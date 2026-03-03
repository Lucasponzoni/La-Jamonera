(function inventarioModule() {
  const inventarioModal = document.getElementById('inventarioModal');
  if (!inventarioModal) return;

  const DEFAULT_LOW_THRESHOLD = 5;
  const DEFAULT_EXPIRING_SOON_DAYS = 2;
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
    backBtn: $('inventarioBackBtn')
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
    tableSearch: ''
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
    lotConfig: {
      configured: false,
      collapsed: false,
      tokens: ['fecha_ingreso', 'fecha_caducidad', 'cantidad', 'unidad']
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

  const stockStatusFor = (record) => {
    const stockKg = Number(record.stockKg) || 0;
    if (!record.hasEntries) return { label: 'Nunca ingresó stock', className: 'status-never' };
    if (stockKg <= 0) return { label: 'Sin stock', className: 'status-empty' };
    if (stockKg <= currentThresholdFor(record)) return { label: 'Stock bajo', className: 'status-low' };
    return { label: 'En stock', className: 'status-good' };
  };

  const isEntryExpiringSoon = (entry) => {
    const days = Number(state.inventario.config.expiringSoonDays || DEFAULT_EXPIRING_SOON_DAYS);
    const expiry = new Date(entry.expiryDate || '');
    if (Number.isNaN(expiry.getTime())) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    expiry.setHours(0, 0, 0, 0);
    const diffDays = Math.round((expiry.getTime() - today.getTime()) / 86400000);
    return diffDays >= 0 && diffDays <= days;
  };

  const sumExpiringSoonKg = (record) => (Array.isArray(record.entries) ? record.entries : [])
    .filter((entry) => isEntryExpiringSoon(entry))
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
      const threshold = currentThresholdFor(record);
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
            <p class="inventario-stock-line"><strong>${(Number(record.stockKg) || 0).toFixed(2)} kg</strong><span>Umbral bajo: ${threshold.toFixed(2)} kg ${record.lowThresholdKg != null ? '(personalizado)' : '(global)'}</span></p>
            <div class="inventario-actions-row">
              <button type="button" class="btn ios-btn ios-btn-success" data-inventario-open-editor="${item.id}"><i class="fa-solid fa-plus"></i><span>Ingresar Stock</span></button>
              <button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-inventario-config-item="${item.id}"><i class="fa-solid fa-sliders"></i><span>Umbral</span></button>
            </div>
          </div>
        </article>`;
    }).join('');

    updateListScrollHint();
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
      html: `<div class="text-start"><label class="form-label" for="itemLowThresholdInput">Umbral (kg)</label><input id="itemLowThresholdInput" class="swal2-input ios-input" type="number" min="0" step="0.01" value="${record.lowThresholdKg ?? ''}" placeholder="Vacío = usar global"></div>`,
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      cancelButtonText: 'Cancelar',
      preConfirm: () => {
        const raw = normalizeValue(document.getElementById('itemLowThresholdInput')?.value);
        if (!raw) return null;
        const num = parseNumber(raw);
        if (!Number.isFinite(num) || num < 0) {
          Swal.showValidationMessage('Ingresá un número válido.');
          return false;
        }
        return Number(num.toFixed(2));
      }
    });
    if (!result.isConfirmed) return;
    const next = getRecord(ingredientId);
    next.lowThresholdKg = result.value;
    state.inventario.items[ingredientId] = next;
    await persistInventario();
    renderList();
  };

  const buildLotSummaryBadges = (tokens) => {
    const labels = {
      fecha_ingreso: 'Fecha ingreso',
      fecha_caducidad: 'Fecha caducidad',
      cantidad: 'Cantidad',
      unidad: 'Unidad'
    };
    return tokens.map((token) => `<span class="inventario-config-badge">${labels[token] || token}</span>`).join('');
  };

  const renderEntryTable = (record) => {
    const search = normalizeLower(state.tableSearch);
    const source = Array.isArray(record.entries) ? [...record.entries] : [];
    const filtered = source.filter((entry) => {
      if (!search) return true;
      const blob = [entry.entryDate, entry.expiryDate, entry.invoiceNumber, entry.qty, entry.unit].map(normalizeLower).join(' ');
      return blob.includes(search);
    });

    const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    state.tablePage = Math.min(Math.max(1, state.tablePage), pages);
    const start = (state.tablePage - 1) * PAGE_SIZE;
    const pageRows = filtered.slice(start, start + PAGE_SIZE);

    const rowsHtml = pageRows.length ? pageRows.map((entry) => `
      <tr>
        <td>${entry.entryDate || '-'}</td>
        <td>${entry.expiryDate || '-'}</td>
        <td>${Number(entry.qty || 0).toFixed(2)} ${escapeHtml(entry.unit || '')}</td>
        <td>${escapeHtml(entry.invoiceNumber || '-')}</td>
        <td>${entry.invoiceImageUrl ? `<button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-open-invoice-image="${entry.id}"><i class="fa-regular fa-image"></i><span>Ver</span></button>` : '-'}</td>
      </tr>`).join('') : '<tr><td colspan="5" class="text-center">Sin ingresos para mostrar.</td></tr>';

    return `
      <div class="inventario-table-wrap">
        <div class="inventario-table-head">
          <input id="inventarioEntriesSearch" class="form-control ios-input" placeholder="Buscar en ingresos" value="${escapeHtml(state.tableSearch)}">
        </div>
        <div class="table-responsive">
          <table class="table recipe-table mb-0">
            <thead><tr><th>Fecha ingreso</th><th>Fecha caducidad</th><th>Cantidad</th><th>Nº factura/remito</th><th>Imagen</th></tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
        <div class="inventario-pagination">
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
    const expiringKg = sumExpiringSoonKg(record);

    const baseDraft = {
      qty: '',
      unit: 'kilos',
      entryDate: new Date().toISOString().slice(0, 10),
      expiryDate: '',
      invoiceNumber: '',
      invoiceImageFile: null,
      tokens: [...record.lotConfig.tokens]
    };
    state.editorDraft = { ...baseDraft, ...(draft || {}) };
    state.selectedIngredientId = ingredientId;
    state.editorDirty = false;
    setStateView('editor');
    nodes.editorTitle.textContent = `Inventario · ${capitalize(ingredient.name)}`;

    const configCollapsed = Boolean(record.lotConfig.configured || record.lotConfig.collapsed);
    const tokenLabels = {
      fecha_ingreso: 'Fecha de ingreso',
      fecha_caducidad: 'Fecha de caducidad',
      cantidad: 'Cantidad',
      unidad: 'Unidad'
    };

    nodes.editorForm.innerHTML = `
      <section class="inventario-product-head">
        <div class="inventario-product-head-main">
          ${ingredientAvatar(ingredient)}
          <div>
            <h6 class="inventario-editor-name">${capitalize(ingredient.name)}</h6>
            <p class="inventario-editor-meta">${capitalize(ingredient.description || 'Sin descripción')} · ${getMeasureLabel(ingredient.measure || 'kilos')}</p>
            <button type="button" id="inventarioEditIngredientBtn" class="btn ios-btn ios-btn-secondary"><i class="fa-solid fa-pen"></i><span>Editar ingrediente</span></button>
          </div>
        </div>
        <div class="inventario-product-head-stats">
          <div class="inventario-stat-card">
            <small>Stock total actual</small>
            <strong>${(Number(record.stockKg) || 0).toFixed(2)} kg</strong>
          </div>
          <div class="inventario-stat-card is-alert">
            <small>Próximos a caducar (${state.inventario.config.expiringSoonDays} días)</small>
            <strong>${expiringKg.toFixed(2)} kg</strong>
          </div>
        </div>
      </section>

      <section class="recipe-step-card step-block">
        <button type="button" class="inventario-collapse-head" id="lotConfigToggleBtn" aria-expanded="${!configCollapsed}">
          <span><span class="recipe-step-number">1</span> Configuración de lote</span>
          <span class="inventario-collapse-summary">${buildLotSummaryBadges(state.editorDraft.tokens)}</span>
        </button>
        <div id="lotConfigBody" class="step-content ${configCollapsed ? 'd-none' : ''}">
          <div class="inventario-lot-order" id="lotTokenOrder"></div>
          <code id="lotPatternPreview" class="inventario-lot-preview"></code>
        </div>
      </section>

      <section class="recipe-step-card step-block">
        <h6 class="step-title"><span class="recipe-step-number">2</span> Ingresar Stock</h6>
        <div class="step-content recipe-fields-flex">
          <div class="recipe-field recipe-field-half">
            <label class="form-label" for="inventoryQty">Cantidad a ingresar</label>
            <input id="inventoryQty" class="form-control ios-input" type="number" min="0" step="0.01" value="${state.editorDraft.qty}">
          </div>
          <div class="recipe-field recipe-field-half">
            <label class="form-label" for="inventoryUnit">Unidad</label>
            <select id="inventoryUnit" class="form-select ios-input">
              ${state.measures.map((m) => `<option value="${escapeHtml(m.name)}" ${measureKey(m.name) === measureKey(state.editorDraft.unit) ? 'selected' : ''}>${escapeHtml(getMeasureLabel(m.name))}</option>`).join('')}
              <option value="add_measure">+ Agregar medida</option>
            </select>
          </div>
          <div class="recipe-field recipe-field-half">
            <label class="form-label" for="inventoryEntryDate">Fecha de ingreso</label>
            <input id="inventoryEntryDate" class="form-control ios-input" value="${escapeHtml(state.editorDraft.entryDate)}" placeholder="Seleccionar fecha">
          </div>
          <div class="recipe-field recipe-field-half">
            <label class="form-label" for="inventoryExpiryDate">Fecha de caducidad</label>
            <input id="inventoryExpiryDate" class="form-control ios-input" value="${escapeHtml(state.editorDraft.expiryDate)}" placeholder="Seleccionar fecha">
          </div>
          <div class="recipe-field recipe-field-half">
            <label class="form-label" for="inventoryInvoiceNumber">Número de factura/remito</label>
            <input id="inventoryInvoiceNumber" class="form-control ios-input" value="${escapeHtml(state.editorDraft.invoiceNumber)}" placeholder="Ej: A-000123">
          </div>
          <div class="recipe-field recipe-field-half">
            <label class="form-label" for="inventoryInvoiceImage">Adjuntar foto de factura/remito</label>
            <input id="inventoryInvoiceImage" class="form-control" type="file" accept="image/*">
          </div>
        </div>
      </section>

      <section class="recipe-step-card step-block">
        <h6 class="step-title"><span class="recipe-step-number">3</span> Historial de ingresos</h6>
        ${renderEntryTable(record)}
      </section>

      <div class="recipe-table-actions">
        <button type="submit" id="saveInventoryBtn" class="btn ios-btn ios-btn-success recipe-table-action-btn recipe-table-action-btn-primary">
          <img src="./IMG/Meta-ai-logo.webp" alt="Guardando" class="meta-spinner-login d-none" id="saveInventorySpinner">
          <i class="fa-solid fa-floppy-disk" id="saveInventoryIcon"></i>
          <span>Guardar ingreso</span>
        </button>
      </div>`;

    const syncDraft = () => {
      state.editorDraft.qty = nodes.editorForm.querySelector('#inventoryQty')?.value || '';
      state.editorDraft.unit = nodes.editorForm.querySelector('#inventoryUnit')?.value || 'kilos';
      state.editorDraft.entryDate = nodes.editorForm.querySelector('#inventoryEntryDate')?.value || '';
      state.editorDraft.expiryDate = nodes.editorForm.querySelector('#inventoryExpiryDate')?.value || '';
      state.editorDraft.invoiceNumber = nodes.editorForm.querySelector('#inventoryInvoiceNumber')?.value || '';
      state.editorDirty = true;
    };

    const renderLotTokens = () => {
      const box = nodes.editorForm.querySelector('#lotTokenOrder');
      box.innerHTML = state.editorDraft.tokens.map((token) => `<button type="button" class="inventario-token-chip" draggable="true" data-token="${token}">${tokenLabels[token] || token}</button>`).join('');
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
          renderLotTokens();
          renderPattern();
        });
      });
    };

    const renderPattern = () => {
      nodes.editorForm.querySelector('#lotPatternPreview').textContent = state.editorDraft.tokens.map((token) => '${' + (tokenLabels[token] || token).replaceAll(' ', '_') + '}').join('');
      nodes.editorForm.querySelector('.inventario-collapse-summary').innerHTML = buildLotSummaryBadges(state.editorDraft.tokens);
    };

    nodes.editorForm.querySelector('#lotConfigToggleBtn')?.addEventListener('click', () => {
      const body = nodes.editorForm.querySelector('#lotConfigBody');
      const hidden = body.classList.toggle('d-none');
      nodes.editorForm.querySelector('#lotConfigToggleBtn').setAttribute('aria-expanded', String(!hidden));
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
        html: '<input id="newMeasureName" class="swal2-input ios-input" placeholder="Nombre"><input id="newMeasureAbbr" class="swal2-input ios-input" placeholder="Abreviatura">',
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

    nodes.editorForm.querySelectorAll('[data-entry-page]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.tablePage += btn.dataset.entryPage === 'next' ? 1 : -1;
        renderEditor(ingredientId, state.editorDraft);
      });
    });

    nodes.editorForm.querySelectorAll('[data-open-invoice-image]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const entryId = btn.dataset.openInvoiceImage;
        const entry = (record.entries || []).find((item) => item.id === entryId);
        if (!entry?.invoiceImageUrl) return;
        await openIosSwal({
          title: 'Factura / Remito',
          width: 860,
          html: `<div class="image-viewer-wrap"><img src="${entry.invoiceImageUrl}" alt="Factura o remito" class="attachment-image is-loaded"></div>`,
          confirmButtonText: 'Cerrar'
        });
      });
    });

    if (window.flatpickr) {
      const locale = window.flatpickr.l10ns?.es || undefined;
      window.flatpickr(nodes.editorForm.querySelector('#inventoryEntryDate'), { locale, dateFormat: 'Y-m-d', allowInput: true });
      window.flatpickr(nodes.editorForm.querySelector('#inventoryExpiryDate'), { locale, dateFormat: 'Y-m-d', allowInput: true });
    }

    renderLotTokens();
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
        configured: true,
        collapsed: true,
        tokens: [...state.editorDraft.tokens]
      };

      state.inventario.items[ingredientId] = record;
      await persistInventario();
      state.editorDirty = false;
      state.tablePage = 1;
      renderEditor(ingredientId, {
        ...state.editorDraft,
        qty: '',
        invoiceNumber: '',
        expiryDate: '',
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

  const loadInventario = async () => {
    setStateView('loading');
    try {
      await loadData();
      if (!Object.keys(state.ingredientes).length) {
        setStateView('empty');
        return;
      }
      setStateView('list');
      if (state.resumeEditor?.ingredientId && state.ingredientes[state.resumeEditor.ingredientId]) {
        renderEditor(state.resumeEditor.ingredientId, state.resumeEditor.draft || null);
      } else {
        renderFamilies();
        renderList();
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

  inventarioModal.addEventListener('hide.bs.modal', snapshotEditorDraft);
  inventarioModal.addEventListener('hidden.bs.modal', () => inventarioModal.removeAttribute('inert'));
  inventarioModal.addEventListener('show.bs.modal', loadInventario);
})();
