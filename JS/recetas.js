(function recetasModule() {
  const IA_WORKER_BASE = 'https://worker.lucasponzoninovogar.workers.dev';
  const IA_ICON_SRC = './IMG/ia-unscreen.gif';
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
    editorEventsBound: false
  };

  const normalizeValue = (value) => String(value || '').trim();
  const normalizeLower = (value) => normalizeValue(value).toLowerCase();
  const capitalize = (value) => normalizeLower(value).replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
  const safeObject = (value) => (value && typeof value === 'object' ? value : {});
  const makeId = (prefix) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const blurActiveElement = () => document.activeElement?.blur?.();
  const openIosSwal = (options) => Swal.fire({
    ...options,
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

  const showState = (key) => {
    recetasLoading.classList.toggle('d-none', key !== 'loading');
    recetasEmpty.classList.toggle('d-none', key !== 'empty');
    recetasData.classList.toggle('d-none', key !== 'data');
  };

  const setView = (view) => {
    state.view = view;
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

  const formatDate = (value) => {
    const date = new Date(value || Date.now());
    return date.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
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
    const response = await fetch(`${IA_WORKER_BASE}/api/ia/imagen`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt })
    });
    if (!response.ok) throw new Error('No se pudo generar la imagen con IA.');
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
      showState(getRecetasArray().length ? 'data' : 'empty');
      return;
    }

    const measureMap = new Map(getMeasureOptions().map((item) => [item.value, item.label]));
    recetasList.innerHTML = source.map((item) => {
      const label = measureMap.get(normalizeLower(item.yieldUnit)) || capitalize(item.yieldUnit || '');
      return `
        <article class="receta-card" data-receta-id="${item.id}">
          <div class="receta-card-head">
            <div class="receta-card-info">
              <img class="receta-thumb" src="${item.imageUrl || './IMG/La Jamonera Cerdito.webp'}" alt="${capitalize(item.title || 'Receta')}">
              <div>
                <h6 class="mb-1">${capitalize(item.title || 'Sin título')}</h6>
                <div class="receta-card-meta">Rinde: ${item.yieldQuantity || '0'} ${label || ''}</div>
              </div>
            </div>
            <div class="recipe-row-actions">
              <button type="button" class="btn family-manage-btn" data-receta-edit="${item.id}" title="Editar"><i class="fa-solid fa-pen"></i></button>
              <button type="button" class="btn family-manage-btn" data-receta-delete="${item.id}" title="Eliminar"><i class="fa-solid fa-trash"></i></button>
            </div>
          </div>
          <p class="mb-1">${item.description ? capitalize(item.description) : '<em>Sin descripción</em>'}</p>
          <small class="receta-card-meta">Actualizada: ${formatDate(item.updatedAt)}</small>
        </article>`;
    }).join('');
    showState('data');
  };

  const getPlaceholderCircle = () => '<span class="image-placeholder-circle"><i class="fa-regular fa-image"></i></span>';
  const buildImageStepHtml = (prefix, initialImage) => `
    <section class="step-block recipe-step-card">
      <h6 class="step-title"><span class="recipe-step-number">3</span> Imagen de receta</h6>
      <div class="step-content">
        <div class="image-method-buttons" id="${prefix}_methodButtons">
          <button type="button" class="btn image-method-btn" data-image-method="url"><i class="fa-solid fa-link"></i>Link</button>
          <button type="button" class="btn image-method-btn" data-image-method="upload"><i class="fa-solid fa-upload"></i>Subir</button>
          <button type="button" class="btn image-method-btn is-active" data-image-method="ai"><img src="${IA_ICON_SRC}" alt="" aria-hidden="true">IA</button>
        </div>
        <input type="hidden" id="${prefix}_imageMethod" value="ai">
        <div class="recipe-image-layout">
          <div id="${prefix}_preview" class="image-preview-circle recipe-image-preview">${initialImage ? `<img src="${initialImage}" alt="Vista previa">` : getPlaceholderCircle()}</div>
          <div class="recipe-image-inputs">
            <div id="${prefix}_urlWrap">
              <label class="form-label" for="${prefix}_imageUrl">URL de imagen</label>
              <input id="${prefix}_imageUrl" class="swal2-input ios-input" placeholder="https://..." value="${initialImage || ''}">
            </div>
            <div id="${prefix}_uploadWrap" class="d-none">
              <label class="form-label" for="${prefix}_imageFile">Subir imagen</label>
              <input id="${prefix}_imageFile" type="file" class="form-control image-file-input" accept="image/*">
            </div>
            <div id="${prefix}_aiWrap" class="d-none">
              <label class="form-label" for="${prefix}_imagePrompt">Prompt IA</label>
              <div class="ios-input-group input-with-icon">
                <img src="${IA_ICON_SRC}" alt="" aria-hidden="true">
                <input id="${prefix}_imagePrompt" class="swal2-input ios-input" placeholder="Ej: foto realista del producto terminado">
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>`;

  const wireImageStep = (prefix, stateImage) => {
    const methodInput = document.getElementById(`${prefix}_imageMethod`);
    const methodButtons = Array.from(document.querySelectorAll(`#${prefix}_methodButtons [data-image-method]`));
    const preview = document.getElementById(`${prefix}_preview`);
    const urlWrap = document.getElementById(`${prefix}_urlWrap`);
    const uploadWrap = document.getElementById(`${prefix}_uploadWrap`);
    const aiWrap = document.getElementById(`${prefix}_aiWrap`);
    const urlInput = document.getElementById(`${prefix}_imageUrl`);
    const fileInput = document.getElementById(`${prefix}_imageFile`);
    const promptInput = document.getElementById(`${prefix}_imagePrompt`);

    const setPreview = (url) => { if (preview) preview.innerHTML = url ? `<img src="${url}" alt="Vista previa">` : getPlaceholderCircle(); };
    const applyMethod = (method) => {
      methodInput.value = method;
      methodButtons.forEach((button) => button.classList.toggle('is-active', button.dataset.imageMethod === method));
      urlWrap?.classList.toggle('d-none', method !== 'url');
      uploadWrap?.classList.toggle('d-none', method !== 'upload');
      aiWrap?.classList.toggle('d-none', method !== 'ai');
      stateImage.method = method;
      if (method === 'url') setPreview(normalizeValue(urlInput?.value));
      if (method === 'upload' && !stateImage.file) setPreview('');
    };

    methodButtons.forEach((button) => button.addEventListener('click', () => applyMethod(button.dataset.imageMethod)));
    urlInput?.addEventListener('input', () => { stateImage.url = urlInput.value; if (stateImage.method === 'url') setPreview(normalizeValue(stateImage.url)); });
    fileInput?.addEventListener('change', () => {
      stateImage.file = fileInput.files?.[0] || null;
      if (!stateImage.file) return setPreview('');
      const reader = new FileReader();
      reader.onload = () => setPreview(reader.result || '');
      reader.readAsDataURL(stateImage.file);
    });
    promptInput?.addEventListener('input', () => { stateImage.prompt = promptInput.value; });

    applyMethod(normalizeValue(urlInput?.value) ? 'url' : 'ai');
  };

  const getIngredientRows = () => state.editor.rows.filter((row) => row.type === 'ingredient');
  const ensureIngredientRow = () => {
    if (!getIngredientRows().length) {
      state.editor.rows.push({ id: makeId('row'), type: 'ingredient', ingredientId: '', ingredientName: '', quantity: '', unit: state.editor.measureOptions[0]?.value || '' });
    }
  };

  const clearSuggestions = () => {
    document.querySelectorAll('.recipe-suggest-floating').forEach((node) => node.remove());
    state.editor && (state.editor.activeSuggestRowId = '');
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
          <td>
            <div class="recipe-ing-autocomplete">
              <input class="form-control ios-input" data-ing-input="${row.id}" value="${row.ingredientName || ''}" placeholder="Buscar ingrediente...">
            </div>
          </td>
          <td><input class="form-control ios-input" data-qty-input="${row.id}" value="${row.quantity || ''}" placeholder="0,00"></td>
          <td>
            <select class="form-select ios-input" data-unit-input="${row.id}">
              ${state.editor.measureOptions.map((item) => `<option value="${item.value}" ${normalizeLower(row.unit) === item.value ? 'selected' : ''}>${item.label}</option>`).join('')}
            </select>
          </td>
          <td><button type="button" class="btn family-manage-btn" data-remove-row="${row.id}"><i class="fa-solid fa-trash"></i></button></td>
        </tr>`;
    }).join('');
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
    dropdown.className = 'recipe-suggest-list recipe-suggest-floating';
    dropdown.innerHTML = `${source.map((item) => `
      <button type="button" class="recipe-suggest-item" data-pick-ingredient="${rowId}" data-ing-id="${item.id}">
        <img class="recipe-suggest-avatar" src="${item.imageUrl || './IMG/La Jamonera Cerdito.webp'}" alt="${capitalize(item.name)}">
        <span>${capitalize(item.name)}</span>
      </button>`).join('')}
      <button type="button" class="recipe-suggest-item recipe-suggest-create" data-create-ingredient-inline="${rowId}">
        <i class="fa-solid fa-plus"></i><span>Crear ingrediente</span>
      </button>`;

    recetasEditor.appendChild(dropdown);
    const inputRect = input.getBoundingClientRect();
    const containerRect = recetasEditor.getBoundingClientRect();
    dropdown.style.top = `${inputRect.bottom - containerRect.top + 6}px`;
    dropdown.style.left = `${inputRect.left - containerRect.left}px`;
    dropdown.style.width = `${inputRect.width}px`;
    state.editor.activeSuggestRowId = rowId;
  };

  const bindEditorEvents = () => {
    if (!state.editor) return;
    const rowsBody = recipeEditorForm.querySelector('#recipeRowsBody');
    let draggingId = '';

    if (!state.editorEventsBound) recipeEditorForm.addEventListener('click', async (event) => {
      const addIngredientBtn = event.target.closest('[data-add-ingredient-row]');
      if (addIngredientBtn) {
        state.editor.rows.push({ id: makeId('row'), type: 'ingredient', ingredientId: '', ingredientName: '', quantity: '', unit: state.editor.measureOptions[0]?.value || '' });
        renderRows();
        return;
      }

      const addCommentBtn = event.target.closest('[data-add-comment-row]');
      if (addCommentBtn) {
        state.editor.rows.push({ id: makeId('row'), type: 'comment', comment: '' });
        renderRows();
        return;
      }

      const removeBtn = event.target.closest('[data-remove-row]');
      if (removeBtn) {
        state.editor.rows = state.editor.rows.filter((row) => row.id !== removeBtn.dataset.removeRow);
        ensureIngredientRow();
        renderRows();
        clearSuggestions();
        return;
      }

      const pickBtn = event.target.closest('[data-pick-ingredient]');
      if (pickBtn) {
        const row = state.editor.rows.find((item) => item.id === pickBtn.dataset.pickIngredient);
        const ingredient = state.ingredientes[pickBtn.dataset.ingId];
        if (row && ingredient) {
          row.ingredientId = ingredient.id;
          row.ingredientName = ingredient.name;
          renderRows();
          clearSuggestions();
        }
        return;
      }

      const createInlineBtn = event.target.closest('[data-create-ingredient-inline]');
      if (createInlineBtn) {
        const rowId = createInlineBtn.dataset.createIngredientInline;
        const row = state.editor.rows.find((item) => item.id === rowId);
        const draft = row ? { name: row.ingredientName } : null;
        clearSuggestions();
        const ingredientId = await window.laJamoneraIngredientesAPI?.openIngredientForm?.(null, draft);
        await fetchIngredientesData();
        if (ingredientId && state.ingredientes[ingredientId]) {
          const target = state.editor.rows.find((item) => item.id === rowId);
          if (target) {
            target.ingredientId = ingredientId;
            target.ingredientName = state.ingredientes[ingredientId].name;
          } else {
            state.editor.rows.push({
              id: makeId('row'), type: 'ingredient', ingredientId,
              ingredientName: state.ingredientes[ingredientId].name,
              quantity: '', unit: state.editor.measureOptions[0]?.value || ''
            });
          }
          renderRows();
        }
      }
    });

    if (!state.editorEventsBound) recipeEditorForm.addEventListener('input', (event) => {
      const input = event.target;
      if (input.matches('[data-ing-input]')) {
        const row = state.editor.rows.find((item) => item.id === input.dataset.ingInput);
        if (!row) return;
        row.ingredientName = input.value;
        row.ingredientId = '';
        showSuggestions(input, row.id, input.value);
        return;
      }
      if (input.matches('[data-qty-input]')) {
        const row = state.editor.rows.find((item) => item.id === input.dataset.qtyInput);
        if (row) row.quantity = input.value;
        return;
      }
      if (input.matches('[data-comment-input]')) {
        const row = state.editor.rows.find((item) => item.id === input.dataset.commentInput);
        if (row) row.comment = input.value;
      }
    });

    if (!state.editorEventsBound) recipeEditorForm.addEventListener('change', (event) => {
      const select = event.target;
      if (select.matches('[data-unit-input]')) {
        const row = state.editor.rows.find((item) => item.id === select.dataset.unitInput);
        if (row) row.unit = select.value;
      }
      if (select.id === 'recipeOrderModeEditor') {
        state.editor.orderMode = normalizeLower(select.value);
        renderRows();
      }
    });

    if (!state.editorEventsBound) recipeEditorForm.addEventListener('focusin', (event) => {
      const input = event.target;
      if (input.matches('[data-ing-input]')) showSuggestions(input, input.dataset.ingInput, input.value);
    });

    if (!state.editorEventsBound) document.addEventListener('click', (event) => {
      if (!recetasEditor.classList.contains('d-none') && !event.target.closest('.recipe-ing-autocomplete') && !event.target.closest('.recipe-suggest-list')) {
        clearSuggestions();
      }
    });

    state.editorEventsBound = true;

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

  const renderEditor = async (initial = null) => {
    await fetchIngredientesData();
    const measureOptions = getMeasureOptions();
    const rowsSeed = Array.isArray(initial?.rows) && initial.rows.length
      ? initial.rows.map((row) => ({ ...row, id: row.id || makeId('row') }))
      : [{ id: makeId('row'), type: 'ingredient', ingredientId: '', ingredientName: '', quantity: '', unit: measureOptions[0]?.value || '' }];

    state.editor = {
      image: { method: 'ai', url: initial?.imageUrl || '', prompt: '', file: null },
      rows: rowsSeed,
      orderMode: initial?.orderMode || 'desc',
      measureOptions,
      activeSuggestRowId: ''
    };

    recipeEditorTitle.textContent = initial ? 'Editar receta' : 'Nueva receta';
    state.activeRecipeId = initial?.id || '';
    recipeEditorForm.innerHTML = `
      <section class="step-block recipe-step-card">
        <h6 class="step-title"><span class="recipe-step-number">1</span> Datos principales</h6>
        <div class="step-content row g-3">
          <div class="col-md-6">
            <label class="form-label" for="recipeTitle">Título *</label>
            <input id="recipeTitle" class="form-control ios-input" value="${initial?.title || ''}" placeholder="Ej: Chorizo parrillero">
          </div>
          <div class="col-md-6">
            <label class="form-label" for="recipeDescription">Descripción (opcional)</label>
            <textarea id="recipeDescription" class="form-control ios-input recipe-description-lg" placeholder="Detalle amplio de la receta">${initial?.description || ''}</textarea>
          </div>
          <div class="col-md-4">
            <label class="form-label" for="recipeYieldQty">Cantidad final obtenida *</label>
            <input id="recipeYieldQty" class="form-control ios-input" value="${initial?.yieldQuantity || ''}" placeholder="Ej: 10,50">
          </div>
          <div class="col-md-4">
            <label class="form-label" for="recipeYieldUnit">Unidad de medida *</label>
            <select id="recipeYieldUnit" class="form-select ios-input">${measureOptions.map((item) => `<option value="${item.value}" ${normalizeLower(initial?.yieldUnit) === item.value ? 'selected' : ''}>${item.label}</option>`).join('')}</select>
          </div>
          <div class="col-md-4">
            <label class="form-label" for="recipeOrderModeEditor">Orden de ingredientes</label>
            <select id="recipeOrderModeEditor" class="form-select ios-input">
              <option value="desc" ${state.editor.orderMode === 'desc' ? 'selected' : ''}>De mayor a menor</option>
              <option value="asc" ${state.editor.orderMode === 'asc' ? 'selected' : ''}>De menor a mayor</option>
              <option value="custom" ${state.editor.orderMode === 'custom' ? 'selected' : ''}>Personalizado</option>
            </select>
          </div>
        </div>
      </section>

      <section class="step-block recipe-step-card">
        <h6 class="step-title"><span class="recipe-step-number">2</span> Ingredientes y comentarios</h6>
        <div class="step-content">
          <div class="recipe-table-wrap">
            <table class="recipe-table">
              <thead>
                <tr><th style="width:36px">↕</th><th>Ingrediente / Comentario</th><th style="width:130px">Cantidad</th><th style="width:240px">Unidad</th><th style="width:68px">Acción</th></tr>
              </thead>
              <tbody id="recipeRowsBody"></tbody>
            </table>
          </div>
          <div class="recipe-table-actions">
            <button type="button" class="btn ios-btn ios-btn-secondary recipe-table-action-btn" data-add-ingredient-row><i class="fa-solid fa-plus"></i><span>Agregar fila</span></button>
            <button type="button" class="btn ios-btn ios-btn-secondary recipe-table-action-btn" data-add-comment-row><i class="fa-regular fa-message"></i><span>Comentario</span></button>
          </div>
        </div>
      </section>

      ${buildImageStepHtml('recipeImage', initial?.imageUrl || '')}

      <div class="recipe-editor-actions">
        <button type="submit" class="btn ios-btn ios-btn-success"><i class="fa-solid fa-floppy-disk"></i><span>${initial ? 'Guardar receta' : 'Crear receta'}</span></button>
      </div>`;

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
    const orderMode = normalizeLower(recipeEditorForm.querySelector('#recipeOrderModeEditor')?.value);

    if (!title) throw new Error('El título es obligatorio.');
    if (!yieldQuantity) throw new Error('Completá la cantidad obtenida.');
    if (!yieldUnit) throw new Error('Seleccioná una unidad de medida.');

    const rows = state.editor.rows
      .map((row) => row.type === 'comment'
        ? { id: row.id, type: 'comment', comment: normalizeValue(row.comment) }
        : { id: row.id, type: 'ingredient', ingredientId: normalizeValue(row.ingredientId), ingredientName: normalizeValue(row.ingredientName), quantity: normalizeValue(row.quantity).replaceAll('.', ','), unit: normalizeLower(row.unit) })
      .filter((row) => row.type === 'comment' ? row.comment : row.ingredientName);

    if (!rows.length) throw new Error('Agregá al menos una fila válida en la receta.');

    let imageUrl = normalizeValue(state.editor.image.url || '');
    if (state.editor.image.method === 'upload' && state.editor.image.file) {
      const msg = validateImageFile(state.editor.image.file);
      if (msg) throw new Error(msg);
      imageUrl = await uploadImageToStorage(state.editor.image.file, 'recetas/uploads');
    }
    if (state.editor.image.method === 'ai' && normalizeValue(state.editor.image.prompt)) {
      const aiFile = await generateImageWithIA(normalizeValue(state.editor.image.prompt));
      imageUrl = await uploadImageToStorage(aiFile, 'recetas/ia');
    }

    return { title, description, yieldQuantity, yieldUnit, orderMode, rows, imageUrl };
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
    try {
      await fetchIngredientesData();
      await fetchRecetas();
      renderRecetas();
      setView(getRecetasArray().length ? 'list' : 'empty');
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
      renderRecetas();
      setView('list');
    } catch (error) {
      await openIosSwal({ title: 'Revisá los datos', html: `<p>${error.message || 'No se pudo guardar la receta.'}</p>`, icon: 'warning', confirmButtonText: 'Entendido' });
    }
  });

  recipeBackBtn?.addEventListener('click', () => {
    state.activeRecipeId = '';
    state.editor = null;
    setView(getRecetasArray().length ? 'list' : 'empty');
  });

  recetasModal.addEventListener('hide.bs.modal', blurActiveElement);
  recetasModal.addEventListener('hidden.bs.modal', () => {
    clearSuggestions();
    state.editor = null;
    state.activeRecipeId = '';
    blurActiveElement();
  });
  recetasModal.addEventListener('show.bs.modal', loadRecetas);

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
