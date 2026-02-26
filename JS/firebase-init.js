(function initFirebase() {
  if (!window.firebase) {
    throw new Error('Firebase SDK no cargado');
  }

  const defaultFirebaseConfig = {
    apiKey: 'AIzaSyAL7gKhxAggAwVAoq2F-UZRgyMZm_O-RDE',
    authDomain: 'fg-lj-d6325.firebaseapp.com',
    databaseURL: 'https://fg-lj-d6325-default-rtdb.firebaseio.com',
    projectId: 'fg-lj-d6325',
    storageBucket: 'fg-lj-d6325.firebasestorage.app',
    messagingSenderId: '585417524093',
    appId: '1:585417524093:web:b33f869375f2522421c214',
    measurementId: 'G-6Z81D5E347'
  };

  const firebaseConfig = window.LA_JAMONERA_FIREBASE_CONFIG || defaultFirebaseConfig;
  const appName = 'laJamonera';

  const app =
    (firebase.apps && firebase.apps.find((item) => item.name === appName)) ||
    firebase.initializeApp(firebaseConfig, appName);

  const db = app.database();
  const storage = app.storage();

  window.appLaJamonera = app;
  window.dbLaJamonera = db;
  window.storageLaJamonera = storage;

  const dbSecret = 'Op2ecrJQzPp1MvTltzw9IfkhGbgsm8ZhabPWebyN';
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
