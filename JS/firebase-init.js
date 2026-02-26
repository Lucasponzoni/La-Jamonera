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

  window.laJamoneraKeys = {
    privateKey: 'TZ7ivKSXFLljT5MVs9lLfP8FLWuoyjmTP3u-fqs8BeM',
    keyPair: 'BHCVLnM40Ix6cvBAzRodKmbx1ZLcjSMSmyhNwBLh9JCRLRe63qHS0G-XFGMox1PUBV3UoEmBTYAWzuN_X6hbtcw'
  };
})();
