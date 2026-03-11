(function produccionModule() {
  const produccionModal = document.getElementById('produccionModal');
  if (!produccionModal) return;
  const nodes = {
    loading: document.getElementById('produccionLoading'),
    empty: document.getElementById('produccionEmpty'),
    data: document.getElementById('produccionData'),
    list: document.getElementById('produccionList'),
    editor: document.getElementById('produccionEditor'),
    search: document.getElementById('produccionSearchInput'),
    historyView: document.getElementById('produccionPeriodView'),
    historyBackBtn: document.getElementById('produccionPeriodBackBtn'),
    historySearch: document.getElementById('produccionGlobalSearch'),
    historyRange: document.getElementById('produccionGlobalRange'),
    historyApplyBtn: document.getElementById('produccionGlobalApplyBtn'),
    historyClearBtn: document.getElementById('produccionGlobalClearBtn'),
    historyExpandBtn: document.getElementById('produccionGlobalExpandBtn'),
    historyExcelBtn: document.getElementById('produccionGlobalExcelBtn'),
    historyPrintBtn: document.getElementById('produccionGlobalPrintBtn'),
    historyMassPlanillasBtn: document.getElementById('produccionGlobalMassPlanillasBtn'),
    historyWeeklyPlanillaBtn: document.getElementById('produccionGlobalWeeklyPlanillaBtn'),
    historyLoading: document.getElementById('produccionGlobalLoading'),
    historyTableWrap: document.getElementById('produccionGlobalTableWrap'),
    dispatchBtn: document.getElementById('produccionDispatchBtn'),
    dispatchView: document.getElementById('produccionDispatchView'),
    rneAlert: document.getElementById('produccionRneAlert'),
    modalTitle: document.getElementById('produccionModalLabel')
  };
  const FIAMBRES_IMAGE = 'https://i.postimg.cc/fyvNDdrt/FIambres.png';
  const BASE_ICON = '<i class="fa-solid fa-drumstick-bite"></i>';
  const CONFIG_PATH = '/produccion/config';
  const RESERVAS_PATH = '/produccion/reservas';
  const DRAFTS_PATH = '/produccion/drafts';
  const REGISTROS_PATH = '/produccion/registros';
  const SEQUENCE_PATH = '/produccion/sequence';
  const REPARTO_PATH = '/Reparto';
  const LEGACY_REPARTO_PATH = '/REPARTO';
  const AUDIT_PATH = '/produccion/auditoria';
  const RESERVE_TTL_MS = 10 * 60 * 1000;
  const ALLOWED_UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const ALLOWED_RNE_UPLOAD_TYPES = [...ALLOWED_UPLOAD_TYPES, 'application/pdf'];
  const MAX_UPLOAD_SIZE_BYTES = 5 * 1024 * 1024;
  const QR_PRINT_SIZES = [
    { value: '80x40', label: '8cm x 4cm (80 x 40 mm)', widthMm: 80, heightMm: 40 },
    { value: '50x25', label: '5cm x 2.5cm (50 x 25 mm)', widthMm: 50, heightMm: 25 },
    { value: '80x25', label: '8cm x 2.5cm (80 x 25 mm)', widthMm: 80, heightMm: 25 },
    { value: '100x35', label: '10cm x 3.5cm (100 x 35 mm)', widthMm: 100, heightMm: 35 }
  ];
  const ROSARIO_DEPT_LOCALITIES = ['Rosario', 'Villa Gobernador Gálvez', 'Pérez', 'Funes', 'Roldán', 'Ibarlucea', 'Alvear', 'Pueblo Esther', 'General Lagos', 'Arroyo Seco', 'Piñero'];
  const state = {
    recetas: {},
    ingredientes: {},
    inventario: {},
    users: {},
    reservas: {},
    drafts: {},
    registros: {},
    search: '',
    view: 'loading',
    analysis: {},
    activeRecipeId: '',
    activeDraftId: '',
    activeReservationId: '',
    reservationTick: null,
    draftsTick: null,
    editorPlan: null,
    pendingExpiryActions: {},
    lotCollapseState: {},
    historyMode: false,
    dispatchMode: false,
    dispatchCreateMode: false,
    historySearch: '',
    historyRange: '',
    historyPage: 1,
    historyTraceCollapse: {},
    dispatchSearch: '',
    dispatchRange: '',
    dispatchPage: 1,
    dispatchCollapse: {},
    dispatchDraft: null,
    reparto: {
      registros: {},
      sequenceByDate: {},
      clients: {},
      vehicles: {},
      localities: [...ROSARIO_DEPT_LOCALITIES]
    },
    config: {
      globalMinKg: 1,
      recipeMinKg: {},
      lastProductionByRecipe: {},
      preferredManagers: [],
      preferredManagersByRecipe: {},
      usersPreferences: {},
      idConfig: { prefix: 'PROD-LJ' },
      companyLogoUrl: '',
      rne: { number: '', expiryDate: '', attachmentUrl: '', attachmentType: '', validFrom: '', updatedAt: 0, history: [] }
    }
  };
  const safeObject = (value) => (value && typeof value === 'object' ? value : {});
  const normalizeValue = (value) => String(value || '').trim();
  const normalizeLower = (value) => normalizeValue(value).toLowerCase();
  const normalizeUpper = (value) => normalizeValue(value).toUpperCase();
  const ARG_PROVINCIAS = ['Buenos Aires', 'CABA', 'Catamarca', 'Chaco', 'Chubut', 'Córdoba', 'Corrientes', 'Entre Ríos', 'Formosa', 'Jujuy', 'La Pampa', 'La Rioja', 'Mendoza', 'Misiones', 'Neuquén', 'Río Negro', 'Salta', 'San Juan', 'San Luis', 'Santa Cruz', 'Santa Fe', 'Santiago del Estero', 'Tierra del Fuego', 'Tucumán'];
  const COMPANY_LEGAL_NAME = 'FRIGORIFICO LA JAMONERA SA';
  const normalizeDispatchStore = (source = {}) => ({
    registros: safeObject(source?.registros),
    sequenceByDate: safeObject(source?.sequenceByDate),
    clients: safeObject(source?.clients),
    vehicles: safeObject(source?.vehicles),
    productIndex: safeObject(source?.productIndex),
    localities: [...new Set([...(Array.isArray(source?.localities) ? source.localities : []), ...ROSARIO_DEPT_LOCALITIES].map((item) => normalizeValue(item)).filter(Boolean))]
  });
  const getWeekStartIso = (dateLike = nowTs()) => {
    const date = new Date(dateLike);
    if (Number.isNaN(date.getTime())) return toIsoDate();
    const day = date.getDay();
    const diff = (day + 6) % 7;
    date.setDate(date.getDate() - diff);
    return toIsoDate(date.getTime());
  };
  const toFiniteKg = (value) => {
    const n = Number(value || 0);
    return Number.isFinite(n) ? Number(n.toFixed(3)) : 0;
  };
  const getRecipeProductIndex = (recipeId) => {
    const id = normalizeValue(recipeId);
    if (!id) return null;
    if (!state.reparto.productIndex || typeof state.reparto.productIndex !== 'object') state.reparto.productIndex = {};
    if (!state.reparto.productIndex[id]) {
      state.reparto.productIndex[id] = {
        availableKg: 0,
        updatedAt: 0,
        weeklyOutByWeek: {},
        movements: {}
      };
    }
    const current = safeObject(state.reparto.productIndex[id]);
    current.weeklyOutByWeek = safeObject(current.weeklyOutByWeek);
    current.movements = safeObject(current.movements);
    state.reparto.productIndex[id] = current;
    return current;
  };
  const compactRecipeMovements = (entry) => {
    const movements = Object.values(safeObject(entry?.movements));
    if (movements.length <= 2000) return;
    const next = movements.sort((a, b) => Number(b.at || 0) - Number(a.at || 0)).slice(0, 2000)
      .reduce((acc, move) => {
        const key = normalizeValue(move.id) || makeId('prod_move');
        acc[key] = move;
        return acc;
      }, {});
    entry.movements = next;
  };
  const appendRecipeMovement = (recipeId, movement = {}) => {
    const entry = getRecipeProductIndex(recipeId);
    if (!entry) return;
    const moveId = normalizeValue(movement.id) || makeId('prod_move');
    const type = normalizeValue(movement.type) === 'egreso' ? 'egreso' : 'ingreso';
    const qtyKg = toFiniteKg(movement.qtyKg);
    const at = Number(movement.at || nowTs());
    entry.movements[moveId] = {
      id: moveId,
      type,
      qtyKg,
      at,
      label: normalizeValue(movement.label),
      sourceId: normalizeValue(movement.sourceId),
      sourceCode: normalizeValue(movement.sourceCode),
      date: normalizeValue(movement.date),
      reason: normalizeValue(movement.reason),
      nonTraceable: Boolean(movement.nonTraceable),
      lotNumber: normalizeValue(movement.lotNumber),
      expiryDate: normalizeValue(movement.expiryDate)
    };
    entry.availableKg = toFiniteKg(type === 'egreso' ? Math.max(0, Number(entry.availableKg || 0) - qtyKg) : Number(entry.availableKg || 0) + qtyKg);
    if (type === 'egreso') {
      const week = getWeekStartIso(at);
      entry.weeklyOutByWeek[week] = toFiniteKg(Number(entry.weeklyOutByWeek[week] || 0) + qtyKg);
    }
    entry.updatedAt = nowTs();
    compactRecipeMovements(entry);
  };
  const getLastWeekOutFromIndex = (recipeId) => {
    const entry = safeObject(state.reparto?.productIndex?.[recipeId]);
    const now = Date.now();
    const weekAgo = now - (7 * 24 * 60 * 60 * 1000);
    return Number(Object.entries(safeObject(entry.weeklyOutByWeek)).reduce((acc, [weekIso, qty]) => {
      const weekTs = Number(new Date(`${weekIso}T00:00:00`).getTime());
      if (!Number.isFinite(weekTs) || weekTs < weekAgo) return acc;
      return acc + Number(qty || 0);
    }, 0).toFixed(3));
  };
  const getProvidersCatalog = () => (Array.isArray(state.inventario?.config?.providers) ? state.inventario.config.providers : []);
  const normalizeRneRecord = (source = {}) => ({
    number: normalizeValue(source?.number),
    expiryDate: normalizeValue(source?.expiryDate),
    infiniteExpiry: Boolean(source?.infiniteExpiry),
    attachmentUrl: normalizeValue(source?.attachmentUrl),
    attachmentType: normalizeValue(source?.attachmentType),
    validFrom: normalizeValue(source?.validFrom),
    updatedAt: Number(source?.updatedAt || 0)
  });
  const findProviderFromTraceValue = (value) => {
    const source = normalizeValue(value);
    if (!source) return null;
    const providers = getProvidersCatalog();
    return providers.find((provider) => {
      const byId = normalizeValue(provider?.id);
      const byName = normalizeUpper(provider?.name);
      return source === byId || normalizeUpper(source) === byName;
    }) || null;
  };
  const resolveProviderRneFromLot = (lot = {}) => {
    const persisted = normalizeRneRecord(safeObject(lot.providerRne));
    if (persisted.number || persisted.attachmentUrl) return persisted;
    const provider = findProviderFromTraceValue(lot.provider);
    if (!provider) return normalizeRneRecord();
    return normalizeRneRecord(safeObject(provider.rne));
  };
  const resolveRecipeRnpaFromRegistro = (registro = {}) => {
    const persisted = safeObject(registro?.traceability?.product?.rnpa);
    const recipe = safeObject(state.recetas?.[registro?.recipeId]);
    const fallback = safeObject(recipe?.rnpa);
    const source = Object.keys(persisted).length ? persisted : fallback;
    return {
      number: normalizeValue(source?.number),
      denomination: normalizeValue(source?.denomination),
      brand: normalizeValue(source?.brand),
      businessName: normalizeValue(source?.businessName),
      expiryDate: normalizeValue(source?.expiryDate),
      attachmentUrl: normalizeValue(source?.attachmentUrl),
      attachmentType: normalizeValue(source?.attachmentType),
      attachmentName: normalizeValue(source?.attachmentName)
    };
  };
  const resolveCompanyRneFromRegistro = (registro = {}) => {
    const persisted = normalizeRneRecord(safeObject(registro?.traceability?.company?.rne));
    if (persisted.number || persisted.attachmentUrl) return persisted;
    return normalizeRneRecord(safeObject(state.config?.rne));
  };
  const enrichIngredientPlansWithSnapshots = (ingredientPlans = []) => (Array.isArray(ingredientPlans) ? ingredientPlans : []).map((ingredientPlan) => ({
    ...ingredientPlan,
    lots: (Array.isArray(ingredientPlan?.lots) ? ingredientPlan.lots : []).map((lot) => ({
      ...lot,
      providerRne: normalizeRneRecord(safeObject(lot?.providerRne?.number || lot?.providerRne?.attachmentUrl ? lot.providerRne : findProviderFromTraceValue(lot?.provider)?.rne))
    }))
  }));
  const capitalize = (value) => normalizeLower(value).replace(/(^|\s)\S/g, (ch) => ch.toUpperCase());
  const parseNumber = (value) => {
    const parsed = Number(normalizeValue(value).replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  };
  const isEntryNoPerecedero = (entry) => Boolean(entry?.noPerecedero);
  const disableCalendarSuggestions = (input) => {
    if (!input) return;
    input.setAttribute('autocomplete', 'new-password');
    input.setAttribute('autocapitalize', 'off');
    input.setAttribute('autocorrect', 'off');
    input.setAttribute('spellcheck', 'false');
    input.setAttribute('inputmode', 'none');
    input.setAttribute('readonly', 'readonly');
  };
  const parsePositive = (value, fallback = 1) => {
    const n = parseNumber(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  const makeId = (prefix) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const nowTs = () => Date.now();
  const sessionId = (() => {
    const key = 'laJamoneraProduccionSessionId';
    const current = normalizeValue(localStorage.getItem(key));
    if (current) return current;
    const next = makeId('prod_session');
    localStorage.setItem(key, next);
    return next;
  })();
  const getCurrentUserLabel = () => 'La Jamonera';
  const getUnitMeta = (unitRaw) => {
    const unit = normalizeLower(unitRaw);
    const massMap = {
      kg: 1000, kilo: 1000, kilos: 1000, kilogramo: 1000, kilogramos: 1000,
      g: 1, gr: 1, gramo: 1, gramos: 1,
      mg: 0.001, miligramo: 0.001, miligramos: 0.001,
      oz: 28.3495, onza: 28.3495, onzas: 28.3495,
      cda: 15, cucharada: 15, cucharadas: 15,
      cdita: 5, cucharadita: 5, cucharaditas: 5,
      pzc: 0.5, pizca: 0.5, pizcas: 0.5
    };
    const volumeMap = {
      l: 1000, lt: 1000, litro: 1000, litros: 1000,
      ml: 1, mililitro: 1, mililitros: 1, cc: 1,
      gota: 0.05, gotas: 0.05, gts: 0.05
    };
    if (massMap[unit]) return { category: 'peso', factor: massMap[unit], label: unit || 'g' };
    if (volumeMap[unit]) return { category: 'volumen', factor: volumeMap[unit], label: unit || 'ml' };
    if (['u', 'un', 'unidad', 'unidades'].includes(unit)) return { category: 'unidad', factor: 1, label: 'unidad' };
    if (['paquete', 'paquetes', 'pack', 'packs'].includes(unit)) return { category: 'paquete', factor: 1, label: 'paquete' };
    return { category: 'otro', factor: 1, label: unit || 'otro' };
  };
  const toBase = (qty, unit) => {
    const meta = getUnitMeta(unit);
    const amount = parseNumber(qty);
    if (!Number.isFinite(amount)) return Number.NaN;
    return amount * meta.factor;
  };
  const fromBase = (baseQty, unit) => {
    const meta = getUnitMeta(unit);
    return Number(baseQty || 0) / (meta.factor || 1);
  };
  const getEntryAvailableQty = (entry) => {
    const available = parseNumber(entry?.availableQty);
    const entryId = normalizeValue(entry?.id);
    const pendingQtyKg = Number(state.pendingExpiryActions?.[entryId]?.qtyKg || 0);
    const sourceAvailableKg = Number(entry?.availableKg);
    if (Number.isFinite(available) && available >= 0) {
      if (Number.isFinite(sourceAvailableKg) && sourceAvailableKg > 0 && pendingQtyKg > 0) {
        const ratio = Math.max(0, Math.min(1, pendingQtyKg / sourceAvailableKg));
        return Math.max(0, available - (available * ratio));
      }
      return available;
    }
    const qty = parseNumber(entry?.qty);
    if (!(Number.isFinite(qty) && qty > 0)) return 0;
    if (Number.isFinite(sourceAvailableKg) && sourceAvailableKg > 0 && pendingQtyKg > 0) {
      const ratio = Math.max(0, Math.min(1, pendingQtyKg / sourceAvailableKg));
      return Math.max(0, qty - (qty * ratio));
    }
    return qty;
  };
  const getEntryAvailableKg = (entry) => {
    const availableKg = Number(entry?.availableKg);
    const entryId = normalizeValue(entry?.id);
    const pendingQtyKg = Number(state.pendingExpiryActions?.[entryId]?.qtyKg || 0);
    if (Number.isFinite(availableKg) && availableKg >= 0) return Math.max(0, availableKg - pendingQtyKg);
    const availableQty = getEntryAvailableQty(entry);
    const base = toBase(availableQty, entry?.unit);
    return Number.isFinite(base) ? Number((base / 1000).toFixed(4)) : 0;
  };
  const formatQty = (value, unit = '', digits = 2) => `${Number(value || 0).toFixed(digits)} ${unit}`.trim();
  const formatCompactQty = (value, unit = '') => {
    const amount = Number(value || 0);
    if (!Number.isFinite(amount)) return formatQty(0, unit, 2);
    const digits = amount >= 10 ? 2 : 3;
    return `${amount.toFixed(digits)} ${unit}`.trim();
  };
  const getIngredientPlanQtyKg = (item = {}) => {
    const qty = Number(item?.requiredQty ?? item?.neededQty ?? 0);
    const unit = normalizeValue(item?.unit || item?.ingredientUnit);
    const base = toBase(qty, unit);
    if (!Number.isFinite(base)) return 0;
    return Number((base / 1000).toFixed(6));
  };
  const toIsoDate = (value = nowTs()) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toISOString().slice(0, 10);
  };
  const getArgentinaIsoDate = (dateObj) => {
    if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) return '';
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Argentina/Buenos_Aires',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(dateObj);
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${map.year}-${map.month}-${map.day}`;
  };
  const getProductionDayMap = () => getRegistrosList().reduce((acc, item) => {
    const iso = getArgentinaIsoDate(new Date(Number(item?.createdAt || 0)));
    if (iso) acc[iso] = (acc[iso] || 0) + 1;
    return acc;
  }, {});
  const getProductionKgDayMap = (rows = []) => (Array.isArray(rows) ? rows : []).reduce((acc, item) => {
    const iso = getArgentinaIsoDate(new Date(Number(item?.createdAt || 0)));
    if (!iso) return acc;
    acc[iso] = Number((Number(acc[iso] || 0) + Number(item?.quantityKg || 0)).toFixed(3));
    return acc;
  }, {});
  const formatDate = (value) => {
    if (!value) return 'Nunca producida';
    const d = new Date(Number(value));
    if (Number.isNaN(d.getTime())) return 'Nunca producida';
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };
  const formatDateTime = (value) => {
    const d = new Date(Number(value));
    if (Number.isNaN(d.getTime())) return '-';
    return d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };
  const formatExpiryHuman = (value) => {
    const raw = normalizeValue(value);
    if (!raw) return '-';
    if (normalizeLower(raw) === 'no perecedero') return 'No perecedero';
    return formatIsoEs(raw) || raw;
  };
  const formatIsoToDmyCompact = (iso) => {
    const text = normalizeValue(iso);
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (!match) return text.replaceAll('-', '');
    return `${match[3]}${match[2]}${match[1]}`;
  };
  const formatIsoEs = (iso) => {
    const text = normalizeValue(iso);
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (!match) return text || 'Sin VTO';
    return `${match[3]}-${match[2]}-${match[1]}`;
  };
  const hasPlanillaDisponible = (registro) => Number(registro?.planillaVersion || 0) >= 1;
  const getPublicTraceUrlForProduction = (productionId) => `https://www.lajamonera.online/${encodeURIComponent(normalizeValue(productionId))}`;
  const formatValidProductionRange = (entryDate, expiryDate) => {
    const from = formatIsoEs(normalizeValue(entryDate));
    const to = formatIsoEs(normalizeValue(expiryDate));
    if (!normalizeValue(entryDate) || !normalizeValue(expiryDate)) return '';
    return `(producible entre ${from} y ${to})`;
  };
  const addDaysToIso = (isoDate, days) => {
    const text = normalizeValue(isoDate);
    if (!text) return '';
    const utc = new Date(`${text}T00:00:00Z`);
    if (Number.isNaN(utc.getTime())) return '';
    utc.setUTCDate(utc.getUTCDate() + Number(days || 0));
    return utc.toISOString().slice(0, 10);
  };
  const diffDays = (fromIso, toIso) => {
    const from = normalizeValue(fromIso);
    const to = normalizeValue(toIso);
    if (!from || !to) return Number.NaN;
    const fromDate = new Date(`${from}T00:00:00Z`);
    const toDate = new Date(`${to}T00:00:00Z`);
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) return Number.NaN;
    return Math.round((fromDate.getTime() - toDate.getTime()) / 86400000);
  };
  const moveIsoFromSunday = (isoDate) => {
    const text = normalizeValue(isoDate);
    if (!text) return '';
    const cursor = new Date(`${text}T00:00:00Z`);
    if (Number.isNaN(cursor.getTime())) return '';
    while (cursor.getUTCDay() === 0) {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return cursor.toISOString().slice(0, 10);
  };
  const resolvePackagingFromRegistro = (registro) => {
    const persisted = normalizeValue(registro?.packagingDate);
    const persistedAging = Number(registro?.agingDaysAtProduction);
    if (persisted && Number.isFinite(persistedAging) && persistedAging > 0) {
      return { agingDays: persistedAging, packagingDate: persisted };
    }
    const recipe = state.recetas?.[registro?.recipeId] || {};
    const agingDays = Number(registro?.agingDaysAtProduction ?? recipe?.agingDays);
    if (!Number.isFinite(agingDays) || agingDays <= 0) return { agingDays: 0, packagingDate: '' };
    const baseDate = toIsoDate(registro?.createdAt || nowTs());
    if (!baseDate) return { agingDays, packagingDate: '' };
    const computed = addDaysToIso(baseDate, agingDays);
    return { agingDays, packagingDate: moveIsoFromSunday(computed) };
  };
  const resolveProductExpiryIso = (registro) => {
    const persisted = normalizeValue(registro?.productExpiryDate);
    if (persisted) return persisted;
    const recipe = state.recetas?.[registro?.recipeId] || {};
    const productionDate = normalizeValue(registro?.productionDate) || toIsoDate(registro?.createdAt || nowTs());
    const shelfLifeDays = Number(registro?.shelfLifeDaysAtProduction ?? recipe?.shelfLifeDays);
    if (!Number.isFinite(shelfLifeDays) || shelfLifeDays <= 0 || !productionDate) return '';
    return addDaysToIso(productionDate, shelfLifeDays);
  };
  const formatProductExpiryLabel = (registro) => {
    const expiryIso = resolveProductExpiryIso(registro);
    if (!expiryIso) return 'Sin VTO';
    return formatIsoEs(expiryIso);
  };
  const escapeHtml = (value) => String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
  const sanitizeImageUrl = (value) => {
    const url = normalizeValue(value);
    if (!url) return '';
    if (/^(https?:)?\/\//i.test(url) || /^data:image\//i.test(url)) return url;
    return '';
  };
  const deepClone = (value) => JSON.parse(JSON.stringify(value || {}));
  const getRegistrosList = () => Object.values(safeObject(state.registros));
  const getRegistroById = (key) => safeObject(state.registros?.[key]);
  const getGeneralPassword = async () => {
    await window.laJamoneraReady;
    const value = await window.dbLaJamoneraRest.read('/passGeneral/pass');
    return normalizeValue(value);
  };
  const askSensitivePassword = async (title, html, withReason = false) => {
    const result = await openIosSwal({
      title,
      html: `<div class="swal-stack-fields"><input id="produccionSecurePass" type="password" class="swal2-input ios-input" placeholder="Clave general" autocomplete="new-password" name="produccion-secure-pass" autocapitalize="off" autocorrect="off" spellcheck="false">${withReason ? '<textarea id="produccionSecureReason" class="swal2-textarea ios-input" placeholder="Motivo"></textarea>' : ''}${html || ''}</div>`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Validar',
      cancelButtonText: 'Cancelar',
      customClass: { popup: 'produccion-secure-alert', confirmButton: 'ios-btn ios-btn-primary', cancelButton: 'ios-btn ios-btn-secondary' },
      didOpen: () => {
        const passNode = document.getElementById('produccionSecurePass');
        if (passNode) {
          passNode.value = '';
          passNode.setAttribute('readonly', 'readonly');
          setTimeout(() => passNode.removeAttribute('readonly'), 60);
          passNode.focus({ preventScroll: true });
        }
      },
      preConfirm: async () => {
        const entered = normalizeValue(document.getElementById('produccionSecurePass')?.value);
        const remote = await getGeneralPassword();
        if (!entered || !remote || entered !== remote) {
          Swal.showValidationMessage('Clave incorrecta.');
          return false;
        }
        const reason = normalizeValue(document.getElementById('produccionSecureReason')?.value);
        if (withReason && !reason) {
          Swal.showValidationMessage('Ingresá un motivo.');
          return false;
        }
        return { reason };
      }
    });
    return result;
  };
  const appendAudit = async ({ action, productionId = '', before = null, after = null, reason = '' }) => {
    const existing = safeObject(await window.dbLaJamoneraRest.read(AUDIT_PATH));
    const id = makeId('audit');
    existing[id] = {
      id,
      action,
      productionId,
      user: getCurrentUserLabel(),
      reason: normalizeValue(reason),
      createdAt: nowTs(),
      before,
      after
    };
    await window.dbLaJamoneraRest.write(AUDIT_PATH, existing);
  };
  const updateEntryMovement = (entry, movement) => {
    const next = { ...entry };
    next.movementHistory = Array.isArray(next.movementHistory) ? next.movementHistory : [];
    next.movementHistory.unshift(movement);
    return next;
  };
  const usageToBaseQty = (usage = {}, fallbackUnit = 'kilos') => {
    const usedQty = Number(usage?.usedQty);
    const usedUnit = normalizeValue(usage?.usedUnit) || fallbackUnit;
    if (Number.isFinite(usedQty) && usedQty > 0) {
      const baseQty = toBase(usedQty, usedUnit);
      if (Number.isFinite(baseQty) && baseQty > 0) return baseQty;
    }
    const kilosUsed = Number(usage?.kilosUsed);
    if (Number.isFinite(kilosUsed) && kilosUsed > 0) return kilosUsed * 1000;
    return 0;
  };
  const applyPlanOnInventory = (inventorySource, plan, productionId, productionDate, mode = 'consume') => {
    const inventoryNext = safeObject(inventorySource);
    plan.ingredientPlans.forEach((item) => {
      const record = safeObject(inventoryNext.items?.[item.ingredientId]);
      const nextEntries = Array.isArray(record.entries) ? [...record.entries] : [];
      item.lots.forEach((lot) => {
        const index = nextEntries.findIndex((entry) => entry.id === lot.entryId);
        if (index === -1) return;
        const entry = { ...nextEntries[index] };
        const entryUnit = normalizeValue(entry.unit || lot.unit || item.ingredientUnit || 'kilos') || 'kilos';
        const fullQty = parseNumber(entry?.qty);
        const maxQty = Number.isFinite(fullQty) && fullQty > 0 ? fullQty : Number.POSITIVE_INFINITY;
        const currentAvailableQty = getEntryAvailableQty(entry);
        entry.productionUsage = Array.isArray(entry.productionUsage) ? [...entry.productionUsage] : [];
        let safeAmount = 0;
        if (mode === 'restore') {
          const keepUsages = [];
          let restoreBaseQty = 0;
          entry.productionUsage.forEach((usage) => {
            if (normalizeValue(usage?.productionId) === normalizeValue(productionId)) {
              restoreBaseQty += usageToBaseQty(usage, entryUnit);
            } else {
              keepUsages.push(usage);
            }
          });
          entry.productionUsage = keepUsages;
          safeAmount = Number.isFinite(restoreBaseQty) && restoreBaseQty > 0
            ? Number(fromBase(restoreBaseQty, entryUnit).toFixed(4))
            : 0;
          if (safeAmount <= 0) {
            nextEntries[index] = entry;
            return;
          }
          entry.availableQty = Number(Math.min(maxQty, currentAvailableQty + safeAmount).toFixed(4));
          entry.availableBase = Number(Math.max(0, toBase(entry.availableQty, entryUnit)).toFixed(6));
        } else {
          const amountInEntryUnit = fromBase(lot.takeBaseQty, entryUnit);
          safeAmount = Number.isFinite(amountInEntryUnit) ? Number(amountInEntryUnit.toFixed(4)) : 0;
          if (safeAmount <= 0) return;
          entry.availableQty = Number(Math.max(0, currentAvailableQty - safeAmount).toFixed(4));
          entry.availableBase = Number(Math.max(0, toBase(entry.availableQty, entryUnit)).toFixed(6));
          entry.productionUsage.unshift({
            id: makeId('usage'),
            productionId,
            producedAt: nowTs(),
            productionDate,
            expiryDateAtProduction: isEntryNoPerecedero(entry) ? 'No perecedero' : normalizeValue(entry.expiryDate),
            kilosUsed: Number((Number(lot.takeBaseQty || 0) / 1000).toFixed(4)),
            usedQty: Number(lot.takeQty || 0),
            usedUnit: normalizeValue(lot.unit || item.ingredientUnit || ''),
            usedBaseQty: Number(lot.takeBaseQty || 0),
            lotNumber: normalizeValue(entry.lotNumber) || normalizeValue(entry.invoiceNumber) || entry.id,
            ingredientLot: normalizeValue(entry.lotNumber) || normalizeValue(entry.invoiceNumber) || entry.id,
            ingredientEntryId: entry.id,
            ingredientId: item.ingredientId
          });
        }
        if (!Number.isFinite(Number(entry.availableBase))) {
          entry.availableBase = Number(Math.max(0, toBase(entry.availableQty, entryUnit)).toFixed(6));
        }
        const nextAvailableKg = Number((toBase(entry.availableQty, entryUnit) / 1000).toFixed(4));
        entry.availableKg = nextAvailableKg;
        entry.lotStatus = entry.availableQty <= 0 ? 'consumido_en_produccion' : 'disponible';
        const moveType = mode === 'consume' ? 'consumo_produccion' : 'reversion_produccion';
        nextEntries[index] = updateEntryMovement(entry, {
          type: moveType,
          productionId,
          qty: Number(safeAmount.toFixed(4)),
          qtyUnit: entryUnit,
          createdAt: nowTs(),
          productionDate,
          user: getCurrentUserLabel(),
          reference: productionId,
          observation: mode === 'consume' ? 'Consumo FEFO en producción' : 'Restitución por anulación/edición'
        });
      });
      const stockBase = nextEntries.reduce((acc, entry) => {
        const availableBase = Number(entry?.availableBase);
        if (Number.isFinite(availableBase) && availableBase >= 0) return acc + availableBase;
        return acc + Math.max(0, Number(toBase(getEntryAvailableQty(entry), entry?.unit || record.stockUnit || item.ingredientUnit || 'kilos') || 0));
      }, 0);
      const stockKg = nextEntries.reduce((acc, entry) => acc + getEntryAvailableKg(entry), 0);
      inventoryNext.items[item.ingredientId] = {
        ...record,
        entries: nextEntries,
        stockBase: Number(stockBase.toFixed(6)),
        stockKg: Number(stockKg.toFixed(4))
      };
    });
    return inventoryNext;
  };
  const initialsFromName = (value) => normalizeValue(value)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((item) => item.charAt(0).toUpperCase())
    .join('');
  const initialsFromPersonName = (value) => {
    const words = normalizeValue(value)
      .split(/\s+/)
      .map((item) => item.replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑ]/g, ''))
      .filter(Boolean);
    if (words.length < 2) return '';
    return words.slice(0, 2).map((item) => item.charAt(0).toUpperCase()).join('');
  };
  const getDispatchUserRole = (user) => normalizeValue(user?.cargo || user?.role || user?.puesto || user?.position || user?.jobTitle || 'Sin cargo');
  const renderUserAvatar = (user) => {
    const photoUrl = sanitizeImageUrl(user?.photoUrl);
    if (photoUrl) {
      return `<span class="user-avatar-thumb"><span class="thumb-loading"><img class="meta-spinner-login" src="./IMG/Meta-ai-logo.webp" alt="Cargando"></span><img class="thumb-image js-produccion-user-photo" src="${photoUrl}" alt="${normalizeValue(user.fullName || user.email || 'Usuario')}"></span>`;
    }
    const initials = initialsFromName(user?.fullName || user?.email || '');
    return `<span class="user-avatar-thumb user-avatar-initials">${initials || '<i class="bi bi-person-fill"></i>'}</span>`;
  };
  const prepareThumbLoaders = (selector) => {
    const list = Array.from(document.querySelectorAll(selector));
    list.forEach((img) => {
      const parent = img.closest('.user-avatar-thumb, .receta-thumb-wrap, .produccion-hero-avatar, .inventario-trace-avatar, .inventario-print-photo-wrap, .recipe-inline-avatar-wrap, .recipe-suggest-avatar-wrap');
      const spinner = parent ? parent.querySelector('.thumb-loading') : null;
      const done = () => {
        img.classList.add('is-loaded');
        spinner?.remove();
      };
      if (img.complete && img.naturalWidth > 0) {
        done();
      } else {
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', () => { spinner?.remove(); }, { once: true });
        setTimeout(() => {
          if (!img.classList.contains('is-loaded')) {
            spinner?.remove();
          }
        }, 7000);
      }
    });
  };
  const waitPrintAssets = async (printWindow) => {
    const images = [...(printWindow?.document?.images || [])];
    if (!images.length) return;
    await Promise.all(images.map((img) => new Promise((resolve) => {
      if (img.complete) {
        resolve();
        return;
      }
      const done = () => resolve();
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
    })));
  };
  const preloadPrintImages = async (urls = []) => {
    const unique = [...new Set((Array.isArray(urls) ? urls : []).filter(Boolean))];
    if (!unique.length) return;
    Swal.fire({
      title: 'Preparando impresión...',
      html: '<div class="informes-saving-spinner"><img src="./IMG/Meta-ai-logo.webp" alt="Preparando impresión" class="meta-spinner-login"></div>',
      allowOutsideClick: false,
      showConfirmButton: false,
      customClass: {
        popup: 'ios-alert produccion-loading-alert',
        title: 'ios-alert-title',
        htmlContainer: 'ios-alert-text'
      }
    });
    try {
      await Promise.all(unique.map((url) => new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve();
        img.onerror = () => resolve();
        img.src = url;
      })));
    } finally {
      if (Swal.isVisible()) Swal.close();
    }
  };
  const openIosSwal = (options) => {
    const incoming = safeObject(options?.customClass);
    const joinClass = (base, extra) => [base, extra].filter(Boolean).join(' ').trim();
    const reserved = new Set(['popup', 'title', 'htmlContainer', 'confirmButton', 'cancelButton', 'denyButton']);
    const passthrough = Object.fromEntries(Object.entries(incoming).filter(([key]) => !reserved.has(key)));
    const activeBootstrapModal = document.querySelector('.modal.show .modal-content');
    const target = options?.target || activeBootstrapModal || document.body;
    return Swal.fire({
      ...options,
      target,
      returnFocus: false,
      customClass: {
        ...passthrough,
        popup: joinClass('ios-alert', incoming.popup),
        title: joinClass('ios-alert-title', incoming.title),
        htmlContainer: joinClass('ios-alert-text', incoming.htmlContainer),
        confirmButton: joinClass('ios-btn ios-btn-primary', incoming.confirmButton),
        cancelButton: joinClass('ios-btn ios-btn-secondary', incoming.cancelButton),
        denyButton: joinClass('ios-btn ios-btn-warning', incoming.denyButton)
      },
      buttonsStyling: false
    });
  };
  const exportStyledExcel = async ({ fileName, sheetName, headers, rows }) => {
    if (!window.ExcelJS) return;
    const wb = new window.ExcelJS.Workbook();
    const ws = wb.addWorksheet(sheetName);
    ws.columns = headers.map((header) => ({ header, key: header, width: 24 }));
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
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
      const tone = data.__tone === 'trace' ? 'FFFFECEF' : data.__tone === 'movement_in' ? 'FFECFDF3' : data.__tone === 'movement_out' ? 'FFFFF1F2' : data.__tone === 'internal_use' ? 'FFFFF2E3' : data.__tone === 'resolution_yellow' ? 'FFFFF6D9' : (index % 2 === 0 ? 'FFF5F8FF' : 'FFEAF1FF');
      row.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: tone } };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFD8E2F5' } },
          left: { style: 'thin', color: { argb: 'FFD8E2F5' } },
          bottom: { style: 'thin', color: { argb: 'FFD8E2F5' } },
          right: { style: 'thin', color: { argb: 'FFD8E2F5' } }
        };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        const colHeader = headers[cell.col - 1];
        if (data.__tone === 'trace' || data.__tone === 'internal_use') {
          cell.font = { color: { argb: 'FF1F2A44' }, bold: false };
        } else if (data.__tone === 'movement_in') {
          if (colHeader === 'Tipo' || colHeader === 'Código' || colHeader === 'Cantidad (kg)') {
            cell.font = { color: { argb: 'FF17803D' }, bold: true };
          } else {
            cell.font = { color: { argb: 'FF111827' }, bold: false };
          }
        } else if (data.__tone === 'movement_out') {
          if (colHeader === 'Tipo' || colHeader === 'Código' || colHeader === 'Cantidad (kg)') {
            cell.font = { color: { argb: 'FFB4232A' }, bold: true };
          } else {
            cell.font = { color: { argb: 'FF111827' }, bold: false };
          }
        }
      });
      if (data.__mergeAcross) {
        ws.mergeCells(row.number, 1, row.number, headers.length);
        const mergedCell = row.getCell(1);
        mergedCell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      }
    });
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };
  const isHighlightedResolutionType = (type) => ['decommissioned', 'sold_counter'].includes(normalizeValue(type));
  const readMinKgForRecipe = (recipeId) => {
    const local = parseNumber(state.config.recipeMinKg?.[recipeId]);
    if (Number.isFinite(local) && local > 0) return local;
    return parsePositive(state.config.globalMinKg, 1);
  };
  const persistConfig = async () => {
    await window.laJamoneraReady;
    await window.dbLaJamoneraRest.write(CONFIG_PATH, state.config);
  };
  const uploadImageToStorage = async (file, folder) => {
    const safeName = String(file?.name || 'logo').replace(/\s+/g, '_').replace(/[^a-zA-Z0-9._-]/g, '');
    const refPath = `${folder}/${Date.now()}_${safeName}`;
    const ref = window.storageLaJamonera.ref().child(refPath);
    await ref.put(file);
    return ref.getDownloadURL();
  };

  const runWithBackSpinner = async (task) => {
    const modalContent = produccionModal?.querySelector('.modal-content');
    if (!modalContent) {
      await task();
      return;
    }
    if (window.getComputedStyle(modalContent).position === 'static') {
      modalContent.style.position = 'relative';
    }
    document.querySelectorAll('.produccion-dispatch-floating-suggest').forEach((node) => node.remove());
    const overlay = document.createElement('div');
    overlay.className = 'modal-local-overlay';
    overlay.innerHTML = '<div class="modal-local-overlay-card"><img src="./IMG/Meta-ai-logo.webp" alt="Actualizando" class="meta-spinner-login"></div>';
    modalContent.appendChild(overlay);
    try {
      await task();
    } finally {
      overlay.remove();
    }
  };
  const setStateView = (view) => {
    state.view = view;
    if (view !== 'list' && state.draftsTick) {
      clearInterval(state.draftsTick);
      state.draftsTick = null;
    }
    nodes.loading.classList.toggle('d-none', view !== 'loading');
    nodes.empty.classList.toggle('d-none', view !== 'empty');
    nodes.data.classList.toggle('d-none', view !== 'list');
    nodes.editor.classList.toggle('d-none', view !== 'editor');
  };
  const updateProduccionListScrollHint = () => {
    if (!nodes.list) return;
    const hasOverflow = nodes.list.scrollHeight > nodes.list.clientHeight + 4;
    const isAtEnd = nodes.list.scrollTop + nodes.list.clientHeight >= nodes.list.scrollHeight - 4;
    nodes.list.classList.toggle('has-scroll-hint', hasOverflow && !isAtEnd);
  };
  const getRecipes = () => Object.values(safeObject(state.recetas));
  const getThumbPlaceholder = () => `<span class="image-placeholder-circle-2">${BASE_ICON}</span>`;
  const activeReservations = () => Object.values(safeObject(state.reservas))
    .filter((item) => Number(item?.expiresAt || 0) > nowTs() && item.status !== 'released');
  const getDraftExpiryTs = (draft) => Number(draft?.updatedAt || 0) + RESERVE_TTL_MS;
  const getDraftRemainingMs = (draft) => getDraftExpiryTs(draft) - nowTs();
  const formatCountdown = (remainingMs) => {
    const safeMs = Math.max(0, Number(remainingMs || 0));
    const mins = Math.floor(safeMs / 60000);
    const secs = Math.floor((safeMs % 60000) / 1000);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };
  const getRecipeDraftLockInfo = (recipeId) => {
    const relevantDrafts = Object.values(safeObject(state.drafts)).filter((draft) => (
      normalizeValue(draft?.recipeId) === normalizeValue(recipeId)
      && normalizeValue(draft?.status || 'active') === 'active'
      && getDraftRemainingMs(draft) > 0
    ));
    if (!relevantDrafts.length) return null;
    const draftWithTime = relevantDrafts.reduce((best, draft) => {
      if (!best) return draft;
      return getDraftExpiryTs(draft) > getDraftExpiryTs(best) ? draft : best;
    }, null);
    const reservationMap = safeObject(state.reservas);
    const blockedKg = relevantDrafts.reduce((acc, draft) => {
      const reservationId = normalizeValue(draft?.reservationId);
      const reservation = reservationMap[reservationId];
      if (!reservation || reservation.status !== 'active' || Number(reservation.expiresAt || 0) <= nowTs()) return acc;
      const locks = Array.isArray(reservation.locks) ? reservation.locks : [];
      const reservedKg = locks.reduce((sum, lock) => {
        const reservedBase = Number(lock?.reservedBaseQty);
        if (Number.isFinite(reservedBase) && reservedBase > 0) return sum + (reservedBase / 1000);
        const fallbackBase = toBase(lock?.reservedQty, lock?.unit);
        return sum + ((Number.isFinite(fallbackBase) && fallbackBase > 0) ? (fallbackBase / 1000) : 0);
      }, 0);
      return acc + reservedKg;
    }, 0);
    return {
      blockedKg: Number(blockedKg.toFixed(2)),
      remainingMs: getDraftRemainingMs(draftWithTime)
    };
  };
  const reservedByOthersForEntry = (ingredientId, entryId, unit) => {
    const baseUnit = normalizeLower(unit);
    const baseMeta = getUnitMeta(baseUnit);
    return activeReservations().reduce((acc, reservation) => {
      if (reservation.ownerSessionId === sessionId) return acc;
      const locks = Array.isArray(reservation?.locks) ? reservation.locks : [];
      locks.forEach((lock) => {
        if (lock.ingredientId !== ingredientId) return;
        if (entryId && lock.entryId && lock.entryId !== entryId) return;
        const lockMeta = getUnitMeta(lock.unit || baseUnit);
        if (lockMeta.category !== baseMeta.category) return;
        const lockBase = Number(lock.reservedBaseQty || toBase(lock.reservedQty, lock.unit || baseUnit) || 0);
        acc += fromBase(lockBase, baseUnit);
      });
      return acc;
    }, 0);
  };
  const getInventoryAvailability = (ingredientId, targetUnit, productionDateIso = toIsoDate()) => {
    const record = safeObject(state.inventario.items?.[ingredientId]);
    const entries = Array.isArray(record.entries) ? record.entries : [];
    const targetMeta = getUnitMeta(targetUnit);
    if (!entries.length && targetMeta.category === 'peso') {
      const stockKg = Number(record.stockKg || 0);
      const base = Number.isFinite(stockKg) ? stockKg * 1000 : 0;
      const reserved = reservedByOthersForEntry(ingredientId, '', 'kg') * 1000;
      const net = Math.max(0, base - reserved);
      return {
        available: fromBase(net, targetUnit),
        total: fromBase(base, targetUnit),
        hasExpired: false,
        incompatibleUnits: [],
        nextToExpire: null
      };
    }
    const aggregate = entries.reduce((acc, entry) => {
      const qty = getEntryAvailableQty(entry);
      if (!Number.isFinite(qty) || qty <= 0) return acc;
      const entryMeta = getUnitMeta(entry.unit);
      const entryBase = qty * entryMeta.factor;
      const reservedQty = reservedByOthersForEntry(ingredientId, entry.id, entry.unit);
      const reservedBase = toBase(reservedQty, entry.unit);
      const netBase = Math.max(0, entryBase - (Number.isFinite(reservedBase) ? reservedBase : 0));
      const expiryIso = isEntryNoPerecedero(entry) ? '' : normalizeValue(entry.expiryDate);
      const expiredForDate = expiryIso && expiryIso < productionDateIso;
      if (entryMeta.category === targetMeta.category) {
        acc.totalBase += netBase;
        if (!expiredForDate) acc.usableBase += netBase;
      } else {
        acc.incompatible.push(entry.unit || 'sin unidad');
      }
      if (expiredForDate) acc.hasExpired = true;
      if (!acc.nextToExpire && expiryIso) acc.nextToExpire = expiryIso;
      return acc;
    }, { totalBase: 0, usableBase: 0, incompatible: [], hasExpired: false, nextToExpire: null });
    return {
      available: fromBase(aggregate.usableBase, targetUnit),
      total: fromBase(aggregate.totalBase, targetUnit),
      hasExpired: aggregate.hasExpired,
      incompatibleUnits: aggregate.incompatible,
      nextToExpire: aggregate.nextToExpire
    };
  };
  const getExpiredKgForIngredient = (ingredientId, productionDateIso = toIsoDate()) => {
    const record = safeObject(state.inventario.items?.[ingredientId]);
    const entries = Array.isArray(record.entries) ? record.entries : [];
    return entries.reduce((acc, entry) => {
      const expiryIso = isEntryNoPerecedero(entry) ? '' : normalizeValue(entry.expiryDate);
      if (!expiryIso || expiryIso >= productionDateIso) return acc;
      const availableKg = getEntryAvailableKg(entry);
      if (!Number.isFinite(availableKg) || availableKg <= 0.0001) return acc;
      return acc + availableKg;
    }, 0);
  };
  const formatDateRangeForRecipe = (recipe) => {
    const ingredientRows = (Array.isArray(recipe?.rows) ? recipe.rows : []).filter((row) => row.type === 'ingredient' && row.ingredientId);
    let minEntry = '';
    let maxExpiry = '';
    ingredientRows.forEach((row) => {
      const record = safeObject(state.inventario.items?.[row.ingredientId]);
      const entries = Array.isArray(record.entries) ? record.entries : [];
      entries.forEach((entry) => {
        const availableQty = getEntryAvailableQty(entry);
        if (!Number.isFinite(availableQty) || availableQty <= 0.0001) return;
        const entryDate = normalizeValue(entry.entryDate);
        const expiryDate = isEntryNoPerecedero(entry) ? '' : normalizeValue(entry.expiryDate);
        if (entryDate && (!minEntry || entryDate < minEntry)) minEntry = entryDate;
        if (expiryDate && (!maxExpiry || expiryDate > maxExpiry)) maxExpiry = expiryDate;
      });
    });
    if (!minEntry && !maxExpiry) return 'sin rango disponible';
    return `${minEntry || '-'} a ${maxExpiry || '-'}`;
  };

  const getRecipeExpiredKg = (recipe, productionDateIso = toIsoDate()) => {
    const ingredientRows = (Array.isArray(recipe?.rows) ? recipe.rows : []).filter((row) => row.type === 'ingredient' && row.ingredientId);
    const uniqueIds = [...new Set(ingredientRows.map((row) => row.ingredientId))];
    return uniqueIds.reduce((acc, ingredientId) => acc + getExpiredKgForIngredient(ingredientId, productionDateIso), 0);
  };
  const analyzeRecipe = (recipe, productionDateIso = toIsoDate()) => {
    const rows = (Array.isArray(recipe.rows) ? recipe.rows : []).filter((row) => row.type === 'ingredient');
    const yieldQty = parseNumber(recipe.yieldQuantity);
    const yieldMeta = getUnitMeta(recipe.yieldUnit);
    const minKg = readMinKgForRecipe(recipe.id);
    if (!Number.isFinite(yieldQty) || yieldQty <= 0 || yieldMeta.category !== 'peso') {
      return {
        status: 'danger', statusText: 'Configuración inválida', maxKg: 0, progress: 0, canProduce: false,
        errors: ['La receta debe tener rendimiento en unidad de peso para calcular producción.'],
        requirements: [], missingForMin: [], hasExpired: false, minKg
      };
    }
    const yieldKg = toBase(yieldQty, recipe.yieldUnit) / 1000;
    const requirements = [];
    const errors = [];
    rows.forEach((row) => {
      const reqQty = parseNumber(row.quantity);
      const unit = normalizeLower(row.unit);
      if (!row.ingredientId || !Number.isFinite(reqQty) || reqQty <= 0 || !unit) return;
      const neededPerKg = reqQty / yieldKg;
      const availability = getInventoryAvailability(row.ingredientId, unit, productionDateIso);
      const coverage = neededPerKg > 0 ? Math.max(0, availability.available) / neededPerKg : 0;
      const totalCoverage = neededPerKg > 0 ? Math.max(0, availability.total) / neededPerKg : 0;
      if (availability.incompatibleUnits.length) {
        errors.push(`Esta receta contiene unidades incompatibles para cálculo automático. Revisá ${capitalize(row.ingredientName)}.`);
      }
      requirements.push({
        ingredientId: row.ingredientId,
        name: capitalize(row.ingredientName || state.ingredientes[row.ingredientId]?.name || 'Ingrediente'),
        unit,
        neededPerKg,
        available: availability.available,
        totalAvailable: availability.total,
        coverage,
        totalCoverage,
        missingForMin: Math.max(0, (neededPerKg * minKg) - availability.available),
        missingForMinIncludingExpired: Math.max(0, (neededPerKg * minKg) - availability.total),
        hasExpired: availability.hasExpired
      });
    });
    if (!requirements.length) {
      return {
        status: 'danger', statusText: 'Sin insumos', maxKg: 0, progress: 0, canProduce: false,
        errors: ['La receta no tiene ingredientes válidos para producción.'],
        requirements: [], missingForMin: [], hasExpired: false, minKg
      };
    }
    const minCoverage = Math.min(...requirements.map((item) => item.coverage));
    const minTotalCoverage = Math.min(...requirements.map((item) => item.totalCoverage));
    const maxKg = Math.max(0, minCoverage);
    const maxKgIncludingExpired = Math.max(0, minTotalCoverage);
    const readyCount = requirements.filter((item) => item.missingForMin <= 0.0001).length;
    const readyCountIncludingExpired = requirements.filter((item) => item.missingForMinIncludingExpired <= 0.0001).length;
    const progress = Math.max(0, Math.min(100, (readyCount / Math.max(requirements.length, 1)) * 100));
    const progressIncludingExpired = Math.max(0, Math.min(100, (readyCountIncludingExpired / Math.max(requirements.length, 1)) * 100));
    const canProduce = maxKg >= minKg;
    const canProduceConsideringExpired = maxKgIncludingExpired >= minKg;
    const missingForMin = requirements.filter((item) => item.missingForMin > 0.0001);
    const missingForMinIncludingExpired = requirements.filter((item) => item.missingForMinIncludingExpired > 0.0001);
    const hasExpired = requirements.some((item) => item.hasExpired);
    let status = 'danger';
    let statusText = 'Faltan insumos';
    if (canProduce) {
      status = 'success';
      statusText = 'Disponible';
    } else if (!canProduce && canProduceConsideringExpired) {
      status = 'warning';
      statusText = 'Stock vencido';
    } else if (progress >= 50) {
      status = 'warning';
      statusText = 'Stock parcial';
    }
    const expiredKg = getRecipeExpiredKg(recipe, productionDateIso);
    return {
      status,
      statusText,
      maxKg,
      maxKgIncludingExpired,
      progress,
      progressIncludingExpired,
      canProduce,
      canProduceConsideringExpired,
      errors,
      requirements,
      missingForMin,
      missingForMinIncludingExpired,
      hasExpired,
      minKg,
      expiredKg
    };
  };
  const sortEntriesFEFO = (entries = []) => [...entries].sort((a, b) => {
    const expiryA = isEntryNoPerecedero(a) ? '9999-12-31' : (normalizeValue(a.expiryDate) || '9999-12-31');
    const expiryB = isEntryNoPerecedero(b) ? '9999-12-31' : (normalizeValue(b.expiryDate) || '9999-12-31');
    if (expiryA !== expiryB) return expiryA.localeCompare(expiryB);
    return Number(a.createdAt || 0) - Number(b.createdAt || 0);
  });
  const getDispatchRecordsList = () => Object.values(safeObject(state.reparto?.registros));
  const getProducedStockMeta = (recipeId) => {
    const indexed = safeObject(state.reparto?.productIndex?.[recipeId]);
    if (Object.keys(indexed).length) {
      return {
        produced: 0,
        dispatched: 0,
        available: toFiniteKg(indexed.availableKg),
        lastWeekOut: getLastWeekOutFromIndex(recipeId)
      };
    }
    const produced = getRegistrosList()
      .filter((item) => normalizeValue(item.recipeId) === normalizeValue(recipeId) && normalizeValue(item.status) !== 'anulada')
      .reduce((acc, item) => acc + Number(item.quantityKg || 0), 0);
    const dispatched = getDispatchRecordsList().reduce((acc, reparto) => {
      const products = Array.isArray(reparto.products) ? reparto.products : [];
      const subtotal = products
        .filter((row) => normalizeValue(row.recipeId) === normalizeValue(recipeId))
        .reduce((sum, row) => sum + Number(row.qtyKg || 0), 0);
      return acc + subtotal;
    }, 0);
    const available = Number(Math.max(0, produced - dispatched).toFixed(3));
    const now = Date.now();
    const weekAgo = now - (7 * 24 * 60 * 60 * 1000);
    const lastWeekOut = getDispatchRecordsList().reduce((acc, reparto) => {
      const createdAt = Number(reparto.createdAt || 0);
      if (!Number.isFinite(createdAt) || createdAt < weekAgo) return acc;
      const products = Array.isArray(reparto.products) ? reparto.products : [];
      return acc + products
        .filter((row) => normalizeValue(row.recipeId) === normalizeValue(recipeId))
        .reduce((sum, row) => sum + Number(row.qtyKg || 0), 0);
    }, 0);
    return { produced, dispatched, available, lastWeekOut: Number(lastWeekOut.toFixed(3)) };
  };
  const getRecipeHistoryRows = (recipeId) => {
    const indexed = safeObject(state.reparto?.productIndex?.[recipeId]);
    const rows = Object.values(safeObject(indexed.movements))
      .sort((a, b) => Number(b.at || 0) - Number(a.at || 0));
    return rows;
  };
  const rebuildProductIndexFromHistory = () => {
    state.reparto.productIndex = {};
    getRegistrosList()
      .filter((item) => normalizeValue(item.status) !== 'anulada')
      .forEach((registro) => {
        appendRecipeMovement(registro.recipeId, {
          id: `ing_${registro.id}`,
          type: 'ingreso',
          qtyKg: Number(registro.quantityKg || 0),
          at: Number(registro.createdAt || 0) || nowTs(),
          sourceId: registro.id,
          sourceCode: registro.id,
          label: 'Producción confirmada',
          date: registro.productionDate
        });
      });
    getDispatchRecordsList().forEach((reparto) => {
      const products = Array.isArray(reparto.products) ? reparto.products : [];
      products.forEach((product) => {
        appendRecipeMovement(product.recipeId, {
          id: `egr_${reparto.id}_${product.recipeId}`,
          type: 'egreso',
          qtyKg: Number(product.qtyKg || 0),
          at: Number(reparto.createdAt || 0) || nowTs(),
          sourceId: reparto.id,
          sourceCode: reparto.code,
          label: 'Reparto guardado',
          date: reparto.dispatchDate
        });
      });
    });
  };
  const buildPlanForRecipe = (recipe, qtyKg, productionDateIso = toIsoDate()) => {
    const analysis = analyzeRecipe(recipe, productionDateIso);
    const ingredientPlans = [];
    const conflicts = [];
    const warnings = [];
    analysis.requirements.forEach((requirement) => {
      const rowNeed = requirement.neededPerKg * qtyKg;
      let remaining = rowNeed;
      const record = safeObject(state.inventario.items?.[requirement.ingredientId]);
      const entries = sortEntriesFEFO(Array.isArray(record.entries) ? record.entries : []);
      const lots = [];
      entries.forEach((entry) => {
        const entryUnit = normalizeLower(entry.unit || requirement.unit);
        const entryMeta = getUnitMeta(entryUnit);
        const reqMeta = getUnitMeta(requirement.unit);
        if (entryMeta.category !== reqMeta.category) return;
        const entryQty = getEntryAvailableQty(entry);
        const reservedByOther = reservedByOthersForEntry(requirement.ingredientId, entry.id, entryUnit);
        const available = Math.max(0, entryQty - reservedByOther);
        const expiryIso = isEntryNoPerecedero(entry) ? '' : normalizeValue(entry.expiryDate);
        const status = !expiryIso || expiryIso >= productionDateIso ? 'ok' : 'expired';
        const isSoon = expiryIso && expiryIso >= productionDateIso && expiryIso <= toIsoDate(new Date(productionDateIso).getTime() + 2 * 86400000);
        if (isSoon) warnings.push(`${requirement.name}: lote próximo a vencer (${expiryIso}).`);
        const lotNumber = normalizeValue(entry.lotNumber) || normalizeValue(entry.invoiceNumber) || entry.id;
        if (status === 'expired' && available > 0.0001) {
          lots.push({
            ingredientId: requirement.ingredientId,
            ingredientName: requirement.name,
            ingredientImage: state.ingredientes[requirement.ingredientId]?.imageUrl || '',
            entryId: entry.id,
            lotNumber,
            entryDate: entry.entryDate || '',
            createdAt: Number(entry.createdAt || 0),
            expiryDate: expiryIso || (isEntryNoPerecedero(entry) ? 'No perecedero' : ''),
            noPerecedero: isEntryNoPerecedero(entry),
            provider: normalizeValue(entry.provider) || '-',
            invoiceNumber: normalizeValue(entry.invoiceNumber) || '-',
            invoiceImageUrls: Array.isArray(entry.invoiceImageUrls) ? entry.invoiceImageUrls : (entry.invoiceImageUrl ? [entry.invoiceImageUrl] : []),
            unit: requirement.unit,
            takeQty: 0,
            takeBaseQty: 0,
            availableQty: Number(available.toFixed(4)),
            availableKg: getEntryAvailableKg(entry),
            entryAvailableQty: Number(available.toFixed(4)),
            status: 'expired'
          });
          return;
        }
        const availableInReqUnit = fromBase(toBase(available, entryUnit), requirement.unit);
        const take = Math.min(remaining, availableInReqUnit);
        if (take <= 0) return;
        remaining = Number((remaining - take).toFixed(6));
        lots.push({
          ingredientId: requirement.ingredientId,
          ingredientName: requirement.name,
          ingredientImage: state.ingredientes[requirement.ingredientId]?.imageUrl || '',
          entryId: entry.id,
          lotNumber,
          entryDate: entry.entryDate || '',
          createdAt: Number(entry.createdAt || 0),
            expiryDate: expiryIso || (isEntryNoPerecedero(entry) ? 'No perecedero' : ''),
            noPerecedero: isEntryNoPerecedero(entry),
          provider: normalizeValue(entry.provider) || '-',
          invoiceNumber: normalizeValue(entry.invoiceNumber) || '-',
          invoiceImageUrls: Array.isArray(entry.invoiceImageUrls) ? entry.invoiceImageUrls : (entry.invoiceImageUrl ? [entry.invoiceImageUrl] : []),
          unit: requirement.unit,
          takeQty: Number(take.toFixed(4)),
          takeBaseQty: Number(toBase(take, requirement.unit).toFixed(6)),
          availableQty: Number(available.toFixed(4)),
          availableKg: getEntryAvailableKg(entry),
          entryAvailableQty: Number(available.toFixed(4)),
          status: isSoon ? 'soon' : 'ok'
        });
      });
      const missing = Math.max(0, Number(remaining.toFixed(4)));
      if (missing > 0.0001) {
        const hasExpiredWithStock = lots.some((lot) => lot.status === 'expired' && Number(lot.availableQty || 0) > 0.0001);
        if (hasExpiredWithStock) {
          conflicts.push(`${requirement.name}: faltan ${formatQty(missing, requirement.unit)} para la fecha ${productionDateIso}. Resolvé vencidos, cambiá el rango de fecha o ingresá un nuevo lote.`);
        } else {
          conflicts.push(`${requirement.name}: faltan ${formatQty(missing, requirement.unit)} para la fecha ${productionDateIso}. Ingresá un nuevo lote o cambiá fecha.`);
        }
      }
      ingredientPlans.push({
        ingredientId: requirement.ingredientId,
        ingredientName: requirement.name,
        ingredientUnit: requirement.unit,
        neededQty: Number(rowNeed.toFixed(4)),
        availableQty: Number(requirement.available.toFixed(4)),
        missingQty: missing,
        lots
      });
    });
    const flatLocks = ingredientPlans.flatMap((item) => item.lots.map((lot) => ({
      ingredientId: lot.ingredientId,
      entryId: lot.entryId,
      reservedQty: lot.takeQty,
      reservedBaseQty: lot.takeBaseQty,
      unit: lot.unit,
      lotNumber: lot.lotNumber
    })));
    return {
      recipeId: recipe.id,
      qtyKg: Number(qtyKg.toFixed(2)),
      productionDate: productionDateIso,
      ingredientPlans,
      locks: flatLocks,
      warnings,
      conflicts,
      isValid: conflicts.length === 0
    };
  };
  const cleanupExpiredReservations = async () => {
    const now = nowTs();
    const reservas = safeObject(await window.dbLaJamoneraRest.read(RESERVAS_PATH));
    const updates = { ...reservas };
    let changed = false;
    Object.entries(reservas).forEach(([id, reservation]) => {
      if (!reservation) return;
      if (Number(reservation.expiresAt || 0) <= now && reservation.status === 'active') {
        updates[id] = { ...reservation, status: 'released', releasedAt: now, releasedReason: 'expired' };
        changed = true;
      }
    });
    if (changed) await window.dbLaJamoneraRest.write(RESERVAS_PATH, updates);
    state.reservas = changed ? updates : reservas;
  };
  const applyPendingExpiryActionsOnInventory = (inventory) => {
    const pending = safeObject(state.pendingExpiryActions);
    if (!Object.keys(pending).length) return inventory;
    const next = deepClone(safeObject(inventory));
    const rawEntryAvailableQty = (entry) => {
      const available = parseNumber(entry?.availableQty);
      if (Number.isFinite(available) && available >= 0) return available;
      const qty = parseNumber(entry?.qty);
      return Number.isFinite(qty) && qty > 0 ? qty : 0;
    };
    const rawEntryAvailableKg = (entry) => {
      const availableKg = Number(entry?.availableKg);
      if (Number.isFinite(availableKg) && availableKg >= 0) return availableKg;
      const base = toBase(rawEntryAvailableQty(entry), entry?.unit || 'kilos');
      return Number.isFinite(base) ? Number((base / 1000).toFixed(4)) : 0;
    };

    Object.values(safeObject(next.items)).forEach((record) => {
      const entries = Array.isArray(record.entries) ? record.entries : [];
      entries.forEach((entry) => {
        const action = pending[normalizeValue(entry.id)];
        if (!action) return;
        const availableKg = rawEntryAvailableKg(entry);
        const availableQty = rawEntryAvailableQty(entry);
        const qtyKg = Math.max(0, Math.min(Number(action.qtyKg || 0), Number.isFinite(availableKg) ? availableKg : 0));
        if (qtyKg <= 0) return;
        const ratio = Number.isFinite(availableKg) && availableKg > 0 ? (qtyKg / availableKg) : 1;
        const qtyDiscount = Number.isFinite(availableQty) ? (availableQty * ratio) : 0;
        entry.availableKg = Number(Math.max(0, (Number.isFinite(availableKg) ? availableKg : 0) - qtyKg).toFixed(4));
        entry.availableQty = Number(Math.max(0, (Number.isFinite(availableQty) ? availableQty : 0) - qtyDiscount).toFixed(4));
        entry.availableBase = Number(Math.max(0, toBase(entry.availableQty, entry?.unit || record.stockUnit || 'kilos')).toFixed(6));
        entry.expiryResolutions = Array.isArray(entry.expiryResolutions) ? entry.expiryResolutions : [];
        entry.expiryResolutions.unshift({ id: makeId('expiry_resolution'), createdAt: nowTs(), type: action.type, qtyKg: Number(qtyKg.toFixed(4)) });
        entry.movementHistory = Array.isArray(entry.movementHistory) ? entry.movementHistory : [];
        entry.movementHistory.unshift({
          type: 'resolucion_vencido',
          createdAt: nowTs(),
          qty: Number(qtyDiscount.toFixed(4)),
          qtyUnit: normalizeValue(entry?.unit || record.stockUnit || 'kilos'),
          qtyKg: Number(qtyKg.toFixed(4)),
          reference: normalizeValue(action.type),
          observation: action.type === 'decommissioned' ? 'Lote vencido decomisado' : 'Lote vencido vendido en mostrador'
        });
        if (entry.availableKg <= 0.0001) {
          entry.expiryResolutionStatus = action.type;
          entry.status = action.type;
          entry.lotStatus = action.type === 'decommissioned' ? 'decomisado' : 'sin_trazabilidad';
        }
      });
      record.stockBase = Number(entries.reduce((acc, item) => acc + Number(item?.availableBase || 0), 0).toFixed(6));
      record.stockKg = Number(entries.reduce((acc, item) => acc + Number(item?.availableKg || 0), 0).toFixed(4));
    });
    return next;
  };
  const cleanupExpiredDrafts = async () => {
    const drafts = safeObject(await window.dbLaJamoneraRest.read(DRAFTS_PATH));
    const reservas = safeObject(await window.dbLaJamoneraRest.read(RESERVAS_PATH));
    const now = nowTs();
    const nextDrafts = { ...drafts };
    const nextReservas = { ...reservas };
    let draftsChanged = false;
    let reservasChanged = false;
    Object.entries(drafts).forEach(([id, draft]) => {
      const draftStatus = normalizeValue(draft?.status || 'active');
      if (draftStatus !== 'active') return;
      if (getDraftRemainingMs(draft) > 0) return;
      delete nextDrafts[id];
      draftsChanged = true;
      const reservationId = normalizeValue(draft?.reservationId);
      const reservation = nextReservas[reservationId];
      if (reservation?.status === 'active') {
        nextReservas[reservationId] = {
          ...reservation,
          status: 'released',
          releasedAt: now,
          releasedReason: 'draft_expired'
        };
        reservasChanged = true;
      }
    });
    if (draftsChanged) await window.dbLaJamoneraRest.write(DRAFTS_PATH, nextDrafts);
    if (reservasChanged) await window.dbLaJamoneraRest.write(RESERVAS_PATH, nextReservas);
    state.drafts = draftsChanged ? nextDrafts : drafts;
    state.reservas = reservasChanged ? nextReservas : reservas;
  };
  const releaseReservation = async (reason = 'manual') => {
    if (!state.activeReservationId) return;
    const reservation = safeObject(state.reservas[state.activeReservationId]);
    if (!reservation || reservation.status !== 'active') {
      state.activeReservationId = '';
      return;
    }
    const next = {
      ...reservation,
      status: 'released',
      releasedAt: nowTs(),
      releasedReason: reason
    };
    const updated = { ...state.reservas, [state.activeReservationId]: next };
    await window.dbLaJamoneraRest.write(RESERVAS_PATH, updated);
    state.reservas = updated;
    state.activeReservationId = '';
    if (state.reservationTick) {
      clearInterval(state.reservationTick);
      state.reservationTick = null;
    }
    if (state.draftsTick) {
      clearInterval(state.draftsTick);
      state.draftsTick = null;
    }
  };
  const ensureReservationForPlan = async (plan) => {
    if (!plan?.locks?.length) return;
    if (state.activeReservationId) await releaseReservation('refresh');
    const reservationId = makeId('reserva');
    const reservation = {
      id: reservationId,
      recipeId: plan.recipeId,
      draftId: state.activeDraftId || '',
      ownerSessionId: sessionId,
      ownerLabel: getCurrentUserLabel(),
      createdAt: nowTs(),
      expiresAt: nowTs() + RESERVE_TTL_MS,
      status: 'active',
      locks: plan.locks
    };
    const next = { ...state.reservas, [reservationId]: reservation };
    await window.dbLaJamoneraRest.write(RESERVAS_PATH, next);
    state.reservas = next;
    state.activeReservationId = reservationId;
    if (state.reservationTick) clearInterval(state.reservationTick);
    state.reservationTick = setInterval(async () => {
      const remaining = Number(reservation.expiresAt || 0) - nowTs();
      const badge = nodes.editor.querySelector('#produccionReservaTimer');
      if (badge) {
        const mins = Math.max(0, Math.ceil(remaining / 60000));
        badge.textContent = `Reserva temporal: ${mins} min`;
      }
      if (remaining <= 0) {
        await releaseReservation('expired');
        await openIosSwal({
          title: 'Reserva vencida',
          html: '<p>La reserva temporal de stock venció. Recalculamos disponibilidad.</p>',
          icon: 'warning',
          confirmButtonText: 'Entendido'
        });
        await refreshData();
        renderList();
      }
    }, 5000);
  };
  const persistDraft = async (payload) => {
    const draftId = `${sessionId}_${payload.recipeId}`;
    const draft = {
      id: draftId,
      ownerSessionId: sessionId,
      ownerLabel: getCurrentUserLabel(),
      updatedAt: nowTs(),
      ...payload
    };
    const next = { ...state.drafts, [draftId]: draft };
    await window.dbLaJamoneraRest.write(DRAFTS_PATH, next);
    state.drafts = next;
    state.activeDraftId = draftId;
  };
  const discardDraft = async () => {
    if (!state.activeDraftId) return;
    const next = { ...state.drafts };
    delete next[state.activeDraftId];
    await window.dbLaJamoneraRest.write(DRAFTS_PATH, next);
    state.drafts = next;
    state.activeDraftId = '';
    state.activeReservationId = '';
  };
  const getCurrentDraftForRecipe = (recipeId) => {
    const own = Object.values(safeObject(state.drafts)).find((item) => item.recipeId === recipeId && item.ownerSessionId === sessionId);
    return own || null;
  };
  const getOwnDrafts = () => Object.values(safeObject(state.drafts))
    .filter((item) => item.ownerSessionId === sessionId && item.status === 'active' && item.recipeId && getDraftRemainingMs(item) > 0)
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
  const getDraftReservationCountdown = (draft) => {
    const reservationId = normalizeValue(draft?.reservationId);
    if (!reservationId) return null;
    const reservation = safeObject(state.reservas[reservationId]);
    if (reservation.status !== 'active') return null;
    const remainingMs = Number(reservation.expiresAt || 0) - nowTs();
    if (remainingMs <= 0) return null;
    return formatCountdown(remainingMs);
  };
  const getDraftExpirationCountdown = (draft) => {
    const remainingMs = getDraftRemainingMs(draft);
    if (remainingMs <= 0) return null;
    return formatCountdown(remainingMs);
  };
  const getForeignDraftConflict = (recipeId) => Object.values(safeObject(state.drafts)).find((item) => item.recipeId === recipeId && item.ownerSessionId !== sessionId);
  const openGlobalMinConfig = async () => {
    const currentRne = safeObject(state.config.rne);
    const rneHistoryHtml = (Array.isArray(currentRne.history) && currentRne.history.length)
      ? `<div class="produccion-rne-history">${currentRne.history.map((item, index) => `<article class="produccion-rne-history-item" data-rne-history-item="${index}"><div><strong>Versión ${index + 1}</strong><p><strong>N° RNE:</strong> ${escapeHtml(item.number || '-')}</p><p><strong>Vigencia:</strong> ${escapeHtml(formatIsoEs(item.validFrom || ''))} → ${item.replacedAt || item.savedAt ? escapeHtml(formatDateTime(item.replacedAt || item.savedAt)) : '-'}</p><p><strong>Vencimiento declarado:</strong> ${escapeHtml(formatIsoEs(item.expiryDate || ''))}</p></div><div class="produccion-rne-history-actions">${item.attachmentUrl ? `<button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-open-rne-history="${index}"><i class="bi bi-eye"></i><span>Ver</span></button>` : '<button type="button" class="btn ios-btn ios-btn-danger inventario-no-photo-btn" disabled>Sin adjunto</button>'}<button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-delete-rne-history="${index}" aria-label="Eliminar versión de historial"><i class="fa-solid fa-trash"></i></button></div></article>`).join('')}</div>`
      : '<p class="produccion-rne-history-empty">Aún no hay historial de RNE.</p>';
    const result = await openIosSwal({
      title: 'Configuración de Producción',
      html: `<div class="text-center produccion-umbral-form produccion-config-form">
          <label class="form-label" for="produccionGlobalMinInput"><strong>Umbral global de stock bajo (kg)</strong></label>
          <input id="produccionGlobalMinInput" type="number" min="0" step="0.01" class="swal2-input ios-input" value="${Number(state.config.globalMinKg || 1).toFixed(2)}">
          <section class="recipe-step-card step-block inventario-lot-section mt-2 produccion-config-section">
            <button type="button" class="inventario-collapse-head inventario-collapse-head-styled produccion-config-toggle" id="logoCompanyToggleBtn" aria-expanded="false">
              <span><span class="recipe-step-number">2</span> <i class="bi bi-building"></i> <strong>Logo Empresa</strong></span>
              <span class="inventario-collapse-summary"><strong><i class="bi bi-arrows-fullscreen"></i></strong></span>
            </button>
            <div id="logoCompanyBody" class="step-content d-none">
              <div class="produccion-company-logo-preview-wrap">
                <span class="produccion-company-logo-preview" id="produccionCompanyLogoPreview">${normalizeValue(state.config.companyLogoUrl) ? `<img src="${state.config.companyLogoUrl}" alt="Logo empresa">` : '<i class="fa-solid fa-image"></i>'}</span>
              </div>
              <div class="produccion-config-actions">
                <button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" id="produccionOpenLogoViewerBtn" ${normalizeValue(state.config.companyLogoUrl) ? '' : 'disabled'}><i class="fa-regular fa-eye"></i><span>Visualizar logo</span></button>
              </div>
              <input id="produccionCompanyLogoFile" class="form-control ios-input image-file-input" type="file" accept="image/*">
              <small class="text-muted"><strong>Formatos:</strong> JPG, PNG, WEBP o GIF. <strong>Máx:</strong> 5MB.</small>
            </div>
          </section>
          <section class="recipe-step-card step-block inventario-lot-section mt-2 produccion-config-section">
            <button type="button" class="inventario-collapse-head inventario-collapse-head-styled produccion-config-toggle" id="rneToggleBtn" aria-expanded="false">
              <span><span class="recipe-step-number">3</span> <i class="bi bi-shield-check"></i> <strong>RNE</strong> • Empresa</span>
              <span class="inventario-collapse-summary"><strong><i class="bi bi-arrows-fullscreen"></i></strong></span>
            </button>
            <div id="rneBody" class="step-content d-none">
              <label class="form-label" for="produccionRneNumberInput"><strong>Número de RNE</strong></label>
              <input id="produccionRneNumberInput" type="text" class="form-control ios-input" placeholder="Ej: 12-34567" value="${escapeHtml(currentRne.number || '')}">
              <small class="text-muted">Se permiten números y guion (<strong>-</strong>).</small>
              <label class="form-label mt-2" for="produccionRneExpiryInput"><strong>Fecha de caducidad</strong></label>
              <input id="produccionRneExpiryInput" type="text" class="form-control ios-input" placeholder="Seleccionar fecha" value="${escapeHtml(currentRne.expiryDate || '')}">
              <label class="inventario-check-row inventario-check-row-compact mt-2"><input type="checkbox" id="produccionRneInfiniteInput" ${currentRne.infiniteExpiry ? 'checked' : ''}><span>Vencimiento infinito (∞)</span></label>
              <label class="form-label mt-2" for="produccionRneFile"><strong>Archivo adjunto</strong> (PDF o imagen)</label>
              <div class="produccion-rne-file-row">
                <input id="produccionRneFile" class="form-control ios-input image-file-input" type="file" accept="image/*,application/pdf">
                <span id="produccionRneFileLoading" class="produccion-rne-upload-loading d-none"><img src="./IMG/Meta-ai-logo.webp" alt="Subiendo RNE" class="meta-spinner-login produccion-rne-spinner"></span>
              </div>
              <small class="text-muted">Se guarda la versión anterior en el historial.</small>
              <div class="produccion-config-actions">
                <button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" id="produccionOpenRneViewerBtn" ${normalizeValue(currentRne.attachmentUrl) ? '' : 'disabled'}><i class="fa-regular fa-eye"></i><span>Visualizar adjunto actual</span></button>
                <button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" id="produccionDeleteRneBtn" aria-label="Eliminar RNE actual" ${(normalizeValue(currentRne.number) || normalizeValue(currentRne.attachmentUrl) || (Array.isArray(currentRne.history) && currentRne.history.length)) ? '' : 'disabled'}><i class="fa-solid fa-trash"></i></button>
              </div>
              <div class="produccion-rne-history-wrap">
                <h6><strong>Historial de RNE</strong></h6>
                ${rneHistoryHtml}
              </div>
            </div>
          </section>
        </div>`,
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      cancelButtonText: 'Cancelar',
      customClass: {
        popup: 'produccion-umbral-alert'
      },
      didOpen: (popup) => {
        requestAnimationFrame(() => {
          popup.querySelector('#produccionGlobalMinInput')?.focus({ preventScroll: true });
        });
        const setupToggle = (btnId, bodyId) => {
          const toggleBtn = popup.querySelector(btnId);
          const body = popup.querySelector(bodyId);
          toggleBtn?.addEventListener('click', () => {
            const hidden = body?.classList.contains('d-none');
            body?.classList.toggle('d-none', !hidden);
            toggleBtn.setAttribute('aria-expanded', String(hidden));
            toggleBtn.classList.toggle('is-open', Boolean(hidden));
          });
        };
        setupToggle('#logoCompanyToggleBtn', '#logoCompanyBody');
        setupToggle('#rneToggleBtn', '#rneBody');

        const fileInput = popup.querySelector('#produccionCompanyLogoFile');
        const preview = popup.querySelector('#produccionCompanyLogoPreview');
        const logoViewerBtn = popup.querySelector('#produccionOpenLogoViewerBtn');
        const rneViewerBtn = popup.querySelector('#produccionOpenRneViewerBtn');
        const deleteRneBtn = popup.querySelector('#produccionDeleteRneBtn');
        const rneInput = popup.querySelector('#produccionRneNumberInput');

        const setLoading = () => {
          if (!preview) return;
          preview.innerHTML = '<span class="produccion-company-logo-loading"><img src="./IMG/Meta-ai-logo.webp" alt="Cargando logo" class="meta-spinner produccion-company-logo-spinner"></span>';
        };
        const setFallback = () => {
          if (!preview) return;
          preview.innerHTML = '<i class="fa-solid fa-image"></i>';
        };
        const setImage = (url) => {
          const safeUrl = normalizeValue(url);
          if (!safeUrl) {
            setFallback();
            return;
          }
          setLoading();
          const image = new Image();
          image.alt = 'Logo empresa';
          image.src = safeUrl;
          image.onload = () => {
            if (!preview) return;
            preview.innerHTML = '';
            preview.appendChild(image);
          };
          image.onerror = () => {
            setFallback();
          };
        };
        setImage(state.config.companyLogoUrl);
        fileInput?.addEventListener('change', () => {
          const file = fileInput.files?.[0];
          if (!file) {
            setImage(state.config.companyLogoUrl);
            return;
          }
          const tempUrl = URL.createObjectURL(file);
          setImage(tempUrl);
        });
        logoViewerBtn?.addEventListener('click', async () => {
          const activeLogo = fileInput?.files?.[0] ? URL.createObjectURL(fileInput.files[0]) : normalizeValue(state.config.companyLogoUrl);
          if (!activeLogo) return;
          await window.laJamoneraOpenImageViewer?.([{ invoiceImageUrls: [activeLogo] }], 0, 'Logo empresa');
        });
        rneViewerBtn?.addEventListener('click', async () => {
          const currentUrl = normalizeValue(state.config.rne?.attachmentUrl);
          if (!currentUrl) return;
          await window.laJamoneraOpenImageViewer?.([{ invoiceImageUrls: [currentUrl] }], 0, 'Adjunto RNE');
        });

        deleteRneBtn?.addEventListener('click', async () => {
          const confirmDelete = await openIosSwal({
            title: 'Borrar RNE de Producción',
            html: '<p><strong>Confirmación:</strong> se eliminará solo el RNE actual.</p><p><small>El historial se conservará para trazabilidad.</small></p>',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Eliminar',
            cancelButtonText: 'Cancelar'
          });
          if (!confirmDelete.isConfirmed) return;
          state.config.rne = { ...safeObject(state.config.rne), number: '', expiryDate: '', infiniteExpiry: false, attachmentUrl: '', attachmentType: '', validFrom: '', updatedAt: 0 };
          await persistConfig();
          Swal.close();
          await openGlobalMinConfig();
        });
        popup.querySelectorAll('[data-open-rne-history]').forEach((button) => {
          button.addEventListener('click', async () => {
            const index = Number(button.dataset.openRneHistory || -1);
            const item = Array.isArray(state.config.rne?.history) ? state.config.rne.history[index] : null;
            const attachment = normalizeValue(item?.attachmentUrl);
            if (!attachment) return;
            await window.laJamoneraOpenImageViewer?.([{ invoiceImageUrls: [attachment] }], 0, `Historial RNE #${index + 1}`);
          });
        });

        popup.querySelectorAll('[data-delete-rne-history]').forEach((button) => {
          button.addEventListener('click', async () => {
            const index = Number(button.dataset.deleteRneHistory || -1);
            const history = Array.isArray(state.config.rne?.history) ? [...state.config.rne.history] : [];
            if (index < 0 || index >= history.length) return;
            const confirmDelete = await openIosSwal({
              title: 'Borrar versión de historial RNE',
              html: '<p><strong>Confirmación:</strong> se eliminará solo esta versión del historial.</p><p><small>El RNE actual no se modifica.</small></p>',
              icon: 'warning',
              showCancelButton: true,
              confirmButtonText: 'Eliminar',
              cancelButtonText: 'Cancelar'
            });
            if (!confirmDelete.isConfirmed) return;
            history.splice(index, 1);
            state.config.rne = { ...safeObject(state.config.rne), history };
            await persistConfig();
            button.closest('[data-rne-history-item]')?.remove();
          });
        });
        rneInput?.addEventListener('input', () => {
          rneInput.value = rneInput.value.replace(/[^0-9-]/g, '');
        });
        if (window.flatpickr) {
          const locale = window.flatpickr.l10ns?.es || undefined;
          const expiryInput = popup.querySelector('#produccionRneExpiryInput');
          if (expiryInput) {
            window.flatpickr(expiryInput, {
              locale,
              dateFormat: 'Y-m-d',
              altInput: true,
              altFormat: 'd/m/Y',
              allowInput: true,
              disableMobile: true,
              defaultDate: normalizeValue(currentRne.expiryDate) || undefined
            });
          }
        }
        const infiniteInput = popup.querySelector('#produccionRneInfiniteInput');
        const expiryInput = popup.querySelector('#produccionRneExpiryInput');
        const syncInfinite = () => {
          if (!expiryInput) return;
          expiryInput.disabled = Boolean(infiniteInput?.checked);
          if (infiniteInput?.checked) expiryInput.value = '';
        };
        infiniteInput?.addEventListener('change', syncInfinite);
        syncInfinite();
      },
      preConfirm: async () => {
        const value = document.getElementById('produccionGlobalMinInput')?.value;
        const n = parseNumber(value);
        if (!Number.isFinite(n) || n <= 0) {
          Swal.showValidationMessage('Ingresá un valor mayor a 0.');
          return false;
        }
        const rneNumber = normalizeValue(document.getElementById('produccionRneNumberInput')?.value);
        if (rneNumber && !/^[0-9-]+$/.test(rneNumber)) {
          Swal.showValidationMessage('El número de RNE solo admite dígitos y guion (-).');
          return false;
        }
        const rneInfiniteExpiry = Boolean(document.getElementById('produccionRneInfiniteInput')?.checked);
        const rneExpiryDate = rneInfiniteExpiry ? '' : normalizeValue(document.getElementById('produccionRneExpiryInput')?.value);

        const file = document.getElementById('produccionCompanyLogoFile')?.files?.[0];
        let companyLogoUrl = normalizeValue(state.config.companyLogoUrl);
        if (file) {
          const preview = document.getElementById('produccionCompanyLogoPreview');
          if (preview) {
            preview.innerHTML = '<span class="produccion-company-logo-loading"><img src="./IMG/Meta-ai-logo.webp" alt="Subiendo logo" class="meta-spinner produccion-company-logo-spinner"></span>';
          }
          if (!ALLOWED_UPLOAD_TYPES.includes(file.type)) {
            Swal.showValidationMessage('Formato de logo no admitido.');
            return false;
          }
          if (file.size > MAX_UPLOAD_SIZE_BYTES) {
            Swal.showValidationMessage('El logo supera 5MB.');
            return false;
          }
          try {
            companyLogoUrl = await uploadImageToStorage(file, 'produccion/logo_empresa');
          } catch (error) {
            Swal.showValidationMessage('No se pudo subir el logo a Firebase Storage.');
            return false;
          }
        }

        const rneFile = document.getElementById('produccionRneFile')?.files?.[0];
        const rneLoading = document.getElementById('produccionRneFileLoading');
        const previousRne = safeObject(state.config.rne);
        let nextRneAttachmentUrl = normalizeValue(previousRne.attachmentUrl);
        let nextRneAttachmentType = normalizeValue(previousRne.attachmentType);
        const nextHistory = Array.isArray(previousRne.history) ? [...previousRne.history] : [];

        if (rneFile) {
          if (!ALLOWED_RNE_UPLOAD_TYPES.includes(rneFile.type)) {
            Swal.showValidationMessage('Adjunto RNE inválido. Permitido: PDF o imagen.');
            return false;
          }
          if (rneFile.size > MAX_UPLOAD_SIZE_BYTES) {
            Swal.showValidationMessage('El adjunto de RNE supera 5MB.');
            return false;
          }
          if (normalizeValue(previousRne.attachmentUrl)) {
            nextHistory.unshift({
              number: normalizeValue(previousRne.number),
              validFrom: normalizeValue(previousRne.validFrom || toIsoDate(previousRne.updatedAt || nowTs())),
              expiryDate: normalizeValue(previousRne.expiryDate),
              attachmentUrl: normalizeValue(previousRne.attachmentUrl),
              attachmentType: normalizeValue(previousRne.attachmentType),
              savedAt: nowTs(),
              replacedAt: nowTs()
            });
          }
          try {
            rneLoading?.classList.remove('d-none');
            nextRneAttachmentUrl = await uploadImageToStorage(rneFile, 'produccion/rne');
            nextRneAttachmentType = rneFile.type;
          } catch (error) {
            Swal.showValidationMessage('No se pudo subir el archivo de RNE a Firebase Storage.');
            return false;
          } finally {
            rneLoading?.classList.add('d-none');
          }
        }
        return {
          minKg: n,
          companyLogoUrl,
          rne: {
            number: rneNumber,
            expiryDate: rneExpiryDate,
            infiniteExpiry: rneInfiniteExpiry,
            attachmentUrl: nextRneAttachmentUrl,
            attachmentType: nextRneAttachmentType,
            updatedAt: nowTs(),
            validFrom: rneFile ? toIsoDate(nowTs()) : (normalizeValue(previousRne.validFrom) || toIsoDate(nowTs())),
            history: nextHistory
          }
        };
      }
    });
    if (!result.isConfirmed) return;
    state.config.globalMinKg = Number(result.value.minKg.toFixed(2));
    state.config.companyLogoUrl = normalizeValue(result.value.companyLogoUrl);
    state.config.rne = {
      ...safeObject(state.config.rne),
      ...safeObject(result.value.rne)
    };
    await persistConfig();
    recomputeAnalysis();
    renderList();
  };
  const openRecipeMinConfig = async (recipeId) => {
    const currentRaw = state.config.recipeMinKg?.[recipeId];
    const result = await openIosSwal({
      title: 'Umbral por producto',
      html: `<div class="text-center produccion-umbral-form">
          <label class="form-label" for="produccionRecipeMinInput">Umbral de stock (kg)</label>
          <input id="produccionRecipeMinInput" type="number" min="0" step="0.01" class="swal2-input ios-input" value="${normalizeValue(currentRaw)}" placeholder="Vacío = usar global">
        </div>`,
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      cancelButtonText: 'Cancelar',
      customClass: {
        popup: 'produccion-umbral-alert'
      },
      preConfirm: () => {
        const value = normalizeValue(document.getElementById('produccionRecipeMinInput')?.value);
        if (!value) return null;
        const n = parseNumber(value);
        if (!Number.isFinite(n) || n <= 0) {
          Swal.showValidationMessage('Ingresá un valor mayor a 0 o dejá vacío para usar global.');
          return false;
        }
        return n;
      }
    });
    if (!result.isConfirmed) return;
    if (result.value == null) {
      delete state.config.recipeMinKg[recipeId];
    } else {
      state.config.recipeMinKg[recipeId] = Number(result.value.toFixed(2));
    }
    await persistConfig();
    recomputeAnalysis();
    renderList();
  };
  const getUserByManagerToken = (token) => {
    const key = normalizeValue(token);
    if (!key) return null;
    const users = Object.values(safeObject(state.users));
    return users.find((user) => {
      const options = [
        user?.id,
        user?.email,
        user?.fullName,
        user?.name
      ].map(normalizeLower).filter(Boolean);
      return options.includes(normalizeLower(key));
    }) || null;
  };
  const getManagerDisplay = (token) => {
    const user = getUserByManagerToken(token);
    const raw = normalizeValue(token);
    const fallbackName = raw && !raw.startsWith('usr_') ? raw : 'Sin responsable';
    return {
      name: normalizeValue(user?.fullName || user?.name) || fallbackName,
      role: normalizeValue(user?.position || user?.role || user?.sector) || 'Encargado'
    };
  };
  const getManagerLabel = (item) => {
    const managers = Array.isArray(item?.managers) ? item.managers : [];
    const first = managers[0] || item?.createdBy || '';
    return getManagerDisplay(first);
  };
  const getHistoryRows = () => {
    const [from, to] = normalizeValue(state.historyRange).split(' a ').map((item) => normalizeValue(item));
    const query = normalizeLower(state.historySearch);
    const fromTs = from ? new Date(`${from}T00:00:00`).getTime() : 0;
    const toTs = to ? new Date(`${to}T23:59:59`).getTime() : 0;
    return getRegistrosList()
      .filter((item) => {
        const createdAt = Number(item?.createdAt || 0);
        if (fromTs && createdAt < fromTs) return false;
        if (toTs && createdAt > toTs) return false;
        if (!query) return true;
        const blob = [item?.id, item?.recipeTitle, item?.productionDate, item?.status].map(normalizeLower).join(' ');
        return blob.includes(query);
      })
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  };
  const getTraceRowsFromRegistro = (registro) => (Array.isArray(registro?.lots) ? registro.lots : [])
    .flatMap((ingredientPlan) => (Array.isArray(ingredientPlan?.lots) ? ingredientPlan.lots : []).map((lot, index) => ({
      id: `${registro.id}_${ingredientPlan.ingredientId || 'ing'}_${lot.entryId || index}`,
      index: index + 1,
      createdAt: Number(lot?.producedAt || registro?.createdAt || 0),
      ingredientId: ingredientPlan?.ingredientId || '',
      ingredientName: normalizeValue(ingredientPlan?.ingredientName) || 'Ingrediente',
      ingredientImageUrl: normalizeValue(state.ingredientes?.[ingredientPlan?.ingredientId]?.imageUrl),
      expiryDate: normalizeValue(lot?.expiryDate) || '-',
      amount: `${Number(lot?.takeQty || 0).toFixed(3)} ${lot?.unit || ingredientPlan?.unit || ''}`.trim(),
      lotNumber: normalizeValue(lot?.lotNumber || lot?.entryId || lot?.invoiceNumber) || '-',
      invoiceImageUrls: Array.isArray(lot?.invoiceImageUrls) ? lot.invoiceImageUrls : []
    })));
  const markProductionExport = async (productionId, type) => {
    const registros = deepClone(state.registros);
    const reg = registros[productionId];
    if (!reg) return;
    reg.exports = safeObject(reg.exports);
    reg.exports[type] = nowTs();
    reg.auditTrail = Array.isArray(reg.auditTrail) ? reg.auditTrail : [];
    reg.auditTrail.unshift({ action: `export_${type}`, user: getCurrentUserLabel(), at: nowTs() });
    registros[productionId] = reg;
    await window.dbLaJamoneraRest.write(REGISTROS_PATH, registros);
    state.registros = registros;
  };
  const reportHtml = (registro, withAttachments = true) => {
    const lotRows = (registro.lots || []).map((item) => `
      <tr><td colspan="10" style="background:#eef3ff;font-weight:700">${escapeHtml(item.ingredientName || item.ingredientId)}</td></tr>
      ${(item.lots || []).map((lot) => `<tr>
        <td>${escapeHtml(lot.entryId || '-')}</td>
        <td>${escapeHtml(lot.entryDate || '-')}</td>
        <td>${escapeHtml(formatExpiryHuman(lot.expiryDate))}</td>
        <td>${Number(lot.takeQty || 0).toFixed(2)}</td>
        <td>${escapeHtml(lot.unit || '')}</td>
        <td>${escapeHtml(lot.provider || '-')}</td>
        <td>${escapeHtml(lot.invoiceNumber || '-')}</td>
        <td>${withAttachments ? (Array.isArray(lot.invoiceImageUrls) ? lot.invoiceImageUrls.length : 0) : '-'}</td>
        <td>${escapeHtml(lot.status || '-')}</td>
        <td>${escapeHtml(lot.productionDate || registro.productionDate || '-')}</td>
      </tr>`).join('')}
    `).join('');
    return `
      <div class="report-viewer-content-wrap" style="text-align:left">
        <h3 style="margin:0 0 6px">Informe de producción ${escapeHtml(registro.id)}</h3>
        <p><strong>Producto:</strong> ${escapeHtml(registro.recipeTitle || '-')} · <strong>Fecha:</strong> ${escapeHtml(registro.productionDate || '-')} · <strong>Estado:</strong> ${escapeHtml(registro.status || '-')}</p>
        <p><strong>Cantidad:</strong> ${Number(registro.quantityKg || 0).toFixed(2)} kg · <strong>Encargados:</strong> ${escapeHtml((registro.managers || []).join(', ') || 'Sin asignar')}</p>
        <p><strong>Observaciones:</strong> ${escapeHtml(registro.observations || '-')}</p>
        <div style="overflow:auto"><table style="width:100%;border-collapse:collapse" border="1" cellpadding="6">
          <thead><tr><th>Lote</th><th>Ingreso</th><th>Vence</th><th>Cantidad</th><th>Unidad</th><th>Proveedor</th><th>Factura</th><th>Adjuntos</th><th>Estado</th><th>Fecha/Hora</th></tr></thead>
          <tbody>${lotRows || '<tr><td colspan="10">Sin lotes</td></tr>'}</tbody>
        </table></div>
      </div>`;
  };
  const printReport = async (registro) => {
    const include = await openIosSwal({
      title: 'Imprimir informe',
      html: '<p>¿Incluir facturas, remitos e imágenes adjuntas?</p>',
      showDenyButton: true,
      showCancelButton: true,
      confirmButtonText: 'Sí, incluir',
      denyButtonText: 'No incluir',
      cancelButtonText: 'Cancelar',
      customClass: { denyButton: 'ios-btn ios-btn-danger' }
    });
    if (!include.isConfirmed && !include.isDenied) return;
    const win = window.open('', '_blank', 'width=1200,height=900');
    if (!win) return;
    win.document.write(`<html><head><title>${registro.id}</title></head><body>${reportHtml(registro, include.isConfirmed)}</body></html>`);
    win.document.close();
    win.focus();
    win.print();
    await markProductionExport(registro.id, 'print');
  };

  const getProductionTraceUrl = (registro) => {
    if (window.laJamoneraPlanillaProduccion?.getTraceUrl) {
      return window.laJamoneraPlanillaProduccion.getTraceUrl(registro);
    }
    return `https://www.lajamonera.online/produccion_publica.html?id=${encodeURIComponent(normalizeValue(registro?.id))}`;
  };

  const getQrPrintSizeConfig = (value) => {
    const item = QR_PRINT_SIZES.find((size) => size.value === value);
    return item || QR_PRINT_SIZES[0];
  };

  const loadImageFromDataUrl = (src) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo generar el QR para impresión.'));
    img.src = src;
  });

  const getQrDataUrl = async (text) => {
    const ready = await ensureQrCodeLib();
    if (!ready || !window.QRCode) return '';
    const holder = document.createElement('div');
    holder.style.cssText = 'position:fixed;left:-99999px;top:-99999px;width:240px;height:240px;';
    document.body.appendChild(holder);
    try {
      // eslint-disable-next-line no-new
      new window.QRCode(holder, { text, width: 220, height: 220, colorDark: '#111827', colorLight: '#ffffff' });
      await new Promise((resolve) => setTimeout(resolve, 120));
      const canvas = holder.querySelector('canvas');
      if (canvas?.toDataURL) return canvas.toDataURL('image/png');
      const img = holder.querySelector('img');
      return normalizeValue(img?.src);
    } finally {
      holder.remove();
    }
  };

  const drawRoundRect = (ctx, x, y, w, h, radius) => {
    const r = Math.max(0, Math.min(radius, Math.min(w, h) / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };

  const wrapTextLines = (ctx, text, maxWidth) => {
    const words = String(text || '').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return ['-'];
    const lines = [];
    let line = '';
    words.forEach((word) => {
      const trial = line ? `${line} ${word}` : word;
      if (ctx.measureText(trial).width <= maxWidth || !line) {
        line = trial;
      } else {
        lines.push(line);
        line = word;
      }
    });
    if (line) lines.push(line);
    return lines;
  };


  const fitFontSizeByWidth = (ctx, textList, weight, startPx, minPx, maxWidth) => {
    const values = Array.isArray(textList) ? textList.filter(Boolean) : [textList].filter(Boolean);
    let size = Math.max(minPx, startPx);
    while (size > minPx) {
      ctx.font = `${weight} ${size}px Inter, Arial, sans-serif`;
      const widest = values.reduce((max, item) => Math.max(max, ctx.measureText(String(item)).width), 0);
      if (widest <= maxWidth) return size;
      size -= 1;
    }
    return minPx;
  };

  const splitProductionId = (raw) => {
    const value = normalizeValue(raw) || '-';
    const tokens = value.split('-').filter(Boolean);
    if (tokens.length <= 2) return [value];
    const first = tokens.slice(0, 2).join('-');
    const second = tokens.slice(2).join('-');
    return second ? [first, second] : [first];
  };

  const buildProductionQrCanvas = ({ registro, qrImage, sizeConfig }) => {
    const scale = 12;
    const width = Math.max(360, Math.round(sizeConfig.widthMm * scale));
    const height = Math.max(250, Math.round(sizeConfig.heightMm * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    const pagePad = Math.round(Math.min(width, height) * 0.055);
    const cardX = pagePad;
    const cardY = pagePad;
    const cardW = width - (pagePad * 2);
    const cardH = height - (pagePad * 2);

    drawRoundRect(ctx, cardX, cardY, cardW, cardH, Math.round(cardH * 0.09));
    ctx.fillStyle = '#fefefe';
    ctx.fill();
    ctx.strokeStyle = '#cfdaf2';
    ctx.lineWidth = Math.max(2, Math.round(Math.min(cardW, cardH) * 0.012));
    ctx.stroke();

    const contentPad = Math.round(cardH * 0.10);
    const qrSize = Math.round(Math.min(cardH - contentPad * 2, cardW * 0.35));
    const qrX = cardX + contentPad;
    const qrY = cardY + (cardH - qrSize) / 2;
    ctx.drawImage(qrImage, qrX, qrY, qrSize, qrSize);

    const textX = qrX + qrSize + Math.round(cardW * 0.08);
    const textW = Math.max(80, cardX + cardW - contentPad - textX);
    const title = 'PRODUCCION • LA JAMONERA';
    const idLines = splitProductionId(registro?.id);

    const titleFont = fitFontSizeByWidth(ctx, title, 800, Math.round(cardH * 0.105), Math.max(14, Math.round(cardH * 0.07)), textW);
    ctx.fillStyle = '#1a2f5c';
    ctx.font = `800 ${titleFont}px Inter, Arial, sans-serif`;
    const titleY = cardY + contentPad + titleFont;
    ctx.fillText(title, textX, titleY);

    const idFont = fitFontSizeByWidth(ctx, idLines, 900, Math.round(cardH * 0.18), Math.max(16, Math.round(cardH * 0.1)), textW);
    ctx.fillStyle = '#2452a6';
    ctx.font = `900 ${idFont}px Inter, Arial, sans-serif`;
    let idY = titleY + Math.round(idFont * 0.95);
    idLines.forEach((line) => {
      ctx.fillText(line, textX, idY);
      idY += Math.round(idFont * 0.98);
    });

    const noteBase = Math.max(13, Math.round(cardH * 0.075));
    const noteNormal = fitFontSizeByWidth(ctx, 'Escaneá el QR con tu celular para acceder a la', 500, noteBase, 12, textW);
    const noteBold = fitFontSizeByWidth(ctx, 'trazabilidad completa del producto.', 800, Math.max(noteNormal, noteBase), 12, textW);
    const note1 = wrapTextLines(ctx, 'Escaneá el QR con tu celular para acceder a la', textW);
    ctx.fillStyle = '#4d628f';
    ctx.font = `500 ${noteNormal}px Inter, Arial, sans-serif`;
    const noteLineH = Math.round(noteNormal * 1.18);
    let noteY = Math.max(idY + Math.round(cardH * 0.02), cardY + cardH - contentPad - (noteLineH * (note1.length + 1)));
    note1.forEach((line) => {
      ctx.fillText(line, textX, noteY);
      noteY += noteLineH;
    });

    ctx.fillStyle = '#304f8c';
    ctx.font = `800 ${noteBold}px Inter, Arial, sans-serif`;
    ctx.fillText('trazabilidad completa del producto.', textX, noteY);

    return canvas;
  };

  const buildPdfFromQrCanvases = (canvases, sizeConfig) => {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      throw new Error('No se pudo cargar la librería PDF.');
    }
    const { jsPDF } = window.jspdf;
    const orientation = sizeConfig.widthMm > sizeConfig.heightMm ? 'landscape' : 'portrait';
    const pdf = new jsPDF({ orientation, unit: 'mm', format: [sizeConfig.widthMm, sizeConfig.heightMm] });
    canvases.forEach((canvas, index) => {
      if (index > 0) pdf.addPage([sizeConfig.widthMm, sizeConfig.heightMm], orientation);
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, sizeConfig.widthMm, sizeConfig.heightMm, undefined, 'FAST');
    });
    return pdf;
  };

  const openProductionQrPrintConfigurator = async (registro) => {
    const qrDataUrl = await getQrDataUrl(getProductionTraceUrl(registro));
    if (!qrDataUrl) {
      await openIosSwal({ title: 'QR no disponible', html: '<p>No pudimos generar el código QR para esta producción.</p>', icon: 'warning', confirmButtonText: 'Entendido' });
      return;
    }

    const qrImage = await loadImageFromDataUrl(qrDataUrl);

    const result = await openIosSwal({
      title: `Impresión · QR ${escapeHtml(registro.id || '')}`,
      width: 820,
      customClass: {
        popup: 'recipe-print-alert produccion-qr-print-alert',
        denyButton: 'ios-btn ios-btn-success'
      },
      html: `
        <div class="recipe-print-panel">
          <div class="recipe-print-controls">
            <label class="recipe-print-field">
              <span>Tamaño de hoja</span>
              <select id="printQrSheetType" class="form-select ios-input">
                ${QR_PRINT_SIZES.map((item) => `<option value="${item.value}">${item.label}</option>`).join('')}
              </select>
            </label>
            <label class="recipe-print-field">
              <span>Cantidad por hoja</span>
              <input id="printQrPerSheet" type="number" min="1" step="1" value="1" class="form-control ios-input" disabled>
            </label>
            <label class="recipe-print-field">
              <span>Cantidad de hojas</span>
              <input id="printQrSheetCount" type="number" min="1" step="1" value="1" class="form-control ios-input">
            </label>
          </div>
          <div class="recipe-print-meta" id="printQrLayoutMeta"></div>
          <div class="recipe-print-preview-wrap produccion-qr-preview-wrap" id="printQrPreviewPages"></div>
        </div>
      `,
      showCancelButton: true,
      cancelButtonText: 'Cerrar',
      showDenyButton: true,
      denyButtonText: 'Descargar',
      confirmButtonText: 'Imprimir',
      didOpen: (popup) => {
        const panel = popup.querySelector('.recipe-print-panel');
        const sheetTypeNode = panel.querySelector('#printQrSheetType');
        const perSheetNode = panel.querySelector('#printQrPerSheet');
        const sheetCountNode = panel.querySelector('#printQrSheetCount');
        const metaNode = panel.querySelector('#printQrLayoutMeta');
        const previewPagesNode = panel.querySelector('#printQrPreviewPages');

        const panelState = { sheet: QR_PRINT_SIZES[0].value, perSheet: 1, sheetCount: 1 };

        const normalizePanel = () => {
          panelState.sheet = getQrPrintSizeConfig(sheetTypeNode.value).value;
          panelState.perSheet = 1;
          panelState.sheetCount = Math.max(1, Math.floor(Number(sheetCountNode.value) || 1));
          perSheetNode.value = '1';
          sheetCountNode.value = String(panelState.sheetCount);
          panel.dataset.sheet = panelState.sheet;
          panel.dataset.perSheet = '1';
          panel.dataset.sheetCount = String(panelState.sheetCount);
        };

        const drawPreview = () => {
          const sizeConfig = getQrPrintSizeConfig(panelState.sheet);
          const pageCanvas = buildProductionQrCanvas({ registro, qrImage, sizeConfig });
          const previewCount = Math.min(8, panelState.sheetCount);
          previewPagesNode.innerHTML = '';
          for (let index = 0; index < previewCount; index += 1) {
            const image = document.createElement('img');
            image.className = 'recipe-print-preview-canvas produccion-qr-preview-page';
            image.alt = `Preview ${index + 1}`;
            image.src = pageCanvas.toDataURL('image/png');
            previewPagesNode.appendChild(image);
          }
          if (panelState.sheetCount > previewCount) {
            const extra = document.createElement('p');
            extra.className = 'produccion-qr-preview-extra';
            extra.textContent = `+${panelState.sheetCount - previewCount} hoja(s) más`;
            previewPagesNode.appendChild(extra);
          }
          metaNode.innerHTML = `
            <strong>${escapeHtml(normalizeValue(registro.id) || 'Producción')}</strong>
            <span>Formato: ${sizeConfig.label}</span>
            <span>Disposición: 1 fila(s) × 1 columna(s)</span>
            <span>Cantidad por hoja: 1</span>
            <span>Cantidad de hojas: ${panelState.sheetCount}</span>
          `;
        };

        sheetTypeNode.addEventListener('change', () => {
          normalizePanel();
          drawPreview();
        });
        sheetCountNode.addEventListener('input', () => {
          normalizePanel();
          drawPreview();
        });

        normalizePanel();
        drawPreview();
      },
      preConfirm: () => {
        const panel = Swal.getPopup().querySelector('.recipe-print-panel');
        return {
          action: 'print',
          sheet: panel.dataset.sheet,
          perSheet: 1,
          sheetCount: Number(panel.dataset.sheetCount)
        };
      },
      preDeny: () => {
        const panel = Swal.getPopup().querySelector('.recipe-print-panel');
        return {
          action: 'download',
          sheet: panel.dataset.sheet,
          perSheet: 1,
          sheetCount: Number(panel.dataset.sheetCount)
        };
      }
    });

    if (!result.isConfirmed && !result.isDenied) return;

    const config = result.value || {};
    const sizeConfig = getQrPrintSizeConfig(config.sheet);
    const canvases = Array.from({ length: Math.max(1, Number(config.sheetCount) || 1) }, () => buildProductionQrCanvas({ registro, qrImage, sizeConfig }));
    const pdf = buildPdfFromQrCanvases(canvases, sizeConfig);
    const safeName = `${normalizeLower(normalizeValue(registro?.id) || 'produccion').replace(/[^a-z0-9]+/g, '-') || 'produccion'}-qr-${sizeConfig.value}`;

    if (config.action === 'download') {
      pdf.save(`${safeName}.pdf`);
      window.laJamoneraNotify?.show({ type: 'success', title: 'Descarga lista', message: 'Se descargó el PDF de impresión.' });
      return;
    }

    const pdfBlob = pdf.output('blob');
    const pdfUrl = URL.createObjectURL(pdfBlob);
    const printWindow = window.open(pdfUrl, '_blank');
    if (!printWindow) {
      URL.revokeObjectURL(pdfUrl);
      window.laJamoneraNotify?.show({ type: 'error', title: 'Bloqueado', message: 'Permití ventanas emergentes para imprimir.' });
      return;
    }

    const releaseUrl = () => setTimeout(() => URL.revokeObjectURL(pdfUrl), 60000);
    printWindow.addEventListener('load', () => {
      setTimeout(() => {
        try { printWindow.focus(); printWindow.print(); } catch (e) {}
        releaseUrl();
      }, 600);
    }, { once: true });
  };

  const exportProductionExcel = async (registro) => {
    if (!window.ExcelJS) return;
    const wb = new window.ExcelJS.Workbook();
    const ws = wb.addWorksheet('Producción');
    ws.columns = [
      { header: 'Producción', key: 'id', width: 22 },
      { header: 'Fecha y hora', key: 'fechaHora', width: 20 },
      { header: 'Producto', key: 'producto', width: 24 },
      { header: 'Cantidad kg', key: 'kg', width: 14 },
      { header: 'Responsable', key: 'responsable', width: 24 },
      { header: 'Puesto', key: 'puesto', width: 18 },
      { header: 'Ingrediente', key: 'ingrediente', width: 24 },
      { header: 'Lote', key: 'lote', width: 22 },
      { header: 'Tomado', key: 'cantidad', width: 14 },
      { header: 'Quedó', key: 'restante', width: 14 },
      { header: 'Proveedor', key: 'proveedor', width: 20 }
    ];
    const manager = getManagerLabel(registro);
    (registro.lots || []).forEach((item) => {
      (item.lots || []).forEach((lot) => {
        const totalBefore = Number(lot.availableQty || 0);
        const used = Number(lot.takeQty || 0);
        ws.addRow({
          id: registro.id,
          fechaHora: formatDateTime(registro.createdAt),
          producto: registro.recipeTitle,
          kg: Number(registro.quantityKg || 0),
          responsable: manager.name,
          puesto: manager.role,
          ingrediente: item.ingredientName || item.ingredientId,
          lote: lot.entryId,
          cantidad: `${used.toFixed(2)} ${lot.unit || ''}`,
          restante: `${Math.max(0, totalBefore - used).toFixed(2)} ${lot.unit || ''}`,
          proveedor: lot.provider || '-'
        });
      });
    });
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${registro.id}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    await markProductionExport(registro.id, 'excel');
  };
  const exportProductionPdf = async (registro) => {
    if (!window.jspdf?.jsPDF) return;
    const doc = new window.jspdf.jsPDF();
    doc.setFontSize(12);
    doc.text(`Producción ${registro.id}`, 10, 12);
    doc.text(`Producto: ${registro.recipeTitle || '-'}`, 10, 20);
    doc.text(`Fecha: ${formatDateTime(registro.createdAt)} / Estado: ${registro.status || '-'}`, 10, 28);
    doc.text(`Cantidad: ${Number(registro.quantityKg || 0).toFixed(2)} kg`, 10, 36);
    doc.text(`Encargados: ${(registro.managers || []).join(', ') || '-'}`, 10, 44);
    doc.save(`${registro.id}.pdf`);
    await markProductionExport(registro.id, 'pdf');
  };
  const loadExternalScript = (src, id) => new Promise((resolve) => {
    const existing = document.getElementById(id);
    if (existing) {
      if (existing.dataset.loaded === 'true') {
        resolve(true);
        return;
      }
      existing.addEventListener('load', () => resolve(true), { once: true });
      existing.addEventListener('error', () => resolve(false), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.id = id;
    script.src = src;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = 'true';
      resolve(true);
    };
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
  const loadScriptFromSources = async (sources, idPrefix) => {
    for (let index = 0; index < sources.length; index += 1) {
      const ok = await loadExternalScript(sources[index], `${idPrefix}_${index}`);
      if (ok) return true;
    }
    return false;
  };
  const ensureTraceDiagramLib = async () => {
    if (window.mermaid) return true;
    if (window.__laJamoneraLoadingMermaid) return window.__laJamoneraLoadingMermaid;
    window.__laJamoneraLoadingMermaid = (async () => {
      const loaded = await loadScriptFromSources([
        'https://unpkg.com/mermaid@10/dist/mermaid.min.js',
        'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js'
      ], 'la-jamonera-mermaid');
      if (!loaded || !window.mermaid) return false;
      window.mermaid.initialize({
        startOnLoad: false,
        theme: 'base',
        securityLevel: 'loose',
        themeVariables: {
          primaryColor: '#eef4ff',
          primaryTextColor: '#223f78',
          primaryBorderColor: '#c4d5f5',
          lineColor: '#6e88bc',
          tertiaryColor: '#ffffff',
          fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif'
        }
      });
      return true;
    })();
    return window.__laJamoneraLoadingMermaid;
  };
  const buildTraceMermaidDefinition = (registro) => {
    const isMobileTrace = Boolean(window.matchMedia && window.matchMedia('(max-width: 768px)').matches);
    const esc = (value) => String(value || '-')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
    const safeNodeId = (value, fallback) => {
      const base = String(value || fallback || 'X').replace(/[^a-zA-Z0-9_]/g, '_');
      return /^[a-zA-Z_]/.test(base) ? base : `N_${base}`;
    };
    const ingredients = Array.isArray(registro?.lots) ? registro.lots : [];
    const totalIngredientsKg = ingredients.reduce((sum, item) => sum + getIngredientPlanQtyKg(item), 0);
    const mermaKg = Math.max(0, totalIngredientsKg - Number(registro?.quantityKg || 0));
    const manager = (Array.isArray(registro?.managers) && registro.managers[0]) ? getManagerDisplay(registro.managers[0]).name : 'Sin encargado';
    const productionDate = normalizeValue(registro?.productionDate) || toIsoDate(registro?.createdAt || nowTs());
    const packaging = resolvePackagingFromRegistro(registro);
    const companyRne = resolveCompanyRneFromRegistro(registro);
    const productRnpa = resolveRecipeRnpaFromRegistro(registro);
    const productRnpaNumber = normalizeValue(productRnpa.number || '-');
    const productRnpaLabel = normalizeValue(productRnpa.denomination || productRnpa.brand || productRnpa.businessName || registro?.recipeTitle || '-');

    const lines = [
      `flowchart ${isMobileTrace ? 'TB' : 'LR'}`,
      `C["<b>${esc(COMPANY_LEGAL_NAME)}</b>"]:::toneCompany`,
      `CR["<b>RNE EMPRESA</b><br/>${esc(companyRne.number || '-')} "]:::toneRegistry`,
      `P["<b>${esc((registro?.recipeTitle || 'Producto').toUpperCase())}</b>"]:::toneProduct`,
      `RNPA["<b>RNPA</b><br/>N° ${esc(productRnpaNumber)}<br/>${esc(productRnpaLabel)}"]:::toneRegistry`,
      `R["<b>PRODUCCIÓN</b> ${Number(registro?.quantityKg || 0).toFixed(2)} KG<br/><b>Fecha:</b> ${esc(formatIsoEs(productionDate))}"]:::toneProduction`,
      `L["<b>LOTE:</b> ${esc(registro?.id || '-')}<br/><b>VTO:</b> ${esc(formatProductExpiryLabel(registro))}"]:::toneLot`,
      `M["<b>ENCARGADO:</b> ${esc(manager)}"]:::toneManager`,
      `I["<b>INGREDIENTES TOTALES</b> ${totalIngredientsKg.toFixed(3)} KG"]:::toneIngredients`,
      `W["<b>MERMA</b> ${mermaKg.toFixed(3)} KG"]:::toneWaste`,
      'C --> CR',
      'C --> P',
      'P -.-> RNPA',
      'P --> R',
      'R --> L',
      'R --> M',
      'R --> I',
      'I --> W'
    ];

    if (packaging.agingDays > 0 && packaging.packagingDate) {
      lines.push(`E["<b>ENVASADO</b><br/><b>+${packaging.agingDays} días</b><br/>${esc(formatIsoEs(packaging.packagingDate))}"]:::toneManager`);
      lines.push('R -.-> E');
    }

    ingredients.forEach((item, index) => {
      const lots = Array.isArray(item?.lots) && item.lots.length ? item.lots : [{}];
      const nodeId = safeNodeId(`ING_${index + 1}_${item?.ingredientId || ''}`, `ING_${index + 1}`);
      const nodeLabel = [
        `<b>${index + 1}. ${esc((item?.ingredientName || 'Ingrediente').toUpperCase())}</b>`,
        `<b>Usado total:</b> ${esc(formatCompactQty(item?.requiredQty ?? item?.neededQty, item?.unit || item?.ingredientUnit || ''))}`,
        `<b>Lotes usados:</b> ${lots.length}`
      ].join('<br/>');
      lines.push(`${nodeId}["${nodeLabel}"]:::toneIngredient`);
      lines.push(`I --> ${nodeId}`);
      let previousLotNodeId = '';
      lots.forEach((lot, lotIndex) => {
        const lotNodeId = `${nodeId}_LOT_${lotIndex + 1}`;
        const rneId = `${lotNodeId}_RNE`;
        const providerRne = resolveProviderRneFromLot(lot);
        const lotQty = Number(lot?.takeQty || 0);
        lines.push(`${lotNodeId}["<b>LOTE ${lotIndex + 1}</b><br/>${esc(lot?.lotNumber || lot?.entryId || '-')}<br/><b>Usado:</b> ${esc(formatCompactQty(lotQty, lot?.unit || item?.unit || item?.ingredientUnit || ''))}<br/><b>Proveedor:</b> ${esc(lot?.provider || '-')}"]:::toneLot`);
        lines.push(`${rneId}["<b>RNE PROVEEDOR</b><br/>${esc(providerRne.number || '-')}"]:::toneRegistry`);
        lines.push(`${nodeId} -.->|LOTE ${lotIndex + 1}| ${lotNodeId}`);
        lines.push(`${lotNodeId} -.->|RNE| ${rneId}`);
        if (previousLotNodeId) lines.push(`${previousLotNodeId} -.-> ${lotNodeId}`);
        previousLotNodeId = lotNodeId;
      });
    });

    lines.push('linkStyle default stroke:#6e83a7,stroke-width:1.8px;');
    lines.push('classDef toneCompany fill:#2f6ecf,stroke:#1f57ad,color:#ffffff,stroke-width:1.8px;');
    lines.push('classDef toneProduct fill:#3b82f6,stroke:#1f5ec4,color:#ffffff,stroke-width:1.7px;');
    lines.push('classDef toneLot fill:#ffedd1,stroke:#e4b674,color:#704b1e,stroke-width:1.4px;');
    lines.push('classDef toneProduction fill:#ffe7a9,stroke:#dbb867,color:#6b4f16,stroke-width:1.55px;');
    lines.push('classDef toneManager fill:#ece0ff,stroke:#c0a2ea,color:#4f3a7d,stroke-width:1.35px;');
    lines.push('classDef toneIngredients fill:#d1f2df,stroke:#89c8a5,color:#1a5e3f,stroke-width:1.45px;');
    lines.push('classDef toneWaste fill:#ffd8de,stroke:#e994a4,color:#7d2233,stroke-width:1.4px;');
    lines.push('classDef toneIngredient fill:#eaf1ff,stroke:#9fb9e6,color:#173f78,stroke-width:1.35px;');
    lines.push('classDef toneRegistry fill:#e7efff,stroke:#8eaedf,color:#173d73,stroke-width:1.35px;');
    return lines.join('\n');
  };

  const renderTraceabilityFallbackDiagram = (registro) => {
    const ingredients = Array.isArray(registro?.lots) ? registro.lots : [];
    const manager = (Array.isArray(registro?.managers) && registro.managers[0])
      ? getManagerDisplay(registro.managers[0]).name
      : 'Sin encargado';
    const productionDate = normalizeValue(registro?.productionDate) || toIsoDate(registro?.createdAt || nowTs());
    const companyRne = resolveCompanyRneFromRegistro(registro);
    const productRnpa = resolveRecipeRnpaFromRegistro(registro);
    const totalIngredientsKg = ingredients.reduce((sum, item) => sum + getIngredientPlanQtyKg(item), 0);
    const mermaKg = Math.max(0, totalIngredientsKg - Number(registro?.quantityKg || 0));
    const productLabel = normalizeValue(registro?.recipeTitle || 'Producto');
    const ingredientRows = ingredients.map((item, index) => {
      const firstLot = Array.isArray(item?.lots) && item.lots[0] ? item.lots[0] : {};
      return `<li><strong>${index + 1}. ${escapeHtml(item?.ingredientName || 'Ingrediente')}</strong><span>${escapeHtml(formatCompactQty(item?.requiredQty ?? item?.neededQty, item?.unit || item?.ingredientUnit || ''))} · Lote ${escapeHtml(firstLot?.lotNumber || firstLot?.entryId || '-')}</span></li>`;
    }).join('');
    return `<div class="produccion-trace-fallback-diagram" aria-label="Diagrama alternativo de trazabilidad">
      <div class="produccion-trace-fallback-flow">
        <article class="produccion-trace-fallback-node"><small>Empresa</small><strong>${escapeHtml(COMPANY_LEGAL_NAME)}</strong><span>RNE ${escapeHtml(companyRne.number || '-')}</span></article>
        <span class="produccion-trace-fallback-arrow">→</span>
        <article class="produccion-trace-fallback-node"><small>Producto</small><strong>${escapeHtml(productLabel)}</strong><span>RNPA ${escapeHtml(productRnpa.number || '-')}</span></article>
        <span class="produccion-trace-fallback-arrow">→</span>
        <article class="produccion-trace-fallback-node"><small>Producción</small><strong>${Number(registro?.quantityKg || 0).toFixed(2)} kg</strong><span>${escapeHtml(formatIsoEs(productionDate))}</span></article>
      </div>
      <div class="produccion-trace-fallback-meta">
        <p><strong>Encargado:</strong> ${escapeHtml(manager)}</p>
        <p><strong>Total ingredientes:</strong> ${totalIngredientsKg.toFixed(3)} kg</p>
        <p><strong>Merma:</strong> ${mermaKg.toFixed(3)} kg</p>
      </div>
      <ul class="produccion-trace-fallback-list">${ingredientRows || '<li><strong>Sin ingredientes</strong><span>No hay lotes asociados en este registro.</span></li>'}</ul>
    </div>`;
  };

  const renderTraceabilityTree = (registro) => {
    const companyRne = resolveCompanyRneFromRegistro(registro);
    const productRnpa = resolveRecipeRnpaFromRegistro(registro);
    const productRnpaNumber = normalizeValue(productRnpa.number || '-');
    const productRnpaLabel = normalizeValue(productRnpa.denomination || productRnpa.brand || productRnpa.businessName || '-');
    const ingredients = (registro.lots || []).map((item, idx) => {
      const ingredientImage = normalizeValue(state.ingredientes[item.ingredientId]?.imageUrl);
      const aggregatedImages = (item.lots || []).flatMap((lot) => Array.isArray(lot.invoiceImageUrls) ? lot.invoiceImageUrls : []);
      const providerRneSummary = (item.lots || []).map((lot) => {
        const providerRne = resolveProviderRneFromLot(lot);
        return {
          number: providerRne.number,
          attachmentUrl: providerRne.attachmentUrl
        };
      }).find((row) => row.number || row.attachmentUrl) || { number: '', attachmentUrl: '' };
      const lotCards = (item.lots || []).map((lot) => {
        const takenQty = Number(lot.takeQty || 0);
        const availableQty = Number(lot.availableQty || 0);
        const remainingQty = Math.max(0, availableQty - takenQty);
        const providerRne = resolveProviderRneFromLot(lot);
        return `<article class="produccion-trace-lot-card">
          <div class="produccion-trace-lot-head">
            <strong><i class="bi bi-upc-scan fa-solid fa-barcode"></i> Lote ${escapeHtml(lot.lotNumber || lot.entryId || '-')}</strong>
            <span class="produccion-trace-used-badge">Vencimiento al elaborar: ${escapeHtml(formatIsoEs(lot.expiryDate || ''))}</span>
          </div>
          <div class="produccion-trace-grid">
            <p><strong>Usado</strong><span>${formatCompactQty(takenQty, lot.unit || item.unit || '')}</span></p>
            <p><strong>Disponible</strong><span>${formatCompactQty(availableQty, lot.unit || item.unit || '')}</span></p>
            <p><strong>Remanente</strong><span>${formatCompactQty(remainingQty, lot.unit || item.unit || '')}</span></p>
            <p><strong>Proveedor</strong><span>${escapeHtml(lot.provider || 'Sin proveedor')}</span></p>
            <p><strong>RNE proveedor</strong><span>${escapeHtml(providerRne.number || '-')}</span></p>
            <p><strong>Factura</strong><span>${escapeHtml(lot.invoiceNumber || '-')}</span></p>
            <p><strong>Ingreso</strong><span>${escapeHtml(lot.entryDate || '-')}</span></p>
          </div>
          <div class="produccion-trace-card-actions">${Array.isArray(lot.invoiceImageUrls) && lot.invoiceImageUrls.length ? `<button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-prod-trace-images="${encodeURIComponent(JSON.stringify(lot.invoiceImageUrls))}"><i class="bi bi-paperclip fa-solid fa-paperclip"></i><span>Ver adjunto (${lot.invoiceImageUrls.length})</span></button>` : '<button type="button" class="btn ios-btn ios-btn-danger inventario-no-photo-btn" disabled>Sin adjuntos</button>'}${providerRne.attachmentUrl ? `<button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-prod-trace-images='${encodeURIComponent(JSON.stringify([providerRne.attachmentUrl]))}'><i class="fa-regular fa-eye"></i><span>Ver adjunto RNE</span></button>` : '<button type="button" class="btn ios-btn ios-btn-danger inventario-no-photo-btn" disabled>RNE sin adjunto</button>'}</div>
        </article>`;
      }).join('');
      return `<article class="produccion-trace-ingredient-card">
        <header>
          <div class="produccion-trace-ingredient-head-main">
            <span class="produccion-trace-ingredient-index">${idx + 1}</span>
            <span class="produccion-trace-ingredient-avatar">${ingredientImage ? `<img src="${ingredientImage}" alt="${escapeHtml(item.ingredientName || 'Ingrediente')}">` : '<i class="bi bi-basket2-fill fa-solid fa-carrot"></i>'}</span>
            <div>
              <h6><i class="bi bi-box-seam fa-solid fa-box-open"></i> ${escapeHtml(item.ingredientName || item.ingredientId || 'Ingrediente')}</h6>
              <small>Cantidad usada: ${formatCompactQty(item.requiredQty ?? item.neededQty, item.unit || item.ingredientUnit || '')}</small>
              <small>RNE proveedor: <strong>${escapeHtml(providerRneSummary.number || '-')}</strong></small>
            </div>
          </div>
          <div class="produccion-trace-card-actions">${aggregatedImages.length ? `<button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-prod-trace-images="${encodeURIComponent(JSON.stringify(aggregatedImages))}"><i class="bi bi-images fa-regular fa-images"></i><span>Ver adjunto (${aggregatedImages.length})</span></button>` : '<button type="button" class="btn ios-btn ios-btn-danger inventario-no-photo-btn" disabled>Sin adjuntos</button>'}${providerRneSummary.attachmentUrl ? `<button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-prod-trace-images='${encodeURIComponent(JSON.stringify([providerRneSummary.attachmentUrl]))}'><i class="fa-regular fa-eye"></i><span>Ver adjunto RNE</span></button>` : '<button type="button" class="btn ios-btn ios-btn-danger inventario-no-photo-btn" disabled>RNE sin adjunto</button>'}</div>
        </header>
        <div class="produccion-trace-lots">${lotCards || '<p class="m-0">Sin lotes asociados.</p>'}</div>
      </article>`;
    }).join('');
    return `<section class="produccion-trace-v2 produccion-trace-apple-viewer">
      <div class="produccion-trace-diagram-wrap">
        <div class="produccion-trace-diagram">
          <div class="produccion-trace-toolbar-zoom">
            <button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-trace-zoom-out aria-label="Alejar"><i class="fa-solid fa-magnifying-glass-minus"></i></button>
            <span class="produccion-trace-zoom-value" data-trace-zoom-value>100%</span>
            <button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-trace-zoom-in aria-label="Acercar"><i class="fa-solid fa-magnifying-glass-plus"></i></button>
            <button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-trace-zoom-reset aria-label="Restablecer zoom"><i class="fa-solid fa-arrows-rotate"></i></button>
          </div>
          <article class="produccion-trace-summary">
            <h6><i class="bi bi-diagram-3 fa-solid fa-diagram-project"></i> Trazabilidad ${escapeHtml(registro.id)}</h6>
            <div class="produccion-trace-grid">
              <p><strong>Empresa</strong><span>${escapeHtml(COMPANY_LEGAL_NAME)}</span></p>
              <p><strong>RNE empresa</strong><span>${escapeHtml(companyRne.number || '-')}</span></p>
              <p><strong>Producto</strong><span>${escapeHtml(registro.recipeTitle || '-')}</span></p>
              <p><strong>RNPA</strong><span>${escapeHtml(productRnpaNumber)}</span></p>
              <p><strong>Detalle RNPA</strong><span>${escapeHtml(productRnpaLabel || '-')}</span></p>
              <p><strong>Cantidad final</strong><span>${Number(registro.quantityKg || 0).toFixed(2)} kg</span></p>
              <p><strong>Fecha</strong><span>${escapeHtml(formatDateTime(registro.createdAt))}</span></p>
              <p><strong>Estado</strong><span>${escapeHtml(registro.status || '-')}</span></p>
            </div>
            <div class="produccion-trace-card-actions">${companyRne.attachmentUrl ? `<button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-prod-trace-images='${encodeURIComponent(JSON.stringify([companyRne.attachmentUrl]))}'><i class="fa-regular fa-eye"></i><span>Ver adjunto RNE empresa</span></button>` : '<button type="button" class="btn ios-btn ios-btn-danger inventario-no-photo-btn" disabled>RNE empresa sin adjunto</button>'}${productRnpa.attachmentUrl ? `<button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-prod-trace-images='${encodeURIComponent(JSON.stringify([productRnpa.attachmentUrl]))}'><i class="fa-regular fa-eye"></i><span>Ver adjunto RNPA</span></button>` : '<button type="button" class="btn ios-btn ios-btn-danger inventario-no-photo-btn" disabled>RNPA sin adjunto</button>'}</div>
            <div class="produccion-trace-managers">${(Array.isArray(registro.managers) ? registro.managers : []).map((token) => { const manager = getManagerDisplay(token); return `<span class="produccion-trace-chip"><i class="bi bi-person-badge fa-solid fa-user-tie"></i><strong>${escapeHtml(manager.name)}</strong><small>${escapeHtml(manager.role)}</small></span>`; }).join('') || '<span class="produccion-trace-chip"><i class="bi bi-person-x fa-solid fa-user-xmark"></i><strong>Sin responsable</strong><small>Encargado</small></span>'}</div>
          </article>
          <div class="produccion-trace-mermaid-wrap">
            <div class="produccion-trace-mermaid" data-trace-mermaid><button type="button" class="produccion-trace-mermaid-overlay" data-trace-mermaid-overlay><i class="fa-solid fa-hand-pointer"></i><span>Click para visualizar diagrama</span></button></div>
          </div>
          <div class="produccion-trace-ingredients">${ingredients || '<p class="m-0">Sin desglose de lotes para esta producción.</p>'}</div>
        </div>
      </div>
    </section>`;
  };
  const initTraceMermaidDiagram = async (popup, registro) => {
    const host = popup.querySelector('[data-trace-mermaid]');
    if (!host) return;
    host.innerHTML = '<div class="produccion-trace-mermaid-loading" aria-live="polite"><img src="./IMG/Meta-ai-logo.webp" alt="Renderizando diagrama" class="meta-spinner-login"><p>Generando diagrama...</p></div>';
    const hasLib = await ensureTraceDiagramLib();
    if (!hasLib) {
      host.innerHTML = '<p class="m-0">No se pudo cargar Mermaid.</p>';
      return;
    }
    const source = buildTraceMermaidDefinition(registro);
    try {
      const renderId = `trace_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const rendered = await window.mermaid.render(renderId, source);
      if (!rendered || !rendered.svg) throw new Error('Mermaid render vacío');
      host.innerHTML = `${rendered.svg}<button type="button" class="produccion-trace-mermaid-overlay is-ready" data-trace-mermaid-overlay><i class="fa-solid fa-hand-pointer"></i><span>Click para visualizar diagrama</span></button>`;
      host.dataset.traceScale = '1';
      host.style.transformOrigin = 'top left';
      host.style.transform = 'scale(1)';
      return;
    } catch (primaryError) {
      host.innerHTML = `<pre class="mermaid">${source}</pre><button type="button" class="produccion-trace-mermaid-overlay is-ready" data-trace-mermaid-overlay><i class="fa-solid fa-hand-pointer"></i><span>Click para visualizar diagrama</span></button>`;
      try {
        const node = host.querySelector('.mermaid');
        if (!node) throw new Error('Nodo Mermaid ausente');
        await window.mermaid.run({ nodes: [node] });
        host.dataset.traceScale = '1';
        host.style.transformOrigin = 'top left';
        host.style.transform = 'scale(1)';
      } catch (fallbackError) {
        host.innerHTML = renderTraceabilityFallbackDiagram(registro);
      }
    }
  };
  const initTraceMermaidZoomControls = (popup) => {
    const host = popup.querySelector('[data-trace-mermaid]');
    const viewport = popup.querySelector('.produccion-trace-mermaid');
    const label = popup.querySelector('[data-trace-zoom-value]');
    if (!host || !viewport || !label) return;
    let zoom = Number(host.dataset.traceScale || 1);
    let panX = Number(host.dataset.tracePanX || 0);
    let panY = Number(host.dataset.tracePanY || 0);
    const minZoom = 0.65;
    const maxZoom = 2.5;
    const pointers = new Map();
    let pointerDrag = null;
    let pinchStart = null;

    const applyTransform = () => {
      host.dataset.traceScale = String(zoom);
      host.dataset.tracePanX = String(panX);
      host.dataset.tracePanY = String(panY);
      host.style.transformOrigin = '0 0';
      host.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
      label.textContent = `${Math.round(zoom * 100)}%`;
    };

    const setZoom = (next, originX = viewport.clientWidth / 2, originY = viewport.clientHeight / 2) => {
      const clamped = Math.min(maxZoom, Math.max(minZoom, next));
      if (Math.abs(clamped - zoom) < 0.0001) return;
      const worldX = (originX - panX) / zoom;
      const worldY = (originY - panY) / zoom;
      zoom = clamped;
      panX = originX - worldX * zoom;
      panY = originY - worldY * zoom;
      applyTransform();
    };

    const setPan = (nextX, nextY) => {
      panX = nextX;
      panY = nextY;
      applyTransform();
    };

    viewport.addEventListener('wheel', (event) => {
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const originX = event.clientX - rect.left;
      const originY = event.clientY - rect.top;
      const factor = event.deltaY < 0 ? 1.1 : 0.9;
      setZoom(zoom * factor, originX, originY);
    }, { passive: false });

    viewport.addEventListener('pointerdown', (event) => {
      viewport.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 1) {
        pointerDrag = { startX: event.clientX, startY: event.clientY, originX: panX, originY: panY };
        viewport.classList.add('is-dragging');
      } else if (pointers.size === 2) {
        const [a, b] = Array.from(pointers.values());
        pinchStart = {
          distance: Math.hypot(a.x - b.x, a.y - b.y),
          zoom,
          panX,
          panY,
          centerX: (a.x + b.x) / 2,
          centerY: (a.y + b.y) / 2
        };
      }
    });

    viewport.addEventListener('pointermove', (event) => {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size >= 2) {
        const [a, b] = Array.from(pointers.values());
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (!pinchStart || pinchStart.distance <= 0) return;
        const rect = viewport.getBoundingClientRect();
        const centerX = ((a.x + b.x) / 2) - rect.left;
        const centerY = ((a.y + b.y) / 2) - rect.top;
        const ratio = distance / pinchStart.distance;
        const nextZoom = Math.min(maxZoom, Math.max(minZoom, pinchStart.zoom * ratio));
        const worldX = (centerX - pinchStart.panX) / pinchStart.zoom;
        const worldY = (centerY - pinchStart.panY) / pinchStart.zoom;
        zoom = nextZoom;
        panX = centerX - worldX * zoom;
        panY = centerY - worldY * zoom;
        applyTransform();
        return;
      }
      if (!pointerDrag) return;
      const dx = event.clientX - pointerDrag.startX;
      const dy = event.clientY - pointerDrag.startY;
      setPan(pointerDrag.originX + dx, pointerDrag.originY + dy);
    });

    const endPointer = (event) => {
      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinchStart = null;
      if (pointers.size === 0) {
        pointerDrag = null;
        viewport.classList.remove('is-dragging');
      } else if (pointers.size === 1) {
        const [single] = Array.from(pointers.values());
        pointerDrag = { startX: single.x, startY: single.y, originX: panX, originY: panY };
      }
    };

    viewport.addEventListener('pointerup', endPointer);
    viewport.addEventListener('pointercancel', endPointer);
    viewport.addEventListener('pointerleave', (event) => {
      if (!event.buttons) endPointer(event);
    });

    const setZoomCentered = (next) => {
      const rect = viewport.getBoundingClientRect();
      setZoom(next, rect.width / 2, rect.height / 2);
    };
    popup.querySelector('[data-trace-zoom-in]')?.addEventListener('click', () => setZoomCentered(zoom + 0.12));
    popup.querySelector('[data-trace-zoom-out]')?.addEventListener('click', () => setZoomCentered(zoom - 0.12));
    popup.querySelector('[data-trace-zoom-reset]')?.addEventListener('click', () => {
      zoom = 1;
      panX = 0;
      panY = 0;
      applyTransform();
    });
    zoom = 1;
    panX = 0;
    panY = 0;
    applyTransform();
  };
  const ensureTraceabilityDerivedData = async (registro) => {
    if (!registro?.id) return registro;
    const packaging = resolvePackagingFromRegistro(registro);
    const needsPersist = packaging.agingDays > 0 && packaging.packagingDate
      && (normalizeValue(registro.packagingDate) !== packaging.packagingDate
        || Number(registro.agingDaysAtProduction || 0) !== Number(packaging.agingDays || 0));
    if (!needsPersist) return registro;
    const updated = {
      ...registro,
      packagingDate: packaging.packagingDate,
      agingDaysAtProduction: Number(packaging.agingDays || 0)
    };
    state.registros[registro.id] = updated;
    try {
      const remote = safeObject(await window.dbLaJamoneraRest.read(REGISTROS_PATH));
      remote[registro.id] = updated;
      await window.dbLaJamoneraRest.write(REGISTROS_PATH, remote);
    } catch (error) {
    }
    return updated;
  };
  const openTraceability = async (registro) => {
    Swal.fire({
      title: 'Cargando trazabilidad...',
      html: '<div class="informes-saving-spinner"><img src="./IMG/Meta-ai-logo.webp" alt="Cargando trazabilidad" class="meta-spinner-login"></div>',
      allowOutsideClick: false,
      showConfirmButton: false,
      customClass: {
        popup: 'ios-alert produccion-loading-alert',
        title: 'ios-alert-title',
        htmlContainer: 'ios-alert-text'
      }
    });
    await new Promise((resolve) => setTimeout(resolve, 220));
    Swal.close();
    const traceRegistro = await ensureTraceabilityDerivedData(registro);
    await openIosSwal({
      title: `Trazabilidad ${traceRegistro.id}`,
      html: renderTraceabilityTree(traceRegistro),
      width: '94vw',
      confirmButtonText: 'Cerrar',
      customClass: {
        popup: 'produccion-trace-alert'
      },
      didOpen: async (popup) => {
        await initTraceMermaidDiagram(popup, traceRegistro);
        const overlay = popup.querySelector('[data-trace-mermaid-overlay]');
        const activateTraceDiagram = () => {
          overlay?.classList.add('d-none');
          if (!popup.__traceZoomInitialized) {
            initTraceMermaidZoomControls(popup);
            popup.__traceZoomInitialized = true;
          }
        };
        if (overlay) {
          overlay.addEventListener('click', activateTraceDiagram, { once: true });
        } else {
          activateTraceDiagram();
        }
        popup.querySelectorAll('[data-prod-trace-images]').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const urls = JSON.parse(decodeURIComponent(btn.dataset.prodTraceImages || '[]'));
            if (!Array.isArray(urls) || !urls.length) return;
            if (typeof window.laJamoneraOpenImageViewer === 'function') {
              await window.laJamoneraOpenImageViewer([{ invoiceImageUrls: urls }], 0, 'Adjuntos de lote');
            }
          });
        });
      },
      willClose: (popup) => {
        popup.__traceReactRoot?.unmount?.();
        const host = popup.querySelector('[data-trace-reactflow]');
        if (!popup.__traceReactRoot && host && window.ReactDOM?.unmountComponentAtNode) {
          window.ReactDOM.unmountComponentAtNode(host);
        }
        popup.__traceFlowApi = null;
      }
    });
  };
  const renderHistoryTable = () => {
    if (!nodes.historyTableWrap) return;
    const rows = getHistoryRows();
    rows.forEach((item) => {
      if (state.historyTraceCollapse[item.id] !== undefined) return;
      if (getTraceRowsFromRegistro(item).length) state.historyTraceCollapse[item.id] = true;
    });
    const PAGE = 10;
    const pages = Math.max(1, Math.ceil(rows.length / PAGE));
    state.historyPage = Math.min(Math.max(1, state.historyPage), pages);
    const start = (state.historyPage - 1) * PAGE;
    const pageRows = rows.slice(start, start + PAGE);
    const traceableRows = rows.filter((item) => getTraceRowsFromRegistro(item).length);
    const canCollapseRows = traceableRows.some((item) => state.historyTraceCollapse[item.id] !== true);
    const canExpandRows = traceableRows.some((item) => state.historyTraceCollapse[item.id] === true);
    const htmlRows = pageRows.length ? pageRows.map((item, index) => {
      const manager = getManagerLabel(item);
      const traceRows = getTraceRowsFromRegistro(item);
      const isCollapsed = state.historyTraceCollapse[item.id] === true;
      const planillaDisabled = hasPlanillaDisponible(item) ? '' : 'disabled';
      const traceHtml = (!isCollapsed && traceRows.length)
        ? traceRows.map((trace) => `<tr class="inventario-trace-row">
          <td><div class="inventario-trace-main"><img src="./IMG/Octicons-git-merge.svg" alt="merge" class="inventario-trace-icon"><span class="inventario-trace-avatar">${trace.ingredientImageUrl ? `<span class="thumb-loading"><img class="meta-spinner-login" src="./IMG/Meta-ai-logo.webp" alt="Cargando"></span><img class="thumb-image js-produccion-thumb" src="${escapeHtml(trace.ingredientImageUrl)}" alt="${escapeHtml(trace.ingredientName)}">` : '<i class="fa-solid fa-carrot"></i>'}</span><span class="inventario-trace-label">${escapeHtml(trace.ingredientName)}</span></div></td>
          <td></td>
          <td><span class="produccion-trace-date">${escapeHtml(formatDateTime(trace.createdAt))}</span></td>
          <td class="inventario-trace-kilos">-${escapeHtml(trace.amount)}</td>
          <td>${escapeHtml(trace.lotNumber)}</td>
          <td><span class="produccion-trace-expiry">${escapeHtml(formatExpiryHuman(trace.expiryDate))}${normalizeLower(trace.expiryDate)==='no perecedero' ? '' : ' (VTO)'}</span></td>
          <td><span class="produccion-trace-badge">Trazabilidad</span></td>
          <td>-</td>
          <td>${trace.invoiceImageUrls.length ? `<button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-prod-trace-images="${encodeURIComponent(JSON.stringify(trace.invoiceImageUrls))}"><i class="fa-regular fa-image"></i><span>Adjunto (${trace.invoiceImageUrls.length})</span></button>` : '<button type="button" class="btn ios-btn ios-btn-danger inventario-no-photo-btn" disabled>Sin adjuntos</button>'}</td>
          <td>-</td>
        </tr>`).join('') : '';
      return `<tr class="inventario-row-tone ${index % 2 === 0 ? 'is-even-row' : 'is-odd-row'}">
        <td><div class="d-flex align-items-center gap-2">${traceRows.length ? `<button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-prod-collapse="${escapeHtml(item.id)}" title="${isCollapsed ? 'Descolapsar' : 'Colapsar'}" aria-label="${isCollapsed ? 'Descolapsar' : 'Colapsar'}"><i class="fa-solid ${isCollapsed ? 'fa-expand' : 'fa-compress'}"></i></button>` : ''}<span>${escapeHtml(item.id)}</span></div></td>
        <td>${escapeHtml(formatDateTime(item.createdAt))}</td>
        <td>${escapeHtml(item.recipeTitle || '-')}</td>
        <td>${Number(item.quantityKg || 0).toFixed(2)} kg</td>
        <td><span class="produccion-responsable-wrap"><strong>${escapeHtml(manager.name)}</strong><small>${escapeHtml(manager.role)}</small></span></td>
        <td class="produccion-vto-cell">${escapeHtml(formatProductExpiryLabel(item))}</td>
        <td><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-prod-trace="${item.id}"><img src="./IMG/family-tree-icon-no-bg.svg" alt="" style="width:14px;height:14px"><span>Trazabilidad</span></button></td>
        <td><div class="produccion-planilla-actions"><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-prod-planilla="${escapeHtml(item.id)}" ${planillaDisabled}><i class="fa-regular fa-file-lines"></i><span>Planilla</span></button><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-prod-qr-print="${escapeHtml(item.id)}" title="Imprimir QR"><i class="fa-solid fa-qrcode"></i></button></div></td>
        <td>${traceRows.some((trace) => trace.invoiceImageUrls.length) ? `<button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-prod-trace-images='${encodeURIComponent(JSON.stringify(traceRows.flatMap((trace) => trace.invoiceImageUrls)))}'><i class="fa-regular fa-image"></i><span>Ver adjuntos</span></button>` : '<button type="button" class="btn ios-btn ios-btn-danger inventario-no-photo-btn" disabled>Sin adjuntos</button>'}</td>
        <td><button type="button" class="btn ios-btn ios-btn-danger inventario-threshold-btn" data-prod-cancel="${escapeHtml(item.id)}"><i class="fa-solid fa-trash"></i><span>Eliminar</span></button></td>
      </tr>${traceHtml}`;
    }).join('') : '<tr><td colspan="10" class="text-center">Sin producciones en ese rango.</td></tr>';
    nodes.historyTableWrap.innerHTML = `
      <div class="inventario-print-row mb-2 inventario-trace-toolbar toolbar-scroll-x">
        <button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" id="produccionHistoryCollapseAllRowsBtn" ${canCollapseRows ? '' : 'disabled'}><i class="fa-solid fa-compress"></i><span>Colapsar</span></button>
        <button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" id="produccionHistoryExpandAllRowsBtn" ${canExpandRows ? '' : 'disabled'}><i class="fa-solid fa-expand"></i><span>Descolapsar</span></button>
      </div>
      <div class="table-responsive inventario-global-table inventario-table-compact-wrap">
        <table class="table recipe-table inventario-table-compact mb-0">
          <thead><tr><th>ID producción</th><th>Fecha y hora</th><th>Producto</th><th>Fabricado (KG.)</th><th>Responsable</th><th>VTO producto</th><th>Trazabilidad</th><th>Planilla</th><th>Adjuntos</th><th>Acciones</th></tr></thead>
          <tbody>${htmlRows}</tbody>
        </table>
      </div>
      <div class="inventario-pagination enhanced">
        <button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn inventario-page-btn" data-prod-page="prev" ${state.historyPage <= 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-left"></i></button>
        <span>Página ${state.historyPage} de ${pages}</span>
        <button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn inventario-page-btn" data-prod-page="next" ${state.historyPage >= pages ? 'disabled' : ''}><i class="fa-solid fa-chevron-right"></i></button>
      </div>`;
    prepareThumbLoaders('.js-produccion-thumb');
  };
  const setHistoryMode = (enabled) => {
    state.historyMode = enabled;
    if (enabled) state.dispatchMode = false;
    nodes.search?.closest('.produccion-toolbar')?.classList.toggle('d-none', enabled);
    nodes.rneAlert?.classList.toggle('d-none', enabled || !getRneExpiryMeta().visible);
    nodes.list?.classList.toggle('d-none', enabled);
    nodes.historyView?.classList.toggle('d-none', !enabled);
    nodes.dispatchView?.classList.toggle('d-none', true);
  };
  const openHistory = async () => {
    state.historyPage = 1;
    if (nodes.historySearch) nodes.historySearch.value = state.historySearch;
    if (nodes.historyRange) nodes.historyRange.value = state.historyRange;
    nodes.historyClearBtn?.classList.toggle('d-none', !(state.historyRange || state.historySearch));
    setHistoryMode(true);
    renderHistoryTable();
  };

  const openMovementShortcut = async (rawCode) => {
    const code = normalizeValue(rawCode);
    if (!code) return;
    const upper = normalizeUpper(code);
    if (upper.startsWith('PROD-')) {
      state.historySearch = code;
      state.historyRange = '';
      state.historyPage = 1;
      await openHistory();
      return;
    }
    if (upper.startsWith('REP-')) {
      state.dispatchSearch = code;
      state.dispatchRange = '';
      state.dispatchPage = 1;
      openDispatch();
      return;
    }
    await openIosSwal({ title: 'Código no reconocido', html: '<p>El código no corresponde a Producción ni Reparto.</p>', icon: 'info' });
  };

  const openRecipeQuickHistory = async (recipeId) => {
    Swal.fire({
      title: 'Cargando historial...',
      html: '<div class="informes-saving-spinner"><img src="./IMG/Meta-ai-logo.webp" alt="Cargando historial" class="meta-spinner-login"></div>',
      allowOutsideClick: false,
      showConfirmButton: false,
      customClass: {
        popup: 'ios-alert produccion-loading-alert',
        title: 'ios-alert-title',
        htmlContainer: 'ios-alert-text'
      }
    });
    await new Promise((resolve) => setTimeout(resolve, 120));
    const recipe = safeObject(state.recetas?.[recipeId]);
    const rows = getRecipeHistoryRows(recipeId);
    Swal.close();
    let page = 1;
    const PAGE_SIZE = 12;
    let query = '';
    let range = '';
    let expanded = false;
    const getFilteredRows = () => {
      const { from, to } = parseDispatchRange(range);
      return rows.filter((item) => {
        const text = normalizeLower(`${item.label || ''} ${item.sourceCode || ''} ${item.sourceId || ''}`);
        if (query && !text.includes(normalizeLower(query))) return false;
        const day = normalizeValue(item.date) || toIsoDate(item.at || 0);
        if (from && day < from) return false;
        if (to && day > to) return false;
        return true;
      });
    };
    const buildRowsHtml = (items) => items.map((item) => {
      const isOut = item.type === 'egreso';
      const isNonTraceable = Boolean(item.nonTraceable) || normalizeUpper(item.sourceCode) === 'SIN TRAZABILIDAD';
      const movementTypeLabel = isOut ? (normalizeValue(item.label) || 'Egreso') : 'Ingreso';
      const toneClass = isOut ? 'movement-type-out' : 'movement-type-in';
      const codeClass = isOut ? 'movement-code-out' : 'movement-code-in';
      const qty = Number(item.qtyKg || 0);
      const qtyClass = isOut ? 'movement-qty-out' : 'movement-qty-in';
      const qtyLabel = `${isOut ? '-' : '+'}${Math.abs(qty).toFixed(2)} kg`;
      const codeHtml = isNonTraceable
        ? '<span class="inventario-internal-no-trace">SIN TRAZABILIDAD</span>'
        : `<button type="button" class="btn btn-link p-0 ${codeClass}" data-history-shortcut-code="${escapeHtml(item.sourceCode || item.sourceId || '')}">${escapeHtml(item.sourceCode || item.sourceId || '-')}</button>`;
      return `<tr class="${isOut ? 'is-movement-out' : 'is-movement-in'}"><td><span class="${toneClass}"><i class="fa-solid ${isOut ? 'fa-arrow-down' : 'fa-arrow-up'}"></i> ${escapeHtml(movementTypeLabel)}</span></td><td>${escapeHtml(formatDateTime(item.at || 0))}</td><td>${codeHtml}</td><td><span class="${qtyClass}">${qtyLabel}</span></td></tr>`;
    }).join('');
    const exportRecipeHistoryExcel = async () => {
      const filtered = getFilteredRows();
      if (!filtered.length) {
        await openIosSwal({ title: 'Sin datos', html: '<p>No hay movimientos para exportar.</p>', icon: 'info' });
        return;
      }
      const headers = ['Tipo', 'Fecha y hora', 'Código', 'Cantidad (kg)'];
      const rowsExcel = filtered.map((item) => ({
        Tipo: `${item.type === 'egreso' ? '↓' : '↑'} ${item.type === 'egreso' ? (normalizeValue(item.label) || 'Egreso') : 'Ingreso'}`,
        'Fecha y hora': formatDateTime(item.at || 0),
        Código: (Boolean(item.nonTraceable) || normalizeUpper(item.sourceCode) === 'SIN TRAZABILIDAD') ? 'SIN TRAZABILIDAD' : (item.sourceCode || item.sourceId || '-'),
        'Cantidad (kg)': `${item.type === 'egreso' ? '-' : '+'}${Math.abs(Number(item.qtyKg || 0)).toFixed(2)}`,
        __tone: item.type === 'egreso' ? 'movement_out' : 'movement_in'
      }));
      await exportStyledExcel({
        fileName: `historial_producto_${normalizeValue(recipe.title || 'producto').replace(/\s+/g, '_').toLowerCase()}_${Date.now()}.xlsx`,
        sheetName: 'Historial Producto',
        headers,
        rows: rowsExcel
      });
    };
    const printRecipeHistory = async () => {
      const ask = await openIosSwal({
        title: 'Imprimir período',
        html: '<p>Se imprimirá el período filtrado del historial rápido.</p>',
        showCancelButton: true,
        confirmButtonText: 'Imprimir',
        cancelButtonText: 'Cancelar',
        customClass: {
          confirmButton: 'ios-btn ios-btn-success',
          cancelButton: 'ios-btn ios-btn-secondary'
        }
      });
      if (!ask.isConfirmed) return;
      const filtered = getFilteredRows();
      const title = `Historial producto ${capitalize(recipe.title || 'Producto')}`;
      const bodyRows = buildRowsHtml(filtered) || '<tr><td colspan="4" class="text-center">Sin movimientos para el filtro.</td></tr>';
      const win = window.open('', '_blank', 'width=1300,height=900');
      if (!win) return;
      win.document.write(`<html><head><title>${escapeHtml(title)}</title><style>body{font-family:Inter,Arial,sans-serif;padding:12px;color:#223457}table{width:100%;border-collapse:collapse}th,td{border:1px solid #d5def2;padding:8px;font-size:11px;vertical-align:top}th{background:#eef3ff;font-size:10px;text-transform:uppercase;letter-spacing:.03em}.is-movement-in td{background:#ecfdf3;color:#111827;font-weight:400}.is-movement-out td{background:#fff1f2;color:#111827;font-weight:400}.movement-type-in,.movement-code-in{color:#17803d;font-weight:700}.movement-type-out,.movement-code-out{color:#b4232a;font-weight:700}</style></head><body><h2>${escapeHtml(title)}</h2><table><thead><tr><th>Tipo</th><th>Fecha y hora</th><th>Código</th><th>Cantidad</th></tr></thead><tbody>${bodyRows}</tbody></table></body></html>`);
      win.document.close();
      await waitPrintAssets(win);
      win.focus();
      win.print();
    };
    const renderRows = (popup) => {
      if (!popup) return;
      const filtered = getFilteredRows();
      const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
      page = Math.min(Math.max(1, page), pages);
      const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
      const body = popup.querySelector('[data-recipe-history-body]');
      const pager = popup.querySelector('[data-recipe-history-pager]');
      const prevBtn = popup.querySelector('[data-recipe-history-prev]');
      const nextBtn = popup.querySelector('[data-recipe-history-next]');
      const expandBtn = popup.querySelector('[data-recipe-history-expand]');
      if (body) body.innerHTML = `<div class="table-responsive inventario-global-table inventario-table-compact-wrap ${expanded ? 'is-expanded' : ''}"><table class="table recipe-table inventario-table-compact mb-0"><thead><tr><th>Tipo</th><th>Fecha y hora</th><th>Código</th><th>Cantidad</th></tr></thead><tbody>${buildRowsHtml(pageRows) || '<tr><td colspan="4" class="text-center">Sin movimientos para el filtro.</td></tr>'}</tbody></table></div>`;
      popup.classList.toggle('is-expanded', expanded);
      if (expandBtn) {
        const label = expandBtn.querySelector('span');
        if (label) label.textContent = expanded ? 'Contraer tabla' : 'Ampliar tabla';
      }
      if (pager) pager.textContent = `Página ${page} de ${pages}`;
      if (prevBtn) prevBtn.disabled = page <= 1;
      if (nextBtn) nextBtn.disabled = page >= pages;
    };
    await openIosSwal({
      title: `Historial rápido · ${escapeHtml(capitalize(recipe.title || 'Producto'))}`,
      width: 'min(720px,96vw)',
      customClass: { popup: 'produccion-recipe-history-alert' },
      html: `<div class="text-start produccion-recipe-history-modal"><div class="input-group ios-input-group ingredientes-search-group mb-2"><span class="input-group-text ingredientes-search-icon"><i class="fa-solid fa-magnifying-glass"></i></span><input type="search" class="form-control ios-input" data-recipe-history-search placeholder="Buscar por código"></div><div class="input-group ios-input-group ingredientes-search-group mb-2"><span class="input-group-text ingredientes-search-icon"><i class="fa-regular fa-calendar"></i></span><input type="text" class="form-control ios-input" data-recipe-history-range placeholder="Filtrar rango (desde - hasta)" autocomplete="off"><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-recipe-history-range-clear><i class="fa-solid fa-xmark"></i></button></div><div class="inventario-print-row mb-2 inventario-trace-toolbar toolbar-scroll-x"><button type="button" class="btn ios-btn inventario-expand-btn inventario-threshold-btn" data-recipe-history-expand><i class="fa-solid fa-up-right-and-down-left-from-center"></i><span>Ampliar tabla</span></button><button type="button" class="btn ios-btn ios-btn-success inventario-threshold-btn" data-recipe-history-excel><i class="fa-solid fa-file-excel"></i><span>Excel</span></button><span class="inventario-period-divider" aria-hidden="true"></span><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-recipe-history-print><i class="fa-solid fa-print"></i><span>Período</span></button></div><div data-recipe-history-body class="dispatch-clients-manager-list produccion-recipe-history-table-host"></div><div class="d-flex align-items-center justify-content-between mt-2"><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-recipe-history-prev><i class="fa-solid fa-chevron-left"></i></button><span data-recipe-history-pager>Página 1 de 1</span><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-recipe-history-next><i class="fa-solid fa-chevron-right"></i></button></div></div>`,
      confirmButtonText: 'Cerrar',
      didOpen: (popup) => {
        const rangeInput = popup.querySelector('[data-recipe-history-range]');
        const safeRenderRows = () => {
          try {
            renderRows(popup);
          } catch (error) {
            const body = popup.querySelector('[data-recipe-history-body]');
            if (body) body.innerHTML = '<p class="text-danger mb-0">No se pudo renderizar el historial. Intentá nuevamente.</p>';
          }
        };
        popup.querySelector('[data-recipe-history-search]')?.addEventListener('input', (event) => {
          query = event.target.value;
          page = 1;
          safeRenderRows();
        });
        popup.addEventListener('click', async (event) => {
          if (event.target.closest('[data-recipe-history-range-clear]')) {
            range = '';
            if (rangeInput) rangeInput.value = '';
            page = 1;
            safeRenderRows();
            return;
          }
          if (event.target.closest('[data-recipe-history-prev]')) {
            page -= 1;
            safeRenderRows();
            return;
          }
          if (event.target.closest('[data-recipe-history-next]')) {
            page += 1;
            safeRenderRows();
            return;
          }
          if (event.target.closest('[data-recipe-history-expand]')) {
            expanded = !expanded;
            safeRenderRows();
            return;
          }
          if (event.target.closest('[data-recipe-history-excel]')) {
            await exportRecipeHistoryExcel();
            return;
          }
          if (event.target.closest('[data-recipe-history-print]')) {
            await printRecipeHistory();
            return;
          }
          const shortcutBtn = event.target.closest('[data-history-shortcut-code]');
          if (shortcutBtn) {
            const shortcutCode = normalizeValue(shortcutBtn.dataset.historyShortcutCode);
            Swal.close();
            await openMovementShortcut(shortcutCode);
          }
        });
        if (window.flatpickr && rangeInput) {
          try {
            const locale = window.flatpickr.l10ns?.es || undefined;
            disableCalendarSuggestions(rangeInput);
            window.flatpickr(rangeInput, {
              locale,
              mode: 'range',
              dateFormat: 'Y-m-d',
              allowInput: false,
              onClose: (_selectedDates, _dateStr, instance) => {
                const from = instance.selectedDates[0] ? getArgentinaIsoDate(instance.selectedDates[0]) : '';
                const to = instance.selectedDates[1] ? getArgentinaIsoDate(instance.selectedDates[1]) : from;
                range = from && to ? `${from} a ${to}` : from;
                rangeInput.value = range;
                page = 1;
                safeRenderRows();
              }
            });
          } catch (error) {
            // noop
          }
        }
        safeRenderRows();
      }
    });
  };
  const getDispatchClient = (clientId) => safeObject(state.reparto.clients?.[clientId]);
  const getDispatchVehicle = (vehicleId) => safeObject(state.reparto.vehicles?.[vehicleId]);
  const getDispatchRecordById = (dispatchId) => safeObject(state.reparto?.registros?.[dispatchId]);
  const ensureQrCodeLib = async () => {
    if (window.QRCode) return true;
    return loadScriptFromSources([
      'https://cdn.jsdelivr.net/npm/qrcodejs2@0.0.2/qrcode.min.js',
      'https://unpkg.com/qrcodejs2@0.0.2/qrcode.min.js'
    ], 'la-jamonera-qrcode-dispatch');
  };
  const waitNodeImages = async (root) => Promise.all([...(root?.querySelectorAll('img') || [])].map((img) => (
    img.complete ? Promise.resolve() : new Promise((resolve) => {
      img.addEventListener('load', resolve, { once: true });
      img.addEventListener('error', resolve, { once: true });
    })
  )));
  const getDispatchTraceUrl = (productionId) => {
    const id = encodeURIComponent(normalizeValue(productionId));
    return `https://www.lajamonera.online/produccion_publica.html?id=${id}`;
  };
  const renderDispatchPlanillaQr = async (host, dispatchRow) => {
    if (!host || !dispatchRow?.id) return;
    const ready = await ensureQrCodeLib();
    if (!ready || !window.QRCode) return;
    const products = Array.isArray(dispatchRow.products) ? dispatchRow.products : [];
    const lotIds = [...new Set(products.flatMap((item) => (Array.isArray(item.allocations) ? item.allocations : []).map((lot) => normalizeValue(lot.productionId)).filter(Boolean)))];
    if (!lotIds.length) return;
    host.innerHTML = '';
    host.style.display = 'grid';
    host.style.gridTemplateColumns = 'repeat(auto-fit,minmax(130px,1fr))';
    host.style.gap = '10px';
    lotIds.forEach((id) => {
      const wrap = document.createElement('div');
      wrap.style.display = 'flex';
      wrap.style.flexDirection = 'column';
      wrap.style.alignItems = 'center';
      wrap.style.gap = '4px';
      const qrBox = document.createElement('div');
      qrBox.style.width = '130px';
      qrBox.style.height = '130px';
      const caption = document.createElement('small');
      caption.style.fontWeight = '700';
      caption.style.color = '#1f2a44';
      caption.style.textAlign = 'center';
      caption.textContent = id;
      wrap.appendChild(qrBox);
      wrap.appendChild(caption);
      host.appendChild(wrap);
      // eslint-disable-next-line no-new
      new window.QRCode(qrBox, { text: getDispatchTraceUrl(id), width: 130, height: 130, colorDark: '#111827', colorLight: '#ffffff' });
    });
  };
  const printDispatchPlanilla = async (node, dispatchRow) => {
    const win = window.open('', '_blank', 'width=1400,height=900');
    if (!win) return;
    win.document.write(`<html><head><title>Planilla reparto ${escapeHtml(dispatchRow?.code || '')}</title><style>@page{size:landscape;margin:10mm}body{font-family:Inter,Arial,sans-serif;color:#111827;background:#ffffff;margin:0;padding:8px}.dispatch-planilla-print{background:#fff}.dispatch-planilla-print table{width:100%;border-collapse:collapse;table-layout:fixed}.dispatch-planilla-print th,.dispatch-planilla-print td{border:1px solid #2f2f2f;padding:6px;word-break:break-word;background:#fff;color:#111827}.dispatch-planilla-print .head-title{font-size:20px;font-weight:800;margin:0}.dispatch-planilla-print .head-sub{font-size:14px;color:#374151;margin:0}.dispatch-planilla-top-title{font-weight:800;text-align:center;padding:8px;border:1px solid #2f2f2f;border-bottom:none}</style></head><body>${node.outerHTML}</body></html>`);
    win.document.close();
    await new Promise((resolve) => setTimeout(resolve, 180));
    const qrHost = win.document.querySelector('[data-dispatch-planilla-qr]');
    if (qrHost) await renderDispatchPlanillaQr(qrHost, dispatchRow);
    await waitPrintAssets(win);
    onProgress?.(100);
    win.focus();
    win.print();
  };
  const buildDispatchPlanillaHtml = (dispatchRow) => {
    const client = { ...getDispatchClient(dispatchRow.clientId), ...safeObject(dispatchRow.clientSnapshot) };
    const vehicle = getDispatchVehicle(dispatchRow.vehicleId);
    const managerTokens = Array.isArray(dispatchRow.managers) ? dispatchRow.managers : [];
    const managerProfiles = Array.isArray(dispatchRow.managerProfiles) ? dispatchRow.managerProfiles : [];
    const managerLabel = managerTokens.length
      ? managerTokens.map((token) => {
        const manager = getManagerDisplay(token);
        return `${manager.name} (${manager.role})`;
      }).join(', ')
      : (managerProfiles.length
        ? managerProfiles.map((m) => `${normalizeValue(m.name) || 'Sin responsable'} (${normalizeValue(m.role) || 'Encargado'})`).join(', ')
        : 'Sin responsable (Encargado)');
    const location = [client.address, client.city, client.province, client.country].map((item) => normalizeValue(item)).filter(Boolean).join(' • ');
    const clientDoc = normalizeValue(client.doc || client.dni || client.cuit || client.cuil || client.document || client.taxId);
    const products = Array.isArray(dispatchRow.products) ? dispatchRow.products : [];
    const detailRows = products.flatMap((item) => {
      const imageUrl = sanitizeImageUrl(item.recipeImageUrl || state.recetas?.[item.recipeId]?.imageUrl);
      const allocations = Array.isArray(item.allocations) && item.allocations.length ? item.allocations : [{ lotNumber: '-', qtyKg: item.qtyKg, expiryDate: '' }];
      return allocations.map((allocation) => `<tr><td><span style="display:inline-flex;align-items:center;gap:8px;">${imageUrl ? `<img src="${escapeHtml(imageUrl)}" style="width:22px;height:22px;border-radius:999px;object-fit:cover;border:1px solid #d7def2;">` : ''}<span>${escapeHtml(item.recipeTitle || '-')}</span></span></td><td><strong>${Number(allocation.qtyKg || 0).toFixed(2)} kg</strong></td><td>${escapeHtml(formatIsoEs(allocation.expiryDate || '')) || '-'}</td><td><strong>${escapeHtml(allocation.lotNumber || '-')} · ${Number(getRegistroById(allocation.productionId)?.quantityKg || allocation.qtyKg || 0).toFixed(2)} kg</strong></td></tr>`);
    }).join('') || '<tr><td colspan="4">Sin productos.</td></tr>';
    const comments = (Array.isArray(dispatchRow.comments) ? dispatchRow.comments : []).map((c) => normalizeValue(c)).filter(Boolean);
    const commentsRows = comments.length
      ? comments.map((item, idx) => `<tr><td colspan="4"><strong>OBSERVACIÓN ${idx + 1}:</strong> ${escapeHtml(item)}</td></tr>`).join('')
      : '<tr><td colspan="4"><strong>OBSERVACIÓN 1:</strong> Sin observaciones</td></tr>';
    const headerTable = `<table style="width:100%;border-collapse:collapse;table-layout:fixed"><tbody><tr><td style="border:1px solid #2f2f2f;padding:4px;font-weight:800;text-align:center" colspan="4">FRIGORIFICO LA JAMONERA • REGISTRO DE SALIDA DE PRODUCTOS TERMINADOS</td></tr><tr><td style="border:1px solid #2f2f2f;padding:4px;font-weight:800;text-align:center" colspan="4">${escapeHtml(dispatchRow.code || dispatchRow.id)}</td></tr><tr><td style="border:1px solid #2f2f2f;padding:4px"><strong>FECHA Y HORA:</strong></td><td style="border:1px solid #2f2f2f;padding:4px"><strong>${escapeHtml(formatDateTime(dispatchRow.createdAt || dispatchRow.dispatchDate))}</strong></td><td style="border:1px solid #2f2f2f;padding:4px"><strong>CLIENTE:</strong></td><td style="border:1px solid #2f2f2f;padding:4px"><strong>${escapeHtml(normalizeValue(client.name) || '-')}</strong></td></tr><tr><td style="border:1px solid #2f2f2f;padding:4px" colspan="4"><strong>DIRECCION:</strong> ${escapeHtml(location)}${location && clientDoc ? ' • ' : ''}${escapeHtml(clientDoc)}</td></tr></tbody></table>`;
    const planillaStyle = '<style>.dispatch-planilla-print{font-family:Inter,Arial,sans-serif;color:#111827;background:#fff}.dispatch-planilla-print table{width:100%;border-collapse:collapse;table-layout:fixed}.dispatch-planilla-print th,.dispatch-planilla-print td{border:1px solid #2f2f2f;padding:6px;word-break:break-word;background:#fff;color:#111827}</style>';
    const html = `${planillaStyle}<div class="dispatch-planilla-print" id="dispatchPlanillaPrintable">${headerTable}<div class="table-responsive" style="margin-top:8px;"><table><thead><tr><th>Productos</th><th>Cantidad</th><th>Vencimiento</th><th>Número de lote</th></tr></thead><tbody>${detailRows}<tr><td colspan="4"><strong>VEHÍCULO (UTA-URA):</strong> ${escapeHtml(`${vehicle.number || '-'} - ${vehicle.patent || '-'} - ${vehicle.brand || vehicle.type || '-'}`)}</td></tr>${commentsRows}<tr><td colspan="4"><strong>CONTROLO:</strong> ${escapeHtml(managerLabel)}</td></tr><tr><td colspan="2"><strong>TEMPERATURA UNIDAD DE TRANSPORTE:</strong> 3 °C</td><td colspan="2"><strong>UNIDAD DE TRANSPORTE ESTADO:</strong> A (ACEPTABLE)</td></tr></tbody></table></div><div style="margin-top:10px;display:flex;gap:12px;align-items:center;"><div data-dispatch-planilla-qr></div><div><p style="margin:0 0 6px;font-weight:700;">QR de trazabilidad de los lotes</p><p style="margin:0;color:#556487;">Escaneá el QR con tu celular para acceder a la trazabilidad completa del producto.</p></div></div></div>`;
    return { html };
  };
  const printDispatchPlanillasBatch = async (rows = [], onProgress) => {
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) return;
    const win = window.open('', '_blank', 'width=1400,height=900');
    if (!win) return;
    win.document.write('<html><head><title>Planillas masivas reparto</title><style>@page{size:landscape;margin:10mm}body{font-family:Inter,Arial,sans-serif;color:#111827;background:#ffffff;margin:0;padding:8px}.dispatch-planilla-print{background:#fff}.dispatch-planilla-print table{width:100%;border-collapse:collapse;table-layout:fixed}.dispatch-planilla-print th,.dispatch-planilla-print td{border:1px solid #2f2f2f;padding:6px;word-break:break-word;background:#fff;color:#111827}.page-break{page-break-before:always;break-before:page}</style></head><body></body></html>');
    win.document.close();
    for (let index = 0; index < list.length; index += 1) {
      const row = list[index];
      const section = win.document.createElement('section');
      section.className = index > 0 ? 'page-break' : '';
      section.innerHTML = buildDispatchPlanillaHtml(row).html;
      win.document.body.appendChild(section);
      const printable = section.querySelector('#dispatchPlanillaPrintable');
      if (printable) {
        await renderDispatchPlanillaQr(printable.querySelector('[data-dispatch-planilla-qr]'), row);
        await waitNodeImages(printable);
      }
      if (typeof onProgress === 'function') {
        onProgress(Math.min(95, Math.round(((index + 1) / list.length) * 95)));
      }
    }
    await waitPrintAssets(win);
    onProgress?.(100);
    win.focus();
    win.print();
  };
  const openDispatchPlanilla = async (dispatchRow) => {
    if (!dispatchRow?.id) return;
    const html = buildDispatchPlanillaHtml(dispatchRow).html;
    Swal.fire({
      title: 'Generando planilla...',
      html: '<div class="informes-saving-spinner"><img src="./IMG/Meta-ai-logo.webp" alt="Cargando planilla" class="meta-spinner-login"></div>',
      allowOutsideClick: false,
      showConfirmButton: false,
      customClass: { popup: 'ios-alert produccion-loading-alert', title: 'ios-alert-title', htmlContainer: 'ios-alert-text' }
    });
    await new Promise((resolve) => setTimeout(resolve, 140));
    Swal.close();
    await openIosSwal({
      title: `Planilla ${escapeHtml(dispatchRow.code || dispatchRow.id)}`,
      html: `<div class="planilla-toolbar"><button type="button" class="btn ios-btn ios-btn-secondary" id="dispatchPlanillaPrintBtn"><i class="fa-solid fa-print"></i><span>Imprimir</span></button></div><div class="planilla-card">${html}</div>`,
      width: '98vw',
      confirmButtonText: 'Cerrar',
      customClass: { popup: 'produccion-trace-alert planilla-modal', confirmButton: 'ios-btn ios-btn-secondary' },
      didOpen: async (popup) => {
        const printable = popup.querySelector('#dispatchPlanillaPrintable');
        if (!printable) return;
        await renderDispatchPlanillaQr(printable.querySelector('[data-dispatch-planilla-qr]'), dispatchRow);
        await waitNodeImages(printable);
        popup.querySelector('#dispatchPlanillaPrintBtn')?.addEventListener('click', async () => printDispatchPlanilla(printable, dispatchRow));
      }
    });
  };
  const getDispatchVehicleExpiryMeta = (vehicle = {}) => {
    const expiry = normalizeValue(vehicle.expiryDate);
    if (!expiry) return { tone: 'neutral', text: 'Sin vencimiento', days: null };
    const days = diffDays(expiry, toIsoDate());
    if (days < 0) return { tone: 'danger', text: 'Vencido', days };
    if (days <= 30) return { tone: 'danger', text: `Vence en ${days} día${days === 1 ? '' : 's'}`, days };
    if (days <= 90) return { tone: 'warning', text: `Vence en ${days} días`, days };
    return { tone: 'success', text: `Vigente (${days} días)`, days };
  };
  const formatDispatchVehicleLabel = (vehicle = {}) => {
    const meta = getDispatchVehicleExpiryMeta(vehicle);
    const brand = normalizeValue(vehicle.brand || vehicle.type || 'Vehículo');
    return `${vehicle.number || '-'} - ${vehicle.patent || '-'} - ${brand} (${meta.text})`;
  };
  const getDispatchAvailableByProductionId = (productionId) => {
    const prod = safeObject(state.registros?.[productionId]);
    if (!prod.id || normalizeValue(prod.status) === 'anulada') return 0;
    const producedKg = Number(prod.quantityKg || 0);
    const dispatchedKg = getDispatchRecordsList().reduce((acc, rep) => {
      const products = Array.isArray(rep.products) ? rep.products : [];
      return acc + products.reduce((sum, row) => sum + (Array.isArray(row.allocations) ? row.allocations : []).reduce((inner, lot) => inner + (normalizeValue(lot.productionId) === normalizeValue(productionId) ? Number(lot.qtyKg || 0) : 0), 0), 0);
    }, 0);
    return Number(Math.max(0, producedKg - dispatchedKg).toFixed(3));
  };
  const buildRecipeLotsForDispatch = (recipeId) => getRegistrosList()
    .filter((reg) => normalizeValue(reg.recipeId) === normalizeValue(recipeId) && normalizeValue(reg.status) !== 'anulada')
    .sort((a, b) => {
      const expiryA = normalizeValue(a.productExpiryDate) || '9999-12-31';
      const expiryB = normalizeValue(b.productExpiryDate) || '9999-12-31';
      if (expiryA !== expiryB) return expiryA.localeCompare(expiryB);
      return Number(a.createdAt || 0) - Number(b.createdAt || 0);
    })
    .map((reg) => ({
      productionId: reg.id,
      lotNumber: reg.id,
      expiryDate: normalizeValue(reg.productExpiryDate),
      availableKg: getDispatchAvailableByProductionId(reg.id)
    }))
    .filter((row) => row.availableKg > 0.0001);
  const isDispatchLotExpiredForDate = (lot = {}, dispatchDateIso = toIsoDate()) => {
    const expiryIso = normalizeValue(lot.expiryDate);
    return Boolean(expiryIso && dispatchDateIso && expiryIso < dispatchDateIso);
  };
  const getDispatchExpiredLots = (allocations = [], dispatchDateIso = toIsoDate()) =>
    (Array.isArray(allocations) ? allocations : []).filter((lot) => isDispatchLotExpiredForDate(lot, dispatchDateIso));
  const allocateDispatchLots = (recipeId, qtyKg) => {
    const needed = Number(qtyKg || 0);
    if (!Number.isFinite(needed) || needed <= 0) return { allocations: [], fulfilledKg: 0, missingKg: needed, hasStock: false };
    let remaining = needed;
    const allocations = [];
    buildRecipeLotsForDispatch(recipeId).forEach((lot) => {
      if (remaining <= 0.0001) return;
      const takeKg = Math.min(remaining, Number(lot.availableKg || 0));
      if (takeKg <= 0.0001) return;
      allocations.push({ ...lot, qtyKg: Number(takeKg.toFixed(3)) });
      remaining = Number(Math.max(0, remaining - takeKg).toFixed(3));
    });
    return {
      allocations,
      fulfilledKg: Number((needed - remaining).toFixed(3)),
      missingKg: Number(remaining.toFixed(3)),
      hasStock: remaining <= 0.0001
    };
  };
  const registerDispatchExpiredResolution = async ({ recipeId = '', lotNumber = '', productionId = '', qtyKg = 0, expiryDate = '', resolutionType = 'retail_sale', dispatchDate = toIsoDate() } = {}) => {
    const safeRecipeId = normalizeValue(recipeId);
    const safeLot = normalizeValue(lotNumber) || '-';
    const safeExpiry = normalizeValue(expiryDate);
    const safeQty = Number(qtyKg || 0);
    if (!safeRecipeId || safeQty <= 0) return false;
    const movementLabel = resolutionType === 'decommissioned' ? 'Decomisado' : 'Venta en Sucursal';
    const safeProductionId = normalizeValue(productionId) || safeLot;
    appendRecipeMovement(safeRecipeId, {
      id: makeId('egr_sin_trazabilidad'),
      type: 'egreso',
      qtyKg: Number(safeQty.toFixed(3)),
      at: nowTs(),
      sourceId: safeProductionId,
      sourceCode: safeProductionId,
      label: movementLabel,
      date: dispatchDate,
      reason: resolutionType,
      nonTraceable: false,
      lotNumber: safeLot,
      expiryDate: safeExpiry
    });
    return true;
  };
  const setDispatchMode = (enabled) => {
    state.dispatchMode = enabled;
    if (enabled) state.historyMode = false;
    nodes.search?.closest('.produccion-toolbar')?.classList.toggle('d-none', enabled);
    nodes.rneAlert?.classList.toggle('d-none', enabled || !getRneExpiryMeta().visible);
    nodes.list?.classList.toggle('d-none', enabled);
    nodes.historyView?.classList.toggle('d-none', true);
    nodes.dispatchView?.classList.toggle('d-none', !enabled);
  };
  const normalizeDispatchDateToken = (value) => {
    const raw = normalizeValue(value);
    if (!raw) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const slash = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (slash) return `${slash[3]}-${slash[2]}-${slash[1]}`;
    const compact = raw.match(/^(\d{4})-(\d{2})-(\d{2}).*$/);
    return compact ? `${compact[1]}-${compact[2]}-${compact[3]}` : '';
  };
  const parseDispatchRange = (value) => {
    const raw = normalizeValue(value);
    if (!raw) return { from: '', to: '' };
    const chunks = raw.split(/\s+a\s+|\s+to\s+/i).map((item) => normalizeDispatchDateToken(item)).filter(Boolean);
    if (!chunks.length) {
      const single = normalizeDispatchDateToken(raw);
      return { from: single, to: single };
    }
    const from = chunks[0];
    const to = chunks[1] || from;
    return { from, to };
  };
  const getDispatchRows = () => {
    const all = getDispatchRecordsList().sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    const query = normalizeLower(state.dispatchSearch);
    const { from, to } = parseDispatchRange(state.dispatchRange);
    return all.filter((row) => {
      const client = getDispatchClient(row.clientId);
      const text = `${row.code || ''} ${client.name || ''} ${(Array.isArray(row.products) ? row.products.map((p) => p.recipeTitle).join(' ') : '')}`.toLowerCase();
      if (query && !text.includes(query)) return false;
      const day = normalizeValue(row.dispatchDate);
      if (from && day < from) return false;
      if (to && day > to) return false;
      return true;
    });
  };
  const rebuildProductIndexEntryMetrics = (entry) => {
    const target = safeObject(entry);
    const movements = Object.values(safeObject(target.movements));
    const weekly = {};
    let totalIn = 0;
    let totalOut = 0;
    movements.forEach((move) => {
      const qtyKg = toFiniteKg(move.qtyKg);
      const type = normalizeValue(move.type) === 'egreso' ? 'egreso' : 'ingreso';
      if (type === 'egreso') {
        totalOut += qtyKg;
        const week = getWeekStartIso(move.at || nowTs());
        weekly[week] = toFiniteKg(Number(weekly[week] || 0) + qtyKg);
        return;
      }
      totalIn += qtyKg;
    });
    target.availableKg = toFiniteKg(Math.max(0, totalIn - totalOut));
    target.weeklyOutByWeek = weekly;
    target.updatedAt = nowTs();
    return target;
  };

  const removeRecipeMovementsBySource = ({ recipeId, sourceId = '', sourceCode = '' }) => {
    const entry = getRecipeProductIndex(recipeId);
    if (!entry) return;
    const safeSourceId = normalizeValue(sourceId);
    const safeSourceCode = normalizeValue(sourceCode);
    const nextMovements = Object.values(safeObject(entry.movements)).filter((movement) => {
      const moveSourceId = normalizeValue(movement?.sourceId);
      const moveSourceCode = normalizeValue(movement?.sourceCode);
      if (safeSourceId && moveSourceId === safeSourceId) return false;
      if (safeSourceCode && moveSourceCode === safeSourceCode) return false;
      return true;
    }).reduce((acc, movement) => {
      const key = normalizeValue(movement?.id) || makeId('prod_move');
      acc[key] = movement;
      return acc;
    }, {});
    entry.movements = nextMovements;
    rebuildProductIndexEntryMetrics(entry);
    compactRecipeMovements(entry);
  };


  const renderDispatchHistoryTable = () => {
    if (!nodes.dispatchView || state.dispatchCreateMode) return;
    const rows = getDispatchRows();
    const PAGE = 8;
    const pages = Math.max(1, Math.ceil(rows.length / PAGE));
    state.dispatchPage = Math.min(Math.max(1, state.dispatchPage), pages);
    const start = (state.dispatchPage - 1) * PAGE;
    const slice = rows.slice(start, start + PAGE);
    const canCollapse = slice.some((row) => state.dispatchCollapse[row.id] === false);
    const canExpand = slice.some((row) => state.dispatchCollapse[row.id] !== false);
    const htmlRows = slice.length ? slice.map((row, index) => {
      const products = Array.isArray(row.products) ? row.products : [];
      const kgTotal = products.reduce((acc, item) => acc + Number(item.qtyKg || 0), 0);
      const expiries = [...new Set(products.flatMap((item) => (Array.isArray(item.allocations) ? item.allocations : []).map((l) => normalizeValue(l.expiryDate)).filter(Boolean)))];
      const expiryLabel = expiries.length === 1 ? formatIsoEs(expiries[0]) : (expiries.length ? 'Ver detalle' : '-');
      const client = { ...getDispatchClient(row.clientId), ...safeObject(row.clientSnapshot) };
      const collapsed = state.dispatchCollapse[row.id] !== false;
      const productLabel = `${products.length} ${products.length === 1 ? 'producto' : 'productos'}`;
      const detailItems = products.flatMap((item) => {
        const allocations = Array.isArray(item.allocations) && item.allocations.length
          ? item.allocations
          : [{ lotNumber: '-', qtyKg: item.qtyKg, expiryDate: '', productionId: '' }];
        return allocations.map((allocation) => ({ item, allocation }));
      });
      const detailRows = !collapsed ? detailItems.map(({ item, allocation }) => {
        const imageUrl = sanitizeImageUrl(item.recipeImageUrl || state.recetas?.[item.recipeId]?.imageUrl);
        const traceBtn = normalizeValue(allocation.productionId)
          ? `<button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-prod-trace="${escapeHtml(allocation.productionId)}"><img src="./IMG/family-tree-icon-no-bg.svg" alt="" style="width:14px;height:14px"><span>Trazabilidad</span></button>`
          : '<span class="inventario-internal-no-trace">Sin trazabilidad</span>';
        return `<tr class="inventario-trace-row"><td><div class="inventario-trace-main"><img src="./IMG/Octicons-git-merge.svg" alt="merge" class="inventario-trace-icon"><span class="inventario-trace-avatar">${imageUrl ? `<span class="thumb-loading"><img class="meta-spinner-login" src="./IMG/Meta-ai-logo.webp" alt="Cargando"></span><img class="thumb-image js-produccion-thumb" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(item.recipeTitle)}">` : '<i class="fa-solid fa-drumstick-bite"></i>'}</span><span class="inventario-trace-label">${escapeHtml(item.recipeTitle || '-')} ${Number(allocation.qtyKg || 0).toFixed(2)} kg</span></div></td><td>${Number(allocation.qtyKg || 0).toFixed(2)} kg</td><td>${escapeHtml(allocation.lotNumber || '-')} · ${Number(getRegistroById(allocation.productionId)?.quantityKg || allocation.qtyKg || 0).toFixed(2)} kg</td><td>${escapeHtml(formatIsoEs(allocation.expiryDate || '')) || '-'}</td><td>${traceBtn}</td><td>${escapeHtml(client.name || '-')}</td><td>-</td><td>-</td></tr>`;
      }).join('') : '';
      const locationParts = [client.address, client.city, client.province, client.country].map((item) => normalizeValue(item)).filter(Boolean);
      const customerDoc = normalizeValue(client.doc || client.dni || client.cuit || client.cuil || client.document || client.taxId);
      const locationMeta = [normalizeValue(client.name), customerDoc].filter(Boolean).join(' · ');
      const locationRow = !collapsed && (locationParts.length || locationMeta)
        ? `<tr class="inventario-internal-use-row"><td colspan="8"><i class="fa-solid fa-house"></i> ${escapeHtml(locationParts.join(' • '))}${locationMeta ? ` • ${escapeHtml(locationMeta)}` : ''}</td></tr>`
        : '';
      return `<tr class="inventario-row-tone ${index % 2 === 0 ? 'is-even-row' : 'is-odd-row'}"><td><div class="d-flex align-items-center gap-2">${products.length ? `<button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-dispatch-collapse="${escapeHtml(row.id)}" title="${collapsed ? 'Descolapsar' : 'Colapsar'}" aria-label="${collapsed ? 'Descolapsar' : 'Colapsar'}"><i class="fa-solid ${collapsed ? 'fa-expand' : 'fa-compress'}"></i></button>` : ''}<span>${escapeHtml(formatDateTime(row.createdAt))}</span></div></td><td>${productLabel}</td><td>${kgTotal.toFixed(2)} kg</td><td>${escapeHtml(expiryLabel)}</td><td>${escapeHtml(row.code || row.id || '-')}</td><td>${escapeHtml(client.name || '-')}</td><td><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-dispatch-planilla="${escapeHtml(row.id)}"><i class="fa-regular fa-file-lines"></i><span>Planilla</span></button></td><td><button type="button" class="btn ios-btn ios-btn-danger inventario-threshold-btn" data-dispatch-delete="${escapeHtml(row.id)}"><i class="fa-solid fa-trash"></i><span>Eliminar</span></button></td></tr>${detailRows}${locationRow}`;
    }).join('') : '<tr><td colspan="8" class="text-center">Sin repartos para el filtro seleccionado.</td></tr>';
    const tableWrap = nodes.dispatchView.querySelector('#produccionDispatchTableWrap');
    if (!tableWrap) return;
    tableWrap.innerHTML = `<div class="inventario-print-row mb-2 inventario-trace-toolbar toolbar-scroll-x"><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" id="inventarioGlobalCollapseAllRowsBtn" ${canCollapse ? '' : 'disabled'}><i class="fa-solid fa-compress"></i><span>Colapsar todo</span></button><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" id="inventarioGlobalExpandAllRowsBtn" ${canExpand ? '' : 'disabled'}><i class="fa-solid fa-expand"></i><span>Descolapsar todo</span></button></div><div class="table-responsive inventario-global-table inventario-table-compact-wrap"><table class="table recipe-table inventario-table-compact mb-0 produccion-dispatch-table-center"><thead><tr><th>Fecha de reparto</th><th>Productos</th><th>Cantidad</th><th>Vencimiento</th><th>Número de reparto</th><th>Cliente</th><th>Planilla</th><th>Acciones</th></tr></thead><tbody>${htmlRows}</tbody></table></div><div class="inventario-pagination enhanced"><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn inventario-page-btn" data-dispatch-page="prev" ${state.dispatchPage <= 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-left"></i></button><span>Página ${state.dispatchPage} de ${pages}</span><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn inventario-page-btn" data-dispatch-page="next" ${state.dispatchPage >= pages ? 'disabled' : ''}><i class="fa-solid fa-chevron-right"></i></button></div>`;
    prepareThumbLoaders('.js-produccion-thumb');
  };
  const renderDispatchMain = () => {
    if (!nodes.dispatchView) return;
    state.dispatchCreateMode = false;
    nodes.dispatchView.innerHTML = `<div class="inventario-period-head produccion-dispatch-head"><button id="produccionDispatchBackBtn" type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn"><i class="fa-solid fa-arrow-left"></i><span>Volver</span></button><h6 class="step-title mb-0">Salida de Productos</h6><button id="produccionDispatchNewBtn" type="button" class="btn ios-btn ios-btn-success inventario-threshold-btn"><i class="bi bi-plus-lg"></i><span>Reparto</span></button></div><div class="inventario-period-filters"><input id="produccionDispatchSearch" type="search" class="form-control ios-input produccion-dispatch-filter" placeholder="Buscar reparto, cliente o producto" value="${escapeHtml(state.dispatchSearch)}"><input id="produccionDispatchRange" class="form-control ios-input produccion-dispatch-filter" placeholder="Seleccionar rango de fechas" value="${escapeHtml(state.dispatchRange)}"><div class="toolbar-scroll-x inventario-period-actions-scroll"><button id="produccionDispatchClearBtn" type="button" class="btn ios-btn inventario-delete-btn inventario-threshold-btn ${(state.dispatchRange || state.dispatchSearch) ? '' : 'd-none'}"><i class="fa-solid fa-xmark"></i><span>Limpiar filtro</span></button><button id="produccionDispatchApplyBtn" type="button" class="btn ios-btn ios-btn-primary inventario-threshold-btn"><i class="fa-solid fa-filter"></i><span>Aplicar</span></button><button id="produccionDispatchExpandBtn" type="button" class="btn ios-btn inventario-expand-btn inventario-threshold-btn"><i class="fa-solid fa-up-right-and-down-left-from-center"></i><span>Ampliar tabla</span></button><button id="produccionDispatchExcelBtn" type="button" class="btn ios-btn ios-btn-success inventario-threshold-btn"><i class="fa-solid fa-file-excel"></i><span>Excel</span></button><span class="inventario-period-divider" aria-hidden="true"></span><button id="produccionDispatchPrintBtn" type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn"><i class="fa-solid fa-print"></i><span>Imprimir período</span></button><button id="produccionDispatchMassBtn" type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn"><i class="fa-regular fa-file-lines"></i><span>Planillas masivas</span></button></div></div><div id="produccionDispatchTableWrap"></div>`;
    const rangeInput = nodes.dispatchView.querySelector('#produccionDispatchRange');
    if (window.flatpickr && rangeInput) {
      const locale = window.flatpickr.l10ns?.es || undefined;
      disableCalendarSuggestions(rangeInput);
      window.flatpickr(rangeInput, {
        locale,
        mode: 'range',
        dateFormat: 'Y-m-d',
        altInput: true,
        altFormat: 'd/m/Y',
        allowInput: true,
        disableMobile: true,
        onClose: (selectedDates, dateStr, instance) => {
          const from = instance.selectedDates[0] ? toIsoDate(instance.selectedDates[0].getTime()) : '';
          const to = instance.selectedDates[1] ? toIsoDate(instance.selectedDates[1].getTime()) : from;
          state.dispatchRange = from && to ? `${from} a ${to}` : from;
          rangeInput.value = state.dispatchRange;
        }
      });
    }
    const searchInput = nodes.dispatchView.querySelector('#produccionDispatchSearch');
    const clearBtn = nodes.dispatchView.querySelector('#produccionDispatchClearBtn');
    const refreshDispatchFilters = () => {
      state.dispatchSearch = normalizeValue(searchInput?.value);
      state.dispatchPage = 1;
      renderDispatchHistoryTable();
      clearBtn?.classList.toggle('d-none', !(state.dispatchRange || state.dispatchSearch));
    };
    searchInput?.addEventListener('input', refreshDispatchFilters);
    searchInput?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        refreshDispatchFilters();
      }
    });
    renderDispatchHistoryTable();
    alignScrollActionsToRight(nodes.dispatchView);
  };
  const hasDispatchDraftChanges = (draft = {}) => {
    if (!draft || typeof draft !== 'object') return false;
    if (normalizeValue(draft.clientId || draft.clientName || draft.vehicleId || draft.vehicleSearch || draft.clientAddress || draft.clientCity)) return true;
    if (Array.isArray(draft.managers) && draft.managers.length) return true;
    if (Array.isArray(draft.comments) && draft.comments.some((item) => normalizeValue(item))) return true;
    if (Array.isArray(draft.proofs) && draft.proofs.some((item) => normalizeValue(item?.url || item?.name))) return true;
    const lines = Array.isArray(draft.lines) ? draft.lines : [];
    return lines.some((line) => normalizeValue(line?.recipeId || line?.recipeSearch || line?.qtyKg));
  };

  const confirmLeaveDispatchCreate = async () => {
    if (!hasDispatchDraftChanges(state.dispatchDraft)) return true;
    const result = await openIosSwal({
      title: 'Abandonar nuevo reparto',
      html: '<p>Hay cambios sin guardar en este reparto.</p>',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, salir',
      cancelButtonText: 'Seguir editando'
    });
    return Boolean(result.isConfirmed);
  };

  const buildDispatchDraft = () => ({
    dispatchDate: toIsoDate(),
    clientId: '',
    clientName: '',
    clientAddress: '',
    clientCity: '',
    clientProvince: 'Santa Fe',
    clientCountry: 'Argentina',
    lines: [{ id: makeId('dispatch_row'), recipeId: '', recipeSearch: '', qtyKg: '', allocations: [] }],
    comments: [],
    proofs: [],
    managers: [],
    vehicleId: '',
    vehicleSearch: '',
    managerSearch: ''
  });
  const alignScrollActionsToRight = (scope = document) => {
    const nodesToAlign = scope.querySelectorAll('.toolbar-scroll-x, .inventario-toolbar-actions, .produccion-toolbar-actions');
    requestAnimationFrame(() => {
      nodesToAlign.forEach((node) => {
        node.scrollLeft = node.scrollWidth;
      });
    });
  };

  const openDispatch = () => {
    state.dispatchPage = 1;
    setDispatchMode(true);
    renderDispatchMain();
  };
  const renderDispatchCreate = (draft) => {
    if (!nodes.dispatchView) return;
    state.dispatchCreateMode = true;
    const lineRows = draft.lines.map((line, idx) => {
      const alloc = allocateDispatchLots(line.recipeId, Number(line.qtyKg || 0));
      line.allocations = alloc.allocations;
      const dispatchDateIso = normalizeValue(draft.dispatchDate) || toIsoDate();
      const expiredLots = getDispatchExpiredLots(alloc.allocations, dispatchDateIso);
      const requestedKg = Number(line.qtyKg || 0);
      const availableKg = Number(getProducedStockMeta(line.recipeId).available || 0);
      const stockStatus = normalizeValue(line.recipeId)
        ? (requestedKg <= 0
          ? `<span class="produccion-dispatch-ok"><i class="fa-solid fa-circle-check"></i> <strong>Disponible:</strong> ${availableKg.toFixed(2)} kg</span>`
          : (alloc.hasStock
            ? `<span class="produccion-dispatch-ok dispatch-stock-block"><i class="fa-solid fa-circle-check"></i> <strong>Disponible:</strong> ${availableKg.toFixed(2)} kg</span><span class="produccion-dispatch-ok dispatch-stock-block"><strong class="dispatch-uses-label">Usás:</strong> <span class="dispatch-uses-value">${requestedKg.toFixed(2)} kg</span></span>`
            : (availableKg > 0.0001
              ? `<span class="produccion-dispatch-missing dispatch-stock-block"><i class="fa-solid fa-circle-exclamation"></i> <strong>Disponible:</strong> ${availableKg.toFixed(2)} kg</span><span class="produccion-dispatch-missing dispatch-stock-block"><strong>Faltan:</strong> ${alloc.missingKg.toFixed(2)} kg</span>`
              : '<span class="produccion-dispatch-missing"><i class="fa-solid fa-circle-xmark"></i> <strong>Sin stock disponible.</strong></span>')))
        : '<span class="text-muted">Seleccionar producto.</span>';
      const lotsText = alloc.allocations.map((lot) => `${escapeHtml(lot.lotNumber)} · ${Number(lot.qtyKg || 0).toFixed(2)} kg`).join('<br>') || 'Sin asignar';
      const expiries = [...new Set(alloc.allocations.map((lot) => normalizeValue(lot.expiryDate)).filter(Boolean))];
      const expiryText = expiries.length === 1
        ? `<span class="${expiredLots.length ? 'dispatch-expiry-text-danger' : ''}">${escapeHtml(formatIsoEs(expiries[0]))}</span>`
        : (expiries.length
          ? expiries.map((item) => `<span class="${item && item < dispatchDateIso ? 'dispatch-expiry-text-danger' : ''}">${escapeHtml(formatIsoEs(item))}</span>`).join('<br>')
          : 'Sin fecha');
      const recipe = safeObject(state.recetas[line.recipeId]);
      const recipeTitle = normalizeValue(line.recipeSearch || recipe.title);
      const recipeImage = sanitizeImageUrl(recipe.imageUrl);
      const expiredLot = expiredLots[0];
      const expiredHelpRow = expiredLot
        ? `<tr class="dispatch-expired-row"><td colspan="6"><p class="dispatch-expired-copy">PODÉS SACAR A REPARTO LA UNIDAD CAMBIANDO LA FECHA HASTA EL DÍA ${escapeHtml(formatIsoEs(expiredLot.expiryDate || ''))}. También podés marcar los kilos disponibles del lote como vendidos en mostrador o decomisados.</p><div class="dispatch-expired-actions"><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-dispatch-expired-action="retail_sale" data-dispatch-row="${idx}"><i class="fa-solid fa-store"></i><span>Marcar venta en mostrador</span></button><button type="button" class="btn ios-btn ios-btn-danger inventario-threshold-btn" data-dispatch-expired-action="decommissioned" data-dispatch-row="${idx}"><i class="fa-solid fa-trash"></i><span>Marcar decomisado</span></button></div></td></tr>`
        : '';
      return `<tr><td><div class="recipe-ing-autocomplete" data-dispatch-product-wrap="${idx}"><div class="recipe-ing-input-wrap dispatch-product-input-wrap"><span class="recipe-inline-avatar-wrap">${recipeImage ? `<span class="thumb-loading"><img class="meta-spinner-login" src="./IMG/Meta-ai-logo.webp" alt="Cargando"></span><img class="recipe-inline-avatar js-dispatch-inline-thumb" src="${escapeHtml(recipeImage)}" alt="${escapeHtml(recipeTitle || 'Producto')}">` : '<span class="image-placeholder-circle-2 dispatch-product-placeholder"><i class="fa-solid fa-drumstick-bite dispatch-product-table-icon dispatch-product-row-icon"></i></span>'}</span><input type="search" class="form-control ios-input dispatch-product-search-input" data-dispatch-product-search="${idx}" placeholder="Seleccionar producto" value="${escapeHtml(recipeTitle)}" autocomplete="new-password" autocapitalize="off" autocorrect="off" spellcheck="false"></div><input type="hidden" data-dispatch-product-id="${idx}" value="${escapeHtml(line.recipeId)}"></div></td><td><input class="form-control ios-input" type="number" step="0.01" min="0" data-dispatch-qty="${idx}" value="${escapeHtml(line.qtyKg || '')}"></td><td class="dispatch-stock-cell">${stockStatus}</td><td class="dispatch-lot-cell">${lotsText}</td><td class="dispatch-expiry-cell ${expiredLots.length ? 'is-danger' : ''}">${expiryText}</td><td><button type="button" class="btn family-manage-btn" data-dispatch-remove="${idx}"><i class="fa-solid fa-trash"></i></button></td></tr>${expiredHelpRow}`;
    }).join('');
    const commentRows = draft.comments.map((comment, idx) => `<tr class="dispatch-comment-row"><td colspan="5"><textarea class="form-control ios-input dispatch-comment-textarea" data-dispatch-comment="${idx}" placeholder="Agregá comentarios y observaciones">${escapeHtml(comment)}</textarea></td><td><button type="button" class="btn family-manage-btn" data-dispatch-comment-remove="${idx}"><i class="fa-solid fa-trash"></i></button></td></tr>`).join('');
    const proofRows = (Array.isArray(draft.proofs) ? draft.proofs : []).map((proof, idx) => `<tr class="dispatch-proof-row"><td colspan="4"><label class="inventario-upload-dropzone dispatch-proof-drop" for="dispatchProofFile_${idx}"><i class="fa-solid fa-paperclip"></i><span>${escapeHtml(proof?.name || 'Adjuntar comprobante (imagen/PDF)')}</span></label><input id="dispatchProofFile_${idx}" class="inventario-hidden-file-input" type="file" accept="image/*,application/pdf" data-dispatch-proof-file="${idx}">${proof?.url ? `<p class="dispatch-proof-name">Cargado: ${escapeHtml(proof.name || 'comprobante')}</p>` : ''}</td><td class="dispatch-proof-expiry-cell">Comprobante</td><td><button type="button" class="btn family-manage-btn" data-dispatch-proof-remove="${idx}"><i class="fa-solid fa-trash"></i></button></td></tr>`).join('');
    nodes.dispatchView.innerHTML = `<div class="inventario-period-head"><button id="produccionDispatchBackToListBtn" type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn"><i class="fa-solid fa-arrow-left"></i><span>Volver</span></button><h6 class="step-title mb-0">Nuevo reparto</h6></div>
    <section class="recipe-step-card step-block"><h6 class="step-title"><span class="recipe-step-number">1</span> Datos generales</h6><div class="step-content recipe-fields-flex"><div class="recipe-field recipe-field-half"><label class="form-label">Día de reparto</label><input id="dispatchDateInput" class="form-control ios-input" value="${escapeHtml(draft.dispatchDate)}"></div><div class="recipe-field recipe-field-half"><div class="dispatch-client-head"><label class="form-label mb-0">Cliente <small class="dispatch-client-helper">(si no existe, crealo)</small></label><div class="dispatch-client-head-actions"><button type="button" class="btn ios-btn ios-btn-secondary dispatch-quick-client-btn" id="dispatchQuickCreateClientBtn"><i class="fa-solid fa-plus"></i><span>Nuevo cliente</span></button><button type="button" class="btn ios-btn ios-btn-secondary dispatch-quick-client-btn" id="dispatchQuickEditClientBtn"><i class="fa-solid fa-pen"></i><span>Modificar cliente</span></button></div></div><div class="inventario-provider-search-wrap"><input id="dispatchClientInput" class="form-control ios-input" placeholder="Buscar por nombre, DNI o CUIL" value="${escapeHtml(draft.clientName)}"><input type="hidden" id="dispatchClientId" value="${escapeHtml(draft.clientId)}"></div></div><div class="recipe-field recipe-field-half"><label class="form-label">Dirección de reparto</label><input id="dispatchClientAddressInput" class="form-control ios-input" placeholder="Dirección" value="${escapeHtml(draft.clientAddress || '')}" ${draft.clientId ? '' : 'disabled'}></div><div class="recipe-field recipe-field-half"><label class="form-label">Localidad</label><input id="dispatchClientCityInput" class="form-control ios-input" list="dispatchLocalitiesList" placeholder="Localidad" value="${escapeHtml(draft.clientCity || '')}" ${draft.clientId ? '' : 'disabled'}><datalist id="dispatchLocalitiesList">${(Array.isArray(state.reparto.localities) ? state.reparto.localities : []).map((loc) => `<option value="${escapeHtml(loc)}"></option>`).join('')}</datalist></div><div class="recipe-field recipe-field-half"><label class="form-label">Provincia</label><select id="dispatchClientProvinceInput" class="form-select ios-input" ${draft.clientId ? '' : 'disabled'}>${ARG_PROVINCIAS.map((item) => `<option value="${escapeHtml(item)}" ${normalizeValue(draft.clientProvince || 'Santa Fe') === item ? 'selected' : ''}>${escapeHtml(item)}</option>`).join('')}</select></div><div class="recipe-field recipe-field-half"><label class="form-label">País</label><input id="dispatchClientCountryInput" class="form-control ios-input" value="${escapeHtml(draft.clientCountry || 'Argentina')}" ${draft.clientId ? '' : 'disabled'}></div></div></section>
    <section class="recipe-step-card step-block produccion-dispatch-create"><div class="d-flex align-items-center justify-content-between mb-2"><h6 class="step-title mb-0"><span class="recipe-step-number">2</span> Productos a repartir</h6></div><div class="table-responsive recipe-table-wrap dispatch-products-table"><table class="table recipe-table inventario-bulk-table mb-0"><thead><tr><th>Producto</th><th>Kilos</th><th>Stock</th><th>Lote</th><th>Vencimiento</th><th></th></tr></thead><tbody>${lineRows}${commentRows}${proofRows}</tbody></table></div><div class="toolbar-scroll-x dispatch-actions-row mt-2"><button type="button" class="btn ios-btn ios-btn-success recipe-table-action-btn" id="dispatchAddProductBtn"><i class="fa-solid fa-plus"></i><span>Producto</span></button><button type="button" class="btn recipe-table-action-btn recipe-table-action-btn-neutral" id="dispatchAddCommentBtn"><i class="fa-regular fa-message"></i><span>Comentario</span></button><button type="button" class="btn recipe-table-action-btn recipe-table-action-btn-monography" id="dispatchAddProofBtn"><i class="fa-solid fa-paperclip"></i><span>Adjuntar comprobantes</span></button></div></section>
    <section class="recipe-step-card step-block"><h6 class="step-title"><span class="recipe-step-number">3</span> Vehículo y responsables</h6><div class="step-content recipe-fields-flex"><div class="recipe-field recipe-field-half"><label class="form-label">Transporte habilitado (UTA/URA)</label><small class="d-block text-muted mb-1">Unidad de Transporte Alimentario / Unidad de Reparto Alimentario.</small><div class="inventario-provider-search-wrap"><input id="dispatchVehicleInput" class="form-control ios-input" placeholder="Seleccionar unidad habilitada" value="${escapeHtml(draft.vehicleSearch || (draft.vehicleId ? formatDispatchVehicleLabel(getDispatchVehicle(draft.vehicleId)) : ''))}" autocomplete="new-password" autocapitalize="off" autocorrect="off" spellcheck="false"><input type="hidden" id="dispatchVehicleSelect" value="${escapeHtml(draft.vehicleId)}"></div><div class="dispatch-vehicle-actions"><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" id="dispatchAddVehicleBtn"><i class="fa-solid fa-plus"></i><span>Nueva unidad</span></button><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" id="dispatchManageVehiclesBtn"><i class="fa-solid fa-pen-to-square"></i><span>Gestionar UTA/URA</span></button></div></div><div class="recipe-field recipe-field-half"><label class="form-label">Responsables</label><div class="input-group ios-input-group ingredientes-search-group dispatch-managers-search-group"><span class="input-group-text ingredientes-search-icon"><i class="fa-solid fa-magnifying-glass"></i></span><input id="dispatchManagersSearch" class="form-control ios-input ingredientes-search-input" placeholder="Buscar responsable" value="${escapeHtml(draft.managerSearch || '')}"></div><div class="produccion-managers-grid">${Object.values(safeObject(state.users)).map((user) => `<label class="produccion-user-check" data-user-search="${escapeHtml(normalizeLower(`${user.fullName || ''} ${user.email || ''} ${getDispatchUserRole(user) || ''}`))}"><input type="checkbox" data-dispatch-manager="${escapeHtml(user.id)}" value="${escapeHtml(user.id)}" ${draft.managers.includes(user.id) ? 'checked' : ''}>${renderUserAvatar(user)}<span class="produccion-user-text"><strong>${escapeHtml(user.fullName || user.email || user.id)}</strong><small>${escapeHtml(getDispatchUserRole(user))}</small></span></label>`).join('')}</div></div></div></section><div class="produccion-config-actions"><button type="button" class="btn ios-btn ios-btn-primary" id="dispatchSaveBtn"><i class="fa-solid fa-floppy-disk"></i><span>Guardar reparto</span></button></div>`;
    const dateInput = nodes.dispatchView.querySelector('#dispatchDateInput');
    if (window.flatpickr && dateInput) {
      window.flatpickr(dateInput, {
        locale: window.flatpickr.l10ns?.es || undefined,
        dateFormat: 'Y-m-d',
        altInput: true,
        altFormat: 'd/m/Y',
        allowInput: true,
        disableMobile: true
      });
    }
    prepareThumbLoaders('.js-produccion-user-photo, .js-dispatch-inline-thumb');
  };
  const persistRepartoStore = async () => {
    await window.dbLaJamoneraRest.write(REPARTO_PATH, state.reparto);
  };
  const DISPATCH_NEW_LOCALITY_VALUE = '__new_locality__';
  const getDispatchLocalities = () => (Array.isArray(state.reparto.localities) ? state.reparto.localities : []).map((item) => normalizeValue(item)).filter(Boolean);
  const renderDispatchLocalityOptions = (selected = '') => {
    const normalized = normalizeValue(selected);
    const options = getDispatchLocalities().map((loc) => `<option value="${escapeHtml(loc)}" ${normalizeValue(loc) === normalized ? 'selected' : ''}>${escapeHtml(loc)}</option>`).join('');
    const newOption = `<option value="${DISPATCH_NEW_LOCALITY_VALUE}">+ Nueva localidad</option>`;
    return `<option value="" ${!normalized ? 'selected' : ''}>Seleccionar localidad</option>${options}${newOption}`;
  };
  const askForNewDispatchLocality = async (seed = '') => {
    const result = await openIosSwal({
      title: 'Nueva localidad',
      customClass: { popup: 'dispatch-locality-alert' },
      input: 'text',
      inputValue: normalizeValue(seed),
      inputPlaceholder: 'Ej: Granadero Baigorria',
      showCancelButton: true,
      confirmButtonText: 'Guardar localidad',
      cancelButtonText: 'Cancelar',
      preConfirm: (value) => {
        const city = normalizeValue(value);
        if (!city) {
          Swal.showValidationMessage('Ingresá una localidad válida.');
          return false;
        }
        return city;
      }
    });
    if (!result.isConfirmed) return '';
    await ensureDispatchLocalitySaved(result.value);
    return normalizeValue(result.value);
  };
  const openCreateDispatchClient = async (seedName = '') => {
    const result = await openIosSwal({
      title: 'Nuevo cliente',
      customClass: { popup: 'dispatch-client-alert' },
      html: `<div class="swal-stack-fields text-start"><div class="dispatch-client-preview"><span id="dispatchClientInitialsPreview" class="user-avatar-thumb dispatch-client-preview-avatar">${initialsFromPersonName(seedName) || '<i class=\"bi bi-person-fill\"></i>'}</span></div><input id="dispatchClientName" class="swal2-input ios-input" placeholder="Nombre y apellido / Razón social" value=""><input id="dispatchClientDoc" class="swal2-input ios-input" placeholder="DNI o CUIL"><input id="dispatchClientAddress" class="swal2-input ios-input" placeholder="Dirección"><select id="dispatchClientCity" class="swal2-select ios-input">${renderDispatchLocalityOptions('')}</select><select id="dispatchClientProvince" class="swal2-select ios-input">${ARG_PROVINCIAS.map((item) => `<option value="${escapeHtml(item)}" ${item === 'Santa Fe' ? 'selected' : ''}>${escapeHtml(item)}</option>`).join('')}</select><input id="dispatchClientCountry" class="swal2-input ios-input" value="Argentina" placeholder="País"></div>`,
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      cancelButtonText: 'Cancelar',
      didOpen: () => {
        const nameInput = document.getElementById('dispatchClientName');
        const preview = document.getElementById('dispatchClientInitialsPreview');
        const citySelect = document.getElementById('dispatchClientCity');
        nameInput?.focus();
        const sync = () => {
          if (!preview) return;
          const initials = initialsFromPersonName(nameInput?.value || '');
          preview.innerHTML = initials ? escapeHtml(initials) : '<i class="bi bi-person-fill"></i>';
        };
        nameInput?.addEventListener('input', sync);
        citySelect?.addEventListener('change', async () => {
          if (citySelect.value !== DISPATCH_NEW_LOCALITY_VALUE) return;
          const created = await askForNewDispatchLocality('');
          citySelect.innerHTML = renderDispatchLocalityOptions(created);
          citySelect.value = created || '';
        });
        sync();
      },
      preConfirm: () => {
        const name = normalizeValue(document.getElementById('dispatchClientName')?.value);
        const doc = normalizeValue(document.getElementById('dispatchClientDoc')?.value);
        const address = normalizeValue(document.getElementById('dispatchClientAddress')?.value);
        const city = normalizeValue(document.getElementById('dispatchClientCity')?.value);
        const province = normalizeValue(document.getElementById('dispatchClientProvince')?.value) || 'Santa Fe';
        const country = normalizeValue(document.getElementById('dispatchClientCountry')?.value) || 'Argentina';
        if (!name) return Swal.showValidationMessage('Completá nombre o razón social.');
        if (!doc) return Swal.showValidationMessage('Completá DNI o CUIL.');
        if (!address) return Swal.showValidationMessage('Completá dirección.');
        if (!city) return Swal.showValidationMessage('Completá localidad.');
        if (!province) return Swal.showValidationMessage('Completá provincia.');
        if (!country) return Swal.showValidationMessage('Completá país.');
        return {
          name,
          doc,
          address,
          city,
          province,
          country
        };
      }
    });
    if (!result.isConfirmed) return null;
    const id = makeId('dispatch_client');
    const initials = initialsFromPersonName(result.value.name) || 'U';
    state.reparto.clients[id] = { id, ...result.value, initials, createdAt: nowTs() };
    await persistRepartoStore();
    await ensureDispatchLocalitySaved(result.value.city);
    return state.reparto.clients[id];
  };
  const DISPATCH_CLIENT_TONES = [
    { bg: '#eef3ff', color: '#2f4c9a', border: '#ced9ff' },
    { bg: '#e8f8f1', color: '#1f7a58', border: '#bfe9d8' },
    { bg: '#fff3e8', color: '#9a5f1b', border: '#ffd9b5' },
    { bg: '#f3edff', color: '#6d39b4', border: '#dacbff' },
    { bg: '#ffeef2', color: '#b43b62', border: '#ffcfe0' }
  ];
  const getDispatchClientTone = (seed = '') => {
    const source = normalizeValue(seed || 'client');
    const hash = [...source].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
    return DISPATCH_CLIENT_TONES[hash % DISPATCH_CLIENT_TONES.length];
  };
  const getDispatchClientAvatarStyle = (client = {}) => {
    const tone = getDispatchClientTone(client.id || client.name || client.initials);
    return `background:${tone.bg};color:${tone.color};border:1px solid ${tone.border};`;
  };

  const ensureDispatchLocalitySaved = async (locality) => {
    const city = normalizeValue(locality);
    if (!city) return;
    const current = Array.isArray(state.reparto.localities) ? state.reparto.localities : [];
    if (current.some((item) => normalizeLower(item) === normalizeLower(city))) return;
    state.reparto.localities = [...current, city].sort((a, b) => normalizeValue(a).localeCompare(normalizeValue(b), 'es'));
    await persistRepartoStore();
  };
  const openDispatchClientsManager = async () => {
    let query = '';
    let page = 1;
    const PAGE = 8;
    let mode = 'list';
    let editingId = '';
    const getRows = () => Object.values(safeObject(state.reparto.clients || {}))
      .filter((item) => {
        const hay = normalizeLower(`${item.name || ''} ${item.doc || ''} ${item.address || ''}`);
        return !query || hay.includes(normalizeLower(query));
      })
      .sort((a, b) => normalizeValue(a.name).localeCompare(normalizeValue(b.name), 'es'));
    const renderList = (popup) => {
      const host = popup.querySelector('[data-dispatch-clients-host]');
      if (!host) return;
      const rows = getRows();
      const pages = Math.max(1, Math.ceil(rows.length / PAGE));
      page = Math.min(Math.max(1, page), pages);
      const slice = rows.slice((page - 1) * PAGE, page * PAGE);
      host.innerHTML = `<div class="dispatch-clients-manager-toolbar mb-2"><div class="input-group ios-input-group ingredientes-search-group dispatch-clients-manager-search"><span class="input-group-text ingredientes-search-icon"><i class="fa-solid fa-magnifying-glass"></i></span><input id="dispatchClientsManagerSearch" type="search" class="form-control ios-input" placeholder="Buscar cliente" value="${escapeHtml(query)}"></div><button type="button" class="btn ios-btn ios-btn-success inventario-threshold-btn" data-client-create-inline><i class="fa-solid fa-plus"></i><span>Crear cliente</span></button></div><div class="dispatch-clients-manager-list">${slice.map((item) => `<article class="dispatch-client-row"><div class="dispatch-client-row-main"><span class="user-avatar-thumb dispatch-client-suggest-avatar" style="${getDispatchClientAvatarStyle(item)}">${escapeHtml(item.initials || initialsFromPersonName(item.name) || 'U')}</span><div><strong>${escapeHtml(item.name || '-')}</strong><small>${escapeHtml(item.doc || '-')}</small></div></div><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-client-edit="${escapeHtml(item.id)}"><i class="fa-solid fa-pen"></i><span>Editar</span></button></article>`).join('') || '<p class="m-0">Sin clientes para ese filtro.</p>'}</div><div class="inventario-pagination enhanced mt-2"><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn inventario-page-btn" data-client-page="prev" ${page <= 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-left"></i></button><span>Página ${page} de ${pages}</span><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn inventario-page-btn" data-client-page="next" ${page >= pages ? 'disabled' : ''}><i class="fa-solid fa-chevron-right"></i></button></div>`;
      const searchInput = host.querySelector('#dispatchClientsManagerSearch');
      if (searchInput) {
        searchInput.focus();
        const len = searchInput.value.length;
        searchInput.setSelectionRange(len, len);
      }
    };
    const renderEdit = (popup, clientId) => {
      const host = popup.querySelector('[data-dispatch-clients-host]');
      const client = safeObject(state.reparto.clients?.[clientId]);
      if (!host || !client.id) return;
      host.innerHTML = `<div class=\"dispatch-clients-edit-head mb-2\"><div class=\"inventario-period-head mb-0\"><button type=\"button\" class=\"btn ios-btn ios-btn-secondary inventario-threshold-btn\" data-client-edit-back><i class=\"fa-solid fa-arrow-left\"></i><span>Volver</span></button><h6 class=\"step-title mb-0\">Editar cliente</h6></div><button type=\"button\" class=\"btn ios-btn ios-btn-success inventario-threshold-btn\" data-client-create-inline><i class=\"fa-solid fa-plus\"></i><span>Crear cliente</span></button></div><div class=\"swal-stack-fields text-start\"><div class=\"dispatch-client-preview\"><span id=\"dispatchClientEditInitialsPreview\" class=\"user-avatar-thumb dispatch-client-preview-avatar\" style=\"${getDispatchClientAvatarStyle(client)}\">${escapeHtml(client.initials || initialsFromPersonName(client.name) || 'U')}</span></div><input id=\"dispatchClientEditName\" class=\"swal2-input ios-input\" placeholder=\"Nombre\" value=\"${escapeHtml(client.name || '')}\"><input id=\"dispatchClientEditDoc\" class=\"swal2-input ios-input\" placeholder=\"DNI/CUIL\" value=\"${escapeHtml(client.doc || '')}\"><input id=\"dispatchClientEditAddress\" class=\"swal2-input ios-input\" placeholder=\"Dirección\" value=\"${escapeHtml(client.address || '')}\"><select id=\"dispatchClientEditCity\" class=\"swal2-select ios-input\">${renderDispatchLocalityOptions(client.city || '')}</select><select id=\"dispatchClientEditProvince\" class=\"swal2-select ios-input\">${ARG_PROVINCIAS.map((prov) => `<option value=\"${escapeHtml(prov)}\" ${normalizeValue(client.province || 'Santa Fe') === prov ? 'selected' : ''}>${escapeHtml(prov)}</option>`).join('')}</select><input id=\"dispatchClientEditCountry\" class=\"swal2-input ios-input\" placeholder=\"País\" value=\"${escapeHtml(client.country || 'Argentina')}\"></div><div class=\"produccion-config-actions\"><button type=\"button\" class=\"btn ios-btn ios-btn-success\" data-client-edit-save=\"${escapeHtml(client.id)}\"><i class=\"fa-solid fa-floppy-disk\"></i><span>Guardar</span></button></div>`;
      const nameInput = host.querySelector('#dispatchClientEditName');
      const citySelect = host.querySelector('#dispatchClientEditCity');
      const preview = host.querySelector('#dispatchClientEditInitialsPreview');
      const syncPreview = () => {
        if (!preview) return;
        const initials = initialsFromPersonName(nameInput?.value || client.name || '');
        preview.textContent = initials || 'U';
      };
      citySelect?.addEventListener('change', async () => {
        if (citySelect.value !== DISPATCH_NEW_LOCALITY_VALUE) return;
        const created = await askForNewDispatchLocality('');
        citySelect.innerHTML = renderDispatchLocalityOptions(created || client.city || '');
        citySelect.value = created || normalizeValue(client.city || '');
      });
      nameInput?.addEventListener('input', syncPreview);
      syncPreview();
    };
    await openIosSwal({
      title: 'Clientes de reparto',
      width: 'min(860px,96vw)',
      html: '<div data-dispatch-clients-host></div>',
      confirmButtonText: 'Cerrar',
      didOpen: (popup) => {
        renderList(popup);
        popup.addEventListener('input', (event) => {
          const search = event.target.closest('#dispatchClientsManagerSearch');
          if (!search) return;
          query = normalizeValue(search.value);
          page = 1;
          renderList(popup);
        });
        popup.addEventListener('click', async (event) => {
          const pageBtn = event.target.closest('[data-client-page]');
          if (pageBtn) {
            page += pageBtn.dataset.clientPage === 'next' ? 1 : -1;
            renderList(popup);
            return;
          }
          if (event.target.closest('[data-client-create-inline]')) {
            const created = await openCreateDispatchClient('');
            if (created) {
              page = 1;
              query = '';
              renderList(popup);
            }
            return;
          }
          const editBtn = event.target.closest('[data-client-edit]');
          if (editBtn) {
            mode = 'edit';
            editingId = editBtn.dataset.clientEdit;
            renderEdit(popup, editingId);
            return;
          }
          if (event.target.closest('[data-client-edit-back]')) {
            mode = 'list';
            editingId = '';
            renderList(popup);
            return;
          }
          const saveBtn = event.target.closest('[data-client-edit-save]');
          if (saveBtn) {
            const id = saveBtn.dataset.clientEditSave;
            const current = safeObject(state.reparto.clients?.[id]);
            if (!current.id) return;
            const name = normalizeValue(popup.querySelector('#dispatchClientEditName')?.value);
            const doc = normalizeValue(popup.querySelector('#dispatchClientEditDoc')?.value);
            const address = normalizeValue(popup.querySelector('#dispatchClientEditAddress')?.value);
            const city = normalizeValue(popup.querySelector('#dispatchClientEditCity')?.value);
            const province = normalizeValue(popup.querySelector('#dispatchClientEditProvince')?.value) || 'Santa Fe';
            const country = normalizeValue(popup.querySelector('#dispatchClientEditCountry')?.value) || 'Argentina';
            if (!name || !doc || !address || !city) {
              await openIosSwal({ title: 'Datos incompletos', html: '<p>Completá nombre, documento, dirección y localidad.</p>', icon: 'warning' });
              return;
            }
            state.reparto.clients[id] = { ...current, name, doc, address, city, province, country, initials: initialsFromPersonName(name) || current.initials || 'U', updatedAt: nowTs() };
            await ensureDispatchLocalitySaved(city);
            if (state.dispatchDraft?.clientId === id) {
              state.dispatchDraft.clientName = name;
              state.dispatchDraft.clientAddress = address;
              state.dispatchDraft.clientCity = city;
              state.dispatchDraft.clientProvince = province;
              state.dispatchDraft.clientCountry = country;
            }
            await persistRepartoStore();
            await openIosSwal({ title: 'Cliente actualizado', html: '<p>Se guardaron los cambios.</p>', icon: 'success' });
            mode = 'list';
            editingId = '';
            renderList(popup);
            if (state.dispatchCreateMode && state.dispatchDraft) renderDispatchCreate(state.dispatchDraft);
          }
        });
      }
    });
  };

  const openCreateDispatchVehicle = async () => {
    const result = await openIosSwal({
      title: 'Nueva UTA / URA',
      customClass: { popup: 'dispatch-vehicle-alert' },
      html: '<div class="swal-stack-fields text-start"><input id="dispatchVehicleNumber" class="swal2-input ios-input" placeholder="Número de URA / UTA"><input id="dispatchVehiclePatent" class="swal2-input ios-input" placeholder="Patente"><input id="dispatchVehicleBrand" class="swal2-input ios-input" placeholder="Marca"><input id="dispatchVehicleType" class="swal2-input ios-input" value="Camión" placeholder="Tipo"><input id="dispatchVehicleExpiry" class="swal2-input ios-input" placeholder="Vencimiento"><label for="dispatchVehicleFile" class="inventario-upload-dropzone"><i class="fa-regular fa-file"></i><span id="dispatchVehicleFileLabel">Adjunto: click o arrastrá</span></label><input id="dispatchVehicleFile" class="form-control image-file-input inventario-hidden-file-input" type="file" accept="image/*,application/pdf"></div>',
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      cancelButtonText: 'Cancelar',
      didOpen: () => {
        const expiryInput = document.getElementById('dispatchVehicleExpiry');
        const fileInput = document.getElementById('dispatchVehicleFile');
        const dropzone = document.querySelector('label[for="dispatchVehicleFile"]');
        const fileLabel = document.getElementById('dispatchVehicleFileLabel');
        if (window.flatpickr && expiryInput) {
          window.flatpickr(expiryInput, { locale: window.flatpickr.l10ns?.es || undefined, dateFormat: 'Y-m-d', altInput: true, altFormat: 'd/m/Y', allowInput: true, disableMobile: true });
        }
        fileInput?.addEventListener('change', () => {
          const file = fileInput.files?.[0];
          if (fileLabel) fileLabel.textContent = file ? `Adjunto: ${file.name}` : 'Adjunto: click o arrastrá';
        });
        dropzone?.addEventListener('dragover', (event) => {
          event.preventDefault();
          dropzone.classList.add('is-dragging');
        });
        dropzone?.addEventListener('dragleave', () => dropzone.classList.remove('is-dragging'));
        dropzone?.addEventListener('drop', (event) => {
          event.preventDefault();
          dropzone.classList.remove('is-dragging');
          const file = event.dataTransfer?.files?.[0];
          if (!file || !fileInput) return;
          const dt = new DataTransfer();
          dt.items.add(file);
          fileInput.files = dt.files;
        });
      },
      preConfirm: async () => {
        const number = normalizeValue(document.getElementById('dispatchVehicleNumber')?.value);
        const patent = normalizeValue(document.getElementById('dispatchVehiclePatent')?.value);
        const brand = normalizeValue(document.getElementById('dispatchVehicleBrand')?.value);
        const type = normalizeValue(document.getElementById('dispatchVehicleType')?.value) || 'Camión';
        const expiryDate = normalizeValue(document.getElementById('dispatchVehicleExpiry')?.value);
        if (!number) return Swal.showValidationMessage('Completá el número de URA/UTA.');
        if (!patent) return Swal.showValidationMessage('Completá patente.');
        if (!brand) return Swal.showValidationMessage('Completá marca.');
        if (!type) return Swal.showValidationMessage('Completá tipo.');
        if (!expiryDate) return Swal.showValidationMessage('Completá vencimiento.');
        const file = document.getElementById('dispatchVehicleFile')?.files?.[0] || null;
        if (!file) return Swal.showValidationMessage('Adjuntá respaldo del vehículo.');
        let attachmentUrl = '';
        if (file) {
          const validType = [...ALLOWED_UPLOAD_TYPES, 'application/pdf'].includes(file.type);
          if (!validType) return Swal.showValidationMessage('Adjunto inválido (imagen o PDF).');
          if (file.size > MAX_UPLOAD_SIZE_BYTES) return Swal.showValidationMessage('El adjunto supera 5MB.');
          attachmentUrl = await uploadImageToStorage(file, 'reparto/vehiculos');
        }
        return {
          number,
          patent,
          brand,
          type,
          expiryDate,
          attachmentUrl
        };
      }
    });
    if (!result.isConfirmed) return null;
    const id = makeId('dispatch_vehicle');
    state.reparto.vehicles[id] = { id, ...result.value, createdAt: nowTs() };
    await persistRepartoStore();
    return state.reparto.vehicles[id];
  };
  const openDispatchVehiclesManager = async () => {
    const rows = Object.values(safeObject(state.reparto.vehicles || {}));
    const html = rows.length
      ? `<div class="input-group ios-input-group ingredientes-search-group dispatch-vehicles-search-group"><span class="input-group-text ingredientes-search-icon"><i class="fa-solid fa-magnifying-glass"></i></span><input id="dispatchVehiclesSearchInput" type="search" class="form-control ios-input ingredientes-search-input" placeholder="Buscar por número, patente o marca" autocomplete="off"></div><div id="dispatchVehiclesManagerList" class="dispatch-vehicles-manager-list">${rows.map((item) => {
        const meta = getDispatchVehicleExpiryMeta(item);
        return `<div class="dispatch-vehicle-manager-card tone-${meta.tone}" data-vehicle-search="${escapeHtml(normalizeLower(`${item.number || ''} ${item.patent || ''} ${item.brand || ''} ${item.type || ''}`))}"><p><strong>${escapeHtml(formatDispatchVehicleLabel(item))}</strong></p><small>${escapeHtml(item.brand || '-')} · ${escapeHtml(item.patent || '-')}</small><div class="dispatch-vehicle-manager-actions"><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-vehicle-view="${escapeHtml(item.id)}"><i class="fa-regular fa-eye"></i><span>Adjunto</span></button><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-vehicle-upload="${escapeHtml(item.id)}"><i class="fa-solid fa-upload"></i><span>Reemplazar</span></button><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-vehicle-clear="${escapeHtml(item.id)}"><i class="fa-solid fa-paperclip"></i><span>Quitar</span></button><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-vehicle-toggle="${escapeHtml(item.id)}"><i class="fa-solid fa-toggle-${item.enabled === false ? 'off' : 'on'}"></i><span>${item.enabled === false ? 'Deshabilitado' : 'Habilitado'}</span></button><button type="button" class="btn ios-btn ios-btn-danger inventario-threshold-btn" data-vehicle-delete="${escapeHtml(item.id)}"><i class="fa-solid fa-trash"></i><span>Eliminar</span></button></div></div>`;
      }).join('')}</div>`
      : '<p>No hay unidades cargadas.</p>';
    const result = await openIosSwal({
      title: 'Gestionar UTA/URA',
      html,
      width: 'min(980px,96vw)',
      confirmButtonText: 'Cerrar',
      didOpen: () => {
        const box = Swal.getHtmlContainer();
        const refreshVehiclesManagerList = () => {
          const list = box?.querySelector('#dispatchVehiclesManagerList');
          if (!list) return;
          const rowsLive = Object.values(safeObject(state.reparto.vehicles || {}));
          list.innerHTML = rowsLive.map((item) => {
            const meta = getDispatchVehicleExpiryMeta(item);
            return `<div class="dispatch-vehicle-manager-card tone-${meta.tone}" data-vehicle-search="${escapeHtml(normalizeLower(`${item.number || ''} ${item.patent || ''} ${item.brand || ''} ${item.type || ''}`))}"><p><strong>${escapeHtml(formatDispatchVehicleLabel(item))}</strong></p><small>${escapeHtml(item.brand || '-')} · ${escapeHtml(item.patent || '-')}</small><div class="dispatch-vehicle-manager-actions"><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-vehicle-view="${escapeHtml(item.id)}"><i class="fa-regular fa-eye"></i><span>Adjunto</span></button><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-vehicle-upload="${escapeHtml(item.id)}"><i class="fa-solid fa-upload"></i><span>Reemplazar</span></button><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-vehicle-clear="${escapeHtml(item.id)}"><i class="fa-solid fa-paperclip"></i><span>Quitar</span></button><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-vehicle-toggle="${escapeHtml(item.id)}"><i class="fa-solid fa-toggle-${item.enabled === false ? 'off' : 'on'}"></i><span>${item.enabled === false ? 'Deshabilitado' : 'Habilitado'}</span></button><button type="button" class="btn ios-btn ios-btn-danger inventario-threshold-btn" data-vehicle-delete="${escapeHtml(item.id)}"><i class="fa-solid fa-trash"></i><span>Eliminar</span></button></div></div>`;
          }).join('') || '<p>No hay unidades cargadas.</p>';
        };
        const searchInput = box?.querySelector('#dispatchVehiclesSearchInput');
        searchInput?.addEventListener('input', () => {
          const query = normalizeLower(searchInput.value);
          box.querySelectorAll('.dispatch-vehicle-manager-card[data-vehicle-search]').forEach((card) => {
            const hay = normalizeLower(card.getAttribute('data-vehicle-search') || '');
            card.classList.toggle('d-none', Boolean(query) && !hay.includes(query));
          });
        });
        
        box?.addEventListener('click', async (ev) => {
          const id = ev.target.closest('[data-vehicle-view],[data-vehicle-upload],[data-vehicle-clear],[data-vehicle-toggle],[data-vehicle-delete]')?.dataset.vehicleView
            || ev.target.closest('[data-vehicle-upload]')?.dataset.vehicleUpload
            || ev.target.closest('[data-vehicle-clear]')?.dataset.vehicleClear
            || ev.target.closest('[data-vehicle-toggle]')?.dataset.vehicleToggle
            || ev.target.closest('[data-vehicle-delete]')?.dataset.vehicleDelete;
          if (!id) return;
          const vehicle = safeObject(state.reparto.vehicles[id]);
          if (!vehicle.id) return;
          if (ev.target.closest('[data-vehicle-view]')) {
            if (!vehicle.attachmentUrl) {
              await openIosSwal({ title: 'Sin adjunto', html: '<p>No hay adjunto cargado.</p>', icon: 'info' });
            } else if (typeof window.laJamoneraOpenImageViewer === 'function') {
              await window.laJamoneraOpenImageViewer([{ invoiceImageUrls: [vehicle.attachmentUrl] }], 0, 'Adjunto UTA/URA');
            } else {
              window.open(vehicle.attachmentUrl, '_blank', 'noopener,noreferrer');
            }
            return;
          }
          if (ev.target.closest('[data-vehicle-upload]')) {
            const pick = await openIosSwal({ title: 'Reemplazar adjunto', customClass: { popup: 'dispatch-vehicle-replace-alert' }, html: '<div class="dispatch-vehicle-replace-wrap"><label for="vehicleReplaceFile" class="inventario-upload-dropzone"><i class="fa-solid fa-upload"></i><span id="vehicleReplaceLabel">Seleccioná un archivo PDF o imagen</span></label><input id="vehicleReplaceFile" type="file" class="inventario-hidden-file-input" accept="image/*,application/pdf"></div>', showCancelButton: true, confirmButtonText: 'Subir', didOpen: () => { const fileInput = document.getElementById('vehicleReplaceFile'); const label = document.getElementById('vehicleReplaceLabel'); fileInput?.addEventListener('change', () => { const file = fileInput.files?.[0]; if (label) label.textContent = file ? file.name : 'Seleccioná un archivo PDF o imagen'; }); }, preConfirm: async () => {
              const file = document.getElementById('vehicleReplaceFile')?.files?.[0];
              if (!file) return Swal.showValidationMessage('Seleccioná un archivo.');
              if (![...ALLOWED_UPLOAD_TYPES, 'application/pdf'].includes(file.type)) return Swal.showValidationMessage('Sólo imagen o PDF.');
              if (file.size > MAX_UPLOAD_SIZE_BYTES) return Swal.showValidationMessage('Máximo 5MB.');
              return uploadImageToStorage(file, 'reparto/vehiculos');
            } });
            if (pick.isConfirmed && pick.value) {
              state.reparto.vehicles[id].attachmentUrl = pick.value;
              await persistRepartoStore();
              refreshVehiclesManagerList();
            }
            return;
          }
          if (ev.target.closest('[data-vehicle-clear]')) {
            state.reparto.vehicles[id].attachmentUrl = '';
            await persistRepartoStore();
            refreshVehiclesManagerList();
            return;
          }
          if (ev.target.closest('[data-vehicle-toggle]')) {
            state.reparto.vehicles[id].enabled = state.reparto.vehicles[id].enabled === false;
            await persistRepartoStore();
            refreshVehiclesManagerList();
            return;
          }
          if (ev.target.closest('[data-vehicle-delete]')) {
            delete state.reparto.vehicles[id];
            await persistRepartoStore();
            refreshVehiclesManagerList();
          }
        });
      }
    });
    return result.isConfirmed;
  };
  const showRestoringStockOverlay = (title = 'Restaurando stock...') => {
    Swal.fire({
      title,
      html: '<div class="informes-saving-spinner"><img src="./IMG/Meta-ai-logo.webp" alt="Restaurando stock" class="meta-spinner-login"></div>',
      allowOutsideClick: false,
      allowEscapeKey: false,
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

  const cancelProduction = async (registro) => {
    const productionId = normalizeValue(registro?.id);
    if (!productionId) return;
    const linkedDispatch = getDispatchRecordsList().filter((row) => (Array.isArray(row?.products) ? row.products : []).some((product) => (Array.isArray(product?.allocations) ? product.allocations : []).some((allocation) => normalizeValue(allocation?.productionId) === productionId)));
    if (linkedDispatch.length) {
      await openIosSwal({ title: 'Eliminación bloqueada', html: '<p>Esta producción está asociada a una salida de productos. Eliminá primero los repartos vinculados.</p>', icon: 'warning' });
      return;
    }
    const confirmDelete = await openIosSwal({
      title: 'Eliminar producción',
      html: '<p>Se eliminará la producción, se restaurará el stock de insumos usados y se limpiarán los movimientos relacionados del historial.</p><small>Esta acción no se puede deshacer.</small>',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Eliminar',
      cancelButtonText: 'Cancelar'
    });
    if (!confirmDelete.isConfirmed) return;
    const auth = await askSensitivePassword('Clave general requerida', '<p>Confirmá para eliminar la producción y revertir su impacto.</p>', true);
    if (!auth.isConfirmed) return;
    showRestoringStockOverlay();
    try {
      const latestInventory = safeObject(await window.dbLaJamoneraRest.read('/inventario'));
      const restored = applyPlanOnInventory(latestInventory, { ingredientPlans: registro.lots || [] }, productionId, registro.productionDate, 'restore');
      const registros = deepClone(state.registros);
      const previous = deepClone(registros[productionId]);
      delete registros[productionId];
      removeRecipeMovementsBySource({ recipeId: registro.recipeId, sourceId: productionId, sourceCode: productionId });
      await window.dbLaJamoneraRest.write('/inventario', restored);
      await window.dbLaJamoneraRest.write(REGISTROS_PATH, registros);
      await persistRepartoStore();
      await appendAudit({ action: 'produccion_eliminada', productionId, before: previous, after: null, reason: auth.value.reason });
      state.inventario = restored;
      state.registros = registros;
      await refreshAfterMutation();
      if (Swal.isVisible()) Swal.close();
      await openIosSwal({ title: 'Producción eliminada', html: `<p>Se eliminó ${productionId} y se restauró el stock.</p>`, icon: 'success', confirmButtonText: 'Entendido' });
    } catch (error) {
      if (Swal.isVisible()) Swal.close();
      await openIosSwal({ title: 'No se pudo eliminar', html: '<p>Ocurrió un error restaurando stock. Intentá nuevamente.</p>', icon: 'error' });
    }
  };


  const refreshAfterMutation = async () => {
    await refreshData({ silent: true });
    if (state.historyMode) renderHistoryTable();
    if (state.dispatchMode) {
      if (state.dispatchCreateMode) {
        renderDispatchCreate();
      } else {
        renderDispatchMain();
      }
    }
    if (state.view === 'editor' && state.activeRecipeId) {
      await renderEditor(state.activeRecipeId);
    } else if (state.view === 'list') {
      renderList();
    }
  };

  const deleteDispatchRecord = async (dispatchRow) => {
    const dispatchId = normalizeValue(dispatchRow?.id);
    if (!dispatchId) return;
    const confirmDelete = await openIosSwal({
      title: 'Eliminar salida de productos',
      html: '<p>Se eliminará la salida, se restaurará el stock disponible y se limpiarán los movimientos relacionados del historial.</p><small>Esta acción no se puede deshacer.</small>',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Eliminar',
      cancelButtonText: 'Cancelar'
    });
    if (!confirmDelete.isConfirmed) return;
    const auth = await askSensitivePassword('Clave general requerida', '<p>Confirmá para eliminar la salida de productos.</p>', true);
    if (!auth.isConfirmed) return;
    showRestoringStockOverlay();
    try {
      const repartoNext = normalizeDispatchStore(deepClone(state.reparto));
      const previous = deepClone(repartoNext.registros[dispatchId]);
      delete repartoNext.registros[dispatchId];
      state.reparto = repartoNext;
      (Array.isArray(dispatchRow?.products) ? dispatchRow.products : []).forEach((product) => {
        removeRecipeMovementsBySource({ recipeId: product.recipeId, sourceId: dispatchId, sourceCode: dispatchRow.code });
      });
      await persistRepartoStore();
      await appendAudit({ action: 'reparto_eliminado', dispatchId, before: previous, after: null, reason: auth.value.reason });
      await refreshAfterMutation();
      if (Swal.isVisible()) Swal.close();
      await openIosSwal({ title: 'Salida eliminada', html: `<p>Se eliminó ${escapeHtml(dispatchRow.code || dispatchId)} y se restauró el stock disponible.</p>`, icon: 'success' });
    } catch (error) {
      if (Swal.isVisible()) Swal.close();
      await openIosSwal({ title: 'No se pudo eliminar', html: '<p>Ocurrió un error restaurando stock. Intentá nuevamente.</p>', icon: 'error' });
    }
  };

  const editProduction = async (registro) => {
    if (registro.status === 'anulada') {
      await openIosSwal({ title: 'No editable', html: '<p>Una producción anulada no puede editarse.</p>', icon: 'warning', confirmButtonText: 'Entendido' });
      return;
    }
    const auth = await askSensitivePassword('Editar producción', '<p>Se recalculará el consumo FEFO.</p>', true);
    if (!auth.isConfirmed) return;
    const form = await openIosSwal({
      title: `Editar ${registro.id}`,
      html: `<div class="swal-stack-fields"><input id="editQty" type="number" min="0.1" step="0.01" class="swal2-input ios-input" value="${Number(registro.quantityKg || 0).toFixed(2)}"><input id="editDate" type="date" class="swal2-input ios-input" value="${registro.productionDate || toIsoDate()}"><textarea id="editObs" class="swal2-textarea ios-input">${escapeHtml(registro.observations || '')}</textarea></div>`,
      showCancelButton: true,
      confirmButtonText: 'Guardar cambios',
      cancelButtonText: 'Cancelar',
      preConfirm: () => ({ qty: parsePositive(document.getElementById('editQty')?.value, 0), date: normalizeValue(document.getElementById('editDate')?.value), obs: normalizeValue(document.getElementById('editObs')?.value) })
    });
    if (!form.isConfirmed) return;
    const recipe = state.recetas[registro.recipeId];
    if (!recipe) return;
    const currentInventory = safeObject(await window.dbLaJamoneraRest.read('/inventario'));
    const restored = applyPlanOnInventory(currentInventory, { ingredientPlans: registro.lots || [] }, registro.id, registro.productionDate, 'restore');
    const backup = state.inventario;
    state.inventario = restored;
    const plan = buildPlanForRecipe(recipe, form.value.qty, form.value.date || toIsoDate());
    state.inventario = backup;
    if (!plan.isValid) {
      await openIosSwal({ title: 'No se puede editar', html: `<p>${plan.conflicts.join('<br>')}</p>`, icon: 'warning', confirmButtonText: 'Entendido' });
      return;
    }
    const consumed = applyPlanOnInventory(restored, plan, registro.id, form.value.date || toIsoDate(), 'consume');
    const agingDaysAtProduction = Number(recipe.agingDays || 0);
    const packagingDate = agingDaysAtProduction > 0
      ? moveIsoFromSunday(addDaysToIso(toIsoDate(nowTs()), agingDaysAtProduction))
      : '';
    const registros = deepClone(state.registros);
    const prev = deepClone(registros[registro.id]);
    const snapshotIngredientPlans = enrichIngredientPlansWithSnapshots(plan.ingredientPlans);
    registros[registro.id] = {
      ...registro,
      quantityKg: Number(form.value.qty.toFixed(2)),
      productionDate: form.value.date || toIsoDate(),
      observations: form.value.obs,
      lots: snapshotIngredientPlans,
      agingDaysAtProduction,
      packagingDate,
      editedAt: nowTs(),
      editedBy: getCurrentUserLabel(),
      editReason: auth.value.reason,
      traceability: {
        ...safeObject(registro.traceability),
        ingredients: snapshotIngredientPlans.map((ingredientPlan) => ({
          ingredientId: ingredientPlan.ingredientId,
          ingredientName: ingredientPlan.ingredientName,
          ingredientImageUrl: normalizeValue(state.ingredientes[ingredientPlan.ingredientId]?.imageUrl || safeObject(registro.traceability).ingredients?.find((item) => normalizeValue(item?.ingredientId) === normalizeValue(ingredientPlan.ingredientId))?.ingredientImageUrl),
          requiredQty: Number(ingredientPlan.neededQty || 0),
          unit: normalizeValue(ingredientPlan.ingredientUnit || ''),
          lots: (Array.isArray(ingredientPlan.lots) ? ingredientPlan.lots : []).map((lot) => ({
            entryId: lot.entryId,
            lotNumber: lot.lotNumber,
            takeQty: lot.takeQty,
            unit: lot.unit,
            expiryDate: lot.expiryDate,
            provider: lot.provider,
            providerRne: normalizeRneRecord(safeObject(lot.providerRne)),
            invoiceNumber: lot.invoiceNumber,
            invoiceImageUrls: Array.isArray(lot.invoiceImageUrls) ? lot.invoiceImageUrls : []
          }))
        }))
      }
    };
    await window.dbLaJamoneraRest.write('/inventario', consumed);
    await window.dbLaJamoneraRest.write(REGISTROS_PATH, registros);
    await appendAudit({ action: 'produccion_editada', productionId: registro.id, before: prev, after: registros[registro.id], reason: auth.value.reason });
    state.inventario = consumed;
    state.registros = registros;
    renderHistoryTable();
    await openIosSwal({ title: 'Producción editada', html: `<p>${registro.id} fue recalculada y guardada.</p>`, icon: 'success', confirmButtonText: 'Entendido' });
  };

  const getRneExpiryMeta = () => {
    const hasAttachment = Boolean(normalizeValue(state.config?.rne?.attachmentUrl));
    if (Boolean(state.config?.rne?.infiniteExpiry)) {
      return { visible: false, days: null, tone: 'ok', text: 'RNE con vencimiento infinito (∞).', hasAttachment, infinite: true };
    }
    const expiryIso = normalizeValue(state.config?.rne?.expiryDate);
    if (!expiryIso) return { visible: false, days: null, tone: 'none', text: '', hasAttachment, infinite: false };
    const expiryTs = new Date(`${expiryIso}T00:00:00`).getTime();
    if (!Number.isFinite(expiryTs)) return { visible: false, days: null, tone: 'none', text: '', hasAttachment, infinite: false };
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = Math.ceil((expiryTs - today.getTime()) / (1000 * 60 * 60 * 24));
    const tone = days < 0 ? 'danger' : days < 60 ? 'danger' : days < 180 ? 'warning' : 'ok';
    const text = days < 0
      ? `El RNE de la Jamonera venció hace ${Math.abs(days)} días (${formatIsoEs(expiryIso)}).`
      : `El RNE de la Jamonera vence en ${days} días (${formatIsoEs(expiryIso)}).`;
    const visible = tone === 'warning' || tone === 'danger';
    return { visible, days, tone, text, hasAttachment, infinite: false };
  };

  const renderRneExpiryAlert = () => {
    if (!nodes.rneAlert) return;
    const meta = getRneExpiryMeta();
    nodes.rneAlert.className = `produccion-rne-expiry-alert ${meta.visible ? '' : 'd-none'} ${meta.tone === 'danger' ? 'is-danger' : meta.tone === 'ok' ? 'is-ok' : 'is-warning'}`.trim();
    if (!meta.visible) {
      nodes.rneAlert.innerHTML = '';
      return;
    }
    nodes.rneAlert.innerHTML = `<i class="bi ${meta.tone === 'danger' ? 'bi-exclamation-octagon-fill' : meta.tone === 'ok' ? 'bi-check-circle-fill' : 'bi-exclamation-triangle-fill'}"></i><span>${escapeHtml(meta.text)}</span>`;
  };

  const renderModalRneBadge = () => {
    if (!nodes.modalTitle) return;
    const meta = getRneExpiryMeta();
    const attachmentLabel = meta.hasAttachment ? 'RNE adjunto' : 'Sin adjunto';
    let expiryBadge = '';
    if (meta.infinite) {
      expiryBadge = '<span class="produccion-modal-rne-badge is-ok"><i class="bi bi-infinity"></i>RNE</span>';
    } else if (meta.days != null) {
      const expiryLabel = meta.days < 0 ? `Vencido hace ${Math.abs(meta.days)} días` : `Vence en ${meta.days} días`;
      expiryBadge = `<span class="produccion-modal-rne-badge ${meta.tone === 'danger' ? 'is-danger' : meta.tone === 'warning' ? 'is-warning' : 'is-ok'}"><i class="bi bi-clock-history"></i>${escapeHtml(expiryLabel)}</span>`;
    }
    const attachmentBadge = `<span class="produccion-modal-rne-badge ${meta.hasAttachment ? 'is-ok' : 'is-warning'}"><i class="bi bi-paperclip"></i>${attachmentLabel}</span>`;
    if (!expiryBadge) {
      nodes.modalTitle.innerHTML = `Producción <span class="produccion-modal-rne-badges">${attachmentBadge}</span>`;
      return;
    }
    nodes.modalTitle.innerHTML = `Producción <span class="produccion-modal-rne-badges">${attachmentBadge}${expiryBadge}</span>`;
  };

  const renderList = () => {
    renderRneExpiryAlert();
    renderModalRneBadge();
    const query = normalizeLower(state.search);
    const list = getRecipes()
      .filter((item) => !query || normalizeLower(item.title).includes(query) || normalizeLower(item.description).includes(query))
      .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
    if (!list.length) {
      nodes.list.innerHTML = '<div class="ingrediente-empty-list">No hay recetas para ese filtro.</div>';
      updateProduccionListScrollHint();
      setStateView(getRecipes().length ? 'list' : 'empty');
      return;
    }
    const buildCoverageChecksHtml = (analysis) => {
      const available = analysis.requirements.filter((item) => item.missingForMin <= 0.0001).length;
      return `
        <div class="produccion-checks-head">${available}/${analysis.requirements.length} ingredientes listos</div>
        <div class="produccion-checks-list">${analysis.requirements.map((item) => `
          <span class="produccion-check-item ${item.missingForMin <= 0.0001 ? 'is-ok' : (item.missingForMinIncludingExpired <= 0.0001 ? 'is-expired' : 'is-missing')}">
            <i class="fa-solid ${item.missingForMin <= 0.0001 ? 'fa-circle-check' : (item.missingForMinIncludingExpired <= 0.0001 ? 'fa-triangle-exclamation' : 'fa-circle-xmark')}"></i>
            <span>${item.name}</span>
          </span>`).join('')}
        </div>`;
    };
    const cardsHtml = list.map((recipe) => {
      const analysis = state.analysis[recipe.id] || analyzeRecipe(recipe);
      const dispatchMeta = getProducedStockMeta(recipe.id);
      const draftLock = getRecipeDraftLockInfo(recipe.id);
      const isExpiredOnlyAvailable = Boolean(!analysis.canProduce && analysis.canProduceConsideringExpired);
      const statusClass = isExpiredOnlyAvailable
        ? 'tone-expired'
        : (analysis.status === 'success' ? 'tone-success' : analysis.status === 'warning' ? 'tone-warning' : 'tone-danger');
      const canOpenProduction = Boolean(analysis.canProduce || analysis.canProduceConsideringExpired);
      const actionToneClass = canOpenProduction
        ? (analysis.canProduce ? 'ios-btn-success' : 'ios-btn-danger')
        : 'ios-btn-success';
      const action = `<button type="button" class="btn ios-btn ${actionToneClass} produccion-main-btn ${canOpenProduction ? '' : 'is-disabled'}" data-open-produccion="${recipe.id}" ${canOpenProduction ? '' : 'disabled'}><i class="bi bi-plus-lg"></i><span>Producir</span></button>`;
      const inventoryAction = analysis.canProduce
        ? ''
        : `<button type="button" class="btn ios-btn inventory-production-action-btn is-inventory" data-open-inventario="1"><i class="fa-solid fa-boxes-stacked"></i><span>Inventario</span></button>`;
      const viewAction = `<button type="button" class="btn ios-btn ios-btn-secondary produccion-visualizar-btn" data-open-produccion="${recipe.id}"><i class="fa-regular fa-eye"></i><span>Visualizar</span></button>`;
      const foreignDraft = getForeignDraftConflict(recipe.id);
      const badges = [
        analysis.missingForMin.length
          ? `<span class="produccion-badge">${isExpiredOnlyAvailable ? 'Faltan insumos frescos' : 'Faltan insumos'}</span>`
          : '',
        (!isExpiredOnlyAvailable && analysis.status === 'warning') ? '<span class="produccion-badge is-warning">Stock parcial</span>' : '',
        analysis.hasExpired ? '<span class="produccion-badge is-danger">Posee lotes expirados</span>' : '',
        foreignDraft ? '<span class="produccion-badge is-warning">Borrador en uso</span>' : ''
      ].filter(Boolean).join('');
      const missingFresh = analysis.missingForMin.filter((item) => Number(item.missingForMinIncludingExpired || 0) > 0.0001);
      const expiredOnlyIngredients = analysis.requirements.filter((item) => item.missingForMin > 0.0001 && item.missingForMinIncludingExpired <= 0.0001);
      const missingHtml = analysis.missingForMin.length
        ? `<div class="produccion-missing-list">${missingFresh.map((item) => `<p><strong>${item.name}:</strong> disponible ${formatQty(item.available, item.unit)} / faltan ${formatQty(item.missingForMin, item.unit)}</p>`).join('')}${expiredOnlyIngredients.map((item) => `<p><strong>${item.name}:</strong> sin stock fresco · disponible en expirado ${formatQty(item.totalAvailable, item.unit)}</p>`).join('')}</div>`
        : '<p class="produccion-ok-line">Cobertura suficiente para iniciar producción.</p>';
      const lastProductionAt = state.config.lastProductionByRecipe?.[recipe.id] || recipe.lastProductionAt || recipe.production?.lastAt || 0;
      return `
        <article class="ingrediente-card receta-card produccion-card ${statusClass}">
          <div class="ingrediente-avatar receta-thumb-wrap">
            ${recipe.imageUrl
              ? `<span class="thumb-loading"><img class="meta-spinner-login" src="./IMG/Meta-ai-logo.webp" alt="Cargando"></span><img class="receta-thumb js-produccion-thumb" src="${recipe.imageUrl}" alt="${capitalize(recipe.title || 'Receta')}" loading="lazy">`
              : getThumbPlaceholder()}
          </div>
          <div class="ingrediente-main receta-main">
            <div class="produccion-row-head">
              <h6 class="ingrediente-name receta-name">${capitalize(recipe.title || 'Sin título')}</h6>
              <span class="produccion-chip ${statusClass}"><span class="produccion-semaforo"></span>${isExpiredOnlyAvailable ? 'Disponible con expirados' : analysis.statusText}</span>
            </div>
            <div class="produccion-stats-line">
              <div class="produccion-stat-block">
                <small>Máximo producible</small>
                ${isExpiredOnlyAvailable
      ? `<strong class="produccion-max-expired-only">${Number(analysis.maxKgIncludingExpired || 0).toFixed(2)} kg*</strong>`
      : (draftLock?.blockedKg > 0
        ? `<div class="produccion-max-values"><strong class="produccion-max-base">${analysis.maxKg.toFixed(2)} kg</strong><strong class="produccion-max-adjusted">${Math.max(0, analysis.maxKg - draftLock.blockedKg).toFixed(2)} kg</strong></div>`
        : `<strong>${analysis.maxKg.toFixed(2)} kg</strong>`)}
              </div>
              <div class="produccion-stat-sep" aria-hidden="true"></div>
              <div class="produccion-stat-block">
                <small>Mínimo</small>
                <strong>${analysis.minKg.toFixed(2)} kg</strong>
              </div>
              <div class="produccion-stat-sep" aria-hidden="true"></div>
              <div class="produccion-stat-block is-stock-up">
                <small>En stock <i class="fa-solid fa-arrow-up"></i></small>
                <strong>${dispatchMeta.available.toFixed(2)} kg</strong>
              </div>
              <div class="produccion-stat-sep" aria-hidden="true"></div>
              <div class="produccion-stat-block is-stock-down">
                <small>Últimos egresados <i class="fa-solid fa-arrow-down"></i></small>
                <strong>${dispatchMeta.lastWeekOut.toFixed(2)} kg</strong>
              </div>
              <div class="produccion-stat-sep" aria-hidden="true"></div>
              <div class="produccion-stat-block">
                <small><button type="button" class="btn btn-link p-0 produccion-product-history-btn" data-open-recipe-history="${recipe.id}">Historial</button></small>
              </div>
            </div>
            ${Number(analysis.expiredKg || 0) > 0.0001 ? `<p class="produccion-last-line produccion-last-line-expired"><i class="fa-solid fa-triangle-exclamation"></i> <strong>Kilos expirados:</strong> <strong>${Number(analysis.expiredKg || 0).toFixed(2)} kg</strong></p>` : ''}
            ${(!analysis.canProduce && analysis.canProduceConsideringExpired) ? `<p class="produccion-last-line produccion-last-line-expired"><i class="fa-solid fa-calendar-days"></i> Podes producir con lote vencido ${Number(analysis.maxKgIncludingExpired || 0).toFixed(2)} kg, pero en el rango de fecha ${formatDateRangeForRecipe(recipe)}.</p>` : ''}
            ${draftLock?.blockedKg > 0 ? `<p class="produccion-last-line" data-draft-lock-line="${recipe.id}"><i class="fa-solid fa-lock"></i> Bloqueado por borrador: <strong>${draftLock.blockedKg.toFixed(2)} kg</strong> · disponible en <strong data-draft-lock-time="${recipe.id}">${formatCountdown(draftLock.remainingMs)}</strong></p>` : ''}
            <p class="produccion-last-line"><i class="fa-regular fa-clock"></i> Última producción: <strong>${formatDate(lastProductionAt)}</strong></p>
            <div class="produccion-progress-wrap ${isExpiredOnlyAvailable ? 'is-expired-only' : ''}">
              <div class="produccion-progress-bar"><span class="${isExpiredOnlyAvailable ? 'is-expired' : (analysis.status === 'danger' ? 'is-danger' : analysis.progress >= 100 ? 'is-success' : 'is-warning')}" style="width:${(isExpiredOnlyAvailable ? Number(analysis.progressIncludingExpired || 0) : analysis.progress).toFixed(1)}%"></span></div>
              <small>Cobertura del mínimo: ${(isExpiredOnlyAvailable ? Number(analysis.progressIncludingExpired || 0) : analysis.progress).toFixed(0)}%${isExpiredOnlyAvailable ? ' (con expirados)' : ''}</small>
            </div>
            ${buildCoverageChecksHtml(analysis)}
            <div class="produccion-badges">${badges}</div>
            ${analysis.errors.length ? `<p class="produccion-error">${analysis.errors[0]}</p>` : missingHtml}
            <div class="produccion-actions-row inventory-production-actions">
              ${action.replace('produccion-main-btn', 'produccion-main-btn inventory-production-action-btn is-main')}
              <span class="barra-vertical produccion-actions-divider" aria-hidden="true"></span>
              ${inventoryAction}
              ${viewAction.replace('produccion-visualizar-btn', 'produccion-visualizar-btn inventory-production-action-btn is-view')}
              <button type="button" class="btn ios-btn inventory-production-action-btn is-threshold" data-set-recipe-min="${recipe.id}"><i class="fa-solid fa-sliders"></i><span>Umbral</span></button>
            </div>
          </div>
        </article>`;
    }).join('');
    const drafts = getOwnDrafts();
    const draftsHtml = drafts.length
      ? `<section class="produccion-drafts-wrap">
          <h6 class="step-title"><span class="recipe-step-number">B</span> Borradores</h6>
          <div class="produccion-drafts-grid">${drafts.map((draft) => {
            const recipe = state.recetas[draft.recipeId] || {};
            return `<article class="produccion-draft-card">
              <div>
                <strong>${capitalize(recipe.title || 'Receta')}</strong>
                <small>Actualizado: ${formatDateTime(draft.updatedAt)}</small>
                ${getDraftReservationCountdown(draft) ? `<small class="produccion-reserva-timer" data-draft-reservation-timer="${draft.id}">Reserva activa: ${getDraftReservationCountdown(draft)}</small>` : '<small data-draft-reservation-timer="">Reserva sin bloqueo activo.</small>'}
                ${getDraftExpirationCountdown(draft) ? `<small class="produccion-reserva-timer" data-draft-expiry-timer="${draft.id}">Borrador vence en: ${getDraftExpirationCountdown(draft)}</small>` : '<small data-draft-expiry-timer="">Borrador vencido.</small>'}
              </div>
              <div class="produccion-draft-actions">
                <button type="button" class="btn ios-btn ios-btn-secondary" data-open-draft="${draft.id}"><i class="fa-solid fa-pen"></i><span>Continuar</span></button>
                <button type="button" class="btn ios-btn ios-btn-danger" data-delete-draft="${draft.id}"><i class="fa-solid fa-trash"></i><span>Descartar</span></button>
              </div>
            </article>`;
          }).join('')}</div>
        </section>`
      : '';
    nodes.list.innerHTML = `${draftsHtml}${cardsHtml}`;
    document.querySelectorAll('.js-produccion-thumb').forEach((image) => {
      const wrap = image.closest('.receta-thumb-wrap');
      image.addEventListener('error', () => {
        if (wrap) wrap.innerHTML = getThumbPlaceholder();
      }, { once: true });
    });
    prepareThumbLoaders('.js-produccion-thumb');
    updateProduccionListScrollHint();
    if (state.draftsTick) clearInterval(state.draftsTick);
    state.draftsTick = setInterval(async () => {
      if (state.view !== 'list' || state.historyMode || state.activeRecipeId) return;
      const ownDrafts = Object.values(safeObject(state.drafts)).filter((item) => item.ownerSessionId === sessionId && item.status === 'active' && item.recipeId);
      let hasExpiredDraft = false;
      ownDrafts.forEach((draft) => {
        const reservationNode = nodes.list.querySelector(`[data-draft-reservation-timer="${draft.id}"]`);
        const reservationCountdown = getDraftReservationCountdown(draft);
        if (reservationNode) reservationNode.textContent = reservationCountdown ? `Reserva activa: ${reservationCountdown}` : 'Reserva sin bloqueo activo.';
        const expiryNode = nodes.list.querySelector(`[data-draft-expiry-timer="${draft.id}"]`);
        const draftCountdown = getDraftExpirationCountdown(draft);
        if (expiryNode) expiryNode.textContent = draftCountdown ? `Borrador vence en: ${draftCountdown}` : 'Borrador vencido.';
        if (!draftCountdown) hasExpiredDraft = true;
      });
      Object.keys(state.recetas || {}).forEach((recipeId) => {
        const timerNode = nodes.list.querySelector(`[data-draft-lock-time="${recipeId}"]`);
        if (!timerNode) return;
        const lock = getRecipeDraftLockInfo(recipeId);
        if (!lock?.blockedKg || lock.remainingMs <= 0) {
          const lockLine = timerNode.closest('[data-draft-lock-line]');
          lockLine?.remove();
          return;
        }
        timerNode.textContent = formatCountdown(lock.remainingMs);
      });
      if (hasExpiredDraft) {
        await cleanupExpiredDrafts();
        recomputeAnalysis();
        const activeDraftNodes = nodes.list.querySelectorAll('[data-draft-expiry-timer]');
        if (activeDraftNodes.length) {
          renderList();
        }
      }
    }, 1000);
    setStateView('list');
  };
  const buildLotsBreakdownHtml = (plan) => {
    const mergeIcon = './IMG/Octicons-git-merge.svg';
    const gitIcon = './IMG/Octicons-git-branch.svg';
    const allExpanded = plan.ingredientPlans.every((row) => state.lotCollapseState[row.ingredientId] !== true);
    const allCollapsed = plan.ingredientPlans.every((row) => state.lotCollapseState[row.ingredientId] === true);
    const getExpiryBadge = (expiryDate) => {
      const expiry = normalizeValue(expiryDate);
      if (!expiry) return '<span class="produccion-expiry-badge is-unknown">Sin fecha</span>';
      const days = Math.ceil((new Date(`${expiry}T00:00:00`).getTime() - new Date(`${plan.productionDate}T00:00:00`).getTime()) / 86400000);
      if (days < 0) return `<span class="produccion-expiry-badge is-danger">Vencido ${Math.abs(days)}d</span>`;
      if (days <= 2) return `<span class="produccion-expiry-badge is-danger">${days}d</span>`;
      if (days <= 4) return `<span class="produccion-expiry-badge is-warning">${days}d</span>`;
      return `<span class="produccion-expiry-badge is-ok">${days}d</span>`;
    };
    return `<div class="produccion-lote-global-actions">
        <button type="button" class="btn ios-btn ios-btn-secondary" id="produccionCollapseAllBtn" ${allCollapsed ? 'disabled' : ''}>Colapsar todo</button>
        <button type="button" class="btn ios-btn ios-btn-secondary" id="produccionExpandAllBtn" ${allExpanded ? 'disabled' : ''}>Descolapsar todo</button>
      </div>` + plan.ingredientPlans.map((row) => `
      <article class="produccion-lote-group ${row.missingQty > 0 ? 'is-missing' : ''}" data-lot-group="${row.ingredientId}">
        <header class="produccion-lote-head">
          <div class="produccion-lote-main">
            <img src="${state.ingredientes[row.ingredientId]?.imageUrl || FIAMBRES_IMAGE}" alt="${row.ingredientName}" class="produccion-lote-ingredient-image">
            <div>
              <h6>${row.ingredientName}</h6>
              <p>
                <span class="produccion-needs-label">Necesita</span>
                <strong class="produccion-needs-value">${formatCompactQty(row.neededQty, row.ingredientUnit)}</strong>
                <span class="produccion-available-value">· Disponible <strong>${formatCompactQty(row.availableQty, row.ingredientUnit)}</strong></span>
                ${row.missingQty > 0 ? ` <em>· Faltan ${formatCompactQty(row.missingQty, row.ingredientUnit)}</em>` : ''}
              </p>
            </div>
          </div>
          <div class="produccion-lote-head-actions">
            <button type="button" class="btn ios-btn ios-btn-secondary produccion-lote-toggle-btn" data-lot-toggle="${row.ingredientId}">
              <i class="fa-solid ${state.lotCollapseState[row.ingredientId] ? 'fa-chevron-down' : 'fa-chevron-up'}"></i>
              <span>${state.lotCollapseState[row.ingredientId] ? 'Desplegar' : 'Colapsar'}</span>
            </button>
            <img src="${gitIcon}" alt="Desglose" class="produccion-merge-icon" width="20" height="20" style="width:20px;height:20px;">
          </div>
        </header>
        <div class="produccion-lote-rows ${state.lotCollapseState[row.ingredientId] ? 'is-collapsed' : ''}">
          ${row.lots.length ? row.lots.map((lot) => `
          <div class="produccion-lote-row tone-${lot.status}">
            <div><strong class="produccion-lote-key">Lote:</strong> <span class="produccion-lote-value">${lot.lotNumber}</span></div>
            <div><strong>Ingreso:</strong> ${lot.entryDate || formatDateTime(lot.createdAt)}</div>
            <div><strong>Vence:</strong> ${formatExpiryHuman(lot.expiryDate)} ${normalizeLower(lot.expiryDate) === 'no perecedero' ? '' : getExpiryBadge(lot.expiryDate)}</div>
            <div><strong>Usar:</strong> ${formatCompactQty(lot.takeQty, lot.unit)}</div>
            ${lot.status === 'expired' ? `<div class="produccion-lote-expired-help"><strong>Lote expirado:</strong> no se usará con fecha ${plan.productionDate}. Cambiá la fecha o resolvelo manualmente ${formatValidProductionRange(lot.entryDate, lot.expiryDate)}.</div>` : ''}
            <div><strong class="produccion-provider-key">Proveedor:</strong> ${lot.provider || '-'}</div>
            <div><strong>Factura:</strong> ${lot.invoiceNumber || '-'}</div>
            <div class="produccion-lote-adjuntos-row"><strong>Adjuntos:</strong> ${lot.invoiceImageUrls.length
              ? `<button type="button" class="btn ios-btn ios-btn-secondary produccion-lote-adjuntos-btn" data-lot-images="${encodeURIComponent(JSON.stringify(lot.invoiceImageUrls))}"><i class="fa-regular fa-image"></i><span>Ver (${lot.invoiceImageUrls.length})</span></button>`
              : '<span>Sin adjuntos</span>'}</div>
            ${lot.status === 'expired' ? `<div class="produccion-lote-expired-actions"><button type="button" class="btn ios-btn ios-btn-secondary" data-resolve-expired-lot="${escapeHtml(lot.ingredientId)}" data-resolve-expired-entry="${escapeHtml(lot.entryId)}" data-resolve-expired-qtykg="${Number(lot.availableKg || 0).toFixed(4)}" data-resolve-expired-mode="sold_counter"><i class="fa-solid fa-shop"></i><span>Vendido en mostrador</span></button><button type="button" class="btn ios-btn ios-btn-danger" data-resolve-expired-lot="${escapeHtml(lot.ingredientId)}" data-resolve-expired-entry="${escapeHtml(lot.entryId)}" data-resolve-expired-qtykg="${Number(lot.availableKg || 0).toFixed(4)}" data-resolve-expired-mode="decommissioned"><i class="fa-solid fa-trash"></i><span>Decomisado</span></button></div>` : ''}
          </div>`).join('<hr class="produccion-lote-separator">') : '<p class="produccion-lote-empty">Sin lotes aptos para la fecha elegida.</p>'}
        </div>
      </article>
    `).join('');
  };
  const saveEditorDraft = async () => {
    const recipe = state.recetas[state.activeRecipeId];
    if (!recipe || !state.editorPlan) return;
    const qty = parsePositive(nodes.editor.querySelector('#produccionQtyInput')?.value, state.editorPlan.qtyKg || 1);
    const productionDate = normalizeValue(nodes.editor.querySelector('#produccionDateInput')?.value) || toIsoDate();
    const observations = normalizeValue(nodes.editor.querySelector('#produccionObsInput')?.value);
    const managers = [...nodes.editor.querySelectorAll('[data-manager-check]:checked')].map((node) => node.value).filter(Boolean);
    await persistDraft({
      recipeId: recipe.id,
      quantityKg: qty,
      productionDate,
      managers,
      observations,
      locks: state.editorPlan.locks,
      lotPlan: state.editorPlan,
      pendingExpiryActions: safeObject(state.pendingExpiryActions),
      reservationId: state.activeReservationId,
      step: 'editor',
      status: 'active'
    });
  };
  const buildManagersHtml = (selected = []) => {
    const users = Object.values(safeObject(state.users))
      .sort((a, b) => String(a.fullName || a.email || '').localeCompare(String(b.fullName || b.email || '')));
    if (!users.length) return '<p class="produccion-empty-users">No hay usuarios cargados. Podés continuar sin asignar encargados.</p>';
    return users.map((user) => {
      const fullName = normalizeValue(user.fullName || user.name || user.email || 'Usuario');
      const userId = normalizeValue(user.id) || normalizeValue(user.email) || `user_${normalizeLower(fullName).replace(/[^a-z0-9]+/g, '_')}`;
      const position = normalizeValue(user.position || user.role || 'Sin puesto');
      return `<label class="produccion-user-check">
        <input type="checkbox" data-manager-check value="${userId}" ${selected.includes(userId) ? 'checked' : ''}>
        ${renderUserAvatar(user)}
        <span class="produccion-user-text"><strong>${fullName}</strong><small>${position}</small></span>
      </label>`;
    }).join('');
  };
  const renderEditor = async (recipeId) => {
    const recipe = state.recetas[recipeId];
    const analysis = state.analysis[recipeId];
    if (!recipe || !analysis) return;
    const foreignDraft = getForeignDraftConflict(recipe.id);
    if (foreignDraft) {
      const action = await openIosSwal({
        title: 'Conflicto de borrador',
        html: `<p>Existe un borrador en uso para esta receta por ${foreignDraft.ownerLabel || 'otro usuario'}.</p>`,
        showCancelButton: true,
        showDenyButton: true,
        confirmButtonText: 'Cancelar borrador y continuar',
        denyButtonText: 'Cargar borrador',
        cancelButtonText: 'Volver'
      });
      if (action.isDismissed) return;
      if (action.isDenied) {
        state.activeDraftId = foreignDraft.id;
      } else if (action.isConfirmed) {
        const next = { ...state.drafts };
        delete next[foreignDraft.id];
        await window.dbLaJamoneraRest.write(DRAFTS_PATH, next);
        state.drafts = next;
      }
    }
    const ownDraft = getCurrentDraftForRecipe(recipe.id);
    const preferredManagers = Array.isArray(state.config.preferredManagersByRecipe?.[recipe.id])
      ? state.config.preferredManagersByRecipe[recipe.id]
      : (Array.isArray(state.config.preferredManagers) ? state.config.preferredManagers : []);
    const editorMaxKg = Math.max(0.1, Number(analysis.maxKg || 0), Number(analysis.maxKgIncludingExpired || 0));
    const requestedInitialQty = ownDraft ? parsePositive(ownDraft.quantityKg, analysis.minKg) : Math.max(analysis.minKg, 0.1);
    const initialQty = Math.min(editorMaxKg, Math.max(0.1, requestedInitialQty));
    const initialDate = ownDraft?.productionDate || toIsoDate();
    const initialObs = ownDraft?.observations || '';
    const initialManagers = Array.isArray(ownDraft?.managers) ? ownDraft.managers : preferredManagers;
    state.pendingExpiryActions = safeObject(ownDraft?.pendingExpiryActions);
    state.lotCollapseState = {};
    state.editorPlan = buildPlanForRecipe(recipe, initialQty, initialDate);
    await ensureReservationForPlan(state.editorPlan);
    state.activeDraftId = ownDraft?.id || state.activeDraftId;
    nodes.editor.innerHTML = `
      <div class="recetas-editor-header produccion-editor-header">
        <button id="produccionBackBtn" type="button" class="btn ios-btn ios-btn-secondary recetas-back-btn"><i class="fa-solid fa-arrow-left"></i><span>Atrás</span></button>
        <div>
          <p class="recetas-editor-kicker">Producción</p>
          <h6 class="recetas-editor-title mb-0">Detalle de producción</h6>
        </div>
      </div>
      <section class="inventario-product-head-v2 produccion-head-box">
        <div class="produccion-hero-wrap">
          <img src="${FIAMBRES_IMAGE}" class="produccion-hero-bg" alt="Producción">
          <div class="produccion-hero-avatar">
            <span class="thumb-loading"><img class="meta-spinner-login" src="./IMG/Meta-ai-logo.webp" alt="Cargando"></span><img id="produccionHeadImage" class="produccion-head-image js-produccion-head-photo" src="${normalizeValue(recipe.imageUrl) || FIAMBRES_IMAGE}" alt="${capitalize(recipe.title || 'Producto')}" loading="lazy">
          </div>
        </div>
        <div class="inventario-product-copy">
          <p class="inventario-editor-kicker"><img src="./IMG/Octicons-git-branch.svg" class="produccion-head-icon" alt="Flujo"> Flujo de producción</p>
          <h3 class="inventario-editor-name">${capitalize(recipe.title || 'Sin título')}</h3>
          <p class="inventario-editor-meta">${capitalize(recipe.description || 'Sin descripción.')}</p>
          <p class="produccion-max-line">Máximo según inventario: <strong>${analysis.maxKg.toFixed(2)} kg</strong>${Number(analysis.maxKgIncludingExpired || 0) > Number(analysis.maxKg || 0) ? ` <span class="produccion-expired-max-help">(con vencidos: ${Number(analysis.maxKgIncludingExpired || 0).toFixed(2)} kg)</span>` : ''}</p>
          <p id="produccionReservaTimer" class="produccion-reserva-timer"></p>
        </div>
      </section>
      <section class="recipe-step-card step-block">
        <h6 class="step-title"><span class="recipe-step-number">1</span> ¿Qué cantidad deseás producir?</h6>
        <div class="produccion-qty-grid">
          <input id="produccionQtyInput" type="number" min="0.1" step="0.01" max="${editorMaxKg.toFixed(2)}" value="${initialQty.toFixed(2)}" class="form-control ios-input">
          <button id="produccionQtyMaxBtn" type="button" class="btn ios-btn ios-btn-secondary">Usar máximo</button>
        </div>
        <p id="produccionQtyHelp" class="produccion-qty-help"></p>
      </section>
      <section class="recipe-step-card step-block">
        <h6 class="step-title"><span class="recipe-step-number">2</span> Fecha de producción</h6>
        <input id="produccionDateInput" type="text" class="form-control ios-input" value="${initialDate}">
        <p class="produccion-qty-help">Si cambiás la fecha, recalculamos vencimientos y lotes (FEFO).</p>
      </section>
      <section class="recipe-step-card step-block">
        <h6 class="step-title"><span class="recipe-step-number">3</span> Encargados</h6>
        <div class="produccion-managers-actions">
          <button id="produccionSaveManagersPrefBtn" type="button" class="btn ios-btn ios-btn-secondary"><i class="fa-regular fa-bookmark"></i><span>Guardar preferencia</span></button>
        </div>
        <div class="produccion-managers-grid">${buildManagersHtml(initialManagers)}</div>
      </section>
      <section class="recipe-step-card step-block">
        <h6 class="step-title"><span class="recipe-step-number">4</span> Observaciones</h6>
        <textarea id="produccionObsInput" class="form-control ios-input" rows="3" placeholder="Notas de producción, incidentes, reemplazos...">${initialObs}</textarea>
      </section>
      <section class="recipe-step-card step-block">
        <h6 class="step-title"><span class="recipe-step-number">5</span> Desglose por lotes (FEFO)</h6>
        <p class="produccion-fefo-note"><strong>FEFO:</strong> <span>First Expired, First Out</span> · primero vence, primero se usa.</p>
        <div id="produccionLotsBreakdown" class="produccion-lotes-wrap"></div>
      </section>
      <section class="recipe-step-card step-block">
        <h6 class="step-title"><span class="recipe-step-number">6</span> Historial de producción</h6>
        <div id="produccionRecipeHistory" class="produccion-recipe-history"></div>
      </section>
      <section class="recipe-step-card step-block">
        <div class="produccion-final-actions">
          <button id="produccionSaveDraftBtn" type="button" class="btn ios-btn ios-btn-secondary"><i class="fa-solid fa-floppy-disk"></i><span>Guardar borrador</span></button>
          <button id="produccionConfirmBtn" type="button" class="btn ios-btn ios-btn-success"><i class="fa-solid fa-check"></i><span>Confirmar producción</span></button>
        </div>
      </section>`;
    const qtyInput = nodes.editor.querySelector('#produccionQtyInput');
    const dateInput = nodes.editor.querySelector('#produccionDateInput');
    const qtyHelp = nodes.editor.querySelector('#produccionQtyHelp');
    const lotsWrap = nodes.editor.querySelector('#produccionLotsBreakdown');
    const confirmBtn = nodes.editor.querySelector('#produccionConfirmBtn');
    const recipeHistoryState = { search: '', range: '' };
    const getRecipeHistoryRows = () => {
      const [from, to] = normalizeValue(recipeHistoryState.range).split(' a ').map((item) => normalizeValue(item));
      const fromTs = from ? new Date(`${from}T00:00:00`).getTime() : 0;
      const toTs = to ? new Date(`${to}T23:59:59`).getTime() : 0;
      const query = normalizeLower(recipeHistoryState.search);
      return getRegistrosList()
        .filter((item) => normalizeValue(item.recipeId) === normalizeValue(recipe.id))
        .filter((item) => {
          const createdAt = Number(item?.createdAt || 0);
          if (fromTs && createdAt < fromTs) return false;
          if (toTs && createdAt > toTs) return false;
          if (!query) return true;
          const blob = [item.id, item.recipeTitle, item.status, formatDateTime(item.createdAt), item.productionDate]
            .map(normalizeLower)
            .join(' ');
          return blob.includes(query);
        })
        .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    };
    const getRecipeCalendarKgMap = () => getProductionKgDayMap(getRegistrosList().filter((item) => normalizeValue(item.recipeId) === normalizeValue(recipe.id)));
    const printRecipeHistoryRows = async (rows) => {
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
      const attachedImages = ask.isConfirmed
        ? rows.flatMap((item) => getTraceRowsFromRegistro(item).flatMap((trace) => trace.invoiceImageUrls || []))
        : [];
      if (ask.isConfirmed) {
        await preloadPrintImages(attachedImages);
      }
      const win = window.open('', '_blank', 'width=1300,height=900');
      if (!win) return;
      const bodyRows = rows.flatMap((item) => {
        const manager = getManagerLabel(item);
        const productImage = normalizeValue(item?.traceability?.product?.imageUrl) || normalizeValue(state.recetas?.[item.recipeId]?.imageUrl);
        const productCell = `<span style="display:inline-flex;align-items:center;gap:8px;">${productImage ? `<img src="${escapeHtml(productImage)}" style="width:28px;height:28px;border-radius:999px;object-fit:cover;border:1px solid #d7def2;">` : ''}<strong>${escapeHtml(item.recipeTitle || '-')}</strong></span>`;
        const main = `<tr><td>${escapeHtml(item.id || '-')}</td><td>${escapeHtml(formatDateTime(item.createdAt))}</td><td>${productCell}</td><td>${Number(item.quantityKg || 0).toFixed(2)} kg</td><td>${escapeHtml(manager.name)}<br><small>${escapeHtml(manager.role)}</small></td><td>${escapeHtml(formatProductExpiryLabel(item))} (VTO)</td></tr>`;
        const resolutions = (Array.isArray(item?.lots) ? item.lots : [])
          .flatMap((plan) => (Array.isArray(plan?.lots) ? plan.lots : [])
            .flatMap((lot) => (Array.isArray(lot?.expiryResolutions) ? lot.expiryResolutions : [])
              .filter((res) => isHighlightedResolutionType(res.type))
              .map((res) => `<tr class="is-resolution-row"><td>↳ RES</td><td>${escapeHtml(formatDateTime(res.createdAt))}</td><td>${escapeHtml(item.recipeTitle || '-')}</td><td>-${Number(res.qtyKg || 0).toFixed(2)} kg</td><td>${escapeHtml(res.type === 'decommissioned' ? 'Decomisado' : 'Vendido en mostrador')}</td><td>${escapeHtml(formatProductExpiryLabel(item))} (VTO)</td></tr>`)));
        if (!includeTrace) return [main, ...resolutions];
        const traces = getTraceRowsFromRegistro(item).map((trace) => `<tr class="is-trace-row"><td>↳ ${trace.index}</td><td><span class="print-trace-date">${escapeHtml(formatDateTime(trace.createdAt))}</span></td><td><span style="display:inline-flex;align-items:center;gap:8px;">${trace.ingredientImageUrl ? `<img src="${escapeHtml(trace.ingredientImageUrl)}" style="width:22px;height:22px;border-radius:999px;object-fit:cover;border:1px solid #d7def2;">` : ''}<span>${escapeHtml(trace.ingredientName)}</span></span></td><td>-${escapeHtml(trace.amount)}</td><td>${escapeHtml(trace.lotNumber)}</td><td><span class="print-trace-vto">${escapeHtml(formatExpiryHuman(trace.expiryDate))}${normalizeLower(trace.expiryDate)==='no perecedero' ? '' : ' (VTO)'}</span></td></tr>`);
        return [main, ...resolutions, ...traces];
      }).join('');
      const tracesWithAttachments = rows.flatMap((item) => getTraceRowsFromRegistro(item).filter((trace) => Array.isArray(trace.invoiceImageUrls) && trace.invoiceImageUrls.length));
      const imagesHtml = ask.isConfirmed && tracesWithAttachments.length
        ? `<section><h2 style="margin:16px 0 10px;font-size:18px;">Imágenes adjuntas</h2><div style="display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));">${tracesWithAttachments.map((trace) => `<figure style="margin:0;border:1px solid #d7def2;border-radius:12px;padding:10px;background:#fff;"><div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;"><figcaption style="font-size:12px;color:#4b5f8e;font-weight:700;">${escapeHtml(trace.ingredientName)}</figcaption></div>${(trace.invoiceImageUrls || []).map((url) => `<img src="${url}" style="width:100%;max-height:220px;object-fit:contain;border-radius:10px;margin-top:8px;">`).join('')}</figure>`).join('')}</div></section>`
        : '';
      win.document.write(`<html><head><title>Historial producción ${escapeHtml(capitalize(recipe.title || ''))}</title><style>body{font-family:Inter,Arial;padding:20px;color:#1f2a44}table{width:100%;border-collapse:collapse}th,td{border:1px solid #d7def2;padding:6px;font-size:11px;vertical-align:top}th{background:#eef3ff;font-size:10px;text-transform:uppercase;letter-spacing:.04em}.is-trace-row td{background:#ffecef}.is-resolution-row td{background:#fff6d9}.print-trace-date{color:#1f6fd6;font-weight:700}.print-trace-vto{color:#b04a09;font-weight:700}</style></head><body><h1>Historial producción ${escapeHtml(capitalize(recipe.title || ''))}</h1><table><thead><tr><th>ID</th><th>Fecha y hora</th><th>Producto</th><th>Cantidad</th><th>Responsable</th><th>VTO producto</th></tr></thead><tbody>${bodyRows || '<tr><td colspan="6">Sin datos</td></tr>'}</tbody></table>${imagesHtml}</body></html>`);
      win.document.close();
      win.focus();
      await waitPrintAssets(win);
      win.print();
    };
    const renderRecipeHistory = () => {
      const rows = getRecipeHistoryRows();
      const node = nodes.editor.querySelector('#produccionRecipeHistory');
      if (!node) return;
      rows.forEach((item) => {
        if (state.historyTraceCollapse[item.id] !== undefined) return;
        if (getTraceRowsFromRegistro(item).length) state.historyTraceCollapse[item.id] = true;
      });
      if (!rows.length) {
        node.innerHTML = '<p class="produccion-lote-empty">Todavía no hay producciones confirmadas para esta receta.</p>';
        return;
      }
      const traceableRows = rows.filter((item) => getTraceRowsFromRegistro(item).length);
      const canCollapseRows = traceableRows.some((item) => state.historyTraceCollapse[item.id] !== true);
      const canExpandRows = traceableRows.some((item) => state.historyTraceCollapse[item.id] === true);
      const htmlRows = rows.map((item, index) => {
        const manager = getManagerLabel(item);
        const traceRows = getTraceRowsFromRegistro(item);
        const isCollapsed = state.historyTraceCollapse[item.id] === true;
        const planillaDisabled = hasPlanillaDisponible(item) ? '' : 'disabled';
        const traceHtml = (!isCollapsed && traceRows.length)
          ? traceRows.map((trace) => `<tr class="inventario-trace-row"><td><div class="inventario-trace-main"><img src="./IMG/Octicons-git-merge.svg" alt="merge" class="inventario-trace-icon"><span class="inventario-trace-avatar">${trace.ingredientImageUrl ? `<span class="thumb-loading"><img class="meta-spinner-login" src="./IMG/Meta-ai-logo.webp" alt="Cargando"></span><img class="thumb-image js-produccion-thumb" src="${escapeHtml(trace.ingredientImageUrl)}" alt="${escapeHtml(trace.ingredientName)}">` : '<i class="fa-solid fa-carrot"></i>'}</span><span class="inventario-trace-label">${escapeHtml(trace.ingredientName)}</span></div></td><td></td><td><span class="produccion-trace-date">${escapeHtml(formatDateTime(trace.createdAt))}</span></td><td class="inventario-trace-kilos">-${escapeHtml(trace.amount)}</td><td>${escapeHtml(trace.lotNumber)}</td><td><span class="produccion-trace-expiry">${escapeHtml(formatExpiryHuman(trace.expiryDate))}${normalizeLower(trace.expiryDate)==='no perecedero' ? '' : ' (VTO)'}</span></td><td><span class="produccion-trace-badge">Trazabilidad</span></td><td>-</td><td>${trace.invoiceImageUrls.length ? `<button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-recipe-prod-trace-images="${encodeURIComponent(JSON.stringify(trace.invoiceImageUrls))}"><i class="fa-regular fa-image"></i><span>Adjunto (${trace.invoiceImageUrls.length})</span></button>` : '<button type="button" class="btn ios-btn ios-btn-danger inventario-no-photo-btn" disabled>Sin adjuntos</button>'}</td><td>-</td></tr>`).join('') : '';
        return `<tr class="inventario-row-tone ${index % 2 === 0 ? 'is-even-row' : 'is-odd-row'}"><td><div class="d-flex align-items-center gap-2">${traceRows.length ? `<button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-recipe-prod-collapse="${escapeHtml(item.id || '')}" title="${isCollapsed ? 'Descolapsar' : 'Colapsar'}" aria-label="${isCollapsed ? 'Descolapsar' : 'Colapsar'}"><i class="fa-solid ${isCollapsed ? 'fa-expand' : 'fa-compress'}"></i></button>` : ''}<span>${escapeHtml(item.id || '-')}</span></div></td><td>${escapeHtml(formatDateTime(item.createdAt))}</td><td>${escapeHtml(item.recipeTitle || '-')}</td><td>${Number(item.quantityKg || 0).toFixed(2)} kg</td><td><span class="produccion-responsable-wrap"><strong>${escapeHtml(manager.name)}</strong><small>${escapeHtml(manager.role)}</small></span></td><td class="produccion-vto-cell">${escapeHtml(formatProductExpiryLabel(item))}</td><td><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-recipe-prod-trace="${escapeHtml(item.id || '')}"><img src="./IMG/family-tree-icon-no-bg.svg" alt="" style="width:14px;height:14px"><span>Trazabilidad</span></button></td><td><div class="produccion-planilla-actions"><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-recipe-prod-planilla="${escapeHtml(item.id || '')}" ${planillaDisabled}><i class="fa-regular fa-file-lines"></i><span>Planilla</span></button><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-recipe-prod-qr-print="${escapeHtml(item.id || '')}" title="Imprimir QR"><i class="fa-solid fa-qrcode"></i></button></div></td><td>${traceRows.some((trace) => trace.invoiceImageUrls.length) ? `<button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-recipe-prod-trace-images='${encodeURIComponent(JSON.stringify(traceRows.flatMap((trace) => trace.invoiceImageUrls)))}'><i class="fa-regular fa-image"></i><span>Ver adjuntos</span></button>` : '<button type="button" class="btn ios-btn ios-btn-danger inventario-no-photo-btn" disabled>Sin adjuntos</button>'}</td><td><button type="button" class="btn ios-btn ios-btn-danger inventario-threshold-btn" data-recipe-prod-delete="${escapeHtml(item.id || '')}"><i class="fa-solid fa-trash"></i><span>Eliminar</span></button></td></tr>${traceHtml}`;
      }).join('');
      node.innerHTML = `
        <div class="inventario-table-head enhanced">
          <input id="produccionRecipeHistorySearch" type="search" class="form-control ios-input" autocomplete="off" placeholder="Buscar por producción" value="${escapeHtml(recipeHistoryState.search)}">
          <div class="inventario-history-toolbar">
            <div class="inventario-table-range">
              <input id="produccionRecipeHistoryRange" class="form-control ios-input" autocomplete="off" placeholder="Rango de fechas" value="${escapeHtml(recipeHistoryState.range)}">
            </div>
            <div class="inventario-print-row toolbar-scroll-x">
              <button type="button" class="btn ios-btn inventario-delete-btn inventario-threshold-btn ${recipeHistoryState.range ? '' : 'd-none'}" id="produccionRecipeHistoryClearBtn"><i class="fa-solid fa-xmark"></i><span>Limpiar rango</span></button>
              <button type="button" class="btn ios-btn inventario-expand-btn inventario-threshold-btn" id="produccionRecipeHistoryExpandBtn"><i class="fa-solid fa-up-right-and-down-left-from-center"></i><span>Ampliar</span></button>
              <button type="button" class="btn ios-btn ios-btn-success inventario-threshold-btn" id="produccionRecipeHistoryExcelBtn"><i class="fa-solid fa-file-excel"></i><span>Excel</span></button>
              <span class="inventario-period-divider" aria-hidden="true"></span>
              <button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" id="produccionRecipeHistoryPrintFilteredBtn"><i class="fa-solid fa-print"></i><span>Imprimir filtro</span></button>
              <button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" id="produccionRecipeHistoryPrintAllBtn"><i class="fa-solid fa-print"></i><span>Imprimir total</span></button>
            </div>
            <div class="inventario-print-row toolbar-scroll-x">
              <button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" id="produccionRecipeHistoryCollapseAllRowsBtn" ${canCollapseRows ? '' : 'disabled'}><i class="fa-solid fa-compress"></i><span>Colapsar</span></button>
              <button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" id="produccionRecipeHistoryExpandAllRowsBtn" ${canExpandRows ? '' : 'disabled'}><i class="fa-solid fa-expand"></i><span>Descolapsar</span></button>
            </div>
          </div>
        </div>
        <div class="table-responsive inventario-table-compact-wrap">
          <table class="table recipe-table inventario-table-compact mb-0">
            <thead><tr><th>ID producción</th><th>Fecha y hora</th><th>Producto</th><th>Fabricado (KG.)</th><th>Responsable</th><th>VTO producto</th><th>Trazabilidad</th><th>Planilla</th><th>Adjuntos</th><th>Acciones</th></tr></thead>
            <tbody>${htmlRows}</tbody>
          </table>
        </div>`;
      prepareThumbLoaders('.js-produccion-thumb');
      const rangeNode = nodes.editor.querySelector('#produccionRecipeHistoryRange');
      if (window.flatpickr && rangeNode) {
        const locale = window.flatpickr.l10ns?.es || undefined;
        const dayMap = getRecipeCalendarKgMap();
        disableCalendarSuggestions(rangeNode);
        window.flatpickr(rangeNode, {
          locale,
          mode: 'range',
          dateFormat: 'Y-m-d',
          allowInput: false,
          defaultDate: normalizeValue(recipeHistoryState.range).split(' a ').filter(Boolean),
          onDayCreate: (_dObj, _dStr, _fp, dayElem) => {
            const iso = dayElem?.dateObj ? getArgentinaIsoDate(dayElem.dateObj) : '';
            const producedKg = Number(dayMap[iso] || 0);
            if (producedKg <= 0) return;
            const bubble = document.createElement('span');
            bubble.className = 'inventario-day-kg';
            bubble.textContent = `${producedKg.toFixed(2)}kg`;
            dayElem.appendChild(bubble);
          },
          onClose: (_dates, _str, instance) => {
            const from = instance.selectedDates[0] ? toIsoDate(instance.selectedDates[0].getTime()) : '';
            const to = instance.selectedDates[1] ? toIsoDate(instance.selectedDates[1].getTime()) : '';
            recipeHistoryState.range = from && to ? `${from} a ${to}` : from;
            renderRecipeHistory();
          }
        });
      }
    };
    const updateEditorPlan = async () => {
      const editorMaxKg = Math.max(analysis.maxKg, analysis.maxKgIncludingExpired || 0);
      let qty = parsePositive(qtyInput.value, 0.1);
      if (qty > editorMaxKg) qty = editorMaxKg;
      qtyInput.value = qty.toFixed(2);
      const productionDate = normalizeValue(dateInput.value) || toIsoDate();
      state.editorPlan = buildPlanForRecipe(recipe, qty, productionDate);
      lotsWrap.innerHTML = buildLotsBreakdownHtml(state.editorPlan);
      renderRecipeHistory();
      const expiredLotsCount = state.editorPlan.ingredientPlans.reduce((acc, row) => acc + row.lots.filter((lot) => lot.status === 'expired').length, 0);
      const canConfirm = state.editorPlan.isValid && qty > 0 && expiredLotsCount === 0;
      if (confirmBtn) confirmBtn.disabled = !canConfirm;
      qtyHelp.textContent = canConfirm
        ? `Escala aplicada: ${qty.toFixed(2)} kg. Reserva temporal activa por 10 min.`
        : (qty <= 0 ? 'Modo visualización: ajustá kilos para confirmar producción.' : `Hay conflictos de stock/lotes para ${productionDate}.`);
      if (expiredLotsCount > 0) {
        qtyHelp.textContent += ` Detectamos ${expiredLotsCount} lote(s) vencido(s): resolvé su estado o cambiá fecha para continuar. También podés ajustar la fecha para recalcular FEFO.`;
      }
      await ensureReservationForPlan(state.editorPlan);
    };
    nodes.editor.addEventListener('click', async (event) => {
      const resolveExpiredBtn = event.target.closest('[data-resolve-expired-entry]');
      if (resolveExpiredBtn) {
        const ingredientId = normalizeValue(resolveExpiredBtn.dataset.resolveExpiredLot);
        const entryId = normalizeValue(resolveExpiredBtn.dataset.resolveExpiredEntry);
        const maxQtyKg = parseNumber(resolveExpiredBtn.dataset.resolveExpiredQtykg) || 0;
        const resolutionType = normalizeValue(resolveExpiredBtn.dataset.resolveExpiredMode);
        if (!ingredientId || !entryId || maxQtyKg <= 0) return;
        if (!resolutionType) return;
        const label = resolutionType === 'decommissioned' ? 'decomisar' : 'vender en mostrador';
        const askConfirm = await openIosSwal({
          title: 'Confirmar acción',
          html: `<div class="text-center produccion-resolve-qty-wrap"><p>Se aplicará <strong>${label}</strong> sobre el lote completo.</p><p>Cantidad afectada: <strong>${maxQtyKg.toFixed(3)} kg</strong>.</p></div>`,
          showCancelButton: true,
          confirmButtonText: 'Confirmar',
          cancelButtonText: 'Cancelar',
        });
        if (!askConfirm.isConfirmed) return;
        state.pendingExpiryActions[entryId] = {
          ingredientId,
          type: resolutionType,
          qtyKg: Number(maxQtyKg.toFixed(3))
        };
        await updateEditorPlan();
        await openIosSwal({ title: 'Acción preparada', html: '<p>La resolución se aplicará al confirmar la producción.</p>', icon: 'success', confirmButtonText: 'Continuar' });
        return;
      }
      const toggleBtn = event.target.closest('[data-lot-toggle]');
      if (toggleBtn && state.editorPlan) {
        const ingredientId = toggleBtn.dataset.lotToggle;
        state.lotCollapseState[ingredientId] = !state.lotCollapseState[ingredientId];
        lotsWrap.innerHTML = buildLotsBreakdownHtml(state.editorPlan);
      renderRecipeHistory();
        return;
      }
      if (event.target.closest('#produccionCollapseAllBtn') && state.editorPlan) {
        state.editorPlan.ingredientPlans.forEach((item) => {
          state.lotCollapseState[item.ingredientId] = true;
        });
        lotsWrap.innerHTML = buildLotsBreakdownHtml(state.editorPlan);
      renderRecipeHistory();
        return;
      }
      if (event.target.closest('#produccionExpandAllBtn') && state.editorPlan) {
        state.editorPlan.ingredientPlans.forEach((item) => {
          state.lotCollapseState[item.ingredientId] = false;
        });
        lotsWrap.innerHTML = buildLotsBreakdownHtml(state.editorPlan);
      renderRecipeHistory();
        return;
      }
      if (event.target.closest('#produccionRecipeHistoryClearBtn')) {
        recipeHistoryState.range = '';
        renderRecipeHistory();
        return;
      }
      if (event.target.closest('#produccionRecipeHistoryCollapseAllRowsBtn')) {
        getRecipeHistoryRows().forEach((item) => {
          if (getTraceRowsFromRegistro(item).length) state.historyTraceCollapse[item.id] = true;
        });
        renderRecipeHistory();
        return;
      }
      if (event.target.closest('#produccionRecipeHistoryExpandAllRowsBtn')) {
        getRecipeHistoryRows().forEach((item) => {
          if (getTraceRowsFromRegistro(item).length) state.historyTraceCollapse[item.id] = false;
        });
        renderRecipeHistory();
        return;
      }
      const recipePlanillaBtn = event.target.closest('[data-recipe-prod-planilla]');
      if (recipePlanillaBtn) {
        const reg = state.registros[recipePlanillaBtn.dataset.recipeProdPlanilla];
        if (reg) await window.laJamoneraPlanillaProduccion?.openByRegistro?.(reg, { companyLogoUrl: normalizeValue(state.config.companyLogoUrl), usersMap: safeObject(state.users) });
        return;
      }
      const recipeQrPrintBtn = event.target.closest('[data-recipe-prod-qr-print]');
      if (recipeQrPrintBtn) {
        const reg = state.registros[recipeQrPrintBtn.dataset.recipeProdQrPrint];
        if (reg) await openProductionQrPrintConfigurator(reg);
        return;
      }
      const recipeTraceBtn = event.target.closest('[data-recipe-prod-trace]');
      if (recipeTraceBtn) {
        const reg = state.registros[recipeTraceBtn.dataset.recipeProdTrace];
        if (reg) await openTraceability(reg);
        return;
      }
      const recipeTraceImageBtn = event.target.closest('[data-recipe-prod-trace-images]');
      if (recipeTraceImageBtn) {
        const urls = JSON.parse(decodeURIComponent(recipeTraceImageBtn.dataset.recipeProdTraceImages || '[]'));
        if (Array.isArray(urls) && urls.length && typeof window.laJamoneraOpenImageViewer === 'function') {
          await window.laJamoneraOpenImageViewer([{ invoiceImageUrls: urls }], 0, 'Adjuntos de lote');
        }
        return;
      }
      const recipeCollapseBtn = event.target.closest('[data-recipe-prod-collapse]');
      if (recipeCollapseBtn) {
        const prodId = recipeCollapseBtn.dataset.recipeProdCollapse;
        state.historyTraceCollapse[prodId] = !state.historyTraceCollapse[prodId];
        renderRecipeHistory();
        return;
      }
      const recipePrintBtn = event.target.closest('[data-recipe-prod-print]');
      if (recipePrintBtn) {
        const reg = state.registros[recipePrintBtn.dataset.recipeProdPrint];
        if (reg) await printReport(reg);
        return;
      }
      const recipeDeleteBtn = event.target.closest('[data-recipe-prod-delete]');
      if (recipeDeleteBtn) {
        const reg = state.registros[recipeDeleteBtn.dataset.recipeProdDelete];
        if (reg) await cancelProduction(reg);
        return;
      }
      if (event.target.closest('#produccionRecipeHistoryExpandBtn')) {
        const rows = getRecipeHistoryRows();
        const collapseMap = { ...state.historyTraceCollapse };
        let expandedPage = 1;
        const EXPANDED_PAGE_SIZE = 12;
        const totalPages = () => Math.max(1, Math.ceil(rows.length / EXPANDED_PAGE_SIZE));
        const getPageRows = () => {
          expandedPage = Math.min(Math.max(1, expandedPage), totalPages());
          const start = (expandedPage - 1) * EXPANDED_PAGE_SIZE;
          return rows.slice(start, start + EXPANDED_PAGE_SIZE);
        };
        const renderRows = () => getPageRows().length
          ? getPageRows().map((item, index) => {
            const manager = getManagerLabel(item);
            const traceRows = getTraceRowsFromRegistro(item);
            const isCollapsed = collapseMap[item.id] === true;
            const planillaDisabled = hasPlanillaDisponible(item) ? '' : 'disabled';
            const traceHtml = (!isCollapsed && traceRows.length)
              ? traceRows.map((trace) => `<tr class="inventario-trace-row"><td><div class="inventario-trace-main"><img src="./IMG/Octicons-git-merge.svg" alt="merge" class="inventario-trace-icon"><span class="inventario-trace-avatar">${trace.ingredientImageUrl ? `<span class="thumb-loading"><img class="meta-spinner-login" src="./IMG/Meta-ai-logo.webp" alt="Cargando"></span><img class="thumb-image js-produccion-thumb" src="${escapeHtml(trace.ingredientImageUrl)}" alt="${escapeHtml(trace.ingredientName)}">` : '<i class="fa-solid fa-carrot"></i>'}</span><span class="inventario-trace-label">${escapeHtml(trace.ingredientName)}</span></div></td><td></td><td><span class="produccion-trace-date">${escapeHtml(formatDateTime(trace.createdAt))}</span></td><td class="inventario-trace-kilos">-${escapeHtml(trace.amount)}</td><td>${escapeHtml(trace.lotNumber)}</td><td><span class="produccion-trace-expiry">${escapeHtml(formatExpiryHuman(trace.expiryDate))}${normalizeLower(trace.expiryDate)==='no perecedero' ? '' : ' (VTO)'}</span></td><td><span class="produccion-trace-badge">Trazabilidad</span></td><td>-</td><td>${trace.invoiceImageUrls.length ? `<button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-recipe-prod-trace-images="${encodeURIComponent(JSON.stringify(trace.invoiceImageUrls))}"><i class="fa-regular fa-image"></i><span>Adjunto (${trace.invoiceImageUrls.length})</span></button>` : '<button type="button" class="btn ios-btn ios-btn-danger inventario-no-photo-btn" disabled>Sin adjuntos</button>'}</td></tr>`).join('')
              : '';
            return `<tr class="inventario-row-tone ${index % 2 === 0 ? 'is-even-row' : 'is-odd-row'}"><td><div class="d-flex align-items-center gap-2">${traceRows.length ? `<button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-recipe-prod-collapse="${escapeHtml(item.id || '')}" title="${isCollapsed ? 'Descolapsar' : 'Colapsar'}" aria-label="${isCollapsed ? 'Descolapsar' : 'Colapsar'}"><i class="fa-solid ${isCollapsed ? 'fa-expand' : 'fa-compress'}"></i></button>` : ''}<span>${escapeHtml(item.id || '-')}</span></div></td><td>${escapeHtml(formatDateTime(item.createdAt))}</td><td>${escapeHtml(item.recipeTitle || '-')}</td><td>${Number(item.quantityKg || 0).toFixed(2)} kg</td><td><span class="produccion-responsable-wrap"><strong>${escapeHtml(manager.name)}</strong><small>${escapeHtml(manager.role)}</small></span></td><td class="produccion-vto-cell">${escapeHtml(formatProductExpiryLabel(item))}</td><td><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-recipe-prod-trace="${escapeHtml(item.id || '')}"><img src="./IMG/family-tree-icon-no-bg.svg" alt="" style="width:14px;height:14px"><span>Trazabilidad</span></button></td><td><div class="produccion-planilla-actions"><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-recipe-prod-planilla="${escapeHtml(item.id || '')}" ${planillaDisabled}><i class="fa-regular fa-file-lines"></i><span>Planilla</span></button><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-recipe-prod-qr-print="${escapeHtml(item.id || '')}" title="Imprimir QR"><i class="fa-solid fa-qrcode"></i></button></div></td><td>${traceRows.some((trace) => trace.invoiceImageUrls.length) ? `<button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-recipe-prod-trace-images='${encodeURIComponent(JSON.stringify(traceRows.flatMap((trace) => trace.invoiceImageUrls)))}'><i class="fa-regular fa-image"></i><span>Ver adjuntos</span></button>` : '<button type="button" class="btn ios-btn ios-btn-danger inventario-no-photo-btn" disabled>Sin adjuntos</button>'}</td><td><button type="button" class="btn ios-btn ios-btn-danger inventario-threshold-btn" data-recipe-prod-delete="${escapeHtml(item.id || '')}"><i class="fa-solid fa-trash"></i><span>Eliminar</span></button></td></tr>${traceHtml}`;
          }).join('')
          : '<tr><td colspan="10" class="text-center">Sin producciones.</td></tr>';
        const renderExpandedContent = (popup) => {
          const host = popup.querySelector('#produccionRecipeExpandedHistoryHost');
          if (!host) return;
          const traceableRows = rows.filter((item) => getTraceRowsFromRegistro(item).length);
          const canCollapseRows = traceableRows.some((item) => collapseMap[item.id] !== true);
          const canExpandRows = traceableRows.some((item) => collapseMap[item.id] === true);
          const pages = totalPages();
          host.innerHTML = `<div class="inventario-print-row mb-2 inventario-trace-toolbar toolbar-scroll-x"><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" id="produccionRecipeExpandedHistoryCollapseAllRowsBtn" ${canCollapseRows ? '' : 'disabled'}><i class="fa-solid fa-compress"></i><span>Colapsar</span></button><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" id="produccionRecipeExpandedHistoryExpandAllRowsBtn" ${canExpandRows ? '' : 'disabled'}><i class="fa-solid fa-expand"></i><span>Descolapsar</span></button></div><div class="table-responsive inventario-table-compact-wrap"><table class="table recipe-table inventario-table-compact mb-0"><thead><tr><th>ID producción</th><th>Fecha y hora</th><th>Producto</th><th>Fabricado (KG.)</th><th>Responsable</th><th>VTO producto</th><th>Trazabilidad</th><th>Planilla</th><th>Adjuntos</th><th>Acciones</th></tr></thead><tbody>${renderRows()}</tbody></table></div><div class="inventario-pagination enhanced"><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn inventario-page-btn" data-recipe-expanded-page="prev" ${expandedPage <= 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-left"></i></button><span>Página ${expandedPage} de ${pages}</span><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn inventario-page-btn" data-recipe-expanded-page="next" ${expandedPage >= pages ? 'disabled' : ''}><i class="fa-solid fa-chevron-right"></i></button></div>`;
          prepareThumbLoaders('.js-produccion-thumb');
        };
        await openIosSwal({
          title: 'Historial de producción (ampliado)',
          html: '<div id="produccionRecipeExpandedHistoryHost" class="inventario-expand-wrap"></div>',
          width: '92vw',
          confirmButtonText: 'Cerrar',
          customClass: { confirmButton: 'ios-btn ios-btn-secondary' },
          didOpen: (popup) => {
            renderExpandedContent(popup);
            popup.addEventListener('click', async (clickEvent) => {
              if (clickEvent.target.closest('#produccionRecipeExpandedHistoryCollapseAllRowsBtn')) {
                rows.forEach((item) => {
                  if (getTraceRowsFromRegistro(item).length) collapseMap[item.id] = true;
                });
                renderExpandedContent(popup);
                return;
              }
              if (clickEvent.target.closest('#produccionRecipeExpandedHistoryExpandAllRowsBtn')) {
                rows.forEach((item) => {
                  if (getTraceRowsFromRegistro(item).length) collapseMap[item.id] = false;
                });
                renderExpandedContent(popup);
                return;
              }
              const collapseBtn = clickEvent.target.closest('[data-recipe-prod-collapse]');
              if (collapseBtn) {
                const prodId = collapseBtn.dataset.recipeProdCollapse;
                collapseMap[prodId] = !collapseMap[prodId];
                renderExpandedContent(popup);
                return;
              }
              const pageBtn = clickEvent.target.closest('[data-recipe-expanded-page]');
              if (pageBtn) {
                expandedPage += pageBtn.dataset.recipeExpandedPage === 'next' ? 1 : -1;
                renderExpandedContent(popup);
                return;
              }
              const planillaBtn = clickEvent.target.closest('[data-recipe-prod-planilla]');
              if (planillaBtn) {
                const reg = state.registros[planillaBtn.dataset.recipeProdPlanilla];
                if (reg) await window.laJamoneraPlanillaProduccion?.openByRegistro?.(reg, { companyLogoUrl: normalizeValue(state.config.companyLogoUrl), usersMap: safeObject(state.users) });
                return;
              }
              const qrPrintBtn = clickEvent.target.closest('[data-recipe-prod-qr-print]');
              if (qrPrintBtn) {
                const reg = state.registros[qrPrintBtn.dataset.recipeProdQrPrint];
                if (reg) await openProductionQrPrintConfigurator(reg);
                return;
              }
              const traceBtn = clickEvent.target.closest('[data-recipe-prod-trace]');
              if (traceBtn) {
                const reg = state.registros[traceBtn.dataset.recipeProdTrace];
                if (reg) await openTraceability(reg);
                return;
              }
              const traceImageBtn = clickEvent.target.closest('[data-recipe-prod-trace-images]');
              if (traceImageBtn && typeof window.laJamoneraOpenImageViewer === 'function') {
                const urls = JSON.parse(decodeURIComponent(traceImageBtn.dataset.recipeProdTraceImages || '[]'));
                if (Array.isArray(urls) && urls.length) {
                  await window.laJamoneraOpenImageViewer([{ invoiceImageUrls: urls }], 0, 'Adjuntos de lote');
                }
                return;
              }
              const deleteBtn = clickEvent.target.closest('[data-recipe-prod-delete]');
              if (deleteBtn) {
                const reg = state.registros[deleteBtn.dataset.recipeProdDelete];
                if (reg) await cancelProduction(reg);
              }
            });
          }
        });
        return;
      }
      if (event.target.closest('#produccionRecipeHistoryExcelBtn')) {
        const rows = getRecipeHistoryRows();
        const payload = rows.flatMap((item) => {
          const manager = getManagerLabel(item);
          const main = {
            'ID producción': item.id || '-',
            'Fecha y hora': formatDateTime(item.createdAt),
            Producto: item.recipeTitle || '-',
            'Fabricado (KG.)': `${Number(item.quantityKg || 0).toFixed(2)} kg`,
            Responsable: manager.name,
            'VTO producto': formatProductExpiryLabel(item),
            Trazabilidad: '-',
            Acciones: '-'
          };
          const resolutions = (Array.isArray(item?.lots) ? item.lots : [])
            .flatMap((plan) => (Array.isArray(plan?.lots) ? plan.lots : [])
              .flatMap((lot) => (Array.isArray(lot?.expiryResolutions) ? lot.expiryResolutions : []).map((res) => ({
                'ID producción': '↳ RES',
                'Fecha y hora': formatDateTime(res.createdAt),
                Producto: item.recipeTitle || '-',
                'Fabricado (KG.)': `-${Number(res.qtyKg || 0).toFixed(2)} kg`,
                Responsable: res.type === 'decommissioned' ? 'Decomisado' : 'Vendido mostrador',
                'VTO producto': formatProductExpiryLabel(item),
                Trazabilidad: 'Resolución vencido',
                Acciones: '-',
                __tone: isHighlightedResolutionType(res.type) ? 'resolution_yellow' : 'normal'
              }))));
          const traces = getTraceRowsFromRegistro(item).map((trace) => ({
            'ID producción': `↳ ${trace.index}`,
            'Fecha y hora': formatDateTime(trace.createdAt),
            Producto: trace.ingredientName,
            'Fabricado (KG.)': `-${trace.amount}`,
            Responsable: trace.lotNumber,
            'VTO producto': trace.expiryDate || '-',
            Trazabilidad: 'Adjunto',
            Acciones: '-',
            __tone: 'trace'
          }));
          return [main, ...resolutions, ...traces];
        });
        await exportStyledExcel({
          fileName: `produccion_receta_${normalizeLower(recipe.title || 'receta').replace(/\s+/g, '_')}_${Date.now()}.xlsx`,
          sheetName: 'Producción receta',
          headers: ['ID producción', 'Fecha y hora', 'Producto', 'Fabricado (KG.)', 'Responsable', 'VTO producto', 'Trazabilidad', 'Acciones'],
          rows: payload
        });
        return;
      }
      if (event.target.closest('#produccionRecipeHistoryPrintFilteredBtn')) {
        await printRecipeHistoryRows(getRecipeHistoryRows());
        return;
      }
      if (event.target.closest('#produccionRecipeHistoryPrintAllBtn')) {
        const allRows = getRegistrosList().filter((item) => normalizeValue(item.recipeId) === normalizeValue(recipe.id));
        await printRecipeHistoryRows(allRows);
        return;
      }
      const attachmentBtn = event.target.closest('[data-lot-images]');
      if (attachmentBtn) {
        const raw = decodeURIComponent(attachmentBtn.dataset.lotImages || '');
        let urls = [];
        try {
          urls = JSON.parse(raw);
        } catch (error) {
          urls = [];
        }
        if (typeof window.laJamoneraOpenImageViewer === 'function') {
          await window.laJamoneraOpenImageViewer([{ invoiceImageUrls: urls }], 0, 'Adjuntos de lote');
        } else {
          await openIosSwal({ title: 'Visor no disponible', html: '<p>No se pudo abrir el visor de imágenes.</p>', icon: 'warning', confirmButtonText: 'Entendido' });
        }
      }
    });
    nodes.editor.addEventListener('input', (event) => {
      const searchNode = event.target.closest('#produccionRecipeHistorySearch');
      if (!searchNode) return;
      recipeHistoryState.search = normalizeValue(searchNode.value);
      renderRecipeHistory();
    });
    if (window.flatpickr) {
      const locale = window.flatpickr.l10ns?.es || undefined;
      window.flatpickr(dateInput, {
        locale,
        dateFormat: 'Y-m-d',
        defaultDate: initialDate,
        allowInput: true,
        onChange: async () => {
          await updateEditorPlan();
        }
      });
    }
    qtyInput.addEventListener('change', async () => { await updateEditorPlan(); });
    qtyInput.addEventListener('blur', async () => { await updateEditorPlan(); });
    nodes.editor.querySelector('#produccionQtyMaxBtn').addEventListener('click', async () => {
      qtyInput.value = Math.max(analysis.maxKg, analysis.maxKgIncludingExpired || 0).toFixed(2);
      await updateEditorPlan();
    });
    nodes.editor.querySelector('#produccionSaveManagersPrefBtn')?.addEventListener('click', async () => {
      const selected = [...nodes.editor.querySelectorAll('[data-manager-check]:checked')].map((node) => node.value).filter(Boolean);
      state.config.preferredManagers = selected;
      state.config.preferredManagersByRecipe = {
        ...safeObject(state.config.preferredManagersByRecipe),
        [recipe.id]: selected
      };
      await persistConfig();
      await openIosSwal({ title: 'Preferencia guardada', html: '<p>Este/estos encargados se preseleccionarán en próximas producciones.</p>', icon: 'success', confirmButtonText: 'Entendido' });
    });
    nodes.editor.querySelector('#produccionSaveDraftBtn').addEventListener('click', async () => {
      await saveEditorDraft();
      await openIosSwal({ title: 'Borrador guardado', html: '<p>Podés retomarlo cuando quieras.</p>', icon: 'success', confirmButtonText: 'Entendido' });
    });
    prepareThumbLoaders('.js-produccion-head-photo, .js-produccion-user-photo');
    const confirmProduction = async () => {
      const refreshBefore = await window.dbLaJamoneraRest.read('/inventario');
      state.inventario = safeObject(refreshBefore);
      const qty = parsePositive(qtyInput.value, 0.1);
      const date = normalizeValue(dateInput.value) || toIsoDate();
      const revalidated = buildPlanForRecipe(recipe, qty, date);
      const revalidatedExpiredLots = revalidated.ingredientPlans.reduce((acc, row) => acc + row.lots.filter((lot) => lot.status === 'expired').length, 0);
      if (revalidatedExpiredLots > 0) {
        await openIosSwal({
          title: 'Hay carne vencida pendiente',
          html: '<p>No podés confirmar hasta resolver el estado de los lotes vencidos o cambiar la fecha de producción a un rango válido.</p>',
          icon: 'warning',
          confirmButtonText: 'Entendido'
        });
        state.editorPlan = revalidated;
        lotsWrap.innerHTML = buildLotsBreakdownHtml(state.editorPlan);
        renderRecipeHistory();
        return;
      }
      if (!revalidated.isValid) {
        await openIosSwal({
          title: 'Stock cambió durante la edición',
          html: `<p>Recalculamos y encontramos conflictos:</p><ul>${revalidated.conflicts.map((item) => `<li>${item}</li>`).join('')}</ul>`,
          icon: 'warning',
          confirmButtonText: 'Revisar'
        });
        state.editorPlan = revalidated;
        lotsWrap.innerHTML = buildLotsBreakdownHtml(state.editorPlan);
      renderRecipeHistory();
        return;
      }
      const managers = [...nodes.editor.querySelectorAll('[data-manager-check]:checked')].map((node) => node.value).filter(Boolean);
      if (!managers.length) {
        await openIosSwal({
          title: 'Encargado requerido',
          html: '<p>Debés seleccionar al menos un encargado para continuar.</p>',
          icon: 'warning',
          confirmButtonText: 'Entendido'
        });
        const managersSection = nodes.editor.querySelector('[data-manager-check]')?.closest('.recipe-step-card');
        if (managersSection) {
          managersSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
          const firstManager = managersSection.querySelector('[data-manager-check]');
          firstManager?.focus({ preventScroll: true });
        }
        return;
      }
      const managerSummary = managers.map((token) => {
        const manager = getManagerDisplay(token);
        return `${escapeHtml(manager.name)} (${escapeHtml(manager.role)})`;
      }).join('<br>');
      const productExpiry = addDaysToIso(date, Number(recipe.shelfLifeDays || 0));
      const summaryRows = revalidated.ingredientPlans.map((plan) => `<li><strong>${escapeHtml(plan.ingredientName)}</strong>: ${Number(plan.neededQty || 0).toFixed(3)} ${escapeHtml(plan.ingredientUnit || '')}</li>`).join('');
      const qtyGrams = Number((qty * 1000).toFixed(3));
      const confirm = await openIosSwal({
        title: 'Confirmar producción final',
        html: `<div class="text-start produccion-confirm-summary produccion-confirm-card"><div class="produccion-confirm-head"><span class="produccion-confirm-icon"><i class="bi bi-check2-circle"></i></span><div><p class="produccion-confirm-kicker">Validación final</p><p class="produccion-confirm-note">Se descontará stock real del inventario al confirmar.</p></div></div><p><strong><i class="bi bi-box-seam fa-solid fa-box-open"></i> Producto:</strong> <span>${escapeHtml(recipe.title || '-')}</span></p><p><strong><i class="bi bi-calendar-event"></i> Fecha:</strong> <span class="produccion-trace-date">${escapeHtml(formatIsoEs(date))}</span></p><p><strong><i class="bi bi-hourglass-split"></i> VTO producto:</strong> <span class="produccion-confirm-vto">${escapeHtml(formatIsoEs(productExpiry || ''))} (VTO)</span></p><p><strong><i class="bi bi-speedometer2"></i> Total a producir:</strong> <span class="produccion-confirm-total">${qty.toFixed(3)} kg</span><br><small>${qtyGrams.toFixed(3)} gramos</small></p><p><strong><i class="bi bi-people"></i> Encargado/s:</strong><br>${managerSummary}</p><p><strong><i class="bi bi-list-check"></i> Resumen de insumos:</strong></p><ul>${summaryRows}</ul></div>`,
        showCancelButton: true,
        confirmButtonText: 'Confirmar',
        cancelButtonText: 'Cancelar',
        customClass: { popup: 'produccion-confirm-alert', confirmButton: 'ios-btn ios-btn-success', cancelButton: 'ios-btn ios-btn-secondary' }
      });
      if (!confirm.isConfirmed) return;
      Swal.fire({
        title: 'Cargando producción...',
        html: '<div class="informes-saving-spinner"><img src="./IMG/Meta-ai-logo.webp" alt="Cargando producción" class="meta-spinner-login"></div>',
        allowOutsideClick: false,
        showConfirmButton: false,
        customClass: {
          popup: 'ios-alert produccion-loading-alert',
          title: 'ios-alert-title',
          htmlContainer: 'ios-alert-text'
        }
      });
      try {
        const registros = safeObject(await window.dbLaJamoneraRest.read(REGISTROS_PATH));
        const sequence = Number(await window.dbLaJamoneraRest.read(SEQUENCE_PATH)) || 0;
        const nextSequence = sequence + 1;
        const dateToken = formatIsoToDmyCompact(date);
        const prefix = normalizeValue(state.config.idConfig?.prefix) || 'PROD-LJ';
        const productionId = `${prefix}-${dateToken}-${String(nextSequence).padStart(4, '0')}`;
        const observations = normalizeValue(nodes.editor.querySelector('#produccionObsInput')?.value);
        const inventoryWithResolutions = applyPendingExpiryActionsOnInventory(state.inventario);
        const inventarioNext = applyPlanOnInventory(inventoryWithResolutions, revalidated, productionId, date, 'consume');
        const agingDaysAtProduction = Number(recipe.agingDays || 0);
        const recipeRnpa = safeObject(recipe.rnpa);
        const companyRne = safeObject(state.config.rne);
        const packagingDate = agingDaysAtProduction > 0
          ? moveIsoFromSunday(addDaysToIso(toIsoDate(nowTs()), agingDaysAtProduction))
          : '';
        const snapshotIngredientPlans = enrichIngredientPlansWithSnapshots(revalidated.ingredientPlans);
        const registro = {
        id: productionId,
        recipeId: recipe.id,
        recipeTitle: recipe.title,
        productionDate: date,
        productExpiryDate: productExpiry,
        shelfLifeDaysAtProduction: Number(recipe.shelfLifeDays || 0),
        agingDaysAtProduction,
        packagingDate,
        quantityKg: qty,
        managers,
        observations,
        lots: snapshotIngredientPlans,
        traceability: {
          generatedAt: nowTs(),
          company: {
            legalName: COMPANY_LEGAL_NAME,
            rne: normalizeRneRecord(companyRne)
          },
          product: {
            id: recipe.id,
            title: recipe.title,
            imageUrl: normalizeValue(recipe.imageUrl),
            rnpa: {
              number: normalizeValue(recipeRnpa.number),
              denomination: normalizeValue(recipeRnpa.denomination),
              brand: normalizeValue(recipeRnpa.brand),
              businessName: normalizeValue(recipeRnpa.businessName),
              expiryDate: normalizeValue(recipeRnpa.expiryDate),
              attachmentUrl: normalizeValue(recipeRnpa.attachmentUrl),
              attachmentType: normalizeValue(recipeRnpa.attachmentType),
              attachmentName: normalizeValue(recipeRnpa.attachmentName)
            }
          },
          ingredients: snapshotIngredientPlans.map((ingredientPlan) => ({
            ingredientId: ingredientPlan.ingredientId,
            ingredientName: ingredientPlan.ingredientName,
            ingredientImageUrl: normalizeValue(state.ingredientes[ingredientPlan.ingredientId]?.imageUrl),
            requiredQty: ingredientPlan.neededQty,
            unit: ingredientPlan.ingredientUnit,
            lots: (ingredientPlan.lots || []).map((lot) => ({
              entryId: lot.entryId,
              lotNumber: lot.lotNumber,
              takeQty: lot.takeQty,
              unit: lot.unit,
              expiryDate: lot.expiryDate,
              provider: lot.provider,
              providerRne: normalizeRneRecord(safeObject(lot.providerRne)),
              invoiceNumber: lot.invoiceNumber,
              invoiceImageUrls: Array.isArray(lot.invoiceImageUrls) ? lot.invoiceImageUrls : []
            }))
          }))
        },
        createdBy: getCurrentUserLabel(),
        createdAt: nowTs(),
        status: 'confirmada',
        reservationId: state.activeReservationId,
        planillaVersion: 1,
        publicTraceUrl: getPublicTraceUrlForProduction(productionId),
        exports: {},
        auditTrail: [{ action: 'creada', at: nowTs(), user: getCurrentUserLabel() }]
      };
        await window.dbLaJamoneraRest.write('/inventario', inventarioNext);
        await window.dbLaJamoneraRest.write(SEQUENCE_PATH, nextSequence);
        await window.dbLaJamoneraRest.write(REGISTROS_PATH, { ...registros, [productionId]: registro });
        appendRecipeMovement(recipe.id, {
          id: `ing_${productionId}`,
          type: 'ingreso',
          qtyKg: qty,
          at: nowTs(),
          sourceId: productionId,
          sourceCode: productionId,
          label: 'Producción confirmada',
          date
        });
        await persistRepartoStore();
        await appendAudit({ action: 'produccion_confirmada', productionId, before: null, after: registro, reason: 'confirmacion final' });
        state.config.lastProductionByRecipe[recipe.id] = nowTs();
        await persistConfig();
        await releaseReservation('confirmed');
        await discardDraft();
        state.pendingExpiryActions = {};
        await refreshData();
        renderList();
        Swal.close();
        await openIosSwal({ title: 'Producción guardada', html: `<p>ID generado: <strong>${productionId}</strong></p>`, icon: 'success', confirmButtonText: 'Genial' });
      } catch (error) {
        Swal.close();
        await openIosSwal({ title: 'No se pudo confirmar', html: '<p>Ocurrió un error al guardar la producción.</p>', icon: 'error', confirmButtonText: 'Entendido' });
      }
    };
    let isConfirmingProduction = false;
    nodes.editor.querySelector('#produccionConfirmBtn').addEventListener('click', async () => {
      if (isConfirmingProduction) return;
      isConfirmingProduction = true;
      confirmBtn.setAttribute('disabled', 'disabled');
      try {
        await confirmProduction();
      } finally {
        confirmBtn.removeAttribute('disabled');
        isConfirmingProduction = false;
      }
    });
    nodes.editor.querySelector('#produccionBackBtn').addEventListener('click', async () => {
      const result = await openIosSwal({
        title: '¿Deseás abandonar esta producción?',
        html: '<p>Se guardará borrador para retomarlo luego.</p>',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Abandonar',
        cancelButtonText: 'Seguir'
      });
      if (!result.isConfirmed) return;
      await saveEditorDraft();
      state.activeRecipeId = '';
      state.activeReservationId = '';
      if (state.reservationTick) {
        clearInterval(state.reservationTick);
        state.reservationTick = null;
      }
      renderList();
    });
    await updateEditorPlan();
    renderRecipeHistory();
    setStateView('editor');
  };
  const recomputeAnalysis = () => {
    state.analysis = Object.values(state.recetas).reduce((acc, recipe) => {
      acc[recipe.id] = analyzeRecipe(recipe);
      return acc;
    }, {});
  };
  const refreshData = async ({ silent = false } = {}) => {
    if (!silent) setStateView('loading');
    await window.laJamoneraReady;
    const safeRead = async (path, fallback = {}) => {
      try {
        const value = await window.dbLaJamoneraRest.read(path);
        return value == null ? fallback : value;
      } catch (error) {
        return fallback;
      }
    };
    const [recetas, ingredientes, inventario, config, reservas, drafts, registros, users, repartoStore, legacyRepartoStore] = await Promise.all([
      safeRead('/recetas', {}),
      safeRead('/ingredientes/items', {}),
      safeRead('/inventario', {}),
      safeRead(CONFIG_PATH, {}),
      safeRead(RESERVAS_PATH, {}),
      safeRead(DRAFTS_PATH, {}),
      safeRead(REGISTROS_PATH, {}),
      safeRead('/informes/users', {}),
      safeRead(REPARTO_PATH, {}),
      safeRead(LEGACY_REPARTO_PATH, {})
    ]);
    state.recetas = safeObject(recetas);
    state.ingredientes = safeObject(ingredientes);
    state.inventario = safeObject(inventario);
    state.reservas = safeObject(reservas);
    state.drafts = safeObject(drafts);
    state.registros = safeObject(registros);
    state.users = safeObject(users);
    const nextRepartoStore = Object.keys(safeObject(repartoStore)).length
      ? repartoStore
      : legacyRepartoStore;
    state.reparto = normalizeDispatchStore(nextRepartoStore);
    if (!Object.keys(safeObject(state.reparto.productIndex)).length) {
      rebuildProductIndexFromHistory();
      try {
        await window.dbLaJamoneraRest.write(REPARTO_PATH, state.reparto);
      } catch (error) {
        console.warn('[Producción] No se pudo persistir /Reparto al reconstruir índice.', error);
      }
    }
    if (!Object.keys(safeObject(repartoStore)).length && Object.keys(safeObject(legacyRepartoStore)).length) {
      try {
        await window.dbLaJamoneraRest.write(REPARTO_PATH, state.reparto);
      } catch (error) {
        console.warn('[Producción] No se pudo migrar /REPARTO a /Reparto.', error);
      }
    }
    state.config = {
      globalMinKg: parsePositive(config?.globalMinKg, 1),
      recipeMinKg: safeObject(config?.recipeMinKg),
      lastProductionByRecipe: safeObject(config?.lastProductionByRecipe),
      preferredManagers: Array.isArray(config?.preferredManagers) ? config.preferredManagers : [],
      preferredManagersByRecipe: safeObject(config?.preferredManagersByRecipe),
      usersPreferences: safeObject(config?.usersPreferences),
      idConfig: { prefix: normalizeValue(config?.idConfig?.prefix) || 'PROD-LJ' },
      companyLogoUrl: normalizeValue(config?.companyLogoUrl),
      rne: {
        number: normalizeValue(config?.rne?.number),
        expiryDate: normalizeValue(config?.rne?.expiryDate),
        infiniteExpiry: Boolean(config?.rne?.infiniteExpiry),
        attachmentUrl: normalizeValue(config?.rne?.attachmentUrl),
        attachmentType: normalizeValue(config?.rne?.attachmentType),
        validFrom: normalizeValue(config?.rne?.validFrom),
        updatedAt: Number(config?.rne?.updatedAt || 0),
        history: Array.isArray(config?.rne?.history) ? config.rne.history : []
      }
    };
    await cleanupExpiredReservations();
    await cleanupExpiredDrafts();
    recomputeAnalysis();
  };
  const openInventarioFromProduccion = () => {
    const productionInstance = window.bootstrap?.Modal?.getOrCreateInstance(produccionModal);
    const inventarioModal = document.getElementById('inventarioModal');
    const inventarioInstance = inventarioModal ? window.bootstrap?.Modal?.getOrCreateInstance(inventarioModal) : null;
    if (!productionInstance || !inventarioInstance) return;
    const openOnHidden = () => {
      produccionModal.removeEventListener('hidden.bs.modal', openOnHidden);
      inventarioInstance.show();
    };
    produccionModal.addEventListener('hidden.bs.modal', openOnHidden, { once: true });
    productionInstance.hide();
  };
  nodes.search.addEventListener('input', (event) => {
    state.search = event.target.value;
    renderList();
  });
  nodes.list.addEventListener('scroll', updateProduccionListScrollHint);
  nodes.list.addEventListener('click', async (event) => {
    const openDraftBtn = event.target.closest('[data-open-draft]');
    if (openDraftBtn) {
      const draftId = openDraftBtn.dataset.openDraft;
      const draft = state.drafts[draftId];
      if (draft?.recipeId) {
        state.activeRecipeId = draft.recipeId;
        await renderEditor(draft.recipeId);
      }
      return;
    }
    const deleteDraftBtn = event.target.closest('[data-delete-draft]');
    if (deleteDraftBtn) {
      const draftId = deleteDraftBtn.dataset.deleteDraft;
      const draft = state.drafts[draftId];
      const confirmDelete = await openIosSwal({
        title: 'Descartar borrador',
        html: '<p>Se liberará el stock reservado y el borrador se eliminará.</p><small>Esta acción no se puede deshacer.</small>',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Sí, descartar',
        cancelButtonText: 'Cancelar'
      });
      if (!confirmDelete.isConfirmed) return;
      let reservasNext = { ...state.reservas };
      if (draft?.reservationId && reservasNext[draft.reservationId]?.status === 'active') {
        reservasNext[draft.reservationId] = { ...reservasNext[draft.reservationId], status: 'released', releasedAt: nowTs(), releasedReason: 'draft_deleted' };
        await window.dbLaJamoneraRest.write(RESERVAS_PATH, reservasNext);
        state.reservas = reservasNext;
      }
      const next = { ...state.drafts };
      delete next[draftId];
      await window.dbLaJamoneraRest.write(DRAFTS_PATH, next);
      state.drafts = next;
      renderList();
      return;
    }
    const usersBtn = event.target.closest('[data-open-users-manager]');
    if (usersBtn) {
      const modal = document.getElementById('usersManagerModal');
      if (window.bootstrap && modal) {
        const instance = bootstrap.Modal.getOrCreateInstance(modal);
        instance.show();
      }
      return;
    }

    const produceBtn = event.target.closest('[data-open-produccion]');
    if (produceBtn) {
      state.activeRecipeId = produceBtn.dataset.openProduccion;
      Swal.fire({
        title: 'Cargando producción...',
        html: '<div class="informes-saving-spinner"><img src="./IMG/Meta-ai-logo.webp" alt="Cargando producción" class="meta-spinner-login"></div>',
        allowOutsideClick: false,
        showConfirmButton: false,
        customClass: {
          popup: 'ios-alert produccion-loading-alert',
          title: 'ios-alert-title',
          htmlContainer: 'ios-alert-text'
        }
      });
      try {
        await renderEditor(state.activeRecipeId);
      } catch (error) {
        await openIosSwal({ title: 'No se pudo abrir producción', html: '<p>Hubo un error al preparar el editor. Intentá nuevamente.</p>', icon: 'error', confirmButtonText: 'Entendido' });
        state.activeRecipeId = '';
        setStateView('list');
      } finally {
        Swal.close();
      }
      return;
    }
    if (event.target.closest('[data-open-inventario]')) {
      openInventarioFromProduccion();
      return;
    }
    const historyBtn = event.target.closest('[data-open-recipe-history]');
    if (historyBtn) {
      await openRecipeQuickHistory(historyBtn.dataset.openRecipeHistory);
      return;
    }
    const minBtn = event.target.closest('[data-set-recipe-min]');
    if (minBtn) {
      await openRecipeMinConfig(minBtn.dataset.setRecipeMin);
    }
  });
  produccionModal.addEventListener('click', async (event) => {
    if (event.target.closest('#produccionGlobalMinBtn')) {
      await openGlobalMinConfig();
      return;
    }
    if (event.target.closest('#produccionHistoryBtn')) {
      await openHistory();
      return;
    }
    if (event.target.closest('#produccionDispatchBtn')) {
      openDispatch();
    }
  });
  nodes.historyBackBtn?.addEventListener('click', async () => {
    await runWithBackSpinner(async () => {
      await refreshData({ silent: true });
      setHistoryMode(false);
      renderList();
    });
  });
  nodes.historyApplyBtn?.addEventListener('click', () => {
    state.historySearch = normalizeValue(nodes.historySearch?.value);
    state.historyRange = normalizeValue(nodes.historyRange?.value);
    nodes.historyClearBtn?.classList.toggle('d-none', !(state.historyRange || state.historySearch));
    state.historyPage = 1;
    nodes.historyClearBtn?.classList.toggle('d-none', !(state.historyRange || state.historySearch));
    renderHistoryTable();
  });
  nodes.historySearch?.addEventListener('input', () => {
    state.historySearch = normalizeValue(nodes.historySearch?.value);
    state.historyPage = 1;
    nodes.historyClearBtn?.classList.toggle('d-none', !(state.historyRange || state.historySearch));
    renderHistoryTable();
  });

  nodes.historyClearBtn?.addEventListener('click', () => {
    state.historySearch = '';
    state.historyRange = '';
    if (nodes.historySearch) nodes.historySearch.value = '';
    if (nodes.historyRange) nodes.historyRange.value = '';
    nodes.historyClearBtn?.classList.add('d-none');
    state.historyPage = 1;
    renderHistoryTable();
  });
  nodes.historyExpandBtn?.addEventListener('click', async () => {
    const rows = getHistoryRows();
    const collapseMap = { ...state.historyTraceCollapse };
    let expandedPage = 1;
    const EXPANDED_PAGE_SIZE = 12;
    rows.forEach((item) => {
      if (collapseMap[item.id] !== undefined) return;
      if (getTraceRowsFromRegistro(item).length) collapseMap[item.id] = true;
    });
    const totalPages = () => Math.max(1, Math.ceil(rows.length / EXPANDED_PAGE_SIZE));
    const getPageRows = () => {
      expandedPage = Math.min(Math.max(1, expandedPage), totalPages());
      const start = (expandedPage - 1) * EXPANDED_PAGE_SIZE;
      return rows.slice(start, start + EXPANDED_PAGE_SIZE);
    };
    const renderRows = () => getPageRows().length ? getPageRows().map((item, index) => {
      const manager = getManagerLabel(item);
      const traceRows = getTraceRowsFromRegistro(item);
      const isCollapsed = collapseMap[item.id] === true;
      const planillaDisabled = hasPlanillaDisponible(item) ? '' : 'disabled';
      const traceHtml = (!isCollapsed && traceRows.length) ? traceRows.map((trace) => `<tr class="inventario-trace-row">
        <td><div class="inventario-trace-main"><img src="./IMG/Octicons-git-merge.svg" alt="merge" class="inventario-trace-icon"><span class="inventario-trace-avatar">${trace.ingredientImageUrl ? `<span class="thumb-loading"><img class="meta-spinner-login" src="./IMG/Meta-ai-logo.webp" alt="Cargando"></span><img class="thumb-image js-produccion-thumb" src="${escapeHtml(trace.ingredientImageUrl)}" alt="${escapeHtml(trace.ingredientName)}">` : '<i class="fa-solid fa-carrot"></i>'}</span><span class="inventario-trace-label">${escapeHtml(trace.ingredientName)}</span></div></td>
        <td></td>
        <td><span class="produccion-trace-date">${escapeHtml(formatDateTime(trace.createdAt))}</span></td>
        <td class="inventario-trace-kilos">-${escapeHtml(trace.amount)}</td>
        <td>${escapeHtml(trace.lotNumber)}</td>
        <td><span class="produccion-trace-expiry">${escapeHtml(formatExpiryHuman(trace.expiryDate))}${normalizeLower(trace.expiryDate)==='no perecedero' ? '' : ' (VTO)'}</span></td>
        <td><span class="produccion-trace-badge">Trazabilidad</span></td>
        <td>-</td>
        <td>${trace.invoiceImageUrls.length ? `<button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-recipe-prod-trace-images='${encodeURIComponent(JSON.stringify(trace.invoiceImageUrls))}'><i class="fa-regular fa-image"></i><span>Adjunto (${trace.invoiceImageUrls.length})</span></button>` : '<button type="button" class="btn ios-btn ios-btn-danger inventario-no-photo-btn" disabled>Sin adjuntos</button>'}</td>
        <td>-</td>
      </tr>`).join('') : '';
      return `<tr class="inventario-row-tone ${index % 2 === 0 ? 'is-even-row' : 'is-odd-row'}"><td><div class="d-flex align-items-center gap-2">${traceRows.length ? `<button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-prod-expanded-collapse="${escapeHtml(item.id || '')}" title="${isCollapsed ? 'Descolapsar' : 'Colapsar'}" aria-label="${isCollapsed ? 'Descolapsar' : 'Colapsar'}"><i class="fa-solid ${isCollapsed ? 'fa-expand' : 'fa-compress'}"></i></button>` : ''}<span>${escapeHtml(item.id)}</span></div></td><td>${escapeHtml(formatDateTime(item.createdAt))}</td><td>${escapeHtml(item.recipeTitle || '-')}</td><td>${Number(item.quantityKg || 0).toFixed(2)} kg</td><td>${escapeHtml(manager.name)} (${escapeHtml(manager.role)})</td><td class="produccion-vto-cell">${escapeHtml(formatProductExpiryLabel(item))}</td><td><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-recipe-prod-trace="${escapeHtml(item.id || '')}"><img src="./IMG/family-tree-icon-no-bg.svg" alt="" style="width:14px;height:14px"><span>Trazabilidad</span></button></td><td><div class="produccion-planilla-actions"><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-recipe-prod-planilla="${escapeHtml(item.id || '')}" ${planillaDisabled}><i class="fa-regular fa-file-lines"></i><span>Planilla</span></button><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-recipe-prod-qr-print="${escapeHtml(item.id || '')}" title="Imprimir QR"><i class="fa-solid fa-qrcode"></i></button></div></td><td>${traceRows.some((trace) => trace.invoiceImageUrls.length) ? `<button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-recipe-prod-trace-images='${encodeURIComponent(JSON.stringify(traceRows.flatMap((trace) => trace.invoiceImageUrls)))}'><i class="fa-regular fa-image"></i><span>Ver adjuntos</span></button>` : '<button type="button" class="btn ios-btn ios-btn-danger inventario-no-photo-btn" disabled>Sin adjuntos</button>'}</td><td><button type="button" class="btn ios-btn ios-btn-danger inventario-threshold-btn" data-prod-cancel="${escapeHtml(item.id || '')}"><i class="fa-solid fa-trash"></i><span>Eliminar</span></button></td></tr>${traceHtml}`;
    }).join('') : '<tr><td colspan="10" class="text-center">Sin producciones.</td></tr>';
    const renderExpandedContent = (popup) => {
      const host = popup.querySelector('#produccionExpandedHistoryHost');
      if (!host) return;
      const traceableRows = rows.filter((item) => getTraceRowsFromRegistro(item).length);
      const canCollapseRows = traceableRows.some((item) => collapseMap[item.id] !== true);
      const canExpandRows = traceableRows.some((item) => collapseMap[item.id] === true);
      const pages = totalPages();
      host.innerHTML = `<div class="inventario-print-row mb-2 inventario-trace-toolbar toolbar-scroll-x"><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" id="produccionExpandedHistoryCollapseAllRowsBtn" ${canCollapseRows ? '' : 'disabled'}><i class="fa-solid fa-compress"></i><span>Colapsar</span></button><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" id="produccionExpandedHistoryExpandAllRowsBtn" ${canExpandRows ? '' : 'disabled'}><i class="fa-solid fa-expand"></i><span>Descolapsar</span></button></div><div class="table-responsive inventario-table-compact-wrap"><table class="table recipe-table inventario-table-compact mb-0"><thead><tr><th>ID</th><th>Fecha y hora</th><th>Producto</th><th>Cantidad</th><th>Responsable</th><th>VTO producto</th><th>Trazabilidad</th><th>Planilla</th><th>Adjuntos</th><th>Acciones</th></tr></thead><tbody>${renderRows()}</tbody></table></div><div class="inventario-pagination enhanced"><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn inventario-page-btn" data-prod-expanded-page="prev" ${expandedPage <= 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-left"></i></button><span>Página ${expandedPage} de ${pages}</span><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn inventario-page-btn" data-prod-expanded-page="next" ${expandedPage >= pages ? 'disabled' : ''}><i class="fa-solid fa-chevron-right"></i></button></div>`;
      prepareThumbLoaders('.js-produccion-thumb');
    };
    await openIosSwal({
      title: 'Producciones guardadas • La Jamonera',
      html: '<div id="produccionExpandedHistoryHost" class="inventario-expand-wrap"></div>',
      width: '92vw',
      confirmButtonText: 'Cerrar',
      didOpen: (popup) => {
        renderExpandedContent(popup);
        popup.addEventListener('click', async (event) => {
          if (event.target.closest('#produccionExpandedHistoryCollapseAllRowsBtn')) {
            rows.forEach((item) => {
              if (getTraceRowsFromRegistro(item).length) collapseMap[item.id] = true;
            });
            renderExpandedContent(popup);
            return;
          }
          if (event.target.closest('#produccionExpandedHistoryExpandAllRowsBtn')) {
            rows.forEach((item) => {
              if (getTraceRowsFromRegistro(item).length) collapseMap[item.id] = false;
            });
            renderExpandedContent(popup);
            return;
          }
          const collapseBtn = event.target.closest('[data-prod-expanded-collapse]');
          if (collapseBtn) {
            const prodId = collapseBtn.dataset.prodExpandedCollapse;
            collapseMap[prodId] = !collapseMap[prodId];
            renderExpandedContent(popup);
            return;
          }
          const pageBtn = event.target.closest('[data-prod-expanded-page]');
          if (pageBtn) {
            expandedPage += pageBtn.dataset.prodExpandedPage === 'next' ? 1 : -1;
            renderExpandedContent(popup);
            return;
          }
          const qrPrintBtn = event.target.closest('[data-recipe-prod-qr-print]');
          if (qrPrintBtn) {
            const reg = state.registros[qrPrintBtn.dataset.recipeProdQrPrint];
            if (reg) await openProductionQrPrintConfigurator(reg);
            return;
          }
          const traceBtn = event.target.closest('[data-recipe-prod-trace]');
          if (traceBtn) {
            const reg = state.registros[traceBtn.dataset.recipeProdTrace];
            if (reg) await openTraceability(reg);
            return;
          }
          const traceImageBtn = event.target.closest('[data-recipe-prod-trace-images]');
          if (traceImageBtn && typeof window.laJamoneraOpenImageViewer === 'function') {
            const urls = JSON.parse(decodeURIComponent(traceImageBtn.dataset.recipeProdTraceImages || '[]'));
            if (Array.isArray(urls) && urls.length) {
              await window.laJamoneraOpenImageViewer([{ invoiceImageUrls: urls }], 0, 'Adjuntos de lote');
            }
            return;
          }
          const deleteBtn = event.target.closest('[data-prod-cancel]');
          if (deleteBtn) {
            const reg = state.registros[deleteBtn.dataset.prodCancel];
            if (reg) await cancelProduction(reg);
          }
        });
      },
      customClass: { confirmButton: 'ios-btn ios-btn-secondary' }
    });
  });
  nodes.historyExcelBtn?.addEventListener('click', async () => {
    const rows = getHistoryRows();
    const payload = rows.flatMap((item) => {
      const manager = getManagerLabel(item);
      const main = {
        'ID producción': item.id || '-',
        'Fecha y hora': formatDateTime(item.createdAt),
        Producto: item.recipeTitle || '-',
        'Fabricado (KG.)': `${Number(item.quantityKg || 0).toFixed(2)} kg`,
        Responsable: manager.name,
        'VTO producto': formatProductExpiryLabel(item),
        Trazabilidad: '-',
        Acciones: '-'
      };
      const resolutions = (Array.isArray(item?.lots) ? item.lots : [])
        .flatMap((plan) => (Array.isArray(plan?.lots) ? plan.lots : [])
          .flatMap((lot) => (Array.isArray(lot?.expiryResolutions) ? lot.expiryResolutions : []).map((res) => ({
            'ID producción': '↳ RES',
            'Fecha y hora': formatDateTime(res.createdAt),
            Producto: item.recipeTitle || '-',
            'Fabricado (KG.)': `-${Number(res.qtyKg || 0).toFixed(2)} kg`,
            Responsable: res.type === 'decommissioned' ? 'Decomisado' : 'Vendido mostrador',
            'VTO producto': formatProductExpiryLabel(item),
            Trazabilidad: 'Resolución vencido',
            Acciones: '-',
            __tone: isHighlightedResolutionType(res.type) ? 'resolution_yellow' : 'normal'
          }))));
      const traces = getTraceRowsFromRegistro(item).map((trace) => ({
        'ID producción': `↳ ${trace.index}`,
        'Fecha y hora': formatDateTime(trace.createdAt),
        Producto: trace.ingredientName,
        'Fabricado (KG.)': `-${trace.amount}`,
        Responsable: trace.lotNumber,
        'VTO producto': trace.expiryDate || '-',
        Trazabilidad: 'Adjunto',
        Acciones: '-',
        __tone: 'trace'
      }));
      return [main, ...resolutions, ...traces];
    });
    await exportStyledExcel({
      fileName: `producciones_periodo_${Date.now()}.xlsx`,
      sheetName: 'Producciones',
      headers: ['ID producción', 'Fecha y hora', 'Producto', 'Fabricado (KG.)', 'Responsable', 'VTO producto', 'Trazabilidad', 'Acciones'],
      rows: payload
    });
  });

  const openMassPlanillasByPeriod = async () => {
    const rows = getHistoryRows();
    if (!rows.length) {
      await openIosSwal({ title: 'Sin datos', html: '<p>No hay producciones para el período seleccionado.</p>', icon: 'info' });
      return;
    }

    const uniqueRecipes = Object.values(rows.reduce((acc, row) => {
      const id = normalizeValue(row.recipeId || row.recipeTitle || row.id);
      if (!id) return acc;
      if (!acc[id]) {
        const recipe = safeObject(state.recetas?.[row.recipeId]);
        const imageUrl = normalizeValue(recipe.imageUrl || row?.traceability?.product?.imageUrl);
        acc[id] = { id, title: normalizeValue(row.recipeTitle) || normalizeValue(recipe.title) || 'Sin nombre', imageUrl };
      }
      return acc;
    }, {}));

    const selector = await openIosSwal({
      title: 'Selector de productos',
      html: `<div class="swal-stack-fields text-start">
        <label class="inventario-check-row"><input type="radio" name="massPlanillaScope" value="all" checked><span>Incluir todos los productos</span></label>
        <label class="inventario-check-row"><input type="radio" name="massPlanillaScope" value="exclude"><span>Excluir algunos productos</span></label>
        <div id="massPlanillasScope" class="notify-specific-users-list d-none">
          <div class="step-block"><strong>Productos</strong>${uniqueRecipes.map((item) => `<label class="inventario-check-row inventario-selector-row">${item.imageUrl ? `<span class="inventario-print-photo-wrap"><span class="thumb-loading"><img class="meta-spinner-login" src="./IMG/Meta-ai-logo.webp" alt="Cargando"></span><img class="thumb-image js-produccion-thumb" src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.title)}"></span>` : ''}<input type="checkbox" data-mass-planilla-recipe value="${escapeHtml(item.id)}"><span>${escapeHtml(item.title)}</span></label>`).join('')}</div>
        </div>
      </div>`,
      showCancelButton: true,
      confirmButtonText: 'Continuar',
      cancelButtonText: 'Cancelar',
      didOpen: () => {
        const all = document.querySelector('input[name="massPlanillaScope"][value="all"]');
        const exclude = document.querySelector('input[name="massPlanillaScope"][value="exclude"]');
        const list = document.getElementById('massPlanillasScope');
        const toggle = () => list?.classList.toggle('d-none', !exclude?.checked);
        all?.addEventListener('change', toggle);
        exclude?.addEventListener('change', toggle);
        prepareThumbLoaders('.js-produccion-thumb');
      },
      preConfirm: () => {
        const mode = document.querySelector('input[name="massPlanillaScope"]:checked')?.value || 'all';
        const selected = [...document.querySelectorAll('[data-mass-planilla-recipe]:checked')].map((node) => node.value);
        if (mode === 'exclude' && !selected.length) {
          Swal.showValidationMessage('Seleccioná al menos un producto para excluir.');
          return false;
        }
        return { mode, selected };
      }
    });
    if (!selector.isConfirmed) return;

    const excluded = new Set(selector.value.mode === 'exclude' ? selector.value.selected : []);
    const filtered = rows.filter((row) => !excluded.has(normalizeValue(row.recipeId || row.recipeTitle || row.id)));
    if (!filtered.length) {
      await openIosSwal({ title: 'Sin resultados', html: '<p>El filtro dejó 0 planillas para imprimir.</p>', icon: 'warning' });
      return;
    }

    await Swal.fire({
      title: 'Planillas masivas',
      html: '<div class="planilla-progress-wrap"><div class="planilla-progress-bar"><span id="massPlanillasProgressBar" style="width:0%"></span></div><p id="massPlanillasProgressText" class="planilla-progress-text">0% Preparando...</p></div>',
      allowOutsideClick: false,
      showConfirmButton: false,
      customClass: { popup: 'ios-alert produccion-loading-alert', title: 'ios-alert-title', htmlContainer: 'ios-alert-text' },
      didOpen: async () => {
        try {
          await window.laJamoneraPlanillaProduccion?.printBatch?.(filtered, { companyLogoUrl: normalizeValue(state.config.companyLogoUrl), usersMap: safeObject(state.users) }, (progress) => {
            const value = Math.max(0, Math.min(100, Number(progress) || 0));
            const bar = document.getElementById('massPlanillasProgressBar');
            const text = document.getElementById('massPlanillasProgressText');
            if (bar) bar.style.width = `${value}%`;
            if (text) text.textContent = `${value}% Procesando planillas...`;
          });
        } finally {
          Swal.close();
        }
      }
    });
  };
  const openMassDispatchPlanillasByPeriod = async () => {
    const rows = getDispatchRows();
    if (!rows.length) {
      await openIosSwal({ title: 'Sin datos', html: '<p>No hay repartos para el período seleccionado.</p>', icon: 'info' });
      return;
    }

    const uniqueRecipes = Object.values(rows.reduce((acc, row) => {
      const products = Array.isArray(row.products) ? row.products : [];
      products.forEach((product) => {
        const id = normalizeValue(product.recipeId || product.recipeTitle);
        if (!id) return;
        if (!acc[id]) {
          acc[id] = {
            id,
            title: normalizeValue(product.recipeTitle) || normalizeValue(state.recetas?.[product.recipeId]?.title) || 'Sin nombre',
            imageUrl: normalizeValue(product.recipeImageUrl || state.recetas?.[product.recipeId]?.imageUrl)
          };
        }
      });
      return acc;
    }, {}));

    const selector = await openIosSwal({
      title: 'Selector de productos',
      html: `<div class="swal-stack-fields text-start">
        <label class="inventario-check-row"><input type="radio" name="dispatchMassPlanillaScope" value="all" checked><span>Incluir todos los productos</span></label>
        <label class="inventario-check-row"><input type="radio" name="dispatchMassPlanillaScope" value="exclude"><span>Excluir algunos productos</span></label>
        <div id="dispatchMassPlanillasScope" class="notify-specific-users-list d-none">
          <div class="step-block"><strong>Productos</strong>${uniqueRecipes.map((item) => `<label class="inventario-check-row inventario-selector-row">${item.imageUrl ? `<span class="inventario-print-photo-wrap"><span class="thumb-loading"><img class="meta-spinner-login" src="./IMG/Meta-ai-logo.webp" alt="Cargando"></span><img class="thumb-image js-dispatch-mass-thumb" src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.title)}"></span>` : ''}<input type="checkbox" data-dispatch-mass-planilla-recipe value="${escapeHtml(item.id)}"><span>${escapeHtml(item.title)}</span></label>`).join('')}</div>
        </div>
      </div>`,
      showCancelButton: true,
      confirmButtonText: 'Continuar',
      cancelButtonText: 'Cancelar',
      didOpen: () => {
        const all = document.querySelector('input[name="dispatchMassPlanillaScope"][value="all"]');
        const exclude = document.querySelector('input[name="dispatchMassPlanillaScope"][value="exclude"]');
        const list = document.getElementById('dispatchMassPlanillasScope');
        const toggle = () => list?.classList.toggle('d-none', !exclude?.checked);
        all?.addEventListener('change', toggle);
        exclude?.addEventListener('change', toggle);
        prepareThumbLoaders('.js-dispatch-mass-thumb');
      },
      preConfirm: () => {
        const mode = document.querySelector('input[name="dispatchMassPlanillaScope"]:checked')?.value || 'all';
        const selected = [...document.querySelectorAll('[data-dispatch-mass-planilla-recipe]:checked')].map((node) => node.value);
        if (mode === 'exclude' && !selected.length) {
          Swal.showValidationMessage('Seleccioná al menos un producto para excluir.');
          return false;
        }
        return { mode, selected };
      }
    });
    if (!selector.isConfirmed) return;

    const excluded = new Set(selector.value.mode === 'exclude' ? selector.value.selected : []);
    const filtered = rows.filter((row) => {
      if (!excluded.size) return true;
      const products = Array.isArray(row.products) ? row.products : [];
      return products.some((product) => !excluded.has(normalizeValue(product.recipeId || product.recipeTitle)));
    });
    if (!filtered.length) {
      await openIosSwal({ title: 'Sin resultados', html: '<p>El filtro dejó 0 planillas para imprimir.</p>', icon: 'warning' });
      return;
    }

    await Swal.fire({
      title: 'Planillas masivas',
      html: '<div class="planilla-progress-wrap"><div class="planilla-progress-bar"><span id="dispatchMassPlanillasProgressBar" style="width:0%"></span></div><p id="dispatchMassPlanillasProgressText" class="planilla-progress-text">0% Preparando...</p></div>',
      allowOutsideClick: false,
      showConfirmButton: false,
      customClass: { popup: 'ios-alert produccion-loading-alert', title: 'ios-alert-title', htmlContainer: 'ios-alert-text' },
      didOpen: async () => {
        try {
          await printDispatchPlanillasBatch(filtered, (progress) => {
            const value = Math.max(0, Math.min(100, Number(progress) || 0));
            const bar = document.getElementById('dispatchMassPlanillasProgressBar');
            const text = document.getElementById('dispatchMassPlanillasProgressText');
            if (bar) bar.style.width = `${value}%`;
            if (text) text.textContent = `${value}% Procesando planillas...`;
          });
        } finally {
          Swal.close();
        }
      }
    });
  };


  const parseWeeklyRangeValue = (value = '') => {
    const raw = normalizeValue(value);
    if (!raw) return { from: '', to: '' };
    const parts = raw.split(/\s+to\s+|\s+a\s+/i).map((item) => normalizeValue(item));
    return {
      from: parts[0] || '',
      to: parts[1] || parts[0] || ''
    };
  };
  const addIsoDays = (isoDate, days = 0) => {
    const date = new Date(`${normalizeValue(isoDate)}T00:00:00`);
    if (Number.isNaN(date.getTime())) return '';
    date.setDate(date.getDate() + Number(days || 0));
    return toIsoDate(date.getTime());
  };
  const askRequiredRangeForWeeklyProductionSheet = async () => {
    const picker = await openIosSwal({
      title: 'Rango obligatorio para planilla',
      customClass: { popup: 'weekly-range-alert' },
      html: '<p>Para evitar procesar datos infinitos, seleccioná un rango de fechas antes de continuar.</p><input id="sheetRangeInput" class="swal2-input ios-input w-100" placeholder="Seleccionar rango">',
      showCancelButton: true,
      confirmButtonText: 'Continuar',
      cancelButtonText: 'Cancelar',
      didOpen: () => {
        const input = document.getElementById('sheetRangeInput');
        if (window.flatpickr && input) {
          const locale = { ...(window.flatpickr.l10ns?.es || {}), rangeSeparator: ' a ' };
          window.flatpickr(input, { locale, mode: 'range', dateFormat: 'Y-m-d', allowInput: false, disableMobile: true });
        }
      },
      preConfirm: () => {
        const parsed = parseWeeklyRangeValue(normalizeValue(document.getElementById('sheetRangeInput')?.value));
        if (!parsed.from || !parsed.to) {
          Swal.showValidationMessage('Debés seleccionar un rango completo (desde y hasta).');
          return false;
        }
        return parsed;
      }
    });
    return picker.isConfirmed ? picker.value : null;
  };
  const printWeeklyProductionPlanilla = (html) => {
    const win = window.open('', '_blank', 'width=1400,height=900');
    if (!win) return;
    win.document.write(`<html><head><title>Planilla de producción semanal</title><style>@page{size:landscape;margin:10mm}body{font-family:Inter,Arial,sans-serif;color:#111827;background:#ffffff;margin:0;padding:8px}.weekly-production-sheet{display:grid;gap:14px}.weekly-sheet-block{border:1px solid #2f2f2f}.weekly-sheet-block h3,.weekly-sheet-block h4{margin:0;text-align:center;font-weight:800;padding:6px 6px}.weekly-sheet-block h4{border-top:1px solid #2f2f2f;font-size:16px}.weekly-sheet-table{width:100%;border-collapse:collapse;table-layout:fixed}.weekly-sheet-table th,.weekly-sheet-table td{border:1px solid #2f2f2f;padding:4px;word-break:break-word;text-align:center;font-size:11px;line-height:1.15}.weekly-sheet-table th.th-cat{background:#1d7a2f;color:#fff}.weekly-sheet-table th.th-day{background:#136fb6;color:#fff}.weekly-sheet-table th.th-total{background:#08266e;color:#fff}.weekly-sheet-table td.is-missing{background:#f4dfe2}.weekly-sheet-table td.is-ok{background:#e9edf2}.weekly-sheet-table td.weekly-total{font-weight:800}.weekly-product-cell{display:inline-flex;align-items:center;gap:8px;justify-content:flex-start;text-align:left}.weekly-product-cell img{width:24px;height:24px;border-radius:999px;object-fit:cover;border:1px solid #c7d3ea}.page-break{page-break-before:always;break-before:page}</style></head><body>${html}</body></html>`);
    win.document.close();
    const safePrint = () => {
      try {
        if (win.__printed) return;
        win.__printed = true;
        win.focus();
        win.print();
      } catch (_) {
      }
    };
    waitPrintAssets(win).then(() => {
      setTimeout(safePrint, 120);
    }).catch(() => {
      safePrint();
    });
    setTimeout(safePrint, 1200);
  };

  const openWeeklyProductionPlanillaByPeriod = async () => {
    const range = await askRequiredRangeForWeeklyProductionSheet();
    if (!range) return;
    const allRows = Object.values(safeObject(state.registros || {}));
    const uniqueRecipes = Object.values(allRows.reduce((acc, row) => {
      const id = normalizeValue(row.recipeId || row.recipeTitle || row.id);
      if (!id) return acc;
      if (!acc[id]) {
        const recipe = safeObject(state.recetas?.[row.recipeId]);
        acc[id] = {
          id,
          title: normalizeValue(row.recipeTitle) || normalizeValue(recipe.title) || 'Sin nombre',
          imageUrl: normalizeValue(recipe.imageUrl || row?.traceability?.product?.imageUrl),
          category: normalizeValue(recipe?.nutrition?.category || 'sin-categoria'),
          subcategory: normalizeValue(recipe?.nutrition?.subcategory || 'sin-subcategoria')
        };
      }
      return acc;
    }, {}));
    const selector = await openIosSwal({
      title: 'Selector de productos',
      html: `<div class="swal-stack-fields text-start"><label class="inventario-check-row"><input type="radio" name="weeklyPlanillaScope" value="all" checked><span>Incluir todos los productos</span></label><label class="inventario-check-row"><input type="radio" name="weeklyPlanillaScope" value="exclude"><span>Excluir algunos productos</span></label><div id="weeklyPlanillasScope" class="notify-specific-users-list d-none"><div class="step-block"><strong>Productos</strong>${uniqueRecipes.map((item) => `<label class="inventario-check-row inventario-selector-row">${item.imageUrl ? `<span class="inventario-print-photo-wrap"><span class="thumb-loading"><img class="meta-spinner-login" src="./IMG/Meta-ai-logo.webp" alt="Cargando"></span><img class="thumb-image js-weekly-production-thumb" src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.title)}"></span>` : ''}<input type="checkbox" data-weekly-planilla-recipe value="${escapeHtml(item.id)}"><span>${escapeHtml(item.title)}</span></label>`).join('')}</div></div></div>`,
      showCancelButton: true,
      confirmButtonText: 'Continuar',
      cancelButtonText: 'Cancelar',
      didOpen: () => {
        const all = document.querySelector('input[name="weeklyPlanillaScope"][value="all"]');
        const exclude = document.querySelector('input[name="weeklyPlanillaScope"][value="exclude"]');
        const list = document.getElementById('weeklyPlanillasScope');
        const toggle = () => list?.classList.toggle('d-none', !exclude?.checked);
        all?.addEventListener('change', toggle);
        exclude?.addEventListener('change', toggle);
        prepareThumbLoaders('.js-weekly-production-thumb');
      },
      preConfirm: () => {
        const mode = document.querySelector('input[name="weeklyPlanillaScope"]:checked')?.value || 'all';
        const selected = [...document.querySelectorAll('[data-weekly-planilla-recipe]:checked')].map((node) => node.value);
        if (mode === 'exclude' && !selected.length) {
          Swal.showValidationMessage('Seleccioná al menos un producto para excluir.');
          return false;
        }
        return { mode, selected };
      }
    });
    if (!selector.isConfirmed) return;
    const excluded = new Set(selector.value.mode === 'exclude' ? selector.value.selected : []);
    const products = uniqueRecipes.filter((item) => !excluded.has(item.id));
    if (!products.length) return;
    const rowsInRange = allRows.filter((row) => {
      const date = normalizeValue(row.productionDate);
      return date && date >= range.from && date <= range.to;
    });
    const segments = [];
    let cursor = range.from;
    while (cursor && cursor <= range.to) {
      const segEndCandidate = addIsoDays(cursor, 6);
      const segEnd = segEndCandidate > range.to ? range.to : segEndCandidate;
      segments.push({ start: cursor, end: segEnd });
      cursor = addIsoDays(segEnd, 1);
    }
    const dayLabelByIndex = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const html = `<div class="weekly-production-sheet">${segments.map((segment, idx) => {
      const dayIsos = [];
      let d = segment.start;
      while (d && d <= segment.end) {
        dayIsos.push(d);
        d = addIsoDays(d, 1);
      }
      const hasWeekendProduction = dayIsos.some((iso) => {
        const weekday = new Date(`${iso}T00:00:00`).getDay();
        if (!(weekday === 0 || weekday === 6)) return false;
        return rowsInRange.some((row) => normalizeValue(row.productionDate) === iso && Number(row.quantityKg || 0) > 0);
      });
      const displayIsos = dayIsos.filter((iso) => {
        const weekday = new Date(`${iso}T00:00:00`).getDay();
        if (weekday >= 1 && weekday <= 5) return true;
        return hasWeekendProduction && (weekday === 0 || weekday === 6);
      });
      const headers = displayIsos.map((iso) => dayLabelByIndex[new Date(`${iso}T00:00:00`).getDay()] || '-');
      const rowsHtml = products.slice().sort((a,b)=> `${a.subcategory}|${a.title}`.localeCompare(`${b.subcategory}|${b.title}`,'es')).map((product) => {
        const daily = displayIsos.map((iso) => rowsInRange.filter((row) => normalizeValue(row.recipeId || row.recipeTitle || row.id) === product.id && normalizeValue(row.productionDate) === iso).reduce((acc, row) => acc + Number(row.quantityKg || 0), 0));
        const total = daily.reduce((acc, value) => acc + value, 0);
        return `<tr><td>${escapeHtml(capitalize(product.category.replaceAll('-', ' ')))}</td><td>${escapeHtml(capitalize(product.subcategory))}</td><td><div class="weekly-product-cell">${product.imageUrl ? `<img class="weekly-product-thumb" src="${escapeHtml(product.imageUrl)}" alt="${escapeHtml(product.title)}">` : ''}<span>${escapeHtml(product.title)}</span></div></td>${daily.map((kg) => `<td class="${kg > 0 ? 'is-ok' : 'is-missing'}">${kg > 0 ? `${kg.toFixed(2)}KG` : ''}</td>`).join('')}<td class="weekly-total">${total.toFixed(2)}KG</td></tr>`;
      }).join('');
      return `<section class="weekly-sheet-block ${idx ? 'page-break' : ''}"><h3>FRIGORIFICO LA JAMONERA • PLANILLA DE PRODUCCION SEMANAL</h3><h4>SEMANA DE ${formatIsoEs(segment.start)} A ${formatIsoEs(segment.end)}</h4><div class="table-responsive"><table class="weekly-sheet-table"><thead><tr><th class="th-cat">CATEGORIA</th><th class="th-cat">SUBCATEGORIA</th><th class="th-cat">PRODUCTO</th>${headers.map((d) => `<th class="th-day">${d.toUpperCase()}</th>`).join('')}<th class="th-total">TOTAL</th></tr></thead><tbody>${rowsHtml || `<tr><td colspan="${4 + headers.length}">Sin datos.</td></tr>`}</tbody></table></div></section>`;
    }).join('')}</div>`;

    await openIosSwal({
      title: 'Planilla de Producción Semanal',
      width: 'min(1400px,98vw)',
      html: `<div class="planilla-toolbar"><button type="button" class="btn ios-btn ios-btn-secondary" id="weeklyProductionPrintBtn"><i class="fa-solid fa-print"></i><span>Imprimir</span></button></div><div class="planilla-card">${html}</div>`,
      confirmButtonText: 'Cerrar',
      customClass: { popup: 'produccion-trace-alert planilla-modal', confirmButton: 'ios-btn ios-btn-secondary' },
      didOpen: (popup) => {
        popup.querySelector('#weeklyProductionPrintBtn')?.addEventListener('click', async () => {
          printWeeklyProductionPlanilla(html);
        });
      }
    });
  };

  nodes.historyPrintBtn?.addEventListener('click', async () => {
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
    const rows = getHistoryRows();
    const attachedImages = includeImages
      ? rows.flatMap((item) => getTraceRowsFromRegistro(item).flatMap((trace) => trace.invoiceImageUrls || []))
      : [];
    if (includeImages) {
      await preloadPrintImages(attachedImages);
    }
    const win = window.open('', '_blank', 'width=1300,height=900');
    if (!win) return;
    const bodyRows = rows.flatMap((item) => {
      const manager = getManagerLabel(item);
      const productImage = normalizeValue(item?.traceability?.product?.imageUrl) || normalizeValue(state.recetas?.[item.recipeId]?.imageUrl);
      const productCell = `<span style="display:inline-flex;align-items:center;gap:8px;">${productImage ? `<img src="${escapeHtml(productImage)}" style="width:28px;height:28px;border-radius:999px;object-fit:cover;border:1px solid #d7def2;">` : ''}<strong>${escapeHtml(item.recipeTitle || '-')}</strong></span>`;
      const main = `<tr><td>${escapeHtml(item.id)}</td><td>${escapeHtml(formatDateTime(item.createdAt))}</td><td>${productCell}</td><td>${Number(item.quantityKg || 0).toFixed(2)} kg</td><td>${escapeHtml(manager.name)}<br><small>${escapeHtml(manager.role)}</small></td><td>${escapeHtml(formatProductExpiryLabel(item))} (VTO)</td></tr>`;
      const resolutions = (Array.isArray(item?.lots) ? item.lots : [])
        .flatMap((plan) => (Array.isArray(plan?.lots) ? plan.lots : [])
          .flatMap((lot) => (Array.isArray(lot?.expiryResolutions) ? lot.expiryResolutions : [])
            .filter((res) => isHighlightedResolutionType(res.type))
            .map((res) => `<tr class="is-resolution-row"><td>↳ RES</td><td>${escapeHtml(formatDateTime(res.createdAt))}</td><td>${escapeHtml(item.recipeTitle || '-')}</td><td>-${Number(res.qtyKg || 0).toFixed(2)} kg</td><td>${escapeHtml(res.type === 'decommissioned' ? 'Decomisado' : 'Vendido en mostrador')}</td><td>${escapeHtml(formatProductExpiryLabel(item))} (VTO)</td></tr>`)));
      if (!includeTrace) return [main, ...resolutions];
      const traces = getTraceRowsFromRegistro(item).map((trace) => `<tr class="is-trace-row"><td>↳ ${trace.index}</td><td><span class="print-trace-date">${escapeHtml(formatDateTime(trace.createdAt))}</span></td><td><span style="display:inline-flex;align-items:center;gap:8px;">${trace.ingredientImageUrl ? `<img src="${escapeHtml(trace.ingredientImageUrl)}" style="width:22px;height:22px;border-radius:999px;object-fit:cover;border:1px solid #d7def2;">` : ''}<span>${escapeHtml(trace.ingredientName)}</span></span></td><td class="inventario-trace-kilos">-${escapeHtml(trace.amount)}</td><td>${escapeHtml(trace.lotNumber)}</td><td><span class="print-trace-vto">${escapeHtml(formatExpiryHuman(trace.expiryDate))}${normalizeLower(trace.expiryDate)==='no perecedero' ? '' : ' (VTO)'}</span></td></tr>`);
      return [main, ...resolutions, ...traces];
    }).join('');
    const tracesWithAttachments = rows.flatMap((item) => getTraceRowsFromRegistro(item).filter((trace) => Array.isArray(trace.invoiceImageUrls) && trace.invoiceImageUrls.length));
    const imagesHtml = includeImages && tracesWithAttachments.length
      ? `<section><h2 style="margin:16px 0 10px;font-size:18px;">Imágenes adjuntas del período</h2><div style="display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));">${tracesWithAttachments.map((trace) => `<figure style="margin:0;border:1px solid #d7def2;border-radius:12px;padding:10px;background:#fff;"><div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;"><figcaption style="font-size:12px;color:#4b5f8e;font-weight:700;">${escapeHtml(trace.ingredientName)}</figcaption></div>${(trace.invoiceImageUrls || []).map((url, idx) => `<img src="${url}" style="width:100%;max-height:240px;object-fit:contain;border-radius:10px;margin-top:${idx ? '8px' : '0'};">`).join('')}</figure>`).join('')}</div></section>`
      : '';
    win.document.write(`<html><head><title>Producción por período</title><style>body{font-family:Inter,Arial;padding:20px;color:#1f2a44}table{width:100%;border-collapse:collapse}th,td{border:1px solid #d7def2;padding:6px;font-size:11px;vertical-align:top}th{background:#eef3ff;font-size:10px;text-transform:uppercase;letter-spacing:.04em}.is-trace-row td{background:#ffecef}.is-resolution-row td{background:#fff6d9}.print-trace-date{color:#1f6fd6;font-weight:700}.print-trace-vto{color:#b04a09;font-weight:700}</style></head><body><h1>Producción por período • La Jamonera</h1><table><thead><tr><th>ID producción</th><th>Fecha y hora</th><th>Producto</th><th>Fabricado (KG.)</th><th>Responsable</th><th>VTO producto</th></tr></thead><tbody>${bodyRows || '<tr><td colspan="6">Sin datos</td></tr>'}</tbody></table>${imagesHtml}</body></html>`);
    win.document.close();
    win.focus();
    await waitPrintAssets(win);
    onProgress?.(100);
    win.print();
  });
  nodes.historyMassPlanillasBtn?.addEventListener('click', openMassPlanillasByPeriod);
  nodes.historyWeeklyPlanillaBtn?.addEventListener('click', openWeeklyProductionPlanillaByPeriod);

  nodes.dispatchView?.addEventListener('click', (event) => {
    if (!state.dispatchCreateMode || !state.dispatchDraft) return;
    const vehicleInput = event.target.closest('#dispatchVehicleInput');
    if (vehicleInput) {
      showDispatchVehicleSuggestions(vehicleInput);
      return;
    }
    const productInput = event.target.closest('[data-dispatch-product-search]');
    if (productInput) {
      showDispatchProductSuggestions(productInput);
    }
  });

  nodes.dispatchView?.addEventListener('click', async (event) => {
    if (event.target.closest('#produccionDispatchBackBtn')) {
      if (state.dispatchCreateMode) {
        const canLeave = await confirmLeaveDispatchCreate();
        if (!canLeave) return;
      }
      await runWithBackSpinner(async () => {
        await refreshData({ silent: true });
        setDispatchMode(false);
        renderList();
      });
      return;
    }
    if (event.target.closest('#produccionDispatchNewBtn')) {
      state.dispatchDraft = buildDispatchDraft();
      renderDispatchCreate(state.dispatchDraft);
      return;
    }
    if (event.target.closest('#produccionDispatchBackToListBtn')) {
      const canLeave = await confirmLeaveDispatchCreate();
      if (!canLeave) return;
      await runWithBackSpinner(async () => {
        await refreshData({ silent: true });
        renderDispatchMain();
      });
      return;
    }
    if (event.target.closest('#dispatchAddProductBtn')) {
      state.dispatchDraft.lines.push({ id: makeId('dispatch_row'), recipeId: '', recipeSearch: '', qtyKg: '', allocations: [] });
      renderDispatchCreate(state.dispatchDraft);
      return;
    }
    if (event.target.closest('#dispatchAddVehicleBtn')) {
      const vehicle = await openCreateDispatchVehicle();
      if (vehicle) {
        state.dispatchDraft.vehicleId = vehicle.id;
        state.dispatchDraft.vehicleSearch = formatDispatchVehicleLabel(vehicle);
      }
      renderDispatchCreate(state.dispatchDraft);
      return;
    }
    if (event.target.closest('#dispatchManageVehiclesBtn')) {
      await openDispatchVehiclesManager();
      renderDispatchCreate(state.dispatchDraft);
      return;
    }
    const removeLineBtn = event.target.closest('[data-dispatch-remove]');
    if (removeLineBtn) {
      const idx = Number(removeLineBtn.dataset.dispatchRemove);
      state.dispatchDraft.lines = state.dispatchDraft.lines.filter((_, i) => i !== idx);
      if (!state.dispatchDraft.lines.length) state.dispatchDraft.lines.push({ id: makeId('dispatch_row'), recipeId: '', recipeSearch: '', qtyKg: '', allocations: [] });
      renderDispatchCreate(state.dispatchDraft);
      return;
    }
    if (event.target.closest('#dispatchQuickCreateClientBtn')) {
      const created = await openCreateDispatchClient('');
      if (created) {
        state.dispatchDraft.clientId = created.id;
        state.dispatchDraft.clientName = created.name;
        state.dispatchDraft.clientAddress = normalizeValue(created.address);
        state.dispatchDraft.clientCity = normalizeValue(created.city);
        state.dispatchDraft.clientProvince = normalizeValue(created.province) || 'Santa Fe';
        state.dispatchDraft.clientCountry = normalizeValue(created.country) || 'Argentina';
        renderDispatchCreate(state.dispatchDraft);
      }
      return;
    }
    if (event.target.closest('#dispatchQuickEditClientBtn')) {
      await openDispatchClientsManager();
      if (state.dispatchCreateMode && state.dispatchDraft) renderDispatchCreate(state.dispatchDraft);
      return;
    }
    if (event.target.closest('#dispatchAddCommentBtn')) {
      state.dispatchDraft.comments.push('');
      renderDispatchCreate(state.dispatchDraft);
      return;
    }
    if (event.target.closest('#dispatchAddProofBtn')) {
      if (!Array.isArray(state.dispatchDraft.proofs)) state.dispatchDraft.proofs = [];
      state.dispatchDraft.proofs.push({ name: '', url: '' });
      renderDispatchCreate(state.dispatchDraft);
      return;
    }
    const removeCommentBtn = event.target.closest('[data-dispatch-comment-remove]');
    if (removeCommentBtn) {
      const idx = Number(removeCommentBtn.dataset.dispatchCommentRemove);
      state.dispatchDraft.comments = state.dispatchDraft.comments.filter((_, i) => i !== idx);
      renderDispatchCreate(state.dispatchDraft);
      return;
    }
    const removeProofBtn = event.target.closest('[data-dispatch-proof-remove]');
    if (removeProofBtn) {
      const idx = Number(removeProofBtn.dataset.dispatchProofRemove);
      state.dispatchDraft.proofs = (Array.isArray(state.dispatchDraft.proofs) ? state.dispatchDraft.proofs : []).filter((_, i) => i !== idx);
      renderDispatchCreate(state.dispatchDraft);
      return;
    }
    const expiredActionBtn = event.target.closest('[data-dispatch-expired-action]');
    if (expiredActionBtn) {
      const idx = Number(expiredActionBtn.dataset.dispatchRow);
      const actionType = normalizeValue(expiredActionBtn.dataset.dispatchExpiredAction);
      const line = state.dispatchDraft.lines?.[idx];
      const recipeId = normalizeValue(line?.recipeId);
      const dispatchDate = normalizeValue(state.dispatchDraft.dispatchDate) || toIsoDate();
      if (!recipeId) {
        await openIosSwal({ title: 'Producto requerido', html: '<p>Seleccioná un producto válido antes de resolver lotes vencidos.</p>', icon: 'warning' });
        return;
      }
      const expiredLot = buildRecipeLotsForDispatch(recipeId).find((lot) => isDispatchLotExpiredForDate(lot, dispatchDate));
      if (!expiredLot || Number(expiredLot.availableKg || 0) <= 0.0001) {
        await openIosSwal({ title: 'Sin lotes vencidos', html: '<p>El lote vencido ya no está disponible para resolver.</p>', icon: 'info' });
        renderDispatchCreate(state.dispatchDraft);
        return;
      }
      const upcomingLot = buildRecipeLotsForDispatch(recipeId).find((lot) => !isDispatchLotExpiredForDate(lot, dispatchDate) && Number(lot.availableKg || 0) > 0.0001);
      const confirmTitle = actionType === 'decommissioned' ? '¿Marcar lote como decomisado?' : '¿Marcar lote como venta en sucursal?';
      const confirmText = actionType === 'decommissioned'
        ? 'Se descontará todo el disponible del lote vencido y se registrará un egreso como Decomisado, vinculado al número de producción.'
        : 'Se descontará todo el disponible del lote vencido y se registrará un egreso como Venta en Sucursal, vinculado al número de producción.';
      const extraLotText = upcomingLot
        ? `<small>Al confirmar cargaremos otro lote disponible: <strong>${escapeHtml(upcomingLot.lotNumber || '-')}</strong> con <strong>${Number(upcomingLot.availableKg || 0).toFixed(2)} kg</strong>.</small>`
        : '<small>Si no hay otro lote vigente, la fila del producto se quitará para que puedas seguir cargando el reparto.</small>';
      const confirm = await openIosSwal({
        title: confirmTitle,
        html: `<p>${confirmText}</p><p><strong>Lote:</strong> ${escapeHtml(expiredLot.lotNumber || '-')} · <strong>Vence:</strong> ${escapeHtml(formatIsoEs(expiredLot.expiryDate || ''))} · <strong>Disponible:</strong> ${Number(expiredLot.availableKg || 0).toFixed(2)} kg</p>${extraLotText}`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Confirmar',
        cancelButtonText: 'Cancelar'
      });
      if (!confirm.isConfirmed) return;
      const applied = await registerDispatchExpiredResolution({
        recipeId,
        lotNumber: normalizeValue(expiredLot.lotNumber),
        productionId: normalizeValue(expiredLot.productionId),
        qtyKg: Number(expiredLot.availableKg || 0),
        expiryDate: normalizeValue(expiredLot.expiryDate),
        resolutionType: actionType === 'decommissioned' ? 'decommissioned' : 'retail_sale',
        dispatchDate
      });
      if (!applied) return;
      const qtyRequested = Number(line.qtyKg || 0);
      const nextAlloc = allocateDispatchLots(recipeId, qtyRequested);
      const stillExpired = getDispatchExpiredLots(nextAlloc.allocations, dispatchDate).length > 0;
      if (!nextAlloc.hasStock || stillExpired) {
        state.dispatchDraft.lines = state.dispatchDraft.lines.filter((_, rowIdx) => rowIdx !== idx);
      }
      if (!state.dispatchDraft.lines.length) {
        state.dispatchDraft.lines.push({ id: makeId('dispatch_row'), recipeId: '', recipeSearch: '', qtyKg: '', allocations: [] });
      }
      await persistRepartoStore();
      renderDispatchCreate(state.dispatchDraft);
      return;
    }
    if (event.target.closest('#dispatchSaveBtn')) {
      const draft = state.dispatchDraft;
      draft.dispatchDate = normalizeValue(nodes.dispatchView.querySelector('#dispatchDateInput')?.value) || toIsoDate();
      draft.clientId = normalizeValue(nodes.dispatchView.querySelector('#dispatchClientId')?.value);
      draft.clientName = normalizeValue(nodes.dispatchView.querySelector('#dispatchClientInput')?.value);
      draft.vehicleId = normalizeValue(nodes.dispatchView.querySelector('#dispatchVehicleSelect')?.value);
      draft.clientAddress = normalizeValue(nodes.dispatchView.querySelector('#dispatchClientAddressInput')?.value);
      draft.clientCity = normalizeValue(nodes.dispatchView.querySelector('#dispatchClientCityInput')?.value);
      draft.clientProvince = normalizeValue(nodes.dispatchView.querySelector('#dispatchClientProvinceInput')?.value) || 'Santa Fe';
      draft.clientCountry = normalizeValue(nodes.dispatchView.querySelector('#dispatchClientCountryInput')?.value) || 'Argentina';
      draft.managers = [...nodes.dispatchView.querySelectorAll('[data-dispatch-manager]:checked')].map((n) => normalizeValue(n.dataset.dispatchManager || n.value)).filter(Boolean);
      draft.comments = [...nodes.dispatchView.querySelectorAll('[data-dispatch-comment]')].map((n) => normalizeValue(n.value)).filter(Boolean);
      draft.proofs = Array.isArray(draft.proofs) ? draft.proofs.filter((item) => normalizeValue(item?.url)) : [];
      if (!draft.clientId) {
        await openIosSwal({ title: 'Cliente requerido', html: '<p>Seleccioná o creá un cliente.</p>', icon: 'warning' });
        return;
      }
      if (!draft.vehicleId) {
        await openIosSwal({ title: 'Vehículo requerido', html: '<p>Seleccioná o creá una UTA/URA.</p>', icon: 'warning' });
        return;
      }
      if (!draft.managers.length) {
        await openIosSwal({ title: 'Responsable requerido', html: '<p>Seleccioná al menos un responsable.</p>', icon: 'warning' });
        return;
      }
      if (!draft.lines.some((line) => normalizeValue(line.recipeId) && Number(line.qtyKg || 0) > 0)) {
        await openIosSwal({ title: 'Sin productos', html: '<p>Agregá al menos un producto para repartir.</p>', icon: 'warning' });
        return;
      }
      const normalizedProducts = [];
      for (const line of draft.lines) {
        const recipeId = normalizeValue(line.recipeId);
        const qtyKg = Number(line.qtyKg || 0);
        if (!recipeId) {
          await openIosSwal({ title: 'Producto incompleto', html: '<p>Seleccioná un producto válido en todas las filas cargadas.</p>', icon: 'warning' });
          return;
        }
        if (qtyKg <= 0) {
          await openIosSwal({ title: 'Cantidad inválida', html: '<p>Completá kilos mayores a 0 para cada fila.</p>', icon: 'warning' });
          return;
        }
        const recipe = safeObject(state.recetas[recipeId]);
        const allocated = allocateDispatchLots(recipeId, qtyKg);
        const expiredForDate = getDispatchExpiredLots(allocated.allocations, draft.dispatchDate);
        if (expiredForDate.length) {
          await openIosSwal({
            title: 'Lote vencido detectado',
            html: `<p>${escapeHtml(capitalize(recipe.title || 'Receta'))} tiene lote vencido para la fecha ${escapeHtml(formatIsoEs(draft.dispatchDate || ''))}.</p><small>Resolvé la fila en rojo (Venta en Sucursal/Decomisado) o cambiá la fecha de reparto.</small>`,
            icon: 'warning'
          });
          return;
        }
        if (!allocated.hasStock) {
          await openIosSwal({ title: 'Stock insuficiente', html: `<p>${escapeHtml(capitalize(recipe.title || 'Receta'))}: faltan ${allocated.missingKg.toFixed(2)} kg.</p>`, icon: 'warning' });
          return;
        }
        normalizedProducts.push({
          recipeId,
          recipeTitle: normalizeValue(recipe.title),
          recipeImageUrl: normalizeValue(recipe.imageUrl),
          qtyKg: Number(qtyKg.toFixed(3)),
          allocations: allocated.allocations
        });
      }
      const selectedClient = getDispatchClient(draft.clientId);
      const selectedVehicle = getDispatchVehicle(draft.vehicleId);
      const managerSummary = draft.managers.map((token) => {
        const manager = getManagerDisplay(token);
        return `${escapeHtml(manager.name)} (${escapeHtml(manager.role)})`;
      }).join('<br>');
      const productsSummaryRows = normalizedProducts.map((item) => `<li><strong>${escapeHtml(item.recipeTitle || 'Producto')}</strong>: ${Number(item.qtyKg || 0).toFixed(2)} kg</li>`).join('');
      const confirmSaveDispatch = await openIosSwal({
        title: 'Confirmar reparto final',
        html: `<div class="text-start produccion-confirm-summary produccion-confirm-card"><div class="produccion-confirm-head"><span class="produccion-confirm-icon"><i class="bi bi-truck"></i></span><div><p class="produccion-confirm-kicker">Validación final</p><p class="produccion-confirm-note">Se descontará stock de productos al guardar el reparto.</p></div></div><p><strong><i class="bi bi-calendar-event"></i> Fecha:</strong> <span>${escapeHtml(formatIsoEs(draft.dispatchDate || ''))}</span></p><p><strong><i class="fa-solid fa-user"></i> Cliente:</strong> <span>${escapeHtml(draft.clientName || selectedClient.name || '-')}</span></p><p><strong><i class="fa-solid fa-truck"></i> UTA/URA:</strong> <span>${escapeHtml(formatDispatchVehicleLabel(selectedVehicle))}</span></p><p><strong><i class="bi bi-people"></i> Responsables:</strong><br>${managerSummary || '-'}</p><p><strong><i class="bi bi-box-seam"></i> Productos:</strong></p><ul>${productsSummaryRows}</ul></div>`,
        showCancelButton: true,
        confirmButtonText: 'Guardar reparto',
        cancelButtonText: 'Cancelar',
        customClass: { popup: 'produccion-confirm-alert', confirmButton: 'ios-btn ios-btn-success', cancelButton: 'ios-btn ios-btn-secondary' }
      });
      if (!confirmSaveDispatch.isConfirmed) return;
      Swal.fire({
        title: 'Guardando reparto...',
        html: '<div class="informes-saving-spinner"><img src="./IMG/Meta-ai-logo.webp" alt="Guardando reparto" class="meta-spinner-login"></div>',
        allowOutsideClick: false,
        showConfirmButton: false,
        customClass: {
          popup: 'ios-alert produccion-loading-alert',
          title: 'ios-alert-title',
          htmlContainer: 'ios-alert-text'
        }
      });
      try {
      const dayToken = formatIsoToDmyCompact(draft.dispatchDate);
      const seq = Number(state.reparto.sequenceByDate?.[dayToken] || 0) + 1;
      state.reparto.sequenceByDate[dayToken] = seq;
      const code = `REP-LJ-${dayToken}-${String(seq).padStart(3, '0')}`;
      const repartoId = makeId('reparto');
      state.reparto.registros[repartoId] = {
        id: repartoId,
        code,
        dispatchDate: draft.dispatchDate,
        clientId: draft.clientId,
        vehicleId: draft.vehicleId,
        managers: draft.managers,
        managerProfiles: draft.managers.map((token) => {
          const manager = getManagerDisplay(token);
          return { id: token, name: manager.name, role: manager.role };
        }),
        comments: draft.comments,
        proofs: draft.proofs,
        clientSnapshot: {
          id: draft.clientId,
          name: draft.clientName,
          doc: normalizeValue(getDispatchClient(draft.clientId)?.doc),
          address: draft.clientAddress,
          city: draft.clientCity,
          province: draft.clientProvince,
          country: draft.clientCountry
        },
        products: normalizedProducts,
        createdAt: nowTs(),
        createdBy: getCurrentUserLabel()
      };
      normalizedProducts.forEach((product) => {
        appendRecipeMovement(product.recipeId, {
          id: `egr_${repartoId}_${product.recipeId}`,
          type: 'egreso',
          qtyKg: Number(product.qtyKg || 0),
          at: nowTs(),
          sourceId: repartoId,
          sourceCode: code,
          label: 'Reparto guardado',
          date: draft.dispatchDate
        });
      });
      const persistResult = await Promise.race([
        persistRepartoStore().then(() => 'ok').catch(() => 'error'),
        new Promise((resolve) => setTimeout(() => resolve('timeout'), 10000))
      ]);
      if (persistResult !== 'ok') {
        throw new Error(`persist_reparto_${persistResult}`);
      }
      state.dispatchDraft = null;
      renderDispatchMain();
      refreshData({ silent: true }).then(() => {
        if (state.dispatchMode && !state.dispatchCreateMode) renderDispatchMain();
      }).catch((error) => {
        console.warn('[produccion] refreshData post-dispatch failed', error);
      });
      Swal.close();
      await openIosSwal({ title: 'Reparto guardado', html: `<p>Código generado: <strong>${code}</strong></p>`, icon: 'success' });
      } catch (error) {
        Swal.close();
        await openIosSwal({ title: 'No se pudo guardar', html: '<p>Ocurrió un error al guardar el reparto. Intentá nuevamente.</p>', icon: 'error' });
      }
      return;
    }
    if (event.target.closest('#produccionDispatchApplyBtn')) {
      state.dispatchSearch = normalizeValue(nodes.dispatchView.querySelector('#produccionDispatchSearch')?.value);
      state.dispatchRange = normalizeValue(state.dispatchRange || nodes.dispatchView.querySelector('#produccionDispatchRange')?.value);
      state.dispatchPage = 1;
      renderDispatchHistoryTable();
      nodes.dispatchView.querySelector('#produccionDispatchClearBtn')?.classList.toggle('d-none', !(state.dispatchRange || state.dispatchSearch));
      return;
    }
    if (event.target.closest('#produccionDispatchClearBtn')) {
      state.dispatchSearch = '';
      state.dispatchRange = '';
      const rangeInput = nodes.dispatchView.querySelector('#produccionDispatchRange');
      if (rangeInput) rangeInput.value = '';
      const searchInput = nodes.dispatchView.querySelector('#produccionDispatchSearch');
      if (searchInput) searchInput.value = '';
      state.dispatchPage = 1;
      renderDispatchMain();
      return;
    }
    if (event.target.closest('#produccionDispatchPrintBtn')) {
      const rows = getDispatchRows();
      if (!rows.length) {
        await openIosSwal({ title: 'Sin datos', html: '<p>No hay repartos para imprimir.</p>', icon: 'info' });
        return;
      }
      const askDetail = await openIosSwal({
        title: 'Incluir Desglose',
        html: '<p>¿Querés incluir los datos colapsados de Repartos donde ves el detalle de productos?</p>',
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
      if (!askDetail.isConfirmed && !askDetail.isDenied) return;
      const includeDetail = askDetail.isConfirmed;
      const win = window.open('', '_blank', 'width=1280,height=920');
      if (!win) return;
      win.document.write('<html><head><title>Cargando impresión...</title></head><body style="font-family:Inter,Arial,sans-serif;padding:16px;color:#223457;">Preparando impresión de repartos...</body></html>');
      win.document.close();
      const imageUrls = rows.flatMap((row) => {
        const products = Array.isArray(row.products) ? row.products : [];
        return products.map((item) => sanitizeImageUrl(item.recipeImageUrl || state.recetas?.[item.recipeId]?.imageUrl)).filter(Boolean);
      });
      await preloadPrintImages(imageUrls);
      const body = rows.flatMap((row, index) => {
        const client = { ...getDispatchClient(row.clientId), ...safeObject(row.clientSnapshot) };
        const products = Array.isArray(row.products) ? row.products : [];
        const kg = products.reduce((acc, p) => acc + Number(p.qtyKg || 0), 0);
        const expiries = [...new Set(products.flatMap((item) => (Array.isArray(item.allocations) ? item.allocations : []).map((l) => normalizeValue(l.expiryDate)).filter(Boolean)))];
        const expiryLabel = expiries.length === 1 ? formatIsoEs(expiries[0]) : (expiries.length ? 'Ver detalle' : '-');
        const customerDoc = normalizeValue(client.doc || client.dni || client.cuit || client.cuil || client.document || client.taxId);
        const locationParts = [client.address, client.city, client.province, client.country].map((item) => normalizeValue(item)).filter(Boolean);
        const locationText = `${locationParts.join(' • ')}${customerDoc ? ` • ${customerDoc}` : ''}`;
        const repartoHead = `<tr class="is-dispatch-head-row"><td colspan="6"><div class="dispatch-print-head"><span class="dispatch-print-truck">🚚</span><div><h3>${escapeHtml(row.code || '-')}</h3><p>${escapeHtml(locationText)}</p></div></div></td></tr>`;
        const summary = `<tr class="inventario-row-tone ${index % 2 === 0 ? 'is-even-row' : 'is-odd-row'}"><td>${escapeHtml(formatDateTime(row.createdAt))}</td><td>${products.length === 1 ? '1 producto' : `${products.length} productos`}</td><td>${kg.toFixed(2)} kg</td><td>${escapeHtml(expiryLabel)}</td><td>${escapeHtml(row.code || '-')}</td><td>${escapeHtml(client.name || '-')}</td></tr>`;
        if (!includeDetail) return [repartoHead, summary];
        const detailRows = products.flatMap((item) => {
          const imageUrl = sanitizeImageUrl(item.recipeImageUrl || state.recetas?.[item.recipeId]?.imageUrl);
          const allocations = Array.isArray(item.allocations) && item.allocations.length
            ? item.allocations
            : [{ lotNumber: '-', qtyKg: item.qtyKg, expiryDate: '', productionId: '' }];
          return allocations.map((allocation) => `<tr class="is-dispatch-trace-row"><td>↳ <span style="display:inline-flex;align-items:center;gap:8px;">${imageUrl ? `<img src="${escapeHtml(imageUrl)}" style="width:22px;height:22px;border-radius:999px;object-fit:cover;border:1px solid #d7def2;">` : ''}<span>${escapeHtml(item.recipeTitle || '-')}</span></span></td><td>${Number(allocation.qtyKg || 0).toFixed(2)} kg</td><td>${escapeHtml(allocation.lotNumber || '-')} · ${Number(getRegistroById(allocation.productionId)?.quantityKg || allocation.qtyKg || 0).toFixed(2)} kg</td><td>${escapeHtml(formatIsoEs(allocation.expiryDate || '')) || '-'}</td><td>${normalizeValue(allocation.productionId) ? 'Trazabilidad' : 'Sin trazabilidad'}</td><td>${escapeHtml(client.name || '-')}</td></tr>`);
        });
        const locationRow = locationText
          ? `<tr class="is-dispatch-internal-row"><td colspan="6">🏠 ${escapeHtml(locationText)}</td></tr>`
          : '';
        return [repartoHead, summary, ...detailRows, locationRow].filter(Boolean);
      }).join('');
      win.document.write(`<html><head><title>Repartos</title><style>body{font-family:Inter,Arial,sans-serif;padding:12px;color:#223457}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{border:1px solid #d5def2;padding:8px;font-size:11px;vertical-align:top;word-break:break-word}th{background:#eef3ff;font-size:10px;text-transform:uppercase;letter-spacing:.03em}.is-dispatch-head-row td{background:#fff}.dispatch-print-head{display:flex;align-items:center;gap:10px}.dispatch-print-head h3{margin:0;font-size:26px;line-height:1.1;color:#1f2a44}.dispatch-print-head p{margin:2px 0 0;color:#6d7ca3;font-size:18px}.dispatch-print-truck{width:48px;height:48px;border-radius:999px;border:1px solid #d7def2;display:inline-flex;align-items:center;justify-content:center;background:#fff;font-size:24px}.is-dispatch-trace-row td{background:#ffecef;color:#1f2a44}.is-dispatch-internal-row td{background:#fff2e3;color:#1f2a44;font-weight:400;text-align:center}</style></head><body><h2>Salida de Productos</h2><table><thead><tr><th>Fecha</th><th>Productos</th><th>Cantidad</th><th>Vencimiento</th><th>Número de reparto</th><th>Cliente</th></tr></thead><tbody>${body || '<tr><td colspan="6">Sin datos</td></tr>'}</tbody></table></body></html>`);
      win.document.close();
      win.focus();
      await waitPrintAssets(win);
      win.print();
      return;
    }
    if (event.target.closest('#produccionDispatchExcelBtn')) {
      const headers = ['Fecha', 'Productos', 'Cantidad (kg)', 'Vencimiento', 'Número de reparto', 'Cliente'];
      const rows = getDispatchRows().flatMap((row) => {
        const products = Array.isArray(row.products) ? row.products : [];
        const kgTotal = products.reduce((acc, item) => acc + Number(item.qtyKg || 0), 0);
        const expiries = [...new Set(products.flatMap((item) => (Array.isArray(item.allocations) ? item.allocations : []).map((l) => normalizeValue(l.expiryDate)).filter(Boolean)))];
        const expiryLabel = expiries.length === 1 ? formatIsoEs(expiries[0]) : (expiries.length ? 'Ver detalle' : '-');
        const client = { ...getDispatchClient(row.clientId), ...safeObject(row.clientSnapshot) };
        const summary = {
          Fecha: formatDateTime(row.createdAt),
          Productos: `${products.length} ${products.length === 1 ? 'producto' : 'productos'}`,
          'Cantidad (kg)': `${kgTotal.toFixed(2)} kg`,
          Vencimiento: expiryLabel,
          'Número de reparto': row.code || row.id || '-',
          Cliente: client.name || '-'
        };
        const detailRows = products.flatMap((item) => {
          const allocations = Array.isArray(item.allocations) && item.allocations.length
            ? item.allocations
            : [{ lotNumber: '-', qtyKg: item.qtyKg, expiryDate: '', productionId: '' }];
          return allocations.map((allocation) => ({
            Fecha: `↳ ${item.recipeTitle || '-'}`,
            Productos: `${Number(allocation.qtyKg || 0).toFixed(2)} kg`,
            'Cantidad (kg)': `${allocation.lotNumber || '-'} · ${Number(getRegistroById(allocation.productionId)?.quantityKg || allocation.qtyKg || 0).toFixed(2)} kg`,
            Vencimiento: formatIsoEs(allocation.expiryDate || '') || '-',
            'Número de reparto': normalizeValue(allocation.productionId) ? 'Trazabilidad' : 'Sin trazabilidad',
            Cliente: client.name || '-',
            __tone: 'trace'
          }));
        });
        const locationParts = [client.address, client.city, client.province, client.country].map((item) => normalizeValue(item)).filter(Boolean);
        const customerDoc = normalizeValue(client.doc || client.dni || client.cuit || client.cuil || client.document || client.taxId);
        const locationMeta = [normalizeValue(client.name), customerDoc].filter(Boolean).join(' · ');
        const locationRow = (locationParts.length || locationMeta)
          ? [{
            Fecha: `↳ 🏠 ${locationParts.join(' • ')}${locationMeta ? ` • ${locationMeta}` : ''}`,
            Productos: '',
            'Cantidad (kg)': '',
            Vencimiento: '',
            'Número de reparto': '',
            Cliente: '',
            __tone: 'internal_use',
            __mergeAcross: true
          }]
          : [];
        return [summary, ...detailRows, ...locationRow];
      });
      if (!rows.length) {
        await openIosSwal({ title: 'Sin datos', html: '<p>No hay repartos para exportar.</p>', icon: 'info' });
        return;
      }
      await exportStyledExcel({ fileName: `repartos_periodo_${Date.now()}.xlsx`, sheetName: 'Repartos', headers, rows });
      return;
    }
    if (event.target.closest('#produccionDispatchMassBtn')) {
      await openMassDispatchPlanillasByPeriod();
      return;
    }
    if (event.target.closest('#produccionDispatchExpandBtn')) {
      const rows = getDispatchRows();
      await openIosSwal({
        title: 'Salida de Productos · Vista ampliada',
        width: '92vw',
        html: '<div id="dispatchExpandedWrap"></div>',
        confirmButtonText: 'Cerrar',
        didOpen: (popup) => {
          const pageSize = 8;
          let expandedPage = 1;
          const renderExpanded = () => {
            const pages = Math.max(1, Math.ceil(rows.length / pageSize));
            expandedPage = Math.min(Math.max(1, expandedPage), pages);
            const start = (expandedPage - 1) * pageSize;
            const slice = rows.slice(start, start + pageSize);
            const canCollapseRows = slice.some((row) => state.dispatchCollapse[row.id] === false);
            const canExpandRows = slice.some((row) => state.dispatchCollapse[row.id] !== false);
            const body = slice.map((row, index) => {
              const products = Array.isArray(row.products) ? row.products : [];
              const kg = products.reduce((acc, p) => acc + Number(p.qtyKg || 0), 0);
              const expiries = [...new Set(products.flatMap((item) => (Array.isArray(item.allocations) ? item.allocations : []).map((l) => normalizeValue(l.expiryDate)).filter(Boolean)))];
              const expiryLabel = expiries.length === 1 ? formatIsoEs(expiries[0]) : (expiries.length ? 'Ver detalle' : '-');
              const client = { ...getDispatchClient(row.clientId), ...safeObject(row.clientSnapshot) };
              const collapsed = state.dispatchCollapse[row.id] !== false;
              const detail = !collapsed ? products.flatMap((item) => {
                const allocations = Array.isArray(item.allocations) && item.allocations.length ? item.allocations : [{ lotNumber: '-', qtyKg: item.qtyKg, expiryDate: '', productionId: '' }];
                return allocations.map((allocation) => {
                  const traceBtn = normalizeValue(allocation.productionId)
                    ? `<button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-prod-trace="${escapeHtml(allocation.productionId)}"><img src="./IMG/family-tree-icon-no-bg.svg" alt="" style="width:14px;height:14px"><span>Trazabilidad</span></button>`
                    : '<span class="inventario-internal-no-trace">Sin trazabilidad</span>';
                  const imageUrl = sanitizeImageUrl(item.recipeImageUrl || state.recetas?.[item.recipeId]?.imageUrl);
                  return `<tr class="inventario-trace-row"><td><div class="inventario-trace-main"><img src="./IMG/Octicons-git-merge.svg" alt="merge" class="inventario-trace-icon"><span class="inventario-trace-avatar">${imageUrl ? `<span class="thumb-loading"><img class="meta-spinner-login" src="./IMG/Meta-ai-logo.webp" alt="Cargando"></span><img class="thumb-image js-produccion-thumb" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(item.recipeTitle)}">` : '<i class="fa-solid fa-drumstick-bite"></i>'}</span><span class="inventario-trace-label">${escapeHtml(item.recipeTitle || '-')} ${Number(allocation.qtyKg || 0).toFixed(2)} kg</span></div></td><td>${Number(allocation.qtyKg || 0).toFixed(2)} kg</td><td>${escapeHtml(allocation.lotNumber || '-')} · ${Number(getRegistroById(allocation.productionId)?.quantityKg || allocation.qtyKg || 0).toFixed(2)} kg</td><td>${escapeHtml(formatIsoEs(allocation.expiryDate || '')) || '-'}</td><td>${traceBtn}</td><td>${escapeHtml(client.name || '-')}</td><td>-</td><td>-</td></tr>`;
                });
              }).join('') : '';
              const locationParts = [client.address, client.city, client.province, client.country].map((item) => normalizeValue(item)).filter(Boolean);
              const customerDoc = normalizeValue(client.doc || client.dni || client.cuit || client.cuil || client.document || client.taxId);
              const locationMeta = [normalizeValue(client.name), customerDoc].filter(Boolean).join(' · ');
              const locationRow = !collapsed && (locationParts.length || locationMeta)
                ? `<tr class="inventario-internal-use-row"><td colspan="8"><i class="fa-solid fa-house"></i> ${escapeHtml(locationParts.join(' • '))}${locationMeta ? ` • ${escapeHtml(locationMeta)}` : ''}</td></tr>`
                : '';
              return `<tr class="inventario-row-tone ${index % 2 === 0 ? 'is-even-row' : 'is-odd-row'}"><td><div class="d-flex align-items-center gap-2">${products.length ? `<button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-dispatch-expanded-collapse="${escapeHtml(row.id)}"><i class="fa-solid ${collapsed ? 'fa-expand' : 'fa-compress'}"></i></button>` : ''}<span>${escapeHtml(formatDateTime(row.createdAt))}</span></div></td><td>${products.length === 1 ? '1 producto' : `${products.length} productos`}</td><td>${kg.toFixed(2)} kg</td><td>${escapeHtml(expiryLabel)}</td><td>${escapeHtml(row.code || '-')}</td><td>${escapeHtml(client.name || '-')}</td><td><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-dispatch-planilla="${escapeHtml(row.id)}"><i class="fa-regular fa-file-lines"></i><span>Planilla</span></button></td><td><button type="button" class="btn ios-btn ios-btn-danger inventario-threshold-btn" data-dispatch-delete="${escapeHtml(row.id)}"><i class="fa-solid fa-trash"></i><span>Eliminar</span></button></td></tr>${detail}${locationRow}`;
            }).join('') || '<tr><td colspan="8">Sin datos.</td></tr>';
            popup.querySelector('#dispatchExpandedWrap').innerHTML = `<div class="inventario-print-row mb-2 inventario-trace-toolbar toolbar-scroll-x"><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-dispatch-expanded-collapse-all ${canCollapseRows ? '' : 'disabled'}><i class="fa-solid fa-compress"></i><span>Colapsar</span></button><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-dispatch-expanded-expand-all ${canExpandRows ? '' : 'disabled'}><i class="fa-solid fa-expand"></i><span>Descolapsar</span></button></div><div class="table-responsive inventario-table-compact-wrap"><table class="table recipe-table inventario-table-compact mb-0 produccion-dispatch-table-center"><thead><tr><th>Fecha de reparto</th><th>Productos</th><th>Cantidad</th><th>Vencimiento</th><th>Número de reparto</th><th>Cliente</th><th>Planilla</th><th>Acciones</th></tr></thead><tbody>${body}</tbody></table></div><div class="inventario-pagination enhanced"><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn inventario-page-btn" data-dispatch-expanded-page="prev" ${expandedPage <= 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-left"></i></button><span>Página ${expandedPage} de ${pages}</span><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn inventario-page-btn" data-dispatch-expanded-page="next" ${expandedPage >= pages ? 'disabled' : ''}><i class="fa-solid fa-chevron-right"></i></button></div>`;
            prepareThumbLoaders('.js-produccion-thumb');
          };
          renderExpanded();
          popup.addEventListener('click', async (expandedEvent) => {
            const toggleBtn = expandedEvent.target.closest('[data-dispatch-expanded-collapse]');
            if (toggleBtn) {
              const id = toggleBtn.dataset.dispatchExpandedCollapse;
              const collapsed = state.dispatchCollapse[id] !== false;
              state.dispatchCollapse[id] = collapsed ? false : true;
              renderExpanded();
              renderDispatchHistoryTable();
              return;
            }
            if (expandedEvent.target.closest('[data-dispatch-expanded-collapse-all]')) {
              rows.forEach((row) => { state.dispatchCollapse[row.id] = true; });
              renderExpanded();
              renderDispatchHistoryTable();
              return;
            }
            if (expandedEvent.target.closest('[data-dispatch-expanded-expand-all]')) {
              rows.forEach((row) => { state.dispatchCollapse[row.id] = false; });
              renderExpanded();
              renderDispatchHistoryTable();
              return;
            }
            const pageBtn = expandedEvent.target.closest('[data-dispatch-expanded-page]');
            if (pageBtn) {
              expandedPage += pageBtn.dataset.dispatchExpandedPage === 'next' ? 1 : -1;
              renderExpanded();
              return;
            }
            const traceBtn = expandedEvent.target.closest('[data-prod-trace]');
            if (traceBtn) {
              const reg = getRegistroById(traceBtn.dataset.prodTrace);
              if (reg) await openTraceability(reg);
              return;
            }
            const dispatchPlanillaBtn = expandedEvent.target.closest('[data-dispatch-planilla]');
            if (dispatchPlanillaBtn) {
              const dispatchRow = getDispatchRecordById(dispatchPlanillaBtn.dataset.dispatchPlanilla);
              if (dispatchRow.id) await openDispatchPlanilla(dispatchRow);
              return;
            }
            const dispatchDeleteBtn = expandedEvent.target.closest('[data-dispatch-delete]');
            if (dispatchDeleteBtn) {
              const dispatchRow = getDispatchRecordById(dispatchDeleteBtn.dataset.dispatchDelete);
              if (dispatchRow.id) await deleteDispatchRecord(dispatchRow);
            }
          });
        }
      });
      return;
    }
    const collapseBtn = event.target.closest('[data-dispatch-collapse]');
    if (collapseBtn) {
      const id = collapseBtn.dataset.dispatchCollapse;
      const collapsed = state.dispatchCollapse[id] !== false;
      state.dispatchCollapse[id] = collapsed ? false : true;
      renderDispatchHistoryTable();
      return;
    }
    const pageBtn = event.target.closest('[data-dispatch-page]');
    if (pageBtn) {
      state.dispatchPage += pageBtn.dataset.dispatchPage === 'next' ? 1 : -1;
      renderDispatchHistoryTable();
      return;
    }
    if (event.target.closest('#inventarioGlobalCollapseAllRowsBtn')) {
      getDispatchRows().forEach((row) => { state.dispatchCollapse[row.id] = true; });
      renderDispatchHistoryTable();
      return;
    }
    if (event.target.closest('#inventarioGlobalExpandAllRowsBtn')) {
      getDispatchRows().forEach((row) => { state.dispatchCollapse[row.id] = false; });
      renderDispatchHistoryTable();
      return;
    }
    const traceBtn = event.target.closest('[data-prod-trace]');
    if (traceBtn) {
      const reg = getRegistroById(traceBtn.dataset.prodTrace);
      if (reg) await openTraceability(reg);
      return;
    }
    const dispatchPlanillaBtn = event.target.closest('[data-dispatch-planilla]');
    if (dispatchPlanillaBtn) {
      const dispatchRow = getDispatchRecordById(dispatchPlanillaBtn.dataset.dispatchPlanilla);
      if (dispatchRow.id) await openDispatchPlanilla(dispatchRow);
      return;
    }
    const dispatchDeleteBtn = event.target.closest('[data-dispatch-delete]');
    if (dispatchDeleteBtn) {
      const dispatchRow = getDispatchRecordById(dispatchDeleteBtn.dataset.dispatchDelete);
      if (dispatchRow.id) await deleteDispatchRecord(dispatchRow);
      return;
    }
  });

  nodes.dispatchView?.addEventListener('change', async (event) => {
    if (!state.dispatchCreateMode || !state.dispatchDraft) return;
    if (event.target.matches('#dispatchDateInput')) {
      state.dispatchDraft.dispatchDate = normalizeValue(event.target.value) || toIsoDate();
      renderDispatchCreate(state.dispatchDraft);
      return;
    }
    const proofInput = event.target.closest('[data-dispatch-proof-file]');
    if (proofInput) {
      const idx = Number(proofInput.dataset.dispatchProofFile);
      const file = proofInput.files?.[0];
      if (!file) return;
      const validType = [...ALLOWED_UPLOAD_TYPES, 'application/pdf'].includes(file.type);
      if (!validType) {
        await openIosSwal({ title: 'Adjunto inválido', html: '<p>Adjuntá imagen o PDF.</p>', icon: 'warning' });
        return;
      }
      if (file.size > MAX_UPLOAD_SIZE_BYTES) {
        await openIosSwal({ title: 'Archivo muy grande', html: '<p>Máximo permitido: 5MB.</p>', icon: 'warning' });
        return;
      }
      const uploaded = await uploadImageToStorage(file, 'reparto/comprobantes');
      if (!Array.isArray(state.dispatchDraft.proofs)) state.dispatchDraft.proofs = [];
      state.dispatchDraft.proofs[idx] = { name: file.name, url: uploaded };
      renderDispatchCreate(state.dispatchDraft);
      return;
    }
    const qtyInput = event.target.closest('[data-dispatch-qty]');
    if (qtyInput) {
      const idx = Number(qtyInput.dataset.dispatchQty);
      state.dispatchDraft.lines[idx].qtyKg = normalizeValue(qtyInput.value);
      renderDispatchCreate(state.dispatchDraft);
      return;
    }
    if (event.target.matches('#dispatchClientProvinceInput')) {
      state.dispatchDraft.clientProvince = normalizeValue(event.target.value) || 'Santa Fe';
      return;
    }
  });

  let dispatchClientSuggestEl = null;
  let dispatchProductSuggestEl = null;
  let dispatchVehicleSuggestEl = null;
  const closeDispatchSuggests = () => {
    dispatchClientSuggestEl?.remove();
    dispatchProductSuggestEl?.remove();
    dispatchVehicleSuggestEl?.remove();
    dispatchClientSuggestEl = null;
    dispatchProductSuggestEl = null;
    dispatchVehicleSuggestEl = null;
  };
  const ensureFloatingSuggest = (type) => {
    const current = type === 'client'
      ? dispatchClientSuggestEl
      : (type === 'product' ? dispatchProductSuggestEl : dispatchVehicleSuggestEl);
    if (current) return current;
    const node = document.createElement('div');
    node.className = 'recipe-suggest-floating produccion-dispatch-floating-suggest';
    node.dataset.dispatchSuggest = type;
    document.body.appendChild(node);
    if (type === 'client') dispatchClientSuggestEl = node;
    else if (type === 'product') dispatchProductSuggestEl = node;
    else dispatchVehicleSuggestEl = node;
    return node;
  };
  const positionFloatingSuggest = (node, anchor) => {
    if (!node || !anchor) return;
    const rect = anchor.getBoundingClientRect();
    node.style.position = 'absolute';
    node.style.left = `${rect.left + window.scrollX}px`;
    node.style.top = `${rect.bottom + window.scrollY + 4}px`;
    const maxWidth = Math.min(window.innerWidth - 24, 560);
    node.style.width = `${Math.min(Math.max(rect.width, 300), maxWidth)}px`;
    node.style.zIndex = '3300';
  };

  const showDispatchVehicleSuggestions = (vehicleInput) => {
    if (!state.dispatchDraft || !vehicleInput) return;
    const query = normalizeLower(vehicleInput.value);
    state.dispatchDraft.vehicleSearch = normalizeValue(vehicleInput.value);
    state.dispatchDraft.vehicleId = '';
    const hidden = nodes.dispatchView?.querySelector('#dispatchVehicleSelect');
    if (hidden) hidden.value = '';
    const list = Object.values(safeObject(state.reparto.vehicles || {}))
      .filter((item) => item.enabled !== false)
      .filter((item) => {
        const hay = normalizeLower(`${item.number || ''} ${item.patent || ''} ${item.brand || ''} ${item.type || ''}`);
        return hay.includes(query);
      })
      .slice(0, 8);
    const suggest = ensureFloatingSuggest('vehicle');
    positionFloatingSuggest(suggest, vehicleInput);
    suggest.innerHTML = `${list.map((item) => {
      const meta = getDispatchVehicleExpiryMeta(item);
      return `<button type="button" class="recipe-suggest-item" data-dispatch-vehicle-pick="${escapeHtml(item.id)}"><span class="dispatch-vehicle-tone tone-${meta.tone}"></span><span><strong>${escapeHtml(item.number || item.id)}</strong><br><small>${escapeHtml(formatDispatchVehicleLabel(item))}</small></span></button>`;
    }).join('')}${query ? `<button type="button" class="recipe-suggest-item recipe-suggest-create" data-dispatch-vehicle-create="1"><i class="fa-solid fa-plus"></i><span>Nueva unidad</span></button>` : ''}`;
    suggest.onclick = async (ev) => {
      const pick = ev.target.closest('[data-dispatch-vehicle-pick]');
      if (pick) {
        const vehicle = getDispatchVehicle(pick.dataset.dispatchVehiclePick);
        if (!vehicle.id) return;
        state.dispatchDraft.vehicleId = vehicle.id;
        state.dispatchDraft.vehicleSearch = formatDispatchVehicleLabel(vehicle);
        vehicleInput.value = state.dispatchDraft.vehicleSearch;
        if (hidden) hidden.value = vehicle.id;
        closeDispatchSuggests();
        return;
      }
      if (ev.target.closest('[data-dispatch-vehicle-create]')) {
        closeDispatchSuggests();
        const created = await openCreateDispatchVehicle();
        if (created) {
          state.dispatchDraft.vehicleId = created.id;
          state.dispatchDraft.vehicleSearch = formatDispatchVehicleLabel(created);
          renderDispatchCreate(state.dispatchDraft);
        }
      }
    };
  };

  const showDispatchProductSuggestions = (productInput) => {
    if (!state.dispatchDraft || !productInput) return;
    const idx = Number(productInput.dataset.dispatchProductSearch);
    if (!Number.isFinite(idx) || !state.dispatchDraft.lines?.[idx]) return;
    const query = normalizeLower(productInput.value);
    state.dispatchDraft.lines[idx].recipeSearch = normalizeValue(productInput.value);
    state.dispatchDraft.lines[idx].recipeId = '';
    const suggest = ensureFloatingSuggest('product');
    positionFloatingSuggest(suggest, productInput);
    const recipes = Object.values(state.recetas)
      .filter((item) => !query || normalizeLower(item.title).includes(query))
      .slice(0, 8)
      .map((item) => ({ ...item, meta: getProducedStockMeta(item.id) }));
    suggest.innerHTML = `${recipes.map((item) => `<button type="button" class="recipe-suggest-item" data-dispatch-product-pick="${escapeHtml(item.id)}" data-dispatch-row="${idx}"><span class="recipe-suggest-avatar-wrap">${sanitizeImageUrl(item.imageUrl) ? `<span class="thumb-loading"><img class="meta-spinner-login" src="./IMG/Meta-ai-logo.webp" alt="Cargando"></span><img class="recipe-suggest-avatar js-dispatch-suggest-thumb" src="${escapeHtml(sanitizeImageUrl(item.imageUrl))}" alt="${escapeHtml(item.title)}">` : '<span class="image-placeholder-circle-2 dispatch-product-placeholder"><i class="fa-solid fa-drumstick-bite dispatch-product-table-icon dispatch-product-row-icon"></i></span>'}</span><span><strong>${escapeHtml(capitalize(item.title || 'Receta'))}</strong><br><small class="${item.meta.available > 0.0001 ? 'produccion-dispatch-ok' : 'text-danger'}">${item.meta.available > 0.0001 ? `Disponible: ${item.meta.available.toFixed(2)} kg` : 'Sin stock disponible'}</small></span></button>`).join('')}`;
    prepareThumbLoaders('.js-dispatch-suggest-thumb');
    suggest.onclick = (ev) => {
      const pick = ev.target.closest('[data-dispatch-product-pick]');
      if (!pick) return;
      const rowIdx = Number(pick.dataset.dispatchRow);
      const rec = safeObject(state.recetas[pick.dataset.dispatchProductPick]);
      state.dispatchDraft.lines[rowIdx].recipeId = normalizeValue(rec.id);
      state.dispatchDraft.lines[rowIdx].recipeSearch = normalizeValue(capitalize(rec.title || ''));
      closeDispatchSuggests();
      renderDispatchCreate(state.dispatchDraft);
    };
  };

  nodes.dispatchView?.addEventListener('input', async (event) => {
    if (!state.dispatchCreateMode || !state.dispatchDraft) return;
    const clientInput = event.target.closest('#dispatchClientInput');
    if (clientInput) {
      const query = normalizeLower(clientInput.value);
      state.dispatchDraft.clientName = normalizeValue(clientInput.value);
      state.dispatchDraft.clientId = '';
      state.dispatchDraft.clientAddress = '';
      state.dispatchDraft.clientCity = '';
      state.dispatchDraft.clientProvince = 'Santa Fe';
      state.dispatchDraft.clientCountry = 'Argentina';
      nodes.dispatchView.querySelector('#dispatchClientId').value = '';
      const list = Object.values(safeObject(state.reparto.clients))
        .filter((item) => normalizeLower(item.name).includes(query) || normalizeLower(item.doc).includes(query))
        .slice(0, 8);
      const suggest = ensureFloatingSuggest('client');
      positionFloatingSuggest(suggest, clientInput);
      suggest.innerHTML = `${list.map((item) => `<button type="button" class="recipe-suggest-item" data-dispatch-client-pick="${escapeHtml(item.id)}"><span class="user-avatar-thumb dispatch-client-suggest-avatar">${escapeHtml(item.initials || 'U')}</span><span>${escapeHtml(item.name)}<br><small>${escapeHtml(item.doc || '-')}</small></span></button>`).join('')}${query ? `<button type="button" class="recipe-suggest-item recipe-suggest-create" data-dispatch-client-create="1"><i class="fa-solid fa-plus"></i><span>Nuevo Cliente</span></button>` : ''}`;
      suggest.onclick = async (ev) => {
        const pick = ev.target.closest('[data-dispatch-client-pick]');
        if (pick) {
          const client = getDispatchClient(pick.dataset.dispatchClientPick);
          if (!client.id) return;
          state.dispatchDraft.clientId = client.id;
          state.dispatchDraft.clientName = client.name;
          state.dispatchDraft.clientAddress = normalizeValue(client.address);
          state.dispatchDraft.clientCity = normalizeValue(client.city);
          state.dispatchDraft.clientProvince = normalizeValue(client.province) || 'Santa Fe';
          state.dispatchDraft.clientCountry = normalizeValue(client.country) || 'Argentina';
          nodes.dispatchView.querySelector('#dispatchClientInput').value = client.name;
          nodes.dispatchView.querySelector('#dispatchClientId').value = client.id;
          closeDispatchSuggests();
          renderDispatchCreate(state.dispatchDraft);
          return;
        }
        if (ev.target.closest('[data-dispatch-client-create]')) {
          closeDispatchSuggests();
          const created = await openCreateDispatchClient('');
          if (created) {
            state.dispatchDraft.clientId = created.id;
            state.dispatchDraft.clientName = created.name;
            state.dispatchDraft.clientAddress = normalizeValue(created.address);
            state.dispatchDraft.clientCity = normalizeValue(created.city);
            state.dispatchDraft.clientProvince = normalizeValue(created.province) || 'Santa Fe';
            state.dispatchDraft.clientCountry = normalizeValue(created.country) || 'Argentina';
            renderDispatchCreate(state.dispatchDraft);
          }
        }
      };
      return;
    }
    const addressInput = event.target.closest('#dispatchClientAddressInput');
    if (addressInput) { state.dispatchDraft.clientAddress = normalizeValue(addressInput.value); return; }
    const cityInput = event.target.closest('#dispatchClientCityInput');
    if (cityInput) { state.dispatchDraft.clientCity = normalizeValue(cityInput.value); return; }
    const countryInput = event.target.closest('#dispatchClientCountryInput');
    if (countryInput) { state.dispatchDraft.clientCountry = normalizeValue(countryInput.value); return; }

    const managersSearchInput = event.target.closest('#dispatchManagersSearch');
    if (managersSearchInput) {
      state.dispatchDraft.managerSearch = normalizeValue(managersSearchInput.value);
      const query = normalizeLower(managersSearchInput.value);
      nodes.dispatchView.querySelectorAll('.produccion-user-check[data-user-search]').forEach((row) => {
        const hay = normalizeLower(row.dataset.userSearch || '');
        row.classList.toggle('d-none', !!query && !hay.includes(query));
      });
      return;
    }

    const vehicleInput = event.target.closest('#dispatchVehicleInput');
    if (vehicleInput) {
      showDispatchVehicleSuggestions(vehicleInput);
      return;
    }

    const productInput = event.target.closest('[data-dispatch-product-search]');
    if (!productInput) return;
    showDispatchProductSuggestions(productInput);
  });

  document.addEventListener('click', (event) => {
    if (!state.dispatchCreateMode) return;
    if (event.target.closest('.produccion-dispatch-floating-suggest')) return;
    if (event.target.closest('#dispatchClientInput')) return;
    if (event.target.closest('#dispatchVehicleInput')) return;
    if (event.target.closest('[data-dispatch-product-search]')) return;
    closeDispatchSuggests();
  });

  nodes.historyTableWrap?.addEventListener('click', async (event) => {
    if (event.target.closest('#produccionHistoryCollapseAllRowsBtn')) {
      getHistoryRows().forEach((item) => {
        if (getTraceRowsFromRegistro(item).length) state.historyTraceCollapse[item.id] = true;
      });
      renderHistoryTable();
      return;
    }
    if (event.target.closest('#produccionHistoryExpandAllRowsBtn')) {
      getHistoryRows().forEach((item) => {
        if (getTraceRowsFromRegistro(item).length) state.historyTraceCollapse[item.id] = false;
      });
      renderHistoryTable();
      return;
    }
    const pageBtn = event.target.closest('[data-prod-page]');
    if (pageBtn) {
      state.historyPage += pageBtn.dataset.prodPage === 'next' ? 1 : -1;
      renderHistoryTable();
      return;
    }
    const getRegistro = (key) => state.registros[key];
    const planillaBtn = event.target.closest('[data-prod-planilla]');
    if (planillaBtn) {
      const reg = getRegistro(planillaBtn.dataset.prodPlanilla);
      if (reg) await window.laJamoneraPlanillaProduccion?.openByRegistro?.(reg, { companyLogoUrl: normalizeValue(state.config.companyLogoUrl), usersMap: safeObject(state.users) });
      return;
    }
    const qrPrintBtn = event.target.closest('[data-prod-qr-print]');
    if (qrPrintBtn) {
      const reg = getRegistro(qrPrintBtn.dataset.prodQrPrint);
      if (reg) await openProductionQrPrintConfigurator(reg);
      return;
    }
    const traceBtn = event.target.closest('[data-prod-trace]');
    if (traceBtn) {
      const reg = getRegistroById(traceBtn.dataset.prodTrace);
      if (reg) await openTraceability(reg);
      return;
    }
    const dispatchPlanillaBtn = event.target.closest('[data-dispatch-planilla]');
    if (dispatchPlanillaBtn) {
      const dispatchRow = getDispatchRecordById(dispatchPlanillaBtn.dataset.dispatchPlanilla);
      if (dispatchRow.id) await openDispatchPlanilla(dispatchRow);
      return;
    }
    const dispatchDeleteBtn = event.target.closest('[data-dispatch-delete]');
    if (dispatchDeleteBtn) {
      const dispatchRow = getDispatchRecordById(dispatchDeleteBtn.dataset.dispatchDelete);
      if (dispatchRow.id) await deleteDispatchRecord(dispatchRow);
      return;
    }
    const traceImageBtn = event.target.closest('[data-prod-trace-images]');
    if (traceImageBtn) {
      const urls = JSON.parse(decodeURIComponent(traceImageBtn.dataset.prodTraceImages || '[]'));
      if (Array.isArray(urls) && urls.length && typeof window.laJamoneraOpenImageViewer === 'function') {
        await window.laJamoneraOpenImageViewer([{ invoiceImageUrls: urls }], 0, 'Adjuntos de lote');
      }
      return;
    }
    const collapseBtn = event.target.closest('[data-prod-collapse]');
    if (collapseBtn) {
      const prodId = collapseBtn.dataset.prodCollapse;
      state.historyTraceCollapse[prodId] = !state.historyTraceCollapse[prodId];
      renderHistoryTable();
      return;
    }
    const printBtn = event.target.closest('[data-prod-print]');
    if (printBtn) {
      const reg = getRegistro(printBtn.dataset.prodPrint);
      if (reg) await printReport(reg);
      return;
    }
    const cancelBtn = event.target.closest('[data-prod-cancel]');
    if (cancelBtn) {
      const reg = getRegistro(cancelBtn.dataset.prodCancel);
      if (reg) await cancelProduction(reg);
    }
  });
  window.laJamoneraProduccionAPI = {
    getRegistroById: async (productionId) => {
      const id = normalizeValue(productionId);
      if (!id) return null;
      if (!state.registros[id]) await refreshData();
      return state.registros[id] || null;
    },
    openTraceabilityById: async (productionId) => {
      const id = normalizeValue(productionId);
      if (!id) return;
      if (!state.registros[id]) {
        await refreshData();
      }
      const reg = state.registros[id];
      if (!reg) {
        await openIosSwal({ title: 'Sin datos', html: '<p>No se encontró la producción solicitada.</p>', icon: 'warning', confirmButtonText: 'Entendido' });
        return;
      }
      await openTraceability(reg);
    }
  };
  produccionModal.addEventListener('show.bs.modal', async () => {
    try {
      await refreshData();
      state.historyTraceCollapse = {};
      setHistoryMode(false);
      renderList();
      renderModalRneBadge();
      alignScrollActionsToRight(document);
      if (window.flatpickr && nodes.historyRange) {
        const locale = window.flatpickr.l10ns?.es || undefined;
        const dayMap = getProductionDayMap();
        disableCalendarSuggestions(nodes.historyRange);
        window.flatpickr(nodes.historyRange, {
          locale,
          mode: 'range',
          dateFormat: 'Y-m-d',
          allowInput: false,
          defaultDate: normalizeValue(state.historyRange).split(' a ').filter(Boolean),
          onDayCreate: (_dObj, _dStr, _fp, dayElem) => {
            const date = dayElem.dateObj ? getArgentinaIsoDate(dayElem.dateObj) : '';
            const count = dayMap[date];
            if (count) {
              const bubble = document.createElement('span');
              bubble.className = 'inventario-day-kg';
              bubble.textContent = `${count} prod.`;
              dayElem.appendChild(bubble);
            }
          },
          onClose: (_selectedDates, _dateStr, instance) => {
            const from = instance.selectedDates[0] ? getArgentinaIsoDate(instance.selectedDates[0]) : '';
            const to = instance.selectedDates[1] ? getArgentinaIsoDate(instance.selectedDates[1]) : '';
            nodes.historyRange.value = from && to ? `${from} a ${to}` : from;
          }
        });
      }
    } catch (error) {
      nodes.empty.querySelector('.ingredientes-empty-text').textContent = 'No se pudo cargar producción desde Firebase.';
      setStateView('empty');
    }
  });
  produccionModal.addEventListener('hidden.bs.modal', async () => {
    if (state.activeRecipeId) {
      await saveEditorDraft();
    }
    state.activeRecipeId = '';
    state.activeDraftId = '';
    state.activeReservationId = '';
    state.pendingExpiryActions = {};
    nodes.search.value = '';
    state.search = '';
    nodes.editor.innerHTML = '';
    state.historySearch = '';
    state.historyRange = '';
    state.historyPage = 1;
    if (nodes.historySearch) nodes.historySearch.value = '';
    if (nodes.historyRange) nodes.historyRange.value = '';
    setHistoryMode(false);
    setDispatchMode(false);
    state.dispatchCreateMode = false;
    state.dispatchDraft = null;
    state.dispatchRange = '';
    state.dispatchSearch = '';
    state.dispatchCollapse = {};
    state.dispatchPage = 1;
    if (nodes.dispatchView) nodes.dispatchView.innerHTML = '';
    if (state.reservationTick) {
      clearInterval(state.reservationTick);
      state.reservationTick = null;
    }
    if (state.draftsTick) {
      clearInterval(state.draftsTick);
      state.draftsTick = null;
    }
  });
})();
