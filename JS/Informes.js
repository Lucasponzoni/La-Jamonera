(function informesModule() {
  const informesModal = document.getElementById('informesModal');
  if (!informesModal) {
    return;
  }

  const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;
  const DRAFT_KEY = 'laJamoneraInformeDraft';
  const USER_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

  const informesLoading = document.getElementById('informesLoading');
  const informesData = document.getElementById('informesData');
  const openUserFormBtn = document.getElementById('openUserFormBtn');
  const informesUsersList = document.getElementById('informesUsersList');
  const informeDateInput = document.getElementById('informeDateInput');
  const informeUserSelect = document.getElementById('informeUserSelect');
  const informeEditor = document.getElementById('informeEditor');
  const fontSizeSelect = document.getElementById('fontSizeSelect');
  const formatBlockSelect = document.getElementById('formatBlockSelect');
  const textColorInput = document.getElementById('textColorInput');
  const highlightColorInput = document.getElementById('highlightColorInput');
  const applyHighlightBtn = document.getElementById('applyHighlightBtn');
  const toggleEmojiPanel = document.getElementById('toggleEmojiPanel');
  const emojiPanel = document.getElementById('emojiPanel');
  const informePreview = document.getElementById('informePreview');
  const attachFilesBtn = document.getElementById('attachFilesBtn');
  const attachmentsInput = document.getElementById('attachmentsInput');
  const attachmentsGrid = document.getElementById('attachmentsGrid');
  const saveInformeBtn = document.getElementById('saveInformeBtn');
  const clearInformeBtn = document.getElementById('clearInformeBtn');
  const importanceRange = document.getElementById('importanceRange');
  const importanceLabel = document.getElementById('importanceLabel');

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
    target: informesModal,
    ...options,
    customClass: {
      popup: `ios-alert informes-alert ${options?.customClass?.popup || ''}`.trim(),
      title: 'ios-alert-title',
      htmlContainer: 'ios-alert-text',
      confirmButton: 'ios-btn ios-btn-primary',
      denyButton: 'ios-btn ios-btn-secondary',
      cancelButton: 'ios-btn ios-btn-secondary',
      ...options.customClass
    },
    buttonsStyling: false
  });

  const initialsFromName = (fullName) => {
    const parts = normalizeValue(fullName).split(/\s+/).filter(Boolean);
    if (!parts.length) return '';
    const initial = parts.slice(0, 2).map((p) => p[0].toUpperCase()).join('');
    return initial || '';
  };

  const showState = (key) => {
    informesLoading.classList.toggle('d-none', key !== 'loading');
    informesData.classList.toggle('d-none', key !== 'data');
    if (key !== 'data') {
      informesData.classList.remove('has-scroll-hint');
    }
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
    const initials = initialsFromName(user.fullName);
    return `<span class="user-avatar-thumb user-avatar-initials">${initials || '<i class=\"bi bi-person-fill\"></i>'}</span>`;
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

  const toggleScrollHint = (element) => {
    if (!element) {
      return;
    }

    if (element === informesUsersList) {
      const hasOverflow = element.scrollWidth > element.clientWidth + 4;
      const nearEnd = element.scrollLeft + element.clientWidth >= element.scrollWidth - 6;
      element.classList.toggle('has-scroll-hint', hasOverflow && !nearEnd);
      return;
    }

    const hasOverflow = element.scrollHeight > element.clientHeight + 4;
    const nearBottom = element.scrollTop + element.clientHeight >= element.scrollHeight - 6;
    element.classList.toggle('has-scroll-hint', hasOverflow && !nearBottom);
  };

  const setCollapsedSelection = (node, offset = 0) => {
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.setStart(node, offset);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  };

  const createPlainWrapper = (text = '​') => {
    const span = document.createElement('span');
    span.className = 'editor-plain-text';
    span.textContent = text || '​';
    return span;
  };

  const placeCaretOutsideFormatting = (node) => {
    if (!node) return;
    const styledTags = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'MARK', 'FONT', 'SPAN']);
    let cursor = node.parentElement;
    let styledAncestor = null;

    while (cursor && cursor !== informeEditor) {
      const hasInlineStyle = Boolean(cursor.getAttribute('style'));
      if (styledTags.has(cursor.tagName) || hasInlineStyle) {
        styledAncestor = cursor;
      }
      cursor = cursor.parentElement;
    }

    if (!styledAncestor || !styledAncestor.parentNode) {
      return;
    }

    const spacer = createPlainWrapper();
    styledAncestor.parentNode.insertBefore(spacer, styledAncestor.nextSibling);
    setCollapsedSelection(spacer.firstChild, spacer.firstChild.length);
  };

  const ensurePlainTypingContext = () => {
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) {
      return;
    }

    const range = selection.getRangeAt(0);
    if (!range.collapsed || !informeEditor.contains(range.startContainer)) {
      return;
    }

    const plain = createPlainWrapper();
    range.insertNode(plain);
    setCollapsedSelection(plain.firstChild, plain.firstChild.length);
    placeCaretOutsideFormatting(plain);
  };

  const renderUsers = () => {
    const users = Object.values(state.users).sort((a, b) => String(a.fullName).localeCompare(String(b.fullName)));

    if (!users.length) {
      informesUsersList.innerHTML = '<div class="informes-empty">No hay usuarios cargados.</div>';
      informesUsersList.classList.remove('has-scroll-hint');
      renderUserSelect();
      return;
    }

    informesUsersList.innerHTML = users.map((user) => `
      <div class="informe-user-circle-wrap">
        <article class="informe-user-circle" data-user-id="${user.id}">
          ${renderUserAvatar(user)}
          <div class="informe-user-main">
            <h6>${user.fullName}</h6>
            <p>${user.position}</p>
          </div>
        </article>
        <div class="informe-user-actions">
          <button class="family-manage-btn" type="button" data-user-edit="${user.id}" title="Editar usuario"><i class="fa-solid fa-pen"></i></button>
          <button class="family-manage-btn" type="button" data-user-delete="${user.id}" title="Eliminar usuario"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>
    `).join('');

    renderUserSelect();
    prepareThumbLoaders('.js-user-photo');
    toggleScrollHint(informesUsersList);
  };

  const renderUserSelect = () => {
    const users = Object.values(state.users).sort((a, b) => String(a.fullName).localeCompare(String(b.fullName)));
    const current = informeUserSelect.value;

    const options = users.map((user) => `<option value="${user.id}">${user.fullName} (${user.position})</option>`).join('');
    informeUserSelect.innerHTML = `<option value="">Seleccioná un usuario</option>${options}<option value="create">Crear usuario</option>`;

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
      updateMainScrollHint();
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
      inputClass: 'ios-input informes-key-input',
      inputLabel: 'Ingresá la clave de 4 dígitos',
      inputAttributes: { maxlength: 4, inputmode: 'numeric' },
      confirmButtonText: 'Validar',
      showCancelButton: true,
      cancelButtonText: 'Cancelar',
      customClass: {
        popup: 'informes-key-alert'
      },
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
      customClass: { popup: 'informes-user-form-alert ingredientes-alert' },
      html: `
        <div class="ingrediente-form-grid">
          <section class="step-block">
            <h6 class="step-title">1) Datos personales</h6>
            <div class="step-content">
              <label for="userFullName">Nombre y apellido *</label>
              <input id="userFullName" class="swal2-input ios-input" autocomplete="off" placeholder="Ej: Juan Pérez" value="${initial ? initial.fullName : ''}">
              <label for="userPosition">Puesto en la empresa *</label>
              <input id="userPosition" class="swal2-input ios-input" autocomplete="off" placeholder="Ej: Bromatólogo" value="${initial ? initial.position : ''}">
              <label for="userPin">Clave de 4 dígitos *</label>
              <div class="ios-input-group d-flex align-items-center px-2">
                <input id="userPin" class="swal2-input ios-input border-0 bg-transparent flex-grow-1" type="password" maxlength="4" inputmode="numeric" autocomplete="new-password" placeholder="4 dígitos" value="${initial ? initial.pin : ''}">
                <button id="toggleUserPin" type="button" class="btn ios-toggle-pass" aria-label="Ver u ocultar clave"><i class="fa-solid fa-eye"></i></button>
              </div>
            </div>
          </section>
          <section class="step-block">
            <h6 class="step-title">2) Fotografía (opcional)</h6>
            <div class="step-content">
              <div id="userPhotoPreview" class="image-preview-circle">${initial?.photoUrl ? `<img src="${initial.photoUrl}" alt="Foto">` : '<span class="image-placeholder-circle-2 user-initials-preview"><i class="bi bi-person-fill"></i></span>'}</div>
              <input id="userPhotoInput" type="file" class="form-control image-file-input" accept="image/*">
            </div>
          </section>
        </div>
      `,
      didOpen: () => {
        const fullNameInput = document.getElementById('userFullName');
        const photoInput = document.getElementById('userPhotoInput');
        const preview = document.getElementById('userPhotoPreview');
        const userPinInput = document.getElementById('userPin');
        const toggleUserPin = document.getElementById('toggleUserPin');

        const updateInitials = () => {
          if (pendingUpload || (initial && initial.photoUrl)) {
            return;
          }
          const initials = initialsFromName(fullNameInput.value);
          preview.innerHTML = initials
            ? `<span class="image-placeholder-circle-2 user-initials-preview">${initials}</span>`
            : '<span class="image-placeholder-circle-2 user-initials-preview"><i class="bi bi-person-fill"></i></span>';
        };

        fullNameInput.addEventListener('input', updateInitials);
        toggleUserPin.addEventListener('click', () => {
          const hidden = userPinInput.type === 'password';
          userPinInput.type = hidden ? 'text' : 'password';
          toggleUserPin.innerHTML = hidden ? '<i class="fa-solid fa-eye-slash"></i>' : '<i class="fa-solid fa-eye"></i>';
        });
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

    const keyCheck = await promptUserKey();
    if (!keyCheck.isConfirmed || keyCheck.value !== state.users[selectedUserId].pin) {
      if (keyCheck.isConfirmed) {
        await openIosSwal({ title: 'Clave incorrecta', html: '<p>No coincide la clave del usuario.</p>', icon: 'error', confirmButtonText: 'Entendido' });
      }
      return;
    }

    const date = getCurrentDate();
    const { year, month, day } = getDateParts(date);
    const reportId = makeId('inf');

    Swal.fire({
      title: 'Guardando informe...',
      html: '<div class="informes-saving-spinner"><img src="./IMG/Meta-ai-logo.webp" alt="Guardando" class="meta-spinner-login"></div>',
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false,
      customClass: { popup: 'ios-alert informes-alert informes-saving-alert', title: 'ios-alert-title', htmlContainer: 'ios-alert-text' }
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
      updatePreview();
      importanceRange.value = 50;
      updateImportanceLabel();
      clearDraft();
      await openIosSwal({ title: 'Informe guardado', html: '<p>El informe fue almacenado correctamente en Firebase.</p>', icon: 'success', confirmButtonText: 'Entendido' });
    } catch (error) {
      await openIosSwal({ title: 'Error al guardar', html: '<p>No se pudo guardar el informe. Reintentá.</p>', icon: 'error', confirmButtonText: 'Entendido' });
    } finally {
      Swal.close();
    }
  };

  const updatePreview = () => {
    const previewColor = textColorInput.value || '#000000';
    const previewHighlight = highlightColorInput.value || '#ffffff';
    const previewBold = document.queryCommandState('bold');
    const previewItalic = document.queryCommandState('italic');
    const previewUnderline = document.queryCommandState('underline');
    const previewStrike = document.queryCommandState('strikeThrough');
    const align = ['justifyCenter', 'justifyRight', 'justifyFull'].find((cmd) => document.queryCommandState(cmd));
    informePreview.style.textAlign = align === 'justifyCenter' ? 'center' : align === 'justifyRight' ? 'right' : align === 'justifyFull' ? 'justify' : 'left';
    const deco = `${previewUnderline ? 'underline ' : ''}${previewStrike ? 'line-through' : 'none'}`.trim();
    informePreview.innerHTML = `<span style="color:${previewColor};background:${previewHighlight};font-weight:${previewBold ? 700 : 400};font-style:${previewItalic ? 'italic' : 'normal'};text-decoration:${deco || 'none'};">Texto vista previa</span>`;
  };

  const updateToolbarState = () => {
    const toggles = ['bold', 'italic', 'underline', 'strikeThrough', 'insertUnorderedList', 'insertOrderedList', 'justifyLeft', 'justifyCenter', 'justifyRight', 'justifyFull'];
    toggles.forEach((cmd) => {
      const button = document.querySelector(`.editor-btn[data-cmd="${cmd}"]`);
      if (!button) return;
      let active = false;
      try { active = document.queryCommandState(cmd); } catch (error) { active = false; }
      button.classList.toggle('is-active', !!active);
    });
  };

  const resetEditorControls = () => {
    fontSizeSelect.value = '3';
    formatBlockSelect.value = 'P';
    textColorInput.value = '#000000';
    highlightColorInput.value = '#ffffff';
  };

  const clearTypingStates = () => {
    ['bold', 'italic', 'underline', 'strikeThrough', 'insertUnorderedList', 'insertOrderedList'].forEach((cmd) => {
      let active = false;
      try { active = document.queryCommandState(cmd); } catch (error) { active = false; }
      if (active) {
        document.execCommand(cmd, false, null);
      }
    });
    document.execCommand('justifyLeft', false, null);
  };

  const applyEditorCommand = (cmd, value = null) => {
    const selection = window.getSelection();
    const hasSelection =
      selection
      && selection.rangeCount > 0
      && !selection.isCollapsed
      && informeEditor.contains(selection.anchorNode)
      && informeEditor.contains(selection.focusNode);

    informeEditor.focus();
    if (cmd === 'removeFormat') {
      if (hasSelection && selection.rangeCount) {
        const range = selection.getRangeAt(0);
        const plainText = range.toString();
        range.deleteContents();
        const plainNode = createPlainWrapper(plainText);
        range.insertNode(plainNode);
        setCollapsedSelection(plainNode.firstChild, plainNode.firstChild.length);
        placeCaretOutsideFormatting(plainNode);
      }

      clearTypingStates();
      resetEditorControls();
      ensurePlainTypingContext();
      updateToolbarState();
      updatePreview();
      return;
    } else if (cmd === 'formatBlock') {
      document.execCommand('formatBlock', false, `<${value}>`);
    } else if (cmd === 'hiliteColor') {
      document.execCommand('styleWithCSS', false, true);
      document.execCommand('hiliteColor', false, value || 'transparent');
    } else if (cmd === 'foreColor') {
      document.execCommand('styleWithCSS', false, true);
      document.execCommand('foreColor', false, value);
    } else {
      document.execCommand(cmd, false, value);
    }
    updateToolbarState();
    updatePreview();
  };

  const IMPORTANCE_STATES = [
    { max: 14, text: 'Excelente 😄' },
    { max: 28, text: 'Muy bueno 🙂' },
    { max: 42, text: 'Bueno 😊' },
    { max: 56, text: 'Normal 😐' },
    { max: 70, text: 'Atención 😶' },
    { max: 84, text: 'Importante ⚠️' },
    { max: 100, text: 'Muy importante 🚨' }
  ];

  const updateImportanceLabel = () => {
    const value = Number(importanceRange.value || 0);
    const found = IMPORTANCE_STATES.find((item) => value <= item.max) || IMPORTANCE_STATES[IMPORTANCE_STATES.length - 1];
    importanceLabel.textContent = found.text;
  };

  const EMOJIS = ['😀', '😁', '😂', '🤣', '😊', '🙂', '😉', '😍', '😘', '😎', '🤔', '😐', '😶', '🙄', '😢', '😭', '😡', '🤯', '🥳', '👍', '👎', '👏', '🙏', '💡', '🔥', '⚠️', '🚨', '✅', '❌', '🧪', '📌', '📎', '📅', '🧼', '🧫'];

  const renderEmojiPanel = () => {
    emojiPanel.innerHTML = EMOJIS.map((emoji) => `<button type="button" class="emoji-btn" data-emoji="${emoji}">${emoji}</button>`).join('');
  };


  const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const persistDraft = async () => {
    try {
      const attachments = await Promise.all(state.attachments.map(async (item) => ({
        name: item.file.name,
        type: item.file.type,
        size: item.file.size,
        dataUrl: await readFileAsDataUrl(item.file)
      })));
      const draft = {
        editorHtml: informeEditor.innerHTML,
        userId: informeUserSelect.value,
        importance: Number(importanceRange.value || 50),
        date: informeDateInput.value,
        fontSize: fontSizeSelect.value,
        formatBlock: formatBlockSelect.value,
        textColor: textColorInput.value,
        highlightColor: highlightColorInput.value,
        attachments,
        updatedAt: Date.now()
      };
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch (error) {
      // noop
    }
  };

  const clearDraft = () => {
    localStorage.removeItem(DRAFT_KEY);
  };

  const restoreDraft = async () => {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) {
      resetEditorControls();
      updatePreview();
      return;
    }
    try {
      const draft = JSON.parse(raw);
      informeEditor.innerHTML = draft.editorHtml || '';
      importanceRange.value = Number(draft.importance || 50);
      if (draft.userId && state.users[draft.userId]) informeUserSelect.value = draft.userId;
      if (draft.date && datePicker) datePicker.setDate(draft.date, true, 'd/m/Y');
      if (draft.fontSize) fontSizeSelect.value = draft.fontSize;
      if (draft.formatBlock) formatBlockSelect.value = draft.formatBlock;
      if (draft.textColor) textColorInput.value = draft.textColor;
      if (draft.highlightColor) highlightColorInput.value = draft.highlightColor;

      state.attachments.forEach((item) => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });

      state.attachments = await Promise.all((draft.attachments || []).map(async (item) => {
        const response = await fetch(item.dataUrl);
        const blob = await response.blob();
        const file = new File([blob], item.name, { type: item.type || blob.type });
        return {
          file,
          type: getFileCategory(file),
          previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : ''
        };
      }));

      renderAttachments();
      updateImportanceLabel();
      updateToolbarState();
      updatePreview();
    } catch (error) {
      clearDraft();
    }
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

  fontSizeSelect.addEventListener('change', () => applyEditorCommand('fontSize', fontSizeSelect.value));
  formatBlockSelect.addEventListener('change', () => applyEditorCommand('formatBlock', formatBlockSelect.value));
  textColorInput.addEventListener('input', () => applyEditorCommand('foreColor', textColorInput.value));
  highlightColorInput.addEventListener('input', updatePreview);
  applyHighlightBtn.addEventListener('click', () => applyEditorCommand('hiliteColor', highlightColorInput.value));

  toggleEmojiPanel.addEventListener('click', () => {
    emojiPanel.classList.toggle('is-open');
  });

  emojiPanel.addEventListener('click', (event) => {
    const button = event.target.closest('[data-emoji]');
    if (!button) return;
    applyEditorCommand('insertText', button.dataset.emoji);
    emojiPanel.classList.remove('is-open');
  });

  document.addEventListener('click', (event) => {
    if (!emojiPanel.classList.contains('is-open')) return;
    if (event.target.closest('.emoji-picker-wrap')) return;
    emojiPanel.classList.remove('is-open');
  });

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
    persistDraft();
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

  informesUsersList.addEventListener('scroll', () => {
    toggleScrollHint(informesUsersList);
  });

  saveInformeBtn.addEventListener('click', saveInforme);

  clearInformeBtn.addEventListener('click', async () => {
    const answer = await openIosSwal({
      title: 'Borrar informe',
      html: '<p>¿Qué querés borrar?</p>',
      showDenyButton: true,
      showCancelButton: true,
      confirmButtonText: 'Solo texto',
      denyButtonText: 'Texto y adjuntos',
      cancelButtonText: 'Cancelar',
      customClass: {
        popup: 'informes-clear-alert'
      }
    });

    if (answer.isConfirmed || answer.isDenied) {
      informeEditor.innerHTML = '';
      if (answer.isDenied) {
        state.attachments.forEach((item) => {
          if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
        });
        state.attachments = [];
        renderAttachments();
      }
      resetEditorControls();
      applyEditorCommand('removeFormat');
      updatePreview();
      persistDraft();
    }
  });

  informeEditor.addEventListener('input', () => {
    informeEditor.querySelectorAll('.editor-plain-text').forEach((node) => {
      if (node.textContent === '\u200B') {
        node.remove();
      }
    });
    updatePreview();
    persistDraft();
  });
  informeEditor.addEventListener('keyup', updateToolbarState);
  informeEditor.addEventListener('mouseup', updateToolbarState);
  document.addEventListener('selectionchange', () => {
    if (document.activeElement === informeEditor || informeEditor.contains(document.activeElement)) {
      updateToolbarState();
    }
  });

  importanceRange.addEventListener('input', () => { updateImportanceLabel(); persistDraft(); });

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

  window.addEventListener('beforeunload', persistDraft);
  informesModal.addEventListener('hidden.bs.modal', persistDraft);
  informeUserSelect.addEventListener('change', persistDraft);
  fontSizeSelect.addEventListener('change', persistDraft);
  formatBlockSelect.addEventListener('change', persistDraft);
  textColorInput.addEventListener('change', persistDraft);
  highlightColorInput.addEventListener('change', persistDraft);

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

    renderEmojiPanel();
    updatePreview();
    updateToolbarState();
    updateImportanceLabel();
    await loadData();
    await restoreDraft();
    updateMainScrollHint();
  });
})();
