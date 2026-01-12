# TIFF Viewer - Chrome Extension

A Chrome extension that views multi-page TIFF files directly in the browser, similar to Chrome's built-in PDF viewer.

## Features

### Core Viewing
- **Auto-interception**: Automatically opens TIFF files when navigating to `.tif` or `.tiff` URLs
- **Download interception**: Catches TIFF downloads and opens them in the viewer instead
- **Local file support**: Drag-and-drop or file picker for local TIFF files
- **Multi-page support**: Full support for multi-page TIFF documents

### Navigation
- **Page navigation**: Previous/Next buttons, direct page input, keyboard shortcuts
- **View modes**: Toggle between continuous scroll and single-page view
- **Scroll tracking**: In continuous mode, tracks and displays current visible page

### Zoom Controls
- **Preset zoom levels**: 25%, 50%, 75%, 100%, 125%, 150%, 200%, 300%, 400%
- **Fit modes**: Fit to width (default), Fit to page
- **Mouse wheel zoom**: Ctrl+scroll to zoom in/out
- **Keyboard zoom**: Ctrl+Plus/Minus to zoom

### Rotation
- **90-degree rotation**: Rotate current page clockwise or counter-clockwise
- **Per-page rotation**: Each page maintains its own rotation state
- **Persistent during session**: Rotation is preserved while viewing

### OCR (Optical Character Recognition)
- **Tesseract.js integration**: Local OCR processing using Tesseract.js
- **Single page OCR**: Process just the current page
- **Batch OCR**: Process all pages at once
- **Text selection**: After OCR, text becomes selectable/copyable
- **Position-accurate overlay**: OCR text is positioned to match the original document
- **Rotation-aware**: Text overlay adjusts for rotated pages

### Print & Save
- **Print support**: Print all pages with proper page breaks
- **Save original**: Download the original TIFF file

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| Left Arrow / Page Up | Previous page |
| Right Arrow / Page Down | Next page |
| Home | First page |
| End | Last page |
| Ctrl + Plus | Zoom in |
| Ctrl + Minus | Zoom out |
| Ctrl + 0 | Reset zoom to 100% |
| V | Toggle view mode (continuous/single) |
| R | Rotate clockwise |
| Shift + R | Rotate counter-clockwise |
| Ctrl + P | Print |
| Ctrl + S | Save |

## Architecture

### File Structure
```
tiff-browser/
├── manifest.json           # Extension manifest (MV3)
├── background.js           # Service worker for TIFF interception & OCR routing
├── viewer/
│   ├── viewer.html         # Main viewer page
│   ├── viewer.js           # TiffViewer class with all viewing logic
│   └── viewer.css          # Viewer styling
├── offscreen/
│   ├── offscreen.html      # Offscreen document for OCR processing
│   └── offscreen.js        # Tesseract.js worker management
├── lib/
│   ├── UTIF.js             # TIFF decoding library
│   ├── tesseract.min.js    # Tesseract.js main library
│   ├── tesseract-worker.min.js    # Tesseract worker script
│   ├── tesseract-core-simd.wasm.js # Tesseract WASM core
│   └── eng.traineddata.gz  # English language data for OCR
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

### Component Responsibilities

#### background.js (Service Worker)
- Intercepts TIFF file navigation using `declarativeNetRequest`
- Intercepts TIFF downloads and redirects to viewer
- Routes OCR messages between viewer and offscreen document
- Manages offscreen document lifecycle

#### viewer/viewer.js (TiffViewer Class)
- Loads and decodes TIFF files using UTIF.js
- Renders pages to canvas elements
- Handles all user interactions (zoom, rotation, navigation)
- Manages OCR workflow and text overlay rendering

#### offscreen/offscreen.js (OCR Processor)
- Creates Tesseract.js worker with inlined blob scripts
- Processes OCR requests from the viewer
- Returns serializable OCR results (text, confidence, word bounding boxes)

### OCR Implementation Notes

Chrome extension restrictions prevent loading Web Workers from external URLs or using `importScripts()`. The solution:

1. **Offscreen document**: Chrome MV3 allows offscreen documents to run workers
2. **Inlined blob worker**: The Tesseract worker and WASM core are fetched as text and combined into a single blob URL
3. **Worker constructor patching**: The global `Worker` constructor is temporarily patched so Tesseract.js uses our blob worker
4. **Request ID messaging**: Async responses use a request ID pattern to avoid Chrome's message channel timeouts

## Development

### Loading the Extension
1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked" and select the `tiff-browser` directory

### Testing
- Navigate to any `.tif` or `.tiff` URL
- Drag-and-drop a local TIFF file onto the viewer
- Test multi-page documents for navigation
- Test OCR on scanned documents

### Debugging
- Service worker logs: chrome://extensions/ → TIFF Viewer → "Service worker" link
- Viewer logs: DevTools console on the viewer page
- Offscreen logs: chrome://extensions/ → TIFF Viewer → "offscreen.html" in the views list

## Dependencies

- **UTIF.js**: Pure JavaScript TIFF decoder (https://github.com/nickydev/UTIF.js)
- **Tesseract.js**: JavaScript OCR engine (https://github.com/naptha/tesseract.js)

## Permissions

- `downloads`: Intercept TIFF file downloads
- `tabs`: Update tab URLs when redirecting to viewer
- `webNavigation`: Detect navigation to TIFF URLs
- `declarativeNetRequest`: Create redirect rules for TIFF URLs
- `offscreen`: Create offscreen document for OCR processing
- `<all_urls>`: Access TIFF files from any URL

## Version History

- **1.0.29**: Fixed OCR messaging with request ID pattern, serializable results
- **1.0.26**: Added offscreen document for OCR, save button
- **1.0.0**: Initial release with viewing, zoom, rotation, print
