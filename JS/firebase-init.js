(function initFirebase() {
  if (!window.firebase) {
    throw new Error('Firebase SDK no cargado');
  }

  const WORKER_BASE_URL = 'https://jamonera.lucasponzoninovogar.workers.dev';

  const fetchJson = async (url, options) => {
    const response = await fetch(url, options);
    if (!response.ok) {
      const message = await response.text();
      throw new Error(`Worker ${response.status}: ${message}`);
    }
    return response.json();
  };

  const init = async () => {
    const bootstrap = await fetchJson(`${WORKER_BASE_URL}/bootstrap`);

    if (!bootstrap || !bootstrap.firebaseConfig) {
      throw new Error('Worker sin firebaseConfig');
    }

    const appName = 'laJamonera';
    const app =
      (firebase.apps && firebase.apps.find((item) => item.name === appName)) ||
      firebase.initializeApp(bootstrap.firebaseConfig, appName);

    window.appLaJamonera = app;
    window.dbLaJamonera = app.database();
    window.storageLaJamonera = app.storage();

    window.dbLaJamoneraRest = {
      read: async (path) => fetchJson(`${WORKER_BASE_URL}/rtdb/read?path=${encodeURIComponent(path || '')}`),
      write: async (path, value) =>
        fetchJson(`${WORKER_BASE_URL}/rtdb/write`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path, value })
        }),
      update: async (path, value) =>
        fetchJson(`${WORKER_BASE_URL}/rtdb/update`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path, value })
        })
    };
  };

  window.laJamoneraReady = init();
})();
