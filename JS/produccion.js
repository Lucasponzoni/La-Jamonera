(function produccionModule() {
  const produccionModal = document.getElementById('produccionModal');
  if (!produccionModal) return;

  const nodes = {
    loading: document.getElementById('produccionLoading'),
    empty: document.getElementById('produccionEmpty'),
    data: document.getElementById('produccionData'),
    list: document.getElementById('produccionList'),
    editor: document.getElementById('produccionEditor'),
    search: document.getElementById('produccionSearchInput')
  };

  const FIAMBRES_IMAGE = 'https://i.postimg.cc/fyvNDdrt/FIambres.png';
  const BASE_ICON = '<i class="fa-solid fa-drumstick-bite"></i>';
  const CONFIG_PATH = '/produccion/config';

  const state = {
    recetas: {},
    ingredientes: {},
    inventario: {},
    search: '',
    view: 'loading',
    analysis: {},
    activeRecipeId: '',
    config: {
      globalMinKg: 1,
      recipeMinKg: {},
      lastProductionByRecipe: {}
    }
  };

  const safeObject = (value) => (value && typeof value === 'object' ? value : {});
  const normalizeValue = (value) => String(value || '').trim();
  const normalizeLower = (value) => normalizeValue(value).toLowerCase();
  const capitalize = (value) => normalizeLower(value).replace(/(^|\s)\S/g, (ch) => ch.toUpperCase());
  const parseNumber = (value) => {
    const parsed = Number(normalizeValue(value).replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : NaN;
  };
  const parsePositive = (value, fallback = 1) => {
    const n = parseNumber(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };

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

  const formatQty = (value, unit = '', digits = 2) => `${Number(value || 0).toFixed(digits)} ${unit}`.trim();
  const todayIso = () => new Date().toISOString().slice(0, 10);
  const formatDate = (value) => {
    if (!value) return 'Nunca producida';
    const d = new Date(Number(value));
    if (Number.isNaN(d.getTime())) return 'Nunca producida';
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  const readMinKgForRecipe = (recipeId) => {
    const local = parseNumber(state.config.recipeMinKg?.[recipeId]);
    if (Number.isFinite(local) && local > 0) return local;
    return parsePositive(state.config.globalMinKg, 1);
  };

  const persistConfig = async () => {
    await window.laJamoneraReady;
    await window.dbLaJamoneraRest.write(CONFIG_PATH, state.config);
  };

  const getInventoryAvailability = (ingredientId, targetUnit) => {
    const record = safeObject(state.inventario.items?.[ingredientId]);
    const entries = Array.isArray(record.entries) ? record.entries : [];
    const targetMeta = getUnitMeta(targetUnit);

    if (!entries.length && targetMeta.category === 'peso') {
      const stockKg = Number(record.stockKg || 0);
      const base = Number.isFinite(stockKg) ? stockKg * 1000 : 0;
      return {
        available: fromBase(base, targetUnit),
        total: fromBase(base, targetUnit),
        hasExpired: false,
        incompatibleUnits: []
      };
    }

    const aggregate = entries.reduce((acc, entry) => {
      const qty = parseNumber(entry.qty);
      if (!Number.isFinite(qty) || qty <= 0) return acc;
      const entryMeta = getUnitMeta(entry.unit);
      const baseQty = qty * entryMeta.factor;
      const expired = normalizeValue(entry.expiryDate) && normalizeValue(entry.expiryDate) < todayIso();
      if (entryMeta.category === targetMeta.category) {
        acc.totalBase += baseQty;
        if (!expired) acc.usableBase += baseQty;
      } else {
        acc.incompatible.push(entry.unit || 'sin unidad');
      }
      if (expired) acc.hasExpired = true;
      return acc;
    }, { totalBase: 0, usableBase: 0, incompatible: [], hasExpired: false });

    if (!entries.length && targetMeta.category === 'peso') {
      const stockKg = Number(record.stockKg || 0);
      aggregate.totalBase = Math.max(aggregate.totalBase, stockKg * 1000);
      aggregate.usableBase = Math.max(aggregate.usableBase, stockKg * 1000);
    }

    return {
      available: fromBase(aggregate.usableBase, targetUnit),
      total: fromBase(aggregate.totalBase, targetUnit),
      hasExpired: aggregate.hasExpired,
      incompatibleUnits: aggregate.incompatible
    };
  };

  const analyzeRecipe = (recipe) => {
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
      const availability = getInventoryAvailability(row.ingredientId, unit);
      const coverage = neededPerKg > 0 ? Math.max(0, availability.available) / neededPerKg : 0;
      if (availability.incompatibleUnits.length) {
        errors.push(`Revisá la configuración de unidades del ingrediente ${capitalize(row.ingredientName)}.`);
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
    const progress = Math.max(0, Math.min(100, (maxKg / minKg) * 100));
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

    return { status, statusText, maxKg, progress, canProduce, errors, requirements, missingForMin, hasExpired, minKg };
  };

  const setStateView = (view) => {
    state.view = view;
    nodes.loading.classList.toggle('d-none', view !== 'loading');
    nodes.empty.classList.toggle('d-none', view !== 'empty');
    nodes.data.classList.toggle('d-none', view !== 'list');
    nodes.editor.classList.toggle('d-none', view !== 'editor');
  };

  const getRecipes = () => Object.values(safeObject(state.recetas));
  const getThumbPlaceholder = () => `<span class="image-placeholder-circle-2">${BASE_ICON}</span>`;

  const openGlobalMinConfig = async () => {
    const result = await Swal.fire({
      title: 'Umbral por producto',
      html: `<div class="produccion-umbral-form">
          <label for="produccionGlobalMinInput">Umbral de stock (kg)</label>
          <input id="produccionGlobalMinInput" type="number" min="0.1" step="0.1" class="swal2-input ios-input" value="${Number(state.config.globalMinKg || 1).toFixed(2)}">
        </div>`,
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      cancelButtonText: 'Cancelar',
      preConfirm: () => {
        const value = document.getElementById('produccionGlobalMinInput')?.value;
        const n = parseNumber(value);
        if (!Number.isFinite(n) || n <= 0) {
          Swal.showValidationMessage('Ingresá un valor mayor a 0.');
          return false;
        }
        return n;
      },
      customClass: {
        popup: 'ios-alert produccion-umbral-alert', title: 'ios-alert-title', htmlContainer: 'ios-alert-text',
        confirmButton: 'ios-btn ios-btn-primary', cancelButton: 'ios-btn ios-btn-secondary'
      },
      buttonsStyling: false
    });
    if (!result.isConfirmed) return;
    state.config.globalMinKg = Number(result.value.toFixed(2));
    await persistConfig();
    recomputeAnalysis();
    renderList();
  };

  const openRecipeMinConfig = async (recipeId) => {
    const currentRaw = state.config.recipeMinKg?.[recipeId];
    const result = await Swal.fire({
      title: 'Umbral por producto',
      html: `<div class="produccion-umbral-form">
          <label for="produccionRecipeMinInput">Umbral de stock (kg)</label>
          <input id="produccionRecipeMinInput" type="number" min="0.1" step="0.1" class="swal2-input ios-input" value="${normalizeValue(currentRaw)}" placeholder="Vacío = usar global">
        </div>`,
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      cancelButtonText: 'Cancelar',
      preConfirm: () => {
        const value = normalizeValue(document.getElementById('produccionRecipeMinInput')?.value);
        if (!value) return null;
        const n = parseNumber(value);
        if (!Number.isFinite(n) || n <= 0) {
          Swal.showValidationMessage('Ingresá un valor mayor a 0 o dejá vacío para usar global.');
          return false;
        }
        return n;
      },
      customClass: {
        popup: 'ios-alert produccion-umbral-alert', title: 'ios-alert-title', htmlContainer: 'ios-alert-text',
        confirmButton: 'ios-btn ios-btn-primary', cancelButton: 'ios-btn ios-btn-secondary'
      },
      buttonsStyling: false
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

  const renderList = () => {
    const query = normalizeLower(state.search);
    const list = getRecipes()
      .filter((item) => !query || normalizeLower(item.title).includes(query) || normalizeLower(item.description).includes(query))
      .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));

    if (!list.length) {
      nodes.list.innerHTML = '<div class="ingrediente-empty-list">No hay recetas para ese filtro.</div>';
      setStateView(getRecipes().length ? 'list' : 'empty');
      return;
    }

    nodes.list.innerHTML = list.map((recipe) => {
      const analysis = state.analysis[recipe.id] || analyzeRecipe(recipe);
      const statusClass = analysis.status === 'success' ? 'tone-success' : analysis.status === 'warning' ? 'tone-warning' : 'tone-danger';
      const action = analysis.canProduce
        ? `<button type="button" class="btn ios-btn ios-btn-success produccion-main-btn" data-open-produccion="${recipe.id}"><i class="fa-solid fa-plus"></i><span>Producir</span></button>`
        : `<button type="button" class="btn ios-btn produccion-to-inventario-btn" data-open-inventario="1"><i class="fa-solid fa-plus"></i><span>Inventario</span></button>`;

      const badges = [
        analysis.missingForMin.length ? '<span class="produccion-badge">Faltan insumos</span>' : '',
        analysis.status === 'warning' ? '<span class="produccion-badge is-warning">Stock parcial</span>' : '',
        analysis.hasExpired ? '<span class="produccion-badge is-danger">Vencido</span>' : ''
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
            <p class="ingrediente-meta receta-card-meta">Máximo producible: <strong>${analysis.maxKg.toFixed(2)} kg</strong> · Mínimo: <strong>${analysis.minKg.toFixed(2)} kg</strong></p>
            <p class="produccion-last-line"><i class="fa-regular fa-clock"></i> Última producción: <strong>${formatDate(lastProductionAt)}</strong></p>
            <div class="produccion-progress-wrap">
              <div class="produccion-progress-bar"><span style="width:${analysis.progress.toFixed(1)}%"></span></div>
              <small>Cobertura del mínimo: ${analysis.progress.toFixed(0)}%</small>
            </div>
            <div class="produccion-badges">${badges}</div>
            ${analysis.errors.length ? `<p class="produccion-error">${analysis.errors[0]}</p>` : missingHtml}
            <div class="produccion-actions-row">
              ${action}
              <button type="button" class="btn ios-btn ios-btn-secondary produccion-umbral-btn" data-set-recipe-min="${recipe.id}"><i class="fa-solid fa-sliders"></i><span>Umbral</span></button>
            </div>
          </div>
        </article>`;
    }).join('');

    document.querySelectorAll('.js-produccion-thumb').forEach((image) => {
      const wrap = image.closest('.receta-thumb-wrap');
      const loading = wrap?.querySelector('.thumb-loading');
      const showImage = () => {
        image.classList.add('is-loaded');
        loading?.classList.add('d-none');
      };
      const showFallback = () => {
        if (wrap) wrap.innerHTML = getThumbPlaceholder();
      };
      if (image.complete && image.naturalWidth > 0) showImage();
      else {
        image.addEventListener('load', showImage, { once: true });
        image.addEventListener('error', showFallback, { once: true });
      }
    });

    setStateView('list');
  };

  const buildProductionRows = (analysis, quantityKg) => analysis.requirements.map((item) => {
    const needed = item.neededPerKg * quantityKg;
    const missing = Math.max(0, needed - item.available);
    return `
      <div class="produccion-detail-row ${missing > 0.0001 ? 'is-missing' : ''}">
        <strong>${item.name}</strong>
        <span>Necesita: ${formatQty(needed, item.unit)} · Disponible: ${formatQty(item.available, item.unit)}</span>
        <small>${missing > 0.0001 ? `Faltan ${formatQty(missing, item.unit)}` : 'Stock OK para esta cantidad'}</small>
      </div>`;
  }).join('');

  const renderEditor = (recipeId) => {
    const recipe = state.recetas[recipeId];
    const analysis = state.analysis[recipeId];
    if (!recipe || !analysis) return;

    const defaultQty = Math.max(0.1, Math.min(Math.max(analysis.minKg, 0.1), Math.max(analysis.maxKg, 0.1)));

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
            <img id="produccionHeadImage" class="produccion-head-image" src="${FIAMBRES_IMAGE}" alt="${capitalize(recipe.title || 'Producto')}" loading="lazy">
          </div>
        </div>
        <div class="inventario-product-copy">
          <p class="inventario-editor-kicker"><img src="./IMG/Octicons-git-branch.svg" class="produccion-head-icon" alt="Flujo"> Flujo de producción</p>
          <h3 class="inventario-editor-name">${capitalize(recipe.title || 'Sin título')}</h3>
          <p class="inventario-editor-meta">${capitalize(recipe.description || 'Sin descripción.')}</p>
          <p class="produccion-max-line">Máximo según inventario: <strong>${analysis.maxKg.toFixed(2)} kg</strong></p>
        </div>
      </section>

      <section class="recipe-step-card">
        <h6 class="step-title">Paso 1 · ¿Qué cantidad deseás producir?</h6>
        <div class="produccion-qty-grid">
          <input id="produccionQtyInput" type="number" min="0.1" step="0.01" max="${analysis.maxKg.toFixed(2)}" value="${defaultQty.toFixed(2)}" class="form-control ios-input">
          <button id="produccionQtyMaxBtn" type="button" class="btn ios-btn ios-btn-secondary">Usar máximo</button>
        </div>
        <p id="produccionQtyHelp" class="produccion-qty-help">Permitido de 0,1 kg hasta ${analysis.maxKg.toFixed(2)} kg.</p>
      </section>

      <section class="recipe-step-card">
        <h6 class="step-title">Cálculo proporcional en tiempo real</h6>
        <div id="produccionDetailRows" class="produccion-detail-grid"></div>
      </section>`;

    const image = nodes.editor.querySelector('#produccionHeadImage');
    image.addEventListener('error', () => {
      image.src = FIAMBRES_IMAGE;
    }, { once: true });

    const qtyInput = nodes.editor.querySelector('#produccionQtyInput');
    const qtyHelp = nodes.editor.querySelector('#produccionQtyHelp');
    const rowsWrap = nodes.editor.querySelector('#produccionDetailRows');

    const updateRows = () => {
      let qty = parseNumber(qtyInput.value);
      if (!Number.isFinite(qty) || qty <= 0) qty = 0.1;
      if (qty > analysis.maxKg) qty = analysis.maxKg;
      qtyInput.value = qty.toFixed(2);
      rowsWrap.innerHTML = buildProductionRows(analysis, qty);
      qtyHelp.textContent = `Escala aplicada: ${qty.toFixed(2)} kg. Mínimo recomendado: ${analysis.minKg.toFixed(2)} kg.`;
    };

    qtyInput.addEventListener('input', updateRows);
    nodes.editor.querySelector('#produccionQtyMaxBtn').addEventListener('click', () => {
      qtyInput.value = analysis.maxKg.toFixed(2);
      updateRows();
    });

    nodes.editor.querySelector('#produccionBackBtn').addEventListener('click', async () => {
      const result = await Swal.fire({
        title: '¿Deseás abandonar esta producción?',
        html: '<p>Volverás al listado de recetas disponibles.</p>',
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Sí, volver',
        cancelButtonText: 'Seguir aquí',
        customClass: {
          popup: 'ios-alert', title: 'ios-alert-title', htmlContainer: 'ios-alert-text',
          confirmButton: 'ios-btn ios-btn-primary', cancelButton: 'ios-btn ios-btn-secondary'
        },
        buttonsStyling: false,
        returnFocus: false
      });
      if (!result.isConfirmed) return;
      state.activeRecipeId = '';
      setStateView('list');
    });

    updateRows();
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
    const [recetas, ingredientes, inventario, config] = await Promise.all([
      window.dbLaJamoneraRest.read('/recetas'),
      window.dbLaJamoneraRest.read('/ingredientes/items'),
      window.dbLaJamoneraRest.read('/inventario'),
      window.dbLaJamoneraRest.read(CONFIG_PATH)
    ]);
    state.recetas = safeObject(recetas);
    state.ingredientes = safeObject(ingredientes);
    state.inventario = safeObject(inventario);
    state.config = {
      globalMinKg: parsePositive(config?.globalMinKg, 1),
      recipeMinKg: safeObject(config?.recipeMinKg),
      lastProductionByRecipe: safeObject(config?.lastProductionByRecipe)
    };
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

  nodes.list.addEventListener('click', async (event) => {
    const produceBtn = event.target.closest('[data-open-produccion]');
    if (produceBtn) {
      state.activeRecipeId = produceBtn.dataset.openProduccion;
      renderEditor(state.activeRecipeId);
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
    }
  });

  produccionModal.addEventListener('show.bs.modal', async () => {
    try {
      await refreshData();
      renderList();
    } catch (error) {
      nodes.empty.querySelector('.ingredientes-empty-text').textContent = 'No se pudo cargar producción desde Firebase.';
      setStateView('empty');
    }
  });

  produccionModal.addEventListener('hidden.bs.modal', () => {
    state.activeRecipeId = '';
    nodes.search.value = '';
    state.search = '';
    nodes.editor.innerHTML = '';
  });
})();
