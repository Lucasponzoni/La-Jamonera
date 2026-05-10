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

  const CACHE_TTL_MS = 45_000;
  const INDEX_CACHE_TTL_MS = 5 * 60_000;
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

  const isIndexPath = (path = '') => /(^|\/)(ingredientes_index|inventario_index|recetas_index|produccion_index|informes_index|reparto_index|_index_meta)(\/|$)/.test(normalizePath(path));
  const CHUNKED_ROOTS = new Set(['/inventario', '/ingredientes', '/recetas', '/Reparto']);

  const getCached = (path) => {
    const key = normalizePath(path);
    const entry = cache.get(key);
    if (!entry) return { hit: false };
    const ttl = isIndexPath(key) ? INDEX_CACHE_TTL_MS : CACHE_TTL_MS;
    if (Date.now() - entry.ts > ttl) {
      cache.delete(key);
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

  const syncIndexAfterWrite = async (path, value, mode) => {
    const service = window.laJamoneraIndexService;
    if (!service?.syncAfterWrite) return;
    try {
      await service.syncAfterWrite({ path: normalizePath(path), value: clone(value), mode });
      invalidateCache('/ingredientes_index');
      invalidateCache('/inventario_index');
      invalidateCache('/recetas_index');
      invalidateCache('/produccion_index');
      invalidateCache('/informes_index');
      invalidateCache('/reparto_index');
      invalidateCache('/_index_meta');
    } catch (error) {
      console.warn('[Firebase indexes] No se pudo sincronizar el indice.', normalizePath(path), error);
    }
  };

  const writeMapChildren = async (basePath, value) => {
    const cleanBase = normalizePath(basePath);
    const obj = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const ref = getDb().ref(cleanBase);
    const entries = Object.entries(obj);
    for (let index = 0; index < entries.length; index += 25) {
      const chunk = entries.slice(index, index + 25);
      await Promise.all(chunk.map(([childKey, childValue]) =>
        ref.child(childKey).set(childValue === undefined ? null : childValue)));
    }
  };

  const writeChunkedRoot = async (key, value) => {
    if (!CHUNKED_ROOTS.has(key) || !value || typeof value !== 'object' || Array.isArray(value)) {
      await getDb().ref(key).set(value);
      return;
    }

    if (key === '/inventario') {
      await getDb().ref('/inventario/config').set(value.config || {});
      await writeMapChildren('/inventario/items', value.items || {});
      return;
    }

    if (key === '/ingredientes') {
      await getDb().ref('/ingredientes/config').set(value.config || {});
      await writeMapChildren('/ingredientes/familias', value.familias || {});
      await writeMapChildren('/ingredientes/items', value.items || {});
      return;
    }

    if (key === '/recetas') {
      await writeMapChildren('/recetas', value || {});
      return;
    }

    if (key === '/Reparto') {
      await getDb().ref('/Reparto/sequenceByDate').set(value.sequenceByDate || {});
      await getDb().ref('/Reparto/localities').set(Array.isArray(value.localities) ? value.localities : []);
      await getDb().ref('/Reparto/xlsxConfig').set(value.xlsxConfig || {});
      await writeMapChildren('/Reparto/clients', value.clients || {});
      await writeMapChildren('/Reparto/vehicles', value.vehicles || {});
      await writeMapChildren('/Reparto/productIndex', value.productIndex || {});
      await writeMapChildren('/Reparto/registros', value.registros || {});
      return;
    }

    await getDb().ref(key).set(value);
  };

  const write = async (path, value) => {
    await waitForAuth();
    const key = normalizePath(path);
    const cleanValue = value === undefined ? null : value;
    await writeChunkedRoot(key, cleanValue);
    invalidateCache(key);
    setCache(key, cleanValue);
    await syncIndexAfterWrite(key, cleanValue, 'write');
    return { ok: true };
  };

  const update = async (path, value) => {
    await waitForAuth();
    const key = normalizePath(path);
    const cleanValue = value === undefined ? null : value;
    await getDb().ref(key).update(cleanValue);
    invalidateCache(key);
    await syncIndexAfterWrite(key, cleanValue, 'update');
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
      primeCache: (path, value) => setCache(path, value),
      clearCache: (path = '') => {
        if (!path) {
          cache.clear();
          return;
        }
        invalidateCache(path);
      }
    };

    return waitForInitialAuth();
  };

  window.laJamoneraReady = init();
})();
