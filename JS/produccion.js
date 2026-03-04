(function produccionModule() {
  const modal = document.getElementById('produccionModal');
  if (!modal) return;

  const SESSION_ID = (() => {
    const key = 'laJamoneraProductionSession';
    const cached = localStorage.getItem(key);
    if (cached) return cached;
    const created = `prod_session_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(key, created);
    return created;
  })();
  const RESERVATION_MINUTES = 10;
  const DEFAULT_IMAGE = 'https://i.postimg.cc/fyvNDdrt/FIambres.png';

  const $ = (id) => document.getElementById(id);
  const nodes = {
    loading: $('produccionLoading'),
    data: $('produccionData'),
    listView: $('produccionListView'),
    editor: $('produccionEditor'),
    editorForm: $('produccionEditorForm'),
    editorTitle: $('produccionEditorTitle'),
    searchInput: $('produccionSearchInput'),
    backBtn: $('produccionBackBtn'),
    configBtn: $('produccionConfigBtn'),
    historyBtn: $('produccionOpenListBtn'),
    historyView: $('produccionHistoryView')
  };

  const state = {
    recetas: {},
    ingredientes: {},
    inventario: { items: {}, config: {} },
    reservas: {},
    producciones: {},
    users: {},
    preferences: {},
    search: '',
    view: 'list',
    activeRecipeId: '',
    analysisCache: {},
    activeDraft: null,
    activeReservationId: '',
    config: { prefix: 'PROD-LJ' },
    listEventsBound: false
  };

  const normalizeValue = (v) => String(v || '').trim();
  const normalizeLower = (v) => normalizeValue(v).toLowerCase();
  const safeObject = (v) => (v && typeof v === 'object' ? v : {});
  const parseNumber = (v) => {
    const n = Number(String(v || '').replace(',', '.'));
    return Number.isFinite(n) ? n : NaN;
  };
  const cap = (v) => normalizeLower(v).replace(/(^|\s)\S/g, (c) => c.toUpperCase());
  const esc = (v) => String(v || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  const makeId = (p) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const openIosSwal = (options) => Swal.fire({
    ...options,
    customClass: {
      popup: 'ios-alert ingredientes-alert',
      title: 'ios-alert-title',
      htmlContainer: 'ios-alert-text',
      confirmButton: 'ios-btn ios-btn-primary',
      cancelButton: 'ios-btn ios-btn-secondary',
      denyButton: 'ios-btn ios-btn-secondary',
      ...options.customClass
    },
    buttonsStyling: false,
    returnFocus: false
  });

  const showMainState = (loading) => {
    nodes.loading.classList.toggle('d-none', !loading);
    nodes.data.classList.toggle('d-none', loading);
  };

  const unitCategory = (unitRaw) => {
    const u = normalizeLower(unitRaw);
    if (['kg', 'kilo', 'kilos', 'kilogramo', 'kilogramos', 'g', 'gr', 'gramo', 'gramos'].includes(u)) return 'peso';
    if (['l', 'lt', 'litro', 'litros', 'ml', 'mililitro', 'mililitros', 'cc'].includes(u)) return 'volumen';
    if (['unidad', 'unidades', 'u'].includes(u)) return 'unidad';
    if (['paquete', 'paquetes'].includes(u)) return 'paquete';
    return 'otro';
  };

  const toBase = (qty, unitRaw) => {
    const u = normalizeLower(unitRaw);
    const n = Number(qty);
    if (!Number.isFinite(n)) return Number.NaN;
    if (['kg', 'kilo', 'kilos', 'kilogramo', 'kilogramos'].includes(u)) return n * 1000;
    if (['g', 'gr', 'gramo', 'gramos'].includes(u)) return n;
    if (['l', 'lt', 'litro', 'litros'].includes(u)) return n * 1000;
    if (['ml', 'mililitro', 'mililitros', 'cc'].includes(u)) return n;
    return n;
  };

  const fromBase = (baseQty, unitRaw) => {
    const u = normalizeLower(unitRaw);
    const n = Number(baseQty);
    if (!Number.isFinite(n)) return Number.NaN;
    if (['kg', 'kilo', 'kilos', 'kilogramo', 'kilogramos'].includes(u)) return n / 1000;
    if (['l', 'lt', 'litro', 'litros'].includes(u)) return n / 1000;
    return n;
  };

  const convertUnit = (qty, fromUnit, toUnit) => {
    const fromCat = unitCategory(fromUnit);
    const toCat = unitCategory(toUnit);
    if (fromCat !== toCat) return Number.NaN;
    const base = toBase(qty, fromUnit);
    return fromBase(base, toUnit);
  };

  const formatDate = (ts) => new Date(Number(ts || Date.now())).toLocaleString('es-AR');
  const isoToday = () => new Date().toISOString().slice(0, 10);
  const isoToInt = (iso) => Number((normalizeValue(iso) || '0').replaceAll('-', ''));

  const getLotNumber = (entry) => {
    if (normalizeValue(entry?.lotNumber)) return entry.lotNumber;
    const invoice = normalizeValue(entry?.invoiceNumber) || 'SIN-FACTURA';
    const day = normalizeValue(entry?.entryDate) || isoToday();
    return `${invoice}-${day}`;
  };

  const isEntryUsableByDate = (entry, productionDateIso) => {
    const exp = normalizeValue(entry?.expiryDate);
    if (!exp) return true;
    return isoToInt(productionDateIso) <= isoToInt(exp);
  };

  const activeReservations = () => {
    const now = Date.now();
    return Object.values(safeObject(state.reservas)).filter((item) => Number(item.expiresAt) > now && item.status === 'active');
  };

  const getReservedForEntry = (ingredientId, entryId) => activeReservations().reduce((acc, res) => {
    if (res.sessionId === SESSION_ID) return acc;
    const hit = (Array.isArray(res.allocations) ? res.allocations : []).find((a) => a.ingredientId === ingredientId && a.entryId === entryId);
    return acc + Number(hit?.qty || 0);
  }, 0);

  const getEntriesForIngredient = (ingredientId, productionDateIso) => {
    const record = safeObject(state.inventario.items)[ingredientId] || {};
    const list = Array.isArray(record.entries) ? record.entries : [];
    return list
      .map((entry) => {
        const total = Number(entry.remainingQty ?? entry.qty ?? 0);
        const reserved = getReservedForEntry(ingredientId, entry.id);
        const available = Number((total - reserved).toFixed(4));
        const expired = !isEntryUsableByDate(entry, productionDateIso);
        return {
          ...entry,
          lotNumber: getLotNumber(entry),
          available,
          expired
        };
      })
      .filter((entry) => entry.available > 0 && !entry.expired && !['decomisado', 'vendido_local', 'anulado'].includes(normalizeLower(entry.status)))
      .sort((a, b) => {
        const expA = isoToInt(a.expiryDate || '9999-12-31');
        const expB = isoToInt(b.expiryDate || '9999-12-31');
        if (expA !== expB) return expA - expB;
        return Number(a.createdAt || 0) - Number(b.createdAt || 0);
      });
  };

  const getRecipes = () => Object.values(safeObject(state.recetas)).sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));

  const parseRecipeIngredients = (recipe) => (Array.isArray(recipe?.rows) ? recipe.rows : []).filter((r) => r.type === 'ingredient' && r.ingredientId && parseNumber(r.quantity) > 0);

  const analyzeRecipe = (recipe, productionDateIso = isoToday()) => {
    const cacheKey = `${recipe.id}_${productionDateIso}`;
    if (state.analysisCache[cacheKey]) return state.analysisCache[cacheKey];

    const yieldQty = parseNumber(recipe?.yieldQuantity);
    const yieldUnit = normalizeLower(recipe?.yieldUnit);
    const yieldCat = unitCategory(yieldUnit);
    const yieldKg = yieldCat === 'peso' ? convertUnit(yieldQty, yieldUnit, 'kg') : Number.NaN;
    const rows = parseRecipeIngredients(recipe);

    if (!Number.isFinite(yieldKg) || yieldKg <= 0) {
      const invalid = { invalid: true, reason: 'La receta no tiene un rinde compatible con kilos.' };
      state.analysisCache[cacheKey] = invalid;
      return invalid;
    }

    let maxKg = Number.POSITIVE_INFINITY;
    let totalCoverage = 0;
    const ingredientNeeds = [];

    for (const row of rows) {
      const recipeQty = parseNumber(row.quantity);
      const unit = normalizeLower(row.unit);
      const cat = unitCategory(unit);
      if (!Number.isFinite(recipeQty) || recipeQty <= 0 || cat === 'otro') {
        const invalid = { invalid: true, reason: `Unidad incompatible en ${row.ingredientName || 'ingrediente'}.` };
        state.analysisCache[cacheKey] = invalid;
        return invalid;
      }

      const perKg = recipeQty / yieldKg;
      const neededOneKg = perKg;
      const entries = getEntriesForIngredient(row.ingredientId, productionDateIso);
      const available = entries.reduce((acc, e) => {
        const converted = convertUnit(e.available, e.unit, unit);
        return acc + (Number.isFinite(converted) ? converted : 0);
      }, 0);

      const ingredientMaxKg = perKg > 0 ? available / perKg : 0;
      maxKg = Math.min(maxKg, ingredientMaxKg);
      totalCoverage += Math.min(1, neededOneKg > 0 ? available / neededOneKg : 1);

      ingredientNeeds.push({
        ingredientId: row.ingredientId,
        ingredientName: row.ingredientName,
        unit,
        perKg,
        neededOneKg,
        available,
        missingOneKg: Math.max(0, neededOneKg - available),
        entries
      });
    }

    const coverage = rows.length ? totalCoverage / rows.length : 0;
    const normalizedMax = Number.isFinite(maxKg) ? Number(Math.max(0, maxKg).toFixed(3)) : 0;
    const missing = ingredientNeeds.filter((item) => item.missingOneKg > 0.0001);

    const result = {
      invalid: false,
      yieldKg,
      maxKg: normalizedMax,
      coverage,
      ingredients: ingredientNeeds,
      missing,
      status: normalizedMax >= 1 ? 'green' : (coverage >= 0.5 ? 'orange' : 'red')
    };
    state.analysisCache[cacheKey] = result;
    return result;
  };

  const renderList = () => {
    const q = normalizeLower(state.search);
    const recipes = getRecipes().filter((item) => {
      const analysis = analyzeRecipe(item);
      const text = `${item.title} ${item.description}`.toLowerCase();
      const hasIng = analysis.ingredients?.some((ing) => normalizeLower(ing.ingredientName).includes(q));
      return !q || text.includes(q) || hasIng;
    });

    if (!recipes.length) {
      nodes.listView.innerHTML = '<div class="ingrediente-empty-list">No hay recetas para producir con ese filtro.</div>';
      return;
    }

    nodes.listView.innerHTML = recipes.map((item) => {
      const analysis = analyzeRecipe(item);
      if (analysis.invalid) {
        return `<article class="ingrediente-card receta-card prod-card is-danger"><div class="ingrediente-main receta-main"><h6 class="ingrediente-name receta-name">${esc(cap(item.title || 'Sin título'))}</h6><p class="ingrediente-description">${esc(analysis.reason)}</p><span class="prod-chip chip-red">Unidades incompatibles</span></div></article>`;
      }
      const pct = Math.max(0, Math.min(100, analysis.coverage * 100));
      const statusClass = analysis.status === 'green' ? 'chip-green' : (analysis.status === 'orange' ? 'chip-orange' : 'chip-red');
      const badgeMissing = analysis.missing.length ? `<span class="prod-mini-badge badge-missing">Faltan insumos (${analysis.missing.length})</span>` : '';
      const badgePartial = analysis.status === 'orange' ? '<span class="prod-mini-badge badge-partial">Stock parcial</span>' : '';
      const ctaInventory = analysis.maxKg < 1;
      const missingRows = analysis.missing.slice(0, 3).map((m) => `<li>${esc(cap(m.ingredientName))}: faltan ${m.missingOneKg.toFixed(2)} ${esc(m.unit)} para 1 kg</li>`).join('');
      return `
        <article class="ingrediente-card receta-card prod-card" data-prod-recipe="${item.id}">
          <div class="ingrediente-avatar receta-thumb-wrap">
            <span class="thumb-loading"><img class="meta-spinner-login" src="./IMG/Meta-ai-logo.webp" alt="Cargando"></span>
            <img class="receta-thumb js-prod-thumb" src="${esc(item.imageUrl || DEFAULT_IMAGE)}" alt="${esc(cap(item.title || 'Receta'))}" loading="lazy">
          </div>
          <div class="ingrediente-main receta-main">
            <h6 class="ingrediente-name receta-name">${esc(cap(item.title || 'Sin título'))}</h6>
            <p class="ingrediente-description">${esc(cap(item.description || 'Sin descripción'))}</p>
            <div class="prod-chip-row">
              <span class="prod-chip ${statusClass}">${analysis.status === 'green' ? 'Disponible' : (analysis.status === 'orange' ? 'Parcial' : 'Sin mínimo')}</span>
              <span class="prod-chip chip-info">Máx: ${analysis.maxKg.toFixed(2)} kg</span>
              ${badgeMissing}
              ${badgePartial}
            </div>
            <div class="prod-progress-wrap"><span>Cobertura receta</span><div class="prod-progress"><b style="width:${pct.toFixed(1)}%"></b></div></div>
            ${missingRows ? `<ul class="prod-missing-list">${missingRows}</ul>` : ''}
          </div>
          <div class="ingrediente-actions recipe-row-actions">
            <button class="btn ios-btn ${ctaInventory ? 'ios-btn-warning' : 'ios-btn-success'}" type="button" data-prod-action="${ctaInventory ? 'inventory' : 'produce'}" data-prod-id="${item.id}">
              <i class="fa-solid ${ctaInventory ? 'fa-boxes-stacked' : 'fa-plus'}"></i>
              <span>${ctaInventory ? '+ Inventario' : '+ Producir'}</span>
            </button>
          </div>
        </article>`;
    }).join('');

    nodes.listView.querySelectorAll('.js-prod-thumb').forEach((image) => {
      const wrapper = image.closest('.receta-thumb-wrap');
      const loading = wrapper?.querySelector('.thumb-loading');
      const ok = () => { image.classList.add('is-loaded'); loading?.classList.add('d-none'); };
      const fallback = () => {
        image.src = DEFAULT_IMAGE;
      };
      if (image.complete && image.naturalWidth > 0) ok();
      else {
        image.addEventListener('load', ok, { once: true });
        image.addEventListener('error', fallback, { once: true });
      }
    });
  };

  const getAllocationForQty = (recipe, qtyKg, productionDateIso) => {
    const analysis = analyzeRecipe(recipe, productionDateIso);
    if (analysis.invalid) return { invalid: true, message: analysis.reason };

    const allocations = [];
    for (const item of analysis.ingredients) {
      const needed = Number((item.perKg * qtyKg).toFixed(4));
      let left = needed;
      const rows = [];
      for (const entry of item.entries) {
        const availableInRecipeUnit = convertUnit(entry.available, entry.unit, item.unit);
        if (!Number.isFinite(availableInRecipeUnit) || availableInRecipeUnit <= 0) continue;
        const take = Math.min(left, availableInRecipeUnit);
        if (take <= 0) continue;
        left -= take;
        rows.push({
          ingredientId: item.ingredientId,
          ingredientName: item.ingredientName,
          entryId: entry.id,
          qty: Number(take.toFixed(4)),
          unit: item.unit,
          sourceUnit: entry.unit,
          lotNumber: entry.lotNumber,
          provider: entry.provider || '',
          invoiceNumber: entry.invoiceNumber || '',
          invoiceImageUrls: Array.isArray(entry.invoiceImageUrls) ? entry.invoiceImageUrls : [],
          entryDate: entry.entryDate || '',
          expiryDate: entry.expiryDate || '',
          createdAt: entry.createdAt || 0
        });
        if (left <= 0.0001) break;
      }
      if (left > 0.0001) {
        return { invalid: true, message: `Stock insuficiente para ${item.ingredientName}.` };
      }
      allocations.push(...rows);
    }

    return { invalid: false, allocations, analysis };
  };

  const setView = (view) => {
    state.view = view;
    nodes.listView.classList.toggle('d-none', view !== 'list');
    nodes.editor.classList.toggle('d-none', view !== 'editor');
    nodes.historyView.classList.toggle('d-none', view !== 'history');
  };

  const reserveStock = async (recipe, qtyKg, productionDateIso) => {
    const alloc = getAllocationForQty(recipe, qtyKg, productionDateIso);
    if (alloc.invalid) throw new Error(alloc.message);

    if (state.activeReservationId) {
      await window.dbLaJamoneraRest.write(`/produccion/reservas/${state.activeReservationId}`, null);
      state.activeReservationId = '';
    }

    const reservationId = makeId('res');
    const payload = {
      id: reservationId,
      sessionId: SESSION_ID,
      recipeId: recipe.id,
      qtyKg,
      productionDateIso,
      allocations: alloc.allocations,
      createdAt: Date.now(),
      expiresAt: Date.now() + (RESERVATION_MINUTES * 60 * 1000),
      status: 'active'
    };
    await window.dbLaJamoneraRest.write(`/produccion/reservas/${reservationId}`, payload);
    state.activeReservationId = reservationId;
    state.reservas[reservationId] = payload;
    return payload;
  };

  const renderEditor = async (recipeId, initial = {}) => {
    const recipe = state.recetas[recipeId];
    if (!recipe) return;
    state.activeRecipeId = recipeId;
    nodes.editorTitle.textContent = `Producción · ${cap(recipe.title || 'Sin título')}`;

    const productionDate = normalizeValue(initial.productionDate || isoToday());
    const maxForDate = analyzeRecipe(recipe, productionDate).maxKg;
    const qty = Number.isFinite(initial.qtyKg) ? initial.qtyKg : (maxForDate >= 1 ? 1 : maxForDate);

    let alloc;
    try {
      alloc = await reserveStock(recipe, qty, productionDate);
    } catch (error) {
      await openIosSwal({ title: 'No se pudo reservar stock', html: `<p>${esc(error.message)}</p>`, icon: 'warning', confirmButtonText: 'Entendido' });
      return;
    }

    const analysis = analyzeRecipe(recipe, productionDate);
    const grouped = alloc.allocations.reduce((acc, item) => {
      if (!acc[item.ingredientId]) acc[item.ingredientId] = { name: item.ingredientName, unit: item.unit, rows: [] };
      acc[item.ingredientId].rows.push(item);
      return acc;
    }, {});

    const userOptions = Object.values(safeObject(state.users)).map((u) => {
      const email = normalizeValue(u?.email || u?.mail || u?.usuario || u?.name || u?.nombre);
      return email ? `<option value="${esc(email)}">${esc(email)}</option>` : '';
    }).join('');

    nodes.editorForm.innerHTML = `
      <div class="inventario-product-head inventario-product-head-v2 prod-head">
        <div class="inventario-editor-photo">
          <div class="ingrediente-avatar receta-thumb-wrap">
            <span class="thumb-loading"><img class="meta-spinner-login" src="./IMG/Meta-ai-logo.webp" alt="Cargando"></span>
            <img class="receta-thumb js-prod-thumb" src="${esc(recipe.imageUrl || DEFAULT_IMAGE)}" alt="${esc(cap(recipe.title || 'Producto'))}">
          </div>
        </div>
        <div class="prod-head-main">
          <p class="recetas-editor-kicker"><img src="./IMG/Octicons-git-branch.svg" class="prod-head-icon" alt="Flujo"> Producción</p>
          <h5>${esc(cap(recipe.title || 'Sin título'))}</h5>
          <p>${esc(cap(recipe.description || 'Sin descripción'))}</p>
          <p class="prod-max-line">Máximo producible hoy: <strong>${analysis.maxKg.toFixed(2)} kg</strong></p>
        </div>
      </div>

      <div class="prod-grid-2">
        <div>
          <label class="form-label">¿Qué cantidad deseás producir? (kg)</label>
          <input id="prodQtyInput" class="form-control ios-input" type="number" min="0.1" step="0.01" value="${qty.toFixed(2)}">
          <small class="text-muted">Mínimo recomendado: 1 kg · permitidos decimales.</small>
        </div>
        <div>
          <label class="form-label">Fecha de producción</label>
          <input id="prodDateInput" class="form-control ios-input" type="text" value="${productionDate}">
        </div>
      </div>

      <div class="prod-grid-2">
        <div>
          <label class="form-label">Encargados</label>
          <select id="prodManagersInput" class="form-select ios-input" multiple>${userOptions}</select>
        </div>
        <div>
          <label class="form-label">Observaciones</label>
          <textarea id="prodObsInput" class="form-control ios-input" rows="3" placeholder="Notas, incidentes, reemplazos..."></textarea>
        </div>
      </div>

      <div class="prod-breakdown-wrap">
        <h6><img src="./IMG/Octicons-git-merge.svg" class="prod-head-icon" alt="Desglose"> Desglose FEFO por lotes</h6>
        ${Object.values(grouped).map((g) => `
          <div class="prod-group">
            <p class="prod-group-title">${esc(cap(g.name))}</p>
            <table class="table recipe-table mb-0">
              <thead><tr><th>Lote</th><th>Ingreso</th><th>Vencimiento</th><th>Cantidad</th><th>Proveedor</th><th>N° lote/factura</th><th>Adjuntos</th></tr></thead>
              <tbody>
                ${g.rows.map((row) => `<tr>
                  <td>${esc(row.lotNumber)}</td>
                  <td>${esc(row.entryDate || '-')}</td>
                  <td>${esc(row.expiryDate || '-')}</td>
                  <td>${row.qty.toFixed(2)} ${esc(row.unit)}</td>
                  <td>${esc(row.provider || 'No indica')}</td>
                  <td>${esc(row.invoiceNumber || row.lotNumber)}</td>
                  <td>${row.invoiceImageUrls.length ? `<span class="prod-mini-badge">${row.invoiceImageUrls.length} imagen/es</span>` : '<span class="prod-mini-badge badge-muted">Sin imágenes</span>'}</td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>`).join('')}
      </div>

      <div class="prod-actions-row">
        <button id="prodSaveDraftBtn" type="button" class="btn ios-btn ios-btn-secondary"><i class="fa-regular fa-floppy-disk"></i><span>Guardar borrador</span></button>
        <button id="prodConfirmBtn" type="submit" class="btn ios-btn ios-btn-success"><i class="fa-solid fa-circle-check"></i><span>Confirmar producción</span></button>
      </div>
    `;

    setView('editor');

    nodes.editorForm.querySelectorAll('.js-prod-thumb').forEach((image) => {
      const wrap = image.closest('.receta-thumb-wrap');
      const loading = wrap?.querySelector('.thumb-loading');
      const ready = () => { image.classList.add('is-loaded'); loading?.classList.add('d-none'); };
      if (image.complete && image.naturalWidth > 0) ready();
      else image.addEventListener('load', ready, { once: true });
    });

    if (window.flatpickr) {
      const locale = window.flatpickr.l10ns?.es || undefined;
      window.flatpickr(nodes.editorForm.querySelector('#prodDateInput'), { locale, dateFormat: 'Y-m-d', allowInput: true });
    }

    nodes.editorForm.querySelector('#prodQtyInput')?.addEventListener('change', () => rerenderEditorFromInputs());
    nodes.editorForm.querySelector('#prodDateInput')?.addEventListener('change', () => rerenderEditorFromInputs());
    nodes.editorForm.querySelector('#prodSaveDraftBtn')?.addEventListener('click', saveDraft);
    nodes.editorForm.onsubmit = submitProduction;
  };

  const rerenderEditorFromInputs = async () => {
    const qty = parseNumber(nodes.editorForm.querySelector('#prodQtyInput')?.value);
    const date = normalizeValue(nodes.editorForm.querySelector('#prodDateInput')?.value || isoToday());
    const recipe = state.recetas[state.activeRecipeId];
    if (!recipe) return;
    const analysis = analyzeRecipe(recipe, date);
    if (qty > analysis.maxKg) {
      await openIosSwal({ title: 'Cantidad inválida', html: `<p>No podés superar ${analysis.maxKg.toFixed(2)} kg con el stock disponible.</p>`, icon: 'warning', confirmButtonText: 'Entendido' });
      return;
    }
    await renderEditor(state.activeRecipeId, { qtyKg: qty, productionDate: date });
  };

  const saveDraft = async () => {
    const payload = {
      id: SESSION_ID,
      recipeId: state.activeRecipeId,
      qtyKg: parseNumber(nodes.editorForm.querySelector('#prodQtyInput')?.value),
      productionDate: normalizeValue(nodes.editorForm.querySelector('#prodDateInput')?.value || isoToday()),
      managers: [...(nodes.editorForm.querySelector('#prodManagersInput')?.selectedOptions || [])].map((o) => o.value),
      observations: normalizeValue(nodes.editorForm.querySelector('#prodObsInput')?.value),
      reservationId: state.activeReservationId,
      updatedAt: Date.now()
    };
    await window.dbLaJamoneraRest.write(`/produccion/drafts/${SESSION_ID}`, payload);
    localStorage.setItem('laJamoneraProductionDraft', JSON.stringify(payload));
    state.activeDraft = payload;
    await openIosSwal({ title: 'Borrador guardado', html: '<p>Se guardó automáticamente en Firebase y localStorage.</p>', icon: 'success', confirmButtonText: 'Continuar' });
  };

  const nextProductionId = async () => {
    const today = isoToday().replaceAll('-', '');
    const path = `/produccion/index/${today}`;
    const current = Number(await window.dbLaJamoneraRest.read(path)) || 0;
    const next = current + 1;
    await window.dbLaJamoneraRest.write(path, next);
    const prefix = normalizeValue(state.config.prefix) || 'PROD-LJ';
    return `${prefix}-${today}-${String(next).padStart(4, '0')}`;
  };

  const submitProduction = async (event) => {
    event.preventDefault();
    const recipe = state.recetas[state.activeRecipeId];
    if (!recipe) return;

    const qtyKg = parseNumber(nodes.editorForm.querySelector('#prodQtyInput')?.value);
    const productionDate = normalizeValue(nodes.editorForm.querySelector('#prodDateInput')?.value || isoToday());
    const managers = [...(nodes.editorForm.querySelector('#prodManagersInput')?.selectedOptions || [])].map((o) => o.value);
    const observations = normalizeValue(nodes.editorForm.querySelector('#prodObsInput')?.value);

    const analysis = analyzeRecipe(recipe, productionDate);
    if (!Number.isFinite(qtyKg) || qtyKg <= 0 || qtyKg > analysis.maxKg) {
      await openIosSwal({ title: 'Cantidad inválida', html: '<p>Revisá la cantidad a producir.</p>', icon: 'warning', confirmButtonText: 'Entendido' });
      return;
    }

    const ask = await openIosSwal({
      title: 'Confirmar producción final',
      html: '<p>Se descontará stock real y se registrará trazabilidad por lote.</p>',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Confirmar',
      cancelButtonText: 'Cancelar'
    });
    if (!ask.isConfirmed) return;

    const allocationResult = getAllocationForQty(recipe, qtyKg, productionDate);
    if (allocationResult.invalid) {
      await openIosSwal({ title: 'Conflicto de stock', html: `<p>${esc(allocationResult.message)}<br>El stock pudo haber cambiado.</p>`, icon: 'warning', confirmButtonText: 'Entendido' });
      return;
    }

    const productionId = await nextProductionId();
    const now = Date.now();

    const groupedUsage = allocationResult.allocations.reduce((acc, item) => {
      if (!acc[item.ingredientId]) acc[item.ingredientId] = [];
      acc[item.ingredientId].push(item);
      return acc;
    }, {});

    Object.entries(groupedUsage).forEach(([ingredientId, uses]) => {
      const record = safeObject(state.inventario.items)[ingredientId];
      if (!record || !Array.isArray(record.entries)) return;
      uses.forEach((use) => {
        const entry = record.entries.find((e) => e.id === use.entryId);
        if (!entry) return;
        const takeSourceUnit = convertUnit(use.qty, use.unit, entry.unit);
        const remaining = Number(entry.remainingQty ?? entry.qty ?? 0);
        entry.remainingQty = Number(Math.max(0, remaining - takeSourceUnit).toFixed(4));
        entry.status = entry.remainingQty <= 0.0001 ? 'consumido_produccion' : 'disponible';
        entry.lotNumber = entry.lotNumber || getLotNumber(entry);
        entry.movements = Array.isArray(entry.movements) ? entry.movements : [];
        entry.movements.unshift({
          id: makeId('mov'),
          type: 'consumo_produccion',
          reference: productionId,
          qty: Number(takeSourceUnit.toFixed(4)),
          unit: entry.unit,
          user: 'La Jamonera',
          at: now,
          observations
        });
      });
      record.stockKg = Number((record.entries.reduce((sum, e) => {
        const qty = Number(e.remainingQty ?? e.qty ?? 0);
        if (normalizeLower(e.unit).includes('gram')) return sum + (qty / 1000);
        return sum + qty;
      }, 0)).toFixed(4));
    });

    const payload = {
      id: productionId,
      recipeId: recipe.id,
      recipeTitle: recipe.title,
      productionDate,
      qtyKg,
      managers,
      observations,
      lots: allocationResult.allocations,
      createdBy: 'La Jamonera',
      createdAt: now,
      updatedAt: now,
      status: 'confirmada',
      audit: [{ at: now, user: 'La Jamonera', action: 'create', oldValue: null, newValue: { qtyKg, productionDate }, reason: 'confirmación' }]
    };

    await window.dbLaJamoneraRest.write('/inventario', state.inventario);
    await window.dbLaJamoneraRest.write(`/produccion/registros/${productionId}`, payload);
    await window.dbLaJamoneraRest.write(`/produccion/auditoria/${productionId}/${now}`, payload.audit[0]);
    if (state.activeReservationId) await window.dbLaJamoneraRest.write(`/produccion/reservas/${state.activeReservationId}`, null);
    await window.dbLaJamoneraRest.write(`/produccion/drafts/${SESSION_ID}`, null);
    localStorage.removeItem('laJamoneraProductionDraft');

    state.activeReservationId = '';
    state.activeDraft = null;
    state.analysisCache = {};
    await loadData();
    renderList();
    setView('list');

    await openIosSwal({ title: 'Producción guardada', html: `<p>ID: <strong>${esc(productionId)}</strong></p>`, icon: 'success', confirmButtonText: 'Entendido' });
  };

  const renderHistory = () => {
    const rows = Object.values(safeObject(state.producciones)).sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    nodes.historyView.innerHTML = `
      <div class="prod-history-head">
        <button type="button" class="btn ios-btn ios-btn-secondary" id="prodHistoryBackBtn"><i class="fa-solid fa-arrow-left"></i><span>Volver</span></button>
      </div>
      <div class="table-responsive inventario-table-compact-wrap">
        <table class="table recipe-table inventario-table-compact mb-0">
          <thead><tr><th>ID</th><th>Fecha</th><th>Producto</th><th>Cantidad</th><th>Encargados</th><th>Estado</th></tr></thead>
          <tbody>
            ${rows.length ? rows.map((row, i) => `<tr class="inventario-row-tone ${i % 2 === 0 ? 'is-even-row' : 'is-odd-row'}"><td>${esc(row.id)}</td><td>${esc(row.productionDate || '-')}</td><td>${esc(cap(row.recipeTitle || '-'))}</td><td>${Number(row.qtyKg || 0).toFixed(2)} kg</td><td>${esc((row.managers || []).join(', ') || '-')}</td><td>${esc(cap(row.status || '-'))}</td></tr>`).join('') : '<tr><td colspan="6" class="text-center">Sin producciones registradas.</td></tr>'}
          </tbody>
        </table>
      </div>`;
    nodes.historyView.querySelector('#prodHistoryBackBtn')?.addEventListener('click', () => setView('list'));
  };

  const openConfig = async () => {
    const answer = await openIosSwal({
      title: 'Configuración de ID de producción',
      html: `<label class="form-label" for="prodPrefixInput">Prefijo</label><input id="prodPrefixInput" class="swal2-input ios-input" value="${esc(state.config.prefix || 'PROD-LJ')}">`,
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      cancelButtonText: 'Cancelar',
      preConfirm: () => normalizeValue(document.getElementById('prodPrefixInput')?.value || '')
    });
    if (!answer.isConfirmed) return;
    state.config.prefix = answer.value || 'PROD-LJ';
    await window.dbLaJamoneraRest.write('/produccion/config', state.config);
  };

  const loadData = async () => {
    await window.laJamoneraReady;
    const [recetas, ingredientes, inventario, reservas, producciones, users, config, prefs] = await Promise.all([
      window.dbLaJamoneraRest.read('/recetas'),
      window.dbLaJamoneraRest.read('/ingredientes/items'),
      window.dbLaJamoneraRest.read('/inventario'),
      window.dbLaJamoneraRest.read('/produccion/reservas'),
      window.dbLaJamoneraRest.read('/produccion/registros'),
      window.dbLaJamoneraRest.read('/informes/users'),
      window.dbLaJamoneraRest.read('/produccion/config'),
      window.dbLaJamoneraRest.read('/produccion/preferences')
    ]);

    state.recetas = safeObject(recetas);
    state.ingredientes = safeObject(ingredientes);
    state.inventario = safeObject(inventario);
    state.reservas = safeObject(reservas);
    state.producciones = safeObject(producciones);
    state.users = safeObject(users);
    state.config = { prefix: 'PROD-LJ', ...safeObject(config) };
    state.preferences = safeObject(prefs);
    state.analysisCache = {};
  };

  const openInventoryFromProduction = () => {
    const instance = bootstrap.Modal.getOrCreateInstance(modal);
    instance.hide();
    const inventoryModal = document.getElementById('inventarioModal');
    if (inventoryModal) bootstrap.Modal.getOrCreateInstance(inventoryModal).show();
  };

  const bindListEvents = () => {
    if (state.listEventsBound) return;
    state.listEventsBound = true;
    nodes.listView.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-prod-action]');
      if (!btn) return;
      const id = btn.dataset.prodId;
      if (btn.dataset.prodAction === 'inventory') return openInventoryFromProduction();
      renderEditor(id, { qtyKg: 1, productionDate: isoToday() });
    });
  };

  const askRecoverDraft = async () => {
    const remote = await window.dbLaJamoneraRest.read(`/produccion/drafts/${SESSION_ID}`);
    const local = (() => {
      try { return JSON.parse(localStorage.getItem('laJamoneraProductionDraft') || 'null'); } catch (e) { return null; }
    })();
    const draft = remote || local;
    if (!draft || !draft.recipeId) return;

    const answer = await openIosSwal({
      title: 'Borrador detectado',
      html: '<p>Encontramos una producción sin finalizar.</p>',
      showDenyButton: true,
      showCancelButton: true,
      confirmButtonText: 'Continuar borrador',
      denyButtonText: 'Descartar borrador',
      cancelButtonText: 'Cerrar'
    });
    if (answer.isConfirmed) {
      await renderEditor(draft.recipeId, { qtyKg: Number(draft.qtyKg || 1), productionDate: draft.productionDate || isoToday() });
    }
    if (answer.isDenied) {
      await window.dbLaJamoneraRest.write(`/produccion/drafts/${SESSION_ID}`, null);
      localStorage.removeItem('laJamoneraProductionDraft');
    }
  };

  nodes.searchInput?.addEventListener('input', () => {
    state.search = nodes.searchInput.value || '';
    renderList();
  });

  nodes.backBtn?.addEventListener('click', async () => {
    const answer = await openIosSwal({
      title: '¿Deseás abandonar esta producción?',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Abandonar',
      cancelButtonText: 'Seguir'
    });
    if (!answer.isConfirmed) return;
    if (state.activeReservationId) {
      await window.dbLaJamoneraRest.write(`/produccion/reservas/${state.activeReservationId}`, null);
      state.activeReservationId = '';
    }
    setView('list');
  });

  nodes.configBtn?.addEventListener('click', openConfig);
  nodes.historyBtn?.addEventListener('click', () => {
    renderHistory();
    setView('history');
  });

  modal.addEventListener('show.bs.modal', async () => {
    showMainState(true);
    setView('list');
    try {
      await loadData();
      renderList();
      bindListEvents();
      await askRecoverDraft();
    } finally {
      showMainState(false);
    }
  });

  modal.addEventListener('hidden.bs.modal', async () => {
    if (state.view === 'editor' && state.activeRecipeId) {
      try {
        await saveDraft();
      } catch (error) {
      }
    }
  });
})();
