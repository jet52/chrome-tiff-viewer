# Security Assessment Report

**Extension**: TIFF Viewer v1.0.30
**Date**: January 2026
**Scope**: Security review for handling sensitive documents

---

## Executive Summary

The extension is generally well-designed for its purpose but has several areas of concern when handling sensitive documents. The most significant issues relate to **broad permissions**, **console logging of document content**, and **lack of URL validation**. Most issues are LOW to MEDIUM severity and can be mitigated.

---

## Findings

### 1. Broad Host Permissions (MEDIUM)

**Location**: `manifest.json:18-20`
```json
"host_permissions": ["<all_urls>"]
```

**Risk**: The extension can access any URL, which is more permission than strictly necessary. A compromised extension could exfiltrate data to any domain.

**Mitigation**: Consider limiting to specific protocols:
- `"host_permissions": ["http://*/*", "https://*/*", "file://*/*"]`
- Or allow users to grant permissions on-demand via `optional_permissions`

---

### 2. ~~Console Logging of Sensitive Content~~ (FIXED in v1.0.31)

**Status**: FIXED - All logging now controlled by DEBUG flag (default: false).

Changes made:
- Added `DEBUG = false` flag to all source files
- All `console.log/error` calls replaced with `log/logError` wrappers
- OCR text preview removed from logs entirely
- Blob worker debug logging removed

To enable logging for development, set `DEBUG = true` in the source file.

---

### 3. ~~No URL Validation~~ (FIXED in v1.0.32)

**Location**: `viewer.js:332-359`

**Status**: FIXED - URL scheme validation now implemented.

The viewer now validates URL schemes before fetching, allowing only:
- `http:`
- `https:`
- `file:`

Invalid URLs display an error message instead of attempting to fetch.

---

### 4. Web Accessible Resources (LOW)

**Location**: `manifest.json:24-28`
```json
"web_accessible_resources": [{
  "resources": ["viewer/*", "lib/*", "offscreen/*"],
  "matches": ["<all_urls>"]
}]
```

**Risk**: Any webpage can load extension resources. While necessary for the viewer to work, it exposes:
- Extension detection (fingerprinting)
- Potential for webpage to probe extension behavior

**Mitigation**:
- Limit `matches` to specific domains if the extension is for internal use
- Accept as necessary trade-off for public extension

---

### 5. Document Data in Memory (LOW)

**Location**: `viewer.js:45`
```javascript
this.buffer = null; // Raw TIFF file data
```

**Risk**: Sensitive document data remains in JavaScript memory until page is closed. Could be accessed by:
- Other scripts on the page (none in this extension, but if XSS occurred)
- Browser memory dumps
- Extensions with broad permissions

**Mitigation**:
- Clear `this.buffer` after rendering if save functionality isn't needed
- Consider adding a "Clear document" button for security-conscious users
- Document data is NOT persisted to disk (good)

---

### 6. OCR Data Broadcast (LOW)

**Location**: `background.js:350-358`
```javascript
if (message.type === 'ocr-progress' && sender.url?.includes('offscreen')) {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (tab.url?.includes('viewer/viewer.html')) {
        chrome.tabs.sendMessage(tab.id, message).catch(() => {});
      }
    }
  });
}
```

**Risk**: OCR progress messages are broadcast to ALL viewer tabs, not just the requesting one. If multiple sensitive documents are open, progress leaks between them.

**Mitigation**:
- Track which tab initiated the OCR request
- Only send progress to the originating tab

---

### 7. Message Origin Validation (LOW)

**Location**: `background.js:339`
```javascript
if (message.type === 'ocr-response' && sender.url?.includes('offscreen')) {
```

**Risk**: Sender validation uses string includes rather than exact match. A malicious context with "offscreen" in URL could potentially spoof messages.

**Mitigation**:
- Use exact URL match: `sender.url === chrome.runtime.getURL('offscreen/offscreen.html')`

---

### 8. Third-Party Library Risk (LOW)

**Location**: `lib/` directory contains:
- UTIF.js
- tesseract.min.js
- tesseract-worker.min.js
- tesseract-core-simd.wasm.js

**Risk**: Supply chain attack if libraries are compromised. No integrity verification.

**Mitigation**:
- Document library versions and sources
- Consider Subresource Integrity (SRI) hashes if loading from CDN
- Periodically audit for known vulnerabilities

---

### 9. Print Frame Content (LOW)

**Location**: `viewer.js:732-745`
```javascript
for (const page of this.pages) {
  const dataUrl = page.canvas.toDataURL('image/png');
  html += `<img src="${dataUrl}"...>`;
}
printDoc.write(html);
```

**Risk**: All pages are converted to data URLs and written to a hidden iframe. Large documents temporarily double memory usage.

**Mitigation**:
- Print pages on-demand rather than all at once
- Clear iframe content after printing

---

### 10. No Content Security Policy for Viewer (INFO)

**Location**: `viewer/viewer.html` - No meta CSP tag

**Risk**: If XSS were possible, there's no CSP to limit damage. However, the extension CSP in manifest provides some protection.

**Mitigation**:
- Add meta CSP to viewer.html as defense-in-depth

---

## Positive Security Aspects

1. **No persistent storage**: Documents are not saved to localStorage or IndexedDB
2. **Tesseract cacheMethod: 'none'**: OCR data is not cached to disk
3. **Blob URL cleanup**: Save function revokes blob URLs after use
4. **Local OCR processing**: Document text is never sent to external servers
5. **Manifest V3**: Uses modern extension architecture with isolated service worker
6. **wasm-unsafe-eval only**: CSP doesn't allow arbitrary script execution

---

## Recommendations Summary

| Priority | Issue | Status |
|----------|-------|--------|
| ~~HIGH~~ | ~~Console logging~~ | FIXED (v1.0.31) |
| ~~MEDIUM~~ | ~~URL validation~~ | FIXED (v1.0.32) |
| MEDIUM | Host permissions | Consider narrowing scope |
| LOW | OCR broadcast | Send progress to originating tab only |
| LOW | Message validation | Use exact URL matching |
| LOW | Memory cleanup | Add option to clear document from memory |

---

## For Sensitive Document Use

If deploying for highly sensitive documents:

1. ~~Build a production version with all console.log statements removed~~ (DONE - DEBUG=false)
2. ~~Add URL scheme validation (https only for network, file for local)~~ (DONE - v1.0.32)
3. Add a "Close & Clear" button that nullifies all document data
4. Consider disabling OCR feature if text extraction is a concern
5. Deploy with restricted `host_permissions` if possible
