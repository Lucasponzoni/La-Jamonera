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
    editorDirty: false
  };

  const normalizeValue = (value) => String(value || '').trim();
  const normalizeLower = (value) => normalizeValue(value).toLowerCase();
  const capitalize = (value) => normalizeLower(value).replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
  const safeObject = (value) => (value && typeof value === 'object' ? value : {});
  const makeId = (prefix) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const NEW_MEASURE_VALUE = '__new_measure__';

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
    return `${opts.map((item) => `<option value="${item.value}" ${normalizeLower(selected) === item.value ? 'selected' : ''}>${item.label}</option>`).join('')}<option value="${NEW_MEASURE_VALUE}">+ Agregar nueva medida</option>`;
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
      return `
        <article class="ingrediente-card receta-card" data-receta-id="${item.id}">
          <div class="ingrediente-avatar receta-thumb-wrap">
            ${item.imageUrl
              ? `<span class="thumb-loading"><img class="meta-spinner-login" src="./IMG/Meta-ai-logo.webp" alt="Cargando"></span><img class="receta-thumb js-receta-thumb" src="${item.imageUrl}" alt="${capitalize(item.title || 'Receta')}" loading="lazy">`
              : getPlaceholderCircle()}
          </div>
          <div class="ingrediente-main receta-main">
            <h6 class="ingrediente-name receta-name">${capitalize(item.title || 'Sin título')}</h6>
            <p class="ingrediente-meta receta-card-meta">Rinde: ${item.yieldQuantity || '0'} ${label || ''}</p>
            <p class="ingrediente-meta receta-card-ingredients">Ingredientes: ${recipeIngredients.length ? recipeIngredients.join(' · ') : 'Sin ingredientes vinculados.'}</p>
            ${item.description ? `<p class="ingrediente-description">${capitalize(item.description)}</p>` : '<p class="ingrediente-description"><em>Sin descripción</em></p>'}
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
  const getSmallPlaceholder = (icon = 'fa-solid fa-bowl-food') => `<span class="recipe-small-placeholder"><i class="${icon}"></i></span>`;
  const buildImageStepHtml = (prefix, initialImage) => `
    <section class="step-block recipe-step-card">
      <h6 class="step-title"><span class="recipe-step-number">3</span> Imagen</h6>
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
  const ensureIngredientRow = () => {
    if (!getIngredientRows().length) {
      state.editor.rows.push({ id: makeId('row'), type: 'ingredient', ingredientId: '', ingredientName: '', quantity: '', unit: getMeasureOptions()[0]?.value || '' });
    }
  };

  const clearSuggestions = () => {
    document.querySelectorAll('.recipe-suggest-floating').forEach((node) => node.remove());
    state.editor && (state.editor.activeSuggestRowId = '');
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

    rowsBody.innerHTML = state.editor.rows.map((row) => {
      if (row.type === 'comment') {
        return `
          <tr class="is-comment" data-row-id="${row.id}" draggable="${state.editor.orderMode === 'custom'}">
            <td><i class="fa-solid fa-grip-lines"></i></td>
            <td colspan="3"><input class="form-control ios-input" data-comment-input="${row.id}" value="${row.comment || ''}" placeholder="Comentario visual (no afecta receta)"></td>
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

    const autoWrap = input.closest('.recipe-ing-autocomplete');
    if (autoWrap) {
      autoWrap.appendChild(dropdown);
    } else {
      recetasEditor.appendChild(dropdown);
      const inputRect = input.getBoundingClientRect();
      const containerRect = recetasEditor.getBoundingClientRect();
      dropdown.style.top = `${inputRect.bottom - containerRect.top + 6}px`;
      dropdown.style.left = `${inputRect.left - containerRect.left}px`;
      dropdown.style.width = `${inputRect.width}px`;
    }

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
        const addIngredientBtn = event.target.closest('[data-add-ingredient-row]');
        if (addIngredientBtn) {
          state.editor.rows.push({ id: makeId('row'), type: 'ingredient', ingredientId: '', ingredientName: '', quantity: '', unit: getMeasureOptions()[0]?.value || '' });
          markEditorDirty();
          renderRows();
          return;
        }
        const addCommentBtn = event.target.closest('[data-add-comment-row]');
        if (addCommentBtn) {
          state.editor.rows.push({ id: makeId('row'), type: 'comment', comment: '' });
          markEditorDirty();
          renderRows();
          return;
        }
        const removeBtn = event.target.closest('[data-remove-row]');
        if (removeBtn) {
          state.editor.rows = state.editor.rows.filter((row) => row.id !== removeBtn.dataset.removeRow);
          ensureIngredientRow();
          markEditorDirty();
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
          showSuggestions(input, row.id, input.value);
          return;
        }
        if (input.matches('[data-qty-input]')) {
          const row = state.editor.rows.find((item) => item.id === input.dataset.qtyInput);
          if (row) {
            row.quantity = input.value;
            markEditorDirty();
          }
          return;
        }
        if (input.matches('[data-comment-input]')) {
          const row = state.editor.rows.find((item) => item.id === input.dataset.commentInput);
          if (row) {
            row.comment = input.value;
            markEditorDirty();
          }
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
        }
      });

      recipeEditorForm.addEventListener('focusin', (event) => {
        const input = event.target;
        if (input.matches('[data-ing-input]')) showSuggestions(input, input.dataset.ingInput, input.value);
      });

      recetasEditor.addEventListener('click', async (event) => {
        const pickBtn = event.target.closest('[data-pick-ingredient]');
        if (pickBtn) {
          const row = state.editor?.rows.find((item) => item.id === pickBtn.dataset.pickIngredient);
          const ingredient = state.ingredientes[pickBtn.dataset.ingId];
          if (row && ingredient) {
            row.ingredientId = ingredient.id;
            row.ingredientName = ingredient.name;
            markEditorDirty();
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
              markEditorDirty();
            } else {
              state.editor.rows.push({ id: makeId('row'), type: 'ingredient', ingredientId, ingredientName: state.ingredientes[ingredientId].name, quantity: '', unit: getMeasureOptions()[0]?.value || '' });
              markEditorDirty();
            }
            renderRows();
          }
        }
      });

      document.addEventListener('click', (event) => {
        if (!recetasEditor.classList.contains('d-none') && !event.target.closest('.recipe-ing-autocomplete') && !event.target.closest('.recipe-suggest-floating')) {
          clearSuggestions();
        }
      });

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
      if (!rowEl || state.editor.orderMode !== 'custom') return;
      event.preventDefault();
      rowsBody.querySelectorAll('.drag-over').forEach((node) => node.classList.remove('drag-over'));
      rowEl.classList.add('drag-over');
    });
    rowsBody.addEventListener('drop', (event) => {
      const rowEl = event.target.closest('tr[data-row-id]');
      if (!rowEl || !draggingId || state.editor.orderMode !== 'custom') return;
      event.preventDefault();
      const from = state.editor.rows.findIndex((row) => row.id === draggingId);
      const to = state.editor.rows.findIndex((row) => row.id === rowEl.dataset.rowId);
      if (from < 0 || to < 0) return;
      const [moved] = state.editor.rows.splice(from, 1);
      state.editor.rows.splice(to, 0, moved);
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
      orderMode: initial?.orderMode || 'desc'
    };
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
          </div>
        </div>
      </section>

      ${buildImageStepHtml('recipeImage', initial?.imageUrl || '')}
      <div class="recipe-editor-actions"><button type="submit" class="btn ios-btn ios-btn-success"><i class="fa-solid fa-floppy-disk"></i><span>${initial ? 'Guardar receta' : 'Crear receta'}</span></button></div>`;

    renderRows();
    wireImageStep('recipeImage', state.editor.image);
    bindEditorEvents();
    setView('editor');
  };

  const collectEditorPayload = async () => {
    const title = normalizeValue(recipeEditorForm.querySelector('#recipeTitle')?.value);
    const description = normalizeValue(recipeEditorForm.querySelector('#recipeDescription')?.value);
    const yieldQuantity = normalizeValue(recipeEditorForm.querySelector('#recipeYieldQty')?.value).replaceAll('.', ',');
    const yieldUnit = normalizeLower(recipeEditorForm.querySelector('#recipeYieldUnit')?.value);
    const shelfLifeDays = Number(normalizeValue(recipeEditorForm.querySelector('#recipeShelfLifeDays')?.value));
    const orderMode = normalizeLower(recipeEditorForm.querySelector('#recipeOrderModeEditor')?.value);

    if (!title) throw new Error('El título es obligatorio.');
    if (!yieldQuantity) throw new Error('Completá la cantidad obtenida.');
    if (!yieldUnit || yieldUnit === NEW_MEASURE_VALUE) throw new Error('Seleccioná una unidad de medida válida.');
    if (!Number.isFinite(shelfLifeDays) || shelfLifeDays <= 0) throw new Error('Ingresá la caducidad en días con un número mayor a 0.');

    const rows = state.editor.rows
      .map((row) => row.type === 'comment'
        ? { id: row.id, type: 'comment', comment: normalizeValue(row.comment) }
        : { id: row.id, type: 'ingredient', ingredientId: normalizeValue(row.ingredientId), ingredientName: normalizeValue(row.ingredientName), quantity: normalizeValue(row.quantity).replaceAll('.', ','), unit: normalizeLower(row.unit) })
      .filter((row) => row.type === 'comment' ? row.comment : row.ingredientName);

    if (!rows.length) throw new Error('Agregá al menos una fila válida en la receta.');
    const invalidIngredientRow = rows.find((row) => row.type === 'ingredient' && (!row.ingredientId || !row.quantity || !row.unit || row.unit === NEW_MEASURE_VALUE));
    if (invalidIngredientRow) throw new Error('Todas las filas de ingredientes deben tener ingrediente, cantidad y medida.');

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

    return { title, description, yieldQuantity, yieldUnit, shelfLifeDays, orderMode, rows, imageUrl };
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
      await openIosSwal({ title: 'Revisá los datos', html: `<p>${error.message || 'No se pudo guardar la receta.'}</p>`, icon: 'warning', confirmButtonText: 'Entendido' });
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
    const editBtn = event.target.closest('[data-receta-edit]');
    if (editBtn) return renderEditor(state.recetas[editBtn.dataset.recetaEdit]);
    const deleteBtn = event.target.closest('[data-receta-delete]');
    if (deleteBtn) return removeRecipe(deleteBtn.dataset.recetaDelete);
  });
})();
