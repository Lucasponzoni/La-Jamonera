(function authGuard() {
  const SESSION_KEY = 'laJamoneraSession';
  const loginPage = /\/login\.html$/i.test(window.location.pathname);

  const readSession = () => {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw);
    } catch (error) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
  };

  const hasActiveSession = () => {
    const session = readSession();
    if (!session || !session.expiresAt) {
      return false;
    }

    if (Date.now() >= Number(session.expiresAt)) {
      localStorage.removeItem(SESSION_KEY);
      return false;
    }

    return true;
  };

  const active = hasActiveSession();

  if (loginPage && active) {
    window.location.replace('./index.html');
    return;
  }

  if (!loginPage && !active) {
    window.location.replace('./login.html');
  }
})();
