(function appModule() {
  const SESSION_KEY = 'laJamoneraSession';
  const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;
  const logoutButtons = document.querySelectorAll('.js-logout');
  const yearNode = document.getElementById('currentYear');
  const footerCountdown = document.getElementById('sessionCountdown');

  const readSession = () => {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw);
    } catch (error) {
      return null;
    }
  };

  const formatCountdown = (remainingMs) => {
    const safeMs = Math.max(0, Number(remainingMs) || 0);
    const totalMinutes = Math.floor(safeMs / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m`;
  };

  const updateSessionCountdown = () => {
    if (!footerCountdown) {
      return;
    }

    const session = readSession();
    if (!session || !session.expiresAt) {
      footerCountdown.textContent = formatCountdown(SESSION_DURATION_MS);
      return;
    }

    const remainingMs = Number(session.expiresAt) - Date.now();
    footerCountdown.textContent = formatCountdown(remainingMs);
  };

  if (yearNode) {
    yearNode.textContent = new Date().getFullYear();
  }

  updateSessionCountdown();
  setInterval(updateSessionCountdown, 1000);

  const closeSession = async () => {
    const result = await Swal.fire({
      title: '¿Cerrar sesión?',
      html: '<p>Tu sesión actual se cerrará en este dispositivo.</p>',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Sí, cerrar',
      cancelButtonText: 'Cancelar',
      reverseButtons: true,
      customClass: {
        popup: 'ios-alert',
        title: 'ios-alert-title',
        htmlContainer: 'ios-alert-text',
        confirmButton: 'ios-btn ios-btn-primary',
        cancelButton: 'ios-btn ios-btn-secondary'
      },
      buttonsStyling: false,
      returnFocus: false
    });

    if (result.isConfirmed) {
      localStorage.removeItem(SESSION_KEY);
      window.location.replace('./login.html');
    }
  };

  logoutButtons.forEach((button) => {
    button.addEventListener('click', closeSession);
  });
})();
