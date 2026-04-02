(function ingredientesModule() {
  const IA_WORKER_BASE = 'https://worker.lucasponzoninovogar.workers.dev';
  const IA_ICON_SRC = './IMG/ia-unscreen.gif';
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
    ingredientes: { familias: {}, items: {}, config: { measures: [] } }
  };

  const ingredientesModal = document.getElementById('ingredientesModal');
  const ingredientesLoading = document.getElementById('ingredientesLoading');
  const ingredientesEmpty = document.getElementById('ingredientesEmpty');
  const ingredientesData = document.getElementById('ingredientesData');
  const familiasCircles = document.getElementById('familiasCircles');
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

  const parkFocusOutsideHiddenContainers = () => {
    let node = document.getElementById('focusParkingNode');
    if (!node) {
      node = document.createElement('button');
      node.id = 'focusParkingNode';
      node.type = 'button';
      node.setAttribute('aria-hidden', 'true');
      node.tabIndex = -1;
      node.style.position = 'fixed';
      node.style.opacity = '0';
      node.style.pointerEvents = 'none';
      node.style.width = '1px';
      node.style.height = '1px';
      node.style.left = '-9999px';
      node.style.top = '-9999px';
      document.body.appendChild(node);
    }
    node.focus({ preventScroll: true });
  };

  const releaseAriaHiddenFocus = () => {
    const active = document.activeElement;
    if (!active || active === document.body) return;
    let node = active;
    while (node && node !== document.body) {
      if (node.getAttribute && node.getAttribute('aria-hidden') === 'true') {
        blurActiveElement();
        document.body.focus?.();
        break;
      }
      node = node.parentElement;
    }
  };

  const openIosSwal = (options) => {
    blurActiveElement();
    releaseAriaHiddenFocus();
    parkFocusOutsideHiddenContainers();
    ingredientesModal.setAttribute('inert', '');
    return Swal.fire({
      ...options,
      returnFocus: false,
      willClose: () => {
        ingredientesModal.removeAttribute('inert');
        if (typeof options.willClose === 'function') {
          options.willClose();
        }
      },
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
  };

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
    const data = await window.dbLaJamoneraRest.read('/ingredientes');
    const safeData = safeObject(data);
    state.ingredientes = {
      familias: safeObject(safeData.familias),
      items: safeObject(safeData.items),
      config: safeObject(safeData.config)
    };
    ensureMeasures();
  };

  const persistIngredientes = async () => {
    ensureMeasures();
    await window.laJamoneraReady;
    await window.dbLaJamoneraRest.write('/ingredientes', state.ingredientes);
  };

  const getFamiliasArray = () => Object.values(safeObject(state.ingredientes.familias));
  const getIngredientesArray = () => Object.values(safeObject(state.ingredientes.items));

  const familyAvatar = (url, alt, itemCount = 0) => {
    const countBadge = Number(itemCount) > 0 ? `<span class="family-circle-count">${Math.min(99, Number(itemCount))}</span>` : '';
    return url
      ? `<span class="family-circle-thumb"><span class="thumb-loading"><img class="meta-spinner" src="./IMG/Meta-ai-logo.webp" alt="Cargando"></span><img class="thumb-image js-family-thumb" src="${url}" alt="${alt}" loading="lazy">${countBadge}</span>`
      : `<span class="family-circle-thumb family-circle-thumb-placeholder">${PLACEHOLDER_ICON}${countBadge}</span>`;
  };

  const renderFamilies = () => {
    const families = getFamiliasArray().sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    const ingredientCounts = getIngredientesArray().reduce((acc, item) => {
      const familyId = normalizeValue(item?.familyId);
      if (!familyId) return acc;
      acc[familyId] = Number(acc[familyId] || 0) + 1;
      return acc;
    }, {});

    const allButton = `
      <div class="family-circle-wrap">
        <button type="button" class="family-circle-item ${state.activeFamilyId === 'all' ? 'is-active' : ''}" data-family-filter="all">
          <span class="family-circle-thumb family-circle-thumb-placeholder">${PLACEHOLDER_ICON}</span>
          <span class="family-circle-name">Todas</span>
        </button>
      </div>
    `;

    const familyButtons = families.map((family) => `
      <div class="family-circle-wrap">
        <button type="button" class="family-circle-item ${state.activeFamilyId === family.id ? 'is-active' : ''}" data-family-filter="${family.id}">
          ${familyAvatar(family.imageUrl, capitalizeLabel(family.name), ingredientCounts[family.id] || 0)}
          <span class="family-circle-name">${capitalizeLabel(family.name)}</span>
        </button>
        <div class="family-circle-actions">
          <button class="family-manage-btn" data-family-edit="${family.id}" type="button" title="Editar familia"><i class="fa-solid fa-pen"></i></button>
          <button class="family-manage-btn" data-family-delete="${family.id}" type="button" title="Eliminar familia"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>
    `).join('');

    familiasCircles.innerHTML = allButton + familyButtons;
    prepareThumbLoaders('.js-family-thumb');
  };

  const matchesSearch = (item) => {
    if (!state.search) {
      return true;
    }
    const content = [item.name, item.familyName, item.measure, item.description].map(normalizeLower).join(' ');
    return content.includes(state.search);
  };

  const ingredientAvatar = (url, alt) => url
    ? `<div class="ingrediente-avatar"><span class="thumb-loading"><img class="meta-spinner" src="./IMG/Meta-ai-logo.webp" alt="Cargando"></span><img class="thumb-image js-ingrediente-thumb" src="${url}" alt="${alt}" loading="lazy"></div>`
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
        wrapper.innerHTML = getPlaceholderCircle();
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

    if (!items.length) {
      const outsideMatches = state.search
        ? allItems.filter((item) => {
          const content = [item.name, item.familyName, item.measure, item.description].map(normalizeLower).join(' ');
          return content.includes(state.search);
        })
        : [];
      if (outsideMatches.length) {
        visibleItems = outsideMatches;
        helperHtml = `<div class="ingrediente-empty-list">No hay resultados con los filtros actuales.<div class="ingrediente-empty-image-wrap"><img src="${escapeHtml(NO_DATA_IMAGE_URL)}" alt="Sin resultados" class="ingrediente-empty-image"></div></div><hr class="inventario-filter-separator"><p class="inventario-filter-helper">Coincidencias <strong>fuera del filtro</strong> seleccionado</p>`;
      } else {
        ingredientesList.innerHTML = '<div class="ingrediente-empty-list">No encontramos ingredientes con ese filtro.</div>';
        updateListScrollHint();
        return;
      }
    }

    const sorted = visibleItems.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    ingredientesList.innerHTML = `${helperHtml}${sorted.map((item) => `
      <article class="ingrediente-card">
        ${ingredientAvatar(item.imageUrl, capitalizeLabel(item.name))}
        <div class="ingrediente-main">
          <h6 class="ingrediente-name">${capitalizeLabel(item.name)}</h6>
          <p class="ingrediente-meta">${capitalizeLabel(item.familyName)} · ${getMeasureLabel(item.measure)}</p>
          <p class="ingrediente-dates">
            <span><i class="fa-regular fa-calendar-plus" aria-hidden="true"></i> Alta: ${formatDateLabel(item.createdAt)}</span>
            <span><i class="fa-regular fa-calendar-check" aria-hidden="true"></i> Mod: ${formatDateLabel(item.updatedAt)}</span>
          </p>
          ${item.description ? `<p class="ingrediente-description">${item.description}</p>` : ''}
        </div>
        <div class="ingrediente-actions">
          <button class="ingrediente-action" type="button" data-ingrediente-edit="${item.id}" title="Editar ingrediente"><i class="fa-solid fa-pen"></i></button>
          <button class="ingrediente-action" type="button" data-ingrediente-delete="${item.id}" title="Eliminar ingrediente"><i class="fa-solid fa-trash"></i></button>
        </div>
      </article>
    `).join('')}`;

    prepareThumbLoaders('.js-ingrediente-thumb');
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

    printIngredientsBtn = document.createElement('button');
    printIngredientsBtn.type = 'button';
    printIngredientsBtn.id = 'printIngredientsBtn';
    printIngredientsBtn.className = 'btn ios-btn ios-btn-secondary produccion-toolbar-icon-btn boton-fc';
    printIngredientsBtn.title = 'Imprimir';
    printIngredientsBtn.setAttribute('aria-label', 'Imprimir');
    printIngredientsBtn.innerHTML = '<i class="fa-solid fa-print"></i><span>Imprimir</span>';

    actionsWrap.insertBefore(separator, createIngredientBtn);
    actionsWrap.insertBefore(printIngredientsBtn, separator);
  };

  const openIngredientsScopeSelector = async () => openIosSwal({
    title: 'Selector de productos',
    html: `<div class="swal-stack-fields text-start">
      <label class="inventario-check-row"><input type="radio" name="ingredientPrintScope" value="all" checked><span>Todos los productos</span></label>
      <label class="inventario-check-row"><input type="radio" name="ingredientPrintScope" value="exclude"><span>Algunos productos</span></label>
      <label class="inventario-check-row"><input type="radio" name="ingredientPrintScope" value="perishable"><span>Perecederos o no perecederos</span></label>
      <div id="ingredientPrintTypeScope" class="notify-specific-users-list d-none">
        <label class="inventario-check-row"><input type="radio" name="ingredientPerishableType" value="perishable" checked><span>Solo perecederos</span></label>
        <label class="inventario-check-row"><input type="radio" name="ingredientPerishableType" value="non_perishable"><span>Solo no perecederos</span></label>
      </div>
      <div id="ingredientPrintProductsScope" class="notify-specific-users-list d-none">
        <div class="step-block"><strong>Familias</strong>${getFamiliasArray().map((family) => `<label class="inventario-check-row inventario-selector-row">${family.imageUrl ? `<span class="inventario-print-photo-wrap"><span class="thumb-loading"><img class="meta-spinner" src="./IMG/Meta-ai-logo.webp" alt="Cargando"></span><img class="thumb-image js-ingredientes-print-thumb ingredientes-print-thumb-fit" src="${escapeHtml(family.imageUrl)}" alt="${escapeHtml(capitalizeLabel(family.name))}"></span>` : '<span class="inventario-print-photo-wrap"><span class="image-placeholder-circle-2"><i class="fa-solid fa-carrot"></i></span></span>'}<input type="checkbox" data-ingredient-print-family value="${family.id}"><span>${escapeHtml(capitalizeLabel(family.name))}</span></label>`).join('')}</div>
        <div class="step-block"><strong>Productos</strong>${getIngredientesArray().map((item) => `<label class="inventario-check-row inventario-selector-row">${item.imageUrl ? `<span class="inventario-print-photo-wrap"><span class="thumb-loading"><img class="meta-spinner" src="./IMG/Meta-ai-logo.webp" alt="Cargando"></span><img class="thumb-image js-ingredientes-print-thumb ingredientes-print-thumb-fit" src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(capitalizeLabel(item.name))}"></span>` : '<span class="inventario-print-photo-wrap"><span class="image-placeholder-circle-2"><i class="fa-solid fa-carrot"></i></span></span>'}<input type="checkbox" data-ingredient-print-product data-family-id="${item.familyId || ''}" value="${item.id}"><span>${escapeHtml(capitalizeLabel(item.name))}</span></label>`).join('')}</div>
      </div>
    </div>`,
    showCancelButton: true,
    confirmButtonText: 'Continuar',
    cancelButtonText: 'Cancelar',
    didOpen: () => {
      const all = document.querySelector('input[name="ingredientPrintScope"][value="all"]');
      const exclude = document.querySelector('input[name="ingredientPrintScope"][value="exclude"]');
      const perishable = document.querySelector('input[name="ingredientPrintScope"][value="perishable"]');
      const productsScope = document.getElementById('ingredientPrintProductsScope');
      const typeScope = document.getElementById('ingredientPrintTypeScope');
      const toggle = () => {
        productsScope?.classList.toggle('d-none', !exclude?.checked);
        typeScope?.classList.toggle('d-none', !perishable?.checked);
      };
      all?.addEventListener('change', toggle);
      exclude?.addEventListener('change', toggle);
      perishable?.addEventListener('change', toggle);
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
      const mode = document.querySelector('input[name="ingredientPrintScope"]:checked')?.value || 'all';
      const selected = [...document.querySelectorAll('[data-ingredient-print-product]:checked')].map((node) => node.value);
      const targetPerishable = document.querySelector('input[name="ingredientPerishableType"]:checked')?.value || 'perishable';
      if (mode === 'exclude' && !selected.length) {
        Swal.showValidationMessage('Seleccioná al menos un producto para imprimir.');
        return false;
      }
      return { mode, selected, targetPerishable };
    }
  });


  const showPreparingPrintAlert = () => Swal.fire({
    title: 'Preparando selector...',
    html: '<div class="informes-saving-spinner"><img src="./IMG/Meta-ai-logo.webp" alt="Preparando selector" class="meta-spinner-login"></div>',
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
        const inventoryConfig = await window.dbLaJamoneraRest.read('/inventario/items');
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
      ingredientesModal.removeAttribute('inert');
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
          ${item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" style="width:100%;height:100%;object-fit:contain;object-position:center;border-radius:999px;display:block;" alt="${escapeHtml(capitalizeLabel(item.name))}">` : '<i class="fa-solid fa-carrot" style="color:#5f6a89;font-size:28px;"></i>'}
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
        <div class="image-method-buttons" id="${prefix}_methodButtons">
          <button type="button" class="btn image-method-btn" data-image-method="url"><i class="fa-solid fa-link"></i>Link</button>
          <button type="button" class="btn image-method-btn" data-image-method="upload"><i class="fa-solid fa-upload"></i>Subir</button>
          <button type="button" class="btn image-method-btn is-active" data-image-method="ai"><img src="${IA_ICON_SRC}" alt="" aria-hidden="true"> IA</button>
        </div>
        <input type="hidden" id="${prefix}_method" value="ai">

        <div id="${prefix}_preview" class="image-preview-circle">
          ${initialImage ? `<img src="${initialImage}" alt="Vista previa">` : getPlaceholderCircle()}
        </div>

        <div id="${prefix}_urlWrap">
          <label for="${prefix}_imageUrl">Link de imagen</label>
          <input id="${prefix}_imageUrl" class="swal2-input ios-input" placeholder="https://..." value="${initialImage || ''}">
        </div>

        <div id="${prefix}_uploadWrap" class="d-none">
          <label for="${prefix}_imageFile">Subir imagen</label>
          <input id="${prefix}_imageFile" type="file" class="form-control image-file-input" accept="image/*">
        </div>

        <div id="${prefix}_aiWrap" class="d-none">
          <label for="${prefix}_aiPrompt">Prompt corto para IA</label>
          <input id="${prefix}_aiPrompt" class="swal2-input ios-input" placeholder="Ej: carne de cerdo">
          <button id="${prefix}_aiGenerate" type="button" class="ai-generate-btn mt-2">
            <img src="${IA_ICON_SRC}" alt="" aria-hidden="true">
            <span>Generar imagen con IA</span>
          </button>
          <div id="${prefix}_aiError" class="ai-alert-note d-none mt-2"></div>
        </div>
      </div>
    </section>
  `;

  const attachImageStepEvents = (prefix) => {
    const methodInput = document.getElementById(`${prefix}_method`);
    const methodButtons = Array.from(document.querySelectorAll(`#${prefix}_methodButtons [data-image-method]`));
    const urlWrap = document.getElementById(`${prefix}_urlWrap`);
    const uploadWrap = document.getElementById(`${prefix}_uploadWrap`);
    const aiWrap = document.getElementById(`${prefix}_aiWrap`);
    const preview = document.getElementById(`${prefix}_preview`);
    const imageUrlInput = document.getElementById(`${prefix}_imageUrl`);
    const imageFileInput = document.getElementById(`${prefix}_imageFile`);
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

    imageFileInput.addEventListener('change', () => {
      const file = imageFileInput.files && imageFileInput.files[0];
      const message = validateImageFile(file);
      if (message) {
        aiError.textContent = `Archivo no admitido: ${message}`;
        aiError.classList.remove('d-none');
        imageFileInput.value = '';
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
      preview.innerHTML = `<span class="image-preview-overlay"><img src="${IA_ICON_SRC}" alt="Generando"></span>`;

      try {
        const res = await fetch(`${IA_WORKER_BASE}/emoji`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, mode: 'fast' })
        });

        if (!res.ok) {
          let msg = `${res.status} ${res.statusText}`;
          try {
            const j = await res.json();
            msg = j?.details ? `${j.error}: ${j.details}` : (j?.error || msg);
          } catch (error) {
            msg = (await res.text()).slice(0, 220);
          }

          const policyError = /nft|nsfw|prohibid|unsafe|policy/i.test(msg);
          aiError.innerHTML = policyError
            ? 'La IA interpreta que querés generar una imagen de contenido prohibido. Reintentá y cambiá la descripción.'
            : `No se pudo generar la imagen. ${msg}`;
          aiError.classList.remove('d-none');
          setPreview('');
          return;
        }

        const blob = await res.blob();
        imageState.generatedBlob = blob;
        setPreview(URL.createObjectURL(blob));
      } catch (error) {
        aiError.textContent = `No se pudo conectar: ${error?.message || error}`;
        aiError.classList.remove('d-none');
        setPreview('');
      } finally {
        aiGenerateBtn.disabled = false;
      }
    };

    aiGenerateBtn.addEventListener('click', generateWithIa);

    return async () => {
      const method = methodInput.value;
      if (method === 'url') {
        return normalizeValue(imageUrlInput.value);
      }
      if (method === 'upload') {
        const file = imageFileInput.files && imageFileInput.files[0];
        const message = validateImageFile(file);
        if (message) {
          throw new Error(`Archivo no admitido: ${message}`);
        }
        preview.innerHTML = `<span class="image-preview-overlay"><img class="meta-spinner-login" src="./IMG/Meta-ai-logo.webp" alt="Subiendo"></span>`;
        return uploadImageToStorage(file, 'ingredientes/uploads');
      }
      if (method === 'ai') {
        if (!imageState.generatedBlob) {
          const existingUrl = normalizeValue(imageUrlInput.value);
          if (existingUrl) {
            return existingUrl;
          }
          throw new Error('Generá una imagen IA antes de guardar.');
        }
        const aiFile = new File([imageState.generatedBlob], `ia_${Date.now()}.png`, { type: imageState.generatedBlob.type || 'image/png' });
        return uploadImageToStorage(aiFile, 'ingredientes/ia');
      }
      return '';
    };
  };

  const showSavingOverlay = () => {
    ingredientesModal.setAttribute('inert', '');
    Swal.fire({
      title: 'Guardando...',
      html: '<img src="./IMG/Meta-ai-logo.webp" alt="Guardando" class="meta-spinner-login">',
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false,
      customClass: {
        popup: 'ios-alert ingredientes-alert ingredientes-saving-alert',
        title: 'ios-alert-title',
        htmlContainer: 'ios-alert-text ingredientes-saving-html'
      },
      willClose: () => {
        ingredientesModal.removeAttribute('inert');
      }
    });
  };

  const hideSavingOverlay = () => {
    Swal.close();
    ingredientesModal.removeAttribute('inert');
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
              <label for="familyNameInput">Nombre de familia *</label>
              <input id="familyNameInput" class="swal2-input ios-input" placeholder="Ej: Carnes" value="${initial ? capitalizeLabel(initial.name) : ''}">
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

    Object.values(state.ingredientes.items).forEach((item) => {
      if (item.familyId === familyId) {
        item.familyName = result.value.name;
      }
    });

    showSavingOverlay();
    try {
      await persistIngredientes();
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

    const result = await openIosSwal({
      title: isEdit ? 'Editar ingrediente' : 'Crear ingrediente',
      showCancelButton: true,
      confirmButtonText: isEdit ? 'Guardar' : 'Crear ingrediente',
      cancelButtonText: 'Cancelar',
      customClass: {
        confirmButton: `ios-btn ${isEdit ? 'ios-btn-primary' : 'ios-btn-success'}`,
        cancelButton: 'ios-btn ios-btn-secondary'
      },
      html: `
        <div class="ingrediente-form-grid">
          <section class="step-block">
            <h6 class="step-title">1) Datos básicos</h6>
            <div class="step-content">
              <label for="ingredientNameInput">Nombre de ingrediente *</label>
              <input id="ingredientNameInput" class="swal2-input ios-input" placeholder="Ej: Jamón cocido" value="${draft?.name ?? (initial ? capitalizeLabel(initial.name) : '')}">

              <label for="ingredientFamilySelect">Familia *</label>
              <div class="family-inline-create">
                <select id="ingredientFamilySelect" class="form-select ios-input">
                  <option value="">Seleccioná una familia</option>
                  ${families.map((family) => `<option value="${family.id}" ${(draft?.familyId || initial?.familyId) === family.id ? 'selected' : ''}>${capitalizeLabel(family.name)}</option>`).join('')}
                </select>
                <button type="button" id="createFamilyInline" class="btn ios-btn ios-btn-secondary">Crear familia</button>
              </div>

              <label for="ingredientDescriptionInput">Descripción (opcional)</label>
              <textarea id="ingredientDescriptionInput" class="swal2-textarea ios-input" placeholder="Descripción del ingrediente">${draft?.description ?? (initial?.description || '')}</textarea>
            </div>
          </section>

          <section class="step-block">
            <h6 class="step-title">2) Medida</h6>
            <div class="step-content">
              <label for="ingredientMeasureSelect">Medida *</label>
              <select id="ingredientMeasureSelect" class="form-select ios-input">
                <option value="">Seleccioná una medida</option>
                ${measures.map((item) => `<option value="${item.name}" ${measureKey((draft?.measure || initial?.measure)) === measureKey(item.name) ? 'selected' : ''}>${capitalizeLabel(item.name)} (${item.abbr})</option>`).join('')}
                <option value="custom">Otra medida</option>
              </select>
              <div id="customMeasureWrap" class="d-none custom-measure-wrap">
                <input id="ingredientMeasureCustomName" class="swal2-input ios-input" placeholder="Nombre de medida">
                <input id="ingredientMeasureCustomAbbr" class="swal2-input ios-input" placeholder="Abreviatura">
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
          customWrap.classList.toggle('d-none', measureSelect.value !== 'custom');
        });

        createFamilyInline.addEventListener('click', async () => {
          const draftState = {
            name: document.getElementById('ingredientNameInput').value,
            familyId: familySelect.value,
            description: document.getElementById('ingredientDescriptionInput').value,
            measure: document.getElementById('ingredientMeasureSelect').value,
            customName: document.getElementById('ingredientMeasureCustomName').value,
            customAbbr: document.getElementById('ingredientMeasureCustomAbbr').value
          };

          blurActiveElement();
          releaseAriaHiddenFocus();
          Swal.close();
          ingredientesModal.removeAttribute('inert');
          parkFocusOutsideHiddenContainers();
          await new Promise((resolve) => setTimeout(resolve, 30));
          blurActiveElement();
          releaseAriaHiddenFocus();
          parkFocusOutsideHiddenContainers();
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
        const familyId = normalizeValue(document.getElementById('ingredientFamilySelect').value);
        const description = normalizeValue(document.getElementById('ingredientDescriptionInput').value);
        const measureSelect = normalizeLower(document.getElementById('ingredientMeasureSelect').value);
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
      await persistIngredientes();
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

  const handleDataClicks = async (event) => {
    const filterButton = event.target.closest('[data-family-filter]');
    if (filterButton) {
      state.activeFamilyId = filterButton.dataset.familyFilter;
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
      await persistIngredientes();
      refreshView();
      return;
    }

    const editIngredientButton = event.target.closest('[data-ingrediente-edit]');
    if (editIngredientButton) {
      const item = state.ingredientes.items[editIngredientButton.dataset.ingredienteEdit];
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
      await persistIngredientes();
      refreshView();
    }
  };

  const loadIngredientes = async () => {
    showIngredientesState('loading');
    try {
      await fetchIngredientes();
      refreshView();
    } catch (error) {
      showIngredientesState('empty');
      await openIosSwal({ title: 'No se pudo cargar', html: '<p>Error leyendo ingredientes desde Firebase.</p>', icon: 'error', confirmButtonText: 'Entendido' });
    }
  };


  ingredientesModal.addEventListener('hide.bs.modal', () => {
    blurActiveElement();
  });

  ingredientesModal.addEventListener('hidden.bs.modal', () => {
    blurActiveElement();
    ingredientesModal.removeAttribute('inert');
  });

  ingredientesModal.addEventListener('show.bs.modal', loadIngredientes);
  let searchRenderTimer = null;
  const scheduleIngredientesSearchRender = () => {
    if (searchRenderTimer) {
      clearTimeout(searchRenderTimer);
    }
    searchRenderTimer = setTimeout(() => {
      searchRenderTimer = null;
      renderIngredientes();
    }, 0);
  };
  if (searchInput) {
    searchInput.addEventListener('input', (event) => {
      state.search = normalizeLower(event.target.value);
      scheduleIngredientesSearchRender();
    });
  }
  if (ingredientesData) {
    ingredientesData.addEventListener('click', handleDataClicks);
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
    }
  };

})();
