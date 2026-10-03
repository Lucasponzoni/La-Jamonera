// Verificaciones de seguridad que dependen del backend.
// - PIN de 4 dígitos de una persona (/informes/users): en Firebase se compara con el PIN guardado;
//   en Supabase el PIN nunca llega al navegador (se guarda con hash) y se valida con la RPC verificar_pin.
// - "Clave general" para acciones sensibles: en Firebase es /passGeneral; en Supabase se pide la
//   contraseña del propio usuario (reautenticación) y la base exige además el permiso de borrar/editar.
(function ljSecurity() {
  const SUPABASE = window.LJ_BACKEND === 'supabase';
  const norm = (v) => String(v == null ? '' : v).trim();

  window.ljPinIsSet = (user) => Boolean(user && (user.hasPin || /^\d{4}$/.test(norm(user.pin))));

  window.ljVerifyPin = async (user, typed) => {
    const pin = norm(typed);
    if (!user || !/^\d{4}$/.test(pin)) return false;
    if (!SUPABASE) return pin === norm(user.pin);
    try {
      await window.laJamoneraReady;
      const { data, error } = await window.supabaseLaJamonera.rpc('verificar_pin', { p_persona: user.id, p_pin: pin });
      if (error) throw error;
      return data === true;
    } catch (error) {
      console.warn('[seguridad] verificar_pin', error);
      return false;
    }
  };

  // Formularios de persona: en Supabase el PIN guardado viene enmascarado; el campo arranca vacío
  // y vacío significa "mantener la clave actual".
  window.ljPinFieldValue = (initial) => {
    if (!initial) return '';
    if (SUPABASE) return '';
    return norm(initial.pin);
  };
  window.ljPinPlaceholder = (initial) => (SUPABASE && window.ljPinIsSet(initial) ? 'Sin cambios (dejá vacío)' : '4 dígitos');
  window.ljPinResolve = (typed, initial) => {
    const pin = norm(typed);
    if (/^\d{4}$/.test(pin)) return pin;
    if (!pin && SUPABASE && window.ljPinIsSet(initial)) return norm(initial.pin) || '••••';
    return null;
  };

  window.ljSensitivePasswordLabel = SUPABASE ? 'Tu contraseña' : 'Clave general';

  window.ljVerifySensitivePassword = async (typed) => {
    const entered = norm(typed);
    if (!entered) return false;
    if (!SUPABASE) {
      const remote = norm(await window.dbLaJamoneraRest.read('/passGeneral/pass'));
      return Boolean(remote) && entered === remote;
    }
    const email = window.authLaJamonera?.currentUser?.email;
    if (!email) return false;
    const cfg = window.LJ_SUPABASE;
    // Se valida contra Auth sin reemplazar la sesión actual.
    const res = await fetch(`${cfg.url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: cfg.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: typed })
    });
    return res.ok;
  };
})();
