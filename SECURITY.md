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

### 2. Console Logging of Sensitive Content (MEDIUM)

**Locations**:
- `viewer.js:1002-1003` - Logs first 100 chars of OCR text
- `offscreen.js:65` - Logs worker messages
- `offscreen.js:135` - Logs OCR progress
- Multiple debug `console.log` statements throughout

**Risk**: Sensitive document text appears in browser console logs. Other extensions or malicious scripts with console access could capture this. Browser extensions can read console output in some scenarios.

**Mitigation**:
- Remove or gate debug logging behind a flag
- Never log document content, even partial previews
- Use a production build that strips console statements

---

### 3. No URL Validation (MEDIUM)

**Location**: `viewer.js:327-332`
```javascript
async loadFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const url = params.get('url');
  if (url) {
    await this.loadUrl(url);
  }
}
```

**Risk**: The viewer accepts any URL from query parameters without validation. Could be used to:
- Probe internal network resources (SSRF-like)
- Load from `file://` URLs if browser allows
- Load from `javascript:` or `data:` URLs (though fetch would fail)

**Mitigation**:
- Validate URL scheme is `http:` or `https:` (or `file:` if intended)
- Consider a URL allowlist for sensitive deployments
- Validate URL format before fetching

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

| Priority | Issue | Action |
|----------|-------|--------|
| HIGH | Console logging | Remove document content from logs |
| MEDIUM | URL validation | Validate scheme before fetch |
| MEDIUM | Host permissions | Consider narrowing scope |
| LOW | OCR broadcast | Send progress to originating tab only |
| LOW | Message validation | Use exact URL matching |
| LOW | Memory cleanup | Add option to clear document from memory |

---

## For Sensitive Document Use

If deploying for highly sensitive documents:

1. Build a production version with all console.log statements removed
2. Add URL scheme validation (https only for network, file for local)
3. Add a "Close & Clear" button that nullifies all document data
4. Consider disabling OCR feature if text extraction is a concern
5. Deploy with restricted `host_permissions` if possible
