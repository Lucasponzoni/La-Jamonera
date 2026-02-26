(function appModule() {
  const logoutButtons = document.querySelectorAll('.js-logout');
  const yearNode = document.getElementById('currentYear');
  const ingredientesModal = document.getElementById('ingredientesModal');
  const ingredientesLoading = document.getElementById('ingredientesLoading');
  const ingredientesEmpty = document.getElementById('ingredientesEmpty');
  const ingredientesData = document.getElementById('ingredientesData');

  if (yearNode) {
    yearNode.textContent = new Date().getFullYear();
  }

  const showIngredientesState = (state) => {
    if (!ingredientesLoading || !ingredientesEmpty || !ingredientesData) {
      return;
    }

    ingredientesLoading.classList.toggle('d-none', state !== 'loading');
    ingredientesEmpty.classList.toggle('d-none', state !== 'empty');
    ingredientesData.classList.toggle('d-none', state !== 'data');
  };

  const hasIngredientes = (value) => {
    if (!value) {
      return false;
    }

    if (Array.isArray(value)) {
      return value.filter(Boolean).length > 0;
    }

    if (typeof value === 'object') {
      return Object.keys(value).length > 0;
    }

    return false;
  };

  const loadIngredientes = async () => {
    if (!window.dbLaJamoneraRest) {
      showIngredientesState('empty');
      return;
    }

    showIngredientesState('loading');

    try {
      await window.laJamoneraReady;
      const value = await window.dbLaJamoneraRest.read('/ingredientes');

      if (hasIngredientes(value)) {
        showIngredientesState('data');
        ingredientesData.innerHTML = '<p class="home-text mb-0">Contenido de ingredientes cargado correctamente.</p>';
        return;
      }

      showIngredientesState('empty');
    } catch (error) {
      showIngredientesState('empty');
    }
  };

  if (ingredientesModal) {
    ingredientesModal.addEventListener('show.bs.modal', loadIngredientes);
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
      buttonsStyling: false
    });

    if (result.isConfirmed) {
      localStorage.removeItem('laJamoneraSession');
      window.location.replace('./login.html');
    }
  };

  logoutButtons.forEach((button) => {
    button.addEventListener('click', closeSession);
  });
})();
