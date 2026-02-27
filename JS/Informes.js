(function informesModule() {
  const informesModal = document.getElementById('informesModal');
  if (!informesModal) {
    return;
  }

  const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;
  const USER_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

  const informesLoading = document.getElementById('informesLoading');
  const informesData = document.getElementById('informesData');
  const openUserFormBtn = document.getElementById('openUserFormBtn');
  const informesUsersList = document.getElementById('informesUsersList');
  const informeDateInput = document.getElementById('informeDateInput');
  const informeUserSelect = document.getElementById('informeUserSelect');
  const informeEditor = document.getElementById('informeEditor');
  const fontSizeSelect = document.getElementById('fontSizeSelect');
  const attachFilesBtn = document.getElementById('attachFilesBtn');
  const attachmentsInput = document.getElementById('attachmentsInput');
  const attachmentsGrid = document.getElementById('attachmentsGrid');
  const saveInformeBtn = document.getElementById('saveInformeBtn');
  const importanceRange = document.getElementById('importanceRange');

  const imageViewerModalEl = document.getElementById('imageViewerModal');
  const viewerImage = document.getElementById('viewerImage');
  const viewerPrevBtn = document.getElementById('viewerPrevBtn');
  const viewerNextBtn = document.getElementById('viewerNextBtn');
  const viewerZoomInBtn = document.getElementById('viewerZoomInBtn');
  const viewerZoomOutBtn = document.getElementById('viewerZoomOutBtn');

  const state = {
    users: {},
    attachments: [],
    imageViewerIndex: 0,
    viewerScale: 1,
    reportsByDate: {}
  };

  let datePicker = null;
  let imageViewerModal = null;

  const normalizeValue = (value) => String(value || '').trim();
  const normalizeLower = (value) => normalizeValue(value).toLowerCase();
  const makeId = (prefix) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const openIosSwal = (options) => Swal.fire({
    ...options,
    customClass: {
      popup: `ios-alert informes-alert ${options?.customClass?.popup || ''}`.trim(),
      title: 'ios-alert-title',
      htmlContainer: 'ios-alert-text',
      confirmButton: 'ios-btn ios-btn-primary',
      cancelButton: 'ios-btn ios-btn-secondary',
      ...options.customClass
    },
    buttonsStyling: false
  });

  const initialsFromName = (fullName) => {
    const parts = normalizeValue(fullName).split(/\s+/).filter(Boolean);
    if (!parts.length) return '??';
    const initial = parts.slice(0, 2).map((p) => p[0].toUpperCase()).join('');
    return initial || '??';
  };

  const showState = (key) => {
    informesLoading.classList.toggle('d-none', key !== 'loading');
    informesData.classList.toggle('d-none', key !== 'data');
  };

  const getDateParts = (date) => {
    const year = String(date.getFullYear());
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return { year, month, day };
  };

  const getCurrentDate = () => {
    if (datePicker && datePicker.selectedDates && datePicker.selectedDates[0]) {
      return datePicker.selectedDates[0];
    }
    return new Date();
  };

  const getFileCategory = (file) => file.type.startsWith('image/') ? 'image' : 'doc';

  const fileIcon = (file) => {
    const name = normalizeLower(file.name);
    if (name.endsWith('.pdf')) return 'bi-file-earmark-pdf';
    if (name.endsWith('.doc') || name.endsWith('.docx')) return 'bi-file-earmark-word';
    if (name.endsWith('.xls') || name.endsWith('.xlsx') || name.endsWith('.csv')) return 'bi-file-earmark-excel';
    return 'bi-file-earmark-text';
  };

  const renderUserAvatar = (user) => {
    if (user.photoUrl) {
      return `<span class="user-avatar-thumb"><span class="thumb-loading"><img class="meta-spinner-login" src="./IMG/Meta-ai-logo.webp" alt="Cargando"></span><img class="thumb-image js-user-photo" src="${user.photoUrl}" alt="${user.fullName}"></span>`;
    }
    return `<span class="user-avatar-thumb user-avatar-initials">${initialsFromName(user.fullName)}</span>`;
  };

  const prepareThumbLoaders = (selector) => {
    const nodes = Array.from(document.querySelectorAll(selector));
    nodes.forEach((img) => {
      const parent = img.closest('.user-avatar-thumb');
      const spinner = parent ? parent.querySelector('.thumb-loading') : null;
      const done = () => {
        img.classList.add('is-loaded');
        if (spinner) spinner.remove();
      };
      if (img.complete) {
        done();
      } else {
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', () => {
          if (spinner) spinner.remove();
        }, { once: true });
      }
    });
  };

  const renderUsers = () => {
    const users = Object.values(state.users).sort((a, b) => String(a.fullName).localeCompare(String(b.fullName)));

    if (!users.length) {
      informesUsersList.innerHTML = '<div class="informes-empty">No hay usuarios cargados.</div>';
      renderUserSelect();
      return;
    }

    informesUsersList.innerHTML = users.map((user) => `
      <article class="user-card">
        ${renderUserAvatar(user)}
        <div class="user-main">
          <h6>${user.fullName}</h6>
          <p>${user.position}</p>
        </div>
        <div class="ingrediente-actions">
          <button class="ingrediente-action" type="button" data-user-edit="${user.id}" title="Editar usuario"><i class="fa-solid fa-pen"></i></button>
          <button class="ingrediente-action" type="button" data-user-delete="${user.id}" title="Eliminar usuario"><i class="fa-solid fa-trash"></i></button>
        </div>
      </article>
    `).join('');

    renderUserSelect();
    prepareThumbLoaders('.js-user-photo');
  };

  const renderUserSelect = () => {
    const users = Object.values(state.users).sort((a, b) => String(a.fullName).localeCompare(String(b.fullName)));
    const current = informeUserSelect.value;

    const options = users.map((user) => `<option value="${user.id}">${user.fullName} (${user.position})</option>`).join('');
    informeUserSelect.innerHTML = `<option value="">Seleccioná un usuario</option>${options}<option value="create">Cargar usuario</option>`;

    if (current && state.users[current]) {
      informeUserSelect.value = current;
    }
  };

  const renderAttachments = () => {
    if (!state.attachments.length) {
      attachmentsGrid.innerHTML = '<div class="informes-empty">No hay archivos adjuntos.</div>';
      return;
    }

    attachmentsGrid.innerHTML = state.attachments.map((item, idx) => {
      if (item.type === 'image') {
        return `
          <button type="button" class="attachment-card" data-view-image="${idx}">
            <span class="attachment-loader"><img src="./IMG/Meta-ai-logo.webp" alt="Cargando" class="meta-spinner-login"></span>
            <img src="${item.previewUrl}" alt="${item.file.name}" class="attachment-image js-attachment-preview">
          </button>
        `;
      }

      return `
        <div class="attachment-card attachment-doc">
          <i class="bi ${fileIcon(item.file)}"></i>
          <span>${item.file.name}</span>
        </div>
      `;
    }).join('');

    const previews = Array.from(attachmentsGrid.querySelectorAll('.js-attachment-preview'));
    previews.forEach((img) => {
      const loader = img.parentElement.querySelector('.attachment-loader');
      const done = () => {
        img.classList.add('is-loaded');
        if (loader) loader.remove();
      };
      if (img.complete) {
        done();
      } else {
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', () => {
          if (loader) loader.remove();
        }, { once: true });
      }
    });
  };

  const loadData = async () => {
    showState('loading');
    try {
      await window.laJamoneraReady;
      const users = await window.dbLaJamoneraRest.read('/informes/users');
      state.users = users && typeof users === 'object' ? users : {};
      renderUsers();
      renderAttachments();
      showState('data');
    } catch (error) {
      await openIosSwal({ title: 'Error', html: '<p>No se pudieron cargar los datos de informes.</p>', icon: 'error', confirmButtonText: 'Entendido' });
      showState('data');
    }
  };

  const uploadToStorage = async (file, basePath) => {
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
    const refPath = `${basePath}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const ref = window.storageLaJamonera.ref().child(refPath);
    await ref.put(file);
    return ref.getDownloadURL();
  };

  const promptUserKey = async () => {
    const keyCheck = await openIosSwal({
      title: 'Verificar clave',
      input: 'password',
      inputLabel: 'Ingresá la clave de 4 dígitos',
      inputAttributes: { maxlength: 4, inputmode: 'numeric' },
      confirmButtonText: 'Validar',
      showCancelButton: true,
      cancelButtonText: 'Cancelar',
      preConfirm: (val) => {
        if (!/^\d{4}$/.test(String(val || ''))) {
          Swal.showValidationMessage('La clave debe tener 4 dígitos numéricos.');
          return false;
        }
        return String(val);
      }
    });
    return keyCheck;
  };

  const openUserForm = async (initial = null) => {
    let pendingUpload = null;
    const result = await openIosSwal({
      title: initial ? 'Editar usuario' : 'Cargar usuario',
      showCancelButton: true,
      confirmButtonText: initial ? 'Guardar cambios' : 'Crear usuario',
      cancelButtonText: 'Cancelar',
      html: `
        <div class="ingrediente-form-grid">
          <section class="step-block">
            <h6 class="step-title">1) Datos personales</h6>
            <div class="step-content">
              <label for="userFullName">Nombre y apellido *</label>
              <input id="userFullName" class="swal2-input ios-input" value="${initial ? initial.fullName : ''}">
              <label for="userPosition">Puesto en la empresa *</label>
              <input id="userPosition" class="swal2-input ios-input" value="${initial ? initial.position : ''}">
              <label for="userPin">Clave de 4 dígitos *</label>
              <input id="userPin" class="swal2-input ios-input" type="password" maxlength="4" inputmode="numeric" value="${initial ? initial.pin : ''}">
            </div>
          </section>
          <section class="step-block">
            <h6 class="step-title">2) Fotografía (opcional)</h6>
            <div class="step-content">
              <div id="userPhotoPreview" class="image-preview-circle">${initial?.photoUrl ? `<img src="${initial.photoUrl}" alt="Foto">` : '<span class="image-placeholder-circle-2 user-initials-preview">??</span>'}</div>
              <input id="userPhotoInput" type="file" class="form-control image-file-input" accept="image/*">
            </div>
          </section>
        </div>
      `,
      didOpen: () => {
        const fullNameInput = document.getElementById('userFullName');
        const photoInput = document.getElementById('userPhotoInput');
        const preview = document.getElementById('userPhotoPreview');

        const updateInitials = () => {
          if (pendingUpload || (initial && initial.photoUrl)) {
            return;
          }
          preview.innerHTML = `<span class="image-placeholder-circle-2 user-initials-preview">${initialsFromName(fullNameInput.value)}</span>`;
        };

        fullNameInput.addEventListener('input', updateInitials);
        updateInitials();

        photoInput.addEventListener('change', async () => {
          const file = photoInput.files && photoInput.files[0];
          if (!file) return;
          if (!USER_PHOTO_TYPES.includes(file.type) || file.size > MAX_UPLOAD_SIZE_BYTES) {
            photoInput.value = '';
            return;
          }
          pendingUpload = file;
          preview.innerHTML = `<span class="image-preview-overlay"><img src="./IMG/Meta-ai-logo.webp" alt="Subiendo" class="meta-spinner-login"></span>`;
          const tmp = URL.createObjectURL(file);
          setTimeout(() => {
            preview.innerHTML = `<img src="${tmp}" alt="Vista previa">`;
          }, 600);
        });
      },
      preConfirm: async () => {
        const fullName = normalizeValue(document.getElementById('userFullName').value);
        const position = normalizeValue(document.getElementById('userPosition').value);
        const pin = normalizeValue(document.getElementById('userPin').value);

        if (!fullName || !position) {
          Swal.showValidationMessage('Completá nombre y puesto.');
          return false;
        }
        if (!/^\d{4}$/.test(pin)) {
          Swal.showValidationMessage('La clave debe tener 4 dígitos.');
          return false;
        }

        let photoUrl = initial?.photoUrl || '';
        if (pendingUpload) {
          try {
            await window.laJamoneraReady;
            photoUrl = await uploadToStorage(pendingUpload, 'informes/users');
          } catch (error) {
            Swal.showValidationMessage('No se pudo subir la foto.');
            return false;
          }
        }

        return { fullName, position, pin, photoUrl };
      }
    });

    if (!result.isConfirmed) {
      return null;
    }

    const id = initial?.id || makeId('usr');
    const payload = {
      id,
      ...result.value,
      createdAt: initial?.createdAt || Date.now(),
      updatedAt: Date.now()
    };

    state.users[id] = payload;
    await window.dbLaJamoneraRest.write('/informes/users', state.users);
    renderUsers();
    return id;
  };

  const saveInforme = async () => {
    const selectedUserId = normalizeValue(informeUserSelect.value);
    const editorHtml = normalizeValue(informeEditor.innerHTML);

    if (!selectedUserId || !state.users[selectedUserId]) {
      await openIosSwal({ title: 'Falta usuario', html: '<p>Seleccioná un usuario válido para guardar.</p>', icon: 'warning', confirmButtonText: 'Entendido' });
      return;
    }
    if (!editorHtml) {
      await openIosSwal({ title: 'Falta contenido', html: '<p>Escribí el contenido del informe.</p>', icon: 'warning', confirmButtonText: 'Entendido' });
      return;
    }

    const date = getCurrentDate();
    const { year, month, day } = getDateParts(date);
    const reportId = makeId('inf');

    Swal.fire({
      title: 'Guardando informe...',
      html: '<img src="./IMG/Meta-ai-logo.webp" alt="Guardando" class="meta-spinner-login">',
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false,
      customClass: { popup: 'ios-alert informes-alert', title: 'ios-alert-title', htmlContainer: 'ios-alert-text' }
    });

    try {
      await window.laJamoneraReady;
      const attachmentsSaved = [];

      for (const item of state.attachments) {
        const folder = item.type === 'image' ? 'images' : 'docs';
        const storagePath = `informes/${year}/${month}/${day}/${reportId}/${folder}`;
        const url = await uploadToStorage(item.file, storagePath);
        attachmentsSaved.push({
          name: item.file.name,
          type: item.type,
          mime: item.file.type,
          size: item.file.size,
          url
        });
      }

      const basePath = `/informes/${year}/${month}/${day}/${reportId}`;
      const reportPayload = {
        id: reportId,
        createdAt: Date.now(),
        reportDate: `${year}-${month}-${day}`,
        userId: selectedUserId,
        userName: state.users[selectedUserId].fullName,
        userPosition: state.users[selectedUserId].position,
        html: editorHtml,
        importance: Number(importanceRange.value || 50),
        attachments: attachmentsSaved
      };

      await window.dbLaJamoneraRest.write(basePath, reportPayload);
      await window.dbLaJamoneraRest.write(`/informes_index/${year}/${month}/${day}/${reportId}`, {
        id: reportId,
        reportDate: `${year}-${month}-${day}`,
        userId: selectedUserId,
        userName: state.users[selectedUserId].fullName,
        importance: Number(importanceRange.value || 50),
        createdAt: Date.now(),
        attachmentsCount: attachmentsSaved.length
      });

      state.attachments.forEach((item) => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
      state.attachments = [];
      renderAttachments();
      informeEditor.innerHTML = '';
      importanceRange.value = 50;
      await openIosSwal({ title: 'Informe guardado', html: '<p>El informe fue almacenado correctamente en Firebase.</p>', icon: 'success', confirmButtonText: 'Entendido' });
    } catch (error) {
      await openIosSwal({ title: 'Error al guardar', html: '<p>No se pudo guardar el informe. Reintentá.</p>', icon: 'error', confirmButtonText: 'Entendido' });
    } finally {
      Swal.close();
    }
  };

  const applyEditorCommand = (cmd, value = null) => {
    informeEditor.focus();
    document.execCommand(cmd, false, value);
  };

  const openImageViewer = (index) => {
    const images = state.attachments.filter((item) => item.type === 'image');
    if (!images.length) return;
    state.imageViewerIndex = index;
    state.viewerScale = 1;
    viewerImage.style.transform = 'scale(1)';
    viewerImage.src = images[state.imageViewerIndex].previewUrl;
    imageViewerModal.show();
  };

  const updateViewerImage = (delta) => {
    const images = state.attachments.filter((item) => item.type === 'image');
    if (!images.length) return;
    state.imageViewerIndex = (state.imageViewerIndex + delta + images.length) % images.length;
    state.viewerScale = 1;
    viewerImage.style.transform = 'scale(1)';
    viewerImage.src = images[state.imageViewerIndex].previewUrl;
  };

  const setViewerScale = (value) => {
    state.viewerScale = Math.max(1, Math.min(4, value));
    viewerImage.style.transform = `scale(${state.viewerScale})`;
  };

  const validateFile = (file) => {
    if (!file) return 'Archivo vacío';
    if (file.size > MAX_UPLOAD_SIZE_BYTES) return 'Cada archivo debe pesar menos de 10MB';
    return '';
  };

  openUserFormBtn.addEventListener('click', () => openUserForm());

  informesUsersList.addEventListener('click', async (event) => {
    const editBtn = event.target.closest('[data-user-edit]');
    if (editBtn) {
      const user = state.users[editBtn.dataset.userEdit];
      if (!user) return;
      const keyCheck = await promptUserKey();
      if (!keyCheck.isConfirmed || keyCheck.value !== user.pin) {
        if (keyCheck.isConfirmed) {
          await openIosSwal({ title: 'Clave incorrecta', html: '<p>No coincide la clave del usuario.</p>', icon: 'error', confirmButtonText: 'Entendido' });
        }
        return;
      }
      await openUserForm(user);
      return;
    }

    const deleteBtn = event.target.closest('[data-user-delete]');
    if (deleteBtn) {
      const user = state.users[deleteBtn.dataset.userDelete];
      if (!user) return;
      const keyCheck = await promptUserKey();
      if (!keyCheck.isConfirmed || keyCheck.value !== user.pin) {
        if (keyCheck.isConfirmed) {
          await openIosSwal({ title: 'Clave incorrecta', html: '<p>No coincide la clave del usuario.</p>', icon: 'error', confirmButtonText: 'Entendido' });
        }
        return;
      }
      const confirm = await openIosSwal({ title: 'Eliminar usuario', html: `<p>Se eliminará a ${user.fullName}.</p>`, icon: 'warning', showCancelButton: true, confirmButtonText: 'Eliminar', cancelButtonText: 'Cancelar' });
      if (!confirm.isConfirmed) return;
      delete state.users[user.id];
      await window.dbLaJamoneraRest.write('/informes/users', state.users);
      renderUsers();
    }
  });

  informeUserSelect.addEventListener('change', async (event) => {
    if (event.target.value === 'create') {
      const id = await openUserForm();
      if (id) {
        informeUserSelect.value = id;
      } else {
        informeUserSelect.value = '';
      }
    }
  });

  document.querySelectorAll('.editor-btn[data-cmd]').forEach((button) => {
    button.addEventListener('click', () => applyEditorCommand(button.dataset.cmd, button.dataset.value || null));
  });

  document.querySelectorAll('.editor-btn[data-emoji]').forEach((button) => {
    button.addEventListener('click', () => applyEditorCommand('insertText', button.dataset.emoji));
  });

  fontSizeSelect.addEventListener('change', () => applyEditorCommand('fontSize', fontSizeSelect.value));

  attachFilesBtn.addEventListener('click', () => attachmentsInput.click());
  attachmentsInput.addEventListener('change', (event) => {
    const files = Array.from(event.target.files || []);
    files.forEach((file) => {
      const message = validateFile(file);
      if (message) return;
      const type = getFileCategory(file);
      const previewUrl = type === 'image' ? URL.createObjectURL(file) : '';
      state.attachments.push({ file, type, previewUrl });
    });
    event.target.value = '';
    renderAttachments();
  });

  attachmentsGrid.addEventListener('click', (event) => {
    const card = event.target.closest('[data-view-image]');
    if (!card) return;
    const clickedIndex = Number(card.dataset.viewImage);
    const imageAttachments = state.attachments.filter((item) => item.type === 'image');
    const target = state.attachments[clickedIndex];
    const imageIndex = imageAttachments.findIndex((img) => img.previewUrl === target.previewUrl);
    if (imageIndex >= 0) {
      openImageViewer(imageIndex);
    }
  });

  saveInformeBtn.addEventListener('click', saveInforme);

  viewerPrevBtn.addEventListener('click', () => updateViewerImage(-1));
  viewerNextBtn.addEventListener('click', () => updateViewerImage(1));
  viewerZoomInBtn.addEventListener('click', () => setViewerScale(state.viewerScale + 0.25));
  viewerZoomOutBtn.addEventListener('click', () => setViewerScale(state.viewerScale - 0.25));
  viewerImage.addEventListener('wheel', (event) => {
    event.preventDefault();
    const delta = event.deltaY > 0 ? -0.2 : 0.2;
    setViewerScale(state.viewerScale + delta);
  }, { passive: false });

  let pinchStartDistance = 0;
  let pinchStartScale = 1;
  viewerImage.addEventListener('touchstart', (event) => {
    if (event.touches.length === 2) {
      const [a, b] = event.touches;
      pinchStartDistance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      pinchStartScale = state.viewerScale;
    }
  }, { passive: true });

  viewerImage.addEventListener('touchmove', (event) => {
    if (event.touches.length === 2) {
      const [a, b] = event.touches;
      const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (pinchStartDistance) {
        const ratio = distance / pinchStartDistance;
        setViewerScale(pinchStartScale * ratio);
      }
    }
  }, { passive: true });

  informesModal.addEventListener('show.bs.modal', async () => {
    if (!datePicker && window.flatpickr) {
      datePicker = flatpickr(informeDateInput, {
        dateFormat: 'd/m/Y',
        defaultDate: new Date(),
        locale: window.flatpickr.l10ns.es
      });
    }
    if (!imageViewerModal && window.bootstrap && imageViewerModalEl) {
      imageViewerModal = new bootstrap.Modal(imageViewerModalEl);
    }

    await loadData();
  });
})();
