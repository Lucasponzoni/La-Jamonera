(function repartosModule() {
  window.initProduccionRepartos = function initProduccionRepartos(ctx) {
    const {
      state, nodes,
      safeObject, normalizeValue, normalizeLower, nowTs, makeId, toIsoDate, formatIsoToDmyCompact,
      getDispatchRecordsList, getRegistrosList, getProducedStockMeta, getCurrentUserLabel,
      sanitizeImageUrl, capitalize, escapeHtml, formatDateTime, formatIsoEs,
      openIosSwal, updateProduccionListScrollHint,
      renderUserAvatar, initialsFromPersonName, getDispatchUserRole, prepareThumbLoaders,
      uploadImageToStorage, ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_SIZE_BYTES, ARG_PROVINCIAS,
      REPARTO_PATH,
    } = ctx;

  const getDispatchClient = (clientId) => safeObject(state.reparto.clients?.[clientId]);
  const getDispatchVehicle = (vehicleId) => safeObject(state.reparto.vehicles?.[vehicleId]);
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
  const setDispatchMode = (enabled) => {
    state.dispatchMode = enabled;
    if (enabled) state.historyMode = false;
    nodes.search?.closest('.produccion-toolbar')?.classList.toggle('d-none', enabled);
    nodes.rneAlert?.classList.toggle('d-none', enabled || !getRneExpiryMeta().visible);
    nodes.list?.classList.toggle('d-none', enabled);
    nodes.historyView?.classList.toggle('d-none', true);
    nodes.dispatchView?.classList.toggle('d-none', !enabled);
  };
  const getDispatchRows = () => {
    const all = getDispatchRecordsList().sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    const query = normalizeLower(state.dispatchSearch);
    const [from, to] = String(state.dispatchRange || '').split(' a ').map((item) => normalizeValue(item));
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
      const client = getDispatchClient(row.clientId);
      const collapsed = state.dispatchCollapse[row.id] !== false;
      const detail = !collapsed ? products.map((item) => `<tr class="inventario-trace-row"><td><div class="inventario-trace-main"><img src="./IMG/Octicons-git-merge.svg" alt="merge" class="inventario-trace-icon"><span class="inventario-trace-avatar">${item.recipeImageUrl ? `<img class="thumb-image" src="${escapeHtml(item.recipeImageUrl)}" alt="${escapeHtml(item.recipeTitle)}">` : '<i class="fa-solid fa-drumstick-bite"></i>'}</span><span class="inventario-trace-label">${escapeHtml(item.recipeTitle || '-')}</span></div></td><td>${Number(item.qtyKg || 0).toFixed(2)} kg</td><td>${(Array.isArray(item.allocations) ? item.allocations : []).map((a) => `${escapeHtml(a.lotNumber)} · ${Number(a.qtyKg || 0).toFixed(2)} kg`).join('<br>') || '-'}</td><td>${(Array.isArray(item.allocations) ? item.allocations : []).map((a) => escapeHtml(formatIsoEs(a.expiryDate || ''))).join('<br>') || '-'}</td><td colspan="3">${(Array.isArray(item.allocations) ? item.allocations : []).map((a) => `<small>${escapeHtml(a.productionId)}</small>`).join('<br>')}</td></tr>`).join('') : '';
      return `<tr class="inventario-row-tone ${index % 2 === 0 ? 'is-even-row' : 'is-odd-row'}"><td>${escapeHtml(formatDateTime(row.createdAt))}</td><td>${products.length} productos</td><td>${kgTotal.toFixed(2)} kg</td><td>${escapeHtml(expiryLabel)}</td><td>${escapeHtml(row.code || row.id || '-')}</td><td>${escapeHtml(client.name || '-')}</td><td><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-dispatch-collapse="${escapeHtml(row.id)}" title="${collapsed ? 'Descolapsar' : 'Colapsar'}" aria-label="${collapsed ? 'Descolapsar' : 'Colapsar'}"><i class="fa-solid ${collapsed ? 'fa-expand' : 'fa-compress'}"></i></button></td></tr>${detail}`;
    }).join('') : '<tr><td colspan="7" class="text-center">Sin repartos para el filtro seleccionado.</td></tr>';
    const tableWrap = nodes.dispatchView.querySelector('#produccionDispatchTableWrap');
    if (!tableWrap) return;
    tableWrap.innerHTML = `<div class="inventario-print-row mb-2 inventario-trace-toolbar toolbar-scroll-x"><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" id="inventarioGlobalCollapseAllRowsBtn" ${canCollapse ? '' : 'disabled'}><i class="fa-solid fa-compress"></i><span>Colapsar todo</span></button><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" id="inventarioGlobalExpandAllRowsBtn" ${canExpand ? '' : 'disabled'}><i class="fa-solid fa-expand"></i><span>Descolapsar todo</span></button></div><div class="table-responsive inventario-global-table inventario-table-compact-wrap"><table class="table recipe-table inventario-table-compact mb-0"><thead><tr><th>Fecha de reparto</th><th>Productos</th><th>Cantidad</th><th>Vencimiento</th><th>Número de reparto</th><th>Cliente</th><th>Acción</th></tr></thead><tbody>${htmlRows}</tbody></table></div><div class="inventario-pagination enhanced"><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn inventario-page-btn" data-dispatch-page="prev" ${state.dispatchPage <= 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-left"></i></button><span>Página ${state.dispatchPage} de ${pages}</span><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn inventario-page-btn" data-dispatch-page="next" ${state.dispatchPage >= pages ? 'disabled' : ''}><i class="fa-solid fa-chevron-right"></i></button></div>`;
  };
  const renderDispatchMain = () => {
    if (!nodes.dispatchView) return;
    state.dispatchCreateMode = false;
    nodes.dispatchView.innerHTML = `<div class="inventario-period-head produccion-dispatch-head"><button id="produccionDispatchBackBtn" type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn"><i class="fa-solid fa-arrow-left"></i><span>Volver</span></button><h6 class="step-title mb-0">Salida de Productos</h6><button id="produccionDispatchNewBtn" type="button" class="btn ios-btn ios-btn-success inventario-threshold-btn"><i class="bi bi-plus-lg"></i><span>Nuevo reparto</span></button></div><div class="inventario-period-filters"><input id="produccionDispatchSearch" type="search" class="form-control ios-input produccion-dispatch-filter" placeholder="Buscar reparto, cliente o producto" value="${escapeHtml(state.dispatchSearch)}"><input id="produccionDispatchRange" class="form-control ios-input produccion-dispatch-filter" placeholder="Seleccionar rango de fechas" value="${escapeHtml(state.dispatchRange)}"><div class="toolbar-scroll-x inventario-period-actions-scroll"><button id="produccionDispatchClearBtn" type="button" class="btn ios-btn inventario-delete-btn inventario-threshold-btn ${state.dispatchRange ? '' : 'd-none'}"><i class="fa-solid fa-xmark"></i><span>Limpiar filtro</span></button><button id="produccionDispatchApplyBtn" type="button" class="btn ios-btn ios-btn-primary inventario-threshold-btn"><i class="fa-solid fa-filter"></i><span>Aplicar</span></button><button id="produccionDispatchExpandBtn" type="button" class="btn ios-btn inventario-expand-btn inventario-threshold-btn"><i class="fa-solid fa-up-right-and-down-left-from-center"></i><span>Ampliar tabla</span></button><button id="produccionDispatchExcelBtn" type="button" class="btn ios-btn ios-btn-success inventario-threshold-btn"><i class="fa-solid fa-file-excel"></i><span>Excel</span></button><span class="inventario-period-divider" aria-hidden="true"></span><button id="produccionDispatchPrintBtn" type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn"><i class="fa-solid fa-print"></i><span>Imprimir período</span></button><button id="produccionDispatchMassBtn" type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn"><i class="fa-regular fa-file-lines"></i><span>Planillas masivas</span></button></div></div><div id="produccionDispatchTableWrap"></div>`;
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
    renderDispatchHistoryTable();
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
    managers: [],
    vehicleId: ''
  });
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
      const requestedKg = Number(line.qtyKg || 0);
      const availableKg = Number(getProducedStockMeta(line.recipeId).available || 0);
      const stockStatus = normalizeValue(line.recipeId)
        ? (requestedKg <= 0
          ? `<span class="produccion-dispatch-ok"><i class="fa-solid fa-circle-check"></i> <strong>Disponible:</strong> ${availableKg.toFixed(2)} kg</span>`
          : (alloc.hasStock
            ? `<span class="produccion-dispatch-ok"><i class="fa-solid fa-circle-check"></i> <strong>Disponible:</strong> ${availableKg.toFixed(2)} kg · <strong>Usás:</strong> ${requestedKg.toFixed(2)} kg</span>`
            : (availableKg > 0.0001
              ? `<span class="produccion-dispatch-missing"><i class="fa-solid fa-circle-exclamation"></i> <strong>Disponible:</strong> ${availableKg.toFixed(2)} kg · <strong>Faltan:</strong> ${alloc.missingKg.toFixed(2)} kg</span>`
              : '<span class="produccion-dispatch-missing"><i class="fa-solid fa-circle-xmark"></i> <strong>Sin stock disponible.</strong></span>')))
        : '<span class="text-muted">Seleccionar producto.</span>';
      const lotsText = alloc.allocations.map((lot) => `${escapeHtml(lot.lotNumber)} · ${Number(lot.qtyKg || 0).toFixed(2)} kg`).join('<br>') || '-';
      const expiries = [...new Set(alloc.allocations.map((lot) => normalizeValue(lot.expiryDate)).filter(Boolean))];
      const expiryText = expiries.length === 1 ? escapeHtml(formatIsoEs(expiries[0])) : (expiries.length ? expiries.map((item) => escapeHtml(formatIsoEs(item))).join('<br>') : '-');
      const recipe = safeObject(state.recetas[line.recipeId]);
      const recipeTitle = normalizeValue(line.recipeSearch || recipe.title);
      const recipeImage = sanitizeImageUrl(recipe.imageUrl);
      return `<tr><td><div class="recipe-ing-autocomplete" data-dispatch-product-wrap="${idx}"><div class="recipe-ing-input-wrap dispatch-product-input-wrap"><span class="recipe-inline-avatar-wrap">${recipeImage ? `<span class="thumb-loading"><img class="meta-spinner-login" src="./IMG/Meta-ai-logo.webp" alt="Cargando"></span><img class="recipe-inline-avatar js-dispatch-inline-thumb dispatch-fit-image" src="${escapeHtml(recipeImage)}" alt="${escapeHtml(recipeTitle || 'Producto')}">` : '<span class="image-placeholder-circle-2"><i class="fa-solid fa-drumstick-bite"></i></span>'}</span><input type="search" class="form-control ios-input dispatch-product-search-input" data-dispatch-product-search="${idx}" placeholder="Seleccionar producto" value="${escapeHtml(recipeTitle)}"></div><input type="hidden" data-dispatch-product-id="${idx}" value="${escapeHtml(line.recipeId)}"></div></td><td><input class="form-control ios-input" type="number" step="0.01" min="0" data-dispatch-qty="${idx}" value="${escapeHtml(line.qtyKg || '')}"></td><td>${stockStatus}</td><td>${lotsText}</td><td>${expiryText}</td><td><button type="button" class="btn family-manage-btn" data-dispatch-remove="${idx}"><i class="fa-solid fa-trash"></i></button></td></tr>`;
    }).join('');
    nodes.dispatchView.innerHTML = `<div class="inventario-period-head"><button id="produccionDispatchBackToListBtn" type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn"><i class="fa-solid fa-arrow-left"></i><span>Volver</span></button><h6 class="step-title mb-0">Nuevo reparto</h6></div>
    <section class="recipe-step-card step-block"><h6 class="step-title"><span class="recipe-step-number">1</span> Datos generales</h6><div class="step-content recipe-fields-flex"><div class="recipe-field recipe-field-half"><label class="form-label">Día de reparto</label><input id="dispatchDateInput" class="form-control ios-input" value="${escapeHtml(draft.dispatchDate)}"></div><div class="recipe-field recipe-field-half"><label class="form-label">Cliente</label><div class="inventario-provider-search-wrap"><input id="dispatchClientInput" class="form-control ios-input" placeholder="Buscar por nombre, DNI o CUIL" value="${escapeHtml(draft.clientName)}"><input type="hidden" id="dispatchClientId" value="${escapeHtml(draft.clientId)}"></div><small class="text-muted">Si no existe, seleccioná Nuevo Cliente.</small></div><div class="recipe-field recipe-field-half"><label class="form-label">Dirección de reparto</label><input id="dispatchClientAddressInput" class="form-control ios-input" placeholder="Dirección" value="${escapeHtml(draft.clientAddress || '')}" ${draft.clientId ? '' : 'disabled'}></div><div class="recipe-field recipe-field-half"><label class="form-label">Localidad</label><input id="dispatchClientCityInput" class="form-control ios-input" placeholder="Localidad" value="${escapeHtml(draft.clientCity || '')}" ${draft.clientId ? '' : 'disabled'}></div><div class="recipe-field recipe-field-half"><label class="form-label">Provincia</label><select id="dispatchClientProvinceInput" class="form-select ios-input" ${draft.clientId ? '' : 'disabled'}>${ARG_PROVINCIAS.map((item) => `<option value="${escapeHtml(item)}" ${normalizeValue(draft.clientProvince || 'Santa Fe') === item ? 'selected' : ''}>${escapeHtml(item)}</option>`).join('')}</select></div><div class="recipe-field recipe-field-half"><label class="form-label">País</label><input id="dispatchClientCountryInput" class="form-control ios-input" value="${escapeHtml(draft.clientCountry || 'Argentina')}" ${draft.clientId ? '' : 'disabled'}></div></div></section>
    <section class="recipe-step-card step-block produccion-dispatch-create"><div class="d-flex align-items-center justify-content-between mb-2"><h6 class="step-title mb-0"><span class="recipe-step-number">2</span> Productos a repartir</h6></div><div class="table-responsive recipe-table-wrap dispatch-products-table"><table class="table recipe-table inventario-bulk-table mb-0"><thead><tr><th>Producto</th><th>Kilos</th><th>Stock</th><th>Lote</th><th>Vencimiento</th><th></th></tr></thead><tbody>${lineRows}${draft.comments.map((comment, idx) => `<tr class="inventario-bulk-comment-row"><td colspan="5"><input class="form-control ios-input" data-dispatch-comment="${idx}" placeholder="Comentario visual (no afecta stock)" value="${escapeHtml(comment)}"></td><td><button type="button" class="btn family-manage-btn" data-dispatch-remove-comment="${idx}"><i class="fa-solid fa-trash"></i></button></td></tr>`).join('')}</tbody></table></div><div class="dispatch-actions-row mt-2"><button type="button" class="btn ios-btn ios-btn-success recipe-table-action-btn" id="dispatchAddProductBtn"><i class="fa-solid fa-plus"></i><span>Producto</span></button><button type="button" class="btn recipe-table-action-btn recipe-table-action-btn-neutral" id="dispatchAddCommentBtn" data-add-comment-row=""><i class="fa-regular fa-message"></i><span>Comentario</span></button></div></section>
    <section class="recipe-step-card step-block"><h6 class="step-title"><span class="recipe-step-number">3</span> Vehículo y responsables</h6><div class="step-content recipe-fields-flex"><div class="recipe-field recipe-field-half"><label class="form-label">UTA / URA</label><small class="d-block text-muted mb-1">Elegí la unidad de transporte habilitada para el reparto (UTA/URA).</small><select id="dispatchVehicleSelect" class="form-select ios-input"><option value="">Seleccionar UTA/URA</option>${Object.values(safeObject(state.reparto.vehicles)).map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === draft.vehicleId ? 'selected' : ''}>${escapeHtml(item.number || item.patent || item.id)}</option>`).join('')}<option value="add_vehicle">+ URA/UTA</option></select></div><div class="recipe-field recipe-field-half"><label class="form-label">Responsables</label><div class="produccion-managers-grid">${Object.values(safeObject(state.users)).map((user) => `<label class="produccion-user-check"><input type="checkbox" data-dispatch-manager="${escapeHtml(user.id)}" ${draft.managers.includes(user.id) ? 'checked' : ''}>${renderUserAvatar(user)}<span class="produccion-user-text"><strong>${escapeHtml(user.fullName || user.email || user.id)}</strong><small>${escapeHtml(getDispatchUserRole(user))}</small></span></label>`).join('')}</div></div></div></section><div class="produccion-config-actions"><button type="button" class="btn ios-btn ios-btn-primary" id="dispatchSaveBtn"><i class="fa-solid fa-floppy-disk"></i><span>Guardar reparto</span></button></div>`;
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
  const openCreateDispatchClient = async (seedName = '') => {
    const result = await openIosSwal({
      title: 'Nuevo cliente',
      customClass: { popup: 'dispatch-client-alert' },
      html: `<div class="swal-stack-fields text-start"><div class="dispatch-client-preview"><span id="dispatchClientInitialsPreview" class="user-avatar-thumb dispatch-client-preview-avatar">${initialsFromPersonName(seedName) || '<i class=\"bi bi-person-fill\"></i>'}</span></div><input id="dispatchClientName" class="swal2-input ios-input" placeholder="Nombre y apellido / Razón social" value="${escapeHtml(seedName)}"><input id="dispatchClientDoc" class="swal2-input ios-input" placeholder="DNI o CUIL"><input id="dispatchClientAddress" class="swal2-input ios-input" placeholder="Dirección"><input id="dispatchClientCity" class="swal2-input ios-input" placeholder="Localidad"><select id="dispatchClientProvince" class="swal2-select ios-input">${ARG_PROVINCIAS.map((item) => `<option value="${escapeHtml(item)}" ${item === 'Santa Fe' ? 'selected' : ''}>${escapeHtml(item)}</option>`).join('')}</select><input id="dispatchClientCountry" class="swal2-input ios-input" value="Argentina" placeholder="País"></div>`,
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      cancelButtonText: 'Cancelar',
      didOpen: () => {
        const nameInput = document.getElementById('dispatchClientName');
        const preview = document.getElementById('dispatchClientInitialsPreview');
        const sync = () => {
          if (!preview) return;
          const initials = initialsFromPersonName(nameInput?.value || '');
          preview.innerHTML = initials ? escapeHtml(initials) : '<i class="bi bi-person-fill"></i>';
        };
        nameInput?.addEventListener('input', sync);
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
    return state.reparto.clients[id];
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
          <span class="produccion-check-item ${item.missingForMin <= 0.0001 ? 'is-ok' : 'is-missing'}">
            <i class="fa-solid ${item.missingForMin <= 0.0001 ? 'fa-circle-check' : 'fa-circle-xmark'}"></i>
            <span>${item.name}</span>
          </span>`).join('')}
        </div>`;
    };
    const cardsHtml = list.map((recipe) => {
      const analysis = state.analysis[recipe.id] || analyzeRecipe(recipe);
      const dispatchMeta = getProducedStockMeta(recipe.id);
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
            </div>
            ${Number(analysis.expiredKg || 0) > 0.0001 ? `<p class="produccion-last-line produccion-last-line-expired"><i class="fa-solid fa-triangle-exclamation"></i> <strong>Kilos expirados:</strong> <strong>${Number(analysis.expiredKg || 0).toFixed(2)} kg</strong></p>` : ''}
            ${draftLock?.blockedKg > 0 ? `<p class="produccion-last-line" data-draft-lock-line="${recipe.id}"><i class="fa-solid fa-lock"></i> Bloqueado por borrador: <strong>${draftLock.blockedKg.toFixed(2)} kg</strong> · disponible en <strong data-draft-lock-time="${recipe.id}">${formatCountdown(draftLock.remainingMs)}</strong></p>` : ''}
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
        const traces = getTraceRowsFromRegistro(item).map((trace) => `<tr class="is-trace-row"><td>↳ ${trace.index}</td><td><span class="print-trace-date">${escapeHtml(formatDateTime(trace.createdAt))}</span></td><td><span style="display:inline-flex;align-items:center;gap:8px;">${trace.ingredientImageUrl ? `<img src="${escapeHtml(trace.ingredientImageUrl)}" style="width:22px;height:22px;border-radius:999px;object-fit:cover;border:1px solid #d7def2;">` : ''}<span>${escapeHtml(trace.ingredientName)}</span></span></td><td>-${escapeHtml(trace.amount)}</td><td>${escapeHtml(trace.lotNumber)}</td><td><span class="print-trace-vto">${escapeHtml(formatExpiryHuman(trace.expiryDate))}${normalizeLower(trace.expiryDate)==='no perecedero' ? '' : ' (VTO)'}</span></td></tr>`);
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
          ? traceRows.map((trace) => `<tr class="inventario-trace-row"><td><div class="inventario-trace-main"><img src="./IMG/Octicons-git-merge.svg" alt="merge" class="inventario-trace-icon"><span class="inventario-trace-avatar">${trace.ingredientImageUrl ? `<span class="thumb-loading"><img class="meta-spinner-login" src="./IMG/Meta-ai-logo.webp" alt="Cargando"></span><img class="thumb-image js-produccion-thumb" src="${escapeHtml(trace.ingredientImageUrl)}" alt="${escapeHtml(trace.ingredientName)}">` : '<i class="fa-solid fa-carrot"></i>'}</span><span class="inventario-trace-label">${escapeHtml(trace.ingredientName)}</span></div></td><td></td><td><span class="produccion-trace-date">${escapeHtml(formatDateTime(trace.createdAt))}</span></td><td class="inventario-trace-kilos">-${escapeHtml(trace.amount)}</td><td>${escapeHtml(trace.lotNumber)}</td><td><span class="produccion-trace-expiry">${escapeHtml(formatExpiryHuman(trace.expiryDate))}${normalizeLower(trace.expiryDate)==='no perecedero' ? '' : ' (VTO)'}</span></td><td><span class="produccion-trace-badge">Trazabilidad</span></td><td>-</td><td>${trace.invoiceImageUrls.length ? `<button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-recipe-prod-trace-images="${encodeURIComponent(JSON.stringify(trace.invoiceImageUrls))}"><i class="fa-regular fa-image"></i><span>Adjunto (${trace.invoiceImageUrls.length})</span></button>` : '<button type="button" class="btn ios-btn ios-btn-danger inventario-no-photo-btn" disabled>Sin adjuntos</button>'}</td></tr>`).join('') : '';
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
            return `<tr class="inventario-row-tone ${index % 2 === 0 ? 'is-even-row' : 'is-odd-row'}"><td><div class="d-flex align-items-center gap-2">${traceRows.length ? `<button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-recipe-prod-collapse="${escapeHtml(item.id || '')}" title="${isCollapsed ? 'Descolapsar' : 'Colapsar'}" aria-label="${isCollapsed ? 'Descolapsar' : 'Colapsar'}"><i class="fa-solid ${isCollapsed ? 'fa-expand' : 'fa-compress'}"></i></button>` : ''}<span>${escapeHtml(item.id || '-')}</span></div></td><td>${escapeHtml(formatDateTime(item.createdAt))}</td><td>${escapeHtml(item.recipeTitle || '-')}</td><td>${Number(item.quantityKg || 0).toFixed(2)} kg</td><td><span class="produccion-responsable-wrap"><strong>${escapeHtml(manager.name)}</strong><small>${escapeHtml(manager.role)}</small></span></td><td class="produccion-vto-cell">${escapeHtml(formatProductExpiryLabel(item))}</td><td><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-recipe-prod-trace="${escapeHtml(item.id || '')}"><img src="./IMG/family-tree-icon-no-bg.svg" alt="" style="width:14px;height:14px"><span>Trazabilidad</span></button></td><td><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-recipe-prod-planilla="${escapeHtml(item.id || '')}" ${planillaDisabled}><i class="fa-regular fa-file-lines"></i><span>Planilla</span></button></td><td>${traceRows.some((trace) => trace.invoiceImageUrls.length) ? `<button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-recipe-prod-trace-images='${encodeURIComponent(JSON.stringify(traceRows.flatMap((trace) => trace.invoiceImageUrls)))}'><i class="fa-regular fa-image"></i><span>Ver adjuntos</span></button>` : '<button type="button" class="btn ios-btn ios-btn-danger inventario-no-photo-btn" disabled>Sin adjuntos</button>'}</td></tr>${traceHtml}`;
          }).join('')
          : '<tr><td colspan="9" class="text-center">Sin producciones.</td></tr>';
        const renderExpandedContent = (popup) => {
          const host = popup.querySelector('#produccionRecipeExpandedHistoryHost');
          if (!host) return;
          const traceableRows = rows.filter((item) => getTraceRowsFromRegistro(item).length);
          const canCollapseRows = traceableRows.some((item) => collapseMap[item.id] !== true);
          const canExpandRows = traceableRows.some((item) => collapseMap[item.id] === true);
          const pages = totalPages();
          host.innerHTML = `<div class="inventario-print-row mb-2 inventario-trace-toolbar toolbar-scroll-x"><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" id="produccionRecipeExpandedHistoryCollapseAllRowsBtn" ${canCollapseRows ? '' : 'disabled'}><i class="fa-solid fa-compress"></i><span>Colapsar</span></button><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" id="produccionRecipeExpandedHistoryExpandAllRowsBtn" ${canExpandRows ? '' : 'disabled'}><i class="fa-solid fa-expand"></i><span>Descolapsar</span></button></div><div class="table-responsive inventario-table-compact-wrap"><table class="table recipe-table inventario-table-compact mb-0"><thead><tr><th>ID producción</th><th>Fecha y hora</th><th>Producto</th><th>Fabricado (KG.)</th><th>Responsable</th><th>VTO producto</th><th>Trazabilidad</th><th>Planilla</th><th>Adjuntos</th></tr></thead><tbody>${renderRows()}</tbody></table></div><div class="inventario-pagination enhanced"><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn inventario-page-btn" data-recipe-expanded-page="prev" ${expandedPage <= 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-left"></i></button><span>Página ${expandedPage} de ${pages}</span><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn inventario-page-btn" data-recipe-expanded-page="next" ${expandedPage >= pages ? 'disabled' : ''}><i class="fa-solid fa-chevron-right"></i></button></div>`;
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
  const refreshData = async () => {
    setStateView('loading');
    await window.laJamoneraReady;
    const safeRead = async (path, fallback = {}) => {
      try {
        const value = await window.dbLaJamoneraRest.read(path);
        return value == null ? fallback : value;
      } catch (error) {
        return fallback;
      }
    };
    const [recetas, ingredientes, inventario, config, reservas, drafts, registros, users, repartoStore] = await Promise.all([
      safeRead('/recetas', {}),
      safeRead('/ingredientes/items', {}),
      safeRead('/inventario', {}),
      safeRead(CONFIG_PATH, {}),
      safeRead(RESERVAS_PATH, {}),
      safeRead(DRAFTS_PATH, {}),
      safeRead(REGISTROS_PATH, {}),
      safeRead('/informes/users', {}),
      safeRead(REPARTO_PATH, {})
    ]);
    state.recetas = safeObject(recetas);
    state.ingredientes = safeObject(ingredientes);
    state.inventario = safeObject(inventario);
    state.reservas = safeObject(reservas);
    state.drafts = safeObject(drafts);
    state.registros = safeObject(registros);
    state.users = safeObject(users);
    state.reparto = normalizeDispatchStore(repartoStore);
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
      </tr>`).join('') : '';
      return `<tr class="inventario-row-tone ${index % 2 === 0 ? 'is-even-row' : 'is-odd-row'}"><td><div class="d-flex align-items-center gap-2">${traceRows.length ? `<button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-prod-expanded-collapse="${escapeHtml(item.id || '')}" title="${isCollapsed ? 'Descolapsar' : 'Colapsar'}" aria-label="${isCollapsed ? 'Descolapsar' : 'Colapsar'}"><i class="fa-solid ${isCollapsed ? 'fa-expand' : 'fa-compress'}"></i></button>` : ''}<span>${escapeHtml(item.id)}</span></div></td><td>${escapeHtml(formatDateTime(item.createdAt))}</td><td>${escapeHtml(item.recipeTitle || '-')}</td><td>${Number(item.quantityKg || 0).toFixed(2)} kg</td><td>${escapeHtml(manager.name)} (${escapeHtml(manager.role)})</td><td class="produccion-vto-cell">${escapeHtml(formatProductExpiryLabel(item))}</td><td><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-recipe-prod-trace="${escapeHtml(item.id || '')}"><img src="./IMG/family-tree-icon-no-bg.svg" alt="" style="width:14px;height:14px"><span>Trazabilidad</span></button></td><td><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-recipe-prod-planilla="${escapeHtml(item.id || '')}" ${planillaDisabled}><i class="fa-regular fa-file-lines"></i><span>Planilla</span></button></td><td>${traceRows.some((trace) => trace.invoiceImageUrls.length) ? `<button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" data-recipe-prod-trace-images='${encodeURIComponent(JSON.stringify(traceRows.flatMap((trace) => trace.invoiceImageUrls)))}'><i class="fa-regular fa-image"></i><span>Ver adjuntos</span></button>` : '<button type="button" class="btn ios-btn ios-btn-danger inventario-no-photo-btn" disabled>Sin adjuntos</button>'}</td></tr>${traceHtml}`;
    }).join('') : '<tr><td colspan="9" class="text-center">Sin producciones.</td></tr>';
    const renderExpandedContent = (popup) => {
      const host = popup.querySelector('#produccionExpandedHistoryHost');
      if (!host) return;
      const traceableRows = rows.filter((item) => getTraceRowsFromRegistro(item).length);
      const canCollapseRows = traceableRows.some((item) => collapseMap[item.id] !== true);
      const canExpandRows = traceableRows.some((item) => collapseMap[item.id] === true);
      const pages = totalPages();
      host.innerHTML = `<div class="inventario-print-row mb-2 inventario-trace-toolbar toolbar-scroll-x"><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" id="produccionExpandedHistoryCollapseAllRowsBtn" ${canCollapseRows ? '' : 'disabled'}><i class="fa-solid fa-compress"></i><span>Colapsar</span></button><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn" id="produccionExpandedHistoryExpandAllRowsBtn" ${canExpandRows ? '' : 'disabled'}><i class="fa-solid fa-expand"></i><span>Descolapsar</span></button></div><div class="table-responsive inventario-table-compact-wrap"><table class="table recipe-table inventario-table-compact mb-0"><thead><tr><th>ID</th><th>Fecha y hora</th><th>Producto</th><th>Cantidad</th><th>Responsable</th><th>VTO producto</th><th>Trazabilidad</th><th>Planilla</th><th>Adjuntos</th></tr></thead><tbody>${renderRows()}</tbody></table></div><div class="inventario-pagination enhanced"><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn inventario-page-btn" data-prod-expanded-page="prev" ${expandedPage <= 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-left"></i></button><span>Página ${expandedPage} de ${pages}</span><button type="button" class="btn ios-btn ios-btn-secondary inventario-threshold-btn inventario-page-btn" data-prod-expanded-page="next" ${expandedPage >= pages ? 'disabled' : ''}><i class="fa-solid fa-chevron-right"></i></button></div>`;
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
      const traces = getTraceRowsFromRegistro(item).map((trace) => `<tr class="is-trace-row"><td>↳ ${trace.index}</td><td><span class="print-trace-date">${escapeHtml(formatDateTime(trace.createdAt))}</span></td><td><span style="display:inline-flex;align-items:center;gap:8px;">${trace.ingredientImageUrl ? `<img src="${escapeHtml(trace.ingredientImageUrl)}" style="width:22px;height:22px;border-radius:999px;object-fit:cover;border:1px solid #d7def2;">` : ''}<span>${escapeHtml(trace.ingredientName)}</span></span></td><td class="inventario-trace-kilos">-${escapeHtml(trace.amount)}</td><td>${escapeHtml(trace.lotNumber)}</td><td><span class="print-trace-vto">${escapeHtml(formatExpiryHuman(trace.expiryDate))}${normalizeLower(trace.expiryDate)==='no perecedero' ? '' : ' (VTO)'}</span></td></tr>`);
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
  nodes.historyMassPlanillasBtn?.addEventListener('click', openMassPlanillasByPeriod);

  nodes.dispatchView?.addEventListener('click', async (event) => {
    if (event.target.closest('#produccionDispatchBackBtn')) {
      setDispatchMode(false);
      return;
    }
    if (event.target.closest('#produccionDispatchNewBtn')) {
      state.dispatchDraft = buildDispatchDraft();
      renderDispatchCreate(state.dispatchDraft);
      return;
    }
    if (event.target.closest('#produccionDispatchBackToListBtn')) {
      renderDispatchMain();
      return;
    }
    if (event.target.closest('#dispatchAddProductBtn')) {
      state.dispatchDraft.lines.push({ id: makeId('dispatch_row'), recipeId: '', recipeSearch: '', qtyKg: '', allocations: [] });
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
    if (event.target.closest('#dispatchAddCommentBtn')) {
      state.dispatchDraft.comments.push('');
      renderDispatchCreate(state.dispatchDraft);
      return;
    }
    const removeCommentBtn = event.target.closest('[data-dispatch-remove-comment]');
    if (removeCommentBtn) {
      const idx = Number(removeCommentBtn.dataset.dispatchRemoveComment);
      state.dispatchDraft.comments = state.dispatchDraft.comments.filter((_, i) => i !== idx);
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
      draft.managers = [...nodes.dispatchView.querySelectorAll('[data-dispatch-manager]:checked')].map((n) => n.value).filter(Boolean);
      draft.comments = [...nodes.dispatchView.querySelectorAll('[data-dispatch-comment]')].map((n) => normalizeValue(n.value)).filter(Boolean);
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
        comments: draft.comments,
        clientSnapshot: {
          id: draft.clientId,
          name: draft.clientName,
          address: draft.clientAddress,
          city: draft.clientCity,
          province: draft.clientProvince,
          country: draft.clientCountry
        },
        products: normalizedProducts,
        createdAt: nowTs(),
        createdBy: getCurrentUserLabel()
      };
      await persistRepartoStore();
      await refreshData();
      state.dispatchDraft = null;
      renderDispatchMain();
      await openIosSwal({ title: 'Reparto guardado', html: `<p>Código generado: <strong>${code}</strong></p>`, icon: 'success' });
      return;
    }
    if (event.target.closest('#produccionDispatchApplyBtn')) {
      state.dispatchSearch = normalizeValue(nodes.dispatchView.querySelector('#produccionDispatchSearch')?.value);
      state.dispatchRange = normalizeValue(nodes.dispatchView.querySelector('#produccionDispatchRange')?.value);
      state.dispatchPage = 1;
      renderDispatchHistoryTable();
      return;
    }
    if (event.target.closest('#produccionDispatchClearBtn')) {
      state.dispatchRange = '';
      const rangeInput = nodes.dispatchView.querySelector('#produccionDispatchRange');
      if (rangeInput) rangeInput.value = '';
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
      const win = window.open('', '_blank', 'noopener,noreferrer,width=1200,height=900');
      if (!win) return;
      const body = rows.map((row) => {
        const client = getDispatchClient(row.clientId);
        const products = Array.isArray(row.products) ? row.products : [];
        const kg = products.reduce((acc, p) => acc + Number(p.qtyKg || 0), 0);
        return `<tr><td>${escapeHtml(formatDateTime(row.createdAt))}</td><td>${products.length}</td><td>${kg.toFixed(2)} kg</td><td>${escapeHtml(row.code || '-')}</td><td>${escapeHtml(client.name || '-')}</td></tr>`;
      }).join('');
      win.document.write(`<html><head><title>Repartos</title><style>body{font-family:Inter,Arial,sans-serif;padding:12px;color:#223457}table{width:100%;border-collapse:collapse}th,td{border:1px solid #d5def2;padding:8px}th{background:#eef3ff}</style></head><body><h2>Salida de Productos</h2><table><thead><tr><th>Fecha</th><th>Productos</th><th>Cantidad</th><th>Código</th><th>Cliente</th></tr></thead><tbody>${body}</tbody></table></body></html>`);
      win.document.close();
      win.focus();
      win.print();
      return;
    }
    if (event.target.closest('#produccionDispatchExcelBtn')) {
      const rows = getDispatchRows().map((row) => {
        const client = getDispatchClient(row.clientId);
        const products = Array.isArray(row.products) ? row.products : [];
        return {
          Fecha: formatDateTime(row.createdAt),
          Cliente: client.name || '-',
          Código: row.code || '-',
          Productos: products.length,
          'Cantidad (kg)': products.reduce((acc, p) => acc + Number(p.qtyKg || 0), 0).toFixed(2)
        };
      });
      if (!rows.length) {
        await openIosSwal({ title: 'Sin datos', html: '<p>No hay repartos para exportar.</p>', icon: 'info' });
        return;
      }
      await exportStyledExcel({ fileName: `repartos_periodo_${Date.now()}.xlsx`, sheetName: 'Repartos', headers: ['Fecha', 'Cliente', 'Código', 'Productos', 'Cantidad (kg)'], rows });
      return;
    }
    if (event.target.closest('#produccionDispatchMassBtn')) {
      await openIosSwal({ title: 'Próximamente', html: '<p>Planillas masivas para repartos quedará en la próxima etapa.</p>', icon: 'info' });
      return;
    }
    if (event.target.closest('#produccionDispatchExpandBtn')) {
      const rows = getDispatchRows();
      await openIosSwal({
        title: 'Salida de Productos · Vista ampliada',
        width: '92vw',
        html: `<div class="table-responsive inventario-table-compact-wrap"><table class="table recipe-table inventario-table-compact mb-0"><thead><tr><th>Fecha</th><th>Productos</th><th>Cantidad</th><th>Código</th><th>Cliente</th></tr></thead><tbody>${rows.map((row) => {
          const client = getDispatchClient(row.clientId);
          const products = Array.isArray(row.products) ? row.products : [];
          const kg = products.reduce((acc, p) => acc + Number(p.qtyKg || 0), 0);
          return `<tr><td>${escapeHtml(formatDateTime(row.createdAt))}</td><td>${products.length}</td><td>${kg.toFixed(2)} kg</td><td>${escapeHtml(row.code || '-')}</td><td>${escapeHtml(client.name || '-')}</td></tr>`;
        }).join('') || '<tr><td colspan="5">Sin datos.</td></tr>'}</tbody></table></div>`,
        confirmButtonText: 'Cerrar'
      });
      return;
    }
    const collapseBtn = event.target.closest('[data-dispatch-collapse]');
    if (collapseBtn) {
      const id = collapseBtn.dataset.dispatchCollapse;
      state.dispatchCollapse[id] = !state.dispatchCollapse[id];
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
  });

  nodes.dispatchView?.addEventListener('change', async (event) => {
    if (!state.dispatchCreateMode || !state.dispatchDraft) return;
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
    if (event.target.matches('#dispatchVehicleSelect') && event.target.value === 'add_vehicle') {
      const vehicle = await openCreateDispatchVehicle();
      if (vehicle) state.dispatchDraft.vehicleId = vehicle.id;
      renderDispatchCreate(state.dispatchDraft);
      return;
    }
  });

  let dispatchClientSuggestEl = null;
  let dispatchProductSuggestEl = null;
  const closeDispatchSuggests = () => {
    dispatchClientSuggestEl?.remove();
    dispatchProductSuggestEl?.remove();
    dispatchClientSuggestEl = null;
    dispatchProductSuggestEl = null;
  };
  const ensureFloatingSuggest = (type) => {
    const current = type === 'client' ? dispatchClientSuggestEl : dispatchProductSuggestEl;
    if (current) return current;
    const node = document.createElement('div');
    node.className = 'recipe-suggest-floating produccion-dispatch-floating-suggest';
    node.dataset.dispatchSuggest = type;
    document.body.appendChild(node);
    if (type === 'client') dispatchClientSuggestEl = node;
    else dispatchProductSuggestEl = node;
    return node;
  };
  const positionFloatingSuggest = (node, anchor) => {
    if (!node || !anchor) return;
    const rect = anchor.getBoundingClientRect();
    node.style.position = 'absolute';
    node.style.left = `${rect.left + window.scrollX}px`;
    node.style.top = `${rect.bottom + window.scrollY + 4}px`;
    node.style.width = `${Math.max(rect.width, 420)}px`;
    node.style.zIndex = '3300';
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
      suggest.innerHTML = `${list.map((item) => `<button type="button" class="recipe-suggest-item" data-dispatch-client-pick="${escapeHtml(item.id)}"><span class="user-avatar-thumb" style="width:38px;height:38px;font-size:.85rem">${escapeHtml(item.initials || 'U')}</span><span>${escapeHtml(item.name)}<br><small>${escapeHtml(item.doc || '-')}</small></span></button>`).join('')}${query ? `<button type="button" class="recipe-suggest-item recipe-suggest-create" data-dispatch-client-create="1"><i class="fa-solid fa-plus"></i><span>Nuevo Cliente</span></button>` : ''}`;
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
          const created = await openCreateDispatchClient(normalizeValue(clientInput.value));
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

    const productInput = event.target.closest('[data-dispatch-product-search]');
    if (!productInput) return;
    const idx = Number(productInput.dataset.dispatchProductSearch);
    const query = normalizeLower(productInput.value);
    state.dispatchDraft.lines[idx].recipeSearch = normalizeValue(productInput.value);
    state.dispatchDraft.lines[idx].recipeId = '';
    const wrap = nodes.dispatchView.querySelector(`[data-dispatch-product-wrap="${idx}"]`);
    if (!wrap) return;
    const suggest = ensureFloatingSuggest('product');
    positionFloatingSuggest(suggest, productInput);
    const recipes = Object.values(state.recetas)
      .filter((item) => normalizeLower(item.title).includes(query))
      .slice(0, 8)
      .map((item) => ({ ...item, meta: getProducedStockMeta(item.id) }));
    suggest.innerHTML = `${recipes.map((item) => `<button type="button" class="recipe-suggest-item" data-dispatch-product-pick="${escapeHtml(item.id)}" data-dispatch-row="${idx}"><span class="recipe-suggest-avatar-wrap">${sanitizeImageUrl(item.imageUrl) ? `<span class="thumb-loading"><img class="meta-spinner-login" src="./IMG/Meta-ai-logo.webp" alt="Cargando"></span><img class="recipe-suggest-avatar js-dispatch-suggest-thumb dispatch-fit-image" src="${escapeHtml(sanitizeImageUrl(item.imageUrl))}" alt="${escapeHtml(item.title)}">` : '<span class="image-placeholder-circle-2"><i class="fa-solid fa-drumstick-bite"></i></span>'}</span><span><strong>${escapeHtml(capitalize(item.title || 'Receta'))}</strong><br><small class="${item.meta.available > 0.0001 ? 'produccion-dispatch-ok' : 'text-danger'}">${item.meta.available > 0.0001 ? `Disponible: ${item.meta.available.toFixed(2)} kg` : 'Sin stock disponible'}</small></span></button>`).join('')}`;
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
  });

  document.addEventListener('click', (event) => {
    if (!state.dispatchCreateMode) return;
    if (event.target.closest('.produccion-dispatch-floating-suggest')) return;
    if (event.target.closest('#dispatchClientInput')) return;
    if (event.target.closest('[data-dispatch-product-search]')) return;
    closeDispatchSuggests();
  });

    return { openDispatch, setDispatchMode };
  };
})();
