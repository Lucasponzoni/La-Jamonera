(function inventarioModule() {
  const inventarioModal = document.getElementById('inventarioModal');
  if (!inventarioModal) return;

  const DEFAULT_LOW_THRESHOLD = 5;
  const DEFAULT_EXPIRING_SOON_DAYS = 2;
  const LOT_TOKEN_OPTIONS = [
    { key: 'remito_factura', label: 'N° de factura' },
    { key: 'fecha_fabricacion', label: 'Fecha de fabricación' },
    { key: 'fecha_hoy', label: 'Fecha de hoy' },
    { key: 'fecha_vencimiento', label: 'Fecha de vencimiento' },
    { key: 'iniciales_producto', label: 'Iniciales del producto' },
    { key: 'siglas_personalizadas', label: 'Siglas personalizadas' }
  ];
  const LOT_SEPARATORS = ['.', '-', '_', ',', ';', '|'];
  // Versión del esquema de configuración de lote. Los registros guardados con
  // una versión anterior (o sin versión) se pisan con el default N° DE FACTURA
  // (el lote es directamente el número de factura del ingreso) hasta que el
  // usuario guarde una configuración propia (que ya sale versionada).
  const LOT_CONFIG_VERSION = 3;
  const buildDefaultLotConfig = () => ({
    configured: true,
    collapsed: true,
    version: LOT_CONFIG_VERSION,
    tokens: ['remito_factura'],
    customAcronym: 'LJ',
    includeSeparator: true,
    separator: '-'
  });
  const PAGE_SIZE = 10;
  const NO_DATA_IMAGE_URL = 'https://firebasestorage.googleapis.com/v0/b/fg-lj-d6325.firebasestorage.app/o/extras%2FNo%20data.png?alt=media&token=2d7086a4-6f7d-4fb8-aa8c-51c579f59828';
  const ALLOWED_UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const ALLOWED_INVOICE_UPLOAD_TYPES = [...ALLOWED_UPLOAD_TYPES, 'application/pdf'];
  const ALLOWED_RNE_UPLOAD_TYPES = [...ALLOWED_UPLOAD_TYPES, 'application/pdf'];
  const MAX_UPLOAD_SIZE_BYTES = 5 * 1024 * 1024;
  const PROVIDER_AVATAR_TONES = [
    { bg: '#e9f1ff', border: '#bfd2ff', color: '#2f57b0' },
    { bg: '#e8f8ef', border: '#b9e8cb', color: '#167a43' },
    { bg: '#fff3e6', border: '#f4d5ae', color: '#9a621d' },
    { bg: '#f2edff', border: '#d9c9ff', color: '#6a43c2' },
    { bg: '#ffecef', border: '#f3bfca', color: '#a6324a' },
    { bg: '#e7f7ff', border: '#b8deef', color: '#1e617d' }
  ];

  const $ = (id) => document.getElementById(id);
  const nodes = {
    loading: $('inventarioLoading'),
    empty: $('inventarioEmpty'),
    data: $('inventarioData'),
    list: $('inventarioList'),
    families: $('inventarioFamilies'),
    statusFilters: $('inventarioStatusFilters'),
    autoEgresoFilters: $('inventarioAutoEgresoFilters'),
    searchInput: $('inventarioSearchInput'),
    createIngredientBtn: $('inventarioCreateIngredientBtn'),
    toolbarCreateBtn: $('inventarioToolbarCreateIngredientBtn'),
    configBtn: $('inventarioConfigBtn'),
    providersRneBtn: $('inventarioProvidersRneBtn'),
    weeklyConfigBtn: $('inventarioWeeklyConfigBtn'),
    providersRneAlert: $('inventarioProvidersRneAlert'),
    expiryAlert: $('inventarioExpiryAlert'),
    editorWrap: $('inventarioEditor'),
    editorForm: $('inventarioEditorForm'),
    editorTitle: $('inventarioEditorTitle'),
    backBtn: $('inventarioBackBtn'),
    openPeriodFilterBtn: $('inventarioOpenPeriodFilterBtn'),
    periodView: $('inventarioPeriodView'),
    periodBackBtn: $('inventarioPeriodBackBtn'),
    globalRange: $('inventarioGlobalRange'),
    globalApplyBtn: $('inventarioGlobalApplyBtn'),
    globalClearBtn: $('inventarioGlobalClearBtn'),
    globalExpandBtn: $('inventarioGlobalExpandBtn'),
    globalLoading: $('inventarioGlobalLoading'),
    globalPrintBtn: $('inventarioGlobalPrintBtn'),
    globalSheetBtn: $('inventarioGlobalSheetBtn'),
    globalExcelBtn: $('inventarioGlobalExcelBtn'),
    globalTableWrap: $('inventarioGlobalTableWrap'),
    imageViewerModal: $('imageViewerModal'),
    viewerImage: $('viewerImage'),
    viewerStage: $('viewerStage'),
    viewerStageSpinner: $('viewerStageSpinner'),
    viewerDocument: $('viewerDocument'),
    viewerPrevBtn: $('viewerPrevBtn'),
    viewerNextBtn: $('viewerNextBtn'),
    viewerCounter: $('viewerCounter'),
    viewerZoomInBtn: $('viewerZoomInBtn'),
    viewerZoomOutBtn: $('viewerZoomOutBtn'),
    viewerBackBtn: $('viewerBackBtn'),
    viewerDownloadBtn: $('viewerDownloadBtn')
  };

  // El autoloader define cada sl-* recién cuando aparece en el DOM. Varios renders de este
  // módulo leen .value/.checked en el mismo tick del innerHTML: precargamos los componentes
  // que usa inventario para que ya estén definidos (la mejora es sincrónica una vez definidos).
  (() => {
    const tags = ['sl-input', 'sl-select', 'sl-option', 'sl-textarea', 'sl-checkbox', 'sl-switch', 'sl-radio-group', 'sl-radio',
      'sl-button', 'sl-icon-button', 'sl-icon', 'sl-badge', 'sl-dropdown', 'sl-menu', 'sl-menu-item', 'sl-divider', 'sl-spinner'];
    const pending = tags.filter((tag) => !customElements.get(tag));
    if (!pending.length || !document.body) return;
    const holder = document.createElement('div');
    holder.hidden = true;
    holder.setAttribute('aria-hidden', 'true');
    holder.innerHTML = pending.map((tag) => `<${tag}></${tag}>`).join('');
    document.body.append(holder);
    Promise.all(pending.map((tag) => customElements.whenDefined(tag))).finally(() => holder.remove());
  })();

  const state = {
    ingredientes: {},
    familias: {},
    measures: [],
    inventario: { config: { globalLowThresholdKg: DEFAULT_LOW_THRESHOLD, expiringSoonDays: DEFAULT_EXPIRING_SOON_DAYS }, items: {} },
    search: '',
    activeFamilyId: 'all',
    familiesCollapsed: (() => { try { return localStorage.getItem('inventario_families_collapsed') === '1'; } catch (_) { return false; } })(),
    view: 'list',
    selectedIngredientId: '',
    editorDraft: null,
    editorDirty: false,
    resumeEditor: null,
    tablePage: 1,
    tableSearch: '',
    tableDateRange: '',
    dashboardDateRange: '',
    periodMode: false,
    globalTablePage: 1,
    activeStockStatus: 'all',
    viewerImages: [],
    viewerIndex: 0,
    viewerScale: 1,
    entryCollapseByIngredient: {},
    globalEntryCollapse: {},
    providerRneFilter: 'all',
    providerRneSearch: '',
    providerRnePage: 1,
    pendingProviderDeleteId: '',
    weeklyConfigSearch: '',
    weeklyConfigPage: 1,
    activeAutoEgresoFilter: 'all',
    searchRenderTimer: null,
    inventoryLoadedFromIndex: false,
    fullInventoryLoaded: false,
    inventoryDetailLoaded: {},
    periodLots: null,
    inventoryExpiryExpanded: false
  };

  const safeObject = (value) => (value && typeof value === 'object' ? value : {});
  const normalizeValue = (value) => String(value || '').trim();
  const normalizeLower = (value) => normalizeValue(value).toLowerCase();
  const normalizeUpper = (value) => normalizeValue(value).toUpperCase();
  const capitalize = (value) => normalizeLower(value).replace(/(^|\s)\S/g, (ch) => ch.toUpperCase());
  const sentenceCase = (value) => {
    const text = normalizeValue(value).toLowerCase();
    if (!text) return '';
    return text.charAt(0).toUpperCase() + text.slice(1);
  };
  const makeId = (prefix) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const AR_TIMEZONE = 'America/Argentina/Buenos_Aires';

  const getDateParts = (date, timeZone = AR_TIMEZONE) => {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    const parts = formatter.formatToParts(date);
    const map = parts.reduce((acc, part) => {
      if (part.type !== 'literal') acc[part.type] = part.value;
      return acc;
    }, {});
    return {
      year: Number(map.year),
      month: Number(map.month),
      day: Number(map.day)
    };
  };

  const toIsoDate = ({ year, month, day }) => `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  const getArgentinaIsoDate = (date = new Date()) => toIsoDate(getDateParts(date, AR_TIMEZONE));

  const addDaysToIso = (isoDate, days) => {
    const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(String(isoDate || ''));
    if (!match) return '';
    const utc = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    utc.setUTCDate(utc.getUTCDate() + Number(days || 0));
    return toIsoDate({
      year: utc.getUTCFullYear(),
      month: utc.getUTCMonth() + 1,
      day: utc.getUTCDate()
    });
  };

  const normalizeIsoDate = (value) => {
    const text = normalizeValue(value);
    const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(text);
    if (!match) return '';
    return `${match[1]}-${match[2]}-${match[3]}`;
  };

  const formatIsoDateEs = (isoDate) => {
    const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(normalizeValue(isoDate));
    if (!match) return '-';
    return `${match[3]}/${match[2]}/${match[1]}`;
  };

  const formatExpiryForUi = (entry) => {
    if (entry?.noPerecedero) return 'No perecedero';
    const iso = normalizeIsoDate(entry?.expiryDate);
    return iso ? formatIsoDateEs(iso) : '-';
  };

  const formatShortDateTimeEs = (value) => {
    const date = value instanceof Date ? value : new Date(Number(value) || value);
    if (Number.isNaN(date.getTime())) return '-';
    const datePart = new Intl.DateTimeFormat('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      timeZone: AR_TIMEZONE
    }).format(date);
    const timePart = new Intl.DateTimeFormat('es-AR', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: AR_TIMEZONE
    }).format(date).replace(' a. m.', ' a. m.').replace(' p. m.', ' p. m.');
    return `${datePart}, ${timePart}`;
  };

  const getDaysUntilIso = (isoDate) => {
    const normalized = normalizeIsoDate(isoDate);
    if (!normalized) return null;
    const today = getArgentinaIsoDate();
    return Math.round((new Date(`${normalized}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86400000);
  };

  const isEntryNoPerecedero = (entry) => Boolean(entry?.noPerecedero);
  const isEntryUsoInterno = (entry) => Boolean(entry?.usoInternoEmpresa);
  const isEntryFrozen = (entry) => Boolean(entry?.isFrozen || entry?.frozen);

  // === Frozen product (CAA/SENASA) ===
  // Cuando un ingreso se marca como "congelado", el vencimiento se fija a 60 días
  // desde la fecha de ingreso, independientemente de los días sugeridos.
  const FROZEN_EXPIRY_DAYS = 60;

  const FROZEN_INFO_HTML = `
    <div class="frozen-info-content">
      <header class="frozen-info-hero">
        <div class="frozen-info-hero-icon"><sl-icon name="snow2"></sl-icon></div>
        <div>
          <p class="frozen-info-kicker">Procedimiento interno</p>
          <h3 class="frozen-info-hero-title">Congelamiento y descongelado seguro de alimentos</h3>
          <p class="frozen-info-hero-sub">Basado en CAA, BPM/POES y recomendaciones oficiales de inocuidad alimentaria</p>
        </div>
      </header>

      <article class="frozen-info-card frozen-info-card--blue">
        <header class="frozen-info-card-head">
          <span class="frozen-info-step">1</span>
          <h4><sl-icon name="clipboard2-check-fill"></sl-icon> Condición previa</h4>
        </header>
        <ul class="frozen-info-list">
          <li><sl-icon name="check-circle-fill"></sl-icon> Congelar solamente alimentos aptos, identificados, dentro de vida útil y con trazabilidad de lote/proveedor.</li>
          <li><sl-icon name="check-circle-fill"></sl-icon> Verificar integridad del envase, condiciones higiénico-sanitarias y ausencia de signos de alteración.</li>
          <li><sl-icon name="check-circle-fill"></sl-icon> Registrar fecha/hora de ingreso, fecha/hora de congelamiento, responsable, lote y temperatura de cámara.</li>
          <li><sl-icon name="check-circle-fill"></sl-icon> Mantener separación entre crudos/listos para consumir y evitar contaminación cruzada.</li>
        </ul>
      </article>

      <article class="frozen-info-card frozen-info-card--ice">
        <header class="frozen-info-card-head">
          <span class="frozen-info-step">2</span>
          <h4><sl-icon name="snow"></sl-icon> Congelamiento en cámara a -18&nbsp;°C</h4>
        </header>
        <div class="frozen-info-temp-grid">
          <div class="frozen-info-temp">
            <strong>-18&nbsp;°C</strong>
            <span>temperatura objetivo de cámara/freezer</span>
          </div>
        </div>
        <ul class="frozen-info-list">
          <li><sl-icon name="check-circle-fill"></sl-icon> Colocar el alimento protegido, rotulado y en envase apto para freezer.</li>
          <li><sl-icon name="check-circle-fill"></sl-icon> Disponerlo de forma que el frío circule y el descenso de temperatura sea uniforme.</li>
          <li><sl-icon name="check-circle-fill"></sl-icon> Controlar y documentar la temperatura de cámara durante el almacenamiento.</li>
          <li><sl-icon name="x-circle-fill"></sl-icon> Evitar aperturas prolongadas, fluctuaciones de temperatura y descongelamientos parciales.</li>
        </ul>
        <div class="frozen-info-callout frozen-info-callout--warn">
          <sl-icon name="exclamation-triangle-fill"></sl-icon>
          <p><strong>Importante:</strong> congelar no elimina peligros microbiológicos ni vuelve indefinida la vida útil. La fecha extendida debe estar definida por procedimiento, rotulado/trazabilidad y respaldo técnico del establecimiento.</p>
        </div>
      </article>

      <article class="frozen-info-card frozen-info-card--mint">
        <header class="frozen-info-card-head">
          <span class="frozen-info-step">3</span>
          <h4><sl-icon name="droplet-half"></sl-icon> Descongelado en cámara de 0 a 5&nbsp;°C</h4>
        </header>
        <ul class="frozen-info-list">
          <li><sl-icon name="check-circle-fill"></sl-icon> Pasar el alimento a cámara refrigerada entre <strong>0&nbsp;°C y 5&nbsp;°C</strong>, protegido e identificado.</li>
          <li><sl-icon name="check-circle-fill"></sl-icon> Registrar inicio/fin de descongelado, lote, responsable y temperatura de cámara.</li>
          <li><sl-icon name="check-circle-fill"></sl-icon> Mantenerlo separado de alimentos listos para consumir y contener posibles exudados.</li>
          <li><sl-icon name="x-circle-fill"></sl-icon> No descongelar a temperatura ambiente, cerca de fuentes de calor ni bajo canilla.</li>
          <li><sl-icon name="x-circle-fill"></sl-icon> No volver a congelar un alimento descongelado salvo que exista proceso validado y documentado.</li>
        </ul>
      </article>

      <article class="frozen-info-card frozen-info-card--rose">
        <header class="frozen-info-card-head">
          <span class="frozen-info-step">4</span>
          <h4><sl-icon name="calendar2-check"></sl-icon> Vencimiento extendido</h4>
        </header>
        <p class="frozen-info-text">El vencimiento extendido por congelamiento a -18&nbsp;°C debe usarse como criterio interno documentado. No es automático: depende del producto, proceso, envase, cadena de frío, rotulado y validación sanitaria.</p>
        <ul class="frozen-info-list">
          <li><sl-icon name="check-circle-fill"></sl-icon> Definir la duración a -18&nbsp;°C y las instrucciones de conservación/descongelado cuando correspondan.</li>
          <li><sl-icon name="check-circle-fill"></sl-icon> Mantener registros de temperaturas, lotes, fechas y responsables.</li>
          <li><sl-icon name="check-circle-fill"></sl-icon> Respaldar la vida útil con procedimiento BPM/POES, evaluación de riesgo y controles aplicables.</li>
        </ul>
        <div class="frozen-info-callout frozen-info-callout--info">
          <sl-icon name="info-circle-fill"></sl-icon>
          <p><strong>CAA:</strong> para alimentos cuya duración varía por temperatura, debe indicarse la condición de conservación, por ejemplo duración a -18&nbsp;°C, y las instrucciones necesarias de uso/descongelación cuando correspondan.</p>
        </div>
      </article>

      <article class="frozen-info-card frozen-info-card--violet">
        <header class="frozen-info-card-head">
          <span class="frozen-info-step">5</span>
          <h4><sl-icon name="folder-check"></sl-icon> Documentación mínima</h4>
        </header>
        <ul class="frozen-info-list frozen-info-list--two-col">
          <li><sl-icon name="check2-square"></sl-icon> Procedimiento escrito de congelamiento y descongelado.</li>
          <li><sl-icon name="check2-square"></sl-icon> Registros de temperatura de cámara/freezer.</li>
          <li><sl-icon name="check2-square"></sl-icon> Identificación de lote y fecha de congelamiento.</li>
          <li><sl-icon name="check2-square"></sl-icon> Registro de descongelado en cámara 0 a 5&nbsp;°C.</li>
          <li><sl-icon name="check2-square"></sl-icon> Trazabilidad de proveedor, ingreso, elaboración y egreso.</li>
          <li><sl-icon name="check2-square"></sl-icon> Verificación sanitaria según el producto y proceso.</li>
        </ul>
      </article>

      <footer class="frozen-info-conclusion">
        <sl-icon name="patch-check-fill"></sl-icon>
        <p>El criterio correcto es: congelar en cámara a <strong>-18&nbsp;°C</strong>, conservar cadena de frío, documentar todo el proceso y descongelar en cámara de <strong>0 a 5&nbsp;°C</strong>. La vida útil extendida debe estar respaldada por el procedimiento y los controles del establecimiento.</p>
      </footer>
    </div>`;

  const FROZEN_INFO_PDF_SECTIONS = [
    { title: '1. Condicion previa', lines: ['Congelar solamente alimentos aptos, identificados, dentro de vida util y con trazabilidad de lote/proveedor.', 'Verificar integridad del envase, condiciones higienico-sanitarias y ausencia de signos de alteracion.', 'Registrar fecha/hora de ingreso, fecha/hora de congelamiento, responsable, lote y temperatura de camara.', 'Mantener separacion entre crudos/listos para consumir y evitar contaminacion cruzada.'] },
    { title: '2. Congelamiento en camara a -18 C', lines: ['La temperatura objetivo de camara/freezer es -18 C.', 'Colocar el alimento protegido, rotulado y en envase apto para freezer.', 'Disponerlo de forma que el frio circule y el descenso de temperatura sea uniforme.', 'Controlar y documentar la temperatura de camara durante el almacenamiento.', 'Evitar aperturas prolongadas, fluctuaciones de temperatura y descongelamientos parciales.', 'Congelar no elimina peligros microbiologicos ni vuelve indefinida la vida util.'] },
    { title: '3. Descongelado en camara de 0 a 5 C', lines: ['Pasar el alimento a camara refrigerada entre 0 C y 5 C, protegido e identificado.', 'Registrar inicio/fin de descongelado, lote, responsable y temperatura de camara.', 'Mantenerlo separado de alimentos listos para consumir y contener posibles exudados.', 'No descongelar a temperatura ambiente, cerca de fuentes de calor ni bajo canilla.', 'No volver a congelar un alimento descongelado salvo que exista proceso validado y documentado.'] },
    { title: '4. Vencimiento extendido', lines: ['El vencimiento extendido por congelamiento a -18 C debe usarse como criterio interno documentado.', 'No es automatico: depende del producto, proceso, envase, cadena de frio, rotulado y validacion sanitaria.', 'Para alimentos cuya duracion varia por temperatura, debe indicarse la condicion de conservacion y las instrucciones necesarias de uso/descongelacion cuando correspondan.'] },
    { title: '5. Documentacion minima', lines: ['Procedimiento escrito de congelamiento y descongelado.', 'Registros de temperatura de camara/freezer.', 'Identificacion de lote y fecha de congelamiento.', 'Registro de descongelado en camara 0 a 5 C.', 'Trazabilidad de proveedor, ingreso, elaboracion y egreso.', 'Verificacion sanitaria segun el producto y proceso.'] }
  ];

  const getFrozenInfoLogoDataUrl = () => new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 96;
      canvas.height = 96;
      const context = canvas.getContext('2d');
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/png'));
    };
    image.onerror = () => resolve('');
    image.src = './IMG/La Jamonera App.png';
  });

  const downloadFrozenInfoPdf = async () => {
    if (!window.jspdf?.jsPDF) {
      openIosSwal({ title: 'No se pudo generar', html: '<p>No se pudo cargar la libreria PDF. Reintenta en unos segundos.</p>', icon: 'error', confirmButtonText: 'Entendido' });
      return;
    }
    const logoDataUrl = await getFrozenInfoLogoDataUrl();
    const doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
    const margin = 14;
    const maxWidth = 182;
    let y = 38;
    const drawHeader = () => {
      if (logoDataUrl) doc.addImage(logoDataUrl, 'PNG', margin, 9, 20, 20);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(17);
      doc.text('La Jamonera', logoDataUrl ? 39 : margin, 17);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.text('Procedimiento interno de inocuidad alimentaria', logoDataUrl ? 39 : margin, 23);
      doc.setDrawColor(210, 222, 242);
      doc.line(margin, 32, 196, 32);
    };
    const drawFooters = () => {
      const pageCount = doc.getNumberOfPages();
      for (let page = 1; page <= pageCount; page += 1) {
        doc.setPage(page);
        doc.setDrawColor(210, 222, 242);
        doc.line(margin, 284, 196, 284);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.text('Back Office para empresas · powered by Asesoria Bromatologica Rosario', 105, 290, { align: 'center' });
        doc.text(String(page), 196, 290, { align: 'right' });
      }
    };
    drawHeader();
    const addLines = (lines, size = 10, gap = 5) => {
      doc.setFontSize(size);
      lines.forEach((line) => {
        const wrapped = doc.splitTextToSize(line, maxWidth);
        if (y + wrapped.length * gap > 272) {
          doc.addPage();
          drawHeader();
          y = 38;
        }
        doc.text(wrapped, margin, y);
        y += wrapped.length * gap;
      });
    };
    doc.setFont('helvetica', 'bold');
    addLines(['Congelamiento y descongelado seguro de alimentos'], 15, 7);
    doc.setFont('helvetica', 'normal');
    addLines(['Basado en CAA, BPM/POES y recomendaciones oficiales de inocuidad alimentaria.'], 10, 6);
    y += 2;
    FROZEN_INFO_PDF_SECTIONS.forEach((section) => {
      doc.setFont('helvetica', 'bold');
      addLines([section.title], 12, 6);
      doc.setFont('helvetica', 'normal');
      addLines(section.lines.map((line) => `- ${line}`), 10, 5);
      y += 2;
    });
    doc.setFont('helvetica', 'bold');
    addLines(['Criterio operativo'], 12, 6);
    doc.setFont('helvetica', 'normal');
    addLines(['Congelar en camara a -18 C, conservar cadena de frio, documentar todo el proceso y descongelar en camara de 0 a 5 C. La vida util extendida debe estar respaldada por el procedimiento y los controles del establecimiento.'], 10, 5);
    drawFooters();
    doc.save('procedimiento-congelamiento-descongelado.pdf');
  };

  const openFrozenInfoSwal = () => openIosSwal({
    ljModal: true,
    title: 'Congelamiento a -18°C',
    html: FROZEN_INFO_HTML,
    showDenyButton: true,
    confirmButtonText: 'Entendido',
    denyButtonText: 'Descargar PDF',
    width: 720,
    customClass: { popup: 'ios-alert frozen-info-alert' }
  }).then((result) => {
    if (result.isDenied) downloadFrozenInfoPdf();
  });

  const frozenInfoIconHtml = (extraClass = '') =>
    `<sl-icon-button name="info-circle-fill" class="frozen-info-icon ${extraClass}" data-frozen-info label="Información sobre producto congelado" title="¿Qué significa congelado?"></sl-icon-button>`;

  const frozenBadgeHtml = (entry) => {
    if (!isEntryFrozen(entry)) return '';
    const frozenAt = normalizeValue(entry?.frozenAt);
    const frozenAtHtml = frozenAt
      ? `<span class="inventario-frozen-since">desde ${escapeHtml(formatIsoDateEs(frozenAt))}</span>`
      : '';
    return `<span class="inventario-frozen-badge" title="Producto congelado al ingreso (vto. 60 días)"><sl-icon name="snow2"></sl-icon><span>Congelado</span>${frozenAtHtml}</span>`;
  };

  const recordHasFrozenEntries = (record) =>
    Array.isArray(record?.entries) && record.entries.some(isEntryFrozen);

  const getExpiryBadgeTone = (days) => {
    if (!Number.isFinite(days)) return '';
    if (days <= 2) return 'is-danger';
    if (days <= 4) return 'is-warning';
    return 'is-success';
  };

  const getExpiryBadgeHtml = (entry) => {
    const available = getAvailableQty(entry);
    if (!Number.isFinite(available) || available <= 0) return '';
    if (isEntryNoPerecedero(entry)) return '<span class="inventario-expiry-days-badge is-neutral">No perecedero</span>';
    const days = getDaysUntilIso(entry?.expiryDate);
    if (!Number.isFinite(days)) return '';
    const tone = getExpiryBadgeTone(days);
    if (days < 0) {
      return `<span class="inventario-expiry-days-badge is-danger">Expirado hace ${Math.abs(days)} día(s)</span>`;
    }
    return `<span class="inventario-expiry-days-badge ${tone}">Vence en ${days} día(s)</span>`;
  };

  const getExpiryBadgeText = (entry) => {
    const available = getAvailableQty(entry);
    if (!Number.isFinite(available) || available <= 0) return '';
    if (isEntryNoPerecedero(entry)) return 'No perecedero';
    const days = getDaysUntilIso(entry?.expiryDate);
    if (!Number.isFinite(days)) return '';
    if (days < 0) return `Expirado hace ${Math.abs(days)} día(s)`;
    return `Vence en ${days} día(s)`;
  };

  const formatEntryDetailLabel = (entry) => {
    const unit = normalizeValue(entry?.unit || '');
    const qty = Number(entry?.qty || 0);
    const available = Number(getAvailableInUnit(entry, unit));
    const abbr = escapeHtml(getMeasureAbbr(unit || ''));
    const pkg = Number(entry?.packageQty || 0) > 0 ? ` x${Number(entry.packageQty)}` : '';
    return {
      qtyLabel: `${qty.toFixed(2)} ${escapeHtml(unit)}`,
      availableLabel: `disp. ${available.toFixed(2)} ${abbr}${pkg}`
    };
  };

  const parseNumber = (value) => {
    const parsed = Number(normalizeValue(value).replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : NaN;
  };


  const getDefaultBulkEntryDraft = (ingredientId = '') => ({
    id: makeId('bulk'),
    ingredientId,
    qty: '',
    unit: '',
    packageQty: '',
    noPerecedero: false,
    usoInternoEmpresa: false,
    entryDate: '',
    expiryDate: ''
  });
  const disableCalendarSuggestions = (input) => {
    if (!input) return;
    input.setAttribute('autocomplete', 'new-password');
    input.setAttribute('autocapitalize', 'off');
    input.setAttribute('autocorrect', 'off');
    input.setAttribute('spellcheck', 'false');
    input.setAttribute('inputmode', 'none');
    input.setAttribute('readonly', 'readonly');
  };

  const getDefaultProviderRne = () => ({
    number: '',
    expiryDate: '',
    infiniteExpiry: false,
    observations: '',
    attachmentUrl: '',
    attachmentType: '',
    updatedAt: 0,
    history: []
  });

  const getDefaultProvider = () => ({
    id: makeId('provider'),
    name: '',
    email: '',
    phone: '',
    photoUrl: '',
    nonFoodCategory: false,
    createdAt: Date.now(),
    rne: getDefaultProviderRne()
  });

  const normalizeProvider = (item) => {
    if (typeof item === 'string') {
      const name = normalizeUpper(item);
      if (!name) return null;
      return {
        ...getDefaultProvider(),
        name
      };
    }

    const source = safeObject(item);
    const name = normalizeUpper(source.name || source.label || source.provider);
    if (!name) return null;

    return {
      ...getDefaultProvider(),
      ...source,
      id: normalizeValue(source.id) || makeId('provider'),
      name,
      rne: {
        ...getDefaultProviderRne(),
        ...safeObject(source.rne),
        observations: normalizeValue(source?.rne?.observations || source?.rne?.observation || source?.rne?.observacion),
        history: Array.isArray(source?.rne?.history) ? source.rne.history : []
      }
    };
  };

  const getProviders = () => (Array.isArray(state.inventario?.config?.providers) ? state.inventario.config.providers : [])
    .map((item) => normalizeProvider(item))
    .filter(Boolean);

  const sortedProviders = () => getProviders().sort((a, b) => a.name.localeCompare(b.name, 'es'));

  const findProviderById = (providerId) => {
    const id = normalizeValue(providerId);
    if (!id) return null;
    return getProviders().find((item) => item.id === id) || null;
  };

  const findProviderByName = (providerName) => {
    const name = normalizeUpper(providerName);
    if (!name) return null;
    return getProviders().find((item) => normalizeUpper(item.name) === name) || null;
  };

  const resolveProvider = (value) => {
    const raw = normalizeValue(value);
    if (!raw) return null;
    return findProviderById(raw) || findProviderByName(raw);
  };

  const providerLabel = (value) => {
    const provider = resolveProvider(value);
    if (provider?.name) return provider.name;
    return normalizeValue(value) || 'No indica';
  };

  const providerInitials = (name) => {
    const tokens = normalizeValue(name).split(/\s+/).filter(Boolean);
    if (!tokens.length) return 'PR';
    if (tokens.length === 1) return tokens[0].slice(0, 2).toUpperCase();
    return `${tokens[0][0] || ''}${tokens[1][0] || ''}`.toUpperCase();
  };

  const getProviderAvatarTone = (providerName) => {
    const source = normalizeUpper(providerName || 'PR');
    const hash = [...source].reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return PROVIDER_AVATAR_TONES[hash % PROVIDER_AVATAR_TONES.length];
  };

  const providerAvatarStyle = (providerName) => {
    const tone = getProviderAvatarTone(providerName);
    return `--provider-avatar-bg:${tone.bg};--provider-avatar-border:${tone.border};--provider-avatar-color:${tone.color};`;
  };

  const sanitizeImageUrl = (value) => {
    const raw = normalizeValue(value);
    if (!raw) return '';
    const lower = raw.toLowerCase();
    if (['null', 'undefined', 'nan', '[object object]'].includes(lower)) return '';
    if (window.LaJamoneraImageGuard?.isBroken?.(raw)) return '';
    return raw;
  };

  const providerAvatarHtml = (provider, opts = {}) => {
    const sizeClass = opts.size === 'editor' ? 'inventario-provider-editor-avatar' : 'inventario-provider-avatar';
    const photoUrl = sanitizeImageUrl(provider?.photoUrl);
    const initials = escapeHtml(providerInitials(provider?.name));
    if (photoUrl) {
      return `<div class="${sizeClass}" data-provider-initials="${initials}" style="${providerAvatarStyle(provider?.name)}"><span class="thumb-loading"><sl-spinner class="meta-spinner-login" aria-label="Cargando"></sl-spinner></span><img class="thumb-image js-inventario-thumb" src="${(window.ljThumb || String)(escapeHtml(photoUrl))}" alt="${escapeHtml(provider?.name || 'Proveedor')}"></div>`;
    }
    return `<div class="${sizeClass}" style="${providerAvatarStyle(provider?.name)}">${initials}</div>`;
  };

  const getRneRemainingDays = (expiryIso) => {
    const expiry = new Date(`${normalizeValue(expiryIso)}T00:00:00`);
    if (Number.isNaN(expiry.getTime())) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((expiry.getTime() - today.getTime()) / 86400000);
  };

  const getProviderRneStatus = (provider) => {
    if (Boolean(provider?.nonFoodCategory)) {
      return { key: 'all', label: 'No alimentos', tone: 'neutral', helper: 'No requiere RNE.' };
    }
    const rne = safeObject(provider?.rne);
    const hasRne = Boolean(normalizeValue(rne.number) || normalizeValue(rne.observations) || normalizeValue(rne.attachmentUrl));
    if (!hasRne) {
      return { key: 'none', label: 'Sin RNE', tone: 'info', helper: 'Podés cargarlo más tarde.' };
    }
    if (Boolean(rne?.infiniteExpiry)) {
      return { key: 'all', label: 'RNE', tone: 'info', helper: 'Vencimiento infinito.' };
    }
    const remainingDays = getRneRemainingDays(rne.expiryDate);
    if (remainingDays == null) {
      return { key: 'all', label: 'RNE cargado', tone: 'info', helper: 'Sin fecha de caducidad declarada.' };
    }
    if (remainingDays < 0) {
      return { key: 'danger', label: 'RNE vencido', tone: 'danger', helper: `Venció hace ${Math.abs(remainingDays)} día(s).` };
    }
    if (remainingDays < 60) {
      return { key: 'danger', label: 'Vence en menos de 60 días', tone: 'danger', helper: `Vence en ${remainingDays} día(s).` };
    }
    if (remainingDays < 180) {
      return { key: 'warning', label: 'Vence en menos de 6 meses', tone: 'warning', helper: `Vence en ${remainingDays} día(s).` };
    }
    return { key: 'all', label: 'RNE al día', tone: 'info', helper: `Vence en ${remainingDays} día(s).` };
  };


  const createProviderWithName = (name) => ({
    ...getDefaultProvider(),
    name: normalizeUpper(name)
  });

  const saveProviderInConfig = (provider) => {
    const next = sortedProviders().filter((item) => item.id !== provider.id && normalizeUpper(item.name) !== normalizeUpper(provider.name));
    next.push(provider);
    state.inventario.config.providers = next;
    normalizeProvidersConfig();
  };

  const buildProviderRneHistoryEntry = (source) => ({
    number: normalizeValue(source?.number),
    expiryDate: normalizeValue(source?.expiryDate),
    infiniteExpiry: Boolean(source?.infiniteExpiry),
    observations: normalizeValue(source?.observations || source?.observation || source?.observacion),
    attachmentUrl: normalizeValue(source?.attachmentUrl),
    attachmentType: normalizeValue(source?.attachmentType),
    savedAt: Date.now()
  });

  const measureKey = (value) => normalizeLower(value);
  const getMeasureLabel = (name) => {
    const match = state.measures.find((item) => measureKey(item.name) === measureKey(name));
    if (!match) return capitalize(name || 'unidad');
    return `${capitalize(match.name)} (${normalizeValue(match.abbr) || 'S/A'})`;
  };

  const getMeasureAbbr = (name) => {
    const match = state.measures.find((item) => measureKey(item.name) === measureKey(name));
    return normalizeValue(match?.abbr) || capitalize(name || 'u.');
  };

  const getUnitMeta = (unitRaw) => {
    const unit = normalizeLower(unitRaw);
    const massMap = {
      kg: 1000, kilo: 1000, kilos: 1000, kilogramo: 1000, kilogramos: 1000,
      g: 1, gr: 1, gramo: 1, gramos: 1,
      oz: 28.3495, onza: 28.3495, onzas: 28.3495,
      cda: 15, cucharada: 15, cucharadas: 15,
      cdita: 5, cucharadita: 5, cucharaditas: 5,
      pzc: 0.5, pizca: 0.5, pizcas: 0.5
    };
    const volumeMap = {
      l: 1000, lt: 1000, lts: 1000, litro: 1000, litros: 1000,
      ml: 1, mililitro: 1, mililitros: 1,
      cc: 1, 'centimetros cubicos': 1,
      gota: 0.05, gotas: 0.05, gts: 0.05
    };
    if (massMap[unit]) return { category: 'peso', factor: massMap[unit] };
    if (volumeMap[unit]) return { category: 'volumen', factor: volumeMap[unit] };
    if (['u', 'un', 'un.', 'unidad', 'unidades'].includes(unit)) return { category: 'unidad', factor: 1 };
    return { category: 'otro', factor: 1 };
  };

  const toBase = (qty, unit) => {
    const amount = Number(qty || 0);
    if (!Number.isFinite(amount)) return Number.NaN;
    const meta = getUnitMeta(unit);
    return amount * (meta.factor || 1);
  };

  const fromBase = (baseQty, unit) => {
    const meta = getUnitMeta(unit);
    return Number(baseQty || 0) / (meta.factor || 1);
  };

  const formatQtyUnit = (qty, unit, digits = 2) => `${Number(qty || 0).toFixed(digits)} ${getMeasureAbbr(unit)}`;

  const openIosSwal = (options) => {
    const incomingCustomClass = safeObject(options?.customClass);
    const joinClass = (base, extra) => [base, extra].filter(Boolean).join(' ').trim();
    const reservedKeys = new Set(['popup', 'title', 'htmlContainer', 'confirmButton', 'cancelButton']);
    const passthroughCustomClass = Object.fromEntries(
      Object.entries(incomingCustomClass).filter(([key]) => !reservedKeys.has(key))
    );

    return Swal.fire({
      ...options,
      customClass: {
        ...passthroughCustomClass,
        popup: joinClass('ios-alert ingredientes-alert', incomingCustomClass.popup),
        title: joinClass('ios-alert-title', incomingCustomClass.title),
        htmlContainer: joinClass('ios-alert-text', incomingCustomClass.htmlContainer),
        confirmButton: joinClass('ios-btn-primary', incomingCustomClass.confirmButton),
        cancelButton: joinClass('ios-btn-secondary', incomingCustomClass.cancelButton)
      }
    });
  };

  const runWithBackSpinner = async (task) => {
    const modalContent = LJModal.body(inventarioModal);
    if (!modalContent) {
      await task();
      return;
    }
    if (window.getComputedStyle(modalContent).position === 'static') {
      modalContent.style.position = 'relative';
    }
    const overlay = document.createElement('div');
    overlay.className = 'modal-local-overlay';
    overlay.innerHTML = '<div class="modal-local-overlay-card"><sl-spinner class="meta-spinner-login" aria-label="Actualizando"></sl-spinner></div>';
    modalContent.appendChild(overlay);
    try {
      await task();
    } finally {
      overlay.remove();
    }
  };

  const setStateView = (view) => {
    state.view = view;
    nodes.loading.classList.toggle('d-none', view !== 'loading');
    nodes.empty.classList.toggle('d-none', view !== 'empty');
    nodes.data.classList.toggle('d-none', view !== 'list');
    nodes.editorWrap.classList.toggle('d-none', view !== 'editor');
  };

  const updateListScrollHint = () => {
    if (!nodes.list) return;
    const hasOverflow = nodes.list.scrollHeight > nodes.list.clientHeight + 4;
    const isAtEnd = nodes.list.scrollTop + nodes.list.clientHeight >= nodes.list.scrollHeight - 4;
    nodes.list.classList.toggle('has-scroll-hint', hasOverflow && !isAtEnd);
  };

  const ingredientAvatar = (item) => item?.imageUrl
    ? `<div class="ingrediente-avatar"><span class="thumb-loading"><sl-spinner class="meta-spinner-login" aria-label="Cargando"></sl-spinner></span><img class="thumb-image js-inventario-thumb" src="${(window.ljThumb || String)(item.imageUrl)}" alt="${capitalize(item.name)}"></div>`
    : '<div class="ingrediente-avatar ingrediente-avatar-placeholder"><i class="fa-solid fa-carrot"></i></div>';

  const uploadImageToStorage = async (file, folder) => {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const refPath = `${folder}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const ref = window.storageLaJamonera.ref().child(refPath);
    await ref.put(file);
    return ref.getDownloadURL();
  };

  const validateInvoiceFile = (file) => {
    if (!file) return '';
    if (!ALLOWED_INVOICE_UPLOAD_TYPES.includes(file.type)) return 'Formato no válido (JPG, PNG, WEBP, GIF o PDF).';
    if (file.size > MAX_UPLOAD_SIZE_BYTES) return 'El adjunto supera 5MB.';
    return '';
  };

  const setFilesOnInput = (input, files = []) => {
    if (!input || !files?.length) return;
    const dt = new DataTransfer();
    [...files].forEach((file) => dt.items.add(file));
    input.files = dt.files;
  };

  const getDefaultWeeklySheetConfig = () => ({
    configured: false,
    counterOnly: false,
    egresoEnabled: true,
    perishable: true,
    rotationDays: 7,
    updatedAt: 0
  });
  const INFINITE_STOCK_NOTICE = 'Stock infinito, producto comprado en el dia por caja chica, sin trazabilidad.';
  const isInfiniteStockRecord = (record = {}) => Boolean(record?.infiniteStock || record?.stockInfinito);

  const getDefaultRecord = (ingredientId) => ({
    ingredientId,
    stockKg: 0,
    stockBase: 0,
    stockUnit: '',
    infiniteStock: false,
    hasEntries: false,
    entries: [],
    lowThresholdKg: null,
    lowThresholdBase: null,
    lowThresholdMode: 'global',
    packageQty: null,
    expiringSoonDays: null,
    suggestedExpiryDays: null,
    lotConfig: buildDefaultLotConfig(),
    weeklySheetConfig: getDefaultWeeklySheetConfig()
  });

  const getRecord = (ingredientId) => {
    const saved = safeObject(state.inventario.items[ingredientId]);
    const base = getDefaultRecord(ingredientId);
    // Config de lote: sólo respetamos la guardada si es de la versión actual;
    // las viejas (o inexistentes) se reemplazan por el default N° DE FACTURA.
    const savedLotConfig = safeObject(saved.lotConfig);
    const merged = {
      ...base,
      ...saved,
      lotConfig: Number(savedLotConfig.version) >= LOT_CONFIG_VERSION
        ? { ...base.lotConfig, ...savedLotConfig }
        : buildDefaultLotConfig(),
      weeklySheetConfig: { ...getDefaultWeeklySheetConfig(), ...safeObject(saved.weeklySheetConfig) }
    };
    merged.infiniteStock = isInfiniteStockRecord(merged);
    return merged;
  };

  const recomputeRecordStock = (record, fallbackUnit = 'kilos') => {
    const entries = Array.isArray(record?.entries) ? record.entries : [];
    if (!entries.length) {
      record.stockBase = 0;
      record.stockKg = 0;
      record.stockUnit = '';
      return record;
    }
    const unit = record.stockUnit || entries[0]?.unit || fallbackUnit;
    const stockBase = entries.reduce((acc, entry) => {
      const availableBase = Number(entry?.availableBase);
      if (Number.isFinite(availableBase)) return acc + availableBase;
      return acc + toBase(getAvailableQty(entry), entry?.unit || unit);
    }, 0);
    record.stockUnit = unit;
    record.stockBase = Number(stockBase.toFixed(6));
    return record;
  };

  const currentThresholdFor = (record, fallbackUnit = 'kilos') => {
    const mode = normalizeValue(record.lowThresholdMode || '');
    const localBase = Number(record.lowThresholdBase);
    if (mode === 'custom' && Number.isFinite(localBase) && localBase >= 0) return localBase;
    const localLegacy = Number(record.lowThresholdKg);
    const unit = record.stockUnit || fallbackUnit || 'kilos';
    if (mode === 'custom' && Number.isFinite(localLegacy) && localLegacy >= 0) return toBase(localLegacy, unit);

    if (!mode) {
      if (Number.isFinite(localBase) && localBase > 0) return localBase;
      if (Number.isFinite(localLegacy) && localLegacy > 0) return toBase(localLegacy, unit);
    }
    const category = getUnitMeta(unit).category;
    const global = category === 'unidad'
      ? Number(state.inventario.config.globalLowThresholdUnits)
      : Number(state.inventario.config.globalLowThresholdKg);
    if (Number.isFinite(global) && global >= 0) return toBase(global, unit);
    return toBase(DEFAULT_LOW_THRESHOLD, unit);
  };

  const currentExpiringDaysFor = (record) => {
    const local = Number(record.expiringSoonDays);
    if (Number.isFinite(local) && local >= 0) return local;
    const global = Number(state.inventario.config.expiringSoonDays);
    return Number.isFinite(global) && global >= 0 ? global : DEFAULT_EXPIRING_SOON_DAYS;
  };

  const stockStatusFor = (record, fallbackUnit = 'kilos') => {
    if (isInfiniteStockRecord(record)) return { label: 'Stock infinito', className: 'status-good', infinite: true };
    const unit = record.stockUnit || fallbackUnit || 'kilos';
    const stockBase = Number(record.stockBase || toBase(record.stockKg || 0, unit)) || 0;
    if (!record.hasEntries) return { label: 'Nunca ingresó stock', className: 'status-never' };
    if (stockBase <= 0) return { label: 'Sin stock', className: 'status-empty' };
    if (stockBase <= currentThresholdFor(record, unit)) return { label: 'Stock bajo', className: 'status-low' };
    return { label: 'En stock', className: 'status-good' };
  };

  const isEntryExpiringSoon = (entry, days) => {
    if (isEntryNoPerecedero(entry)) return false;
    const expiry = new Date(entry.expiryDate || '');
    if (Number.isNaN(expiry.getTime())) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    expiry.setHours(0, 0, 0, 0);
    const diffDays = Math.round((expiry.getTime() - today.getTime()) / 86400000);
    return diffDays >= 0 && diffDays <= days;
  };

  const sumExpiringSoonKg = (record) => (Array.isArray(record.entries) ? record.entries : [])
    .filter((entry) => isEntryExpiringSoon(entry, currentExpiringDaysFor(record)))
    .reduce((acc, entry) => acc + getAvailableKg(entry), 0);

  const getExpiringSoonEntries = (record) => {
    const daysWindow = currentExpiringDaysFor(record);
    const todayIso = getArgentinaIsoDate();
    const entries = Array.isArray(record?.entries) ? record.entries : [];
    // Fallback para records lite (vienen de /inventario_index): si no hay
    // entries, usamos el summary precomputado. El optimizador congela diffDays
    // contra el today del momento de la build, así que lo recalculamos contra
    // el today actual y descartamos los que ya cruzaron a vencido.
    if (!entries.length && Array.isArray(record?.expiringEntries) && record.expiringEntries.length) {
      return record.expiringEntries
        .map((row) => {
          const expiryDate = normalizeValue(row.expiryDate);
          const diffDays = expiryDate
            ? Math.round((new Date(`${expiryDate}T00:00:00`).getTime() - new Date(`${todayIso}T00:00:00`).getTime()) / 86400000)
            : null;
          return {
            entryId: normalizeValue(row.entryId),
            qty: Number(row.qty || 0),
            unit: normalizeValue(row.unit) || record.stockUnit || 'kilos',
            diffDays,
            expiryDate,
            lotNumber: normalizeValue(row.lotNumber),
            packageQty: Number.isFinite(Number(row.packageQty)) ? Number(row.packageQty) : (record.packageQty || null)
          };
        })
        .filter((row) => row.qty > 0 && Number.isFinite(row.diffDays) && row.diffDays >= 0 && row.diffDays <= daysWindow)
        .sort((a, b) => a.diffDays - b.diffDays);
    }
    return entries
      .map((entry) => {
        const expiryDate = normalizeIsoDate(entry.expiryDate);
        const availableQty = getAvailableQty(entry);
        if (isEntryNoPerecedero(entry)) return null;
        if (!expiryDate || !Number.isFinite(availableQty) || availableQty <= 0) return null;
        if (expiryDate < todayIso) return null;
        const diffDays = Math.round((new Date(`${expiryDate}T00:00:00`).getTime() - new Date(`${todayIso}T00:00:00`).getTime()) / 86400000);
        if (diffDays < 0 || diffDays > daysWindow) return null;
        return {
          entryId: entry.id,
          qty: availableQty,
          unit: entry.unit,
          diffDays,
          expiryDate,
          lotNumber: normalizeValue(entry.lotNumber),
          packageQty: Number(entry.packageQty || record.packageQty || 0) || null
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.diffDays - b.diffDays);
  };

  const getExpiredEntries = (record) => {
    const todayIso = getArgentinaIsoDate();
    const entries = Array.isArray(record?.entries) ? record.entries : [];
    // Fallback para records lite (vienen de /inventario_index): si no hay
    // entries, usamos el summary precomputado. Mergeamos expiredEntries con los
    // expiringEntries que ya cruzaron la fecha (el bucket del optimizador es
    // del día en que se buildeó el índice) y recalculamos diffDays vs today.
    const liteExpired = Array.isArray(record?.expiredEntries) ? record.expiredEntries : [];
    const liteExpiring = Array.isArray(record?.expiringEntries) ? record.expiringEntries : [];
    if (!entries.length && (liteExpired.length || liteExpiring.length)) {
      const seen = new Set();
      return [...liteExpired, ...liteExpiring]
        .map((row) => {
          const expiryDate = normalizeValue(row.expiryDate);
          const diffDays = expiryDate
            ? Math.abs(Math.round((new Date(`${todayIso}T00:00:00`).getTime() - new Date(`${expiryDate}T00:00:00`).getTime()) / 86400000))
            : 0;
          return {
            entryId: normalizeValue(row.entryId),
            qty: Number(row.qty || 0),
            unit: normalizeValue(row.unit) || record.stockUnit || 'kilos',
            diffDays,
            expiryDate,
            lotNumber: normalizeValue(row.lotNumber),
            packageQty: Number.isFinite(Number(row.packageQty)) ? Number(row.packageQty) : (record.packageQty || null)
          };
        })
        .filter((row) => {
          if (row.qty <= 0 || !row.expiryDate || row.expiryDate >= todayIso) return false;
          if (seen.has(row.entryId)) return false;
          seen.add(row.entryId);
          return true;
        })
        .sort((a, b) => a.diffDays - b.diffDays);
    }
    return entries
      .map((entry) => {
        const expiryDate = normalizeIsoDate(entry.expiryDate);
        const availableQty = getAvailableQty(entry);
        if (isEntryNoPerecedero(entry)) return null;
        if (!expiryDate || !Number.isFinite(availableQty) || availableQty <= 0) return null;
        if (expiryDate >= todayIso) return null;
        const diffDays = Math.abs(Math.round((new Date(`${todayIso}T00:00:00`).getTime() - new Date(`${expiryDate}T00:00:00`).getTime()) / 86400000));
        return {
          entryId: entry.id,
          qty: availableQty,
          unit: entry.unit,
          diffDays,
          expiryDate,
          lotNumber: normalizeValue(entry.lotNumber),
          packageQty: Number(entry.packageQty || record.packageQty || 0) || null
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.diffDays - b.diffDays);
  };

  const ensureIndexes = () => {
    state.inventario.indexes = safeObject(state.inventario.indexes);
    state.inventario.indexes.invoiceByIngredient = safeObject(state.inventario.indexes.invoiceByIngredient);
    state.inventario.indexes.byDate = safeObject(state.inventario.indexes.byDate);
  };

  const rebuildInventarioIndexes = () => {
    ensureIndexes();
    const invoiceByIngredient = {};
    const byDate = {};

    Object.values(state.ingredientes).forEach((ingredient) => {
      const ingredientId = ingredient.id;
      const record = getRecord(ingredientId);
      const entries = Array.isArray(record.entries) ? record.entries : [];
      if (!invoiceByIngredient[ingredientId]) invoiceByIngredient[ingredientId] = {};

      entries.forEach((entry) => {
        const invoiceKey = normalizeLower(entry.invoiceNumber);
        if (invoiceKey) invoiceByIngredient[ingredientId][invoiceKey] = entry.id;

        const iso = normalizeValue(entry.entryDate);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return;
        const [year, month, day] = iso.split('-');
        byDate[year] = byDate[year] || {};
        byDate[year][month] = byDate[year][month] || {};
        byDate[year][month][day] = byDate[year][month][day] || [];
        byDate[year][month][day].push({ ingredientId, entryId: entry.id });
      });
    });

    state.inventario.indexes.invoiceByIngredient = invoiceByIngredient;
    state.inventario.indexes.byDate = byDate;
  };


  const normalizeProvidersConfig = () => {
    const seen = new Set();
    const providers = getProviders()
      .filter((provider) => {
        const key = normalizeUpper(provider.name);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'es'));
    state.inventario.config.providers = providers;
  };

  const persistInventario = async (options = {}) => {
    normalizeProvidersConfig();
    await window.laJamoneraReady;
    // Sólo config (umbrales globales, proveedores): no se tocan los registros.
    if (options.configOnly) {
      await window.dbLaJamoneraRest.write('/inventario/config', state.inventario.config || {});
      return;
    }
    const itemIds = [...new Set((Array.isArray(options.itemIds) ? options.itemIds : []).map(normalizeValue).filter(Boolean))];
    if (itemIds.length) {
      await window.dbLaJamoneraRest.write('/inventario/config', state.inventario.config || {});
      for (const itemId of itemIds) {
        let record = { ...safeObject(state.inventario.items?.[itemId]) };
        // Registro "liviano" del índice (sin lotes): se combina con el detalle completo para no borrar lotes.
        if (record.__indexLite) {
          const base = safeObject(await window.dbLaJamoneraRest.read(`/inventario/items/${itemId}`));
          ['__indexLite', 'entries', 'entriesCount', 'expiredEntries', 'expiringEntries', 'hasFrozenEntries'].forEach((k) => delete record[k]);
          record = { ...base, ...record };
          state.inventario.items[itemId] = record;
        }
        delete record.__indexLite;
        await window.dbLaJamoneraRest.write(`/inventario/items/${itemId}`, record);
      }
      return;
    }
    const hasLiteRecords = Object.values(safeObject(state.inventario.items)).some((item) => item?.__indexLite);
    let payload = state.inventario;
    if (hasLiteRecords) {
      const full = safeObject(await window.dbLaJamoneraRest.read('/inventario'));
      const mergedItems = {};
      Object.entries(safeObject(state.inventario.items)).forEach(([id, record]) => {
        const base = record?.__indexLite && full.items?.[id] ? safeObject(full.items[id]) : {};
        const cleanRecord = { ...safeObject(record) };
        if (cleanRecord.__indexLite) {
          delete cleanRecord.__indexLite;
          delete cleanRecord.entries;
          delete cleanRecord.entriesCount;
          delete cleanRecord.expiredEntries;
          delete cleanRecord.expiringEntries;
          delete cleanRecord.hasFrozenEntries;
        }
        mergedItems[id] = { ...base, ...cleanRecord };
      });
      payload = {
        ...safeObject(full),
        config: safeObject(state.inventario.config),
        items: mergedItems
      };
      state.inventario = payload;
      state.fullInventoryLoaded = true;
      state.inventoryLoadedFromIndex = false;
    }
    await window.dbLaJamoneraRest.write('/inventario', payload);
  };

  const persistMeasuresIfNeeded = async (measureName, measureAbbr) => {
    const key = measureKey(measureName);
    if (!key) return;
    if (state.measures.some((item) => measureKey(item.name) === key)) return;
    state.measures.push({ name: normalizeLower(measureName), abbr: normalizeValue(measureAbbr) || 'S/A' });
    await window.dbLaJamoneraRest.write('/ingredientes/config/measures', state.measures);
  };

  const normalizeInventoryRecordForIngredient = (ingredient) => {
    const current = getRecord(ingredient.id);
    current.infiniteStock = isInfiniteStockRecord(current);
    const entries = Array.isArray(current.entries) ? current.entries : [];
    if (!entries.length) {
      if (current.__indexLite) {
        current.hasEntries = Boolean(current.hasEntries);
        current.packageQty = Number.isFinite(Number(current.packageQty)) ? Number(current.packageQty) : null;
        current.stockUnit = current.stockUnit || '';
        current.stockBase = Number(current.stockBase || 0);
        current.stockKg = Number(current.stockKg || 0);
      } else {
        current.hasEntries = false;
        current.packageQty = null;
        current.stockUnit = '';
        current.stockBase = 0;
        current.stockKg = 0;
      }
      current.lowThresholdMode = current.lowThresholdMode || 'global';
    } else {
      current.hasEntries = true;
      const firstUnit = current.stockUnit || entries[0]?.unit || ingredient.measure || 'kilos';
      current.stockUnit = firstUnit;
      if (!Number.isFinite(Number(current.packageQty))) {
        const pkgEntry = entries.find((entry) => Number.isFinite(Number(entry?.packageQty)) && Number(entry.packageQty) > 0);
        current.packageQty = pkgEntry ? Number(pkgEntry.packageQty) : null;
      }
      recomputeRecordStock(current, firstUnit);
      if (!normalizeValue(current.lowThresholdMode)) {
        const hasLegacyCustom = Number.isFinite(Number(current.lowThresholdBase))
          ? Number(current.lowThresholdBase) > 0
          : Number.isFinite(Number(current.lowThresholdKg)) && Number(current.lowThresholdKg) > 0;
        current.lowThresholdMode = hasLegacyCustom ? 'custom' : 'global';
        if (!hasLegacyCustom) {
          current.lowThresholdBase = null;
          current.lowThresholdKg = null;
        }
      }
    }
    state.inventario.items[ingredient.id] = current;
    return current;
  };

  const loadData = async (options = {}) => {
    try {
      await window.laJamoneraReady;
    } catch (error) {
      console.error('[Inventario] Firebase no estuvo disponible al cargar.', error);
    }
    let ing = {};
    let inv = {};

    try {
      ing = await window.laJamoneraIngredientesAPI?.getIngredientesSnapshot?.() || {};
    } catch (error) {
      console.error('[Inventario] No se pudo leer snapshot de ingredientes.', error);
      ing = {};
    }

    try {
      const forceFull = Boolean(options.forceFull);
      if (!forceFull) {
        inv = safeObject(await window.dbLaJamoneraRest.read('/inventario_index'));
        state.inventoryLoadedFromIndex = Boolean(inv?.items);
        state.fullInventoryLoaded = !state.inventoryLoadedFromIndex;
      }
      if (forceFull || !inv?.items) {
        inv = safeObject(await window.dbLaJamoneraRest.read('/inventario'));
        state.inventoryLoadedFromIndex = false;
        state.fullInventoryLoaded = true;
      }
      state.inventoryDetailLoaded = state.fullInventoryLoaded ? { __all: true } : {};
    } catch (error) {
      console.error('[Inventario] No se pudo leer /inventario desde Firebase.', error);
      inv = {};
      state.inventoryLoadedFromIndex = false;
      state.fullInventoryLoaded = false;
    }

    state.ingredientes = safeObject(ing?.items);
    state.familias = safeObject(ing?.familias);
    state.measures = Array.isArray(ing?.measures) ? ing.measures : [];
    state.inventario = {
      config: {
        globalLowThresholdKg: Number(inv?.config?.globalLowThresholdKg) >= 0 ? Number(inv.config.globalLowThresholdKg) : DEFAULT_LOW_THRESHOLD,
        globalLowThresholdUnits: Number(inv?.config?.globalLowThresholdUnits) >= 0 ? Number(inv.config.globalLowThresholdUnits) : DEFAULT_LOW_THRESHOLD,
        expiringSoonDays: Number(inv?.config?.expiringSoonDays) >= 0 ? Number(inv.config.expiringSoonDays) : DEFAULT_EXPIRING_SOON_DAYS,
        // Flag de migración one-shot: lotes históricos regenerados al formato
        // LJ-ddmmaaaa-INICIALES. Debe sobrevivir la normalización del config.
        lotMigrationV2: Boolean(inv?.config?.lotMigrationV2),
        providers: Array.isArray(inv?.config?.providers)
          ? inv.config.providers.map((item) => normalizeProvider(item)).filter(Boolean)
          : []
      },
      items: safeObject(inv?.items)
    };
    Object.values(state.ingredientes).forEach((ingredient) => normalizeInventoryRecordForIngredient(ingredient));
    normalizeProvidersConfig();
    rebuildInventarioIndexes();
  };

  const ensureInventoryRecordDetail = async (ingredientId) => {
    const id = normalizeValue(ingredientId);
    if (!id || state.fullInventoryLoaded || state.inventoryDetailLoaded[id]) return;
    try {
      const detail = safeObject(await window.dbLaJamoneraRest.read(`/inventario/items/${id}`));
      if (Object.keys(detail).length) {
        state.inventario.items[id] = detail;
        const ingredient = state.ingredientes[id];
        if (ingredient) normalizeInventoryRecordForIngredient(ingredient);
        state.inventoryDetailLoaded[id] = true;
      }
    } catch (error) {
      console.warn('[Inventario] No se pudo leer detalle exacto de inventario.', id, error);
    }
  };

  const ensureFullInventoryLoaded = async () => {
    if (state.fullInventoryLoaded) return;
    await loadData({ forceFull: true });
  };

  // Ingresos por período: con Supabase se listan los lotes "livianos" (sin los historiales de consumo, que
  // pesan ~50 MB) y el detalle de un ingrediente se pide recién al desplegar una de sus filas.
  // Se guardan aparte (state.periodLots) para que ningún guardado use un registro incompleto.
  const ensurePeriodLotsLoaded = async () => {
    if (state.fullInventoryLoaded) return;
    const client = window.LJ_BACKEND === 'supabase' ? window.supabaseLaJamonera : null;
    if (!client) { await ensureFullInventoryLoaded(); return; }
    const { data, error } = await client.rpc('lj_inventario_lotes_lite');
    if (error) { console.warn('[Inventario] lotes livianos', error); await ensureFullInventoryLoaded(); return; }
    state.periodLots = safeObject(data);
  };
  const periodEntriesFor = (ingredientId) => {
    const record = getRecord(ingredientId);
    if (state.fullInventoryLoaded || state.inventoryDetailLoaded[ingredientId] || !state.periodLots) {
      return Array.isArray(record.entries) ? record.entries : [];
    }
    return Array.isArray(state.periodLots[ingredientId]) ? state.periodLots[ingredientId] : [];
  };
  const periodDetailLoading = new Set();
  const loadPeriodDetailsFor = async (ingredientIds) => {
    const ids = [...new Set(ingredientIds)].filter((id) => id && !state.inventoryDetailLoaded[id] && !periodDetailLoading.has(id));
    if (!ids.length) return;
    ids.forEach((id) => periodDetailLoading.add(id));
    try {
      await Promise.all(ids.map((id) => ensureInventoryRecordDetail(id)));
    } finally {
      ids.forEach((id) => periodDetailLoading.delete(id));
    }
    if (state.periodMode) renderGlobalPeriodTable();
  };

  // loadData() sin forceFull relee /inventario_index, cuyos records vienen
  // "lite" (sin entries). Si eso pasa mientras el editor de un ingrediente esta
  // abierto, la tabla de ingresos queda vacia ("Sin ingresos para mostrar")
  // hasta salir y volver a entrar. Recargamos el detalle del ingrediente
  // abierto para que la tabla se repinte con sus entries reales.
  const reloadEditorData = async (ingredientId) => {
    await loadData();
    await ensureInventoryRecordDetail(ingredientId);
  };

  const filteredIngredients = () => Object.values(state.ingredientes)
    .filter((item) => {
      if (state.activeFamilyId !== 'all' && item.familyId !== state.activeFamilyId) return false;
      if (state.activeStockStatus !== 'all') {
        const record = getRecord(item.id);
        if (state.activeStockStatus === 'expiring') {
          if (!getExpiringSoonEntries(record).length) return false;
        } else if (state.activeStockStatus === 'expired') {
          if (!getExpiredEntries(record).length) return false;
        } else {
          const stockClass = stockStatusFor(record, item.measure || 'kilos').className;
          if (stockClass !== state.activeStockStatus) return false;
        }
      }
      if (state.activeAutoEgresoFilter !== 'all') {
        const egresoEnabled = !!getRecord(item.id).weeklySheetConfig?.egresoEnabled;
        if (state.activeAutoEgresoFilter === 'enabled' && !egresoEnabled) return false;
        if (state.activeAutoEgresoFilter === 'disabled' && egresoEnabled) return false;
      }
      if (!state.search) return true;
      const text = [item.name, item.description, item.familyName, item.measure].map(normalizeLower).join(' ');
      return text.includes(state.search);
    })
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

  const initThumbLoading = (scope = document) => {
    scope.querySelectorAll('.js-inventario-thumb').forEach((img) => {
      const parent = img.closest('.ingrediente-avatar, .family-circle-thumb, .recipe-inline-avatar-wrap, .receta-thumb-wrap, .recipe-suggest-avatar-wrap, .inventario-print-photo-wrap, .inventario-provider-avatar, .inventario-provider-editor-avatar, .user-avatar-thumb');
      const loader = parent?.querySelector('.thumb-loading');
      const done = () => {
        img.classList.add('is-loaded');
        loader?.classList.add('d-none');
      };
      const fail = () => {
        loader?.classList.add('d-none');
        if (parent?.matches('.inventario-provider-avatar, .inventario-provider-editor-avatar')) {
          const fallbackInitials = normalizeValue(parent.dataset.providerInitials) || 'PR';
          parent.innerHTML = escapeHtml(fallbackInitials);
        }
      };
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', fail, { once: true });
      if (img.complete && img.naturalWidth > 0) {
        done();
      } else if (img.complete) {
        fail();
      } else {
        const isProviderAvatar = parent?.matches('.inventario-provider-avatar, .inventario-provider-editor-avatar');
        const timeoutMs = isProviderAvatar ? 2500 : 7000;
        setTimeout(() => {
          if (!img.classList.contains('is-loaded')) {
            fail();
          }
        }, timeoutMs);
      }
    });
  };
  const requestDeleteConfirmation = async ({ title, text, subtext }) => {
    const result = await openIosSwal({
      title,
      html: `<div class="swal-stack-fields"><p>${text}</p><p><small>${subtext}</small></p></div>`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Eliminar',
      cancelButtonText: 'Cancelar'
    });
    return result.isConfirmed;
  };

  const buildProviderDeleteConfirmHtml = (provider) => `<div class="inventario-provider-inline-confirm" data-provider-delete-confirm-wrap="${escapeHtml(provider.id)}">
    <div class="inventario-provider-inline-confirm-copy">
      <strong>Eliminar proveedor</strong>
      <p>Se borrará <strong>${escapeHtml(provider.name || 'este proveedor')}</strong> del listado.</p>
      <small>También se eliminará su RNE, historial, foto y referencias guardadas para futuras cargas.</small>
    </div>
    <div class="inventario-provider-inline-confirm-actions">
      <sl-button variant="danger" type="button" class="inventario-threshold-btn" data-provider-delete-accept="${escapeHtml(provider.id)}"><i slot="prefix" class="fa-solid fa-trash"></i><span>Eliminar proveedor</span></sl-button>
      <sl-button variant="default" type="button" class="inventario-threshold-btn" data-provider-delete-cancel="${escapeHtml(provider.id)}"><i slot="prefix" class="fa-solid fa-xmark"></i><span>Cancelar</span></sl-button>
    </div>
  </div>`;

  const waitPrintAssets = async (printWindow) => {
    const images = [...(printWindow?.document?.images || [])];
    await Promise.all(images.map((image) => {
      if (image.complete && image.naturalWidth > 0) {
        return Promise.resolve();
      }
      return new Promise((resolve) => {
        const done = () => resolve();
        image.addEventListener('load', done, { once: true });
        image.addEventListener('error', done, { once: true });
        setTimeout(resolve, 6000);
      });
    }));
  };

  const parseAiJsonFromText = (text) => {
    const content = String(text || '').trim();
    if (!content) return null;
    try {
      return JSON.parse(content);
    } catch (error) {
      const block = content.match(/```json([\s\S]*?)```/i) || content.match(/```([\s\S]*?)```/);
      if (block?.[1]) {
        try { return JSON.parse(block[1].trim()); } catch (innerError) { }
      }
      const first = content.indexOf('{');
      const last = content.lastIndexOf('}');
      if (first >= 0 && last > first) {
        try { return JSON.parse(content.slice(first, last + 1)); } catch (innerError) { }
      }
      return null;
    }
  };

  // IA: Google Gemini vía Cloud Function (window.LJAI). Devuelve el JSON chat/completions.
  const callIa = (payload) => window.LJAI.chat(payload);

  const mondayStartIso = (isoDate) => {
    const normalized = normalizeIsoDate(isoDate);
    if (!normalized) return '';
    const date = new Date(`${normalized}T00:00:00`);
    if (Number.isNaN(date.getTime())) return '';
    const day = date.getDay();
    const diffToMonday = (day + 6) % 7;
    date.setDate(date.getDate() - diffToMonday);
    return getArgentinaIsoDate(date);
  };

  const addIsoDays = (isoDate, days) => addDaysToIso(isoDate, days);

  const resolveIngredientPerishableFlag = (ingredientId) => {
    const recordCfg = safeObject(state.inventario?.items?.[ingredientId]?.weeklySheetConfig);
    if (typeof recordCfg.perishable === 'boolean') return recordCfg.perishable;
    const ingredientCfg = safeObject(state.ingredientes?.[ingredientId]);
    if (typeof ingredientCfg.perishable === 'boolean') return ingredientCfg.perishable;
    return true;
  };

  const openProductsScopeSelector = async (title = 'Selector de productos', options = {}) => openIosSwal({
    title,
    html: `<div class="swal-stack-fields text-start">
      <sl-radio-group name="printScope" value="all" class="inventario-radio-group">
        <sl-radio value="all">Incluir todos los productos</sl-radio>
        <sl-radio value="exclude">Excluir algunos productos</sl-radio>
      </sl-radio-group>
      <div id="printProductsScope" class="notify-specific-users-list d-none">
        <div class="step-block"><strong>Familias</strong>${Object.values(state.familias).map((family) => `<sl-checkbox class="inventario-check-row inventario-selector-row" data-print-family value="${family.id}">${family.imageUrl ? `<span class="inventario-print-photo-wrap"><span class="thumb-loading"><sl-spinner class="meta-spinner" aria-label="Cargando"></sl-spinner></span><img class="thumb-image js-inventario-thumb inventario-print-photo" src="${family.imageUrl}" alt="${escapeHtml(capitalize(family.name))}"></span>` : ''}<span>${escapeHtml(capitalize(family.name))}</span></sl-checkbox>`).join('')}</div>
        <div class="step-block"><strong>Productos</strong>${Object.values(state.ingredientes).map((item) => {
          const perishable = resolveIngredientPerishableFlag(item.id);
          const disabledByType = typeof options.targetPerishable === 'boolean' ? perishable !== options.targetPerishable : false;
          return `<sl-checkbox class="inventario-check-row inventario-selector-row ${disabledByType ? 'is-disabled-by-perishable' : ''}" style="${disabledByType ? 'opacity:.55;text-decoration:line-through;' : ''}" data-print-product data-family-id="${item.familyId || ''}" value="${item.id}" ${disabledByType ? 'disabled' : ''}>${item.imageUrl ? `<span class="inventario-print-photo-wrap"><span class="thumb-loading"><sl-spinner class="meta-spinner" aria-label="Cargando"></sl-spinner></span><img class="thumb-image js-inventario-thumb inventario-print-photo" src="${item.imageUrl}" alt="${escapeHtml(capitalize(item.name))}"></span>` : ''}<span>${escapeHtml(capitalize(item.name))}${disabledByType ? ` <small>(${options.targetPerishable ? 'No perecedero' : 'Perecedero'})</small>` : ''}</span></sl-checkbox>`;
        }).join('')}</div>
      </div>
    </div>`,
    showCancelButton: true,
    confirmButtonText: 'Continuar',
    cancelButtonText: 'Cancelar',
    didOpen: () => {
      const scopeGroup = document.querySelector('sl-radio-group[name="printScope"]');
      const list = document.getElementById('printProductsScope');
      const toggle = () => list?.classList.toggle('d-none', scopeGroup?.value !== 'exclude');
      scopeGroup?.addEventListener('sl-change', toggle);
      document.querySelectorAll('[data-print-family]').forEach((familyCheckbox) => {
        familyCheckbox.addEventListener('change', () => {
          const familyId = familyCheckbox.value;
          document.querySelectorAll(`[data-print-product][data-family-id="${familyId}"]`).forEach((productCheckbox) => {
            productCheckbox.checked = familyCheckbox.checked;
          });
        });
      });
      initThumbLoading(Swal.getHtmlContainer() || document);
    },
    preConfirm: () => {
      const mode = document.querySelector('sl-radio-group[name="printScope"]')?.value || 'all';
      const selected = [...document.querySelectorAll('sl-checkbox[data-print-product]')].filter((node) => node.checked).map((node) => node.value);
      if (mode === 'exclude' && !selected.length) {
        Swal.showValidationMessage('Seleccioná al menos un producto para excluir.');
        return false;
      }
      return { mode, selected };
    }
  });

  const openManagersSelector = async () => {
    await window.laJamoneraReady;
    const usersMap = safeObject(await window.dbLaJamoneraRest.read('/informes/users'));
    const users = Object.values(usersMap)
      .map((item) => ({
        id: normalizeValue(item.id || item.email || makeId('user')),
        fullName: normalizeValue(item.fullName || item.name || item.email || 'Usuario'),
        role: normalizeValue(item.position || item.role || item.sector || 'Sin cargo'),
        photoUrl: normalizeValue(item.photoUrl || '')
      }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName, 'es'));

    const selector = await openIosSwal({
      title: 'Seleccionar encargados',
      html: `<div class="swal-stack-fields text-start">
        <sl-input id="ingresosManagersSearch" class="swal2-input" placeholder="Buscar encargado..."></sl-input>
        <div id="ingresosManagersList" class="notify-specific-users-list" style="max-height:300px;overflow:auto;padding-right:4px;">${users.map((user) => `<sl-checkbox class="inventario-check-row inventario-selector-row" data-ingreso-user-row data-ingreso-user value="${escapeHtml(user.id)}"><span style="display:inline-flex;align-items:center;gap:8px;">${user.photoUrl ? `<span class="user-avatar-thumb" style="width:30px;height:30px;"><span class="thumb-loading"><sl-spinner class="meta-spinner-login" aria-label="Cargando"></sl-spinner></span><img class="thumb-image js-inventario-thumb" src="${escapeHtml(user.photoUrl)}" alt="${escapeHtml(user.fullName)}"></span>` : `<span class="user-avatar-fallback" style="width:30px;height:30px;border-radius:999px;border:1px solid var(--lj-border-strong);display:inline-flex;align-items:center;justify-content:center;font-size:11px;color:var(--lj-accent);background:var(--lj-accent-soft);">${escapeHtml((user.fullName.split(' ').filter(Boolean).map((p) => p[0]).join('').slice(0, 2) || 'US').toUpperCase())}</span>`}<span><strong>${escapeHtml(user.fullName)}</strong><small style="display:block;color:var(--lj-muted);">${escapeHtml(user.role)}</small></span></span></sl-checkbox>`).join('') || '<p class="text-muted">No hay usuarios cargados.</p>'}</div>
      </div>`,
      showCancelButton: true,
      confirmButtonText: 'Continuar',
      cancelButtonText: 'Cancelar',
      didOpen: () => {
        const search = document.getElementById('ingresosManagersSearch');
        const rows = [...document.querySelectorAll('[data-ingreso-user-row]')];
        initThumbLoading(Swal.getHtmlContainer() || document);
        search?.addEventListener('input', () => {
          const q = normalizeLower(search.value);
          rows.forEach((row) => {
            row.classList.toggle('d-none', q && !normalizeLower(row.textContent).includes(q));
          });
        });
      },
      preConfirm: () => {
        const ids = [...document.querySelectorAll('sl-checkbox[data-ingreso-user]')].filter((node) => node.checked).map((node) => node.value);
        return { users, ids };
      }
    });
    if (!selector.isConfirmed) return null;
    const selectedUsers = selector.value.users.filter((user) => selector.value.ids.includes(user.id));
    const managersLabel = selectedUsers.length ? selectedUsers.map((user) => `${user.fullName} (${user.role})`).join(', ') : 'Sin encargado';
    return { selectedUsers, managersLabel };
  };

  const estimateIngresoTemperatures = async (rows) => {
    const isBreadLikeProduct = (name) => /(\bpan\b|lactal|panificado|pan de|boll|baguette|figazza|figaza|tostado|miga)/i.test(normalizeLower(name || ''));
    const fallback = rows.reduce((acc, row) => {
      const key = `${row.ingredientId}|${row.entryId}`;
      const name = normalizeLower(row.ingredientName || '');
      const isMeat = /(carne|pollo|cerdo|vacuno|res|chacin|hamburguesa|bondiola|jamon)/i.test(name);
      const isBread = isBreadLikeProduct(name);
      const seed = (normalizeValue(row.ingredientId).length + normalizeValue(row.entryId).length + Math.round(Number(row.qty || 0) * 10)) % 10;
      const value = isMeat ? (0.8 + (seed * 0.3)) : isBread ? (16 + (seed * 0.7)) : (4.2 + (seed * 0.4));
      if (isMeat) {
        acc[key] = Math.min(4, value).toFixed(1);
      } else if (isBread) {
        acc[key] = Math.max(12, Math.min(26, value)).toFixed(1);
      } else {
        acc[key] = Math.min(12, value).toFixed(1);
      }
      return acc;
    }, {});
    try {
      if (!window.LJAI) return fallback;
      const compactRows = rows.map((row) => ({
        key: `${row.ingredientId}|${row.entryId}`,
        sharedKey: normalizeValue(row.lotNumber || row.invoiceNumber || row.entryId || ''),
        producto: row.ingredientName,
        proveedor: row.provider,
        unidad: row.unit,
        cantidad: Number(row.qty || 0)
      }));
      const payload = {
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'Sos un empleado de un frigorífico recepcionando productos. Respondé SOLO JSON válido.' },
          { role: 'user', content: `Completá temperaturas de ingreso (°C) para cada item. Para carnes, temperatura máxima 4°C. Para panes/panificados (ej: pan lactal en bolsa) NO usar grados bajos: devolver siempre 12°C o más. No fuerces todos los valores al mismo número; variá por producto/proveedor/lote. Devolvé SOLO JSON con esta estructura: {"temperaturas":{"KEY":"X.X"}}. Items: ${JSON.stringify(compactRows)}` }
        ],
        temperature: 0.1
      };
      const data = await Promise.race([
        callIa(payload),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout_ia')), 12000))
      ]);
      const parsed = parseAiJsonFromText(data?.choices?.[0]?.message?.content || '');
      const map = safeObject(parsed?.temperaturas);
      const sharedTemperatures = {};
      rows.forEach((row) => {
        const key = `${row.ingredientId}|${row.entryId}`;
        const raw = Number(String(map[key] || '').replace(',', '.'));
        const name = normalizeLower(row.ingredientName || '');
        const isMeat = /(carne|pollo|cerdo|vacuno|res|chacin|hamburguesa|bondiola|jamon)/i.test(name);
        const isBread = isBreadLikeProduct(name);
        if (!Number.isFinite(raw)) return;
        const sharedKey = normalizeValue(row.lotNumber || row.invoiceNumber || row.entryId || '');
        if (sharedKey && sharedTemperatures[sharedKey]) {
          fallback[key] = sharedTemperatures[sharedKey];
          return;
        }
        if (isMeat) {
          fallback[key] = Math.min(raw, 4).toFixed(1);
          if (sharedKey) sharedTemperatures[sharedKey] = fallback[key];
          return;
        }
        if (isBread) {
          fallback[key] = Math.max(12, raw).toFixed(1);
          if (sharedKey) sharedTemperatures[sharedKey] = fallback[key];
          return;
        }
        fallback[key] = raw.toFixed(1);
        if (sharedKey) sharedTemperatures[sharedKey] = fallback[key];
      });
    } catch (error) {
    }
    return fallback;
  };

  const askRequiredRangeForIngresosSheet = async (options = {}) => {
    const title = normalizeValue(options.title) || 'Rango obligatorio para planilla';
    const description = normalizeValue(options.description) || 'Para evitar procesar datos infinitos, seleccioná un rango de fechas antes de continuar.';
    const picker = await openIosSwal({
      title,
      html: `<p>${escapeHtml(description)}</p><input id="sheetRangeInput" class="lj-input swal2-input" placeholder="Seleccionar rango">`,
      showCancelButton: true,
      confirmButtonText: 'Continuar',
      cancelButtonText: 'Cancelar',
      didOpen: () => {
        const input = document.getElementById('sheetRangeInput');
        if (window.flatpickr && input) {
          window.flatpickr(input, {
            locale: window.flatpickr.l10ns?.es || undefined,
            mode: 'range',
            dateFormat: 'Y-m-d',
            allowInput: false,
            disableMobile: true,
            defaultDate: getDefaultRangeDates(state.dashboardDateRange)
          });
        }
      },
      preConfirm: () => {
        const raw = normalizeValue(document.getElementById('sheetRangeInput')?.value);
        const parsed = parseRangeValue(raw);
        if (!parsed.from || !parsed.to) {
          Swal.showValidationMessage('Debés seleccionar un rango completo (desde y hasta).');
          return false;
        }
        return parsed;
      }
    });
    return picker.isConfirmed ? picker.value : null;
  };


  const entryImageUrls = (entry) => {
    if (Array.isArray(entry?.invoiceImageUrls) && entry.invoiceImageUrls.length) {
      return entry.invoiceImageUrls.filter(Boolean);
    }
    if (entry?.invoiceImageUrl) {
      return [entry.invoiceImageUrl];
    }
    return [];
  };

  const invoiceUploadFileKey = (file) => file
    ? `${normalizeValue(file.name)}|${Number(file.size || 0)}|${Number(file.lastModified || 0)}`
    : '';

  const invoiceUploadSummary = (items = []) => {
    const uploaded = items.filter((item) => item.status === 'done' && item.url).length;
    const uploading = items.filter((item) => item.status === 'uploading').length;
    const failed = items.filter((item) => item.status === 'error').length;
    if (!uploaded && !uploading && !failed) return 'Sin archivos seleccionados';
    const parts = [];
    if (uploading) parts.push(`${uploading} subiendo`);
    if (uploaded) parts.push(`${uploaded} adjunto${uploaded === 1 ? '' : 's'} listo${uploaded === 1 ? '' : 's'}`);
    if (failed) parts.push(`${failed} con error`);
    return parts.join(' · ');
  };

  const createInvoiceUploadItem = (file) => ({
    id: makeId('invoice_upload'),
    file,
    fileKey: invoiceUploadFileKey(file),
    name: normalizeValue(file?.name) || 'Adjunto',
    status: 'uploading',
    url: '',
    error: ''
  });

  const createExistingInvoiceUploadItem = (url, index = 0) => ({
    id: makeId('invoice_existing'),
    file: null,
    fileKey: '',
    name: `Adjunto ${index + 1}`,
    status: 'done',
    url: normalizeValue(url),
    error: '',
    existing: true
  });

  const getInvoiceUploadItems = () => Array.isArray(state.editorDraft?.invoiceUploadItems)
    ? state.editorDraft.invoiceUploadItems
    : [];

  const setInvoiceUploadItems = (items = []) => {
    state.editorDraft.invoiceUploadItems = items;
    state.editorDraft.invoiceImageFiles = items
      .filter((item) => item.file && item.status !== 'done')
      .map((item) => item.file);
    state.editorDraft.invoiceImageCountLabel = invoiceUploadSummary(items);
  };

  const renderInvoiceUploadFeedbackHtml = (draft = state.editorDraft) => {
    const items = Array.isArray(draft?.invoiceUploadItems) ? draft.invoiceUploadItems : [];
    if (!items.length) {
      return escapeHtml(draft?.invoiceImageCountLabel || 'Sin archivos seleccionados');
    }
    return `<div class="inventario-file-upload-list">${items.map((item) => {
      const statusHtml = item.status === 'uploading'
        ? '<span class="inventario-file-upload-status is-uploading"><sl-spinner class="meta-spinner" aria-label="Subiendo"></sl-spinner><span>Subiendo</span></span>'
        : item.status === 'error'
          ? `<span class="inventario-file-upload-status is-error"><i class="fa-solid fa-circle-exclamation"></i><span>${escapeHtml(item.error || 'Error al subir')}</span></span>`
          : `<span class="inventario-file-upload-status is-done"><i class="fa-solid fa-circle-check"></i><span>${item.existing ? 'Cargado' : 'Subido'}</span></span>`;
      return `<span class="inventario-file-upload-row"><span class="inventario-file-upload-name">${escapeHtml(item.name || 'Adjunto')}</span><span class="inventario-file-upload-actions">${statusHtml}<sl-button variant="text" size="small" type="button" class="lj-icon-btn inventario-file-upload-remove" data-invoice-upload-remove="${escapeHtml(item.id)}" aria-label="Quitar adjunto" title="Quitar adjunto"><i class="fa-solid fa-xmark"></i></sl-button></span></span>`;
    }).join('')}</div>`;
  };

  const updateInvoiceUploadFeedback = () => {
    const feedback = nodes.editorForm?.querySelector('#inventoryInvoiceImageFeedback');
    if (feedback) feedback.innerHTML = renderInvoiceUploadFeedbackHtml();
  };

  const getInvoiceDraftImageUrls = () => {
    const seen = new Set();
    return getInvoiceUploadItems()
      .filter((item) => item.status === 'done' && normalizeValue(item.url))
      .map((item) => normalizeValue(item.url))
      .filter((url) => {
        if (seen.has(url)) return false;
        seen.add(url);
        return true;
      });
  };

  const uploadInvoiceDraftFiles = async (files = []) => {
    const selectedFiles = [...files].filter(Boolean);
    if (!selectedFiles.length) return true;
    const invalid = selectedFiles.map(validateInvoiceFile).find(Boolean);
    if (invalid) {
      await openIosSwal({ title: 'Adjunto inválido', html: `<p>${escapeHtml(invalid)}</p>`, icon: 'warning', confirmButtonText: 'Entendido' });
      return false;
    }
    const currentItems = getInvoiceUploadItems().filter((item) => item.status !== 'error');
    const knownKeys = new Set(currentItems.map((item) => item.fileKey).filter(Boolean));
    const newItems = selectedFiles
      .filter((file) => {
        const key = invoiceUploadFileKey(file);
        if (!key || knownKeys.has(key)) return false;
        knownKeys.add(key);
        return true;
      })
      .map(createInvoiceUploadItem);

    if (!newItems.length) {
      updateInvoiceUploadFeedback();
      return true;
    }

    const nextItems = [...currentItems, ...newItems];
    setInvoiceUploadItems(nextItems);
    updateInvoiceUploadFeedback();

    await Promise.all(newItems.map(async (item) => {
      let status = 'done';
      let url = '';
      let errorMessage = '';
      try {
        url = await uploadImageToStorage(item.file, 'inventario/facturas');
      } catch (error) {
        status = 'error';
        errorMessage = 'No se pudo subir';
      } finally {
        const liveItems = getInvoiceUploadItems();
        const liveItem = liveItems.find((current) => current.id === item.id);
        if (liveItem) {
          liveItem.url = url;
          liveItem.status = status;
          liveItem.file = null;
          liveItem.error = errorMessage;
          setInvoiceUploadItems(liveItems);
          updateInvoiceUploadFeedback();
        }
      }
    }));

    const newItemIds = new Set(newItems.map((item) => item.id));
    return !getInvoiceUploadItems().some((item) => newItemIds.has(item.id) && item.status === 'error');
  };

  const waitInvoiceDraftUploads = async () => {
    const legacyFiles = Array.isArray(state.editorDraft?.invoiceImageFiles) ? state.editorDraft.invoiceImageFiles : [];
    if (legacyFiles.length) {
      const uploadedLegacy = await uploadInvoiceDraftFiles(legacyFiles);
      if (!uploadedLegacy) throw new Error('No se pudieron subir todos los adjuntos.');
    }
    let guard = 0;
    while (getInvoiceUploadItems().some((item) => item.status === 'uploading') && guard < 400) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      guard += 1;
    }
    const failed = getInvoiceUploadItems().find((item) => item.status === 'error');
    if (failed) throw new Error(failed.error || 'No se pudieron subir todos los adjuntos.');
    if (getInvoiceUploadItems().some((item) => item.status === 'uploading')) {
      throw new Error('La subida de adjuntos sigue en curso.');
    }
    return getInvoiceDraftImageUrls();
  };

  const providerIdFromEntry = (entry) => resolveProvider(entry?.provider)?.id || '';

  const rerenderEditorKeepViewport = (ingredientId, draft, focusSelector = '') => {
    const modalBody = LJModal.body(inventarioModal);
    const scrollTop = modalBody?.scrollTop || 0;
    const active = focusSelector ? ljNativeInput(nodes.editorForm?.querySelector(focusSelector)) : null;
    const selStart = active && typeof active.selectionStart === 'number' ? active.selectionStart : null;
    const selEnd = active && typeof active.selectionEnd === 'number' ? active.selectionEnd : null;
    renderEditor(ingredientId, draft);
    requestAnimationFrame(() => {
      if (modalBody) {
        modalBody.scrollTop = scrollTop;
      }
      if (focusSelector) {
        const next = nodes.editorForm?.querySelector(focusSelector);
        next?.focus({ preventScroll: true });
        if (next && selStart != null && typeof next.setSelectionRange === 'function') {
          next.setSelectionRange(selStart, selEnd ?? selStart);
        }
      }
    });
  };

  const renderStatusFilters = () => {
    if (!nodes.statusFilters) return;
    const allIngredients = Object.values(state.ingredientes);
    const counts = {
      'status-empty': 0,
      'status-low': 0,
      'status-good': 0,
      'status-never': 0,
      expired: 0,
      expiring: 0
    };
    allIngredients.forEach((item) => {
      const record = getRecord(item.id);
      const statusClass = stockStatusFor(record, item.measure || 'kilos').className;
      counts[statusClass] = (counts[statusClass] || 0) + 1;
      if (getExpiredEntries(record).length) counts.expired += 1;
      if (getExpiringSoonEntries(record).length) counts.expiring += 1;
    });

    const statusOptions = [
      { key: 'all', label: 'Todos', tone: 'neutral', count: allIngredients.length, icon: 'fa-list' },
      { key: 'status-empty', label: 'Sin stock', tone: 'danger', count: counts['status-empty'], icon: 'fa-box-open' },
      { key: 'status-low', label: 'Stock bajo', tone: 'warning', count: counts['status-low'], icon: 'fa-arrow-trend-down' },
      { key: 'status-good', label: 'Con stock', tone: 'success', count: counts['status-good'], icon: 'fa-boxes-stacked' },
      { key: 'status-never', label: 'Nunca ingresó', tone: 'info', count: counts['status-never'], icon: 'fa-circle-question' }
    ];
    const dynamicOptions = [
      { key: 'expired', label: 'Vencidos', tone: 'danger', count: counts.expired, icon: 'fa-calendar-xmark' },
      { key: 'expiring', label: 'Por vencer', tone: 'warning', count: counts.expiring, icon: 'fa-hourglass-half' }
    ].filter((option) => option.count > 0);

    const chipTone = { danger: 'is-danger', warning: 'is-warning', success: 'is-success', info: 'is-info', neutral: '' };
    const renderOption = (option) => `<sl-button variant="default" size="small" type="button" class="recetas-chip inventario-status-btn ${chipTone[option.tone] || ''} ${state.activeStockStatus === option.key ? 'is-active' : ''}" data-inv-status-filter="${option.key}" ${option.count || option.key === 'all' ? '' : 'disabled'}><i slot="prefix" class="fa-solid ${option.icon}"></i>${option.label}<span slot="suffix" class="recetas-chip-count">${option.count}</span></sl-button>`;

    nodes.statusFilters.innerHTML = `${statusOptions.map(renderOption).join('')}${dynamicOptions.length ? '<span class="recetas-toolbar-divider inventario-status-divider" aria-hidden="true"></span>' : ''}${dynamicOptions.map(renderOption).join('')}`;
  };

  const renderAutoEgresoFilters = () => {
    if (!nodes.autoEgresoFilters) return;
    const allIngredients = Object.values(state.ingredientes);
    const counts = {
      all: allIngredients.length,
      enabled: allIngredients.filter(item => getRecord(item.id).weeklySheetConfig?.egresoEnabled).length,
      disabled: allIngredients.filter(item => !getRecord(item.id).weeklySheetConfig?.egresoEnabled).length
    };

    const options = [
      { key: 'all', label: 'Todos los productos', tone: 'neutral', count: counts.all, icon: 'fa-list' },
      { key: 'enabled', label: 'Con Autoegreso', tone: 'info', count: counts.enabled, icon: 'fa-robot' },
      { key: 'disabled', label: 'Sin Autoegreso', tone: 'neutral', count: counts.disabled, icon: 'fa-ban' }
    ];

    const renderOption = (option) => `
      <sl-button variant="default" size="small" type="button" class="inventario-status-btn tone-${option.tone} ${state.activeAutoEgresoFilter === option.key ? 'is-active' : ''}" data-inv-auto-egreso-filter="${option.key}">
        ${option.icon ? `<i slot="prefix" class="fa-solid ${option.icon}"></i>` : ''}
        <span>${option.label}</span>
        <strong>${option.count}</strong>
      </sl-button>`;

    nodes.autoEgresoFilters.innerHTML = options.map(renderOption).join('');
  };


  const getProviderRneCounts = () => {
    const providers = sortedProviders();
    return providers.reduce((acc, provider) => {
      const status = getProviderRneStatus(provider);
      acc.all += 1;
      if (status.key === 'none') acc.none += 1;
      if (status.key === 'warning') acc.warning += 1;
      if (status.key === 'danger') acc.danger += 1;
      return acc;
    }, { all: 0, none: 0, warning: 0, danger: 0 });
  };

  const renderProviderRneAlert = () => {
    const counts = getProviderRneCounts();
    const hasIssues = counts.none > 0 || counts.warning > 0 || counts.danger > 0;

    if (nodes.providersRneBtn) {
      nodes.providersRneBtn.innerHTML = `<i slot="prefix" class="fa-solid fa-file-shield"></i><span>RNE</span>${hasIssues ? `<strong slot="suffix" class="inventario-rne-alert-badge">${counts.none + counts.warning + counts.danger}</strong>` : ''}`;
    }

    if (!nodes.providersRneAlert || state.periodMode) {
      if (nodes.providersRneAlert) {
        nodes.providersRneAlert.classList.add('d-none');
        nodes.providersRneAlert.innerHTML = '';
      }
      return;
    }

    const providers = sortedProviders().map((provider) => {
      const expiryDate = normalizeValue(provider?.rne?.expiryDate);
      const remainingDays = getRneRemainingDays(expiryDate);
      if (!Number.isFinite(remainingDays) || remainingDays < 0 || remainingDays >= 180) {
        return null;
      }
      const tone = remainingDays < 90 ? 'danger' : 'warning';
      return {
        id: provider.id,
        name: provider.name,
        expiryDate,
        remainingDays,
        tone
      };
    }).filter(Boolean);

    const dangerRows = providers.filter((item) => item.tone === 'danger').sort((a, b) => a.remainingDays - b.remainingDays);
    const warningRows = providers.filter((item) => item.tone === 'warning').sort((a, b) => a.remainingDays - b.remainingDays);

    if (!dangerRows.length && !warningRows.length) {
      nodes.providersRneAlert.classList.add('d-none');
      nodes.providersRneAlert.innerHTML = '';
      return;
    }

    const rowHtml = (row, toneClass) => `<div class="inventario-rne-expiry-row ${toneClass}"><strong>${escapeHtml(row.name)}</strong><span>${escapeHtml(formatIsoDateEs(row.expiryDate))} · <strong>${row.remainingDays} día(s)</strong></span></div>`;

    const detailsCount = dangerRows.length + warningRows.length;

    const alertMessage = dangerRows.length ? 'Hay RNE críticos por vencer.' : 'Hay RNE próximos a vencer.';

    nodes.providersRneAlert.classList.remove('d-none');
    nodes.providersRneAlert.innerHTML = `<button type="button" class="lj-tile produccion-rne-expiry-alert ${dangerRows.length ? 'is-danger' : 'is-ok'} is-collapsible" data-rne-alert-toggle aria-expanded="false">
        <span class="produccion-rne-expiry-text"><sl-icon name="${dangerRows.length ? 'exclamation-octagon-fill' : 'exclamation-triangle-fill'}"></sl-icon><span>${alertMessage}</span></span>
        <span class="produccion-rne-expiry-collapse-meta"><strong>${detailsCount}</strong><i class="fa-solid fa-chevron-down" aria-hidden="true"></i></span>
      </button>
      <div class="inventario-rne-expiry-board" data-rne-alert-details hidden>
        ${dangerRows.length ? `<section class="inventario-rne-expiry-group"><h6><strong>Vencen en menos de 3 meses</strong></h6>${dangerRows.map((row) => rowHtml(row, 'is-danger')).join('')}</section>` : ''}
        ${warningRows.length ? `<section class="inventario-rne-expiry-group"><h6><strong>Vencen en menos de 6 meses</strong></h6>${warningRows.map((row) => rowHtml(row, 'is-warning')).join('')}</section>` : ''}
      </div>`;

    const toggleBtn = nodes.providersRneAlert.querySelector('[data-rne-alert-toggle]');
    const details = nodes.providersRneAlert.querySelector('[data-rne-alert-details]');
    toggleBtn?.addEventListener('click', () => {
      if (!details) return;
      const expanded = toggleBtn.getAttribute('aria-expanded') === 'true';
      toggleBtn.setAttribute('aria-expanded', expanded ? 'false' : 'true');
      details.hidden = expanded;
      toggleBtn.classList.toggle('is-open', !expanded);
    });
  };

  const getInventoryExpiryAlertRows = () => {
    const rows = [];
    Object.values(state.ingredientes).forEach((ingredient) => {
      const record = getRecord(ingredient.id);
      if (isInfiniteStockRecord(record)) return;
      const collect = (items, type) => {
        items.forEach((item) => {
          const sourceEntry = (Array.isArray(record.entries) ? record.entries : []).find((entry) => normalizeValue(entry.id) === normalizeValue(item.entryId));
          const availableKg = Number(getAvailableKg(sourceEntry || item).toFixed(4));
          rows.push({
            id: `${ingredient.id}::${item.entryId}`,
            ingredientId: ingredient.id,
            entryId: item.entryId,
            ingredientName: capitalize(ingredient.name),
            imageUrl: normalizeValue(ingredient.imageUrl),
            lotNumber: normalizeValue(item.lotNumber),
            expiryDate: normalizeValue(item.expiryDate),
            diffDays: Number(item.diffDays || 0),
            qty: Number(item.qty || 0),
            unit: normalizeValue(item.unit || record.stockUnit || ingredient.measure || 'kilos'),
            packageQty: item.packageQty,
            availableKg,
            expired: type === 'expired'
          });
        });
      };
      collect(getExpiredEntries(record), 'expired');
      collect(getExpiringSoonEntries(record), 'soon');
    });
    return rows.sort((a, b) => (a.expired === b.expired ? a.diffDays - b.diffDays : (a.expired ? -1 : 1)) || a.ingredientName.localeCompare(b.ingredientName, 'es'));
  };

  const inventoryExpiryWhenLabel = (row) => row.expired
    ? `Expirado hace ${Math.abs(row.diffDays)} dia(s)`
    : (row.diffDays === 0 ? 'Vence hoy' : `Vence en ${row.diffDays} dia(s)`);

  const askInventoryExpiryResolutionType = async (count = 1) => {
    const result = await openIosSwal({
      title: count > 1 ? 'Resolver vencidos seleccionados' : 'Resolver lote vencido',
      html: '<p>Elegi como queres resolver el stock vencido.</p><small>Se creara el movimiento en el historial del ingreso y se descontara el stock disponible.</small>',
      icon: 'warning',
      showCancelButton: true,
      showDenyButton: true,
      confirmButtonText: 'Venta en mostrador',
      denyButtonText: 'Decomisado',
      cancelButtonText: 'Cancelar',
      customClass: {
        popup: 'expiry-resolution-alert',
        confirmButton: 'ios-btn-success',
        denyButton: 'ios-btn-danger',
        cancelButton: 'ios-btn-secondary'
      }
    });
    if (result.isConfirmed) return 'sold_counter';
    if (result.isDenied) return 'decommissioned';
    return '';
  };

  const resolveInventoryExpiryRows = async (rows = [], resolutionType = '') => {
    const targets = (Array.isArray(rows) ? rows : []).filter((row) => row?.expired && normalizeValue(row.ingredientId) && normalizeValue(row.entryId));
    if (!targets.length || !normalizeValue(resolutionType)) return 0;
    state.inventoryExpiryExpanded = true;
    Swal.fire({
      title: 'Resolviendo vencidos...',
      html: '<div class="informes-saving-spinner"><sl-spinner class="meta-spinner-login" aria-label="Resolviendo"></sl-spinner></div>',
      allowOutsideClick: false,
      showConfirmButton: false,
      customClass: { popup: 'ios-alert ingredientes-alert ingredientes-saving-alert' }
    });
    let resolved = 0;
    let failureMessage = '';
    try {
      for (const row of targets) {
        await ensureInventoryRecordDetail(row.ingredientId);
        const record = getRecord(row.ingredientId);
        const entry = (Array.isArray(record.entries) ? record.entries : [])
          .find((item) => normalizeValue(item.id) === normalizeValue(row.entryId));
        const actualAvailableKg = getAvailableKg(entry);
        const result = await resolveExpiredEntryStock({
          ingredientId: row.ingredientId,
          entryId: row.entryId,
          resolutionType,
          qtyKg: actualAvailableKg
        });
        if (result?.ok) resolved += 1;
        else if (!failureMessage) failureMessage = normalizeValue(result?.message) || 'No se pudo resolver el lote vencido.';
      }
      state.activeFamilyId = 'all';
      state.activeStockStatus = 'all';
      state.search = '';
      if (nodes.searchInput) nodes.searchInput.value = '';
      await loadData();
      renderFamilies();
      renderStatusFilters();
      renderList();
      renderInventoryExpiryAlert();
      if (!resolved && failureMessage) {
        await openIosSwal({ title: 'No se pudo resolver', html: `<p>${escapeHtml(failureMessage)}</p>`, icon: 'error', confirmButtonText: 'Entendido' });
      }
      return resolved;
    } finally {
      if (Swal.isVisible()) Swal.close();
    }
  };

  const renderInventoryExpiryAlert = () => {
    if (!nodes.expiryAlert) return;
    if (state.periodMode) {
      nodes.expiryAlert.classList.add('d-none');
      nodes.expiryAlert.innerHTML = '';
      state.inventoryExpiryExpanded = false;
      return;
    }
    const rows = getInventoryExpiryAlertRows();
    if (!rows.length) {
      nodes.expiryAlert.classList.add('d-none');
      nodes.expiryAlert.innerHTML = '';
      state.inventoryExpiryExpanded = false;
      return;
    }
    const expiredRows = rows.filter((row) => row.expired);
    const soonRows = rows.filter((row) => !row.expired);
    const tone = expiredRows.length ? 'is-danger' : 'is-warning';
    const expanded = Boolean(state.inventoryExpiryExpanded);
    const title = expiredRows.length
      ? `${expiredRows.length} lote(s) de inventario vencido(s) con stock`
      : `${soonRows.length} lote(s) de inventario proximo(s) a vencer`;
    const rowHtml = rows.map((row) => `<div class="produccion-expiry-row ${row.expired ? 'is-expired' : 'is-soon'}">
      <sl-checkbox class="produccion-expiry-select" data-inventory-expiry-select="${escapeHtml(row.id)}" ${row.expired ? '' : 'disabled'}><span class="visually-hidden">Seleccionar lote</span></sl-checkbox>
      <span class="produccion-expiry-thumb">${row.imageUrl ? `<img src="${(window.ljThumb || String)(escapeHtml(row.imageUrl))}" alt="${escapeHtml(row.ingredientName)}">` : '<i class="fa-solid fa-carrot"></i>'}</span>
      <span class="produccion-expiry-info"><strong>${escapeHtml(row.ingredientName)}</strong><small>Lote ${escapeHtml(row.lotNumber || row.entryId)} · ${escapeHtml(inventoryExpiryWhenLabel(row))} · ${escapeHtml(formatIsoDateEs(row.expiryDate))}</small></span>
      <span class="produccion-expiry-qty">${escapeHtml(formatQtyUnit(row.qty, row.unit))}${row.packageQty ? ` x${row.packageQty}` : ''}</span>
      ${row.expired ? `<sl-button variant="danger" size="small" type="button" class="inventario-threshold-btn" data-inventory-expiry-resolve-one="${escapeHtml(row.id)}"><i slot="prefix" class="fa-solid fa-check"></i><span>Resolver</span></sl-button>` : ''}
    </div>`).join('');
    nodes.expiryAlert.classList.remove('d-none');
    nodes.expiryAlert.innerHTML = `<section class="produccion-expiry-alert-card ${tone} ${expanded ? 'is-expanded' : ''}" data-inventory-expiry-alert>
      <button type="button" class="lj-tile produccion-rne-expiry-alert ${tone} is-collapsible ${expanded ? 'is-open' : ''}" data-inventory-expiry-toggle aria-expanded="${expanded ? 'true' : 'false'}">
        <span class="produccion-rne-expiry-text"><sl-icon name="${expiredRows.length ? 'exclamation-octagon-fill' : 'exclamation-triangle-fill'}"></sl-icon><span>${escapeHtml(title)}</span></span>
        <span class="produccion-rne-expiry-collapse-meta"><strong>${rows.length}</strong><i class="fa-solid fa-chevron-${expanded ? 'up' : 'down'}" aria-hidden="true"></i></span>
      </button>
      <div class="produccion-expiry-alert-details" data-inventory-expiry-details ${expanded ? '' : 'hidden'}>
        <div class="produccion-expiry-toolbar">
          <sl-button variant="default" size="small" type="button" class="inventario-threshold-btn" data-inventory-expiry-config><i slot="prefix" class="fa-solid fa-sliders"></i><span>Configurar dias</span></sl-button>
          <sl-button variant="default" size="small" type="button" class="inventario-threshold-btn" data-inventory-expiry-select-all ${expiredRows.length ? '' : 'disabled'}><i slot="prefix" class="fa-regular fa-square-check"></i><span>Seleccionar vencidos</span></sl-button>
          <sl-button variant="danger" size="small" type="button" class="inventario-threshold-btn" data-inventory-expiry-resolve-selected ${expiredRows.length ? '' : 'disabled'}><i slot="prefix" class="fa-solid fa-list-check"></i><span>Resolver seleccionados</span></sl-button>
          <sl-button variant="danger" size="small" type="button" class="inventario-threshold-btn" data-inventory-expiry-resolve-all ${expiredRows.length ? '' : 'disabled'}><i slot="prefix" class="fa-solid fa-check-double"></i><span>Resolver todos</span></sl-button>
        </div>
        <div class="produccion-expiry-list">${rowHtml}</div>
      </div>
    </section>`;

    const toggle = nodes.expiryAlert.querySelector('[data-inventory-expiry-toggle]');
    const details = nodes.expiryAlert.querySelector('[data-inventory-expiry-details]');
    const cardEl = nodes.expiryAlert.querySelector('[data-inventory-expiry-alert]');
    toggle?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const wasExpanded = toggle.getAttribute('aria-expanded') === 'true';
      const nextExpanded = !wasExpanded;
      state.inventoryExpiryExpanded = nextExpanded;
      toggle.setAttribute('aria-expanded', nextExpanded ? 'true' : 'false');
      details.hidden = !nextExpanded;
      toggle.classList.toggle('is-open', nextExpanded);
      const icon = toggle.querySelector('.produccion-rne-expiry-collapse-meta i');
      icon?.classList.toggle('fa-chevron-down', !nextExpanded);
      icon?.classList.toggle('fa-chevron-up', nextExpanded);
      // Sólo mostramos el "card frame" alrededor cuando está expandido,
      // así colapsado el alert no parece un div dentro de otro div.
      cardEl?.classList.toggle('is-expanded', nextExpanded);
    });
    nodes.expiryAlert.querySelector('[data-inventory-expiry-config]')?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openGlobalConfig();
    });
    nodes.expiryAlert.querySelector('[data-inventory-expiry-select-all]')?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      state.inventoryExpiryExpanded = true;
      nodes.expiryAlert.querySelectorAll('sl-checkbox[data-inventory-expiry-select]').forEach((checkbox) => {
        if (!checkbox.disabled) checkbox.checked = true;
      });
    });
    const resolveRowsFromAlert = async (mode, id = '', sourceElement = nodes.expiryAlert) => {
      const latest = getInventoryExpiryAlertRows().filter((row) => row.expired);
      const scope = sourceElement?.closest?.('[data-inventory-expiry-alert]') || nodes.expiryAlert;
      const selected = new Set([...scope.querySelectorAll('sl-checkbox[data-inventory-expiry-select]')].filter((node) => node.checked).map((node) => normalizeValue(node.dataset.inventoryExpirySelect)));
      const targets = mode === 'all' ? latest : mode === 'one' ? latest.filter((row) => row.id === id) : latest.filter((row) => selected.has(row.id));
      if (!targets.length) {
        await openIosSwal({ title: 'Sin seleccion', html: '<p>Selecciona al menos un lote vencido para resolver.</p>', icon: 'info' });
        return;
      }
      const resolutionType = await askInventoryExpiryResolutionType(targets.length);
      if (!resolutionType) return;
      state.inventoryExpiryExpanded = true;
      await resolveInventoryExpiryRows(targets, resolutionType);
    };
    nodes.expiryAlert.querySelector('[data-inventory-expiry-resolve-selected]')?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      resolveRowsFromAlert('selected', '', event.currentTarget);
    });
    nodes.expiryAlert.querySelector('[data-inventory-expiry-resolve-all]')?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      resolveRowsFromAlert('all', '', event.currentTarget);
    });
    nodes.expiryAlert.querySelectorAll('[data-inventory-expiry-resolve-one]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        resolveRowsFromAlert('one', normalizeValue(button.dataset.inventoryExpiryResolveOne), event.currentTarget);
      });
    });
  };


  // Filtro de familias: select con contador (mismo patrón que "Grupos" en Recetas).
  const renderFamilies = () => {
    if (!nodes.families) return;
    if (state.periodMode) {
      nodes.families.innerHTML = '';
      nodes.families.hidden = true;
      return;
    }
    nodes.families.hidden = false;
    const families = Object.values(state.familias).sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    const ingredientCounts = Object.values(state.ingredientes).reduce((acc, item) => {
      const familyId = normalizeValue(item?.familyId);
      if (!familyId) return acc;
      acc[familyId] = Number(acc[familyId] || 0) + 1;
      return acc;
    }, {});
    const total = Object.keys(state.ingredientes).length;
    const optionValue = (raw) => (window.ljOptionValue ? window.ljOptionValue(raw) : raw);
    const options = [`<sl-option value="${optionValue('all')}">Todas las familias<span slot="suffix" class="recetas-chip-count">${total}</span></sl-option>`]
      .concat(families.map((family) => `<sl-option value="${optionValue(family.id)}">${escapeHtml(capitalize(family.name))}<span slot="suffix" class="recetas-chip-count">${Number(ingredientCounts[family.id] || 0)}</span></sl-option>`));
    nodes.families.innerHTML = `<sl-select class="recetas-group-select inventario-family-select" data-inv-family-select hoist aria-label="Filtrar por familia"><i slot="prefix" class="fa-solid fa-carrot"></i>${options.join('')}</sl-select>`;
    const select = nodes.families.querySelector('[data-inv-family-select]');
    const active = state.activeFamilyId !== 'all' && !state.familias?.[state.activeFamilyId] ? 'all' : state.activeFamilyId;
    if (window.ljSetSelectValue) window.ljSetSelectValue(select, active || 'all');
    else select.value = active || 'all';
  };

  // ---------- Maestro-detalle (lista + ficha), mismo patrón que Recetas ----------
  const INV_TONE_BY_STATUS = { 'status-empty': 'bad', 'status-low': 'warn', 'status-good': 'ok', 'status-never': 'neu', 'status-expired': 'bad' };

  // Datos de stock/vencimientos de un ingrediente para la fila y la ficha.
  const inventorySummaryFor = (item) => {
    const record = getRecord(item.id);
    const infiniteStock = isInfiniteStockRecord(record);
    const status = stockStatusFor(record, item.measure || 'kilos');
    const stockUnit = record.stockUnit || item.measure || 'kilos';
    const stockBase = Number(record.stockBase || toBase(record.stockKg || 0, stockUnit)) || 0;
    const stockQty = fromBase(stockBase, stockUnit);
    const thresholdQty = fromBase(currentThresholdFor(record, stockUnit), stockUnit);
    const packageSuffix = Number(record.packageQty) > 0 ? ` x${Number(record.packageQty)}` : '';
    const expiredRows = infiniteStock ? [] : getExpiredEntries(record);
    const expiringRows = infiniteStock ? [] : getExpiringSoonEntries(record);
    const expiredQty = fromBase(expiredRows.reduce((acc, entry) => acc + toBase(entry.qty, entry.unit), 0), stockUnit);
    const realQty = Math.max(0, stockQty - expiredQty);
    const hasExpiredStock = expiredQty > 0.0001;
    const allStockExpired = hasExpiredStock && realQty <= 0.0001;
    const effectiveStatus = allStockExpired
      ? { label: 'Stock vencido', className: 'status-expired' }
      : (hasExpiredStock ? { label: `${status.label} · con vencidos`, className: `${status.className} has-expired` } : status);
    const tone = infiniteStock ? 'ok' : (allStockExpired ? 'bad' : (INV_TONE_BY_STATUS[status.className] || 'neu'));
    const shortLabel = infiniteStock
      ? 'Infinito'
      : (allStockExpired ? 'Vencido' : ({ 'status-empty': 'Sin stock', 'status-low': 'Stock bajo', 'status-good': 'En stock', 'status-never': 'Sin ingresos' }[status.className] || status.label));
    // Los records de /inventario_index vienen sin lotes: sólo hay entries reales tras leer el detalle.
    const detailLoaded = Boolean(state.fullInventoryLoaded || state.inventoryDetailLoaded?.[item.id]);
    const entries = detailLoaded && Array.isArray(record.entries) ? record.entries : null;
    return { record, entries, detailLoaded, infiniteStock, status, effectiveStatus, stockUnit, stockQty, thresholdQty, packageSuffix, expiredRows, expiringRows, expiredQty, realQty, hasExpiredStock, tone, shortLabel, abbr: getMeasureAbbr(stockUnit) };
  };

  const invListRowHtml = (item, on) => {
    const info = inventorySummaryFor(item);
    const stockText = info.infiniteStock ? 'Stock infinito' : `${info.stockQty.toFixed(2)} ${info.abbr}${info.packageSuffix}`;
    const sub = [capitalize(item.familyName || 'Sin familia'), stockText].join(' · ');
    const expiredFlag = info.expiredRows.length && info.tone !== 'bad'
      ? '<span class="recetas-tag tone-bad" title="Tiene lotes vencidos con stock" aria-label="Tiene lotes vencidos con stock"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i></span>'
      : '';
    return `<button type="button" class="lj-tile recetas-item inv-md-item ${on ? 'is-active' : ''}" role="option" aria-selected="${on}" tabindex="${on ? 0 : -1}" data-inv-select="${escapeHtml(item.id)}">
        ${ingredientAvatar(item)}
        <span class="recetas-item-copy"><strong title="${escapeHtml(capitalize(item.name))}">${escapeHtml(capitalize(item.name))}</strong><small title="${escapeHtml(sub)}">${escapeHtml(sub)}</small></span>
        <span class="md-item-tags"><span class="recetas-tag tone-${info.tone}">${escapeHtml(info.shortLabel)}</span>${expiredFlag}</span>
      </button>`;
  };

  const invNextExpiry = (info) => {
    const entries = info.entries || [];
    const candidates = entries.length
      ? entries
        .filter((entry) => !isEntryNoPerecedero(entry) && getAvailableQty(entry) > 0 && normalizeIsoDate(entry.expiryDate))
        .map((entry) => normalizeIsoDate(entry.expiryDate))
      : [...info.expiredRows, ...info.expiringRows].map((row) => normalizeIsoDate(row.expiryDate)).filter(Boolean);
    if (!candidates.length) return { value: '-', note: entries.length ? 'Sin lotes perecederos' : '', tone: 'neu' };
    const next = candidates.sort()[0];
    const todayIso = getArgentinaIsoDate();
    const diff = Math.round((new Date(`${next}T00:00:00`).getTime() - new Date(`${todayIso}T00:00:00`).getTime()) / 86400000);
    const tone = diff < 0 ? 'bad' : (diff <= currentExpiringDaysFor(info.record) ? 'warn' : 'ok');
    const note = diff < 0 ? `Venció hace ${Math.abs(diff)} día(s)` : (diff === 0 ? 'Vence hoy' : `En ${diff} día(s)`);
    return { value: formatIsoDateEs(next), note, tone };
  };

  const invLotsTableHtml = (info) => {
    const entries = info.entries;
    if (!entries) return '<p class="recetas-detail-empty-text inv-md-loading-lots"><sl-spinner aria-label="Cargando lotes"></sl-spinner><span>Cargando lotes...</span></p>';
    const rows = entries
      .filter((entry) => getAvailableQty(entry) > 0.0001)
      .sort((a, b) => String(normalizeIsoDate(a.expiryDate) || '9999').localeCompare(String(normalizeIsoDate(b.expiryDate) || '9999')));
    if (!rows.length) return '<p class="recetas-detail-empty-text">No hay lotes con stock disponible.</p>';
    const todayIso = getArgentinaIsoDate();
    return `<div class="recetas-detail-table-wrap inv-md-table-wrap"><table class="recetas-detail-table">
      <thead><tr><th>Ingreso</th><th>Lote</th><th>Proveedor</th><th class="is-num">Disponible</th><th>Vencimiento</th></tr></thead>
      <tbody>${rows.map((entry) => {
        const expiry = normalizeIsoDate(entry.expiryDate);
        const noPer = isEntryNoPerecedero(entry);
        const expired = !noPer && expiry && expiry < todayIso;
        const frozen = Boolean(entry.isFrozen || entry.frozen);
        const expiryCell = noPer
          ? '<span class="recetas-tag tone-neu">No perecedero</span>'
          : `${escapeHtml(expiry ? formatIsoDateEs(expiry) : '-')}${expired ? ' <span class="recetas-tag tone-bad">Vencido</span>' : ''}${frozen ? ' <span class="recetas-tag tone-info"><sl-icon name="snow2"></sl-icon>Congelado</span>' : ''}`;
        return `<tr class="${expired ? 'is-expired' : ''}">
          <td>${escapeHtml(formatIsoDateEs(normalizeIsoDate(entry.entryDate)) || '-')}</td>
          <td>${escapeHtml(normalizeValue(entry.lotNumber) || normalizeValue(entry.invoiceNumber) || '-')}</td>
          <td>${escapeHtml(providerLabel(entry.provider) || '-')}</td>
          <td class="is-num">${escapeHtml(formatQtyUnit(getAvailableQty(entry), entry.unit))}</td>
          <td>${expiryCell}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;
  };

  const invDetailNode = () => nodes.list?.querySelector('.inv-md-detail');
  const invListNode = () => nodes.list?.querySelector('.inv-md-list');
  const isInvMobileLayout = () => window.matchMedia('(max-width: 767.98px)').matches;
  const setInvDetailOpen = (open) => {
    state.invDetailOpen = Boolean(open);
    nodes.list?.classList.toggle('is-detail-open', state.invDetailOpen);
  };

  const renderInvDetail = (item) => {
    const host = invDetailNode();
    if (!host) return;
    if (!item) {
      host.innerHTML = '<div class="recetas-detail-empty"><i class="fa-solid fa-boxes-stacked" aria-hidden="true"></i><p>Elegí un ingrediente de la lista para ver su stock.</p></div>';
      return;
    }
    const info = inventorySummaryFor(item);
    const thresholdMode = normalizeValue(info.record.lowThresholdMode) === 'custom' ? 'personalizado' : 'global';
    const next = invNextExpiry(info);
    const { entries } = info;
    const lotsWithStock = entries ? entries.filter((entry) => getAvailableQty(entry) > 0.0001).length : null;
    const stockTone = info.stockQty <= 0.0001 ? 'bad' : (info.status.className === 'status-low' ? 'warn' : 'ok');
    const stockValue = `${info.hasExpiredStock ? `<s>${info.stockQty.toFixed(2)}</s>` : info.stockQty.toFixed(2)} ${escapeHtml(info.abbr)}${escapeHtml(info.packageSuffix)}`;
    const stockKpi = info.infiniteStock
      ? '<b class="tone-ok">Infinito</b><small>Sin control manual</small>'
      : `<b class="tone-${stockTone}">${stockValue}</b>${info.hasExpiredStock ? `<small>Real ${info.realQty.toFixed(2)} ${escapeHtml(info.abbr)} sin vencidos</small>` : ''}`;
    const expiredCount = info.expiredRows.length;
    const expiredBanner = expiredCount
      ? `<div class="inventario-card-expired-banner inv-md-expired"><div class="inventario-card-expired-banner-text"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i><span><strong>${expiredCount}</strong> lote${expiredCount === 1 ? '' : 's'} vencido${expiredCount === 1 ? '' : 's'} con stock (${info.expiredQty.toFixed(2)} ${escapeHtml(info.abbr)})</span></div><sl-button variant="danger" size="small" type="button" data-inventario-resolve-expired="${item.id}"><i slot="prefix" class="fa-solid fa-check"></i>Resolver vencidos</sl-button></div>`
      : '';
    const soonRows = info.expiringRows;
    const soonHtml = soonRows.length
      ? `<section class="recetas-detail-section">
        <h6 class="recetas-detail-title"><i class="fa-solid fa-hourglass-half" aria-hidden="true"></i>Por vencer</h6>
        <div class="inventario-expiring-list">${soonRows.map((entry) => `<p class="inventario-expiring-line is-soon"><strong>${escapeHtml(formatQtyUnit(entry.qty, entry.unit))}${entry.packageQty ? ` x${entry.packageQty}` : ''}</strong><span>Vence en ${entry.diffDays} día(s)${entry.lotNumber ? ` · lote ${escapeHtml(entry.lotNumber)}` : ''}${entry.expiryDate ? ` · ${escapeHtml(formatIsoDateEs(entry.expiryDate))}` : ''}</span></p>`).join('')}</div>
      </section>`
      : '';
    host.innerHTML = `
      <div class="recetas-detail-mobilebar">
        <sl-button variant="default" size="small" type="button" data-inv-detail-back><i slot="prefix" class="fa-solid fa-arrow-left"></i>Volver</sl-button>
      </div>
      <header class="recetas-detail-head">
        <span class="inv-md-avatar-lg">${ingredientAvatar(item)}</span>
        <div class="recetas-detail-titles">
          <h6 class="recetas-detail-name">${escapeHtml(capitalize(item.name))}</h6>
          <p class="recetas-detail-group"><i class="fa-solid fa-carrot" aria-hidden="true"></i>${escapeHtml(capitalize(item.familyName || 'Sin familia'))} · ${escapeHtml(getMeasureLabel(item.measure || 'kilos'))}</p>
          <p class="inv-md-chips">
            <span class="recetas-tag tone-${info.tone}">${escapeHtml(info.effectiveStatus.label)}</span>
            ${recordHasFrozenEntries(info.record) ? '<span class="recetas-tag tone-info" title="Tiene lotes congelados"><sl-icon name="snow2"></sl-icon>Congelado</span>' : ''}
          </p>
        </div>
        <div class="recetas-detail-tools">
          <sl-button variant="success" size="small" type="button" data-inventario-open-editor="${item.id}" ${info.infiniteStock ? 'disabled title="Stock infinito sin carga manual"' : ''}><i slot="prefix" class="fa-solid fa-plus"></i>Ingresar stock</sl-button>
          <sl-button variant="default" size="small" type="button" data-inventario-open-editor="${item.id}"><i slot="prefix" class="fa-regular fa-eye"></i>Historial</sl-button>
          <sl-button variant="default" size="small" type="button" class="lj-icon-btn" data-inventario-config-item="${item.id}" title="Configurar umbral" aria-label="Configurar umbral"><i class="fa-solid fa-sliders"></i></sl-button>
        </div>
      </header>

      <div class="recetas-kpis">
        <div class="recetas-kpi"><span>Stock disponible</span>${stockKpi}</div>
        <div class="recetas-kpi"><span>Umbral ${thresholdMode}</span><b>${info.infiniteStock ? '-' : `${info.thresholdQty.toFixed(2)} ${escapeHtml(info.abbr)}`}</b></div>
        <div class="recetas-kpi"><span>Lotes con stock</span><b>${lotsWithStock == null ? '-' : lotsWithStock}</b><small>${Number(entries ? entries.length : (info.record.entriesCount || 0))} ingreso(s) en total</small></div>
        <div class="recetas-kpi"><span>Próximo vencimiento</span><b class="tone-${next.tone}">${escapeHtml(next.value)}</b>${next.note ? `<small>${escapeHtml(next.note)}</small>` : ''}</div>
      </div>

      ${expiredBanner}
      ${info.infiniteStock ? infiniteStockNoticeHtml() : ''}
      ${soonHtml}

      ${info.infiniteStock ? '' : `<section class="recetas-detail-section">
        <h6 class="recetas-detail-title"><i class="fa-solid fa-boxes-stacked" aria-hidden="true"></i>Lotes con stock</h6>
        ${invLotsTableHtml(info)}
      </section>`}

      ${item.description ? `<section class="recetas-detail-section">
        <h6 class="recetas-detail-title"><i class="fa-solid fa-align-left" aria-hidden="true"></i>Descripción</h6>
        <p class="recetas-detail-text">${escapeHtml(sentenceCase(item.description))}</p>
      </section>` : ''}`;
    initThumbLoading(host);
    // La lista viene "lite" (sin lotes): traemos sólo el detalle de este ingrediente.
    if (!entries && !info.infiniteStock) {
      const id = item.id;
      ensureInventoryRecordDetail(id).then(() => {
        if (state.invSelectedId !== id || state.view !== 'list') return;
        if (!state.inventoryDetailLoaded[id]) state.inventoryDetailLoaded[id] = true;
        renderInvDetail(state.ingredientes[id]);
        const row = invListNode()?.querySelector(`[data-inv-select="${CSS.escape(id)}"]`);
        if (row) {
          row.outerHTML = invListRowHtml(state.ingredientes[id], true);
          initThumbLoading(invListNode() || document);
        }
      });
    }
  };

  const selectInvItem = (ingredientId, options = {}) => {
    const id = normalizeValue(ingredientId);
    if (!id || !state.ingredientes[id]) return;
    state.invSelectedId = id;
    invListNode()?.querySelectorAll('[data-inv-select]').forEach((node) => {
      const on = node.dataset.invSelect === id;
      node.classList.toggle('is-active', on);
      node.setAttribute('aria-selected', on ? 'true' : 'false');
      node.tabIndex = on ? 0 : -1;
    });
    renderInvDetail(state.ingredientes[id]);
    invDetailNode()?.scrollTo?.({ top: 0 });
    if (options.openDetail && isInvMobileLayout()) {
      setInvDetailOpen(true);
      LJModal.body(inventarioModal)?.scrollTo({ top: 0 });
    }
    if (options.focus) invListNode()?.querySelector(`[data-inv-select="${CSS.escape(id)}"]`)?.focus();
  };

  const renderList = () => {
    renderStatusFilters();
    renderAutoEgresoFilters();
    renderProviderRneAlert();
    renderInventoryExpiryAlert();
    const items = filteredIngredients();
    let visibleItems = items;
    let helperHtml = '';
    if (!items.length && state.search) {
      const outsideMatches = Object.values(state.ingredientes).filter((item) => {
        const text = [item.name, item.description, item.familyName, item.measure].map(normalizeLower).join(' ');
        return text.includes(state.search);
      });
      if (outsideMatches.length) {
        visibleItems = outsideMatches.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
        helperHtml = '<div class="recetas-list-helper"><p>No hay resultados con los filtros actuales.</p><sl-button variant="default" size="small" type="button" data-inv-search-all><sl-icon slot="prefix" name="lightning-charge"></sl-icon>Buscar en toda la base</sl-button><small>Coincidencias <strong>fuera del filtro</strong> seleccionado</small></div>';
      }
    }
    if (!nodes.list.querySelector('.inv-md-list')) {
      nodes.list.innerHTML = '<div class="recetas-list inv-md-list" role="listbox" aria-label="Ingredientes del inventario"></div><section class="recetas-detail inv-md-detail" aria-live="polite"></section>';
    }
    const listNode = invListNode();
    if (!visibleItems.length) {
      listNode.innerHTML = '<div class="recetas-list-empty">No encontramos ingredientes con ese filtro.</div>';
      state.invSelectedId = '';
      setInvDetailOpen(false);
      renderInvDetail(null);
      if (state.periodMode) renderGlobalPeriodTable();
      return;
    }
    if (!visibleItems.some((item) => item.id === state.invSelectedId)) {
      state.invSelectedId = visibleItems[0].id;
      setInvDetailOpen(false);
    }
    listNode.innerHTML = helperHtml + visibleItems.map((item) => invListRowHtml(item, item.id === state.invSelectedId)).join('');
    initThumbLoading(listNode);
    setInvDetailOpen(state.invDetailOpen);
    renderInvDetail(state.ingredientes[state.invSelectedId]);
    if (state.periodMode) renderGlobalPeriodTable();
  };

  const parseRangeValue = (value) => {
    const raw = normalizeValue(value);
    if (!raw) return { from: '', to: '' };
    const parts = raw.split(/\s+to\s+|\s+a\s+/i).map((item) => normalizeValue(item));
    return {
      from: parts[0] || '',
      to: parts[1] || parts[0] || ''
    };
  };

  const getDefaultRangeDates = (value) => {
    const { from, to } = parseRangeValue(value);
    if (from && to) return [from, to];
    if (from) return [from];
    return null;
  };

  const getGlobalFilteredEntries = (ignoreRange = false) => {
    const range = parseRangeValue(state.dashboardDateRange);
    const rows = [];
    Object.values(state.ingredientes).forEach((ingredient) => {
      const record = getRecord(ingredient.id);
      periodEntriesFor(ingredient.id).forEach((entry) => {
        if (!ignoreRange && (range.from || range.to) && !inDateRange(entry.entryDate, range.from, range.to)) return;
        rows.push({
          ingredientId: ingredient.id,
          ingredientName: capitalize(ingredient.name),
          ingredientDescription: sentenceCase(ingredient.description || 'Sin descripción'),
          ingredientImageUrl: ingredient.imageUrl || '',
          entryDate: entry.entryDate || '-',
          entryDateTime: formatEntryDateTime(entry.entryDate, entry.createdAt),
          createdAt: entry.createdAt,
          expiryDate: entry.expiryDate || '',
          noPerecedero: Boolean(entry.noPerecedero),
          usoInternoEmpresa: Boolean(entry.usoInternoEmpresa),
          isFrozen: Boolean(entry.isFrozen || entry.frozen),
          frozenAt: normalizeValue(entry.frozenAt) || '',
          qtyKg: Number(entry.qtyKg || 0),
          qty: Number(entry.qty || 0),
          availableKg: getAvailableKg(entry),
          availableQty: getAvailableQty(entry),
          packageQty: Number(entry.packageQty || record.packageQty || 0) || null,
          productionUsage: getEntryUsages(entry),
          entryId: entry.id,
          unit: entry.unit || '',
          invoiceNumber: entry.invoiceNumber || '-',
          remitoNumber: normalizeValue(entry.remitoNumber),
          lotNumber: normalizeValue(entry.lotNumber),
          customLot: normalizeValue(entry.customLot),
          provider: providerLabel(entry.provider),
          invoiceImageUrls: entryImageUrls(entry),
          invoiceImageUrl: entryImageUrls(entry)[0] || '',
          expiryResolutions: Array.isArray(entry.expiryResolutions) ? entry.expiryResolutions : [],
          expiryResolutionStatus: normalizeValue(entry.expiryResolutionStatus),
          status: normalizeValue(entry.status),
          isLite: Boolean(entry.__lite),
          liteUsageCount: entry.__lite ? Number(entry.__usageCount || 0) : 0
        });
      });
    });
    return rows.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  };

  const getDayKgMap = (entries) => entries.reduce((acc, entry) => {
    const key = String(entry.entryDate || '');
    acc[key] = Number(acc[key] || 0) + (Number(entry.qtyKg) || 0);
    return acc;
  }, {});

  const getDaySummaryMap = (entries) => entries.reduce((acc, entry) => {
    const key = String(entry.entryDate || '');
    if (!key) return acc;
    acc[key] = acc[key] || { kg: 0, units: 0 };
    const meta = getUnitMeta(entry.unit);
    if (meta.category === 'peso') {
      acc[key].kg += Number(entry.qtyKg || 0);
    } else {
      acc[key].units += Number(entry.qty || 0);
    }
    return acc;
  }, {});

  const formatUsageAmount = (kilosUsed) => {
    const kg = Number(kilosUsed || 0);
    if (!Number.isFinite(kg) || kg <= 0) return '0.00 kilos';
    if (kg >= 1) return `${kg.toFixed(2)} kilos`;
    const grams = kg * 1000;
    if (grams >= 1) return `${grams.toFixed(2)} gramos`;
    return `${(grams * 1000).toFixed(2)} mg`;
  };
  const formatRawUsageAmount = (qty, unit) => {
    const amount = Number(qty || 0);
    const normalizedUnit = normalizeValue(unit).toLowerCase();
    if (!Number.isFinite(amount) || amount <= 0 || !normalizedUnit) return '';
    if (['kg', 'kilo', 'kilos', 'kilogramo', 'kilogramos'].includes(normalizedUnit)) return `${amount.toFixed(3)} kilos`;
    if (['g', 'gr', 'gramo', 'gramos'].includes(normalizedUnit)) return `${amount.toFixed(2)} gramos`;
    if (['mg', 'miligramo', 'miligramos'].includes(normalizedUnit)) return `${amount.toFixed(2)} mg`;
    if (['l', 'lt', 'litro', 'litros'].includes(normalizedUnit)) return `${amount.toFixed(3)} litros`;
    if (['ml', 'mililitro', 'mililitros', 'cc'].includes(normalizedUnit)) return `${amount.toFixed(2)} ml`;
    return `${amount.toFixed(2)} ${normalizedUnit}`;
  };

  // Filas de detalle (consumos y resolución) de un ingreso de la tabla por período. Se generan sólo
  // al expandir esa fila: abrir/cerrar no redibuja la tabla entera.
  const buildGlobalDetailHtml = (row, traces = getEntryTraceRows(row), resolutionRow = getEntryResolutionRowData(row)) => {
    const traceHtml = traces.length ? traces.map((trace) => `
      <tr class="${getTraceRowClass(trace)}" data-global-detail-of="${escapeHtml(row.entryId)}">
        <td><div class="inventario-trace-main"><img src="./IMG/Octicons-git-merge.svg" alt="merge" class="inventario-trace-icon">${escapeHtml(formatDateTime(trace.createdAt))}</div></td>
        <td>${escapeHtml(row.ingredientName)}</td>
        <td class="is-num inventario-trace-kilos">-${trace.displayAmount || formatUsageAmount(trace.kilosUsed)}</td>
        <td>${getTraceTypeLabelHtml(trace)}</td>
        <td>${escapeHtml(trace.ingredientLot)}</td>
        <td>${escapeHtml((trace.internalUse || isAutoGeneratedCounterTrace(trace)) ? row.provider : trace.productionId)}</td>
        <td>${(trace.internalUse || isAutoGeneratedCounterTrace(trace)) ? '<span class="recetas-tag tone-neu">Sin trazabilidad</span>' : `<sl-button variant="default" size="small" type="button" class="inventario-threshold-btn" data-open-production-trace="${escapeHtml(trace.productionId)}"><i slot="prefix" class="fa-solid fa-users-viewfinder"></i><span>Trazabilidad</span></sl-button>`}</td>
      </tr>`).join('') : '';
    const resolutionHtml = resolutionRow ? `<tr class="inventario-resolution-row" data-global-detail-of="${escapeHtml(row.entryId)}"><td><div class="inventario-trace-main"><img src="./IMG/Octicons-git-merge.svg" alt="merge" class="inventario-trace-icon">${escapeHtml(formatDateTime(resolutionRow.at))}</div></td><td>${escapeHtml(row.ingredientName)}</td><td class="is-num inventario-trace-kilos">-${resolutionRow.resolvedKg.toFixed(2)} kilos<br><span class="inventario-available-line is-zero">disp. ${resolutionRow.availableKg.toFixed(3)} kg</span></td><td><span class="inventario-resolution-badge">${escapeHtml(resolutionRow.badge)}</span></td><td>${escapeHtml(row.invoiceNumber)}</td><td class="inventario-provider-cell">${escapeHtml(row.provider)}</td><td><span class="recetas-tag tone-neu">Sin trazabilidad</span></td></tr>` : '';
    return resolutionHtml + traceHtml;
  };

  const renderGlobalPeriodTable = () => {
    if (!nodes.globalTableWrap) return;
    const rows = getGlobalFilteredEntries();
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    state.globalTablePage = Math.min(Math.max(1, state.globalTablePage), pages);
    const start = (state.globalTablePage - 1) * PAGE_SIZE;
    const pageRows = rows.slice(start, start + PAGE_SIZE);
    state.globalPageRowsById = Object.fromEntries(pageRows.map((row) => [row.entryId, row]));
    const canCollapse = pageRows.some((row) => hasEntryDetailRows(row) && state.globalEntryCollapse[row.entryId] === false);
    const canExpand = pageRows.some((row) => hasEntryDetailRows(row) && state.globalEntryCollapse[row.entryId] !== false);

    const htmlRows = pageRows.length ? pageRows.map((row, index) => {
      const traces = getEntryTraceRows(row);
      const isCollapsed = state.globalEntryCollapse[row.entryId] !== false;
      const expiryMeta = getEntryExpiryMeta(row);
      const isExpiredAvailable = expiryMeta.isExpired;
      const resolutionMeta = getEntryResolutionMeta(row);
      const resolutionLabel = resolutionMeta.badge;
      const resolutionRow = getEntryResolutionRowData(row);
      const expiredQtyClass = isExpiredAvailable ? 'inventario-expired-strike' : '';
      const detailHtml = (!isCollapsed && row.isLite && row.liteUsageCount)
        ? `<tr data-global-detail-of="${escapeHtml(row.entryId)}"><td colspan="7" class="text-center text-muted"><sl-spinner style="font-size:14px;vertical-align:-2px"></sl-spinner> Cargando consumos…</td></tr>`
        : ((!isCollapsed && (traces.length || resolutionRow)) ? buildGlobalDetailHtml(row, traces, resolutionRow) : '');

      const availableClass = Number(row.availableQty || 0) <= 0 ? 'is-zero' : '';
      
      return `<tr data-global-row="${escapeHtml(row.entryId)}" class="inventario-row-tone ${isExpiredAvailable ? 'is-expired-row' : ''} ${resolutionLabel ? 'is-resolution-row' : ''} ${index % 2 === 0 ? 'is-even-row' : 'is-odd-row'}">
        <td>${escapeHtml(row.entryDateTime)}${getExpiryBadgeHtml(row) ? `<br><small>${getExpiryBadgeHtml(row)}</small>` : ''}${isEntryFrozen(row) ? `<br><small class="inventario-frozen-meta">${frozenBadgeHtml(row)}</small>` : ''}</td>
        <td>${escapeHtml(row.ingredientName)}</td>
        <td class="is-num"><span class="inv-qty ${expiredQtyClass}">${Number(row.qty || 0).toFixed(2)} ${escapeHtml(row.unit || '')}</span><br><span class="inventario-available-line ${availableClass} ${expiredQtyClass}">disp. ${Number(row.availableQty || 0).toFixed(2)} ${escapeHtml(getMeasureAbbr(row.unit || ''))}${row.packageQty ? ` x${row.packageQty}` : ''}</span></td>
        <td>${escapeHtml(formatExpiryForUi(row))} </td>
        <td class="is-code">${escapeHtml(`${row.invoiceNumber}${normalizeValue(row.remitoNumber) ? ` | ${row.remitoNumber}` : ''}`)}</td>
        <td class="inventario-provider-cell">${escapeHtml(row.provider)}</td>
        <td><div class="inventario-entry-actions">${(traces.length || resolutionRow || row.liteUsageCount) ? `<sl-button variant="default" size="small" type="button" class="lj-icon-btn inventario-threshold-btn inventario-icon-only-btn" data-toggle-global-collapse="${row.entryId}" aria-label="Ver detalle" title="Ver detalle"><i class="fa-solid ${isCollapsed ? 'fa-chevron-down' : 'fa-chevron-up'}"></i></sl-button>` : ''}${row.invoiceImageUrls.length ? `<sl-button variant="default" size="small" type="button" class="inventario-threshold-btn" data-open-global-images="${encodeURIComponent(JSON.stringify(row.invoiceImageUrls))}"><i slot="prefix" class="fa-regular fa-image"></i><span>Ver (${row.invoiceImageUrls.length})</span></sl-button>` : '<span class="recetas-tag tone-neu">Sin foto</span>'}</div></td>
      </tr>${detailHtml}`;
    }).join('') : '<tr><td colspan="7" class="text-center">Sin ingresos en ese rango.</td></tr>';

    nodes.globalTableWrap.innerHTML = `
      <div class="inventario-print-row mb-2 inventario-trace-toolbar toolbar-scroll-x">
        <sl-button variant="default" size="small" type="button" class="inventario-threshold-btn" id="inventarioGlobalCollapseAllRowsBtn" ${canCollapse ? '' : 'disabled'}><i slot="prefix" class="fa-solid fa-compress"></i><span>Colapsar todo</span></sl-button>
        <sl-button variant="default" size="small" type="button" class="inventario-threshold-btn" id="inventarioGlobalExpandAllRowsBtn" ${canExpand ? '' : 'disabled'}><i slot="prefix" class="fa-solid fa-expand"></i><span>Descolapsar todo</span></sl-button>
      </div>
      <div class="table-responsive inventario-global-table inventario-table-compact-wrap">
        <table class="table recipe-table inventario-table-compact mb-0">
          <thead><tr><th>Fecha y hora</th><th>Producto</th><th class="is-num">Cantidad</th><th>Vence</th><th>N° factura</th><th>Proveedor</th><th>Imagen / Acción</th></tr></thead>
          <tbody>${htmlRows}</tbody>
        </table>
      </div>
      <div class="inventario-pagination enhanced">
        <sl-button variant="default" size="small" type="button" class="lj-icon-btn inventario-threshold-btn inventario-page-btn" data-global-page="prev" ${state.globalTablePage <= 1 ? 'disabled' : ''} aria-label="Página anterior" title="Página anterior"><i class="fa-solid fa-chevron-left"></i></sl-button>
        <span>Página ${state.globalTablePage} de ${pages}</span>
        <sl-button variant="default" size="small" type="button" class="lj-icon-btn inventario-threshold-btn inventario-page-btn" data-global-page="next" ${state.globalTablePage >= pages ? 'disabled' : ''} aria-label="Página siguiente" title="Página siguiente"><i class="fa-solid fa-chevron-right"></i></sl-button>
      </div>`;
    const pendingDetail = pageRows.filter((row) => row.isLite && row.liteUsageCount && state.globalEntryCollapse[row.entryId] === false);
    if (pendingDetail.length) loadPeriodDetailsFor(pendingDetail.map((row) => row.ingredientId));
  };

  const openGlobalConfig = async () => {
    const result = await openIosSwal({
      title: 'Configuración global de inventario',
      html: `
        <div class="text-start">
          <label class="lj-label" for="globalLowThresholdInput">Umbral global de stock bajo (kg)</label>
          <sl-input id="globalLowThresholdInput" class="swal2-input" type="number" min="0" step="0.01" value="${state.inventario.config.globalLowThresholdKg}"></sl-input>
          <label class="lj-label mt-2" for="globalLowThresholdUnitInput">Umbral global de stock bajo (unidades)</label>
          <sl-input id="globalLowThresholdUnitInput" class="swal2-input" type="number" min="0" step="0.01" value="${state.inventario.config.globalLowThresholdUnits ?? DEFAULT_LOW_THRESHOLD}"></sl-input>
          <label class="lj-label mt-2" for="globalExpiringSoonInput">Días para considerar “próximo a caducar”</label>
          <sl-input id="globalExpiringSoonInput" class="swal2-input" type="number" min="0" step="1" value="${state.inventario.config.expiringSoonDays}"></sl-input>
        </div>`,
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      cancelButtonText: 'Cancelar',
      preConfirm: () => {
        const low = parseNumber(document.getElementById('globalLowThresholdInput')?.value);
        const lowUnits = parseNumber(document.getElementById('globalLowThresholdUnitInput')?.value);
        const days = parseInt(document.getElementById('globalExpiringSoonInput')?.value || '', 10);
        if (!Number.isFinite(low) || low < 0) {
          Swal.showValidationMessage('Ingresá un umbral válido.');
          return false;
        }
        if (!Number.isFinite(days) || days < 0) {
          Swal.showValidationMessage('Ingresá días válidos (0 o más).');
          return false;
        }
        if (!Number.isFinite(lowUnits) || lowUnits < 0) {
          Swal.showValidationMessage('Ingresá un umbral válido para unidades.');
          return false;
        }
        return { low: Number(low.toFixed(2)), lowUnits: Number(lowUnits.toFixed(2)), days };
      }
    });
    if (!result.isConfirmed) return;
    state.inventario.config.globalLowThresholdKg = result.value.low;
    state.inventario.config.globalLowThresholdUnits = result.value.lowUnits;
    state.inventario.config.expiringSoonDays = result.value.days;
    await persistInventario({ configOnly: true });
    renderList();
  };

  const openProductThresholdConfig = async (ingredientId) => {
    const record = getRecord(ingredientId);
    const unit = record.stockUnit || state.ingredientes[ingredientId]?.measure || 'kilos';
    const unitAbbr = getMeasureAbbr(unit);
    const currentLocal = Number.isFinite(Number(record.lowThresholdBase))
      ? fromBase(Number(record.lowThresholdBase), unit)
      : record.lowThresholdKg;
    const result = await openIosSwal({
      title: 'Umbral por producto',
      html: `
        <div class="text-start">
          <label class="lj-label">Id unico de ingrediente</label>
          <div class="inventario-inline-field">
            <sl-input id="itemIngredientIdInput" value="${escapeHtml(ingredientId)}" readonly></sl-input>
            <sl-button variant="default" id="copyIngredientIdBtn" type="button" class="inventario-threshold-btn"><i slot="prefix" class="fa-regular fa-copy"></i><span>Copiar</span></sl-button>
          </div>
          <label class="lj-label mt-2" for="itemLowThresholdInput">Umbral de stock (${escapeHtml(unitAbbr)})</label>
          <sl-input id="itemLowThresholdInput" class="swal2-input" type="number" min="0" step="0.01" value="${currentLocal ?? ''}" placeholder="Vacío = usar global"></sl-input>
          <label class="lj-label mt-2" for="itemExpiringSoonInput">Próximo a caducar (días)</label>
          <sl-input id="itemExpiringSoonInput" class="swal2-input" type="number" min="0" step="1" value="${record.expiringSoonDays ?? ''}" placeholder="Vacío = usar global"></sl-input>
        </div>`,
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      cancelButtonText: 'Cancelar',
      didOpen: () => {
        document.getElementById('copyIngredientIdBtn')?.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(String(ingredientId || ''));
          } catch (_error) {
            const input = document.getElementById('itemIngredientIdInput');
            input?.focus();
            input?.select?.();
            document.execCommand('copy');
          }
        });
      },
      preConfirm: () => {
        const lowRaw = normalizeValue(document.getElementById('itemLowThresholdInput')?.value);
        const daysRaw = normalizeValue(document.getElementById('itemExpiringSoonInput')?.value);

        let low = null;
        if (lowRaw) {
          low = parseNumber(lowRaw);
          if (!Number.isFinite(low) || low < 0) {
            Swal.showValidationMessage('Ingresá un umbral de stock válido.');
            return false;
          }
          low = Number(low.toFixed(2));
        }

        let days = null;
        if (daysRaw) {
          days = Number.parseInt(daysRaw, 10);
          if (!Number.isFinite(days) || days < 0) {
            Swal.showValidationMessage('Ingresá días válidos (0 o más).');
            return false;
          }
        }

        return { low, days };
      }
    });
    if (!result.isConfirmed) return;
    const next = getRecord(ingredientId);
    next.lowThresholdKg = null;
    next.lowThresholdBase = result.value.low == null ? null : Number(toBase(result.value.low, unit).toFixed(6));
    next.lowThresholdMode = result.value.low == null ? 'global' : 'custom';
    next.expiringSoonDays = result.value.days;
    state.inventario.items[ingredientId] = next;
    await persistInventario({ itemIds: [ingredientId] });
    renderList();

    if (state.selectedIngredientId === ingredientId && state.view === 'editor') {
      renderEditor(ingredientId, state.editorDraft);
    }
  };

  const lotTokenLabelFor = (token, customAcronym) => {
    if (token === 'siglas_personalizadas') {
      return customAcronym ? `Siglas (${escapeHtml(customAcronym)})` : 'Siglas';
    }
    return LOT_TOKEN_OPTIONS.find((item) => item.key === token)?.label || token;
  };

  const formatDateCompact = (isoDate) => {
    const normalized = normalizeIsoDate(isoDate) || getArgentinaIsoDate();
    return normalized.replaceAll('-', '');
  };

  const formatDateCompactDmy = (isoDate) => {
    const normalized = normalizeIsoDate(isoDate) || getArgentinaIsoDate();
    const [year, month, day] = normalized.split('-');
    return `${day || '01'}${month || '01'}${year || '1900'}`;
  };

  // Fecha de vencimiento para el número de lote, formato numérico ddmmaaaa
  // (día/mes/año como se lee en español): 10072026. Sin vencimiento → SINVTO.
  const formatLotExpiryDate = (isoDate) => (normalizeIsoDate(isoDate) ? formatDateCompactDmy(isoDate) : 'SINVTO');

  // Iniciales del producto para el lote: una letra por palabra significativa
  // ("Pimienta Negra Molida" → PNM); una sola palabra usa sus 3 primeras letras.
  // Los tokens de tamaño/código con dígitos se ignoran (ver abajo).
  const LOT_INITIALS_STOPWORDS = ['de', 'del', 'la', 'las', 'el', 'los', 'y', 'con', 'sin', 'a', 'en', 'para'];
  const getProductInitials = (name) => {
    const clean = normalizeValue(name)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9\s]/g, ' ');
    const allWords = clean.split(/\s+/).filter((word) => word && !LOT_INITIALS_STOPWORDS.includes(word.toLowerCase()));
    // Palabras "reales": sólo letras. Los códigos/tamaños con dígitos ("X220",
    // "500g") se descartan salvo que no quede ninguna palabra alfabética, así
    // "Aceituna Rellena Barbera X220" → ARB (no ARBX).
    const alphaWords = allWords.filter((word) => /^[a-zA-Z]+$/.test(word));
    const words = alphaWords.length ? alphaWords : allWords;
    if (!words.length) return 'PROD';
    if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
    return words.slice(0, 4).map((word) => word[0]).join('').toUpperCase();
  };

  const openWeeklySheetConfig = async (ingredientId, { force = false } = {}) => {
    const ingredient = state.ingredientes[ingredientId];
    if (!ingredient) return false;
    const record = getRecord(ingredientId);
    const current = { ...getDefaultWeeklySheetConfig(), ...safeObject(record.weeklySheetConfig) };
    if (!force && current.configured) {
      const quick = await openIosSwal({
        title: 'Planilla semanal',
        html: `<p><strong>${escapeHtml(capitalize(ingredient.name))}</strong></p><p><small>Perecedero: <strong>${current.perishable ? 'Sí' : 'No'}</strong> · Egreso: <strong>${current.egresoEnabled ? 'Sí' : 'No'}</strong> · Rotación: <strong>${Number(current.rotationDays || 0)} día(s)</strong></small></p>`,
        showDenyButton: true,
        showCancelButton: true,
        confirmButtonText: 'Editar',
        denyButtonText: 'Cerrar',
        cancelButtonText: 'Cancelar'
      });
      if (!quick.isConfirmed) return quick.isDenied;
    }

    const result = await openIosSwal({
      title: 'Planilla Semanal',
      html: `<div class="swal-stack-fields text-start">
        <p class="mb-1"><strong>${escapeHtml(capitalize(ingredient.name))}</strong></p>
        <sl-checkbox class="inventario-check-row" id="invPerishable" ${current.perishable ? 'checked' : ''}>Producto perecedero</sl-checkbox>
        <sl-checkbox class="inventario-check-row" id="invEgresoEnabled" ${current.egresoEnabled ? 'checked' : ''}><i class="fa-solid fa-robot"></i> Habilitado para egreso</sl-checkbox>
        <label class="lj-label mt-2" for="invRotationDays">Días de rotación</label>
        <sl-input id="invRotationDays" class="swal2-input" type="number" min="0" step="1" value="${Number(current.rotationDays || 0)}"></sl-input>
      </div>`,
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      cancelButtonText: 'Cancelar',
      didOpen: () => {
        const egresoInput = document.getElementById('invEgresoEnabled');
        const rotationInput = document.getElementById('invRotationDays');
        const syncRotationDisabled = () => {
          if (!rotationInput) return;
          rotationInput.disabled = !Boolean(egresoInput?.checked);
        };
        egresoInput?.addEventListener('change', syncRotationDisabled);
        syncRotationDisabled();
      },
      preConfirm: () => {
        const rotationDays = Number(document.getElementById('invRotationDays')?.value || 0);
        if (!Number.isFinite(rotationDays) || rotationDays < 0) {
          Swal.showValidationMessage('Completá días de rotación con un número válido.');
          return false;
        }
        return {
          perishable: Boolean(document.getElementById('invPerishable')?.checked),
          counterOnly: Boolean(current.counterOnly),
          egresoEnabled: Boolean(document.getElementById('invEgresoEnabled')?.checked),
          rotationDays: Math.round(rotationDays)
        };
      }
    });

    if (!result.isConfirmed) return false;
    record.weeklySheetConfig = {
      ...getDefaultWeeklySheetConfig(),
      ...safeObject(record.weeklySheetConfig),
      ...result.value,
      configured: true,
      updatedAt: Date.now()
    };
    state.inventario.items[ingredientId] = record;
    await persistInventario({ itemIds: [ingredientId] });
    return true;
  };

  const buildWeeklyConfigBulkRows = (filterMode = 'all', familyId = 'all') => Object.values(state.ingredientes)
    .filter((ingredient) => {
      if (familyId !== 'all' && ingredient.familyId !== familyId) return false;
      if (filterMode === 'all') return true;
      const egresoEnabled = !!getRecord(ingredient.id).weeklySheetConfig?.egresoEnabled;
      return filterMode === 'enabled' ? egresoEnabled : !egresoEnabled;
    })
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es'))
    .map((ingredient) => {
      const record = getRecord(ingredient.id);
      const cfg = { ...getDefaultWeeklySheetConfig(), ...safeObject(record.weeklySheetConfig) };
      const perishableClass = cfg.perishable ? 'is-perishable' : 'is-non-perishable';
      const suggestedVal = record.suggestedExpiryDays ?? 5;
      return `<article class="inventario-weekly-row ${perishableClass}" data-weekly-row="${escapeHtml(ingredient.id)}" data-weekly-name="${escapeHtml(normalizeLower(ingredient.name))}">
        <div class="inventario-weekly-product-head">
          <span class="inventario-print-photo-wrap inventario-weekly-thumb-wrap">${ingredient.imageUrl ? `<span class="thumb-loading"><sl-spinner class="meta-spinner" aria-label="Cargando"></sl-spinner></span><img class="thumb-image js-inventario-thumb" src="${escapeHtml(ingredient.imageUrl)}" alt="${escapeHtml(capitalize(ingredient.name))}">` : '<i class="fa-solid fa-drumstick-bite"></i>'}</span>
          <div>
            <h6>${escapeHtml(capitalize(ingredient.name))}</h6>
            <p>${escapeHtml(sentenceCase(ingredient.description || 'Sin descripción'))}</p>
          </div>
        </div>
        <div class="inventario-weekly-grid inventario-weekly-grid-v2">
          <div class="inventario-weekly-checks">
            <sl-checkbox class="inventario-check-row" data-weekly-perishable="${escapeHtml(ingredient.id)}" ${cfg.perishable ? 'checked' : ''}>Producto perecedero</sl-checkbox>
            <sl-checkbox class="inventario-check-row" data-weekly-egreso="${escapeHtml(ingredient.id)}" ${cfg.egresoEnabled ? 'checked' : ''}><i class="fa-solid fa-robot"></i> Habilitado para egreso</sl-checkbox>
          </div>
          <div class="inventario-weekly-inputs">
            <div class="inventario-weekly-field">
              <label class="lj-label" for="weeklyRotation_${escapeHtml(ingredient.id)}">Días de rotación</label>
              <sl-input id="weeklyRotation_${escapeHtml(ingredient.id)}" class="swal2-input" type="number" min="0" step="1" value="${Number(cfg.rotationDays || 0)}" data-weekly-rotation="${escapeHtml(ingredient.id)}"></sl-input>
            </div>
            <div class="inventario-weekly-field">
              <label class="lj-label" for="weeklySuggested_${escapeHtml(ingredient.id)}">Vencimiento sugerido (días)</label>
              <sl-input id="weeklySuggested_${escapeHtml(ingredient.id)}" class="swal2-input" type="number" min="0" step="1" value="${suggestedVal}" data-weekly-suggested="${escapeHtml(ingredient.id)}"></sl-input>
            </div>
          </div>
        </div>
      </article>`;
    }).join('');

  const openWeeklyConfigManager = async () => {
    state.activeAutoEgresoFilter = 'all';
    const result = await openIosSwal({
      ljModal: true,
      title: 'Planilla semanal · Productos',
      html: `<div class="inventario-weekly-bulk-wrap">
        <p class="inventario-weekly-bulk-intro">Editá en masa la configuración de todos los productos.</p>
        <div class="inventario-weekly-toolbar-v2">
          <sl-input id="inventarioWeeklySearchInput" type="search" class="ingredientes-search-input inventario-weekly-search" placeholder="Buscar producto"><i slot="prefix" class="fa-solid fa-magnifying-glass"></i></sl-input>
          <sl-dropdown class="inventario-weekly-family-dropdown" hoist>
            <sl-button slot="trigger" variant="default" caret id="inventarioWeeklyFamilyDropBtn">
              <i slot="prefix" class="fa-solid fa-layer-group"></i><span id="inventarioWeeklyFamilyDropLabel">Todas las familias</span>
            </sl-button>
            <sl-menu class="inventario-weekly-family-menu">
              <sl-menu-item type="checkbox" checked class="active" value="all" data-bulk-family-pick="all">Todas las familias</sl-menu-item>
              <sl-divider></sl-divider>
              ${Object.values(state.familias).sort((a, b) => a.name.localeCompare(b.name)).map(f => `<sl-menu-item type="checkbox" value="${ljOptionValue(f.id)}" data-bulk-family-pick="${f.id}">${escapeHtml(capitalize(f.name))}</sl-menu-item>`).join('')}
            </sl-menu>
          </sl-dropdown>
          <div id="inventarioWeeklyEgresoFilters" class="inventario-status-filters inventario-weekly-filters-row"></div>
        </div>
        <div class="inventario-weekly-bulk-list" id="inventarioWeeklyBulkList">${buildWeeklyConfigBulkRows()}</div>
        <div class="inventario-pagination enhanced"><sl-button variant="default" size="small" type="button" class="lj-icon-btn inventario-threshold-btn inventario-page-btn" id="inventarioWeeklyPrevBtn" aria-label="Página anterior" title="Página anterior"><i class="fa-solid fa-chevron-left"></i></sl-button><span id="inventarioWeeklyPageText">Página 1</span><sl-button variant="default" size="small" type="button" class="lj-icon-btn inventario-threshold-btn inventario-page-btn" id="inventarioWeeklyNextBtn" aria-label="Página siguiente" title="Página siguiente"><i class="fa-solid fa-chevron-right"></i></sl-button></div>
      </div>`,
      width: 'min(1100px, 96vw)',
      showCancelButton: true,
      confirmButtonText: 'Guardar cambios',
      cancelButtonText: 'Cancelar',
      customClass: {
        popup: 'ios-alert inventario-weekly-bulk-alert',
        confirmButton: 'ios-btn-primary inventario-weekly-save-btn',
        cancelButton: 'ios-btn-secondary inventario-weekly-cancel-btn'
      },
      didOpen: (popup) => {
        initThumbLoading(popup);
        const listNode = popup.querySelector('#inventarioWeeklyBulkList');
        const pageText = popup.querySelector('#inventarioWeeklyPageText');
        const prevBtn = popup.querySelector('#inventarioWeeklyPrevBtn');
        const nextBtn = popup.querySelector('#inventarioWeeklyNextBtn');
        const searchInput = popup.querySelector('#inventarioWeeklySearchInput');
        const filterHost = popup.querySelector('#inventarioWeeklyEgresoFilters');

        const renderEgresoFilters = () => {
          if (!filterHost) return;
          const allIngredients = Object.values(state.ingredientes);
          const counts = {
            all: allIngredients.length,
            enabled: allIngredients.filter(item => getRecord(item.id).weeklySheetConfig?.egresoEnabled).length,
            disabled: allIngredients.filter(item => !getRecord(item.id).weeklySheetConfig?.egresoEnabled).length
          };
          const options = [
            { key: 'all', label: 'Todos', tone: 'neutral', count: counts.all, icon: 'fa-list' },
            { key: 'enabled', label: 'Con Autoegreso', tone: 'success', count: counts.enabled, icon: 'fa-robot' },
            { key: 'disabled', label: 'Sin Autoegreso', tone: 'danger', count: counts.disabled, icon: 'fa-ban' }
          ];
          filterHost.innerHTML = options.map(opt => `<sl-button variant="default" size="small" type="button" class="inventario-status-btn tone-${opt.tone} ${state.activeAutoEgresoFilter === opt.key ? 'is-active' : ''}" data-bulk-auto-egreso-filter="${opt.key}">${opt.icon ? `<i slot="prefix" class="fa-solid ${opt.icon}"></i>` : ''}<span>${opt.label}</span><strong>${opt.count}</strong></sl-button>`).join('');
        };

        const syncPage = () => {
          const query = normalizeLower(searchInput?.value || '');
          const currentRows = [...listNode.querySelectorAll('[data-weekly-row]')];
          const filtered = currentRows.filter((row) => String(row.dataset.weeklyName || '').includes(query));
          const pager = getPagedRows(filtered, state.weeklyConfigPage, PAGE_SIZE);
          state.weeklyConfigPage = pager.page;
          currentRows.forEach((row) => {
            row.classList.toggle('d-none', !pager.rows.includes(row));
          });
          if (pageText) pageText.textContent = `Página ${pager.page} de ${pager.pages}`;
          if (prevBtn) prevBtn.disabled = pager.page <= 1;
          if (nextBtn) nextBtn.disabled = pager.page >= pager.pages;
        };

        const refreshList = () => {
          const activeFamilyBtn = popup.querySelector('[data-bulk-family-pick].active');
          const familyId = activeFamilyBtn?.dataset.bulkFamilyPick || 'all';
          listNode.innerHTML = buildWeeklyConfigBulkRows(state.activeAutoEgresoFilter, familyId);
          state.weeklyConfigPage = 1;
          syncPage();
          initThumbLoading(listNode);
          renderEgresoFilters();
        };

        popup.querySelector('#inventarioWeeklyFamilyFilter')?.addEventListener('change', refreshList);

        popup.querySelector('.inventario-weekly-family-dropdown')?.addEventListener('click', (e) => {
          const pick = e.target.closest('[data-bulk-family-pick]');
          if (pick) {
            const familyId = pick.dataset.bulkFamilyPick;
            const labelNode = popup.querySelector('#inventarioWeeklyFamilyDropLabel');
            const dropdownBtn = popup.querySelector('#inventarioWeeklyFamilyDropBtn');
            
            // Update UI
            popup.querySelectorAll('[data-bulk-family-pick]').forEach((btn) => {
              btn.classList.remove('active');
              btn.checked = false;
            });
            pick.classList.add('active');
            pick.checked = true;
            if (labelNode) labelNode.textContent = normalizeValue(pick.textContent);
            
            refreshList();
          }
        });

        filterHost.addEventListener('click', (e) => {
          const btn = e.target.closest('[data-bulk-auto-egreso-filter]');
          if (btn) {
            state.activeAutoEgresoFilter = btn.dataset.bulkAutoEgresoFilter;
            refreshList();
          }
        });

        searchInput?.addEventListener('input', () => {
          state.weeklyConfigPage = 1;
          syncPage();
        });
        prevBtn?.addEventListener('click', () => {
          state.weeklyConfigPage -= 1;
          syncPage();
        });
        nextBtn?.addEventListener('click', () => {
          state.weeklyConfigPage += 1;
          syncPage();
        });
        listNode.addEventListener('change', (event) => {
          if (event.target.matches('[data-weekly-perishable]')) {
            const ingredientId = event.target.dataset.weeklyPerishable;
            listNode.querySelector(`[data-weekly-row="${ingredientId}"]`)?.classList.toggle('is-perishable', event.target.checked);
            listNode.querySelector(`[data-weekly-row="${ingredientId}"]`)?.classList.toggle('is-non-perishable', !event.target.checked);
          }
          if (event.target.matches('[data-weekly-egreso]')) {
            const ingredientId = event.target.dataset.weeklyEgreso;
            const input = listNode.querySelector(`[data-weekly-rotation="${ingredientId}"]`);
            if (input) input.disabled = !event.target.checked;
          }
        });
        renderEgresoFilters();
        syncPage();
      },
      preConfirm: () => {
        const payload = {};
        const errors = [];
        const container = Swal.getHtmlContainer();
        popupLoop: for (const ingredient of Object.values(state.ingredientes)) {
          const ingredientId = ingredient.id;
          const perishableInput = container.querySelector(`[data-weekly-perishable="${ingredientId}"]`);
          // Si el input no está en el DOM actual (por paginación), usamos los datos previos o del record
          const perishable = perishableInput ? Boolean(perishableInput.checked) : !!getRecord(ingredientId).weeklySheetConfig?.perishable;
          const counterOnly = Boolean(getRecord(ingredientId).weeklySheetConfig?.counterOnly);
          const egresoInput = container.querySelector(`[data-weekly-egreso="${ingredientId}"]`);
          const egresoEnabled = egresoInput ? Boolean(egresoInput.checked) : !!getRecord(ingredientId).weeklySheetConfig?.egresoEnabled;
          const rotationInput = container.querySelector(`[data-weekly-rotation="${ingredientId}"]`);
          const rotationDays = rotationInput ? Number(rotationInput.value || 0) : Number(getRecord(ingredientId).weeklySheetConfig?.rotationDays || 0);
          const suggestedInput = container.querySelector(`[data-weekly-suggested="${ingredientId}"]`);
          const suggestedExpiryDays = suggestedInput ? (suggestedInput.value === '' ? null : parseInt(suggestedInput.value, 10)) : getRecord(ingredientId).suggestedExpiryDays;

          if (!Number.isFinite(rotationDays) || rotationDays < 0) {
            errors.push(capitalize(ingredient.name));
            if (errors.length > 2) break popupLoop;
            continue;
          }
          payload[ingredientId] = {
            perishable,
            counterOnly,
            egresoEnabled,
            rotationDays: Math.round(rotationDays),
            suggestedExpiryDays
          };
        }
        if (errors.length) {
          Swal.showValidationMessage(`Revisá días de rotación en: ${errors.join(', ')}.`);
          return false;
        }
        return payload;
      }
    });

    if (!result.isConfirmed) return;
    Object.entries(result.value || {}).forEach(([ingredientId, cfg]) => {
      const record = getRecord(ingredientId);
      const { suggestedExpiryDays, ...weeklyCfg } = cfg;
      record.suggestedExpiryDays = suggestedExpiryDays;
      record.weeklySheetConfig = {
        ...getDefaultWeeklySheetConfig(),
        ...safeObject(record.weeklySheetConfig),
        ...weeklyCfg,
        configured: true,
        updatedAt: Date.now()
      };
      state.inventario.items[ingredientId] = record;
    });
    await persistInventario({ itemIds: Object.keys(result.value || {}) });
    await openIosSwal({
      title: 'Configuración guardada',
      html: '<p>La planilla semanal quedó actualizada para todos los productos editados.</p>',
      icon: 'success',
      confirmButtonText: 'Entendido'
    });
  };

  const buildLotNumber = ({ lotConfig, invoiceNumber, entryDate, expiryDate, productName }) => {
    const config = safeObject(lotConfig);
    const tokens = Array.isArray(config.tokens) ? config.tokens : [];
    const custom = normalizeUpper(config.customAcronym);
    const separator = config.includeSeparator ? (normalizeValue(config.separator) || '-') : '';
    if (!tokens.length) return normalizeValue(invoiceNumber);
    const resolved = tokens.map((token) => {
      if (token === 'remito_factura') return normalizeValue(invoiceNumber) || 'SIN-FACT';
      if (token === 'fecha_fabricacion') return formatDateCompactDmy(entryDate);
      if (token === 'fecha_hoy') return formatDateCompactDmy(getArgentinaIsoDate());
      if (token === 'fecha_vencimiento') return formatLotExpiryDate(expiryDate);
      if (token === 'iniciales_producto') return getProductInitials(productName);
      if (token === 'siglas_personalizadas') return custom || 'LJ';
      return normalizeUpper(token);
    }).filter(Boolean);
    return resolved.join(separator) || normalizeValue(invoiceNumber);
  };

  const buildLotSummaryBadges = (lotConfig) => {
    const tokens = Array.isArray(lotConfig?.tokens) ? lotConfig.tokens : [];
    const customAcronym = normalizeValue(lotConfig?.customAcronym);
    if (!tokens.length) {
      return '<span class="inventario-config-badge is-muted">Sin configuración</span>';
    }

    const separatorBadge = `<span class="inventario-config-badge is-secondary">Separador: ${escapeHtml(lotConfig?.separator || '-')}</span>`;
    const badges = [];
    tokens.forEach((token, index) => {
      badges.push(`<span class="inventario-config-badge">${lotTokenLabelFor(token, customAcronym)}</span>`);
      if (lotConfig?.includeSeparator && index < tokens.length - 1) {
        badges.push(separatorBadge);
      }
    });
    return badges.join('');
  };

  const formatDateTime = (value) => {
    const date = new Date(Number(value || 0));
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString('es-AR', {
      timeZone: AR_TIMEZONE,
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatTimeOnly = (value) => {
    const date = new Date(Number(value || 0));
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleTimeString('es-AR', { timeZone: AR_TIMEZONE, hour: '2-digit', minute: '2-digit' });
  };

  const formatEntryDateTime = (entryDate, createdAt) => {
    const dateLabel = normalizeIsoDate(entryDate) ? formatIsoDateEs(entryDate) : '-';
    const timeLabel = formatTimeOnly(createdAt);
    return `${dateLabel}, ${timeLabel}`;
  };

  const getPagedRows = (rows, page = 1, pageSize = PAGE_SIZE) => {
    const list = Array.isArray(rows) ? rows : [];
    const pages = Math.max(1, Math.ceil(list.length / pageSize));
    const current = Math.min(Math.max(1, Number(page) || 1), pages);
    const start = (current - 1) * pageSize;
    return {
      page: current,
      pages,
      rows: list.slice(start, start + pageSize)
    };
  };

  const getAvailableQty = (entry) => {
    const value = Number(entry?.availableQty);
    if (Number.isFinite(value) && value >= 0) return value;
    return Number(entry?.qty || 0);
  };

  const getAvailableInUnit = (entry, unit = '') => {
    const targetUnit = unit || entry?.unit;
    const availableBase = Number(entry?.availableBase);
    if (Number.isFinite(availableBase) && availableBase >= 0) {
      return fromBase(availableBase, targetUnit);
    }
    const availableQty = Number(entry?.availableQty);
    if (Number.isFinite(availableQty)) return availableQty;
    return Number(entry?.qty || 0);
  };

  const getAvailableKg = (entry) => {
    const value = Number(entry?.availableKg);
    if (Number.isFinite(value) && value >= 0) return value;
    const qtyKg = Number(entry?.qtyKg);
    if (Number.isFinite(qtyKg) && qtyKg >= 0) return qtyKg;
    const availableQty = getAvailableQty(entry);
    return Number(convertToKg(availableQty, entry?.unit || 'kilos') || 0);
  };

  const getEntryUsages = (entry) => Array.isArray(entry?.productionUsage) ? entry.productionUsage : [];
  const getEntryExpiryMeta = (entry, targetIso = getArgentinaIsoDate()) => {
    if (isEntryNoPerecedero(entry)) return { isExpired: false, availableKg: getAvailableKg(entry), expiredKg: 0 };
    const expiryIso = normalizeIsoDate(entry?.expiryDate);
    if (!expiryIso) return { isExpired: false, availableKg: getAvailableKg(entry), expiredKg: 0 };
    const availableKg = getAvailableKg(entry);
    const availableQty = getAvailableQty(entry);
    const hasAvailable = (Number.isFinite(availableKg) && availableKg > 0.0001) || (Number.isFinite(availableQty) && availableQty > 0.0001);
    const isExpired = expiryIso < targetIso && hasAvailable;
    return {
      isExpired,
      availableKg,
      expiredKg: isExpired ? Number(availableKg.toFixed(3)) : 0
    };
  };
  const getRecordExpiredAvailableKg = (record, targetIso = getArgentinaIsoDate()) => (Array.isArray(record?.entries) ? record.entries : [])
    .reduce((acc, entry) => acc + getEntryExpiryMeta(entry, targetIso).expiredKg, 0);
  const getEntryResolutionMeta = (entry) => {
    const resolutions = Array.isArray(entry?.expiryResolutions) ? entry.expiryResolutions : [];
    const latest = resolutions[0] || null;
    const latestIsAuto = Boolean(latest?.generatedAutomatically) || normalizeValue(latest?.source) === 'apps_script_auto_egreso' || ['auto_sold_local', 'auto_sold_counter'].includes(normalizeValue(latest?.type));
    if (latestIsAuto) return { badge: '', status: '' };
    const status = normalizeValue(entry?.expiryResolutionStatus || entry?.status || latest?.type);
    const totalKg = Number(entry?.qtyKg || 0);
    const availableKg = getAvailableKg(entry);
    const isFull = availableKg <= 0.0001;
    const resolvedKg = Number(latest?.qtyKg || 0);
    const baseLabel = status === 'sold_local'
      ? 'Vendida en local'
      : status === 'sold_branch'
        ? 'Vendido en sucursal'
        : status === 'sold_counter'
          ? 'Vendido en mostrador'
          : status === 'decommissioned'
            ? 'Decomisado'
            : '';
    if (!baseLabel) return { badge: '', status };
    if (isFull) return { badge: `${baseLabel}`, status };
    if (resolvedKg > 0.0001 && totalKg > 0.0001) {
      return { badge: `${baseLabel} ${resolvedKg.toFixed(1)}Kg de ${totalKg.toFixed(0)}Kg`, status };
    }
    return { badge: baseLabel, status };
  };
  const isBlueResolutionStatus = (status) => ['decommissioned', 'sold_counter'].includes(normalizeValue(status));

  const getEntryResolutionRowData = (entry) => {
    const meta = getEntryResolutionMeta(entry);
    const resolutions = Array.isArray(entry?.expiryResolutions) ? entry.expiryResolutions : [];
    const latest = resolutions[0] || {};
    const totalKg = Number(entry?.qtyKg || 0);
    const availableKg = getAvailableKg(entry);
    if (meta.badge) {
      const resolvedKgRaw = Number(latest?.qtyKg || 0);
      const resolvedKg = resolvedKgRaw > 0 ? resolvedKgRaw : Math.max(0, totalKg - availableKg);
      return {
        badge: meta.badge,
        status: meta.status,
        at: Number(latest?.createdAt || entry?.createdAt || 0),
        resolvedKg: Number(resolvedKg.toFixed(2)),
        availableKg: Number(availableKg.toFixed(3))
      };
    }
    const movements = Array.isArray(entry?.movementHistory) ? entry.movementHistory : [];
    const latestDispatchMovement = movements.find((movement) => normalizeValue(movement?.type) === 'resolucion_vencido_reparto_xlsx');
    if (!latestDispatchMovement) return null;
    const qtyKg = Math.max(0, Number(latestDispatchMovement?.qtyKg || 0));
    if (qtyKg <= 0.0001) return null;
    const obs = normalizeLower(latestDispatchMovement?.observation || '');
    const badge = obs.includes('decomis') ? 'Decomisado' : 'Vendido en mostrador';
    return {
      badge,
      status: badge === 'Decomisado' ? 'decommissioned' : 'sold_counter',
      at: Number(latestDispatchMovement?.createdAt || entry?.createdAt || 0),
      resolvedKg: Number(qtyKg.toFixed(2)),
      availableKg: Number(availableKg.toFixed(3))
    };
  };

  const getEntryTraceRows = (entry) => getEntryUsages(entry).map((usage) => ({
    id: usage.id || makeId('usage_row'),
    createdAt: Number(usage.producedAt || usage.createdAt || 0),
    productionDate: normalizeValue(usage.productionDate) || '-',
    expiryDateAtProduction: normalizeValue(usage.expiryDateAtProduction) || (isEntryNoPerecedero(entry) ? 'No perecedero' : '-'),
    kilosUsed: Number(usage.kilosUsed || 0),
    usedQty: Number(usage.usedQty || 0),
    usedUnit: normalizeValue(usage.usedUnit),
    displayAmount: formatRawUsageAmount(usage.usedQty, usage.usedUnit) || formatUsageAmount(usage.kilosUsed),
    ingredientLot: normalizeValue(usage.ingredientLot || usage.lotNumber) || normalizeValue(entry.lotNumber) || '-',
    productionId: normalizeValue(usage.productionId) || '-',
    internalUse: Boolean(usage.internalUse),
    generatedAutomatically: Boolean(usage.generatedAutomatically),
    source: normalizeValue(usage.source)
  })).sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));

  const isAutoGeneratedCounterTrace = (trace = {}) => Boolean(trace.generatedAutomatically) || normalizeValue(trace.source) === 'apps_script_auto_egreso' || normalizeUpper(trace.productionId).startsWith('AUTO-EGRESO-');
  const getAutoGeneratedTraceLabel = (trace = {}) => {
    const traceType = normalizeValue(trace.type);
    if (['auto_dispatch_home', 'auto_dispatch_home_xlsx'].includes(traceType) || normalizeValue(trace.source) === 'dispatch_xlsx_home_delivery') return 'Reparto a domicilio';
    if (traceType === 'auto_sold_counter') return 'Venta en mostrador';
    if (traceType === 'auto_sold_local') return 'Venta en Local';
    const expiryLabel = normalizeLower(trace.expiryDateAtProduction || '');
    if (expiryLabel.includes('reparto a domicilio')) return 'Reparto a domicilio';
    if (expiryLabel.includes('mostrador')) return 'Venta en mostrador';
    return 'Venta en Local';
  };
  const getTraceRowClass = (trace = {}) => {
    if (isAutoGeneratedCounterTrace(trace)) {
      return getAutoGeneratedTraceLabel(trace) === 'Reparto a domicilio'
        ? 'inventario-auto-egreso-home-row'
        : 'inventario-auto-egreso-row';
    }
    return trace.internalUse ? 'inventario-internal-use-row' : 'inventario-trace-row';
  };
  const getTraceTypeLabelHtml = (trace = {}) => isAutoGeneratedCounterTrace(trace)
    ? `<span class="inventario-resolution-badge inventario-auto-egreso-badge ${getAutoGeneratedTraceLabel(trace) === 'Reparto a domicilio' ? 'is-home-delivery' : ''}"><i class="fa-solid ${getAutoGeneratedTraceLabel(trace) === 'Reparto a domicilio' ? 'fa-truck' : 'fa-robot'}"></i>${escapeHtml(getAutoGeneratedTraceLabel(trace))}</span>`
    : (trace.internalUse ? '<span class="inventario-resolution-badge">Uso interno en empresa</span>' : escapeHtml(trace.expiryDateAtProduction || 'No perecedero'));

  const hasEntryDetailRows = (entry) => getEntryTraceRows(entry).length > 0 || Boolean(getEntryResolutionRowData(entry)) || Boolean(entry?.isLite && entry.liteUsageCount);

  const canExpandAnyRows = (entries = [], collapseMap = {}) => entries.some((entry) => {
    if (!hasEntryDetailRows(entry)) return false;
    return collapseMap[entry.id] !== false;
  });

  const canCollapseAnyRows = (entries = [], collapseMap = {}) => entries.some((entry) => {
    if (!hasEntryDetailRows(entry)) return false;
    return collapseMap[entry.id] === false;
  });


  const buildTraceRowsForEntry = (entry) => getEntryTraceRows(entry).map((trace) => ({
    __isTrace: true,
    fechaHora: formatDateTime(trace.createdAt),
    fechaCaducidad: isAutoGeneratedCounterTrace(trace) ? getAutoGeneratedTraceLabel(trace) : (trace.internalUse ? 'Uso interno en empresa' : (trace.expiryDateAtProduction || 'No perecedero')),
    cantidad: `-${trace.displayAmount || formatUsageAmount(trace.kilosUsed)}`,
    factura: trace.ingredientLot || '-',
    proveedor: (trace.internalUse || isAutoGeneratedCounterTrace(trace)) ? providerLabel(entry.provider) : (trace.productionId || '-'),
    imagenes: 'Trazabilidad',
    productionId: (trace.internalUse || isAutoGeneratedCounterTrace(trace)) ? providerLabel(entry.provider) : (trace.productionId || '-'),
    internalUse: Boolean(trace.internalUse)
  }));

  const buildPrintableRowsForEntries = (entries, includeTrace = false) => {
    const rows = [];
    entries.forEach((entry) => {
      const resolutionRow = getEntryResolutionRowData(entry);
      const expiryMeta = getEntryExpiryMeta(entry);
      const detail = formatEntryDetailLabel(entry);
      rows.push({
        __isTrace: false,
        __tone: expiryMeta.isExpired ? 'expired' : 'normal',
        __expired: expiryMeta.isExpired,
        fechaHora: formatDateTime(entry.createdAt),
        fechaCaducidad: [entry.expiryDate || '-', getExpiryBadgeText(entry)].filter(Boolean).join(' · '),
        cantidad: `${detail.qtyLabel} · ${detail.availableLabel}`,
        factura: entry.invoiceNumber || '-',
        proveedor: providerLabel(entry.provider),
        imagenes: entryImageUrls(entry).length ? `Ver adjunto (${entryImageUrls(entry).length})` : 'Sin adjunto'
      });
      if (resolutionRow) {
        rows.push({
          __isTrace: true,
          __tone: isBlueResolutionStatus(resolutionRow.status) ? 'resolution' : 'normal',
          fechaHora: formatDateTime(resolutionRow.at),
          fechaCaducidad: resolutionRow.badge,
          cantidad: `-${resolutionRow.resolvedKg.toFixed(2)} kilos · disp. ${resolutionRow.availableKg.toFixed(3)} kg`,
          factura: entry.invoiceNumber || '-',
          proveedor: providerLabel(entry.provider),
          imagenes: 'Resolución'
        });
      }
      if (includeTrace) rows.push(...buildTraceRowsForEntry(entry));
    });
    return rows;
  };

  const buildExportRowsForEntries = (entries, includeTrace = false) => {
    const rows = [];
    entries.forEach((entry) => {
      const urls = entryImageUrls(entry);
      const resolutionRow = getEntryResolutionRowData(entry);
      rows.push({
        Fecha: formatDateTime(entry.createdAt),
        'Fecha caducidad': [entry.expiryDate || '-', getExpiryBadgeText(entry)].filter(Boolean).join(' · '),
        Cantidad: `${formatEntryDetailLabel(entry).qtyLabel} · ${formatEntryDetailLabel(entry).availableLabel}`,
        'N° factura': entry.invoiceNumber || '-',
        Lote: entry.lotNumber || '-',
        Proveedor: providerLabel(entry.provider),
        Imágenes: imageLinksText(entry),
        __firstImage: urls[0] || '',
        __tone: getEntryExpiryMeta(entry).isExpired ? 'expired' : 'normal'
      });
      if (resolutionRow) {
        rows.push({
          Fecha: `↳ ${formatDateTime(resolutionRow.at)}`,
          'Fecha caducidad': resolutionRow.badge,
          Cantidad: `-${resolutionRow.resolvedKg.toFixed(2)} kilos · disp. ${resolutionRow.availableKg.toFixed(3)} kg`,
          'N° factura': entry.invoiceNumber || '-',
          Lote: entry.lotNumber || '-',
          Proveedor: providerLabel(entry.provider),
          Imágenes: 'Resolución',
          __tone: isBlueResolutionStatus(resolutionRow.status) ? 'resolution_yellow' : 'normal'
        });
      }
      if (includeTrace) {
        buildTraceRowsForEntry(entry).forEach((trace) => {
          rows.push({
            Fecha: `↳ ${trace.fechaHora}`,
            'Fecha caducidad': trace.fechaCaducidad,
            Cantidad: trace.cantidad,
            'N° factura': '-',
            Lote: trace.factura,
            Proveedor: trace.proveedor,
            Imágenes: 'Trazabilidad',
            __tone: 'trace'
          });
        });
      }
    });
    return rows;
  };

  const clampViewerOffsets = () => {
    if (!nodes.viewerImage || !nodes.viewerStage || state.viewerScale <= 1) return;
    const stageRect = nodes.viewerStage.getBoundingClientRect();
    const baseWidth = nodes.viewerImage.clientWidth;
    const baseHeight = nodes.viewerImage.clientHeight;
    if (!stageRect.width || !stageRect.height || !baseWidth || !baseHeight) return;
    const scaledWidth = baseWidth * state.viewerScale;
    const scaledHeight = baseHeight * state.viewerScale;
    const maxOffsetX = Math.max(0, (scaledWidth - stageRect.width) / 2);
    const maxOffsetY = Math.max(0, (scaledHeight - stageRect.height) / 2);
    state.viewerOffsetX = Math.min(maxOffsetX, Math.max(-maxOffsetX, state.viewerOffsetX));
    state.viewerOffsetY = Math.min(maxOffsetY, Math.max(-maxOffsetY, state.viewerOffsetY));
  };

  const applyViewerTransform = () => {
    if (!nodes.viewerImage) return;
    clampViewerOffsets();
    nodes.viewerImage.style.transform = `translate(${state.viewerOffsetX}px, ${state.viewerOffsetY}px) scale(${state.viewerScale})`;
  };

  const setViewerScale = (value) => {
    state.viewerScale = Math.max(1, Math.min(4, value));
    if (state.viewerScale <= 1) {
      state.viewerOffsetX = 0;
      state.viewerOffsetY = 0;
    }
    applyViewerTransform();
  };

  const isViewerPdfUrl = (url) => /\.pdf(?:$|[?#])/i.test(String(url || '').split('?')[0] || '');

  const ensureViewerDocumentPlaceholder = () => {
    let node = document.getElementById('viewerDocumentPlaceholder');
    if (node) return node;
    node = document.createElement('div');
    node.id = 'viewerDocumentPlaceholder';
    node.className = 'viewer-document d-none';
    node.style.display = 'grid';
    node.style.alignContent = 'center';
    node.style.justifyItems = 'center';
    node.style.gap = '12px';
    node.style.padding = '28px';
    node.style.textAlign = 'center';
    node.style.color = 'var(--lj-accent)';
    nodes.viewerDocument?.insertAdjacentElement('afterend', node);
    return node;
  };

  const renderViewerImage = () => {
    const item = state.viewerImages[state.viewerIndex];
    if (!item || !nodes.viewerImage) return;
    if (nodes.viewerCounter) {
      nodes.viewerCounter.textContent = `${state.viewerIndex + 1}/${state.viewerImages.length}`;
      nodes.viewerCounter.classList.toggle('d-none', state.viewerImages.length <= 1);
    }
    const isPdf = isViewerPdfUrl(item.src);
    const pdfPlaceholder = ensureViewerDocumentPlaceholder();
    if (nodes.viewerDownloadBtn) {
      nodes.viewerDownloadBtn.href = item.src || '#';
      const rawName = String(item.src || '').split('/').pop()?.split('?')[0] || 'adjunto';
      nodes.viewerDownloadBtn.download = decodeURIComponent(rawName) || 'adjunto';
    }
    nodes.viewerStage?.classList.toggle('is-document', isPdf);
    nodes.viewerStage?.classList.toggle('is-image', !isPdf);
    nodes.viewerImage.classList.toggle('d-none', isPdf);
    nodes.viewerImage.setAttribute('draggable', 'false');
    nodes.viewerZoomInBtn?.classList.toggle('d-none', isPdf);
    nodes.viewerZoomOutBtn?.classList.toggle('d-none', isPdf);
    nodes.viewerStageSpinner?.classList.remove('d-none');
    nodes.viewerImage.classList.remove('is-loaded');
    if (isPdf) {
      // Mostramos el PDF INLINE en el iframe. Si por algún motivo el browser
      // no lo soporta o el iframe falla, dejamos el placeholder como fallback.
      if (nodes.viewerDocument) {
        nodes.viewerDocument.classList.remove('d-none');
        // Usamos #toolbar=1&view=FitH para que arranque ajustado al ancho.
        nodes.viewerDocument.src = `${item.src}#view=FitH`;
        nodes.viewerDocument.onload = () => {
          nodes.viewerStageSpinner?.classList.add('d-none');
        };
      }
      // Placeholder oculto cuando el iframe está activo.
      pdfPlaceholder?.classList.add('d-none');
      if (pdfPlaceholder) {
        // Igual lo poblamos como fallback por si el iframe se rompe a futuro.
        pdfPlaceholder.innerHTML = `<i class="fa-regular fa-file-pdf" style="font-size:44px;color:var(--lj-danger);"></i><strong>Documento PDF adjunto</strong><p style="margin:0;color:var(--lj-muted);">Si el visor interno no carga el PDF, abrilo en una pestaña.</p><sl-button variant="primary" href="${escapeHtml(item.src)}" target="_blank" rel="noopener noreferrer"><i slot="prefix" class="fa-solid fa-up-right-from-square"></i><span>Abrir PDF</span></sl-button>`;
      }
      nodes.viewerImage.src = '';
      return;
    }
    // No es PDF: ocultamos iframe y placeholder, mostramos imagen.
    if (nodes.viewerDocument) {
      nodes.viewerDocument.classList.add('d-none');
      nodes.viewerDocument.src = '';
      nodes.viewerDocument.onload = null;
    }
    pdfPlaceholder?.classList.add('d-none');
    state.viewerOffsetX = 0;
    state.viewerOffsetY = 0;
    applyViewerTransform();
    nodes.viewerImage.src = item.src;
  };

  const openAttachmentViewer = async (entries, startIndex = 0, title = 'Adjuntos') => {
    const images = entries.flatMap((item) => entryImageUrls(item).map((url) => ({ src: url })));
    if (!images.length || !nodes.imageViewerModal) return;
    const viewerTitle = nodes.imageViewerModal.querySelector('.lj-dialog-heading');
    if (viewerTitle) viewerTitle.textContent = title;
    state.viewerImages = images;
    state.viewerIndex = Math.min(Math.max(0, startIndex), images.length - 1);
    state.viewerOffsetX = 0;
    state.viewerOffsetY = 0;
    setViewerScale(1);
    renderViewerImage();
    // Los sl-dialog comparten z-index y se apilan por orden en el DOM: lo movemos al final
    // del body (estando cerrado) para que quede arriba de cualquier modal o alerta abierta.
    if (!nodes.imageViewerModal.open && nodes.imageViewerModal !== document.body.lastElementChild) {
      document.body.append(nodes.imageViewerModal);
    }
    LJModal.open(nodes.imageViewerModal);
  };

  window.laJamoneraOpenImageViewer = openAttachmentViewer;


  nodes.viewerStage?.addEventListener('wheel', (event) => {
    if (!state.viewerImages.length || nodes.viewerImage?.classList.contains('d-none')) return;
    event.preventDefault();
    const delta = event.deltaY < 0 ? 0.2 : -0.2;
    setViewerScale(state.viewerScale + delta);
  }, { passive: false });

  let pinchStartDistance = 0;
  let pinchStartScale = 1;
  const touchDistance = (touches) => {
    if (!touches || touches.length < 2) return 0;
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt((dx * dx) + (dy * dy));
  };

  nodes.viewerStage?.addEventListener('touchstart', (event) => {
    if (event.touches.length < 2) return;
    pinchStartDistance = touchDistance(event.touches);
    pinchStartScale = state.viewerScale;
  }, { passive: true });

  nodes.viewerStage?.addEventListener('touchmove', (event) => {
    if (event.touches.length < 2 || !pinchStartDistance) return;
    event.preventDefault();
    const nextDistance = touchDistance(event.touches);
    const ratio = nextDistance / pinchStartDistance;
    setViewerScale(pinchStartScale * ratio);
  }, { passive: false });

  nodes.viewerStage?.addEventListener('touchend', (event) => {
    if (pinchStartDistance && state.viewerScale <= 1) {
      state.viewerOffsetX = 0;
      state.viewerOffsetY = 0;
      applyViewerTransform();
    }
    if ((event.touches?.length || 0) < 2) {
      pinchStartDistance = 0;
    }
  });
  nodes.viewerStage?.addEventListener('touchcancel', () => {
    pinchStartDistance = 0;
  });

  nodes.viewerStage?.addEventListener('pointerdown', (event) => {
    if (state.viewerScale <= 1) return;
    state.viewerIsDragging = true;
    state.viewerDragStartX = event.clientX - state.viewerOffsetX;
    state.viewerDragStartY = event.clientY - state.viewerOffsetY;
    event.preventDefault();
    nodes.viewerStage?.setPointerCapture?.(event.pointerId);
    nodes.viewerStage?.classList.add('is-dragging');
  });

  nodes.viewerStage?.addEventListener('pointermove', (event) => {
    if (!state.viewerIsDragging) return;
    state.viewerOffsetX = event.clientX - state.viewerDragStartX;
    state.viewerOffsetY = event.clientY - state.viewerDragStartY;
    applyViewerTransform();
  });

  const stopViewerDrag = (event) => {
    if (!state.viewerIsDragging) return;
    state.viewerIsDragging = false;
    nodes.viewerStage?.classList.remove('is-dragging');
    nodes.viewerStage?.releasePointerCapture?.(event.pointerId);
  };
  nodes.viewerStage?.addEventListener('pointerup', stopViewerDrag);
  nodes.viewerStage?.addEventListener('pointercancel', stopViewerDrag);
  nodes.viewerStage?.addEventListener('pointerleave', stopViewerDrag);

  const inDateRange = (value, from, to) => {
    const dateIso = normalizeIsoDate(value);
    if (!dateIso) return false;
    if (from && dateIso < from) return false;
    if (to && dateIso > to) return false;
    return true;
  };

  const getFilteredEntries = (entries) => {
    const search = normalizeLower(state.tableSearch);
    const range = parseRangeValue(state.tableDateRange);
    return entries.filter((entry) => {
      if (search) {
        const blob = [entry.entryDate, entry.expiryDate, entry.invoiceNumber, entry.provider, entry.qty, entry.unit].map(normalizeLower).join(' ');
        if (!blob.includes(search)) return false;
      }
      if ((range.from || range.to) && !inDateRange(entry.entryDate, range.from, range.to)) return false;
      return true;
    });
  };

  const isPdfAttachmentUrl = (url) => {
    const raw = String(url || '').split('?')[0] || '';
    try {
      return /\.pdf(?:$|[?#])/i.test(decodeURIComponent(raw));
    } catch (_) {
      return /\.pdf(?:$|[?#])/i.test(raw);
    }
  };

  const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

  const isFirebaseStorageUrl = (url) => /firebasestorage\.googleapis\.com|\.firebasestorage\.app/i.test(String(url || ''));

  const fetchPrintableBlob = async (url) => {
    const safeUrl = normalizeValue(url);
    // Imagenes de Storage: via Cloud Function (reemplazo de cors.sh) para sumar cabeceras CORS.
    if (isFirebaseStorageUrl(safeUrl) && window.laJamoneraProxy) {
      return window.laJamoneraProxy.imageResponse(safeUrl);
    }
    return fetch(safeUrl, { cache: 'force-cache', mode: 'cors' });
  };

  const loadPrintableImageSrc = async (url) => {
    const safeUrl = normalizeValue(url);
    if (!safeUrl || /^data:image\//i.test(safeUrl) || isPdfAttachmentUrl(safeUrl)) return safeUrl;
    try {
      const response = await fetchPrintableBlob(safeUrl);
      if (!response.ok) return safeUrl;
      const blob = await response.blob();
      if (!String(blob.type || '').startsWith('image/')) return safeUrl;
      return await blobToDataUrl(blob);
    } catch (_) {
      return safeUrl;
    }
  };

  const preloadImages = async (urls) => {
    const uniqueUrls = [...new Set(urls.filter(Boolean))];
    const printableMap = {};
    if (!uniqueUrls.length) return printableMap;

    await openIosSwal({
      title: 'Preparando impresión...',
      html: '<div class="informes-saving-spinner"><sl-spinner class="meta-spinner-login" aria-label="Preparando impresión"></sl-spinner></div>',
      allowOutsideClick: false,
      showConfirmButton: false,
      didOpen: async () => {
        await Promise.all(uniqueUrls.map(async (url) => {
          printableMap[url] = await loadPrintableImageSrc(url);
          if (printableMap[url] !== url || isPdfAttachmentUrl(url)) return;
          await new Promise((resolve) => {
            const img = new Image();
            img.onload = resolve;
            img.onerror = resolve;
            img.src = url;
          });
        }));
        Swal.close();
      }
    });
    return printableMap;
  };

  const openPrintEntries = async (ingredient, entries) => {
    const ask = await openIosSwal({
      title: 'Imprimir historial',
      html: '<p>¿Querés incluir imágenes adjuntas en la impresión?</p>',
      showCancelButton: true,
      showDenyButton: true,
      confirmButtonText: 'Incluir',
      denyButtonText: 'No incluir',
      cancelButtonText: 'Cancelar',
      customClass: {
        confirmButton: 'ios-btn-success',
        denyButton: 'ios-btn-danger ios-btn-deny-critical',
        cancelButton: 'ios-btn-secondary'
      }
    });
    if (!ask.isConfirmed && !ask.isDenied) return;

    const includeImages = ask.isConfirmed;

    const askTrace = await openIosSwal({
      title: 'Incluir trazabilidad',
      html: '<p>¿Querés incluir los datos colapsados de trazabilidad?</p>',
      showCancelButton: true,
      showDenyButton: true,
      confirmButtonText: 'Incluir',
      denyButtonText: 'No incluir',
      cancelButtonText: 'Cancelar',
      customClass: {
        confirmButton: 'ios-btn-success',
        denyButton: 'ios-btn-danger ios-btn-deny-critical',
        cancelButton: 'ios-btn-secondary'
      }
    });
    if (!askTrace.isConfirmed && !askTrace.isDenied) return;

    const includeTrace = askTrace.isConfirmed;

    if (includeImages) {
      await preloadImages(entries.flatMap((entry) => entryImageUrls(entry)).concat([ingredient.imageUrl]));
    }

    const tableRows = entries.flatMap((entry, index) => {
      const expiryMeta = getEntryExpiryMeta(entry);
      const expiryBadge = getExpiryBadgeText(entry);
      const detail = formatEntryDetailLabel(entry);
      const strikeClass = expiryMeta.isExpired ? ' style="text-decoration:line-through;font-weight:700;color:#b42338"' : '';
      const mainRow = `<tr class="inventario-row-tone ${index % 2 === 0 ? 'is-even-row' : 'is-odd-row'}${expiryMeta.isExpired ? ' is-expired-row-print' : ''}"><td>${escapeHtml(formatDateTime(entry.createdAt))}</td><td>${escapeHtml(entry.expiryDate || '-')}${expiryBadge ? `<br><small style="color:#b42338;font-weight:700">${escapeHtml(expiryBadge)}</small>` : ''}</td><td><span${strikeClass}>${escapeHtml(detail.qtyLabel)}</span><br><small${strikeClass}>${escapeHtml(detail.availableLabel)}</small></td><td><span${strikeClass}>${escapeHtml(detail.qtyLabel)}</span></td><td class="is-code">${escapeHtml(entry.invoiceNumber || '-')}</td><td class="inventario-provider-cell">${escapeHtml(providerLabel(entry.provider))}</td><td>${includeImages ? (entryImageUrls(entry).length ? `Ver adjunto (${entryImageUrls(entry).length})` : 'Sin adjunto') : (entryImageUrls(entry).length ? `Posee ${entryImageUrls(entry).length} adjunto/s` : 'Sin adjunto')}</td></tr>`;
      const resolution = getEntryResolutionRowData(entry);
      const resolutionRow = resolution
        ? `<tr class="is-resolution-row-print"><td>${escapeHtml(`↳ ${formatDateTime(resolution.at)}`)}</td><td>${escapeHtml(entry.expiryDate || '-')}</td><td>${escapeHtml(`-${resolution.resolvedKg.toFixed(2)} kilos`)}</td><td>${escapeHtml(resolution.badge)}</td><td class="is-code">${escapeHtml(entry.invoiceNumber || '-')}</td><td class="inventario-provider-cell">${escapeHtml(providerLabel(entry.provider))}</td><td>Resolución</td></tr>`
        : '';
      if (!includeTrace) return [mainRow, resolutionRow].filter(Boolean);
      const traceRows = buildTraceRowsForEntry(entry).map((trace) => `<tr class="is-trace-row"><td>${escapeHtml(`↳ ${trace.fechaHora}`)}</td><td>${escapeHtml(trace.fechaCaducidad || '-')}</td><td>${escapeHtml(trace.cantidad)}</td><td>${escapeHtml(trace.factura)}</td><td>${escapeHtml(trace.proveedor)}</td><td class="inventario-provider-cell">Trazabilidad</td><td></td></tr>`);
      return [mainRow, resolutionRow, ...traceRows].filter(Boolean);
    }).join('');

    const imagesHtml = includeImages
      ? `<section><h2 style="margin:16px 0 10px;font-size:18px;">Imágenes adjuntas</h2><div style="display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));">${entries.flatMap((entry) => entryImageUrls(entry).map((url, idx) => `<figure style="margin:0;border:1px solid #d7def2;border-radius:12px;padding:10px;background:#fff;"><img src="${url}" style="width:100%;max-height:320px;object-fit:contain;border-radius:10px;"/><figcaption style="font-size:12px;color:#4b5f8e;margin-top:6px;">${escapeHtml(entry.invoiceNumber || '-')} · ${escapeHtml(entry.entryDate || '-')} · ${idx + 1}</figcaption></figure>`)).join('')}</div></section>`
      : '';

    const printWindow = window.open('', '_blank', 'width=1300,height=900');
    if (!printWindow) return;
    printWindow.document.write(`
      <html>
        <head>
          <title>Historial inventario - ${escapeHtml(capitalize(ingredient.name))}</title>
          <style>
            body{font-family:Inter,Arial,sans-serif;padding:20px;color:#1f2a44}
            table{width:100%;border-collapse:collapse}
            th,td{border:1px solid #d7def2;padding:6px;font-size:11px;vertical-align:top}
            th{background:#eef3ff;font-size:10px;text-transform:uppercase;letter-spacing:.04em}
            .is-trace-row td{background:#ffecef}
            .is-resolution-row-print td{background:#fff6d9}
            .is-expired-row-print td{background:#ffecef}
          </style>
        </head>
        <body>
          <h1>Ingresos por período • La Jamonera</h1>
          <section style="margin-bottom:14px;">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">${ingredient.imageUrl ? `<img src="${ingredient.imageUrl}" style="width:62px;height:62px;border-radius:999px;object-fit:cover;border:1px solid #d7def2;">` : ''}<div><h2 style="margin:0;font-size:18px;">${escapeHtml(capitalize(ingredient.name))}</h2><p style="margin:0;color:#55607f;font-size:12px;">${escapeHtml(sentenceCase(ingredient.description || 'Sin descripción'))}</p></div></div>
            <table>
              <thead><tr><th>Fecha y hora</th><th>Fecha vencimiento</th><th>Cantidad / Disp.</th><th class="is-num">Cantidad</th><th>N° factura</th><th>Proveedor</th><th>Imagen</th></tr></thead>
              <tbody>${tableRows || '<tr><td colspan="7">Sin datos</td></tr>'}</tbody>
            </table>
          </section>
          ${imagesHtml}
        </body>
      </html>`);
    printWindow.document.close();
    printWindow.focus();
    await waitPrintAssets(printWindow);
    printWindow.print();
  };


  const openPrintGlobalPeriod = async (rows) => {
    const ask = await openIosSwal({
      title: 'Imprimir período',
      html: '<p>¿Querés incluir imágenes adjuntas?</p>',
      showCancelButton: true,
      showDenyButton: true,
      confirmButtonText: 'Incluir',
      denyButtonText: 'No incluir',
      cancelButtonText: 'Cancelar',
      customClass: {
        confirmButton: 'ios-btn-success',
        denyButton: 'ios-btn-danger ios-btn-deny-critical',
        cancelButton: 'ios-btn-secondary'
      }
    });
    if (!ask.isConfirmed && !ask.isDenied) return;
    const includeImages = ask.isConfirmed;

    const askTrace = await openIosSwal({
      title: 'Incluir trazabilidad',
      html: '<p>¿Querés incluir los datos colapsados de trazabilidad?</p>',
      showCancelButton: true,
      showDenyButton: true,
      confirmButtonText: 'Incluir',
      denyButtonText: 'No incluir',
      cancelButtonText: 'Cancelar',
      customClass: {
        confirmButton: 'ios-btn-success',
        denyButton: 'ios-btn-danger ios-btn-deny-critical',
        cancelButton: 'ios-btn-secondary'
      }
    });
    if (!askTrace.isConfirmed && !askTrace.isDenied) return;
    const includeTrace = askTrace.isConfirmed;

    const selector = await openProductsScopeSelector('Selector de productos');
    if (!selector.isConfirmed) return;

    const excluded = new Set(selector.value.mode === 'exclude' ? selector.value.selected : []);
    const scopedRows = rows.filter((row) => !excluded.has(row.ingredientId));
    const printableImageMap = includeImages
      ? await preloadImages(scopedRows.flatMap((row) => row.invoiceImageUrls || []).concat(scopedRows.map((row) => row.ingredientImageUrl)))
      : {};
    const printableImageSrc = (url) => printableImageMap[url] || url;
    const renderPrintableAttachment = (row, url, idx) => {
      const caption = `${row.ingredientName} · ${row.entryDate} · ${idx + 1}`;
      if (isPdfAttachmentUrl(url)) {
        return `<figure style="margin:0;border:1px solid #d7def2;border-radius:12px;padding:10px;background:#fff;"><div style="min-height:120px;display:flex;align-items:center;justify-content:center;border:1px dashed #b9c8eb;border-radius:10px;color:#31569b;font-weight:800;">PDF adjunto</div><figcaption style="font-size:12px;color:#4b5f8e;margin-top:6px;">${escapeHtml(caption)}</figcaption><a href="${escapeHtml(url)}" target="_blank" rel="noopener" style="font-size:11px;color:#31569b;">Abrir PDF</a></figure>`;
      }
      return `<figure style="margin:0;border:1px solid #d7def2;border-radius:12px;padding:10px;background:#fff;"><img src="${escapeHtml(printableImageSrc(url))}" style="width:100%;max-height:320px;object-fit:contain;border-radius:10px;"/><figcaption style="font-size:12px;color:#4b5f8e;margin-top:6px;">${escapeHtml(caption)}</figcaption></figure>`;
    };

    const grouped = scopedRows.reduce((acc, row) => {
      acc[row.ingredientId] = acc[row.ingredientId] || [];
      acc[row.ingredientId].push(row);
      return acc;
    }, {});

    const content = Object.keys(grouped).map((ingredientId) => {
      const productRows = grouped[ingredientId];
      const head = productRows[0];
      const tableRows = productRows.flatMap((row) => {
        const expiryMeta = getEntryExpiryMeta(row); const expiryBadge = getExpiryBadgeText(row); const detail = formatEntryDetailLabel(row); const strikeClass = expiryMeta.isExpired ? ' style="text-decoration:line-through;font-weight:700;color:#b42338"' : ''; const mainRow = `<tr${expiryMeta.isExpired ? ' style="background:#ffecef"' : ''}><td>${escapeHtml(row.entryDateTime)}</td><td>${escapeHtml(row.noPerecedero ? 'No perecedero' : (row.expiryDate || 'No perecedero'))}${expiryBadge ? `<br><small style="color:#b42338;font-weight:700">${escapeHtml(expiryBadge)}</small>` : ''}</td><td><span${strikeClass}>${escapeHtml(detail.qtyLabel)}</span><br><small${strikeClass}>${escapeHtml(detail.availableLabel)}</small></td><td><span${strikeClass}>${escapeHtml(detail.qtyLabel)}</span></td><td>${escapeHtml(row.invoiceNumber)}</td><td class="inventario-provider-cell">${escapeHtml(row.provider)}</td><td>${includeImages ? (row.invoiceImageUrls?.length ? `Ver adjunto (${row.invoiceImageUrls.length})` : 'Sin adjunto') : (row.invoiceImageUrls?.length ? `Posee ${row.invoiceImageUrls.length} adjunto/s` : 'Sin adjunto')}</td></tr>`;
        const resolution = getEntryResolutionRowData(row);
        const resolutionRow = resolution ? `<tr style="background:#fff6d9;"><td>${escapeHtml(`↳ ${formatDateTime(resolution.at)}`)}</td><td>${escapeHtml(row.noPerecedero ? 'No perecedero' : (row.expiryDate || 'No perecedero'))}</td><td>${escapeHtml(`-${resolution.resolvedKg.toFixed(2)} kilos`)}</td><td>${escapeHtml(resolution.badge)}</td><td>${escapeHtml(row.invoiceNumber || '-')}</td><td class="inventario-provider-cell">${escapeHtml(row.provider || '-')}</td><td>Resolución</td></tr>` : '';
        if (!includeTrace) return [mainRow, resolutionRow].filter(Boolean);
        const traceRows = buildTraceRowsForEntry(row).map((trace) => `<tr style="background:#ffecef;"><td>${escapeHtml(`↳ ${trace.fechaHora}`)}</td><td>${escapeHtml(trace.fechaCaducidad || '-')}</td><td>${escapeHtml(trace.cantidad)}</td><td>${escapeHtml(trace.factura)}</td><td>${escapeHtml(trace.proveedor)}</td><td class="inventario-provider-cell">Trazabilidad</td><td></td></tr>`);
        return [mainRow, resolutionRow, ...traceRows].filter(Boolean);
      }).join('');
      return `<section style="margin-bottom:14px;"><div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">${head.ingredientImageUrl ? `<img src="${escapeHtml(printableImageSrc(head.ingredientImageUrl))}" style="width:62px;height:62px;border-radius:999px;object-fit:cover;border:1px solid #d7def2;">` : ''}<div><h2 style="margin:0;font-size:18px;">${escapeHtml(head.ingredientName)}</h2><p style="margin:0;color:#55607f;font-size:12px;">${escapeHtml(head.ingredientDescription)}</p></div></div><table><thead><tr><th>Fecha y hora</th><th>Fecha vencimiento</th><th>Cantidad / Disp.</th><th class="is-num">Cantidad</th><th>N° factura</th><th>Proveedor</th><th>Imagen</th></tr></thead><tbody>${tableRows}</tbody></table></section>`;
    }).join('');

    const imagesHtml = includeImages
      ? `<section><h2 style="margin:16px 0 10px;font-size:18px;">Imágenes adjuntas del período</h2><div style="display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));">${scopedRows.flatMap((row) => (row.invoiceImageUrls || []).map((url, idx) => renderPrintableAttachment(row, url, idx))).join('')}</div></section>`
      : '';

    const win = window.open('', '_blank', 'width=1300,height=900');
    if (!win) return;
    const range = parseRangeValue(state.dashboardDateRange);
    const title = range.from && range.to ? `Ingresos del ${range.from.split('-').reverse().join('/')} al ${range.to.split('-').reverse().join('/')}` : 'Ingresos por período • La Jamonera';
    win.document.write(`<html><head><title>${title}</title><style>body{font-family:Inter,Arial;padding:20px;color:#1f2a44}table{width:100%;border-collapse:collapse}th,td{border:1px solid #d7def2;padding:6px;font-size:11px}th{background:#eef3ff;font-size:10px;text-transform:uppercase;letter-spacing:.04em}</style></head><body><h1>${title}</h1>${content || '<p>Sin datos.</p>'}${imagesHtml}</body></html>`);
    win.document.close();
    win.focus();
    await waitPrintAssets(win);
    win.print();
  };

  const openIngresosWeeklySheet = async (rows) => {
    const forcedRange = await askRequiredRangeForIngresosSheet();
    if (!forcedRange) return;
    const rangedRows = (Array.isArray(rows) ? rows : []).filter((row) => inDateRange(row.entryDate, forcedRange.from, forcedRange.to));

    const typeAsk = await openIosSwal({
      title: 'Generar planilla de artículos',
      html: '<p>Elegí el tipo de materias primas a incluir en esta planilla semanal. Se procesarán únicamente ingresos dentro del rango seleccionado y luego se completarán temperaturas estimadas para recepción.</p>',
      showCancelButton: true,
      showDenyButton: true,
      confirmButtonText: 'Perecederos',
      denyButtonText: 'No perecederos',
      cancelButtonText: 'Cancelar',
      customClass: {
        confirmButton: 'ios-btn-success',
        denyButton: 'ios-btn-danger ios-btn-deny-critical',
        cancelButton: 'ios-btn-secondary'
      }
    });
    if (!typeAsk.isConfirmed && !typeAsk.isDenied) return;
    const targetPerishable = typeAsk.isConfirmed;

    const selector = await openProductsScopeSelector('Selector de productos', { targetPerishable });
    if (!selector.isConfirmed) return;

    const managers = await openManagersSelector();
    if (!managers) return;

    const excluded = new Set(selector.value.mode === 'exclude' ? selector.value.selected : []);
    const scopedRows = rangedRows
      .filter((row) => !excluded.has(row.ingredientId))
      .filter((row) => {
        const perishable = resolveIngredientPerishableFlag(row.ingredientId);
        return targetPerishable ? perishable : !perishable;
      });

    if (!scopedRows.length) {
      await openIosSwal({ title: 'Sin resultados', html: '<p>No hay ingresos para el tipo de artículo seleccionado.</p>', icon: 'warning' });
      return;
    }

    const groupedWeeks = scopedRows.reduce((acc, row) => {
      const weekStart = mondayStartIso(row.entryDate || row.entryDateTime || '');
      if (!weekStart) return acc;
      const weekEnd = addIsoDays(weekStart, 6);
      const key = `${weekStart}|${weekEnd}`;
      if (!acc[key]) acc[key] = { weekStart, weekEnd, rows: [] };
      acc[key].rows.push(row);
      return acc;
    }, {});

    const weeks = Object.values(groupedWeeks).sort((a, b) => a.weekStart.localeCompare(b.weekStart));
    const allRows = weeks.flatMap((week) => week.rows);
    await preloadImages(allRows.map((row) => row.ingredientImageUrl).filter(Boolean));

    await Swal.fire({
      title: 'Generando planilla...',
      html: '<div class="informes-saving-spinner"><sl-spinner class="meta-spinner-login" aria-label="Generando"></sl-spinner></div>',
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false,
      customClass: { popup: 'ios-alert produccion-loading-alert', title: 'ios-alert-title', htmlContainer: 'ios-alert-text' },
      didOpen: async () => {
        try {
          await new Promise((resolve) => setTimeout(resolve, 350));
          Swal.update({ html: '<div class="informes-saving-spinner"><sl-spinner class="meta-spinner-login" aria-label="IA"></sl-spinner></div><p>Obteniendo temperaturas...</p>' });
          const tempMap = await estimateIngresoTemperatures(allRows);
          const weekSections = weeks.map((week, weekIndex) => {
            const managersPrintHtml = managers.selectedUsers.length
              ? managers.selectedUsers.map((user) => `
                <span class="sheet-manager-line">
                  <strong>${escapeHtml(String(user.fullName || '').toUpperCase())}</strong>
                  <small>${escapeHtml(String(user.role || 'ENCARGADO').toUpperCase())}</small>
                </span>
              `).join('')
              : '<span class="sheet-manager-line"><strong>SIN ENCARGADO</strong></span>';
            const rowsHtml = week.rows.map((row) => {
              const tempKey = `${row.ingredientId}|${row.entryId}`;
              const temp = tempMap[tempKey] || '-';
              const vtoLabel = row.noPerecedero ? 'No perecedero' : (row.expiryDate || 'No perecedero');
              const productUp = String(row.ingredientName || '-').toUpperCase();
              const productDescription = normalizeValue(row.ingredientDescription || 'SIN DESCRIPCIÓN');
              const productImage = row.ingredientImageUrl
                ? `<span class="sheet-mini-avatar"><img src="${(window.ljThumb || String)(escapeHtml(row.ingredientImageUrl))}" alt="${escapeHtml(productUp)}"></span>`
                : '';
              const qtyLabel = `${Number(row.qty || 0).toFixed(2)} ${String(row.unit || '').toUpperCase()}${row.packageQty ? ` X${row.packageQty}` : ''}`;
              const provider = resolveProvider(row.provider);
              const providerName = provider?.name || String(row.provider || '-').toUpperCase();
              const providerRne = normalizeValue(provider?.rne?.number);
              const providerMeta = normalizeValue(provider?.email || provider?.phone || '');
              const providerPhoto = sanitizeImageUrl(provider?.photoUrl);
              const providerInitial = providerInitials(providerName);
              const providerAvatarHtml = providerPhoto
                ? `<span class="sheet-provider-avatar"><img src="${(window.ljThumb || String)(escapeHtml(providerPhoto))}" alt="${escapeHtml(providerName)}"></span>`
                : `<span class="sheet-provider-avatar sheet-provider-avatar-fallback">${escapeHtml(providerInitial)}</span>`;
              const facturaUp = `${String(row.invoiceNumber || '-').toUpperCase()}${normalizeValue(row.remitoNumber) ? ` | ${String(row.remitoNumber).toUpperCase()}` : ''}`;
              const loteUp = String(row.lotNumber || row.invoiceNumber || '-').toUpperCase();
              const vtoUp = String(vtoLabel || 'NO PERECEDERO').toUpperCase();
              return `<tr class="sheet-product-row">
                <td colspan="9">
                  <div class="sheet-entry-product-wrap sheet-entry-product-wrap-full">
                    ${productImage || '<span class="sheet-mini-avatar sheet-mini-avatar-empty"><i class="fa-solid fa-box"></i></span>'}
                    <div class="sheet-entry-product-copy">
                      <h3>${escapeHtml(productUp)}</h3>
                      <p class="sheet-entry-product-description" title="${escapeHtml(productDescription)}"><span class="sheet-entry-product-divider" aria-hidden="true"></span><span>${escapeHtml(productDescription)}</span></p>
                    </div>
                  </div>
                </td>
              </tr>
              <tr>
                <td>${escapeHtml(productUp)}</td>
                <td>${escapeHtml(formatShortDateTimeEs(row.createdAt))}</td>
                <td>${escapeHtml(qtyLabel)}</td>
                <td>${escapeHtml(facturaUp)}</td>
                <td>${escapeHtml(loteUp)}</td>
                <td>${escapeHtml(vtoUp)}</td>
                <td>${escapeHtml(`${temp} °C`)}</td>
                <td><div class="sheet-manager-cell">${managersPrintHtml}</div></td>
                <td>
                  <div class="sheet-provider-wrap">
                    ${providerAvatarHtml}
                    <div class="sheet-provider-copy">
                      <strong>${escapeHtml(providerName)}</strong>
                      <small>${providerRne ? `RNE ${escapeHtml(providerRne)}` : escapeHtml(providerMeta || 'PROVEEDOR')}</small>
                    </div>
                  </div>
                </td>
              </tr>`;
            }).join('');
            const from = formatIsoDateEs(week.weekStart);
            const to = formatIsoDateEs(week.weekEnd);
            const tipoHeader = targetPerishable ? 'PERECEDERAS' : 'NO PERECEDERAS';
            const footer = targetPerishable
              ? '*LOTE: MATERIAS PRIMAS CONGELADAS O AL VACIO (CON ROTULO)<br>CS: CERTIFICADO SANITARIO'
              : 'LOTE. SI LA MATERIA PRIMA TRAE NUMERO DE LOTE SE COPIA.<br>SI NO VIENE CON NUMERO DE LOTE, SE TOMA FECHA DE VENCIMIENTO COMO NUMERO DE LOTE.<br>RECHAZO, SI ES SI, COLOCAR EN OBSERVACIONES MOTIVOS, EJ: CERCANO A SU FECHA DE VENCIMIENTO, PAQUETES DAÑADOS, ETC.';
            return `<section style="${weekIndex ? 'page-break-before:always;' : ''}">
              <header class="sheet-header">
                <div class="sheet-week-block">
                  <p class="sheet-week-label">Planilla semanal</p>
                  <h1 class="sheet-main-week">SEMANA DE ${from} A ${to}</h1>
                </div>
                <div class="sheet-company-block"><strong>FRIGORÍFICO • LA JAMONERA S.A.</strong><small>REGISTRO INGRESO DE MATERIAS PRIMAS</small><small>${tipoHeader}</small></div>
              </header>
              <div class="sheet-entries-wrap">${rowsHtml
                ? `<table class="sheet-entry-data-table">
                    <thead>
                      <tr>
                        <th>Materia Prima</th>
                        <th>Fecha y hora</th>
                        <th class="is-num">Cantidad</th>
                        <th>Factura / Remito</th>
                        <th>Lote</th>
                        <th>Vencimiento</th>
                        <th>Temperatura</th>
                        <th>Recibió</th>
                        <th>Proveedor</th>
                      </tr>
                    </thead>
                    <tbody>${rowsHtml}</tbody>
                  </table>`
                : '<p>Sin ingresos</p>'}</div>
              <footer style="margin-top:12px;border-top:1px dashed #aebde4;padding-top:8px;font-size:11px;line-height:1.4;color:#293b68;"><strong>NOTAS:</strong><br>${footer}</footer>
            </section>`;
          }).join('');

          const win = window.open('', '_blank', 'width=1400,height=900');
          if (!win) return;
          win.document.write(`<html><head><title>Planilla de ingresos</title><style>@page{size:portrait;margin:8mm;}body{font-family:Inter,Arial,sans-serif;color:#1f2a44;padding:4px;background:#f7f9ff;}.sheet-header{display:flex;justify-content:space-between;align-items:stretch;gap:8px;margin-bottom:8px;}.sheet-week-block{border:1px solid #c8d4f0;border-radius:10px;background:#fff;padding:7px 10px;display:grid;align-content:center;min-width:0;}.sheet-week-label{margin:0 0 2px;color:#6073a1;font-size:10px;text-transform:uppercase;letter-spacing:.04em;}.sheet-main-week{font-size:16px;margin:0;letter-spacing:.03em;line-height:1.15;}.sheet-company-block{border:1px solid #c8d4f0;border-radius:10px;background:#fff;padding:7px 10px;line-height:1.2;display:grid;align-content:center;min-width:260px;}.sheet-company-block strong{font-size:11px;}.sheet-company-block small{font-size:9px;color:#4f628f;font-weight:700;}.sheet-entries-wrap{display:grid;gap:0;}.sheet-entry-product-wrap{display:flex;gap:8px;align-items:center;justify-content:center;min-width:0;}.sheet-entry-product-wrap-full{justify-content:flex-start;}.sheet-mini-avatar,.sheet-provider-avatar{width:25px;height:25px;border-radius:999px;border:1px solid #d2dbef;overflow:hidden;display:inline-flex;align-items:center;justify-content:center;background:#edf2ff;color:#3a5898;flex-shrink:0;}.sheet-mini-avatar img,.sheet-provider-avatar img{width:100%;height:100%;object-fit:cover;}.sheet-mini-avatar-empty{font-size:10px;}.sheet-entry-product-copy{min-width:0;max-width:100%;text-align:left;display:flex;align-items:center;gap:8px;}.sheet-entry-product-copy h3{margin:0;font-size:13px;line-height:1.1;white-space:nowrap;}.sheet-entry-product-description{margin:0;display:flex;align-items:center;gap:8px;min-width:0;max-width:100%;color:#586a92;font-size:9px;font-weight:700;}.sheet-entry-product-description span:last-child{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block;}.sheet-entry-product-divider{display:inline-block;width:1px;height:14px;background:#9baed9;flex-shrink:0;}.sheet-provider-wrap{display:flex;gap:6px;align-items:center;justify-content:center;}.sheet-provider-avatar-fallback{font-size:10px;font-weight:800;color:#2f5db1;}.sheet-provider-copy{text-align:center;}.sheet-provider-copy strong{display:block;font-size:10px;line-height:1.1;}.sheet-provider-copy small{display:block;color:#6f7fa3;font-size:8px;line-height:1.1;}.sheet-entry-data-table{width:100%;margin-top:5px;border-collapse:collapse;table-layout:fixed;}.sheet-entry-data-table thead{display:table-header-group;}.sheet-entry-data-table th,.sheet-entry-data-table td{border:1px solid #dbe4f6;padding:4px 3px;font-size:8px;line-height:1.15;text-align:center;vertical-align:middle;}.sheet-entry-data-table th{background:#fff;color:#000;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.02em;}.sheet-product-row td{background:#f4f7ff;font-weight:800;}.sheet-entry-data-table td:nth-child(3),.sheet-entry-data-table td:nth-child(4),.sheet-entry-data-table td:nth-child(5),.sheet-entry-data-table td:nth-child(6){font-weight:700;}.sheet-manager-cell{display:grid;gap:2px;justify-items:center;}.sheet-manager-line{display:grid;line-height:1.1;}.sheet-manager-line strong{font-size:8px;}.sheet-manager-line small{font-size:7px;color:#5f7097;font-weight:700;}footer{break-inside:avoid;margin-top:8px !important;padding-top:6px !important;font-size:9px !important;line-height:1.25 !important;}</style></head><body>${weekSections}</body></html>`);
          win.document.close();
          await waitPrintAssets(win);
          win.focus();
          win.print();
        } finally {
          Swal.close();
        }
      }
    });
  };

  const removeEntryWithSecurity = async (ingredientId, entryId) => {
    const confirm = await openIosSwal({
      title: 'Eliminar ingreso',
      html: '<p>Esta acción quitará la fila del historial y descontará su stock.</p>',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Continuar',
      cancelButtonText: 'Cancelar'
    });
    if (!confirm.isConfirmed) return false;

    const auth = await openIosSwal({
      title: 'Confirmación de seguridad',
      html: `<sl-input id="entryDeletePass" type="password" password-toggle class="swal2-input" placeholder="${window.ljSensitivePasswordLabel}"></sl-input>`,
      showCancelButton: true,
      confirmButtonText: 'Eliminar',
      cancelButtonText: 'Cancelar',
      customClass: {
        confirmButton: 'ios-btn-danger',
        cancelButton: 'ios-btn-secondary'
      },
      preConfirm: async () => {
        const enteredPass = normalizeValue(document.getElementById('entryDeletePass')?.value);
        if (!enteredPass) {
          Swal.showValidationMessage('Ingresá la contraseña.');
          return false;
        }
        if (!(await window.ljVerifySensitivePassword(enteredPass))) {
          Swal.showValidationMessage('Contraseña incorrecta.');
          return false;
        }
        return true;
      }
    });

    if (!auth.isConfirmed) return false;

    const record = getRecord(ingredientId);
    const entries = Array.isArray(record.entries) ? [...record.entries] : [];
    const entry = entries.find((item) => item.id === entryId);
    if (!entry) return false;

    record.entries = entries.filter((item) => item.id !== entryId);
    const nextStock = Number(record.stockKg || 0) - Number(getAvailableKg(entry) || 0);
    record.stockKg = Number(Math.max(0, nextStock).toFixed(4));
    record.hasEntries = record.entries.length > 0;
    if (!record.hasEntries) {
      record.stockUnit = '';
      record.stockBase = 0;
      record.packageQty = null;
      record.lowThresholdBase = null;
    }
    recomputeRecordStock(record, entry.unit || state.ingredientes[ingredientId]?.measure || 'kilos');

    state.inventario.items[ingredientId] = record;
    rebuildInventarioIndexes();
    await persistInventario({ itemIds: [ingredientId] });
    return true;
  };



  const editEntryWithSecurity = async (ingredientId, entryId) => {
    const record = getRecord(ingredientId);
    const entries = Array.isArray(record.entries) ? [...record.entries] : [];
    const idx = entries.findIndex((item) => item.id === entryId);
    if (idx < 0) return false;
    const entry = { ...entries[idx] };
    await window.laJamoneraReady;
    const usersMap = safeObject(await window.dbLaJamoneraRest.read('/informes/users'));
    const users = Object.values(usersMap).filter((user) => normalizeValue(user?.id) && window.ljPinIsSet(user));
    if (!users.length) {
      await openIosSwal({ title: 'Sin usuarios', html: '<p>No hay usuarios con clave para autorizar la edición.</p>', icon: 'warning', confirmButtonText: 'Entendido' });
      return false;
    }

    const form = await openIosSwal({
      title: 'Editar ingreso',
      width: 'min(760px, 96vw)',
      html: `<div class="swal-stack-fields text-start">
        <div class="inventario-bulk-grid"><sl-input id="editInventoryQty" class="swal2-input" type="number" min="0" step="0.01" value="${Number(entry.qty || 0)}"></sl-input><sl-input id="editInventoryInvoice" class="swal2-input" value="${escapeHtml(entry.invoiceNumber || '')}" placeholder="N° factura"></sl-input></div>
        <sl-input id="editInventoryRemito" class="swal2-input" value="${escapeHtml(entry.remitoNumber || '')}" placeholder="N° remito (opcional)"></sl-input>
        <div class="inventario-bulk-grid"><input id="editInventoryEntryDate" class="lj-input swal2-input" value="${escapeHtml(entry.entryDate || '')}" placeholder="Fecha ingreso"><input id="editInventoryExpiryDate" class="lj-input swal2-input" value="${escapeHtml(entry.expiryDate || '')}" placeholder="Fecha caducidad"></div>
        <sl-checkbox class="inventario-check-row inventario-check-row-compact" id="editInventoryNoPerecedero" ${entry.noPerecedero ? 'checked' : ''}>No perecedero</sl-checkbox>
        <sl-checkbox class="inventario-check-row inventario-check-row-compact" id="editInventoryUsoInternoEmpresa" ${entry.usoInternoEmpresa ? 'checked' : ''}>Envases primarios & más</sl-checkbox>
        <small class="text-muted">Auto egreso</small>
        <sl-select id="editInventoryProvider" class="swal2-select" hoist placeholder="Seleccionar proveedor" value="${ljOptionValue((sortedProviders().find((provider) => normalizeValue(entry.provider) === provider.id || normalizeUpper(entry.provider) === normalizeUpper(provider.name)) || {}).id || '')}">${sortedProviders().map((provider) => `<sl-option value="${ljOptionValue(provider.id)}">${escapeHtml(provider.name)}</sl-option>`).join('')}</sl-select>
        <label for="editInventoryFiles" class="inventario-upload-dropzone" id="editInventoryFilesDropzone"><i class="fa-regular fa-file-lines"></i><span>Adjuntar archivos (click o arrastrá)</span></label>
        <input id="editInventoryFiles" class="image-file-input inventario-hidden-file-input" type="file" accept="image/*,application/pdf" multiple>
        <small id="editInventoryFilesFeedback" class="inventario-file-feedback">Sin archivos seleccionados</small>
        <div class="inventario-bulk-grid"><sl-select id="editInventoryUser" class="swal2-select" hoist placeholder="Usuario que modifica">${users.map((user) => `<sl-option value="${ljOptionValue(user.id)}">${escapeHtml(user.fullName || user.email || user.id)}</sl-option>`).join('')}</sl-select><sl-input id="editInventoryPin" class="swal2-input" type="password" maxlength="4" placeholder="Clave del usuario"></sl-input></div>
      </div>`,
      showCancelButton: true,
      confirmButtonText: 'Guardar cambios',
      cancelButtonText: 'Cancelar',
      customClass: {
        popup: 'inventario-edit-entry-alert'
      },
      didOpen: () => {
        const noPer = document.getElementById('editInventoryNoPerecedero');
        const exp = document.getElementById('editInventoryExpiryDate');
        const fileInput = document.getElementById('editInventoryFiles');
        const dropzone = document.getElementById('editInventoryFilesDropzone');
        const feedback = document.getElementById('editInventoryFilesFeedback');

        const updateFilesFeedback = () => {
          const count = fileInput?.files?.length || 0;
          if (!feedback) return;
          feedback.textContent = count ? `${count} archivo(s) seleccionado(s)` : 'Sin archivos seleccionados';
        };

        fileInput?.addEventListener('change', updateFilesFeedback);
        dropzone?.addEventListener('dragover', (event) => {
          event.preventDefault();
          dropzone.classList.add('is-dragging');
        });
        dropzone?.addEventListener('dragleave', () => dropzone.classList.remove('is-dragging'));
        dropzone?.addEventListener('drop', (event) => {
          event.preventDefault();
          dropzone.classList.remove('is-dragging');
          setFilesOnInput(fileInput, event.dataTransfer?.files || []);
          updateFilesFeedback();
        });
        const sync = () => {
          if (!exp) return;
          exp.disabled = Boolean(noPer?.checked);
          if (noPer?.checked) exp.value = '';
        };
        noPer?.addEventListener('change', sync);
        sync();
        if (window.flatpickr) {
          ['editInventoryEntryDate', 'editInventoryExpiryDate'].forEach((id) => {
            const input = document.getElementById(id);
            if (!input) return;
            window.flatpickr(input, { locale: window.flatpickr.l10ns?.es || undefined, dateFormat: 'Y-m-d', altInput: true, altFormat: 'd/m/Y', allowInput: true, disableMobile: true });
          });
        }
      },
      preConfirm: async () => {
        const qty = parseNumber(document.getElementById('editInventoryQty')?.value);
        const invoice = normalizeValue(document.getElementById('editInventoryInvoice')?.value);
        const remito = normalizeValue(document.getElementById('editInventoryRemito')?.value);
        const entryDate = normalizeValue(document.getElementById('editInventoryEntryDate')?.value);
        const noPerecedero = Boolean(document.getElementById('editInventoryNoPerecedero')?.checked);
        const usoInternoEmpresa = Boolean(document.getElementById('editInventoryUsoInternoEmpresa')?.checked);
        const expiryDate = noPerecedero ? '' : normalizeValue(document.getElementById('editInventoryExpiryDate')?.value);
        const provider = providerLabel(normalizeValue(ljSelectValue(document.getElementById('editInventoryProvider'))));
        const userId = normalizeValue(ljSelectValue(document.getElementById('editInventoryUser')));
        const pin = normalizeValue(document.getElementById('editInventoryPin')?.value);
        const files = [...(document.getElementById('editInventoryFiles')?.files || [])];
        if (!Number.isFinite(qty) || qty <= 0) return Swal.showValidationMessage('Cantidad inválida.');
        if (!invoice) return Swal.showValidationMessage('Factura/remito obligatorio.');
        if (!entryDate) return Swal.showValidationMessage('Fecha de ingreso obligatoria.');
        if (!noPerecedero && !expiryDate) return Swal.showValidationMessage('Fecha de caducidad obligatoria.');
        if (!provider) return Swal.showValidationMessage('Proveedor obligatorio.');
        if (!userId || !usersMap[userId]) return Swal.showValidationMessage('Seleccioná usuario.');
        if (!(await window.ljVerifyPin({ ...usersMap[userId], id: usersMap[userId]?.id || userId }, pin))) return Swal.showValidationMessage('Clave incorrecta.');
        const urls = [...entryImageUrls(entry)];
        for (const file of files) {
          const message = validateInvoiceFile(file);
          if (message) return Swal.showValidationMessage(message);
          const uploaded = await uploadImageToStorage(file, 'inventario/facturas');
          if (uploaded) urls.push(uploaded);
        }
        return { qty, invoice, remito, entryDate, expiryDate, noPerecedero, usoInternoEmpresa, provider, userId, urls };
      }
    });

    if (!form.isConfirmed || !form.value) return false;
    const qtyValue = Number(form.value.qty.toFixed(2));
    const previousQty = Number(entry.qty || 0);
    const previousAvailable = Number(getAvailableQty(entry) || 0);
    const consumedQty = Math.max(0, previousQty - previousAvailable);
    const nextAvailableQty = Number(Math.max(0, qtyValue - consumedQty).toFixed(2));
    entry.qty = qtyValue;
    entry.qtyBase = Number(toBase(qtyValue, entry.unit || 'kilos').toFixed(6));
    entry.qtyKg = Number(convertToKg(qtyValue, entry.unit || 'kilos').toFixed(4));
    entry.availableQty = Math.min(qtyValue, nextAvailableQty);
    entry.availableBase = Number(toBase(entry.availableQty, entry.unit || 'kilos').toFixed(6));
    entry.availableKg = Number(convertToKg(entry.availableQty, entry.unit || 'kilos').toFixed(4));
    entry.invoiceNumber = form.value.invoice;
    entry.remitoNumber = form.value.remito;
    entry.entryDate = form.value.entryDate;
    entry.expiryDate = form.value.noPerecedero ? '' : form.value.expiryDate;
    entry.noPerecedero = Boolean(form.value.noPerecedero);
    entry.usoInternoEmpresa = Boolean(form.value.usoInternoEmpresa);
    entry.provider = form.value.provider;
    entry.invoiceImageUrls = form.value.urls;
    entry.invoiceImageUrl = form.value.urls[0] || '';
    entry.lastEditedAt = Date.now();
    entry.lastEditedBy = form.value.userId;

    entries[idx] = entry;
    record.entries = entries;
    recomputeRecordStock(record, record.stockUnit || entry.unit || 'kilos');
    state.inventario.items[ingredientId] = record;
    rebuildInventarioIndexes();
    await persistInventario({ itemIds: [ingredientId] });
    return true;
  };

  const buildEntryEditDraft = (ingredientId, record, entry) => {
    const urls = entryImageUrls(entry);
    const uploadItems = urls.map((url, index) => createExistingInvoiceUploadItem(url, index));
    const providerId = providerIdFromEntry(entry);
    const qtyValue = Number(entry?.qty || 0);
    return {
      qty: Number.isFinite(qtyValue) && qtyValue > 0 ? String(qtyValue) : '',
      unit: entry.unit || record.stockUnit || state.ingredientes[ingredientId]?.measure || 'kilos',
      packageQty: entry.packageQty ?? record.packageQty ?? '',
      entryDate: entry.entryDate || getArgentinaIsoDate(),
      expiryDate: entry.noPerecedero ? '' : (entry.expiryDate || ''),
      noPerecedero: Boolean(entry.noPerecedero),
      usoInternoEmpresa: Boolean(entry.usoInternoEmpresa),
      // Cargar el flag de congelado desde el entry persistido para que el tile
      // se muestre correctamente al editar un ingreso ya cargado.
      isFrozen: Boolean(entry.isFrozen || entry.frozen),
      // Marcamos los flags como "no vienen de preferencia" porque vienen del
      // entry real que se está editando — no queremos mostrar el badge ámbar.
      flagsFromPreferences: { noPerecedero: false, isFrozen: false, usoInternoEmpresa: false },
      invoiceNumber: entry.invoiceNumber || '',
      remitoNumber: normalizeValue(entry.remitoNumber || ''),
      customLot: normalizeValue(entry.customLot || ''),
      provider: providerId,
      invoiceImageFile: null,
      invoiceImageFiles: [],
      invoiceUploadItems: uploadItems,
      invoiceImageCountLabel: invoiceUploadSummary(uploadItems),
      editingEntryId: entry.id,
      tokens: [...record.lotConfig.tokens],
      customAcronym: normalizeValue(record.lotConfig.customAcronym),
      includeSeparator: Boolean(record.lotConfig.includeSeparator),
      separator: record.lotConfig.separator || '-',
      showLotConfig: !Boolean(record.lotConfig.configured || record.lotConfig.collapsed),
      bulkEntries: []
    };
  };

  const loadEntryIntoStockForm = (ingredientId, entryId) => {
    const record = getRecord(ingredientId);
    const entry = (Array.isArray(record.entries) ? record.entries : []).find((item) => item.id === entryId);
    if (!entry) return false;
    const draft = buildEntryEditDraft(ingredientId, record, entry);
    renderEditor(ingredientId, draft);
    requestAnimationFrame(() => {
      const target = nodes.editorForm?.querySelector('#inventoryQty') || nodes.editorForm?.querySelector('#inventarioStockEntrySection');
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const qtyInput = nodes.editorForm?.querySelector('#inventoryQty');
      qtyInput?.focus({ preventScroll: true });
      if (qtyInput && typeof qtyInput.select === 'function') qtyInput.select();
    });
    return true;
  };

  const clearEntryMovements = async (ingredientId, entryId) => {
    const record = getRecord(ingredientId);
    const entries = Array.isArray(record.entries) ? [...record.entries] : [];
    const idx = entries.findIndex((item) => item.id === entryId);
    if (idx < 0) return false;
    const entry = { ...entries[idx] };
    const movements = getEntryUsages(entry);
    if (!movements.length) return false;

    const confirm = await openIosSwal({
      title: 'Eliminar movimientos',
      html: `<div class="text-start"><p>Se van a eliminar todos los movimientos asociados a este ingreso.</p><small class="text-muted">El stock consumido por esos movimientos volverá a quedar disponible en este lote. Esta acción no elimina el ingreso ni sus adjuntos.</small></div>`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Eliminar movimientos',
      cancelButtonText: 'Cancelar',
      customClass: {
        confirmButton: 'ios-btn-danger inventario-clear-movements-confirm-btn',
        cancelButton: 'ios-btn-secondary'
      }
    });
    if (!confirm.isConfirmed) return false;

    openIosSwal({
      title: 'Eliminando movimientos...',
      html: '<div class="informes-saving-spinner"><sl-spinner class="meta-spinner-login" aria-label="Procesando"></sl-spinner></div>',
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false
    });
    await new Promise((resolve) => requestAnimationFrame(() => resolve()));

    try {
      const entryUnit = entry.unit || record.stockUnit || 'kilos';
      const qtyBase = Number.isFinite(Number(entry.qtyBase))
        ? Number(entry.qtyBase)
        : Number(toBase(Number(entry.qty || 0), entryUnit).toFixed(6));
      const currentAvailableBase = Number.isFinite(Number(entry.availableBase))
        ? Number(entry.availableBase)
        : Number(toBase(getAvailableQty(entry), entryUnit).toFixed(6));
      const restoredBase = movements.reduce((acc, movement) => {
        const usedQty = Number(movement?.usedQty);
        const usedUnit = normalizeValue(movement?.usedUnit || entryUnit);
        if (Number.isFinite(usedQty) && usedQty > 0) {
          return acc + Number(toBase(usedQty, usedUnit).toFixed(6));
        }
        const kilosUsed = Number(movement?.kilosUsed);
        if (Number.isFinite(kilosUsed) && kilosUsed > 0) {
          return acc + Number(toBase(kilosUsed, 'kilos').toFixed(6));
        }
        return acc;
      }, currentAvailableBase);
      const nextAvailableBase = Number(Math.min(qtyBase, Math.max(0, restoredBase)).toFixed(6));
      const nextAvailableQty = Number(fromBase(nextAvailableBase, entryUnit).toFixed(4));

      entry.productionUsage = [];
      entry.usoInternoEmpresa = false;
      entry.availableBase = nextAvailableBase;
      entry.availableQty = nextAvailableQty;
      entry.availableKg = Number(convertToKg(nextAvailableQty, entryUnit).toFixed(4));
      if (nextAvailableQty > 0.0001) entry.lotStatus = 'disponible';
      entry.lastEditedAt = Date.now();

      entries[idx] = entry;
      record.entries = entries;
      recomputeRecordStock(record, record.stockUnit || entryUnit);
      state.inventario.items[ingredientId] = record;
      rebuildInventarioIndexes();
      await persistInventario({ itemIds: [ingredientId] });
      return true;
    } catch (error) {
      await openIosSwal({ title: 'No se pudo eliminar', html: '<p>Ocurrió un error eliminando los movimientos.</p>', icon: 'error', confirmButtonText: 'Entendido' });
      return false;
    } finally {
      if (Swal.isVisible()) Swal.close();
    }
  };

  const renderEntryTable = (record) => {
    const source = Array.isArray(record.entries) ? [...record.entries] : [];
    const filtered = getFilteredEntries(source);
    const collapseMap = state.entryCollapseByIngredient[state.selectedIngredientId] || {};

    const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    state.tablePage = Math.min(Math.max(1, state.tablePage), pages);
    const start = (state.tablePage - 1) * PAGE_SIZE;
    const pageRows = filtered.slice(start, start + PAGE_SIZE);

    const rowsHtml = pageRows.length ? pageRows.map((entry, index) => {
      const traceRows = getEntryTraceRows(entry);
      const isCollapsed = collapseMap[entry.id] !== false;
      const expiryMeta = getEntryExpiryMeta(entry);
      const isExpiredAvailable = expiryMeta.isExpired;
      const resolutionMeta = getEntryResolutionMeta(entry);
      const resolutionLabel = resolutionMeta.badge;
      const resolutionRow = getEntryResolutionRowData(entry);
      const traceHtml = (!isCollapsed && traceRows.length)
        ? traceRows.map((trace) => `
        <tr class="${getTraceRowClass(trace)}">
          <td><div class="inventario-trace-main"><img src="./IMG/Octicons-git-merge.svg" alt="merge" class="inventario-trace-icon">${formatDateTime(trace.createdAt)}</div></td>
          <td>${getTraceTypeLabelHtml(trace)}</td>
          <td class="is-num inventario-trace-kilos">-${trace.displayAmount || formatUsageAmount(trace.kilosUsed)}</td>
          <td></td>
          <td>${escapeHtml(trace.ingredientLot)}</td>
          <td>${escapeHtml((trace.internalUse || isAutoGeneratedCounterTrace(trace)) ? providerLabel(entry.provider) : trace.productionId)}</td>
          <td>${(trace.internalUse || isAutoGeneratedCounterTrace(trace)) ? '<span class="recetas-tag tone-neu">Sin trazabilidad</span>' : `<sl-button variant="default" size="small" type="button" class="inventario-threshold-btn" data-open-production-trace="${escapeHtml(trace.productionId)}"><i slot="prefix" class="fa-solid fa-users-viewfinder"></i><span>Trazabilidad</span></sl-button>`}</td>
          <td></td>
        </tr>`).join('') : '';

      const availableQtyInUnit = getAvailableInUnit(entry, entry.unit || '');
      const availableClass = availableQtyInUnit <= 0.0001 ? 'is-zero' : '';
      const expiredQtyClass = isExpiredAvailable ? 'inventario-expired-strike' : '';
      const resolutionHtml = (!isCollapsed && resolutionRow) ? `<tr class="inventario-resolution-row"><td><div class="inventario-trace-main"><img src="./IMG/Octicons-git-merge.svg" alt="merge" class="inventario-trace-icon">${formatDateTime(resolutionRow.at)}</div></td><td><span class="inventario-resolution-badge">${escapeHtml(resolutionRow.badge)}</span></td><td class="is-num inventario-trace-kilos">-${resolutionRow.resolvedKg.toFixed(2)} kilos<br><span class="inventario-available-line is-zero">disp. ${resolutionRow.availableKg.toFixed(3)} kg</span></td><td class="is-code">${escapeHtml(entry.invoiceNumber || '-')}</td><td>${escapeHtml(entry.lotNumber || '-')}</td><td class="inventario-provider-cell">${escapeHtml(providerLabel(entry.provider))}</td><td><span class="recetas-tag tone-neu">Sin trazabilidad</span></td><td></td></tr>` : '';
      const canEditEntry = availableQtyInUnit > 0.0001;
      const hasMovements = getEntryUsages(entry).length > 0;
      return `
      <tr class="inventario-row-tone ${isEntryFrozen(entry) ? 'inventario-row-frozen' : ''} ${isExpiredAvailable ? 'is-expired-row' : ''} ${resolutionLabel ? 'is-resolution-row' : ''} ${index % 2 === 0 ? 'is-even-row' : 'is-odd-row'}">
        <td>${formatEntryDateTime(entry.entryDate, entry.createdAt)}${getExpiryBadgeHtml(entry) ? `<br><small>${getExpiryBadgeHtml(entry)}</small>` : ''}${isEntryFrozen(entry) ? `<br><small class="inventario-frozen-meta">${frozenBadgeHtml(entry)}</small>` : ''}</td>
        <td>${escapeHtml(formatExpiryForUi(entry))} </td>
        <td class="is-num"><span class="inv-qty ${expiredQtyClass}">${Number(entry.qty || 0).toFixed(2)} ${escapeHtml(entry.unit || '')}</span><br><span class="inventario-available-line ${availableClass} ${expiredQtyClass}">disp. ${getAvailableInUnit(entry, entry.unit).toFixed(2)} ${escapeHtml(getMeasureAbbr(entry.unit || ''))}${entry.packageQty ? ` x${entry.packageQty}` : ''}</span></td>
        <td class="is-code">${escapeHtml(entry.invoiceNumber || '-')}</td>
        <td class="is-code inventario-lot-cell">${escapeHtml(entry.lotNumber || '-')}${entry.customLot ? '<br><small class="text-muted">lote propio</small>' : ''}</td>
        <td class="inventario-provider-cell">${escapeHtml(providerLabel(entry.provider))}</td>
        <td>${entryImageUrls(entry).length ? `<sl-button variant="default" size="small" type="button" class="inventario-threshold-btn" data-open-invoice-image="${entry.id}"><i slot="prefix" class="fa-regular fa-image"></i><span>Ver (${entryImageUrls(entry).length})</span></sl-button>` : '<span class="recetas-tag tone-neu">Sin foto</span>'}</td>
        <td>
          <div class="inventario-entry-actions">
            ${traceRows.length ? `<sl-button variant="default" size="small" type="button" class="lj-icon-btn inventario-threshold-btn inventario-icon-only-btn" data-toggle-entry-collapse="${entry.id}" aria-label="Colapsar desglose" title="Colapsar desglose"><i class="fa-solid ${isCollapsed ? 'fa-chevron-down' : 'fa-chevron-up'}"></i></sl-button>` : ''}
            <sl-button variant="default" size="small" type="button" class="lj-icon-btn inventario-threshold-btn inventario-icon-only-btn" data-print-entry="${entry.id}" aria-label="Imprimir ingreso" title="Imprimir ingreso"><i class="fa-solid fa-print"></i></sl-button>
            <sl-button variant="default" size="small" type="button" class="lj-icon-btn inventario-threshold-btn inventario-icon-only-btn ${canEditEntry ? '' : 'is-disabled'}" data-edit-entry="${entry.id}" aria-label="Editar ingreso" title="Editar ingreso" ${canEditEntry ? '' : 'disabled'}><i class="fa-solid fa-pen"></i></sl-button>
            <div class="inventario-entry-more-wrap">
              <sl-button variant="default" size="small" type="button" class="lj-icon-btn inventario-threshold-btn inventario-icon-only-btn" data-entry-more="${entry.id}" aria-label="Más opciones" title="Más opciones"><i class="fa-solid fa-ellipsis-vertical"></i></sl-button>
              <div class="inventario-entry-more-menu d-none" data-entry-more-menu="${entry.id}">
                <sl-button variant="text" size="small" type="button" data-clear-entry-movements="${entry.id}" ${hasMovements ? '' : 'disabled'}><i slot="prefix" class="fa-solid fa-rotate-left"></i><span>Eliminar movimientos</span></sl-button>
              </div>
            </div>
            <sl-button variant="default" size="small" type="button" class="lj-icon-btn is-danger inventario-delete-btn inventario-threshold-btn inventario-icon-only-btn" data-delete-entry="${entry.id}" aria-label="Eliminar ingreso" title="Eliminar ingreso"><i class="fa-solid fa-trash"></i></sl-button>
          </div>
        </td>
      </tr>${resolutionHtml}${traceHtml}`;
    }).join('') : '<tr><td colspan="8" class="text-center">Sin ingresos para mostrar.</td></tr>';

    const canCollapse = canCollapseAnyRows(filtered, collapseMap);
    const canExpand = canExpandAnyRows(filtered, collapseMap);

    return `
      <div class="inventario-table-wrap">
        <div class="inventario-table-head enhanced">
          <sl-input id="inventarioEntriesSearch" type="search" autocomplete="off" placeholder="Buscar en ingresos" value="${escapeHtml(state.tableSearch)}"><i slot="prefix" class="fa-solid fa-magnifying-glass"></i></sl-input>
          <div class="inventario-history-toolbar">
            <div class="inventario-table-range">
              <input id="inventarioEntriesRange" class="lj-input" autocomplete="off" placeholder="Rango de fechas" value="${escapeHtml(state.tableDateRange)}">
            </div>
            <div class="inventario-print-row toolbar-scroll-x">
              <sl-button variant="default" type="button" class="inventario-delete-btn inventario-threshold-btn ${state.tableDateRange ? '' : 'd-none'}" id="inventarioClearFilterBtn"><i slot="prefix" class="fa-solid fa-xmark"></i><span>Limpiar filtro</span></sl-button>
              <sl-button variant="default" type="button" class="inventario-expand-btn inventario-threshold-btn" id="inventarioExpandTableBtn"><i slot="prefix" class="fa-solid fa-up-right-and-down-left-from-center"></i><span>Ampliar</span></sl-button>
              <sl-button variant="default" type="button" class="inventario-threshold-btn" id="inventarioExcelBtn"><i slot="prefix" class="fa-solid fa-file-excel"></i><span>Excel</span></sl-button>
              <span class="inventario-period-divider" aria-hidden="true"></span>
              <sl-button variant="default" type="button" class="inventario-threshold-btn" id="inventarioPrintFilteredBtn"><i slot="prefix" class="fa-solid fa-print"></i><span>Imprimir filtro</span></sl-button>
              <sl-button variant="default" type="button" class="inventario-threshold-btn" id="inventarioPrintAllBtn"><i slot="prefix" class="fa-solid fa-print"></i><span>Imprimir total</span></sl-button>
            </div>
            <div class="inventario-print-row toolbar-scroll-x">
              <sl-button variant="default" type="button" class="inventario-threshold-btn" id="inventarioCollapseAllRowsBtn" ${canCollapse ? '' : 'disabled'}><i slot="prefix" class="fa-solid fa-compress"></i><span>Colapsar todo</span></sl-button>
              <sl-button variant="default" type="button" class="inventario-threshold-btn" id="inventarioExpandAllRowsBtn" ${canExpand ? '' : 'disabled'}><i slot="prefix" class="fa-solid fa-expand"></i><span>Descolapsar todo</span></sl-button>
            </div>
          </div>
        </div>
        <div class="table-responsive inventario-table-compact-wrap">
          <table class="table recipe-table inventario-table-compact mb-0">
            <thead><tr><th>Fecha y hora</th><th>Fecha caducidad</th><th class="is-num">Cantidad</th><th>Nº factura</th><th>Lote</th><th>Proveedor</th><th>Imagen</th><th>Acción</th></tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
        <div class="inventario-pagination enhanced">
          <sl-button variant="default" size="small" type="button" class="lj-icon-btn inventario-threshold-btn inventario-page-btn" data-entry-page="prev" ${state.tablePage <= 1 ? 'disabled' : ''} aria-label="Página anterior" title="Página anterior"><i class="fa-solid fa-chevron-left"></i></sl-button>
          <span>Página ${state.tablePage} de ${pages}</span>
          <sl-button variant="default" size="small" type="button" class="lj-icon-btn inventario-threshold-btn inventario-page-btn" data-entry-page="next" ${state.tablePage >= pages ? 'disabled' : ''} aria-label="Página siguiente" title="Página siguiente"><i class="fa-solid fa-chevron-right"></i></sl-button>
        </div>
      </div>`;
  };

  const escapeHtml = (value) => String(value || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  const infiniteStockNoticeHtml = () => `<div class="inventario-infinite-stock-note"><i class="fa-solid fa-infinity" aria-hidden="true"></i><span>${escapeHtml(INFINITE_STOCK_NOTICE)}</span></div>`;


  const openExpandedTable = async (title, tableHtml) => {
    await openIosSwal({
      ljModal: true,
      title,
      html: `<div class="inventario-expand-wrap">${tableHtml}</div>`,
      width: '92vw',
      confirmButtonText: 'Cerrar',
      didOpen: (popup) => {
        popup.querySelectorAll('.js-open-expanded-image').forEach((button) => {
          button.addEventListener('click', async () => {
            const raw = button.dataset.images;
            if (!raw) return;
            try {
              const urls = JSON.parse(decodeURIComponent(raw));
              if (!Array.isArray(urls) || !urls.length) return;
              await openAttachmentViewer([{ invoiceImageUrls: urls }], 0, 'Imagen del ingreso');
            } catch (error) {
            }
          });
        });
      },
      customClass: {
        popup: 'ios-alert inventario-expand-alert',
        confirmButton: 'ios-btn-secondary'
      }
    });
  };

  const imageLinksText = (entry) => {
    const urls = entryImageUrls(entry);
    if (!urls.length) return '-';
    return urls.map((_, index) => `LINK ${index + 1}`).join(', ');
  };

  const buildExpandedImageCell = (urls = []) => {
    if (!urls.length) return 'Sin foto';
    return `<sl-button variant="default" size="small" type="button" class="inventario-threshold-btn js-open-expanded-image" data-images="${encodeURIComponent(JSON.stringify(urls))}"><i slot="prefix" class="fa-regular fa-image"></i><span>Ver (${urls.length})</span></sl-button>`;
  };

  const showExcelPreparing = () => {
    Swal.fire({
      title: 'Exportando Excel...',
      html: '<sl-spinner class="meta-spinner-login" aria-label="Exportando Excel"></sl-spinner>',
      allowOutsideClick: false,
      showConfirmButton: false,
      customClass: {
        popup: 'ios-alert ingredientes-alert ingredientes-saving-alert',
        title: 'ios-alert-title',
        htmlContainer: 'ios-alert-text ingredientes-saving-html'
      }
    });
  };

  const makeWorkbook = async ({ fileName, sheetName, headers, rows }) => {
    if (!window.ExcelJS) {
      await openIosSwal({ title: 'Excel no disponible', html: '<p>No se pudo cargar la librería ExcelJS.</p>', icon: 'error', confirmButtonText: 'Entendido' });
      return;
    }

    showExcelPreparing();
    try {
      const wb = new window.ExcelJS.Workbook();
      const ws = wb.addWorksheet(sheetName);
      ws.columns = headers.map((header) => ({ header, key: header, width: 24 }));
      ws.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: headers.length }
      };
      ws.views = [{ state: 'frozen', ySplit: 1 }];

      const headerRow = ws.getRow(1);
      headerRow.height = 24;
      headerRow.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F7AE8' } };
        cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFCED8EE' } },
          left: { style: 'thin', color: { argb: 'FFCED8EE' } },
          bottom: { style: 'thin', color: { argb: 'FFCED8EE' } },
          right: { style: 'thin', color: { argb: 'FFCED8EE' } }
        };
      });

      rows.forEach((data, index) => {
        const rowData = headers.reduce((acc, header) => {
          acc[header] = data[header] ?? '';
          return acc;
        }, {});
        const row = ws.addRow(rowData);
        row.height = 21;
        const tone = data.__tone === 'trace'
          ? 'FFFFECEF'
          : data.__tone === 'resolution_yellow'
            ? 'FFFFF6D9'
            : data.__tone === 'expired'
              ? 'FFFFECEF'
              : (index % 2 === 0 ? 'FFF5F8FF' : 'FFEAF1FF');
        row.eachCell((cell) => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: tone } };
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFD8E2F5' } },
            left: { style: 'thin', color: { argb: 'FFD8E2F5' } },
            bottom: { style: 'thin', color: { argb: 'FFD8E2F5' } },
            right: { style: 'thin', color: { argb: 'FFD8E2F5' } }
          };
          cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        });
        if (data.__tone === 'expired') {
          const qtyCol = headers.indexOf('Cantidad') + 1;
          if (qtyCol > 0) {
            const qtyCell = row.getCell(qtyCol);
            qtyCell.font = { ...(qtyCell.font || {}), strike: true, bold: true, color: { argb: 'FFB42338' } };
          }
        }

        const imgCol = headers.indexOf('Imágenes') + 1;
        if (imgCol > 0 && data.__firstImage) {
          const imageCell = row.getCell(imgCol);
          imageCell.note = data.__firstImage;
        }
      });

      const imgCol = headers.indexOf('Imágenes') + 1;
      if (imgCol > 0) {
        for (let rowIndex = 2; rowIndex <= ws.rowCount; rowIndex += 1) {
          const cell = ws.getCell(rowIndex, imgCol);
          const firstUrl = cell.note;
          if (firstUrl) {
            cell.value = { text: String(cell.value || 'LINK 1'), hyperlink: firstUrl };
            cell.font = { color: { argb: 'FF1F7AE8' }, underline: true };
          }
        }
      }

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([new Uint8Array(buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch (error) {
      await openIosSwal({ title: 'No se pudo exportar', html: '<p>Ocurrió un error generando el archivo Excel.</p>', icon: 'error', confirmButtonText: 'Entendido' });
    } finally {
      if (Swal.isVisible()) Swal.close();
    }
  };

  const parseExcelDateToIso = (value) => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      const excelEpoch = new Date(Date.UTC(1899, 11, 30));
      excelEpoch.setUTCDate(excelEpoch.getUTCDate() + Math.floor(value));
      return toIsoDate({
        year: excelEpoch.getUTCFullYear(),
        month: excelEpoch.getUTCMonth() + 1,
        day: excelEpoch.getUTCDate()
      });
    }
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return toIsoDate({
        year: value.getUTCFullYear(),
        month: value.getUTCMonth() + 1,
        day: value.getUTCDate()
      });
    }
    const text = normalizeValue(value);
    if (!text) return '';
    const normalized = normalizeIsoDate(text);
    if (normalized) return normalized;
    const esMatch = /^([0-9]{2})\/([0-9]{2})\/([0-9]{4})$/.exec(text);
    if (esMatch) return normalizeIsoDate(`${esMatch[3]}-${esMatch[2]}-${esMatch[1]}`);
    return '';
  };

  const alignScrollActionsToRight = (scope = document) => {
    const nodesToAlign = scope.querySelectorAll('.toolbar-scroll-x, .inventario-toolbar-actions, .produccion-toolbar-actions');
    requestAnimationFrame(() => {
      nodesToAlign.forEach((node) => {
        node.scrollLeft = node.scrollWidth;
      });
    });
  };

  const renderEditor = (ingredientId, draft = null) => {
    const ingredient = state.ingredientes[ingredientId];
    if (!ingredient) return;
    const record = getRecord(ingredientId);
    const expiringDays = currentExpiringDaysFor(record);

    // Aplicar preferencias guardadas de cargas anteriores (por ingrediente).
    // Si el usuario marcó congelado/no perecedero/autoegreso en la última carga,
    // se pre-tildan acá. La UI muestra una pista visual junto al tile.
    const flagPrefs = safeObject(record.flagPreferences);
    const hasFlagPrefs = Object.keys(flagPrefs).length > 0;
    const prefIsFrozen = Boolean(flagPrefs.isFrozen);
    const prefNoPerecedero = Boolean(flagPrefs.noPerecedero);
    const prefAutoEgreso = Boolean(flagPrefs.usoInternoEmpresa);

    const baseDraft = {
      qty: '',
      unit: record.stockUnit || ingredient.measure || 'kilos',
      packageQty: record.packageQty ?? '',
      entryDate: getArgentinaIsoDate(),
      expiryDate: prefIsFrozen
        ? addDaysToIso(getArgentinaIsoDate(), FROZEN_EXPIRY_DAYS)
        : addDaysToIso(getArgentinaIsoDate(), 5),
      noPerecedero: prefNoPerecedero,
      isFrozen: prefIsFrozen,
      usoInternoEmpresa: prefAutoEgreso,
      // Flags que vinieron pre-tildados desde preferencias (para mostrar el aviso).
      flagsFromPreferences: hasFlagPrefs
        ? { noPerecedero: prefNoPerecedero, isFrozen: prefIsFrozen, usoInternoEmpresa: prefAutoEgreso }
        : { noPerecedero: false, isFrozen: false, usoInternoEmpresa: false },
      invoiceNumber: '',
      remitoNumber: '',
      customLot: '',
      provider: '',
      invoiceImageFile: null,
      invoiceImageFiles: [],
      invoiceUploadItems: [],
      invoiceImageCountLabel: 'Sin archivos seleccionados',
      editingEntryId: '',
      tokens: [...record.lotConfig.tokens],
      customAcronym: normalizeValue(record.lotConfig.customAcronym),
      includeSeparator: Boolean(record.lotConfig.includeSeparator),
      separator: record.lotConfig.separator || '-',
      showLotConfig: !Boolean(record.lotConfig.configured || record.lotConfig.collapsed),
      bulkEntries: []
    };
    state.editorDraft = { ...baseDraft, ...(draft || {}) };
    if (!Array.isArray(state.editorDraft.invoiceUploadItems)) state.editorDraft.invoiceUploadItems = [];
    state.editorDraft.invoiceImageCountLabel = invoiceUploadSummary(state.editorDraft.invoiceUploadItems);
    state.selectedIngredientId = ingredientId;
    state.editorDirty = false;
    setStateView('editor');
    nodes.editorTitle.textContent = `Inventario · ${capitalize(ingredient.name)}`;

    const providers = sortedProviders();
    const providerSearchValue = findProviderById(state.editorDraft?.provider)?.name || '';
    const editingEntryId = normalizeValue(state.editorDraft?.editingEntryId);
    const isEditingEntry = Boolean(editingEntryId);
    const bulkEntries = isEditingEntry ? [] : (Array.isArray(state.editorDraft?.bulkEntries) ? state.editorDraft.bulkEntries : []);
    const infiniteStock = isInfiniteStockRecord(record);
    const stockDisabledAttr = infiniteStock ? 'disabled' : '';
    const stockUnit = record.stockUnit || ingredient.measure || state.editorDraft.unit || 'kilos';
    const stockBase = Number(record.stockBase || toBase(record.stockKg || 0, stockUnit)) || 0;
    const stockQty = fromBase(stockBase, stockUnit);
    const expiredRows = infiniteStock ? [] : getExpiredEntries(record);
    const expiringRows = infiniteStock ? [] : getExpiringSoonEntries(record);
    const expiredBase = expiredRows.reduce((acc, entry) => acc + toBase(entry.qty, entry.unit), 0);
    const expiredQtyInStockUnit = fromBase(expiredBase, stockUnit);
    const realAvailableQty = Math.max(0, stockQty - expiredQtyInStockUnit);
    const expiryRows = [
      ...expiredRows.map((entry) => ({ ...entry, type: 'expired' })),
      ...expiringRows.map((entry) => ({ ...entry, type: 'soon' }))
    ];
    const editorExpiryHtml = expiryRows.length
      ? `<div class="inventario-expiring-list inventario-expiring-list-editor">${expiryRows.map((entry) => {
        const pkg = entry.packageQty ? ` x${entry.packageQty}` : '';
        const lot = entry.lotNumber ? ` · lote ${escapeHtml(entry.lotNumber)}` : '';
        const when = entry.type === 'expired' ? `Expirado hace ${entry.diffDays} día(s)` : `Vence en ${entry.diffDays} día(s)`;
        return `<p class="inventario-expiring-line ${entry.type === 'expired' ? 'is-expired' : 'is-soon'}"><strong>${formatQtyUnit(entry.qty, entry.unit)}${pkg}</strong><span>${when}${lot}${entry.expiryDate ? ` · ${formatIsoDateEs(entry.expiryDate)}` : ''}</span></p>`;
      }).join('')}</div>`
      : '';
    const packageUnit = state.editorDraft.unit || stockUnit;
    const shouldShowPackageQty = getUnitMeta(packageUnit).category === 'unidad' || Number(record.packageQty) > 0;
    const editorStockHtml = infiniteStock
      ? `<strong class="inventario-infinity-symbol">&infin;</strong><span>Disponible sin control manual</span>`
      : `<strong class="${expiredQtyInStockUnit > 0.0001 ? 'inventario-expired-strike' : ''}">${formatQtyUnit(stockQty, stockUnit)}${record.packageQty ? ` x${record.packageQty}` : ''}</strong>${expiredQtyInStockUnit > 0.0001 ? `<span class="inventario-stock-real-line">Real ${formatQtyUnit(realAvailableQty, stockUnit)}${record.packageQty ? ` x${record.packageQty}` : ''}</span>` : ''}`;

    const lotOptionRows = LOT_TOKEN_OPTIONS.map((option) => `
      <sl-checkbox class="inventario-check-row" data-lot-check="${option.key}" ${state.editorDraft.tokens.includes(option.key) ? 'checked' : ''}>${option.label}</sl-checkbox>`).join('');

    const tokensHtml = state.editorDraft.tokens.map((token) => `
      <div class="inventario-token-chip" draggable="true" data-token="${token}">
        <i class="fa-solid fa-grip-vertical"></i>
        <span>${lotTokenLabelFor(token, state.editorDraft.customAcronym)}</span>
      </div>`).join('');

    nodes.editorForm.innerHTML = `
      <section class="inventario-product-head inventario-product-head-v2">
        <div class="inventario-product-head-main">
          <div class="inventario-editor-photo">${ingredientAvatar(ingredient)}</div>
          <div class="inventario-product-copy">
            <p class="inventario-editor-kicker">Inventario</p>
            <h6 class="inventario-editor-name">${capitalize(ingredient.name)}</h6>
            <p class="inventario-editor-meta">${sentenceCase(ingredient.description || 'Sin descripción')}</p>
            <p class="inventario-editor-measure">${getMeasureLabel(ingredient.measure || 'kilos')}</p>
          </div>
        </div>
          <div class="inventario-product-head-stats">
          <div class="inventario-total-banner">
            <small>Stock total actual</small>
            ${editorStockHtml}
          </div>
          <div class="inventario-stat-row">
            ${expiryRows.length ? `<div class="inventario-stat-card is-alert"><small>Lotes con vencimiento (${expiringDays} días)</small>${editorExpiryHtml}</div>` : ''}
          </div>
          <div class="inventario-head-actions-row">
            <div class="inventario-check-row inventario-check-row-compact inventario-infinite-toggle"><sl-switch id="inventarioInfiniteStockToggle" ${infiniteStock ? 'checked' : ''}>Stock infinito</sl-switch><sl-spinner class="meta-spinner d-none" id="inventarioInfiniteStockSpinner" aria-label="Guardando"></sl-spinner></div>
            <sl-button variant="default" type="button" class="inventario-head-action" id="inventarioProductThresholdBtn"><i slot="prefix" class="fa-solid fa-sliders"></i><span>Configurar umbrales</span></sl-button>
            <sl-button variant="default" type="button" class="inventario-head-action" id="inventarioWeeklySheetBtn"><i slot="prefix" class="fa-regular fa-file-lines"></i><span>Planilla Semanal</span></sl-button>
            <sl-button variant="success" type="button" id="inventarioEditIngredientBtn" class="inventario-head-action"><i slot="prefix" class="fa-solid fa-pen"></i><span>Editar ingrediente</span></sl-button>
          </div>
        </div>
      </section>

      ${infiniteStock ? infiniteStockNoticeHtml() : ''}

      <section class="recipe-step-card step-block inventario-lot-section">
        <div class="d-flex flex-wrap gap-2 align-items-center"><button type="button" class="lj-tile inventario-collapse-head inventario-collapse-head-styled" id="lotConfigToggleBtn" aria-expanded="${state.editorDraft.showLotConfig}">
          <span><span class="recipe-step-number">1</span> Configuración de lote</span>
          <span class="inventario-collapse-summary">${buildLotSummaryBadges(state.editorDraft)}</span>
        </div>
        <div id="lotConfigBody" class="step-content ${state.editorDraft.showLotConfig ? '' : 'd-none'}">
          <div class="inventario-check-grid">${lotOptionRows}</div>
          <div class="inventario-inline-fields">
            <sl-input id="lotCustomAcronym" placeholder="Ej: JAM" value="${escapeHtml(state.editorDraft.customAcronym)}" ${state.editorDraft.tokens.includes('siglas_personalizadas') ? '' : 'disabled'}></sl-input>
          </div>
          <sl-checkbox class="inventario-check-row" id="lotIncludeSeparator" ${state.editorDraft.includeSeparator ? 'checked' : ''}>Incluir separadores</sl-checkbox>
          <sl-select id="lotSeparator" class="inventario-lot-separator" hoist value="${ljOptionValue(LOT_SEPARATORS.includes(state.editorDraft.separator) ? state.editorDraft.separator : LOT_SEPARATORS[0])}" ${state.editorDraft.includeSeparator ? '' : 'disabled'}>
            ${LOT_SEPARATORS.map((sep) => `<sl-option value="${ljOptionValue(sep)}">${sep}</sl-option>`).join('')}
          </sl-select>
          <div class="inventario-lot-order" id="lotTokenOrder">${tokensHtml || '<div class="inventario-token-placeholder">Tildá opciones para generar badges.</div>'}</div>
          <code id="lotPatternPreview" class="inventario-lot-preview"></code>
          <div class="recipe-table-actions inventario-save-inline mt-2">
            <sl-button variant="default" type="button" id="saveLotConfigBtn" class="recipe-table-action-btn">
              <sl-spinner slot="prefix" class="meta-spinner d-none" id="saveLotConfigSpinner" aria-label="Guardando"></sl-spinner>
              <i slot="prefix" class="fa-solid fa-floppy-disk"></i>
              <span>Guardar configuración de lote</span>
            </sl-button>
          </div>
        </div>
      </section>

      <section class="recipe-step-card step-block">
        <div class="d-flex flex-wrap gap-2 align-items-center">
          <button type="button" class="lj-tile inventario-collapse-head inventario-collapse-head-styled" id="suggestedExpiryToggleBtn" aria-expanded="${!record.suggestedExpiryDays}">
            <span><span class="recipe-step-number">2</span> Días de vencimiento sugeridos</span>
            <span class="inventario-collapse-summary" id="suggestedExpirySummary">
              ${record.suggestedExpiryDays ? `<sl-badge variant="warning" pill class="inventario-suggest-badge"><i class="fa-solid fa-calendar-check me-1"></i> ${record.suggestedExpiryDays} días</sl-badge>` : ''}
            </span>
          </button>
        </div>
        <div id="suggestedExpiryBody" class="step-content ${record.suggestedExpiryDays ? 'd-none' : ''}">
          <div class="recipe-fields-flex">
            <div class="recipe-field recipe-field-half">
              <label class="lj-label" for="inventarioSuggestedExpiryDays"><i class="fa-solid fa-hourglass-half inventario-step-icon"></i> Días sugeridos</label>
              <sl-input id="inventarioSuggestedExpiryDays" type="number" min="0" step="1" value="${record.suggestedExpiryDays || ''}" placeholder="Ej: 5"></sl-input>
              ${record.suggestedExpiryDays ? `<div class="mt-2"><sl-badge variant="warning" pill class="inventario-suggest-badge"><i class="fa-solid fa-calendar-check me-1"></i> Sugerencia: ${record.suggestedExpiryDays} días</sl-badge></div>` : '<div class="mt-2"><sl-badge variant="neutral" pill class="inventario-suggest-badge is-empty">Sin sugerencia (default: 5)</sl-badge></div>'}
            </div>
            <div class="recipe-field recipe-field-half d-flex align-items-start pt-2">
               <div class="recipe-table-actions inventario-save-inline w-100 mt-4">
                <sl-button variant="default" type="button" id="saveSuggestedExpiryDaysBtn" class="recipe-table-action-btn w-100">
                  <sl-spinner slot="prefix" class="meta-spinner d-none" id="saveSuggestedExpiryDaysSpinner" aria-label="Guardando"></sl-spinner>
                  <i slot="prefix" class="fa-solid fa-floppy-disk"></i> <span>Guardar vencimiento</span>
                </sl-button>
              </div>
            </div>
            <div class="recipe-field recipe-field-full">
              <small class="text-muted">Al ingresar stock, se sumarán estos días a la fecha de ingreso para calcular el vencimiento automáticamente.</small>
            </div>
          </div>
        </div>
      </section>

      <section class="recipe-step-card step-block" id="inventarioStockEntrySection">
        <h6 class="step-title"><span class="recipe-step-number">3</span> ${isEditingEntry ? 'Editar ingreso' : 'Ingresar Stock'}</h6>
        ${isEditingEntry ? '<div class="inventario-editing-entry-note"><i class="fa-solid fa-pen"></i><span>Estás editando un ingreso existente. Guardá los cambios desde esta misma sección.</span></div>' : ''}
        <div class="step-content recipe-fields-flex inventario-stock-grid">
          <div class="recipe-field recipe-field-half">
            <label class="lj-label" for="inventoryQty"><i class="fa-solid fa-weight-hanging inventario-step-icon"></i> Cantidad a ingresar</label>
            <sl-input id="inventoryQty" type="number" autocomplete="off" min="0" step="0.01" value="${escapeHtml(String(state.editorDraft.qty ?? ''))}" ${stockDisabledAttr}></sl-input>
          </div>
          <div class="recipe-field recipe-field-half">
            <label class="lj-label" for="inventoryUnit"><i class="fa-solid fa-ruler-combined inventario-step-icon"></i> Unidad</label>
            <sl-select id="inventoryUnit" hoist value="${ljOptionValue((state.measures.find((m) => measureKey(m.name) === measureKey(state.editorDraft.unit)) || state.measures[0] || { name: 'add_measure' }).name)}" ${(record.stockUnit || infiniteStock) ? 'disabled' : ''}>
              ${state.measures.map((m) => `<sl-option value="${ljOptionValue(m.name)}">${escapeHtml(getMeasureLabel(m.name))}</sl-option>`).join('')}
              <sl-option value="add_measure">+ Agregar medida</sl-option>
            </sl-select>
            ${infiniteStock ? '<small class="text-muted">Unidad bloqueada por stock infinito.</small>' : (record.stockUnit ? `<small class="text-muted d-block">Unidad bloqueada según ingresos previos.</small><sl-button variant="default" size="small" type="button" class="inventario-threshold-btn mt-1" data-mass-unit-change><i slot="prefix" class="fa-solid fa-right-left"></i><span>Cambiar unidad masivamente</span></sl-button>` : '')}
          </div>
          <div class="recipe-field recipe-field-half ${shouldShowPackageQty ? '' : 'd-none'}" id="inventoryPackageQtyWrap">
            <label class="lj-label" for="inventoryPackageQty"><i class="fa-solid fa-box inventario-step-icon"></i> Cantidad por paquete (opcional)</label>
            <sl-input id="inventoryPackageQty" type="number" min="1" step="1" value="${escapeHtml(String(state.editorDraft.packageQty || ''))}" ${(record.packageQty || infiniteStock) ? 'disabled' : ''}></sl-input>
            ${record.packageQty ? `<small class="text-muted">Fijado en ${record.packageQty} para este ingrediente.</small>` : ''}
          </div>
          <div class="recipe-field recipe-field-half">
            <label class="lj-label" for="inventoryEntryDate"><i class="fa-regular fa-calendar-plus inventario-step-icon"></i> Fecha de ingreso</label>
            <input id="inventoryEntryDate" class="lj-input" autocomplete="off" value="${escapeHtml(state.editorDraft.entryDate)}" placeholder="Seleccionar fecha" ${stockDisabledAttr}>
          </div>
          <div class="recipe-field recipe-field-half">
            <label class="lj-label" for="inventoryExpiryDate"><i class="fa-regular fa-calendar-check inventario-step-icon"></i> Fecha de caducidad</label>
            <input id="inventoryExpiryDate" class="lj-input" autocomplete="off" value="${escapeHtml(state.editorDraft.expiryDate)}" placeholder="Seleccionar fecha" ${(state.editorDraft.noPerecedero || state.editorDraft.isFrozen || infiniteStock) ? 'disabled' : ''}>
            ${state.editorDraft.isFrozen ? `<small class="text-muted d-block mt-1"><sl-icon name="info-circle" class="me-1"></sl-icon>Vencimiento fijo a <strong>${FROZEN_EXPIRY_DAYS} días</strong> desde la fecha de ingreso.</small>` : ''}
          </div>
          <div class="recipe-field recipe-field-half">
            <label class="lj-label" for="inventoryInvoiceNumber"><i class="fa-solid fa-file-invoice inventario-step-icon"></i> Número de factura</label>
            <sl-textarea id="inventoryInvoiceNumber" name="inventory_code_free" class="inventario-invoice-textarea" rows="1" resize="none" placeholder="Ej: A-000123" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" inputmode="text" value="${escapeHtml(state.editorDraft.invoiceNumber)}" ${stockDisabledAttr}></sl-textarea>
            <small id="inventoryInvoiceFeedback" class="inventario-field-feedback" role="status"></small>
          </div>
          <div class="recipe-field recipe-field-half">
            <label class="lj-label" for="inventoryRemitoNumber"><i class="fa-regular fa-file-lines inventario-step-icon"></i> Número de remito (opcional)</label>
            <sl-input id="inventoryRemitoNumber" name="inventory_remito_free" placeholder="Ej: R-0001-00045678" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" inputmode="text" value="${escapeHtml(state.editorDraft.remitoNumber || '')}" ${stockDisabledAttr}></sl-input>
          </div>
          <div class="recipe-field recipe-field-half">
            <label class="lj-label" for="inventoryCustomLot"><i class="fa-solid fa-barcode inventario-step-icon"></i> Lote propio del producto (opcional)</label>
            <sl-input id="inventoryCustomLot" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" placeholder="Ej: L4521-A (lote de fábrica)" value="${escapeHtml(state.editorDraft.customLot || '')}" ${stockDisabledAttr}></sl-input>
            <small class="text-muted">Si el producto trae su propio lote (ej: condimentos), cargalo acá: reemplaza al lote automático sólo para este ingreso.</small>
          </div>
          <div class="recipe-field recipe-field-half">
            <label class="lj-label" for="inventoryProviderSearch"><sl-icon name="box-seam-fill" class="inventario-step-icon"></sl-icon> Proveedor</label>
            <div class="recipe-ing-autocomplete">
              <div class="recipe-ing-input-wrap">
                <span class="recipe-inline-avatar-wrap recipe-inline-avatar-fallback"><span class="recipe-small-placeholder"><i class="fa-solid fa-truck-field"></i></span></span>
                <sl-input id="inventoryProviderSearch" type="search" placeholder="Buscar proveedor..." value="${escapeHtml(providerSearchValue)}" autocomplete="new-password" autocapitalize="off" autocorrect="off" spellcheck="false" ${stockDisabledAttr}></sl-input>
              </div>
            </div>
            <input type="hidden" id="inventoryProvider" value="${escapeHtml((providers.some((provider) => provider.id === normalizeValue(state.editorDraft.provider)) || normalizeValue(state.editorDraft.provider) === 'add_provider') ? normalizeValue(state.editorDraft.provider) : '')}" ${stockDisabledAttr}>
          </div>
          <div class="recipe-field recipe-field-full inventario-flags-block">
            <div class="inventario-flags-head">
              <sl-icon name="tags-fill"></sl-icon>
              <span>Tipo de producto</span>
              <small class="text-muted">Marcá las opciones que correspondan</small>
            </div>
            <div class="inventario-flags-grid">
              ${[
                {
                  flag: 'noperecedero',
                  inputId: 'inventoryNoPerecedero',
                  checked: state.editorDraft.noPerecedero,
                  fromPref: Boolean(state.editorDraft.flagsFromPreferences?.noPerecedero),
                  icon: 'infinity',
                  title: 'No perecedero',
                  desc: 'Sin fecha de vencimiento',
                  hasInfo: false
                },
                {
                  flag: 'frozen',
                  inputId: 'inventoryIsFrozen',
                  checked: state.editorDraft.isFrozen,
                  fromPref: Boolean(state.editorDraft.flagsFromPreferences?.isFrozen),
                  icon: 'snow2',
                  title: 'Congelado al ingreso',
                  desc: `Vto. forzado a ${FROZEN_EXPIRY_DAYS} días`,
                  hasInfo: true
                },
                {
                  flag: 'autoegreso',
                  inputId: 'inventoryUsoInternoEmpresa',
                  checked: state.editorDraft.usoInternoEmpresa,
                  fromPref: Boolean(state.editorDraft.flagsFromPreferences?.usoInternoEmpresa),
                  icon: 'box-arrow-right',
                  title: 'Autoegreso',
                  desc: 'Envases primarios & uso interno',
                  hasInfo: false
                }
              ].map((tile) => `
                <div class="inventario-flag-tile-wrap ${tile.hasInfo ? 'has-info' : ''}">
                  <label class="inventario-flag-tile ${tile.checked ? 'is-checked' : ''} ${tile.fromPref && tile.checked ? 'is-from-pref' : ''} ${tile.hasInfo ? 'has-info' : ''}" data-flag="${tile.flag}">
                    <span class="inventario-flag-tile-icon"><sl-icon name="${tile.icon}"></sl-icon></span>
                    <div class="inventario-flag-tile-body">
                      <span class="inventario-flag-tile-title">${tile.title}</span>
                      <span class="inventario-flag-tile-desc">${tile.desc}</span>
                      ${tile.fromPref && tile.checked ? '<span class="inventario-flag-tile-pref"><sl-icon name="bookmark-star-fill"></sl-icon> Tildado por preferencia guardada</span>' : ''}
                    </div>
                    <sl-checkbox class="inventario-flag-tile-input" id="${tile.inputId}" ${tile.checked ? 'checked' : ''} ${stockDisabledAttr}><span class="visually-hidden">${tile.title}</span></sl-checkbox>
                    <span class="inventario-flag-tile-check" aria-hidden="true"><sl-icon name="check2"></sl-icon></span>
                  </label>
                  ${tile.hasInfo ? `<sl-icon-button name="info-circle-fill" class="frozen-info-icon inventario-flag-tile-info-btn" data-frozen-info label="Información sobre producto congelado" title="¿Qué significa congelado?"></sl-icon-button>` : ''}
                </div>
              `).join('')}
            </div>
          </div>
          <div class="recipe-field recipe-field-full">
            <label class="lj-label" for="inventoryInvoiceImage"><i class="fa-regular fa-images inventario-step-icon"></i> Adjuntar archivos (imagen o PDF)</label>
            <label for="inventoryInvoiceImage" class="inventario-upload-dropzone ${infiniteStock ? 'is-disabled' : ''}">
              <i class="fa-regular fa-images"></i>
              <span>Arrastrá adjuntos o hacé click para seleccionar</span>
            </label>
            <input id="inventoryInvoiceImage" class="image-file-input inventario-hidden-file-input" autocomplete="off" type="file" accept="image/*,application/pdf" multiple ${stockDisabledAttr}>
            <small id="inventoryInvoiceImageFeedback" class="inventario-file-feedback">${renderInvoiceUploadFeedbackHtml(state.editorDraft)}</small>
          </div>
        </div>
          <div class="recipe-table-wrap inventario-bulk-table-wrap ${bulkEntries.length && !isEditingEntry ? '' : 'd-none'}" id="inventarioBulkTableWrap">
            <div class="recipe-table-scroll" aria-label="Tabla de productos en factura">
              <table class="recipe-table inventario-bulk-table">
                <thead><tr><th style="width:40px"><span class="visually-hidden">Orden</span><i class="fa-solid fa-grip-vertical" aria-hidden="true"></i></th><th style="min-width:320px">Producto</th><th style="width:180px">Fecha</th><th style="width:170px" class="is-num">Cantidad</th><th style="width:300px">Unidad</th><th style="width:72px" class="is-num">Acción</th></tr></thead>
                <tbody>${bulkEntries.map((extra, idx) => {
            const extraIngredient = state.ingredientes[extra.ingredientId] || null;
            const extraRecord = extraIngredient ? getRecord(extraIngredient.id) : null;
            const defaultUnit = normalizeValue(extra.unit || extraRecord?.stockUnit || extraIngredient?.measure || 'kilos');
            const isUnit = getUnitMeta(defaultUnit).category === 'unidad';
            const packageLocked = isUnit && Number(extraRecord?.packageQty) > 0;
            const packageVal = normalizeValue(extra.packageQty || (packageLocked ? extraRecord.packageQty : ''));
            const avatarHtml = extraIngredient?.imageUrl
              ? `<span class="recipe-inline-avatar-wrap"><span class="thumb-loading"><sl-spinner class="meta-spinner-login" aria-label="Cargando"></sl-spinner></span><img class="recipe-inline-avatar js-inventario-thumb" src="${(window.ljThumb || String)(escapeHtml(extraIngredient.imageUrl))}" alt="${escapeHtml(capitalize(extraIngredient.name))}" loading="lazy"></span>`
              : '<span class="recipe-inline-avatar-wrap"><span class="image-placeholder-circle-2"><i class="fa-solid fa-bowl-food"></i></span></span>';
            return `<tr data-bulk-index="${idx}" class="inventario-bulk-main-row">
              <td><i class="fa-solid fa-grip-lines"></i></td>
              <td>
                <div class="recipe-ing-autocomplete"><div class="recipe-ing-input-wrap">${avatarHtml}<sl-input type="search" data-bulk-search="${idx}" placeholder="Buscar producto..." value="${escapeHtml(extraIngredient ? capitalize(extraIngredient.name) : '')}" ${stockDisabledAttr}></sl-input></div></div>
                <input type="hidden" data-bulk-ingredient="${idx}" value="${escapeHtml(extraIngredient ? extraIngredient.id : '')}" ${stockDisabledAttr}>
              </td>
              <td><input class="lj-input" type="text" data-bulk-expiry-date="${idx}" value="${escapeHtml(extra.expiryDate || state.editorDraft.expiryDate)}" placeholder="Fecha" ${(extra.noPerecedero || infiniteStock) ? 'disabled' : ''}></td>
              <td><sl-input type="number" min="0" step="0.01" data-bulk-qty="${idx}" placeholder="Cantidad" value="${escapeHtml(extra.qty || '')}" ${stockDisabledAttr}></sl-input></td>
              <td><div class="inventario-bulk-unit-cell"><sl-select hoist data-bulk-unit="${idx}" value="${ljOptionValue((state.measures.find((m) => measureKey(m.name) === measureKey(defaultUnit)) || state.measures[0] || { name: '' }).name)}" ${(extraRecord?.stockUnit || packageLocked || infiniteStock) ? 'disabled' : ''}>${state.measures.map((m) => `<sl-option value="${ljOptionValue(m.name)}">${escapeHtml(getMeasureLabel(m.name))}</sl-option>`).join('')}</sl-select><div class="${isUnit ? '' : 'd-none'}" data-bulk-package-wrap="${idx}"><sl-input type="number" min="1" step="1" data-bulk-package="${idx}" placeholder="Cant. por paquete" value="${escapeHtml(packageVal)}" ${(packageLocked || infiniteStock) ? 'disabled' : ''}></sl-input></div></div></td>
              <td><sl-button variant="default" type="button" class="lj-icon-btn family-manage-btn" data-bulk-remove="${idx}" aria-label="Quitar producto" title="Quitar producto" ${stockDisabledAttr}><i class="fa-solid fa-trash"></i></sl-button></td>
            </tr>
            <tr class="inventario-bulk-secondary-row">
              <td></td>
              <td colspan="5"><div class="inventario-bulk-row-extras"><sl-checkbox class="inventario-check-row inventario-check-row-compact" data-bulk-no-perecedero="${idx}" ${extra.noPerecedero ? 'checked' : ''} ${stockDisabledAttr}>No perecedero</sl-checkbox><sl-checkbox class="inventario-check-row inventario-check-row-compact" data-bulk-auto-egreso="${idx}" ${extra.usoInternoEmpresa ? 'checked' : ''} ${stockDisabledAttr}>Autoegreso</sl-checkbox><span class="inventario-check-row inventario-check-row-compact inventario-frozen-row"><sl-checkbox data-bulk-frozen="${idx}" ${extra.isFrozen ? 'checked' : ''} ${stockDisabledAttr}><sl-icon name="snow2" class="me-1"></sl-icon>Congelado</sl-checkbox>${frozenInfoIconHtml()}</span></div></td>
            </tr>`;
          }).join('')}</tbody>
              </table>
            </div>
          </div>
          <div class="recipe-table-actions inventario-save-inline">
            <sl-button variant="success" type="button" id="addBulkInventoryBtn" class="recipe-table-action-btn inventario-add-bulk-btn ${isEditingEntry ? 'd-none' : ''}" ${isEditingEntry ? 'disabled' : stockDisabledAttr}><i slot="prefix" class="fa-solid fa-plus"></i><span>Productos en factura</span></sl-button>
            ${isEditingEntry ? '<sl-button variant="default" type="button" id="cancelInventoryEditBtn" class="recipe-table-action-btn"><i slot="prefix" class="fa-solid fa-xmark"></i><span>Cancelar edición</span></sl-button>' : ''}
            <sl-button variant="success" type="submit" id="saveInventoryBtn" class="recipe-table-action-btn recipe-table-action-btn-primary" ${stockDisabledAttr}>
              <sl-spinner slot="prefix" class="meta-spinner d-none" id="saveInventorySpinner" aria-label="Guardando"></sl-spinner>
              <i slot="prefix" class="fa-solid fa-floppy-disk" id="saveInventoryIcon"></i>
              <span>${isEditingEntry ? 'Guardar cambios' : 'Guardar ingreso'}</span>
            </sl-button>
          </div>
        </div>
      </section>

      <section class="recipe-step-card step-block">
        <h6 class="step-title"><span class="recipe-step-number">3</span> Historial de ingresos</h6>
        ${renderEntryTable(record)}
      </section>`;

    const syncDraft = () => {
      state.editorDraft.qty = nodes.editorForm.querySelector('#inventoryQty')?.value || '';
      state.editorDraft.unit = ljSelectValue(nodes.editorForm.querySelector('#inventoryUnit')) || 'kilos';
      state.editorDraft.packageQty = nodes.editorForm.querySelector('#inventoryPackageQty')?.value || '';
      state.editorDraft.entryDate = nodes.editorForm.querySelector('#inventoryEntryDate')?.value || '';
      state.editorDraft.expiryDate = nodes.editorForm.querySelector('#inventoryExpiryDate')?.value || '';
      state.editorDraft.noPerecedero = Boolean(nodes.editorForm.querySelector('#inventoryNoPerecedero')?.checked);
      state.editorDraft.usoInternoEmpresa = Boolean(nodes.editorForm.querySelector('#inventoryUsoInternoEmpresa')?.checked);
      state.editorDraft.isFrozen = Boolean(nodes.editorForm.querySelector('#inventoryIsFrozen')?.checked);
      // Si el producto se marca como congelado al ingreso, el vencimiento queda
      // forzado a 60 días desde la fecha de ingreso (CAA/SENASA orientativo).
      if (state.editorDraft.isFrozen && !state.editorDraft.noPerecedero) {
        const baseEntry = state.editorDraft.entryDate || getArgentinaIsoDate();
        const frozenExpiry = addDaysToIso(baseEntry, FROZEN_EXPIRY_DAYS);
        if (frozenExpiry) state.editorDraft.expiryDate = frozenExpiry;
      }
      state.editorDraft.invoiceNumber = nodes.editorForm.querySelector('#inventoryInvoiceNumber')?.value || '';
      state.editorDraft.remitoNumber = nodes.editorForm.querySelector('#inventoryRemitoNumber')?.value || '';
      state.editorDraft.customLot = nodes.editorForm.querySelector('#inventoryCustomLot')?.value || '';
      state.editorDraft.provider = nodes.editorForm.querySelector('#inventoryProvider')?.value || '';
      state.editorDraft.customAcronym = nodes.editorForm.querySelector('#lotCustomAcronym')?.value || '';
      state.editorDraft.includeSeparator = Boolean(nodes.editorForm.querySelector('#lotIncludeSeparator')?.checked);
      state.editorDraft.separator = ljSelectValue(nodes.editorForm.querySelector('#lotSeparator')) || '-';
      state.editorDraft.invoiceImageCountLabel = invoiceUploadSummary(getInvoiceUploadItems());
      state.editorDraft.bulkEntries = isEditingEntry ? [] : [...nodes.editorForm.querySelectorAll('[data-bulk-index]')].map((row) => {
        const idx = row.dataset.bulkIndex;
        const current = Array.isArray(state.editorDraft.bulkEntries) ? state.editorDraft.bulkEntries[idx] : null;
        return {
          id: `bulk_${idx}`,
          ingredientId: normalizeValue(nodes.editorForm.querySelector(`[data-bulk-ingredient="${idx}"]`)?.value),
          qty: normalizeValue(nodes.editorForm.querySelector(`[data-bulk-qty="${idx}"]`)?.value),
          unit: normalizeValue(ljSelectValue(nodes.editorForm.querySelector(`[data-bulk-unit="${idx}"]`))),
          packageQty: normalizeValue(nodes.editorForm.querySelector(`[data-bulk-package="${idx}"]`)?.value),
          noPerecedero: Boolean(nodes.editorForm.querySelector(`[data-bulk-no-perecedero="${idx}"]`)?.checked),
          usoInternoEmpresa: Boolean(nodes.editorForm.querySelector(`[data-bulk-auto-egreso="${idx}"]`)?.checked),
          isFrozen: Boolean(nodes.editorForm.querySelector(`[data-bulk-frozen="${idx}"]`)?.checked),
          entryDate: state.editorDraft.entryDate,
          expiryDate: (() => {
            const isFrozen = Boolean(nodes.editorForm.querySelector(`[data-bulk-frozen="${idx}"]`)?.checked);
            const noPere = Boolean(nodes.editorForm.querySelector(`[data-bulk-no-perecedero="${idx}"]`)?.checked);
            if (isFrozen && !noPere) {
              const base = state.editorDraft.entryDate || getArgentinaIsoDate();
              return addDaysToIso(base, FROZEN_EXPIRY_DAYS) || normalizeValue(nodes.editorForm.querySelector(`[data-bulk-expiry-date="${idx}"]`)?.value);
            }
            return normalizeValue(nodes.editorForm.querySelector(`[data-bulk-expiry-date="${idx}"]`)?.value) || normalizeValue(current?.expiryDate || state.editorDraft.expiryDate);
          })()
        };
      });
      state.editorDirty = true;
    };

    const hasDuplicateInvoice = () => {
      const invoice = normalizeLower(nodes.editorForm.querySelector('#inventoryInvoiceNumber')?.value);
      if (!invoice) return false;
      const indexed = state.inventario.indexes?.invoiceByIngredient?.[ingredientId]?.[invoice];
      return Boolean(indexed && indexed !== editingEntryId);
    };

    const renderInvoiceFeedback = () => {
      const feedback = nodes.editorForm.querySelector('#inventoryInvoiceFeedback');
      const saveBtn = nodes.editorForm.querySelector('#saveInventoryBtn');
      if (!feedback || !saveBtn) return;
      if (infiniteStock) {
        feedback.textContent = '';
        feedback.classList.remove('is-error');
        saveBtn.setAttribute('disabled', 'disabled');
        return;
      }
      if (!hasDuplicateInvoice()) {
        feedback.textContent = '';
        feedback.classList.remove('is-error');
        saveBtn.removeAttribute('disabled');
        return;
      }
      feedback.textContent = 'Ya existe un ingreso para este producto con ese número de factura/remito.';
      feedback.classList.add('is-error');
      saveBtn.setAttribute('disabled', 'disabled');
    };

    const renderPattern = () => {
      const separator = state.editorDraft.includeSeparator ? state.editorDraft.separator : '';
      const pattern = state.editorDraft.tokens.map((token) => '${' + lotTokenLabelFor(token, state.editorDraft.customAcronym).replaceAll(' ', '_') + '}').join(separator);
      // Ejemplo real del lote con los datos actuales del formulario.
      const sample = state.editorDraft.tokens.length ? buildLotNumber({
        lotConfig: {
          tokens: [...state.editorDraft.tokens],
          customAcronym: normalizeValue(state.editorDraft.customAcronym),
          includeSeparator: Boolean(state.editorDraft.includeSeparator),
          separator: normalizeValue(state.editorDraft.separator) || '-'
        },
        invoiceNumber: normalizeValue(state.editorDraft.invoiceNumber) || 'A-000123',
        entryDate: state.editorDraft.entryDate || getArgentinaIsoDate(),
        expiryDate: state.editorDraft.expiryDate || addDaysToIso(getArgentinaIsoDate(), 5),
        productName: ingredient.name || ''
      }) : '';
      nodes.editorForm.querySelector('#lotPatternPreview').textContent = pattern ? `${pattern}${sample ? `  →  ${sample}` : ''}` : 'Sin patrón definido';
      nodes.editorForm.querySelector('.inventario-collapse-summary').innerHTML = buildLotSummaryBadges(state.editorDraft);
    };

    const syncNoPerecederoState = () => {
      const noPerecedero = Boolean(nodes.editorForm.querySelector('#inventoryNoPerecedero')?.checked);
      const expiryInput = nodes.editorForm.querySelector('#inventoryExpiryDate');
      if (!expiryInput) return;
      expiryInput.disabled = noPerecedero;
      if (noPerecedero) expiryInput.value = '';
      state.editorDraft.noPerecedero = noPerecedero;
      if (noPerecedero) state.editorDraft.expiryDate = '';
    };

    const wireTokenDrag = () => {
      const box = nodes.editorForm.querySelector('#lotTokenOrder');
      box.querySelectorAll('.inventario-token-chip').forEach((chip) => {
        chip.addEventListener('dragstart', (event) => {
          chip.classList.add('is-dragging');
          event.dataTransfer.setData('text/plain', chip.dataset.token);
          event.dataTransfer.effectAllowed = 'move';
        });
        chip.addEventListener('dragend', () => {
          chip.classList.remove('is-dragging');
          box.querySelectorAll('.drag-over').forEach((n) => n.classList.remove('drag-over'));
        });
        chip.addEventListener('dragover', (event) => {
          event.preventDefault();
          box.querySelectorAll('.drag-over').forEach((n) => n.classList.remove('drag-over'));
          chip.classList.add('drag-over');
        });
        chip.addEventListener('dragleave', () => chip.classList.remove('drag-over'));
        chip.addEventListener('drop', (event) => {
          event.preventDefault();
          const src = event.dataTransfer.getData('text/plain');
          const target = chip.dataset.token;
          chip.classList.remove('drag-over');
          if (!src || src === target) return;
          const arr = [...state.editorDraft.tokens];
          const s = arr.indexOf(src);
          const t = arr.indexOf(target);
          if (s < 0 || t < 0) return;
          arr.splice(s, 1);
          arr.splice(t, 0, src);
          state.editorDraft.tokens = arr;
          state.editorDirty = true;
          renderEditor(ingredientId, state.editorDraft);
        });
      });
    };

    nodes.editorForm.querySelector('#lotConfigToggleBtn')?.addEventListener('click', () => {
      const body = nodes.editorForm.querySelector('#lotConfigBody');
      const hidden = body.classList.toggle('d-none');
      state.editorDraft.showLotConfig = !hidden;
      nodes.editorForm.querySelector('#lotConfigToggleBtn').setAttribute('aria-expanded', String(!hidden));
    });

    nodes.editorForm.querySelector('#suggestedExpiryToggleBtn')?.addEventListener('click', () => {
      const body = nodes.editorForm.querySelector('#suggestedExpiryBody');
      const hidden = body.classList.toggle('d-none');
      nodes.editorForm.querySelector('#suggestedExpiryToggleBtn').setAttribute('aria-expanded', String(!hidden));
    });

    nodes.editorForm.querySelector('#saveSuggestedExpiryDaysBtn')?.addEventListener('click', async () => {
      const suggestedInput = nodes.editorForm.querySelector('#inventarioSuggestedExpiryDays');
      const spinner = nodes.editorForm.querySelector('#saveSuggestedExpiryDaysSpinner');
      const btn = nodes.editorForm.querySelector('#saveSuggestedExpiryDaysBtn');
      const val = parseInt(suggestedInput?.value || '', 10);
      if (Number.isNaN(val) || val < 0) {
        await openIosSwal({ title: 'Valor inválido', html: '<p>Ingresá un número de días válido.</p>', icon: 'warning' });
        return;
      }
      btn.disabled = true;
      spinner.classList.remove('d-none');
      try {
        const currentRecord = getRecord(ingredientId);
        currentRecord.suggestedExpiryDays = val || null;
        state.inventario.items[ingredientId] = currentRecord;
        await persistInventario({ itemIds: [ingredientId] });
        // Update UI immediately without alert
        renderEditor(ingredientId, state.editorDraft);
      } catch (error) {
        await openIosSwal({ title: 'Error', html: '<p>No se pudo guardar el valor.</p>', icon: 'error' });
      } finally {
        btn.disabled = false;
        spinner.classList.add('d-none');
      }
    });

    const syncExpiryFromSuggested = () => {
      const entryInput = nodes.editorForm.querySelector('#inventoryEntryDate');
      const suggestedInput = nodes.editorForm.querySelector('#inventarioSuggestedExpiryDays');
      const expiryInput = nodes.editorForm.querySelector('#inventoryExpiryDate');
      const entryDate = entryInput?.value;
      const suggestedDays = parseInt(suggestedInput?.value || '0', 10);
      if (entryDate && suggestedDays > 0 && expiryInput && !expiryInput.disabled) {
        expiryInput.value = addDaysToIso(entryDate, suggestedDays);
        if (expiryInput._flatpickr) {
          expiryInput._flatpickr.setDate(expiryInput.value, false);
        }
        state.editorDraft.expiryDate = expiryInput.value;
      }
    };

    nodes.editorForm.querySelector('#inventoryEntryDate')?.addEventListener('change', syncExpiryFromSuggested);
    nodes.editorForm.querySelector('#inventarioSuggestedExpiryDays')?.addEventListener('input', syncExpiryFromSuggested);

    nodes.editorForm.querySelector('#inventarioProductThresholdBtn')?.addEventListener('click', async () => {
      await openProductThresholdConfig(ingredientId);
    });
    nodes.editorForm.querySelector('#saveLotConfigBtn')?.addEventListener('click', async () => {
      syncDraft();
      await saveLotConfigOnly(ingredientId);
    });
    nodes.editorForm.querySelector('#inventarioWeeklySheetBtn')?.addEventListener('click', async () => {
      await openWeeklySheetConfig(ingredientId, { force: true });
      renderEditor(ingredientId, state.editorDraft);
    });
    nodes.editorForm.querySelector('#inventarioInfiniteStockToggle')?.addEventListener('change', async (event) => {
      const toggle = event.target;
      const spinner = nodes.editorForm.querySelector('#inventarioInfiniteStockSpinner');
      const previousValue = isInfiniteStockRecord(getRecord(ingredientId));
      toggle.disabled = true;
      spinner?.classList.remove('d-none');
      await new Promise((resolve) => requestAnimationFrame(() => resolve()));
      try {
        const currentRecord = getRecord(ingredientId);
        currentRecord.infiniteStock = Boolean(toggle.checked);
        if (currentRecord.infiniteStock) {
          state.editorDraft = {
            ...state.editorDraft,
            qty: '',
            invoiceNumber: '',
            remitoNumber: '',
            customLot: '',
            provider: '',
            invoiceImageFiles: [],
            invoiceImageFile: null,
            invoiceUploadItems: [],
            invoiceImageCountLabel: 'Sin archivos seleccionados',
            editingEntryId: '',
            bulkEntries: []
          };
        }
        state.inventario.items[ingredientId] = currentRecord;
        rebuildInventarioIndexes();
        await persistInventario({ itemIds: [ingredientId] });
        state.editorDirty = false;
        renderEditor(ingredientId, state.editorDraft);
      } catch (error) {
        toggle.checked = previousValue;
        await openIosSwal({ title: 'No se pudo actualizar', html: '<p>Ocurrió un error guardando el estado de stock infinito.</p>', icon: 'error', confirmButtonText: 'Entendido' });
      } finally {
        toggle.disabled = false;
        spinner?.classList.add('d-none');
      }
    });

    nodes.editorForm.querySelector('#cancelInventoryEditBtn')?.addEventListener('click', () => {
      renderEditor(ingredientId, {
        ...state.editorDraft,
        editingEntryId: '',
        qty: '',
        invoiceNumber: '',
        remitoNumber: '',
        customLot: '',
        provider: '',
        invoiceImageFiles: [],
        invoiceImageFile: null,
        invoiceUploadItems: [],
        invoiceImageCountLabel: 'Sin archivos seleccionados',
        noPerecedero: false,
        usoInternoEmpresa: false,
        isFrozen: false,
        expiryDate: addDaysToIso(getArgentinaIsoDate(), 5),
        entryDate: getArgentinaIsoDate(),
        bulkEntries: []
      });
    });

    nodes.editorForm.querySelectorAll('[data-lot-check]').forEach((input) => {
      input.addEventListener('change', () => {
        const token = input.dataset.lotCheck;
        const tokens = [...state.editorDraft.tokens];
        const idx = tokens.indexOf(token);
        if (input.checked && idx < 0) tokens.push(token);
        if (!input.checked && idx >= 0) tokens.splice(idx, 1);
        state.editorDraft.tokens = tokens;
        const customField = nodes.editorForm.querySelector('#lotCustomAcronym');
        customField.disabled = !tokens.includes('siglas_personalizadas');
        state.editorDirty = true;
        renderEditor(ingredientId, state.editorDraft);
      });
    });

    nodes.editorForm.querySelector('#lotIncludeSeparator')?.addEventListener('change', () => {
      nodes.editorForm.querySelector('#lotSeparator').disabled = !nodes.editorForm.querySelector('#lotIncludeSeparator').checked;
      syncDraft();
      renderPattern();
    });
    nodes.editorForm.querySelector('#lotSeparator')?.addEventListener('change', () => {
      syncDraft();
      renderPattern();
    });

    nodes.editorForm.querySelector('#inventarioEditIngredientBtn').addEventListener('click', async () => {
      await window.laJamoneraIngredientesAPI?.openIngredientForm?.(state.ingredientes[ingredientId]);
      await reloadEditorData(ingredientId);
      renderEditor(ingredientId, state.editorDraft);
    });

    nodes.editorForm.querySelector('#inventoryUnit').addEventListener('change', async (event) => {
      const selectedUnit = ljSelectValue(event.currentTarget);
      if (selectedUnit !== 'add_measure') {
        syncDraft();
        const wrap = nodes.editorForm.querySelector('#inventoryPackageQtyWrap');
        const isUnit = getUnitMeta(selectedUnit).category === 'unidad' || Number(record.packageQty) > 0;
        wrap?.classList.toggle('d-none', !isUnit);
        if (!isUnit && !record.packageQty) {
          const packageInput = nodes.editorForm.querySelector('#inventoryPackageQty');
          if (packageInput) packageInput.value = '';
          state.editorDraft.packageQty = '';
        }
        return;
      }
      const result = await openIosSwal({
        title: 'Agregar medida',
        html: '<div class="swal-stack-fields"><sl-input id="newMeasureName" class="swal2-input" placeholder="Nombre"></sl-input><sl-input id="newMeasureAbbr" class="swal2-input" placeholder="Abreviatura"></sl-input></div>',
        showCancelButton: true,
        confirmButtonText: 'Guardar',
        cancelButtonText: 'Cancelar',
        preConfirm: () => {
          const name = normalizeLower(document.getElementById('newMeasureName')?.value);
          const abbr = normalizeValue(document.getElementById('newMeasureAbbr')?.value);
          if (!name) {
            Swal.showValidationMessage('Completá el nombre de la medida.');
            return false;
          }
          return { name, abbr };
        }
      });
      if (result.isConfirmed) {
        await persistMeasuresIfNeeded(result.value.name, result.value.abbr);
        await reloadEditorData(ingredientId);
        state.editorDraft.unit = result.value.name;
      }
      renderEditor(ingredientId, state.editorDraft);
    });

    let providerSuggestDropdown = null;
    const closeProviderSuggestions = () => {
      if (providerSuggestDropdown) {
        providerSuggestDropdown.remove();
        providerSuggestDropdown = null;
      }
    };
    const positionProviderSuggestions = (dropdown, input) => {
      const rect = input.getBoundingClientRect();
      dropdown.style.position = 'fixed';
      dropdown.style.left = `${Math.max(12, rect.left)}px`;
      dropdown.style.top = `${rect.bottom + 6}px`;
      dropdown.style.width = `${Math.max(rect.width, 260)}px`;
    };
    const applyProviderSelection = (providerId = '') => {
      const providerSelect = nodes.editorForm.querySelector('#inventoryProvider');
      const providerSearch = nodes.editorForm.querySelector('#inventoryProviderSearch');
      if (!providerSelect || !providerSearch) return;
      if (providerId === 'add_provider') {
        providerSelect.value = 'add_provider';
        providerSearch.value = '';
      } else {
        const provider = findProviderById(providerId);
        providerSelect.value = provider?.id || '';
        providerSearch.value = provider?.name || '';
      }
      providerSelect.dispatchEvent(new Event('change', { bubbles: true }));
    };

    const providerSearchInput = nodes.editorForm.querySelector('#inventoryProviderSearch');
    const showProviderSuggestions = () => {
      if (!providerSearchInput) return;
      const query = normalizeValue(providerSearchInput.value);
      const providerSelect = nodes.editorForm.querySelector('#inventoryProvider');
      if (!query && providerSelect && providerSelect.value) {
        providerSelect.value = '';
        syncDraft();
      }

      const source = sortedProviders()
        .filter((provider) => !query || normalizeLower(provider.name).includes(normalizeLower(query)))
        .slice(0, 10);

      const exact = sortedProviders().find((provider) => normalizeLower(provider.name) === normalizeLower(query));
      if (query && exact) {
        applyProviderSelection(exact.id);
        closeProviderSuggestions();
        return;
      }

      closeProviderSuggestions();
      const dropdown = document.createElement('div');
      dropdown.className = 'recipe-suggest-floating';
      dropdown.innerHTML = `${source.map((provider) => {
        const avatar = sanitizeImageUrl(provider?.photoUrl)
          ? `<span class="recipe-suggest-avatar-wrap"><span class="thumb-loading"><sl-spinner class="meta-spinner-login" aria-label="Cargando"></sl-spinner></span><img class="recipe-suggest-avatar js-inventario-thumb" src="${(window.ljThumb || String)(escapeHtml(sanitizeImageUrl(provider.photoUrl)))}" alt="${escapeHtml(provider.name)}" loading="lazy"></span>`
          : '<span class="recipe-suggest-avatar-wrap"><span class="image-placeholder-circle-2 inventario-provider-suggest-placeholder"><i class="fa-solid fa-truck-field inventario-provider-suggest-icon"></i></span></span>';
        return `<button type="button" class="lj-tile recipe-suggest-item" data-provider-pick="${escapeHtml(provider.id)}">${avatar}<span>${escapeHtml(provider.name)}</span></button>`;
      }).join('')}<button type="button" class="lj-tile recipe-suggest-item recipe-suggest-create" data-provider-create="1"><i class="fa-solid fa-plus"></i><span>nuevo proveedor</span></button>`;
      document.body.appendChild(dropdown);
      positionProviderSuggestions(dropdown, providerSearchInput);
      initThumbLoading(dropdown);
      dropdown.addEventListener('click', (event) => {
        const pick = event.target.closest('[data-provider-pick]');
        if (pick) {
          applyProviderSelection(pick.dataset.providerPick || '');
          closeProviderSuggestions();
          return;
        }
        if (event.target.closest('[data-provider-create]')) {
          applyProviderSelection('add_provider');
          closeProviderSuggestions();
        }
      });
      providerSuggestDropdown = dropdown;
    };
    providerSearchInput?.addEventListener('input', showProviderSuggestions);
    providerSearchInput?.addEventListener('focus', showProviderSuggestions);
    providerSearchInput?.addEventListener('click', showProviderSuggestions);
    providerSearchInput?.addEventListener('blur', () => {
      setTimeout(() => closeProviderSuggestions(), 140);
    });

    nodes.editorForm.querySelector('#inventoryProvider')?.addEventListener('change', async (event) => {
      if (event.target.value !== 'add_provider') {
        syncDraft();
        return;
      }

      const result = await openIosSwal({
        title: 'Agregar proveedor',
        html: `<div class="swal-stack-fields">
          <sl-input id="newProviderName" class="swal2-input" placeholder="Nombre del proveedor"></sl-input>
          <sl-input id="newProviderEmail" class="swal2-input" placeholder="Email (opcional)"></sl-input>
          <sl-input id="newProviderPhone" class="swal2-input" placeholder="Teléfono (opcional)"></sl-input>
          <sl-checkbox class="inventario-check-row inventario-check-row-compact" id="newProviderNonFood">No pertenece al rubro alimentos</sl-checkbox>
          <label for="newProviderPhoto" class="inventario-upload-dropzone"><i class="fa-regular fa-image"></i><span>Foto de perfil: click o arrastrá</span></label><input id="newProviderPhoto" class="image-file-input inventario-hidden-file-input" type="file" accept="image/*"><small id="newProviderPhotoFeedback" class="inventario-file-feedback">Sin foto seleccionada</small>
          <p class="text-start"><small><strong>Opcional:</strong> podés cargar el RNE ahora o hacerlo más tarde.</small></p>
          <sl-input id="newProviderRneNumber" class="swal2-input" placeholder="RNE (opcional, texto libre)"></sl-input>
          <sl-checkbox class="inventario-check-row inventario-check-row-compact" id="newProviderRneInfinite">Vencimiento infinito (∞)</sl-checkbox>
          <input id="newProviderRneExpiry" class="lj-input swal2-input" placeholder="Vencimiento RNE (opcional)">
          <sl-textarea id="newProviderRneObservations" class="swal2-textarea" rows="2" resize="auto" placeholder="Observaciones RNE (opcional)"></sl-textarea>
          <label for="newProviderRneFile" class="inventario-upload-dropzone"><i class="fa-regular fa-file"></i><span>Adjunto RNE: click o arrastrá</span></label><input id="newProviderRneFile" class="image-file-input inventario-hidden-file-input" type="file" accept="image/*,application/pdf"><small id="newProviderRneFeedback" class="inventario-file-feedback">Sin adjunto seleccionado</small>
        </div>`,
        showCancelButton: true,
        confirmButtonText: 'Guardar',
        cancelButtonText: 'Cancelar',
        willOpen: () => {
          const expiryInput = document.getElementById('newProviderRneExpiry');
          const numberInput = document.getElementById('newProviderRneNumber');
          const infiniteInput = document.getElementById('newProviderRneInfinite');
          const nonFoodInput = document.getElementById('newProviderNonFood');
          const observationsInput = document.getElementById('newProviderRneObservations');
          const rneFileInput = document.getElementById('newProviderRneFile');
          const syncInfinite = () => {
            const isNonFood = Boolean(nonFoodInput?.checked);
            if (expiryInput) {
              expiryInput.disabled = Boolean(infiniteInput?.checked) || isNonFood;
              if (infiniteInput?.checked || isNonFood) expiryInput.value = '';
            }
            if (infiniteInput) {
              infiniteInput.disabled = isNonFood;
              if (isNonFood) infiniteInput.checked = false;
            }
            if (numberInput) numberInput.disabled = isNonFood;
            if (observationsInput) observationsInput.disabled = isNonFood;
            if (rneFileInput) rneFileInput.disabled = isNonFood;
            if (isNonFood) {
              if (numberInput) numberInput.value = '';
              if (observationsInput) observationsInput.value = '';
            }
          };
          infiniteInput?.addEventListener('change', syncInfinite);
          nonFoodInput?.addEventListener('change', syncInfinite);
          syncInfinite();
          const wireDrop = (inputId, feedbackId) => {
            const input = document.getElementById(inputId);
            const dropzone = document.querySelector(`label[for="${inputId}"]`);
            const feedback = document.getElementById(feedbackId);
            const update = () => {
              const file = input?.files?.[0];
              if (feedback) feedback.textContent = file ? file.name : 'Sin archivo seleccionado';
            };
            input?.addEventListener('change', update);
            dropzone?.addEventListener('dragover', (event) => {
              event.preventDefault();
              dropzone.classList.add('is-dragging');
            });
            dropzone?.addEventListener('dragleave', () => dropzone.classList.remove('is-dragging'));
            dropzone?.addEventListener('drop', (event) => {
              event.preventDefault();
              dropzone.classList.remove('is-dragging');
              const file = event.dataTransfer?.files?.[0];
              if (!file || !input) return;
              const dt = new DataTransfer();
              dt.items.add(file);
              input.files = dt.files;
              update();
            });
          };
          wireDrop('newProviderPhoto', 'newProviderPhotoFeedback');
          wireDrop('newProviderRneFile', 'newProviderRneFeedback');
          if (window.flatpickr && expiryInput) {
            window.flatpickr(expiryInput, {
              locale: window.flatpickr.l10ns?.es || undefined,
              dateFormat: 'Y-m-d',
              altInput: true,
              altFormat: 'd/m/Y',
              allowInput: true,
              disableMobile: true
            });
          }
        },
        preConfirm: async () => {
          const name = normalizeUpper(document.getElementById('newProviderName')?.value);
          const email = normalizeValue(document.getElementById('newProviderEmail')?.value);
          const phone = normalizeValue(document.getElementById('newProviderPhone')?.value);
          const nonFoodCategory = Boolean(document.getElementById('newProviderNonFood')?.checked);
          const infiniteExpiry = Boolean(document.getElementById('newProviderRneInfinite')?.checked);
          const rneNumber = nonFoodCategory ? '' : normalizeValue(document.getElementById('newProviderRneNumber')?.value);
          const rneObservations = nonFoodCategory ? '' : normalizeValue(document.getElementById('newProviderRneObservations')?.value);
          const rneExpiry = nonFoodCategory || infiniteExpiry ? '' : normalizeIsoDate(document.getElementById('newProviderRneExpiry')?.value);
          const rneFile = nonFoodCategory ? null : (document.getElementById('newProviderRneFile')?.files?.[0] || null);
          const photoFile = document.getElementById('newProviderPhoto')?.files?.[0] || null;

          if (!name) {
            Swal.showValidationMessage('Completá el nombre del proveedor.');
            return false;
          }
          if (rneFile && !ALLOWED_RNE_UPLOAD_TYPES.includes(rneFile.type)) {
            Swal.showValidationMessage('Adjunto RNE inválido. Permitido: PDF o imagen.');
            return false;
          }
          if (rneFile && rneFile.size > MAX_UPLOAD_SIZE_BYTES) {
            Swal.showValidationMessage('El adjunto RNE supera 5MB.');
            return false;
          }

          let attachmentUrl = '';
          if (rneFile) {
            attachmentUrl = await uploadImageToStorage(rneFile, 'inventario/proveedores/rne');
          }
          let photoUrl = '';
          if (photoFile) {
            if (!ALLOWED_UPLOAD_TYPES.includes(photoFile.type)) {
              Swal.showValidationMessage('La foto debe ser JPG, PNG, WEBP o GIF.');
              return false;
            }
            if (photoFile.size > MAX_UPLOAD_SIZE_BYTES) {
              Swal.showValidationMessage('La foto supera 5MB.');
              return false;
            }
            photoUrl = await uploadImageToStorage(photoFile, 'inventario/proveedores/avatar');
          }

          return {
            name,
            email,
            phone,
            photoUrl,
            nonFoodCategory,
            rne: {
              ...getDefaultProviderRne(),
              number: rneNumber,
              expiryDate: rneExpiry,
              infiniteExpiry: nonFoodCategory ? false : infiniteExpiry,
              observations: rneObservations,
              attachmentUrl,
              attachmentType: rneFile?.type || '',
              updatedAt: Date.now()
            }
          };
        }
      });

      if (result.isConfirmed) {
        const existing = findProviderByName(result.value.name);
        const provider = existing
          ? {
            ...existing,
            email: normalizeValue(result.value.email || existing.email),
            phone: normalizeValue(result.value.phone || existing.phone),
            photoUrl: normalizeValue(result.value.photoUrl || existing.photoUrl),
            nonFoodCategory: Boolean(result.value.nonFoodCategory),
            rne: {
              ...getDefaultProviderRne(),
              ...safeObject(existing.rne),
              ...safeObject(result.value.rne)
            }
          }
          : { ...createProviderWithName(result.value.name), email: normalizeValue(result.value.email), phone: normalizeValue(result.value.phone), photoUrl: normalizeValue(result.value.photoUrl), nonFoodCategory: Boolean(result.value.nonFoodCategory), rne: safeObject(result.value.rne) };
        saveProviderInConfig(provider);
        state.editorDraft.provider = provider.id;
        await persistInventario({ configOnly: true });
      }

      renderEditor(ingredientId, state.editorDraft);
    });

    nodes.editorForm.querySelectorAll('sl-input, sl-select, sl-textarea, sl-checkbox, sl-switch, input.lj-input, input[type="hidden"]').forEach((el) => {
      el.addEventListener('input', syncDraft);
      el.addEventListener('change', syncDraft);
    });
    nodes.editorForm.querySelectorAll('sl-input[type="number"]').forEach((input) => {
      input.addEventListener('wheel', (event) => {
        event.preventDefault();
        input.blur();
      }, { passive: false });
    });
    nodes.editorForm.querySelector('#inventoryNoPerecedero')?.addEventListener('change', () => {
      syncNoPerecederoState();
      syncDraft();
    });
    syncNoPerecederoState();

    // Tarjetas "Tipo de producto": el sl-checkbox va oculto dentro de la tarjeta;
    // el clic en cualquier parte de la tarjeta lo alterna y la clase is-checked refleja el estado.
    nodes.editorForm.querySelectorAll('.inventario-flag-tile').forEach((tile) => {
      const check = tile.querySelector('sl-checkbox');
      if (!check) return;
      tile.addEventListener('click', (event) => {
        if (event.target.closest('sl-checkbox, [data-frozen-info]')) return;
        event.preventDefault();
        if (!check.disabled) check.click();
      });
      check.addEventListener('sl-change', () => tile.classList.toggle('is-checked', Boolean(check.checked)));
    });

    nodes.editorForm.querySelector('#addBulkInventoryBtn')?.addEventListener('click', () => {
      const currentBulk = Array.isArray(state.editorDraft.bulkEntries) ? state.editorDraft.bulkEntries : [];
      const nextIndex = currentBulk.length;
      // Heredamos los flags del form principal (no perecedero / congelado / autoegreso)
      // para que la fila nueva arranque con el mismo "tipo de producto" que el principal.
      // Cuando el usuario seleccione un ingrediente, las preferencias guardadas de ESE
      // ingrediente sobreescriben estos defaults (ver el listener de [data-bulk-ingredient]).
      state.editorDraft.bulkEntries = [...currentBulk, {
        ...getDefaultBulkEntryDraft(''),
        entryDate: state.editorDraft.entryDate,
        expiryDate: state.editorDraft.expiryDate,
        noPerecedero: Boolean(state.editorDraft.noPerecedero),
        usoInternoEmpresa: Boolean(state.editorDraft.usoInternoEmpresa),
        isFrozen: Boolean(state.editorDraft.isFrozen)
      }];
      state.editorDraft.focusBulkSearchIndex = nextIndex;
      renderEditor(ingredientId, state.editorDraft);
    });

    nodes.editorForm.querySelectorAll('[data-bulk-remove]').forEach((button) => {
      button.addEventListener('click', () => {
        const idx = Number(button.dataset.bulkRemove);
        const currentBulk = Array.isArray(state.editorDraft.bulkEntries) ? state.editorDraft.bulkEntries : [];
        currentBulk.splice(idx, 1);
        state.editorDraft.bulkEntries = currentBulk;
        renderEditor(ingredientId, state.editorDraft);
      });
    });

    let bulkSuggestDropdown = null;
    let bulkSuggestSuppressUntil = 0;
    const closeBulkSuggestions = () => {
      if (bulkSuggestDropdown) {
        bulkSuggestDropdown.remove();
        bulkSuggestDropdown = null;
      }
    };
    const positionBulkSuggestions = (dropdown, input) => {
      const rect = input.getBoundingClientRect();
      dropdown.style.position = 'fixed';
      dropdown.style.left = `${Math.max(12, rect.left)}px`;
      dropdown.style.top = `${rect.bottom + 6}px`;
      dropdown.style.width = `${Math.max(rect.width, 240)}px`;
    };
    const applyBulkIngredient = (idx, ingredient) => {
      const select = nodes.editorForm.querySelector(`[data-bulk-ingredient="${idx}"]`);
      const input = nodes.editorForm.querySelector(`[data-bulk-search="${idx}"]`);
      if (!select || !input) return;
      select.value = ingredient.id;
      input.value = capitalize(ingredient.name);
      select.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const openBulkSuggestions = (input, idx, query) => {
      if (Date.now() < bulkSuggestSuppressUntil) return;
      closeBulkSuggestions();
      const source = Object.values(state.ingredientes)
        .filter((item) => normalizeLower(item.name).includes(normalizeLower(query)))
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es'))
        .slice(0, 10);
      if (!source.length && normalizeValue(query).length < 2) return;

      const dropdown = document.createElement('div');
      dropdown.className = 'recipe-suggest-floating';
      dropdown.innerHTML = `${source.map((item) => `
        <button type="button" class="lj-tile recipe-suggest-item" data-bulk-pick="${idx}" data-ing-id="${item.id}">
          <span class="recipe-suggest-avatar-wrap">${item.imageUrl
            ? `<span class="thumb-loading"><sl-spinner class="meta-spinner-login" aria-label="Cargando"></sl-spinner></span><img class="recipe-suggest-avatar js-inventario-thumb" src="${(window.ljThumb || String)(escapeHtml(item.imageUrl))}" alt="${escapeHtml(capitalize(item.name))}" loading="lazy">`
            : '<span class="image-placeholder-circle-2"><i class="fa-solid fa-bowl-food"></i></span>'}</span>
          <span>${escapeHtml(capitalize(item.name))}</span>
        </button>`).join('')}
        <button type="button" class="lj-tile recipe-suggest-item recipe-suggest-create" data-bulk-create="${idx}"><i class="fa-solid fa-plus"></i><span>Crear ingrediente</span></button>`;
      document.body.appendChild(dropdown);
      positionBulkSuggestions(dropdown, input);
      initThumbLoading(dropdown);
      dropdown.addEventListener('mousedown', (event) => { event.preventDefault(); });
      dropdown.addEventListener('click', async (event) => {
        const pick = event.target.closest('[data-bulk-pick]');
        if (pick) {
          const ingredientPick = state.ingredientes[pick.dataset.ingId];
          if (ingredientPick) applyBulkIngredient(Number(pick.dataset.bulkPick), ingredientPick);
          bulkSuggestSuppressUntil = Date.now() + 900;
          closeBulkSuggestions();
          return;
        }
        const create = event.target.closest('[data-bulk-create]');
        if (!create) return;
        closeBulkSuggestions();
        await window.laJamoneraIngredientesAPI?.openIngredientForm?.();
        await reloadEditorData(ingredientId);
        renderEditor(ingredientId, state.editorDraft);
      });
      bulkSuggestDropdown = dropdown;
    };

    nodes.editorForm.querySelectorAll('[data-bulk-search]').forEach((input) => {
      input.addEventListener('input', () => {
        const idx = Number(input.dataset.bulkSearch);
        const query = normalizeValue(input.value);
        const select = nodes.editorForm.querySelector(`[data-bulk-ingredient="${idx}"]`);
        if (!query) {
          if (select) {
            select.value = '';
            select.dispatchEvent(new Event('change', { bubbles: true }));
          }
          closeBulkSuggestions();
          return;
        }
        if (select) {
          select.value = '';
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }
        openBulkSuggestions(input, idx, query);
      });
      input.addEventListener('blur', () => {
        setTimeout(() => closeBulkSuggestions(), 320);
      });
    });

    nodes.editorForm.addEventListener('click', (event) => {
      if (!event.target.closest('[data-bulk-search]')) {
        closeBulkSuggestions();
      }
      if (!event.target.closest('#inventoryProviderSearch')) {
        closeProviderSuggestions();
      }
      if (event.target.closest('[data-frozen-info]')) {
        event.preventDefault();
        event.stopPropagation();
        openFrozenInfoSwal();
      }
      if (event.target.closest('[data-mass-unit-change]')) {
        event.preventDefault();
        openMassUnitChangeDialog(ingredientId);
      }
    });

    // === Cambio masivo de unidad ===
    // Permite cambiar la unidad de un ingrediente que ya tiene stock cargado.
    // Permite cambiar a cualquier unidad registrada.
    // Recorre todas las entries y reescribe qty/qtyKg/qtyBase/availableQty/etc.
    // a la nueva unidad usando toBase/fromBase. Persiste y re-renderiza.
    async function openMassUnitChangeDialog(itemId) {
      const targetRecord = getRecord(itemId);
      const currentUnit = targetRecord.stockUnit || (state.ingredientes[itemId]?.measure || 'kilos');
      const currentMeta = getUnitMeta(currentUnit);
      const availableMeasures = state.measures.filter((m) => measureKey(m.name) !== measureKey(currentUnit));
      if (!availableMeasures.length) {
        await openIosSwal({
          title: 'Sin unidades disponibles',
          html: '<p>No hay otras unidades cargadas para cambiar.</p>',
          icon: 'warning',
          confirmButtonText: 'Entendido'
        });
        return;
      }
      const result = await openIosSwal({
        title: 'Cambiar unidad masivamente',
        html: `
          <div class="text-start">
            <p>Vas a cambiar la unidad de <strong>${escapeHtml(capitalize(state.ingredientes[itemId]?.name || ''))}</strong> y todos sus ingresos al nuevo formato. Esta operación es <strong>reversible</strong> repitiendo el proceso, pero conviene revisarlo.</p>
            <label class="lj-label mt-2">Unidad actual</label>
            <sl-input class="swal2-input" value="${escapeHtml(getMeasureLabel(currentUnit))}" readonly></sl-input>
            <label class="lj-label mt-2" for="massUnitChangeNewUnit">Nueva unidad</label>
            <sl-select id="massUnitChangeNewUnit" class="swal2-input" hoist value="${ljOptionValue(availableMeasures[0]?.name || '')}">
              ${availableMeasures.map((m) => `<sl-option value="${ljOptionValue(m.name)}">${escapeHtml(getMeasureLabel(m.name))}</sl-option>`).join('')}
            </sl-select>
            <small class="text-muted d-block mt-2">Podés elegir cualquier unidad cargada. Categoría actual: ${escapeHtml(currentMeta.category)}.</small>
          </div>`,
        showCancelButton: true,
        confirmButtonText: 'Aplicar cambio',
        cancelButtonText: 'Cancelar',
        preConfirm: () => {
          const v = ljSelectValue(document.getElementById('massUnitChangeNewUnit')) || '';
          if (!v) { Swal.showValidationMessage('Seleccioná una unidad'); return false; }
          return v;
        }
      });
      if (!result.isConfirmed) return;
      const newUnit = normalizeValue(result.value);
      const fromFactor = getUnitMeta(currentUnit).factor || 1;
      const toFactor = getUnitMeta(newUnit).factor || 1;
      const ratio = fromFactor / toFactor; // multiplicar qty por esto convierte de currentUnit a newUnit
      const entries = Array.isArray(targetRecord.entries) ? targetRecord.entries : [];
      entries.forEach((entry) => {
        if (!entry) return;
        const oldQty = Number(entry.qty || 0);
        const oldAvail = Number(entry.availableQty || 0);
        const newQty = Number((oldQty * ratio).toFixed(4));
        const newAvail = Number((oldAvail * ratio).toFixed(4));
        entry.qty = newQty;
        entry.availableQty = newAvail;
        entry.unit = newUnit;
        entry.qtyBase = Number(toBase(newQty, newUnit).toFixed(6));
        entry.availableBase = Number(toBase(newAvail, newUnit).toFixed(6));
        // qtyKg / availableKg se recalculan via convertToKg
        entry.qtyKg = Number(convertToKg(newQty, newUnit).toFixed(4));
        entry.availableKg = Number(convertToKg(newAvail, newUnit).toFixed(4));
      });
      targetRecord.entries = entries;
      targetRecord.stockUnit = newUnit;
      recomputeRecordStock(targetRecord, newUnit);
      state.inventario.items[itemId] = targetRecord;
      rebuildInventarioIndexes();
      await persistInventario({ itemIds: [itemId] });
      await openIosSwal({
        title: 'Unidad actualizada',
        html: `<p>Se cambiaron <strong>${entries.length}</strong> ingreso(s) a <strong>${escapeHtml(getMeasureLabel(newUnit))}</strong>.</p>`,
        icon: 'success',
        confirmButtonText: 'Listo'
      });
      renderEditor(itemId, { ...state.editorDraft, unit: newUnit });
    }

    nodes.editorForm.querySelectorAll('[data-bulk-ingredient]').forEach((select) => {
      select.addEventListener('change', () => {
        const idx = Number(select.dataset.bulkIngredient);
        const ingredientPick = state.ingredientes[select.value];
        if (!ingredientPick) {
          syncDraft();
          return;
        }
        const row = nodes.editorForm.querySelector(`[data-bulk-index="${idx}"]`);
        const unitSelect = nodes.editorForm.querySelector(`[data-bulk-unit="${idx}"]`);
        const packageInput = nodes.editorForm.querySelector(`[data-bulk-package="${idx}"]`);
        const packageWrap = nodes.editorForm.querySelector(`[data-bulk-package-wrap="${idx}"]`);
        const extraRecord = getRecord(ingredientPick.id);
        const defaultUnit = extraRecord.stockUnit || ingredientPick.measure || 'kilos';
        if (unitSelect) {
          ljSetSelectValue(unitSelect, defaultUnit);
          unitSelect.disabled = Boolean(extraRecord.stockUnit);
        }
        const isUnit = getUnitMeta(defaultUnit).category === 'unidad';
        packageWrap?.classList.toggle('d-none', !isUnit);
        if (packageInput) {
          packageInput.value = isUnit && Number(extraRecord.packageQty) > 0 ? String(extraRecord.packageQty) : '';
          packageInput.disabled = isUnit && Number(extraRecord.packageQty) > 0;
          if (!isUnit) packageInput.value = '';
        }
        syncDraft();
        // Aplicar las preferencias de flags guardadas en el ingrediente
        // seleccionado (no perecedero / congelado / autoegreso) al bulk row.
        // IMPORTANTE: esto va DESPUÉS de syncDraft (que lee el DOM y reconstruye
        // bulkEntries), si no las preferencias se sobrescriben con los valores
        // del DOM (que todavía tiene los checkboxes apagados).
        const prefs = safeObject(extraRecord.flagPreferences);
        const bulkArr = Array.isArray(state.editorDraft.bulkEntries) ? [...state.editorDraft.bulkEntries] : [];
        if (bulkArr[idx] && Object.keys(prefs).length > 0) {
          bulkArr[idx] = {
            ...bulkArr[idx],
            noPerecedero: Boolean(prefs.noPerecedero),
            isFrozen: Boolean(prefs.isFrozen),
            usoInternoEmpresa: Boolean(prefs.usoInternoEmpresa)
          };
          // Si quedó marcado como congelado, fijamos el vto a +60 días.
          if (prefs.isFrozen && !prefs.noPerecedero) {
            const baseEntry = bulkArr[idx].entryDate || state.editorDraft.entryDate || getArgentinaIsoDate();
            const forced = addDaysToIso(baseEntry, FROZEN_EXPIRY_DAYS);
            if (forced) bulkArr[idx].expiryDate = forced;
          }
          state.editorDraft.bulkEntries = bulkArr;
        }
        renderEditor(ingredientId, state.editorDraft);
      });
    });

    nodes.editorForm.querySelectorAll('[data-bulk-unit]').forEach((select) => {
      select.addEventListener('change', () => {
        const idx = Number(select.dataset.bulkUnit);
        const packageWrap = nodes.editorForm.querySelector(`[data-bulk-package-wrap="${idx}"]`);
        const packageInput = nodes.editorForm.querySelector(`[data-bulk-package="${idx}"]`);
        const isUnit = getUnitMeta(ljSelectValue(select)).category === 'unidad';
        packageWrap?.classList.toggle('d-none', !isUnit);
        if (!isUnit && packageInput) {
          packageInput.value = '';
          packageInput.disabled = false;
        }
        syncDraft();
      });
    });

    nodes.editorForm.querySelectorAll('[data-bulk-no-perecedero]').forEach((check) => {
      check.addEventListener('change', () => {
        const idx = check.dataset.bulkNoPerecedero;
        const expiryInput = nodes.editorForm.querySelector(`[data-bulk-expiry-date="${idx}"]`);
        if (!expiryInput) return;
        expiryInput.disabled = check.checked;
        if (check.checked) {
          expiryInput.value = '';
        } else if (!normalizeValue(expiryInput.value)) {
          expiryInput.value = normalizeValue(state.editorDraft.expiryDate);
        }
        syncDraft();
      });
    });

    const invoiceInput = nodes.editorForm.querySelector('#inventoryInvoiceImage');
    const invoiceDropzone = nodes.editorForm.querySelector('.inventario-upload-dropzone');
    const handleInvoiceFileSelection = async (fileList) => {
      if (infiniteStock) return;
      syncDraft();
      await uploadInvoiceDraftFiles(fileList);
      if (invoiceInput) invoiceInput.value = '';
    };
    invoiceInput?.addEventListener('change', async () => {
      await handleInvoiceFileSelection(invoiceInput.files || []);
    });
    const assignDroppedFiles = async (fileList) => {
      if (!invoiceInput || !fileList?.length) return;
      await handleInvoiceFileSelection(fileList);
    };
    invoiceDropzone?.addEventListener('dragover', (event) => {
      event.preventDefault();
      invoiceDropzone.classList.add('is-dragging');
    });
    invoiceDropzone?.addEventListener('dragleave', () => {
      invoiceDropzone.classList.remove('is-dragging');
    });
    invoiceDropzone?.addEventListener('drop', (event) => {
      event.preventDefault();
      event.stopPropagation();
      invoiceDropzone.classList.remove('is-dragging');
      assignDroppedFiles(event.dataTransfer?.files || []);
    });
    invoiceDropzone?.addEventListener('click', (event) => {
      event.preventDefault();
      invoiceInput?.click();
    });
    nodes.editorForm.querySelector('#inventoryInvoiceImageFeedback')?.addEventListener('click', (event) => {
      const removeBtn = event.target.closest('[data-invoice-upload-remove]');
      if (!removeBtn) return;
      const itemId = normalizeValue(removeBtn.dataset.invoiceUploadRemove);
      setInvoiceUploadItems(getInvoiceUploadItems().filter((item) => item.id !== itemId));
      updateInvoiceUploadFeedback();
      state.editorDirty = true;
    });
    // Aviso en vivo de factura repetida (estaba definido pero sin conectar).
    nodes.editorForm.querySelector('#inventoryInvoiceNumber')?.addEventListener('input', renderInvoiceFeedback);
    nodes.editorForm.querySelector('#inventoryInvoiceNumber')?.addEventListener('change', async () => {
      const invoice = normalizeLower(nodes.editorForm.querySelector('#inventoryInvoiceNumber')?.value);
      if (!invoice) return;
      const indexed = state.inventario.indexes?.invoiceByIngredient?.[ingredientId]?.[invoice];
      if (indexed && indexed !== editingEntryId) {
        await openIosSwal({
          title: 'Ingreso duplicado',
          html: '<p>Ya existe un ingreso para este producto con ese número de factura/remito.</p>',
          icon: 'warning',
          confirmButtonText: 'Entendido'
        });
      }
    });

    nodes.editorForm.querySelector('#inventarioEntriesSearch')?.addEventListener('input', (event) => {
      state.tableSearch = event.target.value;
      state.tablePage = 1;
      rerenderEditorKeepViewport(ingredientId, state.editorDraft, '#inventarioEntriesSearch');
    });

    if (window.flatpickr) {
      const locale = window.flatpickr.l10ns?.es || undefined;
      const dayMap = getDaySummaryMap(Array.isArray(record.entries) ? record.entries : []);
      const entriesRangeInput = nodes.editorForm.querySelector('#inventarioEntriesRange');
      disableCalendarSuggestions(entriesRangeInput);
      window.flatpickr(entriesRangeInput, {
        locale,
        mode: 'range',
        dateFormat: 'Y-m-d',
        allowInput: false,
        defaultDate: getDefaultRangeDates(state.tableDateRange),
        onDayCreate: (_dObj, _dStr, _fp, dayElem) => {
          const date = dayElem.dateObj ? getArgentinaIsoDate(dayElem.dateObj) : '';
          const summary = dayMap[date];
          if (summary && (summary.kg || summary.units)) {
            const bubble = document.createElement('span');
            const hasKg = summary.kg > 0.0001;
            const hasUnits = summary.units > 0.0001;
            bubble.className = `inventario-day-kg ${hasKg && hasUnits ? 'is-mixed' : ''}`;
            bubble.textContent = hasKg && hasUnits
              ? `${Number(summary.kg || 0).toFixed(0)}kg + ${Number(summary.units || 0).toFixed(0)}u.`
              : hasKg
                ? `${Number(summary.kg || 0).toFixed(2)}kg`
                : `${Number(summary.units || 0).toFixed(0)}u.`;
            dayElem.appendChild(bubble);
          }
        },
        onClose: (_selectedDates, dateStr, instance) => {
          const from = instance.selectedDates[0] ? getArgentinaIsoDate(instance.selectedDates[0]) : '';
          const to = instance.selectedDates[1] ? getArgentinaIsoDate(instance.selectedDates[1]) : '';
          const nextRange = from && to ? `${from} a ${to}` : (from || normalizeValue(dateStr));
          state.tableDateRange = normalizeValue(nextRange);
          state.tablePage = 1;
          rerenderEditorKeepViewport(ingredientId, state.editorDraft, '#inventarioEntriesSearch');
        }
      });
    }

    nodes.editorForm.querySelector('#inventarioClearFilterBtn')?.addEventListener('click', () => {
      state.tableDateRange = '';
      state.tablePage = 1;
      rerenderEditorKeepViewport(ingredientId, state.editorDraft, '#inventarioEntriesSearch');
    });

    nodes.editorForm.querySelector('#inventarioCollapseAllRowsBtn')?.addEventListener('click', () => {
      const map = { ...(state.entryCollapseByIngredient[ingredientId] || {}) };
      getFilteredEntries(Array.isArray(record.entries) ? record.entries : []).forEach((entry) => {
        if (hasEntryDetailRows(entry)) map[entry.id] = true;
      });
      state.entryCollapseByIngredient[ingredientId] = map;
      rerenderEditorKeepViewport(ingredientId, state.editorDraft, '#inventarioEntriesSearch');
    });

    nodes.editorForm.querySelector('#inventarioExpandAllRowsBtn')?.addEventListener('click', () => {
      const map = { ...(state.entryCollapseByIngredient[ingredientId] || {}) };
      getFilteredEntries(Array.isArray(record.entries) ? record.entries : []).forEach((entry) => {
        if (hasEntryDetailRows(entry)) map[entry.id] = false;
      });
      state.entryCollapseByIngredient[ingredientId] = map;
      rerenderEditorKeepViewport(ingredientId, state.editorDraft, '#inventarioEntriesSearch');
    });

    nodes.editorForm.querySelectorAll('[data-toggle-entry-collapse]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const entryId = btn.dataset.toggleEntryCollapse;
        if (!entryId) return;
        const map = { ...(state.entryCollapseByIngredient[ingredientId] || {}) };
        map[entryId] = !map[entryId];
        state.entryCollapseByIngredient[ingredientId] = map;
        rerenderEditorKeepViewport(ingredientId, state.editorDraft, '#inventarioEntriesSearch');
      });
    });

    nodes.editorForm.querySelectorAll('[data-open-production-trace]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const productionId = normalizeValue(btn.dataset.openProductionTrace);
        if (!productionId) return;
        await window.laJamoneraProduccionAPI?.openTraceabilityById?.(productionId);
      });
    });

    nodes.editorForm.querySelector('#inventarioExpandTableBtn')?.addEventListener('click', async () => {
      const fullRows = getFilteredEntries(Array.isArray(record.entries) ? record.entries : []);
      const collapseMap = { ...(state.entryCollapseByIngredient[ingredientId] || {}) };
      let expandedPage = 1;
      const renderRows = (rowsPage) => rowsPage.length ? rowsPage.map((entry, index) => {
        const traceRows = getEntryTraceRows(entry);
        const isCollapsed = collapseMap[entry.id] !== false;
        const expiryMeta = getEntryExpiryMeta(entry);
        const isExpiredAvailable = expiryMeta.isExpired;
        const resolutionMeta = getEntryResolutionMeta(entry);
        const resolutionLabel = resolutionMeta.badge;
        const resolutionRow = getEntryResolutionRowData(entry);
        const traceHtml = (!isCollapsed && traceRows.length)
          ? traceRows.map((trace) => `<tr class="${getTraceRowClass(trace)}"><td><div class="inventario-trace-main"><img src="./IMG/Octicons-git-merge.svg" alt="merge" class="inventario-trace-icon">${formatDateTime(trace.createdAt)}</div></td><td>${getTraceTypeLabelHtml(trace)}</td><td class="is-num inventario-trace-kilos">-${trace.displayAmount || formatUsageAmount(trace.kilosUsed)}</td><td></td><td>${escapeHtml(trace.ingredientLot)}</td><td>${escapeHtml((trace.internalUse || isAutoGeneratedCounterTrace(trace)) ? providerLabel(entry.provider) : trace.productionId)}</td><td>${(trace.internalUse || isAutoGeneratedCounterTrace(trace)) ? '<span class="recetas-tag tone-neu">Sin trazabilidad</span>' : `<sl-button variant="default" size="small" type="button" class="inventario-threshold-btn" data-open-production-trace="${escapeHtml(trace.productionId)}"><i slot="prefix" class="fa-solid fa-users-viewfinder"></i><span>Trazabilidad</span></sl-button>`}</td></tr>`).join('')
          : '';
        const availableQtyInUnit = getAvailableInUnit(entry, entry.unit || '');
        const availableClass = availableQtyInUnit <= 0.0001 ? 'is-zero' : '';
        const expiredQtyClass = isExpiredAvailable ? 'inventario-expired-strike' : '';
        const resolutionHtml = (!isCollapsed && resolutionRow) ? `<tr class="inventario-resolution-row"><td><div class="inventario-trace-main"><img src="./IMG/Octicons-git-merge.svg" alt="merge" class="inventario-trace-icon">${formatDateTime(resolutionRow.at)}</div></td><td><span class="inventario-resolution-badge">${escapeHtml(resolutionRow.badge)}</span></td><td class="is-num inventario-trace-kilos">-${resolutionRow.resolvedKg.toFixed(2)} kilos<br><span class="inventario-available-line is-zero">disp. ${resolutionRow.availableKg.toFixed(3)} kg</span></td><td class="is-code">${escapeHtml(entry.invoiceNumber || '-')}</td><td>${escapeHtml(entry.lotNumber || '-')}</td><td class="inventario-provider-cell">${escapeHtml(providerLabel(entry.provider))}</td><td><span class="recetas-tag tone-neu">Sin trazabilidad</span></td></tr>` : '';
        return `<tr class="inventario-row-tone ${isExpiredAvailable ? 'is-expired-row' : ''} ${resolutionLabel ? 'is-resolution-row' : ''} ${index % 2 === 0 ? 'is-even-row' : 'is-odd-row'}"><td>${formatEntryDateTime(entry.entryDate, entry.createdAt)}${getExpiryBadgeHtml(entry) ? `<br><small>${getExpiryBadgeHtml(entry)}</small>` : ''}</td><td>${escapeHtml(formatExpiryForUi(entry))} </td><td class="is-num"><span class="inv-qty ${expiredQtyClass}">${Number(entry.qty || 0).toFixed(2)} ${escapeHtml(entry.unit || '')}</span><br><span class="inventario-available-line ${availableClass} ${expiredQtyClass}">disp. ${getAvailableInUnit(entry, entry.unit).toFixed(2)} ${escapeHtml(getMeasureAbbr(entry.unit || ''))}${entry.packageQty ? ` x${entry.packageQty}` : ''}</span></td><td class="is-code">${escapeHtml(entry.invoiceNumber || '-')}</td><td class="is-code inventario-lot-cell">${escapeHtml(entry.lotNumber || '-')}${entry.customLot ? '<br><small class="text-muted">lote propio</small>' : ''}</td><td class="inventario-provider-cell">${escapeHtml(providerLabel(entry.provider))}</td><td><div class="inventario-entry-actions">${(traceRows.length || resolutionRow) ? `<sl-button variant="default" size="small" type="button" class="lj-icon-btn inventario-threshold-btn inventario-icon-only-btn" data-expanded-entry-collapse="${entry.id}" aria-label="Ver detalle" title="Ver detalle"><i class="fa-solid ${isCollapsed ? 'fa-chevron-down' : 'fa-chevron-up'}"></i></sl-button>` : ''}${buildExpandedImageCell(entryImageUrls(entry))}</div></td></tr>${resolutionHtml}${traceHtml}`;
      }).join('') : '<tr><td colspan="7" class="text-center">Sin ingresos para mostrar.</td></tr>';
      await openIosSwal({
        ljModal: true,
        title: 'Historial ampliado',
        html: '<div id="inventarioExpandedEntryHost" class="inventario-expand-wrap"></div>',
        width: '92vw',
        confirmButtonText: 'Cerrar',
        didOpen: (popup) => {
          const renderContent = () => {
            const host = popup.querySelector('#inventarioExpandedEntryHost');
            if (!host) return;
            const pages = Math.max(1, Math.ceil(fullRows.length / PAGE_SIZE));
            expandedPage = Math.min(Math.max(1, expandedPage), pages);
            const start = (expandedPage - 1) * PAGE_SIZE;
            const pageRows = fullRows.slice(start, start + PAGE_SIZE);
            const canCollapse = fullRows.some((entry) => hasEntryDetailRows(entry) && collapseMap[entry.id] === false);
            const canExpand = fullRows.some((entry) => hasEntryDetailRows(entry) && collapseMap[entry.id] !== false);
            host.innerHTML = `<div class="inventario-print-row mb-2 inventario-trace-toolbar toolbar-scroll-x"><sl-button variant="default" size="small" type="button" class="inventario-threshold-btn" id="inventarioExpandedEntryCollapseAllRowsBtn" ${canCollapse ? '' : 'disabled'}><i slot="prefix" class="fa-solid fa-compress"></i><span>Colapsar todo</span></sl-button><sl-button variant="default" size="small" type="button" class="inventario-threshold-btn" id="inventarioExpandedEntryExpandAllRowsBtn" ${canExpand ? '' : 'disabled'}><i slot="prefix" class="fa-solid fa-expand"></i><span>Descolapsar todo</span></sl-button></div><div class="table-responsive inventario-table-compact-wrap"><table class="table recipe-table inventario-table-compact mb-0"><thead><tr><th>Fecha y hora</th><th>Fecha caducidad</th><th class="is-num">Cantidad</th><th>Nº factura</th><th>Lote</th><th>Proveedor</th><th>Imagen</th></tr></thead><tbody>${renderRows(pageRows)}</tbody></table></div><div class="inventario-pagination enhanced"><sl-button variant="default" size="small" type="button" class="lj-icon-btn inventario-threshold-btn inventario-page-btn" data-expanded-entry-page="prev" ${expandedPage <= 1 ? 'disabled' : ''} aria-label="Página anterior" title="Página anterior"><i class="fa-solid fa-chevron-left"></i></sl-button><span>Página ${expandedPage} de ${pages}</span><sl-button variant="default" size="small" type="button" class="lj-icon-btn inventario-threshold-btn inventario-page-btn" data-expanded-entry-page="next" ${expandedPage >= pages ? 'disabled' : ''} aria-label="Página siguiente"><i class="fa-solid fa-chevron-right"></i></sl-button></div>`;
          };
          renderContent();
          popup.addEventListener('click', async (event) => {
            const entryCollapseBtn = event.target.closest('[data-expanded-entry-collapse]');
            if (entryCollapseBtn) {
              const entryId = entryCollapseBtn.dataset.expandedEntryCollapse;
              collapseMap[entryId] = !collapseMap[entryId];
              renderContent();
              return;
            }
            if (event.target.closest('#inventarioExpandedEntryCollapseAllRowsBtn')) {
              fullRows.forEach((entry) => {
                if (hasEntryDetailRows(entry)) collapseMap[entry.id] = true;
              });
              renderContent();
              return;
            }
            if (event.target.closest('#inventarioExpandedEntryExpandAllRowsBtn')) {
              fullRows.forEach((entry) => {
                if (hasEntryDetailRows(entry)) collapseMap[entry.id] = false;
              });
              renderContent();
              return;
            }
            const entryPageBtn = event.target.closest('[data-expanded-entry-page]');
            if (entryPageBtn) {
              expandedPage += entryPageBtn.dataset.expandedEntryPage === 'next' ? 1 : -1;
              renderContent();
              return;
            }
            const traceBtn = event.target.closest('[data-open-production-trace]');
            if (traceBtn) {
              const productionId = normalizeValue(traceBtn.dataset.openProductionTrace);
              if (productionId) await window.laJamoneraProduccionAPI?.openTraceabilityById?.(productionId);
              return;
            }
            const imageBtn = event.target.closest('.js-open-expanded-image');
            if (!imageBtn) return;
            try {
              const urls = JSON.parse(decodeURIComponent(imageBtn.dataset.images || '[]'));
              if (Array.isArray(urls) && urls.length) {
                await openAttachmentViewer([{ invoiceImageUrls: urls }], 0, 'Imagen del ingreso');
              }
            } catch (error) {
            }
          });
        },
        customClass: {
          popup: 'ios-alert inventario-expand-alert',
          confirmButton: 'ios-btn-secondary'
        }
      });
    });

    nodes.editorForm.querySelector('#inventarioPrintFilteredBtn')?.addEventListener('click', async () => {
      await openPrintEntries(ingredient, getFilteredEntries(Array.isArray(record.entries) ? record.entries : []));
    });
    nodes.editorForm.querySelector('#inventarioPrintAllBtn')?.addEventListener('click', async () => {
      await openPrintEntries(ingredient, Array.isArray(record.entries) ? record.entries : []);
    });

    nodes.editorForm.querySelector('#inventarioExcelBtn')?.addEventListener('click', async () => {
      const rows = getFilteredEntries(Array.isArray(record.entries) ? record.entries : []);
      const payload = buildExportRowsForEntries(rows, true);
      await makeWorkbook({
        fileName: `inventario_${normalizeLower(ingredient.name || 'producto')}_${Date.now()}.xlsx`,
        sheetName: 'Historial',
        headers: ['Fecha', 'Fecha caducidad', 'Cantidad', 'N° factura', 'Lote', 'Proveedor', 'Imágenes'],
        rows: payload
      });
    });

    nodes.editorForm.querySelectorAll('[data-print-entry]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const entryId = btn.dataset.printEntry;
        const entry = (record.entries || []).find((item) => item.id === entryId);
        if (!entry) return;
        await openPrintEntries(ingredient, [entry]);
      });
    });

    nodes.editorForm.querySelectorAll('[data-entry-page]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.tablePage += btn.dataset.entryPage === 'next' ? 1 : -1;
        renderEditor(ingredientId, state.editorDraft);
      });
    });

    nodes.editorForm.querySelectorAll('[data-edit-entry]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const icon = btn.querySelector('i');
        const previousIcon = icon?.className || '';
        btn.setAttribute('disabled', 'disabled');
        if (icon) icon.className = 'fa-solid fa-spinner fa-spin';
        await new Promise((resolve) => requestAnimationFrame(() => resolve()));
        loadEntryIntoStockForm(ingredientId, btn.dataset.editEntry);
        if (icon) icon.className = previousIcon;
        btn.removeAttribute('disabled');
      });
    });

    const closeEntryMoreMenus = () => {
      nodes.editorForm.querySelectorAll('[data-entry-more-menu]').forEach((menu) => {
        menu.classList.add('d-none');
        menu.style.left = '';
        menu.style.top = '';
      });
    };
    const positionEntryMoreMenu = (btn, menu) => {
      if (!btn || !menu) return;
      menu.classList.remove('d-none');
      const rect = btn.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      const gap = 8;
      const left = Math.min(
        Math.max(12, rect.right - menuRect.width),
        window.innerWidth - menuRect.width - 12
      );
      const openBelow = rect.bottom + gap + menuRect.height < window.innerHeight - 12;
      const top = openBelow
        ? rect.bottom + gap
        : Math.max(12, rect.top - menuRect.height - gap);
      menu.style.left = `${left}px`;
      menu.style.top = `${top}px`;
    };
    nodes.editorForm.querySelectorAll('[data-entry-more]').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        event.stopPropagation();
        const menu = nodes.editorForm.querySelector(`[data-entry-more-menu="${btn.dataset.entryMore}"]`);
        const willOpen = menu?.classList.contains('d-none');
        closeEntryMoreMenus();
        if (willOpen) positionEntryMoreMenu(btn, menu);
      });
    });
    nodes.editorForm.querySelectorAll('[data-clear-entry-movements]').forEach((btn) => {
      btn.addEventListener('click', async (event) => {
        event.stopPropagation();
        if (btn.disabled) return;
        closeEntryMoreMenus();
        const updated = await clearEntryMovements(ingredientId, btn.dataset.clearEntryMovements);
        if (!updated) return;
        await reloadEditorData(ingredientId);
        renderEditor(ingredientId, state.editorDraft);
      });
    });
    nodes.editorForm.querySelector('.inventario-table-wrap')?.addEventListener('click', closeEntryMoreMenus);

    nodes.editorForm.querySelectorAll('[data-delete-entry]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const deleted = await removeEntryWithSecurity(ingredientId, btn.dataset.deleteEntry);
        if (!deleted) return;
        state.tablePage = 1;
        await reloadEditorData(ingredientId);
        renderEditor(ingredientId, state.editorDraft);
      });
    });

    nodes.editorForm.querySelectorAll('[data-open-invoice-image]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const entryId = btn.dataset.openInvoiceImage;
        const entry = (record.entries || []).find((item) => item.id === entryId);
        if (!entry || !entryImageUrls(entry).length) return;
        await openAttachmentViewer([entry], 0, 'Factura / Remito');
      });
    });

    if (window.flatpickr) {
      const locale = window.flatpickr.l10ns?.es || undefined;
      window.flatpickr(nodes.editorForm.querySelector('#inventoryEntryDate'), {
        locale,
        dateFormat: 'Y-m-d',
        altInput: true,
        altFormat: 'd/m/Y',
        allowInput: true,
        disableMobile: true
      });
      const entryInput = nodes.editorForm.querySelector('#inventoryEntryDate');
      const expiryInput = nodes.editorForm.querySelector('#inventoryExpiryDate');
      const entryPicker = entryInput?._flatpickr || null;
      const getEntryDateValue = () => normalizeValue(entryInput?.value || state.editorDraft.entryDate || '');
      const syncExpiryMinDate = () => {
        const minDate = getEntryDateValue() || null;
        expiryInput?._flatpickr?.set('minDate', minDate);
        nodes.editorForm.querySelectorAll('[data-bulk-expiry-date]').forEach((bulkInput) => {
          bulkInput?._flatpickr?.set('minDate', minDate);
        });
      };

      window.flatpickr(expiryInput, {
        locale,
        dateFormat: 'Y-m-d',
        altInput: true,
        altFormat: 'd/m/Y',
        allowInput: true,
        disableMobile: true
      });
      nodes.editorForm.querySelectorAll('[data-bulk-entry-date]').forEach((input) => {
        window.flatpickr(input, {
          locale,
          dateFormat: 'Y-m-d',
          altInput: true,
          altFormat: 'd/m/Y',
          allowInput: true,
          disableMobile: true
        });
      });
      nodes.editorForm.querySelectorAll('[data-bulk-expiry-date]').forEach((input) => {
        window.flatpickr(input, {
          locale,
          dateFormat: 'Y-m-d',
          altInput: true,
          altFormat: 'd/m/Y',
          allowInput: true,
          disableMobile: true,
          minDate: getEntryDateValue() || null
        });
      });

      if (entryPicker) {
        entryPicker.set('onChange', [
          () => {
            syncExpiryMinDate();
            syncDraft();
          }
        ]);
      }
      entryInput?.addEventListener('change', syncExpiryMinDate);
      entryInput?.addEventListener('input', syncExpiryMinDate);
      const bindPickerTouchOpen = (input) => {
        const picker = input?._flatpickr;
        if (!picker) return;
        const openPicker = () => {
          try { picker.open(); } catch (_e) {}
        };
        input.addEventListener('focus', openPicker);
        input.addEventListener('click', openPicker);
        if (picker.altInput) {
          picker.altInput.addEventListener('focus', openPicker);
          picker.altInput.addEventListener('click', openPicker);
          picker.altInput.setAttribute('inputmode', 'none');
        }
      };
      bindPickerTouchOpen(entryInput);
      bindPickerTouchOpen(expiryInput);
      nodes.editorForm.querySelectorAll('[data-bulk-entry-date], [data-bulk-expiry-date]').forEach((input) => bindPickerTouchOpen(input));
      syncExpiryMinDate();
    }

    wireTokenDrag();
    renderPattern();
    renderInvoiceFeedback();
    initThumbLoading(nodes.editorForm);

    const focusBulkIdx = Number(state.editorDraft.focusBulkSearchIndex);
    if (Number.isInteger(focusBulkIdx) && focusBulkIdx >= 0) {
      const focusInput = nodes.editorForm.querySelector(`[data-bulk-search="${focusBulkIdx}"]`);
      if (focusInput) {
        focusInput.focus();
      }
      state.editorDraft.focusBulkSearchIndex = null;
    }
  };

  const convertToKg = (qty, unit) => {
    const meta = getUnitMeta(unit);
    const amount = Number(qty || 0);
    if (!Number.isFinite(amount)) return 0;
    if (meta.category === 'peso') return toBase(amount, unit) / 1000;
    return 0;
  };

  const resolveExpiredEntryStock = async ({ ingredientId, entryId, resolutionType, qtyKg }) => {
    await ensureInventoryRecordDetail(ingredientId);
    const record = getRecord(ingredientId);
    const entries = Array.isArray(record.entries) ? [...record.entries] : [];
    const index = entries.findIndex((item) => normalizeValue(item.id) === normalizeValue(entryId));
    if (index < 0) return { ok: false, message: 'Lote no encontrado.' };
    const entry = { ...entries[index] };
    const expiryMeta = getEntryExpiryMeta(entry);
    if (!expiryMeta.isExpired) return { ok: false, message: 'El lote no está expirado o no tiene stock disponible.' };
    const availableKg = getAvailableKg(entry);
    const availableQty = getAvailableQty(entry);
    const hasKg = Number.isFinite(availableKg) && availableKg > 0.0001;
    const hasQty = Number.isFinite(availableQty) && availableQty > 0.0001;
    // Lotes cargados en unidades no convierten a kilos (convertToKg devuelve 0):
    // en ese caso se resuelve el stock completo por cantidad.
    if (!hasKg && !hasQty) return { ok: false, message: 'No hay stock disponible para resolver.' };
    const requestedQtyKg = Number(qtyKg);
    const safeQtyKg = hasKg
      ? (Number.isFinite(requestedQtyKg) && requestedQtyKg > 0.0001 ? Math.min(requestedQtyKg, availableKg) : availableKg)
      : 0;
    const ratio = hasKg ? safeQtyKg / availableKg : 1;
    const qtyToDiscount = Number((availableQty * ratio).toFixed(4));
    const availableBase = Number(entry.availableBase);
    const qtyBase = Number(entry.qtyBase);
    entry.availableKg = Number((availableKg - safeQtyKg).toFixed(4));
    entry.availableQty = Number(Math.max(0, availableQty - qtyToDiscount).toFixed(4));
    if (Number.isFinite(availableBase) && Number.isFinite(qtyBase) && qtyBase > 0) {
      const baseDiscount = Number((availableBase * ratio).toFixed(6));
      entry.availableBase = Number(Math.max(0, availableBase - baseDiscount).toFixed(6));
    }
    entry.expiryResolutions = Array.isArray(entry.expiryResolutions) ? entry.expiryResolutions : [];
    entry.expiryResolutions.unshift({
      id: makeId('expiry_resolution'),
      createdAt: Date.now(),
      type: normalizeValue(resolutionType),
      qtyKg: Number(safeQtyKg.toFixed(4))
    });
    entry.movementHistory = Array.isArray(entry.movementHistory) ? entry.movementHistory : [];
    entry.movementHistory.unshift({
      type: 'resolucion_vencido',
      createdAt: Date.now(),
      qty: qtyToDiscount,
      qtyUnit: normalizeValue(entry?.unit || record.stockUnit || 'kilos'),
      qtyKg: Number(safeQtyKg.toFixed(4)),
      reference: normalizeValue(resolutionType),
      observation: normalizeValue(resolutionType) === 'decommissioned' ? 'Lote vencido decomisado' : 'Lote vencido vendido en mostrador'
    });
    if (entry.availableKg <= 0.0001 && entry.availableQty <= 0.0001) {
      entry.expiryResolutionStatus = normalizeValue(resolutionType);
      entry.status = normalizeValue(resolutionType);
      entry.lotStatus = normalizeValue(resolutionType) === 'decommissioned' ? 'decomisado' : 'sin_trazabilidad';
    }
    entries[index] = entry;
    record.entries = entries;
    record.stockKg = Number(entries.reduce((acc, row) => acc + getAvailableKg(row), 0).toFixed(4));
    recomputeRecordStock(record, entry.unit || 'kilos');
    state.inventario.items[ingredientId] = record;
    rebuildInventarioIndexes();
    await persistInventario({ itemIds: [ingredientId] });
    return { ok: true, resolvedKg: safeQtyKg, remainingKg: entry.availableKg };
  };

  const backToList = async () => {
    if (state.editorDirty) {
      const answer = await openIosSwal({
        title: '¿Abandonar cambios?',
        html: '<p>Hay cambios sin guardar en este ingreso.</p>',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Abandonar',
        cancelButtonText: 'Seguir editando'
      });
      if (!answer.isConfirmed) return;
    }
    state.editorDirty = false;
    state.editorDraft = null;
    setStateView('list');
    renderFamilies();
    renderList();
  };

  const saveLotConfigOnly = async (ingredientId) => {
    // Mismo patrón que saveSuggestedExpiryDays: spinner dentro del botón,
    // sin alert de éxito. Sólo muestra alert si hay error.
    const record = getRecord(ingredientId);
    const draft = safeObject(state.editorDraft);
    const btn = nodes.editorForm?.querySelector('#saveLotConfigBtn');
    const spinner = nodes.editorForm?.querySelector('#saveLotConfigSpinner');
    const iconEl = btn?.querySelector('.fa-floppy-disk');
    if (btn) btn.disabled = true;
    spinner?.classList.remove('d-none');
    iconEl?.classList.add('d-none');
    try {
      record.lotConfig = {
        configured: Array.isArray(draft.tokens) && draft.tokens.length > 0,
        collapsed: Array.isArray(draft.tokens) && draft.tokens.length > 0,
        version: LOT_CONFIG_VERSION,
        tokens: [...(Array.isArray(draft.tokens) ? draft.tokens : [])],
        customAcronym: normalizeValue(draft.customAcronym),
        includeSeparator: Boolean(draft.includeSeparator),
        separator: normalizeValue(draft.separator) || '-'
      };
      state.inventario.items[ingredientId] = record;
      rebuildInventarioIndexes();
      await persistInventario({ itemIds: [ingredientId] });
      state.editorDirty = false;
      // Re-render para reflejar el estado guardado, sin alert de éxito.
      renderEditor(ingredientId, state.editorDraft);
    } catch (error) {
      await openIosSwal({ title: 'No se pudo actualizar lote', html: '<p>Ocurrió un error guardando la configuración de lote.</p>', icon: 'error', confirmButtonText: 'Entendido' });
    } finally {
      if (btn) btn.disabled = false;
      spinner?.classList.add('d-none');
      iconEl?.classList.remove('d-none');
    }
  };

  const saveEntry = async (event) => {
    event.preventDefault();
    const ingredientId = state.selectedIngredientId;
    if (!ingredientId) return;

    await ensureInventoryRecordDetail(ingredientId);
    const record = getRecord(ingredientId);
    const suggestedInput = nodes.editorForm.querySelector('#inventarioSuggestedExpiryDays');
    if (suggestedInput) {
      const sVal = parseInt(suggestedInput.value || '', 10);
      record.suggestedExpiryDays = Number.isNaN(sVal) || sVal < 0 ? null : sVal;
    }

    const qty = parseNumber(nodes.editorForm.querySelector('#inventoryQty')?.value);
    const ingredient = state.ingredientes[ingredientId] || {};
    const unit = normalizeValue(ljSelectValue(nodes.editorForm.querySelector('#inventoryUnit')) || ingredient.measure || 'kilos');
    const packageQtyRaw = normalizeValue(nodes.editorForm.querySelector('#inventoryPackageQty')?.value);
    const packageQty = packageQtyRaw ? Number.parseInt(packageQtyRaw, 10) : null;
    const entryDate = normalizeValue(nodes.editorForm.querySelector('#inventoryEntryDate')?.value);
    const noPerecedero = Boolean(nodes.editorForm.querySelector('#inventoryNoPerecedero')?.checked);
    const isFrozenMain = Boolean(nodes.editorForm.querySelector('#inventoryIsFrozen')?.checked);
    // Si es congelado y no es no-perecedero, forzamos vto = entryDate + 60 días.
    const expiryDate = (isFrozenMain && !noPerecedero && entryDate)
      ? (addDaysToIso(entryDate, FROZEN_EXPIRY_DAYS) || normalizeValue(nodes.editorForm.querySelector('#inventoryExpiryDate')?.value))
      : normalizeValue(nodes.editorForm.querySelector('#inventoryExpiryDate')?.value);
    const usoInternoEmpresa = Boolean(nodes.editorForm.querySelector('#inventoryUsoInternoEmpresa')?.checked);
    const invoiceNumber = normalizeValue(nodes.editorForm.querySelector('#inventoryInvoiceNumber')?.value);
    const remitoNumber = normalizeValue(nodes.editorForm.querySelector('#inventoryRemitoNumber')?.value);
    const customLot = normalizeValue(nodes.editorForm.querySelector('#inventoryCustomLot')?.value);
    const providerId = normalizeValue(nodes.editorForm.querySelector('#inventoryProvider')?.value);
    const providerData = findProviderById(providerId);
    const provider = providerLabel(providerId);
    const editingEntryId = normalizeValue(state.editorDraft?.editingEntryId);
    const isEditingEntry = Boolean(editingEntryId);
    const bulkEntries = isEditingEntry ? [] : (Array.isArray(state.editorDraft.bulkEntries) ? state.editorDraft.bulkEntries : []);

    if (isInfiniteStockRecord(record)) {
      await openIosSwal({ title: 'Stock infinito', html: `<p>${escapeHtml(INFINITE_STOCK_NOTICE)}</p>`, icon: 'info', confirmButtonText: 'Entendido' });
      return;
    }

    if (!isEditingEntry && !record.hasEntries && !state.editorDraft.tokens.length) {
      await openIosSwal({
        title: 'Configuración requerida',
        html: '<p>Antes del primer ingreso debés configurar el LOTE.</p>',
        icon: 'warning',
        confirmButtonText: 'Entendido'
      });
      return;
    }

    const weeklySheet = { ...getDefaultWeeklySheetConfig(), ...safeObject(record.weeklySheetConfig) };
    if (!isEditingEntry && !record.hasEntries && !weeklySheet.configured) {
      const configured = await openWeeklySheetConfig(ingredientId, { force: true });
      if (!configured) return;
    }

    if (!Number.isFinite(qty) || qty <= 0) {
      await openIosSwal({ title: 'Cantidad inválida', html: '<p>Ingresá una cantidad mayor a 0.</p>', icon: 'warning', confirmButtonText: 'Entendido' });
      return;
    }

    if (Number.isFinite(packageQty) && packageQty <= 0) {
      await openIosSwal({ title: 'Cantidad por paquete inválida', html: '<p>Ingresá un valor entero mayor a 0.</p>', icon: 'warning', confirmButtonText: 'Entendido' });
      return;
    }

    if (record.stockUnit && measureKey(record.stockUnit) !== measureKey(unit)) {
      await openIosSwal({ title: 'Unidad incompatible', html: '<p>Estás intentando ingresar una unidad distinta a la configurada para este ingrediente.</p>', icon: 'warning', confirmButtonText: 'Entendido' });
      return;
    }
    if (record.packageQty && Number.isFinite(packageQty) && Number(record.packageQty) !== Number(packageQty)) {
      await openIosSwal({ title: 'Cantidad por paquete bloqueada', html: `<p>Este ingrediente ya tiene definida una cantidad por paquete de <strong>${record.packageQty}</strong>.</p>`, icon: 'warning', confirmButtonText: 'Entendido' });
      return;
    }

    if (!entryDate || (!noPerecedero && !expiryDate)) {
      await openIosSwal({ title: 'Fechas incompletas', html: `<p>Completá fecha de ingreso ${noPerecedero ? '' : 'y caducidad'}.</p>`, icon: 'warning', confirmButtonText: 'Entendido' });
      return;
    }

    if (!invoiceNumber) {
      await openIosSwal({ title: 'Dato faltante', html: '<p>Completá el número de factura.</p>', icon: 'warning', confirmButtonText: 'Entendido' });
      return;
    }

    if (!providerId || !providerData?.id) {
      await openIosSwal({ title: 'Proveedor requerido', html: '<p>Seleccioná un proveedor de la lista antes de guardar el ingreso.</p>', icon: 'warning', confirmButtonText: 'Entendido' });
      return;
    }

    const duplicateEntryId = state.inventario.indexes?.invoiceByIngredient?.[ingredientId]?.[normalizeLower(invoiceNumber)];
    if (duplicateEntryId && duplicateEntryId !== editingEntryId) {
      await openIosSwal({
        title: 'Ingreso duplicado',
        html: '<p>Ya existe un ingreso para este producto con ese número de factura/remito.</p>',
        icon: 'warning',
        confirmButtonText: 'Entendido'
      });
      return;
    }

    const bulkIngredientIds = [...new Set(bulkEntries.map((extra) => normalizeValue(extra.ingredientId)).filter(Boolean))];
    await Promise.all(bulkIngredientIds.map((id) => ensureInventoryRecordDetail(id)));
    const unresolvedInventory = [ingredientId, ...bulkIngredientIds].filter((id) => getRecord(id).__indexLite);
    if (unresolvedInventory.length) {
      await openIosSwal({ title: 'No se pudo guardar', html: '<p>No pudimos cargar el detalle exacto de inventario. Reintentá en unos segundos.</p>', icon: 'error', confirmButtonText: 'Entendido' });
      return;
    }

    for (const extra of bulkEntries) {
      const extraIngredientId = normalizeValue(extra.ingredientId);
      if (!extraIngredientId) {
        await openIosSwal({ title: 'Producto faltante', html: '<p>Completá el producto en "Productos en factura" o eliminá la fila vacía.</p>', icon: 'warning', confirmButtonText: 'Entendido' });
        return;
      }
      const extraRecord = getRecord(extraIngredientId);
      if (isInfiniteStockRecord(extraRecord)) {
        const extraIngredient = state.ingredientes[extraIngredientId] || {};
        await openIosSwal({ title: 'Stock infinito', html: `<p>${escapeHtml(capitalize(extraIngredient.name || 'Producto'))} tiene stock infinito y no admite ingreso manual.</p>`, icon: 'info', confirmButtonText: 'Entendido' });
        return;
      }
      const extraQty = parseNumber(extra.qty);
      if (!Number.isFinite(extraQty) || extraQty <= 0) {
        await openIosSwal({ title: 'Cantidad inválida', html: '<p>Revisá la cantidad en productos adicionales.</p>', icon: 'warning', confirmButtonText: 'Entendido' });
        return;
      }
      const extraNoPerecedero = Boolean(extra.noPerecedero);
      const extraExpiry = normalizeValue(extra.expiryDate || expiryDate);
      if (!extraNoPerecedero && !extraExpiry) {
        await openIosSwal({ title: 'Fechas incompletas', html: '<p>Revisá fecha de caducidad en productos adicionales.</p>', icon: 'warning', confirmButtonText: 'Entendido' });
        return;
      }
      if (state.inventario.indexes?.invoiceByIngredient?.[extraIngredientId]?.[normalizeLower(invoiceNumber)]) {
        await openIosSwal({ title: 'Ingreso duplicado', html: '<p>Ya existe un ingreso con esa factura para uno de los productos adicionales.</p>', icon: 'warning', confirmButtonText: 'Entendido' });
        return;
      }
    }

    const saveBtn = nodes.editorForm.querySelector('#saveInventoryBtn');
    const spinner = nodes.editorForm.querySelector('#saveInventorySpinner');
    const icon = nodes.editorForm.querySelector('#saveInventoryIcon');
    saveBtn.setAttribute('disabled', 'disabled');
    spinner?.classList.remove('d-none');
    icon?.classList.add('d-none');
    await new Promise((resolve) => requestAnimationFrame(() => resolve()));

    try {
      const invoiceImageUrls = await waitInvoiceDraftUploads();

      if (isEditingEntry) {
        const entries = Array.isArray(record.entries) ? [...record.entries] : [];
        const idx = entries.findIndex((item) => item.id === editingEntryId);
        if (idx < 0) throw new Error('No se encontró el ingreso a editar.');

        const entry = { ...entries[idx] };
        const entryUnit = entry.unit || unit;
        const qtyValue = Number(qty.toFixed(2));
        const qtyBase = Number(toBase(qtyValue, entryUnit).toFixed(6));
        const qtyKg = Number(convertToKg(qtyValue, entryUnit).toFixed(4));
        const previousQty = Number(entry.qty || 0);
        const previousAvailable = Number(getAvailableQty(entry) || 0);
        const consumedQty = Math.max(0, previousQty - previousAvailable);
        const nextAvailableQty = usoInternoEmpresa ? 0 : Number(Math.max(0, qtyValue - consumedQty).toFixed(2));
        const nextAvailableBase = Number(toBase(nextAvailableQty, entryUnit).toFixed(6));
        const nextAvailableKg = Number(convertToKg(nextAvailableQty, entryUnit).toFixed(4));
        const nextPackageQty = Number.isFinite(packageQty) ? packageQty : (record.packageQty || entry.packageQty || null);

        entry.qty = qtyValue;
        entry.unit = entryUnit;
        entry.qtyKg = qtyKg;
        entry.qtyBase = qtyBase;
        entry.availableQty = nextAvailableQty;
        entry.availableBase = nextAvailableBase;
        entry.availableKg = nextAvailableKg;
        entry.packageQty = nextPackageQty;
        entry.invoiceNumber = invoiceNumber;
        entry.remitoNumber = remitoNumber;
        entry.entryDate = entryDate;
        entry.expiryDate = noPerecedero ? '' : expiryDate;
        entry.noPerecedero = Boolean(noPerecedero);
        entry.usoInternoEmpresa = Boolean(usoInternoEmpresa);
        // Propagar flag de congelado y registrar fecha de congelación.
        entry.isFrozen = Boolean(isFrozenMain);
        if (isFrozenMain) {
          entry.frozenAt = entry.frozenAt || entryDate || getArgentinaIsoDate();
        } else {
          entry.frozenAt = '';
        }
        entry.provider = provider;
        entry.invoiceImageUrls = invoiceImageUrls;
        entry.invoiceImageUrl = invoiceImageUrls[0] || '';
        // Lote propio editado: si se carga uno, reemplaza el lote del ingreso.
        if (customLot) {
          entry.lotNumber = normalizeUpper(customLot);
          entry.customLot = normalizeUpper(customLot);
        } else if (!normalizeValue(entry.customLot)) {
          // Sin lote propio: regenerar el lote automático porque el vencimiento
          // pudo cambiar en esta edición (p.ej. congelado fuerza +60 días) y la
          // fecha dentro del lote debe reflejarlo.
          entry.lotNumber = buildLotNumber({
            lotConfig: {
              configured: state.editorDraft.tokens.length > 0,
              tokens: [...state.editorDraft.tokens],
              customAcronym: normalizeValue(state.editorDraft.customAcronym),
              includeSeparator: Boolean(state.editorDraft.includeSeparator),
              separator: normalizeValue(state.editorDraft.separator) || '-'
            },
            invoiceNumber,
            entryDate,
            expiryDate: noPerecedero ? '' : expiryDate,
            productName: state.ingredientes[ingredientId]?.name || ''
          });
        }
        entry.lastEditedAt = Date.now();

        if (usoInternoEmpresa) {
          const currentUsage = Array.isArray(entry.productionUsage) ? entry.productionUsage : [];
          const existingInternal = currentUsage.find((usage) => usage?.internalUse);
          const nonInternalUsage = currentUsage.filter((usage) => !usage?.internalUse);
          entry.productionUsage = [
            ...nonInternalUsage,
            {
              id: existingInternal?.id || makeId('usage_internal'),
              createdAt: existingInternal?.createdAt || Date.now(),
              producedAt: existingInternal?.producedAt || Date.now(),
              productionDate: entryDate,
              expiryDateAtProduction: 'Uso interno en empresa',
              kilosUsed: qtyKg,
              usedQty: qtyValue,
              usedUnit: entryUnit,
              lotNumber: entry.lotNumber || '',
              ingredientLot: entry.lotNumber || '',
              productionId: '-',
              internalUse: true,
              note: 'Auto egreso · Envases primarios & más'
            }
          ];
          entry.lotStatus = 'sin_trazabilidad';
        } else if (entry.lotStatus === 'sin_trazabilidad' && nextAvailableQty > 0) {
          entry.lotStatus = 'disponible';
        }

        entries[idx] = entry;
        record.entries = entries;
        record.stockUnit = record.stockUnit || entryUnit;
        record.packageQty = record.packageQty || nextPackageQty;
        record.hasEntries = entries.length > 0;
        recomputeRecordStock(record, record.stockUnit || entryUnit);
        state.inventario.items[ingredientId] = record;
        rebuildInventarioIndexes();
        await persistInventario({ itemIds: [ingredientId] });
        state.editorDirty = false;
        renderEditor(ingredientId, {
          ...state.editorDraft,
          editingEntryId: '',
          qty: '',
          invoiceNumber: '',
          remitoNumber: '',
          customLot: '',
          provider: '',
          invoiceImageCountLabel: 'Sin archivos seleccionados',
          invoiceImageFiles: [],
          invoiceUploadItems: [],
          noPerecedero: false,
          usoInternoEmpresa: false,
          expiryDate: addDaysToIso(getArgentinaIsoDate(), 5),
          entryDate: getArgentinaIsoDate(),
          bulkEntries: []
        });
        return;
      }

      const buildEntry = ({ targetIngredientId, targetRecord, qtyValue, unitValue, packageQtyValue, entryDateValue, expiryDateValue, noPerecederoValue, usoInternoValue, isFrozenValue, customLotValue = '' }) => {
        // Si es congelado y NO es no-perecedero, forzamos el vto a 60 días.
        if (isFrozenValue && !noPerecederoValue && entryDateValue) {
          const forced = addDaysToIso(entryDateValue, FROZEN_EXPIRY_DAYS);
          if (forced) expiryDateValue = forced;
        }
        const qtyBase = Number(toBase(qtyValue, unitValue).toFixed(6));
        const qtyKg = Number(convertToKg(qtyValue, unitValue).toFixed(4));
        // Lote propio del ingreso (ej: lote de fábrica de un condimento):
        // reemplaza al lote generado por la configuración.
        const customLot = normalizeUpper(customLotValue);
        const lotNumber = customLot || buildLotNumber({
          lotConfig: {
            configured: state.editorDraft.tokens.length > 0,
            tokens: [...state.editorDraft.tokens],
            customAcronym: normalizeValue(state.editorDraft.customAcronym),
            includeSeparator: Boolean(state.editorDraft.includeSeparator),
            separator: normalizeValue(state.editorDraft.separator) || '-'
          },
          invoiceNumber,
          entryDate: entryDateValue,
          expiryDate: noPerecederoValue ? '' : expiryDateValue,
          productName: state.ingredientes[targetIngredientId]?.name || ''
        });

        const entry = {
          id: makeId('entry'),
          qty: Number(qtyValue.toFixed(2)),
          unit: unitValue,
          qtyKg,
          qtyBase,
          availableQty: Number(qtyValue.toFixed(2)),
          availableBase: qtyBase,
          availableKg: qtyKg,
          packageQty: Number.isFinite(packageQtyValue) ? packageQtyValue : (targetRecord.packageQty || null),
          productionUsage: [],
          noPerecedero: noPerecederoValue,
          usoInternoEmpresa: usoInternoValue,
          isFrozen: Boolean(isFrozenValue),
          frozenAt: isFrozenValue ? entryDateValue : '',
          entryDate: entryDateValue,
          expiryDate: noPerecederoValue ? '' : expiryDateValue,
          invoiceNumber,
          remitoNumber,
          lotNumber,
          customLot,
          provider,
          lotStatus: 'disponible',
          invoiceImageUrl: invoiceImageUrls[0] || '',
          invoiceImageUrls,
          createdAt: Date.now()
        };

        if (usoInternoValue) {
          entry.productionUsage = [{
            id: makeId('usage_internal'),
            createdAt: Date.now(),
            producedAt: Date.now(),
            productionDate: entryDateValue,
            expiryDateAtProduction: 'Uso interno en empresa',
            kilosUsed: qtyKg,
            usedQty: Number(qtyValue.toFixed(2)),
            usedUnit: unitValue,
            lotNumber,
            ingredientLot: lotNumber,
            productionId: '-',
            internalUse: true,
            note: 'Auto egreso · Envases primarios & más'
          }];
          entry.availableQty = 0;
          entry.availableBase = 0;
          entry.availableKg = 0;
          entry.lotStatus = 'sin_trazabilidad';
        }

        targetRecord.entries = Array.isArray(targetRecord.entries) ? targetRecord.entries : [];
        targetRecord.entries.unshift(entry);
        targetRecord.stockUnit = targetRecord.stockUnit || unitValue;
        targetRecord.packageQty = targetRecord.packageQty || (Number.isFinite(packageQtyValue) ? packageQtyValue : null);
        targetRecord.hasEntries = true;
        recomputeRecordStock(targetRecord, targetRecord.stockUnit || unitValue);
        state.inventario.items[targetIngredientId] = targetRecord;
      };

      buildEntry({
        targetIngredientId: ingredientId,
        targetRecord: record,
        qtyValue: qty,
        unitValue: unit,
        packageQtyValue: packageQty,
        entryDateValue: entryDate,
        expiryDateValue: expiryDate,
        noPerecederoValue: noPerecedero,
        usoInternoValue: usoInternoEmpresa,
        isFrozenValue: isFrozenMain,
        customLotValue: customLot
      });

      for (const extra of bulkEntries) {
        const extraIngredientId = normalizeValue(extra.ingredientId);
        if (!extraIngredientId) continue;
        const extraIngredient = state.ingredientes[extraIngredientId];
        if (!extraIngredient) continue;
        const extraRecord = getRecord(extraIngredientId);
        const extraQty = parseNumber(extra.qty);
        const extraUnit = normalizeValue(extra.unit || extraRecord.stockUnit || extraIngredient.measure || 'kilos');
        const extraPackageRaw = normalizeValue(extra.packageQty);
        const extraPackage = extraPackageRaw ? Number.parseInt(extraPackageRaw, 10) : null;
        const extraEntryDate = normalizeValue(extra.entryDate || entryDate);
        const extraNoPerecedero = Boolean(extra.noPerecedero);
        const extraExpiryDate = normalizeValue(extra.expiryDate || expiryDate);
        buildEntry({
          targetIngredientId: extraIngredientId,
          targetRecord: extraRecord,
          qtyValue: extraQty,
          unitValue: extraUnit,
          packageQtyValue: extraPackage,
          entryDateValue: extraEntryDate,
          expiryDateValue: extraExpiryDate,
          noPerecederoValue: extraNoPerecedero,
          usoInternoValue: Boolean(extra.usoInternoEmpresa),
          isFrozenValue: Boolean(extra.isFrozen)
        });
      }
      record.lotConfig = {
        configured: state.editorDraft.tokens.length > 0,
        collapsed: state.editorDraft.tokens.length > 0,
        version: LOT_CONFIG_VERSION,
        tokens: [...state.editorDraft.tokens],
        customAcronym: normalizeValue(state.editorDraft.customAcronym),
        includeSeparator: Boolean(state.editorDraft.includeSeparator),
        separator: normalizeValue(state.editorDraft.separator) || '-'
      };

      // Guardar las preferencias de flags usadas en esta carga para
      // pre-tildarlas en la próxima vez que el usuario abra el editor.
      record.flagPreferences = {
        noPerecedero: Boolean(noPerecedero),
        isFrozen: Boolean(isFrozenMain),
        usoInternoEmpresa: Boolean(usoInternoEmpresa),
        savedAt: Date.now()
      };

      state.inventario.items[ingredientId] = record;
      rebuildInventarioIndexes();
      await persistInventario({ itemIds: [ingredientId, ...bulkIngredientIds] });
      state.editorDirty = false;
      state.tablePage = 1;
      renderEditor(ingredientId, {
        ...state.editorDraft,
        qty: '',
        invoiceNumber: '',
        remitoNumber: '',
        customLot: '',
        provider: '',
        invoiceImageCountLabel: 'Sin archivos seleccionados',
        invoiceImageFiles: [],
        invoiceUploadItems: [],
        editingEntryId: '',
        noPerecedero: false,
        usoInternoEmpresa: false,
        isFrozen: false,
        expiryDate: addDaysToIso(getArgentinaIsoDate(), 5),
        entryDate: getArgentinaIsoDate(),
        bulkEntries: []
      });
    } catch (error) {
      await openIosSwal({
        title: 'No se pudo guardar',
        html: `<p>${escapeHtml(error?.message || 'Ocurrió un error guardando el ingreso.')}</p>`,
        icon: 'error',
        confirmButtonText: 'Entendido'
      });
    } finally {
      saveBtn.removeAttribute('disabled');
      spinner?.classList.add('d-none');
      icon?.classList.remove('d-none');
    }
  };

  const snapshotEditorDraft = () => {
    if (state.view !== 'editor' || !state.selectedIngredientId) return;
    state.resumeEditor = {
      ingredientId: state.selectedIngredientId,
      draft: { ...safeObject(state.editorDraft) }
    };
  };

  const openCreateIngredient = async () => {
    await window.laJamoneraIngredientesAPI?.openIngredientForm?.();
    await loadData();
    renderProviderRneAlert();
    setStateView(Object.keys(state.ingredientes).length ? 'list' : 'empty');
    renderFamilies();
    renderList();
  };


  const openProviderRneEditor = async (providerId = '') => {
    const existing = findProviderById(providerId);
    const provider = existing || createProviderWithName('');
    const currentRne = safeObject(provider.rne);

    const result = await openIosSwal({
      title: existing ? `Proveedor: ${escapeHtml(provider.name)}` : 'Nuevo proveedor',
      html: `<div class="swal-stack-fields text-start">
        <label class="lj-label" for="providerNameInput"><strong>Nombre</strong></label>
        <sl-input id="providerNameInput" class="swal2-input" value="${escapeHtml(provider.name)}" placeholder="Nombre del proveedor"></sl-input>
        <label class="lj-label" for="providerRneNumberInput"><strong>RNE</strong></label>
        <sl-input id="providerRneNumberInput" class="swal2-input" value="${escapeHtml(currentRne.number || '')}" placeholder="Ej: 21-085083, RUCA N° 69354"></sl-input>
        <label class="lj-label" for="providerRneExpiryInput"><strong>Fecha de caducidad</strong></label>
        <input id="providerRneExpiryInput" class="lj-input swal2-input" value="${escapeHtml(currentRne.expiryDate || '')}" placeholder="Seleccionar fecha">
        <sl-checkbox class="inventario-check-row inventario-check-row-compact" id="providerRneInfiniteInput" ${currentRne.infiniteExpiry ? 'checked' : ''}>Vencimiento infinito (∞)</sl-checkbox>
        <label class="lj-label" for="providerRneObservationsInput"><strong>Observaciones</strong></label>
        <sl-textarea id="providerRneObservationsInput" class="swal2-textarea" rows="2" resize="auto" placeholder="Observaciones del registro" value="${escapeHtml(currentRne.observations || '')}"></sl-textarea>
        <label class="lj-label" for="providerRneFileInput"><strong>Adjunto PDF o imagen</strong></label>
        <input id="providerRneFileInput" class="image-file-input inventario-native-file" type="file" accept="image/*,application/pdf">
        ${normalizeValue(currentRne.attachmentUrl) ? '<small>Si subís un nuevo archivo, el actual pasa al historial.</small>' : '<small>Podés cargar el archivo más tarde.</small>'}
      </div>`,
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      cancelButtonText: 'Cancelar',
      customClass: {
        popup: 'inventario-provider-form-alert',
        htmlContainer: 'inventario-provider-form-html'
      },
      willOpen: () => {
        if (window.flatpickr) {
          const expiryInput = document.getElementById('providerRneExpiryInput');
          if (expiryInput) {
            window.flatpickr(expiryInput, {
              locale: window.flatpickr.l10ns?.es || undefined,
              dateFormat: 'Y-m-d',
              altInput: true,
              altFormat: 'd/m/Y',
              allowInput: true,
              disableMobile: true,
              defaultDate: normalizeValue(currentRne.expiryDate) || undefined
            });
          }
        }
        const infiniteInput = document.getElementById('providerRneInfiniteInput');
        const expiryInput = document.getElementById('providerRneExpiryInput');
        const syncInfinite = () => {
          if (!expiryInput) return;
          expiryInput.disabled = Boolean(infiniteInput?.checked);
          if (infiniteInput?.checked) expiryInput.value = '';
        };
        infiniteInput?.addEventListener('change', syncInfinite);
        syncInfinite();
      },
      didOpen: (popup) => {
        requestAnimationFrame(() => {
          popup.querySelector('#providerNameInput')?.focus({ preventScroll: true });
        });
      },
      preConfirm: async () => {
        const name = normalizeUpper(document.getElementById('providerNameInput')?.value);
        const number = normalizeValue(document.getElementById('providerRneNumberInput')?.value);
        const observations = normalizeValue(document.getElementById('providerRneObservationsInput')?.value);
        const infiniteExpiry = Boolean(document.getElementById('providerRneInfiniteInput')?.checked);
        const expiryDate = infiniteExpiry ? '' : normalizeIsoDate(document.getElementById('providerRneExpiryInput')?.value);
        const file = document.getElementById('providerRneFileInput')?.files?.[0] || null;

        if (!name) {
          Swal.showValidationMessage('Completá el nombre del proveedor.');
          return false;
        }
        if (file && !ALLOWED_RNE_UPLOAD_TYPES.includes(file.type)) {
          Swal.showValidationMessage('Adjunto RNE inválido. Permitido: PDF o imagen.');
          return false;
        }
        if (file && file.size > MAX_UPLOAD_SIZE_BYTES) {
          Swal.showValidationMessage('El adjunto RNE supera 5MB.');
          return false;
        }

        let attachmentUrl = normalizeValue(currentRne.attachmentUrl);
        let attachmentType = normalizeValue(currentRne.attachmentType);
        const history = Array.isArray(currentRne.history) ? [...currentRne.history] : [];

        if (file) {
          if (normalizeValue(currentRne.attachmentUrl) || normalizeValue(currentRne.number)) {
            history.unshift(buildProviderRneHistoryEntry(currentRne));
          }
          attachmentUrl = await uploadImageToStorage(file, 'inventario/proveedores/rne');
          attachmentType = file.type;
        }

        return {
          id: provider.id,
          name,
          createdAt: Number(provider.createdAt || Date.now()),
          rne: {
            ...getDefaultProviderRne(),
            ...currentRne,
            number,
            expiryDate,
            infiniteExpiry,
            observations,
            attachmentUrl,
            attachmentType,
            history,
            updatedAt: Date.now()
          }
        };
      }
    });

    if (!result.isConfirmed) return false;
    saveProviderInConfig(result.value);
    await persistInventario({ configOnly: true });
    renderProviderRneAlert();
    return true;
  };

  const openProvidersRneManager = async () => {
    state.providerRnePage = 1;
    state.providerRneSearch = '';
    state.pendingProviderDeleteId = '';
    const result = await openIosSwal({
      ljModal: true,
      title: 'Centro de proveedores · RNE',
      html: `<div class="inventario-provider-manager" id="inventarioProviderRneManagerRoot"></div>`,
      confirmButtonText: 'Cerrar',
      showCancelButton: false,
      customClass: {
        popup: 'inventario-provider-rne-alert',
        htmlContainer: 'inventario-provider-rne-html'
      },
      didOpen: () => {
        const popup = Swal.getPopup();
        const root = popup.querySelector('#inventarioProviderRneManagerRoot');
        const ui = {
          mode: 'list',
          providerId: '',
          setMode(nextMode, providerId = '') {
            ui.mode = nextMode;
            ui.providerId = providerId;
            rerenderPreservingScroll();
          }
        };

        const getDaysTone = (remainingDays) => {
          if (!Number.isFinite(remainingDays)) return 'is-warning';
          if (remainingDays < 60) return 'is-danger';
          if (remainingDays < 180) return 'is-warning';
          return 'is-ok';
        };

        const renderProviderCard = (provider) => {
          const rne = safeObject(provider.rne);
          const hasNoFood = Boolean(provider.nonFoodCategory);
          const hasRne = Boolean(normalizeValue(rne.number) || normalizeValue(rne.observations) || normalizeValue(rne.attachmentUrl));
          const remainingDays = getRneRemainingDays(rne.expiryDate);
          const isInfinite = Boolean(rne.infiniteExpiry);
          const daysTone = getDaysTone(remainingDays);
          const daysBadge = (hasRne && isInfinite)
            ? '<span class="receta-rnpa-days is-ok"><sl-icon name="infinity"></sl-icon></span>'
            : (hasRne && Number.isFinite(remainingDays))
            ? `<span class="receta-rnpa-days ${daysTone}"><sl-icon name="clock-history"></sl-icon>${escapeHtml(String(remainingDays))} días</span>`
            : '';
          const pendingBadge = '<span class="receta-rnpa-badge is-pending"><i class="fa-solid fa-triangle-exclamation"></i>RNE pendiente</span>';
          const okBadge = '<span class="receta-rnpa-badge is-ok"><i class="fa-solid fa-file-shield"></i>RNE adjunto</span>';
          const noFoodBadge = '<span class="receta-rnpa-badge tone-neutral"><i class="fa-solid fa-store-slash"></i>No alimentos</span>';
          const validFrom = normalizeValue(rne.validFrom);
          const validityText = hasRne
            ? `${isInfinite ? `${escapeHtml(formatIsoDateEs(validFrom || ''))} → ∞` : (rne.expiryDate ? `${escapeHtml(formatIsoDateEs(validFrom || rne.expiryDate))} → ${escapeHtml(formatIsoDateEs(rne.expiryDate))}` : `${escapeHtml(formatIsoDateEs(validFrom || ''))} → Sin caducidad`)}`
            : 'Sin vigencia registrada';

          return `<article class="inventario-provider-card">
            ${providerAvatarHtml(provider)}
            <div class="inventario-provider-main">
              <div class="inventario-provider-head">
                <strong>${escapeHtml(provider.name)}</strong>
                <div class="inventario-provider-badges">${hasNoFood ? noFoodBadge : (hasRne ? okBadge : pendingBadge)}${hasNoFood ? '' : daysBadge}</div>
              </div>
              <p class="inventario-provider-state">${hasNoFood ? 'Proveedor fuera del rubro alimentos' : (hasRne ? 'Registro cargado' : 'Sin registro')}</p>
              ${(provider.email || provider.phone) ? `<p class="inventario-provider-line"><small>${provider.email ? `<i class="fa-regular fa-envelope"></i> ${escapeHtml(provider.email)}` : ''}${provider.email && provider.phone ? ' · ' : ''}${provider.phone ? `<i class="fa-solid fa-phone"></i> ${escapeHtml(provider.phone)}` : ''}</small></p>` : ''}
              ${hasNoFood ? '<p class="inventario-provider-line"><strong>RNE:</strong> No requerido para este proveedor.</p>' : (hasRne ? `<p class="inventario-provider-line"><strong>N° RNE:</strong> ${escapeHtml(rne.number || 'Sin número')}</p><p class="inventario-provider-line"><strong>Vigencia:</strong> ${validityText}</p>${normalizeValue(rne.observations) ? `<p class="inventario-provider-line"><strong>Observaciones:</strong> ${escapeHtml(rne.observations)}</p>` : ''}` : '')}
              <div class="inventario-provider-actions inventario-provider-actions-top">
                <sl-button variant="danger" size="small" type="button" class="lj-icon-btn inventario-threshold-btn" data-provider-delete-request="${provider.id}" aria-label="Eliminar proveedor" title="Eliminar proveedor"><i class="fa-solid fa-trash"></i></sl-button><sl-button variant="default" size="small" type="button" class="inventario-threshold-btn" data-provider-rne-edit="${provider.id}"><i slot="prefix" class="fa-solid fa-file-pen"></i><span>${hasRne ? 'Editar registro' : 'Cargar Registro'}</span></sl-button>
                <sl-button variant="default" size="small" type="button" class="inventario-threshold-btn" data-provider-photo-view="${provider.id}" ${sanitizeImageUrl(provider.photoUrl) ? '' : 'disabled'}><i slot="prefix" class="fa-regular fa-image"></i><span>Ver foto</span></sl-button><sl-button variant="default" size="small" type="button" class="inventario-threshold-btn" data-provider-rne-view="${provider.id}" ${normalizeValue(rne.attachmentUrl) ? '' : 'disabled'}><i slot="prefix" class="fa-regular fa-eye"></i><span>Visualizar adjunto</span></sl-button>
              </div>
              ${state.pendingProviderDeleteId === provider.id ? buildProviderDeleteConfirmHtml(provider) : ''}
            </div>
          </article>`;
        };

        const renderList = () => {
          const activeSearch = document.activeElement?.id === 'inventarioProviderSearchInput';
          const cursorStart = activeSearch ? ljNativeInput(document.activeElement)?.selectionStart : null;
          const cursorEnd = activeSearch ? ljNativeInput(document.activeElement)?.selectionEnd : null;
          const counts = getProviderRneCounts();
          const options = [
            { key: 'all', label: 'Todos', tone: 'neutral', count: counts.all, icon: 'fa-list' },
            { key: 'none', label: 'Sin RNE', tone: 'info', count: counts.none, icon: 'fa-file-circle-xmark' },
            { key: 'warning', label: 'Por vencer · 6 meses', tone: 'warning', count: counts.warning, icon: 'fa-hourglass-half' },
            { key: 'danger', label: 'Vence pronto · 60 días', tone: 'danger', count: counts.danger, icon: 'fa-triangle-exclamation' }
          ];
          const buildPager = () => {
            const providers = sortedProviders().filter((provider) => {
              if (state.providerRneFilter !== 'all' && getProviderRneStatus(provider).key !== state.providerRneFilter) return false;
              if (!state.providerRneSearch) return true;
              const blob = [provider.name, provider.email, provider.phone, provider.rne?.number, provider.rne?.observations].map(normalizeLower).join(' ');
              return blob.includes(state.providerRneSearch);
            });
            const pager = getPagedRows(providers, state.providerRnePage, PAGE_SIZE);
            state.providerRnePage = pager.page;
            return pager;
          };
          const pager = buildPager();

          root.innerHTML = `<div class="inventario-provider-manager-head">
            <div class="inventario-provider-manager-copy-wrap">
              <p class="inventario-provider-manager-kicker">Proveedores</p>
              <p class="inventario-provider-manager-copy">RNE, vencimientos y adjuntos.</p>
            </div>
            <div class="produccion-config-actions">
              <sl-button variant="default" type="button" class="inventario-threshold-btn" id="inventarioProviderExportExcelBtn"><i slot="prefix" class="fa-solid fa-file-excel"></i><span>Descargar Excel</span></sl-button>
              <sl-button variant="default" type="button" class="inventario-threshold-btn" id="inventarioProviderImportExcelBtn"><i slot="prefix" class="fa-solid fa-file-arrow-up"></i><span>Subir Excel</span></sl-button>
              <input id="inventarioProviderImportExcelInput" class="d-none" type="file" accept=".xlsx,.xlsm,.xls">
              <sl-button variant="primary" type="button" class="inventario-threshold-btn inventario-provider-create-fab" id="inventarioProviderCreateBtn" aria-label="Nuevo proveedor"><i slot="prefix" class="fa-solid fa-plus"></i><span>Proveedor</span></sl-button>
            </div>
          </div>
          <sl-input id="inventarioProviderSearchInput" type="search" class="ingredientes-search-input inventario-provider-search" value="${escapeHtml(state.providerRneSearch)}" placeholder="Buscar proveedor"><i slot="prefix" class="fa-solid fa-magnifying-glass"></i></sl-input>
          <div id="inventarioProviderRneFilters" class="inventario-status-filters">${options.map((option) => `<sl-button variant="default" size="small" type="button" class="inventario-status-btn tone-${option.tone} ${state.providerRneFilter === option.key ? 'is-active' : ''}" data-provider-rne-filter="${option.key}" ${option.count === 0 ? "disabled" : ""}><i slot="prefix" class="fa-solid ${option.icon}"></i><span>${option.label}</span><strong>${option.count}</strong></sl-button>`).join('')}</div>
          <div id="inventarioProviderRneList" class="inventario-provider-rne-list">${pager.rows.length ? pager.rows.map(renderProviderCard).join('') : '<div class="ingrediente-empty-list">No hay proveedores para este filtro.</div>'}</div>
          <div class="inventario-pagination enhanced"><sl-button variant="default" size="small" type="button" class="lj-icon-btn inventario-threshold-btn inventario-page-btn" data-provider-page="prev" aria-label="Página anterior" title="Página anterior" ${pager.page <= 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-left"></i></sl-button><span>Página ${pager.page} de ${pager.pages}</span><sl-button variant="default" size="small" type="button" class="lj-icon-btn inventario-threshold-btn inventario-page-btn" data-provider-page="next" aria-label="Página siguiente" title="Página siguiente" ${pager.page >= pager.pages ? 'disabled' : ''}><i class="fa-solid fa-chevron-right"></i></sl-button></div>`;
          const renderProviderRowsOnly = () => {
            const nextPager = buildPager();
            const listNode = root.querySelector('#inventarioProviderRneList');
            const pagerWrap = root.querySelector('.inventario-pagination.enhanced');
            if (listNode) {
              listNode.innerHTML = nextPager.rows.length ? nextPager.rows.map(renderProviderCard).join('') : '<div class="ingrediente-empty-list">No hay proveedores para este filtro.</div>';
            }
            if (pagerWrap) {
              pagerWrap.innerHTML = `<sl-button variant="default" size="small" type="button" class="lj-icon-btn inventario-threshold-btn inventario-page-btn" data-provider-page="prev" aria-label="Página anterior" title="Página anterior" ${nextPager.page <= 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-left"></i></sl-button><span>Página ${nextPager.page} de ${nextPager.pages}</span><sl-button variant="default" size="small" type="button" class="lj-icon-btn inventario-threshold-btn inventario-page-btn" data-provider-page="next" aria-label="Página siguiente" title="Página siguiente" ${nextPager.page >= nextPager.pages ? 'disabled' : ''}><i class="fa-solid fa-chevron-right"></i></sl-button>`;
            }
            initThumbLoading(root);
          };
          const searchInput = root.querySelector('#inventarioProviderSearchInput');
          searchInput?.addEventListener('input', (event) => {
            state.providerRneSearch = normalizeLower(event.target.value);
            state.providerRnePage = 1;
            renderProviderRowsOnly();
          });
          if (activeSearch && searchInput) {
            requestAnimationFrame(() => {
              searchInput.focus({ preventScroll: true });
              if (Number.isFinite(cursorStart) && Number.isFinite(cursorEnd)) {
                searchInput.setSelectionRange(cursorStart, cursorEnd);
              }
            });
          }
          initThumbLoading(root);
        };

        const renderEditor = (providerId) => {
          const existing = findProviderById(providerId);
          const provider = existing || createProviderWithName('');
          const rne = { ...getDefaultProviderRne(), ...safeObject(provider.rne) };
          const history = Array.isArray(rne.history) ? rne.history : [];
          const historyHtml = history.length
            ? `<div class="produccion-rne-history">${history.map((item, index) => `<article class="produccion-rne-history-item" data-provider-history-item="${provider.id}|${index}"><div><strong>Versión ${index + 1}</strong><p><strong>N° RNE:</strong> ${escapeHtml(item.number || '-')}</p><p><strong>Vigencia:</strong> ${escapeHtml(formatIsoDateEs(item.validFrom || item.expiryDate || ''))} → ${item.replacedAt || item.savedAt ? escapeHtml(formatDateTime(item.replacedAt || item.savedAt)) : '-'}</p><p><strong>Vencimiento declarado:</strong> ${escapeHtml(item.expiryDate ? formatIsoDateEs(item.expiryDate) : '-')}</p>${normalizeValue(item.observations) ? `<p><strong>Observaciones:</strong> ${escapeHtml(item.observations)}</p>` : ''}</div><div class="produccion-rne-history-actions">${item.attachmentUrl ? `<sl-button variant="default" size="small" type="button" class="inventario-threshold-btn" data-provider-rne-history-view="${provider.id}|${index}"><sl-icon slot="prefix" name="eye"></sl-icon><span>Ver</span></sl-button>` : '<sl-button variant="danger" size="small" type="button" class="inventario-no-photo-btn" disabled>Sin adjunto</sl-button>'}<sl-button variant="danger" outline size="small" type="button" class="inventario-delete-btn inventario-threshold-btn" data-provider-rne-history-delete="${provider.id}|${index}"><i slot="prefix" class="fa-solid fa-trash"></i><span>Borrar</span></sl-button></div></article>`).join('')}</div>`
            : '<p class="produccion-rne-history-empty">Aún no hay historial de RNE.</p>';

          root.innerHTML = `<div class="inventario-provider-editor-top"><sl-button variant="default" type="button" class="inventario-threshold-btn" data-provider-rne-back><i slot="prefix" class="fa-solid fa-arrow-left"></i><span>Volver</span></sl-button></div>
            <section class="recipe-step-card step-block inventario-lot-section produccion-config-section">
              <div class="step-content">
                <label class="lj-label" for="providerNameInput"><strong>Proveedor</strong></label>
                <div class="inventario-provider-editor-top mt-2 mb-2">
                  ${providerAvatarHtml(provider, { size: 'editor' })}
                </div>
                <label class="lj-label mt-2" for="providerPhotoInput"><strong>Foto de perfil</strong> (opcional)</label>
                <div class="produccion-rne-file-row">
                  <input id="providerPhotoInput" class="image-file-input inventario-native-file" type="file" accept="image/*">
                </div>
                <sl-input id="providerNameInput" type="text" value="${escapeHtml(provider.name)}" placeholder="Nombre del proveedor"></sl-input>
                <label class="lj-label mt-2" for="providerEmailInput"><strong>Email</strong> (opcional)</label>
                <sl-input id="providerEmailInput" type="email" value="${escapeHtml(provider.email || '')}" placeholder="proveedor@email.com"></sl-input>
                <label class="lj-label mt-2" for="providerPhoneInput"><strong>Teléfono</strong> (opcional)</label>
                <sl-input id="providerPhoneInput" type="text" value="${escapeHtml(provider.phone || '')}" placeholder="+54 ..."></sl-input>
                <sl-checkbox class="inventario-check-row inventario-check-row-compact mt-2" id="providerNonFoodInput" ${provider.nonFoodCategory ? 'checked' : ''}>No pertenece al rubro alimentos</sl-checkbox>
                <label class="lj-label mt-2" for="providerRneNumberInput"><strong>Número de RNE</strong></label>
                <sl-textarea id="providerRneNumberInput" rows="1" resize="auto" class="inventario-rne-number-area" placeholder="Ej: 21-085083, RUCA N° 69354" value="${escapeHtml(rne.number || '')}"></sl-textarea>
                <small class="text-muted">Se acepta texto libre tal como figura en el registro.</small>
                <label class="lj-label mt-2" for="providerRneExpiryInput"><strong>Fecha de caducidad</strong></label>
                <input id="providerRneExpiryInput" type="text" class="lj-input" value="${escapeHtml(rne.expiryDate || '')}" placeholder="Seleccionar fecha">
                <sl-checkbox class="inventario-check-row inventario-check-row-compact mt-2" id="providerRneInfiniteInput" ${rne.infiniteExpiry ? 'checked' : ''}>Vencimiento infinito (∞)</sl-checkbox>
                <label class="lj-label mt-2" for="providerRneObservationsInput"><strong>Observaciones</strong></label>
                <sl-textarea id="providerRneObservationsInput" rows="2" resize="auto" placeholder="Observaciones del RNE" value="${escapeHtml(rne.observations || '')}"></sl-textarea>
                <label class="lj-label mt-2" for="providerRneFileInput"><strong>Archivo adjunto</strong> (PDF o imagen)</label>
                <div class="produccion-rne-file-row">
                  <input id="providerRneFileInput" class="image-file-input inventario-native-file" type="file" accept="image/*,application/pdf">
                  <span id="providerRneFileLoading" class="produccion-rne-upload-loading d-none"><sl-spinner class="meta-spinner-login produccion-rne-spinner" aria-label="Subiendo RNE"></sl-spinner></span>
                </div>
                <small class="text-muted">Se guarda la versión anterior en el historial.</small>
                <div class="produccion-config-actions mt-2">
                  <sl-button variant="default" type="button" class="inventario-threshold-btn" data-provider-rne-view="${provider.id}" ${normalizeValue(rne.attachmentUrl) ? '' : 'disabled'}><i slot="prefix" class="fa-regular fa-eye"></i><span>Visualizar adjunto actual</span></sl-button>
                  <sl-button variant="default" type="button" class="lj-icon-btn inventario-threshold-btn" data-provider-rne-delete="${provider.id}" aria-label="Borrar RNE" title="Borrar RNE" ${(normalizeValue(rne.number) || normalizeValue(rne.attachmentUrl)) ? '' : 'disabled'}><i class="fa-solid fa-trash"></i></sl-button>
                </div>
                <div class="produccion-rne-history-wrap mt-2">
                  <h6><strong>Historial de RNE</strong></h6>
                  ${historyHtml}
                </div>
                <div class="produccion-config-actions mt-3">
                  <sl-button variant="success" type="button" data-provider-rne-save="${provider.id}"><i slot="prefix" class="fa-solid fa-floppy-disk"></i><span>Guardar</span></sl-button>
                </div>
              </div>
            </section>`;

          if (window.flatpickr) {
            const expiryInput = root.querySelector('#providerRneExpiryInput');
            if (expiryInput) {
              window.flatpickr(expiryInput, {
                locale: window.flatpickr.l10ns?.es || undefined,
                dateFormat: 'Y-m-d',
                altInput: true,
                altFormat: 'd/m/Y',
                allowInput: true,
                disableMobile: true,
                defaultDate: normalizeValue(rne.expiryDate) || undefined
              });
            }
          }
          const infiniteInput = root.querySelector('#providerRneInfiniteInput');
          const nonFoodInput = root.querySelector('#providerNonFoodInput');
          const expiryInput = root.querySelector('#providerRneExpiryInput');
          const numberInputField = root.querySelector('#providerRneNumberInput');
          const observationsInputField = root.querySelector('#providerRneObservationsInput');
          const fileInputField = root.querySelector('#providerRneFileInput');
          const syncInfinite = () => {
            if (!expiryInput) return;
            const isNonFood = Boolean(nonFoodInput?.checked);
            expiryInput.disabled = Boolean(infiniteInput?.checked) || isNonFood;
            if (infiniteInput?.checked || isNonFood) expiryInput.value = '';
            if (numberInputField) numberInputField.disabled = isNonFood;
            if (observationsInputField) observationsInputField.disabled = isNonFood;
            if (fileInputField) fileInputField.disabled = isNonFood;
            if (isNonFood && numberInputField) numberInputField.value = '';
            if (isNonFood && observationsInputField) observationsInputField.value = '';
          };
          infiniteInput?.addEventListener('change', syncInfinite);
          nonFoodInput?.addEventListener('change', syncInfinite);
          syncInfinite();

          initThumbLoading(root);
          requestAnimationFrame(() => {
            root.querySelector('#providerNameInput')?.focus({ preventScroll: true });
          });
        };

        const rerender = () => {
          if (ui.mode === 'editor') {
            renderEditor(ui.providerId);
            return;
          }
          renderList();
          renderProviderRneAlert();
        };

        const rerenderPreservingScroll = () => {
          const htmlContainer = Swal.getHtmlContainer();
          const currentList = root.querySelector('#inventarioProviderRneList');
          const htmlScrollTop = htmlContainer?.scrollTop || 0;
          const listScrollTop = currentList?.scrollTop || 0;
          rerender();
          requestAnimationFrame(() => {
            if (htmlContainer) htmlContainer.scrollTop = htmlScrollTop;
            const nextList = root.querySelector('#inventarioProviderRneList');
            if (nextList) nextList.scrollTop = listScrollTop;
          });
        };

        root.addEventListener('click', async (event) => {
          const withButtonSpinner = async (button, task) => {
            if (!button) return;
            const icon = button.querySelector('i');
            const label = button.querySelector('span');
            const prevIcon = icon ? icon.className : '';
            const prevLabel = label ? label.textContent : '';
            button.disabled = true;
            if (icon) icon.className = 'fa-solid fa-spinner fa-spin';
            try {
              await task();
            } finally {
              if (icon) icon.className = prevIcon;
              if (label) label.textContent = prevLabel;
              button.disabled = false;
            }
          };

          const exportExcelBtn = event.target.closest('#inventarioProviderExportExcelBtn');
          if (exportExcelBtn) {
            await withButtonSpinner(exportExcelBtn, async () => {
              if (!window.ExcelJS) {
                await openIosSwal({ title: 'Excel no disponible', html: '<p>No se pudo cargar la librería ExcelJS.</p>', icon: 'error', confirmButtonText: 'Entendido' });
                return;
              }
              const wb = new window.ExcelJS.Workbook();
              const ws = wb.addWorksheet('RNE proveedores');
              ws.mergeCells('A1:D1');
              ws.getCell('A1').value = 'Si la fecha de vencimiento está vacía, se considera INFINITO (∞).';
              ws.getCell('A1').font = { bold: true, color: { argb: 'FF1F3D7A' } };
              ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F0FF' } };
              ws.getCell('A1').alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
              ws.getRow(1).height = 24;
              ws.getRow(3).values = ['Proveedor', 'RNE', 'Vencimiento', 'Observacion'];
              ws.getRow(3).height = 22;
              ws.columns = [
                { key: 'provider', width: 38 },
                { key: 'rne', width: 30 },
                { key: 'expiry', width: 20 },
                { key: 'observations', width: 44 }
              ];
              ws.views = [{ state: 'frozen', ySplit: 3 }];
              ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: 4 } };
              ws.getRow(3).eachCell((cell) => {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F7AE8' } };
                cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
                cell.alignment = { vertical: 'middle', horizontal: 'center' };
                cell.border = {
                  top: { style: 'thin', color: { argb: 'FFCED8EE' } },
                  left: { style: 'thin', color: { argb: 'FFCED8EE' } },
                  bottom: { style: 'thin', color: { argb: 'FFCED8EE' } },
                  right: { style: 'thin', color: { argb: 'FFCED8EE' } }
                };
              });
              sortedProviders().forEach((provider, index) => {
                const rowNumber = 4 + index;
                const row = ws.getRow(rowNumber);
                const isNonFood = Boolean(provider.nonFoodCategory);
                const rne = safeObject(provider.rne);
                row.getCell(1).value = provider.name || '';
                row.getCell(2).value = isNonFood ? 'NO REQUIERE' : normalizeValue(rne.number || '');
                row.getCell(3).value = isNonFood
                  ? 'NO REQUIERE'
                  : (normalizeValue(rne.expiryDate) ? new Date(`${normalizeValue(rne.expiryDate)}T00:00:00`) : '');
                row.getCell(4).value = isNonFood ? '' : normalizeValue(rne.observations || '');
                row.eachCell((cell) => {
                  cell.border = {
                    top: { style: 'thin', color: { argb: 'FFD8E2F5' } },
                    left: { style: 'thin', color: { argb: 'FFD8E2F5' } },
                    bottom: { style: 'thin', color: { argb: 'FFD8E2F5' } },
                    right: { style: 'thin', color: { argb: 'FFD8E2F5' } }
                  };
                  cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
                  cell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: isNonFood ? 'FFEDEFF5' : (index % 2 === 0 ? 'FFF5F8FF' : 'FFEAF1FF') }
                  };
                });
                if (!isNonFood) {
                  const expiryCell = row.getCell(3);
                  expiryCell.numFmt = 'yyyy-mm-dd';
                  expiryCell.dataValidation = {
                    type: 'date',
                    operator: 'greaterThan',
                    formulae: [new Date(1900, 0, 1)],
                    allowBlank: true,
                    showErrorMessage: true,
                    errorStyle: 'warning',
                    errorTitle: 'Fecha inválida',
                    error: 'Ingresá una fecha válida en formato fecha.'
                  };
                }
              });
              const buffer = await wb.xlsx.writeBuffer();
              const blob = new Blob([new Uint8Array(buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
              const url = URL.createObjectURL(blob);
              const anchor = document.createElement('a');
              anchor.href = url;
              anchor.download = `proveedores_rne_${Date.now()}.xlsx`;
              document.body.appendChild(anchor);
              anchor.click();
              anchor.remove();
              setTimeout(() => URL.revokeObjectURL(url), 2000);
            });
            return;
          }

          const importExcelBtn = event.target.closest('#inventarioProviderImportExcelBtn');
          if (importExcelBtn) {
            root.querySelector('#inventarioProviderImportExcelInput')?.click();
            return;
          }

          const createBtn = event.target.closest('#inventarioProviderCreateBtn');
          if (createBtn) {
            ui.setMode('editor', '');
            return;
          }

          const backBtn = event.target.closest('[data-provider-rne-back]');
          if (backBtn) {
            ui.setMode('list');
            return;
          }

          const filterBtn = event.target.closest('[data-provider-rne-filter]');
          if (filterBtn) {
            state.providerRneFilter = filterBtn.dataset.providerRneFilter || 'all';
            state.providerRnePage = 1;
            rerenderPreservingScroll();
            return;
          }

          const pageBtn = event.target.closest('[data-provider-page]');
          if (pageBtn) {
            state.providerRnePage += pageBtn.dataset.providerPage === 'next' ? 1 : -1;
            rerender();
            return;
          }

          const editBtn = event.target.closest('[data-provider-rne-edit]');
          if (editBtn) {
            ui.setMode('editor', editBtn.dataset.providerRneEdit || '');
            return;
          }

          const requestProviderDeleteBtn = event.target.closest('[data-provider-delete-request]');
          if (requestProviderDeleteBtn) {
            const providerId = normalizeValue(requestProviderDeleteBtn.dataset.providerDeleteRequest);
            state.pendingProviderDeleteId = state.pendingProviderDeleteId === providerId ? '' : providerId;
            rerenderPreservingScroll();
            return;
          }

          const cancelProviderDeleteBtn = event.target.closest('[data-provider-delete-cancel]');
          if (cancelProviderDeleteBtn) {
            state.pendingProviderDeleteId = '';
            rerenderPreservingScroll();
            return;
          }

          const acceptProviderDeleteBtn = event.target.closest('[data-provider-delete-accept]');
          if (acceptProviderDeleteBtn) {
            const providerId = normalizeValue(acceptProviderDeleteBtn.dataset.providerDeleteAccept);
            const provider = findProviderById(providerId);
            if (!provider) return;
            acceptProviderDeleteBtn.disabled = true;
            acceptProviderDeleteBtn.innerHTML = '<sl-spinner class="inventario-inline-delete-spinner" aria-label="Eliminando"></sl-spinner>';
            try {
              state.inventario.config = safeObject(state.inventario.config);
              const providers = Array.isArray(state.inventario.config.providers) ? state.inventario.config.providers : [];
              state.inventario.config.providers = providers.filter((item) => normalizeValue(item?.id) !== providerId);
              state.pendingProviderDeleteId = '';
              await persistInventario({ configOnly: true });
              rerenderPreservingScroll();
            } catch (error) {
              acceptProviderDeleteBtn.disabled = false;
              acceptProviderDeleteBtn.innerHTML = '<i slot="prefix" class="fa-solid fa-trash"></i><span>Eliminar proveedor</span>';
              await openIosSwal({ title: 'No se pudo eliminar', html: '<p>Ocurrió un error al borrar el proveedor. Intentá nuevamente.</p>', icon: 'error', confirmButtonText: 'Entendido' });
            }
            return;
          }

          const saveBtn = event.target.closest('[data-provider-rne-save]');
          if (saveBtn) {
            const originalSaveHtml = saveBtn.innerHTML;
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<sl-spinner class="inventario-inline-delete-spinner" aria-label="Guardando"></sl-spinner>';
            const providerId = saveBtn.dataset.providerRneSave || '';
            const existing = findProviderById(providerId);
            const provider = existing || createProviderWithName('');
            const currentRne = { ...getDefaultProviderRne(), ...safeObject(provider.rne) };
            const name = normalizeUpper(root.querySelector('#providerNameInput')?.value);
            const email = normalizeValue(root.querySelector('#providerEmailInput')?.value);
            const phone = normalizeValue(root.querySelector('#providerPhoneInput')?.value);
            const number = normalizeValue(root.querySelector('#providerRneNumberInput')?.value);
            const observations = normalizeValue(root.querySelector('#providerRneObservationsInput')?.value);
            const nonFoodCategory = Boolean(root.querySelector('#providerNonFoodInput')?.checked);
            const infiniteExpiry = nonFoodCategory ? false : Boolean(root.querySelector('#providerRneInfiniteInput')?.checked);
            const expiryDate = (infiniteExpiry || nonFoodCategory) ? '' : normalizeIsoDate(root.querySelector('#providerRneExpiryInput')?.value);
            const file = nonFoodCategory ? null : (root.querySelector('#providerRneFileInput')?.files?.[0] || null);
            const photoFile = root.querySelector('#providerPhotoInput')?.files?.[0] || null;
            const loadingNode = root.querySelector('#providerRneFileLoading');
            const avatarNode = root.querySelector('.inventario-provider-editor-avatar');

            if (!name) {
              saveBtn.disabled = false;
              saveBtn.innerHTML = originalSaveHtml;
              await openIosSwal({ title: 'Dato faltante', html: '<p>Completá el nombre del proveedor.</p>', icon: 'warning', confirmButtonText: 'Entendido' });
              return;
            }
            if (file && !ALLOWED_RNE_UPLOAD_TYPES.includes(file.type)) {
              saveBtn.disabled = false;
              saveBtn.innerHTML = originalSaveHtml;
              await openIosSwal({ title: 'Adjunto inválido', html: '<p>Permitido: PDF o imagen.</p>', icon: 'warning', confirmButtonText: 'Entendido' });
              return;
            }
            if (file && file.size > MAX_UPLOAD_SIZE_BYTES) {
              saveBtn.disabled = false;
              saveBtn.innerHTML = originalSaveHtml;
              await openIosSwal({ title: 'Adjunto muy pesado', html: '<p>El adjunto RNE supera 5MB.</p>', icon: 'warning', confirmButtonText: 'Entendido' });
              return;
            }
            if (photoFile && !ALLOWED_UPLOAD_TYPES.includes(photoFile.type)) {
              saveBtn.disabled = false;
              saveBtn.innerHTML = originalSaveHtml;
              await openIosSwal({ title: 'Foto inválida', html: '<p>La foto de perfil debe ser JPG, PNG, WEBP o GIF.</p>', icon: 'warning', confirmButtonText: 'Entendido' });
              return;
            }
            if (photoFile && photoFile.size > MAX_UPLOAD_SIZE_BYTES) {
              saveBtn.disabled = false;
              saveBtn.innerHTML = originalSaveHtml;
              await openIosSwal({ title: 'Foto muy pesada', html: '<p>La foto de perfil supera 5MB.</p>', icon: 'warning', confirmButtonText: 'Entendido' });
              return;
            }

            try {
              let attachmentUrl = nonFoodCategory ? '' : normalizeValue(currentRne.attachmentUrl);
              let attachmentType = nonFoodCategory ? '' : normalizeValue(currentRne.attachmentType);
              let photoUrl = normalizeValue(provider.photoUrl);
              const history = Array.isArray(currentRne.history) ? [...currentRne.history] : [];
              if (file) {
                if (normalizeValue(currentRne.attachmentUrl) || normalizeValue(currentRne.number)) {
                  history.unshift({ ...buildProviderRneHistoryEntry(currentRne), validFrom: normalizeValue(currentRne.validFrom), replacedAt: Date.now() });
                }
                loadingNode?.classList.remove('d-none');
                attachmentUrl = await uploadImageToStorage(file, 'inventario/proveedores/rne');
                attachmentType = file.type;
                loadingNode?.classList.add('d-none');
              }
              if (photoFile) {
                if (avatarNode) {
                  avatarNode.innerHTML = '<span class="produccion-company-logo-loading"><sl-spinner class="meta-spinner produccion-company-logo-spinner" aria-label="Subiendo foto"></sl-spinner></span>';
                }
                photoUrl = await uploadImageToStorage(photoFile, 'inventario/proveedores/avatar');
              }

              const nextProvider = {
                id: provider.id,
                name,
                email,
                phone,
                photoUrl,
                nonFoodCategory,
                createdAt: Number(provider.createdAt || Date.now()),
                rne: {
                  ...getDefaultProviderRne(),
                  ...currentRne,
                  number: nonFoodCategory ? '' : number,
                  expiryDate,
                  infiniteExpiry,
                  observations: nonFoodCategory ? '' : observations,
                  attachmentUrl: nonFoodCategory ? '' : attachmentUrl,
                  attachmentType: nonFoodCategory ? '' : attachmentType,
                  validFrom: normalizeValue(currentRne.validFrom) || getArgentinaIsoDate(),
                  history,
                  updatedAt: Date.now()
                }
              };
              saveProviderInConfig(nextProvider);
              await persistInventario({ configOnly: true });
              ui.setMode('list');
            } catch (error) {
              saveBtn.disabled = false;
              saveBtn.innerHTML = originalSaveHtml;
              loadingNode?.classList.add('d-none');
              await openIosSwal({ title: 'No se pudo guardar', html: '<p>Ocurrió un error al guardar el proveedor. Intentá nuevamente.</p>', icon: 'error', confirmButtonText: 'Entendido' });
            }
            return;
          }

          const photoViewBtn = event.target.closest('[data-provider-photo-view]');
          if (photoViewBtn) {
            const provider = findProviderById(photoViewBtn.dataset.providerPhotoView || '');
            const photoUrl = sanitizeImageUrl(provider?.photoUrl);
            if (!photoUrl) return;
            await openAttachmentViewer([{ invoiceImageUrls: [photoUrl] }], 0, `Foto proveedor · ${provider.name}`);
            return;
          }

          const viewBtn = event.target.closest('[data-provider-rne-view]');
          if (viewBtn) {
            const provider = findProviderById(viewBtn.dataset.providerRneView || '');
            const attachment = normalizeValue(provider?.rne?.attachmentUrl);
            if (!attachment) return;
            await openAttachmentViewer([{ invoiceImageUrls: [attachment] }], 0, `RNE · ${provider.name}`);
            return;
          }

          const historyViewBtn = event.target.closest('[data-provider-rne-history-view]');
          if (historyViewBtn) {
            const [provId, index] = String(historyViewBtn.dataset.providerRneHistoryView || '').split('|');
            const selected = findProviderById(provId);
            const item = Array.isArray(selected?.rne?.history) ? selected.rne.history[Number(index)] : null;
            const attachment = normalizeValue(item?.attachmentUrl);
            if (!attachment) return;
            await openAttachmentViewer([{ invoiceImageUrls: [attachment] }], 0, `Historial RNE #${Number(index) + 1}`);
            return;
          }

          const historyDeleteBtn = event.target.closest('[data-provider-rne-history-delete]');
          if (historyDeleteBtn) {
            const [provId, indexRaw] = String(historyDeleteBtn.dataset.providerRneHistoryDelete || '').split('|');
            const index = Number(indexRaw);
            const selected = findProviderById(provId);
            if (!selected) return;
            const ok = await requestDeleteConfirmation({
              title: 'Borrar versión del historial',
              text: `<strong>${escapeHtml(selected.name)}</strong>: se eliminará solo esta versión de historial.`,
              subtext: 'El RNE actual no será modificado.'
            });
            if (!ok) return;
            const nextHistory = Array.isArray(selected.rne?.history) ? [...selected.rne.history] : [];
            if (index < 0 || index >= nextHistory.length) return;
            nextHistory.splice(index, 1);
            selected.rne = { ...getDefaultProviderRne(), ...safeObject(selected.rne), history: nextHistory };
            saveProviderInConfig(selected);
            await persistInventario({ configOnly: true });
            rerenderPreservingScroll();
            return;
          }

          const deleteBtn = event.target.closest('[data-provider-rne-delete]');
          if (deleteBtn) {
            const provider = findProviderById(deleteBtn.dataset.providerRneDelete || '');
            if (!provider) return;
            const ok = await requestDeleteConfirmation({
              title: 'Borrar RNE actual del proveedor',
              text: `<strong>${escapeHtml(provider.name)}</strong>: se eliminará solo el RNE actual.`,
              subtext: 'El historial se conserva para trazabilidad y podés restaurar/cargar un nuevo RNE.'
            });
            if (!ok) return;
            provider.rne = {
              ...getDefaultProviderRne(),
              ...safeObject(provider.rne),
              number: '',
              expiryDate: '',
              observations: '',
              attachmentUrl: '',
              attachmentType: '',
              validFrom: '',
              updatedAt: Date.now()
            };
            saveProviderInConfig(provider);
            await persistInventario({ configOnly: true });
            rerender();
          }
        });

        root.addEventListener('change', async (event) => {
          const input = event.target.closest('#inventarioProviderImportExcelInput');
          if (!input) return;
          const file = input.files?.[0];
          input.value = '';
          if (!file) return;
          const importBtn = root.querySelector('#inventarioProviderImportExcelBtn');
          const withSpinner = async () => {
            if (!importBtn) return;
            const icon = importBtn.querySelector('i');
            importBtn.disabled = true;
            if (icon) icon.className = 'fa-solid fa-spinner fa-spin';
            try {
              if (!window.ExcelJS) {
                await openIosSwal({ title: 'Excel no disponible', html: '<p>No se pudo cargar la librería ExcelJS.</p>', icon: 'error', confirmButtonText: 'Entendido' });
                return;
              }
              const wb = new window.ExcelJS.Workbook();
              const buffer = await file.arrayBuffer();
              await wb.xlsx.load(buffer);
              const ws = wb.worksheets[0];
              if (!ws) {
                await openIosSwal({ title: 'Archivo inválido', html: '<p>El Excel no contiene hojas.</p>', icon: 'warning', confirmButtonText: 'Entendido' });
                return;
              }
              const errors = [];
              const providersByName = new Map(sortedProviders().map((provider) => [normalizeUpper(provider.name), provider]));
              const firstRow = ws.getRow(3);
              const normalizeHeader = (value) => normalizeUpper(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
              const headerMap = {};
              firstRow.eachCell((cell, colNumber) => {
                const token = normalizeHeader(cell.text);
                if (token.includes('PROVEEDOR')) headerMap.provider = colNumber;
                if (token === 'RNE' || token.includes('REGISTRO')) headerMap.rne = colNumber;
                if (token.includes('VENC') || token.includes('CADUC')) headerMap.expiry = colNumber;
                if (token.includes('OBSERV')) headerMap.observations = colNumber;
              });
              if (!headerMap.provider || !headerMap.rne || !headerMap.expiry) {
                await openIosSwal({ title: 'Formato incorrecto', html: '<p>Usá la plantilla descargada desde "Descargar Excel".</p>', icon: 'warning', confirmButtonText: 'Entendido' });
                return;
              }
              let updated = 0;
              let created = 0;
              for (let rowIndex = 4; rowIndex <= ws.rowCount; rowIndex += 1) {
                const row = ws.getRow(rowIndex);
                const name = normalizeUpper(row.getCell(headerMap.provider).text);
                const rneToken = normalizeValue(row.getCell(headerMap.rne).text);
                const expiryCell = row.getCell(headerMap.expiry).value;
                const expiryText = normalizeValue(row.getCell(headerMap.expiry).text);
                const observations = headerMap.observations ? normalizeValue(row.getCell(headerMap.observations).text) : '';
                if (!name && !rneToken && !expiryText && !observations) continue;
                if (!name) {
                  errors.push(`Fila ${rowIndex}: proveedor vacío.`);
                  continue;
                }
                let provider = providersByName.get(name);
                if (!provider) {
                  provider = createProviderWithName(name);
                  providersByName.set(name, provider);
                  created += 1;
                }
                const noRequire = normalizeUpper(rneToken) === 'NO REQUIERE' || normalizeUpper(expiryText) === 'NO REQUIERE';
                const normalizedRne = noRequire ? '' : normalizeValue(rneToken);
                const expiryIso = parseExcelDateToIso(expiryCell);
                if (!noRequire && expiryText && !expiryIso) {
                  errors.push(`Fila ${rowIndex} (${provider.name}): vencimiento inválido.`);
                  continue;
                }
                provider.nonFoodCategory = Boolean(noRequire);
                provider.rne = {
                  ...getDefaultProviderRne(),
                  ...safeObject(provider.rne),
                  number: normalizedRne,
                  expiryDate: noRequire ? '' : expiryIso,
                  infiniteExpiry: noRequire ? false : !expiryIso,
                  observations: noRequire ? '' : observations,
                  attachmentUrl: noRequire ? '' : normalizeValue(provider.rne?.attachmentUrl),
                  attachmentType: noRequire ? '' : normalizeValue(provider.rne?.attachmentType),
                  validFrom: noRequire ? '' : normalizeValue(provider.rne?.validFrom),
                  updatedAt: Date.now()
                };
                saveProviderInConfig(provider);
                updated += 1;
              }
              if (updated > 0) {
                await persistInventario({ configOnly: true });
                rerenderPreservingScroll();
                renderProviderRneAlert();
              }
              if (errors.length) {
                const details = errors.slice(0, 30).map((error) => `<li>${escapeHtml(error)}</li>`).join('');
                await openIosSwal({
                  title: updated ? 'Importación parcial' : 'No se pudo importar',
                  html: `<p>Se procesaron <strong>${updated}</strong> proveedor(es).${created ? ` Se crearon <strong>${created}</strong> nuevo(s).` : ''}</p><p>Errores detectados: <strong>${errors.length}</strong>.</p><ul style="text-align:left;max-height:240px;overflow:auto;">${details}</ul>`,
                  icon: updated ? 'warning' : 'error',
                  confirmButtonText: 'Entendido'
                });
                return;
              }
              await openIosSwal({ title: 'Importación completada', html: `<p>Se procesaron <strong>${updated}</strong> proveedor(es).${created ? ` Se crearon <strong>${created}</strong> nuevo(s).` : ''}</p>`, icon: 'success', confirmButtonText: 'Entendido' });
            } catch (error) {
              await openIosSwal({ title: 'No se pudo importar', html: '<p>El archivo Excel tiene errores o está dañado.</p>', icon: 'error', confirmButtonText: 'Entendido' });
            } finally {
              importBtn.disabled = false;
              const icon = importBtn.querySelector('i');
              if (icon) icon.className = 'fa-solid fa-file-arrow-up';
            }
          };
          await withSpinner();
        });

        rerender();
      }
    });

    if (result.isConfirmed) {
      renderProviderRneAlert();
    }
  };


  const onListClick = async (event) => {
    const selectBtn = event.target.closest('[data-inv-select]');
    if (selectBtn) {
      selectInvItem(selectBtn.dataset.invSelect, { openDetail: true });
      return;
    }
    if (event.target.closest('[data-inv-detail-back]')) {
      setInvDetailOpen(false);
      const id = state.invSelectedId;
      requestAnimationFrame(() => invListNode()?.querySelector(`[data-inv-select="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' }));
      return;
    }

    const searchAllBtn = event.target.closest('[data-inv-search-all]');
    if (searchAllBtn) {
      state.activeFamilyId = 'all';
      state.activeStockStatus = 'all';
      renderFamilies();
      renderStatusFilters();
      renderList();
      return;
    }

    const statusBtn = event.target.closest('[data-inv-status-filter]');
    if (statusBtn) {
      state.activeStockStatus = statusBtn.dataset.invStatusFilter;
      state.search = '';
      if (nodes.searchInput) nodes.searchInput.value = '';
      renderStatusFilters();
      renderList();
      return;
    }

    const autoEgresoBtn = event.target.closest('[data-inv-auto-egreso-filter]');
    if (autoEgresoBtn) {
      state.activeAutoEgresoFilter = autoEgresoBtn.dataset.invAutoEgresoFilter;
      renderAutoEgresoFilters();
      renderList();
      return;
    }

    if (event.target.closest('[data-inv-families-toggle]')) {
      state.familiesCollapsed = !state.familiesCollapsed;
      try { localStorage.setItem('inventario_families_collapsed', state.familiesCollapsed ? '1' : '0'); } catch (_) {}
      renderFamilies();
      return;
    }

    const familyBtn = event.target.closest('[data-inv-family-filter]');
    if (familyBtn) {
      state.activeFamilyId = familyBtn.dataset.invFamilyFilter;
      state.search = '';
      if (nodes.searchInput) nodes.searchInput.value = '';
      renderFamilies();
      renderStatusFilters();
      renderList();
      return;
    }

    const editorBtn = event.target.closest('[data-inventario-open-editor]');
    if (editorBtn) {
      state.tablePage = 1;
      state.tableSearch = '';
      await ensureInventoryRecordDetail(editorBtn.dataset.inventarioOpenEditor);
      renderEditor(editorBtn.dataset.inventarioOpenEditor);
      return;
    }

    const thresholdBtn = event.target.closest('[data-inventario-config-item]');
    if (thresholdBtn) {
      await openProductThresholdConfig(thresholdBtn.dataset.inventarioConfigItem);
      return;
    }

    // Resolver lotes vencidos directamente desde la card.
    const resolveExpiredBtn = event.target.closest('[data-inventario-resolve-expired]');
    if (resolveExpiredBtn) {
      const ingredientId = normalizeValue(resolveExpiredBtn.dataset.inventarioResolveExpired);
      // El record en la lista puede venir "lite" (sin entries). Forzamos la
      // carga del detalle completo antes de resolver para que persistInventario
      // tenga los entries reales y pueda crear los movimientos correspondientes.
      await ensureInventoryRecordDetail(ingredientId);
      const record = getRecord(ingredientId);
      const expired = getExpiredEntries(record);
      if (!expired.length) return;
      const resolutionType = await askInventoryExpiryResolutionType(expired.length);
      if (!resolutionType) return;
      const ingredient = state.ingredientes[ingredientId] || {};
      // Adaptamos las filas al shape esperado por resolveInventoryExpiryRows.
      const rows = expired.map((row) => ({
        ingredientId,
        ingredientName: capitalize(ingredient.name || ''),
        entryId: row.entryId,
        availableKg: convertToKg(row.qty, row.unit),
        expired: true,
        diffDays: row.diffDays
      }));
      const resolved = await resolveInventoryExpiryRows(rows, resolutionType);
      if (resolved > 0) {
        renderList();
        renderInventoryExpiryAlert?.();
      }
      return;
    }
  };


  const setPeriodMode = (enabled) => {
    state.periodMode = enabled;
    nodes.searchInput?.closest('.inventario-toolbar')?.classList.toggle('d-none', enabled);
    if (nodes.families) {
      nodes.families.classList.toggle('d-none', enabled);
      nodes.families.hidden = enabled;
      if (enabled) {
        nodes.families.innerHTML = '';
        nodes.families.setAttribute('aria-hidden', 'true');
      } else {
        nodes.families.removeAttribute('aria-hidden');
      }
    }
    nodes.statusFilters?.classList.toggle('d-none', enabled);
    nodes.list?.classList.toggle('d-none', enabled);
    nodes.periodView?.classList.toggle('d-none', !enabled);
    if (enabled) {
      nodes.providersRneAlert?.classList.add('d-none');
      nodes.expiryAlert?.classList.add('d-none');
      nodes.globalClearBtn?.classList.toggle('d-none', !state.dashboardDateRange);
      return;
    }
    renderProviderRneAlert();
    renderInventoryExpiryAlert();
  };

  const loadInventario = async () => {
    setStateView('loading');
    try {
      await loadData();
      if (!Object.keys(state.ingredientes).length) {
        renderProviderRneAlert();
        setStateView('empty');
        return;
      }
      setStateView('list');
      setPeriodMode(false);
      // Un pedido explícito (Ingredientes → Ingresar stock) gana sobre el borrador que quedó abierto.
      const explicitOpen = state.pendingOpen?.ingredientId && state.ingredientes[state.pendingOpen.ingredientId];
      if (!explicitOpen && state.resumeEditor?.ingredientId && state.ingredientes[state.resumeEditor.ingredientId]) {
        await ensureInventoryRecordDetail(state.resumeEditor.ingredientId);
        renderEditor(state.resumeEditor.ingredientId, state.resumeEditor.draft || null);
      } else {
        const pending = state.pendingOpen;
        state.pendingOpen = null;
        if (pending?.ingredientId && state.ingredientes[pending.ingredientId]) {
          state.activeFamilyId = 'all';
          state.activeStockStatus = 'all';
          state.invSelectedId = pending.ingredientId;
        }
        renderFamilies();
        renderStatusFilters();
        renderList();
        if (pending?.ingredientId && state.ingredientes[pending.ingredientId]) {
          selectInvItem(pending.ingredientId, { openDetail: true });
          invListNode()?.querySelector(`[data-inv-select="${CSS.escape(pending.ingredientId)}"]`)?.scrollIntoView({ block: 'center' });
          if (pending.editor) {
            await ensureInventoryRecordDetail(pending.ingredientId);
            const sameDraft = state.resumeEditor?.ingredientId === pending.ingredientId ? state.resumeEditor.draft : null;
            renderEditor(pending.ingredientId, sameDraft || null);
          }
        }
        alignScrollActionsToRight(document);
      }
      if (window.flatpickr && nodes.globalRange) {
        const locale = window.flatpickr.l10ns?.es || undefined;
        const dayMapGlobal = getDaySummaryMap(getGlobalFilteredEntries(true));
        disableCalendarSuggestions(nodes.globalRange);
        window.flatpickr(nodes.globalRange, {
          locale,
          mode: 'range',
          dateFormat: 'Y-m-d',
          allowInput: false,
          defaultDate: getDefaultRangeDates(state.dashboardDateRange),
          onDayCreate: (_dObj, _dStr, fp, dayElem) => {
            const date = dayElem.dateObj ? getArgentinaIsoDate(dayElem.dateObj) : '';
            const summary = dayMapGlobal[date];
            if (summary && (summary.kg || summary.units)) {
              const bubble = document.createElement('span');
              const hasKg = summary.kg > 0.0001;
              const hasUnits = summary.units > 0.0001;
              bubble.className = `inventario-day-kg ${hasKg && hasUnits ? 'is-mixed' : ''}`;
              bubble.style.top = (Number(dayElem.dateObj?.getDate() || 0) % 2 === 0) ? '-2px' : 'auto';
              bubble.style.bottom = (Number(dayElem.dateObj?.getDate() || 0) % 2 === 0) ? 'auto' : '-2px';
              bubble.textContent = hasKg && hasUnits
                ? `${Number(summary.kg || 0).toFixed(0)}kg + ${Number(summary.units || 0).toFixed(0)}u.`
                : hasKg
                  ? `${Number(summary.kg || 0).toFixed(2)}kg`
                  : `${Number(summary.units || 0).toFixed(0)}u.`;
              dayElem.appendChild(bubble);
            }
          },
          onClose: (_selectedDates, _dateStr, instance) => {
            const from = instance.selectedDates[0] ? getArgentinaIsoDate(instance.selectedDates[0]) : '';
            const to = instance.selectedDates[1] ? getArgentinaIsoDate(instance.selectedDates[1]) : '';
            nodes.globalRange.value = from && to ? `${from} a ${to}` : from;
          }
        });
      }
    } catch (error) {
      console.error('[Inventario] Error en loadInventario:', error);
      setStateView('empty');
      renderProviderRneAlert();
    }
  };

  nodes.searchInput?.addEventListener('input', (event) => {
    state.search = normalizeLower(event.target.value);
    if (state.searchRenderTimer) {
      clearTimeout(state.searchRenderTimer);
    }
    state.searchRenderTimer = setTimeout(() => {
      state.searchRenderTimer = null;
      // Re-render de familias para que se colapse / expanda según haya búsqueda.
      renderFamilies();
      renderList();
    }, 120); // espera breve: no redibujar ~250 filas con imágenes en cada tecla
  });
  nodes.list?.addEventListener('click', onListClick);
  nodes.families?.addEventListener('click', onListClick);
  // Filtro de familia (sl-select en la barra).
  nodes.families?.addEventListener('change', (event) => {
    const select = event.target.closest?.('[data-inv-family-select]');
    if (!select) return;
    const value = (window.ljSelectValue ? window.ljSelectValue(select) : select.value) || 'all';
    if (value === state.activeFamilyId) return;
    state.activeFamilyId = value;
    renderStatusFilters();
    renderList();
  });
  // Teclado en la lista: flechas cambian la selección (listbox con roving tabindex).
  nodes.list?.addEventListener('keydown', (event) => {
    const row = event.target.closest?.('[data-inv-select]');
    if (!row || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const rows = [...invListNode().querySelectorAll('[data-inv-select]')];
    const index = rows.indexOf(row);
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
    event.preventDefault();
    selectInvItem(rows[nextIndex].dataset.invSelect, { focus: true });
  });
  nodes.statusFilters?.addEventListener('click', onListClick);
  nodes.list?.addEventListener('scroll', updateListScrollHint);
  nodes.configBtn?.addEventListener('click', openGlobalConfig);
  nodes.providersRneBtn?.addEventListener('click', openProvidersRneManager);
  nodes.weeklyConfigBtn?.addEventListener('click', openWeeklyConfigManager);
  nodes.createIngredientBtn?.addEventListener('click', openCreateIngredient);
  nodes.toolbarCreateBtn?.addEventListener('click', openCreateIngredient);
  nodes.backBtn?.addEventListener('click', async () => {
    const prevSelected = state.selectedIngredientId;
    await runWithBackSpinner(async () => {
      await backToList();
      if (state.view !== 'list') return;
      await loadData();
      renderFamilies();
      renderStatusFilters();
      if (prevSelected && state.ingredientes[prevSelected]) {
        state.selectedIngredientId = prevSelected;
      }
      renderList();
    });
  });
  nodes.editorForm?.addEventListener('submit', saveEntry);

  nodes.openPeriodFilterBtn?.addEventListener('click', async () => {
    state.globalTablePage = 1;
    setPeriodMode(true);
    nodes.globalLoading?.classList.remove('d-none');
    await ensurePeriodLotsLoaded();
    nodes.globalLoading?.classList.add('d-none');
    renderGlobalPeriodTable();
  });
  nodes.periodBackBtn?.addEventListener('click', async () => {
    await runWithBackSpinner(async () => {
      await loadData();
      setPeriodMode(false);
      renderFamilies();
      renderStatusFilters();
      renderList();
    });
  });
  nodes.globalApplyBtn?.addEventListener('click', async () => {
    state.dashboardDateRange = normalizeValue(nodes.globalRange?.value);
    nodes.globalClearBtn?.classList.toggle('d-none', !state.dashboardDateRange);
    state.globalTablePage = 1;
    nodes.globalLoading?.classList.remove('d-none');
    nodes.globalTableWrap?.classList.add('d-none');
    if (!state.periodLots) await ensurePeriodLotsLoaded();
    renderGlobalPeriodTable();
    nodes.globalLoading?.classList.add('d-none');
    nodes.globalTableWrap?.classList.remove('d-none');
  });
  nodes.globalClearBtn?.addEventListener('click', () => {
    state.dashboardDateRange = '';
    if (nodes.globalRange) nodes.globalRange.value = '';
    state.globalTablePage = 1;
    nodes.globalClearBtn?.classList.add('d-none');
    renderGlobalPeriodTable();
  });

  nodes.globalExpandBtn?.addEventListener('click', async () => {
    await ensureFullInventoryLoaded();
    const rows = getGlobalFilteredEntries();
    const collapseMap = { ...state.globalEntryCollapse };
    let expandedPage = 1;

    const renderExpandedRows = (rowsPage) => rowsPage.length ? rowsPage.map((row, index) => {
      const traceRows = getEntryTraceRows(row);
      const isCollapsed = collapseMap[row.entryId] !== false;
      const expiryMeta = getEntryExpiryMeta(row);
      const isExpiredAvailable = expiryMeta.isExpired;
      const resolutionMeta = getEntryResolutionMeta(row);
      const resolutionLabel = resolutionMeta.badge;
      const resolutionRow = getEntryResolutionRowData(row);
      const expiredQtyClass = isExpiredAvailable ? 'inventario-expired-strike' : '';
      const traceHtml = (!isCollapsed && traceRows.length)
        ? traceRows.map((trace) => `<tr class="${getTraceRowClass(trace)}"><td><div class="inventario-trace-main"><img src="./IMG/Octicons-git-merge.svg" alt="merge" class="inventario-trace-icon">${escapeHtml(formatDateTime(trace.createdAt))}</div></td><td>${escapeHtml(row.ingredientName)}</td><td class="is-num inventario-trace-kilos">-${trace.displayAmount || formatUsageAmount(trace.kilosUsed)}</td><td>${getTraceTypeLabelHtml(trace)}</td><td>${escapeHtml(trace.ingredientLot)}</td><td>${escapeHtml((trace.internalUse || isAutoGeneratedCounterTrace(trace)) ? row.provider : trace.productionId)}</td><td>${(trace.internalUse || isAutoGeneratedCounterTrace(trace)) ? '<span class="recetas-tag tone-neu">Sin trazabilidad</span>' : `<sl-button variant="default" size="small" type="button" class="inventario-threshold-btn" data-open-production-trace="${escapeHtml(trace.productionId)}"><i slot="prefix" class="fa-solid fa-users-viewfinder"></i><span>Trazabilidad</span></sl-button>`}</td></tr>`).join('') : '';
      const resolutionHtml = (!isCollapsed && resolutionRow) ? `<tr class="inventario-resolution-row"><td><div class="inventario-trace-main"><img src="./IMG/Octicons-git-merge.svg" alt="merge" class="inventario-trace-icon">${escapeHtml(formatDateTime(resolutionRow.at))}</div></td><td>${escapeHtml(row.ingredientName)}</td><td class="is-num inventario-trace-kilos">-${resolutionRow.resolvedKg.toFixed(2)} kilos<br><span class="inventario-available-line is-zero">disp. ${resolutionRow.availableKg.toFixed(3)} kg</span></td><td><span class="inventario-resolution-badge">${escapeHtml(resolutionRow.badge)}</span></td><td>${escapeHtml(row.invoiceNumber)}</td><td class="inventario-provider-cell">${escapeHtml(row.provider)}</td><td><span class="recetas-tag tone-neu">Sin trazabilidad</span></td></tr>` : '';
      return `<tr class="inventario-row-tone ${isExpiredAvailable ? 'is-expired-row' : ''} ${resolutionLabel ? 'is-resolution-row' : ''} ${index % 2 === 0 ? 'is-even-row' : 'is-odd-row'}"><td>${escapeHtml(row.entryDateTime)}${getExpiryBadgeHtml(row) ? `<br><small>${getExpiryBadgeHtml(row)}</small>` : ''}</td><td>${escapeHtml(row.ingredientName)}</td><td><span class="${expiredQtyClass}">${row.qty.toFixed(2)} ${escapeHtml(row.unit)}</span></td><td><span class="${expiredQtyClass}">${row.qty.toFixed(2)} ${escapeHtml(row.unit)}</span><br><span class="inventario-available-line ${Number(row.availableQty || 0) <= 0 ? 'is-zero' : ''} ${expiredQtyClass}">disp. ${Number(row.availableQty || 0).toFixed(2)} ${escapeHtml(getMeasureAbbr(row.unit || ''))}${row.packageQty ? ` x${row.packageQty}` : ''}</span></td><td>${escapeHtml(row.invoiceNumber)}</td><td class="inventario-provider-cell">${escapeHtml(row.provider)}</td><td><div class="inventario-entry-actions">${(traceRows.length || resolutionRow) ? `<sl-button variant="default" size="small" type="button" class="lj-icon-btn inventario-threshold-btn inventario-icon-only-btn" data-expand-toggle-collapse="${row.entryId}" aria-label="Ver detalle" title="Ver detalle"><i class="fa-solid ${isCollapsed ? 'fa-chevron-down' : 'fa-chevron-up'}"></i></sl-button>` : ''}${buildExpandedImageCell(row.invoiceImageUrls)}</div></td></tr>${resolutionHtml}${traceHtml}`;
    }).join('') : '<tr><td colspan="7" class="text-center">Sin ingresos en ese rango.</td></tr>';

    const renderExpandedContent = (popup) => {
      const canCollapse = rows.some((row) => hasEntryDetailRows(row) && collapseMap[row.entryId] === false);
      const canExpand = rows.some((row) => hasEntryDetailRows(row) && collapseMap[row.entryId] !== false);
      const host = popup.querySelector('#inventarioExpandedGlobalHost');
      if (!host) return;
      const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
      expandedPage = Math.min(Math.max(1, expandedPage), pages);
      const start = (expandedPage - 1) * PAGE_SIZE;
      const pageRows = rows.slice(start, start + PAGE_SIZE);
      host.innerHTML = `<div class="inventario-print-row mb-2 inventario-trace-toolbar toolbar-scroll-x"><sl-button variant="default" size="small" type="button" class="inventario-threshold-btn" id="inventarioExpandedCollapseAllRowsBtn" ${canCollapse ? '' : 'disabled'}><i slot="prefix" class="fa-solid fa-compress"></i><span>Colapsar todo</span></sl-button><sl-button variant="default" size="small" type="button" class="inventario-threshold-btn" id="inventarioExpandedExpandAllRowsBtn" ${canExpand ? '' : 'disabled'}><i slot="prefix" class="fa-solid fa-expand"></i><span>Descolapsar todo</span></sl-button></div><div class="table-responsive inventario-table-compact-wrap"><table class="table recipe-table inventario-table-compact mb-0"><thead><tr><th>Fecha y hora</th><th>Producto</th><th class="is-num">Cantidad</th><th>Detalle</th><th>N° factura</th><th>Proveedor</th><th>Imagen / Acción</th></tr></thead><tbody>${renderExpandedRows(pageRows)}</tbody></table></div><div class="inventario-pagination enhanced"><sl-button variant="default" size="small" type="button" class="lj-icon-btn inventario-threshold-btn inventario-page-btn" data-expanded-global-page="prev" ${expandedPage <= 1 ? 'disabled' : ''} aria-label="Página anterior" title="Página anterior"><i class="fa-solid fa-chevron-left"></i></sl-button><span>Página ${expandedPage} de ${pages}</span><sl-button variant="default" size="small" type="button" class="lj-icon-btn inventario-threshold-btn inventario-page-btn" data-expanded-global-page="next" ${expandedPage >= pages ? 'disabled' : ''} aria-label="Página siguiente"><i class="fa-solid fa-chevron-right"></i></sl-button></div>`;
    };

    await openIosSwal({
      ljModal: true,
      title: 'Ingresos por periodo • La Jamonera',
      html: '<div id="inventarioExpandedGlobalHost" class="inventario-expand-wrap"></div>',
      width: '92vw',
      confirmButtonText: 'Cerrar',
      didOpen: (popup) => {
        renderExpandedContent(popup);
        popup.addEventListener('click', async (event) => {
          const toggleBtn = event.target.closest('[data-expand-toggle-collapse]');
          if (toggleBtn) {
            collapseMap[toggleBtn.dataset.expandToggleCollapse] = !collapseMap[toggleBtn.dataset.expandToggleCollapse];
            renderExpandedContent(popup);
            return;
          }
          if (event.target.closest('#inventarioExpandedCollapseAllRowsBtn')) {
            rows.forEach((row) => {
              if (hasEntryDetailRows(row)) collapseMap[row.entryId] = true;
            });
            renderExpandedContent(popup);
            return;
          }
          if (event.target.closest('#inventarioExpandedExpandAllRowsBtn')) {
            rows.forEach((row) => {
              if (hasEntryDetailRows(row)) collapseMap[row.entryId] = false;
            });
            renderExpandedContent(popup);
            return;
          }
          const globalPageBtn = event.target.closest('[data-expanded-global-page]');
          if (globalPageBtn) {
            expandedPage += globalPageBtn.dataset.expandedGlobalPage === 'next' ? 1 : -1;
            renderExpandedContent(popup);
            return;
          }
          const traceBtn = event.target.closest('[data-open-production-trace]');
          if (traceBtn) {
            const productionId = normalizeValue(traceBtn.dataset.openProductionTrace);
            if (productionId) await window.laJamoneraProduccionAPI?.openTraceabilityById?.(productionId);
            return;
          }
          const imageBtn = event.target.closest('.js-open-expanded-image');
          if (!imageBtn) return;
          try {
            const urls = JSON.parse(decodeURIComponent(imageBtn.dataset.images || '[]'));
            if (Array.isArray(urls) && urls.length) {
              await openAttachmentViewer([{ invoiceImageUrls: urls }], 0, 'Imagen del ingreso');
            }
          } catch (error) {
          }
        });
      },
      customClass: {
        popup: 'ios-alert inventario-expand-alert',
        confirmButton: 'ios-btn-secondary'
      }
    });
  });

  nodes.globalPrintBtn?.addEventListener('click', async () => {
    await ensureFullInventoryLoaded();
    const forcedRange = await askRequiredRangeForIngresosSheet({
      title: 'Rango obligatorio para imprimir',
      description: 'Seleccioná el rango de ingresos que querés imprimir con sus adjuntos.'
    });
    if (!forcedRange) return;
    state.dashboardDateRange = `${forcedRange.from} a ${forcedRange.to}`;
    if (nodes.globalRange) nodes.globalRange.value = state.dashboardDateRange;
    nodes.globalClearBtn?.classList.toggle('d-none', !state.dashboardDateRange);
    state.globalTablePage = 1;
    renderGlobalPeriodTable();
    await openPrintGlobalPeriod(getGlobalFilteredEntries());
  });
  nodes.globalSheetBtn?.addEventListener('click', async () => {
    await ensureFullInventoryLoaded();
    await openIngresosWeeklySheet(getGlobalFilteredEntries());
  });
  nodes.globalExcelBtn?.addEventListener('click', async () => {
    await ensureFullInventoryLoaded();
    const rows = getGlobalFilteredEntries();
    const payload = rows.flatMap((row) => {
      const resolutionRow = getEntryResolutionRowData(row);
      const main = {
        'Fecha y hora': row.entryDateTime,
        Producto: row.ingredientName,
        Kilos: `${row.qtyKg.toFixed(2)} kg`,
        Cantidad: `${formatEntryDetailLabel(row).qtyLabel} · ${formatEntryDetailLabel(row).availableLabel}${getExpiryBadgeText(row) ? ` · ${getExpiryBadgeText(row)}` : ''}`,
        'N° factura': row.invoiceNumber,
        Proveedor: row.provider,
        Imágenes: row.invoiceImageUrls.length ? row.invoiceImageUrls.map((_, index) => `LINK ${index + 1}`).join(', ') : '-',
        __firstImage: row.invoiceImageUrls[0] || '',
        __tone: getEntryExpiryMeta(row).isExpired ? 'expired' : 'normal'
      };
      const resolution = resolutionRow ? {
        'Fecha y hora': `↳ ${formatDateTime(resolutionRow.at)}`,
        Producto: row.ingredientName,
        Kilos: `-${resolutionRow.resolvedKg.toFixed(2)} kg`,
        Cantidad: resolutionRow.badge,
        'N° factura': row.invoiceNumber,
        Proveedor: providerLabel(row.provider),
        Imágenes: 'Resolución',
        __tone: isBlueResolutionStatus(resolutionRow.status) ? 'resolution_yellow' : 'normal'
      } : null;
      const traces = buildTraceRowsForEntry(row).map((trace) => ({
        'Fecha y hora': `↳ ${trace.fechaHora}`,
        Producto: row.ingredientName,
        Kilos: trace.cantidad,
        Cantidad: trace.factura,
        'N° factura': trace.proveedor,
        Proveedor: 'Trazabilidad',
        Imágenes: 'Trazabilidad',
        __tone: 'trace'
      }));
      return [main, resolution, ...traces].filter(Boolean);
    });
    await makeWorkbook({
      fileName: `inventario_periodo_${Date.now()}.xlsx`,
      sheetName: 'Periodo',
      headers: ['Fecha y hora', 'Producto', 'Kilos', 'Cantidad', 'N° factura', 'Proveedor', 'Imágenes'],
      rows: payload
    });
  });
  nodes.globalTableWrap?.addEventListener('click', async (event) => {
    const pageBtn = event.target.closest('[data-global-page]');
    if (pageBtn) {
      state.globalTablePage += pageBtn.dataset.globalPage === 'next' ? 1 : -1;
      renderGlobalPeriodTable();
      return;
    }

    const toggleBtn = event.target.closest('[data-toggle-global-collapse]');
    if (toggleBtn) {
      const entryId = toggleBtn.dataset.toggleGlobalCollapse;
      if (entryId) {
        // Abre/cierra sólo esta fila (antes recalculaba y redibujaba toda la tabla: lento y volvía arriba).
        const nowCollapsed = state.globalEntryCollapse[entryId] !== false;
        state.globalEntryCollapse[entryId] = !nowCollapsed;
        const mainRow = toggleBtn.closest('tr');
        const row = state.globalPageRowsById?.[entryId];
        if (!mainRow || !row || (row.isLite && nowCollapsed)) { renderGlobalPeriodTable(); return; }
        nodes.globalTableWrap.querySelectorAll(`tr[data-global-detail-of="${CSS.escape(entryId)}"]`).forEach((tr) => tr.remove());
        if (nowCollapsed) mainRow.insertAdjacentHTML('afterend', buildGlobalDetailHtml(row));
        const icon = toggleBtn.querySelector('i');
        icon?.classList.toggle('fa-chevron-down', !nowCollapsed);
        icon?.classList.toggle('fa-chevron-up', nowCollapsed);
        const ids = Object.keys(state.globalPageRowsById || {}).filter((id) => hasEntryDetailRows(state.globalPageRowsById[id]));
        const collapseAll = nodes.globalTableWrap.querySelector('#inventarioGlobalCollapseAllRowsBtn');
        const expandAll = nodes.globalTableWrap.querySelector('#inventarioGlobalExpandAllRowsBtn');
        if (collapseAll) collapseAll.disabled = !ids.some((id) => state.globalEntryCollapse[id] === false);
        if (expandAll) expandAll.disabled = !ids.some((id) => state.globalEntryCollapse[id] !== false);
      }
      return;
    }

    if (event.target.closest('#inventarioGlobalCollapseAllRowsBtn')) {
      getGlobalFilteredEntries().forEach((row) => {
        if (hasEntryDetailRows(row)) state.globalEntryCollapse[row.entryId] = true;
      });
      renderGlobalPeriodTable();
      return;
    }

    if (event.target.closest('#inventarioGlobalExpandAllRowsBtn')) {
      getGlobalFilteredEntries().forEach((row) => {
        if (hasEntryDetailRows(row)) state.globalEntryCollapse[row.entryId] = false;
      });
      renderGlobalPeriodTable();
      return;
    }

    const traceBtn = event.target.closest('[data-open-production-trace]');
    if (traceBtn) {
      const productionId = normalizeValue(traceBtn.dataset.openProductionTrace);
      if (productionId) await window.laJamoneraProduccionAPI?.openTraceabilityById?.(productionId);
      return;
    }

    const btn = event.target.closest('[data-open-global-images]');
    if (!btn) return;
    const urls = JSON.parse(decodeURIComponent(btn.dataset.openGlobalImages || '[]'));
    if (!Array.isArray(urls) || !urls.length) return;
    await openAttachmentViewer([{ invoiceImageUrls: urls }], 0, 'Imagen del ingreso');
  });

  nodes.viewerPrevBtn?.addEventListener('click', () => {
    if (!state.viewerImages.length) return;
    state.viewerIndex = (state.viewerIndex - 1 + state.viewerImages.length) % state.viewerImages.length;
    state.viewerOffsetX = 0;
    state.viewerOffsetY = 0;
    setViewerScale(1);
    renderViewerImage();
  });
  nodes.viewerNextBtn?.addEventListener('click', () => {
    if (!state.viewerImages.length) return;
    state.viewerIndex = (state.viewerIndex + 1) % state.viewerImages.length;
    state.viewerOffsetX = 0;
    state.viewerOffsetY = 0;
    setViewerScale(1);
    renderViewerImage();
  });
  nodes.viewerZoomInBtn?.addEventListener('click', () => setViewerScale(state.viewerScale + 0.25));
  nodes.viewerZoomOutBtn?.addEventListener('click', () => setViewerScale(state.viewerScale - 0.25));
  nodes.viewerBackBtn?.addEventListener('click', () => LJModal.close(nodes.imageViewerModal));
  nodes.viewerImage?.addEventListener('load', () => {
    nodes.viewerImage.classList.add('is-loaded');
    nodes.viewerStageSpinner?.classList.add('d-none');
    applyViewerTransform();
  });
  nodes.viewerImage?.addEventListener('error', () => {
    nodes.viewerStageSpinner?.classList.add('d-none');
  });

  window.laJamoneraInventarioAPI = {
    ...(window.laJamoneraInventarioAPI || {}),
    resolveExpiredEntryStock,
    // Abre Inventario con un ingrediente seleccionado; editor=true va directo a "Ingresar stock".
    openIngredient: (ingredientId, options = {}) => {
      state.pendingOpen = { ingredientId: normalizeValue(ingredientId), editor: Boolean(options.editor) };
      LJModal.open(inventarioModal);
    },
    refreshInventarioData: async () => {
      await loadData();
      renderList();
    }
  };

  LJModal.on(inventarioModal, 'hide', () => {
    snapshotEditorDraft();
  });
  window.addEventListener('resize', () => {
    if (state.viewerScale > 1) applyViewerTransform();
  });

  LJModal.on(inventarioModal, 'show', loadInventario);
})();
