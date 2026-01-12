/**
 * TIFF Viewer - Background Service Worker
 *
 * This service worker handles:
 * 1. TIFF file interception - Redirects TIFF URLs to the viewer
 * 2. Download interception - Catches TIFF downloads and opens in viewer
 * 3. OCR message routing - Forwards OCR requests between viewer and offscreen document
 *
 * Interception Methods:
 * - declarativeNetRequest: Creates dynamic redirect rules for TIFF URLs
 * - downloads.onDeterminingFilename: Catches TIFF downloads
 * - tabs.onUpdated/onCreated: Detects navigation to TIFF URLs
 * - webNavigation.onBeforeNavigate: Early detection of TIFF navigation
 */

// ==================== Configuration ====================

/** Regex to match TIFF file extensions in URLs */
const TIFF_EXTENSIONS = /\.(tiff?|tif)(\?.*)?$/i;

/** URL of the viewer page */
const VIEWER_URL = chrome.runtime.getURL('viewer/viewer.html');

// ==================== Dynamic Rule Management ====================
//
// Chrome's declarativeNetRequest requires rules to be created before
// navigation occurs. We create temporary rules when TIFF URLs are detected
// and clean them up after 30 seconds.
//

/** Counter for generating unique rule IDs */
let ruleIdCounter = 1;

/** Map of URL -> rule ID for active redirect rules */
const pendingRules = new Map();

/**
 * Create a dynamic redirect rule for a specific URL
 */
async function createRedirectRule(url) {
  // Check if we already have a rule for this URL
  if (pendingRules.has(url)) {
    return;
  }

  const ruleId = ruleIdCounter++;
  pendingRules.set(url, ruleId);

  const viewerUrl = `${VIEWER_URL}?url=${encodeURIComponent(url)}`;

  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      addRules: [{
        id: ruleId,
        priority: 1,
        action: {
          type: 'redirect',
          redirect: { url: viewerUrl }
        },
        condition: {
          urlFilter: url,
          resourceTypes: ['main_frame']
        }
      }],
      removeRuleIds: []
    });

    console.log(`[TIFF Viewer] Created redirect rule ${ruleId} for: ${url}`);

    // Clean up rule after 30 seconds (it should have been used by then)
    setTimeout(() => removeRedirectRule(url), 30000);
  } catch (err) {
    console.error('[TIFF Viewer] Failed to create redirect rule:', err);
    pendingRules.delete(url);
  }
}

/**
 * Remove a dynamic redirect rule
 */
async function removeRedirectRule(url) {
  const ruleId = pendingRules.get(url);
  if (!ruleId) return;

  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      addRules: [],
      removeRuleIds: [ruleId]
    });
    pendingRules.delete(url);
    console.log(`[TIFF Viewer] Removed redirect rule ${ruleId}`);
  } catch (err) {
    console.error('[TIFF Viewer] Failed to remove redirect rule:', err);
  }
}

/**
 * Check if URL is a TIFF file by extension
 */
function isTiffUrl(url) {
  try {
    const urlObj = new URL(url);
    return TIFF_EXTENSIONS.test(urlObj.pathname);
  } catch {
    return TIFF_EXTENSIONS.test(url);
  }
}

/**
 * Open TIFF in viewer
 */
function openInViewer(url, tabId = null) {
  const viewerUrl = `${VIEWER_URL}?url=${encodeURIComponent(url)}`;

  if (tabId) {
    chrome.tabs.update(tabId, { url: viewerUrl });
  } else {
    chrome.tabs.create({ url: viewerUrl });
  }
}

// ==================== Method 1: Download Interception ====================
//
// When Chrome decides to download a TIFF (instead of displaying it),
// we cancel the download and open the URL in our viewer instead.
// Note: blob: URLs are excluded since they're intentional saves from our viewer.
//

chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
  const url = downloadItem.url;
  const filename = downloadItem.filename || '';
  const mime = downloadItem.mime || '';

  // Don't intercept blob URLs (these are intentional saves from our viewer)
  if (url.startsWith('blob:')) {
    suggest({ filename: downloadItem.filename });
    return;
  }

  const isTiff =
    TIFF_EXTENSIONS.test(filename) ||
    TIFF_EXTENSIONS.test(url) ||
    mime === 'image/tiff' ||
    mime === 'image/x-tiff';

  if (isTiff) {
    console.log(`[TIFF Viewer] Intercepted download: ${url}`);

    // Cancel the download
    chrome.downloads.cancel(downloadItem.id);

    // Remove the cancelled download from history
    setTimeout(() => {
      chrome.downloads.erase({ id: downloadItem.id });
    }, 100);

    // Open in viewer
    openInViewer(url);

    // Don't suggest a filename (download is cancelled)
    return;
  }

  // Let other downloads proceed normally
  suggest({ filename: downloadItem.filename });
});

// ==================== Method 2: Tab Navigation Interception ====================
//
// Listen for tab URL changes that involve TIFF files.
// When detected, redirect the tab to our viewer.
//

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url && isTiffUrl(changeInfo.url)) {
    // Skip if it's already our viewer
    if (changeInfo.url.includes(VIEWER_URL)) return;

    console.log(`[TIFF Viewer] Tab navigating to TIFF: ${changeInfo.url}`);
    openInViewer(changeInfo.url, tabId);
  }
});

// Also check when a tab is created with a TIFF URL
chrome.tabs.onCreated.addListener((tab) => {
  if (tab.pendingUrl && isTiffUrl(tab.pendingUrl)) {
    if (tab.pendingUrl.includes(VIEWER_URL)) return;

    console.log(`[TIFF Viewer] New tab with TIFF: ${tab.pendingUrl}`);
    createRedirectRule(tab.pendingUrl);
  }
});

// ==================== Method 3: Early Navigation Interception ====================
//
// Use webNavigation API for early detection of TIFF URL navigation.
// Creates redirect rules before the request is fully processed.
//

chrome.webNavigation?.onBeforeNavigate?.addListener((details) => {
  // Only main frame
  if (details.frameId !== 0) return;

  const url = details.url;

  // Skip our viewer
  if (url.includes('viewer/viewer.html')) return;

  if (isTiffUrl(url)) {
    console.log(`[TIFF Viewer] Navigation to TIFF: ${url}`);

    // Create a redirect rule immediately
    createRedirectRule(url);
  }
});

// ==================== Rule Cleanup ====================
//
// Clean up any leftover redirect rules from previous sessions.
// Rules are created dynamically and should be removed, but this
// handles cases where cleanup didn't happen (e.g., browser crash).
//

chrome.runtime.onStartup.addListener(async () => {
  try {
    const rules = await chrome.declarativeNetRequest.getDynamicRules();
    if (rules.length > 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        addRules: [],
        removeRuleIds: rules.map(r => r.id)
      });
      console.log(`[TIFF Viewer] Cleaned up ${rules.length} old rules`);
    }
  } catch (err) {
    console.error('[TIFF Viewer] Cleanup error:', err);
  }
});

// Also clean up on install
chrome.runtime.onInstalled.addListener(async () => {
  try {
    const rules = await chrome.declarativeNetRequest.getDynamicRules();
    if (rules.length > 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        addRules: [],
        removeRuleIds: rules.map(r => r.id)
      });
    }
    console.log('[TIFF Viewer] Extension installed/updated');
  } catch (err) {
    console.error('[TIFF Viewer] Install cleanup error:', err);
  }
});

// ==================== OCR via Offscreen Document ====================
//
// Chrome MV3 extensions cannot run Web Workers in the service worker.
// We use an offscreen document to host the Tesseract.js worker.
//
// Message Flow:
// 1. Viewer sends ocr-init/ocr-recognize/ocr-terminate to background
// 2. Background ensures offscreen document exists
// 3. Background forwards message to offscreen with a unique requestId
// 4. Offscreen processes and sends ocr-response back with the requestId
// 5. Background matches response to pending callback and resolves
//
// Note: We use request IDs because Chrome's sendResponse times out
// before long OCR operations complete.
//

/** Promise tracking offscreen document creation to prevent duplicates */
let creatingOffscreen = null;

/** Counter for generating unique OCR request IDs */
let ocrRequestId = 0;

/** Map of requestId -> sendResponse callback for pending OCR requests */
const pendingOcrRequests = new Map();

/**
 * Ensure the offscreen document exists for OCR processing
 * Creates it if needed, waits if creation is already in progress
 */
async function setupOffscreen() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL('offscreen/offscreen.html')]
  });

  if (existingContexts.length > 0) {
    return;
  }

  if (creatingOffscreen) {
    await creatingOffscreen;
  } else {
    creatingOffscreen = chrome.offscreen.createDocument({
      url: 'offscreen/offscreen.html',
      reasons: ['WORKERS'],
      justification: 'Run Tesseract.js OCR worker for text recognition'
    });
    await creatingOffscreen;
    creatingOffscreen = null;
  }
}

// Handle messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle OCR requests from viewer
  if (message.type === 'ocr-init' || message.type === 'ocr-recognize' || message.type === 'ocr-terminate') {
    const requestId = ++ocrRequestId;

    // Store the response callback
    pendingOcrRequests.set(requestId, sendResponse);

    // Forward to offscreen with request ID
    (async () => {
      try {
        await setupOffscreen();
        // Send message with request ID - offscreen will respond with ocr-response
        chrome.runtime.sendMessage({
          ...message,
          requestId
        });
      } catch (err) {
        console.error('[TIFF Viewer] OCR setup error:', err);
        const callback = pendingOcrRequests.get(requestId);
        if (callback) {
          callback({ success: false, error: err.message || String(err) });
          pendingOcrRequests.delete(requestId);
        }
      }
    })();

    return true; // Keep channel open
  }

  // Handle OCR responses from offscreen
  if (message.type === 'ocr-response' && sender.url?.includes('offscreen')) {
    const { requestId, ...response } = message;
    const callback = pendingOcrRequests.get(requestId);
    if (callback) {
      console.log('[TIFF Viewer] OCR response received for request:', requestId);
      callback(response);
      pendingOcrRequests.delete(requestId);
    }
    return false;
  }

  // Forward progress messages to viewer tabs
  if (message.type === 'ocr-progress' && sender.url?.includes('offscreen')) {
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        if (tab.url?.includes('viewer/viewer.html')) {
          chrome.tabs.sendMessage(tab.id, message).catch(() => {});
        }
      }
    });
  }
});

console.log('[TIFF Viewer] Service worker loaded');
