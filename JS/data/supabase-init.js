// Capa de datos sobre Supabase con la MISMA API que JS/firebase-init.js, para que los módulos
// no cambien: window.dbLaJamoneraRest (read/write/update…), window.dbLaJamonera.ref(path)
// (once/on/off/set/update/remove/child), window.storageLaJamonera.ref().child(path)
// (put/getDownloadURL/delete), window.authLaJamonera (currentUser, onAuthStateChanged,
// signInWithEmailAndPassword, signOut) y window.laJamoneraReady.
// Las rutas "estilo Firebase" las resuelven las RPC lj_get / lj_set / lj_update de la base, que
// reconstruyen y guardan exactamente el JSON de siempre y aplican los permisos por usuario.
(function ljSupabaseInit() {
  if (window.LJ_BACKEND !== 'supabase') return;
  const CFG = window.LJ_SUPABASE;

  const CACHE_TTL_MS = 45_000;
  const INDEX_CACHE_TTL_MS = 5 * 60_000;
  const READ_TIMEOUT_MS = 60_000;
  const cache = new Map();
  const pendingReads = new Map();

  const normalizePath = (path = '') => {
    const clean = String(path || '').trim().replace(/^\/+/, '').replace(/\/+$/, '');
    return clean ? `/${clean}` : '/';
  };
  const clone = (value) => {
    if (value === undefined) return null;
    try { return JSON.parse(JSON.stringify(value)); } catch (_) { return value; }
  };
  const invalidateCache = (path = '/') => {
    const target = normalizePath(path);
    [...cache.keys()].forEach((key) => {
      if (target === '/' || key === target || key.startsWith(`${target}/`) || target.startsWith(`${key}/`)) cache.delete(key);
    });
  };
  const setCache = (path, value) => cache.set(normalizePath(path), { value: clone(value), ts: Date.now() });
  const isIndexPath = (path = '') => /(^|\/)(ingredientes_index|inventario_index|recetas_index|produccion_index|informes_index|reparto_index|analisis_quimicos_index|_index_meta)(\/|$)/.test(normalizePath(path));
  const getCached = (path) => {
    const key = normalizePath(path);
    const entry = cache.get(key);
    if (!entry) return { hit: false };
    if (Date.now() - entry.ts > (isIndexPath(key) ? INDEX_CACHE_TTL_MS : CACHE_TTL_MS)) { cache.delete(key); return { hit: false }; }
    return { hit: true, value: clone(entry.value) };
  };

  // ---------- SDK y cliente ----------
  const loadSdk = () => new Promise((resolve, reject) => {
    if (window.supabase?.createClient) { resolve(); return; }
    const s = document.createElement('script');
    s.src = CFG.sdk;
    s.integrity = CFG.sdkIntegrity;
    s.crossOrigin = 'anonymous';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('No se pudo cargar Supabase. Revisá la conexión.'));
    document.head.appendChild(s);
  });
  let client = null;
  const clientReady = loadSdk().then(() => {
    client = window.supabase.createClient(CFG.url, CFG.key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'lj-sb-auth' }
    });
    window.supabaseLaJamonera = client;
    return client;
  });

  // ---------- Errores legibles ----------
  const PERMISOS = {
    sin_sesion: 'Tu sesión expiró. Volvé a iniciar sesión.',
    sin_permiso_editar: 'No tenés permiso para modificar registros guardados. Pedile acceso a un administrador.',
    sin_permiso_borrar: 'No tenés permiso para eliminar registros. Pedile acceso a un administrador.',
    ruta_no_migrada: 'Esta función ya no está disponible.'
  };
  const toError = (error, label) => {
    const raw = String(error?.message || error || '');
    const code = Object.keys(PERMISOS).find((k) => raw.includes(k));
    const out = new Error(code ? PERMISOS[code] : `Error de ${label}: ${raw}`);
    out.code = code || error?.code || '';
    out.cause = error;
    return out;
  };
  const rpc = async (fn, args, label) => {
    await clientReady;
    const run = client.rpc(fn, args);
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Se agotó el tiempo de ${label}. Revisá la conexión a internet.`)), READ_TIMEOUT_MS); });
    try {
      const { data, error } = await Promise.race([run, timeout]);
      if (error) throw toError(error, label);
      return data;
    } finally { clearTimeout(timer); }
  };

  // ---------- Auth (forma de Firebase) ----------
  let currentSession = null;
  const authListeners = new Set();
  const userFromSession = (session) => {
    if (!session?.user) return null;
    return {
      uid: session.user.id,
      email: session.user.email,
      metadata: session.user.user_metadata || {},
      getIdToken: async () => {
        await clientReady;
        const { data } = await client.auth.getSession();
        if (!data?.session) throw new Error('Sesión expirada');
        return data.session.access_token;
      }
    };
  };
  const authReady = clientReady.then(async () => {
    const { data } = await client.auth.getSession();
    currentSession = data?.session || null;
    client.auth.onAuthStateChange((_event, session) => {
      const before = currentSession?.user?.id || '';
      currentSession = session || null;
      if ((session?.user?.id || '') !== before) cache.clear();
      authListeners.forEach((cb) => { try { cb(userFromSession(currentSession)); } catch (e) { console.error(e); } });
    });
    return userFromSession(currentSession);
  });

  window.authLaJamonera = {
    get currentUser() { return userFromSession(currentSession); },
    onAuthStateChanged(cb, onError) {
      authListeners.add(cb);
      authReady.then((user) => cb(user), (error) => onError?.(error));
      return () => authListeners.delete(cb);
    },
    async signInWithEmailAndPassword(email, password) {
      await clientReady;
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) { const e = new Error(error.message); e.code = 'auth/invalid-credential'; throw e; }
      currentSession = data.session;
      return { user: userFromSession(data.session) };
    },
    async signOut() {
      await clientReady;
      cache.clear();
      await client.auth.signOut();
      currentSession = null;
    },
    async setPersistence() {}
  };

  const waitForAuth = async () => {
    const user = await authReady;
    if (currentSession?.user) return userFromSession(currentSession);
    if (!user) throw new Error('Usuario no autenticado.');
    return user;
  };

  // ---------- Lecturas (con lectura por partes para colecciones grandes) ----------
  const CHUNKED_READS = { '/inventario/items': 15, '/produccion/registros': 60, '/produccion/auditoria': 80, '/produccion/reservas': 200, '/Reparto/registros': 200, '/public_traces': 40 };
  const readChunked = async (key, size) => {
    const keys = await rpc('lj_keys', { p_path: key }, `lectura de ${key}`);
    if (!keys || !keys.length) return null;
    const out = {};
    for (let i = 0; i < keys.length; i += size) {
      const part = await rpc('lj_get_many', { p_path: key, p_keys: keys.slice(i, i + size) }, `lectura de ${key}`);
      Object.assign(out, part || {});
    }
    return out;
  };
  const readRemote = async (key) => {
    if (CHUNKED_READS[key]) return readChunked(key, CHUNKED_READS[key]);
    if (key === '/inventario') {
      const [config, items, indexes] = await Promise.all([readRemote('/inventario/config'), readRemote('/inventario/items'), readRemote('/inventario/indexes')]);
      return stripEmpty({ config, items, indexes });
    }
    if (key === '/produccion') {
      const parts = ['config', 'registros', 'auditoria', 'reservas', 'drafts', 'sequence'];
      const values = await Promise.all(parts.map((p) => readRemote(`/produccion/${p}`)));
      return stripEmpty(Object.fromEntries(parts.map((p, i) => [p, values[i]])));
    }
    if (key === '/Reparto') {
      const parts = ['registros', 'clients', 'vehicles', 'xlsxConfig', 'localities', 'sequenceByDate', 'productIndex'];
      const values = await Promise.all(parts.map((p) => readRemote(`/Reparto/${p}`)));
      return stripEmpty(Object.fromEntries(parts.map((p, i) => [p, values[i]])));
    }
    return rpc('lj_get', { p_path: key }, `lectura de ${key}`);
  };
  const stripEmpty = (obj) => {
    const out = {};
    Object.entries(obj).forEach(([k, v]) => { if (v !== null && v !== undefined) out[k] = v; });
    return Object.keys(out).length ? out : null;
  };

  const read = async (path) => {
    await waitForAuth();
    const key = normalizePath(path);
    const cached = getCached(key);
    if (cached.hit) return cached.value;
    if (pendingReads.has(key)) return clone(await pendingReads.get(key));
    const promise = readRemote(key)
      .then((value) => { setCache(key, value); return value; })
      .finally(() => pendingReads.delete(key));
    pendingReads.set(key, promise);
    return clone(await promise);
  };

  // ---------- Escrituras ----------
  const syncIndexAfterWrite = async (path, value, mode) => {
    const service = window.laJamoneraIndexService;
    if (!service?.syncAfterWrite) return;
    try {
      await service.syncAfterWrite({ path: normalizePath(path), value: clone(value), mode });
      ['/ingredientes_index', '/inventario_index', '/recetas_index', '/produccion_index', '/informes_index', '/reparto_index', '/_index_meta'].forEach(invalidateCache);
    } catch (error) {
      console.warn('[Supabase indexes] No se pudo sincronizar el indice.', normalizePath(path), error);
    }
  };
  const setRemote = (key, value) => rpc('lj_set', { p_path: key, p_value: value === undefined ? null : value }, `escritura de ${key}`);
  // Igual que firebase-init: las raíces grandes se escriben hijo por hijo (sin borrar los que no vienen).
  const writeMapChildren = async (base, value) => {
    const entries = Object.entries(value && typeof value === 'object' && !Array.isArray(value) ? value : {});
    for (let i = 0; i < entries.length; i += 8) {
      await Promise.all(entries.slice(i, i + 8).map(([k, v]) => setRemote(`${base}/${k}`, v === undefined ? null : v)));
    }
  };
  const writeChunkedRoot = async (key, value) => {
    const obj = value && typeof value === 'object' && !Array.isArray(value) ? value : null;
    if (!obj) return setRemote(key, value);
    if (key === '/inventario') { await setRemote('/inventario/config', obj.config || {}); return writeMapChildren('/inventario/items', obj.items || {}); }
    if (key === '/ingredientes') {
      await setRemote('/ingredientes/config', obj.config || {});
      await writeMapChildren('/ingredientes/familias', obj.familias || {});
      return writeMapChildren('/ingredientes/items', obj.items || {});
    }
    if (key === '/recetas') return writeMapChildren('/recetas', obj);
    if (key === '/Reparto') {
      await setRemote('/Reparto/sequenceByDate', obj.sequenceByDate || {});
      await setRemote('/Reparto/localities', Array.isArray(obj.localities) ? obj.localities : []);
      await setRemote('/Reparto/xlsxConfig', obj.xlsxConfig || {});
      for (const part of ['clients', 'vehicles', 'productIndex', 'registros']) await writeMapChildren(`/Reparto/${part}`, obj[part] || {});
      return null;
    }
    return setRemote(key, value);
  };

  const write = async (path, value) => {
    await waitForAuth();
    const key = normalizePath(path);
    const cleanValue = value === undefined ? null : value;
    await writeChunkedRoot(key, clone(cleanValue));
    invalidateCache(key);
    setCache(key, cleanValue);
    await syncIndexAfterWrite(key, cleanValue, 'write');
    return { ok: true };
  };
  const update = async (path, value) => {
    await waitForAuth();
    const key = normalizePath(path);
    const cleanValue = value === undefined ? null : value;
    await rpc('lj_update', { p_path: key, p_patch: clone(cleanValue) }, `actualización de ${key}`);
    invalidateCache(key);
    Object.keys(cleanValue || {}).forEach((k) => invalidateCache(`${key === '/' ? '' : key}/${k}`));
    await syncIndexAfterWrite(key, cleanValue, 'update');
    return { ok: true };
  };

  window.dbLaJamoneraRest = {
    read,
    write,
    update,
    rawWrite: write,
    rawUpdate: update,
    bulkUpdate: update,
    primeCache: (path, value) => setCache(path, value),
    clearCache: (path = '') => { if (!path) cache.clear(); else invalidateCache(path); }
  };

  // ---------- ref(path) estilo Firebase (subconjunto usado por el sitio) ----------
  const snapshotOf = (key, value) => ({ key: key.split('/').pop() || null, val: () => clone(value), exists: () => value !== null && value !== undefined });
  const REALTIME = [
    { re: /^\/informes\/users(\/|$)/, table: 'personas' },
    { re: /^\/(ingredientes_index|inventario_index|recetas_index|reparto_index|produccion_index|informes_index|analisis_quimicos_index|_index_meta)(\/|$)/, table: 'rtdb_raw' }
  ];
  const listeners = new Map();
  const makeRef = (path) => {
    const key = normalizePath(path);
    return {
      key: key.split('/').pop() || null,
      toString: () => key,
      child: (sub) => makeRef(`${key}/${sub}`),
      async once() {
        await waitForAuth();
        const value = await readRemote(key);
        return snapshotOf(key, value);
      },
      set: async (value) => { await waitForAuth(); await setRemote(key, value === undefined ? null : value); invalidateCache(key); },
      update: async (value) => { await waitForAuth(); await rpc('lj_update', { p_path: key, p_patch: value }, `actualización de ${key}`); invalidateCache(key); },
      remove: async () => { await waitForAuth(); await setRemote(key, null); invalidateCache(key); },
      on(event, cb) {
        if (event !== 'value') return cb;
        const fire = async () => { try { cb(snapshotOf(key, await readRemote(key))); } catch (e) { console.warn('[Supabase realtime]', key, e); } };
        waitForAuth().then(fire).catch(() => {});
        const rule = REALTIME.find((r) => r.re.test(key));
        if (rule) {
          clientReady.then(() => {
            let timer = null;
            const debounced = () => { clearTimeout(timer); timer = setTimeout(() => { invalidateCache(key); fire(); }, 400); };
            const filter = rule.table === 'rtdb_raw' ? { filter: `path=eq.${key.split('/').slice(0, 2).join('/')}` } : {};
            const channel = client.channel(`lj:${key}:${Math.random().toString(36).slice(2, 7)}`)
              .on('postgres_changes', { event: '*', schema: 'public', table: rule.table, ...filter }, debounced)
              .subscribe();
            listeners.set(cb, channel);
          });
        }
        return cb;
      },
      off(_event, cb) {
        const channel = listeners.get(cb);
        if (channel && client) client.removeChannel(channel);
        listeners.delete(cb);
      },
      async transaction(fn) {
        await waitForAuth();
        const current = await readRemote(key);
        const next = fn(clone(current));
        if (next === undefined) return { committed: false, snapshot: snapshotOf(key, current) };
        await setRemote(key, next);
        invalidateCache(key);
        return { committed: true, snapshot: snapshotOf(key, next) };
      }
    };
  };
  window.dbLaJamonera = { ref: (path = '/') => makeRef(path), goOnline() {}, goOffline() {} };

  // ---------- Storage (bucket "archivos", URLs públicas) ----------
  const storagePath = (p) => String(p || '').replace(/^\/+/, '');
  const makeStorageRef = (path = '') => ({
    fullPath: storagePath(path),
    child: (sub) => makeStorageRef(`${storagePath(path)}${path ? '/' : ''}${storagePath(sub)}`),
    async put(file, metadata = {}) {
      await waitForAuth();
      const { error } = await client.storage.from(CFG.bucket).upload(storagePath(path), file, {
        upsert: true, contentType: metadata.contentType || file?.type || undefined, cacheControl: '3600'
      });
      if (error) throw new Error(`No se pudo subir el archivo: ${error.message}`);
      return { ref: makeStorageRef(path), metadata: { fullPath: storagePath(path) } };
    },
    async getDownloadURL() {
      await clientReady;
      return client.storage.from(CFG.bucket).getPublicUrl(storagePath(path)).data.publicUrl;
    },
    async delete() {
      await waitForAuth();
      const { error } = await client.storage.from(CFG.bucket).remove([storagePath(path)]);
      if (error) throw new Error(`No se pudo borrar el archivo: ${error.message}`);
    }
  });
  window.storageLaJamonera = { ref: (path = '') => makeStorageRef(path) };

  window.appLaJamonera = { name: 'laJamonera', backend: 'supabase' };
  // Igual que Firebase: resuelve con el usuario actual o null (sin sesión).
  window.laJamoneraReady = authReady.then(() => userFromSession(currentSession));
})();
