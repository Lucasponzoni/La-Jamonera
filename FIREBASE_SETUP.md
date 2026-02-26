# Firebase en La Jamonera

## ¿Se puede ocultar con `.env`?
En frontend puro no se pueden ocultar secretos reales porque el navegador termina recibiendo los valores.

`.env` sirve para no subirlos al repo y para inyectarlos en build tools, pero no los vuelve secretos del lado cliente.

## Config exacta para este proyecto
```js
window.LA_JAMONERA_FIREBASE_CONFIG = {
  apiKey: 'AIzaSyAL7gKhxAggAwVAoq2F-UZRgyMZm_O-RDE',
  authDomain: 'fg-lj-d6325.firebaseapp.com',
  databaseURL: 'https://fg-lj-d6325-default-rtdb.firebaseio.com',
  projectId: 'fg-lj-d6325',
  storageBucket: 'fg-lj-d6325.firebasestorage.app',
  messagingSenderId: '585417524093',
  appId: '1:585417524093:web:b33f869375f2522421c214',
  measurementId: 'G-6Z81D5E347'
};
```

## Init exacto con Database + Storage
```js
const appName = 'laJamonera';
const app =
  (firebase.apps && firebase.apps.find((item) => item.name === appName)) ||
  firebase.initializeApp(window.LA_JAMONERA_FIREBASE_CONFIG, appName);

window.appLaJamonera = app;
window.dbLaJamonera = app.database();
window.storageLaJamonera = app.storage();
```

## Reglas exactas Realtime Database
```json
{
  "rules": {
    "auth": {
      ".read": true,
      ".write": false
    },
    "data": {
      ".read": true,
      ".write": true
    },
    ".read": false,
    ".write": false
  }
}
```

## Reglas exactas Storage
```txt
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /public/{allPaths=**} {
      allow read: if true;
      allow write: if request.auth != null;
    }

    match /private/{allPaths=**} {
      allow read, write: if request.auth != null;
    }

    match /{allPaths=**} {
      allow read, write: if false;
    }
  }
}
```

## Estructura de datos para login
Guardar en `auth`:

```json
{
  "user": "lajamonera",
  "pass": "buenosaires4560"
}
```
