(function ljTheme() {
  const KEY = 'lj-theme';
  const root = document.documentElement;
  let uid = '';
  const read = () => { try { return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light'; } catch (_) { return 'light'; } };
  const apply = (mode) => {
    const dark = mode === 'dark' && !root.hasAttribute('data-lj-force-light');
    root.classList.toggle('sl-theme-dark', dark);
    root.classList.toggle('sl-theme-light', !dark);
    document.dispatchEvent(new CustomEvent('lj-theme-change', { detail: { mode: dark ? 'dark' : 'light' } }));
    document.querySelectorAll('[data-lj-theme-toggle]').forEach((b) => { b.name = dark ? 'sun' : 'moon'; b.label = dark ? 'Modo claro' : 'Modo oscuro'; });
  };
  const db = () => window.dbLaJamonera || (window.firebase?.apps?.length ? window.firebase.app('laJamonera').database() : null);
  window.LJTheme = {
    get: () => (root.classList.contains('sl-theme-dark') ? 'dark' : 'light'),
    set(mode, { persist = true } = {}) {
      const m = mode === 'dark' ? 'dark' : 'light';
      try { localStorage.setItem(KEY, m); } catch (_) {}
      apply(m);
      if (persist && uid && db()) db().ref(`/userPreferences/${uid}/theme`).set(m).catch(() => {});
    },
    toggle() { this.set(this.get() === 'dark' ? 'light' : 'dark'); },
    async syncFromUser(userId) {
      uid = userId || '';
      if (!uid || !db()) return;
      try {
        const snap = await db().ref(`/userPreferences/${uid}/theme`).once('value');
        const remote = snap.val();
        if (remote === 'dark' || remote === 'light') this.set(remote, { persist: false });
      } catch (_) {}
    },
    mountToggle(container) {
      if (!container) return;
      const b = document.createElement('sl-icon-button');
      b.setAttribute('data-lj-theme-toggle', '');
      b.className = 'lj-theme-toggle';
      b.addEventListener('click', () => this.toggle());
      container.append(b);
      apply(this.get());
    }
  };
  apply(read());
  const auth = () => window.authLaJamonera || (window.firebase?.apps?.length ? window.firebase.app('laJamonera').auth() : null);
  const hook = () => { const a = auth(); if (!a) return false; a.onAuthStateChanged((u) => { if (u) window.LJTheme.syncFromUser(u.uid); }); return true; };
  if (!hook()) window.addEventListener('load', hook, { once: true });
})();
