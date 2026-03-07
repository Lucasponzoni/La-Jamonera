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
    historyRange: document.getElementById('produccionGlobalRange'),
    historyApplyBtn: document.getElementById('produccionGlobalApplyBtn'),
    historyClearBtn: document.getElementById('produccionGlobalClearBtn'),
    historyExpandBtn: document.getElementById('produccionGlobalExpandBtn'),
    historyExcelBtn: document.getElementById('produccionGlobalExcelBtn'),
    historyPrintBtn: document.getElementById('produccionGlobalPrintBtn'),
    historyLoading: document.getElementById('produccionGlobalLoading'),
    historyTableWrap: document.getElementById('produccionGlobalTableWrap'),
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
  const AUDIT_PATH = '/produccion/auditoria';
  const RESERVE_TTL_MS = 10 * 60 * 1000;
  const ALLOWED_UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const ALLOWED_RNE_UPLOAD_TYPES = [...ALLOWED_UPLOAD_TYPES, 'application/pdf'];
  const MAX_UPLOAD_SIZE_BYTES = 5 * 1024 * 1024;
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
    historyRange: '',
    historyPage: 1,
    historyTraceCollapse: {},
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
  const COMPANY_LEGAL_NAME = 'FRIGORIFICO LA JAMONERA SA';
  const getProvidersCatalog = () => (Array.isArray(state.inventario?.config?.providers) ? state.inventario.config.providers : []);
  const normalizeRneRecord = (source = {}) => ({
    number: normalizeValue(source?.number),
    expiryDate: normalizeValue(source?.expiryDate),
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
  const capitalize = (value) => normalizeLower(value).replace(/(^|\s)\S/g, (ch) => ch.toUpperCase());
  const parseNumber = (value) => {
    const parsed = Number(normalizeValue(value).replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : Number.NaN;
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
      mg: 0.001, miligramo: 0.001, miligramos: 0.001
    };
    const volumeMap = {
      l: 1000, lt: 1000, litro: 1000, litros: 1000,
      ml: 1, mililitro: 1, mililitros: 1, cc: 1
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
  const getPublicTraceUrlForProduction = (productionId) => `https://lucasponzoni.github.io/La-Jamonera/${encodeURIComponent(normalizeValue(productionId))}`;
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
  const deepClone = (value) => JSON.parse(JSON.stringify(value || {}));
  const getRegistrosList = () => Object.values(safeObject(state.registros));
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
  const applyPlanOnInventory = (inventorySource, plan, productionId, productionDate, mode = 'consume') => {
    const inventoryNext = safeObject(inventorySource);
    plan.ingredientPlans.forEach((item) => {
      const record = safeObject(inventoryNext.items?.[item.ingredientId]);
      const nextEntries = Array.isArray(record.entries) ? [...record.entries] : [];
      item.lots.forEach((lot) => {
        const index = nextEntries.findIndex((entry) => entry.id === lot.entryId);
        if (index === -1) return;
        const entry = { ...nextEntries[index] };
        const currentAvailableQty = getEntryAvailableQty(entry);
        const amountInEntryUnit = fromBase(lot.takeBaseQty, entry.unit || lot.unit);
        const safeAmount = Number.isFinite(amountInEntryUnit) ? amountInEntryUnit : 0;
        const sign = mode === 'consume' ? -1 : 1;
        const nextAvailableQty = Math.max(0, Number((currentAvailableQty + (sign * safeAmount)).toFixed(4)));
        const nextAvailableKg = Number((toBase(nextAvailableQty, entry.unit || lot.unit) / 1000).toFixed(4));
        entry.availableQty = Number(nextAvailableQty.toFixed(4));
        entry.availableKg = nextAvailableKg;
        entry.lotStatus = nextAvailableQty <= 0 ? 'consumido_en_produccion' : 'disponible';
        entry.productionUsage = Array.isArray(entry.productionUsage) ? [...entry.productionUsage] : [];
        if (mode === 'restore') {
          entry.productionUsage = entry.productionUsage.filter((usage) => normalizeValue(usage?.productionId) !== normalizeValue(productionId));
        } else {
          entry.productionUsage.unshift({
            id: makeId('usage'),
            productionId,
            producedAt: nowTs(),
            productionDate,
            expiryDateAtProduction: normalizeValue(entry.expiryDate),
            kilosUsed: Number((Number(lot.takeBaseQty || 0) / 1000).toFixed(4)),
            lotNumber: normalizeValue(entry.lotNumber) || normalizeValue(entry.invoiceNumber) || entry.id,
            ingredientLot: normalizeValue(entry.lotNumber) || normalizeValue(entry.invoiceNumber) || entry.id,
            ingredientEntryId: entry.id,
            ingredientId: item.ingredientId
          });
        }
        const moveType = mode === 'consume' ? 'consumo_produccion' : 'reversion_produccion';
        nextEntries[index] = updateEntryMovement(entry, {
          type: moveType,
          productionId,
          qty: Number(safeAmount.toFixed(4)),
          qtyUnit: entry.unit || lot.unit,
          createdAt: nowTs(),
          productionDate,
          user: getCurrentUserLabel(),
          reference: productionId,
          observation: mode === 'consume' ? 'Consumo FEFO en producción' : 'Restitución por anulación/edición'
        });
      });
      const stockKg = nextEntries.reduce((acc, entry) => acc + getEntryAvailableKg(entry), 0);
      inventoryNext.items[item.ingredientId] = {
        ...record,
        entries: nextEntries,
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
  const renderUserAvatar = (user) => {
    if (normalizeValue(user?.photoUrl)) {
      return `<span class="user-avatar-thumb"><span class="thumb-loading"><img class="meta-spinner-login" src="./IMG/Meta-ai-logo.webp" alt="Cargando"></span><img class="thumb-image js-produccion-user-photo" src="${user.photoUrl}" alt="${normalizeValue(user.fullName || user.email || 'Usuario')}"></span>`;
    }
    const initials = initialsFromName(user?.fullName || user?.email || '');
    return `<span class="user-avatar-thumb user-avatar-initials">${initials || '<i class="bi bi-person-fill"></i>'}</span>`;
  };
  const prepareThumbLoaders = (selector) => {
    const list = Array.from(document.querySelectorAll(selector));
    list.forEach((img) => {
      const parent = img.closest('.user-avatar-thumb, .receta-thumb-wrap, .produccion-hero-avatar, .inventario-trace-avatar');
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
  const openIosSwal = (options) => Swal.fire({
    ...options,
    returnFocus: false,
    customClass: {
      popup: `ios-alert ${options?.customClass?.popup || ''}`.trim(),
      title: 'ios-alert-title',
      htmlContainer: 'ios-alert-text',
      confirmButton: 'ios-btn ios-btn-primary',
      cancelButton: 'ios-btn ios-btn-secondary',
      denyButton: 'ios-btn ios-btn-warning',
      ...options.customClass
    },
    buttonsStyling: false
  });
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
      const tone = data.__tone === 'trace' ? 'FFFFECEF' : data.__tone === 'resolution_yellow' ? 'FFFFF6D9' : (index % 2 === 0 ? 'FFF5F8FF' : 'FFEAF1FF');
      row.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: tone } };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFD8E2F5' } },
          left: { style: 'thin', color: { argb: 'FFD8E2F5' } },
          bottom: { style: 'thin', color: { argb: 'FFD8E2F5' } },
          right: { style: 'thin', color: { argb: 'FFD8E2F5' } }
        };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        if (data.__tone === 'trace') {
          cell.font = { color: { argb: 'FFB42338' }, bold: true };
        }
      });
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
      const expiryIso = normalizeValue(entry.expiryDate);
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
      const expiryIso = normalizeValue(entry.expiryDate);
      if (!expiryIso || expiryIso >= productionDateIso) return acc;
      const availableKg = getEntryAvailableKg(entry);
      if (!Number.isFinite(availableKg) || availableKg <= 0.0001) return acc;
      return acc + availableKg;
    }, 0);
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
      if (availability.incompatibleUnits.length) {
        errors.push(`Esta receta contiene unidades incompatibles para cálculo automático. Revisá ${capitalize(row.ingredientName)}.`);
      }
      requirements.push({
        ingredientId: row.ingredientId,
        name: capitalize(row.ingredientName || state.ingredientes[row.ingredientId]?.name || 'Ingrediente'),
        unit,
        neededPerKg,
        available: availability.available,
        coverage,
        missingForMin: Math.max(0, (neededPerKg * minKg) - availability.available),
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
    const maxKg = Math.max(0, minCoverage);
    const readyCount = requirements.filter((item) => item.missingForMin <= 0.0001).length;
    const progress = Math.max(0, Math.min(100, (readyCount / Math.max(requirements.length, 1)) * 100));
    const canProduce = maxKg >= minKg;
    const missingForMin = requirements.filter((item) => item.missingForMin > 0.0001);
    const hasExpired = requirements.some((item) => item.hasExpired);
    let status = 'danger';
    let statusText = 'Faltan insumos';
    if (canProduce) {
      status = 'success';
      statusText = 'Disponible';
    } else if (progress >= 50) {
      status = 'warning';
      statusText = 'Stock parcial';
    }
    const expiredKg = getRecipeExpiredKg(recipe, productionDateIso);
    return { status, statusText, maxKg, progress, canProduce, errors, requirements, missingForMin, hasExpired, minKg, expiredKg };
  };
  const sortEntriesFEFO = (entries = []) => [...entries].sort((a, b) => {
    const expiryA = normalizeValue(a.expiryDate) || '9999-12-31';
    const expiryB = normalizeValue(b.expiryDate) || '9999-12-31';
    if (expiryA !== expiryB) return expiryA.localeCompare(expiryB);
    return Number(a.createdAt || 0) - Number(b.createdAt || 0);
  });
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
        const expiryIso = normalizeValue(entry.expiryDate);
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
            expiryDate: expiryIso,
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
          expiryDate: expiryIso,
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
    Object.values(safeObject(next.items)).forEach((record) => {
      const entries = Array.isArray(record.entries) ? record.entries : [];
      entries.forEach((entry) => {
        const action = pending[normalizeValue(entry.id)];
        if (!action) return;
        const availableKg = Number(entry.availableKg);
        const availableQty = Number(entry.availableQty);
        const qtyKg = Math.max(0, Math.min(Number(action.qtyKg || 0), Number.isFinite(availableKg) ? availableKg : 0));
        if (qtyKg <= 0) return;
        const ratio = Number.isFinite(availableKg) && availableKg > 0 ? (qtyKg / availableKg) : 1;
        const qtyDiscount = Number.isFinite(availableQty) ? (availableQty * ratio) : 0;
        entry.availableKg = Number(Math.max(0, (Number.isFinite(availableKg) ? availableKg : 0) - qtyKg).toFixed(4));
        entry.availableQty = Number(Math.max(0, (Number.isFinite(availableQty) ? availableQty : 0) - qtyDiscount).toFixed(4));
        entry.expiryResolutions = Array.isArray(entry.expiryResolutions) ? entry.expiryResolutions : [];
        entry.expiryResolutions.unshift({ id: makeId('expiry_resolution'), createdAt: nowTs(), type: action.type, qtyKg: Number(qtyKg.toFixed(4)) });
        if (entry.availableKg <= 0.0001) {
          entry.expiryResolutionStatus = action.type;
          entry.status = action.type;
        }
      });
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
          state.config.rne = { ...safeObject(state.config.rne), number: '', expiryDate: '', attachmentUrl: '', attachmentType: '', validFrom: '', updatedAt: 0 };
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
        const rneExpiryDate = normalizeValue(document.getElementById('produccionRneExpiryInput')?.value);

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
    const fromTs = from ? new Date(`${from}T00:00:00`).getTime() : 0;
    const toTs = to ? new Date(`${to}T23:59:59`).getTime() : 0;
    return getRegistrosList()
      .filter((item) => {
        const createdAt = Number(item?.createdAt || 0);
        if (fromTs && createdAt < fromTs) return false;
        if (toTs && createdAt > toTs) return false;
        return true;
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
      amount: `${Number(lot?.takeQty || 0).toFixed(2)} ${lot?.unit || ingredientPlan?.unit || ''}`.trim(),
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
        <td>${escapeHtml(lot.expiryDate || '-')}</td>
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
    const totalIngredientsKg = ingredients.reduce((sum, item) => sum + Number(item.requiredQty || item.neededQty || 0), 0);
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
      const lot = Array.isArray(item?.lots) && item.lots[0] ? item.lots[0] : {};
      const nodeId = safeNodeId(`ING_${index + 1}_${item?.ingredientId || ''}`, `ING_${index + 1}`);
      const rneId = `${nodeId}_RNE`;
      const nodeLabel = [
        `<b>${index + 1}. ${esc((item?.ingredientName || 'Ingrediente').toUpperCase())}</b>`,
        `<b>Usado:</b> ${esc(formatCompactQty(item?.requiredQty ?? item?.neededQty, item?.unit || item?.ingredientUnit || ''))}`,
        `<b>Lote:</b> ${esc(lot?.lotNumber || lot?.entryId || '-')}`,
        `<b>VTO lote:</b> ${esc(formatIsoEs(lot?.expiryDate) || '-')}`,
        `<b>Proveedor:</b> ${esc(lot?.provider || '-')}`
      ].join('<br/>');
      const providerRne = resolveProviderRneFromLot(lot);
      lines.push(`${nodeId}["${nodeLabel}"]:::toneIngredient`);
      lines.push(`${rneId}["<b>RNE PROVEEDOR</b><br/>${esc(providerRne.number || '-')}"]:::toneRegistry`);
      lines.push(`I --> ${nodeId}`);
      lines.push(`${nodeId} -.-> ${rneId}`);
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
    const totalIngredientsKg = ingredients.reduce((sum, item) => sum + Number(item.requiredQty || item.neededQty || 0), 0);
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
            <div class="produccion-trace-mermaid" data-trace-mermaid></div>
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
      host.innerHTML = rendered.svg;
      host.dataset.traceScale = '1';
      host.style.transformOrigin = 'top left';
      host.style.transform = 'scale(1)';
      return;
    } catch (primaryError) {
      host.innerHTML = `<pre class="mermaid">${source}</pre>`;
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
        initTraceMermaidZoomControls(popup);
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
          <td><span class="produccion-trace-expiry">${escapeHtml(formatIsoEs(trace.expiryDate))} (VTO)</span></td>
          <td><span class="produccion-trace-badge">Trazabilidad</span></td>
          <td>${trace.invoiceImageUrls.length ? `<button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-prod-trace-images="${encodeURIComponent(JSON.stringify(trace.invoiceImageUrls))}"><i class="fa-regular fa-image"></i><span>Adjunto (${trace.invoiceImageUrls.length})</span></button>` : '<button type="button" class="btn ios-btn ios-btn-danger inventario-no-photo-btn" disabled>Sin adjuntos</button>'}</td>
        </tr>`).join('') : '';
      return `<tr class="inventario-row-tone ${index % 2 === 0 ? 'is-even-row' : 'is-odd-row'}">
        <td><div class="d-flex align-items-center gap-2">${traceRows.length ? `<button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-prod-collapse="${escapeHtml(item.id)}" title="${isCollapsed ? 'Descolapsar' : 'Colapsar'}" aria-label="${isCollapsed ? 'Descolapsar' : 'Colapsar'}"><i class="fa-solid ${isCollapsed ? 'fa-expand' : 'fa-compress'}"></i></button>` : ''}<span>${escapeHtml(item.id)}</span></div></td>
        <td>${escapeHtml(formatDateTime(item.createdAt))}</td>
        <td>${escapeHtml(item.recipeTitle || '-')}</td>
        <td>${Number(item.quantityKg || 0).toFixed(2)} kg</td>
        <td><span class="produccion-responsable-wrap"><strong>${escapeHtml(manager.name)}</strong><small>${escapeHtml(manager.role)}</small></span></td>
        <td class="produccion-vto-cell">${escapeHtml(formatProductExpiryLabel(item))}</td>
        <td><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-prod-trace="${item.id}"><img src="./IMG/family-tree-icon-no-bg.svg" alt="" style="width:14px;height:14px"><span>Trazabilidad</span></button></td>
        <td><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-prod-planilla="${escapeHtml(item.id)}" ${planillaDisabled}><i class="fa-regular fa-file-lines"></i><span>Planilla</span></button></td>
        <td>${traceRows.some((trace) => trace.invoiceImageUrls.length) ? `<button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-prod-trace-images='${encodeURIComponent(JSON.stringify(traceRows.flatMap((trace) => trace.invoiceImageUrls)))}'><i class="fa-regular fa-image"></i><span>Ver adjuntos</span></button>` : '<button type="button" class="btn ios-btn ios-btn-danger inventario-no-photo-btn" disabled>Sin adjuntos</button>'}</td>
      </tr>${traceHtml}`;
    }).join('') : '<tr><td colspan="9" class="text-center">Sin producciones en ese rango.</td></tr>';
    nodes.historyTableWrap.innerHTML = `
      <div class="inventario-print-row mb-2 inventario-trace-toolbar toolbar-scroll-x">
        <button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" id="produccionHistoryCollapseAllRowsBtn" ${canCollapseRows ? '' : 'disabled'}><i class="fa-solid fa-compress"></i><span>Colapsar</span></button>
        <button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" id="produccionHistoryExpandAllRowsBtn" ${canExpandRows ? '' : 'disabled'}><i class="fa-solid fa-expand"></i><span>Descolapsar</span></button>
      </div>
      <div class="table-responsive inventario-global-table inventario-table-compact-wrap">
        <table class="table recipe-table inventario-table-compact mb-0">
          <thead><tr><th>ID producción</th><th>Fecha y hora</th><th>Producto</th><th>Fabricado (KG.)</th><th>Responsable</th><th>VTO producto</th><th>Trazabilidad</th><th>Planilla</th><th>Adjuntos</th></tr></thead>
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
    nodes.search?.closest('.produccion-toolbar')?.classList.toggle('d-none', enabled);
    nodes.rneAlert?.classList.toggle('d-none', enabled || !getRneExpiryMeta().visible);
    nodes.list?.classList.toggle('d-none', enabled);
    nodes.historyView?.classList.toggle('d-none', !enabled);
  };
  const openHistory = async () => {
    state.historyPage = 1;
    if (nodes.historyRange) nodes.historyRange.value = state.historyRange;
    nodes.historyClearBtn?.classList.toggle('d-none', !state.historyRange);
    setHistoryMode(true);
    renderHistoryTable();
  };
  const cancelProduction = async (registro) => {
    if (registro.status === 'anulada') {
      await openIosSwal({ title: 'Ya anulada', html: '<p>La producción ya estaba anulada.</p>', icon: 'info', confirmButtonText: 'Entendido' });
      return;
    }
    const auth = await askSensitivePassword('Anular producción', '<p>Se restituirá stock al inventario.</p>', true);
    if (!auth.isConfirmed) return;
    const latestInventory = safeObject(await window.dbLaJamoneraRest.read('/inventario'));
    const restored = applyPlanOnInventory(latestInventory, { ingredientPlans: registro.lots || [] }, registro.id, registro.productionDate, 'restore');
    const registros = deepClone(state.registros);
    const previous = deepClone(registros[registro.id]);
    registros[registro.id] = { ...registro, status: 'anulada', canceledAt: nowTs(), canceledBy: getCurrentUserLabel(), cancelReason: auth.value.reason };
    await window.dbLaJamoneraRest.write('/inventario', restored);
    await window.dbLaJamoneraRest.write(REGISTROS_PATH, registros);
    await appendAudit({ action: 'produccion_anulada', productionId: registro.id, before: previous, after: registros[registro.id], reason: auth.value.reason });
    state.inventario = restored;
    state.registros = registros;
    renderHistoryTable();
    await openIosSwal({ title: 'Producción anulada', html: `<p>Se anuló ${registro.id} y se restituyó el stock.</p>`, icon: 'success', confirmButtonText: 'Entendido' });
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
    registros[registro.id] = {
      ...registro,
      quantityKg: Number(form.value.qty.toFixed(2)),
      productionDate: form.value.date || toIsoDate(),
      observations: form.value.obs,
      lots: plan.ingredientPlans,
      agingDaysAtProduction,
      packagingDate,
      editedAt: nowTs(),
      editedBy: getCurrentUserLabel(),
      editReason: auth.value.reason
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
    const expiryIso = normalizeValue(state.config?.rne?.expiryDate);
    if (!expiryIso) return { visible: false, days: null, tone: 'none', text: '', hasAttachment };
    const expiryTs = new Date(`${expiryIso}T00:00:00`).getTime();
    if (!Number.isFinite(expiryTs)) return { visible: false, days: null, tone: 'none', text: '', hasAttachment };
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = Math.ceil((expiryTs - today.getTime()) / (1000 * 60 * 60 * 24));
    const tone = days < 0 ? 'danger' : days < 60 ? 'danger' : days < 180 ? 'warning' : 'ok';
    const text = days < 0
      ? `El RNE de la Jamonera venció hace ${Math.abs(days)} días (${formatIsoEs(expiryIso)}).`
      : `El RNE de la Jamonera vence en ${days} días (${formatIsoEs(expiryIso)}).`;
    const visible = tone === 'warning' || tone === 'danger';
    return { visible, days, tone, text, hasAttachment };
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
    if (meta.days != null) {
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
          <span class="produccion-check-item ${item.missingForMin <= 0.0001 ? 'is-ok' : 'is-missing'}">
            <i class="fa-solid ${item.missingForMin <= 0.0001 ? 'fa-circle-check' : 'fa-circle-xmark'}"></i>
            <span>${item.name}</span>
          </span>`).join('')}
        </div>`;
    };
    const cardsHtml = list.map((recipe) => {
      const analysis = state.analysis[recipe.id] || analyzeRecipe(recipe);
      const draftLock = getRecipeDraftLockInfo(recipe.id);
      const statusClass = analysis.status === 'success' ? 'tone-success' : analysis.status === 'warning' ? 'tone-warning' : 'tone-danger';
      const action = `<button type="button" class="btn ios-btn ios-btn-success produccion-main-btn ${analysis.canProduce ? '' : 'is-disabled'}" data-open-produccion="${recipe.id}" ${analysis.canProduce ? '' : 'disabled'}><i class="bi bi-plus-lg"></i><span>Producir</span></button>`;
      const inventoryAction = analysis.canProduce
        ? ''
        : `<button type="button" class="btn ios-btn inventory-production-action-btn is-inventory" data-open-inventario="1"><i class="fa-solid fa-boxes-stacked"></i><span>Inventario</span></button>`;
      const viewAction = `<button type="button" class="btn ios-btn ios-btn-secondary produccion-visualizar-btn" data-open-produccion="${recipe.id}"><i class="fa-regular fa-eye"></i><span>Visualizar</span></button>`;
      const foreignDraft = getForeignDraftConflict(recipe.id);
      const badges = [
        analysis.missingForMin.length ? '<span class="produccion-badge">Faltan insumos</span>' : '',
        analysis.status === 'warning' ? '<span class="produccion-badge is-warning">Stock parcial</span>' : '',
        analysis.hasExpired ? '<span class="produccion-badge is-danger">Posee lotes expirados</span>' : '',
        foreignDraft ? '<span class="produccion-badge is-warning">Borrador en uso</span>' : ''
      ].filter(Boolean).join('');
      const missingHtml = analysis.missingForMin.length
        ? `<div class="produccion-missing-list">${analysis.missingForMin.map((item) => `<p><strong>${item.name}:</strong> disponible ${formatQty(item.available, item.unit)} / faltan ${formatQty(item.missingForMin, item.unit)}</p>`).join('')}</div>`
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
              <span class="produccion-chip ${statusClass}"><span class="produccion-semaforo"></span>${analysis.statusText}</span>
            </div>
            <div class="produccion-stats-line">
              <div class="produccion-stat-block">
                <small>Máximo producible</small>
                <strong>${analysis.maxKg.toFixed(2)} kg</strong>
              </div>
              <div class="produccion-stat-sep" aria-hidden="true"></div>
              <div class="produccion-stat-block">
                <small>Mínimo</small>
                <strong>${analysis.minKg.toFixed(2)} kg</strong>
              </div>
            </div>
            ${Number(analysis.expiredKg || 0) > 0.0001 ? `<p class="produccion-last-line produccion-last-line-expired"><i class="fa-solid fa-triangle-exclamation"></i> <strong>Kilos expirados:</strong> <strong>${Number(analysis.expiredKg || 0).toFixed(2)} kg</strong></p>` : ''}
            ${draftLock?.blockedKg > 0 ? `<p class="produccion-last-line"><i class="fa-solid fa-lock"></i> Bloqueado por borrador: <strong>${draftLock.blockedKg.toFixed(2)} kg</strong> · disponible en <strong>${formatCountdown(draftLock.remainingMs)}</strong></p>` : ''}
            <p class="produccion-last-line"><i class="fa-regular fa-clock"></i> Última producción: <strong>${formatDate(lastProductionAt)}</strong></p>
            <div class="produccion-progress-wrap">
              <div class="produccion-progress-bar"><span class="${analysis.status === 'danger' ? 'is-danger' : analysis.progress >= 100 ? 'is-success' : 'is-warning'}" style="width:${analysis.progress.toFixed(1)}%"></span></div>
              <small>Cobertura del mínimo: ${analysis.progress.toFixed(0)}%</small>
            </div>
            ${buildCoverageChecksHtml(analysis)}
            <div class="produccion-badges">${badges}</div>
            ${analysis.errors.length ? `<p class="produccion-error">${analysis.errors[0]}</p>` : missingHtml}
            <div class="produccion-actions-row inventory-production-actions">
              ${action.replace('produccion-main-btn', 'produccion-main-btn inventory-production-action-btn is-main')}
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
      if (hasExpiredDraft) {
        await cleanupExpiredDrafts();
        recomputeAnalysis();
        renderList();
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
            <div><strong>Vence:</strong> ${lot.expiryDate || '-'} ${getExpiryBadge(lot.expiryDate)}</div>
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
    const initialQty = ownDraft ? parsePositive(ownDraft.quantityKg, analysis.minKg) : Math.max(analysis.minKg, 0.1);
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
          <p class="produccion-max-line">Máximo según inventario: <strong>${analysis.maxKg.toFixed(2)} kg</strong></p>
          <p id="produccionReservaTimer" class="produccion-reserva-timer"></p>
        </div>
      </section>
      <section class="recipe-step-card step-block">
        <h6 class="step-title"><span class="recipe-step-number">1</span> ¿Qué cantidad deseás producir?</h6>
        <div class="produccion-qty-grid">
          <input id="produccionQtyInput" type="number" min="0.1" step="0.01" max="${analysis.maxKg.toFixed(2)}" value="${initialQty.toFixed(2)}" class="form-control ios-input">
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
      const ingredientImages = ask.isConfirmed
        ? rows.flatMap((item) => getTraceRowsFromRegistro(item).map((trace) => trace.ingredientImageUrl).filter(Boolean))
        : [];
      const attachedImages = ask.isConfirmed
        ? rows.flatMap((item) => getTraceRowsFromRegistro(item).flatMap((trace) => trace.invoiceImageUrls || []))
        : [];
      if (ask.isConfirmed) {
        await preloadPrintImages([...ingredientImages, ...attachedImages]);
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
        const traces = getTraceRowsFromRegistro(item).map((trace) => `<tr class="is-trace-row"><td>↳ ${trace.index}</td><td><span class="print-trace-date">${escapeHtml(formatDateTime(trace.createdAt))}</span></td><td><span style="display:inline-flex;align-items:center;gap:8px;">${trace.ingredientImageUrl ? `<img src="${escapeHtml(trace.ingredientImageUrl)}" style="width:22px;height:22px;border-radius:999px;object-fit:cover;border:1px solid #d7def2;">` : ''}<span>${escapeHtml(trace.ingredientName)}</span></span></td><td>-${escapeHtml(trace.amount)}</td><td>${escapeHtml(trace.lotNumber)}</td><td><span class="print-trace-vto">${escapeHtml(formatIsoEs(trace.expiryDate))} (VTO)</span></td></tr>`);
        return [main, ...resolutions, ...traces];
      }).join('');
      const imagesHtml = ask.isConfirmed
        ? `<section><h2 style="margin:16px 0 10px;font-size:18px;">Imágenes adjuntas</h2><div style="display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));">${rows.flatMap((item) => getTraceRowsFromRegistro(item).map((trace) => `<figure style="margin:0;border:1px solid #d7def2;border-radius:12px;padding:10px;background:#fff;"><div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">${trace.ingredientImageUrl ? `<img src="${trace.ingredientImageUrl}" style="width:36px;height:36px;border-radius:999px;object-fit:cover;border:1px solid #d7def2;">` : ''}<figcaption style="font-size:12px;color:#4b5f8e;">${escapeHtml(trace.ingredientName)}</figcaption></div>${(trace.invoiceImageUrls || []).map((url) => `<img src="${url}" style="width:100%;max-height:220px;object-fit:contain;border-radius:10px;margin-top:8px;">`).join('')}</figure>`)).join('')}</div></section>`
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
          ? traceRows.map((trace) => `<tr class="inventario-trace-row"><td><div class="inventario-trace-main"><img src="./IMG/Octicons-git-merge.svg" alt="merge" class="inventario-trace-icon"><span class="inventario-trace-avatar">${trace.ingredientImageUrl ? `<span class="thumb-loading"><img class="meta-spinner-login" src="./IMG/Meta-ai-logo.webp" alt="Cargando"></span><img class="thumb-image js-produccion-thumb" src="${escapeHtml(trace.ingredientImageUrl)}" alt="${escapeHtml(trace.ingredientName)}">` : '<i class="fa-solid fa-carrot"></i>'}</span><span class="inventario-trace-label">${escapeHtml(trace.ingredientName)}</span></div></td><td></td><td><span class="produccion-trace-date">${escapeHtml(formatDateTime(trace.createdAt))}</span></td><td class="inventario-trace-kilos">-${escapeHtml(trace.amount)}</td><td>${escapeHtml(trace.lotNumber)}</td><td><span class="produccion-trace-expiry">${escapeHtml(formatIsoEs(trace.expiryDate))} (VTO)</span></td><td><span class="produccion-trace-badge">Trazabilidad</span></td><td>${trace.invoiceImageUrls.length ? `<button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-recipe-prod-trace-images="${encodeURIComponent(JSON.stringify(trace.invoiceImageUrls))}"><i class="fa-regular fa-image"></i><span>Adjunto (${trace.invoiceImageUrls.length})</span></button>` : '<button type="button" class="btn ios-btn ios-btn-danger inventario-no-photo-btn" disabled>Sin adjuntos</button>'}</td></tr>`).join('') : '';
        return `<tr class="inventario-row-tone ${index % 2 === 0 ? 'is-even-row' : 'is-odd-row'}"><td><div class="d-flex align-items-center gap-2">${traceRows.length ? `<button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-recipe-prod-collapse="${escapeHtml(item.id || '')}" title="${isCollapsed ? 'Descolapsar' : 'Colapsar'}" aria-label="${isCollapsed ? 'Descolapsar' : 'Colapsar'}"><i class="fa-solid ${isCollapsed ? 'fa-expand' : 'fa-compress'}"></i></button>` : ''}<span>${escapeHtml(item.id || '-')}</span></div></td><td>${escapeHtml(formatDateTime(item.createdAt))}</td><td>${escapeHtml(item.recipeTitle || '-')}</td><td>${Number(item.quantityKg || 0).toFixed(2)} kg</td><td><span class="produccion-responsable-wrap"><strong>${escapeHtml(manager.name)}</strong><small>${escapeHtml(manager.role)}</small></span></td><td class="produccion-vto-cell">${escapeHtml(formatProductExpiryLabel(item))}</td><td><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-recipe-prod-trace="${escapeHtml(item.id || '')}"><img src="./IMG/family-tree-icon-no-bg.svg" alt="" style="width:14px;height:14px"><span>Trazabilidad</span></button></td><td><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-recipe-prod-planilla="${escapeHtml(item.id || '')}" ${planillaDisabled}><i class="fa-regular fa-file-lines"></i><span>Planilla</span></button></td><td>${traceRows.some((trace) => trace.invoiceImageUrls.length) ? `<button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-recipe-prod-trace-images='${encodeURIComponent(JSON.stringify(traceRows.flatMap((trace) => trace.invoiceImageUrls)))}'><i class="fa-regular fa-image"></i><span>Ver adjuntos</span></button>` : '<button type="button" class="btn ios-btn ios-btn-danger inventario-no-photo-btn" disabled>Sin adjuntos</button>'}</td></tr>${traceHtml}`;
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
            <thead><tr><th>ID producción</th><th>Fecha y hora</th><th>Producto</th><th>Fabricado (KG.)</th><th>Responsable</th><th>VTO producto</th><th>Trazabilidad</th><th>Planilla</th><th>Adjuntos</th></tr></thead>
            <tbody>${htmlRows}</tbody>
          </table>
        </div>`;
      prepareThumbLoaders('.js-produccion-thumb');
      const rangeNode = nodes.editor.querySelector('#produccionRecipeHistoryRange');
      if (window.flatpickr && rangeNode) {
        const locale = window.flatpickr.l10ns?.es || undefined;
        window.flatpickr(rangeNode, {
          locale,
          mode: 'range',
          dateFormat: 'Y-m-d',
          allowInput: true,
          defaultDate: normalizeValue(recipeHistoryState.range).split(' a ').filter(Boolean),
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
      let qty = parsePositive(qtyInput.value, 0.1);
      if (qty > analysis.maxKg) qty = analysis.maxKg;
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
        qtyHelp.textContent += ` Detectamos ${expiredLotsCount} lote(s) vencido(s): resolvé su estado o cambiá fecha para continuar.`;
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
      if (event.target.closest('#produccionRecipeHistoryExpandBtn')) {
        const rows = getRecipeHistoryRows();
        const collapseMap = { ...state.historyTraceCollapse };
        const renderRows = () => rows.length
          ? rows.map((item, index) => {
            const manager = getManagerLabel(item);
            const traceRows = getTraceRowsFromRegistro(item);
            const isCollapsed = collapseMap[item.id] === true;
            const planillaDisabled = hasPlanillaDisponible(item) ? '' : 'disabled';
            const traceHtml = (!isCollapsed && traceRows.length)
              ? traceRows.map((trace) => `<tr class="inventario-trace-row"><td><div class="inventario-trace-main"><img src="./IMG/Octicons-git-merge.svg" alt="merge" class="inventario-trace-icon"><span class="inventario-trace-avatar">${trace.ingredientImageUrl ? `<span class="thumb-loading"><img class="meta-spinner-login" src="./IMG/Meta-ai-logo.webp" alt="Cargando"></span><img class="thumb-image js-produccion-thumb" src="${escapeHtml(trace.ingredientImageUrl)}" alt="${escapeHtml(trace.ingredientName)}">` : '<i class="fa-solid fa-carrot"></i>'}</span><span class="inventario-trace-label">${escapeHtml(trace.ingredientName)}</span></div></td><td></td><td><span class="produccion-trace-date">${escapeHtml(formatDateTime(trace.createdAt))}</span></td><td class="inventario-trace-kilos">-${escapeHtml(trace.amount)}</td><td>${escapeHtml(trace.lotNumber)}</td><td><span class="produccion-trace-expiry">${escapeHtml(formatIsoEs(trace.expiryDate))} (VTO)</span></td><td><span class="produccion-trace-badge">Trazabilidad</span></td><td>${trace.invoiceImageUrls.length ? `<button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-recipe-prod-trace-images="${encodeURIComponent(JSON.stringify(trace.invoiceImageUrls))}"><i class="fa-regular fa-image"></i><span>Adjunto (${trace.invoiceImageUrls.length})</span></button>` : '<button type="button" class="btn ios-btn ios-btn-danger inventario-no-photo-btn" disabled>Sin adjuntos</button>'}</td></tr>`).join('')
              : '';
            return `<tr class="inventario-row-tone ${index % 2 === 0 ? 'is-even-row' : 'is-odd-row'}"><td><div class="d-flex align-items-center gap-2">${traceRows.length ? `<button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-recipe-prod-collapse="${escapeHtml(item.id || '')}" title="${isCollapsed ? 'Descolapsar' : 'Colapsar'}" aria-label="${isCollapsed ? 'Descolapsar' : 'Colapsar'}"><i class="fa-solid ${isCollapsed ? 'fa-expand' : 'fa-compress'}"></i></button>` : ''}<span>${escapeHtml(item.id || '-')}</span></div></td><td>${escapeHtml(formatDateTime(item.createdAt))}</td><td>${escapeHtml(item.recipeTitle || '-')}</td><td>${Number(item.quantityKg || 0).toFixed(2)} kg</td><td><span class="produccion-responsable-wrap"><strong>${escapeHtml(manager.name)}</strong><small>${escapeHtml(manager.role)}</small></span></td><td class="produccion-vto-cell">${escapeHtml(formatProductExpiryLabel(item))}</td><td><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-recipe-prod-trace="${escapeHtml(item.id || '')}"><img src="./IMG/family-tree-icon-no-bg.svg" alt="" style="width:14px;height:14px"><span>Trazabilidad</span></button></td><td><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-recipe-prod-planilla="${escapeHtml(item.id || '')}" ${planillaDisabled}><i class="fa-regular fa-file-lines"></i><span>Planilla</span></button></td><td>${traceRows.some((trace) => trace.invoiceImageUrls.length) ? `<button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-recipe-prod-trace-images='${encodeURIComponent(JSON.stringify(traceRows.flatMap((trace) => trace.invoiceImageUrls)))}'><i class="fa-regular fa-image"></i><span>Ver adjuntos</span></button>` : '<button type="button" class="btn ios-btn ios-btn-danger inventario-no-photo-btn" disabled>Sin adjuntos</button>'}</td></tr>${traceHtml}`;
          }).join('')
          : '<tr><td colspan="9" class="text-center">Sin producciones.</td></tr>';
        const renderExpandedContent = (popup) => {
          const host = popup.querySelector('#produccionRecipeExpandedHistoryHost');
          if (!host) return;
          const traceableRows = rows.filter((item) => getTraceRowsFromRegistro(item).length);
          const canCollapseRows = traceableRows.some((item) => collapseMap[item.id] !== true);
          const canExpandRows = traceableRows.some((item) => collapseMap[item.id] === true);
          host.innerHTML = `<div class="inventario-print-row mb-2 inventario-trace-toolbar toolbar-scroll-x"><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" id="produccionRecipeExpandedHistoryCollapseAllRowsBtn" ${canCollapseRows ? '' : 'disabled'}><i class="fa-solid fa-compress"></i><span>Colapsar</span></button><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" id="produccionRecipeExpandedHistoryExpandAllRowsBtn" ${canExpandRows ? '' : 'disabled'}><i class="fa-solid fa-expand"></i><span>Descolapsar</span></button></div><div class="table-responsive inventario-table-compact-wrap"><table class="table recipe-table inventario-table-compact mb-0"><thead><tr><th>ID producción</th><th>Fecha y hora</th><th>Producto</th><th>Fabricado (KG.)</th><th>Responsable</th><th>VTO producto</th><th>Trazabilidad</th><th>Planilla</th><th>Adjuntos</th></tr></thead><tbody>${renderRows()}</tbody></table></div>`;
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
              const planillaBtn = clickEvent.target.closest('[data-recipe-prod-planilla]');
              if (planillaBtn) {
                const reg = state.registros[planillaBtn.dataset.recipeProdPlanilla];
                if (reg) await window.laJamoneraPlanillaProduccion?.openByRegistro?.(reg, { companyLogoUrl: normalizeValue(state.config.companyLogoUrl), usersMap: safeObject(state.users) });
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
      qtyInput.value = analysis.maxKg.toFixed(2);
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
        return;
      }
      const managerSummary = managers.map((token) => {
        const manager = getManagerDisplay(token);
        return `${escapeHtml(manager.name)} (${escapeHtml(manager.role)})`;
      }).join('<br>');
      const productExpiry = addDaysToIso(date, Number(recipe.shelfLifeDays || 0));
      const summaryRows = revalidated.ingredientPlans.map((plan) => `<li><strong>${escapeHtml(plan.ingredientName)}</strong>: ${Number(plan.neededQty || 0).toFixed(2)} ${escapeHtml(plan.ingredientUnit || '')}</li>`).join('');
      const confirm = await openIosSwal({
        title: 'Confirmar producción final',
        html: `<div class="text-start produccion-confirm-summary produccion-confirm-card"><div class="produccion-confirm-head"><span class="produccion-confirm-icon"><i class="bi bi-check2-circle"></i></span><div><p class="produccion-confirm-kicker">Validación final</p><p class="produccion-confirm-note">Se descontará stock real del inventario al confirmar.</p></div></div><p><strong><i class="bi bi-box-seam fa-solid fa-box-open"></i> Producto:</strong> <span>${escapeHtml(recipe.title || '-')}</span></p><p><strong><i class="bi bi-calendar-event"></i> Fecha:</strong> <span class="produccion-trace-date">${escapeHtml(formatIsoEs(date))}</span></p><p><strong><i class="bi bi-hourglass-split"></i> VTO producto:</strong> <span class="produccion-confirm-vto">${escapeHtml(formatIsoEs(productExpiry || ''))} (VTO)</span></p><p><strong><i class="bi bi-speedometer2"></i> Total a producir:</strong> <span class="produccion-confirm-total">${qty.toFixed(2)} kg</span></p><p><strong><i class="bi bi-people"></i> Encargado/s:</strong><br>${managerSummary}</p><p><strong><i class="bi bi-list-check"></i> Resumen de insumos:</strong></p><ul>${summaryRows}</ul></div>`,
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
        lots: revalidated.ingredientPlans,
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
          ingredients: revalidated.ingredientPlans.map((ingredientPlan) => ({
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
              providerRne: normalizeRneRecord(findProviderFromTraceValue(lot.provider)?.rne),
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
    nodes.editor.querySelector('#produccionConfirmBtn').addEventListener('click', confirmProduction);
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
  const refreshData = async () => {
    setStateView('loading');
    await window.laJamoneraReady;
    const [recetas, ingredientes, inventario, config, reservas, drafts, registros, users] = await Promise.all([
      window.dbLaJamoneraRest.read('/recetas'),
      window.dbLaJamoneraRest.read('/ingredientes/items'),
      window.dbLaJamoneraRest.read('/inventario'),
      window.dbLaJamoneraRest.read(CONFIG_PATH),
      window.dbLaJamoneraRest.read(RESERVAS_PATH),
      window.dbLaJamoneraRest.read(DRAFTS_PATH),
      window.dbLaJamoneraRest.read(REGISTROS_PATH),
      window.dbLaJamoneraRest.read('/informes/users')
    ]);
    state.recetas = safeObject(recetas);
    state.ingredientes = safeObject(ingredientes);
    state.inventario = safeObject(inventario);
    state.reservas = safeObject(reservas);
    state.drafts = safeObject(drafts);
    state.registros = safeObject(registros);
    state.users = safeObject(users);
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
    }
  });
  nodes.historyBackBtn?.addEventListener('click', () => {
    setHistoryMode(false);
  });
  nodes.historyApplyBtn?.addEventListener('click', () => {
    state.historyRange = normalizeValue(nodes.historyRange?.value);
    nodes.historyClearBtn?.classList.toggle('d-none', !state.historyRange);
    state.historyPage = 1;
    renderHistoryTable();
  });
  nodes.historyClearBtn?.addEventListener('click', () => {
    state.historyRange = '';
    if (nodes.historyRange) nodes.historyRange.value = '';
    nodes.historyClearBtn?.classList.add('d-none');
    state.historyPage = 1;
    renderHistoryTable();
  });
  nodes.historyExpandBtn?.addEventListener('click', async () => {
    const rows = getHistoryRows();
    const collapseMap = { ...state.historyTraceCollapse };
    rows.forEach((item) => {
      if (collapseMap[item.id] !== undefined) return;
      if (getTraceRowsFromRegistro(item).length) collapseMap[item.id] = true;
    });
    const renderRows = () => rows.length ? rows.map((item, index) => {
      const manager = getManagerLabel(item);
      const traceRows = getTraceRowsFromRegistro(item);
      const isCollapsed = collapseMap[item.id] === true;
      const traceHtml = (!isCollapsed && traceRows.length) ? traceRows.map((trace) => `<tr class="inventario-trace-row">
        <td><div class="inventario-trace-main"><img src="./IMG/Octicons-git-merge.svg" alt="merge" class="inventario-trace-icon"><span class="inventario-trace-avatar">${trace.ingredientImageUrl ? `<span class="thumb-loading"><img class="meta-spinner-login" src="./IMG/Meta-ai-logo.webp" alt="Cargando"></span><img class="thumb-image js-produccion-thumb" src="${escapeHtml(trace.ingredientImageUrl)}" alt="${escapeHtml(trace.ingredientName)}">` : '<i class="fa-solid fa-carrot"></i>'}</span><span class="inventario-trace-label">${escapeHtml(trace.ingredientName)}</span></div></td>
        <td></td>
        <td><span class="produccion-trace-date">${escapeHtml(formatDateTime(trace.createdAt))}</span></td>
        <td class="inventario-trace-kilos">-${escapeHtml(trace.amount)}</td>
        <td>${escapeHtml(trace.lotNumber)}</td>
        <td><span class="produccion-trace-expiry">${escapeHtml(formatIsoEs(trace.expiryDate))} (VTO)</span></td>
        <td><span class="produccion-trace-badge">Trazabilidad</span></td>
        <td>${trace.invoiceImageUrls.length ? `<button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-recipe-prod-trace-images='${encodeURIComponent(JSON.stringify(trace.invoiceImageUrls))}'><i class="fa-regular fa-image"></i><span>Adjunto (${trace.invoiceImageUrls.length})</span></button>` : '<button type="button" class="btn ios-btn ios-btn-danger inventario-no-photo-btn" disabled>Sin adjuntos</button>'}</td>
      </tr>`).join('') : '';
      return `<tr class="inventario-row-tone ${index % 2 === 0 ? 'is-even-row' : 'is-odd-row'}"><td><div class="d-flex align-items-center gap-2">${traceRows.length ? `<button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-prod-expanded-collapse="${escapeHtml(item.id || '')}" title="${isCollapsed ? 'Descolapsar' : 'Colapsar'}" aria-label="${isCollapsed ? 'Descolapsar' : 'Colapsar'}"><i class="fa-solid ${isCollapsed ? 'fa-expand' : 'fa-compress'}"></i></button>` : ''}<span>${escapeHtml(item.id)}</span></div></td><td>${escapeHtml(formatDateTime(item.createdAt))}</td><td>${escapeHtml(item.recipeTitle || '-')}</td><td>${Number(item.quantityKg || 0).toFixed(2)} kg</td><td>${escapeHtml(manager.name)} (${escapeHtml(manager.role)})</td><td class="produccion-vto-cell">${escapeHtml(formatProductExpiryLabel(item))}</td><td><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-recipe-prod-trace="${escapeHtml(item.id || '')}"><img src="./IMG/family-tree-icon-no-bg.svg" alt="" style="width:14px;height:14px"><span>Trazabilidad</span></button></td><td><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-recipe-prod-planilla="${escapeHtml(item.id || '')}" ${planillaDisabled}><i class="fa-regular fa-file-lines"></i><span>Planilla</span></button></td><td>${traceRows.some((trace) => trace.invoiceImageUrls.length) ? `<button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-recipe-prod-trace-images='${encodeURIComponent(JSON.stringify(traceRows.flatMap((trace) => trace.invoiceImageUrls)))}'><i class="fa-regular fa-image"></i><span>Ver adjuntos</span></button>` : '<button type="button" class="btn ios-btn ios-btn-danger inventario-no-photo-btn" disabled>Sin adjuntos</button>'}</td></tr>${traceHtml}`;
    }).join('') : '<tr><td colspan="9" class="text-center">Sin producciones.</td></tr>';
    const renderExpandedContent = (popup) => {
      const host = popup.querySelector('#produccionExpandedHistoryHost');
      if (!host) return;
      const traceableRows = rows.filter((item) => getTraceRowsFromRegistro(item).length);
      const canCollapseRows = traceableRows.some((item) => collapseMap[item.id] !== true);
      const canExpandRows = traceableRows.some((item) => collapseMap[item.id] === true);
      host.innerHTML = `<div class="inventario-print-row mb-2 inventario-trace-toolbar toolbar-scroll-x"><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" id="produccionExpandedHistoryCollapseAllRowsBtn" ${canCollapseRows ? '' : 'disabled'}><i class="fa-solid fa-compress"></i><span>Colapsar</span></button><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" id="produccionExpandedHistoryExpandAllRowsBtn" ${canExpandRows ? '' : 'disabled'}><i class="fa-solid fa-expand"></i><span>Descolapsar</span></button></div><div class="table-responsive inventario-table-compact-wrap"><table class="table recipe-table inventario-table-compact mb-0"><thead><tr><th>ID</th><th>Fecha y hora</th><th>Producto</th><th>Cantidad</th><th>Responsable</th><th>VTO producto</th><th>Trazabilidad</th><th>Adjuntos</th></tr></thead><tbody>${renderRows()}</tbody></table></div>`;
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
    const ingredientImages = includeImages
      ? rows.flatMap((item) => getTraceRowsFromRegistro(item).map((trace) => trace.ingredientImageUrl).filter(Boolean))
      : [];
    const attachedImages = includeImages
      ? rows.flatMap((item) => getTraceRowsFromRegistro(item).flatMap((trace) => trace.invoiceImageUrls || []))
      : [];
    if (includeImages) {
      await preloadPrintImages([...ingredientImages, ...attachedImages]);
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
      const traces = getTraceRowsFromRegistro(item).map((trace) => `<tr class="is-trace-row"><td>↳ ${trace.index}</td><td><span class="print-trace-date">${escapeHtml(formatDateTime(trace.createdAt))}</span></td><td><span style="display:inline-flex;align-items:center;gap:8px;">${trace.ingredientImageUrl ? `<img src="${escapeHtml(trace.ingredientImageUrl)}" style="width:22px;height:22px;border-radius:999px;object-fit:cover;border:1px solid #d7def2;">` : ''}<span>${escapeHtml(trace.ingredientName)}</span></span></td><td class="inventario-trace-kilos">-${escapeHtml(trace.amount)}</td><td>${escapeHtml(trace.lotNumber)}</td><td><span class="print-trace-vto">${escapeHtml(formatIsoEs(trace.expiryDate))} (VTO)</span></td></tr>`);
      return [main, ...resolutions, ...traces];
    }).join('');
    const imagesHtml = includeImages
      ? `<section><h2 style="margin:16px 0 10px;font-size:18px;">Imágenes adjuntas del período</h2><div style="display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));">${rows.flatMap((item) => getTraceRowsFromRegistro(item).map((trace) => `<figure style="margin:0;border:1px solid #d7def2;border-radius:12px;padding:10px;background:#fff;"><div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">${trace.ingredientImageUrl ? `<img src="${trace.ingredientImageUrl}" style="width:36px;height:36px;border-radius:999px;object-fit:cover;border:1px solid #d7def2;">` : ''}<figcaption style="font-size:12px;color:#4b5f8e;">${escapeHtml(trace.ingredientName)}</figcaption></div>${(trace.invoiceImageUrls || []).map((url, idx) => `<img src="${url}" style="width:100%;max-height:240px;object-fit:contain;border-radius:10px;margin-top:${idx ? '8px' : '0'};">`).join('')}</figure>`)).join('')}</div></section>`
      : '';
    win.document.write(`<html><head><title>Producción por período</title><style>body{font-family:Inter,Arial;padding:20px;color:#1f2a44}table{width:100%;border-collapse:collapse}th,td{border:1px solid #d7def2;padding:6px;font-size:11px;vertical-align:top}th{background:#eef3ff;font-size:10px;text-transform:uppercase;letter-spacing:.04em}.is-trace-row td{background:#ffecef}.is-resolution-row td{background:#fff6d9}.print-trace-date{color:#1f6fd6;font-weight:700}.print-trace-vto{color:#b04a09;font-weight:700}</style></head><body><h1>Producción por período • La Jamonera</h1><table><thead><tr><th>ID producción</th><th>Fecha y hora</th><th>Producto</th><th>Fabricado (KG.)</th><th>Responsable</th><th>VTO producto</th></tr></thead><tbody>${bodyRows || '<tr><td colspan="6">Sin datos</td></tr>'}</tbody></table>${imagesHtml}</body></html>`);
    win.document.close();
    win.focus();
    await waitPrintAssets(win);
    win.print();
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
    const traceBtn = event.target.closest('[data-prod-trace]');
    if (traceBtn) {
      const reg = getRegistro(traceBtn.dataset.prodTrace);
      if (reg) await openTraceability(reg);
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
      if (window.flatpickr && nodes.historyRange) {
        const locale = window.flatpickr.l10ns?.es || undefined;
        const dayMap = getProductionDayMap();
        window.flatpickr(nodes.historyRange, {
          locale,
          mode: 'range',
          dateFormat: 'Y-m-d',
          allowInput: true,
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
    state.historyRange = '';
    state.historyPage = 1;
    if (nodes.historyRange) nodes.historyRange.value = '';
    setHistoryMode(false);
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
