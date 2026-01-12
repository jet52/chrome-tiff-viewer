// TIFF Viewer - Background Service Worker
// Intercepts TIFF files and redirects them to the viewer

const TIFF_EXTENSIONS = /\.(tiff?|tif)(\?.*)?$/i;
const VIEWER_URL = chrome.runtime.getURL('viewer/viewer.html');

// Rule ID counter for dynamic rules
let ruleIdCounter = 1;

// Store for pending redirects (URL -> rule ID)
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

// === Method 1: Intercept downloads ===
// When Chrome decides to download a TIFF, cancel it and open in viewer
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

// === Method 2: Pre-create redirect rules for .tif/.tiff navigation ===
// Listen for navigation to TIFF URLs and create redirect rules
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

// === Method 3: Handle direct navigation via webNavigation ===
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

// Clean up old dynamic rules on startup
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

let creatingOffscreen = null;

async function setupOffscreen() {
  // Check if offscreen document already exists
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL('offscreen/offscreen.html')]
  });

  if (existingContexts.length > 0) {
    return;
  }

  // Create offscreen document if not already creating
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

// Handle messages from viewer for OCR operations
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'ocr-init' || message.type === 'ocr-recognize' || message.type === 'ocr-terminate') {
    // Forward to offscreen document
    (async () => {
      try {
        await setupOffscreen();
        const response = await chrome.runtime.sendMessage(message);
        sendResponse(response);
      } catch (err) {
        console.error('[TIFF Viewer] OCR error:', err);
        sendResponse({ success: false, error: err.message || String(err) });
      }
    })();
    return true; // Keep channel open for async response
  }

  // Forward progress messages to the viewer tab
  if (message.type === 'ocr-progress' && sender.url?.includes('offscreen')) {
    // Broadcast to all tabs showing viewer
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
