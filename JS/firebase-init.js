(function initFirebase() {
  if (!window.firebase) {
    throw new Error('Firebase SDK no cargado');
  }

  if (!window.LA_JAMONERA_FIREBASE_CONFIG) {
    throw new Error('Falta JS/firebase-config.local.js con LA_JAMONERA_FIREBASE_CONFIG');
  }

  if (!window.LA_JAMONERA_DB_SECRET) {
    throw new Error('Falta JS/firebase-config.local.js con LA_JAMONERA_DB_SECRET');
  }

  const firebaseConfig = window.LA_JAMONERA_FIREBASE_CONFIG;
  const dbSecret = window.LA_JAMONERA_DB_SECRET;
  const appName = 'laJamonera';

  const app =
    (firebase.apps && firebase.apps.find((item) => item.name === appName)) ||
    firebase.initializeApp(firebaseConfig, appName);

  const db = app.database();
  const storage = app.storage();

  window.appLaJamonera = app;
  window.dbLaJamonera = db;
  window.storageLaJamonera = storage;

  const baseDbUrl = firebaseConfig.databaseURL.replace(/\/$/, '');
  const cleanPath = (path) => String(path || '').replace(/^\/+|\/+$/g, '');
  const buildUrl = (path) => `${baseDbUrl}/${cleanPath(path)}.json?auth=${encodeURIComponent(dbSecret)}`;

  const parseResponse = async (response) => {
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Firebase REST ${response.status}: ${body}`);
    }
    return response.json();
  };

  window.dbLaJamoneraRest = {
    read: async (path) => {
      const response = await fetch(buildUrl(path), { method: 'GET' });
      return parseResponse(response);
    },
    write: async (path, value) => {
      const response = await fetch(buildUrl(path), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(value)
      });
      return parseResponse(response);
    },
    update: async (path, value) => {
      const response = await fetch(buildUrl(path), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(value)
      });
      return parseResponse(response);
    }
  };
})();
