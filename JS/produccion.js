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
  const PRODUCT_BG_IMAGE = 'https://i.postimg.cc/fyvNDdrt/FIambres.png';

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
    historyView: $('produccionHistoryView'),
    toolbar: modal.querySelector('.produccion-toolbar')
  };

  const state = {
    recetas: {},
    inventario: { items: {}, config: {} },
    reservas: {},
    producciones: {},
    users: {},
    search: '',
    view: 'list',
    activeRecipeId: '',
    activeReservationId: '',
    analysisCache: {},
    config: { prefix: 'PROD-LJ' },
    listEventsBound: false
  };

  const normalizeValue = (value) => String(value || '').trim();
  const normalizeLower = (value) => normalizeValue(value).toLowerCase();
  const safeObject = (value) => (value && typeof value === 'object' ? value : {});
  const parseNumber = (value) => {
    const parsed = Number(String(value || '').replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : NaN;
  };
  const esc = (value) => String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
  const cap = (value) => normalizeLower(value).replace(/(^|\s)\S/g, (char) => char.toUpperCase());
  const makeId = (prefix) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const isoToday = () => new Date().toISOString().slice(0, 10);
  const isoToInt = (isoDate) => Number(normalizeValue(isoDate).replaceAll('-', '')) || 0;

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

  const setView = (view) => {
    state.view = view;
    nodes.listView.classList.toggle('d-none', view !== 'list');
    nodes.editor.classList.toggle('d-none', view !== 'editor');
    nodes.historyView.classList.toggle('d-none', view !== 'history');
    nodes.toolbar?.classList.toggle('d-none', view !== 'list');
  };

  const unitCategory = (unitRaw) => {
    const unit = normalizeLower(unitRaw);
    if (['kg', 'kilo', 'kilos', 'kilogramo', 'kilogramos', 'g', 'gr', 'gramo', 'gramos'].includes(unit)) return 'peso';
    if (['l', 'lt', 'litro', 'litros', 'ml', 'mililitro', 'mililitros', 'cc'].includes(unit)) return 'volumen';
    if (['unidad', 'unidades', 'u'].includes(unit)) return 'unidad';
    if (['paquete', 'paquetes'].includes(unit)) return 'paquete';
    return 'otro';
  };

  const toBase = (qty, unitRaw) => {
    const unit = normalizeLower(unitRaw);
    const value = Number(qty);
    if (!Number.isFinite(value)) return Number.NaN;
    if (['kg', 'kilo', 'kilos', 'kilogramo', 'kilogramos'].includes(unit)) return value * 1000;
    if (['g', 'gr', 'gramo', 'gramos'].includes(unit)) return value;
    if (['l', 'lt', 'litro', 'litros'].includes(unit)) return value * 1000;
    if (['ml', 'mililitro', 'mililitros', 'cc'].includes(unit)) return value;
    return value;
  };

  const fromBase = (qty, unitRaw) => {
    const unit = normalizeLower(unitRaw);
    const value = Number(qty);
    if (!Number.isFinite(value)) return Number.NaN;
    if (['kg', 'kilo', 'kilos', 'kilogramo', 'kilogramos'].includes(unit)) return value / 1000;
    if (['l', 'lt', 'litro', 'litros'].includes(unit)) return value / 1000;
    return value;
  };

  const convertUnit = (qty, fromUnit, toUnit) => {
    if (unitCategory(fromUnit) !== unitCategory(toUnit)) return Number.NaN;
    return fromBase(toBase(qty, fromUnit), toUnit);
  };

  const getUserFullName = (user) => {
    const first = normalizeValue(user?.firstName || user?.name || user?.nombre || user?.first_name);
    const last = normalizeValue(user?.lastName || user?.lastname || user?.apellido || user?.last_name);
    const both = `${first} ${last}`.trim();
    if (both) return both;
    return normalizeValue(user?.displayName || user?.usuario || user?.email || 'Sin nombre');
  };

  const getUserEmail = (user) => normalizeValue(user?.email || user?.mail || user?.usuario || '');
  const getUserPhoto = (user) => normalizeValue(user?.photoUrl || user?.avatar || user?.imageUrl || user?.foto || '');

  const getLotNumber = (entry) => {
    if (normalizeValue(entry?.lotNumber)) return entry.lotNumber;
    const invoice = normalizeValue(entry?.invoiceNumber) || 'SIN-FACTURA';
    const day = normalizeValue(entry?.entryDate) || isoToday();
    return `${invoice}-${day}`;
  };

  const isEntryUsableByDate = (entry, productionDateIso) => {
    const expiryDate = normalizeValue(entry?.expiryDate);
    if (!expiryDate) return true;
    return isoToInt(productionDateIso) <= isoToInt(expiryDate);
  };

  const activeReservations = () => {
    const now = Date.now();
    return Object.values(safeObject(state.reservas)).filter((item) => item?.status === 'active' && Number(item?.expiresAt) > now);
  };

  const reservedQtyByOthers = (ingredientId, entryId) => activeReservations().reduce((sum, reservation) => {
    if (reservation.sessionId === SESSION_ID) return sum;
    const found = (Array.isArray(reservation.allocations) ? reservation.allocations : [])
      .find((alloc) => alloc.ingredientId === ingredientId && alloc.entryId === entryId);
    return sum + Number(found?.qtySource || 0);
  }, 0);

  const getIngredientEntries = (ingredientId, productionDateIso) => {
    const record = safeObject(state.inventario.items)[ingredientId] || {};
    const entries = Array.isArray(record.entries) ? record.entries : [];

    return entries
      .map((entry) => {
        const total = Number(entry.remainingQty ?? entry.qty ?? 0);
        const reservedByOthers = reservedQtyByOthers(ingredientId, entry.id);
        const available = Number(Math.max(0, total - reservedByOthers).toFixed(4));
        return {
          ...entry,
          lotNumber: getLotNumber(entry),
          available,
          expired: !isEntryUsableByDate(entry, productionDateIso)
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

  const getRecipeIngredientRows = (recipe) => (Array.isArray(recipe?.rows) ? recipe.rows : [])
    .filter((row) => row.type === 'ingredient' && row.ingredientId && parseNumber(row.quantity) > 0);

  const analyzeRecipe = (recipe, productionDateIso = isoToday()) => {
    const cacheKey = `${recipe.id}_${productionDateIso}`;
    if (state.analysisCache[cacheKey]) return state.analysisCache[cacheKey];

    const yieldQty = parseNumber(recipe?.yieldQuantity);
    const yieldUnit = normalizeLower(recipe?.yieldUnit);
    const yieldKg = unitCategory(yieldUnit) === 'peso' ? convertUnit(yieldQty, yieldUnit, 'kg') : Number.NaN;
    const rows = getRecipeIngredientRows(recipe);

    if (!Number.isFinite(yieldKg) || yieldKg <= 0) {
      const invalid = { invalid: true, reason: 'La receta no tiene un rinde válido en peso (kg).' };
      state.analysisCache[cacheKey] = invalid;
      return invalid;
    }

    let maxKg = Number.POSITIVE_INFINITY;
    let coverageAccumulator = 0;
    const ingredientAnalysis = [];

    for (const row of rows) {
      const ingredientQty = parseNumber(row.quantity);
      const ingredientUnit = normalizeLower(row.unit);

      if (!Number.isFinite(ingredientQty) || ingredientQty <= 0 || unitCategory(ingredientUnit) === 'otro') {
        const invalid = { invalid: true, reason: `Unidad incompatible para ${row.ingredientName || 'ingrediente'}.` };
        state.analysisCache[cacheKey] = invalid;
        return invalid;
      }

      const perKg = ingredientQty / yieldKg;
      const neededForOneKg = perKg;
      const entries = getIngredientEntries(row.ingredientId, productionDateIso);

      const availableInRecipeUnit = entries.reduce((sum, entry) => {
        const converted = convertUnit(entry.available, entry.unit, ingredientUnit);
        return sum + (Number.isFinite(converted) ? converted : 0);
      }, 0);

      const ingredientMaxKg = perKg > 0 ? availableInRecipeUnit / perKg : 0;
      maxKg = Math.min(maxKg, ingredientMaxKg);
      coverageAccumulator += Math.min(1, neededForOneKg > 0 ? (availableInRecipeUnit / neededForOneKg) : 1);

      ingredientAnalysis.push({
        ingredientId: row.ingredientId,
        ingredientName: row.ingredientName,
        unit: ingredientUnit,
        perKg,
        neededForOneKg,
        availableForOneKg: availableInRecipeUnit,
        missingToOneKg: Math.max(0, neededForOneKg - availableInRecipeUnit),
        entries
      });
    }

    const normalizedMax = Number.isFinite(maxKg) ? Number(Math.max(0, maxKg).toFixed(3)) : 0;
    const coverage = rows.length ? coverageAccumulator / rows.length : 0;
    const missing = ingredientAnalysis.filter((item) => item.missingToOneKg > 0.0001);

    const result = {
      invalid: false,
      maxKg: normalizedMax,
      coverage,
      missing,
      ingredients: ingredientAnalysis,
      status: normalizedMax >= 1 ? 'green' : (coverage >= 0.5 ? 'orange' : 'red')
    };

    state.analysisCache[cacheKey] = result;
    return result;
  };

  const renderRecipeList = () => {
    const query = normalizeLower(state.search);
    const recipes = getRecipes().filter((recipe) => {
      const analysis = analyzeRecipe(recipe);
      const plain = `${recipe.title || ''} ${recipe.description || ''}`.toLowerCase();
      const hasIngredientMatch = analysis.ingredients?.some((item) => normalizeLower(item.ingredientName).includes(query));
      return !query || plain.includes(query) || hasIngredientMatch;
    });

    if (!recipes.length) {
      nodes.listView.innerHTML = '<div class="ingrediente-empty-list">No encontramos recetas con ese filtro.</div>';
      return;
    }

    nodes.listView.innerHTML = recipes.map((recipe) => {
      const analysis = analyzeRecipe(recipe);

      if (analysis.invalid) {
        return `<article class="ingrediente-card receta-card prod-card">
          <div class="ingrediente-main receta-main">
            <h6 class="ingrediente-name receta-name">${esc(cap(recipe.title || 'Sin título'))}</h6>
            <p class="ingrediente-description">${esc(analysis.reason)}</p>
            <span class="prod-chip chip-red">Unidad incompatible</span>
          </div>
        </article>`;
      }

      const progress = Math.max(0, Math.min(100, analysis.coverage * 100));
      const statusClass = analysis.status === 'green' ? 'chip-green' : (analysis.status === 'orange' ? 'chip-orange' : 'chip-red');
      const statusText = analysis.status === 'green' ? 'Disponible' : (analysis.status === 'orange' ? 'Parcial' : 'Sin mínimo');
      const ctaToInventory = analysis.maxKg < 1;
      const missingPreview = analysis.missing.slice(0, 3).map((item) => `
        <li><strong>${esc(cap(item.ingredientName))}:</strong> faltan ${item.missingToOneKg.toFixed(2)} ${esc(item.unit)} para 1 kg</li>
      `).join('');

      return `
        <article class="ingrediente-card receta-card prod-card" data-prod-recipe="${recipe.id}">
          <div class="ingrediente-avatar receta-thumb-wrap prod-list-thumb-wrap">
            <span class="thumb-loading"><img class="meta-spinner-login" src="./IMG/Meta-ai-logo.webp" alt="Cargando"></span>
            <img class="receta-thumb js-prod-thumb" src="${esc(recipe.imageUrl || PRODUCT_BG_IMAGE)}" alt="${esc(cap(recipe.title || 'Receta'))}" loading="lazy">
          </div>
          <div class="ingrediente-main receta-main">
            <h6 class="ingrediente-name receta-name">${esc(cap(recipe.title || 'Sin título'))}</h6>
            <p class="ingrediente-description">${esc(cap(recipe.description || 'Sin descripción'))}</p>

            <div class="prod-chip-row">
              <span class="prod-chip ${statusClass}">${statusText}</span>
              <span class="prod-chip chip-info">Máx: ${analysis.maxKg.toFixed(2)} kg</span>
              ${analysis.missing.length ? `<span class="prod-mini-badge badge-missing">Faltan insumos (${analysis.missing.length})</span>` : ''}
              ${analysis.status === 'orange' ? '<span class="prod-mini-badge badge-partial">Stock parcial</span>' : ''}
            </div>

            <div class="prod-progress-wrap">
              <span>Cobertura receta</span>
              <div class="prod-progress"><b style="width:${progress.toFixed(1)}%"></b></div>
            </div>

            ${missingPreview ? `<ul class="prod-missing-list">${missingPreview}</ul>` : ''}
          </div>
          <div class="ingrediente-actions recipe-row-actions prod-action-wrap">
            <button type="button" class="btn ios-btn ${ctaToInventory ? 'ios-btn-warning' : 'ios-btn-success'}" data-prod-action="${ctaToInventory ? 'inventory' : 'produce'}" data-prod-id="${recipe.id}">
              <i class="bi bi-plus-lg" aria-hidden="true"></i>
              <span>${ctaToInventory ? 'Inventario' : 'Producir'}</span>
            </button>
          </div>
        </article>
      `;
    }).join('');

    nodes.listView.querySelectorAll('.js-prod-thumb').forEach((image) => {
      const wrap = image.closest('.receta-thumb-wrap');
      const loading = wrap?.querySelector('.thumb-loading');
      const show = () => {
        image.classList.add('is-loaded');
        loading?.classList.add('d-none');
      };
      const fallback = () => {
        image.src = PRODUCT_BG_IMAGE;
      };
      if (image.complete && image.naturalWidth > 0) show();
      else {
        image.addEventListener('load', show, { once: true });
        image.addEventListener('error', fallback, { once: true });
      }
    });
  };

  const getAllocationForQty = (recipe, qtyKg, productionDateIso) => {
    const analysis = analyzeRecipe(recipe, productionDateIso);
    if (analysis.invalid) return { invalid: true, message: analysis.reason };

    const allocations = [];

    for (const item of analysis.ingredients) {
      const neededInRecipeUnit = Number((item.perKg * qtyKg).toFixed(4));
      let pending = neededInRecipeUnit;

      for (const entry of item.entries) {
        const availableRecipeUnit = convertUnit(entry.available, entry.unit, item.unit);
        if (!Number.isFinite(availableRecipeUnit) || availableRecipeUnit <= 0) continue;

        const takeRecipeUnit = Math.min(pending, availableRecipeUnit);
        if (takeRecipeUnit <= 0) continue;

        const takeSourceUnit = convertUnit(takeRecipeUnit, item.unit, entry.unit);

        allocations.push({
          ingredientId: item.ingredientId,
          ingredientName: item.ingredientName,
          entryId: entry.id,
          qty: Number(takeRecipeUnit.toFixed(4)),
          qtySource: Number((Number.isFinite(takeSourceUnit) ? takeSourceUnit : 0).toFixed(4)),
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

        pending -= takeRecipeUnit;
        if (pending <= 0.0001) break;
      }

      if (pending > 0.0001) {
        return { invalid: true, message: `Stock insuficiente para ${item.ingredientName}.` };
      }
    }

    return { invalid: false, allocations, analysis };
  };

  const reserveStock = async (recipe, qtyKg, productionDateIso) => {
    const allocation = getAllocationForQty(recipe, qtyKg, productionDateIso);
    if (allocation.invalid) throw new Error(allocation.message);

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
      allocations: allocation.allocations,
      createdAt: Date.now(),
      expiresAt: Date.now() + (RESERVATION_MINUTES * 60 * 1000),
      status: 'active'
    };

    await window.dbLaJamoneraRest.write(`/produccion/reservas/${reservationId}`, payload);
    state.reservas[reservationId] = payload;
    state.activeReservationId = reservationId;
    return payload;
  };

  const renderManagerSelector = (selected = []) => {
    const selectedSet = new Set((Array.isArray(selected) ? selected : []).map((item) => normalizeValue(item)));
    const users = Object.values(safeObject(state.users));

    if (!users.length) {
      return '<div class="prod-empty-users">No hay usuarios cargados.</div>';
    }

    return `<div class="prod-managers-grid">${users.map((user, idx) => {
      const fullName = getUserFullName(user);
      const email = getUserEmail(user);
      const id = `prod_manager_${idx}`;
      const key = normalizeValue(email || fullName || id);
      const initials = (fullName.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('') || 'U').toUpperCase();
      const photo = getUserPhoto(user);
      return `
        <label class="prod-manager-card" for="${esc(id)}">
          <input id="${esc(id)}" type="checkbox" value="${esc(key)}" ${selectedSet.has(key) ? 'checked' : ''}>
          <span class="prod-manager-photo">${photo ? `<img src="${esc(photo)}" alt="${esc(fullName)}">` : `<b>${esc(initials)}</b>`}</span>
          <span class="prod-manager-text">
            <strong>${esc(fullName)}</strong>
            <small>${esc(email || 'Sin email')}</small>
          </span>
          <span class="prod-manager-check"><i class="bi bi-check-lg"></i></span>
        </label>
      `;
    }).join('')}</div>`;
  };

  const renderSameProductHistory = (recipeId) => {
    const rows = Object.values(safeObject(state.producciones))
      .filter((item) => item.recipeId === recipeId)
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
      .slice(0, 12);

    return `
      <section class="prod-related-history">
        <div class="prod-related-head">
          <h6>Historial de producciones de este producto</h6>
          <small>Últimos registros asociados a la receta actual.</small>
        </div>
        <div class="table-responsive inventario-table-compact-wrap prod-table-scroll">
          <table class="table recipe-table inventario-table-compact mb-0 prod-table-nowrap">
            <thead>
              <tr>
                <th>ID producción</th>
                <th>Fecha producción</th>
                <th>Cantidad</th>
                <th>Encargados</th>
                <th>Estado</th>
                <th>Registrado</th>
              </tr>
            </thead>
            <tbody>
              ${rows.length ? rows.map((row, index) => `
                <tr class="inventario-row-tone ${index % 2 === 0 ? 'is-even-row' : 'is-odd-row'}">
                  <td class="prod-col-strong">${esc(row.id)}</td>
                  <td>${esc(row.productionDate || '-')}</td>
                  <td class="prod-col-accent">${Number(row.qtyKg || 0).toFixed(2)} kg</td>
                  <td>${esc((row.managers || []).join(', ') || '-')}</td>
                  <td><span class="prod-mini-badge ${normalizeLower(row.status) === 'confirmada' ? 'chip-green' : 'badge-muted'}">${esc(cap(row.status || '-'))}</span></td>
                  <td>${new Date(Number(row.createdAt || Date.now())).toLocaleString('es-AR')}</td>
                </tr>
              `).join('') : '<tr><td colspan="6" class="text-center">Sin producciones previas para este producto.</td></tr>'}
            </tbody>
          </table>
        </div>
      </section>
    `;
  };

  const bindPreviewAttachments = () => {
    nodes.editorForm.querySelectorAll('[data-open-attachments]').forEach((button) => {
      button.addEventListener('click', async () => {
        const data = button.dataset.openAttachments || '';
        let images = [];
        try {
          images = JSON.parse(decodeURIComponent(data));
        } catch (error) {
          images = [];
        }

        if (!images.length) {
          await openIosSwal({
            title: 'Sin adjuntos',
            html: '<p>Este lote no tiene imágenes adjuntas.</p>',
            icon: 'info',
            confirmButtonText: 'Entendido'
          });
          return;
        }

        await openIosSwal({
          title: 'Imágenes adjuntas',
          html: `<div class="prod-attachments-grid">${images.map((url) => `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer"><img src="${esc(url)}" alt="Adjunto"></a>`).join('')}</div>`,
          confirmButtonText: 'Cerrar'
        });
      });
    });
  };

  const renderEditor = async (recipeId, initial = {}) => {
    const recipe = state.recetas[recipeId];
    if (!recipe) return;

    state.activeRecipeId = recipeId;
    nodes.editorTitle.textContent = `Producción · ${cap(recipe.title || 'Sin título')}`;

    const productionDate = normalizeValue(initial.productionDate || isoToday());
    const analysis = analyzeRecipe(recipe, productionDate);
    const maxForDate = Number(analysis.maxKg || 0);
    const qty = Number.isFinite(initial.qtyKg) ? initial.qtyKg : (maxForDate >= 1 ? 1 : maxForDate);

    let reservation;
    try {
      reservation = await reserveStock(recipe, qty, productionDate);
    } catch (error) {
      await openIosSwal({ title: 'No se pudo reservar stock', html: `<p>${esc(error.message)}</p>`, icon: 'warning', confirmButtonText: 'Entendido' });
      return;
    }

    const groupedByIngredient = reservation.allocations.reduce((acc, item) => {
      if (!acc[item.ingredientId]) {
        acc[item.ingredientId] = {
          ingredientName: item.ingredientName,
          rows: []
        };
      }
      acc[item.ingredientId].rows.push(item);
      return acc;
    }, {});

    nodes.editorForm.innerHTML = `
      <div class="inventario-product-head inventario-product-head-v2 prod-head">
        <div class="prod-hero-bg" style="background-image:url('${esc(PRODUCT_BG_IMAGE)}')">
          <div class="inventario-editor-photo prod-product-photo">
            <div class="ingrediente-avatar receta-thumb-wrap prod-editor-thumb-wrap">
              <span class="thumb-loading"><img class="meta-spinner-login" src="./IMG/Meta-ai-logo.webp" alt="Cargando"></span>
              <img class="receta-thumb js-prod-thumb" src="${esc(recipe.imageUrl || PRODUCT_BG_IMAGE)}" alt="${esc(cap(recipe.title || 'Producto'))}">
            </div>
          </div>
        </div>
        <div class="prod-head-main">
          <p class="recetas-editor-kicker"><img src="./IMG/Octicons-git-branch.svg" class="prod-head-icon" alt="Flujo"> Producción</p>
          <h5>${esc(cap(recipe.title || 'Sin título'))}</h5>
          <p>${esc(cap(recipe.description || 'Sin descripción'))}</p>
          <p class="prod-max-line">Máximo producible hoy: <strong>${maxForDate.toFixed(2)} kg</strong></p>
        </div>
      </div>

      <div class="prod-grid-2">
        <div>
          <label class="form-label">¿Qué cantidad deseás producir? (kg)</label>
          <input id="prodQtyInput" class="form-control ios-input" type="number" min="0.1" step="0.01" value="${Number(qty || 0).toFixed(2)}">
          <small class="text-muted">Mínimo recomendado: 1 kg · permitidos decimales.</small>
        </div>
        <div>
          <label class="form-label">Fecha de producción</label>
          <input id="prodDateInput" class="form-control ios-input" type="text" value="${esc(productionDate)}">
        </div>
      </div>

      <div class="prod-grid-managers">
        <div>
          <label class="form-label">Encargados</label>
          ${renderManagerSelector(initial.managers || [])}
        </div>
      </div>

      <div class="prod-grid-single">
        <div>
          <label class="form-label">Observaciones</label>
          <textarea id="prodObsInput" class="form-control ios-input" rows="3" placeholder="Notas, incidentes, reemplazos...">${esc(initial.observations || '')}</textarea>
        </div>
      </div>

      <div class="prod-breakdown-wrap">
        <h6><img src="./IMG/Octicons-git-merge.svg" class="prod-head-icon" alt="Desglose"> Desglose FEFO por lotes</h6>
        <p class="prod-fefo-note">FEFO: First Expired, First Out. Se consume primero el lote con vencimiento más próximo; si empatan, el ingreso más antiguo.</p>
        ${Object.values(groupedByIngredient).map((group) => `
          <div class="prod-group">
            <p class="prod-group-title">${esc(cap(group.ingredientName))}</p>
            <div class="table-responsive prod-table-scroll">
              <table class="table recipe-table mb-0 prod-table-nowrap">
                <thead>
                  <tr>
                    <th>Lote</th>
                    <th>Ingreso</th>
                    <th>Vencimiento</th>
                    <th>Cantidad a usar</th>
                    <th>Proveedor</th>
                    <th>N° lote/factura</th>
                    <th>Adjuntos</th>
                  </tr>
                </thead>
                <tbody>
                  ${group.rows.map((row) => `
                    <tr>
                      <td class="prod-col-strong">${esc(row.lotNumber)}</td>
                      <td>${esc(row.entryDate || '-')}</td>
                      <td class="prod-col-warning">${esc(row.expiryDate || '-')}</td>
                      <td class="prod-col-accent">${row.qty.toFixed(2)} ${esc(row.unit)}</td>
                      <td>${esc(row.provider || 'No indica')}</td>
                      <td>${esc(row.invoiceNumber || row.lotNumber)}</td>
                      <td>
                        <button type="button" class="btn ios-btn ios-btn-secondary prod-attachments-btn" data-open-attachments="${encodeURIComponent(JSON.stringify(row.invoiceImageUrls || []))}">
                          <i class="fa-regular fa-image"></i>
                          <span>${row.invoiceImageUrls?.length ? `Ver (${row.invoiceImageUrls.length})` : 'Sin adjuntos'}</span>
                        </button>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        `).join('')}
      </div>

      ${renderSameProductHistory(recipe.id)}

      <div class="prod-actions-row">
        <button id="prodSaveDraftBtn" type="button" class="btn ios-btn ios-btn-secondary">
          <i class="fa-regular fa-floppy-disk"></i><span>Guardar borrador</span>
        </button>
        <button id="prodConfirmBtn" type="submit" class="btn ios-btn ios-btn-success">
          <i class="fa-solid fa-circle-check"></i><span>Confirmar producción</span>
        </button>
      </div>
    `;

    setView('editor');

    nodes.editorForm.querySelectorAll('.js-prod-thumb').forEach((image) => {
      const wrapper = image.closest('.receta-thumb-wrap');
      const loading = wrapper?.querySelector('.thumb-loading');
      const loaded = () => {
        image.classList.add('is-loaded');
        loading?.classList.add('d-none');
      };
      if (image.complete && image.naturalWidth > 0) loaded();
      else image.addEventListener('load', loaded, { once: true });
    });

    if (window.flatpickr) {
      const locale = window.flatpickr.l10ns?.es || undefined;
      window.flatpickr(nodes.editorForm.querySelector('#prodDateInput'), {
        locale,
        dateFormat: 'Y-m-d',
        allowInput: true
      });
    }

    bindPreviewAttachments();

    nodes.editorForm.querySelector('#prodQtyInput')?.addEventListener('change', rerenderEditorFromInputs);
    nodes.editorForm.querySelector('#prodDateInput')?.addEventListener('change', rerenderEditorFromInputs);
    nodes.editorForm.querySelector('#prodSaveDraftBtn')?.addEventListener('click', saveDraft);
    nodes.editorForm.onsubmit = submitProduction;
  };

  const rerenderEditorFromInputs = async () => {
    const recipe = state.recetas[state.activeRecipeId];
    if (!recipe) return;

    const qty = parseNumber(nodes.editorForm.querySelector('#prodQtyInput')?.value);
    const date = normalizeValue(nodes.editorForm.querySelector('#prodDateInput')?.value || isoToday());
    const analysis = analyzeRecipe(recipe, date);

    if (!Number.isFinite(qty) || qty <= 0) return;

    if (qty > analysis.maxKg) {
      await openIosSwal({
        title: 'Cantidad inválida',
        html: `<p>No podés superar <strong>${analysis.maxKg.toFixed(2)} kg</strong> con el stock disponible para esa fecha.</p>`,
        icon: 'warning',
        confirmButtonText: 'Entendido'
      });
      return;
    }

    const managers = [...nodes.editorForm.querySelectorAll('.prod-manager-card input:checked')].map((input) => input.value);
    const observations = normalizeValue(nodes.editorForm.querySelector('#prodObsInput')?.value);
    await renderEditor(state.activeRecipeId, { qtyKg: qty, productionDate: date, managers, observations });
  };

  const getCheckedManagers = () => [...nodes.editorForm.querySelectorAll('.prod-manager-card input:checked')].map((input) => normalizeValue(input.value)).filter(Boolean);

  const saveDraft = async () => {
    if (!state.activeRecipeId) return;
    const draft = {
      id: SESSION_ID,
      recipeId: state.activeRecipeId,
      qtyKg: parseNumber(nodes.editorForm.querySelector('#prodQtyInput')?.value),
      productionDate: normalizeValue(nodes.editorForm.querySelector('#prodDateInput')?.value || isoToday()),
      managers: getCheckedManagers(),
      observations: normalizeValue(nodes.editorForm.querySelector('#prodObsInput')?.value),
      reservationId: state.activeReservationId,
      updatedAt: Date.now()
    };

    await window.dbLaJamoneraRest.write(`/produccion/drafts/${SESSION_ID}`, draft);
    localStorage.setItem('laJamoneraProductionDraft', JSON.stringify(draft));

    await openIosSwal({
      title: 'Borrador guardado',
      html: '<p>Se guardó el borrador en Firebase y localStorage.</p>',
      icon: 'success',
      confirmButtonText: 'Continuar'
    });
  };

  const nextProductionId = async () => {
    const day = isoToday().replaceAll('-', '');
    const path = `/produccion/index/${day}`;
    const current = Number(await window.dbLaJamoneraRest.read(path)) || 0;
    const next = current + 1;
    await window.dbLaJamoneraRest.write(path, next);
    const prefix = normalizeValue(state.config.prefix) || 'PROD-LJ';
    return `${prefix}-${day}-${String(next).padStart(4, '0')}`;
  };

  const submitProduction = async (event) => {
    event.preventDefault();

    const recipe = state.recetas[state.activeRecipeId];
    if (!recipe) return;

    const qtyKg = parseNumber(nodes.editorForm.querySelector('#prodQtyInput')?.value);
    const productionDate = normalizeValue(nodes.editorForm.querySelector('#prodDateInput')?.value || isoToday());
    const managers = getCheckedManagers();
    const observations = normalizeValue(nodes.editorForm.querySelector('#prodObsInput')?.value);
    const analysis = analyzeRecipe(recipe, productionDate);

    if (!Number.isFinite(qtyKg) || qtyKg <= 0 || qtyKg > analysis.maxKg) {
      await openIosSwal({
        title: 'Cantidad inválida',
        html: '<p>Revisá la cantidad a producir.</p>',
        icon: 'warning',
        confirmButtonText: 'Entendido'
      });
      return;
    }

    const confirm = await openIosSwal({
      title: 'Confirmar producción final',
      html: '<p>Se descontará stock real, se cerrará la reserva y se registrará la trazabilidad por lote.</p>',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Confirmar',
      cancelButtonText: 'Cancelar'
    });

    if (!confirm.isConfirmed) return;

    const allocation = getAllocationForQty(recipe, qtyKg, productionDate);
    if (allocation.invalid) {
      await openIosSwal({
        title: 'Conflicto de stock',
        html: `<p>${esc(allocation.message)}<br>El stock pudo haber cambiado por otra sesión.</p>`,
        icon: 'warning',
        confirmButtonText: 'Entendido'
      });
      return;
    }

    const productionId = await nextProductionId();
    const now = Date.now();

    const grouped = allocation.allocations.reduce((acc, item) => {
      if (!acc[item.ingredientId]) acc[item.ingredientId] = [];
      acc[item.ingredientId].push(item);
      return acc;
    }, {});

    Object.entries(grouped).forEach(([ingredientId, rows]) => {
      const record = safeObject(state.inventario.items)[ingredientId];
      if (!record || !Array.isArray(record.entries)) return;

      rows.forEach((usage) => {
        const entry = record.entries.find((item) => item.id === usage.entryId);
        if (!entry) return;

        const current = Number(entry.remainingQty ?? entry.qty ?? 0);
        const next = Number(Math.max(0, current - Number(usage.qtySource || 0)).toFixed(4));

        entry.remainingQty = next;
        entry.status = next <= 0.0001 ? 'consumido_produccion' : 'disponible';
        entry.lotNumber = entry.lotNumber || getLotNumber(entry);
        entry.movements = Array.isArray(entry.movements) ? entry.movements : [];
        entry.movements.unshift({
          id: makeId('mov'),
          type: 'consumo_produccion',
          reference: productionId,
          qty: Number(Number(usage.qtySource || 0).toFixed(4)),
          unit: entry.unit,
          user: 'La Jamonera',
          at: now,
          observations
        });
      });

      record.stockKg = Number(record.entries.reduce((sum, entry) => {
        const qty = Number(entry.remainingQty ?? entry.qty ?? 0);
        const unit = normalizeLower(entry.unit);
        if (['g', 'gr', 'gramo', 'gramos'].includes(unit)) return sum + (qty / 1000);
        return sum + qty;
      }, 0).toFixed(4));
    });

    const payload = {
      id: productionId,
      recipeId: recipe.id,
      recipeTitle: recipe.title,
      productionDate,
      qtyKg,
      managers,
      observations,
      lots: allocation.allocations,
      createdBy: 'La Jamonera',
      createdAt: now,
      updatedAt: now,
      status: 'confirmada',
      audit: [{
        at: now,
        user: 'La Jamonera',
        action: 'create',
        oldValue: null,
        newValue: { qtyKg, productionDate },
        reason: 'confirmación'
      }]
    };

    await window.dbLaJamoneraRest.write('/inventario', state.inventario);
    await window.dbLaJamoneraRest.write(`/produccion/registros/${productionId}`, payload);
    await window.dbLaJamoneraRest.write(`/produccion/auditoria/${productionId}/${now}`, payload.audit[0]);
    if (state.activeReservationId) await window.dbLaJamoneraRest.write(`/produccion/reservas/${state.activeReservationId}`, null);
    await window.dbLaJamoneraRest.write(`/produccion/drafts/${SESSION_ID}`, null);
    localStorage.removeItem('laJamoneraProductionDraft');

    state.activeReservationId = '';
    state.analysisCache = {};

    await loadData();
    renderRecipeList();
    setView('list');

    await openIosSwal({
      title: 'Producción guardada',
      html: `<p>ID generado: <strong>${esc(productionId)}</strong></p>`,
      icon: 'success',
      confirmButtonText: 'Entendido'
    });
  };

  const renderHistory = () => {
    const rows = Object.values(safeObject(state.producciones)).sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));

    nodes.historyView.innerHTML = `
      <div class="prod-history-head">
        <button type="button" class="btn ios-btn ios-btn-secondary" id="prodHistoryBackBtn">
          <i class="fa-solid fa-arrow-left"></i><span>Volver</span>
        </button>
      </div>
      <div class="table-responsive inventario-table-compact-wrap prod-table-scroll">
        <table class="table recipe-table inventario-table-compact mb-0 prod-table-nowrap">
          <thead>
            <tr>
              <th>ID</th>
              <th>Fecha</th>
              <th>Producto</th>
              <th>Cantidad</th>
              <th>Encargados</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            ${rows.length ? rows.map((row, i) => `
              <tr class="inventario-row-tone ${i % 2 === 0 ? 'is-even-row' : 'is-odd-row'}">
                <td class="prod-col-strong">${esc(row.id)}</td>
                <td>${esc(row.productionDate || '-')}</td>
                <td>${esc(cap(row.recipeTitle || '-'))}</td>
                <td class="prod-col-accent">${Number(row.qtyKg || 0).toFixed(2)} kg</td>
                <td>${esc((row.managers || []).join(', ') || '-')}</td>
                <td>${esc(cap(row.status || '-'))}</td>
              </tr>
            `).join('') : '<tr><td colspan="6" class="text-center">Sin producciones registradas.</td></tr>'}
          </tbody>
        </table>
      </div>
    `;

    nodes.historyView.querySelector('#prodHistoryBackBtn')?.addEventListener('click', () => setView('list'));
  };

  const openConfig = async () => {
    const result = await openIosSwal({
      title: 'Configuración de ID de producción',
      html: `<label class="form-label" for="prodPrefixInput">Prefijo</label><input id="prodPrefixInput" class="swal2-input ios-input" value="${esc(state.config.prefix || 'PROD-LJ')}">`,
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      cancelButtonText: 'Cancelar',
      preConfirm: () => normalizeValue(document.getElementById('prodPrefixInput')?.value)
    });

    if (!result.isConfirmed) return;
    state.config.prefix = result.value || 'PROD-LJ';
    await window.dbLaJamoneraRest.write('/produccion/config', state.config);
  };

  const loadData = async () => {
    await window.laJamoneraReady;

    const [recetas, inventario, reservas, producciones, users, config] = await Promise.all([
      window.dbLaJamoneraRest.read('/recetas'),
      window.dbLaJamoneraRest.read('/inventario'),
      window.dbLaJamoneraRest.read('/produccion/reservas'),
      window.dbLaJamoneraRest.read('/produccion/registros'),
      window.dbLaJamoneraRest.read('/informes/users'),
      window.dbLaJamoneraRest.read('/produccion/config')
    ]);

    state.recetas = safeObject(recetas);
    state.inventario = safeObject(inventario);
    state.reservas = safeObject(reservas);
    state.producciones = safeObject(producciones);
    state.users = safeObject(users);
    state.config = { prefix: 'PROD-LJ', ...safeObject(config) };
    state.analysisCache = {};
  };

  const openInventoryModal = () => {
    const current = bootstrap.Modal.getOrCreateInstance(modal);
    current.hide();
    const inventoryModal = document.getElementById('inventarioModal');
    if (inventoryModal) {
      bootstrap.Modal.getOrCreateInstance(inventoryModal).show();
    }
  };

  const bindListEvents = () => {
    if (state.listEventsBound) return;
    state.listEventsBound = true;

    nodes.listView.addEventListener('click', (event) => {
      const button = event.target.closest('[data-prod-action]');
      if (!button) return;

      const recipeId = button.dataset.prodId;
      if (button.dataset.prodAction === 'inventory') {
        openInventoryModal();
        return;
      }

      renderEditor(recipeId, { qtyKg: 1, productionDate: isoToday() });
    });
  };

  const recoverDraftIfAny = async () => {
    const remote = await window.dbLaJamoneraRest.read(`/produccion/drafts/${SESSION_ID}`);
    let local = null;
    try {
      local = JSON.parse(localStorage.getItem('laJamoneraProductionDraft') || 'null');
    } catch (error) {
      local = null;
    }

    const draft = remote || local;
    if (!draft || !draft.recipeId) return;

    const answer = await openIosSwal({
      title: 'Borrador detectado',
      html: '<p>Encontramos una producción en curso. ¿Qué querés hacer?</p>',
      showCancelButton: true,
      showDenyButton: true,
      confirmButtonText: 'Continuar borrador',
      denyButtonText: 'Descartar borrador',
      cancelButtonText: 'Cerrar'
    });

    if (answer.isConfirmed) {
      await renderEditor(draft.recipeId, {
        qtyKg: Number(draft.qtyKg || 1),
        productionDate: draft.productionDate || isoToday(),
        managers: Array.isArray(draft.managers) ? draft.managers : [],
        observations: draft.observations || ''
      });
      return;
    }

    if (answer.isDenied) {
      await window.dbLaJamoneraRest.write(`/produccion/drafts/${SESSION_ID}`, null);
      localStorage.removeItem('laJamoneraProductionDraft');
    }
  };

  nodes.searchInput?.addEventListener('input', () => {
    state.search = nodes.searchInput.value || '';
    renderRecipeList();
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
      bindListEvents();
      renderRecipeList();
      await recoverDraftIfAny();
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
