(function loginModule() {
  const SESSION_KEY = 'laJamoneraSession';
  const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;

  const loginForm = document.getElementById('loginForm');
  if (!loginForm) {
    return;
  }

  const usernameInput = document.getElementById('usernameInput');
  const passwordInput = document.getElementById('passwordInput');
  const togglePasswordButton = document.getElementById('togglePassword');
  const loginButton = document.getElementById('loginButton');
  const loginCard = document.getElementById('loginCard');

  const normalizeValue = (value) => String(value || '').trim().toLowerCase();

  const saveSession = () => {
    const expiresAt = Date.now() + SESSION_DURATION_MS;
    localStorage.setItem(SESSION_KEY, JSON.stringify({ expiresAt }));
  };

  const setLoading = (loading) => {
    if (loading) {
      loginButton.classList.add('is-loading');
      loginButton.setAttribute('disabled', 'disabled');
      loginCard.classList.add('is-loading');
      return;
    }

    loginButton.classList.remove('is-loading');
    loginButton.removeAttribute('disabled');
    loginCard.classList.remove('is-loading');
  };

  const extractCredentials = (value) => {
    if (!value || typeof value !== 'object') {
      return null;
    }

    if (typeof value.user === 'string' && typeof value.pass === 'string') {
      return value;
    }

    return null;
  };

  const readCredentialsFromFirebase = async () => {
    const paths = ['user', 'auth', '/'];

    for (const path of paths) {
      const value = await window.dbLaJamoneraRest.read(path);
      const credentials = extractCredentials(value);
      if (credentials) {
        return {
          user: normalizeValue(credentials.user),
          pass: normalizeValue(credentials.pass)
        };
      }
    }

    throw new Error('Credenciales no encontradas en Firebase');
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
        window.location.replace('./index.html');
        return;
      }

      showError('Datos inválidos', 'Revisá usuario y contraseña para continuar.');
    } catch (error) {
      showError('Error de Firebase', 'No se pudo leer user/pass para validar el ingreso.');
    } finally {
      setLoading(false);
    }
  });
})();
