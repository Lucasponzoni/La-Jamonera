(function appModule() {
  const SESSION_KEY = 'laJamoneraSession';
  const IA_WORKER_BASE = 'https://worker.lucasponzoninovogar.workers.dev';
  const DEFAULT_IMAGE = './IMG/La Jamonera Cerdito.webp';
  const IA_ICON_DATA_URI = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Ccircle cx='32' cy='32' r='30' fill='%23ede9fe'/%3E%3Cpath d='M32 12l4 10 10 4-10 4-4 10-4-10-10-4 10-4 4-10zm15 30l2 5 5 2-5 2-2 5-2-5-5-2 5-2 2-5zm-30 0l2 5 5 2-5 2-2 5-2-5-5-2 5-2 2-5z' fill='%238b5cf6'/%3E%3C/svg%3E";
  const ALLOWED_UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const MAX_UPLOAD_SIZE_BYTES = 5 * 1024 * 1024;

  const state = {
    activeFamilyId: 'all',
    search: '',
    ingredientes: { familias: {}, items: {} }
  };

  const logoutButtons = document.querySelectorAll('.js-logout');
  const yearNode = document.getElementById('currentYear');
  const ingredientesModal = document.getElementById('ingredientesModal');
  const ingredientesLoading = document.getElementById('ingredientesLoading');
  const ingredientesEmpty = document.getElementById('ingredientesEmpty');
  const ingredientesData = document.getElementById('ingredientesData');
  const familiasCircles = document.getElementById('familiasCircles');
  const ingredientesList = document.getElementById('ingredientesList');
  const searchInput = document.getElementById('ingredientesSearchInput');
  const createIngredientBtn = document.getElementById('createIngredientBtn');
  const emptyCreateIngredientBtn = document.getElementById('emptyCreateIngredientBtn');

  const normalizeValue = (value) => String(value || '').trim();
  const normalizeLower = (value) => normalizeValue(value).toLowerCase();
  const toCapitalize = (value) => normalizeValue(value).toLowerCase();
  const capitalizeLabel = (value) => toCapitalize(value).replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());

  const safeObject = (value) => (value && typeof value === 'object' ? value : {});

  const allMeasures = [
    'kilos',
    'gramos',
    'mililitros',
    'litros',
    'centimetros cubicos',
    'unidades',
    'gotas',
    'onzas',
    'pizcas',
    'cucharadas',
    'cucharaditas'
  ];

  if (yearNode) {
    yearNode.textContent = new Date().getFullYear();
  }

  const showIngredientesState = (stateKey) => {
    if (!ingredientesLoading || !ingredientesEmpty || !ingredientesData) {
      return;
    }

    ingredientesLoading.classList.toggle('d-none', stateKey !== 'loading');
    ingredientesEmpty.classList.toggle('d-none', stateKey !== 'empty');
    ingredientesData.classList.toggle('d-none', stateKey !== 'data');
  };

  const makeId = (prefix) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const fetchIngredientes = async () => {
    await window.laJamoneraReady;
    const data = await window.dbLaJamoneraRest.read('/ingredientes');
    const safeData = safeObject(data);
    state.ingredientes = {
      familias: safeObject(safeData.familias),
      items: safeObject(safeData.items)
    };
  };

  const persistIngredientes = async () => {
    await window.laJamoneraReady;
    await window.dbLaJamoneraRest.write('/ingredientes', state.ingredientes);
  };

  const getFamiliasArray = () => Object.values(safeObject(state.ingredientes.familias));
  const getIngredientesArray = () => Object.values(safeObject(state.ingredientes.items));

  const buildImageCircle = (url, alt) => `<span class="family-circle-thumb"><img src="${url || DEFAULT_IMAGE}" alt="${alt}"></span>`;

  const matchesSearch = (item) => {
    if (!state.search) {
      return true;
    }

    const query = state.search;
    const content = [item.name, item.familyName, item.measure, item.description].map(normalizeLower).join(' ');
    return content.includes(query);
  };

  const renderFamilies = () => {
    if (!familiasCircles) {
      return;
    }

    const families = getFamiliasArray().sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    const allButton = `
      <button type="button" class="family-circle-item ${state.activeFamilyId === 'all' ? 'is-active' : ''}" data-family-filter="all">
        ${buildImageCircle(DEFAULT_IMAGE, 'Todas las familias')}
        <span class="family-circle-name">Todas</span>
      </button>
    `;

    const familyButtons = families.map((family) => `
      <div class="family-circle-wrap">
        <button type="button" class="family-circle-item ${state.activeFamilyId === family.id ? 'is-active' : ''}" data-family-filter="${family.id}">
          ${buildImageCircle(family.imageUrl, capitalizeLabel(family.name))}
          <span class="family-circle-name">${capitalizeLabel(family.name)}</span>
        </button>
        <div class="family-circle-actions">
          <button class="family-manage-btn" data-family-edit="${family.id}" type="button" title="Editar familia"><i class="fa-solid fa-pen"></i></button>
          <button class="family-manage-btn" data-family-delete="${family.id}" type="button" title="Eliminar familia"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>
    `).join('');

    familiasCircles.innerHTML = allButton + familyButtons;
  };

  const renderIngredientes = () => {
    if (!ingredientesList) {
      return;
    }

    const items = getIngredientesArray().filter((item) => {
      if (state.activeFamilyId !== 'all' && item.familyId !== state.activeFamilyId) {
        return false;
      }
      return matchesSearch(item);
    });

    if (!items.length) {
      ingredientesList.innerHTML = '<div class="ingrediente-empty-list">No encontramos ingredientes con ese filtro.</div>';
      return;
    }

    const sorted = items.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    ingredientesList.innerHTML = sorted.map((item) => `
      <article class="ingrediente-card">
        <div class="ingrediente-avatar"><img src="${item.imageUrl || DEFAULT_IMAGE}" alt="${capitalizeLabel(item.name)}"></div>
        <div class="ingrediente-main">
          <h6 class="ingrediente-name">${capitalizeLabel(item.name)}</h6>
          <p class="ingrediente-meta">${capitalizeLabel(item.familyName)} · ${capitalizeLabel(item.measure)}</p>
          ${item.description ? `<p class="ingrediente-description">${item.description}</p>` : ''}
        </div>
        <div class="ingrediente-actions">
          <button class="ingrediente-action" type="button" data-ingrediente-edit="${item.id}" title="Editar ingrediente"><i class="fa-solid fa-pen"></i></button>
          <button class="ingrediente-action" type="button" data-ingrediente-delete="${item.id}" title="Eliminar ingrediente"><i class="fa-solid fa-trash"></i></button>
        </div>
      </article>
    `).join('');
  };

  const refreshView = () => {
    const hasData = getFamiliasArray().length > 0 || getIngredientesArray().length > 0;
    showIngredientesState(hasData ? 'data' : 'empty');
    if (hasData) {
      renderFamilies();
      renderIngredientes();
    }
  };

  const uploadImageToStorage = async (file, folder) => {
    await window.laJamoneraReady;
    if (!window.storageLaJamonera || !file) {
      throw new Error('No se encontró archivo para subir');
    }

    const fileExt = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const refPath = `${folder}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${fileExt}`;
    const ref = window.storageLaJamonera.ref().child(refPath);
    await ref.put(file);
    return ref.getDownloadURL();
  };

  const buildImageOptionHtml = (prefix, initial = {}) => `
    <div class="ingrediente-form-grid">
      <div>
        <label>Método de imagen</label>
        <div class="d-flex flex-wrap gap-2">
          <label><input type="radio" name="${prefix}_imageMethod" value="url" ${initial.method !== 'upload' && initial.method !== 'ai' ? 'checked' : ''}> Link</label>
          <label><input type="radio" name="${prefix}_imageMethod" value="upload" ${initial.method === 'upload' ? 'checked' : ''}> Subir</label>
          <label><input type="radio" name="${prefix}_imageMethod" value="ai" ${initial.method === 'ai' ? 'checked' : ''}> IA</label>
        </div>
      </div>

      <div id="${prefix}_preview" class="image-preview-circle">
        <img src="${initial.preview || DEFAULT_IMAGE}" alt="Vista previa de imagen">
      </div>

      <div id="${prefix}_urlWrap">
        <label for="${prefix}_imageUrl">Link de imagen</label>
        <input id="${prefix}_imageUrl" class="swal2-input ios-input" value="${initial.url || ''}" placeholder="https://...">
      </div>

      <div id="${prefix}_uploadWrap" class="d-none">
        <label for="${prefix}_imageFile">Subir imagen</label>
        <input id="${prefix}_imageFile" type="file" class="form-control ios-input" accept="image/*">
      </div>

      <div id="${prefix}_aiWrap" class="d-none ingrediente-form-grid">
        <label for="${prefix}_aiPrompt">Prompt corto para IA</label>
        <input id="${prefix}_aiPrompt" class="swal2-input ios-input" placeholder="Ej: carne de cerdo">
        <button id="${prefix}_aiGenerate" type="button" class="ai-generate-btn">
          <img src="${IA_ICON_DATA_URI}" alt="Generar con IA">
          <span>Generar imagen con IA</span>
        </button>
        <div id="${prefix}_aiError" class="ai-alert-note d-none"></div>
      </div>
    </div>
  `;

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

  const setupImageOptionEvents = (prefix) => {
    const radios = Array.from(document.querySelectorAll(`input[name="${prefix}_imageMethod"]`));
    const urlWrap = document.getElementById(`${prefix}_urlWrap`);
    const uploadWrap = document.getElementById(`${prefix}_uploadWrap`);
    const aiWrap = document.getElementById(`${prefix}_aiWrap`);
    const preview = document.getElementById(`${prefix}_preview`);
    const imageUrlInput = document.getElementById(`${prefix}_imageUrl`);
    const imageFileInput = document.getElementById(`${prefix}_imageFile`);
    const aiPromptInput = document.getElementById(`${prefix}_aiPrompt`);
    const aiGenerateBtn = document.getElementById(`${prefix}_aiGenerate`);
    const aiError = document.getElementById(`${prefix}_aiError`);

    const imageState = {
      method: 'url',
      generatedBlob: null,
      generatedUrl: ''
    };

    const setPreview = (url) => {
      preview.innerHTML = `<img src="${url || DEFAULT_IMAGE}" alt="Vista previa de imagen">`;
    };

    const setLoadingPreview = () => {
      preview.innerHTML = `
        <img src="${DEFAULT_IMAGE}" alt="Generando imagen con IA">
        <span class="image-preview-overlay"><img src="${IA_ICON_DATA_URI}" alt="Generando"></span>
      `;
    };

    const toggleMethod = () => {
      imageState.method = (radios.find((item) => item.checked) || {}).value || 'url';
      urlWrap.classList.toggle('d-none', imageState.method !== 'url');
      uploadWrap.classList.toggle('d-none', imageState.method !== 'upload');
      aiWrap.classList.toggle('d-none', imageState.method !== 'ai');
      aiError.classList.add('d-none');
    };

    const generateByIa = async () => {
      const prompt = normalizeValue(aiPromptInput.value);
      if (!prompt) {
        aiError.textContent = 'Escribí un prompt corto para generar la imagen.';
        aiError.classList.remove('d-none');
        return;
      }

      aiGenerateBtn.disabled = true;
      aiError.classList.add('d-none');
      setLoadingPreview();

      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 45000);

      try {
        const res = await fetch(`${IA_WORKER_BASE}/emoji`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, mode: 'fast' }),
          signal: ctrl.signal
        });

        if (!res.ok) {
          let msg = `${res.status} ${res.statusText}`;
          try {
            const j = await res.json();
            msg = j?.details ? `${j.error}: ${j.details}` : (j?.error || msg);
          } catch (error) {
            try {
              msg = (await res.text()).slice(0, 220);
            } catch (innerError) {
            }
          }

          const policyError = /nft|nsfw|prohibid|unsafe|policy/i.test(msg);
          aiError.innerHTML = policyError
            ? 'La IA interpreta que querés generar una imagen de contenido prohibido. Probá reintentar y cambiar la descripción.'
            : `No se pudo generar la imagen. ${msg}. Podés reintentar.`;
          aiError.classList.remove('d-none');
          setPreview(DEFAULT_IMAGE);
          return;
        }

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        imageState.generatedBlob = blob;
        imageState.generatedUrl = url;
        setPreview(url);
      } catch (error) {
        aiError.textContent = `No se pudo conectar: ${error?.message || error}. Reintentá nuevamente.`;
        aiError.classList.remove('d-none');
        setPreview(DEFAULT_IMAGE);
      } finally {
        clearTimeout(t);
        aiGenerateBtn.disabled = false;
      }
    };

    radios.forEach((radio) => radio.addEventListener('change', toggleMethod));
    imageUrlInput.addEventListener('input', () => {
      if (imageState.method === 'url') {
        setPreview(normalizeValue(imageUrlInput.value) || DEFAULT_IMAGE);
      }
    });
    imageFileInput.addEventListener('change', () => {
      const file = imageFileInput.files && imageFileInput.files[0];
      const validationMessage = validateImageFile(file);
      if (validationMessage) {
        aiError.textContent = validationMessage;
        aiError.classList.remove('d-none');
        imageFileInput.value = '';
        setPreview(DEFAULT_IMAGE);
        return;
      }

      aiError.classList.add('d-none');
      setPreview(URL.createObjectURL(file));
    });
    aiGenerateBtn.addEventListener('click', generateByIa);
    aiPromptInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        generateByIa();
      }
    });

    toggleMethod();

    return async () => {
      const method = imageState.method;
      if (method === 'url') {
        return normalizeValue(imageUrlInput.value) || DEFAULT_IMAGE;
      }
      if (method === 'upload') {
        const file = imageFileInput.files && imageFileInput.files[0];
        const validationMessage = validateImageFile(file);
        if (validationMessage) {
          throw new Error(validationMessage);
        }
        const loading = document.createElement('span');
        loading.className = 'image-preview-overlay';
        loading.innerHTML = '<img src="./IMG/Meta-ai-logo.webp" class="meta-spinner-login" alt="Subiendo imagen">';
        preview.appendChild(loading);
        return uploadImageToStorage(file, 'ingredientes/uploads');
      }
      if (method === 'ai') {
        if (imageState.generatedBlob) {
          const aiFile = new File([imageState.generatedBlob], `ia_${Date.now()}.png`, { type: imageState.generatedBlob.type || 'image/png' });
          return uploadImageToStorage(aiFile, 'ingredientes/ia');
        }
        throw new Error('Generá una imagen de IA antes de guardar.');
      }
      return DEFAULT_IMAGE;
    };
  };

  const openFamilyForm = async (initialFamily = null) => {
    const isEdit = Boolean(initialFamily);
    let resolveImage = null;

    const result = await Swal.fire({
      title: isEdit ? 'Editar familia' : 'Crear familia',
      html: `
        <div class="ingrediente-form-grid">
          <div>
            <label for="familyNameInput">Nombre de familia *</label>
            <input id="familyNameInput" class="swal2-input ios-input" value="${initialFamily ? capitalizeLabel(initialFamily.name) : ''}" placeholder="Ej: Carnes">
          </div>
          ${buildImageOptionHtml('familyImage', { preview: initialFamily?.imageUrl || DEFAULT_IMAGE, url: initialFamily?.imageUrl || '' })}
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: isEdit ? 'Guardar familia' : 'Crear familia',
      cancelButtonText: 'Cancelar',
      customClass: {
        popup: 'ios-alert ingredientes-alert',
        title: 'ios-alert-title',
        htmlContainer: 'ios-alert-text',
        confirmButton: 'ios-btn ios-btn-primary',
        cancelButton: 'ios-btn ios-btn-secondary'
      },
      buttonsStyling: false,
      didOpen: () => {
        resolveImage = setupImageOptionEvents('familyImage');
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

    const familyId = initialFamily?.id || makeId('fam');
    const now = Date.now();
    state.ingredientes.familias[familyId] = {
      id: familyId,
      name: result.value.name,
      imageUrl: result.value.imageUrl,
      updatedAt: now,
      createdAt: initialFamily?.createdAt || now
    };

    Object.values(state.ingredientes.items).forEach((item) => {
      if (item.familyId === familyId) {
        item.familyName = result.value.name;
      }
    });

    await persistIngredientes();
    state.activeFamilyId = familyId;
    refreshView();
    return familyId;
  };

  const openIngredientForm = async (initialItem = null) => {
    const isEdit = Boolean(initialItem);
    let resolveImage = null;

    const families = getFamiliasArray().sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    const familyOptions = families.map((family) => `<option value="${family.id}" ${initialItem?.familyId === family.id ? 'selected' : ''}>${capitalizeLabel(family.name)}</option>`).join('');

    const measureOptions = allMeasures.map((measure) => `<option value="${measure}" ${normalizeLower(initialItem?.measure) === measure ? 'selected' : ''}>${capitalizeLabel(measure)}</option>`).join('');

    const result = await Swal.fire({
      title: isEdit ? 'Editar ingrediente' : 'Crear ingrediente',
      html: `
        <div class="ingrediente-form-grid">
          <div>
            <label for="ingredientNameInput">Nombre de ingrediente *</label>
            <input id="ingredientNameInput" class="swal2-input ios-input" value="${initialItem ? capitalizeLabel(initialItem.name) : ''}" placeholder="Ej: Jamón cocido">
          </div>

          <div>
            <label for="ingredientFamilySelect">Familia *</label>
            <div class="d-flex gap-2 align-items-center">
              <select id="ingredientFamilySelect" class="form-select ios-input" style="height:50px;">
                <option value="">Seleccioná una familia</option>
                ${familyOptions}
              </select>
              <button type="button" id="createFamilyInline" class="btn ios-btn ios-btn-secondary" style="max-width:180px;">Crear familia</button>
            </div>
          </div>

          <div>
            <label for="ingredientDescriptionInput">Descripción (opcional)</label>
            <textarea id="ingredientDescriptionInput" class="swal2-textarea ios-input" rows="5" placeholder="Descripción del ingrediente">${initialItem?.description || ''}</textarea>
          </div>

          <div>
            <label for="ingredientMeasureSelect">Medida *</label>
            <select id="ingredientMeasureSelect" class="form-select ios-input" style="height:50px;">
              <option value="">Seleccioná una medida</option>
              ${measureOptions}
              <option value="custom">Otra medida</option>
            </select>
            <input id="ingredientMeasureCustom" class="swal2-input ios-input d-none" placeholder="Escribí la medida">
          </div>

          ${buildImageOptionHtml('ingredientImage', { preview: initialItem?.imageUrl || DEFAULT_IMAGE, url: initialItem?.imageUrl || '' })}
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: isEdit ? 'Guardar ingrediente' : 'Crear ingrediente',
      cancelButtonText: 'Cancelar',
      customClass: {
        popup: 'ios-alert ingredientes-alert',
        title: 'ios-alert-title',
        htmlContainer: 'ios-alert-text',
        confirmButton: 'ios-btn ios-btn-primary',
        cancelButton: 'ios-btn ios-btn-secondary'
      },
      buttonsStyling: false,
      didOpen: () => {
        resolveImage = setupImageOptionEvents('ingredientImage');
        const measureSelect = document.getElementById('ingredientMeasureSelect');
        const measureCustom = document.getElementById('ingredientMeasureCustom');
        const familySelect = document.getElementById('ingredientFamilySelect');
        const createFamilyInline = document.getElementById('createFamilyInline');

        if (initialItem && !allMeasures.includes(normalizeLower(initialItem.measure))) {
          measureSelect.value = 'custom';
          measureCustom.value = initialItem.measure;
          measureCustom.classList.remove('d-none');
        }

        measureSelect.addEventListener('change', () => {
          const isCustom = measureSelect.value === 'custom';
          measureCustom.classList.toggle('d-none', !isCustom);
          if (!isCustom) {
            measureCustom.value = '';
          }
        });

        createFamilyInline.addEventListener('click', async () => {
          const createdFamilyId = await openFamilyForm();
          if (createdFamilyId) {
            const family = state.ingredientes.familias[createdFamilyId];
            if (family) {
              const option = document.createElement('option');
              option.value = family.id;
              option.textContent = capitalizeLabel(family.name);
              familySelect.appendChild(option);
              familySelect.value = family.id;
            }
          }
        });
      },
      preConfirm: async () => {
        const name = normalizeLower(document.getElementById('ingredientNameInput').value);
        const familyId = normalizeValue(document.getElementById('ingredientFamilySelect').value);
        const description = normalizeValue(document.getElementById('ingredientDescriptionInput').value);
        const measureSelect = document.getElementById('ingredientMeasureSelect').value;
        const customMeasure = normalizeLower(document.getElementById('ingredientMeasureCustom').value);
        const measure = measureSelect === 'custom' ? customMeasure : normalizeLower(measureSelect);

        if (!name) {
          Swal.showValidationMessage('El nombre del ingrediente es obligatorio.');
          return false;
        }

        if (!familyId) {
          Swal.showValidationMessage('Seleccioná o creá una familia.');
          return false;
        }

        if (!measure) {
          Swal.showValidationMessage('La medida es obligatoria.');
          return false;
        }

        const family = state.ingredientes.familias[familyId];
        if (!family) {
          Swal.showValidationMessage('La familia seleccionada no existe.');
          return false;
        }

        try {
          const imageUrl = await resolveImage();
          return { name, familyId, familyName: family.name, measure, description, imageUrl };
        } catch (error) {
          Swal.showValidationMessage(error.message);
          return false;
        }
      }
    });

    if (!result.isConfirmed) {
      return;
    }

    const itemId = initialItem?.id || makeId('ing');
    const now = Date.now();
    state.ingredientes.items[itemId] = {
      id: itemId,
      name: result.value.name,
      familyId: result.value.familyId,
      familyName: result.value.familyName,
      measure: result.value.measure,
      description: result.value.description,
      imageUrl: result.value.imageUrl,
      updatedAt: now,
      createdAt: initialItem?.createdAt || now
    };

    await persistIngredientes();
    state.activeFamilyId = result.value.familyId;
    refreshView();
  };

  const confirmDelete = async ({ title, text }) => {
    const result = await Swal.fire({
      title,
      html: `<p>${text}</p>`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar',
      reverseButtons: true,
      customClass: {
        popup: 'ios-alert',
        title: 'ios-alert-title',
        htmlContainer: 'ios-alert-text',
        confirmButton: 'ios-btn ios-btn-primary',
        cancelButton: 'ios-btn ios-btn-secondary'
      },
      buttonsStyling: false
    });
    return result.isConfirmed;
  };

  const handleDataClicks = async (event) => {
    const filterButton = event.target.closest('[data-family-filter]');
    if (filterButton) {
      state.activeFamilyId = filterButton.getAttribute('data-family-filter');
      renderFamilies();
      renderIngredientes();
      return;
    }

    const editFamilyButton = event.target.closest('[data-family-edit]');
    if (editFamilyButton) {
      const family = state.ingredientes.familias[editFamilyButton.getAttribute('data-family-edit')];
      if (family) {
        await openFamilyForm(family);
      }
      return;
    }

    const deleteFamilyButton = event.target.closest('[data-family-delete]');
    if (deleteFamilyButton) {
      const familyId = deleteFamilyButton.getAttribute('data-family-delete');
      const family = state.ingredientes.familias[familyId];
      if (!family) {
        return;
      }

      const linkedItems = getIngredientesArray().filter((item) => item.familyId === familyId);
      const ok = await confirmDelete({
        title: '¿Eliminar familia?',
        text: `Se eliminará la familia ${capitalizeLabel(family.name)} y ${linkedItems.length} ingrediente(s) asociado(s).`
      });

      if (!ok) {
        return;
      }

      delete state.ingredientes.familias[familyId];
      linkedItems.forEach((item) => {
        delete state.ingredientes.items[item.id];
      });
      if (state.activeFamilyId === familyId) {
        state.activeFamilyId = 'all';
      }
      await persistIngredientes();
      refreshView();
      return;
    }

    const editIngredientButton = event.target.closest('[data-ingrediente-edit]');
    if (editIngredientButton) {
      const ingredient = state.ingredientes.items[editIngredientButton.getAttribute('data-ingrediente-edit')];
      if (ingredient) {
        await openIngredientForm(ingredient);
      }
      return;
    }

    const deleteIngredientButton = event.target.closest('[data-ingrediente-delete]');
    if (deleteIngredientButton) {
      const ingredientId = deleteIngredientButton.getAttribute('data-ingrediente-delete');
      const ingredient = state.ingredientes.items[ingredientId];
      if (!ingredient) {
        return;
      }
      const ok = await confirmDelete({
        title: '¿Eliminar ingrediente?',
        text: `Se eliminará el ingrediente ${capitalizeLabel(ingredient.name)}.`
      });
      if (!ok) {
        return;
      }

      delete state.ingredientes.items[ingredientId];
      await persistIngredientes();
      refreshView();
    }
  };

  const loadIngredientes = async () => {
    if (!window.dbLaJamoneraRest) {
      showIngredientesState('empty');
      return;
    }

    showIngredientesState('loading');

    try {
      await fetchIngredientes();
      refreshView();
    } catch (error) {
      showIngredientesState('empty');
      Swal.fire({
        title: 'No se pudo cargar',
        html: '<p>Hubo un problema al leer ingredientes desde Firebase.</p>',
        icon: 'error',
        customClass: {
          popup: 'ios-alert',
          title: 'ios-alert-title',
          htmlContainer: 'ios-alert-text',
          confirmButton: 'ios-btn ios-btn-primary'
        },
        buttonsStyling: false,
        confirmButtonText: 'Entendido'
      });
    }
  };

  const closeSession = async () => {
    const result = await Swal.fire({
      title: '¿Cerrar sesión?',
      html: '<p>Tu sesión actual se cerrará en este dispositivo.</p>',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Sí, cerrar',
      cancelButtonText: 'Cancelar',
      reverseButtons: true,
      customClass: {
        popup: 'ios-alert',
        title: 'ios-alert-title',
        htmlContainer: 'ios-alert-text',
        confirmButton: 'ios-btn ios-btn-primary',
        cancelButton: 'ios-btn ios-btn-secondary'
      },
      buttonsStyling: false
    });

    if (result.isConfirmed) {
      localStorage.removeItem(SESSION_KEY);
      window.location.replace('./login.html');
    }
  };

  if (ingredientesModal) {
    ingredientesModal.addEventListener('show.bs.modal', loadIngredientes);
  }

  if (searchInput) {
    searchInput.addEventListener('input', (event) => {
      state.search = normalizeLower(event.target.value);
      renderIngredientes();
    });
  }

  if (createIngredientBtn) {
    createIngredientBtn.addEventListener('click', () => openIngredientForm());
  }

  if (emptyCreateIngredientBtn) {
    emptyCreateIngredientBtn.addEventListener('click', () => openIngredientForm());
  }

  if (ingredientesData) {
    ingredientesData.addEventListener('click', handleDataClicks);
  }

  logoutButtons.forEach((button) => {
    button.addEventListener('click', closeSession);
  });
})();
