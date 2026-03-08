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
    target: modalEl,
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

  const uploadToStorage = async (file, folder) => {
    const ext = normalizeValue(file?.name).split('.').pop() || 'jpg';
    const refPath = `${folder}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const ref = window.storageLaJamonera.ref().child(refPath);
    await ref.put(file);
    return ref.getDownloadURL();
  };

  const userAvatarHtml = (user) => {
    if (normalizeValue(user.photoUrl)) {
      return `<span class="user-avatar-thumb"><span class="thumb-loading"><img class="meta-spinner-login" src="./IMG/Meta-ai-logo.webp" alt="Cargando"></span><img class="thumb-image js-user-manager-photo" src="${escapeHtml(user.photoUrl)}" alt="${escapeHtml(user.fullName)}"></span>`;
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
      <div>
        <article class="user-card">
          ${userAvatarHtml(user)}
          <div class="user-main">
            <h6>${escapeHtml(user.fullName || 'Sin nombre')}</h6>
            <p>${escapeHtml(user.position || 'Sin puesto')}</p>
            <p>${escapeHtml(user.email || '')}</p>
          </div>
        </article>
        <div class="family-circle-actions mt-2 justify-content-center">
          <button class="family-manage-btn" type="button" data-user-edit="${escapeHtml(user.id)}" title="Editar usuario"><i class="fa-solid fa-pen"></i></button>
          <button class="family-manage-btn" type="button" data-user-delete="${escapeHtml(user.id)}" title="Eliminar usuario"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>
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
      title: initial ? 'Editar usuario' : 'Crear usuario',
      html: `<div class="swal-stack-fields text-start">
        <input id="userFullName" class="swal2-input ios-input" placeholder="Nombre completo" value="${escapeHtml(initial?.fullName || '')}">
        <input id="userPosition" class="swal2-input ios-input" placeholder="Puesto" value="${escapeHtml(initial?.position || '')}">
        <input id="userEmail" class="swal2-input ios-input" type="email" placeholder="Email" value="${escapeHtml(initial?.email || '')}">
        <input id="userPin" class="swal2-input ios-input" maxlength="4" placeholder="Clave (4 dígitos)" value="${escapeHtml(initial?.pin || '')}">
        <label class="inventario-upload-dropzone" for="userPhotoInput"><i class="fa-regular fa-image"></i><span>Foto de perfil: click o arrastrá</span></label>
        <input id="userPhotoInput" class="form-control image-file-input inventario-hidden-file-input" type="file" accept="image/*">
      </div>`,
      showCancelButton: true,
      confirmButtonText: initial ? 'Guardar cambios' : 'Crear usuario',
      cancelButtonText: 'Cancelar',
      didOpen: () => {
        const input = document.getElementById('userPhotoInput');
        const dropzone = document.querySelector('#userPhotoInput')?.previousElementSibling;
        input?.addEventListener('change', () => {
          pendingFile = input.files?.[0] || null;
        });
        dropzone?.addEventListener('dragover', (event) => {
          event.preventDefault();
          dropzone.classList.add('is-dragging');
        });
        dropzone?.addEventListener('dragleave', () => dropzone.classList.remove('is-dragging'));
        dropzone?.addEventListener('drop', (event) => {
          event.preventDefault();
          dropzone.classList.remove('is-dragging');
          const file = event.dataTransfer?.files?.[0];
          if (!file || !input) return;
          const dt = new DataTransfer();
          dt.items.add(file);
          input.files = dt.files;
          pendingFile = file;
        });
      },
      preConfirm: async () => {
        const fullName = normalizeValue(document.getElementById('userFullName')?.value);
        const position = normalizeValue(document.getElementById('userPosition')?.value);
        const email = normalizeValue(document.getElementById('userEmail')?.value);
        const pin = normalizeValue(document.getElementById('userPin')?.value);
        if (!fullName) return Swal.showValidationMessage('Completá el nombre.');
        if (!position) return Swal.showValidationMessage('Completá el puesto.');
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
      const auth = await openIosSwal({ title: 'Clave de usuario', html: '<input id="editUserPin" type="password" class="swal2-input ios-input" placeholder="Clave actual">', showCancelButton: true, confirmButtonText: 'Continuar', preConfirm: () => {
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
      const auth = await openIosSwal({ title: 'Clave de usuario', html: '<input id="deleteUserPin" type="password" class="swal2-input ios-input" placeholder="Clave">', showCancelButton: true, confirmButtonText: 'Continuar', preConfirm: () => {
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

  modalEl.addEventListener('shown.bs.modal', () => {
    loadUsers().catch(() => {
      nodes.loading.classList.add('d-none');
      nodes.data.classList.remove('d-none');
      nodes.list.innerHTML = '<div class="ingrediente-empty-list">No se pudieron cargar usuarios.</div>';
    });
  });
})();
