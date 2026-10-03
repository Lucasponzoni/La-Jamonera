// Encabezado: botón de tema, menú lateral en celular y cierre del menú de usuario al navegar.
(function ljHeader() {
  const init = () => {
    const slot = document.querySelector('[data-lj-theme-slot]');
    if (slot && window.LJTheme && !slot.querySelector('[data-lj-theme-toggle]')) window.LJTheme.mountToggle(slot);

    const drawer = document.querySelector('.lj-header-drawer');
    document.addEventListener('click', (event) => {
      if (event.target.closest?.('[data-lj-drawer-open]')) drawer?.show();
      if (event.target.closest?.('.lj-drawer-nav a')) drawer?.hide();
    });

    // "Cerrar sesión" vive dentro del sl-dropdown: al hacer clic se cierra el panel.
    const userMenu = document.querySelector('.lj-user-menu');
    userMenu?.addEventListener('click', (event) => {
      if (event.target.closest?.('.js-logout')) userMenu.hide?.();
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
