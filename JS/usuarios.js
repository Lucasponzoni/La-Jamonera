// Usuarios (personas de la planta: encargados, responsables, autores de informes y análisis).
// Datos en /informes/users { id: { id, fullName, position, email, phone?, pin, photoUrl, createdAt, updatedAt } }.
// Vista lista + ficha (como Recetas); el editor es una vista interna con "Volver".
(function usuariosModule() {
  const modalEl = document.getElementById('usersManagerModal');
  if (!modalEl) return;

  const USERS_PATH = '/informes/users';
  const nodes = {
    loading: document.getElementById('usersManagerLoading'),
    data: document.getElementById('usersManagerData'),
    toolbar: document.getElementById('usersManagerToolbar'),
    master: document.getElementById('usersManagerMaster'),
    list: document.getElementById('usersManagerList'),
    detail: document.getElementById('usersManagerDetail'),
    editor: document.getElementById('usersManagerEditor'),
    search: document.getElementById('usersManagerSearch'),
    filter: document.getElementById('usersManagerPositionFilter'),
    count: document.getElementById('usersManagerCount'),
    createBtn: document.getElementById('usersManagerCreateBtn')
  };

  const USER_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;
  const state = { users: {}, search: '', position: '', selectedId: '', usage: null, mobileDetail: false };

  const safeObject = (value) => (value && typeof value === 'object' ? value : {});
  const normalizeValue = (value) => String(value || '').trim();
  const makeId = (prefix) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const escapeHtml = (value) => String(value || '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  const fold = (value) => normalizeValue(value).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const optValue = (raw) => (window.ljOptionValue ? window.ljOptionValue(raw) : raw);
  const selectValue = (el) => (window.ljSelectValue ? window.ljSelectValue(el) : el?.value);
  const notify = (type, title, message) => window.laJamoneraNotify?.show?.({ type, title, message });
  const isMobile = () => window.matchMedia('(max-width: 767.98px)').matches;
  const fmtDate = (ms) => (ms ? new Date(Number(ms)).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '');

  const initialsFromName = (fullName) => {
    const parts = normalizeValue(fullName).split(/\s+/).filter(Boolean);
    return parts.slice(0, 2).map((item) => item.charAt(0).toUpperCase()).join('') || '';
  };
  // Color estable por persona para las iniciales.
  const colorFor = (seed) => {
    let hash = 0;
    String(seed || 'u').split('').forEach((c) => { hash = (hash * 31 + c.charCodeAt(0)) | 0; });
    return `hsl(${Math.abs(hash) % 360}, 52%, 42%)`;
  };

  const openIosSwal = (options) => Swal.fire({
    ...options,
    customClass: {
      popup: `users-manager-alert ${options?.customClass?.popup || ''}`.trim(),
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

  // --- Avatares ---
  const avatarHtml = (user, size = 'sm') => {
    const cls = `users-avatar is-${size}`;
    if (normalizeValue(user.photoUrl)) {
      return `<span class="${cls}"><sl-skeleton effect="sheen" class="users-avatar-sk"></sl-skeleton><img class="js-user-photo" src="${escapeHtml(user.photoUrl)}" alt="" loading="lazy"></span>`;
    }
    return `<span class="${cls} is-initials" style="--users-avatar-bg:${colorFor(user.id || user.fullName)}" aria-hidden="true">${escapeHtml(initialsFromName(user.fullName) || 'U')}</span>`;
  };
  const initPhotos = (root) => {
    root.querySelectorAll('.js-user-photo').forEach((img) => {
      const done = () => { img.classList.add('is-loaded'); img.previousElementSibling?.remove(); };
      const fail = () => {
        const wrap = img.closest('.users-avatar');
        img.previousElementSibling?.remove();
        img.remove();
        wrap?.classList.add('is-broken');
      };
      if (img.complete && img.naturalWidth > 0) done();
      else { img.addEventListener('load', done, { once: true }); img.addEventListener('error', fail, { once: true }); }
    });
  };

  // --- Datos derivados ---
  const allUsers = () => Object.values(state.users)
    .filter((u) => u && typeof u === 'object')
    .sort((a, b) => String(a.fullName || '').localeCompare(String(b.fullName || ''), 'es'));
  const positionsWithCount = () => {
    const map = new Map();
    allUsers().forEach((u) => {
      const key = normalizeValue(u.position) || 'Sin puesto';
      map.set(key, (map.get(key) || 0) + 1);
    });
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es'));
  };
  const visibleUsers = () => {
    const q = fold(state.search);
    return allUsers().filter((u) => {
      if (state.position && (normalizeValue(u.position) || 'Sin puesto') !== state.position) return false;
      if (!q) return true;
      return [u.fullName, u.position, u.email, u.phone].some((v) => fold(v).includes(q));
    });
  };

  // Uso en informes y análisis: índices livianos (unos KB). Producción no se cuenta: el árbol de
  // registros pesa varios MB y no vale la pena leerlo sólo para este dato.
  const loadUsage = async () => {
    const usage = {};
    const walk = (tree, key) => {
      Object.entries(safeObject(tree)).forEach(([year, months]) => {
        if (year === 'users') return;
        Object.values(safeObject(months)).forEach((days) => Object.values(safeObject(days)).forEach((items) => {
          Object.values(safeObject(items)).forEach((item) => {
            const uid = normalizeValue(item?.userId);
            if (!uid) return;
            usage[uid] = usage[uid] || { informes: 0, analisis: 0 };
            usage[uid][key] += 1;
          });
        }));
      });
    };
    try {
      const [inf, ana] = await Promise.all([
        window.dbLaJamoneraRest.read('/informes_index').catch(() => null),
        window.dbLaJamoneraRest.read('/analisis_quimicos_index').catch(() => null)
      ]);
      walk(inf, 'informes');
      walk(ana, 'analisis');
      state.usage = usage;
    } catch (error) {
      state.usage = null;
    }
  };

  // --- Render ---
  const renderFilter = () => {
    if (!nodes.filter) return;
    const current = state.position;
    nodes.filter.innerHTML = '<i slot="prefix" class="fa-solid fa-id-badge" aria-hidden="true"></i>'
      + positionsWithCount().map(([name, n]) => `<sl-option value="${escapeHtml(optValue(name))}">${escapeHtml(name)}<span slot="suffix" class="users-option-count">${n}</span></sl-option>`).join('');
    if (window.ljSetSelectValue) window.ljSetSelectValue(nodes.filter, current || '');
  };

  const renderList = () => {
    const users = visibleUsers();
    const total = allUsers().length;
    if (nodes.count) {
      nodes.count.hidden = !total;
      nodes.count.textContent = total === 1 ? '1 usuario' : `${total} usuarios`;
    }
    if (!users.length) {
      nodes.list.innerHTML = total
        ? '<div class="users-empty"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i><p>No hay usuarios que coincidan.</p></div>'
        : '<div class="users-empty"><i class="fa-solid fa-users" aria-hidden="true"></i><p>Todavía no hay usuarios cargados.</p><sl-button size="small" variant="success" data-user-create><i slot="prefix" class="fa-solid fa-user-plus"></i>Crear el primero</sl-button></div>';
      return;
    }
    if (!users.some((u) => u.id === state.selectedId)) state.selectedId = isMobile() ? '' : users[0].id;
    nodes.list.innerHTML = users.map((u) => {
      const active = u.id === state.selectedId;
      return `<button type="button" class="lj-tile users-item${active ? ' is-active' : ''}" role="option" aria-selected="${active}" tabindex="${active || (!state.selectedId && u === users[0]) ? 0 : -1}" data-user-id="${escapeHtml(u.id)}">
        ${avatarHtml(u, 'sm')}
        <span class="users-item-copy">
          <strong title="${escapeHtml(u.fullName || 'Sin nombre')}">${escapeHtml(u.fullName || 'Sin nombre')}</strong>
          <small title="${escapeHtml(u.email || '')}">${u.email ? escapeHtml(u.email) : 'Sin email'}</small>
        </span>
        <span class="recetas-tag tone-neu users-item-tag">${escapeHtml(u.position || 'Sin puesto')}</span>
      </button>`;
    }).join('');
    initPhotos(nodes.list);
  };

  const usageHtml = (user) => {
    const u = state.usage ? state.usage[user.id] || { informes: 0, analisis: 0 } : null;
    const block = (label, value, note) => `<div class="recetas-kpi"><span>${label}</span><b>${value}</b><small>${note}</small></div>`;
    return `<div class="recetas-kpis users-kpis">
      ${block('Informes', u ? u.informes : '—', u ? (u.informes === 1 ? 'informe firmado' : 'informes firmados') : 'sin datos')}
      ${block('Análisis', u ? u.analisis : '—', u ? (u.analisis === 1 ? 'análisis cargado' : 'análisis cargados') : 'sin datos')}
      ${block('Alta', fmtDate(user.createdAt) || '—', 'fecha de carga')}
      ${block('Actualizado', fmtDate(user.updatedAt) || '—', 'último cambio')}
    </div>`;
  };

  const renderDetail = () => {
    const user = state.users[state.selectedId];
    nodes.master.classList.toggle('is-detail-open', Boolean(user) && state.mobileDetail);
    if (!user) {
      nodes.detail.innerHTML = '<div class="recetas-detail-empty"><i class="fa-solid fa-user" aria-hidden="true"></i><p>Elegí un usuario de la lista para ver su ficha.</p></div>';
      return;
    }
    const email = normalizeValue(user.email);
    const phone = normalizeValue(user.phone);
    nodes.detail.innerHTML = `
      <div class="users-detail-mobilebar">
        <sl-button size="small" variant="default" data-user-back><i slot="prefix" class="fa-solid fa-arrow-left"></i>Volver</sl-button>
      </div>
      <header class="users-detail-head">
        ${avatarHtml(user, 'lg')}
        <div class="users-detail-titles">
          <h3 class="users-detail-name">${escapeHtml(user.fullName || 'Sin nombre')}</h3>
          <p class="users-detail-meta"><span class="recetas-tag tone-info users-detail-role"><i class="fa-solid fa-id-badge" aria-hidden="true"></i>${escapeHtml(user.position || 'Sin puesto')}</span></p>
        </div>
        <div class="users-detail-tools">
          <sl-button variant="primary" size="small" data-user-edit="${escapeHtml(user.id)}"><i slot="prefix" class="fa-solid fa-pen"></i>Editar</sl-button>
          <sl-dropdown placement="bottom-end" hoist class="users-detail-more">
            <sl-button slot="trigger" size="small" variant="default" class="lj-icon-btn" title="Más acciones" aria-label="Más acciones"><i class="fa-solid fa-ellipsis"></i></sl-button>
            <sl-menu>
              <sl-menu-item value="copy" ${email ? '' : 'disabled'}><i slot="prefix" class="fa-regular fa-copy"></i>Copiar email</sl-menu-item>
              <sl-divider></sl-divider>
              <sl-menu-item value="delete" class="is-danger"><i slot="prefix" class="fa-solid fa-trash"></i>Eliminar usuario</sl-menu-item>
            </sl-menu>
          </sl-dropdown>
        </div>
      </header>
      <dl class="users-facts">
        <div><dt><i class="fa-regular fa-envelope" aria-hidden="true"></i>Email</dt><dd>${email ? `<a href="mailto:${escapeHtml(email)}" title="${escapeHtml(email)}">${escapeHtml(email)}</a>` : '<span class="users-muted">Sin email</span>'}</dd></div>
        <div><dt><i class="fa-solid fa-phone" aria-hidden="true"></i>Teléfono</dt><dd>${phone ? `<a href="tel:${escapeHtml(phone.replace(/[^\d+]/g, ''))}">${escapeHtml(phone)}</a>` : '<span class="users-muted">Sin teléfono</span>'}</dd></div>
        <div><dt><i class="fa-solid fa-lock" aria-hidden="true"></i>Clave</dt><dd>${user.pin ? 'Configurada (4 dígitos)' : '<span class="users-muted">Sin clave</span>'}</dd></div>
      </dl>
      <section class="recetas-detail-section">
        <h4 class="recetas-detail-title"><i class="fa-solid fa-chart-simple" aria-hidden="true"></i>Uso</h4>
        ${usageHtml(user)}
      </section>`;
    initPhotos(nodes.detail);
  };

  const render = () => {
    renderList();
    renderDetail();
  };

  const select = (id, { focus = false, openMobile = true } = {}) => {
    state.selectedId = id;
    state.mobileDetail = openMobile && isMobile();
    render();
    if (focus) nodes.list.querySelector(`[data-user-id="${CSS.escape(id)}"]`)?.focus();
  };

  // --- Editor (vista interna) ---
  const showEditor = (open) => {
    nodes.editor.hidden = !open;
    nodes.master.hidden = open;
    nodes.toolbar.hidden = open;
    LJModal.body?.(modalEl)?.scrollTo?.(0, 0);
  };

  const askPin = async (user, title) => {
    if (!normalizeValue(user.pin)) return true;
    const auth = await openIosSwal({
      title,
      html: `<p>Ingresá la clave de 4 dígitos de <strong>${escapeHtml(user.fullName)}</strong>.</p><sl-input id="usersPinCheck" type="password" password-toggle inputmode="numeric" maxlength="4" autocomplete="off" placeholder="Clave" label="Clave"></sl-input>`,
      showCancelButton: true,
      confirmButtonText: 'Continuar',
      cancelButtonText: 'Cancelar',
      preConfirm: () => {
        const pin = normalizeValue(document.getElementById('usersPinCheck')?.value);
        if (pin !== String(user.pin || '')) return Swal.showValidationMessage('Clave incorrecta.');
        return true;
      }
    });
    return auth.isConfirmed;
  };

  const openEditor = (initial = null) => {
    let pendingFile = null;
    let photoUrl = normalizeValue(initial?.photoUrl);
    const positions = positionsWithCount().map(([p]) => p).filter((p) => p !== 'Sin puesto');
    nodes.editor.innerHTML = `
      <header class="users-editor-head">
        <sl-button variant="default" size="small" data-editor-back><i slot="prefix" class="fa-solid fa-arrow-left"></i>Volver</sl-button>
        <div>
          <h3>${initial ? 'Editar usuario' : 'Nuevo usuario'}</h3>
          <p>${initial ? escapeHtml(initial.fullName || '') : 'Completá los datos de la persona.'}</p>
        </div>
      </header>
      <form class="users-editor-form" novalidate>
        <div class="users-editor-photo">
          <span class="users-avatar is-xl" id="usersEditorPreview"></span>
          <div class="users-editor-photo-actions">
            <input id="usersEditorFile" type="file" accept="image/*" hidden>
            <sl-button size="small" variant="default" data-photo-upload><i slot="prefix" class="fa-solid fa-upload"></i>Subir foto</sl-button>
            <sl-button size="small" variant="default" data-photo-link><i slot="prefix" class="fa-solid fa-link"></i>Pegar link</sl-button>
            <sl-button size="small" variant="text" data-photo-clear class="is-danger"><i slot="prefix" class="fa-solid fa-xmark"></i>Quitar</sl-button>
            <small class="users-muted">JPG, PNG o WEBP hasta 10 MB.</small>
          </div>
        </div>
        <div class="users-editor-grid">
          <sl-input name="fullName" label="Nombre y apellido" required autocomplete="off" placeholder="Ej: Juan Pérez" value="${escapeHtml(initial?.fullName || '')}"></sl-input>
          <div class="users-field">
            <sl-input name="position" label="Puesto" required autocomplete="off" placeholder="Ej: Jefe de Producción" value="${escapeHtml(initial?.position || '')}"></sl-input>
            <div class="users-suggest">${positions.slice(0, 6).map((p) => `<sl-button size="small" variant="default" class="users-suggest-chip" data-position="${escapeHtml(p)}">${escapeHtml(p)}</sl-button>`).join('')}</div>
          </div>
          <sl-input name="email" type="email" label="Email" required autocomplete="off" placeholder="usuario@empresa.com" value="${escapeHtml(initial?.email || '')}"></sl-input>
          <sl-input name="phone" type="tel" label="Teléfono (opcional)" autocomplete="off" placeholder="Ej: 341 555-1234" value="${escapeHtml(initial?.phone || '')}"></sl-input>
          <sl-input name="pin" type="password" password-toggle label="Clave de 4 dígitos" required inputmode="numeric" maxlength="4" autocomplete="new-password" placeholder="4 dígitos" help-text="Se pide para editar o eliminar este usuario." value="${escapeHtml(initial?.pin || '')}"></sl-input>
        </div>
        <p class="users-editor-error" role="alert" hidden></p>
        <footer class="users-editor-footer">
          <sl-button variant="default" data-editor-back>Cancelar</sl-button>
          <sl-button variant="primary" type="submit" data-editor-save><i slot="prefix" class="fa-solid fa-floppy-disk"></i>${initial ? 'Guardar cambios' : 'Crear usuario'}</sl-button>
        </footer>
      </form>`;
    showEditor(true);

    const form = nodes.editor.querySelector('form');
    const field = (name) => form.querySelector(`[name="${name}"]`);
    const preview = nodes.editor.querySelector('#usersEditorPreview');
    const fileInput = nodes.editor.querySelector('#usersEditorFile');
    const errorEl = nodes.editor.querySelector('.users-editor-error');
    const paintPreview = (src) => {
      if (src) {
        preview.classList.remove('is-initials');
        preview.removeAttribute('style');
        preview.innerHTML = `<img src="${escapeHtml(src)}" alt="Vista previa" class="is-loaded">`;
        return;
      }
      const name = field('fullName').value;
      preview.classList.add('is-initials');
      preview.style.setProperty('--users-avatar-bg', colorFor(initial?.id || name));
      preview.innerHTML = initialsFromName(name) ? escapeHtml(initialsFromName(name)) : '<i class="fa-solid fa-user" aria-hidden="true"></i>';
    };
    paintPreview(photoUrl);
    const setError = (msg) => { errorEl.hidden = !msg; errorEl.textContent = msg || ''; };

    field('fullName').addEventListener('sl-input', () => { if (!pendingFile && !photoUrl) paintPreview(''); });
    nodes.editor.querySelectorAll('[data-position]').forEach((chip) => chip.addEventListener('click', () => { field('position').value = chip.dataset.position; }));
    nodes.editor.querySelector('[data-photo-upload]').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0] || null;
      if (!file) return;
      if (!USER_PHOTO_TYPES.includes(file.type)) { setError('Formato de foto inválido: usá JPG, PNG, WEBP o GIF.'); fileInput.value = ''; return; }
      if (file.size > MAX_UPLOAD_SIZE_BYTES) { setError('La foto supera los 10 MB.'); fileInput.value = ''; return; }
      setError('');
      pendingFile = file;
      paintPreview(URL.createObjectURL(file));
    });
    nodes.editor.querySelector('[data-photo-link]').addEventListener('click', async () => {
      const res = await openIosSwal({ title: 'Link de la foto', input: 'url', inputPlaceholder: 'https://…', inputValue: photoUrl, showCancelButton: true, confirmButtonText: 'Usar link', cancelButtonText: 'Cancelar',
        preConfirm: (v) => (/^https?:\/\/\S+$/.test(normalizeValue(v)) ? normalizeValue(v) : Swal.showValidationMessage('Pegá un link que empiece con http.')) });
      if (!res.isConfirmed || !res.value) return;
      pendingFile = null;
      photoUrl = res.value;
      paintPreview(photoUrl);
    });
    nodes.editor.querySelector('[data-photo-clear]').addEventListener('click', () => { pendingFile = null; photoUrl = ''; fileInput.value = ''; paintPreview(''); });
    nodes.editor.querySelectorAll('[data-editor-back]').forEach((b) => b.addEventListener('click', () => closeEditor()));

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const value = {
        fullName: normalizeValue(field('fullName').value),
        position: normalizeValue(field('position').value),
        email: normalizeValue(field('email').value),
        phone: normalizeValue(field('phone').value),
        pin: normalizeValue(field('pin').value)
      };
      if (!value.fullName || !value.position || !value.email) return setError('Completá nombre, puesto y email.');
      if (!/^\S+@\S+\.\S+$/.test(value.email)) return setError('Ingresá un email válido.');
      if (!/^\d{4}$/.test(value.pin)) return setError('La clave tiene que tener 4 dígitos.');
      setError('');
      const saveBtn = form.querySelector('[data-editor-save]');
      saveBtn.loading = true;
      try {
        let finalPhoto = photoUrl;
        if (pendingFile) finalPhoto = await uploadToStorage(pendingFile, 'informes/users');
        const id = normalizeValue(initial?.id) || makeId('user');
        const record = { ...safeObject(initial), id, ...value, photoUrl: finalPhoto, updatedAt: Date.now(), createdAt: Number(initial?.createdAt || Date.now()) };
        if (!record.phone) delete record.phone;
        const next = { ...state.users, [id]: record };
        await window.dbLaJamoneraRest.write(USERS_PATH, next);
        state.users = next;
        notify('success', initial ? 'Usuario actualizado' : 'Usuario creado', record.fullName);
        renderFilter();
        closeEditor(id);
      } catch (error) {
        setError(`No se pudo guardar: ${error?.message || error}`);
      } finally {
        saveBtn.loading = false;
      }
    });
    requestAnimationFrame(() => field('fullName').focus?.({ preventScroll: true }));
  };

  const closeEditor = (selectId) => {
    showEditor(false);
    nodes.editor.innerHTML = '';
    if (selectId) select(selectId, { openMobile: true }); else render();
  };

  const deleteUser = async (user) => {
    if (!(await askPin(user, 'Eliminar usuario'))) return;
    const confirm = await openIosSwal({ title: 'Eliminar usuario', icon: 'warning', html: `<p>Se eliminará a <strong>${escapeHtml(user.fullName)}</strong>. Los informes y producciones donde figura no se modifican.</p>`, showCancelButton: true, confirmButtonText: 'Eliminar', cancelButtonText: 'Cancelar', customClass: { confirmButton: 'danger' } });
    if (!confirm.isConfirmed) return;
    const next = { ...state.users };
    delete next[user.id];
    await window.dbLaJamoneraRest.write(USERS_PATH, next);
    state.users = next;
    state.selectedId = '';
    state.mobileDetail = false;
    renderFilter();
    render();
    notify('success', 'Usuario eliminado', user.fullName);
  };

  // --- Eventos ---
  const onSearch = () => { state.search = normalizeValue(nodes.search.value); render(); };
  nodes.search?.addEventListener('sl-input', onSearch);
  nodes.search?.addEventListener('sl-clear', onSearch);
  nodes.filter?.addEventListener('sl-change', () => { state.position = normalizeValue(selectValue(nodes.filter)); render(); });
  nodes.createBtn?.addEventListener('click', () => openEditor(null));

  nodes.list.addEventListener('click', (event) => {
    if (event.target.closest('[data-user-create]')) { openEditor(null); return; }
    const item = event.target.closest('[data-user-id]');
    if (item) select(item.dataset.userId);
  });
  // Teclado: flechas, Inicio y Fin mueven la selección (como Recetas).
  nodes.list.addEventListener('keydown', (event) => {
    const items = [...nodes.list.querySelectorAll('[data-user-id]')];
    const idx = items.indexOf(document.activeElement);
    if (idx < 0) return;
    const to = { ArrowDown: idx + 1, ArrowUp: idx - 1, Home: 0, End: items.length - 1 }[event.key];
    if (to === undefined) return;
    event.preventDefault();
    const target = items[Math.max(0, Math.min(items.length - 1, to))];
    if (target) select(target.dataset.userId, { focus: true, openMobile: false });
  });

  nodes.detail.addEventListener('click', async (event) => {
    if (event.target.closest('[data-user-back]')) { state.mobileDetail = false; renderDetail(); return; }
    const editBtn = event.target.closest('[data-user-edit]');
    if (editBtn) {
      const user = state.users[editBtn.dataset.userEdit];
      if (user && (await askPin(user, 'Editar usuario'))) openEditor(user);
    }
  });
  nodes.detail.addEventListener('sl-select', async (event) => {
    const user = state.users[state.selectedId];
    if (!user) return;
    const action = event.detail?.item?.value;
    if (action === 'copy' && user.email) {
      try { await navigator.clipboard.writeText(user.email); notify('success', 'Email copiado', user.email); } catch (e) { notify('error', 'No se pudo copiar', user.email); }
    }
    if (action === 'delete') deleteUser(user).catch((e) => notify('error', 'No se pudo eliminar', String(e?.message || e)));
  });

  const loadUsers = async () => {
    nodes.loading.classList.remove('d-none');
    nodes.data.classList.add('d-none');
    await window.laJamoneraReady;
    const users = await window.dbLaJamoneraRest.read(USERS_PATH);
    state.users = safeObject(users);
    nodes.loading.classList.add('d-none');
    nodes.data.classList.remove('d-none');
    renderFilter();
    render();
    loadUsage().then(() => renderDetail());
  };

  LJModal.on(modalEl, 'shown', () => {
    showEditor(false);
    loadUsers().catch(() => {
      nodes.loading.classList.add('d-none');
      nodes.data.classList.remove('d-none');
      nodes.list.innerHTML = '<div class="users-empty"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i><p>No se pudieron cargar los usuarios.</p></div>';
    });
  });
})();
