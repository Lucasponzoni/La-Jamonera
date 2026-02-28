(function notificationsModule() {
  const CONTAINER_ID = 'iosNotifyStack';

  const ensureContainer = () => {
    let stack = document.getElementById(CONTAINER_ID);
    if (stack) return stack;
    stack = document.createElement('div');
    stack.id = CONTAINER_ID;
    stack.className = 'ios-notify-stack';
    document.body.appendChild(stack);
    return stack;
  };

  const show = ({ title = 'Notificación', message = '', type = 'info', duration = 4200 } = {}) => {
    const stack = ensureContainer();
    const toast = document.createElement('article');
    toast.className = `ios-notify-card type-${type}`;

    const iconByType = {
      success: 'fa-circle-check',
      error: 'fa-circle-xmark',
      warning: 'fa-triangle-exclamation',
      info: 'fa-circle-info'
    };

    toast.innerHTML = `
      <div class="ios-notify-icon-wrap"><i class="fa-solid ${iconByType[type] || iconByType.info}"></i></div>
      <div class="ios-notify-content">
        <strong>${String(title || '')}</strong>
        <p>${String(message || '')}</p>
      </div>
      <button type="button" class="btn ios-notify-close" aria-label="Cerrar"><i class="fa-solid fa-xmark"></i></button>
    `;

    const remove = () => {
      toast.classList.add('is-leaving');
      setTimeout(() => toast.remove(), 220);
    };

    toast.querySelector('.ios-notify-close')?.addEventListener('click', remove);
    stack.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add('is-visible');
    });

    setTimeout(remove, Math.max(1800, Number(duration) || 4200));
  };

  window.laJamoneraNotify = { show };
})();
