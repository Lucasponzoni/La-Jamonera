(function () {
  if (!window.firebase) {
    throw new Error('Firebase SDK no cargado');
  }

  const firebaseConfig = {
    apiKey: 'AIzaSyAL7gKhxAggAwVAoq2F-UZRgyMZm_O-RDE',
    authDomain: 'fg-lj-d6325.firebaseapp.com',
    databaseURL: 'https://fg-lj-d6325-default-rtdb.firebaseio.com',
    projectId: 'fg-lj-d6325',
    storageBucket: 'fg-lj-d6325.firebasestorage.app',
    messagingSenderId: '585417524093',
    appId: '1:585417524093:web:b33f869375f2522421c214',
    measurementId: 'G-6Z81D5E347'
  };

  const CACHE_TTL_MS = 15_000;
  const cache = new Map();
  const pendingReads = new Map();

  const normalizePath = (path = '') => {
    const clean = String(path || '').trim().replace(/^\/+/, '').replace(/\/+$/, '');
    return clean ? `/${clean}` : '/';
  };

  const clone = (value) => {
    if (value === undefined) return null;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (error) {
      return value;
    }
  };

  const invalidateCache = (path = '/') => {
    const target = normalizePath(path);
    [...cache.keys()].forEach((key) => {
      if (key === target || key.startsWith(`${target}/`) || target.startsWith(`${key}/`)) {
        cache.delete(key);
      }
    });
  };

  const setCache = (path, value) => {
    cache.set(normalizePath(path), { value: clone(value), ts: Date.now() });
  };

  const getCached = (path) => {
    const entry = cache.get(normalizePath(path));
    if (!entry) return { hit: false };
    if (Date.now() - entry.ts > CACHE_TTL_MS) {
      cache.delete(normalizePath(path));
      return { hit: false };
    }
    return { hit: true, value: clone(entry.value) };
  };

  const getAuth = () => window.authLaJamonera || firebase.app('laJamonera').auth();
  const getDb = () => window.dbLaJamonera || firebase.app('laJamonera').database();

  const waitForAuth = () => new Promise((resolve, reject) => {
    const auth = getAuth();
    const unsubscribe = auth.onAuthStateChanged((user) => {
      unsubscribe();
      if (user) resolve(user);
      else reject(new Error('Usuario no autenticado.'));
    }, reject);
  });

  const waitForInitialAuth = () => new Promise((resolve, reject) => {
    const auth = getAuth();
    const unsubscribe = auth.onAuthStateChanged((user) => {
      unsubscribe();
      resolve(user || null);
    }, reject);
  });

  const read = async (path) => {
    await waitForAuth();
    const key = normalizePath(path);
    const cached = getCached(key);
    if (cached.hit) return cached.value;
    if (pendingReads.has(key)) return clone(await pendingReads.get(key));

    const promise = getDb().ref(key).once('value')
      .then((snapshot) => {
        const value = snapshot.val();
        setCache(key, value);
        return value;
      })
      .finally(() => pendingReads.delete(key));

    pendingReads.set(key, promise);
    return clone(await promise);
  };

  const write = async (path, value) => {
    await waitForAuth();
    const key = normalizePath(path);
    const cleanValue = value === undefined ? null : value;
    await getDb().ref(key).set(cleanValue);
    invalidateCache(key);
    setCache(key, cleanValue);
    return { ok: true };
  };

  const update = async (path, value) => {
    await waitForAuth();
    const key = normalizePath(path);
    const cleanValue = value === undefined ? null : value;
    await getDb().ref(key).update(cleanValue);
    invalidateCache(key);
    return { ok: true };
  };

  const init = async () => {
    const appName = 'laJamonera';
    const app =
      (firebase.apps && firebase.apps.find((item) => item.name === appName)) ||
      firebase.initializeApp(firebaseConfig, appName);

    window.appLaJamonera = app;
    window.authLaJamonera = app.auth();
    window.dbLaJamonera = app.database();
    window.storageLaJamonera = app.storage();

    try {
      await window.authLaJamonera.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
    } catch (error) {
    }

    window.dbLaJamoneraRest = {
      read,
      write,
      update,
      rawWrite: write,
      rawUpdate: update,
      bulkUpdate: update,
      clearCache: () => cache.clear()
    };

    return waitForInitialAuth();
  };

  window.laJamoneraReady = init();
})();
