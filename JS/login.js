(function () {
  const SESSION_KEY = 'laJamoneraSession';
  const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;

  // Firebase Auth requiere email + password. Si en pantalla escribis "Lajamonera",
  // se usa este email interno. Cambialo por el email exacto que creaste en Firebase.
  const USERNAME_EMAIL_ALIASES = {
    lajamonera: 'lajamonera@lajamonera.local'
  };

  const loginForm = document.getElementById('loginForm');
  if (!loginForm) return;

  const usernameInput = document.getElementById('usernameInput');
  const passwordInput = document.getElementById('passwordInput');
  const togglePasswordButton = document.getElementById('togglePassword');
  const loginButton = document.getElementById('loginButton');
  const loginCard = document.getElementById('loginCard');

  const normalizeUser = (value) => String(value || '').trim().toLowerCase();
  const normalizeEmail = (value) => {
    const user = normalizeUser(value);
    if (user.includes('@')) return user;
    return USERNAME_EMAIL_ALIASES[user] || `${user}@lajamonera.local`;
  };

  const saveSession = (user) => {
    const expiresAt = Date.now() + SESSION_DURATION_MS;
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      expiresAt,
      uid: user?.uid || '',
      email: user?.email || ''
    }));
  };

  const setLoading = (loading) => {
    if (loading) {
      loginButton.setAttribute('disabled', 'disabled');
      loginCard.classList.add('is-loading');
      return;
    }
    loginButton.removeAttribute('disabled');
    loginCard.classList.remove('is-loading');
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

    const email = normalizeEmail(usernameInput.value);
    const password = String(passwordInput.value || '');

    try {
      await window.laJamoneraReady;
      const credential = await window.authLaJamonera.signInWithEmailAndPassword(email, password);
      saveSession(credential.user);
      window.location.replace('./index.html');
    } catch (error) {
      console.error('[login] Firebase Auth fallo:', error);
      showError('Datos invalidos', 'Revisa usuario y contrasena para continuar.');
    } finally {
      setLoading(false);
    }
  });
})();

// CORS FALLBACK CONFIG
const TRACE_BASE_URL = 'https://lucasponzoni.github.io/La-Jamonera/';
const CORS_PROXY_URL = 'https://proxy.cors.sh/';
const CORS_PROXY_KEY = 'live_36d58f4c13cb7d838833506e8f6450623bf2605859ac089fa008cfeddd29d8dd';
