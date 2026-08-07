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

  // ============================================================
  // Anti-cuelgue: el SDK de RTDB no tiene timeout propio. Tras una
  // suspensión de pestaña o corte de red, once()/set() pueden quedar
  // pendientes para siempre y la UI se clava en "Cargando..." hasta
  // recargar. Acá: timeout + reconexión forzada + un reintento; si
  // vuelve a fallar, rechazamos con error claro (los catch de la UI
  // cierran el spinner y muestran el mensaje).
  // ============================================================
  const READ_TIMEOUT_MS = 20_000;
  const WRITE_TIMEOUT_MS = 45_000;
  const AUTH_TIMEOUT_MS = 12_000;

  const withTimeout = (promise, ms, label) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error(`Se agotó el tiempo de ${label} (${Math.round(ms / 1000)}s). Revisá la conexión a internet.`);
      error.isTimeout = true;
      reject(error);
    }, ms);
    Promise.resolve(promise).then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });

  let reconnecting = false;
  const forceReconnect = () => {
    if (reconnecting) return;
    reconnecting = true;
    try { getDb().goOffline(); } catch (error) {}
    setTimeout(() => {
      try { getDb().goOnline(); } catch (error) {}
      reconnecting = false;
    }, 400);
  };

  const runWithReconnectRetry = async (factory, ms, label) => {
    try {
      return await withTimeout(factory(), ms, label);
    } catch (error) {
      if (!error || !error.isTimeout) throw error;
      console.warn(`[Firebase] ${label}: timeout. Forzando reconexión y reintentando...`);
      forceReconnect();
      await new Promise((resolve) => setTimeout(resolve, 800));
      return withTimeout(factory(), ms, label);
    }
  };

  const waitForAuth = () => new Promise((resolve, reject) => {
    const auth = getAuth();
    // Vía rápida: sesión ya resuelta. Evita esperar un evento de auth que a
    // veces no vuelve a dispararse después de suspender la pestaña.
    if (auth.currentUser) {
      resolve(auth.currentUser);
      return;
    }
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { unsubscribe(); } catch (error) {}
      fn(value);
    };
    const timer = setTimeout(() => {
      if (auth.currentUser) finish(resolve, auth.currentUser);
      else finish(reject, new Error('No se pudo verificar la sesión (timeout). Revisá la conexión.'));
    }, AUTH_TIMEOUT_MS);
    const unsubscribe = auth.onAuthStateChanged((user) => {
      if (user) finish(resolve, user);
      else finish(reject, new Error('Usuario no autenticado.'));
    }, (error) => finish(reject, error));
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

    const promise = runWithReconnectRetry(() => getDb().ref(key).once('value'), READ_TIMEOUT_MS, `lectura de ${key}`)
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
    await runWithReconnectRetry(() => writeChunkedRoot(key, cleanValue), WRITE_TIMEOUT_MS, `escritura de ${key}`);
    invalidateCache(key);
    setCache(key, cleanValue);
    await syncIndexAfterWrite(key, cleanValue, 'write');
    return { ok: true };
  };

  const update = async (path, value) => {
    await waitForAuth();
    const key = normalizePath(path);
    const cleanValue = value === undefined ? null : value;
    await runWithReconnectRetry(() => getDb().ref(key).update(cleanValue), WRITE_TIMEOUT_MS, `actualización de ${key}`);
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

    // Al volver de una pestaña suspendida, empujamos la reconexión del socket
    // de RTDB para que la próxima lectura/escritura no quede colgada.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        try { getDb().goOnline(); } catch (error) {}
      }
    });

    return waitForInitialAuth();
  };

  window.laJamoneraReady = init();
})();
