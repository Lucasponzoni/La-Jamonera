// Permisos del usuario logueado (sólo con backend Supabase).
// window.LJMe → promesa con { uid, email, admin, role, puede_editar, puede_borrar, persona_id, mustChangePassword }.
// Oculta los botones de Editar / Eliminar cuando el usuario no tiene ese permiso (comodidad: el
// control real lo hace la base con RLS). Si tiene que cambiar la contraseña, lo manda al login.
(function ljAuthz() {
  if (window.LJ_BACKEND !== 'supabase') {
    window.LJMe = Promise.resolve(null);
    return;
  }
  const EDIT = ['data-user-edit', 'data-recipe-group-edit', 'data-vehicle-edit', 'data-edit-record', 'data-receta-edit', 'data-provider-rne-edit',
    'data-ingrediente-edit', 'data-family-edit-selected', 'data-family-edit', 'data-edit-report', 'data-edit-entry', 'data-edit-comment', 'data-client-edit'];
  const DELETE = ['data-recipe-group-delete', 'data-vehicle-delete', 'data-user-delete', 'data-dispatch-delete', 'data-recipe-prod-delete', 'data-receta-delete',
    'data-provider-rne-history-delete', 'data-provider-rne-delete', 'data-provider-delete-request', 'data-ingrediente-delete', 'data-family-delete-selected',
    'data-family-delete', 'data-dispatch-xlsx-history-delete', 'data-delete-rne-history', 'data-delete-report', 'data-delete-entry', 'data-delete-record',
    'data-delete-comment'];
  const style = document.createElement('style');
  style.textContent = `html.lj-no-edit :is(${EDIT.map((a) => `[${a}]`).join(',')}) { display: none !important; }
html.lj-no-delete :is(${DELETE.map((a) => `[${a}]`).join(',')}, sl-menu-item.is-danger, sl-menu-item[value="delete"]) { display: none !important; }`;
  document.head.appendChild(style);

  window.LJMe = (async () => {
    const user = await window.laJamoneraReady;
    if (!user) return null;
    try {
      const res = await window.laJamoneraProxy.getJson('/me');
      const me = await res.json();
      if (!res.ok || me.ok === false) return null;
      const root = document.documentElement;
      root.classList.toggle('lj-role-admin', Boolean(me.admin));
      root.classList.toggle('lj-no-edit', !me.puede_editar);
      root.classList.toggle('lj-no-delete', !me.puede_borrar);
      const onLogin = /login\.html$/.test(location.pathname);
      if (me.mustChangePassword && !onLogin) location.replace('./login.html?cambiar=1');
      return me;
    } catch (error) {
      console.warn('[authz] /me', error);
      return null;
    }
  })();
})();
