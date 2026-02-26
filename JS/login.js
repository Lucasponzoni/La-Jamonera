(function loginModule() {
  const SESSION_KEY = 'laJamoneraSession';
  const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;

  const loginView = document.getElementById('loginView');
  const appView = document.getElementById('appView');
  const loginForm = document.getElementById('loginForm');
  const usernameInput = document.getElementById('usernameInput');
  const passwordInput = document.getElementById('passwordInput');
  const togglePasswordButton = document.getElementById('togglePassword');
  const loginButton = document.getElementById('loginButton');
  const logoutButton = document.getElementById('logoutButton');

  const normalizeValue = (value) => String(value || '').trim().toLowerCase();

  const saveSession = () => {
    const expiresAt = Date.now() + SESSION_DURATION_MS;
    localStorage.setItem(SESSION_KEY, JSON.stringify({ expiresAt }));
  };

  const clearSession = () => {
    localStorage.removeItem(SESSION_KEY);
  };

  const hasActiveSession = () => {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) {
      return false;
    }

    try {
      const parsed = JSON.parse(raw);
      if (Date.now() >= Number(parsed.expiresAt)) {
        clearSession();
        return false;
      }
      return true;
    } catch (error) {
      clearSession();
      return false;
    }
  };

  const showApp = () => {
    loginView.classList.add('d-none');
    appView.classList.remove('d-none');
  };

  const showLogin = () => {
    appView.classList.add('d-none');
    loginView.classList.remove('d-none');
  };

  const setLoading = (loading) => {
    if (loading) {
      loginButton.classList.add('is-loading');
      loginButton.setAttribute('disabled', 'disabled');
      return;
    }
    loginButton.classList.remove('is-loading');
    loginButton.removeAttribute('disabled');
  };

  const readCredentialsFromFirebase = async () => {
    const authSnapshot = await window.dbLaJamonera.ref('auth').once('value');
    const rootSnapshot = await window.dbLaJamonera.ref('/').once('value');
    const authValue = authSnapshot.val() || {};
    const rootValue = rootSnapshot.val() || {};
    const value = authValue.user && authValue.pass ? authValue : rootValue;
    return {
      user: normalizeValue(value.user),
      pass: normalizeValue(value.pass)
    };
  };

  const showError = (title, text) => {
    Swal.fire({
      title,
      html: `<p>${text}</p>`,
      icon: 'error',
      customClass: {
        popup: 'ios-alert',
        title: 'ios-alert-title',
        htmlContainer: 'ios-alert-text',
        confirmButton: 'ios-btn ios-btn-primary'
      },
      buttonsStyling: false,
      confirmButtonText: 'Entendido'
    });
  };

  togglePasswordButton.addEventListener('click', () => {
    const hidden = passwordInput.type === 'password';
    passwordInput.type = hidden ? 'text' : 'password';
    togglePasswordButton.innerHTML = hidden
      ? '<i class="fa-solid fa-eye-slash"></i>'
      : '<i class="fa-solid fa-eye"></i>';
  });

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setLoading(true);

    const enteredUser = normalizeValue(usernameInput.value);
    const enteredPass = normalizeValue(passwordInput.value);

    try {
      const credentials = await readCredentialsFromFirebase();
      await new Promise((resolve) => setTimeout(resolve, 2000));

      if (enteredUser === credentials.user && enteredPass === credentials.pass) {
        saveSession();
        showApp();
        return;
      }

      showError('Datos inválidos', 'Revisá usuario y contraseña para continuar.');
    } catch (error) {
      showError('Sin conexión', 'No se pudo validar en Firebase. Intentá nuevamente.');
    } finally {
      setLoading(false);
    }
  });

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
      clearSession();
      usernameInput.value = '';
      passwordInput.value = '';
      passwordInput.type = 'password';
      togglePasswordButton.innerHTML = '<i class="fa-solid fa-eye"></i>';
      showLogin();
    }
  });

  if (hasActiveSession()) {
    showApp();
  } else {
    showLogin();
  }
})();
