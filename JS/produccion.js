(function produccionModule() {
  const modalEl = document.getElementById('produccionModal');
  if (!modalEl) return;

  const RESERVE_MS = 10 * 60 * 1000;
  const SESSION_KEY = 'laJamoneraProductionDraft';
  const PRODUCT_IMAGE_FALLBACK = 'https://i.postimg.cc/fyvNDdrt/FIambres.png';

  const $ = (id) => document.getElementById(id);
  const nodes = {
    loading: $('produccionLoading'),
    data: $('produccionData'),
    list: $('produccionList'),
    search: $('produccionSearchInput'),
    detailView: $('produccionDetailView'),
    listView: $('produccionListView'),
    historyView: $('produccionHistoryView'),
    detailContent: $('produccionDetailContent'),
    backBtn: $('produccionBackBtn'),
    reservationChip: $('produccionReservationChip'),
    inventoryModal: $('inventarioModal'),
    configBtn: $('produccionConfigBtn'),
    viewListBtn: $('produccionViewListBtn'),
    viewHistoryBtn: $('produccionViewHistoryBtn'),
    historyTable: $('produccionHistoryTable'),
    filterRange: $('produccionFilterRange'),
    filterId: $('produccionFilterId'),
    filterProduct: $('produccionFilterProduct'),
    filterEstado: $('produccionFilterEstado'),
    applyFiltersBtn: $('produccionApplyFiltersBtn')
  };

  const state = {
    search: '',
    recipes: {},
    ingredientes: {},
    inventario: { items: {}, config: {} },
    users: {},
    reservas: {},
    producciones: {},
    config: { idPrefix: 'PROD-LJ' },
    view: 'list',
    detail: null,
    historyPage: 1,
    reservationTimer: null,
    allowClose: false
  };

  const normalize = (v) => String(v || '').trim();
  const normalizeLower = (v) => normalize(v).toLowerCase();
  const safeObj = (v) => (v && typeof v === 'object' ? v : {});
  const safeArr = (v) => (Array.isArray(v) ? v : []);
  const parseNum = (v) => {
    const n = Number(String(v || '').replace(',', '.'));
    return Number.isFinite(n) ? n : NaN;
  };
  const escapeHtml = (v) => String(v || '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));

  const unitProfile = (unitRaw) => {
    const unit = normalizeLower(unitRaw);
    if (['kg', 'kilo', 'kilos', 'kilogramo', 'kilogramos', 'g', 'gr', 'gramo', 'gramos'].includes(unit)) return { group: 'peso', base: 'g' };
    if (['l', 'lt', 'litro', 'litros', 'ml', 'mililitro', 'mililitros', 'cc'].includes(unit)) return { group: 'volumen', base: 'ml' };
    if (['u', 'ud', 'unidad', 'unidades'].includes(unit)) return { group: 'unidad', base: 'unidad' };
    if (['paquete', 'paquetes', 'pack', 'packs'].includes(unit)) return { group: 'paquete', base: 'paquete' };
    return { group: 'desconocida', base: unit || 'unidad' };
  };

  const toBase = (qty, unitRaw) => {
    const profile = unitProfile(unitRaw);
    const unit = normalizeLower(unitRaw);
    if (profile.group === 'peso') return unit.startsWith('k') ? qty * 1000 : qty;
    if (profile.group === 'volumen') return ['l', 'lt', 'litro', 'litros'].includes(unit) ? qty * 1000 : qty;
    return qty;
  };

  const fromBase = (qtyBase, unitRaw) => {
    const unit = normalizeLower(unitRaw);
    const profile = unitProfile(unitRaw);
    if (profile.group === 'peso') return unit.startsWith('k') ? qtyBase / 1000 : qtyBase;
    if (profile.group === 'volumen') return ['l', 'lt', 'litro', 'litros'].includes(unit) ? qtyBase / 1000 : qtyBase;
    return qtyBase;
  };

  const formatDate = (value) => {
    const d = new Date(value || Date.now());
    if (Number.isNaN(d.getTime())) return 'S/D';
    return d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const show = (key) => {
    nodes.loading.classList.toggle('d-none', key !== 'loading');
    nodes.data.classList.toggle('d-none', key === 'loading');
  };

  const activeReservations = () => Object.entries(safeObj(state.reservas)).filter(([, r]) => Number(r.expiresAt) > Date.now() && r.status === 'reserved');

  const loadData = async () => {
    await window.laJamoneraReady;
    const [recetas, ingredientes, inventario, users, reservas, producciones, cfg] = await Promise.all([
      window.dbLaJamoneraRest.read('/recetas'),
      window.dbLaJamoneraRest.read('/ingredientes/items'),
      window.dbLaJamoneraRest.read('/inventario'),
      window.dbLaJamoneraRest.read('/informes/users'),
      window.dbLaJamoneraRest.read('/produccion/reservas'),
      window.dbLaJamoneraRest.read('/produccion/registros'),
      window.dbLaJamoneraRest.read('/produccion/config')
    ]);
    state.recipes = safeObj(recetas);
    state.ingredientes = safeObj(ingredientes);
    state.inventario = safeObj(inventario);
    state.inventario.items = safeObj(state.inventario.items);
    state.users = safeObj(users);
    state.reservas = safeObj(reservas);
    state.producciones = safeObj(producciones);
    state.config = { idPrefix: normalize(cfg?.idPrefix) || 'PROD-LJ' };
    await releaseExpiredReservations();
  };

  const getRecipeRows = (recipe) => safeArr(recipe?.rows).filter((row) => row.type === 'ingredient' && row.ingredientId);

  const getAvailableEntries = (ingredientId, refDateIso) => {
    const record = safeObj(state.inventario.items?.[ingredientId]);
    const entries = safeArr(record.entries);
    return entries
      .map((entry) => {
        const qty = Number(entry.qty || 0);
        const consumedQty = Number(entry.consumedQty || 0);
        const reservedQty = Number(entry.reservedQty || 0);
        const availableQty = Math.max(0, qty - consumedQty - reservedQty);
        const status = entry.expiryDate && refDateIso
          ? (entry.expiryDate < refDateIso ? 'vencido' : (entry.expiryDate === refDateIso ? 'vence_hoy' : 'apto'))
          : 'apto';
        return { ...entry, availableQty, status };
      })
      .filter((entry) => entry.availableQty > 0)
      .sort((a, b) => {
        const ea = normalize(a.expiryDate) || '9999-12-31';
        const eb = normalize(b.expiryDate) || '9999-12-31';
        if (ea !== eb) return ea.localeCompare(eb);
        return Number(a.createdAt || 0) - Number(b.createdAt || 0);
      });
  };

  const computePlan = (recipe, produceKg = 1, productionDateIso = '') => {
    const yieldQty = parseNum(recipe?.yieldQuantity);
    const yieldUnit = normalizeLower(recipe?.yieldUnit || 'kg');
    const yieldProfile = unitProfile(yieldUnit);
    if (!Number.isFinite(yieldQty) || yieldQty <= 0 || yieldProfile.group !== 'peso') {
      return { error: 'Esta receta no tiene rendimiento en peso compatible (kg/g).', coverage: 0, ingredientPlans: [] };
    }

    const produceBase = toBase(Number(produceKg) || 0, 'kg');
    const yieldBase = toBase(yieldQty, yieldUnit);
    const factor = produceBase / yieldBase;

    const ingredientPlans = [];
    let globalCoverage = 1;
    const issues = [];

    for (const row of getRecipeRows(recipe)) {
      const reqQty = Number(row.quantity || 0) * factor;
      const reqUnit = normalizeLower(row.unit);
      const reqProfile = unitProfile(reqUnit);
      const entries = getAvailableEntries(row.ingredientId, productionDateIso);
      const ingredientName = state.ingredientes[row.ingredientId]?.name || row.ingredientName || 'Ingrediente';

      if (reqProfile.group === 'desconocida') {
        issues.push(`Revisá la configuración de unidades del ingrediente ${ingredientName}.`);
        ingredientPlans.push({ ingredientId: row.ingredientId, ingredientName, requiredQty: reqQty, requiredUnit: reqUnit, coverage: 0, lots: [], status: 'incompatible' });
        globalCoverage = 0;
        continue;
      }

      const compatible = entries.filter((entry) => unitProfile(entry.unit).group === reqProfile.group);
      if (!compatible.length) {
        ingredientPlans.push({ ingredientId: row.ingredientId, ingredientName, requiredQty: reqQty, requiredUnit: reqUnit, coverage: 0, lots: [], status: 'faltante' });
        globalCoverage = 0;
        continue;
      }

      const requiredBase = toBase(reqQty, reqUnit);
      let remaining = requiredBase;
      const lots = [];
      let availableBase = 0;

      for (const entry of compatible) {
        const entryAvailableBase = toBase(Number(entry.availableQty || 0), entry.unit);
        availableBase += entryAvailableBase;
        if (remaining <= 0) continue;
        const takeBase = Math.min(remaining, entryAvailableBase);
        if (takeBase > 0) {
          lots.push({
            entryId: entry.id,
            qtyBase: takeBase,
            qty: Number(fromBase(takeBase, reqUnit).toFixed(4)),
            unit: reqUnit,
            sourceQty: Number(fromBase(takeBase, entry.unit).toFixed(4)),
            sourceUnit: entry.unit,
            invoiceNumber: entry.invoiceNumber || '-',
            provider: entry.provider || '-',
            entryDate: entry.entryDate || '',
            expiryDate: entry.expiryDate || '',
            invoiceImageUrls: safeArr(entry.invoiceImageUrls),
            status: entry.status
          });
          remaining -= takeBase;
        }
      }

      const coverage = requiredBase > 0 ? Math.min(1, availableBase / requiredBase) : 1;
      globalCoverage = Math.min(globalCoverage, coverage);
      const status = coverage >= 1 ? 'ok' : (coverage >= 0.5 ? 'parcial' : 'faltante');
      ingredientPlans.push({ ingredientId: row.ingredientId, ingredientName, requiredQty: reqQty, requiredUnit: reqUnit, coverage, lots, status, missingQty: Math.max(0, fromBase(remaining, reqUnit)) });
    }

    if (issues.length) {
      return { error: `Esta receta contiene unidades incompatibles para cálculo automático. ${issues.join(' ')}`, coverage: 0, ingredientPlans };
    }

    const maxKg = Number((produceKg * (globalCoverage || 0)).toFixed(3));
    return { coverage: globalCoverage, ingredientPlans, maxKg, error: '' };
  };


  const computeMaxKgForRecipe = (recipe, productionDateIso = '') => {
    const yieldQty = parseNum(recipe?.yieldQuantity);
    const yieldUnit = normalizeLower(recipe?.yieldUnit || 'kg');
    const yieldProfile = unitProfile(yieldUnit);
    if (!Number.isFinite(yieldQty) || yieldQty <= 0 || yieldProfile.group !== 'peso') return 0;
    const yieldBase = toBase(yieldQty, yieldUnit);
    let maxKg = Infinity;
    for (const row of getRecipeRows(recipe)) {
      const reqQty = Number(row.quantity || 0);
      const reqUnit = normalizeLower(row.unit);
      const reqProfile = unitProfile(reqUnit);
      if (reqProfile.group === 'desconocida') return 0;
      const entries = getAvailableEntries(row.ingredientId, productionDateIso).filter((entry) => unitProfile(entry.unit).group === reqProfile.group);
      if (!entries.length) return 0;
      const availableBase = entries.reduce((acc, entry) => acc + toBase(Number(entry.availableQty || 0), entry.unit), 0);
      const requiredBaseForYield = toBase(reqQty, reqUnit);
      if (requiredBaseForYield <= 0) continue;
      const possibleYields = availableBase / requiredBaseForYield;
      const ingredientMaxKg = (possibleYields * yieldBase) / 1000;
      maxKg = Math.min(maxKg, ingredientMaxKg);
    }
    return Number.isFinite(maxKg) ? Number(Math.max(0, maxKg).toFixed(3)) : 0;
  };

  const computeRecipeCard = (recipe) => {
    const today = new Date().toISOString().slice(0, 10);
    const base = computePlan(recipe, 1, today);
    const maxKg = computeMaxKgForRecipe(recipe, today);
    base.maxKg = maxKg;
    const status = base.error ? 'danger' : (maxKg >= 1 ? 'success' : (base.coverage >= 0.5 ? 'warning' : 'danger'));
    const missing = base.ingredientPlans.filter((p) => p.status !== 'ok');
    return { recipe, base, status, missing };
  };

  const renderList = () => {
    const query = normalizeLower(state.search);
    const cards = Object.entries(state.recipes)
      .map(([id, recipe]) => ({ ...recipe, id: recipe.id || id }))
      .filter((r) => normalizeLower(r.title).includes(query))
      .map(computeRecipeCard);

    if (!cards.length) {
      nodes.list.innerHTML = '<div class="ingredientes-empty"><p class="ingredientes-empty-text">No hay recetas para producir.</p></div>';
      return;
    }

    nodes.list.innerHTML = cards.map(({ recipe, base, status, missing }) => {
      const pct = Math.round((base.coverage || 0) * 100);
      const chip = status === 'success' ? 'Producible' : (status === 'warning' ? 'Stock parcial' : 'Sin cobertura');
      const btnProduce = base.maxKg >= 1;
      return `
      <article class="ingrediente-card produccion-card tone-${status}">
        <div class="ingrediente-card-main">
          <div class="ingrediente-card-media recipe-card-media">
            <div class="produccion-image-wrap">
              <div class="produccion-image-spinner"><img src="./IMG/Meta-ai-logo.webp" alt="Cargando" class="meta-spinner-login"></div>
              <img src="${escapeHtml(recipe.imageUrl || PRODUCT_IMAGE_FALLBACK)}" class="ingrediente-thumb produccion-thumb" alt="${escapeHtml(recipe.title)}" loading="lazy" onload="this.previousElementSibling.classList.add('d-none')" onerror="this.previousElementSibling.classList.add('d-none')">
            </div>
          </div>
          <div class="ingrediente-card-copy receta-card-copy">
            <div class="produccion-card-head">
              <h6>${escapeHtml(recipe.title || 'Receta')}</h6>
              <span class="produccion-chip tone-${status}">${chip}</span>
            </div>
            <p class="ingrediente-meta receta-card-meta">Máximo producible: <strong class="produccion-max">${Number(base.maxKg || 0).toFixed(2)} kg</strong></p>
            <p class="ingrediente-meta receta-card-ingredients">${missing.length ? `Faltan: ${escapeHtml(missing.slice(0, 3).map((m) => m.ingredientName).join(', '))}` : 'Cobertura completa de insumos.'}</p>
            <div class="produccion-progress"><div class="produccion-progress-bar tone-${status}" style="width:${Math.max(6, pct)}%"></div></div>
            <div class="produccion-badges">
              ${status === 'danger' ? '<span class="produccion-badge tone-danger">faltan insumos</span>' : ''}
              ${status === 'warning' ? '<span class="produccion-badge tone-warning">stock parcial</span>' : ''}
              ${base.ingredientPlans.some((x) => x.lots.some((lot) => lot.status === 'vencido')) ? '<span class="produccion-badge tone-danger">vencido</span>' : ''}
            </div>
          </div>
        </div>
        <div class="ingrediente-card-actions">
          ${btnProduce
            ? `<button class="btn ios-btn ios-btn-success" data-production-open="${recipe.id}"><i class="fa-solid fa-flask"></i><span>+ Producir</span></button>`
            : `<button class="btn ios-btn ios-btn-warning" data-production-inventory="1"><i class="fa-solid fa-boxes-stacked"></i><span>+ Inventario</span></button>`}
        </div>
      </article>`;
    }).join('');
  };

  const getDraft = () => {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (_) { return null; }
  };

  const saveDraft = async () => {
    if (!state.detail) return;
    localStorage.setItem(SESSION_KEY, JSON.stringify(state.detail));
    await window.dbLaJamoneraRest.write(`/produccion/drafts/${state.detail.draftId}`, state.detail);
  };

  const clearDraft = async () => {
    if (state.detail?.draftId) await window.dbLaJamoneraRest.write(`/produccion/drafts/${state.detail.draftId}`, null);
    localStorage.removeItem(SESSION_KEY);
  };

  const startReservationTicker = () => {
    if (state.reservationTimer) clearInterval(state.reservationTimer);
    state.reservationTimer = setInterval(() => {
      const expires = Number(state.detail?.reserveExpiresAt || 0);
      const ms = Math.max(0, expires - Date.now());
      const min = String(Math.floor(ms / 60000)).padStart(2, '0');
      const sec = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
      nodes.reservationChip.textContent = `Reserva: ${min}:${sec}`;
      if (ms <= 0 && state.detail) {
        releaseReservation(state.detail.reserveId).then(async () => {
          await openAlert('Reserva vencida', 'La reserva temporal se liberó por tiempo agotado.', 'warning');
          state.detail.reserveId = '';
          state.detail.reserveExpiresAt = 0;
          await saveDraft();
        });
      }
    }, 1000);
  };

  const openAlert = (title, text, icon = 'info') => Swal.fire({
    title,
    html: `<p>${escapeHtml(text)}</p>`,
    icon,
    customClass: { popup: 'ios-alert', title: 'ios-alert-title', htmlContainer: 'ios-alert-text', confirmButton: 'ios-btn ios-btn-primary', cancelButton: 'ios-btn ios-btn-secondary' },
    buttonsStyling: false,
    confirmButtonText: 'Entendido'
  });

  const reserveStock = async () => {
    if (!state.detail) return;
    const recipe = state.recipes[state.detail.recipeId];
    const plan = computePlan(recipe, state.detail.qtyKg, state.detail.productionDate);
    state.detail.plan = plan;

    if (state.detail.reserveId) await releaseReservation(state.detail.reserveId);
    if (plan.error) return;

    const allocations = [];
    plan.ingredientPlans.forEach((item) => {
      item.lots.forEach((lot) => {
        allocations.push({ ingredientId: item.ingredientId, entryId: lot.entryId, qty: Number(lot.sourceQty || 0), unit: lot.sourceUnit });
      });
    });

    const reserveId = `res_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const expiresAt = Date.now() + RESERVE_MS;

    for (const alloc of allocations) {
      const entry = safeArr(state.inventario.items?.[alloc.ingredientId]?.entries).find((e) => e.id === alloc.entryId);
      if (!entry) continue;
      entry.reservedQty = Number((Number(entry.reservedQty || 0) + alloc.qty).toFixed(4));
    }

    state.detail.reserveId = reserveId;
    state.detail.reserveExpiresAt = expiresAt;
    state.reservas[reserveId] = {
      id: reserveId,
      recipeId: state.detail.recipeId,
      recipeTitle: recipe.title,
      qtyKg: state.detail.qtyKg,
      user: 'laJamonera',
      draftId: state.detail.draftId,
      allocations,
      status: 'reserved',
      createdAt: Date.now(),
      expiresAt
    };

    await Promise.all([
      window.dbLaJamoneraRest.write('/inventario', state.inventario),
      window.dbLaJamoneraRest.write(`/produccion/reservas/${reserveId}`, state.reservas[reserveId])
    ]);

    await saveDraft();
    startReservationTicker();
  };

  const releaseReservation = async (reserveId) => {
    const reserve = state.reservas[reserveId];
    if (!reserve) return;
    reserve.allocations.forEach((alloc) => {
      const entry = safeArr(state.inventario.items?.[alloc.ingredientId]?.entries).find((e) => e.id === alloc.entryId);
      if (!entry) return;
      entry.reservedQty = Number(Math.max(0, Number(entry.reservedQty || 0) - Number(alloc.qty || 0)).toFixed(4));
    });
    reserve.status = 'released';
    await Promise.all([
      window.dbLaJamoneraRest.write('/inventario', state.inventario),
      window.dbLaJamoneraRest.write(`/produccion/reservas/${reserveId}`, reserve)
    ]);
  };

  const releaseExpiredReservations = async () => {
    const toRelease = Object.entries(safeObj(state.reservas)).filter(([, reserve]) => reserve?.status === 'reserved' && Number(reserve.expiresAt) <= Date.now());
    if (!toRelease.length) return;
    for (const [id] of toRelease) await releaseReservation(id);
  };

  const productionCode = () => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const seq = String(Object.keys(state.producciones).length + 1).padStart(4, '0');
    return `${state.config.idPrefix}-${y}${m}${d}-${seq}`;
  };

  const renderDetail = () => {
    const detail = state.detail;
    if (!detail) return;
    const recipe = state.recipes[detail.recipeId];
    const plan = detail.plan || computePlan(recipe, detail.qtyKg, detail.productionDate);
    const maxValue = Number(computeMaxKgForRecipe(recipe, detail.productionDate) || 0).toFixed(2);
    const users = Object.values(state.users);

    nodes.detailContent.innerHTML = `
      <article class="inventario-product-head inventario-product-head-v2 produccion-product-head">
        <div class="inventario-editor-photo produccion-product-photo-wrap">
          <div class="produccion-image-spinner"><img src="./IMG/Meta-ai-logo.webp" alt="Cargando" class="meta-spinner-login"></div>
          <img src="${escapeHtml(recipe.imageUrl || PRODUCT_IMAGE_FALLBACK)}" class="produccion-product-photo" alt="${escapeHtml(recipe.title)}" onload="this.previousElementSibling.classList.add('d-none')" onerror="this.previousElementSibling.classList.add('d-none')">
        </div>
        <div>
          <p class="inventario-product-kicker"><img src="./IMG/Octicons-git-branch.svg" class="produccion-inline-icon" alt=""> Producción</p>
          <h3>${escapeHtml(recipe.title || 'Receta')}</h3>
          <p>${escapeHtml(recipe.description || 'Sin descripción')}</p>
          <p class="produccion-max">Máximo actual: ${maxValue} kg</p>
        </div>
      </article>

      <div class="produccion-form-grid">
        <div>
          <label class="form-label">¿Qué cantidad deseás producir? (kg)</label>
          <input id="produccionQtyInput" class="form-control ios-input" value="${detail.qtyKg}" type="number" min="0.1" step="0.01">
        </div>
        <div>
          <label class="form-label">Fecha de producción</label>
          <input id="produccionDateInput" class="form-control ios-input" value="${escapeHtml(detail.productionDate || '')}">
        </div>
      </div>

      <div class="produccion-form-grid">
        <div>
          <label class="form-label">Encargados</label>
          <div class="produccion-users-pills">${users.map((u) => `<label><input type="checkbox" data-prod-user="${u.id}" ${detail.managerIds.includes(u.id) ? 'checked' : ''}> ${escapeHtml(u.fullName || u.position || u.id)}</label>`).join('')}</div>
        </div>
        <div>
          <label class="form-label">Observaciones</label>
          <textarea id="produccionObsInput" class="form-control ios-input" rows="3" placeholder="Notas, cambios o incidencias">${escapeHtml(detail.observations || '')}</textarea>
        </div>
      </div>

      ${plan.error ? `<div class="produccion-error">${escapeHtml(plan.error)}</div>` : ''}
      <div class="table-responsive produccion-breakdown-wrap">
        <table class="table recipe-table produccion-breakdown">
          <thead><tr><th>Ingrediente</th><th>Necesario</th><th>Cobertura</th><th>Desglose FEFO</th></tr></thead>
          <tbody>
          ${plan.ingredientPlans.map((item) => `
            <tr class="produccion-row-${item.status}">
              <td><strong>${escapeHtml(item.ingredientName)}</strong></td>
              <td>${Number(item.requiredQty || 0).toFixed(2)} ${escapeHtml(item.requiredUnit)}</td>
              <td>${Math.round((item.coverage || 0) * 100)}%</td>
              <td>
                ${item.lots.length ? item.lots.map((lot) => `<div class="produccion-lot-line"><img src="./IMG/Octicons-git-merge.svg" class="produccion-inline-icon" alt=""> ${escapeHtml(lot.entryDate || '-')} · vence ${escapeHtml(lot.expiryDate || '-')} · usar ${Number(lot.sourceQty || 0).toFixed(2)} ${escapeHtml(lot.sourceUnit)} · lote ${escapeHtml(lot.invoiceNumber || '-')} · ${escapeHtml(lot.provider || '-')}</div>`).join('') : '<span class="produccion-badge tone-danger">sin lote apto</span>'}
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="produccion-actions-row">
        <button id="produccionDraftBtn" type="button" class="btn ios-btn ios-btn-secondary"><i class="fa-regular fa-floppy-disk"></i><span>Guardar borrador</span></button>
        <button id="produccionCancelBtn" type="button" class="btn ios-btn ios-btn-warning"><i class="fa-solid fa-xmark"></i><span>Cancelar</span></button>
        <button id="produccionConfirmBtn" type="button" class="btn ios-btn ios-btn-success"><i class="fa-solid fa-check"></i><span>Confirmar producción</span></button>
      </div>
    `;

    const fpNode = document.getElementById('produccionDateInput');
    if (window.flatpickr && fpNode) {
      window.flatpickr(fpNode, {
        locale: window.flatpickr.l10ns?.es || undefined,
        dateFormat: 'Y-m-d',
        allowInput: true,
        defaultDate: detail.productionDate
      });
    }

    document.getElementById('produccionQtyInput')?.addEventListener('input', async (event) => {
      detail.qtyKg = Math.max(0.1, parseNum(event.target.value) || 0.1);
      await reserveStock();
      renderDetail();
    });
    fpNode?.addEventListener('change', async (event) => {
      detail.productionDate = normalize(event.target.value);
      await reserveStock();
      renderDetail();
    });
    document.getElementById('produccionObsInput')?.addEventListener('input', (event) => {
      detail.observations = event.target.value;
    });
    nodes.detailContent.querySelectorAll('[data-prod-user]').forEach((node) => {
      node.addEventListener('change', () => {
        detail.managerIds = [...nodes.detailContent.querySelectorAll('[data-prod-user]:checked')].map((item) => item.dataset.prodUser);
      });
    });

    document.getElementById('produccionDraftBtn')?.addEventListener('click', async () => {
      await saveDraft();
      await openAlert('Borrador guardado', 'Se guardó el borrador de producción.', 'success');
    });

    document.getElementById('produccionCancelBtn')?.addEventListener('click', async () => {
      const answer = await Swal.fire({
        title: '¿Deseás abandonar esta producción?',
        html: '<p>Se liberará la reserva temporal del stock.</p>',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Sí, abandonar',
        cancelButtonText: 'Seguir',
        customClass: { popup: 'ios-alert', title: 'ios-alert-title', htmlContainer: 'ios-alert-text', confirmButton: 'ios-btn ios-btn-warning', cancelButton: 'ios-btn ios-btn-secondary' },
        buttonsStyling: false
      });
      if (!answer.isConfirmed) return;
      if (detail.reserveId) await releaseReservation(detail.reserveId);
      await clearDraft();
      state.detail = null;
      setView('list');
      renderList();
    });

    document.getElementById('produccionConfirmBtn')?.addEventListener('click', async () => {
      if (plan.error || (plan.maxKg || 0) < 1) {
        await openAlert('No se puede confirmar', 'No alcanza el mínimo de 1 kg o hay incompatibilidades de unidades.', 'warning');
        return;
      }
      await confirmProduction();
    });
  };

  const setView = (view) => {
    state.view = view;
    nodes.listView.classList.toggle('d-none', view !== 'list');
    nodes.detailView.classList.toggle('d-none', view !== 'detail');
    nodes.historyView.classList.toggle('d-none', view !== 'history');
    nodes.viewListBtn.classList.toggle('is-active', view === 'list');
    nodes.viewHistoryBtn.classList.toggle('is-active', view === 'history');
  };

  const openDetail = async (recipeId) => {
    const draft = getDraft();
    if (draft && draft.recipeId === recipeId) {
      const answer = await Swal.fire({
        title: 'Borrador encontrado',
        html: '<p>¿Querés continuar el borrador o descartarlo?</p>',
        icon: 'question',
        showDenyButton: true,
        confirmButtonText: 'Continuar borrador',
        denyButtonText: 'Descartar borrador',
        customClass: { popup: 'ios-alert', title: 'ios-alert-title', htmlContainer: 'ios-alert-text', confirmButton: 'ios-btn ios-btn-primary', denyButton: 'ios-btn ios-btn-warning' },
        buttonsStyling: false
      });
      if (answer.isConfirmed) {
        state.detail = draft;
      } else if (answer.isDenied) {
        await clearDraft();
      }
    }

    if (!state.detail || state.detail.recipeId !== recipeId) {
      state.detail = {
        draftId: `draft_${Date.now()}`,
        recipeId,
        qtyKg: 1,
        productionDate: new Date().toISOString().slice(0, 10),
        observations: '',
        managerIds: [],
        reserveId: '',
        reserveExpiresAt: 0,
        plan: null
      };
    }

    await reserveStock();
    renderDetail();
    setView('detail');
  };

  const confirmProduction = async () => {
    const detail = state.detail;
    const recipe = state.recipes[detail.recipeId];

    await loadData();
    const freshPlan = computePlan(recipe, detail.qtyKg, detail.productionDate);
    if (freshPlan.error || freshPlan.maxKg < 1) {
      await openAlert('Conflicto de stock', 'El stock cambió mientras estaba abierto el modal. Revisá nuevamente.', 'error');
      renderList();
      return;
    }

    const id = productionCode();
    const record = {
      id,
      recipeId: detail.recipeId,
      recipeTitle: recipe.title,
      productionDate: detail.productionDate,
      qtyKg: Number(detail.qtyKg),
      managerIds: detail.managerIds,
      observations: detail.observations,
      lots: freshPlan.ingredientPlans,
      createdBy: 'laJamonera',
      createdAt: Date.now(),
      status: 'confirmada',
      updatedAt: Date.now()
    };

    freshPlan.ingredientPlans.forEach((item) => {
      item.lots.forEach((lot) => {
        const entry = safeArr(state.inventario.items?.[item.ingredientId]?.entries).find((e) => e.id === lot.entryId);
        if (!entry) return;
        entry.reservedQty = Number(Math.max(0, Number(entry.reservedQty || 0) - Number(lot.sourceQty || 0)).toFixed(4));
        entry.consumedQty = Number((Number(entry.consumedQty || 0) + Number(lot.sourceQty || 0)).toFixed(4));
        entry.movements = safeArr(entry.movements);
        entry.movements.unshift({
          type: 'consumido_produccion',
          qty: Number(lot.sourceQty || 0),
          unit: lot.sourceUnit,
          productionId: id,
          createdAt: Date.now(),
          user: 'laJamonera'
        });
      });
    });

    Object.values(state.inventario.items).forEach((item) => {
      const entries = safeArr(item.entries);
      item.stockKg = Number(entries.reduce((acc, entry) => {
        const unit = normalizeLower(entry.unit);
        const available = Math.max(0, Number(entry.qty || 0) - Number(entry.consumedQty || 0));
        if (['kg', 'kilo', 'kilos'].includes(unit)) return acc + available;
        if (['g', 'gr', 'gramo', 'gramos'].includes(unit)) return acc + (available / 1000);
        return acc;
      }, 0).toFixed(4));
    });

    if (detail.reserveId && state.reservas[detail.reserveId]) {
      state.reservas[detail.reserveId].status = 'consumed';
    }

    await Promise.all([
      window.dbLaJamoneraRest.write('/inventario', state.inventario),
      window.dbLaJamoneraRest.write(`/produccion/registros/${id}`, record),
      detail.reserveId ? window.dbLaJamoneraRest.write(`/produccion/reservas/${detail.reserveId}`, state.reservas[detail.reserveId]) : Promise.resolve(),
      window.dbLaJamoneraRest.write(`/produccion/auditoria/${Date.now()}`, {
        action: 'confirmar_produccion',
        user: 'laJamonera',
        createdAt: Date.now(),
        productionId: id,
        oldValue: null,
        newValue: { id, qtyKg: record.qtyKg, recipeTitle: record.recipeTitle }
      })
    ]);

    await clearDraft();
    state.detail = null;
    await openAlert('Producción guardada', `Se guardó la producción ${id}.`, 'success');
    await loadData();
    renderList();
    renderHistory();
    setView('list');
  };

  const renderHistory = () => {
    const rows = Object.values(state.producciones)
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
      .filter((row) => {
        const idMatch = normalizeLower(nodes.filterId.value || '');
        const productMatch = normalizeLower(nodes.filterProduct.value || '');
        const estado = normalizeLower(nodes.filterEstado.value || '');
        if (idMatch && !normalizeLower(row.id).includes(idMatch)) return false;
        if (productMatch && !normalizeLower(row.recipeTitle).includes(productMatch)) return false;
        if (estado && normalizeLower(row.status) !== estado) return false;
        return true;
      });

    const pageSize = 12;
    const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
    state.historyPage = Math.max(1, Math.min(totalPages, state.historyPage));
    const visible = rows.slice((state.historyPage - 1) * pageSize, state.historyPage * pageSize);

    nodes.historyTable.innerHTML = `
      <div class="table-responsive produccion-history-wrap">
        <table class="table recipe-table produccion-history-table">
          <thead><tr><th>ID</th><th>Fecha</th><th>Producto</th><th>Cantidad</th><th>Estado</th><th>Acciones</th></tr></thead>
          <tbody>
            ${visible.length ? visible.map((row) => `<tr>
              <td>${escapeHtml(row.id)}</td>
              <td>${escapeHtml(row.productionDate || '-')}</td>
              <td>${escapeHtml(row.recipeTitle || '-')}</td>
              <td>${Number(row.qtyKg || 0).toFixed(2)} kg</td>
              <td><span class="produccion-badge ${normalizeLower(row.status) === 'anulada' ? 'tone-danger' : 'tone-success'}">${escapeHtml(row.status || '-')}</span></td>
              <td>
                <button class="btn ios-btn ios-btn-secondary" data-prod-report="${row.id}"><i class="fa-solid fa-file-lines"></i><span>Informe</span></button>
                ${normalizeLower(row.status) === 'confirmada' ? `<button class="btn ios-btn ios-btn-warning" data-prod-cancel="${row.id}"><i class="fa-solid fa-ban"></i><span>Anular</span></button>` : ''}
              </td>
            </tr>`).join('') : '<tr><td colspan="6" class="text-center">Sin producciones.</td></tr>'}
          </tbody>
        </table>
      </div>
      <div class="inventario-table-pagination">
        <button type="button" class="btn ios-btn ios-btn-secondary" data-prod-page="prev" ${state.historyPage <= 1 ? 'disabled' : ''}>Anterior</button>
        <span>Página ${state.historyPage} de ${totalPages}</span>
        <button type="button" class="btn ios-btn ios-btn-secondary" data-prod-page="next" ${state.historyPage >= totalPages ? 'disabled' : ''}>Siguiente</button>
      </div>
    `;
  };

  const openReport = async (id) => {
    const prod = state.producciones[id];
    if (!prod) return;
    const include = await Swal.fire({
      title: 'Impresión de informe',
      html: '<p>¿Deseás incluir facturas/remitos e imágenes adjuntas?</p>',
      icon: 'question',
      showDenyButton: true,
      showCancelButton: true,
      confirmButtonText: 'Sí, incluir',
      denyButtonText: 'No incluir',
      cancelButtonText: 'Cancelar',
      customClass: { popup: 'ios-alert', confirmButton: 'ios-btn ios-btn-success', denyButton: 'ios-btn ios-btn-danger', cancelButton: 'ios-btn ios-btn-secondary' },
      buttonsStyling: false
    });
    if (include.isDismissed) return;

    const includeDocs = include.isConfirmed;
    const html = `
      <div class="prod-print-report">
        <h2>${escapeHtml(prod.recipeTitle)}</h2>
        <p><strong>ID:</strong> ${escapeHtml(prod.id)}</p>
        <p><strong>Fecha producción:</strong> ${escapeHtml(prod.productionDate)}</p>
        <p><strong>Cantidad:</strong> ${Number(prod.qtyKg || 0).toFixed(2)} kg</p>
        <p><strong>Estado:</strong> ${escapeHtml(prod.status)}</p>
        <h3>Desglose de insumos</h3>
        ${safeArr(prod.lots).map((item) => `<h4>${escapeHtml(item.ingredientName)}</h4><ul>${safeArr(item.lots).map((lot) => `<li>${escapeHtml(lot.entryDate || '-')} / ${escapeHtml(lot.expiryDate || '-')} / ${Number(lot.sourceQty || 0).toFixed(2)} ${escapeHtml(lot.sourceUnit)} / lote ${escapeHtml(lot.invoiceNumber || '-')} / ${escapeHtml(lot.provider || '-')} ${includeDocs ? `(adjuntos: ${safeArr(lot.invoiceImageUrls).length})` : ''}</li>`).join('')}</ul>`).join('')}
      </div>`;

    const popup = window.open('', '_blank', 'width=900,height=700');
    if (!popup) return;
    popup.document.write(`<html><head><title>${prod.id}</title></head><body>${html}</body></html>`);
    popup.document.close();
    popup.focus();
    popup.print();
  };

  const cancelProduction = async (id) => {
    const passNode = await window.dbLaJamoneraRest.read('/passGeneral/pass');
    const expectedPass = normalize(passNode);
    const res = await Swal.fire({
      title: 'Clave requerida',
      input: 'password',
      inputPlaceholder: 'Ingresá la clave de seguridad',
      showCancelButton: true,
      confirmButtonText: 'Validar',
      cancelButtonText: 'Cancelar',
      customClass: { popup: 'ios-alert', confirmButton: 'ios-btn ios-btn-primary', cancelButton: 'ios-btn ios-btn-secondary' },
      buttonsStyling: false
    });
    if (!res.isConfirmed) return;
    if (normalize(res.value) !== expectedPass) {
      await openAlert('Clave incorrecta', 'No se pudo anular la producción.', 'error');
      return;
    }

    const prod = state.producciones[id];
    if (!prod || normalizeLower(prod.status) !== 'confirmada') return;

    safeArr(prod.lots).forEach((item) => {
      safeArr(item.lots).forEach((lot) => {
        const entry = safeArr(state.inventario.items?.[item.ingredientId]?.entries).find((e) => e.id === lot.entryId);
        if (!entry) return;
        entry.consumedQty = Number(Math.max(0, Number(entry.consumedQty || 0) - Number(lot.sourceQty || 0)).toFixed(4));
        entry.movements = safeArr(entry.movements);
        entry.movements.unshift({ type: 'anulacion_produccion', qty: Number(lot.sourceQty || 0), unit: lot.sourceUnit, productionId: id, createdAt: Date.now(), user: 'laJamonera' });
      });
    });

    prod.status = 'anulada';
    prod.cancelledAt = Date.now();
    await Promise.all([
      window.dbLaJamoneraRest.write('/inventario', state.inventario),
      window.dbLaJamoneraRest.write(`/produccion/registros/${id}`, prod),
      window.dbLaJamoneraRest.write(`/produccion/auditoria/${Date.now()}`, {
        action: 'anular_produccion', user: 'laJamonera', productionId: id, createdAt: Date.now(), reason: 'anulada manual'
      })
    ]);
    await loadData();
    renderHistory();
    await openAlert('Producción anulada', `${id} fue anulada y el stock fue restituido.`, 'success');
  };

  const wireEvents = () => {
    nodes.search?.addEventListener('input', (event) => {
      state.search = normalizeLower(event.target.value);
      renderList();
    });

    nodes.list?.addEventListener('click', async (event) => {
      const openBtn = event.target.closest('[data-production-open]');
      if (openBtn) {
        await openDetail(openBtn.dataset.productionOpen);
        return;
      }
      const invBtn = event.target.closest('[data-production-inventory]');
      if (invBtn) {
        bootstrap.Modal.getOrCreateInstance(modalEl).hide();
        bootstrap.Modal.getOrCreateInstance(nodes.inventoryModal).show();
      }
    });

    nodes.backBtn?.addEventListener('click', async () => {
      const answer = await Swal.fire({
        title: '¿Deseás abandonar esta producción?',
        html: '<p>Se conservará el borrador para continuar luego.</p>',
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Sí, volver',
        cancelButtonText: 'No',
        customClass: { popup: 'ios-alert', confirmButton: 'ios-btn ios-btn-primary', cancelButton: 'ios-btn ios-btn-secondary' },
        buttonsStyling: false
      });
      if (!answer.isConfirmed) return;
      await saveDraft();
      setView('list');
      renderList();
    });

    nodes.configBtn?.addEventListener('click', async () => {
      const res = await Swal.fire({
        title: 'Configuración de identificador',
        html: `<input id="prodIdPrefix" class="swal2-input ios-input" value="${escapeHtml(state.config.idPrefix)}" placeholder="Prefijo (ej: PROD-LJ)">`,
        showCancelButton: true,
        confirmButtonText: 'Guardar',
        cancelButtonText: 'Cancelar',
        preConfirm: () => normalize(document.getElementById('prodIdPrefix')?.value || ''),
        customClass: { popup: 'ios-alert', confirmButton: 'ios-btn ios-btn-primary', cancelButton: 'ios-btn ios-btn-secondary' },
        buttonsStyling: false
      });
      if (!res.isConfirmed) return;
      state.config.idPrefix = res.value || 'PROD-LJ';
      await window.dbLaJamoneraRest.write('/produccion/config', state.config);
      await openAlert('Configuración guardada', 'Se actualizó el prefijo de producción.', 'success');
    });

    nodes.viewListBtn?.addEventListener('click', () => setView('list'));
    nodes.viewHistoryBtn?.addEventListener('click', () => { setView('history'); renderHistory(); });
    nodes.applyFiltersBtn?.addEventListener('click', () => { state.historyPage = 1; renderHistory(); });

    nodes.historyTable?.addEventListener('click', async (event) => {
      const page = event.target.closest('[data-prod-page]');
      if (page) {
        state.historyPage += page.dataset.prodPage === 'next' ? 1 : -1;
        renderHistory();
        return;
      }
      const reportBtn = event.target.closest('[data-prod-report]');
      if (reportBtn) {
        await openReport(reportBtn.dataset.prodReport);
        return;
      }
      const cancelBtn = event.target.closest('[data-prod-cancel]');
      if (cancelBtn) await cancelProduction(cancelBtn.dataset.prodCancel);
    });

    modalEl.addEventListener('show.bs.modal', async () => {
      show('loading');
      await loadData();
      renderList();
      renderHistory();
      setView('list');
      show('data');
    });

    modalEl.addEventListener('hide.bs.modal', async (event) => {
      if (state.allowClose) { state.allowClose = false; return; }
      if (!state.detail) return;
      event.preventDefault();
      const res = await Swal.fire({
        title: 'Producción en curso',
        html: '<p>Se guardará borrador para retomar al volver a abrir.</p>',
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Cerrar y guardar borrador',
        cancelButtonText: 'Volver',
        customClass: { popup: 'ios-alert', confirmButton: 'ios-btn ios-btn-primary', cancelButton: 'ios-btn ios-btn-secondary' },
        buttonsStyling: false
      });
      if (!res.isConfirmed) return;
      await saveDraft();
      state.detail = null;
      state.allowClose = true;
      bootstrap.Modal.getOrCreateInstance(modalEl).hide();
    });
  };

  wireEvents();
})();
