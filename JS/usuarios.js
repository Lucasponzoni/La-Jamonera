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
    createBtn: document.getElementById('usersManagerCreateBtn'),
    templateBtn: document.getElementById('usersManagerTemplateBtn')
  };

  const USER_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;
  const state = { users: {}, search: '', position: '', selectedId: '', usage: null, mobileDetail: false, me: null, access: {} };
  // Acceso al sistema (login, rol y permisos): sólo con backend Supabase y para administradores.
  const SUPABASE = window.LJ_BACKEND === 'supabase';
  const isAdmin = () => SUPABASE && Boolean(state.me?.admin);

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
      return `<span class="${cls}"><sl-skeleton effect="sheen" class="users-avatar-sk"></sl-skeleton><img class="js-user-photo" src="${(window.ljThumb || String)(escapeHtml(user.photoUrl))}" alt="" loading="lazy"></span>`;
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

  // --- Acceso al sistema (Supabase) ---
  const ADMIN_ERRORS = {
    ya_tiene_acceso: 'Esta persona ya tiene acceso al sistema.',
    email_invalido: 'La persona necesita un email válido para tener login.',
    email_de_otra_persona: 'Ese email ya es el login de otra persona.',
    ultimo_admin: 'No se puede: es el único administrador activo.',
    no_podes_quitarte_admin: 'No podés quitarte el rol de administrador a vos mismo.',
    no_podes_desactivarte: 'No podés desactivar tu propio usuario.',
    email_key_missing: 'Falta configurar Resend (Configuración → Correo) para enviar invitaciones.',
    email_config_incomplete: 'Falta el remitente de Resend (Configuración → Correo).',
    password_corta: 'La contraseña temporal tiene que tener al menos 8 caracteres.',
    admin_required: 'Sólo un administrador puede hacer esto.'
  };
  const adminApi = async (action, body = {}) => {
    const redirectTo = `${location.origin}${location.pathname.replace(/[^/]*$/, '')}login.html`;
    const res = await window.laJamoneraProxy.postJson('/admin-users', { action, redirectTo, ...body });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.ok === false) throw new Error(ADMIN_ERRORS[json.error] || json.error || `Error ${res.status}`);
    return json;
  };
  const loadAccess = async () => {
    if (!SUPABASE) { state.access = {}; return; }
    state.me = await window.LJMe;
    if (nodes.templateBtn) nodes.templateBtn.hidden = !isAdmin();
    if (!isAdmin()) { state.access = {}; return; }
    const out = await adminApi('list');
    const next = {};
    (out.personas || []).forEach((p) => { next[p.id] = p; });
    state.access = next;
  };
  const ROLE_LABEL = { admin: 'Administrador', empleado: 'Empleado' };
  const accessOf = (user) => state.access[user.id] || null;
  const accessState = (a) => {
    if (!a || a.acceso !== 'login' || !a.login) return { kind: 'interno', label: 'Uso interno', tone: 'tone-neu' };
    if (!a.login.activo || a.login.baneado) return { kind: 'off', label: 'Desactivado', tone: 'tone-danger' };
    if (a.invitacion_estado === 'pendiente' && !a.login.lastSignInAt) return { kind: 'pending', label: 'Invitación pendiente', tone: 'tone-warn' };
    return { kind: 'on', label: 'Activo', tone: 'tone-ok' };
  };
  const listAccessTag = (user) => {
    if (!isAdmin()) return '';
    const a = accessOf(user);
    if (!a || a.acceso !== 'login' || !a.login) return '';
    const role = ROLE_LABEL[a.login.role] || 'Empleado';
    return `<span class="users-login-dot" title="Login · ${escapeHtml(role)}" aria-label="Tiene login (${escapeHtml(role)})"><i class="fa-solid fa-right-to-bracket" aria-hidden="true"></i></span>`;
  };
  const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : '');
  const accessSectionHtml = (user) => {
    if (!isAdmin()) return '';
    const a = accessOf(user);
    const st = accessState(a);
    if (st.kind === 'interno') {
      return `<section class="recetas-detail-section users-access">
        <h4 class="recetas-detail-title"><i class="fa-solid fa-right-to-bracket" aria-hidden="true"></i>Acceso al sistema</h4>
        <div class="users-access-row">
          <span class="recetas-tag tone-neu">Uso interno</span>
          <p class="users-muted">Aparece en planillas y firma con su clave, pero no entra al sistema.</p>
          <sl-button size="small" variant="primary" data-access-grant><i slot="prefix" class="fa-solid fa-key"></i>Dar acceso al sistema</sl-button>
        </div>
      </section>`;
    }
    const l = a.login;
    const isAdminRole = l.role === 'admin';
    const self = l.userId === state.me?.uid;
    return `<section class="recetas-detail-section users-access">
      <h4 class="recetas-detail-title"><i class="fa-solid fa-right-to-bracket" aria-hidden="true"></i>Acceso al sistema</h4>
      <div class="users-access-head">
        <span class="recetas-tag tone-info">Login · ${escapeHtml(ROLE_LABEL[l.role] || 'Empleado')}</span>
        <span class="recetas-tag ${st.tone}">${escapeHtml(st.label)}</span>
        <small class="users-muted">${l.lastSignInAt ? `Último ingreso ${escapeHtml(fmtDateTime(l.lastSignInAt))}` : 'Todavía no ingresó'}${l.email ? ` · ${escapeHtml(l.email)}` : ''}</small>
      </div>
      <div class="users-access-grid">
        <sl-select size="small" label="Rol" data-access-role value="${escapeHtml(l.role || 'empleado')}" ${self ? 'disabled help-text="No podés cambiar tu propio rol."' : ''} hoist>
          <sl-option value="empleado">Empleado</sl-option>
          <sl-option value="admin">Administrador</sl-option>
        </sl-select>
        <div class="users-access-perms">
          <sl-switch size="small" data-access-perm="editar" ${l.puedeEditar ? 'checked' : ''} ${isAdminRole ? 'disabled' : ''}>Puede editar registros guardados</sl-switch>
          <sl-switch size="small" data-access-perm="borrar" ${l.puedeBorrar ? 'checked' : ''} ${isAdminRole ? 'disabled' : ''}>Puede borrar registros</sl-switch>
          <small class="users-muted">${isAdminRole ? 'El administrador tiene todos los permisos.' : 'Siempre puede ver y crear (producir, ingresar stock, repartos, informes).'}</small>
        </div>
      </div>
      <div class="users-access-actions">
        ${st.kind === 'pending' ? '<sl-button size="small" variant="default" data-access-resend><i slot="prefix" class="fa-solid fa-paper-plane"></i>Reenviar invitación</sl-button>' : ''}
        <sl-dropdown hoist placement="bottom-start">
          <sl-button slot="trigger" size="small" variant="default" caret><i slot="prefix" class="fa-solid fa-unlock-keyhole"></i>Contraseña</sl-button>
          <sl-menu>
            <sl-menu-item value="reset-link"><i slot="prefix" class="fa-solid fa-envelope"></i>Enviar link para cambiarla</sl-menu-item>
            <sl-menu-item value="reset-temp"><i slot="prefix" class="fa-solid fa-key"></i>Generar contraseña temporal</sl-menu-item>
          </sl-menu>
        </sl-dropdown>
        ${self ? '' : (st.kind === 'off'
          ? '<sl-button size="small" variant="success" data-access-active="true"><i slot="prefix" class="fa-solid fa-user-check"></i>Reactivar acceso</sl-button>'
          : '<sl-button size="small" variant="default" class="users-access-off" data-access-active="false"><i slot="prefix" class="fa-solid fa-user-slash"></i>Quitar acceso</sl-button>')}
      </div>
    </section>`;
  };

  const showTempPassword = (pass, nombre) => openIosSwal({
    title: 'Contraseña temporal',
    html: `<p>Pasale esta contraseña a <strong>${escapeHtml(nombre)}</strong>. Se muestra una sola vez; al entrar va a tener que elegir una nueva.</p>
      <sl-input readonly value="${escapeHtml(pass)}" class="users-temp-pass"><sl-copy-button slot="suffix" value="${escapeHtml(pass)}"></sl-copy-button></sl-input>`,
    confirmButtonText: 'Listo'
  });

  const grantAccessDialog = async (user) => {
    if (!normalizeValue(user.email)) {
      await openIosSwal({ title: 'Falta el email', html: '<p>Cargá el email de la persona antes de darle acceso.</p>', icon: 'warning', confirmButtonText: 'Entendido' });
      return;
    }
    const res = await openIosSwal({
      title: 'Dar acceso al sistema',
      html: `<div class="users-grant-form">
        <p>${escapeHtml(user.fullName)} va a entrar con <strong>${escapeHtml(user.email)}</strong>.</p>
        <sl-select id="grantRole" label="Rol" value="empleado" hoist>
          <sl-option value="empleado">Empleado: usa los módulos, sin claves ni usuarios</sl-option>
          <sl-option value="admin">Administrador: todo, incluidas claves y usuarios</sl-option>
        </sl-select>
        <div class="users-access-perms" id="grantPerms">
          <sl-switch id="grantEdit" checked>Puede editar registros guardados</sl-switch>
          <sl-switch id="grantDelete">Puede borrar registros</sl-switch>
        </div>
        <sl-radio-group id="grantMode" label="Forma de alta" value="invite">
          <sl-radio value="invite">Invitación por email (elige su contraseña)</sl-radio>
          <sl-radio value="password">Contraseña temporal (se la pasás vos)</sl-radio>
        </sl-radio-group>
      </div>`,
      showCancelButton: true,
      confirmButtonText: 'Dar acceso',
      cancelButtonText: 'Cancelar',
      didOpen: () => {
        const role = document.getElementById('grantRole');
        role.addEventListener('sl-change', () => { document.getElementById('grantPerms').hidden = role.value === 'admin'; });
      },
      preConfirm: async () => {
        const body = {
          personaId: user.id,
          role: document.getElementById('grantRole').value || 'empleado',
          puedeEditar: document.getElementById('grantEdit').checked,
          puedeBorrar: document.getElementById('grantDelete').checked,
          mode: document.getElementById('grantMode').value || 'invite'
        };
        try { return await adminApi('grantAccess', body); } catch (error) { Swal.showValidationMessage(error.message); return false; }
      }
    });
    if (!res.isConfirmed) return;
    if (res.value?.tempPassword) await showTempPassword(res.value.tempPassword, user.fullName);
    else notify('success', 'Invitación enviada', `${user.fullName} va a recibir un email para activar su cuenta.`);
    await loadAccess();
    renderList();
    renderDetail();
  };

  const runAccessAction = async (user, fn, okTitle) => {
    try {
      const out = await fn();
      if (okTitle) notify('success', okTitle, user.fullName);
      await loadAccess();
      renderList();
      renderDetail();
      return out;
    } catch (error) {
      notify('error', 'No se pudo completar', error.message);
      renderDetail();
      return null;
    }
  };

  // --- Plantilla de invitación (vista interna, sólo admin) ---
  const SAMPLE_VARS = { nombre: 'Juan Pérez', email: 'juan@empresa.com', rol: 'Empleado', empresa: 'La Jamonera', link: '#', vence: 'mañana 18:00', remitente: 'La Jamonera' };
  const renderSample = (tpl) => String(tpl || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => escapeHtml(SAMPLE_VARS[k] ?? m));
  const openTemplateEditor = async () => {
    nodes.editor.innerHTML = '<div class="informes-loading"><sl-spinner class="meta-spinner-login" aria-label="Cargando plantilla"></sl-spinner></div>';
    showEditor(true);
    let tpl;
    try { tpl = await adminApi('getTemplate'); } catch (error) { notify('error', 'No se pudo cargar la plantilla', error.message); closeEditor(); return; }
    const vars = tpl.variables || Object.keys(SAMPLE_VARS);
    nodes.editor.innerHTML = `
      <header class="users-editor-head">
        <sl-button variant="default" size="small" data-editor-back><i slot="prefix" class="fa-solid fa-arrow-left"></i>Volver</sl-button>
        <div><h3>Plantilla de invitación</h3><p>El correo que reciben las personas a las que les das acceso.</p></div>
      </header>
      <div class="users-tpl">
        <div class="users-tpl-edit">
          <sl-input name="asunto" label="Asunto" value="${escapeHtml(tpl.asunto || '')}"></sl-input>
          <div class="users-tpl-vars"><span class="users-muted">Variables</span>${vars.map((v) => `<sl-button size="small" variant="default" data-tpl-var="${escapeHtml(v)}">{{${escapeHtml(v)}}}</sl-button>`).join('')}</div>
          <label class="lj-label" for="usersTplHtml">HTML del correo</label>
          <sl-textarea id="usersTplHtml" class="users-tpl-code" spellcheck="false" rows="16" resize="vertical"></sl-textarea>
          <p class="users-editor-error" role="alert" hidden></p>
        </div>
        <div class="users-tpl-preview">
          <span class="lj-label">Vista previa</span>
          <p class="users-tpl-subject" data-tpl-subject></p>
          <iframe class="users-tpl-frame" sandbox="" title="Vista previa del correo"></iframe>
        </div>
      </div>
      <footer class="users-editor-footer">
        <sl-button variant="default" data-tpl-restore><i slot="prefix" class="fa-solid fa-rotate-left"></i>Restaurar por defecto</sl-button>
        <sl-button variant="default" data-tpl-test><i slot="prefix" class="fa-solid fa-paper-plane"></i>Enviar prueba</sl-button>
        <sl-button variant="primary" data-tpl-save><i slot="prefix" class="fa-solid fa-floppy-disk"></i>Guardar</sl-button>
      </footer>`;
    const code = nodes.editor.querySelector('#usersTplHtml');
    code.value = tpl.html || '';
    await customElements.whenDefined('sl-textarea');
    await code.updateComplete;
    const subject = nodes.editor.querySelector('[name="asunto"]');
    const frame = nodes.editor.querySelector('.users-tpl-frame');
    const subjectOut = nodes.editor.querySelector('[data-tpl-subject]');
    const errorEl = nodes.editor.querySelector('.users-editor-error');
    const setError = (msg) => { errorEl.hidden = !msg; errorEl.textContent = msg || ''; };
    let timer = null;
    const paint = () => {
      frame.srcdoc = renderSample(code.value);
      subjectOut.textContent = renderSample(subject.value).replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
    };
    const schedule = () => { clearTimeout(timer); timer = setTimeout(paint, 200); };
    code.addEventListener('sl-input', schedule);
    subject.addEventListener('sl-input', schedule);
    paint();
    let lastFocus = code;
    code.addEventListener('sl-focus', () => { lastFocus = code; });
    subject.addEventListener('sl-focus', () => { lastFocus = subject; });
    nodes.editor.querySelectorAll('[data-tpl-var]').forEach((b) => b.addEventListener('click', () => {
      const token = `{{${b.dataset.tplVar}}}`;
      if (lastFocus === code) {
        const native = window.ljNativeInput(code);
        const a = native?.selectionStart ?? code.value.length;
        const z = native?.selectionEnd ?? a;
        code.value = code.value.slice(0, a) + token + code.value.slice(z);
        code.focus();
        requestAnimationFrame(() => native?.setSelectionRange?.(a + token.length, a + token.length));
      } else {
        subject.value = `${subject.value}${token}`;
      }
      schedule();
    }));
    const validate = () => {
      if (!normalizeValue(subject.value)) return 'Escribí el asunto.';
      if (!/\{\{\s*link\s*\}\}/.test(code.value)) return 'La plantilla tiene que incluir {{link}} (el botón para activar la cuenta).';
      return '';
    };
    const withBusy = async (btn, fn) => { btn.loading = true; try { await fn(); } finally { btn.loading = false; } };
    nodes.editor.querySelectorAll('[data-editor-back]').forEach((b) => b.addEventListener('click', () => closeEditor(state.selectedId)));
    nodes.editor.querySelector('[data-tpl-save]').addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
      const msg = validate(); setError(msg); if (msg) return;
      try {
        const out = await adminApi('saveTemplate', { asunto: subject.value, html: code.value });
        code.value = out.html;
        paint();
        notify('success', 'Plantilla guardada', 'Las próximas invitaciones usan este diseño.');
      } catch (error) { setError(error.message); }
    }));
    nodes.editor.querySelector('[data-tpl-test]').addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
      const msg = validate(); setError(msg); if (msg) return;
      try {
        const out = await adminApi('testTemplate', { asunto: subject.value, html: code.value });
        notify('success', 'Prueba enviada', `Revisá ${out.to || 'tu correo'}.`);
      } catch (error) { setError(error.message); }
    }));
    nodes.editor.querySelector('[data-tpl-restore]').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const ok = await openIosSwal({ title: 'Restaurar plantilla', html: '<p>Se vuelve al diseño original y se pierden los cambios guardados.</p>', icon: 'warning', showCancelButton: true, confirmButtonText: 'Restaurar', cancelButtonText: 'Cancelar' });
      if (!ok.isConfirmed) return;
      await withBusy(btn, async () => {
        try {
          const out = await adminApi('restoreTemplate');
          subject.value = out.asunto;
          code.value = out.html;
          paint();
          setError('');
          notify('success', 'Plantilla restaurada', '');
        } catch (error) { setError(error.message); }
      });
    });
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
      // Sin resultados: la ficha no debe seguir mostrando a la persona elegida antes.
      state.selectedId = '';
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
        ${listAccessTag(u)}
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
        <div><dt><i class="fa-solid fa-lock" aria-hidden="true"></i>Clave</dt><dd>${window.ljPinIsSet(user) ? 'Configurada (4 dígitos)' : '<span class="users-muted">Sin clave</span>'}</dd></div>
      </dl>
      <section class="recetas-detail-section">
        <h4 class="recetas-detail-title"><i class="fa-solid fa-chart-simple" aria-hidden="true"></i>Uso</h4>
        ${usageHtml(user)}
      </section>
      ${accessSectionHtml(user)}`;
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
    if (!window.ljPinIsSet(user)) return true;
    const auth = await openIosSwal({
      title,
      html: `<p>Ingresá la clave de 4 dígitos de <strong>${escapeHtml(user.fullName)}</strong>.</p><sl-input id="usersPinCheck" type="password" password-toggle inputmode="numeric" maxlength="4" autocomplete="off" placeholder="Clave" label="Clave"></sl-input>`,
      showCancelButton: true,
      confirmButtonText: 'Continuar',
      cancelButtonText: 'Cancelar',
      preConfirm: async () => {
        const pin = normalizeValue(document.getElementById('usersPinCheck')?.value);
        if (!(await window.ljVerifyPin(user, pin))) return Swal.showValidationMessage('Clave incorrecta.');
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
          <sl-input name="pin" type="password" password-toggle label="Clave de 4 dígitos" required inputmode="numeric" maxlength="4" autocomplete="new-password" placeholder="${escapeHtml(window.ljPinPlaceholder(initial))}" help-text="Se pide para editar o eliminar este usuario." value="${escapeHtml(window.ljPinFieldValue(initial))}"></sl-input>
        </div>
        ${!initial && isAdmin() ? `<fieldset class="users-editor-access">
          <legend>Acceso al sistema</legend>
          <sl-radio-group name="acceso" value="interno">
            <sl-radio value="interno">Uso interno (no entra al sistema)</sl-radio>
            <sl-radio value="login">Con login</sl-radio>
          </sl-radio-group>
          <div class="users-editor-login" hidden>
            <sl-select name="role" label="Rol" value="empleado" hoist>
              <sl-option value="empleado">Empleado</sl-option>
              <sl-option value="admin">Administrador</sl-option>
            </sl-select>
            <div class="users-access-perms" data-perms>
              <sl-switch name="puedeEditar" checked>Puede editar registros guardados</sl-switch>
              <sl-switch name="puedeBorrar">Puede borrar registros</sl-switch>
            </div>
            <sl-radio-group name="mode" label="Forma de alta" value="invite">
              <sl-radio value="invite">Invitación por email</sl-radio>
              <sl-radio value="password">Contraseña temporal</sl-radio>
            </sl-radio-group>
          </div>
        </fieldset>` : ''}
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
    const accesoGroup = form.querySelector('[name="acceso"]');
    if (accesoGroup) {
      const loginBox = form.querySelector('.users-editor-login');
      const roleSel = form.querySelector('[name="role"]');
      accesoGroup.addEventListener('sl-change', () => { loginBox.hidden = accesoGroup.value !== 'login'; });
      roleSel.addEventListener('sl-change', () => { form.querySelector('[data-perms]').hidden = roleSel.value === 'admin'; });
    }
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
        pin: window.ljPinResolve(field('pin').value, initial)
      };
      if (!value.fullName || !value.position || !value.email) return setError('Completá nombre, puesto y email.');
      if (!/^\S+@\S+\.\S+$/.test(value.email)) return setError('Ingresá un email válido.');
      if (!value.pin) return setError('La clave tiene que tener 4 dígitos.');
      const accesoField = form.querySelector('[name="acceso"]');
      const wantsLogin = Boolean(accesoField) && accesoField.value === 'login';
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
        if (wantsLogin) {
          try {
            const out = await adminApi('grantAccess', {
              personaId: id,
              role: form.querySelector('[name="role"]').value || 'empleado',
              puedeEditar: form.querySelector('[name="puedeEditar"]').checked,
              puedeBorrar: form.querySelector('[name="puedeBorrar"]').checked,
              mode: form.querySelector('[name="mode"]').value || 'invite'
            });
            await loadAccess();
            if (out.tempPassword) await showTempPassword(out.tempPassword, record.fullName);
            else notify('success', 'Invitación enviada', `${record.fullName} va a recibir un email para activar su cuenta.`);
          } catch (error) {
            notify('error', 'La persona se creó, pero no se pudo dar el acceso', error.message);
          }
        }
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
  nodes.templateBtn?.addEventListener('click', () => { if (isAdmin()) openTemplateEditor(); });

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
    const current = state.users[state.selectedId];
    if (current && event.target.closest('[data-access-grant]')) { grantAccessDialog(current); return; }
    if (current && event.target.closest('[data-access-resend]')) { runAccessAction(current, () => adminApi('resendInvite', { personaId: current.id }), 'Invitación reenviada'); return; }
    const activeBtn = event.target.closest('[data-access-active]');
    if (current && activeBtn) {
      const activo = activeBtn.dataset.accessActive === 'true';
      if (!activo) {
        const ok = await openIosSwal({ title: 'Quitar acceso', icon: 'warning', html: `<p>${escapeHtml(current.fullName)} no va a poder entrar al sistema. Sigue disponible como persona de uso interno y se puede reactivar.</p>`, showCancelButton: true, confirmButtonText: 'Quitar acceso', cancelButtonText: 'Cancelar', customClass: { confirmButton: 'danger' } });
        if (!ok.isConfirmed) return;
      }
      runAccessAction(current, () => adminApi('setActive', { personaId: current.id, activo }), activo ? 'Acceso reactivado' : 'Acceso quitado');
      return;
    }
    const editBtn = event.target.closest('[data-user-edit]');
    if (editBtn) {
      const user = state.users[editBtn.dataset.userEdit];
      if (user && (await askPin(user, 'Editar usuario'))) openEditor(user);
    }
  });
  nodes.detail.addEventListener('sl-change', (event) => {
    const user = state.users[state.selectedId];
    if (!user || !isAdmin()) return;
    const roleSel = event.target.closest?.('[data-access-role]');
    if (roleSel) { runAccessAction(user, () => adminApi('setRole', { personaId: user.id, role: roleSel.value }), 'Rol actualizado'); return; }
    const perm = event.target.closest?.('[data-access-perm]');
    if (perm) {
      const sw = (k) => nodes.detail.querySelector(`[data-access-perm="${k}"]`)?.checked;
      runAccessAction(user, () => adminApi('setPermisos', { personaId: user.id, puedeEditar: Boolean(sw('editar')), puedeBorrar: Boolean(sw('borrar')) }), 'Permisos actualizados');
    }
  });
  nodes.detail.addEventListener('sl-select', async (event) => {
    const user = state.users[state.selectedId];
    if (!user) return;
    const action = event.detail?.item?.value;
    if (action === 'reset-link') { runAccessAction(user, () => adminApi('resetPassword', { personaId: user.id, mode: 'link' }), 'Link enviado por email'); return; }
    if (action === 'reset-temp') {
      const out = await runAccessAction(user, () => adminApi('resetPassword', { personaId: user.id, mode: 'temp' }), '');
      if (out?.tempPassword) showTempPassword(out.tempPassword, user.fullName);
      return;
    }
    if (action === 'copy' && user.email) {
      try { await navigator.clipboard.writeText(user.email); notify('success', 'Email copiado', user.email); } catch (e) { notify('error', 'No se pudo copiar', user.email); }
    }
    if (action === 'delete') deleteUser(user).catch((e) => notify('error', 'No se pudo eliminar', String(e?.message || e)));
  });

  const loadUsers = async () => {
    nodes.loading.classList.remove('d-none');
    nodes.data.classList.add('d-none');
    await window.laJamoneraReady;
    // La lista se muestra apenas llegan las personas; el estado de acceso (función admin-users, ~1,5 s)
    // se completa después sin bloquear. Mientras tanto se usa el de la apertura anterior.
    const access = loadAccess().catch((error) => { console.warn('[usuarios] acceso', error); });
    state.users = safeObject(await window.dbLaJamoneraRest.read(USERS_PATH));
    nodes.loading.classList.add('d-none');
    nodes.data.classList.remove('d-none');
    renderFilter();
    render();
    access.then(() => { render(); renderDetail(); });
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
