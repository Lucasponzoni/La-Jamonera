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
    globalLoading: $('inventarioGlobalLoading'),
    globalPrintBtn: $('inventarioGlobalPrintBtn'),
    globalTableWrap: $('inventarioGlobalTableWrap')
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
    periodMode: false
  };

  const safeObject = (value) => (value && typeof value === 'object' ? value : {});
  const normalizeValue = (value) => String(value || '').trim();
  const normalizeLower = (value) => normalizeValue(value).toLowerCase();
  const capitalize = (value) => normalizeLower(value).replace(/(^|\s)\S/g, (ch) => ch.toUpperCase());
  const makeId = (prefix) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const parseNumber = (value) => {
    const parsed = Number(normalizeValue(value).replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : NaN;
  };

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
    ? `<div class="ingrediente-avatar"><img class="thumb-image is-loaded" src="${item.imageUrl}" alt="${capitalize(item.name)}"></div>`
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
        expiringSoonDays: Number(inv?.config?.expiringSoonDays) >= 0 ? Number(inv.config.expiringSoonDays) : DEFAULT_EXPIRING_SOON_DAYS
      },
      items: safeObject(inv?.items)
    };
  };

  const filteredIngredients = () => Object.values(state.ingredientes)
    .filter((item) => {
      if (state.activeFamilyId !== 'all' && item.familyId !== state.activeFamilyId) return false;
      if (!state.search) return true;
      const text = [item.name, item.description, item.familyName, item.measure].map(normalizeLower).join(' ');
      return text.includes(state.search);
    })
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

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
          <span class="family-circle-thumb ${family.imageUrl ? '' : 'family-circle-thumb-placeholder'}">${family.imageUrl ? `<img class="thumb-image is-loaded" src="${family.imageUrl}" alt="${capitalize(family.name)}">` : '<i class="fa-solid fa-carrot"></i>'}</span>
          <span class="family-circle-name">${capitalize(family.name)}</span>
        </button>
      </div>`).join('');
  };

  const renderList = () => {
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
            ${item.description ? `<p class="ingrediente-description">${item.description}</p>` : ''}
            <p class="inventario-stock-line ${stockClass}"><strong>${(Number(record.stockKg) || 0).toFixed(2)} kg</strong><span>Umbral bajo: ${record.lowThresholdKg != null ? record.lowThresholdKg.toFixed(2) : Number(state.inventario.config.globalLowThresholdKg || DEFAULT_LOW_THRESHOLD).toFixed(2)} kg ${record.lowThresholdKg != null ? '(personalizado)' : '(global)'}</span></p>
            <div class="inventario-actions-row">
              <button type="button" class="btn ios-btn ios-btn-success" data-inventario-open-editor="${item.id}"><i class="fa-solid fa-plus"></i><span>Ingresar stock</span></button>
              <button type="button" class="btn ios-btn ios-btn-secondary inventario-view-btn" data-inventario-open-editor="${item.id}"><i class="fa-regular fa-eye"></i><span>Visualizar</span></button>
              <button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-inventario-config-item="${item.id}"><i class="fa-solid fa-sliders"></i><span>Umbral</span></button>
            </div>
          </div>
        </article>`;
    }).join('');

    updateListScrollHint();
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
          entryDate: entry.entryDate || '-',
          qtyKg: Number(entry.qtyKg || 0),
          qty: Number(entry.qty || 0),
          unit: entry.unit || '',
          invoiceNumber: entry.invoiceNumber || '-',
          invoiceImageUrl: entry.invoiceImageUrl || ''
        });
      });
    });
    return rows.sort((a, b) => String(a.entryDate).localeCompare(String(b.entryDate)));
  };

  const getDayKgMap = (entries) => entries.reduce((acc, entry) => {
    const key = String(entry.entryDate || '');
    acc[key] = Number((acc[key] || 0) + (Number(entry.qtyKg) || 0)).toFixed(2);
    return acc;
  }, {});

  const renderGlobalPeriodTable = () => {
    if (!nodes.globalTableWrap) return;
    const rows = getGlobalFilteredEntries();
    const htmlRows = rows.length ? rows.map((row) => `
      <tr>
        <td>${escapeHtml(row.entryDate)}</td>
        <td>${escapeHtml(row.ingredientName)}</td>
        <td>${row.qtyKg.toFixed(2)} kg</td>
        <td>${row.qty.toFixed(2)} ${escapeHtml(row.unit)}</td>
        <td>${escapeHtml(row.invoiceNumber)}</td>
        <td>${row.invoiceImageUrl ? `<button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-open-global-image="${row.invoiceImageUrl}"><i class="fa-regular fa-image"></i><span>Ver</span></button>` : '-'}</td>
      </tr>`).join('') : '<tr><td colspan="6" class="text-center">Sin ingresos en ese rango.</td></tr>';
    nodes.globalTableWrap.innerHTML = `
      <div class="table-responsive inventario-global-table">
        <table class="table recipe-table mb-0">
          <thead><tr><th>Fecha</th><th>Producto</th><th>Kilos</th><th>Cantidad</th><th>N° factura/remito</th><th>Imagen</th></tr></thead>
          <tbody>${htmlRows}</tbody>
        </table>
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

  const buildLotSummaryBadges = (lotConfig) => {
    const tokens = Array.isArray(lotConfig?.tokens) ? lotConfig.tokens : [];
    const customAcronym = normalizeValue(lotConfig?.customAcronym);
    if (!tokens.length) {
      return '<span class="inventario-config-badge is-muted">Sin configuración</span>';
    }

    const badges = tokens.map((token) => `<span class="inventario-config-badge">${lotTokenLabelFor(token, customAcronym)}</span>`);
    if (lotConfig?.includeSeparator) {
      badges.push(`<span class="inventario-config-badge">Separador: ${escapeHtml(lotConfig.separator || '-')}</span>`);
    }
    return badges.join('');
  };

  const parseIsoDate = (value) => {
    const date = new Date(value || '');
    return Number.isNaN(date.getTime()) ? null : date;
  };

  const formatDateTime = (value) => {
    const date = new Date(Number(value || 0));
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const openAttachmentViewer = async (entries, startIndex = 0, title = 'Adjuntos') => {
    const images = entries.filter((item) => item?.invoiceImageUrl);
    if (!images.length) return;
    let index = Math.min(Math.max(0, startIndex), images.length - 1);

    const render = () => `
      <div class="image-viewer-controls">
        <button type="button" class="btn ios-btn ios-btn-secondary" data-viewer-prev><i class="fa-solid fa-chevron-left"></i></button>
        <span>${index + 1} / ${images.length}</span>
        <button type="button" class="btn ios-btn ios-btn-secondary" data-viewer-next><i class="fa-solid fa-chevron-right"></i></button>
      </div>
      <div class="viewer-stage">
        <img src="${images[index].invoiceImageUrl}" alt="Adjunto" class="attachment-image is-loaded" />
      </div>`;

    await openIosSwal({
      title,
      width: 980,
      html: render(),
      confirmButtonText: 'Cerrar',
      didOpen: () => {
        const box = Swal.getHtmlContainer();
        if (!box) return;
        box.addEventListener('click', (event) => {
          if (event.target.closest('[data-viewer-prev]')) {
            index = (index - 1 + images.length) % images.length;
            box.innerHTML = render();
          }
          if (event.target.closest('[data-viewer-next]')) {
            index = (index + 1) % images.length;
            box.innerHTML = render();
          }
        });
      }
    });
  };

  const inDateRange = (value, from, to) => {
    const date = parseIsoDate(value);
    if (!date) return false;
    const dateIso = date.toISOString().slice(0, 10);
    if (from && dateIso < from) return false;
    if (to && dateIso > to) return false;
    return true;
  };

  const getFilteredEntries = (entries) => {
    const search = normalizeLower(state.tableSearch);
    const range = parseRangeValue(state.tableDateRange);
    return entries.filter((entry) => {
      if (search) {
        const blob = [entry.entryDate, entry.expiryDate, entry.invoiceNumber, entry.qty, entry.unit].map(normalizeLower).join(' ');
        if (!blob.includes(search)) return false;
      }
      if ((range.from || range.to) && !inDateRange(entry.entryDate, range.from, range.to)) return false;
      return true;
    });
  };

  const openPrintEntries = async (ingredient, entries) => {
    const ask = await openIosSwal({
      title: 'Imprimir historial',
      html: '<p>¿Querés incluir imágenes adjuntas en la impresión?</p>',
      showCancelButton: true,
      showDenyButton: true,
      confirmButtonText: 'Sí, incluir imágenes',
      denyButtonText: 'No incluir imágenes',
      cancelButtonText: 'Cancelar',
      customClass: {
        confirmButton: 'ios-btn ios-btn-primary',
        denyButton: 'ios-btn ios-btn-danger',
        cancelButton: 'ios-btn ios-btn-secondary'
      }
    });
    if (!ask.isConfirmed && !ask.isDenied) return;

    const includeImages = ask.isConfirmed;
    const rows = entries.map((entry) => `
      <tr>
        <td>${escapeHtml(entry.entryDate || '-')}</td>
        <td>${formatDateTime(entry.createdAt)}</td>
        <td>${escapeHtml(entry.expiryDate || '-')}</td>
        <td>${Number(entry.qty || 0).toFixed(2)} ${escapeHtml(entry.unit || '')}</td>
        <td>${escapeHtml(entry.invoiceNumber || '-')}</td>
        <td>${includeImages ? (entry.invoiceImageUrl ? 'Ver bloque de imágenes' : 'Sin imagen') : (entry.invoiceImageUrl ? 'Posee imagen adjunta' : 'Sin imagen')}</td>
      </tr>`).join('');

    const imagesHtml = includeImages
      ? `<section><h2 style="margin:16px 0 10px;font-size:18px;">Imágenes adjuntas</h2><div style="display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));">${entries.filter((e) => e.invoiceImageUrl).map((entry) => `<figure style="margin:0;border:1px solid #d7def2;border-radius:12px;padding:10px;background:#fff;"><img src="${entry.invoiceImageUrl}" style="width:100%;max-height:320px;object-fit:contain;border-radius:10px;"/><figcaption style="font-size:12px;color:#4b5f8e;margin-top:6px;">${escapeHtml(entry.invoiceNumber || '-')} · ${escapeHtml(entry.entryDate || '-')}</figcaption></figure>`).join('')}</div></section>`
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
          </style>
        </head>
        <body>
          <h1>${escapeHtml(capitalize(ingredient.name))} · Historial de ingresos</h1>
          <table>
            <thead><tr><th>Fecha ingreso</th><th>Hora carga</th><th>Fecha caducidad</th><th>Cantidad</th><th>N° factura/remito</th><th>Imagen</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="6">Sin datos</td></tr>'}</tbody>
          </table>
          ${imagesHtml}
        </body>
      </html>`);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };


  const openPrintGlobalPeriod = async (rows) => {
    const ask = await openIosSwal({
      title: 'Imprimir período',
      html: '<p>¿Querés incluir imágenes adjuntas?</p>',
      showCancelButton: true,
      showDenyButton: true,
      confirmButtonText: 'Sí',
      denyButtonText: 'No',
      cancelButtonText: 'Cancelar',
      customClass: {
        confirmButton: 'ios-btn ios-btn-primary',
        denyButton: 'ios-btn ios-btn-danger',
        cancelButton: 'ios-btn ios-btn-secondary'
      }
    });
    if (!ask.isConfirmed && !ask.isDenied) return;
    const includeImages = ask.isConfirmed;
    const content = rows.map((row) => `
      <tr>
        <td>${escapeHtml(row.entryDate)}</td>
        <td>${escapeHtml(row.ingredientName)}</td>
        <td>${row.qtyKg.toFixed(2)} kg</td>
        <td>${row.qty.toFixed(2)} ${escapeHtml(row.unit)}</td>
        <td>${escapeHtml(row.invoiceNumber)}</td>
        <td>${includeImages ? (row.invoiceImageUrl ? 'Ver bloque de imágenes' : 'Sin imagen') : (row.invoiceImageUrl ? 'Posee imagen adjunta' : 'Sin imagen')}</td>
      </tr>`).join('');

    const imagesHtml = includeImages
      ? `<section><h2 style="margin:16px 0 10px;font-size:18px;">Imágenes adjuntas del período</h2><div style="display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));">${rows.filter((r) => r.invoiceImageUrl).map((row) => `<figure style="margin:0;border:1px solid #d7def2;border-radius:12px;padding:10px;background:#fff;"><img src="${row.invoiceImageUrl}" style="width:100%;max-height:320px;object-fit:contain;border-radius:10px;"/><figcaption style="font-size:12px;color:#4b5f8e;margin-top:6px;">${escapeHtml(row.ingredientName)} · ${escapeHtml(row.entryDate)}</figcaption></figure>`).join('')}</div></section>`
      : '';

    const win = window.open('', '_blank', 'width=1300,height=900');
    if (!win) return;
    win.document.write(`<html><head><title>Inventario por período</title><style>body{font-family:Inter,Arial;padding:20px;color:#1f2a44}table{width:100%;border-collapse:collapse}th,td{border:1px solid #d7def2;padding:8px;font-size:12px}th{background:#eef3ff}</style></head><body><h1>Ingresos por período</h1><table><thead><tr><th>Fecha</th><th>Producto</th><th>Kilos</th><th>Cantidad</th><th>N° factura/remito</th><th>Imagen</th></tr></thead><tbody>${content || '<tr><td colspan="6">Sin datos</td></tr>'}</tbody></table>${imagesHtml}</body></html>`);
    win.document.close();
    win.focus();
    win.print();
  };


  const renderEntryTable = (record) => {
    const source = Array.isArray(record.entries) ? [...record.entries] : [];
    const filtered = getFilteredEntries(source);

    const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    state.tablePage = Math.min(Math.max(1, state.tablePage), pages);
    const start = (state.tablePage - 1) * PAGE_SIZE;
    const pageRows = filtered.slice(start, start + PAGE_SIZE);

    const rowsHtml = pageRows.length ? pageRows.map((entry) => `
      <tr>
        <td>${entry.entryDate || '-'}</td>
        <td>${formatDateTime(entry.createdAt)}</td>
        <td>${entry.expiryDate || '-'}</td>
        <td>${Number(entry.qty || 0).toFixed(2)} ${escapeHtml(entry.unit || '')}</td>
        <td>${escapeHtml(entry.invoiceNumber || '-')}</td>
        <td>${entry.invoiceImageUrl ? `<button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-open-invoice-image="${entry.id}"><i class="fa-regular fa-image"></i><span>Ver</span></button>` : '-'}</td>
        <td><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-print-entry="${entry.id}"><i class="fa-solid fa-print"></i><span>Imprimir</span></button></td>
      </tr>`).join('') : '<tr><td colspan="7" class="text-center">Sin ingresos para mostrar.</td></tr>';

    return `
      <div class="inventario-table-wrap">
        <div class="inventario-table-head enhanced">
          <input id="inventarioEntriesSearch" class="form-control ios-input" autocomplete="off" placeholder="Buscar en ingresos" value="${escapeHtml(state.tableSearch)}">
          <div class="inventario-table-range">
            <input id="inventarioEntriesRange" class="form-control ios-input" autocomplete="off" placeholder="Rango de fechas" value="${escapeHtml(state.tableDateRange)}">
            <button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" id="inventarioPrintFilteredBtn"><i class="fa-solid fa-print"></i><span>Imprimir filtro</span></button>
            <button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" id="inventarioPrintAllBtn"><i class="fa-solid fa-print"></i><span>Imprimir total</span></button>
          </div>
        </div>
        <div class="table-responsive">
          <table class="table recipe-table mb-0">
            <thead><tr><th>Fecha ingreso</th><th>Hora carga</th><th>Fecha caducidad</th><th>Cantidad</th><th>Nº factura/remito</th><th>Imagen</th><th>Acción</th></tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
        <div class="inventario-pagination enhanced">
          <button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-entry-page="prev" ${state.tablePage <= 1 ? 'disabled' : ''}>Anterior</button>
          <span>Página ${state.tablePage} de ${pages}</span>
          <button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-entry-page="next" ${state.tablePage >= pages ? 'disabled' : ''}>Siguiente</button>
        </div>
      </div>`;
  };

  const escapeHtml = (value) => String(value || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

  const renderEditor = (ingredientId, draft = null) => {
    const ingredient = state.ingredientes[ingredientId];
    if (!ingredient) return;
    const record = getRecord(ingredientId);
    const expiringDays = currentExpiringDaysFor(record);
    const expiringKg = sumExpiringSoonKg(record);

    const baseDraft = {
      qty: '',
      unit: 'kilos',
      entryDate: new Date().toISOString().slice(0, 10),
      expiryDate: new Date(Date.now() + (5 * 86400000)).toISOString().slice(0, 10),
      invoiceNumber: '',
      invoiceImageFile: null,
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
            <p class="inventario-editor-meta">${capitalize(ingredient.description || 'Sin descripción')}</p>
            <p class="inventario-editor-measure">${getMeasureLabel(ingredient.measure || 'kilos')}</p>
          </div>
        </div>
        <div class="inventario-product-head-stats">
          <div class="inventario-stat-card ${(Number(record.stockKg) || 0) <= 0 ? 'is-danger' : ''}">
            <small>Stock total actual</small>
            <strong>${(Number(record.stockKg) || 0).toFixed(2)} kg</strong>
          </div>
          ${shouldShowExpiring ? `<div class="inventario-stat-card is-alert"><small>Próximos a caducar (${expiringDays} días)</small><strong>${expiringKg.toFixed(2)} kg</strong></div>` : ''}
          <button type="button" class="btn ios-btn ios-btn-secondary inventario-head-action" id="inventarioProductThresholdBtn"><i class="fa-solid fa-sliders"></i><span>Configurar umbrales</span></button>
          <button type="button" id="inventarioEditIngredientBtn" class="btn ios-btn ios-btn-success inventario-head-action"><i class="fa-solid fa-pen"></i><span>Editar ingrediente</span></button>
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
            <label class="form-label" for="inventoryQty">Cantidad a ingresar</label>
            <input id="inventoryQty" class="form-control ios-input" type="number" autocomplete="off" min="0" step="0.01" value="${state.editorDraft.qty}">
          </div>
          <div class="recipe-field recipe-field-half">
            <label class="form-label" for="inventoryUnit">Unidad</label>
            <select id="inventoryUnit" class="form-select ios-input" autocomplete="off">
              ${state.measures.map((m) => `<option value="${escapeHtml(m.name)}" ${measureKey(m.name) === measureKey(state.editorDraft.unit) ? 'selected' : ''}>${escapeHtml(getMeasureLabel(m.name))}</option>`).join('')}
              <option value="add_measure">+ Agregar medida</option>
            </select>
          </div>
          <div class="recipe-field recipe-field-half">
            <label class="form-label" for="inventoryEntryDate">Fecha de ingreso</label>
            <input id="inventoryEntryDate" class="form-control ios-input" autocomplete="off" value="${escapeHtml(state.editorDraft.entryDate)}" placeholder="Seleccionar fecha">
          </div>
          <div class="recipe-field recipe-field-half">
            <label class="form-label" for="inventoryExpiryDate">Fecha de caducidad</label>
            <input id="inventoryExpiryDate" class="form-control ios-input" autocomplete="off" value="${escapeHtml(state.editorDraft.expiryDate)}" placeholder="Seleccionar fecha">
          </div>
          <div class="recipe-field recipe-field-half">
            <label class="form-label" for="inventoryInvoiceNumber">Número de factura/remito</label>
            <input id="inventoryInvoiceNumber" class="form-control ios-input" value="${escapeHtml(state.editorDraft.invoiceNumber)}" placeholder="Ej: A-000123" autocomplete="new-password" autocapitalize="off" autocorrect="off" spellcheck="false" inputmode="text">
          </div>
          <div class="recipe-field recipe-field-half">
            <label class="form-label" for="inventoryInvoiceImage">Adjuntar foto de factura/remito</label>
            <input id="inventoryInvoiceImage" class="form-control image-file-input" autocomplete="off" type="file" accept="image/*">
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
      state.editorDraft.customAcronym = nodes.editorForm.querySelector('#lotCustomAcronym')?.value || '';
      state.editorDraft.includeSeparator = Boolean(nodes.editorForm.querySelector('#lotIncludeSeparator')?.checked);
      state.editorDraft.separator = nodes.editorForm.querySelector('#lotSeparator')?.value || '-';
      state.editorDirty = true;
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

    nodes.editorForm.querySelectorAll('input:not([type="file"]),select,textarea').forEach((el) => {
      el.addEventListener('input', syncDraft);
      el.addEventListener('change', syncDraft);
    });

    nodes.editorForm.querySelector('#inventarioEntriesSearch')?.addEventListener('input', (event) => {
      state.tableSearch = event.target.value;
      state.tablePage = 1;
      renderEditor(ingredientId, state.editorDraft);
    });
    nodes.editorForm.querySelector('#inventarioEntriesRange')?.addEventListener('change', (event) => {
      state.tableDateRange = event.target.value;
      state.tablePage = 1;
      renderEditor(ingredientId, state.editorDraft);
    });

    nodes.editorForm.querySelector('#inventarioPrintFilteredBtn')?.addEventListener('click', async () => {
      await openPrintEntries(ingredient, getFilteredEntries(Array.isArray(record.entries) ? record.entries : []));
    });
    nodes.editorForm.querySelector('#inventarioPrintAllBtn')?.addEventListener('click', async () => {
      await openPrintEntries(ingredient, Array.isArray(record.entries) ? record.entries : []);
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

    nodes.editorForm.querySelectorAll('[data-open-invoice-image]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const entryId = btn.dataset.openInvoiceImage;
        const entriesWithImage = (record.entries || []).filter((item) => item.invoiceImageUrl);
        const idx = entriesWithImage.findIndex((item) => item.id === entryId);
        if (idx < 0) return;
        await openAttachmentViewer(entriesWithImage, idx, 'Factura / Remito');
      });
    });

    if (window.flatpickr) {
      const locale = window.flatpickr.l10ns?.es || undefined;
      window.flatpickr(nodes.editorForm.querySelector('#inventoryEntryDate'), { locale, dateFormat: 'Y-m-d', allowInput: true });
      window.flatpickr(nodes.editorForm.querySelector('#inventoryExpiryDate'), { locale, dateFormat: 'Y-m-d', allowInput: true, minDate: 'today' });
      const dayMap = getDayKgMap(Array.isArray(record.entries) ? record.entries : []);
      window.flatpickr(nodes.editorForm.querySelector('#inventarioEntriesRange'), {
        locale,
        mode: 'range',
        dateFormat: 'Y-m-d',
        allowInput: true,
        onDayCreate: (_dObj, _dStr, fp, dayElem) => {
          const date = dayElem.dateObj ? dayElem.dateObj.toISOString().slice(0, 10) : '';
          const kg = dayMap[date];
          if (kg) {
            const bubble = document.createElement('span');
            bubble.className = 'inventario-day-kg';
            bubble.textContent = `${kg}kg`;
            dayElem.appendChild(bubble);
          }
        }
      });
    }

    wireTokenDrag();
    renderPattern();
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
    const file = nodes.editorForm.querySelector('#inventoryInvoiceImage')?.files?.[0] || null;

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

    if (file) {
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
      let invoiceImageUrl = '';
      if (file) {
        invoiceImageUrl = await uploadImageToStorage(file, 'inventario/facturas');
      }

      const record = getRecord(ingredientId);
      const qtyKg = Number(convertToKg(qty, unit).toFixed(4));
      const entry = {
        id: makeId('entry'),
        qty: Number(qty.toFixed(2)),
        unit,
        qtyKg,
        entryDate,
        expiryDate,
        invoiceNumber,
        invoiceImageUrl,
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
      await persistInventario();
      state.editorDirty = false;
      state.tablePage = 1;
      renderEditor(ingredientId, {
        ...state.editorDraft,
        qty: '',
        invoiceNumber: '',
        expiryDate: new Date(Date.now() + (5 * 86400000)).toISOString().slice(0, 10),
        entryDate: new Date().toISOString().slice(0, 10)
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
    const familyBtn = event.target.closest('[data-inv-family-filter]');
    if (familyBtn) {
      state.activeFamilyId = familyBtn.dataset.invFamilyFilter;
      renderFamilies();
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
    nodes.families?.classList.toggle('d-none', enabled);
    nodes.list?.classList.toggle('d-none', enabled);
    nodes.periodView?.classList.toggle('d-none', !enabled);
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
          onDayCreate: (_dObj, _dStr, fp, dayElem) => {
            const date = dayElem.dateObj ? dayElem.dateObj.toISOString().slice(0, 10) : '';
            const kg = dayMapGlobal[date];
            if (kg) {
              const bubble = document.createElement('span');
              bubble.className = 'inventario-day-kg';
              bubble.textContent = `${kg}kg`;
              dayElem.appendChild(bubble);
            }
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
  nodes.list?.addEventListener('scroll', updateListScrollHint);
  nodes.configBtn?.addEventListener('click', openGlobalConfig);
  nodes.createIngredientBtn?.addEventListener('click', openCreateIngredient);
  nodes.toolbarCreateBtn?.addEventListener('click', openCreateIngredient);
  nodes.backBtn?.addEventListener('click', backToList);
  nodes.editorForm?.addEventListener('submit', saveEntry);

  nodes.openPeriodFilterBtn?.addEventListener('click', () => {
    setPeriodMode(true);
  });
  nodes.periodBackBtn?.addEventListener('click', () => {
    setPeriodMode(false);
  });
  nodes.globalApplyBtn?.addEventListener('click', async () => {
    state.dashboardDateRange = normalizeValue(nodes.globalRange?.value);
    nodes.globalLoading?.classList.remove('d-none');
    nodes.globalTableWrap?.classList.add('d-none');
    await new Promise((resolve) => setTimeout(resolve, 450));
    renderGlobalPeriodTable();
    nodes.globalLoading?.classList.add('d-none');
    nodes.globalTableWrap?.classList.remove('d-none');
  });
  nodes.globalPrintBtn?.addEventListener('click', async () => {
    await openPrintGlobalPeriod(getGlobalFilteredEntries());
  });
  nodes.globalTableWrap?.addEventListener('click', async (event) => {
    const btn = event.target.closest('[data-open-global-image]');
    if (!btn) return;
    await openAttachmentViewer([{ invoiceImageUrl: btn.dataset.openGlobalImage }], 0, 'Imagen del ingreso');
  });

  inventarioModal.addEventListener('hide.bs.modal', snapshotEditorDraft);
  inventarioModal.addEventListener('hidden.bs.modal', () => inventarioModal.removeAttribute('inert'));
  inventarioModal.addEventListener('show.bs.modal', loadInventario);
})();
