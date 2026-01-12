// TIFF Viewer - Main viewer logic

class TiffViewer {
  constructor() {
    // State
    this.pages = [];           // Array of page data { ifd, canvas, rotation, ocrData, textOverlay }
    this.currentPage = 0;      // Current page index (0-based)
    this.zoom = 'fit-width';   // Current zoom level (default to fit width)
    this.viewMode = 'continuous'; // 'continuous' or 'single'
    this.buffer = null;        // Raw TIFF data

    // OCR state
    this.ocrWorker = null;     // Tesseract worker instance
    this.ocrInProgress = false;
    this.ocrCancelled = false;

    // Zoom levels
    this.zoomLevels = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

    // Cache DOM elements
    this.elements = {
      toolbar: document.getElementById('toolbar'),
      pagesContainer: document.getElementById('pages-container'),
      loadingOverlay: document.getElementById('loading-overlay'),
      loadingText: document.getElementById('loading-text'),
      loadingProgress: document.getElementById('loading-progress'),
      errorDisplay: document.getElementById('error-display'),
      errorMessage: document.getElementById('error-message'),
      errorDetails: document.getElementById('error-details'),
      dropZone: document.getElementById('drop-zone'),
      fileInput: document.getElementById('file-input'),
      pageInput: document.getElementById('page-input'),
      pageTotal: document.getElementById('page-total'),
      zoomSelect: document.getElementById('zoom-select'),
      fileInfo: document.getElementById('file-info'),
      viewModeLabel: document.getElementById('view-mode-label'),
      iconContinuous: document.getElementById('icon-continuous'),
      iconSingle: document.getElementById('icon-single'),
      printFrame: document.getElementById('print-frame'),
      // OCR elements
      ocrDropdown: document.getElementById('ocr-dropdown'),
      ocrOverlay: document.getElementById('ocr-overlay'),
      ocrStatus: document.getElementById('ocr-status'),
      ocrProgressFill: document.getElementById('ocr-progress-fill'),
      ocrProgressText: document.getElementById('ocr-progress-text'),
    };

    // Bind methods
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleWheel = this.handleWheel.bind(this);
    this.handleScroll = this.handleScroll.bind(this);
    this.handleDrop = this.handleDrop.bind(this);
    this.handleDragOver = this.handleDragOver.bind(this);

    this.init();
  }

  init() {
    this.setupEventListeners();
    this.loadFromUrl();
  }

  setupEventListeners() {
    // Navigation buttons
    document.getElementById('btn-prev').addEventListener('click', () => this.prevPage());
    document.getElementById('btn-next').addEventListener('click', () => this.nextPage());
    this.elements.pageInput.addEventListener('change', (e) => this.goToPage(parseInt(e.target.value) - 1));
    this.elements.pageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.goToPage(parseInt(e.target.value) - 1);
    });

    // Zoom controls
    document.getElementById('btn-zoom-out').addEventListener('click', () => this.zoomOut());
    document.getElementById('btn-zoom-in').addEventListener('click', () => this.zoomIn());
    this.elements.zoomSelect.addEventListener('change', (e) => this.setZoom(e.target.value));

    // Rotation controls
    document.getElementById('btn-rotate-ccw').addEventListener('click', () => this.rotate(-90));
    document.getElementById('btn-rotate-cw').addEventListener('click', () => this.rotate(90));

    // View mode toggle
    document.getElementById('btn-view-mode').addEventListener('click', () => this.toggleViewMode());

    // Print
    document.getElementById('btn-print').addEventListener('click', () => this.print());

    // File chooser
    document.getElementById('btn-choose-file')?.addEventListener('click', () => {
      this.elements.fileInput.click();
    });
    this.elements.fileInput.addEventListener('change', (e) => {
      if (e.target.files[0]) this.loadFile(e.target.files[0]);
    });

    // Drag and drop
    document.addEventListener('dragover', this.handleDragOver);
    document.addEventListener('drop', this.handleDrop);
    document.addEventListener('dragleave', (e) => {
      if (e.relatedTarget === null) {
        this.elements.dropZone.classList.remove('active');
      }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', this.handleKeyDown);

    // Mouse wheel zoom (Ctrl+wheel)
    this.elements.pagesContainer.addEventListener('wheel', this.handleWheel, { passive: false });

    // Scroll tracking for continuous mode
    this.elements.pagesContainer.addEventListener('scroll', this.handleScroll);

    // OCR dropdown toggle
    document.getElementById('btn-ocr').addEventListener('click', (e) => {
      e.stopPropagation();
      this.elements.ocrDropdown.classList.toggle('open');
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!this.elements.ocrDropdown.contains(e.target)) {
        this.elements.ocrDropdown.classList.remove('open');
      }
    });

    // OCR menu items
    document.getElementById('btn-ocr-current').addEventListener('click', () => {
      this.elements.ocrDropdown.classList.remove('open');
      this.ocrCurrentPage();
    });

    document.getElementById('btn-ocr-all').addEventListener('click', () => {
      this.elements.ocrDropdown.classList.remove('open');
      this.ocrAllPages();
    });

    document.getElementById('btn-ocr-clear').addEventListener('click', () => {
      this.elements.ocrDropdown.classList.remove('open');
      this.clearOcr();
    });

    // OCR cancel button
    document.getElementById('btn-ocr-cancel').addEventListener('click', () => {
      this.cancelOcr();
    });
  }

  handleKeyDown(e) {
    // Ignore if typing in input
    if (e.target.tagName === 'INPUT') return;

    switch (e.key) {
      case 'ArrowLeft':
      case 'PageUp':
        e.preventDefault();
        this.prevPage();
        break;
      case 'ArrowRight':
      case 'PageDown':
        e.preventDefault();
        this.nextPage();
        break;
      case 'Home':
        e.preventDefault();
        this.goToPage(0);
        break;
      case 'End':
        e.preventDefault();
        this.goToPage(this.pages.length - 1);
        break;
      case '+':
      case '=':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          this.zoomIn();
        }
        break;
      case '-':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          this.zoomOut();
        }
        break;
      case '0':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          this.setZoom(1);
        }
        break;
      case 'v':
      case 'V':
        this.toggleViewMode();
        break;
      case 'r':
        this.rotate(e.shiftKey ? -90 : 90);
        break;
      case 'p':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          this.print();
        }
        break;
    }
  }

  handleWheel(e) {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      if (e.deltaY < 0) {
        this.zoomIn();
      } else {
        this.zoomOut();
      }
    }
  }

  handleScroll() {
    if (this.viewMode !== 'continuous' || this.pages.length === 0) return;

    const container = this.elements.pagesContainer;
    const scrollTop = container.scrollTop;
    const containerHeight = container.clientHeight;

    // Find which page is most visible
    let maxVisiblePage = 0;
    let maxVisibleArea = 0;

    for (let i = 0; i < this.pages.length; i++) {
      const pageEl = this.pages[i].element;
      if (!pageEl) continue;

      const rect = pageEl.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();

      const visibleTop = Math.max(rect.top, containerRect.top);
      const visibleBottom = Math.min(rect.bottom, containerRect.bottom);
      const visibleArea = Math.max(0, visibleBottom - visibleTop);

      if (visibleArea > maxVisibleArea) {
        maxVisibleArea = visibleArea;
        maxVisiblePage = i;
      }
    }

    if (maxVisiblePage !== this.currentPage) {
      this.currentPage = maxVisiblePage;
      this.updatePageIndicator();
    }
  }

  handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    this.elements.dropZone.classList.add('active');
    this.elements.dropZone.style.display = 'flex';
  }

  handleDrop(e) {
    e.preventDefault();
    this.elements.dropZone.classList.remove('active');
    this.elements.dropZone.style.display = 'none';

    const file = e.dataTransfer.files[0];
    if (file && (file.type === 'image/tiff' || /\.tiff?$/i.test(file.name))) {
      this.loadFile(file);
    }
  }

  async loadFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const url = params.get('url');

    if (url) {
      await this.loadUrl(url);
    } else {
      // Show drop zone for file selection
      this.showDropZone();
    }
  }

  showDropZone() {
    this.elements.loadingOverlay.style.display = 'none';
    this.elements.dropZone.style.display = 'flex';
  }

  showLoading(message = 'Loading TIFF...') {
    this.elements.loadingOverlay.style.display = 'flex';
    this.elements.loadingText.textContent = message;
    this.elements.loadingProgress.textContent = '';
    this.elements.errorDisplay.style.display = 'none';
    this.elements.dropZone.style.display = 'none';
  }

  showError(message, details = '') {
    this.elements.loadingOverlay.style.display = 'none';
    this.elements.errorDisplay.style.display = 'flex';
    this.elements.errorMessage.textContent = message;
    this.elements.errorDetails.textContent = details;
  }

  hideLoading() {
    this.elements.loadingOverlay.style.display = 'none';
  }

  async loadUrl(url) {
    this.showLoading('Fetching TIFF file...');

    try {
      // Update page title
      const filename = decodeURIComponent(url.split('/').pop().split('?')[0]);
      document.title = filename + ' - TIFF Viewer';
      this.elements.fileInfo.textContent = filename;

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentLength = response.headers.get('content-length');
      const total = contentLength ? parseInt(contentLength, 10) : 0;

      // Read with progress
      const reader = response.body.getReader();
      const chunks = [];
      let received = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;

        if (total) {
          const percent = Math.round((received / total) * 100);
          this.elements.loadingProgress.textContent = `${percent}% (${this.formatBytes(received)} / ${this.formatBytes(total)})`;
        } else {
          this.elements.loadingProgress.textContent = this.formatBytes(received);
        }
      }

      // Combine chunks
      this.buffer = new Uint8Array(received);
      let offset = 0;
      for (const chunk of chunks) {
        this.buffer.set(chunk, offset);
        offset += chunk.length;
      }

      await this.decodeTiff();
    } catch (err) {
      console.error('Failed to load TIFF:', err);
      this.showError('Failed to load TIFF file', err.message);
    }
  }

  async loadFile(file) {
    this.showLoading('Reading file...');

    try {
      document.title = file.name + ' - TIFF Viewer';
      this.elements.fileInfo.textContent = file.name;

      this.buffer = new Uint8Array(await file.arrayBuffer());
      await this.decodeTiff();
    } catch (err) {
      console.error('Failed to load file:', err);
      this.showError('Failed to load TIFF file', err.message);
    }
  }

  async decodeTiff() {
    this.showLoading('Decoding TIFF...');

    try {
      // Decode TIFF structure
      const ifds = UTIF.decode(this.buffer);

      if (!ifds || ifds.length === 0) {
        throw new Error('No pages found in TIFF file');
      }

      this.elements.loadingText.textContent = `Rendering ${ifds.length} page${ifds.length > 1 ? 's' : ''}...`;

      // Clear existing pages
      this.pages = [];
      this.elements.pagesContainer.innerHTML = '';

      // Decode and render each page
      for (let i = 0; i < ifds.length; i++) {
        this.elements.loadingProgress.textContent = `Page ${i + 1} of ${ifds.length}`;

        const ifd = ifds[i];
        UTIF.decodeImage(this.buffer, ifd);

        const rgba = UTIF.toRGBA8(ifd);
        const width = ifd.width;
        const height = ifd.height;

        // Create canvas
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        const imageData = ctx.createImageData(width, height);
        imageData.data.set(rgba);
        ctx.putImageData(imageData, 0, 0);

        // Create page wrapper
        const pageWrapper = document.createElement('div');
        pageWrapper.className = 'page-wrapper';
        pageWrapper.dataset.pageIndex = i;

        const pageContent = document.createElement('div');
        pageContent.className = 'page-content';
        pageContent.appendChild(canvas);

        pageWrapper.appendChild(pageContent);
        this.elements.pagesContainer.appendChild(pageWrapper);

        this.pages.push({
          ifd,
          canvas,
          width,
          height,
          rotation: 0,
          element: pageWrapper,
          ocrData: null,      // Will hold OCR results
          textOverlay: null   // Will hold text overlay element
        });
      }

      // Update UI
      this.elements.pageTotal.textContent = this.pages.length;
      this.elements.pageInput.max = this.pages.length;
      this.updateNavigationButtons();
      this.updatePageIndicator();
      this.applyZoom();
      this.updateViewMode();

      this.hideLoading();
    } catch (err) {
      console.error('Failed to decode TIFF:', err);
      this.showError('Failed to decode TIFF file', err.message);
    }
  }

  // Navigation
  prevPage() {
    if (this.currentPage > 0) {
      this.goToPage(this.currentPage - 1);
    }
  }

  nextPage() {
    if (this.currentPage < this.pages.length - 1) {
      this.goToPage(this.currentPage + 1);
    }
  }

  goToPage(index) {
    if (index < 0 || index >= this.pages.length) return;

    this.currentPage = index;
    this.updatePageIndicator();
    this.updateNavigationButtons();

    if (this.viewMode === 'single') {
      this.updateViewMode();
    } else {
      // Scroll to page in continuous mode
      const pageEl = this.pages[index].element;
      if (pageEl) {
        pageEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  }

  updatePageIndicator() {
    this.elements.pageInput.value = this.currentPage + 1;
  }

  updateNavigationButtons() {
    document.getElementById('btn-prev').disabled = this.currentPage === 0;
    document.getElementById('btn-next').disabled = this.currentPage >= this.pages.length - 1;
  }

  // Zoom
  zoomIn() {
    const currentIndex = this.zoomLevels.indexOf(this.zoom);
    if (currentIndex < this.zoomLevels.length - 1) {
      this.setZoom(this.zoomLevels[currentIndex + 1]);
    } else if (currentIndex === -1) {
      // Find next level above current zoom
      const nextLevel = this.zoomLevels.find(z => z > this.zoom);
      if (nextLevel) this.setZoom(nextLevel);
    }
  }

  zoomOut() {
    const currentIndex = this.zoomLevels.indexOf(this.zoom);
    if (currentIndex > 0) {
      this.setZoom(this.zoomLevels[currentIndex - 1]);
    } else if (currentIndex === -1) {
      // Find previous level below current zoom
      const prevLevels = this.zoomLevels.filter(z => z < this.zoom);
      if (prevLevels.length) this.setZoom(prevLevels[prevLevels.length - 1]);
    }
  }

  setZoom(value) {
    if (value === 'fit-width' || value === 'fit-page') {
      this.zoom = value;
    } else {
      this.zoom = parseFloat(value);
    }

    this.elements.zoomSelect.value = value;
    this.applyZoom();
  }

  applyZoom() {
    if (this.pages.length === 0) return;

    const container = this.elements.pagesContainer;
    const containerWidth = container.clientWidth - 40; // Account for padding
    const containerHeight = container.clientHeight - 40;

    for (const page of this.pages) {
      const { canvas, width, height, rotation, element } = page;
      const pageContent = element.querySelector('.page-content');

      // Get effective dimensions after rotation
      const isRotated = rotation % 180 !== 0;
      const effectiveWidth = isRotated ? height : width;
      const effectiveHeight = isRotated ? width : height;

      let scale;
      if (this.zoom === 'fit-width') {
        scale = containerWidth / effectiveWidth;
      } else if (this.zoom === 'fit-page') {
        const scaleX = containerWidth / effectiveWidth;
        const scaleY = containerHeight / effectiveHeight;
        scale = Math.min(scaleX, scaleY);
      } else {
        scale = this.zoom;
      }

      // Store computed scale for text overlay
      page.computedScale = scale;

      // Apply scale to canvas
      canvas.style.width = `${width * scale}px`;
      canvas.style.height = `${height * scale}px`;

      // Apply rotation
      canvas.style.transform = `rotate(${rotation}deg)`;

      // Adjust wrapper size for rotated canvas
      if (isRotated) {
        pageContent.style.width = `${height * scale}px`;
        pageContent.style.height = `${width * scale}px`;
      } else {
        pageContent.style.width = `${width * scale}px`;
        pageContent.style.height = `${height * scale}px`;
      }

      // Update text overlay if exists
      if (page.textOverlay && page.ocrData) {
        this.updateTextOverlay(page);
      }
    }

    // Update zoom select if using numeric zoom
    if (typeof this.zoom === 'number') {
      const option = Array.from(this.elements.zoomSelect.options).find(
        o => parseFloat(o.value) === this.zoom
      );
      if (option) {
        this.elements.zoomSelect.value = option.value;
      }
    }
  }

  // Rotation
  rotate(degrees) {
    if (this.pages.length === 0) return;

    const page = this.pages[this.currentPage];
    page.rotation = (page.rotation + degrees + 360) % 360;

    this.applyZoom();
  }

  // View Mode
  toggleViewMode() {
    this.viewMode = this.viewMode === 'continuous' ? 'single' : 'continuous';
    this.updateViewMode();
  }

  updateViewMode() {
    const isContinuous = this.viewMode === 'continuous';

    this.elements.viewModeLabel.textContent = isContinuous ? 'Continuous' : 'Single Page';
    this.elements.iconContinuous.style.display = isContinuous ? 'block' : 'none';
    this.elements.iconSingle.style.display = isContinuous ? 'none' : 'block';

    this.elements.pagesContainer.className = isContinuous ? 'continuous-mode' : 'single-mode';

    // Show/hide pages
    for (let i = 0; i < this.pages.length; i++) {
      const page = this.pages[i];
      if (isContinuous) {
        page.element.style.display = 'flex';
      } else {
        page.element.style.display = i === this.currentPage ? 'flex' : 'none';
      }
    }
  }

  // Print
  print() {
    if (this.pages.length === 0) return;

    const printFrame = this.elements.printFrame;
    const printDoc = printFrame.contentDocument || printFrame.contentWindow.document;

    // Build print HTML
    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          @media print {
            body { margin: 0; }
            .print-page {
              page-break-after: always;
              display: flex;
              justify-content: center;
              align-items: center;
              height: 100vh;
            }
            .print-page:last-child {
              page-break-after: auto;
            }
            .print-page img {
              max-width: 100%;
              max-height: 100vh;
              object-fit: contain;
            }
          }
        </style>
      </head>
      <body>
    `;

    for (const page of this.pages) {
      const dataUrl = page.canvas.toDataURL('image/png');
      html += `
        <div class="print-page">
          <img src="${dataUrl}" style="transform: rotate(${page.rotation}deg);">
        </div>
      `;
    }

    html += '</body></html>';

    printDoc.open();
    printDoc.write(html);
    printDoc.close();

    // Wait for images to load then print
    setTimeout(() => {
      printFrame.contentWindow.print();
    }, 250);
  }

  // ==================== OCR Functions ====================

  /**
   * Create and initialize the OCR sandbox iframe
   */
  async initOcrSandbox() {
    if (this.ocrSandbox && this.ocrSandboxReady) {
      return this.ocrSandbox;
    }

    console.log('[OCR] Creating sandbox iframe...');

    return new Promise((resolve, reject) => {
      // Create iframe for sandbox (visible for debugging)
      const iframe = document.createElement('iframe');
      const sandboxUrl = chrome.runtime.getURL('sandbox/ocr-sandbox.html');
      console.log('[OCR] Sandbox URL:', sandboxUrl);
      iframe.src = sandboxUrl;
      iframe.id = 'ocr-sandbox-frame';
      // Make it visible for debugging
      iframe.style.position = 'fixed';
      iframe.style.bottom = '0';
      iframe.style.right = '0';
      iframe.style.width = '300px';
      iframe.style.height = '100px';
      iframe.style.border = '2px solid red';
      iframe.style.zIndex = '9999';
      iframe.style.background = 'white';
      document.body.appendChild(iframe);

      this.ocrSandbox = iframe;
      this.ocrMessageId = 0;
      this.ocrPendingMessages = new Map();

      // Listen for messages from sandbox
      const messageHandler = (event) => {
        console.log('[OCR] Received message:', event.data);
        const { type, id, success, data, error, status, progress } = event.data || {};

        if (type === 'ocr-sandbox-ready') {
          console.log('[OCR] Sandbox is ready');
          this.ocrSandboxReady = true;
          // Hide iframe after confirmed working
          iframe.style.display = 'none';
          resolve(iframe);
        }

        if (type === 'ocr-progress') {
          this.handleOcrProgress(status, progress);
        }

        if (type === 'ocr-init-result' || type === 'ocr-result' || type === 'ocr-terminated') {
          const pending = this.ocrPendingMessages.get(id);
          if (pending) {
            this.ocrPendingMessages.delete(id);
            if (success) {
              pending.resolve(data);
            } else {
              pending.reject(new Error(error || 'Unknown OCR error'));
            }
          }
        }

        if (type === 'ocr-sandbox-error') {
          console.error('[OCR] Sandbox error:', error);
        }
      };

      window.addEventListener('message', messageHandler);
      this.ocrMessageHandler = messageHandler;

      // Also listen for iframe load event
      iframe.onload = () => {
        console.log('[OCR] Iframe loaded');
      };

      iframe.onerror = (err) => {
        console.error('[OCR] Iframe error:', err);
        reject(new Error('Failed to load OCR sandbox'));
      };

      // Timeout after 60 seconds
      setTimeout(() => {
        if (!this.ocrSandboxReady) {
          console.error('[OCR] Sandbox timed out. Check if sandbox page loaded correctly.');
          reject(new Error('OCR sandbox initialization timed out. Check console for errors.'));
        }
      }, 60000);
    });
  }

  /**
   * Handle OCR progress updates from sandbox
   */
  handleOcrProgress(status, progress) {
    console.log('[OCR] Progress:', status, progress);
    const percent = Math.round(progress * 100);

    if (status === 'recognizing text') {
      this.updateOcrProgress(`Recognizing text...`, percent);
    } else if (status === 'loading language traineddata') {
      this.updateOcrProgress(`Loading language data...`, percent);
    } else if (status === 'initializing tesseract') {
      this.updateOcrProgress(`Initializing Tesseract...`, 0);
    } else if (status === 'loading tesseract core') {
      this.updateOcrProgress(`Loading OCR engine...`, percent);
    } else if (status === 'initialized tesseract') {
      this.updateOcrProgress(`OCR engine ready`, 100);
    }
  }

  /**
   * Send message to OCR sandbox and wait for response
   */
  sendToSandbox(type, data = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.ocrMessageId;
      this.ocrPendingMessages.set(id, { resolve, reject });

      this.ocrSandbox.contentWindow.postMessage({
        type,
        id,
        ...data
      }, '*');

      // Timeout after 60 seconds for OCR operations
      setTimeout(() => {
        if (this.ocrPendingMessages.has(id)) {
          this.ocrPendingMessages.delete(id);
          reject(new Error('OCR operation timed out'));
        }
      }, 60000);
    });
  }

  /**
   * Initialize OCR (via sandbox)
   */
  async initOcr() {
    this.updateOcrProgress('Initializing OCR engine...', 0);

    try {
      await this.initOcrSandbox();
      await this.sendToSandbox('ocr-init');
      console.log('[OCR] OCR initialized successfully');
    } catch (err) {
      console.error('[OCR] Failed to initialize OCR:', err);
      throw err;
    }
  }

  /**
   * Show OCR progress overlay
   */
  showOcrOverlay() {
    this.elements.ocrOverlay.style.display = 'flex';
    this.ocrInProgress = true;
    this.ocrCancelled = false;
  }

  /**
   * Hide OCR progress overlay
   */
  hideOcrOverlay() {
    this.elements.ocrOverlay.style.display = 'none';
    this.ocrInProgress = false;
  }

  /**
   * Update OCR progress display
   */
  updateOcrProgress(status, percent) {
    this.elements.ocrStatus.textContent = status;
    this.elements.ocrProgressFill.style.width = `${percent}%`;
    this.elements.ocrProgressText.textContent = `${percent}%`;
  }

  /**
   * Cancel ongoing OCR
   */
  cancelOcr() {
    this.ocrCancelled = true;
    this.hideOcrOverlay();
  }

  /**
   * OCR current page
   */
  async ocrCurrentPage() {
    if (this.pages.length === 0 || this.ocrInProgress) return;

    this.showOcrOverlay();

    try {
      await this.initOcr();

      if (this.ocrCancelled) return;

      const page = this.pages[this.currentPage];
      this.updateOcrProgress(`Processing page ${this.currentPage + 1}...`, 0);

      await this.ocrPage(page, this.currentPage);

      this.hideOcrOverlay();
    } catch (err) {
      console.error('[OCR] Error during OCR:', err);
      this.hideOcrOverlay();
      const errorMsg = err && err.message ? err.message : (err ? err.toString() : 'Unknown error occurred');
      alert('OCR failed: ' + errorMsg);
    }
  }

  /**
   * OCR all pages
   */
  async ocrAllPages() {
    if (this.pages.length === 0 || this.ocrInProgress) return;

    this.showOcrOverlay();

    try {
      await this.initOcr();

      for (let i = 0; i < this.pages.length; i++) {
        if (this.ocrCancelled) break;

        const page = this.pages[i];
        this.updateOcrProgress(`Processing page ${i + 1} of ${this.pages.length}...`, 0);

        await this.ocrPage(page, i);
      }

      this.hideOcrOverlay();
    } catch (err) {
      console.error('[OCR] Error during OCR:', err);
      this.hideOcrOverlay();
      const errorMsg = err && err.message ? err.message : (err ? err.toString() : 'Unknown error occurred');
      alert('OCR failed: ' + errorMsg);
    }
  }

  /**
   * OCR a single page
   */
  async ocrPage(page, pageIndex) {
    if (page.ocrData) {
      // Already processed, skip
      console.log(`[OCR] Page ${pageIndex + 1} already processed, skipping`);
      return;
    }

    const canvas = page.canvas;
    console.log(`[OCR] Starting recognition for page ${pageIndex + 1}, canvas size: ${canvas.width}x${canvas.height}`);

    try {
      // Convert canvas to data URL for sending to sandbox
      const imageData = canvas.toDataURL('image/png');

      // Send to sandbox for OCR
      const result = await this.sendToSandbox('ocr-recognize', { imageData });

      if (this.ocrCancelled) {
        console.log('[OCR] Cancelled');
        return;
      }

      console.log('[OCR] Recognition result received');

      // Store OCR data
      page.ocrData = result;

      // Create text overlay
      this.createTextOverlay(page);

      // Mark page as processed
      page.element.classList.add('ocr-processed');

      const textPreview = result.text ? result.text.substring(0, 100) : '(no text)';
      console.log(`[OCR] Completed for page ${pageIndex + 1}: ${textPreview}...`);
    } catch (err) {
      console.error(`[OCR] Failed to recognize page ${pageIndex + 1}:`, err);
      throw new Error(`Failed to process page ${pageIndex + 1}: ${err.message || err}`);
    }
  }

  /**
   * Create text overlay for a page
   */
  createTextOverlay(page) {
    // Remove existing overlay if any
    if (page.textOverlay) {
      page.textOverlay.remove();
    }

    const overlay = document.createElement('div');
    overlay.className = 'text-overlay selectable';

    const pageContent = page.element.querySelector('.page-content');
    pageContent.style.position = 'relative';
    pageContent.appendChild(overlay);

    page.textOverlay = overlay;

    // Populate with words
    this.updateTextOverlay(page);
  }

  /**
   * Update text overlay positions based on current zoom/rotation
   */
  updateTextOverlay(page) {
    if (!page.textOverlay || !page.ocrData) return;

    const overlay = page.textOverlay;
    overlay.innerHTML = '';

    const { width, height, rotation, computedScale } = page;
    const scale = computedScale || 1;

    // Determine if rotated
    const isRotated = rotation % 180 !== 0;
    const overlayWidth = isRotated ? height * scale : width * scale;
    const overlayHeight = isRotated ? width * scale : height * scale;

    overlay.style.width = `${overlayWidth}px`;
    overlay.style.height = `${overlayHeight}px`;

    // Process each word from OCR data
    for (const word of page.ocrData.words) {
      const span = document.createElement('span');
      span.textContent = word.text + ' ';

      // Get bounding box
      const bbox = word.bbox;

      // Calculate position based on rotation
      let left, top, wordWidth, wordHeight;

      switch (rotation) {
        case 0:
          left = bbox.x0 * scale;
          top = bbox.y0 * scale;
          wordWidth = (bbox.x1 - bbox.x0) * scale;
          wordHeight = (bbox.y1 - bbox.y0) * scale;
          break;
        case 90:
          left = (height - bbox.y1) * scale;
          top = bbox.x0 * scale;
          wordWidth = (bbox.y1 - bbox.y0) * scale;
          wordHeight = (bbox.x1 - bbox.x0) * scale;
          break;
        case 180:
          left = (width - bbox.x1) * scale;
          top = (height - bbox.y1) * scale;
          wordWidth = (bbox.x1 - bbox.x0) * scale;
          wordHeight = (bbox.y1 - bbox.y0) * scale;
          break;
        case 270:
          left = bbox.y0 * scale;
          top = (width - bbox.x1) * scale;
          wordWidth = (bbox.y1 - bbox.y0) * scale;
          wordHeight = (bbox.x1 - bbox.x0) * scale;
          break;
        default:
          left = bbox.x0 * scale;
          top = bbox.y0 * scale;
          wordWidth = (bbox.x1 - bbox.x0) * scale;
          wordHeight = (bbox.y1 - bbox.y0) * scale;
      }

      span.style.left = `${left}px`;
      span.style.top = `${top}px`;
      span.style.fontSize = `${wordHeight * 0.85}px`;
      span.style.width = `${wordWidth}px`;
      span.style.height = `${wordHeight}px`;

      overlay.appendChild(span);
    }
  }

  /**
   * Clear OCR data from all pages
   */
  clearOcr() {
    for (const page of this.pages) {
      if (page.textOverlay) {
        page.textOverlay.remove();
        page.textOverlay = null;
      }
      page.ocrData = null;
      page.element.classList.remove('ocr-processed');
    }
  }

  // ==================== Utilities ====================

  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }
}

// Initialize viewer when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.tiffViewer = new TiffViewer();
});
