(function notificationsModule() {
  // Notificaciones flotantes sobre <sl-alert>.toast() (pila de toasts de Shoelace).
  const VARIANT_BY_TYPE = {
    success: 'success',
    error: 'danger',
    warning: 'warning',
    info: 'primary'
  };

  const ICON_BY_TYPE = {
    success: 'fa-circle-check',
    error: 'fa-circle-xmark',
    warning: 'fa-triangle-exclamation',
    info: 'fa-circle-info'
  };

  const show = ({ title = 'Notificación', message = '', type = 'info', duration = 4200 } = {}) => {
    const alert = document.createElement('sl-alert');
    alert.className = `lj-notify type-${type}`;
    alert.variant = VARIANT_BY_TYPE[type] || VARIANT_BY_TYPE.info;
    alert.closable = true;
    alert.duration = Math.max(1800, Number(duration) || 4200);
    alert.innerHTML = `
      <i slot="icon" class="fa-solid ${ICON_BY_TYPE[type] || ICON_BY_TYPE.info}"></i>
      <strong class="lj-notify-title">${String(title || '')}</strong>
      ${message ? `<span class="lj-notify-text">${String(message)}</span>` : ''}
    `;
    document.body.appendChild(alert);
    customElements.whenDefined('sl-alert')
      .then(() => alert.toast())
      .catch(() => alert.remove());
  };

  window.laJamoneraNotify = { show };
})();
