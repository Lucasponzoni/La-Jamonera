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
        popup: 'ios-alert lj-login-alert',
        title: 'ios-alert-title',
        htmlContainer: 'ios-alert-text',
        confirmButton: 'primary'
      },
      confirmButtonText: 'Entendido'
    });
  };

  // ---------- Backend Supabase: olvido de contraseña, invitación y cambio obligatorio ----------
  const SUPABASE = window.LJ_BACKEND === 'supabase';
  const newPasswordForm = document.getElementById('newPasswordForm');
  const forgotBtn = document.getElementById('forgotPasswordBtn');
  const headingTitle = document.querySelector('.login-heading h2');
  const headingText = document.querySelector('.login-heading p');
  const newPassError = document.getElementById('newPasswordError');
  const setHeading = (title, text) => { if (headingTitle) headingTitle.textContent = title; if (headingText) headingText.textContent = text; };
  const showNewPasswordStep = (reason) => {
    loginForm.hidden = true;
    newPasswordForm.hidden = false;
    setHeading(reason === 'invite' ? 'Bienvenido/a a La Jamonera' : 'Elegí tu contraseña',
      reason === 'invite' ? 'Elegí una contraseña para activar tu cuenta.' : 'Tenés que elegir una contraseña nueva para continuar.');
    setTimeout(() => document.getElementById('newPasswordInput')?.focus(), 50);
  };
  const fetchMe = async () => {
    const client = window.supabaseLaJamonera;
    const { data } = await client.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) return null;
    const res = await fetch(`${window.LJ_SUPABASE.functionsBase}/me`, { headers: { Authorization: `Bearer ${token}`, apikey: window.LJ_SUPABASE.key } });
    return res.ok ? res.json() : null;
  };
  const goHome = (user) => { saveSession(user); window.location.replace('./index.html'); };

  if (SUPABASE) {
    forgotBtn.hidden = false;
    forgotBtn.addEventListener('click', async () => {
      const typed = normalizeUser(usernameInput.value);
      const result = await Swal.fire({
        title: 'Restablecer contraseña',
        html: '<p>Te enviamos un link a tu email para elegir una contraseña nueva.</p>',
        input: 'email',
        inputValue: typed.includes('@') ? typed : '',
        inputPlaceholder: 'tu@email.com',
        showCancelButton: true,
        confirmButtonText: 'Enviar link',
        cancelButtonText: 'Cancelar',
        preConfirm: async (value) => {
          const email = normalizeUser(value);
          if (!/^\S+@\S+\.\S+$/.test(email)) { Swal.showValidationMessage('Ingresá un email válido.'); return false; }
          await window.laJamoneraReady;
          const { error } = await window.supabaseLaJamonera.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}${location.pathname}` });
          if (error) { Swal.showValidationMessage('No se pudo enviar el link. Probá de nuevo en unos minutos.'); return false; }
          return email;
        }
      });
      if (result.isConfirmed) Swal.fire({ title: 'Revisá tu correo', html: `<p>Si <strong>${result.value}</strong> tiene una cuenta, vas a recibir el link en unos minutos.</p>`, icon: 'success', confirmButtonText: 'Entendido' });
    });

    newPasswordForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const pass = String(document.getElementById('newPasswordInput').value || '');
      const repeat = String(document.getElementById('newPasswordRepeat').value || '');
      const fail = (msg) => { newPassError.hidden = false; newPassError.textContent = msg; };
      if (pass.length < 8) return fail('La contraseña tiene que tener al menos 8 caracteres.');
      if (pass !== repeat) return fail('Las contraseñas no coinciden.');
      newPassError.hidden = true;
      setLoading(true);
      try {
        const { data, error } = await window.supabaseLaJamonera.auth.updateUser({ password: pass, data: { must_change_password: false } });
        if (error) throw error;
        goHome({ uid: data.user.id, email: data.user.email });
      } catch (error) {
        fail(`No se pudo guardar: ${error.message || error}`);
      } finally {
        setLoading(false);
      }
    });

    // Link de invitación / recuperación (Supabase deja la sesión en la URL) o cambio obligatorio.
    window.laJamoneraReady.then(async (user) => {
      const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
      const query = new URLSearchParams(location.search);
      const type = hash.get('type') || query.get('type');
      if (hash.get('error_description')) {
        setHeading('El link venció o ya se usó', 'Pedí uno nuevo con "¿Olvidaste tu contraseña?" o al administrador.');
        return;
      }
      if (!user) return;
      if (type === 'invite' || type === 'recovery' || query.get('cambiar') === '1') { showNewPasswordStep(type); return; }
      const me = await fetchMe().catch(() => null);
      if (me?.mustChangePassword) showNewPasswordStep('temp');
    }).catch(() => {});
  }

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setLoading(true);

    const email = normalizeEmail(usernameInput.value);
    const password = String(passwordInput.value || '');

    try {
      await window.laJamoneraReady;
      const credential = await window.authLaJamonera.signInWithEmailAndPassword(email, password);
      if (SUPABASE) {
        const me = await fetchMe().catch(() => null);
        if (me && me.activo === false) {
          await window.authLaJamonera.signOut();
          showError('Usuario desactivado', 'Tu usuario está desactivado. Pedile acceso a un administrador.');
          return;
        }
        if (me?.mustChangePassword) { showNewPasswordStep('temp'); return; }
      }
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
