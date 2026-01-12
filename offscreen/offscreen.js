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
 * Recognize text
 */
async function recognize(imageData) {
  if (!tesseractWorker || !workerReady) {
    await initWorker();
  }

  console.log('[OCR Offscreen] Starting recognition...');
  const result = await tesseractWorker.recognize(imageData);
  console.log('[OCR Offscreen] Recognition complete');
  return result.data;
}

// Listen for messages from service worker
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[OCR Offscreen] Received:', message.type);

  if (message.type === 'ocr-init') {
    initWorker()
      .then(() => sendResponse({ success: true }))
      .catch(err => {
        sendResponse({ success: false, error: err.message || String(err) });
      });
    return true;
  }

  if (message.type === 'ocr-recognize') {
    recognize(message.imageData)
      .then(data => sendResponse({ success: true, data }))
      .catch(err => {
        sendResponse({ success: false, error: err.message || String(err) });
      });
    return true;
  }

  if (message.type === 'ocr-terminate') {
    if (tesseractWorker) {
      tesseractWorker.terminate();
      tesseractWorker = null;
      workerReady = false;
    }
    sendResponse({ success: true });
    return false;
  }
});

console.log('[OCR Offscreen] Script loaded');
