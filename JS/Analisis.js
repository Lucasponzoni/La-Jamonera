(function analisisModule() {
  const analisisModal = document.getElementById('analisisModal');
  if (!analisisModal) return;

  const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;
  const DRAFT_KEY = 'laJamoneraAnalisisDraft';
  const USER_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const RECORDS_PER_PAGE = 9;

  const ANALYSIS_TYPES = [
    { value: 'agua',          label: 'Agua',         icon: 'fa-droplet'     },
    { value: 'alimentos',     label: 'Alimentos',    icon: 'fa-utensils'    },
    { value: 'productos',     label: 'Productos',    icon: 'fa-box'         },
    { value: 'superficies',   label: 'Superficies',  icon: 'fa-broom'       },
    { value: 'ambiente',      label: 'Ambiente',     icon: 'fa-wind'        },
    { value: 'materia_prima', label: 'Materia Prima', icon: 'fa-seedling'   },
    { value: 'bebidas',       label: 'Bebidas',      icon: 'fa-glass-water' },
    { value: 'otro',          label: 'Otro',         icon: 'fa-microscope'  }
  ];

  const IMPORTANCE_LEVELS = [
    { max: 14,  label: 'Sin observaciones 😄', tone: 'ok'       },
    { max: 28,  label: 'Conforme 🙂',          tone: 'ok'       },
    { max: 42,  label: 'Aceptable 😊',         tone: 'normal'   },
    { max: 56,  label: 'Normal 😐',            tone: 'normal'   },
    { max: 70,  label: 'Atención 😶',          tone: 'warn'     },
    { max: 84,  label: 'No conforme ⚠️',       tone: 'high'     },
    { max: 100, label: 'Crítico 🚨',           tone: 'critical' }
  ];

  // DOM refs
  const analisisLoading           = document.getElementById('analisisLoading');
  const analisisData              = document.getElementById('analisisData');
  const openAnalisisUserFormBtn   = document.getElementById('openAnalisisUserFormBtn');
  const analisisUsersList         = document.getElementById('analisisUsersList');
  const analisisDateInput         = document.getElementById('analisisDateInput');
  const analisisUserSelect        = document.getElementById('analisisUserSelect');
  const analisisEditor            = document.getElementById('analisisEditor');
  const analisisFontSizeSelect    = document.getElementById('analisisFontSizeSelect');
  const analisisFormatBlockSelect = document.getElementById('analisisFormatBlockSelect');
  const analisisTextColorInput    = document.getElementById('analisisTextColorInput');
  const analisisHighlightColorInput = document.getElementById('analisisHighlightColorInput');
  const analisisApplyHighlightBtn = document.getElementById('analisisApplyHighlightBtn');
  const analisisToggleEmojiPanel  = document.getElementById('analisisToggleEmojiPanel');
  const analisisEmojiPanel        = document.getElementById('analisisEmojiPanel');
  const analisisPreview           = document.getElementById('analisisPreview');
  const analisisAttachFilesBtn    = document.getElementById('analisisAttachFilesBtn');
  const analisisAttachmentsInput  = document.getElementById('analisisAttachmentsInput');
  const analisisAttachmentsGrid   = document.getElementById('analisisAttachmentsGrid');
  const saveAnalisisBtn           = document.getElementById('saveAnalisisBtn');
  const clearAnalisisBtn          = document.getElementById('clearAnalisisBtn');
  const analisisImportanceRange   = document.getElementById('analisisImportanceRange');
  const analisisImportanceLabel   = document.getElementById('analisisImportanceLabel');
  const analisisObservations      = document.getElementById('analisisObservations');
  const analisisSampleId          = document.getElementById('analisisSampleId');
  const analisisLabSelect         = document.getElementById('analisisLab');
  const analisisLabNew            = document.getElementById('analisisLabNew');
  const analisisTypeSelector      = document.getElementById('analisisTypeSelector');
  const analisisTypeHidden        = document.getElementById('analisisTypeHidden');
  const analisisFormatIABtn       = document.getElementById('analisisFormatIABtn');

  const analisisBoardLoading      = document.getElementById('analisisBoardLoading');
  const analisisBoardEmpty        = document.getElementById('analisisBoardEmpty');
  const analisisCardsGrid         = document.getElementById('analisisCardsGrid');
  const analisisPagination        = document.getElementById('analisisPagination');
  const openFilterAnalisisBtn     = document.getElementById('openFilterAnalisisBtn');
  const clearFilterAnalisisBtn    = document.getElementById('clearFilterAnalisisBtn');
  const analisisFilterInput       = document.getElementById('analisisFilterInput');
  const analisisTypeFilterPanel   = document.getElementById('analisisTypeFilterPanel');

  const imageViewerModalEl  = document.getElementById('analisisImageViewerModal');
  const viewerImage         = document.getElementById('analisisViewerImage');
  const viewerStageSpinner  = document.getElementById('analisisViewerStageSpinner');
  const viewerBackBtn       = document.getElementById('analisisViewerBackBtn');
  const viewerPrevBtn       = document.getElementById('analisisViewerPrevBtn');
  const viewerNextBtn       = document.getElementById('analisisViewerNextBtn');
  const viewerZoomInBtn     = document.getElementById('analisisViewerZoomInBtn');
  const viewerZoomOutBtn    = document.getElementById('analisisViewerZoomOutBtn');

  const state = {
    users: {},
    attachments: [],
    records: [],
    filteredRecords: [],
    activeRange: null,
    activeTypeFilter: '',
    currentPage: 1,
    viewerImages: [],
    imageViewerIndex: 0,
    viewerScale: 1,
    editingId: null,
    editingOriginal: null,
    editingOriginalPath: null
  };

  let datePicker         = null;
  let filterPicker       = null;
  let imageViewerModal   = null;
  let initialLoadPromise = null;
  let boardRenderSeq     = 0;

  // ── utils ──────────────────────────────────────────────────────────────────
  const normalizeValue = (v) => String(v || '').trim();
  const normalizeLower = (v) => normalizeValue(v).toLowerCase();
  const normalizePin = (v) => normalizeValue(v);
  const pinsMatch = (entered, stored) => normalizePin(entered) === normalizePin(stored);
  const makeId = (prefix) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const escapeHtml = (v) => String(v || '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

  const getSwalTarget = () => (analisisModal.classList.contains('show') ? analisisModal : document.body);

  const openSwal = (opts) => Swal.fire({
    target: getSwalTarget(), ...opts,
    customClass: {
      popup: `ios-alert informes-alert ${opts?.customClass?.popup || ''}`.trim(),
      title: 'ios-alert-title', htmlContainer: 'ios-alert-text',
      confirmButton: 'ios-btn ios-btn-primary',
      denyButton:    'ios-btn ios-btn-secondary',
      cancelButton:  'ios-btn ios-btn-secondary',
      ...opts?.customClass
    },
    buttonsStyling: false
  });

  const initialsFromName = (name) =>
    normalizeValue(name).split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || '';

  const getImportanceMeta = (val) => {
    const v = Math.min(100, Math.max(0, Math.round(Number(val) || 50)));
    return IMPORTANCE_LEVELS.find((l) => v <= l.max) || IMPORTANCE_LEVELS[IMPORTANCE_LEVELS.length - 1];
  };

  const getAnalysisTypeMeta = (value) =>
    ANALYSIS_TYPES.find((t) => t.value === value) || { value: value || 'otro', label: value || 'Otro', icon: 'fa-microscope' };

  const typeIcon = (meta) => `<i class="fa-solid ${meta.icon || 'fa-microscope'}"></i>`;

  const getDateLabel = (ts) => new Date(Number(ts) || Date.now())
    .toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  const getDateParts = (date) => ({
    year:  String(date.getFullYear()),
    month: String(date.getMonth() + 1).padStart(2, '0'),
    day:   String(date.getDate()).padStart(2, '0')
  });

  const getCurrentDate = () => datePicker?.selectedDates?.[0] || new Date();

  const fileIcon = (file) => {
    const n = normalizeLower(file?.name || file?.filename || '');
    if (n.endsWith('.pdf'))  return 'bi-file-earmark-pdf';
    if (n.endsWith('.doc') || n.endsWith('.docx')) return 'bi-file-earmark-word';
    if (n.endsWith('.xls') || n.endsWith('.xlsx') || n.endsWith('.csv')) return 'bi-file-earmark-excel';
    return 'bi-file-earmark-text';
  };

  const getAttachmentName = (item) => item?.file?.name || item?.name || 'Adjunto';
  const getAttachmentType = (item) => item?.type || (normalizeLower(getAttachmentName(item)).match(/\.(png|jpe?g|webp|gif)$/) ? 'image' : 'doc');
  const getAttachmentPreviewUrl = (item) => item?.previewUrl || item?.url || '';
  const getAttachmentSize = (item) => Number(item?.file?.size ?? item?.size ?? 0);
  const getAttachmentMime = (item) => item?.file?.type || item?.mime || '';
  const shouldRevokeAttachmentPreview = (item) => Boolean(item?.previewUrl && !item?.existing);
  const toExistingAttachmentItem = (item) => ({
    id: item?.id || makeId('att_saved'),
    existing: true,
    name: getAttachmentName(item),
    type: getAttachmentType(item),
    mime: getAttachmentMime(item),
    size: getAttachmentSize(item),
    url: item?.url || '',
    previewUrl: getAttachmentType(item) === 'image' ? (item?.url || '') : ''
  });

  const renderUserAvatar = (user) => {
    if (user.photoUrl) return `<span class="user-avatar-thumb"><span class="thumb-loading"><img class="meta-spinner-login" src="./IMG/Meta-ai-logo.webp" alt="Cargando"></span><img class="thumb-image js-user-photo" src="${user.photoUrl}" alt="${escapeHtml(user.fullName)}"></span>`;
    const ini = initialsFromName(user.fullName);
    return `<span class="user-avatar-thumb user-avatar-initials">${ini || '<i class="bi bi-person-fill"></i>'}</span>`;
  };

  const prepareThumbLoaders = (selector) => {
    document.querySelectorAll(selector).forEach((img) => {
      const spinner = img.closest('.user-avatar-thumb')?.querySelector('.thumb-loading');
      const done = () => { img.classList.add('is-loaded'); spinner?.remove(); };
      if (img.complete) done();
      else { img.addEventListener('load', done, { once: true }); img.addEventListener('error', () => spinner?.remove(), { once: true }); }
    });
  };

  // ── state ──────────────────────────────────────────────────────────────────
  const setModalState = (key) => {
    analisisLoading?.classList.toggle('d-none', key !== 'loading');
    analisisData?.classList.toggle('d-none', key !== 'data');
  };

  const setBoardState = (key) => {
    analisisBoardLoading?.classList.toggle('d-none', key !== 'loading');
    analisisBoardEmpty?.classList.toggle('d-none',  key !== 'empty');
    analisisCardsGrid?.classList.toggle('d-none',   key !== 'data');
    analisisPagination?.classList.toggle('d-none',  key !== 'data');
  };

  // ── laboratorio select dinámico ────────────────────────────────────────────
  const getUniqueLabs = () => {
    const labs = new Set();
    state.records.forEach((r) => { if (r.laboratory) labs.add(r.laboratory); });
    return [...labs].sort((a, b) => a.localeCompare(b));
  };

  const getLabValue = () => {
    if (!analisisLabSelect) return '';
    if (analisisLabSelect.value === '__nuevo__') return normalizeValue(analisisLabNew?.value);
    return analisisLabSelect.value;
  };

  const renderLabSelect = (currentValue = '') => {
    if (!analisisLabSelect) return;
    const labs = getUniqueLabs();
    analisisLabSelect.innerHTML = `<option value="">Sin laboratorio</option>
      ${labs.map((l) => `<option value="${escapeHtml(l)}">${escapeHtml(l)}</option>`).join('')}
      <option value="__nuevo__">+ Agregar nuevo...</option>`;
    if (currentValue && currentValue !== '__nuevo__') analisisLabSelect.value = currentValue;
  };

  analisisLabSelect?.addEventListener('change', () => {
    const isNew = analisisLabSelect.value === '__nuevo__';
    analisisLabNew?.classList.toggle('d-none', !isNew);
    if (isNew) analisisLabNew?.focus();
    else if (analisisLabNew) analisisLabNew.value = '';
  });

  // ── users ──────────────────────────────────────────────────────────────────
  const renderUsers = () => {
    const users = Object.values(state.users).sort((a, b) => String(a.fullName).localeCompare(String(b.fullName)));
    if (!users.length) {
      analisisUsersList.innerHTML = '<div class="informes-empty">No hay usuarios cargados.</div>';
      renderUserSelect(); return;
    }
    analisisUsersList.innerHTML = users.map((u) => `
      <div class="informe-user-circle-wrap">
        <article class="informe-user-circle" data-user-id="${u.id}">
          ${renderUserAvatar(u)}
          <div class="informe-user-main">
            <h6>${escapeHtml(u.fullName)}</h6>
            <p>${escapeHtml(u.position)}</p>
            <small class="email-user">${escapeHtml(u.email || '')}</small>
          </div>
        </article>
        <div class="informe-user-actions">
          <button class="family-manage-btn" type="button" data-user-edit="${u.id}" title="Editar"><i class="fa-solid fa-pen"></i></button>
          <button class="family-manage-btn" type="button" data-user-delete="${u.id}" title="Eliminar"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>`).join('');
    renderUserSelect();
    prepareThumbLoaders('#analisisUsersList .js-user-photo');
  };

  const renderUserSelect = () => {
    const users = Object.values(state.users).sort((a, b) => String(a.fullName).localeCompare(String(b.fullName)));
    const cur = analisisUserSelect?.value;
    if (analisisUserSelect) {
      analisisUserSelect.innerHTML = `<option value="">Seleccioná un usuario</option>
        ${users.map((u) => `<option value="${u.id}">${escapeHtml(u.fullName)} (${escapeHtml(u.position)})</option>`).join('')}
        <option value="create">Crear nuevo usuario</option>`;
      if (cur && state.users[cur]) analisisUserSelect.value = cur;
    }
  };

  const loadUsers = async ({ force = false } = {}) => {
    await window.laJamoneraReady;
    if (force) window.dbLaJamoneraRest?.clearCache?.('/informes/users');
    const users = await window.dbLaJamoneraRest.read('/informes/users');
    state.users = (users && typeof users === 'object') ? users : {};
    renderUsers();
    return state.users;
  };

  const openUserForm = async (initial = null) => {
    let pendingUpload = null;
    const result = await openSwal({
      title: initial ? 'Editar usuario' : 'Crear usuario',
      showCancelButton: true,
      confirmButtonText: initial ? 'Guardar cambios' : 'Crear usuario',
      cancelButtonText: 'Cancelar',
      customClass: { popup: 'informes-user-form-alert ingredientes-alert' },
      html: `
        <div class="ingrediente-form-grid">
          <section class="step-block">
            <h6 class="step-title">1) Datos personales</h6>
            <div class="step-content">
              <label for="aqUserFullName">Nombre y apellido *</label>
              <input id="aqUserFullName" class="swal2-input ios-input" autocomplete="off" placeholder="Ej: Juan Pérez" value="${initial ? escapeHtml(initial.fullName) : ''}">
              <label for="aqUserPosition">Puesto en la empresa *</label>
              <input id="aqUserPosition" class="swal2-input ios-input" autocomplete="off" placeholder="Ej: Bromatólogo" value="${initial ? escapeHtml(initial.position) : ''}">
              <label for="aqUserEmail">Email *</label>
              <input id="aqUserEmail" class="swal2-input ios-input" type="email" autocomplete="off" placeholder="usuario@empresa.com" value="${initial ? escapeHtml(initial.email || '') : ''}">
              <label for="aqUserPin">Clave de 4 dígitos *</label>
              <div class="ios-input-group d-flex align-items-center px-2">
                <input id="aqUserPin" class="swal2-input ios-input border-0 bg-transparent flex-grow-1" type="password" maxlength="4" inputmode="numeric" autocomplete="new-password" placeholder="4 dígitos" value="${initial ? escapeHtml(initial.pin) : ''}">
                <button id="aqTogglePin" type="button" class="btn ios-toggle-pass" aria-label="Ver/ocultar"><i class="fa-solid fa-eye"></i></button>
              </div>
            </div>
          </section>
          <section class="step-block">
            <h6 class="step-title">2) Fotografía (opcional)</h6>
            <div class="step-content">
              <div id="aqPhotoPreview" class="image-preview-circle">${initial?.photoUrl ? `<img src="${escapeHtml(initial.photoUrl)}" alt="Foto">` : '<span class="image-placeholder-circle-2 user-initials-preview"><i class="bi bi-person-fill"></i></span>'}</div>
              <input id="aqPhotoInput" type="file" class="form-control image-file-input" accept="image/*">
            </div>
          </section>
        </div>`,
      didOpen: () => {
        const nameInput  = document.getElementById('aqUserFullName');
        const photoInput = document.getElementById('aqPhotoInput');
        const preview    = document.getElementById('aqPhotoPreview');
        const pinInput   = document.getElementById('aqUserPin');
        const togglePin  = document.getElementById('aqTogglePin');
        const updateInitials = () => {
          if (pendingUpload || initial?.photoUrl) return;
          const ini = initialsFromName(nameInput.value);
          preview.innerHTML = ini
            ? `<span class="image-placeholder-circle-2 user-initials-preview">${ini}</span>`
            : '<span class="image-placeholder-circle-2 user-initials-preview"><i class="bi bi-person-fill"></i></span>';
        };
        nameInput.addEventListener('input', updateInitials);
        togglePin.addEventListener('click', () => {
          const hidden = pinInput.type === 'password';
          pinInput.type = hidden ? 'text' : 'password';
          togglePin.innerHTML = hidden ? '<i class="fa-solid fa-eye-slash"></i>' : '<i class="fa-solid fa-eye"></i>';
        });
        updateInitials();
        photoInput.addEventListener('change', () => {
          const file = photoInput.files?.[0];
          if (!file || !USER_PHOTO_TYPES.includes(file.type) || file.size > MAX_UPLOAD_SIZE_BYTES) { photoInput.value = ''; return; }
          pendingUpload = file;
          preview.innerHTML = `<img src="${URL.createObjectURL(file)}" alt="Vista previa">`;
        });
      },
      preConfirm: async () => {
        const fullName = normalizeValue(document.getElementById('aqUserFullName').value);
        const position = normalizeValue(document.getElementById('aqUserPosition').value);
        const email    = normalizeLower(document.getElementById('aqUserEmail').value);
        const pin      = normalizeValue(document.getElementById('aqUserPin').value);
        if (!fullName || !position || !email) { Swal.showValidationMessage('Completá nombre, puesto e email.'); return false; }
        if (!/^\S+@\S+\.\S+$/.test(email))   { Swal.showValidationMessage('Email inválido.'); return false; }
        if (!/^\d{4}$/.test(pin))             { Swal.showValidationMessage('La clave debe tener 4 dígitos.'); return false; }
        let photoUrl = initial?.photoUrl || '';
        if (pendingUpload) {
          try { await window.laJamoneraReady; photoUrl = await uploadToStorage(pendingUpload, 'analisis_quimicos/users'); }
          catch (e) { Swal.showValidationMessage('No se pudo subir la foto.'); return false; }
        }
        return { fullName, position, email, pin, photoUrl };
      }
    });
    if (!result.isConfirmed) return null;
    const id = initial?.id || makeId('aqu');
    const payload = { id, ...result.value, createdAt: initial?.createdAt || Date.now(), updatedAt: Date.now() };
    state.users[id] = payload;
    await window.dbLaJamoneraRest.write('/informes/users', state.users);
    renderUsers();
    return id;
  };

  // ── attachments ────────────────────────────────────────────────────────────
  const renderAttachments = () => {
    if (!state.attachments.length) {
      analisisAttachmentsGrid.innerHTML = '<div class="informes-empty">No hay archivos adjuntos.</div>';
      return;
    }
    analisisAttachmentsGrid.innerHTML = state.attachments.map((item, idx) => {
      const itemType = getAttachmentType(item);
      const itemName = getAttachmentName(item);
      const itemUrl = getAttachmentPreviewUrl(item);
      if (itemType === 'image') {
        return `<button type="button" class="attachment-card" data-view-image="${idx}">
          <span class="attachment-loader"><img src="./IMG/Meta-ai-logo.webp" alt="Cargando" class="meta-spinner-login"></span>
          <img src="${escapeHtml(itemUrl)}" alt="${escapeHtml(itemName)}" class="attachment-image js-attachment-preview">
        </button>`;
      }
      const isPdf = normalizeLower(itemName).endsWith('.pdf');
      return `<div class="attachment-card attachment-doc${isPdf ? ' attachment-pdf' : ''}">
        <i class="bi ${fileIcon(item.file || { name: itemName })}"${isPdf ? ' style="color:#e74c3c;"' : ''}></i>
        <span>${escapeHtml(itemName)}</span>
        <button type="button" class="btn-close btn-close-sm" data-remove-attachment="${idx}" title="Quitar" style="margin-left:auto;"></button>
      </div>`;
    }).join('');
    analisisAttachmentsGrid.querySelectorAll('.js-attachment-preview').forEach((img) => {
      const loader = img.parentElement.querySelector('.attachment-loader');
      const done   = () => { img.classList.add('is-loaded'); loader?.remove(); };
      if (img.complete) done();
      else { img.addEventListener('load', done, { once: true }); img.addEventListener('error', () => loader?.remove(), { once: true }); }
    });
  };

  // ── draft ──────────────────────────────────────────────────────────────────
  const saveDraft = () => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        html:         analisisEditor?.innerHTML || '',
        observations: analisisObservations?.value || '',
        importance:   analisisImportanceRange?.value || '50',
        typeValue:    analisisTypeHidden?.value || '',
        sampleId:     analisisSampleId?.value || '',
        lab:          getLabValue()
      }));
    } catch (e) {}
  };

  const restoreDraft = () => {
    try {
      if (state.editingId) return;
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (d.html && analisisEditor)               analisisEditor.innerHTML = d.html;
      if (d.observations && analisisObservations) analisisObservations.value = d.observations;
      if (d.importance && analisisImportanceRange) { analisisImportanceRange.value = d.importance; updateImportanceLabel(); }
      if (d.typeValue)    selectAnalysisType(d.typeValue);
      if (d.sampleId && analisisSampleId) analisisSampleId.value = d.sampleId;
      if (d.lab) renderLabSelect(d.lab);
      updatePreview();
    } catch (e) {}
  };

  const clearDraft = () => { try { localStorage.removeItem(DRAFT_KEY); } catch (e) {} };

  // ── type selector ──────────────────────────────────────────────────────────
  const selectAnalysisType = (value) => {
    if (analisisTypeHidden) analisisTypeHidden.value = value;
    analisisTypeSelector?.querySelectorAll('.analisis-type-option').forEach((el) => {
      el.classList.toggle('selected', el.dataset.type === value);
    });
  };

  // ── importance ─────────────────────────────────────────────────────────────
  const updateImportanceLabel = () => {
    if (!analisisImportanceRange || !analisisImportanceLabel) return;
    const meta = getImportanceMeta(analisisImportanceRange.value);
    analisisImportanceLabel.textContent = meta.label;
    analisisImportanceLabel.className = `importance-label tone-${meta.tone}`;
  };

  const updatePreview = () => {
    if (analisisPreview) analisisPreview.innerHTML = analisisEditor?.innerHTML || '';
  };

  // ── editor toolbar ─────────────────────────────────────────────────────────
  const setupEditorToolbar = () => {
    analisisData?.querySelectorAll('.editor-btn[data-cmd]').forEach((btn) => {
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        document.execCommand(btn.dataset.cmd, false, null);
        analisisEditor?.focus();
        updatePreview(); saveDraft();
      });
    });

    analisisFormatBlockSelect?.addEventListener('change', () => {
      document.execCommand('formatBlock', false, analisisFormatBlockSelect.value);
      analisisEditor?.focus(); updatePreview(); saveDraft();
    });

    analisisFontSizeSelect?.addEventListener('change', () => {
      document.execCommand('fontSize', false, analisisFontSizeSelect.value);
      analisisEditor?.focus(); updatePreview(); saveDraft();
    });

    analisisTextColorInput?.addEventListener('input', () => {
      document.execCommand('foreColor', false, analisisTextColorInput.value);
      analisisEditor?.focus();
    });

    analisisApplyHighlightBtn?.addEventListener('click', () => {
      document.execCommand('hiliteColor', false, analisisHighlightColorInput?.value || '#ffff00');
      analisisEditor?.focus(); updatePreview(); saveDraft();
    });

    analisisEditor?.addEventListener('input', () => { updatePreview(); saveDraft(); });
    analisisEditor?.addEventListener('paste',  () => setTimeout(() => { updatePreview(); saveDraft(); }, 0));

    const EMOJIS = ['😊','😄','😐','😶','⚠️','🚨','✅','❌','📋','🔬','💧','🍖','🧴','🧽','🌬️','🌾','🥤','📊','📈','📉','🔴','🟡','🟢','⚡','🧪','💉','🌡️','⚗️','🏭'];
    if (analisisEmojiPanel) {
      analisisEmojiPanel.innerHTML = EMOJIS.map((e) => `<button type="button" class="emoji-btn" data-emoji="${e}">${e}</button>`).join('');
      analisisEmojiPanel.addEventListener('click', (e) => {
        const btn = e.target.closest('.emoji-btn');
        if (!btn) return;
        analisisEditor?.focus();
        document.execCommand('insertText', false, btn.dataset.emoji);
        analisisEmojiPanel.classList.remove('is-open');
        updatePreview(); saveDraft();
      });
    }

    analisisToggleEmojiPanel?.addEventListener('click', (e) => {
      e.stopPropagation();
      analisisEmojiPanel?.classList.toggle('is-open');
    });

    document.addEventListener('click', (e) => {
      if (!analisisEmojiPanel) return;
      if (!analisisEmojiPanel.contains(e.target) && e.target !== analisisToggleEmojiPanel)
        analisisEmojiPanel.classList.remove('is-open');
    });
  };

  // ── IA formatter ───────────────────────────────────────────────────────────
  const callIaApi = async (payload) => {
    await window.laJamoneraReady;
    const keyNode = await window.dbLaJamoneraRest.read('/deepseek/apiKey');
    const apiKey  = typeof keyNode === 'string' ? normalizeValue(keyNode) : normalizeValue(keyNode?.apiKey);
    if (!apiKey) throw new Error('Clave IA no configurada en Firebase.');
    const ENDPOINT  = 'https://api.deepseek.com/chat/completions';
    const doFetch   = (url, headers) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(payload) });
    try {
      const res = await doFetch(ENDPOINT, { Authorization: `Bearer ${apiKey}` });
      if (res.ok) return res;
      throw new Error(`IA ${res.status}`);
    } catch (err) {
      // Fallback via Cloud Function (reemplazo de cors.sh). La key vive en el server.
      if (!window.laJamoneraProxy) throw err;
      const proxyRes = await window.laJamoneraProxy.postJson('/ia', payload);
      if (!proxyRes.ok) throw new Error(`IA proxy ${proxyRes.status}`);
      return proxyRes;
    }
  };

  const formatWithIA = async () => {
    const editorHtml = normalizeValue(analisisEditor?.innerHTML);
    if (!editorHtml || editorHtml === '<br>') {
      await openSwal({ title: 'Sin contenido', html: '<p>Escribí algo en el editor antes de usar la IA.</p>', icon: 'warning', confirmButtonText: 'Entendido' });
      return;
    }
    const btn = analisisFormatIABtn;
    const originalHtml = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<img src="./IMG/Meta-ai-logo.webp" class="meta-spinner-login" style="width:20px;height:20px;object-fit:contain;"> Procesando...';
    }
    try {
      const tempDiv   = document.createElement('div');
      tempDiv.innerHTML = editorHtml;
      const plainText = (tempDiv.textContent || tempDiv.innerText || '').trim();
      const typeMeta  = getAnalysisTypeMeta(analisisTypeHidden?.value);
      const obs       = normalizeValue(analisisObservations?.value);

      const payload = {
        model: 'deepseek-chat', temperature: 0.2,
        messages: [
          {
            role: 'system',
            content: `Sos un asistente especializado en análisis de laboratorio bromatológico y químico. Formateá el texto de un análisis (tipo: ${typeMeta.label}) en HTML estructurado profesional.

REGLAS:
1. <h3 style="color:#1f2a44;margin:14px 0 6px;font-size:1.05rem;font-weight:700;border-bottom:2px solid #e2e8f4;padding-bottom:4px;"> para títulos
2. <h4 style="color:#2d4f8a;margin:10px 0 4px;font-size:0.92rem;font-weight:600;"> para subtítulos
3. <p style="margin:0 0 8px;line-height:1.6;"> para párrafos
4. <ul style="margin:4px 0 10px;padding-left:20px;"><li style="margin-bottom:4px;"> para listas
5. <mark style="background:#fff3cd;padding:2px 4px;border-radius:3px;font-weight:600;"> para valores fuera de norma, alertas, no conformidades
6. <mark style="background:#d4edda;padding:2px 4px;border-radius:3px;"> para valores conformes explícitos
7. Mantené TODA la información original sin inventar datos
8. Respondé SOLO con HTML, sin markdown ni bloques de código`
          },
          { role: 'user', content: `Formateá este análisis:\n\n${plainText}${obs ? `\n\nObservaciones: ${obs}` : ''}` }
        ]
      };

      const response = await callIaApi(payload);
      const data     = await response.json();
      let content    = data?.choices?.[0]?.message?.content || '';
      content = content.replace(/^```html?\s*/i, '').replace(/\s*```$/i, '').trim();
      if (!content) throw new Error('La IA no devolvió contenido.');

      analisisEditor.innerHTML = content;
      updatePreview(); saveDraft();
      window.laJamoneraNotify?.show({ type: 'success', title: 'Texto formateado', message: 'La IA estructuró el análisis correctamente.' });
    } catch (err) {
      await openSwal({ title: 'Error con IA', html: `<p>No se pudo conectar con la IA.</p><small style="color:#888;">${escapeHtml(err?.message || '')}</small>`, icon: 'error', confirmButtonText: 'Entendido' });
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = originalHtml; }
    }
  };

  // ── storage ────────────────────────────────────────────────────────────────
  const uploadToStorage = async (file, basePath) => {
    const ext     = (file.name.split('.').pop() || 'bin').toLowerCase();
    const refPath = `${basePath}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const ref     = window.storageLaJamonera.ref().child(refPath);
    await ref.put(file);
    return ref.getDownloadURL();
  };

  // ── PIN ────────────────────────────────────────────────────────────────────
  const promptUserKey = () => openSwal({
    title: 'Verificar clave',
    input: 'password',
    inputClass: 'ios-input informes-key-input',
    inputLabel: 'Ingresá la clave de 4 dígitos',
    inputAttributes: { maxlength: 4, inputmode: 'numeric', autocomplete: 'new-password' },
    confirmButtonText: 'Validar', showCancelButton: true, cancelButtonText: 'Cancelar',
    customClass: { popup: 'informes-key-alert' },
    didOpen: () => {
      const input = document.querySelector('.swal2-input.informes-key-input');
      if (input) { input.setAttribute('autocomplete', 'new-password'); input.setAttribute('autocorrect', 'off'); input.setAttribute('autocapitalize', 'off'); input.setAttribute('spellcheck', 'false'); }
    },
    preConfirm: (val) => {
      if (!/^\d{4}$/.test(String(val || ''))) { Swal.showValidationMessage('La clave debe tener 4 dígitos numéricos.'); return false; }
      return normalizePin(val);
    }
  });

  // ── save ───────────────────────────────────────────────────────────────────
  const saveAnalisis = async () => {
    const userId  = normalizeValue(analisisUserSelect?.value);
    const html    = normalizeValue(analisisEditor?.innerHTML);
    const typeVal = normalizeValue(analisisTypeHidden?.value);

    if (!userId || !state.users[userId]) { await openSwal({ title: 'Falta usuario', html: '<p>Seleccioná un usuario válido.</p>', icon: 'warning', confirmButtonText: 'Entendido' }); return; }
    if (!html)    { await openSwal({ title: 'Falta contenido', html: '<p>Escribí el contenido del análisis.</p>', icon: 'warning', confirmButtonText: 'Entendido' }); return; }
    if (!typeVal) { await openSwal({ title: 'Falta tipo', html: '<p>Seleccioná el tipo de análisis.</p>', icon: 'warning', confirmButtonText: 'Entendido' }); return; }

    const keyCheck = await promptUserKey();
    if (keyCheck.isConfirmed) await loadUsers({ force: true });
    if (!keyCheck.isConfirmed || !pinsMatch(keyCheck.value, state.users[userId]?.pin)) {
      if (keyCheck.isConfirmed) await openSwal({ title: 'Clave incorrecta', html: '<p>No coincide la clave del usuario.</p>', icon: 'error', confirmButtonText: 'Entendido' });
      return;
    }

    const date      = getCurrentDate();
    const { year, month, day } = getDateParts(date);
    const recordId  = state.editingId || makeId('aqr');

    Swal.fire({
      target: getSwalTarget(), title: 'Guardando análisis...',
      html: '<div class="informes-saving-spinner"><img src="./IMG/Meta-ai-logo.webp" alt="Guardando" class="meta-spinner-login"></div>',
      allowOutsideClick: false, allowEscapeKey: false, showConfirmButton: false,
      customClass: { popup: 'ios-alert informes-alert informes-saving-alert', title: 'ios-alert-title', htmlContainer: 'ios-alert-text' }
    });

    try {
      await window.laJamoneraReady;
      const attachmentsSaved = [];
      for (const item of state.attachments) {
        if (item.existing) {
          attachmentsSaved.push({
            name: getAttachmentName(item),
            type: getAttachmentType(item),
            mime: getAttachmentMime(item),
            size: getAttachmentSize(item),
            url: item.url || getAttachmentPreviewUrl(item)
          });
          continue;
        }
        const folder = item.type === 'image' ? 'images' : 'docs';
        const url = await uploadToStorage(item.file, `analisis_quimicos/${year}/${month}/${day}/${recordId}/${folder}`);
        attachmentsSaved.push({ name: item.file.name, type: item.type, mime: item.file.type, size: item.file.size, url });
      }

      const typeMeta = getAnalysisTypeMeta(typeVal);
      const labValue = getLabValue();
      const basePath = `/analisis_quimicos/${year}/${month}/${day}/${recordId}`;
      const payload  = {
        id: recordId, createdAt: state.editingOriginal?.createdAt || Date.now(), updatedAt: Date.now(), reportDate: `${year}-${month}-${day}`,
        userId, userName: state.users[userId].fullName,
        userPosition: state.users[userId].position, userEmail: state.users[userId].email || '',
        analysisType: typeVal, analysisLabel: typeMeta.label,
        html, observations: normalizeValue(analisisObservations?.value),
        sampleId: normalizeValue(analisisSampleId?.value), laboratory: labValue,
        importance: Number(analisisImportanceRange?.value || 50),
        attachments: attachmentsSaved,
        comments: state.editingOriginal?.comments || {}
      };

      await window.dbLaJamoneraRest.write(basePath, payload);
      await window.dbLaJamoneraRest.write(`/analisis_quimicos_index/${year}/${month}/${day}/${recordId}`, {
        id: recordId, reportDate: `${year}-${month}-${day}`,
        userId, userName: state.users[userId].fullName,
        analysisType: typeVal, analysisLabel: typeMeta.label,
        importance: payload.importance, createdAt: payload.createdAt,
        attachmentsCount: attachmentsSaved.length, commentsCount: Object.keys(state.editingOriginal?.comments || {}).length,
        sampleId: payload.sampleId, laboratory: labValue
      });

      if (state.editingOriginalPath && state.editingOriginalPath !== basePath) {
        await window.dbLaJamoneraRest.write(state.editingOriginalPath, null);
        await window.dbLaJamoneraRest.write(`/analisis_quimicos_index/${state.editingOriginal.year}/${state.editingOriginal.month}/${state.editingOriginal.day}/${recordId}`, null);
      }

      state.attachments.forEach((a) => { if (shouldRevokeAttachmentPreview(a)) URL.revokeObjectURL(a.previewUrl); });
      state.attachments = [];
      renderAttachments();
      if (analisisEditor) analisisEditor.innerHTML = '';
      if (analisisObservations) analisisObservations.value = '';
      if (analisisSampleId) analisisSampleId.value = '';
      if (analisisImportanceRange) { analisisImportanceRange.value = '50'; updateImportanceLabel(); }
      selectAnalysisType('');
      updatePreview(); clearDraft();
      state.editingId = null;
      state.editingOriginal = null;
      state.editingOriginalPath = null;

      await loadRecordsBoard();
      renderLabSelect();
      Swal.close();
      bootstrap.Modal.getOrCreateInstance(analisisModal).hide();
      await openSwal({ title: 'Análisis guardado', html: '<p>El análisis fue almacenado correctamente.</p>', icon: 'success', confirmButtonText: 'Cerrar' });
    } catch (err) {
      Swal.close();
      await openSwal({ title: 'Error al guardar', html: '<p>No se pudo guardar. Reintentá.</p>', icon: 'error', confirmButtonText: 'Entendido' });
    }
  };

  // ── collect records ────────────────────────────────────────────────────────
  const collectRecords = async () => {
    await window.laJamoneraReady;
    let tree = null;
    try { tree = await window.dbLaJamoneraRest.read('/analisis_quimicos_index'); } catch (e) {}
    if (!tree) { try { tree = await window.dbLaJamoneraRest.read('/analisis_quimicos'); } catch (e) {} }
    const out = [];
    if (!tree || typeof tree !== 'object') return out;
    Object.keys(tree).forEach((year) => {
      if (year === 'users') return;
      Object.keys(tree[year] || {}).forEach((month) => {
        Object.keys(tree[year][month] || {}).forEach((day) => {
          Object.keys(tree[year][month][day] || {}).forEach((id) => {
            const r = tree[year][month][day][id];
            if (!r || typeof r !== 'object' || (!r.createdAt && !r.html)) return;
            out.push({ ...r, id: r.id || id, year, month, day });
          });
        });
      });
    });
    out.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    return out;
  };

  const ensureRecordDetail = async (record) => {
    if (!record?.__indexLite && record?.html) return record;
    const { id, year, month, day } = record || {};
    if (!id || !year || !month || !day) return record;
    try {
      const detail = await window.dbLaJamoneraRest.read(`/analisis_quimicos/${year}/${month}/${day}/${id}`);
      if (!detail || typeof detail !== 'object') return record;
      const merged = { ...record, ...detail, id: detail.id || id, year, month, day, __indexLite: false };
      const idx = state.records.findIndex((r) => r.id === id);
      if (idx >= 0) state.records[idx] = merged;
      const fi  = state.filteredRecords.findIndex((r) => r.id === id);
      if (fi >= 0) state.filteredRecords[fi] = merged;
      return merged;
    } catch (e) { return record; }
  };

  // ── filters ────────────────────────────────────────────────────────────────
  const applyFilters = () => {
    let src = state.records;
    if (state.activeRange) {
      const s = new Date(state.activeRange[0]); s.setHours(0, 0, 0, 0);
      const e = new Date(state.activeRange[1]); e.setHours(23, 59, 59, 999);
      src = src.filter((r) => { const ts = Number(r.createdAt || 0); return ts >= s.getTime() && ts <= e.getTime(); });
    }
    if (state.activeTypeFilter) src = src.filter((r) => r.analysisType === state.activeTypeFilter);
    state.filteredRecords = src;
  };

  // ── board ──────────────────────────────────────────────────────────────────
  const renderBoardPagination = (total) => {
    if (!analisisPagination) return;
    if (total <= 1) { analisisPagination.innerHTML = ''; return; }
    const cur = state.currentPage;
    const pages = Array.from({ length: total }, (_, i) => i + 1)
      .map((p) => `<li class="page-item${p === cur ? ' active' : ''}"><button class="page-link" data-page="${p}">${p}</button></li>`)
      .join('');
    analisisPagination.innerHTML = `<nav aria-label="Paginación de análisis"><ul class="pagination pagination-sm justify-content-center mb-0">
      <li class="page-item${cur === 1 ? ' disabled' : ''}"><button class="page-link" data-page="${Math.max(1, cur - 1)}">‹</button></li>
      ${pages}
      <li class="page-item${cur === total ? ' disabled' : ''}"><button class="page-link" data-page="${Math.min(total, cur + 1)}">›</button></li>
    </ul></nav>`;
  };

  const renderRecordsBoard = async () => {
    const seq    = ++boardRenderSeq;
    const isFiltered = state.activeRange || state.activeTypeFilter;
    const source = isFiltered ? state.filteredRecords : state.records;
    if (!source.length) { setBoardState('empty'); return; }

    if (analisisCardsGrid) analisisCardsGrid.innerHTML = '';

    const total  = Math.max(1, Math.ceil(source.length / RECORDS_PER_PAGE));
    state.currentPage = Math.min(state.currentPage, total);
    const start  = (state.currentPage - 1) * RECORDS_PER_PAGE;
    const items  = await Promise.all(source.slice(start, start + RECORDS_PER_PAGE).map(ensureRecordDetail));
    if (seq !== boardRenderSeq) return;

    const tableRows = items.map((record) => {
      const user        = state.users[record.userId] || {};
      const typeMeta    = getAnalysisTypeMeta(record.analysisType);
      const importance  = getImportanceMeta(record.importance);
      const displayName = user.fullName || record.userName || 'Usuario';
      const attachments = Array.isArray(record.attachments) ? record.attachments : [];
      const ts          = Number(record.createdAt || 0);
      const d           = ts ? new Date(ts) : null;
      const dateStr     = d ? `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}` : '-';
      const timeStr     = d ? d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '';

      return `<tr>
        <td class="analisis-td-date"><span>${dateStr}</span><small>${timeStr}</small></td>
        <td><span class="analisis-type-badge">${typeIcon(typeMeta)} ${escapeHtml(typeMeta.label)}</span></td>
        <td>${record.sampleId ? `<span class="sample-chip"><i class="fa-solid fa-vial"></i> ${escapeHtml(record.sampleId)}</span>` : '<span class="analisis-td-empty">—</span>'}</td>
        <td>${record.laboratory ? `<span class="analisis-lab-chip"><i class="fa-solid fa-flask"></i> ${escapeHtml(record.laboratory)}</span>` : '<span class="analisis-td-empty">—</span>'}</td>
        <td class="analisis-td-user"><strong>${escapeHtml(displayName)}</strong><small>${escapeHtml(user.position || record.userPosition || '')}</small></td>
        <td style="white-space:nowrap;"><span class="importance-chip importance-${importance.tone}">${importance.label}</span></td>
        <td style="text-align:center;white-space:nowrap;">${attachments.length ? `<span class="informe-attach-chip"><i class="fa-solid fa-paperclip"></i> ${attachments.length}</span>` : '<span class="analisis-td-empty">—</span>'}</td>
        <td>
          <div class="analisis-table-actions">
            <button class="btn informe-icon-btn" type="button" data-view-record="${record.id}" title="Ver análisis"><i class="fa-solid fa-eye"></i></button>
            <button class="btn informe-icon-btn" type="button" data-edit-record="${record.id}" title="Editar"><i class="fa-solid fa-pen"></i></button>
            <button class="btn informe-icon-btn danger" type="button" data-delete-record="${record.id}" title="Eliminar"><i class="fa-solid fa-trash"></i></button>
            <button class="btn informe-icon-btn" type="button" data-print-record="${record.id}" title="Imprimir"><i class="fa-solid fa-print"></i></button>
          </div>
        </td>
      </tr>`;
    }).join('');

    analisisCardsGrid.innerHTML = `<div class="analisis-table-wrap">
      <table class="analisis-table">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Tipo</th>
            <th>Muestra</th>
            <th>Laboratorio</th>
            <th>Usuario</th>
            <th>Alerta</th>
            <th>Adj.</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>`;
    renderBoardPagination(total);
    setBoardState('data');
  };

  const loadRecordsBoard = async () => {
    setBoardState('loading');
    try {
      state.records = await collectRecords();
      applyFilters();
      await renderRecordsBoard();
    } catch (e) { setBoardState('empty'); }
  };

  // ── view detail ────────────────────────────────────────────────────────────
  const viewRecord = async (recordId) => {
    const record = state.records.find((r) => r.id === recordId);
    if (!record) return;
    const full     = await ensureRecordDetail(record);
    const typeMeta = getAnalysisTypeMeta(full.analysisType);
    const imp      = getImportanceMeta(full.importance);
    const user     = state.users[full.userId] || {};
    const displayName  = user.fullName || full.userName || 'Usuario';
    const attachments  = Array.isArray(full.attachments) ? full.attachments : [];
    const images  = attachments.filter((a) => a.type === 'image');
    const docs    = attachments.filter((a) => a.type !== 'image');

    const imgsHtml = images.length
      ? `<div style="display:grid;gap:10px;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));margin-top:8px;">
          ${images.map((a, i) => `<figure style="margin:0;border:1px solid #d7def2;border-radius:10px;padding:8px;background:#fff;cursor:pointer;" data-view-detail-image="${i}">
            <img src="${escapeHtml(a.url)}" alt="${escapeHtml(a.name)}" style="width:100%;max-height:180px;object-fit:contain;border-radius:8px;">
            <figcaption style="font-size:11px;color:#4b5f8e;margin-top:4px;">${escapeHtml(a.name)}</figcaption>
          </figure>`).join('')}
        </div>`
      : '<p style="color:#5a6482;font-size:0.85rem;">Sin imágenes.</p>';

    const docsHtml = docs.length
      ? `<ul style="margin:6px 0 0;padding-left:18px;">${docs.map((a) => `<li style="margin-bottom:5px;"><a href="${escapeHtml(a.url)}" target="_blank" rel="noopener" style="color:#1d4ed8;">${escapeHtml(a.name)}</a></li>`).join('')}</ul>`
      : '<p style="color:#5a6482;font-size:0.85rem;">Sin documentos.</p>';

    await openSwal({
      title: '', width: 860,
      html: `<div style="font-family:Inter,Arial,sans-serif;text-align:left;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap;">
          <span style="font-size:1.6rem;color:#4b78e8;">${typeIcon(typeMeta)}</span>
          <div><h4 style="margin:0;font-size:1rem;color:#1f2a44;">${escapeHtml(typeMeta.label)}</h4><small style="color:#5a6482;">${getDateLabel(full.createdAt)}</small></div>
          <span class="importance-chip importance-${imp.tone}" style="margin-left:auto;">${imp.label}</span>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
          ${full.sampleId  ? `<span class="sample-chip">Muestra: ${escapeHtml(full.sampleId)}</span>` : ''}
          ${full.laboratory ? `<span class="sample-chip">Lab: ${escapeHtml(full.laboratory)}</span>` : ''}
          <span class="sample-chip">Por: ${escapeHtml(displayName)}</span>
        </div>
        <div style="border:1px solid #dce5fb;border-radius:14px;padding:14px;background:#fbfdff;margin-bottom:10px;">${full.html || '<p>Sin contenido</p>'}</div>
        ${full.observations ? `<div style="background:#fffbea;border:1px solid #f0d060;border-radius:12px;padding:10px 14px;margin-bottom:10px;"><strong style="font-size:0.85rem;color:#7a6000;">Observaciones</strong><p style="margin:4px 0 0;font-size:0.88rem;color:#5a4a00;">${escapeHtml(full.observations)}</p></div>` : ''}
        <div style="margin-top:10px;"><h5 style="font-size:0.9rem;font-weight:700;color:#2d4f8a;margin:0 0 6px;">Imágenes adjuntas</h5>${imgsHtml}</div>
        <div style="margin-top:10px;"><h5 style="font-size:0.9rem;font-weight:700;color:#2d4f8a;margin:0 0 4px;">Documentos y PDFs</h5>${docsHtml}</div>
      </div>`,
      showCancelButton: false, confirmButtonText: 'Cerrar',
      customClass: { popup: 'informes-detail-alert', confirmButton: 'ios-btn ios-btn-secondary' },
      didOpen: () => {
        document.querySelectorAll('[data-view-detail-image]').forEach((fig) => {
          fig.addEventListener('click', () => openViewerWithImages(images, parseInt(fig.dataset.viewDetailImage, 10)));
        });
      }
    });
  };

  // ── edit ───────────────────────────────────────────────────────────────────
  const editRecord = async (recordId) => {
    const record = state.records.find((r) => r.id === recordId);
    if (!record) return;
    const full = await ensureRecordDetail(record);
    await loadUsers({ force: true });
    const keyCheck = await promptUserKey();
    if (!keyCheck.isConfirmed) return;
    const user = state.users[full.userId];
    if (!user || !pinsMatch(keyCheck.value, user.pin)) {
      await openSwal({ title: 'Clave incorrecta', html: '<p>No coincide la clave.</p>', icon: 'error', confirmButtonText: 'Entendido' }); return;
    }
    state.editingId = recordId;
    state.editingOriginal = full;
    state.editingOriginalPath = `/analisis_quimicos/${full.year}/${full.month}/${full.day}/${recordId}`;

    const modal = bootstrap.Modal.getOrCreateInstance(analisisModal);
    modal.show();
    await new Promise((res) => setTimeout(res, 400));

    if (analisisEditor)         analisisEditor.innerHTML = full.html || '';
    if (analisisObservations)   analisisObservations.value = full.observations || '';
    if (analisisSampleId)       analisisSampleId.value = full.sampleId || '';
    if (analisisImportanceRange) { analisisImportanceRange.value = full.importance || 50; updateImportanceLabel(); }
    if (full.analysisType) selectAnalysisType(full.analysisType);
    if (analisisUserSelect) analisisUserSelect.value = full.userId || '';
    renderLabSelect(full.laboratory || '');
    state.attachments.forEach((a) => { if (shouldRevokeAttachmentPreview(a)) URL.revokeObjectURL(a.previewUrl); });
    state.attachments = (Array.isArray(full.attachments) ? full.attachments : []).map(toExistingAttachmentItem);
    renderAttachments();

    state.records = state.records.filter((r) => r.id !== recordId);
    applyFilters();
    updatePreview();
  };

  // ── delete ─────────────────────────────────────────────────────────────────
  const deleteRecord = async (recordId) => {
    const record = state.records.find((r) => r.id === recordId);
    if (!record) return;
    const confirm = await openSwal({
      title: 'Eliminar análisis', html: '<p>Esta acción no se puede deshacer.</p>', icon: 'warning',
      showCancelButton: true, confirmButtonText: 'Eliminar', cancelButtonText: 'Cancelar',
      customClass: { confirmButton: 'ios-btn ios-btn-danger' }
    });
    if (!confirm.isConfirmed) return;
    await loadUsers({ force: true });
    const keyCheck = await promptUserKey();
    if (!keyCheck.isConfirmed) return;
    const user = state.users[record.userId];
    if (!user || !pinsMatch(keyCheck.value, user.pin)) {
      await openSwal({ title: 'Clave incorrecta', html: '<p>No coincide la clave.</p>', icon: 'error', confirmButtonText: 'Entendido' }); return;
    }
    try {
      await window.laJamoneraReady;
      await window.dbLaJamoneraRest.write(`/analisis_quimicos/${record.year}/${record.month}/${record.day}/${recordId}`, null);
      await window.dbLaJamoneraRest.write(`/analisis_quimicos_index/${record.year}/${record.month}/${record.day}/${recordId}`, null);
      state.records = state.records.filter((r) => r.id !== recordId);
      applyFilters();
      await renderRecordsBoard();
      window.laJamoneraNotify?.show({ type: 'success', title: 'Eliminado', message: 'Análisis eliminado.' });
    } catch (e) {
      await openSwal({ title: 'Error', html: '<p>No se pudo eliminar.</p>', icon: 'error', confirmButtonText: 'Entendido' });
    }
  };

  // ── print ──────────────────────────────────────────────────────────────────
  const printRecord = async (recordId) => {
    const record = state.records.find((r) => r.id === recordId);
    if (!record) return;
    const full     = await ensureRecordDetail(record);
    const typeMeta = getAnalysisTypeMeta(full.analysisType);
    const user     = state.users[full.userId] || {};

    const choice = await openSwal({
      title: 'Imprimir análisis', html: '<p>¿Incluir imágenes adjuntas?</p>',
      showDenyButton: true, showCancelButton: true,
      confirmButtonText: 'Con imágenes', denyButtonText: 'Sin imágenes', cancelButtonText: 'Cancelar',
      scrollbarPadding: false, scrollBehavior: 'inside',
      customClass: { confirmButton: 'ios-btn ios-btn-success', denyButton: 'ios-btn ios-btn-secondary', cancelButton: 'ios-btn ios-btn-secondary' }
    });
    if (!choice.isConfirmed && !choice.isDenied) return;

    const attachments = Array.isArray(full.attachments) ? full.attachments : [];
    const images  = choice.isConfirmed ? attachments.filter((a) => a.type === 'image') : [];
    const docs    = attachments.filter((a) => a.type !== 'image');

    const win = window.open('', '_blank', 'width=1300,height=900');
    if (!win) return;

    win.document.write(`<!DOCTYPE html><html><head><title>Análisis ${escapeHtml(typeMeta.label)}</title>
      <style>body{font-family:Inter,Arial,sans-serif;padding:24px;color:#1f2a44}h1{font-size:22px;margin:0 0 6px}.meta{margin:0 0 14px;color:#55607f;font-size:13px}.content{border:1px solid #d7def2;border-radius:12px;padding:14px;background:#fff}mark{background:#fff3cd;padding:1px 3px;border-radius:3px}.obs{background:#fffbea;border:1px solid #f0d060;border-radius:10px;padding:10px 14px;margin-top:10px}.print-logo{display:block;margin:0 auto 10px;max-height:50px;width:auto}</style>
      </head><body>
      <img src="${escapeHtml(new URL('./IMG/ABR LOGO.png', window.location.href).href)}" alt="ABR" class="print-logo">
      <h1>Análisis químico — ${escapeHtml(typeMeta.label)}</h1>
      <p class="meta"><strong>Usuario:</strong> ${escapeHtml(user.fullName || full.userName || '-')} · <strong>Fecha:</strong> ${getDateLabel(full.createdAt)}${full.sampleId ? ` · <strong>Muestra:</strong> ${escapeHtml(full.sampleId)}` : ''}${full.laboratory ? ` · <strong>Lab:</strong> ${escapeHtml(full.laboratory)}` : ''}</p>
      <section class="content">${full.html || '<p>Sin contenido</p>'}</section>
      ${full.observations ? `<div class="obs"><strong>Observaciones:</strong><p style="margin:4px 0 0;">${escapeHtml(full.observations)}</p></div>` : ''}
      <h2 style="margin:16px 0 8px;font-size:16px;">Imágenes adjuntas</h2>
      ${images.length ? `<div style="display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));">${images.map((a,i) => `<figure style="margin:0;border:1px solid #d7def2;border-radius:10px;padding:8px;"><img src="${escapeHtml(a.url)}" style="width:100%;max-height:260px;object-fit:contain;border-radius:8px;"><figcaption style="font-size:11px;color:#4b5f8e;margin-top:4px;">${escapeHtml(a.name||`Imagen ${i+1}`)}</figcaption></figure>`).join('')}</div>` : '<p style="color:#5a6482;">Sin imágenes.</p>'}
      <h2 style="margin:16px 0 8px;font-size:16px;">Documentos</h2>
      ${docs.length ? `<ul style="padding-left:18px;">${docs.map((a) => `<li><a href="${escapeHtml(a.url)}" target="_blank">${escapeHtml(a.name)}</a></li>`).join('')}</ul>` : '<p style="color:#5a6482;">Sin documentos.</p>'}
      </body></html>`);
    win.document.close(); win.focus();
    await new Promise((res) => {
      const imgs = [...(win.document.images || [])];
      if (!imgs.length) { res(); return; }
      let n = 0;
      imgs.forEach((img) => { const d = () => { n++; if (n >= imgs.length) res(); }; if (img.complete) d(); else { img.addEventListener('load', d, {once:true}); img.addEventListener('error', d, {once:true}); } });
    });
    win.print();
  };

  // ── image viewer ───────────────────────────────────────────────────────────
  const ensureImageViewer = () => {
    if (!imageViewerModal && window.bootstrap && imageViewerModalEl)
      imageViewerModal = new bootstrap.Modal(imageViewerModalEl);
  };

  const openViewerWithImages = (images, startIndex = 0) => {
    ensureImageViewer();
    if (!imageViewerModal || !images.length) return;
    state.viewerImages = images; state.imageViewerIndex = startIndex; state.viewerScale = 1;
    showViewerImage(startIndex);
    imageViewerModal.show();
  };

  const showViewerImage = (idx) => {
    if (!viewerImage) return;
    const safeIdx = Math.max(0, Math.min(state.viewerImages.length - 1, idx));
    state.imageViewerIndex = safeIdx; state.viewerScale = 1;
    viewerImage.style.transform = 'scale(1)';
    if (viewerStageSpinner) viewerStageSpinner.style.display = '';
    viewerImage.classList.remove('is-loaded');
    viewerImage.src = '';
    const img = state.viewerImages[safeIdx];
    if (img?.url) {
      viewerImage.onload  = () => { viewerImage.classList.add('is-loaded'); if (viewerStageSpinner) viewerStageSpinner.style.display = 'none'; };
      viewerImage.onerror = () => { if (viewerStageSpinner) viewerStageSpinner.style.display = 'none'; };
      viewerImage.src = img.url;
    }
  };

  viewerPrevBtn?.addEventListener('click', () => showViewerImage(state.imageViewerIndex - 1));
  viewerNextBtn?.addEventListener('click', () => showViewerImage(state.imageViewerIndex + 1));
  viewerBackBtn?.addEventListener('click', () => imageViewerModal?.hide());
  viewerZoomInBtn?.addEventListener('click',  () => { state.viewerScale = Math.min(4, state.viewerScale + 0.25); if (viewerImage) viewerImage.style.transform = `scale(${state.viewerScale})`; });
  viewerZoomOutBtn?.addEventListener('click', () => { state.viewerScale = Math.max(0.5, state.viewerScale - 0.25); if (viewerImage) viewerImage.style.transform = `scale(${state.viewerScale})`; });

  // ── date filter (igual patrón que Informes.js) ─────────────────────────────
  const setupDateFilter = () => {
    if (!openFilterAnalisisBtn || !analisisFilterInput || !window.flatpickr) return;

    filterPicker = flatpickr(analisisFilterInput, {
      mode: 'range',
      dateFormat: 'Y-m-d',
      locale: window.flatpickr?.l10ns?.es || undefined,
      positionElement: openFilterAnalisisBtn,
      appendTo: openFilterAnalisisBtn.parentElement,
      disableMobile: true,
      onReady: (_d, _s, fp) => {
        fp.calendarContainer.classList.add('informes-filter-calendar');
      },
      onClose: (selectedDates) => {
        if (selectedDates.length === 2) {
          state.activeRange = [selectedDates[0], selectedDates[1]];
          clearFilterAnalisisBtn?.classList.remove('d-none');
          applyFilters(); state.currentPage = 1;
          void renderRecordsBoard();
        }
      }
    });

    openFilterAnalisisBtn.addEventListener('click', () => {
      if (filterPicker) { filterPicker.redraw(); filterPicker.open(); }
    });

    clearFilterAnalisisBtn?.addEventListener('click', () => {
      if (filterPicker) filterPicker.clear();
      state.activeRange = null;
      clearFilterAnalisisBtn.classList.add('d-none');
      applyFilters(); state.currentPage = 1;
      void renderRecordsBoard();
    });
  };

  // ── type filter chips ──────────────────────────────────────────────────────
  const setupTypeFilter = () => {
    analisisTypeFilterPanel?.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-type-filter]');
      if (!chip) return;
      analisisTypeFilterPanel.querySelectorAll('.analisis-type-chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      state.activeTypeFilter = chip.dataset.typeFilter;
      state.currentPage = 1;
      applyFilters();
      void renderRecordsBoard();
    });
  };

  // ── event wiring ───────────────────────────────────────────────────────────
  analisisPagination?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-page]');
    if (!btn) return;
    state.currentPage = parseInt(btn.dataset.page, 10);
    void renderRecordsBoard();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  analisisCardsGrid?.addEventListener('click', async (e) => {
    if (e.target.closest('[data-view-record]'))   { await viewRecord(e.target.closest('[data-view-record]').dataset.viewRecord); return; }
    if (e.target.closest('[data-edit-record]'))   { await editRecord(e.target.closest('[data-edit-record]').dataset.editRecord); return; }
    if (e.target.closest('[data-delete-record]')) { await deleteRecord(e.target.closest('[data-delete-record]').dataset.deleteRecord); return; }
    if (e.target.closest('[data-print-record]'))  { await printRecord(e.target.closest('[data-print-record]').dataset.printRecord); return; }
  });

  analisisUsersList?.addEventListener('click', async (e) => {
    if (e.target.closest('[data-user-edit]')) {
      const user = state.users[e.target.closest('[data-user-edit]').dataset.userEdit];
      if (user) await openUserForm(user); return;
    }
    if (e.target.closest('[data-user-delete]')) {
      const uid = e.target.closest('[data-user-delete]').dataset.userDelete;
      const ok  = await openSwal({ title: 'Eliminar usuario', html: '<p>¿Seguro?</p>', icon: 'warning', showCancelButton: true, confirmButtonText: 'Eliminar', cancelButtonText: 'Cancelar', customClass: { confirmButton: 'ios-btn ios-btn-danger' } });
      if (!ok.isConfirmed) return;
      delete state.users[uid];
      await window.dbLaJamoneraRest.write('/informes/users', state.users);
      renderUsers();
    }
  });

  analisisTypeSelector?.addEventListener('click', (e) => {
    const opt = e.target.closest('.analisis-type-option');
    if (!opt) return;
    selectAnalysisType(opt.dataset.type);
    saveDraft();
  });

  analisisUserSelect?.addEventListener('change', async () => {
    if (analisisUserSelect.value === 'create') {
      analisisUserSelect.value = '';
      const id = await openUserForm();
      if (id) analisisUserSelect.value = id;
    }
  });

  openAnalisisUserFormBtn?.addEventListener('click', () => openUserForm());
  analisisImportanceRange?.addEventListener('input', () => { updateImportanceLabel(); saveDraft(); });
  analisisObservations?.addEventListener('input', saveDraft);

  analisisAttachFilesBtn?.addEventListener('click', () => analisisAttachmentsInput?.click());
  analisisAttachmentsInput?.addEventListener('change', () => {
    Array.from(analisisAttachmentsInput.files || []).forEach((file) => {
      if (file.size > MAX_UPLOAD_SIZE_BYTES) { window.laJamoneraNotify?.show({ type: 'error', title: 'Archivo muy grande', message: `${file.name} supera los 10 MB.` }); return; }
      const type = file.type.startsWith('image/') ? 'image' : 'doc';
      state.attachments.push({ id: makeId('att'), file, type, previewUrl: type === 'image' ? URL.createObjectURL(file) : null });
    });
    analisisAttachmentsInput.value = '';
    renderAttachments();
  });

  analisisAttachmentsGrid?.addEventListener('click', (e) => {
    if (e.target.closest('[data-view-image]')) {
      const idx    = parseInt(e.target.closest('[data-view-image]').dataset.viewImage, 10);
      const images = state.attachments.filter((a) => getAttachmentType(a) === 'image').map((a) => ({ url: getAttachmentPreviewUrl(a), name: getAttachmentName(a) }));
      const imgIdx = state.attachments.slice(0, idx + 1).filter((a) => getAttachmentType(a) === 'image').length - 1;
      openViewerWithImages(images, Math.max(0, imgIdx)); return;
    }
    if (e.target.closest('[data-remove-attachment]')) {
      const idx  = parseInt(e.target.closest('[data-remove-attachment]').dataset.removeAttachment, 10);
      const item = state.attachments[idx];
      if (shouldRevokeAttachmentPreview(item)) URL.revokeObjectURL(item.previewUrl);
      state.attachments.splice(idx, 1);
      renderAttachments();
    }
  });

  saveAnalisisBtn?.addEventListener('click', saveAnalisis);

  clearAnalisisBtn?.addEventListener('click', async () => {
    const ok = await openSwal({ title: 'Borrar todo', html: '<p>¿Borrar el análisis en progreso?</p>', icon: 'warning', showCancelButton: true, confirmButtonText: 'Borrar', cancelButtonText: 'Cancelar' });
    if (!ok.isConfirmed) return;
    if (analisisEditor)         analisisEditor.innerHTML = '';
    if (analisisObservations)   analisisObservations.value = '';
    if (analisisSampleId)       analisisSampleId.value = '';
    if (analisisImportanceRange) { analisisImportanceRange.value = '50'; updateImportanceLabel(); }
    state.attachments.forEach((a) => { if (shouldRevokeAttachmentPreview(a)) URL.revokeObjectURL(a.previewUrl); });
    state.attachments = [];
    renderAttachments();
    selectAnalysisType('');
    renderLabSelect();
    updatePreview(); clearDraft();
    state.editingId = null;
    state.editingOriginal = null;
    state.editingOriginalPath = null;
  });

  analisisFormatIABtn?.addEventListener('click', formatWithIA);

  // ── init ───────────────────────────────────────────────────────────────────
  const loadData = async () => {
    setModalState('loading');
    try {
      await loadUsers();
      renderAttachments();
      setModalState('data');
      renderLabSelect();
      restoreDraft();
      updateImportanceLabel();
    } catch (e) {
      await openSwal({ title: 'Error', html: '<p>No se pudieron cargar los datos.</p>', icon: 'error', confirmButtonText: 'Entendido' });
      setModalState('data');
    }
  };

  const ensureInitialLoad = async () => {
    if (initialLoadPromise) return initialLoadPromise;
    initialLoadPromise = loadData();
    try { await initialLoadPromise; } finally { initialLoadPromise = null; }
  };

  setupEditorToolbar();
  setupDateFilter();
  setupTypeFilter();

  analisisModal.addEventListener('show.bs.modal', () => {
    if (!datePicker && window.flatpickr) {
      datePicker = flatpickr(analisisDateInput, { dateFormat: 'd/m/Y', defaultDate: new Date(), locale: window.flatpickr?.l10ns?.es || undefined });
    }
    ensureImageViewer();
    updatePreview();
    updateImportanceLabel();
    ensureInitialLoad();
  });

  window.laJamoneraReady?.then(async () => {
    state.records = await collectRecords();
    applyFilters();
    await renderRecordsBoard();
    renderLabSelect();
  }).catch(() => setBoardState('empty'));

})();
