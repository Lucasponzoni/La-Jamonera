(function appModule() {
  const SESSION_KEY = 'laJamoneraSession';
  const logoutButtons = document.querySelectorAll('.js-logout');
  const yearNode = document.getElementById('currentYear');
  const ingredientesModal = document.getElementById('ingredientesModal');
  const ingredientesLoading = document.getElementById('ingredientesLoading');
  const ingredientesEmpty = document.getElementById('ingredientesEmpty');
  const ingredientesData = document.getElementById('ingredientesData');
  const familiasCircles = document.getElementById('familiasCircles');
  const ingredientesList = document.getElementById('ingredientesList');
  const searchInput = document.getElementById('ingredientesSearchInput');
  const createIngredientBtn = document.getElementById('createIngredientBtn');
  const emptyCreateIngredientBtn = document.getElementById('emptyCreateIngredientBtn');

  const normalizeValue = (value) => String(value || '').trim();
  const normalizeLower = (value) => normalizeValue(value).toLowerCase();
  const toCapitalize = (value) => normalizeValue(value).toLowerCase();
  const capitalizeLabel = (value) => toCapitalize(value).replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());

  const safeObject = (value) => (value && typeof value === 'object' ? value : {});

  const allMeasures = [
    'kilos',
    'gramos',
    'mililitros',
    'litros',
    'centimetros cubicos',
    'unidades',
    'gotas',
    'onzas',
    'pizcas',
    'cucharadas',
    'cucharaditas'
  ];

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

  if (ingredientesModal) {
    ingredientesModal.addEventListener('show.bs.modal', loadIngredientes);
  }

  if (searchInput) {
    searchInput.addEventListener('input', (event) => {
      state.search = normalizeLower(event.target.value);
      renderIngredientes();
    });
  }

  if (createIngredientBtn) {
    createIngredientBtn.addEventListener('click', () => openIngredientForm());
  }

  if (emptyCreateIngredientBtn) {
    emptyCreateIngredientBtn.addEventListener('click', () => openIngredientForm());
  }

  if (ingredientesData) {
    ingredientesData.addEventListener('click', handleDataClicks);
  }

  logoutButtons.forEach((button) => {
    button.addEventListener('click', closeSession);
  });
})();
