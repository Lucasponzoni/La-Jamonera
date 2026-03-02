(function recetasModule() {
  const IA_WORKER_BASE = 'https://worker.lucasponzoninovogar.workers.dev';
  const IA_ICON_SRC = './IMG/ia-unscreen.gif';
  const RECIPE_PLACEHOLDER_ICON = '<i class="fa-solid fa-bowl-food"></i>';
  const ALLOWED_UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const MAX_UPLOAD_SIZE_BYTES = 5 * 1024 * 1024;

  const recetasModal = document.getElementById('recetasModal');
  if (!recetasModal) return;

  const recetasLoading = document.getElementById('recetasLoading');
  const recetasEmpty = document.getElementById('recetasEmpty');
  const recetasData = document.getElementById('recetasData');
  const recetasEditor = document.getElementById('recetasEditor');
  const recetasList = document.getElementById('recetasList');
  const recetasSearchInput = document.getElementById('recetasSearchInput');
  const createRecipeBtn = document.getElementById('createRecipeBtn');
  const emptyCreateRecipeBtn = document.getElementById('emptyCreateRecipeBtn');
  const recipeBackBtn = document.getElementById('recipeBackBtn');
  const recipeEditorTitle = document.getElementById('recipeEditorTitle');
  const recipeEditorForm = document.getElementById('recipeEditorForm');

  const state = {
    recetas: {},
    ingredientes: {},
    familias: {},
    measures: [],
    search: '',
    view: 'list',
    activeRecipeId: '',
    editor: null,
    editorEventsBound: false,
    resumeEditor: null,
    editorDirty: false,
    print: {
      cssText: '',
      cssPromise: null
    }
  };

  const normalizeValue = (value) => String(value || '').trim();
  const normalizeLower = (value) => normalizeValue(value).toLowerCase();
  const capitalize = (value) => normalizeLower(value).replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
  const escapeHtml = (value) => String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
  const safeObject = (value) => (value && typeof value === 'object' ? value : {});
  const makeId = (prefix) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const NEW_MEASURE_VALUE = '__new_measure__';

  const MONOGRAPHY_ROW_TYPE = 'monography';
  const FOOD_CATEGORIES_AR = {
    'carnes-y-derivados': ['Carnes frescas', 'Chacinados embutidos', 'Fiambres y cocidos', 'Menudencias y vísceras'],
    lacteos: ['Leche fluida', 'Leche en polvo', 'Quesos', 'Yogures y fermentados'],
    panificados: ['Panificados', 'Pastas frescas', 'Galletitas y crackers'],
    conservas: ['Conservas vegetales', 'Conservas cárnicas', 'Semiconservas'],
    bebidas: ['Sin alcohol', 'Con alcohol', 'Infusiones'],
    'aditivos-e-ingredientes': ['Condimentos', 'Aditivos', 'Premezclas', 'Ingredientes funcionales']
  };
  const PRODUCT_TYPES = [
    { value: 'solido', label: 'Sólido' },
    { value: 'liquido', label: 'Líquido' },
    { value: 'semisolido', label: 'Semisólido' },
    { value: 'polvo', label: 'Polvo' },
    { value: 'concentrado', label: 'Concentrado' }
  ];
  const DECLARATION_UNITS = [
    { value: 'g', label: 'g' },
    { value: 'ml', label: 'ml' },
    { value: 'unidad', label: 'unidad' }
  ];
  const HOUSEHOLD_MEASURES = [
    { value: 'unidad', singular: 'unidad', plural: 'unidades' },
    { value: 'taza', singular: 'taza', plural: 'tazas' },
    { value: 'vaso', singular: 'vaso', plural: 'vasos' },
    { value: 'cucharada', singular: 'cucharada', plural: 'cucharadas' },
    { value: 'cucharadita', singular: 'cucharadita', plural: 'cucharaditas' },
    { value: 'feta', singular: 'feta', plural: 'fetas' },
    { value: 'rodaja', singular: 'rodaja', plural: 'rodajas' },
    { value: 'pote', singular: 'pote', plural: 'potes' },
    { value: 'paquete', singular: 'paquete', plural: 'paquetes' }
  ];

  const FRONT_LABELS_ALLOWED = [
    'EXCESO EN AZÚCARES',
    'EXCESO EN SODIO',
    'EXCESO EN GRASAS TOTALES',
    'EXCESO EN GRASAS SATURADAS',
    'EXCESO EN CALORÍAS',
    'EXCESO EN EDULCORANTES',
    'EXCESO EN CAFEÍNA'
  ];

  const FRONT_LABEL_CONFIG = {
    'EXCESO EN AZÚCARES': { type: 'octagon', text: 'EXCESO EN\nAZÚCARES' },
    'EXCESO EN SODIO': { type: 'octagon', text: 'EXCESO EN\nSODIO' },
    'EXCESO EN GRASAS TOTALES': { type: 'octagon', text: 'EXCESO EN\nGRASAS\nTOTALES' },
    'EXCESO EN GRASAS SATURADAS': { type: 'octagon', text: 'EXCESO EN\nGRASAS\nSATURADAS' },
    'EXCESO EN CALORÍAS': { type: 'octagon', text: 'EXCESO EN\nCALORÍAS' },
    'EXCESO EN EDULCORANTES': { type: 'rectangle', text: 'CONTIENE EDULCORANTES,\nNO RECOMENDABLE EN NIÑOS/AS.' },
    'EXCESO EN CAFEÍNA': { type: 'rectangle', text: 'CONTIENE CAFEÍNA.\nEVITAR EN NIÑOS/AS.' }
  };


  const blurActiveElement = () => document.activeElement?.blur?.();
  const openIosSwal = (options) => {
    blurActiveElement();
    recetasModal.setAttribute('inert', '');
    return Swal.fire({
    ...options,
    returnFocus: false,
    willClose: () => {
      recetasModal.removeAttribute('inert');
      if (typeof options.willClose === 'function') options.willClose();
    },
    customClass: {
      popup: `ios-alert ingredientes-alert ${options?.customClass?.popup || ''}`.trim(),
      title: 'ios-alert-title',
      htmlContainer: 'ios-alert-text',
      confirmButton: 'ios-btn ios-btn-primary',
      cancelButton: 'ios-btn ios-btn-secondary',
      denyButton: 'ios-btn ios-btn-secondary',
      ...options.customClass
    },
    buttonsStyling: false
  });
  };

  const showState = (key) => {
    recetasLoading.classList.toggle('d-none', key !== 'loading');
    recetasEmpty.classList.toggle('d-none', key !== 'empty');
    recetasData.classList.toggle('d-none', key !== 'data');
  };

  const markEditorDirty = () => {
    state.editorDirty = true;
  };

  const updateListScrollHint = () => {
    if (!recetasList) return;
    const hasOverflow = recetasList.scrollHeight > recetasList.clientHeight + 4;
    const isAtEnd = recetasList.scrollTop + recetasList.clientHeight >= recetasList.scrollHeight - 4;
    recetasList.classList.toggle('has-scroll-hint', hasOverflow && !isAtEnd);
  };

  const setView = (view) => {
    state.view = view;
    recetasLoading?.classList.add('d-none');
    recetasEditor?.classList.toggle('d-none', view !== 'editor');
    recetasData?.classList.toggle('d-none', view !== 'list');
    recetasEmpty?.classList.toggle('d-none', view !== 'empty');
    if (view !== 'editor') clearSuggestions();
  };

  const getIngredientesArray = () => Object.values(safeObject(state.ingredientes));
  const getRecetasArray = () => Object.values(safeObject(state.recetas));

  const getMeasureOptions = () => {
    const list = Array.isArray(state.measures) ? state.measures : [];
    return list.map((item) => ({
      value: normalizeLower(item.name),
      label: `${capitalize(item.name)} (${normalizeValue(item.abbr) || 'S/A'})`
    }));
  };

  const getMeasureSelectOptionsHtml = (selected = '') => {
    const opts = getMeasureOptions();
    const selectedNorm = normalizeLower(selected);
    const hasSelectedInOptions = selectedNorm && opts.some((item) => item.value === selectedNorm);
    const selectedFallbackOption = selectedNorm && !hasSelectedInOptions
      ? `<option value="${selectedNorm}" selected>${capitalize(selectedNorm)}</option>`
      : '';
    return `${selectedFallbackOption}${opts.map((item) => `<option value="${item.value}" ${selectedNorm === item.value ? 'selected' : ''}>${item.label}</option>`).join('')}<option value="${NEW_MEASURE_VALUE}">+ Agregar nueva medida</option>`;
  };

  const getPreferredUnitForIngredient = (ingredient) => {
    const ingredientMeasure = normalizeLower(ingredient?.measure);
    if (ingredientMeasure) {
      return ingredientMeasure;
    }
    const available = getMeasureOptions().map((item) => item.value);
    return available[0] || '';
  };

  const persistNewMeasure = async (name, abbr) => {
    const norm = normalizeLower(name);
    if (!norm) return '';
    const exists = state.measures.some((item) => normalizeLower(item.name) === norm);
    if (!exists) {
      state.measures.push({ name: norm, abbr: normalizeValue(abbr) || 'S/A' });
      await window.laJamoneraReady;
      await window.dbLaJamoneraRest.write('/ingredientes/config/measures', state.measures);
    }
    return norm;
  };

  const formatDate = (value) => {
    const date = new Date(value || Date.now());
    return date.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const formatDateLabel = (timestamp) => {
    const date = new Date(Number(timestamp || 0));
    if (Number.isNaN(date.getTime())) return 'S/D';
    return date.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' });
  };

  const validateImageFile = (file) => {
    if (!file) return 'Seleccioná una imagen para subir.';
    if (!ALLOWED_UPLOAD_TYPES.includes(file.type)) return 'Archivo no admitido. Usá JPG, PNG, WEBP o GIF.';
    if (file.size > MAX_UPLOAD_SIZE_BYTES) return 'La imagen supera 5MB. Elegí un archivo más liviano.';
    return '';
  };

  const uploadImageToStorage = async (file, basePath) => {
    await window.laJamoneraReady;
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const refPath = `${basePath}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const ref = window.storageLaJamonera.ref().child(refPath);
    await ref.put(file);
    return ref.getDownloadURL();
  };

  const generateImageWithIA = async (prompt) => {
    const response = await fetch(`${IA_WORKER_BASE}/emoji`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, mode: 'fast' })
    });
    if (!response.ok) {
      let details = `${response.status} ${response.statusText}`;
      try {
        const payload = await response.json();
        if (payload?.error) details = payload.error;
      } catch (_) {
        // noop: fallback a status text
      }
      throw new Error(`No se pudo generar la imagen con IA (${details}).`);
    }
    const blob = await response.blob();
    if (!blob?.size) throw new Error('La IA no devolvió una imagen válida.');
    return new File([blob], `receta_${Date.now()}.png`, { type: blob.type || 'image/png' });
  };

  const fetchIngredientesData = async () => {
    if (window.laJamoneraIngredientesAPI?.getIngredientesSnapshot) {
      const snapshot = await window.laJamoneraIngredientesAPI.getIngredientesSnapshot();
      state.ingredientes = safeObject(snapshot.items);
      state.familias = safeObject(snapshot.familias);
      state.measures = Array.isArray(snapshot.measures) ? snapshot.measures : [];
      return;
    }
    await window.laJamoneraReady;
    const data = await window.dbLaJamoneraRest.read('/ingredientes');
    state.ingredientes = safeObject(data?.items);
    state.familias = safeObject(data?.familias);
    state.measures = Array.isArray(data?.config?.measures) ? data.config.measures : [];
  };

  const fetchRecetas = async () => {
    await window.laJamoneraReady;
    state.recetas = safeObject(await window.dbLaJamoneraRest.read('/recetas'));
  };

  const persistRecetas = async () => {
    await window.laJamoneraReady;
    await window.dbLaJamoneraRest.write('/recetas', state.recetas);
  };

  const renderRecetas = () => {
    const query = normalizeLower(state.search);
    const source = getRecetasArray()
      .filter((item) => !query || normalizeLower(item.title).includes(query) || normalizeLower(item.description).includes(query))
      .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));

    if (!source.length) {
      recetasList.innerHTML = '<div class="ingrediente-empty-list">No encontramos recetas con ese filtro.</div>';
      updateListScrollHint();
      showState(getRecetasArray().length ? 'data' : 'empty');
      return;
    }

    const measureMap = new Map(getMeasureOptions().map((item) => [item.value, item.label]));
    recetasList.innerHTML = source.map((item) => {
      const label = measureMap.get(normalizeLower(item.yieldUnit)) || capitalize(item.yieldUnit || '');
      const recipeIngredients = (Array.isArray(item.rows) ? item.rows : [])
        .filter((row) => row.type === 'ingredient' && normalizeValue(row.ingredientName))
        .map((row) => capitalize(row.ingredientName));
      const frontLabels = Array.isArray(item.nutrition?.ai?.frontLabels) ? item.nutrition.ai.frontLabels : [];
      const hasNutritionLabel = Boolean(normalizeValue(item.nutrition?.ai?.tableHtml));
      const hasFrontLabels = frontLabels.length > 0;
      return `
        <article class="ingrediente-card receta-card" data-receta-id="${item.id}">
          <div class="ingrediente-avatar receta-thumb-wrap">
            ${item.imageUrl
              ? `<span class="thumb-loading"><img class="meta-spinner-login" src="./IMG/Meta-ai-logo.webp" alt="Cargando"></span><img class="receta-thumb js-receta-thumb" src="${item.imageUrl}" alt="${capitalize(item.title || 'Receta')}" loading="lazy">`
              : getPlaceholderCircle()}
          </div>
          <div class="ingrediente-main receta-main">
            <h6 class="ingrediente-name receta-name">${capitalize(item.title || 'Sin título')}</h6>
            <div class="receta-print-actions">
              <button type="button" class="btn ios-btn ios-btn-secondary receta-print-btn" data-receta-print="nutrition" data-receta-id="${item.id}" ${hasNutritionLabel ? '' : 'disabled'}>
                <i class="fa-solid fa-print"></i>
                <span>Tabla nutricional</span>
              </button>
              <button type="button" class="btn ios-btn ios-btn-secondary receta-print-btn" data-receta-print="front" data-receta-id="${item.id}" ${hasFrontLabels ? '' : 'disabled'}>
                <i class="fa-solid fa-print"></i>
                <span>Etiquetado frontal</span>
              </button>
            </div>
            <p class="ingrediente-meta receta-card-meta">Rinde: ${item.yieldQuantity || '0'} ${label || ''}</p>
            <p class="ingrediente-meta receta-card-ingredients">Ingredientes: ${recipeIngredients.length ? recipeIngredients.join(' · ') : 'Sin ingredientes vinculados.'}</p>
            ${item.description ? `<p class="ingrediente-description">${capitalize(item.description)}</p>` : '<p class="ingrediente-description"><em>Sin descripción</em></p>'}
            ${frontLabels.length ? `<div class="receta-front-inline">${buildFrontLabelsHtml(frontLabels, { compact: true })}</div>` : ''}
            <p class="ingrediente-dates receta-card-dates">
              <span><i class="fa-regular fa-calendar-plus" aria-hidden="true"></i> Alta: ${formatDateLabel(item.createdAt)}</span>
              <span><i class="fa-regular fa-calendar-check" aria-hidden="true"></i> Mod: ${formatDateLabel(item.updatedAt)}</span>
            </p>
          </div>
          <div class="ingrediente-actions recipe-row-actions">
            <button type="button" class="btn family-manage-btn" data-receta-edit="${item.id}" title="Editar"><i class="fa-solid fa-pen"></i></button>
            <button type="button" class="btn family-manage-btn" data-receta-delete="${item.id}" title="Eliminar"><i class="fa-solid fa-trash"></i></button>
          </div>
        </article>`;
    }).join('');
    document.querySelectorAll('.js-receta-thumb').forEach((image) => {
      const wrapper = image.closest('.receta-thumb-wrap');
      const loading = wrapper?.querySelector('.thumb-loading');
      const showImage = () => {
        image.classList.add('is-loaded');
        loading?.classList.add('d-none');
      };
      const showFallback = () => {
        if (wrapper) wrapper.innerHTML = getPlaceholderCircle();
      };
      if (image.complete && image.naturalWidth > 0) {
        showImage();
      } else {
        image.addEventListener('load', showImage, { once: true });
        image.addEventListener('error', showFallback, { once: true });
      }
    });
    updateListScrollHint();
    showState('data');
  };

  const getPlaceholderCircle = () => `<span class="image-placeholder-circle-2">${RECIPE_PLACEHOLDER_ICON}</span>`;

  const getPrintPayload = (recipe, mode) => {
    const title = capitalize(recipe?.title || 'Receta');

    if (mode === 'nutrition') {
      const tableHtml = normalizeValue(recipe?.nutrition?.ai?.tableHtml);
      if (!tableHtml) {
        throw new Error('La receta no tiene tabla nutricional generada.');
      }
      return {
        title,
        mode,
        html: `<div class="recipe-print-nutrition">${tableHtml}</div>`
      };
    }

    const frontLabels = Array.isArray(recipe?.nutrition?.ai?.frontLabels) ? recipe.nutrition.ai.frontLabels : [];
    if (!frontLabels.length) {
      throw new Error('La receta no tiene sellos de etiquetado frontal.');
    }

    return {
      title,
      mode,
      frontLabels,
      html: `<div class="recipe-print-front">${buildFrontLabelsHtml(frontLabels)}</div>`
    };
  };

  const escapeSvgText = (value) => String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

  const renderFrontLabelsToImage = async (labels = []) => {
    const clean = Array.isArray(labels)
      ? labels.map((item) => normalizeValue(item).toUpperCase()).filter((item) => FRONT_LABELS_ALLOWED.includes(item))
      : [];
    const unique = Array.from(new Set(clean));
    if (!unique.length) {
      throw new Error('La receta no tiene sellos de etiquetado frontal.');
    }

    const octagons = unique.filter((item) => FRONT_LABEL_CONFIG[item]?.type === 'octagon');
    const rectangles = unique.filter((item) => FRONT_LABEL_CONFIG[item]?.type === 'rectangle');

    const gap = 10;
    const octSize = 156;
    const rectW = 300;
    const rectH = 96;
    const cols = 2;
    const octRows = Math.max(1, Math.ceil(octagons.length / cols));
    const rectRows = Math.max(0, Math.ceil(rectangles.length / cols));
    const width = 360;
    const octSectionH = octRows * octSize + Math.max(0, octRows - 1) * gap;
    const rectSectionH = rectRows ? (rectRows * rectH + Math.max(0, rectRows - 1) * gap + gap) : 0;
    const height = Math.max(180, 12 + octSectionH + rectSectionH + 12);

    const centerRowX = (itemWidth, colIndex) => {
      const totalRowWidth = itemWidth * cols + gap * (cols - 1);
      const start = (width - totalRowWidth) / 2;
      return start + colIndex * (itemWidth + gap);
    };

    const octagonPath = 'M26,0 L74,0 L100,26 L100,74 L74,100 L26,100 L0,74 L0,26 Z';

    let octSvg = '';
    octagons.forEach((label, index) => {
      const row = Math.floor(index / cols);
      const col = index % cols;
      const x = centerRowX(octSize, col);
      const y = 8 + row * (octSize + gap);
      const text = escapeSvgText((FRONT_LABEL_CONFIG[label]?.text || label)).replaceAll('\n', '</tspan><tspan x="50" dy="12">');
      octSvg += `
        <g transform="translate(${x},${y}) scale(${octSize / 100})">
          <path d="${octagonPath}" fill="#111" />
          <text x="50" y="36" text-anchor="middle" fill="#fff" font-family="Arial, Helvetica, sans-serif" font-size="13" font-weight="900" letter-spacing="-0.2">
            <tspan x="50" dy="0">${text}</tspan>
          </text>
          <text x="50" y="82" text-anchor="middle" fill="#fff" font-family="Arial, Helvetica, sans-serif" font-size="8.5" font-weight="700">
            <tspan x="50" dy="0">Ministerio</tspan>
            <tspan x="50" dy="9">de Salud</tspan>
          </text>
        </g>
      `;
    });

    let rectSvg = '';
    rectangles.forEach((label, index) => {
      const row = Math.floor(index / cols);
      const col = index % cols;
      const x = centerRowX(rectW, col);
      const y = 8 + octSectionH + gap + row * (rectH + gap);
      const text = escapeSvgText((FRONT_LABEL_CONFIG[label]?.text || label)).replaceAll('\n', '</tspan><tspan x="50%" dy="12">');
      rectSvg += `
        <g transform="translate(${x},${y})">
          <rect x="0" y="0" width="${rectW}" height="${rectH}" fill="#111" stroke="#fff" stroke-width="3" />
          <text x="50%" y="30" text-anchor="middle" fill="#fff" font-family="Arial, Helvetica, sans-serif" font-size="13" font-weight="900">
            <tspan x="50%" dy="0">${text}</tspan>
          </text>
          <text x="50%" y="62" text-anchor="middle" fill="#fff" font-family="Arial, Helvetica, sans-serif" font-size="8.5" font-weight="700">
            <tspan x="50%" dy="0">Ministerio de Salud</tspan>
          </text>
        </g>
      `;
    });

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${octSvg}${rectSvg}</svg>`;
    const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);

    try {
      const image = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('No se pudo renderizar sellos frontales.'));
        img.src = url;
      });

      const canvas = document.createElement('canvas');
      const scale = 2;
      canvas.width = width * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

      return {
        dataUrl: canvas.toDataURL('image/png'),
        width: canvas.width,
        height: canvas.height
      };
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  const renderHtmlToImage = async ({ html, mode, frontLabels }) => {
    if (mode === 'front') {
      return renderFrontLabelsToImage(frontLabels);
    }

    if (typeof window.html2canvas !== 'function') {
      throw new Error('No se pudo cargar la librería de renderizado.');
    }

    const host = document.createElement('div');
    host.className = 'recipe-print-render-host';
    host.innerHTML = `<div class="recipe-print-render-root mode-${mode}">${html}</div>`;
    document.body.appendChild(host);

    try {
      const target = host.querySelector('.recipe-print-render-root');
      await new Promise((resolve) => requestAnimationFrame(resolve));

      const canvas = await window.html2canvas(target, {
        backgroundColor: '#ffffff',
        scale: 2,
        useCORS: true,
        allowTaint: true,
        logging: false
      });

      if (!canvas || !canvas.width || !canvas.height) {
        throw new Error('No se pudo renderizar el diseño de impresión.');
      }

      return {
        dataUrl: canvas.toDataURL('image/png'),
        width: canvas.width,
        height: canvas.height
      };
    } catch (error) {
      throw new Error('No se pudo renderizar el diseño de impresión.');
    } finally {
      host.remove();
    }
  };

  const getPrintSheetConfig = (sheet) => {
    if (sheet === 'a4') {
      return { widthMm: 210, heightMm: 297, label: 'A4' };
    }

    return { widthMm: 100, heightMm: 150, label: 'Zebra 10x15' };
  };

  const getGridConfig = (sheet, perSheet) => {
    const count = Math.max(1, Number(perSheet) || 1);

    if (sheet === 'zebra') {
      if (count <= 1) return { rows: 1, cols: 1 };
      if (count === 2) return { rows: 1, cols: 2 };
      if (count === 3) return { rows: 3, cols: 1 };
      if (count === 4) return { rows: 2, cols: 2 };
      return { rows: 3, cols: 2 };
    }

    const ratio = 210 / 297;
    const cols = Math.max(1, Math.ceil(Math.sqrt(count * ratio)));
    const rows = Math.max(1, Math.ceil(count / cols));
    return { rows, cols };
  };

  const loadCanvasImage = (dataUrl) => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('No se pudo preparar la imagen para impresión.'));
    image.src = dataUrl;
  });

  const buildSheetCanvas = ({ imageElement, sheet, perSheet, mode }) => {
    const size = getPrintSheetConfig(sheet);
    const pageWidth = Math.round(size.widthMm * 12);
    const pageHeight = Math.round(size.heightMm * 12);
    const canvas = document.createElement('canvas');
    canvas.width = pageWidth;
    canvas.height = pageHeight;

    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, pageWidth, pageHeight);

    const margin = Math.round(Math.min(pageWidth, pageHeight) * 0.035);
    const gap = Math.round(Math.min(pageWidth, pageHeight) * 0.02);
    const contentWidth = pageWidth - margin * 2;
    const contentHeight = pageHeight - margin * 2;
    const { rows, cols } = getGridConfig(sheet, perSheet);
    const cellWidth = (contentWidth - gap * (cols - 1)) / cols;
    const cellHeight = (contentHeight - gap * (rows - 1)) / rows;

    const sourceWidth = Number(imageElement?.naturalWidth || imageElement?.width || 1);
    const sourceHeight = Number(imageElement?.naturalHeight || imageElement?.height || 1);
    const sourceRatio = sourceWidth / sourceHeight;
    const slots = Math.max(1, Number(perSheet) || 1);
    const shouldRotateZebraNutrition = sheet === 'zebra'
      && mode === 'nutrition'
      && Number(perSheet) === 3;

    for (let index = 0; index < slots; index += 1) {
      const row = Math.floor(index / cols);
      const col = index % cols;
      if (row >= rows) break;

      const x = margin + col * (cellWidth + gap);
      const y = margin + row * (cellHeight + gap);
      const ratioForFit = shouldRotateZebraNutrition ? (1 / sourceRatio) : sourceRatio;
      const targetRatio = cellWidth / cellHeight;
      let drawWidth = cellWidth;
      let drawHeight = cellHeight;

      if (ratioForFit > targetRatio) {
        drawHeight = drawWidth / ratioForFit;
      } else {
        drawWidth = drawHeight * ratioForFit;
      }

      const drawX = x + (cellWidth - drawWidth) / 2;
      const drawY = y + (cellHeight - drawHeight) / 2;

      if (shouldRotateZebraNutrition) {
        context.save();
        context.translate(drawX + (drawWidth / 2), drawY + (drawHeight / 2));
        context.rotate(-Math.PI / 2);
        context.drawImage(imageElement, -drawHeight / 2, -drawWidth / 2, drawHeight, drawWidth);
        context.restore();
      } else {
        context.drawImage(imageElement, drawX, drawY, drawWidth, drawHeight);
      }
    }

    return canvas;
  };

  const buildPdfFromCanvases = (canvases, sheet) => {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      throw new Error('No se pudo cargar la librería PDF.');
    }

    const size = getPrintSheetConfig(sheet);
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({
      orientation: size.widthMm > size.heightMm ? 'landscape' : 'portrait',
      unit: 'mm',
      format: [size.widthMm, size.heightMm]
    });

    canvases.forEach((canvas, index) => {
      if (index > 0) pdf.addPage([size.widthMm, size.heightMm], size.widthMm > size.heightMm ? 'landscape' : 'portrait');
      const dataUrl = canvas.toDataURL('image/png');
      pdf.addImage(dataUrl, 'PNG', 0, 0, size.widthMm, size.heightMm, undefined, 'FAST');
    });

    return pdf;
  };

  const openPrintConfigurator = async (recipe, mode) => {
    const payload = getPrintPayload(recipe, mode);
    const loadingTitle = mode === 'nutrition'
      ? 'Generando imagen de tabla nutricional...'
      : 'Generando imagen de etiquetado frontal...';

    openIosSwal({
      title: loadingTitle,
      html: `
        <div class="recipe-print-loading">
          <p>Estamos preparando la base de impresión.</p>
          <img src="./IMG/Meta-ai-logo.webp" alt="Procesando" class="meta-spinner-login recipe-print-loader">
        </div>
      `,
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false,
      customClass: {
        htmlContainer: 'recipe-print-loading-container'
      }
    });

    let sourceImage;
    try {
      sourceImage = await renderHtmlToImage(payload);
    } finally {
      Swal.close();
    }

    const sourceCanvasImage = await loadCanvasImage(sourceImage.dataUrl);

    const result = await openIosSwal({
      title: `Impresión · ${mode === 'nutrition' ? 'Tabla nutricional' : 'Etiquetado frontal'}`,
      width: 820,
      customClass: {
        popup: 'recipe-print-alert',
        denyButton: 'ios-btn ios-btn-success'
      },
      html: `
        <div class="recipe-print-panel">
          <div class="recipe-print-controls">
            <label class="recipe-print-field">
              <span>Tipo de hoja</span>
              <select id="printSheetType" class="form-select ios-input">
                <option value="zebra">Zebra 10x15</option>
                <option value="a4">A4</option>
              </select>
            </label>
            <label class="recipe-print-field">
              <span>Cantidad por hoja</span>
              <input id="printPerSheet" type="number" min="1" step="1" value="${mode === 'front' ? 6 : 1}" class="form-control ios-input">
            </label>
            <label class="recipe-print-field">
              <span>Cantidad de hojas</span>
              <input id="printSheetCount" type="number" min="1" step="1" value="1" class="form-control ios-input">
            </label>
          </div>
          <div class="recipe-print-meta" id="printLayoutMeta"></div>
          <div class="recipe-print-preview-wrap">
            <canvas id="printPreviewCanvas" class="recipe-print-preview-canvas" width="420" height="590"></canvas>
          </div>
        </div>
      `,
      showCancelButton: true,
      cancelButtonText: 'Cerrar',
      showDenyButton: true,
      denyButtonText: 'Descargar',
      confirmButtonText: 'Imprimir',
      didOpen: (popup) => {
        const panel = popup.querySelector('.recipe-print-panel');
        const sheetTypeNode = panel.querySelector('#printSheetType');
        const perSheetNode = panel.querySelector('#printPerSheet');
        const sheetCountNode = panel.querySelector('#printSheetCount');
        const canvas = panel.querySelector('#printPreviewCanvas');
        const meta = panel.querySelector('#printLayoutMeta');

        const defaultPerSheet = mode === 'front' ? 6 : 1;

        const panelState = {
          sheet: 'zebra',
          perSheet: defaultPerSheet,
          sheetCount: 1
        };

        const normalizePanel = () => {
          panelState.sheet = sheetTypeNode.value === 'a4' ? 'a4' : 'zebra';
          const max = panelState.sheet === 'zebra' ? (mode === 'front' ? 6 : 4) : Number.MAX_SAFE_INTEGER;
          panelState.perSheet = Math.min(max, Math.max(1, Math.floor(Number(perSheetNode.value) || 1)));
          panelState.sheetCount = Math.max(1, Math.floor(Number(sheetCountNode.value) || 1));

          if (panelState.sheet === 'zebra') {
            perSheetNode.max = mode === 'front' ? '6' : '4';
          } else {
            perSheetNode.removeAttribute('max');
          }

          perSheetNode.value = String(panelState.perSheet);
          sheetCountNode.value = String(panelState.sheetCount);
          panel.dataset.sheet = panelState.sheet;
          panel.dataset.perSheet = String(panelState.perSheet);
          panel.dataset.sheetCount = String(panelState.sheetCount);
        };

        const drawPreview = async () => {
          const composed = buildSheetCanvas({
            imageElement: sourceCanvasImage,
            sheet: panelState.sheet,
            perSheet: panelState.perSheet,
            mode
          });

          canvas.width = composed.width;
          canvas.height = composed.height;
          const context = canvas.getContext('2d');
          context.clearRect(0, 0, canvas.width, canvas.height);
          context.drawImage(composed, 0, 0);

          const { rows, cols } = getGridConfig(panelState.sheet, panelState.perSheet);
          const size = getPrintSheetConfig(panelState.sheet);
          meta.innerHTML = `
            <strong>${escapeHtml(payload.title)}</strong>
            <span>Formato: ${size.label}</span>
            <span>Disposición: ${rows} fila(s) × ${cols} columna(s)</span>
            <span>Cantidad por hoja: ${panelState.perSheet}</span>
            <span>Cantidad de hojas: ${panelState.sheetCount}</span>
          `;
        };

        sheetTypeNode.addEventListener('change', () => {
          perSheetNode.value = sheetTypeNode.value === 'a4' ? (mode === 'front' ? '12' : '4') : (mode === 'front' ? '6' : '1');
          normalizePanel();
          drawPreview().catch(() => {});
        });
        perSheetNode.addEventListener('input', () => {
          normalizePanel();
          drawPreview().catch(() => {});
        });
        sheetCountNode.addEventListener('input', () => {
          normalizePanel();
          drawPreview().catch(() => {});
        });

        normalizePanel();
        drawPreview().catch(() => {});
      },
      preConfirm: () => {
        const panel = Swal.getPopup().querySelector('.recipe-print-panel');
        return {
          action: 'print',
          sheet: panel.dataset.sheet,
          perSheet: Number(panel.dataset.perSheet),
          sheetCount: Number(panel.dataset.sheetCount)
        };
      },
      preDeny: () => {
        const panel = Swal.getPopup().querySelector('.recipe-print-panel');
        return {
          action: 'download',
          sheet: panel.dataset.sheet,
          perSheet: Number(panel.dataset.perSheet),
          sheetCount: Number(panel.dataset.sheetCount)
        };
      }
    });

    if (!result.isConfirmed && !result.isDenied) return;

    const config = result.value || {};
    const canvases = Array.from({ length: Math.max(1, config.sheetCount || 1) }, () => buildSheetCanvas({
      imageElement: sourceCanvasImage,
      sheet: config.sheet,
      perSheet: config.perSheet,
      mode
    }));

    const pdf = buildPdfFromCanvases(canvases, config.sheet);
    const safeName = `${normalizeLower(payload.title).replace(/[^a-z0-9]+/g, '-') || 'receta'}-${mode}-${config.sheet}`;

    if (config.action === 'download') {
      pdf.save(`${safeName}.pdf`);
      window.laJamoneraNotify?.show({ type: 'success', title: 'Descarga lista', message: 'Se descargó el PDF de impresión.' });
      return;
    }

    const pdfBlob = pdf.output('blob');
    const pdfUrl = URL.createObjectURL(pdfBlob);
    const printWindow = window.open(pdfUrl, '_blank');
    if (!printWindow) {
      URL.revokeObjectURL(pdfUrl);
      window.laJamoneraNotify?.show({ type: 'error', title: 'Bloqueado', message: 'Permití ventanas emergentes para imprimir.' });
      return;
    }

    const releaseUrl = () => setTimeout(() => URL.revokeObjectURL(pdfUrl), 60000);
    printWindow.addEventListener('load', () => {
      setTimeout(() => {
        try { printWindow.focus(); printWindow.print(); } catch (e) {}
        releaseUrl();
      }, 600);
    }, { once: true });
  };

  const getSmallPlaceholder = (icon = 'fa-solid fa-bowl-food') => `<span class="recipe-small-placeholder"><i class="${icon}"></i></span>`;
  const buildImageStepHtml = (prefix, initialImage, stepNumber = 4) => `
    <section class="step-block recipe-step-card">
      <h6 class="step-title"><span class="recipe-step-number">${stepNumber}</span> Imagen</h6>
      <div class="step-content">
        <div class="image-method-buttons" id="${prefix}_methodButtons">
          <button type="button" class="btn image-method-btn" data-image-method="url"><i class="fa-solid fa-link"></i>Link</button>
          <button type="button" class="btn image-method-btn" data-image-method="upload"><i class="fa-solid fa-upload"></i>Subir</button>
          <button type="button" class="btn image-method-btn is-active" data-image-method="ai"><img src="${IA_ICON_SRC}" alt="" aria-hidden="true"> IA</button>
        </div>
        <input type="hidden" id="${prefix}_method" value="ai">

        <div id="${prefix}_preview" class="image-preview-circle">${initialImage ? `<img src="${initialImage}" alt="Vista previa">` : getPlaceholderCircle()}</div>

        <div id="${prefix}_urlWrap" class="image-field-block">
          <label for="${prefix}_imageUrl">Link de imagen</label>
          <input id="${prefix}_imageUrl" class="form-control ios-input" placeholder="https://..." value="${initialImage || ''}">
        </div>

        <div id="${prefix}_uploadWrap" class="d-none image-field-block">
          <label for="${prefix}_imageFile">Subir imagen</label>
          <input id="${prefix}_imageFile" type="file" class="form-control image-file-input" accept="image/*">
        </div>

        <div id="${prefix}_aiWrap" class="d-none image-field-block">
          <label for="${prefix}_aiPrompt">Prompt corto para IA</label>
          <input id="${prefix}_aiPrompt" class="form-control ios-input recipe-ai-input" placeholder="Ej: carne de cerdo">
          <button id="${prefix}_aiGenerate" type="button" class="ai-generate-btn mt-2">
            <img src="${IA_ICON_SRC}" alt="" aria-hidden="true">
            <span>Generar imagen con IA</span>
          </button>
          <div id="${prefix}_aiError" class="ai-alert-note d-none mt-2"></div>
        </div>
      </div>
    </section>`;

  const wireImageStep = (prefix, stateImage) => {
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

    const setPreview = (url) => { if (preview) preview.innerHTML = url ? `<img src="${url}" alt="Vista previa">` : getPlaceholderCircle(); };
    const toggleMethod = (method) => {
      methodInput.value = method;
      methodButtons.forEach((button) => button.classList.toggle('is-active', button.dataset.imageMethod === method));
      urlWrap.classList.toggle('d-none', method !== 'url');
      uploadWrap.classList.toggle('d-none', method !== 'upload');
      aiWrap.classList.toggle('d-none', method !== 'ai');
      aiError.classList.add('d-none');
      if (method === 'ai' && !stateImage.generatedFile && !normalizeValue(imageUrlInput.value)) setPreview('');
    };

    methodButtons.forEach((button) => button.addEventListener('click', () => toggleMethod(button.dataset.imageMethod)));
    toggleMethod(normalizeValue(imageUrlInput.value) ? 'url' : (stateImage.method || 'ai'));

    imageUrlInput.addEventListener('input', () => { stateImage.url = imageUrlInput.value; if (methodInput.value === 'url') setPreview(normalizeValue(imageUrlInput.value)); });
    imageFileInput.addEventListener('change', () => {
      const file = imageFileInput.files?.[0];
      const msg = validateImageFile(file);
      if (msg) {
        aiError.textContent = `Archivo no admitido: ${msg}`;
        aiError.classList.remove('d-none');
        imageFileInput.value = '';
        setPreview('');
        stateImage.file = null;
        return;
      }
      stateImage.file = file;
      aiError.classList.add('d-none');
      setPreview(URL.createObjectURL(file));
      stateImage.generatedFile = null;
    });

    aiGenerateBtn.addEventListener('click', async () => {
      const prompt = normalizeValue(aiPromptInput.value);
      if (!prompt) {
        aiError.textContent = 'Ingresá un prompt para generar la imagen.';
        aiError.classList.remove('d-none');
        return;
      }
      aiGenerateBtn.disabled = true;
      aiError.classList.add('d-none');
      preview.innerHTML = `<span class="image-preview-overlay"><img src="${IA_ICON_SRC}" alt="Generando"></span>`;
      try {
        const file = await generateImageWithIA(prompt);
        stateImage.generatedFile = file;
        stateImage.prompt = prompt;
        setPreview(URL.createObjectURL(file));
      } catch (error) {
        aiError.textContent = error.message || 'No se pudo generar la imagen con IA.';
        aiError.classList.remove('d-none');
      } finally {
        aiGenerateBtn.disabled = false;
      }
    });

    aiPromptInput.addEventListener('input', () => { stateImage.prompt = aiPromptInput.value; });
  };

  const getIngredientRows = () => state.editor.rows.filter((row) => row.type === 'ingredient');

  const getUnitDimension = (unit) => {
    const value = normalizeLower(unit);
    if (['kg', 'kilo', 'kilos', 'kilogramo', 'kilogramos', 'g', 'gr', 'gramo', 'gramos', 'mg', 'miligramo', 'miligramos'].includes(value)) return 'mass';
    if (['l', 'lt', 'litro', 'litros', 'ml', 'mililitro', 'mililitros', 'cc'].includes(value)) return 'volume';
    return 'other';
  };

  const toComparableQuantity = (quantityRaw, unitRaw) => {
    const quantity = Number(String(quantityRaw || '').replace(',', '.'));
    if (!Number.isFinite(quantity)) return Number.NaN;
    const unit = normalizeLower(unitRaw);
    const map = {
      kg: 1000,
      kilo: 1000,
      kilos: 1000,
      kilogramo: 1000,
      kilogramos: 1000,
      g: 1,
      gr: 1,
      gramo: 1,
      gramos: 1,
      mg: 0.001,
      miligramo: 0.001,
      miligramos: 0.001,
      l: 1000,
      lt: 1000,
      litro: 1000,
      litros: 1000,
      ml: 1,
      mililitro: 1,
      mililitros: 1,
      cc: 1
    };
    const factor = map[unit] ?? 1;
    return quantity * factor;
  };

  const ensureMonographyAtEnd = () => {
    if (!state.editor?.rows?.length) return;
    const monoRows = state.editor.rows.filter((row) => row.type === MONOGRAPHY_ROW_TYPE);
    const withoutMono = state.editor.rows.filter((row) => row.type !== MONOGRAPHY_ROW_TYPE);
    if (!monoRows.length) {
      state.editor.rows = withoutMono;
      return;
    }
    const kept = monoRows[monoRows.length - 1];
    state.editor.rows = [...withoutMono, kept];
  };

  const pushRowBeforeMonography = (row) => {
    const index = state.editor.rows.findIndex((item) => item.type === MONOGRAPHY_ROW_TYPE);
    if (index === -1) {
      state.editor.rows.push(row);
      return;
    }
    state.editor.rows.splice(index, 0, row);
  };

  const ensureIngredientRow = () => {
    if (!getIngredientRows().length) {
      pushRowBeforeMonography({ id: makeId('row'), type: 'ingredient', ingredientId: '', ingredientName: '', quantity: '', unit: getMeasureOptions()[0]?.value || '' });
    }
  };

  const getHouseholdMeasureOptionsHtml = (selected = '', amount = 1) => {
    const selectedNorm = normalizeLower(selected);
    const qty = Number(String(amount || '1').replace(',', '.'));
    const singular = Number.isFinite(qty) && qty <= 1;
    return HOUSEHOLD_MEASURES.map((item) => `<option value="${item.value}" ${selectedNorm === item.value ? 'selected' : ''}>${singular ? item.singular : item.plural}</option>`).join('');
  };

  const getCategoryOptionsHtml = (selected = '') => {
    const selectedNorm = normalizeLower(selected);
    return Object.keys(FOOD_CATEGORIES_AR).map((key) => `<option value="${key}" ${selectedNorm === key ? 'selected' : ''}>${capitalize(key.replaceAll('-', ' '))}</option>`).join('');
  };

  const getSubcategoryOptionsHtml = (category = '', selected = '') => {
    const categoryKey = normalizeLower(category);
    const selectedNorm = normalizeLower(selected);
    const list = FOOD_CATEGORIES_AR[categoryKey] || [];
    return list.length
      ? list.map((item) => {
        const value = normalizeLower(item);
        return `<option value="${value}" ${value === selectedNorm ? 'selected' : ''}>${item}</option>`;
      }).join('')
      : '<option value="">Seleccioná una categoría primero</option>';
  };

  const renderNutritionSubcategories = (selected = '') => {
    const categorySelect = recipeEditorForm.querySelector('#recipeNutritionCategory');
    const subcategorySelect = recipeEditorForm.querySelector('#recipeNutritionSubcategory');
    if (!categorySelect || !subcategorySelect) return;
    const nextValue = normalizeLower(selected || state.editor?.nutrition?.subcategory || '');
    subcategorySelect.innerHTML = getSubcategoryOptionsHtml(categorySelect.value, nextValue);
    if (nextValue) {
      subcategorySelect.value = nextValue;
    }
  };

  const renderHouseholdMeasureOptions = () => {
    const measureSelect = recipeEditorForm.querySelector('#recipeNutritionHouseholdMeasure');
    const amountInput = recipeEditorForm.querySelector('#recipeNutritionHouseholdAmount');
    if (!measureSelect || !amountInput) return;
    const currentValue = normalizeLower(measureSelect.value || state.editor?.nutrition?.householdMeasure || 'unidad');
    const amount = amountInput.value || '1';
    measureSelect.innerHTML = getHouseholdMeasureOptionsHtml(currentValue, amount);
    measureSelect.value = currentValue;
  };

  const sortRowsByOrderMode = (rows, orderMode) => {
    const mode = normalizeLower(orderMode);
    if (mode === 'custom') {
      const nonMonography = rows.filter((row) => row.type !== MONOGRAPHY_ROW_TYPE);
      const monography = rows.filter((row) => row.type === MONOGRAPHY_ROW_TYPE);
      return [...nonMonography, ...monography];
    }

    const ingredients = rows.filter((row) => row.type === 'ingredient').map((row, index) => {
      const dimension = getUnitDimension(row.unit);
      const comparable = toComparableQuantity(row.quantity, row.unit);
      return { row, index, dimension, comparable, hasNumeric: Number.isFinite(comparable) };
    });

    const comments = rows.filter((row) => row.type === 'comment');
    const monography = rows.filter((row) => row.type === MONOGRAPHY_ROW_TYPE);

    const dimensionRank = { mass: 0, volume: 1, other: 2 };
    const direction = mode === 'asc' ? 1 : -1;

    ingredients.sort((a, b) => {
      const dimDiff = (dimensionRank[a.dimension] ?? 9) - (dimensionRank[b.dimension] ?? 9);
      if (dimDiff !== 0) return dimDiff;
      if (a.hasNumeric && b.hasNumeric && a.comparable !== b.comparable) {
        return (a.comparable - b.comparable) * direction;
      }
      if (a.hasNumeric !== b.hasNumeric) {
        return a.hasNumeric ? -1 : 1;
      }
      return a.index - b.index;
    });

    return [...ingredients.map((item) => item.row), ...comments, ...monography];
  };


  const getNutritionGenerationSnapshot = () => {
    const title = normalizeValue(recipeEditorForm.querySelector('#recipeTitle')?.value || state.editor?.title || '');
    const description = normalizeValue(recipeEditorForm.querySelector('#recipeDescription')?.value || state.editor?.description || '');
    const declarationUnit = normalizeLower(recipeEditorForm.querySelector('#recipeNutritionDeclarationUnit')?.value || state.editor?.nutrition?.declarationUnit || '');
    const declarationAmount = normalizeValue(recipeEditorForm.querySelector('#recipeNutritionDeclarationAmount')?.value || state.editor?.nutrition?.declarationAmount || '');
    const servingsPerPackage = normalizeValue(recipeEditorForm.querySelector('#recipeNutritionServingsPerPackage')?.value || state.editor?.nutrition?.servingsPerPackage || '');
    const productType = normalizeLower(recipeEditorForm.querySelector('#recipeNutritionProductType')?.value || state.editor?.nutrition?.productType || '');
    const category = normalizeLower(recipeEditorForm.querySelector('#recipeNutritionCategory')?.value || state.editor?.nutrition?.category || '');
    const subcategory = normalizeLower(recipeEditorForm.querySelector('#recipeNutritionSubcategory')?.value || state.editor?.nutrition?.subcategory || '');
    const householdMeasure = normalizeLower(recipeEditorForm.querySelector('#recipeNutritionHouseholdMeasure')?.value || state.editor?.nutrition?.householdMeasure || '');
    const householdAmount = normalizeValue(recipeEditorForm.querySelector('#recipeNutritionHouseholdAmount')?.value || state.editor?.nutrition?.householdAmount || '');

    const ingredients = (state.editor?.rows || [])
      .filter((row) => row.type === 'ingredient' && normalizeValue(row.ingredientName))
      .map((row) => ({
        ingredientName: normalizeValue(row.ingredientName),
        quantity: normalizeValue(row.quantity),
        unit: normalizeLower(row.unit)
      }));

    return {
      title,
      description,
      ingredients,
      nutrition: {
        productType,
        category,
        subcategory,
        declarationUnit,
        declarationAmount,
        servingsPerPackage,
        householdMeasure,
        householdAmount
      }
    };
  };

  const getNutritionGenerationHash = () => JSON.stringify(getNutritionGenerationSnapshot());

  const hasNutritionFieldsForAI = () => {
    const snapshot = getNutritionGenerationSnapshot();
    const n = snapshot.nutrition || {};
    return Boolean(
      snapshot.title &&
      snapshot.description &&
      snapshot.ingredients.length &&
      n.productType &&
      n.category &&
      n.subcategory &&
      n.declarationUnit &&
      n.declarationAmount &&
      n.householdMeasure &&
      n.householdAmount &&
      n.servingsPerPackage
    );
  };

  const buildFrontLabelsHtml = (labels = [], options = {}) => {
    const clean = Array.isArray(labels)
      ? labels.map((item) => normalizeValue(item).toUpperCase()).filter((item) => FRONT_LABELS_ALLOWED.includes(item))
      : [];
    if (!clean.length) return '<p class="recipe-nutrition-front-empty">Sin sellos de advertencia.</p>';
    const unique = Array.from(new Set(clean));
    const compact = options.compact ? ' is-compact' : '';
    const octagons = unique.filter((item) => FRONT_LABEL_CONFIG[item]?.type === 'octagon');
    const rectangles = unique.filter((item) => FRONT_LABEL_CONFIG[item]?.type === 'rectangle');

    return `
      <div class="recipe-octagons-wrap${compact}">
        ${octagons.map((item) => {
          const config = FRONT_LABEL_CONFIG[item] || { text: item };
          return `<span class="recipe-octagon"><span class="recipe-octagon-title">${escapeHtml(config.text).replaceAll('\n', '<br>')}</span><span class="recipe-octagon-ministry">Ministerio<br>de Salud</span></span>`;
        }).join('')}
      </div>
      ${rectangles.length ? `<div class="recipe-front-rectangles${compact}">${rectangles.map((item) => {
        const config = FRONT_LABEL_CONFIG[item] || { text: item };
        return `<span class="recipe-front-rectangle"><span class="recipe-front-rectangle-title">${escapeHtml(config.text).replaceAll('\n', '<br>')}</span><span class="recipe-octagon-ministry">Ministerio<br>de Salud</span></span>`;
      }).join('')}</div>` : ''}
    `;
  };

  const isNutritionAiStale = () => {
    const ai = state.editor?.nutrition?.ai;
    if (!ai?.tableHtml) return false;
    return Boolean(ai.inputHash && ai.inputHash !== getNutritionGenerationHash());
  };

  const syncSaveButtonWithNutritionState = () => {
    const submitButton = recipeEditorForm.querySelector('.recipe-editor-actions button[type="submit"]');
    if (!submitButton) return;
    const stale = isNutritionAiStale();
    submitButton.toggleAttribute('disabled', stale);
    submitButton.title = stale ? 'Rehacé la tabla nutricional para poder guardar.' : '';
  };

  const parseAiJsonFromText = (text) => {
    const raw = String(text || '').trim();
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (error) {
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) return null;
      try {
        return JSON.parse(match[0]);
      } catch (nestedError) {
        return null;
      }
    }
  };

  const parseNumber = (value, fallback = 0) => {
    const parsed = Number(String(value ?? '').replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const formatSmart = (value, decimals = 1) => {
    const num = parseNumber(value, 0);
    return Number.isInteger(num) ? String(num) : num.toFixed(decimals).replace('.', ',');
  };

  const normalizeFrontLabels = (labels = [], nutrients = {}) => {
    const fromAi = Array.isArray(labels)
      ? labels.map((item) => normalizeValue(item).toUpperCase()).filter((item) => FRONT_LABELS_ALLOWED.includes(item))
      : [];
    if (fromAi.length) return Array.from(new Set(fromAi));

    const inferred = [];
    if (parseNumber(nutrients.sodioMg, 0) >= 400) inferred.push('EXCESO EN SODIO');
    if (parseNumber(nutrients.azucaresG, 0) >= 10) inferred.push('EXCESO EN AZÚCARES');
    if (parseNumber(nutrients.grasasSaturadasG, 0) >= 4) inferred.push('EXCESO EN GRASAS SATURADAS');
    if (parseNumber(nutrients.grasasTotalesG, 0) >= 15) inferred.push('EXCESO EN GRASAS TOTALES');
    if (parseNumber(nutrients.caloriasKcal, 0) >= 275) inferred.push('EXCESO EN CALORÍAS');
    return inferred;
  };

  const buildNutritionTableHtmlFromData = (aiData, snapshot) => {
    const n = safeObject(aiData?.nutrients);
    const vitamins = safeObject(aiData?.vitamins);
    const servingUnit = snapshot?.nutrition?.declarationUnit || 'g';
    const servingAmount = snapshot?.nutrition?.declarationAmount || '100';
    const servings = snapshot?.nutrition?.servingsPerPackage || '1';

    return `
      <div class="recipe-nutrition-label-card">
        <h3>INFORMACIÓN NUTRICIONAL</h3>
        <p class="recipe-nutrition-product-name">${escapeHtml(snapshot?.title || 'Producto')}</p>
        <p class="recipe-nutrition-serving">Tamaño de la porción ${escapeHtml(formatSmart(servingAmount, 2))}${escapeHtml(servingUnit)} · ${escapeHtml(formatSmart(servings, 2))} porciones por envase</p>
        <div class="recipe-nutrition-bar"></div>
        <p class="recipe-nutrition-subtitle">Cantidad por porción</p>
        <div class="recipe-nutrition-two-cols"><span>Calorías ${escapeHtml(formatSmart(n.caloriasKcal, 0))}</span><span>Calorías de grasa ${escapeHtml(formatSmart(n.caloriasGrasaKcal, 0))}</span></div>
        <div class="recipe-nutrition-rule"></div>
        <p class="recipe-nutrition-dv">% Valor Diario</p>
        <table class="recipe-nutrition-table-fixed">
          <tr><td>Grasa total ${escapeHtml(formatSmart(n.grasasTotalesG, 1))}g</td><td>${escapeHtml(formatSmart(n.grasasTotalesDv, 0))}%</td></tr>
          <tr><td class="indent">Grasa saturada ${escapeHtml(formatSmart(n.grasasSaturadasG, 1))}g</td><td>${escapeHtml(formatSmart(n.grasasSaturadasDv, 0))}%</td></tr>
          <tr><td class="indent">Grasas trans ${escapeHtml(formatSmart(n.grasasTransG, 1))}g</td><td>-</td></tr>
          <tr><td>Colesterol ${escapeHtml(formatSmart(n.colesterolMg, 0))}mg</td><td>${escapeHtml(formatSmart(n.colesterolDv, 0))}%</td></tr>
          <tr><td>Sodio ${escapeHtml(formatSmart(n.sodioMg, 0))}mg</td><td>${escapeHtml(formatSmart(n.sodioDv, 0))}%</td></tr>
          <tr><td>Carbohidratos totales ${escapeHtml(formatSmart(n.carbohidratosG, 1))}g</td><td>${escapeHtml(formatSmart(n.carbohidratosDv, 0))}%</td></tr>
          <tr><td class="indent">Fibra dietética ${escapeHtml(formatSmart(n.fibraG, 1))}g</td><td>${escapeHtml(formatSmart(n.fibraDv, 0))}%</td></tr>
          <tr><td class="indent">Azúcares ${escapeHtml(formatSmart(n.azucaresG, 1))}g</td><td>-</td></tr>
          <tr><td>Proteínas ${escapeHtml(formatSmart(n.proteinasG, 1))}g</td><td>-</td></tr>
        </table>
        <div class="recipe-nutrition-bar"></div>
        <p class="recipe-nutrition-micros">Vitamina A ${escapeHtml(formatSmart(vitamins.vitaminaA, 0))}% • Vitamina C ${escapeHtml(formatSmart(vitamins.vitaminaC, 0))}%<br>Calcio ${escapeHtml(formatSmart(vitamins.calcio, 0))}% • Hierro ${escapeHtml(formatSmart(vitamins.hierro, 0))}%</p>
        <p class="recipe-nutrition-footnote">(*) Valores diarios con base a una dieta de 2000 kcal u 8400 kJ. Sus valores diarios pueden ser mayores o menores dependiendo de sus necesidades energéticas.<br>Ingredientes: ${escapeHtml(snapshot.ingredients.map((item) => item.ingredientName).join(', '))}</p>
      </div>
    `;
  };

  const renderNutritionAiPreview = () => {
    const wrapper = recipeEditorForm.querySelector('#recipeNutritionAiPreview');
    const staleFlag = recipeEditorForm.querySelector('#recipeNutritionAiStale');
    const button = recipeEditorForm.querySelector('#generateNutritionAiBtn');
    if (!wrapper || !button) return;

    const canGenerate = hasNutritionFieldsForAI();
    button.toggleAttribute('disabled', !canGenerate);

    const ai = state.editor?.nutrition?.ai;
    if (!ai?.tableHtml) {
      wrapper.innerHTML = '<p class="recipe-nutrition-ai-empty">Completá los datos y generá la tabla nutricional con IA.</p>';
      staleFlag?.classList.add('d-none');
      button.querySelector('.js-generate-label').textContent = 'Generar tabla nutricional con IA';
      wrapper.classList.remove('is-stale', 'is-disabled');
      syncSaveButtonWithNutritionState();
      return;
    }

    const stale = isNutritionAiStale();
    staleFlag?.classList.toggle('d-none', !stale);
    staleFlag.textContent = stale ? 'Se modificaron los datos base. Rehacé la tabla nutricional para continuar.' : '';
    button.querySelector('.js-generate-label').textContent = stale ? 'Rehacer tabla nutricional con IA' : 'Regenerar tabla nutricional con IA';
    wrapper.classList.toggle('is-stale', stale);
    wrapper.classList.toggle('is-disabled', stale);

    wrapper.innerHTML = `
      <div class="recipe-nutrition-product-meta">
        <p>${escapeHtml(normalizeValue(recipeEditorForm.querySelector('#recipeDescription')?.value || ''))}</p>
      </div>
      <div id="recipeNutritionAiTableEditable" class="recipe-nutrition-ai-table ${stale ? 'is-locked' : ''}" contenteditable="${stale ? 'false' : 'true'}">${ai.tableHtml}</div>
      <p class="recipe-nutrition-ai-help">Podés editar manualmente la tabla nutricional si querés ajustar el diseño o valores.</p>
      <div class="recipe-nutrition-front-labels">
        <h6>Etiquetado frontal (Argentina)</h6>
        ${buildFrontLabelsHtml(ai.frontLabels)}
      </div>
    `;
    syncSaveButtonWithNutritionState();
  };

  const markNutritionAiAsStaleIfNeeded = () => {
    renderNutritionAiPreview();
  };

  const callDeepseekWithFallback = async (payload, apiKey, corsConfig) => {
    const direct = async () => fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(payload)
    });

    const proxyUrl = normalizeValue(corsConfig?.url || corsConfig?.url_corsh || '');
    const proxyKey = normalizeValue(corsConfig?.key || corsConfig?.cosh_api_key || '');

    try {
      const res = await direct();
      if (res.ok) return res;
      const txt = await res.text();
      throw new Error(`DeepSeek ${res.status}: ${txt}`);
    } catch (error) {
      if (!proxyUrl) throw error;
      const endpoint = `${proxyUrl}${proxyUrl.endsWith('/') ? '' : '/'}https://api.deepseek.com/chat/completions`;
      const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
      if (proxyKey) headers['x-cors-api-key'] = proxyKey;
      const proxyRes = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(payload) });
      if (!proxyRes.ok) {
        const txt = await proxyRes.text();
        throw new Error(`CORS proxy ${proxyRes.status}: ${txt}`);
      }
      return proxyRes;
    }
  };

  const generateNutritionTableWithIA = async () => {
    if (!hasNutritionFieldsForAI()) {
      await openIosSwal({ title: 'Faltan datos', html: '<p>Completá todos los campos nutricionales y datos base de receta para generar la tabla.</p>', icon: 'warning', confirmButtonText: 'Entendido' });
      return;
    }

    Swal.fire({
      title: 'Generando tabla nutricional...',
      html: '<div class="informes-saving-spinner"><img src="./IMG/ia-unscreen.gif" alt="Generando" class="recipe-ai-static-gif"></div>',
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false,
      customClass: { popup: 'ios-alert ingredientes-alert', title: 'ios-alert-title', htmlContainer: 'ios-alert-text' }
    });

    try {
      await window.laJamoneraReady;
      const keyNode = await window.dbLaJamoneraRest.read('/deepseek/apiKey');
      const apiKey = typeof keyNode === 'string' ? normalizeValue(keyNode) : normalizeValue(keyNode?.apiKey);
      if (!apiKey) throw new Error('No se encontró /deepseek/apiKey en Firebase.');

      const corsConfigNode = await window.dbLaJamoneraRest.read('/deepseek');
      const corsConfig = {
        cosh_api_key: normalizeValue(corsConfigNode?.cosh_api_key),
        url_corsh: normalizeValue(corsConfigNode?.url_corsh)
      };

      const snapshot = getNutritionGenerationSnapshot();
      const payload = {
        model: 'deepseek-chat',
        messages: [
          {
            role: 'system',
            content: 'Sos nutricionista especializado en etiquetado argentino. Respondé SOLO JSON válido.'
          },
          {
            role: 'user',
            content: `Calculá información nutricional por porción para este producto y devolvé SOLO JSON con esta estructura exacta: {"nutrients":{"caloriasKcal":0,"caloriasGrasaKcal":0,"grasasTotalesG":0,"grasasTotalesDv":0,"grasasSaturadasG":0,"grasasSaturadasDv":0,"grasasTransG":0,"colesterolMg":0,"colesterolDv":0,"sodioMg":0,"sodioDv":0,"carbohidratosG":0,"carbohidratosDv":0,"fibraG":0,"fibraDv":0,"azucaresG":0,"proteinasG":0},"vitamins":{"vitaminaA":0,"vitaminaC":0,"calcio":0,"hierro":0},"frontLabels":[]}. No uses null ni strings vacíos para nutrientes; siempre números. Etiquetas frontales solo de esta lista: ${FRONT_LABELS_ALLOWED.join(', ')}. Datos base: ${JSON.stringify(snapshot)}`
          }
        ],
        temperature: 0.1
      };

      const response = await callDeepseekWithFallback(payload, apiKey, corsConfig);
      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content || '';
      const parsed = parseAiJsonFromText(content);
      if (!parsed?.nutrients) {
        throw new Error('La IA no devolvió nutrientes en formato válido.');
      }

      const normalizedFront = normalizeFrontLabels(parsed.frontLabels, parsed.nutrients);
      const tableHtml = buildNutritionTableHtmlFromData(parsed, snapshot);

      state.editor.nutrition = state.editor.nutrition || {};
      state.editor.nutrition.ai = {
        tableHtml,
        raw: parsed,
        frontLabels: normalizedFront,
        inputHash: getNutritionGenerationHash(),
        updatedAt: Date.now()
      };
      markEditorDirty();
      renderNutritionAiPreview();
    } catch (error) {
      await openIosSwal({ title: 'No se pudo generar', html: `<p>${escapeHtml(error.message || 'Error generando tabla nutricional.')}</p>`, icon: 'error', confirmButtonText: 'Entendido' });
    } finally {
      Swal.close();
    }
  };

  const clearSuggestions = () => {
    document.querySelectorAll('.recipe-suggest-floating').forEach((node) => node.remove());
    state.editor && (state.editor.activeSuggestRowId = '');
  };

  const findIngredientInputByRowId = (rowId) => recipeEditorForm.querySelector(`[data-ing-input="${rowId}"]`);

  const positionSuggestionDropdown = (dropdown, input) => {
    if (!dropdown || !input) return;
    const inputRect = input.getBoundingClientRect();
    dropdown.style.position = 'fixed';
    dropdown.style.top = `${inputRect.bottom + 6}px`;
    dropdown.style.left = `${inputRect.left}px`;
    dropdown.style.width = `${Math.max(inputRect.width, 220)}px`;
  };

  const repositionActiveSuggestions = () => {
    if (!state.editor?.activeSuggestRowId) return;
    const dropdown = document.querySelector('.recipe-suggest-floating');
    const input = findIngredientInputByRowId(state.editor.activeSuggestRowId);
    if (!dropdown || !input) {
      clearSuggestions();
      return;
    }
    positionSuggestionDropdown(dropdown, input);
  };

  const snapshotEditorDraft = () => {
    if (state.view !== 'editor' || !state.editor) return;
    state.resumeEditor = {
      activeRecipeId: state.activeRecipeId,
      data: JSON.parse(JSON.stringify(state.editor)),
      title: recipeEditorTitle.textContent
    };
  };

  const ingredientAvatarHtml = (ingredient) => ingredient?.imageUrl
    ? `<span class="recipe-inline-avatar-wrap"><span class="thumb-loading"><img class="meta-spinner-login" src="./IMG/Meta-ai-logo.webp" alt="Cargando"></span><img class="recipe-inline-avatar js-recipe-inline-thumb" src="${ingredient.imageUrl}" alt="${capitalize(ingredient.name)}" loading="lazy"></span>`
    : `<span class="recipe-inline-avatar-wrap recipe-inline-avatar-fallback">${getSmallPlaceholder('fa-solid fa-bowl-food')}</span>`;

  const prepareInlineThumbLoaders = () => {
    recipeEditorForm.querySelectorAll('.js-recipe-inline-thumb').forEach((image) => {
      const wrapper = image.closest('.recipe-inline-avatar-wrap');
      const loading = wrapper?.querySelector('.thumb-loading');
      const showImage = () => {
        image.classList.add('is-loaded');
        loading?.classList.add('d-none');
      };
      const showFallback = () => {
        if (wrapper) wrapper.innerHTML = getSmallPlaceholder('fa-solid fa-bowl-food');
      };
      if (image.complete && image.naturalWidth > 0) {
        showImage();
      } else {
        image.addEventListener('load', showImage, { once: true });
        image.addEventListener('error', showFallback, { once: true });
      }
    });
  };

  const renderRows = () => {
    const rowsBody = recipeEditorForm.querySelector('#recipeRowsBody');
    if (!rowsBody || !state.editor) return;

    ensureMonographyAtEnd();
    if (state.editor.orderMode !== 'custom') {
      state.editor.rows = sortRowsByOrderMode(state.editor.rows, state.editor.orderMode);
    }

    rowsBody.innerHTML = state.editor.rows.map((row) => {
      if (row.type === 'comment') {
        return `
          <tr class="is-comment" data-row-id="${row.id}" draggable="${state.editor.orderMode === 'custom'}">
            <td><i class="fa-solid fa-grip-lines"></i></td>
            <td colspan="3"><input class="form-control ios-input" data-comment-input="${row.id}" value="${row.comment || ''}" placeholder="Comentario visual (no afecta receta)"></td>
            <td><button type="button" class="btn family-manage-btn" data-remove-row="${row.id}"><i class="fa-solid fa-trash"></i></button></td>
          </tr>`;
      }
      if (row.type === MONOGRAPHY_ROW_TYPE) {
        return `
          <tr class="is-monography" data-row-id="${row.id}" draggable="false">
            <td colspan="4">
              <div class="editor-toolbar report-edit-toolbar recipe-monography-toolbar" role="toolbar" aria-label="Herramientas de monografía">
                <button type="button" class="editor-btn" data-mono-cmd="bold" data-mono-row="${row.id}"><i class="fa-solid fa-bold"></i></button>
                <button type="button" class="editor-btn" data-mono-cmd="italic" data-mono-row="${row.id}"><i class="fa-solid fa-italic"></i></button>
                <button type="button" class="editor-btn" data-mono-cmd="underline" data-mono-row="${row.id}"><i class="fa-solid fa-underline"></i></button>
                <button type="button" class="editor-btn" data-mono-cmd="insertUnorderedList" data-mono-row="${row.id}"><i class="fa-solid fa-list-ul"></i></button>
                <button type="button" class="editor-btn" data-mono-cmd="justifyLeft" data-mono-row="${row.id}"><i class="fa-solid fa-align-left"></i></button>
                <button type="button" class="editor-btn" data-mono-cmd="justifyCenter" data-mono-row="${row.id}"><i class="fa-solid fa-align-center"></i></button>
              </div>
              <div class="recipe-monography-editor informe-editor" data-monography-input="${row.id}" contenteditable="true" data-placeholder="Proceso de fabricación / monografía">${row.html || ''}</div>
            </td>
            <td><button type="button" class="btn family-manage-btn" data-remove-row="${row.id}"><i class="fa-solid fa-trash"></i></button></td>
          </tr>`;
      }
      return `
        <tr data-row-id="${row.id}" draggable="${state.editor.orderMode === 'custom'}">
          <td><i class="fa-solid fa-grip-lines"></i></td>
          <td><div class="recipe-ing-autocomplete"><div class="recipe-ing-input-wrap">${ingredientAvatarHtml(state.ingredientes[row.ingredientId])}<input class="form-control ios-input" data-ing-input="${row.id}" value="${row.ingredientName || ''}" placeholder="Buscar ingrediente..."></div></div></td>
          <td><input class="form-control ios-input" data-qty-input="${row.id}" value="${row.quantity || ''}" placeholder="0,00"></td>
          <td><select class="form-select ios-input" data-unit-input="${row.id}">${getMeasureSelectOptionsHtml(row.unit)}</select></td>
          <td><button type="button" class="btn family-manage-btn" data-remove-row="${row.id}"><i class="fa-solid fa-trash"></i></button></td>
        </tr>`;
    }).join('');
    prepareInlineThumbLoaders();
  };

  const showSuggestions = (input, rowId, query) => {
    clearSuggestions();
    const row = state.editor.rows.find((item) => item.id === rowId);
    if (!row) return;

    const source = getIngredientesArray()
      .filter((item) => normalizeLower(item.name).includes(normalizeLower(query)))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
      .slice(0, 10);

    const dropdown = document.createElement('div');
    dropdown.className = 'recipe-suggest-floating';
    dropdown.innerHTML = `${source.map((item) => `
      <button type="button" class="recipe-suggest-item" data-pick-ingredient="${rowId}" data-ing-id="${item.id}">
        <span class="recipe-suggest-avatar-wrap">${item.imageUrl
          ? `<span class="thumb-loading"><img class="meta-spinner-login" src="./IMG/Meta-ai-logo.webp" alt="Cargando"></span><img class="recipe-suggest-avatar js-recipe-suggest-thumb" src="${item.imageUrl}" alt="${capitalize(item.name)}" loading="lazy">`
          : getSmallPlaceholder('fa-solid fa-bowl-food')}</span>
        <span>${capitalize(item.name)}</span>
      </button>`).join('')}
      <button type="button" class="recipe-suggest-item recipe-suggest-create" data-create-ingredient-inline="${rowId}">
        <i class="fa-solid fa-plus"></i><span>Crear ingrediente</span>
      </button>`;

    document.body.appendChild(dropdown);
    positionSuggestionDropdown(dropdown, input);
    state.editor.activeSuggestRowId = rowId;

    dropdown.querySelectorAll('.js-recipe-suggest-thumb').forEach((image) => {
      const wrapper = image.closest('.recipe-suggest-avatar-wrap');
      const loading = wrapper?.querySelector('.thumb-loading');
      const showImage = () => {
        image.classList.add('is-loaded');
        loading?.classList.add('d-none');
      };
      const showFallback = () => {
        if (wrapper) wrapper.innerHTML = getSmallPlaceholder('fa-solid fa-bowl-food');
      };
      if (image.complete && image.naturalWidth > 0) {
        showImage();
      } else {
        image.addEventListener('load', showImage, { once: true });
        image.addEventListener('error', showFallback, { once: true });
      }
    });
  };

  const bindEditorEvents = () => {
    if (!state.editorEventsBound) {
      recipeEditorForm.addEventListener('click', async (event) => {
        const generateNutritionBtn = event.target.closest('#generateNutritionAiBtn');
        if (generateNutritionBtn) {
          await generateNutritionTableWithIA();
          return;
        }

        const addIngredientBtn = event.target.closest('[data-add-ingredient-row]');
        if (addIngredientBtn) {
          pushRowBeforeMonography({ id: makeId('row'), type: 'ingredient', ingredientId: '', ingredientName: '', quantity: '', unit: getMeasureOptions()[0]?.value || '' });
          markEditorDirty();
          markNutritionAiAsStaleIfNeeded();
          renderRows();
          return;
        }
        const addCommentBtn = event.target.closest('[data-add-comment-row]');
        if (addCommentBtn) {
          pushRowBeforeMonography({ id: makeId('row'), type: 'comment', comment: '' });
          markEditorDirty();
          markNutritionAiAsStaleIfNeeded();
          renderRows();
          return;
        }
        const addMonographyBtn = event.target.closest('[data-add-monography-row]');
        if (addMonographyBtn) {
          const existing = state.editor.rows.find((row) => row.type === MONOGRAPHY_ROW_TYPE);
          if (existing) {
            const editor = recipeEditorForm.querySelector(`[data-monography-input="${existing.id}"]`);
            editor?.focus();
          } else {
            state.editor.rows.push({ id: makeId('row'), type: MONOGRAPHY_ROW_TYPE, html: '' });
            markEditorDirty();
            renderRows();
            const editor = recipeEditorForm.querySelector('[data-monography-input]');
            editor?.focus();
          }
          return;
        }
        const monoCmdBtn = event.target.closest('[data-mono-cmd]');
        if (monoCmdBtn) {
          const rowId = monoCmdBtn.dataset.monoRow;
          const editor = recipeEditorForm.querySelector(`[data-monography-input="${rowId}"]`);
          editor?.focus();
          document.execCommand(monoCmdBtn.dataset.monoCmd, false, null);
          const row = state.editor.rows.find((item) => item.id === rowId);
          if (row) {
            row.html = normalizeValue(editor?.innerHTML || '');
            markEditorDirty();
          }
          return;
        }

        const removeBtn = event.target.closest('[data-remove-row]');
        if (removeBtn) {
          state.editor.rows = state.editor.rows.filter((row) => row.id !== removeBtn.dataset.removeRow);
          ensureIngredientRow();
          markEditorDirty();
          markNutritionAiAsStaleIfNeeded();
          renderRows();
          clearSuggestions();
        }
      });

      recipeEditorForm.addEventListener('input', (event) => {
        const input = event.target;
        if (input.matches('[data-ing-input]')) {
          const row = state.editor.rows.find((item) => item.id === input.dataset.ingInput);
          if (!row) return;
          row.ingredientName = input.value;
          row.ingredientId = '';
          markEditorDirty();
          markNutritionAiAsStaleIfNeeded();
          showSuggestions(input, row.id, input.value);
          return;
        }
        if (input.matches('[data-qty-input]')) {
          const row = state.editor.rows.find((item) => item.id === input.dataset.qtyInput);
          if (row) {
            row.quantity = input.value;
            markEditorDirty();
            markNutritionAiAsStaleIfNeeded();
          }
          return;
        }
        if (input.matches('[data-comment-input]')) {
          const row = state.editor.rows.find((item) => item.id === input.dataset.commentInput);
          if (row) {
            row.comment = input.value;
            markEditorDirty();
          }
          return;
        }
        if (input.matches('[data-monography-input]')) {
          const row = state.editor.rows.find((item) => item.id === input.dataset.monographyInput);
          if (row) {
            row.html = normalizeValue(input.innerHTML);
            markEditorDirty();
          }
          return;
        }
        if (input.id === 'recipeNutritionHouseholdAmount') {
          renderHouseholdMeasureOptions();
          markEditorDirty();
          return;
        }
        if (input.id === 'recipeNutritionAiTableEditable') {
          if (state.editor?.nutrition?.ai) {
            state.editor.nutrition.ai.tableHtml = normalizeValue(input.innerHTML);
            markEditorDirty();
          }
          return;
        }
      });

      recipeEditorForm.addEventListener('change', async (event) => {
        const select = event.target;
        if (select.matches('[data-unit-input]')) {
          const row = state.editor.rows.find((item) => item.id === select.dataset.unitInput);
          if (!row) return;
          if (select.value === NEW_MEASURE_VALUE) {
            const res = await openIosSwal({
              title: 'Nueva medida',
              showCancelButton: true,
              confirmButtonText: 'Guardar medida',
              cancelButtonText: 'Cancelar',
              html: '<div class="swal-stack-fields"><input id="recipeNewMeasureName" class="swal2-input ios-input" placeholder="Nombre (ej: cucharadas)"><input id="recipeNewMeasureAbbr" class="swal2-input ios-input" placeholder="Abreviatura (ej: cdas)"></div>',
              preConfirm: () => {
                const name = normalizeValue(document.getElementById('recipeNewMeasureName')?.value);
                const abbr = normalizeValue(document.getElementById('recipeNewMeasureAbbr')?.value);
                if (!name) {
                  Swal.showValidationMessage('Ingresá un nombre de medida.');
                  return false;
                }
                return { name, abbr };
              }
            });
            if (res.isConfirmed && res.value) {
              row.unit = await persistNewMeasure(res.value.name, res.value.abbr);
              markEditorDirty();
              markNutritionAiAsStaleIfNeeded();
              renderRows();
              const yieldSelect = recipeEditorForm.querySelector('#recipeYieldUnit');
              if (yieldSelect) {
                const current = yieldSelect.value;
                yieldSelect.innerHTML = getMeasureSelectOptionsHtml(current);
              }
            } else {
              select.value = row.unit || '';
            }
            return;
          }
          row.unit = select.value;
          markEditorDirty();
          markNutritionAiAsStaleIfNeeded();
          return;
        }
        if (select.id === 'recipeYieldUnit' && select.value === NEW_MEASURE_VALUE) {
          select.value = '';
          const res = await openIosSwal({
            title: 'Nueva medida',
            showCancelButton: true,
            confirmButtonText: 'Guardar medida',
            cancelButtonText: 'Cancelar',
            html: '<div class="swal-stack-fields"><input id="recipeNewMeasureNameY" class="swal2-input ios-input" placeholder="Nombre (ej: litros)"><input id="recipeNewMeasureAbbrY" class="swal2-input ios-input" placeholder="Abreviatura (ej: l)"></div>',
            preConfirm: () => {
              const name = normalizeValue(document.getElementById('recipeNewMeasureNameY')?.value);
              const abbr = normalizeValue(document.getElementById('recipeNewMeasureAbbrY')?.value);
              if (!name) {
                Swal.showValidationMessage('Ingresá un nombre de medida.');
                return false;
              }
              return { name, abbr };
            }
          });
          if (res.isConfirmed && res.value) {
            const val = await persistNewMeasure(res.value.name, res.value.abbr);
            select.innerHTML = getMeasureSelectOptionsHtml(val);
            select.value = val;
            markEditorDirty();
            renderRows();
          }
        }
        if (select.id === 'recipeOrderModeEditor') {
          state.editor.orderMode = normalizeLower(select.value);
          markEditorDirty();
          renderRows();
          return;
        }
        if (select.id === 'recipeNutritionCategory') {
          state.editor.nutrition = state.editor.nutrition || {};
          state.editor.nutrition.category = normalizeLower(select.value);
          state.editor.nutrition.subcategory = '';
          renderNutritionSubcategories('');
          markEditorDirty();
          markNutritionAiAsStaleIfNeeded();
          return;
        }
        if (select.id === 'recipeNutritionSubcategory') {
          state.editor.nutrition = state.editor.nutrition || {};
          state.editor.nutrition.subcategory = normalizeLower(select.value);
          markEditorDirty();
          markNutritionAiAsStaleIfNeeded();
          return;
        }
        if (select.id === 'recipeNutritionProductType') {
          state.editor.nutrition = state.editor.nutrition || {};
          state.editor.nutrition.productType = normalizeLower(select.value);
          markEditorDirty();
          markNutritionAiAsStaleIfNeeded();
          return;
        }
        if (select.id === 'recipeNutritionDeclarationUnit') {
          state.editor.nutrition = state.editor.nutrition || {};
          state.editor.nutrition.declarationUnit = normalizeLower(select.value);
          markEditorDirty();
          markNutritionAiAsStaleIfNeeded();
          return;
        }
        if (select.id === 'recipeNutritionHouseholdMeasure') {
          state.editor.nutrition = state.editor.nutrition || {};
          state.editor.nutrition.householdMeasure = normalizeLower(select.value);
          markEditorDirty();
          markNutritionAiAsStaleIfNeeded();
        }
      });


      recipeEditorForm.addEventListener('input', (event) => {
        const input = event.target;
        if (!state.editor) return;
        state.editor.nutrition = state.editor.nutrition || {};
        if (input.id === 'recipeAgingDays') {
          state.editor.agingDays = normalizeValue(input.value);
          markEditorDirty();
          markNutritionAiAsStaleIfNeeded();
          return;
        }
        if (input.id === 'recipeNutritionDeclarationAmount') {
          state.editor.nutrition.declarationAmount = normalizeValue(input.value);
          markEditorDirty();
          markNutritionAiAsStaleIfNeeded();
          return;
        }
        if (input.id === 'recipeNutritionHouseholdAmount') {
          state.editor.nutrition.householdAmount = normalizeValue(input.value);
          renderHouseholdMeasureOptions();
          markEditorDirty();
          markNutritionAiAsStaleIfNeeded();
          return;
        }
        if (input.id === 'recipeTitle' || input.id === 'recipeDescription') {
          markEditorDirty();
          markNutritionAiAsStaleIfNeeded();
          return;
        }
        if (input.id === 'recipeNutritionServingsPerPackage') {
          state.editor.nutrition.servingsPerPackage = normalizeValue(input.value);
          markEditorDirty();
          markNutritionAiAsStaleIfNeeded();
          return;
        }
      });

      recipeEditorForm.addEventListener('focusin', (event) => {
        const input = event.target;
        if (input.matches('[data-ing-input]')) showSuggestions(input, input.dataset.ingInput, input.value);
      });

      document.addEventListener('click', async (event) => {
        if (recetasEditor.classList.contains('d-none')) return;

        const pickBtn = event.target.closest('[data-pick-ingredient]');
        if (pickBtn) {
          const row = state.editor?.rows.find((item) => item.id === pickBtn.dataset.pickIngredient);
          const ingredient = state.ingredientes[pickBtn.dataset.ingId];
          if (row && ingredient) {
            row.ingredientId = ingredient.id;
            row.ingredientName = ingredient.name;
            row.unit = getPreferredUnitForIngredient(ingredient);
            markEditorDirty();
            markNutritionAiAsStaleIfNeeded();
            renderRows();
            clearSuggestions();
          }
          return;
        }

        const createInlineBtn = event.target.closest('[data-create-ingredient-inline]');
        if (createInlineBtn) {
          const rowId = createInlineBtn.dataset.createIngredientInline;
          const row = state.editor?.rows.find((item) => item.id === rowId);
          const draft = row ? { name: row.ingredientName } : null;
          clearSuggestions();
          blurActiveElement();
          recetasModal.setAttribute('inert', '');
          document.querySelectorAll('.modal[aria-hidden="true"]').forEach((node) => {
            if (node.contains(document.activeElement)) {
              document.activeElement?.blur?.();
            }
          });
          let ingredientId = '';
          try {
            await new Promise((resolve) => setTimeout(resolve, 0));
            ingredientId = await window.laJamoneraIngredientesAPI?.openIngredientForm?.(null, draft);
          } finally {
            recetasModal.removeAttribute('inert');
            blurActiveElement();
          }
          await fetchIngredientesData();
          if (ingredientId && state.ingredientes[ingredientId]) {
            const target = state.editor.rows.find((item) => item.id === rowId);
            if (target) {
              target.ingredientId = ingredientId;
              target.ingredientName = state.ingredientes[ingredientId].name;
              target.unit = getPreferredUnitForIngredient(state.ingredientes[ingredientId]);
              markEditorDirty();
              markNutritionAiAsStaleIfNeeded();
            } else {
              pushRowBeforeMonography({
                id: makeId('row'),
                type: 'ingredient',
                ingredientId,
                ingredientName: state.ingredientes[ingredientId].name,
                quantity: '',
                unit: getPreferredUnitForIngredient(state.ingredientes[ingredientId])
              });
              markEditorDirty();
            }
            markNutritionAiAsStaleIfNeeded();
            renderRows();
          }
          return;
        }
      });

      document.addEventListener('click', (event) => {
        if (!recetasEditor.classList.contains('d-none') && !event.target.closest('.recipe-ing-autocomplete') && !event.target.closest('.recipe-suggest-floating')) {
          clearSuggestions();
        }
      });

      const modalBody = recetasModal.querySelector('.modal-body');
      modalBody?.addEventListener('scroll', repositionActiveSuggestions);
      window.addEventListener('resize', repositionActiveSuggestions);
      window.addEventListener('scroll', repositionActiveSuggestions, true);

      state.editorEventsBound = true;
    }

    const rowsBody = recipeEditorForm.querySelector('#recipeRowsBody');
    let draggingId = '';
    rowsBody.addEventListener('dragstart', (event) => {
      const rowEl = event.target.closest('tr[data-row-id]');
      if (!rowEl || state.editor.orderMode !== 'custom') return;
      draggingId = rowEl.dataset.rowId;
      rowEl.classList.add('is-dragging');
      event.dataTransfer.effectAllowed = 'move';
    });
    rowsBody.addEventListener('dragend', (event) => {
      event.target.closest('tr[data-row-id]')?.classList.remove('is-dragging');
      rowsBody.querySelectorAll('.drag-over').forEach((node) => node.classList.remove('drag-over'));
    });
    rowsBody.addEventListener('dragover', (event) => {
      const rowEl = event.target.closest('tr[data-row-id]');
      if (!rowEl || state.editor.orderMode !== 'custom' || rowEl.classList.contains('is-monography')) return;
      event.preventDefault();
      rowsBody.querySelectorAll('.drag-over').forEach((node) => node.classList.remove('drag-over'));
      rowEl.classList.add('drag-over');
    });
    rowsBody.addEventListener('drop', (event) => {
      const rowEl = event.target.closest('tr[data-row-id]');
      if (!rowEl || !draggingId || state.editor.orderMode !== 'custom' || rowEl.classList.contains('is-monography')) return;
      event.preventDefault();
      const from = state.editor.rows.findIndex((row) => row.id === draggingId);
      const to = state.editor.rows.findIndex((row) => row.id === rowEl.dataset.rowId);
      if (from < 0 || to < 0) return;
      const [moved] = state.editor.rows.splice(from, 1);
      state.editor.rows.splice(to, 0, moved);
      ensureMonographyAtEnd();
      renderRows();
    });
  };

  const renderEditor = async (initial = null, editorSeed = null) => {
    await fetchIngredientesData();

    state.editor = editorSeed || {
      image: { method: 'ai', url: initial?.imageUrl || '', prompt: '', file: null, generatedFile: null },
      rows: Array.isArray(initial?.rows) && initial.rows.length
        ? initial.rows.map((row) => ({ ...row, id: row.id || makeId('row') }))
        : [{ id: makeId('row'), type: 'ingredient', ingredientId: '', ingredientName: '', quantity: '', unit: getMeasureOptions()[0]?.value || '' }],
      orderMode: initial?.orderMode || 'desc',
      agingDays: normalizeValue(initial?.agingDays),
      nutrition: {
        productType: normalizeLower(initial?.nutrition?.productType || ''),
        category: normalizeLower(initial?.nutrition?.category || ''),
        subcategory: normalizeLower(initial?.nutrition?.subcategory || ''),
        declarationUnit: normalizeLower(initial?.nutrition?.declarationUnit || 'g'),
        declarationAmount: normalizeValue(initial?.nutrition?.declarationAmount || ''),
        servingsPerPackage: normalizeValue(initial?.nutrition?.servingsPerPackage || ''),
        householdMeasure: normalizeLower(initial?.nutrition?.householdMeasure || 'unidad'),
        householdAmount: normalizeValue(initial?.nutrition?.householdAmount || '1'),
        ai: safeObject(initial?.nutrition?.ai)
      }
    };
    state.editor.nutrition = {
      productType: normalizeLower(state.editor.nutrition?.productType || ''),
      category: normalizeLower(state.editor.nutrition?.category || ''),
      subcategory: normalizeLower(state.editor.nutrition?.subcategory || ''),
      declarationUnit: normalizeLower(state.editor.nutrition?.declarationUnit || 'g'),
      declarationAmount: normalizeValue(state.editor.nutrition?.declarationAmount || ''),
      servingsPerPackage: normalizeValue(state.editor.nutrition?.servingsPerPackage || ''),
      householdMeasure: normalizeLower(state.editor.nutrition?.householdMeasure || 'unidad'),
      householdAmount: normalizeValue(state.editor.nutrition?.householdAmount || '1'),
      ai: safeObject(state.editor.nutrition?.ai)
    };
    state.editor.agingDays = normalizeValue(state.editor.agingDays);
    ensureMonographyAtEnd();
    state.editorDirty = false;

    recipeEditorTitle.textContent = initial ? 'Editar receta' : 'Nueva receta';
    state.activeRecipeId = initial?.id || '';
    recipeEditorForm.innerHTML = `
      <section class="step-block recipe-step-card recipe-main-step">
        <h6 class="step-title"><span class="recipe-step-number">1</span> Datos generales</h6>
        <div class="step-content recipe-fields-flex">
          <div class="recipe-field recipe-field-full">
            <label class="form-label" for="recipeTitle">Título *</label>
            <input id="recipeTitle" class="form-control ios-input" value="${initial?.title || ''}" placeholder="Ej: Chorizo parrillero">
          </div>
          <div class="recipe-field recipe-field-full">
            <label class="form-label" for="recipeDescription">Descripción (opcional)</label>
            <textarea id="recipeDescription" class="form-control ios-input recipe-description-lg" placeholder="Detalle amplio de la receta">${initial?.description || ''}</textarea>
          </div>
          <div class="recipe-field recipe-field-full"><p class="recipe-subsection-title">Rendimiento / producción</p></div>
          <div class="recipe-field recipe-field-half recipe-highlight-field">
            <label class="form-label" for="recipeYieldQty"><i class="fa-solid fa-weight-hanging"></i> Cantidad final obtenida *</label>
            <input id="recipeYieldQty" class="form-control ios-input" value="${initial?.yieldQuantity || ''}" placeholder="Ej: 10,50">
          </div>
          <div class="recipe-field recipe-field-half recipe-highlight-field">
            <label class="form-label" for="recipeYieldUnit">Unidad de medida *</label>
              <select id="recipeYieldUnit" class="form-select ios-input">${getMeasureSelectOptionsHtml(initial?.yieldUnit)}</select>
          </div>
          <div class="recipe-field recipe-field-half recipe-highlight-field">
            <label class="form-label" for="recipeShelfLifeDays"><i class="fa-regular fa-calendar-days"></i> Caducidad (días) *</label>
            <input id="recipeShelfLifeDays" type="number" min="1" step="1" class="form-control ios-input" value="${initial?.shelfLifeDays || ''}" placeholder="Ej: 3">
          </div>
          <div class="recipe-field recipe-field-half recipe-highlight-field">
            <label class="form-label" for="recipeAgingDays"><i class="fa-solid fa-hourglass-half"></i> Días de estacionado</label>
            <input id="recipeAgingDays" type="number" min="0" step="1" class="form-control ios-input" value="${state.editor.agingDays || ''}" placeholder="Ej: 15">
          </div>
          <div class="recipe-field recipe-field-half recipe-highlight-field">
            <label class="form-label" for="recipeOrderModeEditor"><i class="fa-solid fa-arrow-down-short-wide"></i> Orden de ingredientes</label>
            <select id="recipeOrderModeEditor" class="form-select ios-input">
              <option value="desc" ${state.editor.orderMode === 'desc' ? 'selected' : ''}>De mayor a menor</option>
              <option value="asc" ${state.editor.orderMode === 'asc' ? 'selected' : ''}>De menor a mayor</option>
              <option value="custom" ${state.editor.orderMode === 'custom' ? 'selected' : ''}>Personalizado</option>
            </select>
          </div>
        </div>
      </section>

      <section class="step-block recipe-step-card">
        <h6 class="step-title"><span class="recipe-step-number">2</span> Ingredientes</h6>
        <div class="step-content">
          <div class="recipe-table-wrap">
            <div class="recipe-table-scroll" aria-label="Tabla de ingredientes desplazable horizontalmente">
              <table class="recipe-table">
                <thead><tr><th style="width:40px">↕</th><th style="min-width:220px">Ingrediente / Comentario</th><th style="width:140px">Cantidad</th><th style="width:190px">Unidad</th><th style="width:72px">Acción</th></tr></thead>
                <tbody id="recipeRowsBody"></tbody>
              </table>
            </div>
          </div>
          <div class="recipe-table-actions">
            <button type="button" class="btn recipe-table-action-btn recipe-table-action-btn-primary" data-add-ingredient-row><i class="fa-solid fa-plus"></i><span>Agregar fila</span></button>
            <button type="button" class="btn recipe-table-action-btn recipe-table-action-btn-neutral" data-add-comment-row><i class="fa-regular fa-message"></i><span>Comentario</span></button>
            <button type="button" class="btn recipe-table-action-btn recipe-table-action-btn-monography" data-add-monography-row><i class="fa-solid fa-scroll"></i><span>Monografía</span></button>
          </div>
        </div>
      </section>

      <section class="step-block recipe-step-card recipe-nutrition-step">
        <h6 class="step-title"><span class="recipe-step-number">3</span> Información nutricional (opcional)</h6>
        <div class="step-content recipe-fields-flex">
          <div class="recipe-field recipe-field-half recipe-highlight-field recipe-highlight-field-nutrition">
            <label class="form-label" for="recipeNutritionProductType">Tipo de producto</label>
            <select id="recipeNutritionProductType" class="form-select ios-input">
              <option value="">Seleccionar</option>
              ${PRODUCT_TYPES.map((item) => `<option value="${item.value}" ${state.editor.nutrition.productType === item.value ? 'selected' : ''}>${item.label}</option>`).join('')}
            </select>
          </div>
          <div class="recipe-field recipe-field-half recipe-highlight-field recipe-highlight-field-nutrition">
            <label class="form-label" for="recipeNutritionCategory">Categoría de alimento (Argentina)</label>
            <select id="recipeNutritionCategory" class="form-select ios-input">
              <option value="">Seleccionar</option>
              ${getCategoryOptionsHtml(state.editor.nutrition.category)}
            </select>
          </div>
          <div class="recipe-field recipe-field-half recipe-highlight-field recipe-highlight-field-nutrition">
            <label class="form-label" for="recipeNutritionSubcategory">Subcategoría</label>
            <select id="recipeNutritionSubcategory" class="form-select ios-input">${getSubcategoryOptionsHtml(state.editor.nutrition.category, state.editor.nutrition.subcategory)}</select>
          </div>
          <div class="recipe-field recipe-field-half recipe-highlight-field recipe-highlight-field-nutrition">
            <label class="form-label" for="recipeNutritionDeclarationUnit">Unidad de declaración</label>
            <div class="recipe-nutrition-declaration-grid">
              <select id="recipeNutritionDeclarationUnit" class="form-select ios-input">
                ${DECLARATION_UNITS.map((item) => `<option value="${item.value}" ${state.editor.nutrition.declarationUnit === item.value ? 'selected' : ''}>${item.label}</option>`).join('')}
              </select>
              <input id="recipeNutritionDeclarationAmount" type="number" min="0" step="0.01" class="form-control ios-input" value="${state.editor.nutrition.declarationAmount || ''}" placeholder="Cantidad">
            </div>
          </div>
          <div class="recipe-field recipe-field-half recipe-highlight-field recipe-highlight-field-nutrition">
            <label class="form-label" for="recipeNutritionServingsPerPackage">Porciones por envase</label>
            <input id="recipeNutritionServingsPerPackage" type="number" min="0" step="0.01" class="form-control ios-input" value="${state.editor.nutrition.servingsPerPackage || ''}" placeholder="Ej: 3">
          </div>
          <div class="recipe-field recipe-field-full recipe-highlight-field recipe-highlight-field-nutrition">
            <label class="form-label" for="recipeNutritionHouseholdMeasure">Medida casera</label>
            <div class="recipe-nutrition-household-grid">
              <input id="recipeNutritionHouseholdAmount" type="number" min="0" step="0.01" class="form-control ios-input" value="${state.editor.nutrition.householdAmount || '1'}" placeholder="Ej: 0,5">
              <select id="recipeNutritionHouseholdMeasure" class="form-select ios-input">${getHouseholdMeasureOptionsHtml(state.editor.nutrition.householdMeasure, state.editor.nutrition.householdAmount || 1)}</select>
            </div>
          </div>
          <div class="recipe-field recipe-field-full recipe-highlight-field recipe-highlight-field-nutrition">
            <div class="recipe-nutrition-ai-actions">
              <button id="generateNutritionAiBtn" type="button" class="btn ios-btn ios-btn-secondary recipe-nutrition-ai-btn" disabled>
                <img src="${IA_ICON_SRC}" alt="" aria-hidden="true">
                <span class="js-generate-label">Generar tabla nutricional con IA</span>
              </button>
              <p class="recipe-nutrition-ai-disclaimer">La IA trabaja sobre tus datos reales de receta. No inventa información nutricional: genera una propuesta de diseño editable para la gráfica.</p>
              <span id="recipeNutritionAiStale" class="recipe-nutrition-ai-stale d-none">⚠️ Cambiaron datos: rehacé la tabla nutricional.</span>
            </div>
            <div id="recipeNutritionAiPreview" class="recipe-nutrition-ai-preview"></div>
          </div>
        </div>
      </section>

      ${buildImageStepHtml('recipeImage', initial?.imageUrl || '', 4)}
      <div class="recipe-editor-actions"><button type="submit" class="btn ios-btn ios-btn-success"><i class="fa-solid fa-floppy-disk"></i><span>${initial ? 'Guardar receta' : 'Crear receta'}</span></button></div>`;

    renderRows();
    wireImageStep('recipeImage', state.editor.image);
    renderNutritionSubcategories(state.editor.nutrition.subcategory);
    renderHouseholdMeasureOptions();
    renderNutritionAiPreview();
    bindEditorEvents();
    setView('editor');
  };

  const collectEditorPayload = async () => {
    const title = normalizeValue(recipeEditorForm.querySelector('#recipeTitle')?.value);
    const description = normalizeValue(recipeEditorForm.querySelector('#recipeDescription')?.value);
    const yieldQuantity = normalizeValue(recipeEditorForm.querySelector('#recipeYieldQty')?.value).replaceAll('.', ',');
    const yieldUnit = normalizeLower(recipeEditorForm.querySelector('#recipeYieldUnit')?.value);
    const shelfLifeDays = Number(normalizeValue(recipeEditorForm.querySelector('#recipeShelfLifeDays')?.value));
    const agingDaysRaw = normalizeValue(recipeEditorForm.querySelector('#recipeAgingDays')?.value);
    const agingDays = agingDaysRaw ? Number(agingDaysRaw) : 0;
    const orderMode = normalizeLower(recipeEditorForm.querySelector('#recipeOrderModeEditor')?.value);

    if (!title) throw new Error('El título es obligatorio.');
    if (!yieldQuantity) throw new Error('Completá la cantidad obtenida.');
    if (!yieldUnit || yieldUnit === NEW_MEASURE_VALUE) throw new Error('Seleccioná una unidad de medida válida.');
    if (!Number.isFinite(shelfLifeDays) || shelfLifeDays <= 0) throw new Error('Ingresá la caducidad en días con un número mayor a 0.');
    if (!Number.isFinite(agingDays) || agingDays < 0) throw new Error('Ingresá los días de estacionado con un número válido (0 o mayor).');
    if (isNutritionAiStale()) throw new Error('Se modificaron datos nutricionales. Rehacé la tabla nutricional con IA antes de guardar.');

    const rows = state.editor.rows
      .map((row) => {
        if (row.type === 'comment') {
          return { id: row.id, type: 'comment', comment: normalizeValue(row.comment) };
        }
        if (row.type === MONOGRAPHY_ROW_TYPE) {
          return { id: row.id, type: MONOGRAPHY_ROW_TYPE, html: normalizeValue(row.html) };
        }
        return {
          id: row.id,
          type: 'ingredient',
          ingredientId: normalizeValue(row.ingredientId),
          ingredientName: normalizeValue(row.ingredientName),
          quantity: normalizeValue(row.quantity).replaceAll('.', ','),
          unit: normalizeLower(row.unit)
        };
      })
      .filter((row) => row.type === 'comment' ? row.comment : (row.type === MONOGRAPHY_ROW_TYPE ? row.html : row.ingredientName));

    if (!rows.length) throw new Error('Agregá al menos una fila válida en la receta.');
    const invalidIngredientRow = rows.find((row) => row.type === 'ingredient' && (!row.ingredientId || !row.quantity || !row.unit || row.unit === NEW_MEASURE_VALUE));
    if (invalidIngredientRow) throw new Error('Todas las filas de ingredientes deben tener ingrediente, cantidad y medida.');

    const sortedRows = sortRowsByOrderMode(rows, orderMode);

    const nutrition = {
      productType: normalizeLower(recipeEditorForm.querySelector('#recipeNutritionProductType')?.value),
      category: normalizeLower(recipeEditorForm.querySelector('#recipeNutritionCategory')?.value),
      subcategory: normalizeLower(recipeEditorForm.querySelector('#recipeNutritionSubcategory')?.value),
      declarationUnit: normalizeLower(recipeEditorForm.querySelector('#recipeNutritionDeclarationUnit')?.value),
      declarationAmount: normalizeValue(recipeEditorForm.querySelector('#recipeNutritionDeclarationAmount')?.value),
      servingsPerPackage: normalizeValue(recipeEditorForm.querySelector('#recipeNutritionServingsPerPackage')?.value),
      householdMeasure: normalizeLower(recipeEditorForm.querySelector('#recipeNutritionHouseholdMeasure')?.value),
      householdAmount: normalizeValue(recipeEditorForm.querySelector('#recipeNutritionHouseholdAmount')?.value),
      ai: safeObject(state.editor?.nutrition?.ai)
    };

    let imageUrl = normalizeValue(state.editor.image.url || '');
    const method = normalizeLower(document.getElementById('recipeImage_method')?.value || state.editor.image.method || 'ai');
    if (method === 'upload' && state.editor.image.file) {
      const msg = validateImageFile(state.editor.image.file);
      if (msg) throw new Error(msg);
      imageUrl = await uploadImageToStorage(state.editor.image.file, 'recetas/uploads');
    }
    if (method === 'ai') {
      if (state.editor.image.generatedFile) {
        imageUrl = await uploadImageToStorage(state.editor.image.generatedFile, 'recetas/ia');
      } else if (normalizeValue(state.editor.image.prompt)) {
        const aiFile = await generateImageWithIA(normalizeValue(state.editor.image.prompt));
        imageUrl = await uploadImageToStorage(aiFile, 'recetas/ia');
      }
    }

    return { title, description, yieldQuantity, yieldUnit, shelfLifeDays, agingDays, orderMode, rows: sortedRows, nutrition, imageUrl };
  };

  const removeRecipe = async (recipeId) => {
    const item = state.recetas[recipeId];
    if (!item) return;
    const ok = await openIosSwal({
      title: 'Eliminar receta',
      html: `<p>Vas a eliminar <strong>${capitalize(item.title)}</strong>.</p><p class="mb-0">Esta acción no se puede deshacer.</p>`,
      icon: 'warning', showCancelButton: true, confirmButtonText: 'Eliminar', cancelButtonText: 'Cancelar'
    });
    if (!ok.isConfirmed) return;
    delete state.recetas[recipeId];
    await persistRecetas();
    renderRecetas();
  };

  const loadRecetas = async () => {
    showState('loading');
    recetasEditor?.classList.add('d-none');
    recetasData?.classList.add('d-none');
    recetasEmpty?.classList.add('d-none');
    try {
      await fetchIngredientesData();
      await fetchRecetas();
      renderRecetas();
      if (state.resumeEditor?.data) {
        const recipe = state.resumeEditor.activeRecipeId ? state.recetas[state.resumeEditor.activeRecipeId] : null;
        await renderEditor(recipe || null, state.resumeEditor.data);
        recipeEditorTitle.textContent = state.resumeEditor.title || (recipe ? 'Editar receta' : 'Nueva receta');
      } else {
        setView(getRecetasArray().length ? 'list' : 'empty');
      }
    } catch (error) {
      showState('empty');
      await openIosSwal({ title: 'No se pudo cargar', html: '<p>Error leyendo recetas desde Firebase.</p>', icon: 'error', confirmButtonText: 'Entendido' });
    }
  };

  recipeEditorForm?.addEventListener('submit', async (event) => {
    event.preventDefault();

    Swal.fire({
      title: 'Guardando receta...',
      html: '<div class="informes-saving-spinner"><img src="./IMG/Meta-ai-logo.webp" alt="Guardando" class="meta-spinner-login"></div>',
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false,
      customClass: { popup: 'ios-alert ingredientes-alert', title: 'ios-alert-title', htmlContainer: 'ios-alert-text' }
    });

    try {
      const payload = await collectEditorPayload();
      const id = state.activeRecipeId || makeId('rec');
      const prev = state.recetas[id] || {};
      state.recetas[id] = { id, ...payload, createdAt: prev.createdAt || Date.now(), updatedAt: Date.now() };
      await persistRecetas();
      state.resumeEditor = null;
      state.editorDirty = false;
      renderRecetas();
      setView('list');
    } catch (error) {
      Swal.close();
      await openIosSwal({ title: 'Revisá los datos', html: `<p>${error.message || 'No se pudo guardar la receta.'}</p>`, icon: 'warning', confirmButtonText: 'Entendido' });
      return;
    } finally {
      Swal.close();
    }
  });

  recipeBackBtn?.addEventListener('click', async () => {
    if (state.editorDirty) {
      const leave = await openIosSwal({
        title: '¿Abandonar cambios?',
        html: '<p>Tenés cambios sin guardar en la receta.</p><p class="mb-0">Si volvés atrás, se perderán.</p>',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Abandonar',
        cancelButtonText: 'Seguir editando'
      });
      if (!leave.isConfirmed) return;
    }
    state.activeRecipeId = '';
    state.editor = null;
    state.resumeEditor = null;
    state.editorDirty = false;
    setView(getRecetasArray().length ? 'list' : 'empty');
  });

  recetasModal.addEventListener('hide.bs.modal', () => {
    snapshotEditorDraft();
    blurActiveElement();
    state.editorDirty = false;
  });
  recetasModal.addEventListener('hidden.bs.modal', () => {
    clearSuggestions();
    blurActiveElement();
    recetasModal.removeAttribute('inert');
  });
  recetasModal.addEventListener('show.bs.modal', loadRecetas);

  recetasList?.addEventListener('scroll', updateListScrollHint);

  recetasSearchInput?.addEventListener('input', (event) => {
    state.search = normalizeLower(event.target.value);
    renderRecetas();
  });

  createRecipeBtn?.addEventListener('click', () => renderEditor());
  emptyCreateRecipeBtn?.addEventListener('click', () => renderEditor());

  recetasData?.addEventListener('click', async (event) => {
    const printBtn = event.target.closest('[data-receta-print]');
    if (printBtn) {
      const recipe = state.recetas[printBtn.dataset.recetaId];
      if (!recipe) return;
      try {
        await openPrintConfigurator(recipe, printBtn.dataset.recetaPrint);
      } catch (error) {
        await openIosSwal({
          title: 'No se pudo imprimir',
          html: `<p>${escapeHtml(error.message || 'Error preparando la impresión.')}</p>`,
          icon: 'error',
          confirmButtonText: 'Entendido'
        });
      }
      return;
    }

    const editBtn = event.target.closest('[data-receta-edit]');
    if (editBtn) return renderEditor(state.recetas[editBtn.dataset.recetaEdit]);
    const deleteBtn = event.target.closest('[data-receta-delete]');
    if (deleteBtn) return removeRecipe(deleteBtn.dataset.recetaDelete);
  });
})();
