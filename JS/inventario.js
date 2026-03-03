(function inventarioModule() {
  const inventarioModal = document.getElementById('inventarioModal');
  if (!inventarioModal) return;

  const DEFAULT_LOW_THRESHOLD = 5;

  const state = {
    ingredientes: {},
    inventario: { config: { globalLowThresholdKg: DEFAULT_LOW_THRESHOLD }, items: {} },
    search: '',
    view: 'list',
    selectedIngredientId: '',
    editorDraft: null,
    editorDirty: false,
    resumeEditor: null
  };

  const $ = (id) => document.getElementById(id);
  const nodes = {
    loading: $('inventarioLoading'),
    empty: $('inventarioEmpty'),
    data: $('inventarioData'),
    list: $('inventarioList'),
    searchInput: $('inventarioSearchInput'),
    createIngredientBtn: $('inventarioCreateIngredientBtn'),
    toolbarCreateBtn: $('inventarioToolbarCreateIngredientBtn'),
    toolbarStockBtn: $('inventarioToolbarStockBtn'),
    configBtn: $('inventarioConfigBtn'),
    editorWrap: $('inventarioEditor'),
    editorForm: $('inventarioEditorForm'),
    editorTitle: $('inventarioEditorTitle'),
    backBtn: $('inventarioBackBtn')
  };

  const safeObject = (value) => (value && typeof value === 'object' ? value : {});
  const normalizeValue = (value) => String(value || '').trim();
  const normalizeLower = (value) => normalizeValue(value).toLowerCase();
  const capitalize = (value) => normalizeLower(value).replace(/(^|\s)\S/g, (ch) => ch.toUpperCase());
  const makeId = (prefix) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const parseNumber = (value) => {
    const normalized = normalizeValue(value).replace(',', '.');
    const number = Number(normalized);
    return Number.isFinite(number) ? number : NaN;
  };

  const blurActiveElement = () => {
    const active = document.activeElement;
    if (active && typeof active.blur === 'function') active.blur();
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

  const getDefaultRecord = (ingredientId) => ({
    ingredientId,
    stockKg: 0,
    hasEntries: false,
    entries: [],
    lowThresholdKg: null
  });

  const getRecord = (ingredientId) => ({ ...getDefaultRecord(ingredientId), ...safeObject(state.inventario.items[ingredientId]) });

  const currentThresholdFor = (record) => {
    const local = Number(record.lowThresholdKg);
    if (Number.isFinite(local) && local >= 0) return local;
    const global = Number(state.inventario.config.globalLowThresholdKg);
    return Number.isFinite(global) && global >= 0 ? global : DEFAULT_LOW_THRESHOLD;
  };

  const stockStatusFor = (record) => {
    const stockKg = Number(record.stockKg) || 0;
    if (!record.hasEntries) return { key: 'never', label: 'Nunca ingresó stock', className: 'status-never' };
    if (stockKg <= 0) return { key: 'empty', label: 'Sin stock', className: 'status-empty' };
    if (stockKg <= currentThresholdFor(record)) return { key: 'low', label: 'Stock bajo', className: 'status-low' };
    return { key: 'good', label: 'En stock', className: 'status-good' };
  };

  const persistInventario = async () => {
    await window.laJamoneraReady;
    await window.dbLaJamoneraRest.write('/inventario', state.inventario);
  };

  const loadData = async () => {
    await window.laJamoneraReady;
    const snapshot = await window.laJamoneraIngredientesAPI?.getIngredientesSnapshot?.();
    const inv = safeObject(await window.dbLaJamoneraRest.read('/inventario'));
    state.ingredientes = safeObject(snapshot?.items);
    state.inventario = {
      config: {
        globalLowThresholdKg: Number(inv?.config?.globalLowThresholdKg) >= 0 ? Number(inv.config.globalLowThresholdKg) : DEFAULT_LOW_THRESHOLD
      },
      items: safeObject(inv?.items)
    };
  };

  const filteredIngredients = () => Object.values(state.ingredientes)
    .filter((item) => {
      if (!state.search) return true;
      const text = [item.name, item.description, item.familyName, item.measure].map(normalizeLower).join(' ');
      return text.includes(state.search);
    })
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

  const renderList = () => {
    const items = filteredIngredients();
    const selectedId = state.selectedIngredientId;
    nodes.toolbarStockBtn.disabled = !selectedId;

    if (!items.length) {
      nodes.list.innerHTML = '<div class="ingrediente-empty-list">No encontramos ingredientes para inventario.</div>';
      updateListScrollHint();
      return;
    }

    nodes.list.innerHTML = items.map((item) => {
      const record = getRecord(item.id);
      const status = stockStatusFor(record);
      const threshold = currentThresholdFor(record);
      const selectedClass = selectedId === item.id ? 'is-selected' : '';
      return `
        <article class="ingrediente-card inventario-card ${status.className} ${selectedClass}" data-inventario-card="${item.id}">
          ${ingredientAvatar(item)}
          <div class="ingrediente-main">
            <div class="inventario-card-head">
              <h6 class="ingrediente-name">${capitalize(item.name)}</h6>
              <span class="inventario-status-badge">${status.label}</span>
            </div>
            <p class="ingrediente-meta">${capitalize(item.familyName)} · ${capitalize(item.measure || 'kilos')}</p>
            ${item.description ? `<p class="ingrediente-description">${item.description}</p>` : ''}
            <p class="inventario-stock-line">
              <strong>${(Number(record.stockKg) || 0).toFixed(2)} kg</strong>
              <span>Umbral bajo: ${threshold.toFixed(2)} kg ${record.lowThresholdKg != null ? '(personalizado)' : '(global)'}</span>
            </p>
            <div class="inventario-actions-row">
              <button type="button" class="btn ios-btn ios-btn-success" data-inventario-open-editor="${item.id}"><i class="fa-solid fa-plus"></i><span>Ingresar Stock</span></button>
              <button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-inventario-config-item="${item.id}"><i class="fa-solid fa-sliders"></i><span>Umbral</span></button>
            </div>
          </div>
        </article>
      `;
    }).join('');

    updateListScrollHint();
  };

  const openGlobalConfig = async () => {
    const result = await openIosSwal({
      title: 'Stock bajo global',
      html: `
        <div class="text-start">
          <label class="form-label" for="globalLowThresholdInput">Umbral global en Kg</label>
          <input id="globalLowThresholdInput" class="swal2-input ios-input" type="number" min="0" step="0.01" value="${Number(state.inventario.config.globalLowThresholdKg || DEFAULT_LOW_THRESHOLD)}">
          <p class="mb-0">Se usa cuando el producto no tiene un valor personalizado.</p>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      cancelButtonText: 'Cancelar',
      preConfirm: () => {
        const value = parseNumber(document.getElementById('globalLowThresholdInput')?.value);
        if (!Number.isFinite(value) || value < 0) {
          Swal.showValidationMessage('Ingresá un umbral válido mayor o igual a 0.');
          return false;
        }
        return Number(value.toFixed(2));
      }
    });

    if (!result.isConfirmed) return;
    state.inventario.config.globalLowThresholdKg = result.value;
    await persistInventario();
    renderList();
  };

  const openProductThresholdConfig = async (ingredientId) => {
    const ingredient = state.ingredientes[ingredientId];
    if (!ingredient) return;
    const record = getRecord(ingredientId);

    const result = await openIosSwal({
      title: `Umbral de ${capitalize(ingredient.name)}`,
      html: `
        <div class="text-start">
          <label class="form-label" for="itemLowThresholdInput">Umbral en Kg (opcional)</label>
          <input id="itemLowThresholdInput" class="swal2-input ios-input" type="number" min="0" step="0.01" value="${record.lowThresholdKg != null ? Number(record.lowThresholdKg) : ''}" placeholder="Vacío = usar global">
          <label class="report-notify-check mt-2">
            <input id="resetItemThresholdCheck" type="checkbox">
            <span>Usar configuración global</span>
          </label>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      cancelButtonText: 'Cancelar',
      preConfirm: () => {
        const reset = document.getElementById('resetItemThresholdCheck')?.checked;
        if (reset) return null;
        const raw = normalizeValue(document.getElementById('itemLowThresholdInput')?.value);
        if (!raw) return null;
        const value = parseNumber(raw);
        if (!Number.isFinite(value) || value < 0) {
          Swal.showValidationMessage('Ingresá un umbral válido o dejalo vacío.');
          return false;
        }
        return Number(value.toFixed(2));
      }
    });

    if (!result.isConfirmed) return;
    const next = getRecord(ingredientId);
    next.lowThresholdKg = result.value;
    state.inventario.items[ingredientId] = next;
    await persistInventario();
    renderList();
  };

  const tokenLabelMap = {
    remito_factura: 'Remito_Factura',
    fecha_fabricacion: 'fecha_fabricacion',
    fecha_hoy: 'fecha_hoy',
    siglas: 'siglas'
  };

  const buildLotPatternPreview = (tokens, separatorEnabled, separator) => {
    if (!tokens.length) return 'Sin variables seleccionadas';
    const joiner = separatorEnabled ? separator : '';
    return tokens.map((token) => '${' + tokenLabelMap[token] + '}').join(joiner);
  };

  const resolveTokenValue = (token, values) => {
    if (token === 'fecha_hoy') return new Date().toISOString().slice(0, 10);
    return normalizeValue(values[token] || '');
  };

  const renderEditor = (ingredientId, draft = null) => {
    const ingredient = state.ingredientes[ingredientId];
    if (!ingredient) return;

    const record = getRecord(ingredientId);
    const baseDraft = {
      qtyKg: '',
      remito_factura: '',
      fecha_fabricacion: '',
      siglas: '',
      separatorEnabled: false,
      separator: '-',
      tokens: ['remito_factura', 'fecha_fabricacion', 'fecha_hoy']
    };
    const activeDraft = { ...baseDraft, ...safeObject(record.lastLotConfig), ...safeObject(draft) };

    state.selectedIngredientId = ingredientId;
    state.editorDraft = activeDraft;
    state.editorDirty = false;
    setStateView('editor');
    nodes.editorTitle.textContent = `Ingresar stock · ${capitalize(ingredient.name)}`;

    nodes.editorForm.innerHTML = `
      <section class="step-block inventario-editor-product">
        <div class="inventario-editor-photo">${ingredientAvatar(ingredient)}</div>
        <h6 class="inventario-editor-name">${capitalize(ingredient.name)}</h6>
        <p class="inventario-editor-meta">${capitalize(ingredient.description || 'Sin descripción')} · ${capitalize(ingredient.measure || 'kilos')}</p>
        <button type="button" id="inventarioEditIngredientBtn" class="btn ios-btn ios-btn-secondary"><i class="fa-solid fa-pen"></i><span>Editar ingrediente</span></button>
      </section>

      <section class="recipe-step-card step-block">
        <h6 class="step-title"><span class="recipe-step-number">1</span> Movimiento de stock</h6>
        <div class="step-content recipe-fields-flex">
          <div class="recipe-field recipe-field-half">
            <label class="form-label" for="inventoryQtyKg">Cantidad a ingresar (kg)</label>
            <input id="inventoryQtyKg" class="form-control ios-input" type="number" min="0" step="0.01" value="${activeDraft.qtyKg}">
          </div>
          <div class="recipe-field recipe-field-half">
            <label class="form-label">Stock actual</label>
            <input class="form-control ios-input" type="text" value="${(Number(record.stockKg) || 0).toFixed(2)} kg" disabled>
          </div>
        </div>
      </section>

      <section class="recipe-step-card step-block">
        <h6 class="step-title"><span class="recipe-step-number">2</span> Configuración de lote</h6>
        <div class="step-content inventario-lot-grid">
          <label class="report-notify-check"><input id="checkRemito" type="checkbox"><span>Remito o Factura</span></label>
          <input id="fieldRemito" class="form-control ios-input" placeholder="Ej: R-000123" value="${activeDraft.remito_factura}">

          <label class="report-notify-check"><input id="checkFabricacion" type="checkbox"><span>Fecha de fabricación</span></label>
          <input id="fieldFabricacion" class="form-control ios-input" type="date" value="${activeDraft.fecha_fabricacion}">

          <label class="report-notify-check"><input id="checkHoy" type="checkbox"><span>Fecha de hoy</span></label>
          <input class="form-control ios-input" type="text" value="${new Date().toLocaleDateString('es-AR')}" disabled>

          <label class="report-notify-check"><input id="checkSiglas" type="checkbox"><span>Siglas personalizadas</span></label>
          <input id="fieldSiglas" class="form-control ios-input" placeholder="Ej: LJ" value="${activeDraft.siglas}">
        </div>

        <div class="inventario-lot-separator">
          <label class="report-notify-check"><input id="checkSeparator" type="checkbox"><span>Incluir separadores</span></label>
          <select id="separatorSelect" class="form-select ios-input">
            <option value="-">-</option><option value="_">_</option><option value=",">,</option><option value=";">;</option><option value="|">|</option><option value=".">.</option>
          </select>
        </div>

        <div>
          <p class="inventario-lot-subtitle">Orden de variables (arrastrá para reordenar)</p>
          <div id="lotTokenOrder" class="inventario-lot-order"></div>
        </div>

        <div class="inventario-lot-preview-wrap">
          <p class="inventario-lot-subtitle">Patrón</p>
          <code id="lotPatternPreview" class="inventario-lot-preview"></code>
          <p class="inventario-lot-subtitle mt-2">Resultado</p>
          <code id="lotResultPreview" class="inventario-lot-preview"></code>
        </div>
      </section>

      <div class="recipe-table-actions">
        <button type="submit" class="btn ios-btn ios-btn-success recipe-table-action-btn recipe-table-action-btn-primary" id="saveInventoryBtn">
          <img src="./IMG/Meta-ai-logo.webp" alt="Guardando" class="meta-spinner-login d-none" id="saveInventorySpinner">
          <i class="fa-solid fa-floppy-disk" id="saveInventoryIcon"></i>
          <span>Guardar ingreso</span>
        </button>
      </div>
    `;

    const tokenOrder = nodes.editorForm.querySelector('#lotTokenOrder');
    const tokenChecks = {
      remito_factura: nodes.editorForm.querySelector('#checkRemito'),
      fecha_fabricacion: nodes.editorForm.querySelector('#checkFabricacion'),
      fecha_hoy: nodes.editorForm.querySelector('#checkHoy'),
      siglas: nodes.editorForm.querySelector('#checkSiglas')
    };

    const syncDraftFromInputs = () => {
      state.editorDraft.qtyKg = nodes.editorForm.querySelector('#inventoryQtyKg').value;
      state.editorDraft.remito_factura = nodes.editorForm.querySelector('#fieldRemito').value;
      state.editorDraft.fecha_fabricacion = nodes.editorForm.querySelector('#fieldFabricacion').value;
      state.editorDraft.siglas = nodes.editorForm.querySelector('#fieldSiglas').value;
      state.editorDraft.separatorEnabled = nodes.editorForm.querySelector('#checkSeparator').checked;
      state.editorDraft.separator = nodes.editorForm.querySelector('#separatorSelect').value;
      state.editorDirty = true;
    };

    const renderTokenOrder = () => {
      const selectedTokens = state.editorDraft.tokens.filter((token) => tokenChecks[token]?.checked);
      tokenOrder.innerHTML = selectedTokens.length ? selectedTokens.map((token) => `
        <button type="button" class="inventario-token-chip" draggable="true" data-token="${token}">${tokenLabelMap[token]}</button>
      `).join('') : '<p class="mb-0">Seleccioná variables para construir el lote.</p>';

      tokenOrder.querySelectorAll('.inventario-token-chip').forEach((chip) => {
        chip.addEventListener('dragstart', (event) => {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', chip.dataset.token);
          chip.classList.add('is-dragging');
        });
        chip.addEventListener('dragend', () => chip.classList.remove('is-dragging'));
        chip.addEventListener('dragover', (event) => event.preventDefault());
        chip.addEventListener('drop', (event) => {
          event.preventDefault();
          const source = event.dataTransfer.getData('text/plain');
          const target = chip.dataset.token;
          if (!source || source === target) return;
          const order = [...state.editorDraft.tokens];
          const sourceIndex = order.indexOf(source);
          const targetIndex = order.indexOf(target);
          if (sourceIndex < 0 || targetIndex < 0) return;
          order.splice(sourceIndex, 1);
          order.splice(targetIndex, 0, source);
          state.editorDraft.tokens = order;
          state.editorDirty = true;
          renderTokenOrder();
          renderLotPreview();
        });
      });
    };

    const renderLotPreview = () => {
      const selectedTokens = state.editorDraft.tokens.filter((token) => tokenChecks[token]?.checked);
      const pattern = buildLotPatternPreview(selectedTokens, state.editorDraft.separatorEnabled, state.editorDraft.separator);
      nodes.editorForm.querySelector('#lotPatternPreview').textContent = pattern;
      const joiner = state.editorDraft.separatorEnabled ? state.editorDraft.separator : '';
      const values = selectedTokens.map((token) => resolveTokenValue(token, state.editorDraft));
      nodes.editorForm.querySelector('#lotResultPreview').textContent = values.filter(Boolean).join(joiner) || '—';
    };

    Object.keys(tokenChecks).forEach((token) => {
      tokenChecks[token].checked = state.editorDraft.tokens.includes(token);
      tokenChecks[token].addEventListener('change', () => {
        if (tokenChecks[token].checked) {
          if (!state.editorDraft.tokens.includes(token)) state.editorDraft.tokens.push(token);
        } else {
          state.editorDraft.tokens = state.editorDraft.tokens.filter((item) => item !== token);
        }
        state.editorDirty = true;
        renderTokenOrder();
        renderLotPreview();
      });
    });

    nodes.editorForm.querySelector('#checkSeparator').checked = Boolean(state.editorDraft.separatorEnabled);
    nodes.editorForm.querySelector('#separatorSelect').value = state.editorDraft.separator || '-';

    nodes.editorForm.querySelectorAll('input,select,textarea').forEach((input) => {
      input.addEventListener('input', () => {
        syncDraftFromInputs();
        renderLotPreview();
      });
      input.addEventListener('change', () => {
        syncDraftFromInputs();
        renderLotPreview();
      });
    });

    nodes.editorForm.querySelector('#inventarioEditIngredientBtn').addEventListener('click', async () => {
      blurActiveElement();
      inventarioModal.setAttribute('inert', '');
      try {
        await window.laJamoneraIngredientesAPI?.openIngredientForm?.(state.ingredientes[ingredientId]);
      } finally {
        inventarioModal.removeAttribute('inert');
      }
      await loadData();
      renderEditor(ingredientId, state.editorDraft);
    });

    renderTokenOrder();
    renderLotPreview();
  };

  const backToList = async () => {
    if (state.editorDirty) {
      const answer = await openIosSwal({
        title: '¿Abandonar cambios?',
        html: '<p>Hay cambios sin guardar en el ingreso de stock.</p>',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Abandonar',
        cancelButtonText: 'Seguir editando'
      });
      if (!answer.isConfirmed) return;
    }
    state.editorDirty = false;
    state.editorDraft = null;
    state.resumeEditor = null;
    setStateView('list');
    renderList();
  };

  const handleSaveEditor = async (event) => {
    event.preventDefault();
    if (!state.selectedIngredientId) return;

    const qty = parseNumber(nodes.editorForm.querySelector('#inventoryQtyKg')?.value);
    if (!Number.isFinite(qty) || qty < 0) {
      await openIosSwal({ title: 'Dato inválido', html: '<p>Ingresá una cantidad válida en kg.</p>', icon: 'warning', confirmButtonText: 'Entendido' });
      return;
    }

    const selectedTokens = state.editorDraft.tokens.filter((token) => nodes.editorForm.querySelector({
      remito_factura: '#checkRemito', fecha_fabricacion: '#checkFabricacion', fecha_hoy: '#checkHoy', siglas: '#checkSiglas'
    }[token])?.checked);

    if (!selectedTokens.length) {
      await openIosSwal({ title: 'Lote incompleto', html: '<p>Seleccioná al menos una variable para el lote.</p>', icon: 'warning', confirmButtonText: 'Entendido' });
      return;
    }

    if (selectedTokens.includes('remito_factura') && !normalizeValue(nodes.editorForm.querySelector('#fieldRemito')?.value)) {
      await openIosSwal({ title: 'Falta remito/factura', html: '<p>Completá Remito o Factura.</p>', icon: 'warning', confirmButtonText: 'Entendido' });
      return;
    }

    const spinner = nodes.editorForm.querySelector('#saveInventorySpinner');
    const icon = nodes.editorForm.querySelector('#saveInventoryIcon');
    const saveBtn = nodes.editorForm.querySelector('#saveInventoryBtn');
    saveBtn.setAttribute('disabled', 'disabled');
    spinner?.classList.remove('d-none');
    icon?.classList.add('d-none');

    try {
      const record = getRecord(state.selectedIngredientId);
      const separatorEnabled = nodes.editorForm.querySelector('#checkSeparator')?.checked;
      const separator = nodes.editorForm.querySelector('#separatorSelect')?.value || '-';
      const values = {
        remito_factura: nodes.editorForm.querySelector('#fieldRemito')?.value,
        fecha_fabricacion: nodes.editorForm.querySelector('#fieldFabricacion')?.value,
        fecha_hoy: new Date().toISOString().slice(0, 10),
        siglas: nodes.editorForm.querySelector('#fieldSiglas')?.value
      };
      const lotCode = selectedTokens.map((token) => resolveTokenValue(token, values)).filter(Boolean).join(separatorEnabled ? separator : '');

      const entry = {
        id: makeId('stock'),
        qtyKg: Number(qty.toFixed(2)),
        createdAt: Date.now(),
        lotCode,
        tokens: selectedTokens,
        separatorEnabled,
        separator,
        values
      };

      record.entries = Array.isArray(record.entries) ? record.entries : [];
      record.entries.unshift(entry);
      record.stockKg = Number(((Number(record.stockKg) || 0) + entry.qtyKg).toFixed(2));
      record.hasEntries = true;
      record.lastLotConfig = {
        remito_factura: values.remito_factura,
        fecha_fabricacion: values.fecha_fabricacion,
        siglas: values.siglas,
        separatorEnabled,
        separator,
        tokens: selectedTokens
      };

      state.inventario.items[state.selectedIngredientId] = record;
      await persistInventario();
      state.editorDirty = false;
      state.editorDraft = null;
      state.resumeEditor = null;
      setStateView('list');
      renderList();
      window.laJamoneraNotify?.show?.({ type: 'success', title: 'Stock actualizado', message: 'El ingreso de stock se guardó correctamente.' });
    } finally {
      saveBtn.removeAttribute('disabled');
      spinner?.classList.add('d-none');
      icon?.classList.remove('d-none');
    }
  };

  const snapshotEditorDraft = () => {
    if (state.view !== 'editor' || !state.selectedIngredientId || !state.editorDraft) return;
    state.resumeEditor = {
      ingredientId: state.selectedIngredientId,
      draft: { ...state.editorDraft }
    };
  };

  const openCreateIngredient = async () => {
    blurActiveElement();
    inventarioModal.setAttribute('inert', '');
    try {
      await window.laJamoneraIngredientesAPI?.openIngredientForm?.();
    } finally {
      inventarioModal.removeAttribute('inert');
    }
    await loadData();
    setStateView(Object.keys(state.ingredientes).length ? 'list' : 'empty');
    renderList();
  };

  const handleListClick = async (event) => {
    const card = event.target.closest('[data-inventario-card]');
    if (card) {
      state.selectedIngredientId = card.dataset.inventarioCard;
      renderList();
    }

    const openEditorBtn = event.target.closest('[data-inventario-open-editor]');
    if (openEditorBtn) {
      renderEditor(openEditorBtn.dataset.inventarioOpenEditor);
      return;
    }

    const configBtn = event.target.closest('[data-inventario-config-item]');
    if (configBtn) {
      await openProductThresholdConfig(configBtn.dataset.inventarioConfigItem);
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
  nodes.list?.addEventListener('scroll', updateListScrollHint);
  nodes.list?.addEventListener('click', handleListClick);
  nodes.configBtn?.addEventListener('click', openGlobalConfig);
  nodes.createIngredientBtn?.addEventListener('click', openCreateIngredient);
  nodes.toolbarCreateBtn?.addEventListener('click', openCreateIngredient);
  nodes.toolbarStockBtn?.addEventListener('click', () => {
    if (!state.selectedIngredientId) return;
    renderEditor(state.selectedIngredientId);
  });
  nodes.backBtn?.addEventListener('click', backToList);
  nodes.editorForm?.addEventListener('submit', handleSaveEditor);

  inventarioModal.addEventListener('hide.bs.modal', () => {
    snapshotEditorDraft();
    blurActiveElement();
  });

  inventarioModal.addEventListener('hidden.bs.modal', () => {
    blurActiveElement();
    inventarioModal.removeAttribute('inert');
  });

  inventarioModal.addEventListener('show.bs.modal', loadInventario);
})();
