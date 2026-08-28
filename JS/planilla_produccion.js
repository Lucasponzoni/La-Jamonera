(function planillaProduccionModule() {
  const safeObject = (value) => (value && typeof value === 'object' ? value : {});
  const normalizeValue = (value) => String(value || '').trim();
  const normalizeUpper = (value) => normalizeValue(value).toUpperCase();
  const escapeHtml = (value) => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const TRACE_BASE_URL = normalizeValue(window.TRACE_BASE_URL) || 'https://lucasponzoni.github.io/La-Jamonera/';

  const formatIsoEs = (iso) => {
    const text = normalizeValue(iso);
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (!match) return text || '-';
    return `${match[3]}-${match[2]}-${match[1]}`;
  };

  const formatMonthYearEs = (iso) => {
    const text = normalizeValue(iso);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00`) : new Date(Number(text));
    if (Number.isNaN(date.getTime())) return text || '-';
    const month = date.toLocaleDateString('es-AR', { month: 'long' }).toUpperCase();
    return `${month} ${date.getFullYear()}`;
  };

  // Mes abreviado (ENE..DIC) para el encabezado del protocolo: se usa la fecha
  // real de elaboracion de la produccion, no un valor fijo.
  const MONTHS_SHORT_ES = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
  const formatMonthShortYearEs = (value) => {
    const text = normalizeValue(value);
    if (!text) return '-';
    const date = /^\d{4}-\d{2}-\d{2}/.test(text) ? new Date(`${text.slice(0, 10)}T00:00:00`) : new Date(Number(text));
    if (Number.isNaN(date.getTime())) return '-';
    return `${MONTHS_SHORT_ES[date.getMonth()]} ${date.getFullYear()}`;
  };
  const addDaysToIso = (isoDate, days) => {
    const text = normalizeValue(isoDate);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return '';
    const date = new Date(`${text}T00:00:00`);
    if (Number.isNaN(date.getTime())) return '';
    date.setDate(date.getDate() + Number(days || 0));
    return date.toISOString().slice(0, 10);
  };

  const formatDateTime = (value) => {
    const d = new Date(Number(value));
    if (Number.isNaN(d.getTime())) return '-';
    return d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const sanitizeFileNamePart = (value, fallback = 'sin-dato') => {
    const cleaned = normalizeValue(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return cleaned || fallback;
  };

  const getPlanillaDocumentTitle = (registro = {}) => {
    const product = sanitizeFileNamePart(registro?.recipeTitle || 'producto');
    const production = sanitizeFileNamePart(registro?.id || 'produccion');
    const date = sanitizeFileNamePart(registro?.productionDate || new Date().toISOString().slice(0, 10), 'fecha');
    return `${production} - ${product} - ${date}`;
  };

  const formatQty = (value, unit = '') => `${Number(value || 0).toFixed(3)} ${normalizeUpper(unit)}`.trim();
  const getUnitFactor = (unitRaw) => {
    const unit = normalizeValue(unitRaw).toLowerCase();
    const massMap = {
      kg: 1000, kilo: 1000, kilos: 1000, kilogramo: 1000, kilogramos: 1000,
      g: 1, gr: 1, gramo: 1, gramos: 1,
      mg: 0.001, miligramo: 0.001, miligramos: 0.001
    };
    const volumeMap = {
      l: 1000, lt: 1000, litro: 1000, litros: 1000,
      ml: 1, mililitro: 1, mililitros: 1, cc: 1
    };
    if (massMap[unit]) return massMap[unit];
    if (volumeMap[unit]) return volumeMap[unit];
    return 1;
  };
  const toKg = (qty, unit) => {
    const amount = Number(qty || 0);
    if (!Number.isFinite(amount)) return 0;
    return Number(((amount * getUnitFactor(unit)) / 1000).toFixed(6));
  };
  const getPlanUsedQty = (plan, { hasSiblingSubstitute = false } = {}) => {
    const lots = Array.isArray(plan?.lots) ? plan.lots : [];
    const usedFromLots = lots.reduce((sum, lot) => sum + Number(lot?.takeQty || 0), 0);
    if (usedFromLots > 0.0001) return Number(usedFromLots.toFixed(4));
    if (plan?.infiniteStock || plan?.noTraceability) return Number(((plan?.neededQty ?? plan?.requiredQty) || 0).toFixed(4));
    if (plan?.isSubstitute || hasSiblingSubstitute) return 0;
    return Number(((plan?.neededQty ?? plan?.requiredQty) || 0).toFixed(4));
  };
  const hasSubstituteSibling = (plans = [], plan = {}) => {
    const sourceId = normalizeValue(plan?.sourceIngredientId || plan?.ingredientId);
    return (Array.isArray(plans) ? plans : []).some((candidate) => candidate?.isSubstitute && normalizeValue(candidate?.sourceIngredientId || candidate?.ingredientId) === sourceId);
  };

  const loadScript = (src, id) => new Promise((resolve) => {
    const existing = document.getElementById(id);
    if (existing) return resolve(true);
    const script = document.createElement('script');
    script.id = id;
    script.src = src;
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });

  const ensureQrLib = async () => (window.QRCode ? true : loadScript('https://cdn.jsdelivr.net/npm/qrcodejs2@0.0.2/qrcode.min.js', 'la-jamonera-qrcode'));

  // ---------------------------------------------------------------------------
  // Facturas de ingredientes: hojas extra que se imprimen DESPUES de la planilla.
  // Muchos adjuntos son PDF y el navegador no imprime un PDF embebido, asi que se
  // rasterizan a imagen con pdf.js (carga diferida) antes de armar la grilla.
  // ---------------------------------------------------------------------------
  const PDF_LIB_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/pdf.min.js';
  const PDF_WORKER_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/pdf.worker.min.js';
  // 1.8 alcanza para imprimir a tamano casi real (~170 dpi) y pesa ~20% menos que
  // 2.0, que importa cuando un lote junta cientos de paginas en memoria.
  const PDF_RENDER_SCALE = 1.8;
  const JPEG_QUALITY = 0.8;

  const ensurePdfLib = async () => {
    if (window.pdfjsLib) return window.pdfjsLib;
    await loadScript(PDF_LIB_URL, 'la-jamonera-pdfjs');
    if (!window.pdfjsLib) return null;
    try { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL; } catch (_) {}
    return window.pdfjsLib;
  };

  const isPdfAttachmentUrl = (url) => {
    const raw = String(url || '').split('?')[0] || '';
    try {
      return /\.pdf(?:$|[?#])/i.test(decodeURIComponent(raw));
    } catch (_) {
      return /\.pdf(?:$|[?#])/i.test(raw);
    }
  };

  const isFirebaseStorageUrl = (url) => /firebasestorage\.googleapis\.com|\.firebasestorage\.app/i.test(String(url || ''));

  // Storage necesita el proxy (Cloud Function) para sumar cabeceras CORS: sin eso
  // no se pueden leer los bytes del adjunto para rasterizar ni pasar a dataURL.
  const fetchAttachmentResponse = async (url) => {
    if (isFirebaseStorageUrl(url) && window.laJamoneraProxy) return window.laJamoneraProxy.imageResponse(url);
    return fetch(url, { cache: 'force-cache', mode: 'cors' });
  };

  const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

  const readImageSize = (src) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: Number(img.naturalWidth) || 0, height: Number(img.naturalHeight) || 0 });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = src;
  });

  const renderPdfPagesToDataUrls = async (arrayBuffer) => {
    const pdfjsLib = await ensurePdfLib();
    if (!pdfjsLib) return [];
    const doc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const viewport = page.getViewport({ scale: PDF_RENDER_SCALE });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      const canvasContext = canvas.getContext('2d');
      canvasContext.fillStyle = '#ffffff';
      canvasContext.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext, viewport }).promise;
      pages.push({ dataUrl: canvas.toDataURL('image/jpeg', JPEG_QUALITY), pageNumber, totalPages: doc.numPages, width: canvas.width, height: canvas.height });
      // Liberamos el canvas y cedemos el hilo: un PDF de muchas paginas si no
      // deja la pestana sin responder.
      canvas.width = 1;
      canvas.height = 1;
      await yieldToUi();
    }
    try { await doc.destroy(); } catch (_) {}
    return pages;
  };

  // Tope de imagenes por lote de impresion: cada pagina rasterizada son ~300-500KB
  // de dataURL y todo queda vivo en memoria hasta que se cierra la ventana. Con
  // rangos largos el navegador se queda sin memoria y se traba.
  const BATCH_IMAGE_LIMIT = 250;

  // Cede el hilo principal para que la barra de progreso se pinte y la pestana
  // no quede sin responder mientras se rasteriza un rango largo.
  const yieldToUi = () => new Promise((resolve) => {
    if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(() => setTimeout(resolve, 0));
    else setTimeout(resolve, 0);
  });

  // Cache por URL: en planillas masivas la misma factura se repite entre
  // producciones y rasterizar un PDF es caro. Los dataURL pesan, asi que el
  // cache se poda con FIFO simple.
  const ATTACHMENT_CACHE_LIMIT = 80;
  const attachmentRenderCache = new Map();
  const cacheAttachmentImages = (url, images) => {
    if (attachmentRenderCache.size >= ATTACHMENT_CACHE_LIMIT) {
      const oldestKey = attachmentRenderCache.keys().next().value;
      if (oldestKey !== undefined) attachmentRenderCache.delete(oldestKey);
    }
    attachmentRenderCache.set(url, images);
  };

  const renderAttachmentToImages = async (url) => {
    const safeUrl = normalizeValue(url);
    if (!safeUrl) return [];
    if (attachmentRenderCache.has(safeUrl)) return attachmentRenderCache.get(safeUrl);
    let images = [];
    // Se arrastra aparte de la URL: Storage a veces sirve el PDF como
    // application/octet-stream y con nombre sin extension, y ahi la unica pista
    // fiable son los magic bytes.
    let looksLikePdf = isPdfAttachmentUrl(safeUrl);
    try {
      const response = await fetchAttachmentResponse(safeUrl);
      if (response && response.ok) {
        const blob = await response.blob();
        const blobType = String(blob.type || '').toLowerCase();
        const buffer = await blob.arrayBuffer();
        const head = new Uint8Array(buffer.slice(0, 5));
        // "%PDF"
        const hasPdfMagic = head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46;
        if (hasPdfMagic || blobType.includes('pdf')) looksLikePdf = true;
        if (looksLikePdf) {
          const pages = await renderPdfPagesToDataUrls(buffer);
          images = pages.map((page) => ({
            src: page.dataUrl,
            pageLabel: page.totalPages > 1 ? `pág. ${page.pageNumber}/${page.totalPages}` : '',
            width: page.width,
            height: page.height
          }));
        } else {
          const src = await blobToDataUrl(blob);
          const size = await readImageSize(src);
          // Si no se pudo medir, el dataURL no era una imagen valida: se descarta
          // para que caiga al fallback en vez de imprimir un recuadro roto.
          if (size.width > 0) images = [{ src, pageLabel: '', width: size.width, height: size.height }];
        }
      }
    } catch (_) {
      images = [];
    }
    // Fallback: si no se pudo leer (CORS, 404), imprimimos la URL directa — el
    // <img> no necesita CORS aunque el fetch haya fallado. Un PDF que no se pudo
    // rasterizar no tiene fallback posible: se avisa en la celda.
    if (!images.length) {
      images = looksLikePdf
        ? [{ src: '', pageLabel: '', failed: true, width: 0, height: 0 }]
        : [{ src: safeUrl, pageLabel: '', width: 0, height: 0 }];
    }
    cacheAttachmentImages(safeUrl, images);
    return images;
  };

  // Adjuntos de la produccion, deduplicados por URL: una misma factura puede
  // respaldar varios lotes/ingredientes y se imprime una sola vez.
  const collectRegistroInvoices = (registro = {}) => {
    const byUrl = new Map();
    (Array.isArray(registro?.lots) ? registro.lots : []).forEach((ingredientPlan) => {
      const ingredientName = normalizeUpper(ingredientPlan?.ingredientName) || 'INGREDIENTE';
      (Array.isArray(ingredientPlan?.lots) ? ingredientPlan.lots : []).forEach((lot) => {
        if (Number(lot?.takeQty || 0) <= 0.0001) return;
        const invoiceNumber = normalizeValue(lot?.invoiceNumber);
        const lotNumber = normalizeValue(lot?.lotNumber || lot?.entryId);
        (Array.isArray(lot?.invoiceImageUrls) ? lot.invoiceImageUrls : []).forEach((rawUrl) => {
          const url = normalizeValue(rawUrl);
          if (!url) return;
          const current = byUrl.get(url) || { url, ingredients: [], invoiceNumbers: [], lotNumbers: [] };
          if (!current.ingredients.includes(ingredientName)) current.ingredients.push(ingredientName);
          if (invoiceNumber && !current.invoiceNumbers.includes(invoiceNumber)) current.invoiceNumbers.push(invoiceNumber);
          if (lotNumber && !current.lotNumbers.includes(lotNumber)) current.lotNumbers.push(lotNumber);
          byUrl.set(url, current);
        });
      });
    });
    return [...byUrl.values()];
  };

  const countRegistroInvoices = (registros = []) => (Array.isArray(registros) ? registros : [registros])
    .reduce((sum, registro) => sum + collectRegistroInvoices(registro).length, 0);

  const buildInvoiceCaption = (invoice = {}) => [
    (invoice.ingredients || []).join(' + '),
    (invoice.invoiceNumbers || []).length ? `Factura ${invoice.invoiceNumbers.join(', ')}` : '',
    (invoice.lotNumbers || []).length ? `Lote ${invoice.lotNumbers.join(', ')}` : ''
  ].filter(Boolean).join(' · ');

  // Baja y rasteriza los adjuntos de una produccion. Devuelve una celda por
  // imagen (un PDF de 3 paginas aporta 3 celdas).
  const buildInvoiceCellsForRegistro = async (registro, onStep) => {
    const invoices = collectRegistroInvoices(registro);
    const cells = [];
    for (let index = 0; index < invoices.length; index += 1) {
      const invoice = invoices[index];
      const caption = buildInvoiceCaption(invoice);
      // Se avisa ANTES de bajar/rasterizar: un PDF grande tarda varios segundos
      // y sin esto la barra se queda quieta en 0.
      onStep?.(index, invoices.length);
      const images = await renderAttachmentToImages(invoice.url);
      await yieldToUi();
      images.forEach((image) => cells.push({
        src: image.src,
        failed: Boolean(image.failed),
        // Relacion alto/ancho del original: decide si conviene recortar la franja
        // superior (documento vertical) o mostrarlo entero (escaneo apaisado).
        aspect: Number(image.width) > 0 ? Number(image.height) / Number(image.width) : 0,
        caption: image.pageLabel ? `${caption} · ${image.pageLabel}` : caption
      }));
      onStep?.(index + 1, invoices.length);
    }
    return cells;
  };

  // La escala a la que se imprime cada factura la fija el lado que "ata" la celda.
  // Por eso la grilla no es siempre 1 columna:
  //   1 y 2 por hoja -> bandas anchas: la factura sale casi a tamaño real y se
  //     recorta la franja superior (proveedor, CUIT, N° y fecha, items).
  //   3 por hoja -> banda mas baja, recorte mas corto pero sigue a escala grande.
  //   4 por hoja -> 2x2: el cuadrante (93 x 132 mm) tiene casi la misma forma que
  //     un A4, asi que entra la factura COMPLETA. Apilar 4 bandas daria una tira
  //     4:1 donde solo se ve el logo.
  const INVOICE_GRID_BY_PER_PAGE = {
    1: { cols: 1, rows: 1 },
    2: { cols: 1, rows: 2 },
    3: { cols: 1, rows: 3 },
    4: { cols: 2, rows: 2 }
  };

  // Debajo de esta relacion alto/ancho el adjunto ya es apaisado (foto o escaneo
  // recortado): no hay franja superior que valga la pena recortar, se muestra
  // entero. Un A4 vertical tiene 1.41.
  const PORTRAIT_ASPECT_MIN = 1.15;

  // Sin flexbox: Chrome fragmenta mal los contenedores flex al paginar y la
  // imagen con flex-basis:0 colapsaba a altura cero (recuadro vacio al imprimir).
  // Todo va con alturas definidas en mm para que la grilla resuelva filas reales.
  // Ademas se fija @page y el ancho del body a la medida util de una A4 para que
  // lo que se ve en la ventana sea exactamente lo que sale por impresora.
  const INVOICE_PRINT_STYLE = `<style>
    @page{size:A4 portrait;margin:10mm;}
    body{width:190mm;margin:0 auto;padding:0;}
    .planilla-facturas-page{page-break-before:always;break-before:page;height:275mm;box-sizing:border-box;overflow:hidden;}
    .planilla-facturas-page-title{margin:0 0 3mm;height:6mm;line-height:6mm;font-size:10pt;font-weight:800;color:#31569b;text-transform:uppercase;letter-spacing:.02em;}
    .planilla-facturas-grid{display:grid;gap:3mm;height:266mm;}
    .planilla-facturas-cell{margin:0;box-sizing:border-box;height:100%;border:1px solid #d7def2;border-radius:8px;padding:2mm;overflow:hidden;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
    /* cover + top: la celda se llena y se ve la franja superior del documento.
       Es lo que maximiza la escala para una celda dada. */
    .planilla-facturas-cell img{display:block;width:100%;height:calc(100% - 6mm);object-fit:cover;object-position:top center;background:#fff;}
    /* Adjunto apaisado o de tamaño desconocido: entero, sin recortar. */
    .planilla-facturas-cell.is-whole img{object-fit:contain;object-position:center;}
    .planilla-facturas-cell figcaption{height:6mm;line-height:6mm;font-size:8pt;color:#4b5f8e;text-align:center;font-weight:700;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;}
    .planilla-facturas-failed{box-sizing:border-box;height:calc(100% - 6mm);display:flex;align-items:center;justify-content:center;border:1px dashed #b9c8eb;border-radius:8px;color:#b42338;font-weight:800;font-size:9pt;text-align:center;padding:4mm;}
  </style>`;

  const toSafeImgSrc = (src) => (/^data:image\//i.test(String(src || '')) ? String(src) : escapeHtml(src));

  const buildInvoiceSheetsHtml = (cells = [], perPage = 4, headerLabel = '') => {
    if (!cells.length) return '';
    const grid = INVOICE_GRID_BY_PER_PAGE[Number(perPage)] || INVOICE_GRID_BY_PER_PAGE[4];
    const cols = Math.max(1, Number(grid.cols) || 1);
    const slots = Math.max(1, cols * Math.max(1, Number(grid.rows) || 1));
    const sheets = [];
    for (let index = 0; index < cells.length; index += slots) sheets.push(cells.slice(index, index + slots));
    return sheets.map((sheetCells, sheetIndex) => {
      // La ultima hoja puede quedar incompleta: repartimos el alto entre las
      // facturas que hay en vez de dejar bandas vacias (con 1 sola factura y
      // "4 por hoja" ocupaba un cuarto de pagina y sobraba el resto).
      // Si ademas queda en UNA sola fila de varias columnas, la hoja termina
      // partida al medio en vertical: con "4 por hoja" y 2 sobrantes, 2x2
      // degeneraba en dos columnas de 93 x 266 mm y una factura A4 ahi se
      // recorta el 50% de los costados. En ese caso se apila: dos bandas de
      // 190 x 131 mm muestran la franja superior completa y al doble de escala.
      const defaultCols = Math.min(cols, Math.max(1, sheetCells.length));
      const defaultRows = Math.max(1, Math.ceil(sheetCells.length / defaultCols));
      const stackedGrid = (defaultRows === 1 && defaultCols > 1)
        ? INVOICE_GRID_BY_PER_PAGE[sheetCells.length]
        : null;
      const colsForSheet = stackedGrid ? Math.max(1, Number(stackedGrid.cols) || 1) : defaultCols;
      const rowsForSheet = Math.max(1, Math.ceil(sheetCells.length / colsForSheet));
      const isSingleCell = sheetCells.length === 1;
      const cellHtml = (cell) => {
        // Una celda sola ocupa la hoja entera: ahi entra la factura completa.
        // Un adjunto apaisado (o sin tamaño conocido) tampoco se recorta: no
        // tiene "franja superior" util y cover lo dejaria en una tira.
        const showWhole = isSingleCell || !(Number(cell.aspect) >= PORTRAIT_ASPECT_MIN);
        const className = showWhole ? 'planilla-facturas-cell is-whole' : 'planilla-facturas-cell';
        const body = cell.failed
          ? '<div class="planilla-facturas-failed">No se pudo convertir el PDF a imagen</div>'
          : `<img src="${toSafeImgSrc(cell.src)}" alt="${escapeHtml(cell.caption)}">`;
        return `<figure class="${className}">${body}<figcaption>${escapeHtml(cell.caption)}</figcaption></figure>`;
      };
      return `
      <section class="planilla-facturas-page">
        <p class="planilla-facturas-page-title">Facturas de ingredientes${headerLabel ? ` · ${escapeHtml(headerLabel)}` : ''} · hoja ${sheetIndex + 1}/${sheets.length}</p>
        <div class="planilla-facturas-grid" style="grid-template-columns:repeat(${colsForSheet},minmax(0,1fr));grid-template-rows:repeat(${rowsForSheet},minmax(0,1fr));">
          ${sheetCells.map(cellHtml).join('')}
        </div>
      </section>`;
    }).join('');
  };

  // A4 vertical con margen de 10mm => 190 x 277 mm utiles. A 96dpi son 1047px de
  // alto. Como el body de la ventana de impresion se fija en 190mm, lo que se
  // mide en pantalla coincide con lo que se pagina.
  const MM_TO_PX = 96 / 25.4;
  const PAGE_CONTENT_HEIGHT_PX = Math.round(275 * MM_TO_PX);
  const MIN_PLANILLA_ZOOM = 0.55;

  // La planilla tiene que entrar en una hoja: si se pasa, se achica con zoom
  // hasta que entre (con piso, para no volverla ilegible).
  const fitPlanillaToOnePage = (node) => {
    if (!node) return;
    node.style.zoom = '';
    const height = node.getBoundingClientRect?.().height || 0;
    if (!height || height <= PAGE_CONTENT_HEIGHT_PX) return;
    const zoom = Math.max(MIN_PLANILLA_ZOOM, Math.floor((PAGE_CONTENT_HEIGHT_PX / height) * 1000) / 1000);
    node.style.zoom = String(zoom);
  };

  const fitAllPlanillasToOnePage = (win) => {
    // querySelectorAll por atributo: en el lote hay un id repetido por planilla.
    (win?.document?.querySelectorAll('[id="planillaProduccionPrintable"]') || []).forEach(fitPlanillaToOnePage);
  };

  const warnPopupBlocked = async () => {
    if (typeof Swal === 'undefined') return;
    await openPlanillaSwal({
      title: 'Ventana bloqueada',
      html: '<p>El navegador bloqueó la ventana de impresión. Habilitá las ventanas emergentes para este sitio y volvé a intentar.</p>',
      icon: 'warning',
      confirmButtonText: 'Entendido',
      customClass: { popup: 'ios-alert', title: 'ios-alert-title', htmlContainer: 'ios-alert-text', confirmButton: 'ios-btn ios-btn-primary' }
    });
  };

  const openPlanillaSwal = (options = {}) => {
    // Mismo target que el resto de la app: si hay un modal Bootstrap abierto el
    // dialogo se monta adentro para no quedar detras.
    const activeBootstrapModal = document.querySelector('.modal.show .modal-content');
    return Swal.fire({ target: activeBootstrapModal || document.body, returnFocus: false, buttonsStyling: false, ...options });
  };

  // Pregunta si se anexan las hojas de facturas y en cuantas partes se divide la
  // hoja. Devuelve null si el usuario cancela la impresion.
  const askInvoiceOptions = async (registros = []) => {
    const total = countRegistroInvoices(registros);
    if (!total || typeof Swal === 'undefined') return { include: false, perPage: 4 };
    const optionHtml = (value, label) => `<label class="inventario-check-row"><input type="radio" name="planillaFacturasPerPage" value="${value}"${value === 4 ? ' checked' : ''}><span>${label}</span></label>`;
    const perPageNote = 'Las facturas verticales se recortan a la franja superior (proveedor, N° de comprobante, fecha) para que se lean; las apaisadas y las que quedan solas en la hoja se imprimen enteras.';
    const result = await openPlanillaSwal({
      title: 'Facturas de ingredientes',
      html: `<p>Se detectaron <strong>${total}</strong> factura(s) adjunta(s). ¿Las imprimo después de la planilla?</p>
        <div class="swal-stack-fields text-start">
          <span class="selector-section-label">¿En cuántas partes divido la hoja?</span>
          ${optionHtml(1, '1 por hoja · factura completa, lo más grande posible')}
          ${optionHtml(2, '2 por hoja · franja superior bien grande')}
          ${optionHtml(3, '3 por hoja · franja superior')}
          ${optionHtml(4, '4 por hoja (2 × 2) · factura completa más chica')}
        </div>
        <p class="planilla-facturas-note">${perPageNote} Los adjuntos en PDF se convierten a imagen antes de imprimir.</p>`,
      showCancelButton: true,
      showDenyButton: true,
      confirmButtonText: 'Incluir facturas',
      denyButtonText: 'Solo planilla',
      cancelButtonText: 'Cancelar',
      customClass: {
        popup: 'ios-alert planilla-facturas-alert',
        title: 'ios-alert-title',
        htmlContainer: 'ios-alert-text',
        confirmButton: 'ios-btn ios-btn-primary',
        denyButton: 'ios-btn ios-btn-secondary',
        cancelButton: 'ios-btn ios-btn-secondary'
      },
      preConfirm: () => ({
        perPage: Number(Swal.getHtmlContainer()?.querySelector('input[name="planillaFacturasPerPage"]:checked')?.value) || 4
      })
    });
    if (result.isDismissed) return null;
    if (result.isDenied) return { include: false, perPage: 4 };
    return { include: true, perPage: Number(result.value?.perPage) || 4 };
  };

  const openInvoiceProgressSwal = () => openPlanillaSwal({
    title: 'Preparando facturas...',
    html: '<div class="informes-saving-spinner"><img src="./IMG/Meta-ai-logo.webp" alt="Preparando facturas" class="meta-spinner-login"></div><div class="planilla-progress-wrap"><div class="planilla-progress-bar"><span id="planillaFacturasProgressBar" style="width:0%"></span></div><p id="planillaFacturasProgressText" class="planilla-progress-text">0% Descargando adjuntos...</p></div>',
    allowOutsideClick: false,
    showConfirmButton: false,
    customClass: { popup: 'ios-alert produccion-loading-alert', title: 'ios-alert-title', htmlContainer: 'ios-alert-text' }
  });

  const setInvoiceProgress = (done, total) => {
    const safeTotal = Math.max(1, Number(total) || 0);
    const value = Math.max(0, Math.min(100, Math.round((Number(done) || 0) / safeTotal * 100)));
    const bar = document.getElementById('planillaFacturasProgressBar');
    const text = document.getElementById('planillaFacturasProgressText');
    if (bar) bar.style.width = `${value}%`;
    if (text) text.textContent = `${value}% · adjunto ${Math.min(done, safeTotal)} de ${safeTotal}`;
  };

  const getTraceUrl = (registro) => normalizeValue(registro?.publicTraceUrl) || `${TRACE_BASE_URL}${encodeURIComponent(normalizeValue(registro?.id))}`;
  const getPackagingLabel = (registro = {}) => {
    const type = normalizeValue(registro?.packagingDelayTypeAtProduction || registro?.packagingDelayType || registro?.traceability?.product?.packagingDelayType);
    return type === 'freeze_before_packaging' ? 'CONGELADO PREVIO A ENVASADO' : 'ENVASADO';
  };
  const getPackagingDateDisplay = (registro = {}) => normalizeValue(registro?.packagingDate)
    ? formatIsoEs(registro.packagingDate)
    : 'Al producir';
  const getInitialsToken = (value = '') => {
    const words = normalizeUpper(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
    return words.map((word) => word[0]).join('') || 'PROD';
  };
  const getProductionLotDisplay = (registro = {}) => {
    const explicit = normalizeValue(registro?.lotNumber || registro?.productLotNumber);
    if (explicit) return normalizeUpper(explicit);
    const dateToken = normalizeValue(registro?.productionDate || '').replaceAll('-', '');
    const productToken = getInitialsToken(registro?.recipeTitle || registro?.traceability?.product?.title || 'Producto');
    return `LJ-${dateToken || 'SFECHA'}-${productToken}`;
  };
  const isMissingPlanillaValue = (value = '') => {
    const text = normalizeValue(value);
    return !text || text === '-';
  };
  const getFallbackLotDisplay = (registro = {}, name = '') => {
    const dateToken = normalizeValue(registro?.productionDate || '').replaceAll('-', '');
    return `LJ-${dateToken || 'SFECHA'}-${getInitialsToken(name || registro?.recipeTitle || 'Producto')}`;
  };
  const getIngredientExpiryValue = (registro = {}, expiry = '') => {
    const text = normalizeValue(expiry);
    if (text && text !== '-') return text;
    return addDaysToIso(registro?.productionDate, 5) || '-';
  };
  const getProductExpiryDisplay = (registro = {}) => {
    const explicit = normalizeValue(registro?.productExpiryDate);
    if (explicit) return formatIsoEs(explicit);
    const fallback = addDaysToIso(registro?.productionDate, 5);
    return fallback ? formatIsoEs(fallback) : '-';
  };

  let recipesSnapshotCache = null;
  const getRecipesSnapshot = async (context = {}) => {
    const provided = safeObject(context.recetas || context.recipes);
    if (Object.keys(provided).length) return provided;
    if (recipesSnapshotCache) return recipesSnapshotCache;
    try {
      await window.laJamoneraReady;
      recipesSnapshotCache = safeObject(await window.dbLaJamoneraRest?.read?.('/recetas'));
    } catch (error) {
      recipesSnapshotCache = {};
    }
    return recipesSnapshotCache;
  };

  const findRecipeForRegistro = async (registro = {}, context = {}) => {
    const recipes = await getRecipesSnapshot(context);
    const recipeId = normalizeValue(registro?.recipeId || registro?.traceability?.product?.id);
    if (recipeId && recipes[recipeId]) return safeObject(recipes[recipeId]);
    const title = normalizeUpper(registro?.recipeTitle || registro?.traceability?.product?.title);
    return safeObject(Object.values(recipes).find((recipe) => normalizeUpper(recipe?.title) === title));
  };
  const formatRnpaExemptReason = (value = '') => {
    const reason = normalizeValue(value);
    return reason === 'solo_mostrador' ? 'Venta mostrador' : reason;
  };

  const enrichRegistroForPlanilla = async (registro = {}, context = {}) => {
    const recipe = await findRecipeForRegistro(registro, context);
    if (!Object.keys(recipe).length) return registro;
    const recipeRnpa = safeObject(recipe.rnpa);
    const existingProduct = safeObject(registro?.traceability?.product);
    const existingRnpa = safeObject(existingProduct.rnpa);
    const rnpaExempt = Boolean(recipe?.rnpaNotRequired || recipe?.rnpaExempt || recipe?.subproductNoRnpa || existingRnpa.exempt);
    const rnpaNumber = normalizeValue(existingRnpa.number) || normalizeValue(recipeRnpa.number);
    const currentCommercialName = normalizeValue(recipe.nombreComercial);
    // Vencimiento de respaldo: si el registro no lo trae persistido, lo calculamos
    // como envasado + caducidad (no producción + caducidad). envasado = producción
    // + estacionado (agingDays). Respeta el snapshot si ya existe.
    let productExpiryDate = normalizeValue(registro.productExpiryDate);
    if (!productExpiryDate) {
      const prod = normalizeValue(registro.productionDate);
      const shelfLifeDays = Number(registro.shelfLifeDaysAtProduction ?? recipe.shelfLifeDays);
      const agingDays = Number(registro.agingDaysAtProduction ?? recipe.agingDays) || 0;
      if (prod && Number.isFinite(shelfLifeDays) && shelfLifeDays > 0) {
        const packagingDate = normalizeValue(registro.packagingDate) || (agingDays > 0 ? addDaysToIso(prod, agingDays) : prod);
        productExpiryDate = addDaysToIso(packagingDate, shelfLifeDays);
      }
    }
    return {
      ...registro,
      productExpiryDate,
      recipeNombreComercial: currentCommercialName,
      // Datos de receta para la planilla protocolo: base de cálculo y vida útil.
      recipeYieldQuantity: recipe.yieldQuantity,
      recipeYieldUnit: normalizeValue(recipe.yieldUnit),
      recipeShelfLifeDays: Number(registro.shelfLifeDaysAtProduction ?? recipe.shelfLifeDays) || 0,
      traceability: {
        ...safeObject(registro.traceability),
        product: {
          ...existingProduct,
          nombreComercial: currentCommercialName,
          rnpa: {
            ...existingRnpa,
            number: rnpaNumber,
            exempt: rnpaExempt,
            exemptReason: rnpaExempt ? formatRnpaExemptReason(recipe.rnpaExemptReason || existingRnpa.exemptReason) || 'Venta mostrador' : normalizeValue(existingRnpa.exemptReason)
          }
        }
      }
    };
  };

  const resolveManagerNames = (registro, usersMap = {}) => {
    const tokens = Array.isArray(registro?.managers) ? registro.managers : [];
    if (!tokens.length) return 'SIN RESPONSABLE';
    return tokens.map((token) => {
      const user = safeObject(usersMap[token]);
      const full = normalizeUpper(user.fullName || user.name || token);
      const role = normalizeUpper(user.role || user.position || 'RESPONSABLE');
      return `${full} (${role})`;
    }).join(', ');
  };

  const resolveIngredientRows = (registro) => {
    const plans = Array.isArray(registro?.lots) ? registro.lots : [];
    const traceIngredients = Array.isArray(registro?.traceability?.ingredients) ? registro.traceability.ingredients : [];
    const joinUnique = (items = []) => {
      const normalized = items.map((item) => normalizeValue(item)).filter(Boolean);
      const unique = [...new Set(normalized)];
      return unique.length ? unique.map((item) => normalizeUpper(item)).join(' | ') : '-';
    };
    const sourceMeta = plans.reduce((acc, plan, index) => {
      const ingredientId = normalizeValue(plan?.ingredientId || `ing_${index}`);
      const sourceIngredientId = normalizeValue(plan?.sourceIngredientId || ingredientId);
      if (!acc[sourceIngredientId]) {
        acc[sourceIngredientId] = {
          sourceIngredientId,
          sourceIngredientName: normalizeUpper(plan?.sourceIngredientName || plan?.ingredientName || 'INGREDIENTE'),
          requiredQty: 0,
          unit: normalizeValue(plan?.ingredientUnit || plan?.unit || '')
        };
      }
      if (!plan?.isSubstitute) {
        acc[sourceIngredientId].requiredQty = Number((Number(acc[sourceIngredientId].requiredQty || 0) + Number(plan?.neededQty ?? plan?.requiredQty ?? 0)).toFixed(4));
      }
      if (!acc[sourceIngredientId].unit) acc[sourceIngredientId].unit = normalizeValue(plan?.ingredientUnit || plan?.unit || '');
      return acc;
    }, {});
    const groupedPlans = Object.values(plans.reduce((acc, plan, index) => {
      const hasSiblingSubstitute = hasSubstituteSibling(plans, plan);
      const usedQty = getPlanUsedQty(plan, { hasSiblingSubstitute });
      if (usedQty <= 0.0001) return acc;
      const ingredientId = normalizeValue(plan?.ingredientId || `ing_${index}`);
      const sourceIngredientId = normalizeValue(plan?.sourceIngredientId || ingredientId);
      const key = `${ingredientId}::${sourceIngredientId}`;
      if (!acc[key]) {
        acc[key] = {
          ...safeObject(plan),
          ingredientId,
          sourceIngredientId,
          sourceIngredientName: normalizeUpper(plan?.sourceIngredientName),
          ingredientName: normalizeUpper(plan?.ingredientName || 'INGREDIENTE'),
          ingredientImageUrl: normalizeValue(plan?.ingredientImageUrl || ''),
          isSubstitute: Boolean(plan?.isSubstitute),
          neededQty: 0,
          requiredQty: 0,
          lots: []
        };
      }
      acc[key].neededQty = Number((Number(acc[key].neededQty || 0) + usedQty).toFixed(4));
      acc[key].requiredQty = acc[key].neededQty;
      acc[key].lots.push(...(Array.isArray(plan?.lots) ? plan.lots.filter((lot) => Number(lot?.takeQty || 0) > 0.0001) : []));
      if (!acc[key].ingredientImageUrl) acc[key].ingredientImageUrl = normalizeValue(plan?.ingredientImageUrl || '');
      return acc;
    }, {}));

    return groupedPlans.map((plan) => {
      const traceIngredient = traceIngredients.find((row) => normalizeValue(row?.ingredientId) === normalizeValue(plan?.ingredientId));
      const planLots = Array.isArray(plan?.lots) ? plan.lots : [];
      const traceLots = Array.isArray(traceIngredient?.lots) ? traceIngredient.lots : [];
      const mergedLots = planLots.length ? planLots : traceLots;
      const lots = (mergedLots.length ? mergedLots : [{}]).map((lot, index) => ({
        ...safeObject(traceLots[index]),
        ...safeObject(lot)
      }));
      const lotNumbers = lots.map((lot) => lot?.lotNumber || lot?.entryId || '-');
      const providers = lots.map((lot) => lot?.provider || '-');
      const rnes = lots.map((lot) => lot?.providerRne?.number || '-');
      const observationLots = lots.map((lot, lotIndex) => {
        const usedQty = Number(lot?.takeQty || 0);
        const unit = lot?.unit || plan?.ingredientUnit || plan?.unit || '';
        return {
          index: lotIndex + 1,
          lotNumber: normalizeValue(lot?.lotNumber || lot?.entryId || '-'),
          provider: normalizeUpper(lot?.provider || '-'),
          qtyLabel: formatQty(usedQty, unit),
          isFrozen: Boolean(lot?.isFrozen || lot?.frozen),
          frozenAt: normalizeValue(lot?.frozenAt || ''),
          entryDate: normalizeValue(lot?.entryDate || ''),
          expiryDate: normalizeValue(lot?.expiryDate || '')
        };
      });
      const firstLot = lots[0] || {};
      const displayName = normalizeUpper(plan?.ingredientName || traceIngredient?.ingredientName || 'INGREDIENTE');
      const lotNumberDisplay = joinUnique(lotNumbers);
      const expiryValue = getIngredientExpiryValue(registro, firstLot?.expiryDate || '');
      const takeQty = Number(firstLot?.takeQty || 0);
      const availableQty = Number(firstLot?.availableQty || 0);
      const remainingQty = Math.max(0, availableQty - takeQty);
      const hasMultiProvider = [...new Set(providers.map((item) => normalizeValue(item)).filter(Boolean))].length > 1;
      const lotUsageSummary = observationLots.map((lot, lotIdx) => {
        const exp = formatIsoEs(lots[lotIdx]?.expiryDate || '-');
        return `${lot.qtyLabel} de lote ${lot.index} ${lot.lotNumber} (vence ${exp})`;
      }).join(', ');
      const providersSummary = hasMultiProvider
        ? `El proveedor es ${observationLots.map((lot) => `${lot.provider} para lote ${lot.index}`).join(' y ')}`
        : `El proveedor es ${normalizeValue(providers[0] || '-')}`;
      const meta = sourceMeta[normalizeValue(plan?.sourceIngredientId || plan?.ingredientId)] || {};
      const qtyRaw = Number(plan?.neededQty ?? plan?.requiredQty ?? 0);
      const qtyUnit = normalizeValue(plan?.ingredientUnit || plan?.unit || '');
      return {
        ingredientName: displayName,
        relation: plan?.isSubstitute && normalizeValue(plan?.sourceIngredientName) ? `SUSTITUYE A ${normalizeUpper(plan.sourceIngredientName)}` : '',
        isSubstitute: Boolean(plan?.isSubstitute),
        sourceIngredientId: normalizeValue(plan?.sourceIngredientId || plan?.ingredientId),
        sourceIngredientName: normalizeUpper(meta.sourceIngredientName || plan?.sourceIngredientName || plan?.ingredientName || 'INGREDIENTE'),
        sourceRequiredQty: Number(meta.requiredQty || qtyRaw || 0),
        sourceUnit: normalizeValue(meta.unit || qtyUnit),
        ingredientImage: normalizeValue(plan?.ingredientImageUrl || traceIngredient?.ingredientImageUrl),
        provider: joinUnique(providers),
        lotNumber: isMissingPlanillaValue(lotNumberDisplay) ? getFallbackLotDisplay(registro, displayName) : lotNumberDisplay,
        expiryDate: expiryValue,
        rne: joinUnique(rnes),
        qtyRaw,
        qtyUnit,
        qty: formatQty(qtyRaw, qtyUnit),
        qtyKg: toKg(qtyRaw, qtyUnit),
        available: formatQty(availableQty, firstLot?.unit || plan?.ingredientUnit || plan?.unit || ''),
        remaining: formatQty(remainingQty, firstLot?.unit || plan?.ingredientUnit || plan?.unit || ''),
        invoiceNumber: normalizeValue(firstLot?.invoiceNumber || '-'),
        entryDate: formatIsoEs(firstLot?.entryDate || '-'),
        autoObservation: lots.length > 1
          ? `${plan?.ingredientName || traceIngredient?.ingredientName || 'Ingrediente'}, se usó ${lotUsageSummary}. ${providersSummary}.`
          : ''
      };
    });
  };

  const buildFormulaRows = (ingredientRows = []) => {
    const groups = Object.values((Array.isArray(ingredientRows) ? ingredientRows : []).reduce((acc, row, index) => {
      const key = normalizeValue(row?.sourceIngredientId || row?.ingredientName || `ing_${index}`);
      if (!acc[key]) {
        acc[key] = {
          sourceIngredientName: normalizeUpper(row?.sourceIngredientName || row?.ingredientName || 'INGREDIENTE'),
          sourceRequiredQty: Number(row?.sourceRequiredQty || 0),
          sourceUnit: normalizeValue(row?.sourceUnit || row?.qtyUnit || ''),
          rows: []
        };
      }
      acc[key].rows.push(row);
      if (!acc[key].sourceRequiredQty && Number(row?.sourceRequiredQty || 0)) acc[key].sourceRequiredQty = Number(row.sourceRequiredQty || 0);
      if (!acc[key].sourceUnit) acc[key].sourceUnit = normalizeValue(row?.sourceUnit || row?.qtyUnit || '');
      return acc;
    }, {}));

    // Formato protocolo: sin avatar/foto del producto. Cantidad expresada en KG
    // como pide el registro oficial; si la unidad no es de peso se muestra tal cual.
    const renderQtyKg = (row) => {
      const kg = Number(row.qtyKg || 0);
      if (kg > 0.000001) return kg.toFixed(3);
      return normalizeValue(row.qty) || '-';
    };

    const renderDataRow = (row, className = '') => `<tr class="${className}">
      <td class="planilla-proto-ing"><strong>${escapeHtml(row.ingredientName)}</strong>${row.relation ? `<small class="planilla-substitute-note"><i class="fa-solid fa-link"></i> ${escapeHtml(row.relation)}</small>` : ''}</td>
      <td>${escapeHtml(row.provider)}</td>
      <td>${escapeHtml(row.lotNumber)}</td>
      <td>${escapeHtml(formatIsoEs(row.expiryDate))}</td>
      <td class="planilla-qty-cell">${escapeHtml(renderQtyKg(row))}</td>
    </tr>`;

    return groups.map((group) => {
      const hasSubstitutes = group.rows.some((row) => row.isSubstitute);
      const totalUsed = group.rows.reduce((sum, row) => sum + Number(row.qtyRaw || 0), 0);
      const directUsed = group.rows.filter((row) => !row.isSubstitute).reduce((sum, row) => sum + Number(row.qtyRaw || 0), 0);
      if (!hasSubstitutes) return group.rows.map((row) => renderDataRow(row)).join('');
      const badge = directUsed > 0.0001 ? 'COMBINADO CON SUSTITUTOS' : 'CUBIERTO CON SUSTITUTOS';
      const directText = directUsed > 0.0001 ? `ORIGINAL USADO: ${formatQty(directUsed, group.sourceUnit)}` : 'INGREDIENTE ORIGINAL SIN CONSUMO DIRECTO';
      const sourceRequiredLabel = escapeHtml(formatQty(group.sourceRequiredQty || totalUsed, group.sourceUnit));
      const totalUsedLabel = escapeHtml(formatQty(totalUsed, group.sourceUnit));
      return `<tr class="planilla-source-row"><td colspan="5">
        <div class="planilla-source-head">
          <strong>${escapeHtml(normalizeUpper(group.sourceIngredientName))}</strong>
          <span><i class="fa-solid fa-link"></i> ${badge}</span>
        </div>
        <div class="planilla-source-meta">REQUERIDO: <b>${sourceRequiredLabel}</b> <span aria-hidden="true">|</span> TOTAL USADO: <b>${totalUsedLabel}</b> <span aria-hidden="true">|</span> ${escapeHtml(directText)}</div>
      </td></tr>${group.rows.map((row) => renderDataRow(row, row.isSubstitute ? 'planilla-substitute-row' : '')).join('')}`;
    }).join('') || '<tr><td colspan="5">SIN INGREDIENTES CARGADOS.</td></tr>';
  };

  const buildPlanillaHtml = (registro, context = {}) => {
    const rnpa = safeObject(registro?.traceability?.product?.rnpa);
    const rnpaDisplay = rnpa.exempt
      ? `NO REQUIERE RNPA${normalizeValue(rnpa.exemptReason) ? ` - ${normalizeUpper(rnpa.exemptReason)}` : ''}`
      : normalizeUpper(rnpa.number || '-');
    const commercialName = normalizeValue(registro?.recipeNombreComercial || registro?.traceability?.product?.nombreComercial);
    const ingredientRows = resolveIngredientRows(registro);
    const formulaRows = buildFormulaRows(ingredientRows);
    const managerLabel = resolveManagerNames(registro, context.usersMap);
    const totalIngredients = ingredientRows.reduce((acc, row) => acc + Number(row.qtyKg || 0), 0);
    const merma = Math.max(0, totalIngredients - Number(registro?.quantityKg || 0));
    const autoObservations = ingredientRows
      .map((row) => normalizeValue(row.autoObservation))
      .filter(Boolean)
      .join(' ');
    const observations = [
      normalizeValue(registro?.observations),
      autoObservations
    ].filter(Boolean).join(' · ') || 'SIN OBSERVACIONES';

    const observationsLabel = normalizeUpper(observations.replace(/\u00c2\u00b7/g, '|'));

    // Base de c\u00e1lculo: kilos sobre los que est\u00e1 calculada la receta (desde recetas).
    const yieldQty = Number(registro?.recipeYieldQuantity || 0);
    const yieldUnit = normalizeUpper(registro?.recipeYieldUnit || 'KG');
    const baseCalculoLabel = yieldQty > 0 ? `${yieldQty % 1 ? yieldQty.toFixed(2) : yieldQty} ${yieldUnit} DE PRODUCCI\u00d3N` : '-';
    const shelfLifeDays = Number(registro?.recipeShelfLifeDays || 0);
    const lapsoAptitudLabel = shelfLifeDays > 0
      ? `LAPSO DE APTITUD: ${shelfLifeDays} D\u00cdAS A PARTIR DE LA FECHA DE ENVASADO / ROTULADO`
      : '';
    // Ingredientes del r\u00f3tulo: nombres de las materias primas usadas en la producci\u00f3n.
    const rotuloIngredients = [...new Set(ingredientRows.map((row) => normalizeValue(row.ingredientName).toLowerCase()).filter(Boolean))].join(', ');
    // Encabezado "F. Elaboracion": mes/anio real de la produccion (fallback: alta del registro).
    const elaborationMonthLabel = formatMonthShortYearEs(registro?.productionDate || registro?.createdAt || '');

    return `<div class="planilla-card planilla-print-a4 planilla-proto" id="planillaProduccionPrintable">
      <table class="planilla-proto-head-table">
        <tbody>
          <tr>
            <td class="planilla-proto-brand">Frigor\u00edfico<br><strong>La Jamonera</strong></td>
            <td class="planilla-proto-doc-title">REGISTRO PROTOCOLO DE PRODUCCI\u00d3N</td>
            <td class="planilla-proto-version"><span>Versi\u00f3n <strong>004</strong></span><span>F. Elaboraci\u00f3n <strong>${escapeHtml(elaborationMonthLabel)}</strong></span></td>
          </tr>
          <tr>
            <td class="planilla-proto-format-label">FORMATO</td>
            <td colspan="2" class="planilla-proto-format-value">${escapeHtml(registro?.id || '-')} &bull; EMITIDO: ${escapeHtml(formatDateTime(registro?.createdAt))} &bull; RNE EMPRESA ${escapeHtml(registro?.traceability?.company?.rne?.number || '-')}</td>
          </tr>
        </tbody>
      </table>
      <table class="planilla-proto-fields-table">
        <tbody>
          <tr><th>FECHA DE ELABORACI\u00d3N</th><td>${escapeHtml(formatIsoEs(registro?.productionDate || '') || '-')}</td></tr>
          <tr><th>FECHA DE ${escapeHtml(getPackagingLabel(registro))} / ROTULADO</th><td>${escapeHtml(getPackagingDateDisplay(registro))}</td></tr>
          <tr><th>PRODUCTO</th><td><strong>${escapeHtml(normalizeUpper(registro?.recipeTitle || '-'))}</strong>${commercialName ? ` <small>(${escapeHtml(normalizeUpper(commercialName))})</small>` : ''}</td></tr>
          <tr><th>N\u00b0 LOTE ASIGNADO</th><td>${escapeHtml(getProductionLotDisplay(registro))}</td></tr>
          <tr><th>FECHA DE VENCIMIENTO</th><td>${escapeHtml(normalizeUpper(getProductExpiryDisplay(registro)))}</td></tr>
          <tr><th>BASE DE C\u00c1LCULO</th><td>${escapeHtml(baseCalculoLabel)}</td></tr>
          <tr><th>RNPA</th><td>${escapeHtml(rnpaDisplay)}</td></tr>
        </tbody>
      </table>
      <div class="planilla-table-scroll"><table class="planilla-table planilla-formula-table planilla-proto-formula">
        <thead><tr><th>MATERIA PRIMA</th><th>MARCA</th><th>N\u00b0 DE LOTE</th><th>VENCIMIENTO</th><th>CANTIDAD KG</th></tr></thead>
        <tbody>${formulaRows}
          <tr class="planilla-proto-total-row"><td colspan="4"><strong>TOTAL</strong></td><td class="planilla-qty-cell"><strong>${totalIngredients.toFixed(3)}</strong></td></tr>
        </tbody>
      </table></div>
      <p class="planilla-proto-aptitud">N/A: No Aplica${lapsoAptitudLabel ? `<br>${escapeHtml(lapsoAptitudLabel)}` : ''}</p>
      <table class="planilla-proto-fields-table">
        <tbody>
          <tr><th>CANTIDAD OBTENIDA DEL PRODUCTO EN KILOS</th><td>${escapeHtml(`${Number(registro?.quantityKg || 0).toFixed(2)} KG`)}${merma > 0.0005 ? ` <small>(MERMA ${merma.toFixed(3)} KG)</small>` : ''}</td></tr>
          <tr><th>FIRMA RESPONSABLE</th><td>${escapeHtml(normalizeUpper(managerLabel))}</td></tr>
        </tbody>
      </table>
      <section class="planilla-proto-bottom">
        <div class="planilla-proto-observations">
          <p><strong>OBSERVACIONES:</strong> ${escapeHtml(observationsLabel)}</p>
          ${rotuloIngredients ? `<p><strong>Ingredientes (r\u00f3tulo):</strong> ${escapeHtml(rotuloIngredients)}.</p>` : ''}
        </div>
        <article class="planilla-qr-card"><div id="planillaQrTarget"></div><p class="planilla-qr-note">QR trazabilidad</p></article>
      </section>
    </div>`;
  };

  const waitImages = async (root) => Promise.all([...(root?.querySelectorAll('img') || [])].map((img) => (img.complete ? Promise.resolve() : new Promise((resolve) => {
    img.addEventListener('load', resolve, { once: true });
    img.addEventListener('error', resolve, { once: true });
  }))));

  const waitWindowLoad = (win) => new Promise((resolve) => {
    const finish = () => (win.document?.fonts ? win.document.fonts.ready.then(resolve, resolve) : resolve());
    if (!win || win.document.readyState === 'complete') { finish(); return; }
    win.addEventListener('load', finish, { once: true });
    setTimeout(resolve, 5000);
  });

  // Espera explícita de las hojas de estilo del popup de impresión: el readyState
  // puede quedar "complete" antes de que el CSS externo termine de bajar y la
  // impresora se abre con la planilla sin estilos. Cada <link> resuelve por load,
  // error o timeout de 4s.
  const waitStylesheets = (win) => Promise.all(
    [...(win?.document?.querySelectorAll('link[rel="stylesheet"]') || [])].map((link) => new Promise((resolve) => {
      if (link.sheet) return resolve();
      link.addEventListener('load', resolve, { once: true });
      link.addEventListener('error', resolve, { once: true });
      setTimeout(resolve, 4000);
    }))
  ).then(() => (win.document?.fonts ? win.document.fonts.ready.catch(() => {}) : null));

  const renderQr = (host, registro) => {
    if (!host || !window.QRCode) return;
    host.innerHTML = '';
    // eslint-disable-next-line no-new
    new window.QRCode(host, { text: getTraceUrl(registro), width: 130, height: 130, colorDark: '#111827', colorLight: '#ffffff' });
  };

  const buildPlanillaHeadHtml = (title) => `<title>${title}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/css/all.min.css" integrity="sha512-Evv84Mr4kqVGRNSgIGL/F/aIDqQb7xQ2vcrdIwxfjThSH8CSR7PBEakCr51Ck+w+/U6swU2Im1vVX0SVk9ABhg==" crossorigin="anonymous" referrerpolicy="no-referrer">
    <link rel="stylesheet" href="./CSS/style.css">
    <style>body{font-family:"Inter","Segoe UI",Arial,sans-serif;padding:8px;background:#ffffff;}</style>`;

  const printPlanilla = async (root, registro, options = {}) => {
    // Las hojas de facturas son solo para el back-office autenticado: necesitan el
    // proxy /image (Storage no tiene CORS) y muestran datos de proveedores. La
    // pagina publica de trazabilidad (produccion_publica.html) no las habilita.
    let invoiceOptions = options.invoiceOptions !== undefined ? options.invoiceOptions : null;
    if (invoiceOptions === null) {
      invoiceOptions = options.allowInvoices ? await askInvoiceOptions([registro]) : { include: false, perPage: 4 };
    }
    if (invoiceOptions === null) return;
    const withInvoices = Boolean(invoiceOptions?.include);
    // Primero se bajan y rasterizan los adjuntos con la barra a la vista; la
    // ventana de impresion se abre recien cuando esta todo listo.
    let invoicesHtml = '';
    if (withInvoices) {
      openInvoiceProgressSwal();
      try {
        const cells = await buildInvoiceCellsForRegistro(registro, setInvoiceProgress);
        invoicesHtml = buildInvoiceSheetsHtml(cells, invoiceOptions.perPage, normalizeValue(registro?.id));
      } finally {
        Swal.close();
      }
    }
    const win = window.open('', '_blank', 'width=1240,height=900');
    if (!win) {
      await warnPopupBlocked();
      return;
    }
    const documentTitle = escapeHtml(getPlanillaDocumentTitle(registro));
    win.document.write(`<html><head>${buildPlanillaHeadHtml(documentTitle)}${INVOICE_PRINT_STYLE}</head><body>${root.outerHTML}${invoicesHtml}</body></html>`);
    win.document.close();
    await waitWindowLoad(win);
    // CSS primero, después la impresora: sin esto el diálogo podía abrirse con
    // la planilla sin estilos.
    try { await waitStylesheets(win); } catch (e) {}
    const printRoot = win.document.querySelector('#planillaProduccionPrintable');
    if (printRoot?.querySelector('.planilla-summary-grid')) printRoot.querySelector('.planilla-summary-grid').style.gridTemplateColumns = 'repeat(4, minmax(0, 1fr))';
    const qrHost = win.document.querySelector('#planillaQrTarget');
    if (qrHost && window.QRCode) {
      renderQr(qrHost, registro);
    }
    try { await waitImages(win.document.body); } catch (e) {}
    await new Promise((resolve) => win.requestAnimationFrame ? win.requestAnimationFrame(() => resolve()) : setTimeout(resolve, 50));
    // Se mide despues de cargar imagenes y fuentes: antes el alto no es el real.
    fitAllPlanillasToOnePage(win);
    win.focus();
    win.print();
  };

  const createPrintableNode = async (registro, context = {}) => {
    await ensureQrLib();
    const enrichedRegistro = await enrichRegistroForPlanilla(registro, context);
    const wrapper = document.createElement('div');
    wrapper.style.position = 'fixed';
    wrapper.style.left = '-99999px';
    wrapper.style.top = '0';
    wrapper.innerHTML = buildPlanillaHtml(enrichedRegistro, context);
    document.body.appendChild(wrapper);
    const printable = wrapper.querySelector('#planillaProduccionPrintable');
    renderQr(printable?.querySelector('#planillaQrTarget'), enrichedRegistro);
    await new Promise((resolve) => setTimeout(resolve, 60));
    const clone = printable ? printable.cloneNode(true) : null;
    wrapper.remove();
    return clone;
  };

  const printBatch = async (registros, context = {}, onProgress) => {
    const rows = Array.isArray(registros) ? registros : [];
    if (!rows.length) return;
    // context.invoiceOptions lo resuelve quien llama (produccion.js) antes de
    // abrir su barra de progreso, para no pisar el diálogo de la pregunta.
    const invoiceOptions = context.allowInvoices ? (context.invoiceOptions || null) : null;
    const withInvoices = Boolean(invoiceOptions?.include);
    const printNodes = [];
    // Con facturas cada produccion son 2 pasos (planilla + adjuntos): el avance
    // se reparte entre ambos para que la barra no se quede clavada.
    const stepsPerRow = withInvoices ? 2 : 1;
    const totalSteps = Math.max(1, rows.length * stepsPerRow);
    let doneSteps = 0;
    let renderedImages = 0;
    let skippedImages = 0;
    const report = (label) => onProgress?.(Math.min(95, Math.round((doneSteps / totalSteps) * 95)), label);
    for (let index = 0; index < rows.length; index += 1) {
      report(`Planilla ${index + 1} de ${rows.length}`);
      const node = await createPrintableNode(rows[index], context);
      doneSteps += 1;
      let invoicesHtml = '';
      if (withInvoices) {
        if (renderedImages < BATCH_IMAGE_LIMIT) {
          // Cada planilla arrastra sus propias hojas de facturas atrás.
          const cells = await buildInvoiceCellsForRegistro(rows[index], (attachmentDone, attachmentTotal) => {
            report(`Facturas ${index + 1} de ${rows.length} · adjunto ${Math.min(attachmentDone + 1, attachmentTotal)} de ${attachmentTotal}`);
          });
          renderedImages += cells.length;
          invoicesHtml = buildInvoiceSheetsHtml(cells, invoiceOptions.perPage, normalizeValue(rows[index]?.id));
        } else {
          skippedImages += countRegistroInvoices([rows[index]]);
        }
        doneSteps += 1;
      }
      if (node) printNodes.push(`${node.outerHTML}${invoicesHtml}`);
      report(`Planilla ${index + 1} de ${rows.length} lista`);
      // Respiro para el hilo principal: sin esto un rango largo congela la UI y
      // la barra de progreso no se pinta.
      await yieldToUi();
    }
    if (skippedImages > 0) {
      // Nada de cortes silenciosos: si se llego al tope se avisa.
      console.warn(`[planillas masivas] tope de ${BATCH_IMAGE_LIMIT} imagenes alcanzado: ${skippedImages} adjunto(s) no se imprimieron.`);
      await openPlanillaSwal({
        title: 'Facturas parcialmente incluidas',
        html: `<p>Se alcanzó el tope de <strong>${BATCH_IMAGE_LIMIT}</strong> imágenes para un mismo lote de impresión (evita que el navegador se quede sin memoria).</p><p><strong>${skippedImages}</strong> adjunto(s) quedaron afuera. Las planillas salen completas igual. Para incluirlos todos, imprimí el período en rangos más cortos.</p>`,
        icon: 'warning',
        confirmButtonText: 'Continuar',
        customClass: { popup: 'ios-alert', title: 'ios-alert-title', htmlContainer: 'ios-alert-text', confirmButton: 'ios-btn ios-btn-primary' }
      });
    }
    const win = window.open('', '_blank', 'width=1240,height=900');
    if (!win) {
      onProgress?.(100);
      await warnPopupBlocked();
      return;
    }
    win.document.write(`<html><head>${buildPlanillaHeadHtml('Planillas masivas')}${INVOICE_PRINT_STYLE}</head><body>${printNodes.map((html, index) => `<section style="${index ? 'page-break-before:always;' : ''}">${html}</section>`).join('')}</body></html>`);
    win.document.close();
    // Los dataURL ya viven en el DOM de la ventana: soltamos la copia en JS.
    printNodes.length = 0;
    attachmentRenderCache.clear();
    onProgress?.(100);
    await waitWindowLoad(win);
    try { await waitStylesheets(win); } catch (e) {}
    try { await waitImages(win.document.body); } catch (e) {}
    await new Promise((resolve) => win.requestAnimationFrame ? win.requestAnimationFrame(() => resolve()) : setTimeout(resolve, 50));
    fitAllPlanillasToOnePage(win);
    win.focus();
    win.print();
  };

  const openByRegistro = async (registro, context = {}) => {
    if (!registro || typeof Swal === 'undefined') return;
    Swal.fire({ title: 'Generando planilla...', html: '<div class="informes-saving-spinner"><img src="./IMG/Meta-ai-logo.webp" alt="Cargando planilla" class="meta-spinner-login"></div>', allowOutsideClick: false, showConfirmButton: false, customClass: { popup: 'ios-alert produccion-loading-alert', title: 'ios-alert-title', htmlContainer: 'ios-alert-text' } });
    const printable = await createPrintableNode(registro, context);
    Swal.close();
    if (!printable) return;

    const printOptions = { allowInvoices: Boolean(context.allowInvoices) };
    if (window.matchMedia('(max-width: 768px)').matches && !context.forceModalOnMobile) {
      await printPlanilla(printable, registro, printOptions);
      return;
    }

    await Swal.fire({
      title: `Planilla ${escapeHtml(registro.id || '')}`,
      html: `<div class="planilla-toolbar"><button type="button" class="btn ios-btn ios-btn-secondary" id="planillaPrintBtn"><i class="fa-solid fa-print"></i><span>Imprimir</span></button></div>${printable.outerHTML}`,
      width: '98vw',
      confirmButtonText: 'Cerrar',
      customClass: { popup: 'produccion-trace-alert planilla-modal', confirmButton: 'ios-btn ios-btn-secondary' },
      didOpen: async (popup) => {
        const node = popup.querySelector('#planillaProduccionPrintable');
        if (!node) return;
        renderQr(node.querySelector('#planillaQrTarget'), registro);
        await waitImages(node);
        popup.querySelector('#planillaPrintBtn')?.addEventListener('click', async () => {
          // Sin facturas no hay segundo diálogo: la vista previa queda abierta
          // como siempre (es el caso de la pagina publica de trazabilidad).
          if (!printOptions.allowInvoices) {
            await printPlanilla(node, registro, printOptions);
            return;
          }
          // SweetAlert soporta un solo diálogo a la vez y la pregunta por las
          // facturas abre otro: clonamos la planilla y cerramos la vista previa
          // antes de imprimir para no pelear por el popup.
          const printableClone = node.cloneNode(true);
          Swal.close();
          await printPlanilla(printableClone, registro, printOptions);
        });
      }
    });
  };

  const openById = async (productionId, context = {}) => {
    const id = normalizeValue(productionId);
    if (!id) return;
    const registro = await window.laJamoneraProduccionAPI?.getRegistroById?.(id);
    if (!registro) {
      await Swal.fire({ title: 'Sin datos', html: '<p>No se encontró la producción solicitada.</p>', icon: 'warning' });
      return;
    }
    await openByRegistro(registro, context);
  };

  window.laJamoneraPlanillaProduccion = { openByRegistro, openById, getTraceUrl, printBatch, askInvoiceOptions };
})();
