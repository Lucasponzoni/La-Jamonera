(function usuariosModule() {
  const modalEl = document.getElementById('usersManagerModal');
  if (!modalEl) return;

  const nodes = {
    loading: document.getElementById('usersManagerLoading'),
    data: document.getElementById('usersManagerData'),
    list: document.getElementById('usersManagerList'),
    createBtn: document.getElementById('usersManagerCreateBtn')
  };

  const USER_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;
  const state = { users: {} };

  const safeObject = (value) => (value && typeof value === 'object' ? value : {});
  const normalizeValue = (value) => String(value || '').trim();
  const makeId = (prefix) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const escapeHtml = (value) => String(value || '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  const initialsFromName = (fullName) => {
    const parts = normalizeValue(fullName).split(/\s+/).filter(Boolean);
    return parts.slice(0, 2).map((item) => item.charAt(0).toUpperCase()).join('') || '';
  };

  const openIosSwal = (options) => Swal.fire({
    ...options,
    customClass: {
      popup: `ios-alert informes-alert users-manager-alert ${options?.customClass?.popup || ''}`.trim(),
      title: 'ios-alert-title',
      htmlContainer: 'ios-alert-text',
      confirmButton: 'primary',
      cancelButton: 'secondary',
      ...options.customClass
    }
  });

  const uploadToStorage = async (file, folder) => {
    const ext = normalizeValue(file?.name).split('.').pop() || 'jpg';
    const refPath = `${folder}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const ref = window.storageLaJamonera.ref().child(refPath);
    await ref.put(file);
    return ref.getDownloadURL();
  };

  const userAvatarHtml = (user) => {
    if (normalizeValue(user.photoUrl)) {
      return `<span class="user-avatar-thumb"><span class="thumb-loading"><sl-spinner class="meta-spinner-login" aria-label="Cargando"></sl-spinner></span><img class="thumb-image js-user-manager-photo" src="${escapeHtml(user.photoUrl)}" alt="${escapeHtml(user.fullName)}"></span>`;
    }
    return `<span class="user-avatar-thumb user-avatar-initials">${escapeHtml(initialsFromName(user.fullName) || 'U')}</span>`;
  };

  const initThumbs = () => {
    nodes.list.querySelectorAll('.js-user-manager-photo').forEach((img) => {
      const parent = img.closest('.user-avatar-thumb');
      const spinner = parent?.querySelector('.thumb-loading');
      const done = () => {
        img.classList.add('is-loaded');
        spinner?.remove();
      };
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', () => spinner?.remove(), { once: true });
      if (img.complete && img.naturalWidth > 0) done();
    });
  };

  const render = () => {
    const users = Object.values(state.users).sort((a, b) => String(a.fullName || '').localeCompare(String(b.fullName || ''), 'es'));
    if (!users.length) {
      nodes.list.innerHTML = '<div class="ingrediente-empty-list">No hay usuarios cargados.</div>';
      return;
    }
    nodes.list.innerHTML = users.map((user) => `
      <article class="users-manager-card">
        <div class="users-manager-card-main">
          ${userAvatarHtml(user)}
          <div class="users-manager-card-info">
            <h6>${escapeHtml(user.fullName || 'Sin nombre')}</h6>
            <p class="users-manager-card-position">${escapeHtml(user.position || 'Sin puesto')}</p>
            <p class="users-manager-card-email">${escapeHtml(user.email || '')}</p>
          </div>
        </div>
        <div class="users-manager-card-actions">
          <sl-button variant="default" size="small" class="lj-icon-btn users-manager-card-btn" type="button" data-user-edit="${escapeHtml(user.id)}" title="Editar usuario" aria-label="Editar usuario"><sl-icon name="pencil"></sl-icon></sl-button>
          <sl-button variant="default" size="small" class="lj-icon-btn users-manager-card-btn is-danger" type="button" data-user-delete="${escapeHtml(user.id)}" title="Eliminar usuario" aria-label="Eliminar usuario"><sl-icon name="trash"></sl-icon></sl-button>
        </div>
      </article>
    `).join('');
    initThumbs();
  };

  const loadUsers = async () => {
    nodes.loading.classList.remove('d-none');
    nodes.data.classList.add('d-none');
    await window.laJamoneraReady;
    const users = await window.dbLaJamoneraRest.read('/informes/users');
    state.users = safeObject(users);
    nodes.loading.classList.add('d-none');
    nodes.data.classList.remove('d-none');
    render();
  };

  const openUserForm = async (initial = null) => {
    let pendingFile = null;
    const result = await openIosSwal({
      title: initial ? 'Editar usuario' : 'Cargar usuario',
      customClass: { popup: 'users-manager-alert informes-user-form-alert ingredientes-alert' },
      html: `<div class="ingrediente-form-grid">
        <section class="step-block">
          <h6 class="step-title">1) Datos personales</h6>
          <div class="step-content">
            <sl-input id="userFullName" label="Nombre y apellido *" autocomplete="off" placeholder="Ej: Juan Pérez" value="${escapeHtml(initial?.fullName || '')}"></sl-input>
            <sl-input id="userPosition" label="Puesto en la empresa *" autocomplete="off" placeholder="Ej: Bromatólogo" value="${escapeHtml(initial?.position || '')}"></sl-input>
            <sl-input id="userEmail" label="Email *" autocomplete="off" type="email" placeholder="Ej: usuario@empresa.com" value="${escapeHtml(initial?.email || '')}"></sl-input>
            <sl-input id="userPin" label="Clave de 4 dígitos *" type="password" password-toggle maxlength="4" inputmode="numeric" autocomplete="new-password" placeholder="4 dígitos" value="${escapeHtml(initial?.pin || '')}"></sl-input>
          </div>
        </section>
        <section class="step-block">
          <h6 class="step-title">2) Fotografía (opcional)</h6>
          <div class="step-content">
            <div id="userPhotoPreview" class="image-preview-circle">${initial?.photoUrl ? `<img src="${escapeHtml(initial.photoUrl)}" alt="Foto">` : '<span class="image-placeholder-circle-2 user-initials-preview"><sl-icon name="person-fill"></sl-icon></span>'}</div>
            <input id="userPhotoInput" type="file" class="image-file-input" accept="image/*" hidden>
            <sl-button id="userPhotoPickBtn" type="button" variant="default" class="users-photo-pick"><i slot="prefix" class="fa-solid fa-camera"></i>Elegir foto</sl-button>
          </div>
        </section>
      </div>`,
      showCancelButton: true,
      confirmButtonText: initial ? 'Guardar cambios' : 'Crear usuario',
      cancelButtonText: 'Cancelar',
      didOpen: () => {
        const fullNameInput = document.getElementById('userFullName');
        const photoInput = document.getElementById('userPhotoInput');
        const preview = document.getElementById('userPhotoPreview');
        const photoPickBtn = document.getElementById('userPhotoPickBtn');
        const updateInitials = () => {
          if (pendingFile || normalizeValue(initial?.photoUrl)) return;
          const initials = initialsFromName(fullNameInput?.value);
          preview.innerHTML = initials
            ? `<span class="image-placeholder-circle-2 user-initials-preview">${escapeHtml(initials)}</span>`
            : '<span class="image-placeholder-circle-2 user-initials-preview"><sl-icon name="person-fill"></sl-icon></span>';
        };
        photoPickBtn?.addEventListener('click', () => photoInput?.click());
        fullNameInput?.addEventListener('input', updateInitials);
        photoInput?.addEventListener('change', () => {
          const file = photoInput.files?.[0] || null;
          if (!file) return;
          if (!USER_PHOTO_TYPES.includes(file.type) || file.size > MAX_UPLOAD_SIZE_BYTES) {
            photoInput.value = '';
            return;
          }
          pendingFile = file;
          preview.innerHTML = '<span class="image-preview-overlay"><sl-spinner class="meta-spinner-login" aria-label="Subiendo"></sl-spinner></span>';
          const tempUrl = URL.createObjectURL(file);
          setTimeout(() => {
            preview.innerHTML = `<img src="${tempUrl}" alt="Vista previa">`;
          }, 450);
        });
        updateInitials();
      },
      preConfirm: async () => {
        const fullName = normalizeValue(document.getElementById('userFullName')?.value);
        const position = normalizeValue(document.getElementById('userPosition')?.value);
        const email = normalizeValue(document.getElementById('userEmail')?.value);
        const pin = normalizeValue(document.getElementById('userPin')?.value);
        if (!fullName || !position || !email) return Swal.showValidationMessage('Completá nombre, puesto e email.');
        if (!/^\S+@\S+\.\S+$/.test(email)) return Swal.showValidationMessage('Ingresá un email válido.');
        if (!/^\d{4}$/.test(pin)) return Swal.showValidationMessage('La clave debe tener 4 dígitos.');
        let photoUrl = normalizeValue(initial?.photoUrl);
        if (pendingFile) {
          if (!USER_PHOTO_TYPES.includes(pendingFile.type)) return Swal.showValidationMessage('Formato de foto inválido.');
          if (pendingFile.size > MAX_UPLOAD_SIZE_BYTES) return Swal.showValidationMessage('La foto supera 10MB.');
          photoUrl = await uploadToStorage(pendingFile, 'informes/users');
        }
        return { fullName, position, email, pin, photoUrl };
      }
    });
    if (!result.isConfirmed || !result.value) return null;
    const id = normalizeValue(initial?.id) || makeId('user');
    state.users[id] = { id, ...result.value, updatedAt: Date.now(), createdAt: Number(initial?.createdAt || Date.now()) };
    await window.dbLaJamoneraRest.write('/informes/users', state.users);
    return id;
  };

  nodes.createBtn?.addEventListener('click', async () => {
    const created = await openUserForm();
    if (!created) return;
    render();
  });

  nodes.list?.addEventListener('click', async (event) => {
    const editBtn = event.target.closest('[data-user-edit]');
    if (editBtn) {
      const user = state.users[editBtn.dataset.userEdit];
      if (!user) return;
      const auth = await openIosSwal({ title: 'Clave de usuario', html: '<sl-input id="editUserPin" type="password" password-toggle autocomplete="off" placeholder="Clave actual"></sl-input>', showCancelButton: true, confirmButtonText: 'Continuar', preConfirm: () => {
        const pin = normalizeValue(document.getElementById('editUserPin')?.value);
        if (pin !== String(user.pin || '')) return Swal.showValidationMessage('Clave incorrecta.');
        return true;
      } });
      if (!auth.isConfirmed) return;
      const updated = await openUserForm(user);
      if (!updated) return;
      render();
      return;
    }
    const delBtn = event.target.closest('[data-user-delete]');
    if (delBtn) {
      const user = state.users[delBtn.dataset.userDelete];
      if (!user) return;
      const auth = await openIosSwal({ title: 'Clave de usuario', html: '<sl-input id="deleteUserPin" type="password" password-toggle autocomplete="off" placeholder="Clave"></sl-input>', showCancelButton: true, confirmButtonText: 'Continuar', preConfirm: () => {
        const pin = normalizeValue(document.getElementById('deleteUserPin')?.value);
        if (pin !== String(user.pin || '')) return Swal.showValidationMessage('Clave incorrecta.');
        return true;
      } });
      if (!auth.isConfirmed) return;
      const confirm = await openIosSwal({ title: 'Eliminar usuario', html: `<p>Se eliminará a <strong>${escapeHtml(user.fullName)}</strong>.</p>`, icon: 'warning', showCancelButton: true, confirmButtonText: 'Eliminar', cancelButtonText: 'Cancelar' });
      if (!confirm.isConfirmed) return;
      delete state.users[user.id];
      await window.dbLaJamoneraRest.write('/informes/users', state.users);
      render();
    }
  });

  LJModal.on(modalEl, 'shown', () => {
    loadUsers().catch(() => {
      nodes.loading.classList.add('d-none');
      nodes.data.classList.remove('d-none');
      nodes.list.innerHTML = '<div class="ingrediente-empty-list">No se pudieron cargar usuarios.</div>';
    });
  });
})();
