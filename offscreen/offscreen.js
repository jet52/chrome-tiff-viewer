/**
 * Offscreen Document for OCR Processing
 *
 * This runs in an offscreen document context (not the service worker),
 * which allows us to create Web Workers for Tesseract.js.
 *
 * Challenge: Chrome extension workers cannot use importScripts() to load
 * external scripts. Tesseract.js normally creates a worker that loads
 * additional scripts dynamically.
 *
 * Solution: We create an "inlined blob worker" that contains all the
 * necessary Tesseract code bundled together:
 * 1. Fetch tesseract-worker.min.js and tesseract-core-simd.wasm.js as text
 * 2. Combine them into a single blob with a mocked importScripts
 * 3. Patch the global Worker constructor to use our blob
 * 4. Let Tesseract.js create its worker (which uses our patched constructor)
 * 5. Restore the original Worker constructor
 *
 * Message Types:
 * - ocr-init: Initialize the Tesseract worker
 * - ocr-recognize: Process an image and return OCR results
 * - ocr-terminate: Clean up the worker
 * - ocr-response: Response sent back to background.js
 */

// Production mode - set to false to enable debug logging
const DEBUG = false;
const log = DEBUG ? console.log.bind(console) : () => {};
const logError = DEBUG ? console.error.bind(console) : () => {};

// ==================== State ====================

/** The Tesseract.js worker instance */
let tesseractWorker = null;

/** Whether the worker has been initialized and is ready */
let workerReady = false;

/** Base URL for loading Tesseract files from the extension */
const baseUrl = chrome.runtime.getURL('lib');

// ==================== Blob Worker Creation ====================

/**
 * Create a blob URL containing all Tesseract worker code inlined
 *
 * This fetches the worker script and WASM loader as text, then combines
 * them into a single blob. The blob includes:
 * - A mocked importScripts (no-op since everything is inlined)
 * - Debug wrappers for postMessage
 * - The Tesseract core WASM loader
 * - The Tesseract worker script
 *
 * @returns {Promise<string>} Blob URL that can be used with new Worker()
 */
async function createInlinedWorkerBlob() {
  log('[OCR Offscreen] Fetching scripts for blob...');

  const [workerCode, coreCode] = await Promise.all([
    fetch(baseUrl + '/tesseract-worker.min.js').then(r => r.text()),
    fetch(baseUrl + '/tesseract-core-simd.wasm.js').then(r => r.text())
  ]);

  log('[OCR Offscreen] Creating inlined blob...');

  // Note: Logging removed from blob worker for security - it could expose OCR content
  const blobCode = `
// Mock importScripts - core is inlined
self.importScripts = function() {};

// Inlined Tesseract Core
${coreCode}

// Inlined Tesseract Worker
${workerCode}
`;

  const blob = new Blob([blobCode], { type: 'application/javascript' });
  return URL.createObjectURL(blob);
}

// ==================== Worker Initialization ====================

/**
 * Initialize the Tesseract worker using Worker constructor patching
 *
 * The trick here is to temporarily replace the global Worker constructor
 * so that when Tesseract.js tries to create its worker, it gets our
 * pre-built blob worker instead of trying to load from a URL.
 *
 * Steps:
 * 1. Create the inlined blob URL
 * 2. Save the original Worker constructor
 * 3. Replace Worker with a version that always uses our blob
 * 4. Call Tesseract.createWorker() - it will use our patched Worker
 * 5. Restore the original Worker constructor
 */
async function initWorker() {
  if (tesseractWorker && workerReady) return;

  log('[OCR Offscreen] Initializing...');

  try {
    if (typeof Tesseract === 'undefined') {
      throw new Error('Tesseract library not loaded');
    }

    // Create our inlined blob URL first
    const blobUrl = await createInlinedWorkerBlob();
    log('[OCR Offscreen] Blob URL created');

    // Patch the global Worker constructor to intercept Tesseract's worker creation
    const OriginalWorker = self.Worker;
    self.Worker = function(url, options) {
      log('[OCR Offscreen] Worker constructor intercepted, using blob');
      // Always use our blob instead of whatever URL Tesseract tries to use
      return new OriginalWorker(blobUrl, options);
    };

    // Now use Tesseract.js API - it will use our patched Worker
    tesseractWorker = await Tesseract.createWorker('eng', 1, {
      langPath: baseUrl,
      gzip: true,
      cacheMethod: 'none',
      logger: (m) => {
        log('[OCR Offscreen] Progress:', m.status, Math.round(m.progress * 100) + '%');
        chrome.runtime.sendMessage({
          type: 'ocr-progress',
          status: m.status,
          progress: m.progress
        }).catch(() => {});
      }
    });

    // Restore original Worker constructor
    self.Worker = OriginalWorker;

    workerReady = true;
    log('[OCR Offscreen] Tesseract worker ready');

  } catch (err) {
    logError('[OCR Offscreen] Init failed:', err);
    throw err;
  }
}

/**
 * Recognize text with timeout
 */
async function recognize(imageData) {
  if (!tesseractWorker || !workerReady) {
    await initWorker();
  }

  log('[OCR Offscreen] Starting recognition...');

  // Add timeout wrapper
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Recognition timed out after 3 minutes')), 180000);
  });

  try {
    const result = await Promise.race([
      tesseractWorker.recognize(imageData),
      timeoutPromise
    ]);
    log('[OCR Offscreen] Recognition complete, result:', result ? 'received' : 'null');
    log('[OCR Offscreen] Result keys:', result ? Object.keys(result) : 'N/A');

    // Extract only serializable data (the full result object has non-serializable parts)
    const data = result.data;
    return {
      text: data.text,
      confidence: data.confidence,
      // Include basic word data if needed for highlighting, but simplified
      words: data.words ? data.words.map(w => ({
        text: w.text,
        confidence: w.confidence,
        bbox: w.bbox ? { x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 } : null
      })) : []
    };
  } catch (err) {
    logError('[OCR Offscreen] Recognition error:', err);
    throw err;
  }
}

// ==================== Message Handling ====================
//
// Messages come from background.js with a requestId.
// We process the request and send back an ocr-response message
// with the same requestId so background can match it to the callback.
//

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type, requestId } = message;
  log('[OCR Offscreen] Received:', type, 'requestId:', requestId);

  // Helper to send response back to background
  function respond(response) {
    chrome.runtime.sendMessage({
      type: 'ocr-response',
      requestId,
      ...response
    });
  }

  if (type === 'ocr-init') {
    initWorker()
      .then(() => respond({ success: true }))
      .catch(err => respond({ success: false, error: err.message || String(err) }));
    return false;
  }

  if (type === 'ocr-recognize') {
    recognize(message.imageData)
      .then(data => respond({ success: true, data }))
      .catch(err => respond({ success: false, error: err.message || String(err) }));
    return false;
  }

  if (type === 'ocr-terminate') {
    if (tesseractWorker) {
      tesseractWorker.terminate();
      tesseractWorker = null;
      workerReady = false;
    }
    respond({ success: true });
    return false;
  }
});

log('[OCR Offscreen] Script loaded');
