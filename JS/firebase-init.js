(function initFirebase() {
  if (!window.firebase) {
    throw new Error('Firebase SDK no cargado');
  }

  if (!window.LA_JAMONERA_FIREBASE_CONFIG) {
    throw new Error('Falta JS/firebase-config.local.js con LA_JAMONERA_FIREBASE_CONFIG');
  }

  const appName = 'laJamonera';
  const app =
    (firebase.apps && firebase.apps.find((item) => item.name === appName)) ||
    firebase.initializeApp(window.LA_JAMONERA_FIREBASE_CONFIG, appName);

  window.appLaJamonera = app;
  window.dbLaJamonera = app.database();
  window.storageLaJamonera = app.storage();
})();
