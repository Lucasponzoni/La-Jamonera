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

  window.appLaJamonera = app;
  window.dbLaJamonera = app.database();
  window.storageLaJamonera = app.storage();

  window.laJamoneraKeys = {
    privateKey: 'TZ7ivKSXFLljT5MVs9lLfP8FLWuoyjmTP3u-fqs8BeM',
    keyPair: 'BHCVLnM40Ix6cvBAzRodKmbx1ZLcjSMSmyhNwBLh9JCRLRe63qHS0G-XFGMox1PUBV3UoEmBTYAWzuN_X6hbtcw'
  };
})();
