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
  const recetasList = document.getElementById('recetasList');
  const recetasSearchInput = document.getElementById('recetasSearchInput');
  const createRecipeBtn = document.getElementById('createRecipeBtn');
  const emptyCreateRecipeBtn = document.getElementById('emptyCreateRecipeBtn');

  const state = {
    recetas: {},
    ingredientes: {},
    familias: {},
    measures: [],
    search: ''
  };

  const normalizeValue = (value) => String(value || '').trim();
  const normalizeLower = (value) => normalizeValue(value).toLowerCase();
  const capitalize = (value) => normalizeLower(value).replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
  const safeObject = (value) => (value && typeof value === 'object' ? value : {});
  const makeId = (prefix) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const blurActiveElement = () => {
    const active = document.activeElement;
    if (active && typeof active.blur === 'function') {
      active.blur();
    }
  };

  const openIosSwal = (options) => {
    blurActiveElement();
    recetasModal.setAttribute('inert', '');
    return Swal.fire({
      ...options,
      returnFocus: false,
      willClose: () => {
        recetasModal.removeAttribute('inert');
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

  const showState = (key) => {
    recetasLoading.classList.toggle('d-none', key !== 'loading');
    recetasEmpty.classList.toggle('d-none', key !== 'empty');
    recetasData.classList.toggle('d-none', key !== 'data');
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
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt })
    });

    if (!response.ok) {
      throw new Error('No se pudo generar la imagen con IA.');
    }

    const blob = await response.blob();
    if (!blob || !blob.size) throw new Error('La IA no devolvió una imagen válida.');

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
    const safe = safeObject(data);
    state.ingredientes = safeObject(safe.items);
    state.familias = safeObject(safe.familias);
    state.measures = Array.isArray(safe.config?.measures) ? safe.config.measures : [];
  };

  const fetchRecetas = async () => {
    await window.laJamoneraReady;
    const data = await window.dbLaJamoneraRest.read('/recetas');
    state.recetas = safeObject(data);
  };

  const persistRecetas = async () => {
    await window.laJamoneraReady;
    await window.dbLaJamoneraRest.write('/recetas', state.recetas);
  };

  const formatDate = (value) => {
    const date = new Date(value || Date.now());
    return date.toLocaleDateString('es-AR', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  };

  const renderRecetas = () => {
    const source = getRecetasArray()
      .filter((item) => {
        const q = normalizeLower(state.search);
        if (!q) return true;
        return normalizeLower(item.title).includes(q) || normalizeLower(item.description).includes(q);
      })
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
              <button type="button" class="btn family-manage-btn" data-receta-edit="${item.id}"><i class="fa-solid fa-pen"></i></button>
              <button type="button" class="btn family-manage-btn" data-receta-delete="${item.id}"><i class="fa-solid fa-trash"></i></button>
            </div>
          </div>
          <p class="mb-1">${item.description ? capitalize(item.description) : '<em>Sin descripción</em>'}</p>
          <small class="receta-card-meta">Actualizada: ${formatDate(item.updatedAt)}</small>
        </article>
      `;
    }).join('');

    showState('data');
  };

  const openRecipeForm = async (initial = null) => {
    await fetchIngredientesData();
    const measureOptions = getMeasureOptions();

    const rowsSeed = Array.isArray(initial?.rows) && initial.rows.length
      ? initial.rows.map((row) => ({ ...row, id: row.id || makeId('row') }))
      : [{ id: makeId('row'), type: 'ingredient', ingredientId: '', ingredientName: '', quantity: '', unit: measureOptions[0]?.value || '' }];

    const formState = {
      rows: rowsSeed,
      imageMode: 'url',
      imageUrl: initial?.imageUrl || '',
      imagePrompt: '',
      uploadFile: null,
      orderMode: initial?.orderMode || 'desc'
    };

    const title = initial ? 'Editar receta' : 'Nueva receta';
    const answer = await openIosSwal({
      title,
      width: 1180,
      showCancelButton: true,
      confirmButtonText: initial ? 'Guardar cambios' : 'Crear receta',
      cancelButtonText: 'Cancelar',
      html: `
        <div class="recipe-form-grid text-start">
          <div class="row g-2">
            <div class="col-md-6">
              <label class="form-label">Título *</label>
              <input id="recipeTitle" class="swal2-input ios-input" value="${initial ? initial.title : ''}" placeholder="Ej: Chorizo parrillero">
            </div>
            <div class="col-md-6">
              <label class="form-label">Descripción (opcional)</label>
              <input id="recipeDescription" class="swal2-input ios-input" value="${initial ? (initial.description || '') : ''}" placeholder="Detalle breve">
            </div>
            <div class="col-md-4">
              <label class="form-label">Cantidad final obtenida *</label>
              <input id="recipeYieldQty" class="swal2-input ios-input" value="${initial ? (initial.yieldQuantity || '') : ''}" placeholder="Ej: 10,50">
            </div>
            <div class="col-md-4">
              <label class="form-label">Unidad de medida *</label>
              <select id="recipeYieldUnit" class="form-select ios-input">${measureOptions.map((item) => `<option value="${item.value}" ${normalizeLower(initial?.yieldUnit) === item.value ? 'selected' : ''}>${item.label}</option>`).join('')}</select>
            </div>
            <div class="col-md-4">
              <label class="form-label">Orden de ingredientes</label>
              <select id="recipeOrderMode" class="form-select ios-input">
                <option value="desc" ${formState.orderMode === 'desc' ? 'selected' : ''}>De mayor a menor</option>
                <option value="asc" ${formState.orderMode === 'asc' ? 'selected' : ''}>De menor a mayor</option>
                <option value="custom" ${formState.orderMode === 'custom' ? 'selected' : ''}>Personalizado</option>
              </select>
            </div>
          </div>

          <div class="recipe-table-wrap">
            <table class="recipe-table">
              <thead>
                <tr>
                  <th style="width:36px">↕</th>
                  <th>Ingrediente / Comentario</th>
                  <th style="width:120px">Cantidad</th>
                  <th style="width:220px">Unidad</th>
                  <th style="width:60px">Acción</th>
                </tr>
              </thead>
              <tbody id="recipeRowsBody"></tbody>
            </table>
          </div>

          <div class="d-flex flex-wrap gap-2 justify-content-end">
            <button type="button" class="btn ios-btn ios-btn-secondary" id="addIngredientRowBtn">Agregar fila</button>
            <button type="button" class="btn ios-btn ios-btn-secondary" id="addCommentRowBtn">Agregar comentario</button>
          </div>

          <div class="row g-2">
            <div class="col-md-3">
              <label class="form-label">Imagen: método</label>
              <select id="recipeImageMode" class="form-select ios-input">
                <option value="url">URL</option>
                <option value="upload">Subir archivo</option>
                <option value="ai">Generar con IA</option>
              </select>
            </div>
            <div class="col-md-9" id="recipeImageInputs"></div>
          </div>
        </div>
      `,
      didOpen: (popup) => {
        const rowsBody = popup.querySelector('#recipeRowsBody');
        const orderSelect = popup.querySelector('#recipeOrderMode');
        const imageModeSelect = popup.querySelector('#recipeImageMode');
        const imageInputs = popup.querySelector('#recipeImageInputs');

        let draggingId = '';

        const renderImageInputs = () => {
          if (!imageInputs) return;
          if (formState.imageMode === 'upload') {
            imageInputs.innerHTML = '<label class="form-label">Subir imagen</label><input id="recipeImageUpload" type="file" class="form-control image-file-input" accept="image/*">';
            const input = imageInputs.querySelector('#recipeImageUpload');
            input?.addEventListener('change', (event) => {
              formState.uploadFile = event.target.files?.[0] || null;
            });
            return;
          }
          if (formState.imageMode === 'ai') {
            imageInputs.innerHTML = `<label class="form-label">Prompt IA</label><div class="ios-input-group d-flex align-items-center px-2"><img src="${IA_ICON_SRC}" alt="IA" class="meta-spinner-login"><input id="recipeImagePrompt" class="swal2-input ios-input border-0 bg-transparent flex-grow-1" placeholder="Ej: foto realista del producto terminado" value="${formState.imagePrompt || ''}"></div>`;
            imageInputs.querySelector('#recipeImagePrompt')?.addEventListener('input', (event) => {
              formState.imagePrompt = event.target.value;
            });
            return;
          }
          imageInputs.innerHTML = `<label class="form-label">URL de imagen</label><input id="recipeImageUrl" class="swal2-input ios-input" value="${formState.imageUrl || ''}" placeholder="https://...">`;
          imageInputs.querySelector('#recipeImageUrl')?.addEventListener('input', (event) => {
            formState.imageUrl = event.target.value;
          });
        };

        const renderRows = () => {
          rowsBody.innerHTML = formState.rows.map((row, index) => {
            if (row.type === 'comment') {
              return `
                <tr class="is-comment" data-row-id="${row.id}" draggable="${formState.orderMode === 'custom'}">
                  <td><i class="fa-solid fa-grip-lines"></i></td>
                  <td colspan="3"><input class="form-control ios-input" data-comment-input="${row.id}" value="${row.comment || ''}" placeholder="Comentario visual (no afecta receta)"></td>
                  <td><button type="button" class="btn family-manage-btn" data-remove-row="${row.id}"><i class="fa-solid fa-trash"></i></button></td>
                </tr>
              `;
            }

            const suggestId = `suggest_${row.id}`;
            return `
              <tr data-row-id="${row.id}" draggable="${formState.orderMode === 'custom'}">
                <td><i class="fa-solid fa-grip-lines"></i></td>
                <td>
                  <div class="recipe-ing-autocomplete">
                    <input class="form-control ios-input" data-ing-input="${row.id}" value="${row.ingredientName || ''}" placeholder="Buscar ingrediente...">
                    <div class="recipe-suggest-list d-none" id="${suggestId}"></div>
                  </div>
                </td>
                <td><input class="form-control ios-input" data-qty-input="${row.id}" value="${row.quantity || ''}" placeholder="0,00"></td>
                <td>
                  <select class="form-select ios-input" data-unit-input="${row.id}">
                    ${measureOptions.map((item) => `<option value="${item.value}" ${normalizeLower(row.unit) === item.value ? 'selected' : ''}>${item.label}</option>`).join('')}
                  </select>
                </td>
                <td><button type="button" class="btn family-manage-btn" data-remove-row="${row.id}"><i class="fa-solid fa-trash"></i></button></td>
              </tr>
            `;
          }).join('');
        };

        const reorderRows = (fromId, toId) => {
          const fromIndex = formState.rows.findIndex((row) => row.id === fromId);
          const toIndex = formState.rows.findIndex((row) => row.id === toId);
          if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;
          const [moved] = formState.rows.splice(fromIndex, 1);
          formState.rows.splice(toIndex, 0, moved);
          renderRows();
        };

        const setSuggestionList = async (rowId, query) => {
          const box = rowsBody.querySelector(`#suggest_${rowId}`);
          if (!box) return;
          const source = getIngredientesArray();
          const filtered = source.filter((item) => normalizeLower(item.name).includes(normalizeLower(query))).slice(0, 10);

          const itemsHtml = filtered.map((item) => `
            <button type="button" class="recipe-suggest-item" data-pick-ingredient="${rowId}" data-ing-id="${item.id}">
              <img class="recipe-suggest-avatar" src="${item.imageUrl || './IMG/La Jamonera Cerdito.webp'}" alt="${capitalize(item.name)}">
              <span>${capitalize(item.name)}</span>
            </button>
          `).join('');

          const createHtml = `<button type="button" class="recipe-suggest-item" data-create-ingredient-inline="${rowId}"><i class="fa-solid fa-plus"></i><span>Crear ingrediente</span></button>`;
          box.innerHTML = `${itemsHtml}${createHtml}`;
          box.classList.remove('d-none');
        };

        imageModeSelect?.addEventListener('change', (event) => {
          formState.imageMode = event.target.value;
          renderImageInputs();
        });

        orderSelect?.addEventListener('change', (event) => {
          formState.orderMode = event.target.value;
          renderRows();
        });

        popup.querySelector('#addIngredientRowBtn')?.addEventListener('click', () => {
          formState.rows.push({ id: makeId('row'), type: 'ingredient', ingredientId: '', ingredientName: '', quantity: '', unit: measureOptions[0]?.value || '' });
          renderRows();
        });

        popup.querySelector('#addCommentRowBtn')?.addEventListener('click', () => {
          formState.rows.push({ id: makeId('row'), type: 'comment', comment: '' });
          renderRows();
        });

        rowsBody.addEventListener('input', (event) => {
          const qtyInput = event.target.closest('[data-qty-input]');
          if (qtyInput) {
            const row = formState.rows.find((item) => item.id === qtyInput.dataset.qtyInput);
            if (!row) return;
            qtyInput.value = qtyInput.value.replaceAll('.', ',');
            row.quantity = qtyInput.value;
            return;
          }

          const commentInput = event.target.closest('[data-comment-input]');
          if (commentInput) {
            const row = formState.rows.find((item) => item.id === commentInput.dataset.commentInput);
            if (row) row.comment = commentInput.value;
            return;
          }

          const ingInput = event.target.closest('[data-ing-input]');
          if (ingInput) {
            const row = formState.rows.find((item) => item.id === ingInput.dataset.ingInput);
            if (!row) return;
            row.ingredientName = ingInput.value;
            row.ingredientId = '';
            setSuggestionList(row.id, ingInput.value);
          }
        });

        rowsBody.addEventListener('change', (event) => {
          const unitInput = event.target.closest('[data-unit-input]');
          if (unitInput) {
            const row = formState.rows.find((item) => item.id === unitInput.dataset.unitInput);
            if (row) row.unit = unitInput.value;
          }
        });

        rowsBody.addEventListener('click', async (event) => {
          const removeBtn = event.target.closest('[data-remove-row]');
          if (removeBtn) {
            formState.rows = formState.rows.filter((item) => item.id !== removeBtn.dataset.removeRow);
            renderRows();
            return;
          }

          const pickBtn = event.target.closest('[data-pick-ingredient]');
          if (pickBtn) {
            const row = formState.rows.find((item) => item.id === pickBtn.dataset.pickIngredient);
            const ing = state.ingredientes[pickBtn.dataset.ingId];
            if (!row || !ing) return;
            row.ingredientId = ing.id;
            row.ingredientName = capitalize(ing.name);
            row.unit = normalizeLower(ing.measure || row.unit);
            renderRows();
            return;
          }

          const createBtn = event.target.closest('[data-create-ingredient-inline]');
          if (createBtn) {
            if (window.laJamoneraIngredientesAPI?.openIngredientForm) {
              await window.laJamoneraIngredientesAPI.openIngredientForm();
              await fetchIngredientesData();
              renderRows();
            }
          }
        });

        rowsBody.addEventListener('focusin', (event) => {
          const input = event.target.closest('[data-ing-input]');
          if (input) {
            setSuggestionList(input.dataset.ingInput, input.value);
          }
        });

        rowsBody.addEventListener('focusout', (event) => {
          const input = event.target.closest('[data-ing-input]');
          if (!input) return;
          setTimeout(() => {
            const box = rowsBody.querySelector(`#suggest_${input.dataset.ingInput}`);
            box?.classList.add('d-none');
          }, 120);
        });

        rowsBody.addEventListener('dragstart', (event) => {
          const row = event.target.closest('tr[data-row-id]');
          if (!row || formState.orderMode !== 'custom') return;
          draggingId = row.dataset.rowId;
          row.classList.add('is-dragging');
          event.dataTransfer.effectAllowed = 'move';
        });

        rowsBody.addEventListener('dragend', (event) => {
          const row = event.target.closest('tr[data-row-id]');
          row?.classList.remove('is-dragging');
          rowsBody.querySelectorAll('.drag-over').forEach((node) => node.classList.remove('drag-over'));
          draggingId = '';
        });

        rowsBody.addEventListener('dragover', (event) => {
          const row = event.target.closest('tr[data-row-id]');
          if (!row || formState.orderMode !== 'custom') return;
          event.preventDefault();
          rowsBody.querySelectorAll('.drag-over').forEach((node) => node.classList.remove('drag-over'));
          row.classList.add('drag-over');
        });

        rowsBody.addEventListener('drop', (event) => {
          const row = event.target.closest('tr[data-row-id]');
          if (!row || !draggingId || formState.orderMode !== 'custom') return;
          event.preventDefault();
          reorderRows(draggingId, row.dataset.rowId);
        });

        renderRows();
        renderImageInputs();
      },
      preConfirm: async () => {
        const titleValue = normalizeValue(document.getElementById('recipeTitle')?.value);
        const description = normalizeValue(document.getElementById('recipeDescription')?.value);
        const yieldQuantity = normalizeValue(document.getElementById('recipeYieldQty')?.value).replaceAll('.', ',');
        const yieldUnit = normalizeLower(document.getElementById('recipeYieldUnit')?.value);
        const orderMode = normalizeLower(document.getElementById('recipeOrderMode')?.value);

        if (!titleValue) {
          Swal.showValidationMessage('El título es obligatorio.');
          return false;
        }
        if (!yieldQuantity) {
          Swal.showValidationMessage('Completá la cantidad obtenida.');
          return false;
        }
        if (!yieldUnit) {
          Swal.showValidationMessage('Seleccioná una unidad de medida.');
          return false;
        }

        const rows = formState.rows
          .map((row) => {
            if (row.type === 'comment') {
              return {
                id: row.id,
                type: 'comment',
                comment: normalizeValue(row.comment)
              };
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
          .filter((row) => (row.type === 'comment' ? row.comment : row.ingredientName));

        if (!rows.length) {
          Swal.showValidationMessage('Agregá al menos una fila válida en la receta.');
          return false;
        }

        let imageUrl = normalizeValue(formState.imageUrl || initial?.imageUrl || '');

        if (formState.imageMode === 'upload' && formState.uploadFile) {
          const msg = validateImageFile(formState.uploadFile);
          if (msg) {
            Swal.showValidationMessage(msg);
            return false;
          }
          imageUrl = await uploadImageToStorage(formState.uploadFile, 'recetas/uploads');
        }

        if (formState.imageMode === 'ai' && normalizeValue(formState.imagePrompt)) {
          const aiFile = await generateImageWithIA(normalizeValue(formState.imagePrompt));
          imageUrl = await uploadImageToStorage(aiFile, 'recetas/ia');
        }

        if (formState.imageMode === 'url') {
          const field = document.getElementById('recipeImageUrl');
          imageUrl = normalizeValue(field?.value);
        }

        return {
          title: titleValue,
          description,
          yieldQuantity,
          yieldUnit,
          orderMode,
          rows,
          imageUrl
        };
      }
    });

    if (!answer.isConfirmed) return;

    const id = initial?.id || makeId('rec');
    state.recetas[id] = {
      id,
      ...answer.value,
      createdAt: initial?.createdAt || Date.now(),
      updatedAt: Date.now()
    };

    await persistRecetas();
    renderRecetas();
  };

  const removeRecipe = async (recipeId) => {
    const item = state.recetas[recipeId];
    if (!item) return;

    const ok = await openIosSwal({
      title: 'Eliminar receta',
      html: `<p>Vas a eliminar <strong>${capitalize(item.title)}</strong>.</p><p class="mb-0">Esta acción no se puede deshacer.</p>`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Eliminar',
      cancelButtonText: 'Cancelar'
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
      showState(getRecetasArray().length ? 'data' : 'empty');
    } catch (error) {
      showState('empty');
      await openIosSwal({
        title: 'No se pudo cargar',
        html: '<p>Error leyendo recetas desde Firebase.</p>',
        icon: 'error',
        confirmButtonText: 'Entendido'
      });
    }
  };

  recetasModal.addEventListener('hide.bs.modal', blurActiveElement);
  recetasModal.addEventListener('hidden.bs.modal', () => {
    blurActiveElement();
    recetasModal.removeAttribute('inert');
  });
  recetasModal.addEventListener('show.bs.modal', loadRecetas);

  recetasSearchInput?.addEventListener('input', (event) => {
    state.search = normalizeLower(event.target.value);
    renderRecetas();
  });

  createRecipeBtn?.addEventListener('click', () => openRecipeForm());
  emptyCreateRecipeBtn?.addEventListener('click', () => openRecipeForm());

  recetasData?.addEventListener('click', async (event) => {
    const editBtn = event.target.closest('[data-receta-edit]');
    if (editBtn) {
      const recipe = state.recetas[editBtn.dataset.recetaEdit];
      if (recipe) await openRecipeForm(recipe);
      return;
    }

    const deleteBtn = event.target.closest('[data-receta-delete]');
    if (deleteBtn) {
      await removeRecipe(deleteBtn.dataset.recetaDelete);
    }
  });
})();
