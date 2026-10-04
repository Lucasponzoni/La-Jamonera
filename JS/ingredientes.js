(function ingredientesModule() {
  const IA_ICON_SRC = './IMG/gemini.webp';
  // Gemini genera la imagen; este estilo mantiene el look de ícono que tenían los ingredientes.
  const buildIngredientImagePrompt = (prompt) => `Ícono estilo emoji 3D, simple y nítido, de: ${prompt}. Un solo objeto centrado, sobre fondo blanco liso, sin texto, sin marcas, iluminación suave, formato cuadrado.`;
  const NO_DATA_IMAGE_URL = 'https://firebasestorage.googleapis.com/v0/b/fg-lj-d6325.firebasestorage.app/o/extras%2FNo%20data.png?alt=media&token=2d7086a4-6f7d-4fb8-aa8c-51c579f59828';
  const PLACEHOLDER_ICON = '<i class="fa-solid fa-carrot"></i>';
  const ALLOWED_UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const MAX_UPLOAD_SIZE_BYTES = 5 * 1024 * 1024;

  const DEFAULT_MEASURES = [
    { name: 'kilos', abbr: 'Kg.' },
    { name: 'gramos', abbr: 'Gr.' },
    { name: 'mililitros', abbr: 'Ml.' },
    { name: 'litros', abbr: 'Lts.' },
    { name: 'centimetros cubicos', abbr: 'Cc.' },
    { name: 'unidades', abbr: 'Un.' },
    { name: 'gotas', abbr: 'Gts.' },
    { name: 'onzas', abbr: 'Oz.' },
    { name: 'pizcas', abbr: 'Pzc.' },
    { name: 'cucharadas', abbr: 'Cda.' },
    { name: 'cucharaditas', abbr: 'Cdita.' }
  ];

  const state = {
    activeFamilyId: 'all',
    search: '',
    familiesCollapsed: (() => { try { return localStorage.getItem('ingredientes_families_collapsed') === '1'; } catch (_) { return false; } })(),
    ingredientes: { familias: {}, items: {}, config: { measures: [] } },
    selectedId: '',
    detailOpen: false,
    inventoryIndex: null,
    inventoryIndexLoading: null
  };

  const ingredientesModal = document.getElementById('ingredientesModal');
  const ingredientesLoading = document.getElementById('ingredientesLoading');
  const ingredientesEmpty = document.getElementById('ingredientesEmpty');
  const ingredientesData = document.getElementById('ingredientesData');
  const ingredientesList = document.getElementById('ingredientesList');
  const searchInput = document.getElementById('ingredientesSearchInput');
  const createIngredientBtn = document.getElementById('createIngredientBtn');
  const emptyCreateIngredientBtn = document.getElementById('emptyCreateIngredientBtn');
  let printIngredientsBtn = null;

  if (!ingredientesModal) {
    return;
  }

  const normalizeValue = (value) => String(value || '').trim();
  const normalizeLower = (value) => normalizeValue(value).toLowerCase();
  const capitalizeLabel = (value) => normalizeLower(value).replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
  const safeObject = (value) => (value && typeof value === 'object' ? value : {});
  const makeId = (prefix) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const escapeHtml = (value) => normalizeValue(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

  const blurActiveElement = () => {
    const active = document.activeElement;
    if (active && typeof active.blur === 'function') {
      active.blur();
    }
  };

  const openIosSwal = (options) => Swal.fire({
    ...options,
    customClass: {
      popup: `ios-alert ingredientes-alert ${options?.customClass?.popup || ''}`.trim(),
      title: 'ios-alert-title',
      htmlContainer: 'ios-alert-text',
      confirmButton: 'primary',
      cancelButton: 'secondary',
      ...options.customClass
    }
  });

  const measureKey = (name) => normalizeLower(name);

  const ensureMeasures = () => {
    const source = Array.isArray(state.ingredientes.config?.measures) ? state.ingredientes.config.measures : [];
    const merged = [...DEFAULT_MEASURES, ...source].reduce((acc, item) => {
      const key = measureKey(item.name);
      if (!key) {
        return acc;
      }
      if (!acc.some((saved) => measureKey(saved.name) === key)) {
        acc.push({ name: normalizeLower(item.name), abbr: normalizeValue(item.abbr) || 'S/A' });
      }
      return acc;
    }, []);

    state.ingredientes.config = state.ingredientes.config || {};
    state.ingredientes.config.measures = merged;
  };

  const getMeasures = () => {
    ensureMeasures();
    return state.ingredientes.config.measures;
  };

  const resolveIngredientPerishableFlag = (item) => {
    const ingredient = item && typeof item === 'object'
      ? item
      : safeObject(state.ingredientes.items?.[normalizeValue(item)]);
    const inventoryConfig = safeObject(window.inventarioConfigSnapshot?.[ingredient?.id] || {});
    if (typeof inventoryConfig.perishable === 'boolean') return inventoryConfig.perishable;
    if (typeof ingredient?.perishable === 'boolean') return ingredient.perishable;
    return true;
  };

  const getMeasureLabel = (name) => {
    const found = getMeasures().find((item) => measureKey(item.name) === measureKey(name));
    if (!found) {
      return capitalizeLabel(name);
    }
    return `${capitalizeLabel(found.name)} (${found.abbr})`;
  };

  const validateImageFile = (file) => {
    if (!file) {
      return 'Seleccioná una imagen para subir.';
    }
    if (!ALLOWED_UPLOAD_TYPES.includes(file.type)) {
      return 'Archivo no admitido. Usá JPG, PNG, WEBP o GIF.';
    }
    if (file.size > MAX_UPLOAD_SIZE_BYTES) {
      return 'La imagen supera 5MB. Elegí un archivo más liviano.';
    }
    return '';
  };

  const getPlaceholderCircle = () => '<span class="image-placeholder-circle-2">' + PLACEHOLDER_ICON + '</span>';

  const showIngredientesState = (stateKey) => {
    ingredientesLoading.classList.toggle('d-none', stateKey !== 'loading');
    ingredientesEmpty.classList.toggle('d-none', stateKey !== 'empty');
    ingredientesData.classList.toggle('d-none', stateKey !== 'data');
  };

  const fetchIngredientes = async () => {
    await window.laJamoneraReady;
    let data = null;
    try {
      data = await window.dbLaJamoneraRest.read('/ingredientes_index');
    } catch (error) {
      data = null;
    }
    if (!data || (!data.items && !data.familias)) {
      data = await window.dbLaJamoneraRest.read('/ingredientes');
    }
    const safeData = safeObject(data);
    state.ingredientes = {
      familias: safeObject(safeData.familias),
      items: safeObject(safeData.items),
      config: safeObject(safeData.config)
    };
    ensureMeasures();
  };

  // Guarda sólo lo que cambió (antes reescribía los ~250 ingredientes y todas las familias en cada guardado:
  // lento y, con la ventana abierta en otra PC, pisaba cambios ajenos). La config va siempre (medidas).
  const persistIngredientes = async ({ items = [], families = [] } = {}) => {
    ensureMeasures();
    await window.laJamoneraReady;
    await window.dbLaJamoneraRest.write('/ingredientes/config', safeObject(state.ingredientes.config));
    for (const id of [...new Set(families)].filter(Boolean)) {
      const family = state.ingredientes.familias?.[id];
      await window.dbLaJamoneraRest.write(`/ingredientes/familias/${id}`, family ? safeObject(family) : null);
    }
    const ids = [...new Set(items)].filter(Boolean);
    for (let i = 0; i < ids.length; i += 8) {
      await Promise.all(ids.slice(i, i + 8).map(async (id) => {
        const item = state.ingredientes.items?.[id];
        if (!item) return window.dbLaJamoneraRest.write(`/ingredientes/items/${id}`, null);
        const { __indexLite, ...cleanItem } = safeObject(item);
        const base = __indexLite ? safeObject(await window.dbLaJamoneraRest.read(`/ingredientes/items/${id}`)) : {};
        const next = { ...base, ...cleanItem };
        state.ingredientes.items[id] = next;
        return window.dbLaJamoneraRest.write(`/ingredientes/items/${id}`, next);
      }));
    }
  };

  const ensureIngredientDetail = async (itemId) => {
    const id = normalizeValue(itemId);
    const current = safeObject(state.ingredientes.items?.[id]);
    if (!id || !current.id || !current.__indexLite) return current;
    const detail = safeObject(await window.dbLaJamoneraRest.read(`/ingredientes/items/${id}`));
    if (detail.id) {
      state.ingredientes.items[id] = { ...current, ...detail, __indexLite: false };
      return state.ingredientes.items[id];
    }
    return current;
  };

  const getFamiliasArray = () => Object.values(safeObject(state.ingredientes.familias));
  const getIngredientesArray = () => Object.values(safeObject(state.ingredientes.items));

  // ---------- Maestro-detalle (lista + ficha), mismo patrón que Recetas ----------
  const familyFilterSelect = () => document.getElementById('ingredientesFamilyFilter');
  const ingredientesDetail = () => document.getElementById('ingredientesDetail');
  const ingredientesMasterDetail = () => document.getElementById('ingredientesMasterDetail');
  const isIngMobileLayout = () => window.matchMedia('(max-width: 767.98px)').matches;

  const renderFamilies = () => {
    const select = familyFilterSelect();
    const families = getFamiliasArray().sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    const ingredientCounts = getIngredientesArray().reduce((acc, item) => {
      const familyId = normalizeValue(item?.familyId);
      if (!familyId) return acc;
      acc[familyId] = Number(acc[familyId] || 0) + 1;
      return acc;
    }, {});
    if (state.activeFamilyId !== 'all' && !safeObject(state.ingredientes.familias)[state.activeFamilyId]) state.activeFamilyId = 'all';
    if (select) {
      const total = getIngredientesArray().length;
      select.innerHTML = `<i slot="prefix" class="fa-solid fa-carrot"></i><sl-option value="${ljOptionValue('all')}">Todas las familias<span slot="suffix" class="recetas-chip-count">${total}</span></sl-option>${families.map((family) => `<sl-option value="${ljOptionValue(family.id)}">${escapeHtml(capitalizeLabel(family.name))}<span slot="suffix" class="recetas-chip-count">${Number(ingredientCounts[family.id] || 0)}</span></sl-option>`).join('')}`;
      if (window.ljSetSelectValue) window.ljSetSelectValue(select, state.activeFamilyId || 'all');
      else select.value = state.activeFamilyId || 'all';
    }
    const hasFamily = state.activeFamilyId !== 'all';
    ingredientesData?.querySelectorAll('[data-family-selected-action]').forEach((node) => {
      node.disabled = !hasFamily;
    });
  };

  const matchesSearch = (item) => {
    if (!state.search) {
      return true;
    }
    const content = [item.name, item.familyName, item.measure, item.description].map(normalizeLower).join(' ');
    return content.includes(state.search);
  };

  const ingredientAvatar = (url, alt) => url
    ? `<div class="ingrediente-avatar"><span class="thumb-loading"><sl-spinner class="meta-spinner" aria-label="Cargando"></sl-spinner></span><img class="thumb-image js-ingrediente-thumb" src="${(window.ljThumb || String)(url)}" alt="${alt}" loading="lazy"></div>`
    : `<div class="ingrediente-avatar ingrediente-avatar-placeholder">${PLACEHOLDER_ICON}</div>`;

  const prepareThumbLoaders = (selector) => {
    document.querySelectorAll(selector).forEach((image) => {
      const wrapper = image.closest('.family-circle-thumb, .ingrediente-avatar, .inventario-print-photo-wrap');
      if (!wrapper) {
        return;
      }

      const loading = wrapper.querySelector('.thumb-loading');
      const showImage = () => {
        image.classList.add('is-loaded');
        if (loading) {
          loading.classList.add('d-none');
        }
      };

      const showFallback = () => {
        wrapper.classList.add('ingrediente-avatar-placeholder');
        wrapper.innerHTML = PLACEHOLDER_ICON;
      };

      if (image.complete && image.naturalWidth > 0) {
        showImage();
      } else {
        image.addEventListener('load', showImage, { once: true });
        image.addEventListener('error', showFallback, { once: true });
      }
    });
  };

  const updateListScrollHint = () => {
    if (!ingredientesList) {
      return;
    }
    const hasOverflow = ingredientesList.scrollHeight > ingredientesList.clientHeight + 4;
    const isAtEnd = ingredientesList.scrollTop + ingredientesList.clientHeight >= ingredientesList.scrollHeight - 4;
    ingredientesList.classList.toggle('has-scroll-hint', hasOverflow && !isAtEnd);
  };

  const formatDateLabel = (timestamp) => {
    const date = new Date(Number(timestamp || 0));
    if (Number.isNaN(date.getTime())) {
      return 'S/D';
    }
    return date.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' });
  };

  // Stock del ingrediente desde el índice liviano de inventario (una sola lectura por apertura).
  const STOCK_UNIT_FACTORS = { kilos: 1000, kilo: 1000, kg: 1000, litros: 1000, litro: 1000, lts: 1000, l: 1000 };
  const stockFromIndex = (item) => {
    const row = safeObject(safeObject(state.inventoryIndex)[item.id]);
    if (!Object.keys(row).length) return null;
    const unit = normalizeLower(row.stockUnit || item.measure || 'kilos');
    const factor = STOCK_UNIT_FACTORS[unit] || 1;
    const stockQty = Number.isFinite(Number(row.stockBase)) ? Number(row.stockBase) / factor : Number(row.stockKg || 0);
    const thresholdQty = Number.isFinite(Number(row.lowThresholdBase)) && row.lowThresholdBase !== null ? Number(row.lowThresholdBase) / factor : null;
    const todayIso = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
    const lots = [...(Array.isArray(row.expiredEntries) ? row.expiredEntries : []), ...(Array.isArray(row.expiringEntries) ? row.expiringEntries : [])]
      .filter((lot) => Number(lot?.qty || 0) > 0 && normalizeValue(lot?.expiryDate));
    const expired = lots.filter((lot) => normalizeValue(lot.expiryDate) < todayIso);
    const next = lots.map((lot) => normalizeValue(lot.expiryDate)).sort()[0] || '';
    const infinite = Boolean(row.infiniteStock);
    let tone = 'neu';
    let label = 'Sin ingresos';
    if (infinite) { tone = 'ok'; label = 'Infinito'; }
    else if (row.hasEntries || Number(row.entriesCount || 0)) {
      if (stockQty <= 0.0001) { tone = 'bad'; label = 'Sin stock'; }
      else if (thresholdQty != null && stockQty <= thresholdQty) { tone = 'warn'; label = 'Stock bajo'; }
      else { tone = 'ok'; label = 'En stock'; }
    }
    return { row, unit, stockQty, thresholdQty, entriesCount: Number(row.entriesCount || 0), expiredCount: expired.length, next, todayIso, infinite, frozen: Boolean(row.hasFrozenEntries), tone, label };
  };

  const loadInventoryIndex = async () => {
    if (state.inventoryIndexLoading) return state.inventoryIndexLoading;
    state.inventoryIndexLoading = window.dbLaJamoneraRest.read('/inventario_index/items')
      .then((data) => { state.inventoryIndex = safeObject(data); })
      .catch(() => { state.inventoryIndex = {}; });
    return state.inventoryIndexLoading;
  };

  const formatIsoShort = (iso) => {
    const value = normalizeValue(iso);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return '-';
    const [y, m, d] = value.split('-');
    return `${d}/${m}/${y}`;
  };

  const setIngDetailOpen = (open) => {
    state.detailOpen = Boolean(open);
    ingredientesMasterDetail()?.classList.toggle('is-detail-open', state.detailOpen);
  };

  const ingListRowHtml = (item, on) => {
    const stock = stockFromIndex(item);
    const measure = getMeasureLabel(item.measure);
    const stockText = stock && !stock.infinite && stock.entriesCount ? `${stock.stockQty.toFixed(2)} ${measure}` : measure;
    const sub = `${capitalizeLabel(item.familyName || 'Sin familia')} · ${stockText}`;
    const name = capitalizeLabel(item.name);
    return `<button type="button" class="lj-tile recetas-item ing-md-item ${on ? 'is-active' : ''}" role="option" aria-selected="${on}" tabindex="${on ? 0 : -1}" data-ing-select="${escapeHtml(item.id)}">
        ${ingredientAvatar(item.imageUrl, escapeHtml(name))}
        <span class="recetas-item-copy"><strong title="${escapeHtml(name)}">${escapeHtml(name)}</strong><small title="${escapeHtml(sub)}">${escapeHtml(sub)}</small></span>
        <span class="md-item-tags">${stock ? `<span class="recetas-tag tone-${stock.tone}">${escapeHtml(stock.label)}</span>` : ''}${stock?.expiredCount ? '<span class="recetas-tag tone-bad" title="Tiene lotes vencidos con stock" aria-label="Tiene lotes vencidos con stock"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i></span>' : ''}</span>
      </button>`;
  };

  const renderIngredientDetail = (item) => {
    const host = ingredientesDetail();
    if (!host) return;
    if (!item) {
      host.innerHTML = '<div class="recetas-detail-empty"><i class="fa-solid fa-carrot" aria-hidden="true"></i><p>Elegí un ingrediente de la lista para ver su ficha.</p></div>';
      return;
    }
    const name = capitalizeLabel(item.name);
    const stock = stockFromIndex(item);
    const measure = getMeasureLabel(item.measure);
    const hasImage = Boolean(normalizeValue(item.imageUrl));
    let stockKpis = '';
    if (!stock) {
      stockKpis = `<div class="recetas-kpi"><span>Stock actual</span><b class="tone-neu">${state.inventoryIndex ? 'Sin ingresos' : 'Cargando'}</b></div>
        <div class="recetas-kpi"><span>Umbral</span><b class="tone-neu">-</b></div>
        <div class="recetas-kpi"><span>Ingresos</span><b>0</b></div>
        <div class="recetas-kpi"><span>Próximo vencimiento</span><b class="tone-neu">-</b></div>`;
    } else {
      const nextDiff = stock.next ? Math.round((new Date(`${stock.next}T00:00:00`) - new Date(`${stock.todayIso}T00:00:00`)) / 86400000) : null;
      const nextTone = nextDiff == null ? 'neu' : (nextDiff < 0 ? 'bad' : 'warn');
      stockKpis = `<div class="recetas-kpi"><span>Stock actual</span><b class="tone-${stock.tone}">${stock.infinite ? 'Infinito' : `${stock.stockQty.toFixed(2)} ${escapeHtml(measure)}`}</b><small>${escapeHtml(stock.label)}</small></div>
        <div class="recetas-kpi"><span>Umbral</span><b>${stock.thresholdQty == null ? 'Global' : `${stock.thresholdQty.toFixed(2)} ${escapeHtml(measure)}`}</b><small>${stock.thresholdQty == null ? 'Configuración de inventario' : 'Personalizado'}</small></div>
        <div class="recetas-kpi"><span>Ingresos</span><b>${stock.entriesCount}</b><small>${stock.expiredCount ? `${stock.expiredCount} lote(s) vencido(s) con stock` : 'lotes registrados'}</small></div>
        <div class="recetas-kpi"><span>Próximo vencimiento</span><b class="tone-${nextTone}">${stock.next ? formatIsoShort(stock.next) : '-'}</b><small>${nextDiff == null ? 'Sin vencimientos cercanos' : (nextDiff < 0 ? `Venció hace ${Math.abs(nextDiff)} día(s)` : `En ${nextDiff} día(s)`)}</small></div>`;
    }
    host.innerHTML = `
      <div class="recetas-detail-mobilebar">
        <sl-button variant="default" size="small" type="button" data-ing-detail-back><i slot="prefix" class="fa-solid fa-arrow-left"></i>Volver</sl-button>
      </div>
      <header class="recetas-detail-head">
        <span class="ing-md-avatar-lg">${ingredientAvatar(item.imageUrl, escapeHtml(name))}</span>
        <div class="recetas-detail-titles">
          <h6 class="recetas-detail-name">${escapeHtml(name)}</h6>
          <p class="recetas-detail-group"><i class="fa-solid fa-carrot" aria-hidden="true"></i>${escapeHtml(capitalizeLabel(item.familyName || 'Sin familia'))} · ${escapeHtml(measure)}</p>
          ${stock ? `<p class="ing-md-chips"><span class="recetas-tag tone-${stock.tone}">${escapeHtml(stock.label)}</span>${stock.frozen ? '<span class="recetas-tag tone-info"><sl-icon name="snow2"></sl-icon>Congelado</span>' : ''}</p>` : ''}
        </div>
        <div class="recetas-detail-tools">
          <sl-button variant="default" size="small" type="button" data-ingrediente-edit="${item.id}"><i slot="prefix" class="fa-solid fa-pen"></i>Editar</sl-button>
          <sl-button variant="success" size="small" type="button" data-ingrediente-stock="${item.id}" ${stock?.infinite ? 'disabled title="Stock infinito sin carga manual"' : ''}><i slot="prefix" class="fa-solid fa-plus"></i>Ingresar stock</sl-button>
          <sl-dropdown hoist placement="bottom-end" class="recetas-detail-more">
            <sl-button slot="trigger" variant="default" size="small" class="lj-icon-btn" title="Más acciones" aria-label="Más acciones"><i class="fa-solid fa-ellipsis-vertical"></i></sl-button>
            <sl-menu>
              <sl-menu-item data-ingrediente-image-view="${item.id}" ${hasImage ? '' : 'disabled'}><i slot="prefix" class="fa-regular fa-image"></i>Ver imagen</sl-menu-item>
              <sl-menu-item data-ingrediente-ai-image="${item.id}"><img slot="prefix" src="${IA_ICON_SRC}" alt="" aria-hidden="true" class="ing-md-ai-icon">Generar imagen con IA</sl-menu-item>
              <sl-menu-item data-ingrediente-inventory="${item.id}"><i slot="prefix" class="fa-solid fa-boxes-stacked"></i>Ver en inventario</sl-menu-item>
              <sl-menu-item data-ingrediente-duplicate="${item.id}"><i slot="prefix" class="fa-regular fa-copy"></i>Duplicar</sl-menu-item>
              <sl-divider></sl-divider>
              <sl-menu-item data-ingrediente-delete="${item.id}" class="is-danger"><i slot="prefix" class="fa-solid fa-trash"></i>Eliminar</sl-menu-item>
            </sl-menu>
          </sl-dropdown>
        </div>
      </header>

      <div class="recetas-kpis">${stockKpis}</div>

      <section class="recetas-detail-section">
        <h6 class="recetas-detail-title"><i class="fa-solid fa-circle-info" aria-hidden="true"></i>Datos</h6>
        <div class="recetas-detail-table-wrap"><table class="recetas-detail-table">
          <tbody>
            <tr><td>Familia</td><td>${escapeHtml(capitalizeLabel(item.familyName || 'Sin familia'))}</td></tr>
            <tr><td>Unidad de medida</td><td>${escapeHtml(measure)}</td></tr>
            ${stock?.row?.suggestedExpiryDays ? `<tr><td>Vencimiento sugerido</td><td>${Number(stock.row.suggestedExpiryDays)} días desde el ingreso</td></tr>` : ''}
            ${stock?.row?.weeklySheetConfig ? `<tr><td>Planilla semanal</td><td>${stock.row.weeklySheetConfig.perishable === false ? 'No perecedero' : 'Perecedero'}${stock.row.weeklySheetConfig.egresoEnabled ? ' · con egreso automático' : ''}</td></tr>` : ''}
          </tbody>
        </table></div>
      </section>

      ${normalizeValue(item.description) ? `<section class="recetas-detail-section">
        <h6 class="recetas-detail-title"><i class="fa-solid fa-align-left" aria-hidden="true"></i>Descripción</h6>
        <p class="recetas-detail-text">${escapeHtml(item.description)}</p>
      </section>` : ''}

      <footer class="recetas-detail-dates">
        <span><i class="fa-regular fa-calendar-plus" aria-hidden="true"></i> Alta: ${formatDateLabel(item.createdAt)}</span>
        <span><i class="fa-regular fa-calendar-check" aria-hidden="true"></i> Mod: ${formatDateLabel(item.updatedAt)}</span>
      </footer>`;
    prepareThumbLoaders('#ingredientesDetail .js-ingrediente-thumb');
  };

  const selectIngredient = (itemId, options = {}) => {
    const id = normalizeValue(itemId);
    const item = safeObject(state.ingredientes.items)[id];
    if (!id || !item) return;
    state.selectedId = id;
    ingredientesList?.querySelectorAll('[data-ing-select]').forEach((node) => {
      const on = node.dataset.ingSelect === id;
      node.classList.toggle('is-active', on);
      node.setAttribute('aria-selected', on ? 'true' : 'false');
      node.tabIndex = on ? 0 : -1;
    });
    renderIngredientDetail(item);
    ingredientesDetail()?.scrollTo?.({ top: 0 });
    if (options.openDetail && isIngMobileLayout()) {
      setIngDetailOpen(true);
      LJModal.body(ingredientesModal)?.scrollTo({ top: 0 });
    }
    if (options.focus) ingredientesList?.querySelector(`[data-ing-select="${CSS.escape(id)}"]`)?.focus();
  };

  const renderIngredientes = () => {
    const allItems = getIngredientesArray();
    const items = allItems.filter((item) => {
      if (state.activeFamilyId !== 'all' && item.familyId !== state.activeFamilyId) {
        return false;
      }
      return matchesSearch(item);
    });
    let visibleItems = items;
    let helperHtml = '';

    if (!items.length && state.search) {
      const outsideMatches = allItems.filter((item) => {
        const content = [item.name, item.familyName, item.measure, item.description].map(normalizeLower).join(' ');
        return content.includes(state.search);
      });
      if (outsideMatches.length) {
        visibleItems = outsideMatches;
        helperHtml = '<div class="recetas-list-helper"><p>No hay resultados en esta familia.</p><sl-button variant="default" size="small" type="button" data-ingredient-search-all><sl-icon slot="prefix" name="lightning-charge"></sl-icon>Buscar en toda la base</sl-button><small>Coincidencias <strong>fuera del filtro</strong> seleccionado</small></div>';
      }
    }

    if (!visibleItems.length) {
      ingredientesList.innerHTML = '<div class="recetas-list-empty">No encontramos ingredientes con ese filtro.</div>';
      state.selectedId = '';
      setIngDetailOpen(false);
      renderIngredientDetail(null);
      return;
    }

    const sorted = visibleItems.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    if (!sorted.some((item) => item.id === state.selectedId)) {
      state.selectedId = sorted[0].id;
      setIngDetailOpen(false);
    }
    ingredientesList.innerHTML = helperHtml + sorted.map((item) => ingListRowHtml(item, item.id === state.selectedId)).join('');
    prepareThumbLoaders('#ingredientesList .js-ingrediente-thumb');
    setIngDetailOpen(state.detailOpen);
    renderIngredientDetail(safeObject(state.ingredientes.items)[state.selectedId]);
    updateListScrollHint();
  };

  const refreshView = () => {
    const hasData = getFamiliasArray().length > 0 || getIngredientesArray().length > 0;
    showIngredientesState(hasData ? 'data' : 'empty');
    if (hasData) {
      renderFamilies();
      renderIngredientes();
    }
  };

  const ensurePrintButton = () => {
    printIngredientsBtn = printIngredientsBtn || document.getElementById('printIngredientsBtn');
    if (!createIngredientBtn || printIngredientsBtn) return;
    const toolbar = createIngredientBtn.parentNode;
    if (!toolbar) return;

    let actionsWrap = toolbar.querySelector('.ingredientes-toolbar-actions');
    if (!actionsWrap) {
      actionsWrap = document.createElement('div');
      actionsWrap.className = 'ingredientes-toolbar-actions';
      toolbar.appendChild(actionsWrap);
      actionsWrap.appendChild(createIngredientBtn);
    }

    const separator = document.createElement('span');
    separator.className = 'barra-separadora ingredientes-toolbar-separator';
    separator.setAttribute('aria-hidden', 'true');

    printIngredientsBtn = document.createElement('sl-button');
    printIngredientsBtn.setAttribute('variant', 'default');
    printIngredientsBtn.setAttribute('type', 'button');
    printIngredientsBtn.id = 'printIngredientsBtn';
    printIngredientsBtn.className = 'produccion-toolbar-icon-btn boton-fc';
    printIngredientsBtn.title = 'Imprimir';
    printIngredientsBtn.setAttribute('aria-label', 'Imprimir');
    printIngredientsBtn.innerHTML = '<i slot="prefix" class="fa-solid fa-print"></i><span>Imprimir</span>';

    actionsWrap.insertBefore(separator, createIngredientBtn);
    actionsWrap.insertBefore(printIngredientsBtn, separator);
  };

  const openIngredientsScopeSelector = async () => openIosSwal({
    title: 'Selector de productos',
    html: `<div class="swal-stack-fields text-start">
      <sl-radio-group name="ingredientPrintScope" value="all" class="ingredientes-print-scope">
        <sl-radio value="all">Todos los productos</sl-radio>
        <sl-radio value="exclude">Algunos productos</sl-radio>
        <sl-radio value="perishable">Perecederos o no perecederos</sl-radio>
      </sl-radio-group>
      <div id="ingredientPrintTypeScope" class="notify-specific-users-list d-none">
        <sl-radio-group name="ingredientPerishableType" value="perishable" class="ingredientes-print-scope">
          <sl-radio value="perishable">Solo perecederos</sl-radio>
          <sl-radio value="non_perishable">Solo no perecederos</sl-radio>
        </sl-radio-group>
      </div>
      <div id="ingredientPrintProductsScope" class="notify-specific-users-list d-none">
        <div class="step-block"><strong>Familias</strong>${getFamiliasArray().map((family) => `<sl-checkbox class="ingredientes-print-check" data-ingredient-print-family value="${family.id}"><span class="ingredientes-print-check-label">${family.imageUrl ? `<span class="inventario-print-photo-wrap"><span class="thumb-loading"><sl-spinner class="meta-spinner" aria-label="Cargando"></sl-spinner></span><img class="thumb-image js-ingredientes-print-thumb ingredientes-print-thumb-fit" src="${(window.ljThumb || String)(escapeHtml(family.imageUrl))}" alt="${escapeHtml(capitalizeLabel(family.name))}"></span>` : '<span class="inventario-print-photo-wrap"><span class="image-placeholder-circle-2"><i class="fa-solid fa-carrot"></i></span></span>'}<span>${escapeHtml(capitalizeLabel(family.name))}</span></span></sl-checkbox>`).join('')}</div>
        <div class="step-block"><strong>Productos</strong>${getIngredientesArray().map((item) => `<sl-checkbox class="ingredientes-print-check" data-ingredient-print-product data-family-id="${item.familyId || ''}" value="${item.id}"><span class="ingredientes-print-check-label">${item.imageUrl ? `<span class="inventario-print-photo-wrap"><span class="thumb-loading"><sl-spinner class="meta-spinner" aria-label="Cargando"></sl-spinner></span><img class="thumb-image js-ingredientes-print-thumb ingredientes-print-thumb-fit" src="${(window.ljThumb || String)(escapeHtml(item.imageUrl))}" alt="${escapeHtml(capitalizeLabel(item.name))}"></span>` : '<span class="inventario-print-photo-wrap"><span class="image-placeholder-circle-2"><i class="fa-solid fa-carrot"></i></span></span>'}<span>${escapeHtml(capitalizeLabel(item.name))}</span></span></sl-checkbox>`).join('')}</div>
      </div>
    </div>`,
    showCancelButton: true,
    confirmButtonText: 'Continuar',
    cancelButtonText: 'Cancelar',
    didOpen: () => {
      const scopeGroup = document.querySelector('sl-radio-group[name="ingredientPrintScope"]');
      const productsScope = document.getElementById('ingredientPrintProductsScope');
      const typeScope = document.getElementById('ingredientPrintTypeScope');
      const toggle = () => {
        const mode = scopeGroup?.value || 'all';
        productsScope?.classList.toggle('d-none', mode !== 'exclude');
        typeScope?.classList.toggle('d-none', mode !== 'perishable');
      };
      scopeGroup?.addEventListener('change', toggle);
      document.querySelectorAll('[data-ingredient-print-family]').forEach((familyCheckbox) => {
        familyCheckbox.addEventListener('change', () => {
          const familyId = familyCheckbox.value;
          document.querySelectorAll(`[data-ingredient-print-product][data-family-id="${familyId}"]`).forEach((productCheckbox) => {
            productCheckbox.checked = familyCheckbox.checked;
          });
        });
      });
      toggle();
      prepareThumbLoaders('.js-ingredientes-print-thumb');
    },
    preConfirm: () => {
      const mode = document.querySelector('sl-radio-group[name="ingredientPrintScope"]')?.value || 'all';
      const selected = [...document.querySelectorAll('sl-checkbox[data-ingredient-print-product]')].filter((node) => node.checked).map((node) => node.value);
      const targetPerishable = document.querySelector('sl-radio-group[name="ingredientPerishableType"]')?.value || 'perishable';
      if (mode === 'exclude' && !selected.length) {
        Swal.showValidationMessage('Seleccioná al menos un producto para imprimir.');
        return false;
      }
      return { mode, selected, targetPerishable };
    }
  });


  const showPreparingPrintAlert = () => Swal.fire({
    title: 'Preparando selector...',
    html: '<div class="informes-saving-spinner"><sl-spinner class="meta-spinner-login" aria-label="Preparando selector"></sl-spinner></div>',
    allowOutsideClick: false,
    allowEscapeKey: false,
    showConfirmButton: false,
    customClass: {
      popup: 'ios-alert ingredientes-alert',
      title: 'ios-alert-title',
      htmlContainer: 'ios-alert-text'
    }
  });

  const waitPrintAssets = async (win) => {
    const images = [...win.document.images];
    if (!images.length) return;
    await Promise.all(images.map((img) => new Promise((resolve) => {
      if (img.complete) resolve();
      else {
        img.addEventListener('load', resolve, { once: true });
        img.addEventListener('error', resolve, { once: true });
      }
    })));
  };

  const printIngredientsCatalog = async () => {
    showPreparingPrintAlert();
    await new Promise((resolve) => requestAnimationFrame(() => resolve()));
    try {
      await fetchIngredientes();
      try {
        // El índice liviano trae weeklySheetConfig por ingrediente; /inventario/items completo (lotes,
        // movimientos) tardaba ~20 s. Si el índice no está, se cae al nodo completo como antes.
        const inventoryIndex = await window.dbLaJamoneraRest.read('/inventario_index/items').catch(() => null);
        const inventoryConfig = inventoryIndex && Object.keys(safeObject(inventoryIndex)).length
          ? inventoryIndex
          : await window.dbLaJamoneraRest.read('/inventario/items');
        window.inventarioConfigSnapshot = Object.values(safeObject(inventoryConfig)).reduce((acc, record) => {
          const recordSafe = safeObject(record);
          const ingredientId = normalizeValue(recordSafe.ingredientId || recordSafe.id);
          if (!ingredientId) return acc;
          acc[ingredientId] = safeObject(recordSafe.weeklySheetConfig);
          return acc;
        }, {});
      } catch (error) {
        window.inventarioConfigSnapshot = {};
      }
    } finally {
      Swal.close();
    }
    const selector = await openIngredientsScopeSelector();
    if (!selector.isConfirmed) return;
    const selectedOnly = new Set(selector.value.mode === 'exclude' ? selector.value.selected : []);
    const targetPerishable = selector.value.mode === 'perishable'
      ? selector.value.targetPerishable === 'perishable'
      : '';
    const filtered = getIngredientesArray()
      .filter((item) => (selector.value.mode === 'exclude' ? selectedOnly.has(item.id) : true))
      .filter((item) => {
        if (typeof targetPerishable !== 'boolean') return true;
        const perishable = resolveIngredientPerishableFlag(item);
        return targetPerishable ? perishable : !perishable;
      })
      .sort((a, b) => normalizeValue(a.name).localeCompare(normalizeValue(b.name), 'es'));

    if (!filtered.length) {
      await openIosSwal({ title: 'Sin resultados', html: '<p>No hay productos para imprimir con ese filtro.</p>', icon: 'warning' });
      return;
    }

    const images = filtered.map((item) => item.imageUrl).filter(Boolean);
    await Promise.all(images.map((src) => new Promise((resolve) => {
      const img = new Image();
      img.onload = resolve;
      img.onerror = resolve;
      img.src = src;
    })));

    const content = filtered.map((item) => `
      <article style="display:flex;align-items:center;gap:12px;border:1px solid #d7def2;border-radius:16px;padding:12px;background:#fff;break-inside:avoid;page-break-inside:avoid;">
        <div style="width:74px;height:74px;border-radius:999px;overflow:hidden;border:1px solid #d7def2;background:#eff2fb;display:flex;align-items:center;justify-content:center;flex-shrink:0;padding:6px;">
          ${item.imageUrl ? `<img src="${(window.ljThumb || String)(escapeHtml(item.imageUrl))}" style="width:100%;height:100%;object-fit:contain;object-position:center;border-radius:999px;display:block;" alt="${escapeHtml(capitalizeLabel(item.name))}">` : '<i class="fa-solid fa-carrot" style="color:#5f6a89;font-size:28px;"></i>'}
        </div>
        <div style="min-width:0;">
          <h2 style="margin:0 0 4px;font-size:18px;color:#1f2a44;">${escapeHtml(capitalizeLabel(item.name))}</h2>
          <p style="margin:0;color:#55607f;font-size:13px;"><strong>Familia:</strong> ${escapeHtml(capitalizeLabel(item.familyName || 'Sin familia'))}</p>
          <p style="margin:2px 0 0;color:#55607f;font-size:13px;"><strong>Unidad de medida:</strong> ${escapeHtml(getMeasureLabel(item.measure || ''))}</p>
          <p style="margin:2px 0 0;color:#55607f;font-size:13px;"><strong>Tipo:</strong> ${resolveIngredientPerishableFlag(item) ? 'Perecedero' : 'No perecedero'}</p>
        </div>
      </article>
    `).join('');

    const win = window.open('', '_blank', 'width=1100,height=900');
    if (!win) return;
    win.document.write(`<html><head><title>Productos</title><style>body{font-family:Inter,Arial,sans-serif;padding:20px;color:#1f2a44;background:#f7f9ff}h1{margin:0 0 14px}.ingredients-grid{display:grid;gap:12px;grid-template-columns:repeat(2,minmax(0,1fr));}@media print{.ingredients-grid{grid-template-columns:repeat(2,minmax(0,1fr));}}</style></head><body><h1>Productos</h1><div class="ingredients-grid">${content}</div></body></html>`);
    win.document.close();
    win.focus();
    await waitPrintAssets(win);
    win.print();
  };

  const uploadImageToStorage = async (file, folder) => {
    await window.laJamoneraReady;
    const refPath = `${folder}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${(file.name.split('.').pop() || 'jpg').toLowerCase()}`;
    const ref = window.storageLaJamonera.ref().child(refPath);
    await ref.put(file);
    return ref.getDownloadURL();
  };

  const buildImageStepHtml = (prefix, initialImage) => `
    <section class="step-block">
      <h6 class="step-title">3) Imagen</h6>
      <div class="step-content">
        <div class="image-method-buttons lj-btn-group" id="${prefix}_methodButtons" role="group" aria-label="Origen de la imagen">
          <sl-button variant="default" type="button" class="image-method-btn" data-image-method="url"><i slot="prefix" class="fa-solid fa-link"></i>Link</sl-button>
          <sl-button variant="default" type="button" class="image-method-btn" data-image-method="upload"><i slot="prefix" class="fa-solid fa-upload"></i>Subir</sl-button>
          <sl-button variant="default" type="button" class="image-method-btn is-active" data-image-method="ai"><img slot="prefix" src="${IA_ICON_SRC}" alt="" aria-hidden="true">IA</sl-button>
        </div>
        <input type="hidden" id="${prefix}_method" value="ai">

        <div id="${prefix}_preview" class="image-preview-circle">
          ${initialImage ? `<img src="${initialImage}" alt="Vista previa">` : getPlaceholderCircle()}
        </div>

        <div id="${prefix}_urlWrap">
          <sl-input id="${prefix}_imageUrl" label="Link de imagen" placeholder="https://..." value="${escapeHtml(initialImage || '')}"></sl-input>
        </div>

        <div id="${prefix}_uploadWrap" class="d-none">
          <label class="lj-label" for="${prefix}_imageFile">Subir imagen</label>
          <div class="image-file-picker">
            <input id="${prefix}_imageFile" type="file" class="image-file-input" accept="image/*" hidden>
            <sl-button variant="default" type="button" id="${prefix}_imageFilePick"><i slot="prefix" class="fa-solid fa-upload"></i>Elegir archivo</sl-button>
            <span id="${prefix}_imageFileName" class="image-file-name">Ningún archivo seleccionado</span>
          </div>
        </div>

        <div id="${prefix}_aiWrap" class="d-none">
          <sl-input id="${prefix}_aiPrompt" label="Prompt corto para IA" placeholder="Ej: carne de cerdo"></sl-input>
          <div class="ai-generate-actions mt-2">
            <sl-button variant="default" id="${prefix}_aiGenerate" type="button" class="ai-generate-btn">
              <img slot="prefix" src="${IA_ICON_SRC}" alt="" aria-hidden="true">
              Generar imagen con IA
            </sl-button>
            ${prefix === 'ingredientImage' ? `<sl-button variant="default" id="${prefix}_aiCover" type="button" class="ai-generate-btn" title="Foto del ingrediente con el cartel de madera de La Jamonera">
              <i slot="prefix" class="fa-solid fa-sign-hanging" aria-hidden="true"></i>
              Carátula con IA
            </sl-button>` : ''}
          </div>
          ${prefix === 'ingredientImage' ? '<small class="ai-generate-hint">Carátula: usa el prompt o, si está vacío, el nombre del ingrediente como texto del cartel.</small>' : ''}
          <div id="${prefix}_aiError" class="ai-alert-note d-none mt-2"></div>
        </div>
      </div>
    </section>
  `;

  const attachImageStepEvents = (prefix, options = {}) => {
    // options.uploadFolder: carpeta para los uploads manuales (default 'ingredientes/uploads').
    // options.aiFolder: carpeta para imágenes generadas por IA (default 'ingredientes/ia').
    // options.optional: si true, no es obligatorio agregar imagen — devuelve ''
    //   en lugar de tirar error cuando el usuario no genera/sube nada.
    const uploadFolder = options.uploadFolder || 'ingredientes/uploads';
    const aiFolder = options.aiFolder || 'ingredientes/ia';
    const optional = Boolean(options.optional);
    const methodInput = document.getElementById(`${prefix}_method`);
    const methodButtons = Array.from(document.querySelectorAll(`#${prefix}_methodButtons [data-image-method]`));
    const urlWrap = document.getElementById(`${prefix}_urlWrap`);
    const uploadWrap = document.getElementById(`${prefix}_uploadWrap`);
    const aiWrap = document.getElementById(`${prefix}_aiWrap`);
    const preview = document.getElementById(`${prefix}_preview`);
    const imageUrlInput = document.getElementById(`${prefix}_imageUrl`);
    const imageFileInput = document.getElementById(`${prefix}_imageFile`);
    const imageFilePick = document.getElementById(`${prefix}_imageFilePick`);
    const imageFileName = document.getElementById(`${prefix}_imageFileName`);
    const aiPromptInput = document.getElementById(`${prefix}_aiPrompt`);
    const aiGenerateBtn = document.getElementById(`${prefix}_aiGenerate`);
    const aiError = document.getElementById(`${prefix}_aiError`);

    const imageState = { generatedBlob: null };

    const setPreview = (url) => {
      preview.innerHTML = url ? `<img src="${url}" alt="Vista previa">` : getPlaceholderCircle();
    };

    const toggleMethod = (method) => {
      methodInput.value = method;
      methodButtons.forEach((button) => button.classList.toggle('is-active', button.dataset.imageMethod === method));
      urlWrap.classList.toggle('d-none', method !== 'url');
      uploadWrap.classList.toggle('d-none', method !== 'upload');
      aiWrap.classList.toggle('d-none', method !== 'ai');
      aiError.classList.add('d-none');
      if (method === 'ai' && !imageState.generatedBlob && !normalizeValue(imageUrlInput.value)) {
        setPreview('');
      }
    };

    methodButtons.forEach((button) => {
      button.addEventListener('click', () => toggleMethod(button.dataset.imageMethod));
    });
    const defaultMethod = normalizeValue(imageUrlInput.value) ? 'url' : 'ai';
    toggleMethod(defaultMethod);

    imageUrlInput.addEventListener('input', () => {
      if (methodInput.value === 'url') {
        setPreview(normalizeValue(imageUrlInput.value));
      }
    });

    const showFileName = () => {
      if (!imageFileName) return;
      const file = imageFileInput.files && imageFileInput.files[0];
      imageFileName.textContent = file ? file.name : 'Ningún archivo seleccionado';
    };
    imageFilePick?.addEventListener('click', () => imageFileInput.click());

    imageFileInput.addEventListener('change', () => {
      const file = imageFileInput.files && imageFileInput.files[0];
      const message = validateImageFile(file);
      showFileName();
      if (message) {
        aiError.textContent = `Archivo no admitido: ${message}`;
        aiError.classList.remove('d-none');
        imageFileInput.value = '';
        showFileName();
        setPreview('');
        return;
      }
      aiError.classList.add('d-none');
      setPreview(URL.createObjectURL(file));
    });

    const generateWithIa = async () => {
      const prompt = normalizeValue(aiPromptInput.value);
      if (!prompt) {
        aiError.textContent = 'Escribí un prompt corto para generar la imagen.';
        aiError.classList.remove('d-none');
        return;
      }

      aiGenerateBtn.disabled = true;
      aiError.classList.add('d-none');
      preview.innerHTML = '<span class="image-preview-overlay"><sl-spinner class="meta-spinner-login" aria-label="Generando"></sl-spinner></span>';

      try {
        const blob = await window.LJAI.image(buildIngredientImagePrompt(prompt));
        imageState.generatedBlob = blob;
        setPreview(URL.createObjectURL(blob));
      } catch (error) {
        const msg = String(error?.message || error);
        const policyError = /nft|nsfw|prohibid|unsafe|policy|safety|blocked/i.test(msg);
        aiError.textContent = policyError
          ? 'La IA interpreta que querés generar una imagen de contenido prohibido. Reintentá y cambiá la descripción.'
          : `No se pudo generar la imagen. ${msg}`;
        aiError.classList.remove('d-none');
        setPreview('');
      } finally {
        aiGenerateBtn.disabled = false;
      }
    };

    aiGenerateBtn.addEventListener('click', generateWithIa);

    const aiCoverBtn = document.getElementById(`${prefix}_aiCover`);
    aiCoverBtn?.addEventListener('click', async () => {
      const name = normalizeValue(aiPromptInput.value) || normalizeValue(document.getElementById('ingredientNameInput')?.value);
      if (!name) {
        aiError.textContent = 'Escribí el nombre del ingrediente o un prompt para el texto del cartel.';
        aiError.classList.remove('d-none');
        return;
      }
      aiCoverBtn.disabled = true;
      aiGenerateBtn.disabled = true;
      aiError.classList.add('d-none');
      preview.innerHTML = '<span class="image-preview-overlay"><sl-spinner class="meta-spinner-login" aria-label="Generando"></sl-spinner></span>';
      try {
        const blob = await window.LJAI.cover(name, { kind: 'ingrediente' });
        imageState.generatedBlob = blob;
        setPreview(URL.createObjectURL(blob));
      } catch (error) {
        aiError.textContent = `No se pudo generar la carátula. ${String(error?.message || error)}`;
        aiError.classList.remove('d-none');
        setPreview('');
      } finally {
        aiCoverBtn.disabled = false;
        aiGenerateBtn.disabled = false;
      }
    });

    return async () => {
      const method = methodInput.value;
      if (method === 'url') {
        return normalizeValue(imageUrlInput.value);
      }
      if (method === 'upload') {
        const file = imageFileInput.files && imageFileInput.files[0];
        // Si es opcional y no eligió archivo, dejamos que se guarde sin imagen.
        if (!file && optional) return '';
        const message = validateImageFile(file);
        if (message) {
          // Si es opcional, en vez de tirar error guardamos sin imagen.
          if (optional) return '';
          throw new Error(`Archivo no admitido: ${message}`);
        }
        preview.innerHTML = `<span class="image-preview-overlay"><sl-spinner class="meta-spinner-login" aria-label="Subiendo"></sl-spinner></span>`;
        return uploadImageToStorage(file, uploadFolder);
      }
      if (method === 'ai') {
        if (!imageState.generatedBlob) {
          const existingUrl = normalizeValue(imageUrlInput.value);
          if (existingUrl) {
            return existingUrl;
          }
          // Si es opcional, no es obligatorio generar IA → guardamos sin imagen.
          if (optional) return '';
          throw new Error('Generá una imagen IA antes de guardar.');
        }
        const aiType = imageState.generatedBlob.type || 'image/webp';
        const aiFile = new File([imageState.generatedBlob], `ia_${Date.now()}.${aiType === 'image/png' ? 'png' : 'webp'}`, { type: aiType });
        return uploadImageToStorage(aiFile, aiFolder);
      }
      return '';
    };
  };

  const showSavingOverlay = () => {
    Swal.fire({
      title: 'Guardando...',
      html: '<sl-spinner class="meta-spinner-login" aria-label="Guardando"></sl-spinner>',
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false,
      customClass: {
        popup: 'ios-alert ingredientes-alert ingredientes-saving-alert',
        title: 'ios-alert-title',
        htmlContainer: 'ios-alert-text ingredientes-saving-html'
      }
    });
  };

  const hideSavingOverlay = () => {
    Swal.close();
  };

  const openFamilyForm = async (initial = null) => {
    let resolveImage;
    const isEdit = Boolean(initial);

    const result = await openIosSwal({
      title: isEdit ? 'Editar familia' : 'Crear familia',
      showCancelButton: true,
      confirmButtonText: isEdit ? 'Guardar familia' : 'Crear familia',
      cancelButtonText: 'Cancelar',
      html: `
        <div class="ingrediente-form-grid">
          <section class="step-block">
            <h6 class="step-title">1) Datos de familia</h6>
            <div class="step-content">
              <sl-input id="familyNameInput" label="Nombre de familia *" placeholder="Ej: Carnes" value="${initial ? escapeHtml(capitalizeLabel(initial.name)) : ''}"></sl-input>
            </div>
          </section>
          ${buildImageStepHtml('familyImage', initial?.imageUrl || '')}
        </div>
      `,
      didOpen: () => {
        resolveImage = attachImageStepEvents('familyImage');
      },
      preConfirm: async () => {
        const name = normalizeLower(document.getElementById('familyNameInput').value);
        if (!name) {
          Swal.showValidationMessage('El nombre de familia es obligatorio.');
          return false;
        }
        try {
          const imageUrl = await resolveImage();
          return { name, imageUrl };
        } catch (error) {
          Swal.showValidationMessage(error.message);
          return false;
        }
      }
    });

    if (!result.isConfirmed) {
      return null;
    }

    const familyId = initial?.id || makeId('fam');
    state.ingredientes.familias[familyId] = {
      id: familyId,
      name: result.value.name,
      imageUrl: result.value.imageUrl,
      updatedAt: Date.now(),
      createdAt: initial?.createdAt || Date.now()
    };

    const renamedItemIds = [];
    Object.values(state.ingredientes.items).forEach((item) => {
      if (item.familyId === familyId) {
        if (item.familyName !== result.value.name) renamedItemIds.push(item.id);
        item.familyName = result.value.name;
      }
    });

    showSavingOverlay();
    try {
      await persistIngredientes({ families: [familyId], items: renamedItemIds });
      state.activeFamilyId = familyId;
      refreshView();
      return familyId;
    } finally {
      hideSavingOverlay();
    }
  };

  const openIngredientForm = async (initial = null, draft = null) => {
    let resolveImage;
    const isEdit = Boolean(initial);
    const families = getFamiliasArray().sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    const measures = getMeasures();
    const selectedFamilyId = normalizeValue(draft?.familyId || initial?.familyId);
    const selectedFamily = families.find((family) => family.id === selectedFamilyId);
    const selectedMeasure = measures.find((item) => measureKey(item.name) === measureKey(draft?.measure || initial?.measure));

    const result = await openIosSwal({
      title: isEdit ? 'Editar ingrediente' : 'Crear ingrediente',
      showCancelButton: true,
      confirmButtonText: isEdit ? 'Guardar' : 'Crear ingrediente',
      cancelButtonText: 'Cancelar',
      customClass: {
        confirmButton: isEdit ? 'primary' : 'success',
        cancelButton: 'secondary'
      },
      html: `
        <div class="ingrediente-form-grid">
          <section class="step-block">
            <h6 class="step-title">1) Datos básicos</h6>
            <div class="step-content">
              <sl-input id="ingredientNameInput" label="Nombre de ingrediente *" placeholder="Ej: Jamón cocido" value="${escapeHtml(draft?.name ?? (initial ? capitalizeLabel(initial.name) : ''))}"></sl-input>

              <div>
                <label class="lj-label" for="ingredientFamilySelect">Familia *</label>
                <div class="family-inline-create">
                  <sl-select id="ingredientFamilySelect" placeholder="Seleccioná una familia" hoist value="${selectedFamily ? ljOptionValue(selectedFamily.id) : ''}">
                    ${families.map((family) => `<sl-option value="${ljOptionValue(family.id)}">${capitalizeLabel(family.name)}</sl-option>`).join('')}
                  </sl-select>
                  <sl-button variant="default" type="button" id="createFamilyInline">Crear familia</sl-button>
                </div>
              </div>

              <sl-textarea id="ingredientDescriptionInput" label="Descripción (opcional)" resize="auto" rows="3" placeholder="Descripción del ingrediente" value="${escapeHtml(draft?.description ?? (initial?.description || ''))}"></sl-textarea>
            </div>
          </section>

          <section class="step-block">
            <h6 class="step-title">2) Medida</h6>
            <div class="step-content">
              <sl-select id="ingredientMeasureSelect" label="Medida *" placeholder="Seleccioná una medida" hoist value="${selectedMeasure ? ljOptionValue(selectedMeasure.name) : ''}">
                ${measures.map((item) => `<sl-option value="${ljOptionValue(item.name)}">${capitalizeLabel(item.name)} (${item.abbr})</sl-option>`).join('')}
                <sl-option value="custom">Otra medida</sl-option>
              </sl-select>
              <div id="customMeasureWrap" class="d-none custom-measure-wrap">
                <sl-input id="ingredientMeasureCustomName" placeholder="Nombre de medida"></sl-input>
                <sl-input id="ingredientMeasureCustomAbbr" placeholder="Abreviatura"></sl-input>
              </div>
            </div>
          </section>

          ${buildImageStepHtml('ingredientImage', initial?.imageUrl || '')}
        </div>
      `,
      didOpen: () => {
        resolveImage = attachImageStepEvents('ingredientImage');
        const measureSelect = document.getElementById('ingredientMeasureSelect');
        const customWrap = document.getElementById('customMeasureWrap');
        const createFamilyInline = document.getElementById('createFamilyInline');
        const familySelect = document.getElementById('ingredientFamilySelect');

        measureSelect.addEventListener('change', () => {
          customWrap.classList.toggle('d-none', ljSelectValue(measureSelect) !== 'custom');
        });

        createFamilyInline.addEventListener('click', async () => {
          const draftState = {
            name: document.getElementById('ingredientNameInput').value,
            familyId: ljSelectValue(familySelect),
            description: document.getElementById('ingredientDescriptionInput').value,
            measure: ljSelectValue(document.getElementById('ingredientMeasureSelect')),
            customName: document.getElementById('ingredientMeasureCustomName').value,
            customAbbr: document.getElementById('ingredientMeasureCustomAbbr').value
          };

          Swal.close();
          await new Promise((resolve) => setTimeout(resolve, 30));
          const familyId = await openFamilyForm();
          if (!familyId) {
            await openIngredientForm(initial, draftState);
            return;
          }

          const family = state.ingredientes.familias[familyId];
          await openIngredientForm(initial, { ...draftState, familyId: family?.id || '' });
        });
      },
      preConfirm: async () => {
        const name = normalizeLower(document.getElementById('ingredientNameInput').value);
        const familyId = normalizeValue(ljSelectValue(document.getElementById('ingredientFamilySelect')));
        const description = normalizeValue(document.getElementById('ingredientDescriptionInput').value);
        const measureSelect = normalizeLower(ljSelectValue(document.getElementById('ingredientMeasureSelect')));
        const customName = normalizeLower(document.getElementById('ingredientMeasureCustomName').value);
        const customAbbr = normalizeValue(document.getElementById('ingredientMeasureCustomAbbr').value);

        if (!name) {
          Swal.showValidationMessage('El nombre del ingrediente es obligatorio.');
          return false;
        }
        if (!familyId) {
          Swal.showValidationMessage('Seleccioná o creá una familia.');
          return false;
        }

        let measure = measureSelect;
        if (!measure || (measure === 'custom' && !customName)) {
          Swal.showValidationMessage('Completá una medida válida.');
          return false;
        }

        if (measure === 'custom') {
          measure = customName;
          const exists = getMeasures().some((item) => measureKey(item.name) === measureKey(customName));
          if (!exists) {
            state.ingredientes.config.measures.push({ name: customName, abbr: customAbbr || 'S/A' });
          }
        }

        try {
          const imageUrl = await resolveImage();
          return {
            name,
            familyId,
            familyName: state.ingredientes.familias[familyId]?.name || '',
            description,
            measure,
            imageUrl
          };
        } catch (error) {
          Swal.showValidationMessage(error.message);
          return false;
        }
      }
    });

    if (!result.isConfirmed) {
      return null;
    }

    const itemId = initial?.id || makeId('ing');
    state.ingredientes.items[itemId] = {
      id: itemId,
      name: result.value.name,
      familyId: result.value.familyId,
      familyName: result.value.familyName,
      description: result.value.description,
      measure: result.value.measure,
      imageUrl: result.value.imageUrl,
      updatedAt: Date.now(),
      createdAt: initial?.createdAt || Date.now()
    };

    showSavingOverlay();
    try {
      await persistIngredientes({ items: [itemId] });
      state.activeFamilyId = result.value.familyId;
      refreshView();
      return itemId;
    } finally {
      hideSavingOverlay();
    }
  };

  const confirmDelete = async (title, text) => {
    const result = await openIosSwal({
      title,
      html: `<p>${text}</p>`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar',
      reverseButtons: true
    });
    return result.isConfirmed;
  };

  const deleteFamilyById = async (familyId) => {
    const family = state.ingredientes.familias[familyId];
    if (!family) return;
    const linkedItems = getIngredientesArray().filter((item) => item.familyId === familyId);
    const ok = await confirmDelete('¿Eliminar familia?', `Se eliminará ${capitalizeLabel(family.name)} y ${linkedItems.length} ingrediente(s) asociados.`);
    if (!ok) return;
    delete state.ingredientes.familias[familyId];
    linkedItems.forEach((item) => delete state.ingredientes.items[item.id]);
    state.activeFamilyId = 'all';
    await window.dbLaJamoneraRest.write(`/ingredientes/familias/${familyId}`, null);
    await Promise.all(linkedItems.map((item) => window.dbLaJamoneraRest.write(`/ingredientes/items/${item.id}`, null)));
    await persistIngredientes();
    refreshView();
  };

  const openInventoryFor = async (itemId, editor) => {
    const api = window.laJamoneraInventarioAPI;
    if (!api?.openIngredient) return;
    LJModal.close(ingredientesModal);
    await LJModal.onceClosed(ingredientesModal);
    api.openIngredient(itemId, { editor });
  };

  const handleDataClicks = async (event) => {
    const selectRow = event.target.closest('[data-ing-select]');
    if (selectRow) {
      selectIngredient(selectRow.dataset.ingSelect, { openDetail: true });
      return;
    }
    if (event.target.closest('[data-ing-detail-back]')) {
      setIngDetailOpen(false);
      const id = state.selectedId;
      requestAnimationFrame(() => ingredientesList?.querySelector(`[data-ing-select="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' }));
      return;
    }
    if (event.target.closest('[data-family-create]')) {
      await openFamilyForm();
      return;
    }
    if (event.target.closest('[data-family-edit-selected]')) {
      const family = state.ingredientes.familias[state.activeFamilyId];
      if (family) await openFamilyForm(family);
      return;
    }
    if (event.target.closest('[data-family-delete-selected]')) {
      await deleteFamilyById(state.activeFamilyId);
      return;
    }
    const stockButton = event.target.closest('[data-ingrediente-stock]');
    if (stockButton) {
      await openInventoryFor(stockButton.dataset.ingredienteStock, true);
      return;
    }
    const inventoryButton = event.target.closest('[data-ingrediente-inventory]');
    if (inventoryButton) {
      await openInventoryFor(inventoryButton.dataset.ingredienteInventory, false);
      return;
    }
    const imageViewButton = event.target.closest('[data-ingrediente-image-view]');
    if (imageViewButton) {
      const item = state.ingredientes.items[imageViewButton.dataset.ingredienteImageView];
      if (item?.imageUrl) {
        if (typeof Swal.viewDocument === 'function') Swal.viewDocument(item.imageUrl, capitalizeLabel(item.name));
        else window.open(item.imageUrl, '_blank', 'noopener');
      }
      return;
    }
    const aiImageButton = event.target.closest('[data-ingrediente-ai-image]');
    if (aiImageButton) {
      const item = await ensureIngredientDetail(aiImageButton.dataset.ingredienteAiImage);
      if (item?.id) await openIngredientForm(item);
      return;
    }
    const duplicateButton = event.target.closest('[data-ingrediente-duplicate]');
    if (duplicateButton) {
      const item = await ensureIngredientDetail(duplicateButton.dataset.ingredienteDuplicate);
      if (item?.id) {
        await openIngredientForm(null, {
          name: `${capitalizeLabel(item.name)} (copia)`,
          familyId: item.familyId,
          measure: item.measure,
          description: item.description || ''
        });
      }
      return;
    }

    const searchAllButton = event.target.closest('[data-ingredient-search-all]');
    if (searchAllButton) {
      state.activeFamilyId = 'all';
      renderFamilies();
      renderIngredientes();
      return;
    }

    if (event.target.closest('[data-ing-families-toggle]')) {
      state.familiesCollapsed = !state.familiesCollapsed;
      try { localStorage.setItem('ingredientes_families_collapsed', state.familiesCollapsed ? '1' : '0'); } catch (_) {}
      renderFamilies();
      return;
    }

    const filterButton = event.target.closest('[data-family-filter]');
    if (filterButton) {
      state.activeFamilyId = filterButton.dataset.familyFilter;
      state.search = '';
      if (searchInput) searchInput.value = '';
      renderFamilies();
      renderIngredientes();
      return;
    }

    const editFamilyButton = event.target.closest('[data-family-edit]');
    if (editFamilyButton) {
      const family = state.ingredientes.familias[editFamilyButton.dataset.familyEdit];
      if (family) {
        await openFamilyForm(family);
      }
      return;
    }

    const deleteFamilyButton = event.target.closest('[data-family-delete]');
    if (deleteFamilyButton) {
      const familyId = deleteFamilyButton.dataset.familyDelete;
      const family = state.ingredientes.familias[familyId];
      if (!family) {
        return;
      }
      const linkedItems = getIngredientesArray().filter((item) => item.familyId === familyId);
      const ok = await confirmDelete('¿Eliminar familia?', `Se eliminará ${capitalizeLabel(family.name)} y ${linkedItems.length} ingrediente(s) asociados.`);
      if (!ok) {
        return;
      }
      delete state.ingredientes.familias[familyId];
      linkedItems.forEach((item) => delete state.ingredientes.items[item.id]);
      state.activeFamilyId = 'all';
      await window.dbLaJamoneraRest.write(`/ingredientes/familias/${familyId}`, null);
      await Promise.all(linkedItems.map((item) => window.dbLaJamoneraRest.write(`/ingredientes/items/${item.id}`, null)));
      await persistIngredientes();
      refreshView();
      return;
    }

    const editIngredientButton = event.target.closest('[data-ingrediente-edit]');
    if (editIngredientButton) {
      const item = await ensureIngredientDetail(editIngredientButton.dataset.ingredienteEdit);
      if (item) {
        await openIngredientForm(item);
      }
      return;
    }

    const deleteIngredientButton = event.target.closest('[data-ingrediente-delete]');
    if (deleteIngredientButton) {
      const itemId = deleteIngredientButton.dataset.ingredienteDelete;
      const item = state.ingredientes.items[itemId];
      if (!item) {
        return;
      }
      const ok = await confirmDelete('¿Eliminar ingrediente?', `Se eliminará ${capitalizeLabel(item.name)}.`);
      if (!ok) {
        return;
      }
      delete state.ingredientes.items[itemId];
      await window.dbLaJamoneraRest.write(`/ingredientes/items/${itemId}`, null);
      await persistIngredientes();
      refreshView();
    }
  };

  const loadIngredientes = async () => {
    showIngredientesState('loading');
    state.inventoryIndexLoading = null;
    try {
      await fetchIngredientes();
      refreshView();
      // Stock por ingrediente (índice liviano): se pinta cuando llega, sin bloquear la lista.
      loadInventoryIndex().then(() => {
        if (getIngredientesArray().length) renderIngredientes();
      });
    } catch (error) {
      showIngredientesState('empty');
      await openIosSwal({ title: 'No se pudo cargar', html: '<p>Error leyendo ingredientes desde Firebase.</p>', icon: 'error', confirmButtonText: 'Entendido' });
    }
  };


  LJModal.on(ingredientesModal, 'hide', () => {
    blurActiveElement();
  });

  LJModal.on(ingredientesModal, 'hidden', () => {
    blurActiveElement();
  });

  LJModal.on(ingredientesModal, 'show', loadIngredientes);
  let searchRenderTimer = null;
  const scheduleIngredientesSearchRender = () => {
    if (searchRenderTimer) {
      clearTimeout(searchRenderTimer);
    }
    searchRenderTimer = setTimeout(() => {
      searchRenderTimer = null;
      // Re-render de familias para que se colapse / expanda según haya búsqueda.
      renderFamilies();
      renderIngredientes();
    }, 120); // espera breve: no redibujar ~250 filas en cada tecla
  };
  if (searchInput) {
    searchInput.addEventListener('input', (event) => {
      state.search = normalizeLower(event.target.value);
      scheduleIngredientesSearchRender();
    });
  }
  if (ingredientesData) {
    ingredientesData.addEventListener('click', handleDataClicks);
    ingredientesData.addEventListener('change', (event) => {
      const select = event.target.closest?.('#ingredientesFamilyFilter');
      if (!select) return;
      const value = (window.ljSelectValue ? window.ljSelectValue(select) : select.value) || 'all';
      if (value === state.activeFamilyId) return;
      state.activeFamilyId = value;
      renderFamilies();
      renderIngredientes();
    });
    // Teclado en la lista: flechas cambian la selección (listbox con roving tabindex).
    ingredientesData.addEventListener('keydown', (event) => {
      const row = event.target.closest?.('[data-ing-select]');
      if (!row || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      const rows = [...ingredientesList.querySelectorAll('[data-ing-select]')];
      const index = rows.indexOf(row);
      const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
      event.preventDefault();
      selectIngredient(rows[nextIndex].dataset.ingSelect, { focus: true });
    });
  }
  if (ingredientesList) {
    ingredientesList.addEventListener('scroll', updateListScrollHint);
  }
  if (createIngredientBtn) {
    ensurePrintButton();
    createIngredientBtn.addEventListener('click', () => openIngredientForm());
  }
  if (printIngredientsBtn) {
    printIngredientsBtn.addEventListener('click', () => printIngredientsCatalog());
  }
  if (emptyCreateIngredientBtn) {
    emptyCreateIngredientBtn.addEventListener('click', () => openIngredientForm());
  }

  window.laJamoneraIngredientesAPI = {
    openIngredientForm: async (initial = null, draft = null) => {
      await window.laJamoneraReady;
      await fetchIngredientes();
      if (initial?.id) {
        initial = await ensureIngredientDetail(initial.id);
      }
      return openIngredientForm(initial, draft);
    },
    getIngredientesSnapshot: async () => {
      await window.laJamoneraReady;
      await fetchIngredientes();
      return {
        familias: safeObject(state.ingredientes.familias),
        items: safeObject(state.ingredientes.items),
        measures: getMeasures()
      };
    },
    // Expone el step de imagen (Link / Subir / IA) para que otros módulos
    // (ej. Producción → grupos de recetas) reutilicen el mismo flujo y look.
    // El segundo parámetro `uploadFolder` define la carpeta del Storage.
    imageStep: {
      buildHtml: (prefix, initialImage = '') => buildImageStepHtml(prefix, initialImage),
      attach: (prefix, options = {}) => attachImageStepEvents(prefix, options)
    }
  };

})();
