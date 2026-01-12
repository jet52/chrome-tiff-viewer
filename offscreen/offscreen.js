// Offscreen document for OCR processing
// Patches Worker constructor to use inlined blob, then uses Tesseract.js API

let tesseractWorker = null;
let workerReady = false;

const baseUrl = chrome.runtime.getURL('lib');

/**
 * Fetch and create inlined worker blob
 */
async function createInlinedWorkerBlob() {
  console.log('[OCR Offscreen] Fetching scripts for blob...');

  const [workerCode, coreCode] = await Promise.all([
    fetch(baseUrl + '/tesseract-worker.min.js').then(r => r.text()),
    fetch(baseUrl + '/tesseract-core-simd.wasm.js').then(r => r.text())
  ]);

  console.log('[OCR Offscreen] Creating inlined blob...');

  const blobCode = `
// Debug: wrap postMessage to log outgoing messages
const _originalPostMessage = self.postMessage.bind(self);
self.postMessage = function(msg, transfer) {
  console.log('[BlobWorker] postMessage:', JSON.stringify(msg).substring(0, 150));
  return _originalPostMessage(msg, transfer);
};

// Mock importScripts - core is inlined
self.importScripts = function() {
  console.log('[BlobWorker] importScripts called (no-op)');
};

console.log('[BlobWorker] Starting...');

// Inlined Tesseract Core
${coreCode}

console.log('[BlobWorker] Core loaded');

// Inlined Tesseract Worker
${workerCode}

console.log('[BlobWorker] Worker code loaded');
`;

  const blob = new Blob([blobCode], { type: 'application/javascript' });
  return URL.createObjectURL(blob);
}

/**
 * Initialize by patching Worker and using Tesseract API
 */
async function initWorker() {
  if (tesseractWorker && workerReady) return;

  console.log('[OCR Offscreen] Initializing...');

  try {
    if (typeof Tesseract === 'undefined') {
      throw new Error('Tesseract library not loaded');
    }

    // Create our inlined blob URL first
    const blobUrl = await createInlinedWorkerBlob();
    console.log('[OCR Offscreen] Blob URL created');

    // Patch the global Worker constructor to intercept Tesseract's worker creation
    const OriginalWorker = self.Worker;
    self.Worker = function(url, options) {
      console.log('[OCR Offscreen] Worker constructor intercepted, using blob');
      // Always use our blob instead of whatever URL Tesseract tries to use
      return new OriginalWorker(blobUrl, options);
    };

    // Now use Tesseract.js API - it will use our patched Worker
    tesseractWorker = await Tesseract.createWorker('eng', 1, {
      langPath: baseUrl,
      gzip: true,
      cacheMethod: 'none',
      logger: (m) => {
        console.log('[OCR Offscreen] Progress:', m.status, Math.round(m.progress * 100) + '%');
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
    console.log('[OCR Offscreen] Tesseract worker ready');

  } catch (err) {
    console.error('[OCR Offscreen] Init failed:', err);
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

  console.log('[OCR Offscreen] Starting recognition...');

  // Add timeout wrapper
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Recognition timed out after 3 minutes')), 180000);
  });

  try {
    const result = await Promise.race([
      tesseractWorker.recognize(imageData),
      timeoutPromise
    ]);
    console.log('[OCR Offscreen] Recognition complete, result:', result ? 'received' : 'null');
    console.log('[OCR Offscreen] Result keys:', result ? Object.keys(result) : 'N/A');

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
    console.error('[OCR Offscreen] Recognition error:', err);
    throw err;
  }
}

// Listen for messages from service worker
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type, requestId } = message;
  console.log('[OCR Offscreen] Received:', type, 'requestId:', requestId);

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

console.log('[OCR Offscreen] Script loaded');
