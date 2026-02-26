(function appModule() {
  const SESSION_KEY = 'laJamoneraSession';
  const logoutButtons = document.querySelectorAll('.js-logout');
  const yearNode = document.getElementById('currentYear');

  if (yearNode) {
    yearNode.textContent = new Date().getFullYear();
  }

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
