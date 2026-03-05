(function inventarioModule() {
  const inventarioModal = document.getElementById('inventarioModal');
  if (!inventarioModal) return;

  const DEFAULT_LOW_THRESHOLD = 5;
  const DEFAULT_EXPIRING_SOON_DAYS = 2;
  const LOT_TOKEN_OPTIONS = [
    { key: 'remito_factura', label: 'Remito o Factura' },
    { key: 'fecha_fabricacion', label: 'Fecha de fabricación' },
    { key: 'fecha_hoy', label: 'Fecha de hoy' },
    { key: 'siglas_personalizadas', label: 'Siglas personalizadas' }
  ];
  const LOT_SEPARATORS = ['.', '-', '_', ',', ';', '|'];
  const PAGE_SIZE = 20;
  const ALLOWED_UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const MAX_UPLOAD_SIZE_BYTES = 5 * 1024 * 1024;

  const $ = (id) => document.getElementById(id);
  const nodes = {
    loading: $('inventarioLoading'),
    empty: $('inventarioEmpty'),
    data: $('inventarioData'),
    list: $('inventarioList'),
    families: $('inventarioFamilies'),
    statusFilters: $('inventarioStatusFilters'),
    searchInput: $('inventarioSearchInput'),
    createIngredientBtn: $('inventarioCreateIngredientBtn'),
    toolbarCreateBtn: $('inventarioToolbarCreateIngredientBtn'),
    configBtn: $('inventarioConfigBtn'),
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
    globalExcelBtn: $('inventarioGlobalExcelBtn'),
    globalTableWrap: $('inventarioGlobalTableWrap'),
    imageViewerModal: $('imageViewerModal'),
    viewerImage: $('viewerImage'),
    viewerStageSpinner: $('viewerStageSpinner'),
    viewerPrevBtn: $('viewerPrevBtn'),
    viewerNextBtn: $('viewerNextBtn'),
    viewerZoomInBtn: $('viewerZoomInBtn'),
    viewerZoomOutBtn: $('viewerZoomOutBtn'),
    viewerBackBtn: $('viewerBackBtn')
  };

  const state = {
    ingredientes: {},
    familias: {},
    measures: [],
    inventario: { config: { globalLowThresholdKg: DEFAULT_LOW_THRESHOLD, expiringSoonDays: DEFAULT_EXPIRING_SOON_DAYS }, items: {} },
    search: '',
    activeFamilyId: 'all',
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
    globalEntryCollapse: {}
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

  const parseNumber = (value) => {
    const parsed = Number(normalizeValue(value).replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : NaN;
  };

  const providerLabel = (value) => normalizeValue(value) || 'No indica';
  const sortedProviders = () => [...(Array.isArray(state.inventario?.config?.providers) ? state.inventario.config.providers : [])]
    .map((item) => normalizeUpper(item))
    .filter(Boolean)
    .filter((item, index, arr) => arr.indexOf(item) === index)
    .sort((a, b) => a.localeCompare(b, 'es'));

  const measureKey = (value) => normalizeLower(value);
  const getMeasureLabel = (name) => {
    const match = state.measures.find((item) => measureKey(item.name) === measureKey(name));
    if (!match) return capitalize(name || 'unidad');
    return `${capitalize(match.name)} (${normalizeValue(match.abbr) || 'S/A'})`;
  };

  const openIosSwal = (options) => Swal.fire({
    ...options,
    returnFocus: false,
    customClass: {
      popup: `ios-alert ingredientes-alert ${options?.customClass?.popup || ''}`.trim(),
      title: 'ios-alert-title',
      htmlContainer: 'ios-alert-text',
      confirmButton: 'ios-btn ios-btn-primary',
      cancelButton: 'ios-btn ios-btn-secondary',
      ...options.customClass
    },
    buttonsStyling: false
  });

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
    ? `<div class="ingrediente-avatar"><span class="thumb-loading"><img class="meta-spinner-login" src="./IMG/Meta-ai-logo.webp" alt="Cargando"></span><img class="thumb-image js-inventario-thumb" src="${item.imageUrl}" alt="${capitalize(item.name)}"></div>`
    : '<div class="ingrediente-avatar ingrediente-avatar-placeholder"><i class="fa-solid fa-carrot"></i></div>';

  const uploadImageToStorage = async (file, folder) => {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const refPath = `${folder}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const ref = window.storageLaJamonera.ref().child(refPath);
    await ref.put(file);
    return ref.getDownloadURL();
  };

  const validateImageFile = (file) => {
    if (!file) return 'Seleccioná una imagen.';
    if (!ALLOWED_UPLOAD_TYPES.includes(file.type)) return 'Formato no válido (JPG, PNG, WEBP, GIF).';
    if (file.size > MAX_UPLOAD_SIZE_BYTES) return 'La imagen supera 5MB.';
    return '';
  };

  const getDefaultRecord = (ingredientId) => ({
    ingredientId,
    stockKg: 0,
    hasEntries: false,
    entries: [],
    lowThresholdKg: null,
    expiringSoonDays: null,
    lotConfig: {
      configured: false,
      collapsed: false,
      tokens: [],
      customAcronym: '',
      includeSeparator: false,
      separator: '-'
    }
  });

  const getRecord = (ingredientId) => {
    const saved = safeObject(state.inventario.items[ingredientId]);
    const base = getDefaultRecord(ingredientId);
    return {
      ...base,
      ...saved,
      lotConfig: { ...base.lotConfig, ...safeObject(saved.lotConfig) }
    };
  };

  const currentThresholdFor = (record) => {
    const local = Number(record.lowThresholdKg);
    if (Number.isFinite(local) && local >= 0) return local;
    const global = Number(state.inventario.config.globalLowThresholdKg);
    return Number.isFinite(global) && global >= 0 ? global : DEFAULT_LOW_THRESHOLD;
  };

  const currentExpiringDaysFor = (record) => {
    const local = Number(record.expiringSoonDays);
    if (Number.isFinite(local) && local >= 0) return local;
    const global = Number(state.inventario.config.expiringSoonDays);
    return Number.isFinite(global) && global >= 0 ? global : DEFAULT_EXPIRING_SOON_DAYS;
  };

  const stockStatusFor = (record) => {
    const stockKg = Number(record.stockKg) || 0;
    if (!record.hasEntries) return { label: 'Nunca ingresó stock', className: 'status-never' };
    if (stockKg <= 0) return { label: 'Sin stock', className: 'status-empty' };
    if (stockKg <= currentThresholdFor(record)) return { label: 'Stock bajo', className: 'status-low' };
    return { label: 'En stock', className: 'status-good' };
  };

  const isEntryExpiringSoon = (entry, days) => {
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
    .reduce((acc, entry) => acc + (Number(entry.qtyKg) || 0), 0);

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

  const persistInventario = async () => {
    await window.laJamoneraReady;
    await window.dbLaJamoneraRest.write('/inventario', state.inventario);
  };

  const persistMeasuresIfNeeded = async (measureName, measureAbbr) => {
    const key = measureKey(measureName);
    if (!key) return;
    if (state.measures.some((item) => measureKey(item.name) === key)) return;
    state.measures.push({ name: normalizeLower(measureName), abbr: normalizeValue(measureAbbr) || 'S/A' });
    await window.dbLaJamoneraRest.write('/ingredientes/config/measures', state.measures);
  };

  const loadData = async () => {
    await window.laJamoneraReady;
    const ing = await window.laJamoneraIngredientesAPI?.getIngredientesSnapshot?.();
    const inv = safeObject(await window.dbLaJamoneraRest.read('/inventario'));
    state.ingredientes = safeObject(ing?.items);
    state.familias = safeObject(ing?.familias);
    state.measures = Array.isArray(ing?.measures) ? ing.measures : [];
    state.inventario = {
      config: {
        globalLowThresholdKg: Number(inv?.config?.globalLowThresholdKg) >= 0 ? Number(inv.config.globalLowThresholdKg) : DEFAULT_LOW_THRESHOLD,
        expiringSoonDays: Number(inv?.config?.expiringSoonDays) >= 0 ? Number(inv.config.expiringSoonDays) : DEFAULT_EXPIRING_SOON_DAYS,
        providers: Array.isArray(inv?.config?.providers)
          ? inv.config.providers.map((item) => normalizeUpper(item)).filter(Boolean)
          : []
      },
      items: safeObject(inv?.items)
    };
    rebuildInventarioIndexes();
  };

  const filteredIngredients = () => Object.values(state.ingredientes)
    .filter((item) => {
      if (state.activeFamilyId !== 'all' && item.familyId !== state.activeFamilyId) return false;
      if (state.activeStockStatus !== 'all') {
        const stockClass = stockStatusFor(getRecord(item.id)).className;
        if (stockClass !== state.activeStockStatus) return false;
      }
      if (!state.search) return true;
      const text = [item.name, item.description, item.familyName, item.measure].map(normalizeLower).join(' ');
      return text.includes(state.search);
    })
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

  const initThumbLoading = (scope = document) => {
    scope.querySelectorAll('.js-inventario-thumb').forEach((img) => {
      const parent = img.closest('.ingrediente-avatar, .family-circle-thumb, .recipe-inline-avatar-wrap, .receta-thumb-wrap, .recipe-suggest-avatar-wrap, .inventario-print-photo-wrap');
      const loader = parent?.querySelector('.thumb-loading');
      const done = () => {
        img.classList.add('is-loaded');
        loader?.classList.add('d-none');
      };
      const fail = () => loader?.classList.add('d-none');
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', fail, { once: true });
      if (img.complete && img.naturalWidth > 0) {
        done();
      } else if (img.complete) {
        fail();
      } else {
        setTimeout(() => {
          if (!img.classList.contains('is-loaded')) {
            fail();
          }
        }, 7000);
      }
    });
  };

  const getGeneralPassword = async () => {
    await window.laJamoneraReady;
    const value = await window.dbLaJamoneraRest.read('/passGeneral/pass');
    return normalizeValue(value);
  };

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


  const entryImageUrls = (entry) => {
    if (Array.isArray(entry?.invoiceImageUrls) && entry.invoiceImageUrls.length) {
      return entry.invoiceImageUrls.filter(Boolean);
    }
    if (entry?.invoiceImageUrl) {
      return [entry.invoiceImageUrl];
    }
    return [];
  };

  const rerenderEditorKeepViewport = (ingredientId, draft, focusSelector = '') => {
    const modalBody = inventarioModal.querySelector('.modal-body');
    const scrollTop = modalBody?.scrollTop || 0;
    const active = focusSelector ? nodes.editorForm?.querySelector(focusSelector) : null;
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
      'status-never': 0
    };
    allIngredients.forEach((item) => {
      const statusClass = stockStatusFor(getRecord(item.id)).className;
      counts[statusClass] = (counts[statusClass] || 0) + 1;
    });

    const options = [
      { key: 'all', label: 'Todos', tone: 'neutral', count: allIngredients.length },
      { key: 'status-empty', label: 'Sin stock', tone: 'danger', count: counts['status-empty'] },
      { key: 'status-low', label: 'Stock bajo', tone: 'warning', count: counts['status-low'] },
      { key: 'status-good', label: 'Con stock', tone: 'success', count: counts['status-good'] },
      { key: 'status-never', label: 'Nunca ingresó', tone: 'info', count: counts['status-never'] }
    ];

    nodes.statusFilters.innerHTML = options.map((option) => `
      <button type="button" class="inventario-status-btn tone-${option.tone} ${state.activeStockStatus === option.key ? 'is-active' : ''}" data-inv-status-filter="${option.key}">
        <span>${option.label}</span>
        <strong>${option.count}</strong>
      </button>`).join('');
  };

  const renderFamilies = () => {
    const families = Object.values(state.familias).sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    const allBtn = `
      <div class="family-circle-wrap">
        <button type="button" class="family-circle-item ${state.activeFamilyId === 'all' ? 'is-active' : ''}" data-inv-family-filter="all">
          <span class="family-circle-thumb family-circle-thumb-placeholder"><i class="fa-solid fa-carrot"></i></span>
          <span class="family-circle-name">Todas</span>
        </button>
      </div>`;
    nodes.families.innerHTML = allBtn + families.map((family) => `
      <div class="family-circle-wrap">
        <button type="button" class="family-circle-item ${state.activeFamilyId === family.id ? 'is-active' : ''}" data-inv-family-filter="${family.id}">
          <span class="family-circle-thumb ${family.imageUrl ? '' : 'family-circle-thumb-placeholder'}">${family.imageUrl ? `<span class="thumb-loading"><img class="meta-spinner-login" src="./IMG/Meta-ai-logo.webp" alt="Cargando"></span><img class="thumb-image js-inventario-thumb" src="${family.imageUrl}" alt="${capitalize(family.name)}">` : '<i class="fa-solid fa-carrot"></i>'}</span>
          <span class="family-circle-name">${capitalize(family.name)}</span>
        </button>
      </div>`).join('');
    initThumbLoading(nodes.families);
  };

  const renderList = () => {
    renderStatusFilters();
    const items = filteredIngredients();
    if (!items.length) {
      nodes.list.innerHTML = '<div class="ingrediente-empty-list">No encontramos ingredientes para inventario.</div>';
      updateListScrollHint();
      return;
    }

    nodes.list.innerHTML = items.map((item) => {
      const record = getRecord(item.id);
      const status = stockStatusFor(record);
      const stockClass = Number(record.stockKg) <= 0 ? 'is-zero' : '';
      return `
        <article class="ingrediente-card inventario-card ${status.className}" data-inventario-card="${item.id}">
          ${ingredientAvatar(item)}
          <div class="ingrediente-main">
            <div class="inventario-card-head">
              <h6 class="ingrediente-name">${capitalize(item.name)}</h6>
              <span class="inventario-status-badge">${status.label}</span>
            </div>
            <p class="ingrediente-meta">${capitalize(item.familyName)} · ${getMeasureLabel(item.measure || 'kilos')}</p>
            ${item.description ? `<p class="ingrediente-description">${sentenceCase(item.description)}</p>` : ''}
            <p class="inventario-stock-line ${stockClass}"><strong>${(Number(record.stockKg) || 0).toFixed(2)} kg</strong><span>Umbral bajo: ${record.lowThresholdKg != null ? record.lowThresholdKg.toFixed(2) : Number(state.inventario.config.globalLowThresholdKg || DEFAULT_LOW_THRESHOLD).toFixed(2)} kg ${record.lowThresholdKg != null ? '(personalizado)' : '(global)'}</span></p>
            <div class="inventario-actions-row inventory-production-actions">
              <button type="button" class="btn ios-btn ios-btn-success inventory-production-action-btn is-main" data-inventario-open-editor="${item.id}"><i class="fa-solid fa-plus"></i><span>Ingresar stock</span></button>
              <button type="button" class="btn ios-btn inventory-production-action-btn is-view inventario-view-btn" data-inventario-open-editor="${item.id}"><i class="fa-regular fa-eye"></i><span>Visualizar</span></button>
              <button type="button" class="btn ios-btn inventory-production-action-btn is-threshold inventario-threshold-btn" data-inventario-config-item="${item.id}"><i class="fa-solid fa-sliders"></i><span>Umbral</span></button>
            </div>
          </div>
        </article>`;
    }).join('');

    updateListScrollHint();
    initThumbLoading(nodes.list);
    renderGlobalPeriodTable();
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
      (Array.isArray(record.entries) ? record.entries : []).forEach((entry) => {
        if (!ignoreRange && (range.from || range.to) && !inDateRange(entry.entryDate, range.from, range.to)) return;
        rows.push({
          ingredientId: ingredient.id,
          ingredientName: capitalize(ingredient.name),
          ingredientDescription: sentenceCase(ingredient.description || 'Sin descripción'),
          ingredientImageUrl: ingredient.imageUrl || '',
          entryDate: entry.entryDate || '-',
          entryDateTime: formatDateTime(entry.createdAt),
          createdAt: entry.createdAt,
          expiryDate: entry.expiryDate || '-',
          qtyKg: Number(entry.qtyKg || 0),
          qty: Number(entry.qty || 0),
          availableKg: getAvailableKg(entry),
          availableQty: getAvailableQty(entry),
          productionUsage: getEntryUsages(entry),
          entryId: entry.id,
          unit: entry.unit || '',
          invoiceNumber: entry.invoiceNumber || '-',
          provider: providerLabel(entry.provider),
          invoiceImageUrls: entryImageUrls(entry),
          invoiceImageUrl: entryImageUrls(entry)[0] || ''
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

  const formatUsageAmount = (kilosUsed) => {
    const kg = Number(kilosUsed || 0);
    if (!Number.isFinite(kg) || kg <= 0) return '0.00 kilos';
    if (kg >= 1) return `${kg.toFixed(2)} kilos`;
    const grams = kg * 1000;
    if (grams >= 1) return `${grams.toFixed(2)} gramos`;
    return `${(grams * 1000).toFixed(2)} mg`;
  };

  const renderGlobalPeriodTable = () => {
    if (!nodes.globalTableWrap) return;
    const rows = getGlobalFilteredEntries();
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    state.globalTablePage = Math.min(Math.max(1, state.globalTablePage), pages);
    const start = (state.globalTablePage - 1) * PAGE_SIZE;
    const pageRows = rows.slice(start, start + PAGE_SIZE);
    const canCollapse = pageRows.some((row) => getEntryTraceRows(row).length && state.globalEntryCollapse[row.entryId] !== true);
    const canExpand = pageRows.some((row) => getEntryTraceRows(row).length && state.globalEntryCollapse[row.entryId] === true);

    const htmlRows = pageRows.length ? pageRows.map((row, index) => {
      const traces = getEntryTraceRows(row);
      const isCollapsed = state.globalEntryCollapse[row.entryId] === true;
      const traceHtml = (!isCollapsed && traces.length)
        ? traces.map((trace) => `
      <tr class="inventario-trace-row">
        <td><div class="inventario-trace-main"><img src="./IMG/Octicons-git-merge.svg" alt="merge" class="inventario-trace-icon">${escapeHtml(formatDateTime(trace.createdAt))}</div></td>
        <td>${escapeHtml(row.ingredientName)}</td>
        <td class="inventario-trace-kilos">-${formatUsageAmount(trace.kilosUsed)}</td>
        <td>${escapeHtml(trace.expiryDateAtProduction || '-')}</td>
        <td>${escapeHtml(trace.ingredientLot)}</td>
        <td>${escapeHtml(trace.productionId)}</td>
        <td><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-open-production-trace="${escapeHtml(trace.productionId)}"><i class="fa-solid fa-users-viewfinder"></i><span>trazabilidad</span></button></td>
      </tr>`).join('') : '';

      return `<tr class="inventario-row-tone ${index % 2 === 0 ? 'is-even-row' : 'is-odd-row'}">
        <td>${escapeHtml(row.entryDateTime)}</td>
        <td>${escapeHtml(row.ingredientName)}</td>
        <td><strong>${row.qtyKg.toFixed(2)} kg</strong><br><span class="inventario-available-line">disp. ${Number(row.availableKg || 0).toFixed(3)} kg</span></td>
        <td>${escapeHtml(row.expiryDate || '-')}</td>
        <td>${escapeHtml(row.invoiceNumber)}</td>
        <td class="inventario-provider-cell">${escapeHtml(row.provider)}</td>
        <td><div class="inventario-entry-actions">${traces.length ? `<button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn inventario-icon-only-btn" data-toggle-global-collapse="${row.entryId}"><i class="fa-solid ${isCollapsed ? 'fa-chevron-down' : 'fa-chevron-up'}"></i></button>` : ''}${row.invoiceImageUrls.length ? `<button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-open-global-images="${encodeURIComponent(JSON.stringify(row.invoiceImageUrls))}"><i class="fa-regular fa-image"></i><span>Ver (${row.invoiceImageUrls.length})</span></button>` : '<button type="button" class="btn ios-btn ios-btn-danger inventario-no-photo-btn" disabled>No posee foto</button>'}</div></td>
      </tr>${traceHtml}`;
    }).join('') : '<tr><td colspan="7" class="text-center">Sin ingresos en ese rango.</td></tr>';

    nodes.globalTableWrap.innerHTML = `
      <div class="inventario-print-row mb-2 inventario-trace-toolbar toolbar-scroll-x">
        <button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" id="inventarioGlobalCollapseAllRowsBtn" ${canCollapse ? '' : 'disabled'}><i class="fa-solid fa-compress"></i><span>Colapsar todo</span></button>
        <button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" id="inventarioGlobalExpandAllRowsBtn" ${canExpand ? '' : 'disabled'}><i class="fa-solid fa-expand"></i><span>Descolapsar todo</span></button>
      </div>
      <div class="table-responsive inventario-global-table inventario-table-compact-wrap">
        <table class="table recipe-table inventario-table-compact mb-0">
          <thead><tr><th>Fecha y hora</th><th>Producto</th><th>Kilos</th><th>Vence</th><th>N° factura</th><th>Proveedor</th><th>Imagen / Acción</th></tr></thead>
          <tbody>${htmlRows}</tbody>
        </table>
      </div>
      <div class="inventario-pagination enhanced">
        <button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn inventario-page-btn" data-global-page="prev" ${state.globalTablePage <= 1 ? 'disabled' : ''} aria-label="Página anterior"><i class="fa-solid fa-chevron-left"></i></button>
        <span>Página ${state.globalTablePage} de ${pages}</span>
        <button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn inventario-page-btn" data-global-page="next" ${state.globalTablePage >= pages ? 'disabled' : ''} aria-label="Página siguiente"><i class="fa-solid fa-chevron-right"></i></button>
      </div>`;
  };

  const openGlobalConfig = async () => {
    const result = await openIosSwal({
      title: 'Configuración global de inventario',
      html: `
        <div class="text-start">
          <label class="form-label" for="globalLowThresholdInput">Umbral global de stock bajo (kg)</label>
          <input id="globalLowThresholdInput" class="swal2-input ios-input" type="number" min="0" step="0.01" value="${state.inventario.config.globalLowThresholdKg}">
          <label class="form-label mt-2" for="globalExpiringSoonInput">Días para considerar “próximo a caducar”</label>
          <input id="globalExpiringSoonInput" class="swal2-input ios-input" type="number" min="0" step="1" value="${state.inventario.config.expiringSoonDays}">
        </div>`,
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      cancelButtonText: 'Cancelar',
      preConfirm: () => {
        const low = parseNumber(document.getElementById('globalLowThresholdInput')?.value);
        const days = parseInt(document.getElementById('globalExpiringSoonInput')?.value || '', 10);
        if (!Number.isFinite(low) || low < 0) {
          Swal.showValidationMessage('Ingresá un umbral válido.');
          return false;
        }
        if (!Number.isFinite(days) || days < 0) {
          Swal.showValidationMessage('Ingresá días válidos (0 o más).');
          return false;
        }
        return { low: Number(low.toFixed(2)), days };
      }
    });
    if (!result.isConfirmed) return;
    state.inventario.config.globalLowThresholdKg = result.value.low;
    state.inventario.config.expiringSoonDays = result.value.days;
    await persistInventario();
    renderList();
  };

  const openProductThresholdConfig = async (ingredientId) => {
    const record = getRecord(ingredientId);
    const result = await openIosSwal({
      title: 'Umbral por producto',
      html: `
        <div class="text-start">
          <label class="form-label" for="itemLowThresholdInput">Umbral de stock (kg)</label>
          <input id="itemLowThresholdInput" class="swal2-input ios-input" type="number" min="0" step="0.01" value="${record.lowThresholdKg ?? ''}" placeholder="Vacío = usar global">
          <label class="form-label mt-2" for="itemExpiringSoonInput">Próximo a caducar (días)</label>
          <input id="itemExpiringSoonInput" class="swal2-input ios-input" type="number" min="0" step="1" value="${record.expiringSoonDays ?? ''}" placeholder="Vacío = usar global">
        </div>`,
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      cancelButtonText: 'Cancelar',
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
    next.lowThresholdKg = result.value.low;
    next.expiringSoonDays = result.value.days;
    state.inventario.items[ingredientId] = next;
    await persistInventario();
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

  const buildLotNumber = ({ lotConfig, invoiceNumber, entryDate }) => {
    const config = safeObject(lotConfig);
    const tokens = Array.isArray(config.tokens) ? config.tokens : [];
    const custom = normalizeUpper(config.customAcronym);
    const separator = config.includeSeparator ? (normalizeValue(config.separator) || '-') : '';
    if (!tokens.length) return normalizeValue(invoiceNumber);
    const resolved = tokens.map((token) => {
      if (token === 'remito_factura') return normalizeValue(invoiceNumber) || 'SIN-FACT';
      if (token === 'fecha_fabricacion') return formatDateCompactDmy(entryDate);
      if (token === 'fecha_hoy') return formatDateCompactDmy(getArgentinaIsoDate());
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

  const getAvailableQty = (entry) => {
    const value = Number(entry?.availableQty);
    if (Number.isFinite(value) && value >= 0) return value;
    return Number(entry?.qty || 0);
  };

  const getAvailableKg = (entry) => {
    const value = Number(entry?.availableKg);
    if (Number.isFinite(value) && value >= 0) return value;
    return Number(entry?.qtyKg || 0);
  };

  const getEntryUsages = (entry) => Array.isArray(entry?.productionUsage) ? entry.productionUsage : [];

  const getEntryTraceRows = (entry) => getEntryUsages(entry).map((usage) => ({
    id: usage.id || makeId('usage_row'),
    createdAt: Number(usage.producedAt || usage.createdAt || 0),
    productionDate: normalizeValue(usage.productionDate) || '-',
    expiryDateAtProduction: normalizeValue(usage.expiryDateAtProduction) || '-',
    kilosUsed: Number(usage.kilosUsed || 0),
    ingredientLot: normalizeValue(usage.ingredientLot || usage.lotNumber) || normalizeValue(entry.lotNumber) || '-',
    productionId: normalizeValue(usage.productionId) || '-'
  })).sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));

  const canExpandAnyRows = (entries = [], collapseMap = {}) => entries.some((entry) => {
    const rows = getEntryTraceRows(entry);
    return rows.length && collapseMap[entry.id] === true;
  });

  const canCollapseAnyRows = (entries = [], collapseMap = {}) => entries.some((entry) => {
    const rows = getEntryTraceRows(entry);
    return rows.length && collapseMap[entry.id] !== true;
  });


  const buildTraceRowsForEntry = (entry) => getEntryTraceRows(entry).map((trace) => ({
    __isTrace: true,
    fechaHora: formatDateTime(trace.createdAt),
    fechaCaducidad: trace.expiryDateAtProduction || '-',
    cantidad: `-${formatUsageAmount(trace.kilosUsed)}`,
    factura: trace.ingredientLot || '-',
    proveedor: trace.productionId || '-',
    imagenes: 'Trazabilidad',
    productionId: trace.productionId || '-'
  }));

  const buildPrintableRowsForEntries = (entries, includeTrace = false) => {
    const rows = [];
    entries.forEach((entry) => {
      rows.push({
        __isTrace: false,
        fechaHora: formatDateTime(entry.createdAt),
        fechaCaducidad: entry.expiryDate || '-',
        cantidad: `${Number(entry.qty || 0).toFixed(2)} ${entry.unit || ''}`,
        factura: entry.invoiceNumber || '-',
        proveedor: providerLabel(entry.provider),
        imagenes: entryImageUrls(entry).length ? `Ver adjunto (${entryImageUrls(entry).length})` : 'Sin imagen'
      });
      if (includeTrace) rows.push(...buildTraceRowsForEntry(entry));
    });
    return rows;
  };

  const buildExportRowsForEntries = (entries, includeTrace = false) => {
    const rows = [];
    entries.forEach((entry) => {
      const urls = entryImageUrls(entry);
      rows.push({
        Fecha: formatDateTime(entry.createdAt),
        'Fecha caducidad': entry.expiryDate || '-',
        Cantidad: `${Number(entry.qty || 0).toFixed(2)} ${entry.unit || ''}`,
        'N° factura': entry.invoiceNumber || '-',
        Proveedor: providerLabel(entry.provider),
        Imágenes: imageLinksText(entry),
        __firstImage: urls[0] || '',
        __tone: 'normal'
      });
      if (includeTrace) {
        buildTraceRowsForEntry(entry).forEach((trace) => {
          rows.push({
            Fecha: `↳ ${trace.fechaHora}`,
            'Fecha caducidad': trace.fechaCaducidad,
            Cantidad: trace.cantidad,
            'N° factura': trace.factura,
            Proveedor: trace.proveedor,
            Imágenes: 'Trazabilidad',
            __tone: 'trace'
          });
        });
      }
    });
    return rows;
  };

  let imageViewerModal = null;
  const ensureImageViewerModal = () => {
    if (!imageViewerModal && window.bootstrap && nodes.imageViewerModal) {
      imageViewerModal = new bootstrap.Modal(nodes.imageViewerModal);
    }
  };

  const setViewerScale = (value) => {
    state.viewerScale = Math.max(1, Math.min(4, value));
    if (nodes.viewerImage) nodes.viewerImage.style.transform = `scale(${state.viewerScale})`;
  };

  const renderViewerImage = () => {
    const item = state.viewerImages[state.viewerIndex];
    if (!item || !nodes.viewerImage) return;
    nodes.viewerStageSpinner?.classList.remove('d-none');
    nodes.viewerImage.classList.remove('is-loaded');
    nodes.viewerImage.src = item.src;
  };

  const openAttachmentViewer = async (entries, startIndex = 0, title = 'Adjuntos') => {
    const images = entries.flatMap((item) => entryImageUrls(item).map((url) => ({ src: url })));
    if (!images.length) return;
    ensureImageViewerModal();
    if (!imageViewerModal) return;
    if (nodes.imageViewerModal) nodes.imageViewerModal.style.zIndex = '3200';
    const latestBackdrop = document.querySelector('.modal-backdrop:last-of-type');
    latestBackdrop?.classList.add('inventory-image-backdrop');
    nodes.imageViewerModal.querySelector('.ios-modal-title').textContent = title;
    state.viewerImages = images;
    state.viewerIndex = Math.min(Math.max(0, startIndex), images.length - 1);
    setViewerScale(1);
    renderViewerImage();
    imageViewerModal.show();
  };

  window.laJamoneraOpenImageViewer = openAttachmentViewer;

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

  const preloadImages = async (urls) => {
    const uniqueUrls = [...new Set(urls.filter(Boolean))];
    if (!uniqueUrls.length) return;

    await openIosSwal({
      title: 'Preparando impresión...',
      html: '<div class="informes-saving-spinner"><img src="./IMG/Meta-ai-logo.webp" alt="Preparando impresión" class="meta-spinner-login"></div>',
      allowOutsideClick: false,
      showConfirmButton: false,
      didOpen: async () => {
        await Promise.all(uniqueUrls.map((url) => new Promise((resolve) => {
          const img = new Image();
          img.onload = resolve;
          img.onerror = resolve;
          img.src = url;
        })));
        Swal.close();
      }
    });
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
        confirmButton: 'ios-btn ios-btn-success',
        denyButton: 'ios-btn ios-btn-danger ios-btn-deny-critical',
        cancelButton: 'ios-btn ios-btn-secondary'
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
        confirmButton: 'ios-btn ios-btn-success',
        denyButton: 'ios-btn ios-btn-danger ios-btn-deny-critical',
        cancelButton: 'ios-btn ios-btn-secondary'
      }
    });
    if (!askTrace.isConfirmed && !askTrace.isDenied) return;

    const includeTrace = askTrace.isConfirmed;

    if (includeImages) {
      await preloadImages(entries.flatMap((entry) => entryImageUrls(entry)).concat([ingredient.imageUrl]));
    }

    const printableRows = buildPrintableRowsForEntries(entries, includeTrace);
    const rows = printableRows.map((row, index) => `
      <tr class="inventario-row-tone ${row.__isTrace ? 'is-trace-row' : (index % 2 === 0 ? 'is-even-row' : 'is-odd-row')}">
        <td>${escapeHtml(row.__isTrace ? `↳ ${row.fechaHora}` : row.fechaHora)}</td>
        <td>${escapeHtml(row.fechaCaducidad)}</td>
        <td>${escapeHtml(row.cantidad)}</td>
        <td>${escapeHtml(row.factura)}</td>
        <td class="inventario-provider-cell">${escapeHtml(row.proveedor)}</td>
        <td>${row.__isTrace ? 'Trazabilidad' : (includeImages ? row.imagenes : (row.imagenes === 'Sin imagen' ? 'Sin imagen' : 'Posee adjuntos'))}</td>
      </tr>`).join('');

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
            body{font-family:Inter,Arial,sans-serif;padding:24px;color:#1f2a44}
            h1{font-size:22px;margin:0 0 12px}
            table{width:100%;border-collapse:collapse}
            th,td{border:1px solid #d7def2;padding:8px;text-align:left;font-size:13px;vertical-align:top}
            th{background:#eef3ff}
            .is-trace-row td{background:#ffecef}
          </style>
        </head>
        <body>
          <section style="display:flex;align-items:center;gap:12px;margin-bottom:14px;">
            ${ingredient.imageUrl ? `<img src="${ingredient.imageUrl}" alt="${escapeHtml(capitalize(ingredient.name))}" style="width:74px;height:74px;border-radius:999px;object-fit:cover;border:1px solid #d7def2;">` : ''}
            <div>
              <h1 style="margin:0 0 4px;">${escapeHtml(capitalize(ingredient.name))} · Historial de ingresos</h1>
              <p style="margin:0;color:#55607f;">${escapeHtml(sentenceCase(ingredient.description || 'Sin descripción'))}</p>
            </div>
          </section>
          <table>
            <thead><tr><th>Fecha y hora</th><th>Fecha caducidad</th><th>Cantidad</th><th>N° factura</th><th>Proveedor</th><th>Imagen</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="6">Sin datos</td></tr>'}</tbody>
          </table>
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
        confirmButton: 'ios-btn ios-btn-success',
        denyButton: 'ios-btn ios-btn-danger ios-btn-deny-critical',
        cancelButton: 'ios-btn ios-btn-secondary'
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
        confirmButton: 'ios-btn ios-btn-success',
        denyButton: 'ios-btn ios-btn-danger ios-btn-deny-critical',
        cancelButton: 'ios-btn ios-btn-secondary'
      }
    });
    if (!askTrace.isConfirmed && !askTrace.isDenied) return;
    const includeTrace = askTrace.isConfirmed;

    const selector = await openIosSwal({
      title: 'Selector de productos',
      html: `<div class="swal-stack-fields text-start">
        <label class="inventario-check-row"><input type="radio" name="printScope" value="all" checked><span>Incluir todos los productos</span></label>
        <label class="inventario-check-row"><input type="radio" name="printScope" value="exclude"><span>Excluir algunos productos</span></label>
        <div id="printProductsScope" class="notify-specific-users-list d-none">
          <div class="step-block"><strong>Familias</strong>${Object.values(state.familias).map((family) => `<label class="inventario-check-row inventario-selector-row">${family.imageUrl ? `<span class="inventario-print-photo-wrap"><span class="thumb-loading"><img class="meta-spinner" src="./IMG/Meta-ai-logo.webp" alt="Cargando"></span><img class="thumb-image js-inventario-thumb inventario-print-photo" src="${family.imageUrl}" alt="${escapeHtml(capitalize(family.name))}"></span>` : ''}<input type="checkbox" data-print-family value="${family.id}"><span>${escapeHtml(capitalize(family.name))}</span></label>`).join('')}</div>
          <div class="step-block"><strong>Productos</strong>${Object.values(state.ingredientes).map((item) => `<label class="inventario-check-row inventario-selector-row">${item.imageUrl ? `<span class="inventario-print-photo-wrap"><span class="thumb-loading"><img class="meta-spinner" src="./IMG/Meta-ai-logo.webp" alt="Cargando"></span><img class="thumb-image js-inventario-thumb inventario-print-photo" src="${item.imageUrl}" alt="${escapeHtml(capitalize(item.name))}"></span>` : ''}<input type="checkbox" data-print-product data-family-id="${item.familyId || ''}" value="${item.id}"><span>${escapeHtml(capitalize(item.name))}</span></label>`).join('')}</div>
        </div>
      </div>`,
      showCancelButton: true,
      confirmButtonText: 'Continuar',
      cancelButtonText: 'Cancelar',
      didOpen: () => {
        const all = document.querySelector('input[name="printScope"][value="all"]');
        const exclude = document.querySelector('input[name="printScope"][value="exclude"]');
        const list = document.getElementById('printProductsScope');
        const toggle = () => list?.classList.toggle('d-none', !exclude?.checked);
        all?.addEventListener('change', toggle);
        exclude?.addEventListener('change', toggle);
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
        const mode = document.querySelector('input[name="printScope"]:checked')?.value || 'all';
        const selected = [...document.querySelectorAll('[data-print-product]:checked')].map((node) => node.value);
        if (mode === 'exclude' && !selected.length) {
          Swal.showValidationMessage('Seleccioná al menos un producto para excluir.');
          return false;
        }
        return { mode, selected };
      }
    });
    if (!selector.isConfirmed) return;

    const excluded = new Set(selector.value.mode === 'exclude' ? selector.value.selected : []);
    const scopedRows = rows.filter((row) => !excluded.has(row.ingredientId));
    if (includeImages) {
      await preloadImages(scopedRows.flatMap((row) => row.invoiceImageUrls || []).concat(scopedRows.map((row) => row.ingredientImageUrl)));
    }

    const grouped = scopedRows.reduce((acc, row) => {
      acc[row.ingredientId] = acc[row.ingredientId] || [];
      acc[row.ingredientId].push(row);
      return acc;
    }, {});

    const content = Object.keys(grouped).map((ingredientId) => {
      const productRows = grouped[ingredientId];
      const head = productRows[0];
      const tableRows = productRows.flatMap((row) => {
        const mainRow = `<tr><td>${escapeHtml(row.entryDateTime)}</td><td>${row.qtyKg.toFixed(2)} kg</td><td>${row.qty.toFixed(2)} ${escapeHtml(row.unit)}</td><td>${escapeHtml(row.invoiceNumber)}</td><td class="inventario-provider-cell">${escapeHtml(row.provider)}</td><td>${includeImages ? (row.invoiceImageUrls?.length ? `Ver adjunto (${row.invoiceImageUrls.length})` : 'Sin imagen') : (row.invoiceImageUrls?.length ? `Posee ${row.invoiceImageUrls.length} imagen/es` : 'Sin imagen')}</td></tr>`;
        if (!includeTrace) return [mainRow];
        const traceRows = buildTraceRowsForEntry(row).map((trace) => `<tr style="background:#ffecef;"><td>${escapeHtml(`↳ ${trace.fechaHora}`)}</td><td>${escapeHtml(trace.cantidad)}</td><td>${escapeHtml(trace.factura)}</td><td>${escapeHtml(trace.proveedor)}</td><td class="inventario-provider-cell">Trazabilidad</td><td>${escapeHtml(trace.productionId)}</td></tr>`);
        return [mainRow, ...traceRows];
      }).join('');
      return `<section style="margin-bottom:14px;"><div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">${head.ingredientImageUrl ? `<img src="${head.ingredientImageUrl}" style="width:62px;height:62px;border-radius:999px;object-fit:cover;border:1px solid #d7def2;">` : ''}<div><h2 style="margin:0;font-size:18px;">${escapeHtml(head.ingredientName)}</h2><p style="margin:0;color:#55607f;font-size:12px;">${escapeHtml(head.ingredientDescription)}</p></div></div><table><thead><tr><th>Fecha y hora</th><th>Kilos</th><th>Cantidad</th><th>N° factura</th><th>Proveedor</th><th>Imagen</th></tr></thead><tbody>${tableRows}</tbody></table></section>`;
    }).join('');

    const imagesHtml = includeImages
      ? `<section><h2 style="margin:16px 0 10px;font-size:18px;">Imágenes adjuntas del período</h2><div style="display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));">${scopedRows.flatMap((row) => (row.invoiceImageUrls || []).map((url, idx) => `<figure style="margin:0;border:1px solid #d7def2;border-radius:12px;padding:10px;background:#fff;"><img src="${url}" style="width:100%;max-height:320px;object-fit:contain;border-radius:10px;"/><figcaption style="font-size:12px;color:#4b5f8e;margin-top:6px;">${escapeHtml(row.ingredientName)} · ${escapeHtml(row.entryDate)} · ${idx + 1}</figcaption></figure>`)).join('')}</div></section>`
      : '';

    const win = window.open('', '_blank', 'width=1300,height=900');
    if (!win) return;
    const range = parseRangeValue(state.dashboardDateRange);
    const title = range.from && range.to ? `Ingresos del ${range.from.split('-').reverse().join('/')} al ${range.to.split('-').reverse().join('/')}` : 'Ingresos por período';
    win.document.write(`<html><head><title>${title}</title><style>body{font-family:Inter,Arial;padding:20px;color:#1f2a44}table{width:100%;border-collapse:collapse}th,td{border:1px solid #d7def2;padding:6px;font-size:11px}th{background:#eef3ff;font-size:10px;text-transform:uppercase;letter-spacing:.04em}</style></head><body><h1>${title}</h1>${content || '<p>Sin datos.</p>'}${imagesHtml}</body></html>`);
    win.document.close();
    win.focus();
    await waitPrintAssets(win);
    win.print();
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
      html: '<input id="entryDeletePass" type="password" class="swal2-input ios-input" placeholder="Contraseña general">',
      showCancelButton: true,
      confirmButtonText: 'Eliminar',
      cancelButtonText: 'Cancelar',
      customClass: {
        confirmButton: 'ios-btn ios-btn-danger',
        cancelButton: 'ios-btn ios-btn-secondary'
      },
      preConfirm: async () => {
        const enteredPass = normalizeValue(document.getElementById('entryDeletePass')?.value);
        if (!enteredPass) {
          Swal.showValidationMessage('Ingresá la contraseña.');
          return false;
        }
        const firebasePass = await getGeneralPassword();
        if (!firebasePass || enteredPass !== firebasePass) {
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

    state.inventario.items[ingredientId] = record;
    rebuildInventarioIndexes();
    await persistInventario();
    return true;
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
      const isCollapsed = collapseMap[entry.id] === true;
      const traceHtml = (!isCollapsed && traceRows.length)
        ? traceRows.map((trace) => `
        <tr class="inventario-trace-row">
          <td><div class="inventario-trace-main"><img src="./IMG/Octicons-git-merge.svg" alt="merge" class="inventario-trace-icon">${formatDateTime(trace.createdAt)}</div></td>
          <td>${escapeHtml(trace.expiryDateAtProduction || '-')}</td>
          <td class="inventario-trace-kilos">-${formatUsageAmount(trace.kilosUsed)}</td>
          <td>${escapeHtml(trace.ingredientLot)}</td>
          <td>${escapeHtml(trace.productionId)}</td>
          <td><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-open-production-trace="${escapeHtml(trace.productionId)}"><i class="fa-solid fa-users-viewfinder"></i><span>trazabilidad</span></button></td>
          <td></td>
        </tr>`).join('') : '';

      return `
      <tr class="inventario-row-tone ${index % 2 === 0 ? 'is-even-row' : 'is-odd-row'}">
        <td>${formatDateTime(entry.createdAt)}</td>
        <td>${entry.expiryDate || '-'}</td>
        <td><strong>${Number(entry.qty || 0).toFixed(2)} ${escapeHtml(entry.unit || '')}</strong><br><span class="inventario-available-line">disponible ${getAvailableKg(entry).toFixed(3)} kilos</span></td>
        <td>${escapeHtml(entry.invoiceNumber || '-')}</td>
        <td class="inventario-provider-cell">${escapeHtml(providerLabel(entry.provider))}</td>
        <td>${entryImageUrls(entry).length ? `<button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-open-invoice-image="${entry.id}"><i class="fa-regular fa-image"></i><span>Ver (${entryImageUrls(entry).length})</span></button>` : '<button type="button" class="btn ios-btn ios-btn-danger inventario-no-photo-btn" disabled>Sin foto</button>'}</td>
        <td>
          <div class="inventario-entry-actions">
            ${traceRows.length ? `<button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn inventario-icon-only-btn" data-toggle-entry-collapse="${entry.id}" aria-label="Colapsar desglose"><i class="fa-solid ${isCollapsed ? 'fa-chevron-down' : 'fa-chevron-up'}"></i></button>` : ''}
            <button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn inventario-icon-only-btn" data-print-entry="${entry.id}" aria-label="Imprimir ingreso"><i class="fa-solid fa-print"></i></button>
            <button type="button" class="btn ios-btn inventario-delete-btn inventario-threshold-btn inventario-icon-only-btn" data-delete-entry="${entry.id}" aria-label="Eliminar ingreso"><i class="fa-solid fa-trash"></i></button>
          </div>
        </td>
      </tr>${traceHtml}`;
    }).join('') : '<tr><td colspan="7" class="text-center">Sin ingresos para mostrar.</td></tr>';

    const canCollapse = canCollapseAnyRows(filtered, collapseMap);
    const canExpand = canExpandAnyRows(filtered, collapseMap);

    return `
      <div class="inventario-table-wrap">
        <div class="inventario-table-head enhanced">
          <input id="inventarioEntriesSearch" type="search" class="form-control ios-input" autocomplete="off" placeholder="Buscar en ingresos" value="${escapeHtml(state.tableSearch)}">
          <div class="inventario-history-toolbar">
            <div class="inventario-table-range">
              <input id="inventarioEntriesRange" class="form-control ios-input" autocomplete="off" placeholder="Rango de fechas" value="${escapeHtml(state.tableDateRange)}">
            </div>
            <div class="inventario-print-row toolbar-scroll-x">
              <button type="button" class="btn ios-btn inventario-delete-btn inventario-threshold-btn ${state.tableDateRange ? '' : 'd-none'}" id="inventarioClearFilterBtn"><i class="fa-solid fa-xmark"></i><span>Limpiar filtro</span></button>
              <button type="button" class="btn ios-btn inventario-expand-btn inventario-threshold-btn" id="inventarioExpandTableBtn"><i class="fa-solid fa-up-right-and-down-left-from-center"></i><span>Ampliar</span></button>
              <button type="button" class="btn ios-btn ios-btn-success inventario-threshold-btn" id="inventarioExcelBtn"><i class="fa-solid fa-file-excel"></i><span>Excel</span></button>
              <span class="inventario-period-divider" aria-hidden="true"></span>
              <button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" id="inventarioPrintFilteredBtn"><i class="fa-solid fa-print"></i><span>Imprimir filtro</span></button>
              <button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" id="inventarioPrintAllBtn"><i class="fa-solid fa-print"></i><span>Imprimir total</span></button>
            </div>
            <div class="inventario-print-row toolbar-scroll-x">
              <button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" id="inventarioCollapseAllRowsBtn" ${canCollapse ? '' : 'disabled'}><i class="fa-solid fa-compress"></i><span>Colapsar todo</span></button>
              <button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" id="inventarioExpandAllRowsBtn" ${canExpand ? '' : 'disabled'}><i class="fa-solid fa-expand"></i><span>Descolapsar todo</span></button>
            </div>
          </div>
        </div>
        <div class="table-responsive inventario-table-compact-wrap">
          <table class="table recipe-table inventario-table-compact mb-0">
            <thead><tr><th>Fecha y hora</th><th>Fecha caducidad</th><th>Cantidad</th><th>Nº factura</th><th>Proveedor</th><th>Imagen</th><th>Acción</th></tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
        <div class="inventario-pagination enhanced">
          <button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn inventario-page-btn" data-entry-page="prev" ${state.tablePage <= 1 ? 'disabled' : ''} aria-label="Página anterior"><i class="fa-solid fa-chevron-left"></i></button>
          <span>Página ${state.tablePage} de ${pages}</span>
          <button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn inventario-page-btn" data-entry-page="next" ${state.tablePage >= pages ? 'disabled' : ''} aria-label="Página siguiente"><i class="fa-solid fa-chevron-right"></i></button>
        </div>
      </div>`;
  };

  const escapeHtml = (value) => String(value || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');


  const openExpandedTable = async (title, tableHtml) => {
    await openIosSwal({
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
        confirmButton: 'ios-btn ios-btn-secondary'
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
    return `<button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn js-open-expanded-image" data-images="${encodeURIComponent(JSON.stringify(urls))}"><i class="fa-regular fa-image"></i><span>Ver (${urls.length})</span></button>`;
  };

  const showExcelPreparing = () => {
    Swal.fire({
      title: 'Exportando Excel...',
      html: '<img src="./IMG/Meta-ai-logo.webp" alt="Exportando Excel" class="meta-spinner-login">',
      allowOutsideClick: false,
      showConfirmButton: false,
      customClass: {
        popup: 'ios-alert ingredientes-alert ingredientes-saving-alert',
        title: 'ios-alert-title',
        htmlContainer: 'ios-alert-text ingredientes-saving-html'
      },
      buttonsStyling: false,
      returnFocus: false
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
        const tone = data.__tone === 'trace' ? 'FFFFECEF' : (index % 2 === 0 ? 'FFF5F8FF' : 'FFEAF1FF');
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

  const renderEditor = (ingredientId, draft = null) => {
    const ingredient = state.ingredientes[ingredientId];
    if (!ingredient) return;
    const record = getRecord(ingredientId);
    const expiringDays = currentExpiringDaysFor(record);
    const expiringKg = sumExpiringSoonKg(record);

    const baseDraft = {
      qty: '',
      unit: 'kilos',
      entryDate: getArgentinaIsoDate(),
      expiryDate: addDaysToIso(getArgentinaIsoDate(), 5),
      invoiceNumber: '',
      provider: '',
      invoiceImageFile: null,
      invoiceImageCountLabel: 'Sin imágenes seleccionadas',
      tokens: [...record.lotConfig.tokens],
      customAcronym: normalizeValue(record.lotConfig.customAcronym),
      includeSeparator: Boolean(record.lotConfig.includeSeparator),
      separator: record.lotConfig.separator || '-',
      showLotConfig: !Boolean(record.lotConfig.configured || record.lotConfig.collapsed)
    };
    state.editorDraft = { ...baseDraft, ...(draft || {}) };
    state.selectedIngredientId = ingredientId;
    state.editorDirty = false;
    setStateView('editor');
    nodes.editorTitle.textContent = `Inventario · ${capitalize(ingredient.name)}`;

    const shouldShowExpiring = expiringKg > 0;
    const providers = sortedProviders();

    const lotOptionRows = LOT_TOKEN_OPTIONS.map((option) => `
      <label class="inventario-check-row">
        <input type="checkbox" data-lot-check="${option.key}" ${state.editorDraft.tokens.includes(option.key) ? 'checked' : ''}>
        <span>${option.label}</span>
      </label>`).join('');

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
            <strong>${(Number(record.stockKg) || 0).toFixed(2)} kg</strong>
          </div>
          <div class="inventario-stat-row">
            ${shouldShowExpiring ? `<div class="inventario-stat-card is-alert"><small>Próximos a caducar (${expiringDays} días)</small><strong>${expiringKg.toFixed(2)} kg</strong></div>` : ''}
          </div>
          <div class="inventario-head-actions-row">
            <button type="button" class="btn ios-btn ios-btn-secondary inventario-head-action" id="inventarioProductThresholdBtn"><i class="fa-solid fa-sliders"></i><span>Configurar umbrales</span></button>
            <button type="button" id="inventarioEditIngredientBtn" class="btn ios-btn ios-btn-success inventario-head-action"><i class="fa-solid fa-pen"></i><span>Editar ingrediente</span></button>
          </div>
        </div>
      </section>

      <section class="recipe-step-card step-block inventario-lot-section">
        <button type="button" class="inventario-collapse-head inventario-collapse-head-styled" id="lotConfigToggleBtn" aria-expanded="${state.editorDraft.showLotConfig}">
          <span><span class="recipe-step-number">1</span> Configuración de lote</span>
          <span class="inventario-collapse-summary">${buildLotSummaryBadges(state.editorDraft)}</span>
        </button>
        <div id="lotConfigBody" class="step-content ${state.editorDraft.showLotConfig ? '' : 'd-none'}">
          <div class="inventario-check-grid">${lotOptionRows}</div>
          <div class="inventario-inline-fields">
            <input id="lotCustomAcronym" class="form-control ios-input" placeholder="Ej: JAM" value="${escapeHtml(state.editorDraft.customAcronym)}" ${state.editorDraft.tokens.includes('siglas_personalizadas') ? '' : 'disabled'}>
          </div>
          <label class="inventario-check-row"><input type="checkbox" id="lotIncludeSeparator" ${state.editorDraft.includeSeparator ? 'checked' : ''}><span>Incluir separadores</span></label>
          <select id="lotSeparator" class="form-select ios-input" ${state.editorDraft.includeSeparator ? '' : 'disabled'}>
            ${LOT_SEPARATORS.map((sep) => `<option value="${sep}" ${state.editorDraft.separator === sep ? 'selected' : ''}>${sep}</option>`).join('')}
          </select>
          <div class="inventario-lot-order" id="lotTokenOrder">${tokensHtml || '<div class="inventario-token-placeholder">Tildá opciones para generar badges.</div>'}</div>
          <code id="lotPatternPreview" class="inventario-lot-preview"></code>
        </div>
      </section>

      <section class="recipe-step-card step-block">
        <h6 class="step-title"><span class="recipe-step-number">2</span> Ingresar Stock</h6>
        <div class="step-content recipe-fields-flex inventario-stock-grid">
          <div class="recipe-field recipe-field-half">
            <label class="form-label" for="inventoryQty"><i class="fa-solid fa-weight-hanging inventario-step-icon"></i> Cantidad a ingresar</label>
            <input id="inventoryQty" class="form-control ios-input" type="number" autocomplete="off" min="0" step="0.01" value="${state.editorDraft.qty}">
          </div>
          <div class="recipe-field recipe-field-half">
            <label class="form-label" for="inventoryUnit"><i class="fa-solid fa-ruler-combined inventario-step-icon"></i> Unidad</label>
            <select id="inventoryUnit" class="form-select ios-input" autocomplete="off">
              ${state.measures.map((m) => `<option value="${escapeHtml(m.name)}" ${measureKey(m.name) === measureKey(state.editorDraft.unit) ? 'selected' : ''}>${escapeHtml(getMeasureLabel(m.name))}</option>`).join('')}
              <option value="add_measure">+ Agregar medida</option>
            </select>
          </div>
          <div class="recipe-field recipe-field-half">
            <label class="form-label" for="inventoryEntryDate"><i class="fa-regular fa-calendar-plus inventario-step-icon"></i> Fecha de ingreso</label>
            <input id="inventoryEntryDate" class="form-control ios-input" autocomplete="off" value="${escapeHtml(state.editorDraft.entryDate)}" placeholder="Seleccionar fecha">
          </div>
          <div class="recipe-field recipe-field-half">
            <label class="form-label" for="inventoryExpiryDate"><i class="fa-regular fa-calendar-check inventario-step-icon"></i> Fecha de caducidad</label>
            <input id="inventoryExpiryDate" class="form-control ios-input" autocomplete="off" value="${escapeHtml(state.editorDraft.expiryDate)}" placeholder="Seleccionar fecha">
          </div>
          <div class="recipe-field recipe-field-half">
            <label class="form-label" for="inventoryInvoiceNumber"><i class="fa-solid fa-file-invoice inventario-step-icon"></i> Número de factura/remito</label>
            <textarea id="inventoryInvoiceNumber" name="inventory_code_free" class="form-control ios-input inventario-invoice-textarea" rows="1" placeholder="Ej: A-000123" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" inputmode="text">${escapeHtml(state.editorDraft.invoiceNumber)}</textarea>
          </div>
          <div class="recipe-field recipe-field-half">
            <label class="form-label" for="inventoryProvider"><i class="fa-solid fa-truck-field inventario-step-icon"></i> Proveedor</label>
            <select id="inventoryProvider" class="form-select ios-input" autocomplete="off">
              <option value="">Seleccionar proveedor (opcional)</option>
              ${providers.map((provider) => `<option value="${escapeHtml(provider)}" ${normalizeUpper(state.editorDraft.provider) === provider ? 'selected' : ''}>${escapeHtml(provider)}</option>`).join('')}
              <option value="add_provider">+ Agregar proveedor</option>
            </select>
          </div>
          <div class="recipe-field recipe-field-full">
            <label class="form-label" for="inventoryInvoiceImage"><i class="fa-regular fa-images inventario-step-icon"></i> Adjuntar foto(s)</label>
            <label for="inventoryInvoiceImage" class="inventario-upload-dropzone">
              <i class="fa-regular fa-images"></i>
              <span>Arrastrá imágenes o hacé click para seleccionar</span>
            </label>
            <input id="inventoryInvoiceImage" class="form-control image-file-input inventario-hidden-file-input" autocomplete="off" type="file" accept="image/*" multiple>
            <small id="inventoryInvoiceImageFeedback" class="inventario-file-feedback">${escapeHtml(state.editorDraft.invoiceImageCountLabel || 'Sin imágenes seleccionadas')}</small>
          </div>
        </div>
          <div class="recipe-table-actions inventario-save-inline">
            <button type="submit" id="saveInventoryBtn" class="btn ios-btn ios-btn-success recipe-table-action-btn recipe-table-action-btn-primary">
              <img src="./IMG/Meta-ai-logo.webp" alt="Guardando" class="meta-spinner d-none" id="saveInventorySpinner">
              <i class="fa-solid fa-floppy-disk" id="saveInventoryIcon"></i>
              <span>Guardar ingreso</span>
            </button>
          </div>
        </div>
      </section>

      <section class="recipe-step-card step-block">
        <h6 class="step-title"><span class="recipe-step-number">3</span> Historial de ingresos</h6>
        ${renderEntryTable(record)}
      </section>`;

    const syncDraft = () => {
      state.editorDraft.qty = nodes.editorForm.querySelector('#inventoryQty')?.value || '';
      state.editorDraft.unit = nodes.editorForm.querySelector('#inventoryUnit')?.value || 'kilos';
      state.editorDraft.entryDate = nodes.editorForm.querySelector('#inventoryEntryDate')?.value || '';
      state.editorDraft.expiryDate = nodes.editorForm.querySelector('#inventoryExpiryDate')?.value || '';
      state.editorDraft.invoiceNumber = nodes.editorForm.querySelector('#inventoryInvoiceNumber')?.value || '';
      state.editorDraft.provider = nodes.editorForm.querySelector('#inventoryProvider')?.value || '';
      state.editorDraft.customAcronym = nodes.editorForm.querySelector('#lotCustomAcronym')?.value || '';
      state.editorDraft.includeSeparator = Boolean(nodes.editorForm.querySelector('#lotIncludeSeparator')?.checked);
      state.editorDraft.separator = nodes.editorForm.querySelector('#lotSeparator')?.value || '-';
      const files = [...(nodes.editorForm.querySelector('#inventoryInvoiceImage')?.files || [])];
      state.editorDraft.invoiceImageCountLabel = files.length
        ? `${files.length} imagen${files.length === 1 ? '' : 'es'} adjunta${files.length === 1 ? '' : 's'} para subir`
        : 'Sin imágenes seleccionadas';
      state.editorDirty = true;
    };

    const hasDuplicateInvoice = () => {
      const invoice = normalizeLower(nodes.editorForm.querySelector('#inventoryInvoiceNumber')?.value);
      if (!invoice) return false;
      const indexed = state.inventario.indexes?.invoiceByIngredient?.[ingredientId]?.[invoice];
      return Boolean(indexed);
    };

    const renderInvoiceFeedback = () => {
      const feedback = nodes.editorForm.querySelector('#inventoryInvoiceFeedback');
      const saveBtn = nodes.editorForm.querySelector('#saveInventoryBtn');
      if (!feedback || !saveBtn) return;
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
      nodes.editorForm.querySelector('#lotPatternPreview').textContent = pattern || 'Sin patrón definido';
      nodes.editorForm.querySelector('.inventario-collapse-summary').innerHTML = buildLotSummaryBadges(state.editorDraft);
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

    nodes.editorForm.querySelector('#inventarioProductThresholdBtn')?.addEventListener('click', async () => {
      await openProductThresholdConfig(ingredientId);
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
      inventarioModal.setAttribute('inert', '');
      try {
        await window.laJamoneraIngredientesAPI?.openIngredientForm?.(state.ingredientes[ingredientId]);
      } finally {
        inventarioModal.removeAttribute('inert');
      }
      await loadData();
      renderEditor(ingredientId, state.editorDraft);
    });

    nodes.editorForm.querySelector('#inventoryUnit').addEventListener('change', async (event) => {
      if (event.target.value !== 'add_measure') {
        syncDraft();
        return;
      }
      const result = await openIosSwal({
        title: 'Agregar medida',
        html: '<div class="swal-stack-fields"><input id="newMeasureName" class="swal2-input ios-input" placeholder="Nombre"><input id="newMeasureAbbr" class="swal2-input ios-input" placeholder="Abreviatura"></div>',
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
        await loadData();
        state.editorDraft.unit = result.value.name;
      }
      renderEditor(ingredientId, state.editorDraft);
    });

    nodes.editorForm.querySelector('#inventoryProvider')?.addEventListener('change', async (event) => {
      if (event.target.value !== 'add_provider') {
        syncDraft();
        return;
      }

      const result = await openIosSwal({
        title: 'Agregar proveedor',
        html: '<input id="newProviderName" class="swal2-input ios-input" placeholder="Nombre del proveedor">',
        showCancelButton: true,
        confirmButtonText: 'Guardar',
        cancelButtonText: 'Cancelar',
        preConfirm: () => {
          const provider = normalizeUpper(document.getElementById('newProviderName')?.value);
          if (!provider) {
            Swal.showValidationMessage('Completá el nombre del proveedor.');
            return false;
          }
          return provider;
        }
      });

      if (result.isConfirmed) {
        const merged = new Set([...(state.inventario.config.providers || []), result.value]);
        state.inventario.config.providers = [...merged].map((item) => normalizeUpper(item)).filter(Boolean).sort((a, b) => a.localeCompare(b, 'es'));
        state.editorDraft.provider = result.value;
        await persistInventario();
      }

      renderEditor(ingredientId, state.editorDraft);
    });

    nodes.editorForm.querySelectorAll('input:not([type="file"]),select,textarea').forEach((el) => {
      el.addEventListener('input', syncDraft);
      el.addEventListener('change', syncDraft);
    });
    nodes.editorForm.querySelector('#inventoryInvoiceImage')?.addEventListener('change', () => {
      syncDraft();
      const feedback = nodes.editorForm.querySelector('#inventoryInvoiceImageFeedback');
      if (feedback) {
        feedback.textContent = state.editorDraft.invoiceImageCountLabel || 'Sin imágenes seleccionadas';
      }
    });
    nodes.editorForm.querySelector('#inventoryInvoiceNumber')?.addEventListener('change', async () => {
      const invoice = normalizeLower(nodes.editorForm.querySelector('#inventoryInvoiceNumber')?.value);
      if (!invoice) return;
      if (state.inventario.indexes?.invoiceByIngredient?.[ingredientId]?.[invoice]) {
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
      const dayMap = getDayKgMap(Array.isArray(record.entries) ? record.entries : []);
      window.flatpickr(nodes.editorForm.querySelector('#inventarioEntriesRange'), {
        locale,
        mode: 'range',
        dateFormat: 'Y-m-d',
        allowInput: true,
        defaultDate: getDefaultRangeDates(state.tableDateRange),
        onDayCreate: (_dObj, _dStr, _fp, dayElem) => {
          const date = dayElem.dateObj ? getArgentinaIsoDate(dayElem.dateObj) : '';
          const kg = dayMap[date];
          if (kg) {
            const bubble = document.createElement('span');
            bubble.className = 'inventario-day-kg';
            bubble.textContent = `${Number(kg || 0).toFixed(2)}kg`;
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
        if (getEntryTraceRows(entry).length) map[entry.id] = true;
      });
      state.entryCollapseByIngredient[ingredientId] = map;
      rerenderEditorKeepViewport(ingredientId, state.editorDraft, '#inventarioEntriesSearch');
    });

    nodes.editorForm.querySelector('#inventarioExpandAllRowsBtn')?.addEventListener('click', () => {
      const map = { ...(state.entryCollapseByIngredient[ingredientId] || {}) };
      getFilteredEntries(Array.isArray(record.entries) ? record.entries : []).forEach((entry) => {
        if (getEntryTraceRows(entry).length) map[entry.id] = false;
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
      const htmlRows = fullRows.length ? fullRows.map((entry, index) => `<tr class="inventario-row-tone ${index % 2 === 0 ? 'is-even-row' : 'is-odd-row'}"><td>${formatDateTime(entry.createdAt)}</td><td>${entry.expiryDate || '-'}</td><td>${Number(entry.qty || 0).toFixed(2)} ${escapeHtml(entry.unit || '')}</td><td>${escapeHtml(entry.invoiceNumber || '-')}</td><td class="inventario-provider-cell">${escapeHtml(providerLabel(entry.provider))}</td><td>${buildExpandedImageCell(entryImageUrls(entry))}</td></tr>`).join('') : '<tr><td colspan="6" class="text-center">Sin ingresos para mostrar.</td></tr>';
      await openExpandedTable('Historial ampliado', `<div class="table-responsive inventario-table-compact-wrap"><table class="table recipe-table inventario-table-compact mb-0"><thead><tr><th>Fecha y hora</th><th>Fecha caducidad</th><th>Cantidad</th><th>Nº factura</th><th>Proveedor</th><th>Imagen</th></tr></thead><tbody>${htmlRows}</tbody></table></div>`);
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
        headers: ['Fecha', 'Fecha caducidad', 'Cantidad', 'N° factura', 'Proveedor', 'Imágenes'],
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

    nodes.editorForm.querySelectorAll('[data-delete-entry]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const deleted = await removeEntryWithSecurity(ingredientId, btn.dataset.deleteEntry);
        if (!deleted) return;
        state.tablePage = 1;
        await loadData();
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
      window.flatpickr(nodes.editorForm.querySelector('#inventoryEntryDate'), { locale, dateFormat: 'Y-m-d', allowInput: true });
      window.flatpickr(nodes.editorForm.querySelector('#inventoryExpiryDate'), { locale, dateFormat: 'Y-m-d', allowInput: true, minDate: 'today' });
    }

    wireTokenDrag();
    renderPattern();
    initThumbLoading(nodes.editorForm);
  };

  const convertToKg = (qty, unit) => {
    const key = measureKey(unit);
    if (key.includes('gram')) return qty / 1000;
    return qty;
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

  const saveEntry = async (event) => {
    event.preventDefault();
    const ingredientId = state.selectedIngredientId;
    if (!ingredientId) return;

    const qty = parseNumber(nodes.editorForm.querySelector('#inventoryQty')?.value);
    const unit = normalizeValue(nodes.editorForm.querySelector('#inventoryUnit')?.value || 'kilos');
    const entryDate = normalizeValue(nodes.editorForm.querySelector('#inventoryEntryDate')?.value);
    const expiryDate = normalizeValue(nodes.editorForm.querySelector('#inventoryExpiryDate')?.value);
    const invoiceNumber = normalizeValue(nodes.editorForm.querySelector('#inventoryInvoiceNumber')?.value);
    const provider = normalizeUpper(nodes.editorForm.querySelector('#inventoryProvider')?.value);
    const files = [...(nodes.editorForm.querySelector('#inventoryInvoiceImage')?.files || [])];
    const record = getRecord(ingredientId);

    if (!record.hasEntries && !state.editorDraft.tokens.length) {
      await openIosSwal({
        title: 'Configuración requerida',
        html: '<p>Antes del primer ingreso debés configurar el lote (paso 1).</p>',
        icon: 'warning',
        confirmButtonText: 'Entendido'
      });
      return;
    }

    if (!Number.isFinite(qty) || qty <= 0) {
      await openIosSwal({ title: 'Cantidad inválida', html: '<p>Ingresá una cantidad mayor a 0.</p>', icon: 'warning', confirmButtonText: 'Entendido' });
      return;
    }

    if (!entryDate || !expiryDate) {
      await openIosSwal({ title: 'Fechas incompletas', html: '<p>Completá fecha de ingreso y caducidad.</p>', icon: 'warning', confirmButtonText: 'Entendido' });
      return;
    }

    if (!invoiceNumber) {
      await openIosSwal({ title: 'Dato faltante', html: '<p>Completá el número de factura o remito.</p>', icon: 'warning', confirmButtonText: 'Entendido' });
      return;
    }

    if (state.inventario.indexes?.invoiceByIngredient?.[ingredientId]?.[normalizeLower(invoiceNumber)]) {
      await openIosSwal({
        title: 'Ingreso duplicado',
        html: '<p>Ya existe un ingreso para este producto con ese número de factura/remito.</p>',
        icon: 'warning',
        confirmButtonText: 'Entendido'
      });
      return;
    }

    for (const file of files) {
      const message = validateImageFile(file);
      if (message) {
        await openIosSwal({ title: 'Imagen inválida', html: `<p>${message}</p>`, icon: 'warning', confirmButtonText: 'Entendido' });
        return;
      }
    }

    const saveBtn = nodes.editorForm.querySelector('#saveInventoryBtn');
    const spinner = nodes.editorForm.querySelector('#saveInventorySpinner');
    const icon = nodes.editorForm.querySelector('#saveInventoryIcon');
    saveBtn.setAttribute('disabled', 'disabled');
    spinner?.classList.remove('d-none');
    icon?.classList.add('d-none');

    try {
      const invoiceImageUrls = [];
      for (const file of files) {
        const imageUrl = await uploadImageToStorage(file, 'inventario/facturas');
        if (imageUrl) invoiceImageUrls.push(imageUrl);
      }

      const qtyKg = Number(convertToKg(qty, unit).toFixed(4));
      const lotNumber = buildLotNumber({
        lotConfig: {
          configured: state.editorDraft.tokens.length > 0,
          tokens: [...state.editorDraft.tokens],
          customAcronym: normalizeValue(state.editorDraft.customAcronym),
          includeSeparator: Boolean(state.editorDraft.includeSeparator),
          separator: normalizeValue(state.editorDraft.separator) || '-'
        },
        invoiceNumber,
        entryDate
      });

      const entry = {
        id: makeId('entry'),
        qty: Number(qty.toFixed(2)),
        unit,
        qtyKg,
        availableQty: Number(qty.toFixed(2)),
        availableKg: qtyKg,
        productionUsage: [],
        entryDate,
        expiryDate,
        invoiceNumber,
        lotNumber,
        provider,
        lotStatus: 'disponible',
        invoiceImageUrl: invoiceImageUrls[0] || '',
        invoiceImageUrls,
        createdAt: Date.now()
      };

      record.entries = Array.isArray(record.entries) ? record.entries : [];
      record.entries.unshift(entry);
      record.stockKg = Number(((Number(record.stockKg) || 0) + qtyKg).toFixed(4));
      record.hasEntries = true;
      record.lotConfig = {
        configured: state.editorDraft.tokens.length > 0,
        collapsed: state.editorDraft.tokens.length > 0,
        tokens: [...state.editorDraft.tokens],
        customAcronym: normalizeValue(state.editorDraft.customAcronym),
        includeSeparator: Boolean(state.editorDraft.includeSeparator),
        separator: normalizeValue(state.editorDraft.separator) || '-'
      };

      state.inventario.items[ingredientId] = record;
      rebuildInventarioIndexes();
      await persistInventario();
      state.editorDirty = false;
      state.tablePage = 1;
      renderEditor(ingredientId, {
        ...state.editorDraft,
        qty: '',
        invoiceNumber: '',
        provider: '',
        invoiceImageCountLabel: 'Sin imágenes seleccionadas',
        expiryDate: addDaysToIso(getArgentinaIsoDate(), 5),
        entryDate: getArgentinaIsoDate()
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
    inventarioModal.setAttribute('inert', '');
    try {
      await window.laJamoneraIngredientesAPI?.openIngredientForm?.();
    } finally {
      inventarioModal.removeAttribute('inert');
    }
    await loadData();
    setStateView(Object.keys(state.ingredientes).length ? 'list' : 'empty');
    renderFamilies();
    renderList();
  };

  const onListClick = async (event) => {
    const statusBtn = event.target.closest('[data-inv-status-filter]');
    if (statusBtn) {
      state.activeStockStatus = statusBtn.dataset.invStatusFilter;
      renderStatusFilters();
      renderList();
      return;
    }

    const familyBtn = event.target.closest('[data-inv-family-filter]');
    if (familyBtn) {
      state.activeFamilyId = familyBtn.dataset.invFamilyFilter;
      renderFamilies();
      renderStatusFilters();
      renderList();
      return;
    }

    const editorBtn = event.target.closest('[data-inventario-open-editor]');
    if (editorBtn) {
      state.tablePage = 1;
      state.tableSearch = '';
      renderEditor(editorBtn.dataset.inventarioOpenEditor);
      return;
    }

    const thresholdBtn = event.target.closest('[data-inventario-config-item]');
    if (thresholdBtn) {
      await openProductThresholdConfig(thresholdBtn.dataset.inventarioConfigItem);
    }
  };


  const setPeriodMode = (enabled) => {
    state.periodMode = enabled;
    nodes.searchInput?.closest('.inventario-toolbar')?.classList.toggle('d-none', enabled);
    nodes.families?.classList.toggle('d-none', enabled);
    nodes.statusFilters?.classList.toggle('d-none', enabled);
    nodes.list?.classList.toggle('d-none', enabled);
    nodes.periodView?.classList.toggle('d-none', !enabled);
    if (enabled) {
      nodes.globalClearBtn?.classList.toggle('d-none', !state.dashboardDateRange);
    }
  };

  const loadInventario = async () => {
    setStateView('loading');
    try {
      await loadData();
      if (!Object.keys(state.ingredientes).length) {
        setStateView('empty');
        return;
      }
      setStateView('list');
      setPeriodMode(false);
      if (state.resumeEditor?.ingredientId && state.ingredientes[state.resumeEditor.ingredientId]) {
        renderEditor(state.resumeEditor.ingredientId, state.resumeEditor.draft || null);
      } else {
        renderFamilies();
        renderStatusFilters();
        renderList();
      }
      if (window.flatpickr) {
        const locale = window.flatpickr.l10ns?.es || undefined;
        const dayMapGlobal = getDayKgMap(getGlobalFilteredEntries(true));
        window.flatpickr(nodes.globalRange, {
          locale,
          mode: 'range',
          dateFormat: 'Y-m-d',
          allowInput: true,
          defaultDate: getDefaultRangeDates(state.dashboardDateRange),
          onDayCreate: (_dObj, _dStr, fp, dayElem) => {
            const date = dayElem.dateObj ? getArgentinaIsoDate(dayElem.dateObj) : '';
            const kg = dayMapGlobal[date];
            if (kg) {
              const bubble = document.createElement('span');
              bubble.className = 'inventario-day-kg';
              bubble.textContent = `${Number(kg || 0).toFixed(2)}kg`;
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
      setStateView('empty');
      await openIosSwal({ title: 'No se pudo cargar', html: '<p>Error leyendo inventario desde Firebase.</p>', icon: 'error', confirmButtonText: 'Entendido' });
    }
  };

  nodes.searchInput?.addEventListener('input', (event) => {
    state.search = normalizeLower(event.target.value);
    renderList();
  });
  nodes.list?.addEventListener('click', onListClick);
  nodes.families?.addEventListener('click', onListClick);
  nodes.statusFilters?.addEventListener('click', onListClick);
  nodes.list?.addEventListener('scroll', updateListScrollHint);
  nodes.configBtn?.addEventListener('click', openGlobalConfig);
  nodes.createIngredientBtn?.addEventListener('click', openCreateIngredient);
  nodes.toolbarCreateBtn?.addEventListener('click', openCreateIngredient);
  nodes.backBtn?.addEventListener('click', backToList);
  nodes.editorForm?.addEventListener('submit', saveEntry);

  nodes.openPeriodFilterBtn?.addEventListener('click', () => {
    state.globalTablePage = 1;
    renderGlobalPeriodTable();
    setPeriodMode(true);
  });
  nodes.periodBackBtn?.addEventListener('click', () => {
    setPeriodMode(false);
  });
  nodes.globalApplyBtn?.addEventListener('click', async () => {
    state.dashboardDateRange = normalizeValue(nodes.globalRange?.value);
    nodes.globalClearBtn?.classList.toggle('d-none', !state.dashboardDateRange);
    state.globalTablePage = 1;
    nodes.globalLoading?.classList.remove('d-none');
    nodes.globalTableWrap?.classList.add('d-none');
    await new Promise((resolve) => setTimeout(resolve, 450));
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
    const rows = getGlobalFilteredEntries();
    const htmlRows = rows.length ? rows.map((row, index) => `<tr class="inventario-row-tone ${index % 2 === 0 ? 'is-even-row' : 'is-odd-row'}"><td>${escapeHtml(row.entryDateTime)}</td><td>${escapeHtml(row.ingredientName)}</td><td>${row.qtyKg.toFixed(2)} kg</td><td>${row.qty.toFixed(2)} ${escapeHtml(row.unit)}</td><td>${escapeHtml(row.invoiceNumber)}</td><td class="inventario-provider-cell">${escapeHtml(row.provider)}</td><td>${buildExpandedImageCell(row.invoiceImageUrls)}</td></tr>`).join('') : '<tr><td colspan="7" class="text-center">Sin ingresos en ese rango.</td></tr>';
    await openExpandedTable('Ingresos por período (ampliado)', `<div class="table-responsive inventario-table-compact-wrap"><table class="table recipe-table inventario-table-compact mb-0"><thead><tr><th>Fecha y hora</th><th>Producto</th><th>Kilos</th><th>Cantidad</th><th>N° factura</th><th>Proveedor</th><th>Imagen</th></tr></thead><tbody>${htmlRows}</tbody></table></div>`);
  });

  nodes.globalPrintBtn?.addEventListener('click', async () => {
    await openPrintGlobalPeriod(getGlobalFilteredEntries());
  });
  nodes.globalExcelBtn?.addEventListener('click', async () => {
    const rows = getGlobalFilteredEntries();
    const payload = rows.flatMap((row) => {
      const main = {
        'Fecha y hora': row.entryDateTime,
        Producto: row.ingredientName,
        Kilos: `${row.qtyKg.toFixed(2)} kg`,
        Cantidad: `${row.qty.toFixed(2)} ${row.unit}`,
        'N° factura': row.invoiceNumber,
        Proveedor: row.provider,
        Imágenes: row.invoiceImageUrls.length ? row.invoiceImageUrls.map((_, index) => `LINK ${index + 1}`).join(', ') : '-',
        __firstImage: row.invoiceImageUrls[0] || '',
        __tone: 'normal'
      };
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
      return [main, ...traces];
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
        state.globalEntryCollapse[entryId] = !state.globalEntryCollapse[entryId];
        renderGlobalPeriodTable();
      }
      return;
    }

    if (event.target.closest('#inventarioGlobalCollapseAllRowsBtn')) {
      getGlobalFilteredEntries().forEach((row) => {
        if (getEntryTraceRows(row).length) state.globalEntryCollapse[row.entryId] = true;
      });
      renderGlobalPeriodTable();
      return;
    }

    if (event.target.closest('#inventarioGlobalExpandAllRowsBtn')) {
      getGlobalFilteredEntries().forEach((row) => {
        if (getEntryTraceRows(row).length) state.globalEntryCollapse[row.entryId] = false;
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
    setViewerScale(1);
    renderViewerImage();
  });
  nodes.viewerNextBtn?.addEventListener('click', () => {
    if (!state.viewerImages.length) return;
    state.viewerIndex = (state.viewerIndex + 1) % state.viewerImages.length;
    setViewerScale(1);
    renderViewerImage();
  });
  nodes.viewerZoomInBtn?.addEventListener('click', () => setViewerScale(state.viewerScale + 0.25));
  nodes.viewerZoomOutBtn?.addEventListener('click', () => setViewerScale(state.viewerScale - 0.25));
  nodes.viewerBackBtn?.addEventListener('click', () => imageViewerModal?.hide());
  nodes.viewerImage?.addEventListener('load', () => {
    nodes.viewerImage.classList.add('is-loaded');
    nodes.viewerStageSpinner?.classList.add('d-none');
  });
  nodes.viewerImage?.addEventListener('error', () => {
    nodes.viewerStageSpinner?.classList.add('d-none');
  });

  inventarioModal.addEventListener('hide.bs.modal', snapshotEditorDraft);
  inventarioModal.addEventListener('hidden.bs.modal', () => inventarioModal.removeAttribute('inert'));
  nodes.imageViewerModal?.addEventListener('hidden.bs.modal', () => {
    document.querySelectorAll('.modal-backdrop.inventory-image-backdrop').forEach((backdrop) => backdrop.classList.remove('inventory-image-backdrop'));
  });
  inventarioModal.addEventListener('show.bs.modal', loadInventario);
})();
