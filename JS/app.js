(function appModule() {
  const logoutButton = document.getElementById('logoutButton');
  if (!logoutButton) {
    return;
  }

  logoutButton.addEventListener('click', async () => {
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
      buttonsStyling: false
    });

    if (result.isConfirmed) {
      localStorage.removeItem('laJamoneraSession');
      window.location.replace('./login.html');
    }
  });
})();
