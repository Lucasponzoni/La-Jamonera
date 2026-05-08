(function initFirebase() {
  if (!window.firebase) {
    throw new Error('Firebase SDK no cargado');
  }

  const WORKER_BASE_URL = 'https://jamonera.lucasponzoninovogar.workers.dev';

  // El Worker corta payloads > 800_000 bytes (MAX_BODY_BYTES) con 413.
  // Apuntamos a tandas de ~600 KB para tener margen de overhead JSON.
  const BULK_MAX_BYTES = 600_000;
  // Si una sola entrada supera este tamaño, igual la mandamos sola
  // (rompe el worker, pero al menos no perdemos toda la operación silenciosamente).
  // Hard cap del worker:
  const HARD_LIMIT_BYTES = 780_000;
  // Umbral para decidir si vale la pena batchear: por debajo de esto,
  // un solo PUT/PATCH es más eficiente que partir.
  const SINGLE_SHOT_BYTES = 400_000;

  const fetchJson = async (url, options) => {
    const response = await fetch(url, options);
    if (!response.ok) {
      const message = await response.text();
      throw new Error(`Worker ${response.status}: ${message}`);
    }
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch (err) {
      return text;
    }
  };

  const isPlainObject = (value) =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

  const buildUrl = (endpoint, path) =>
    `${WORKER_BASE_URL}${endpoint}?path=${encodeURIComponent(path || '')}`;

  const rawWrite = (path, value) =>
    fetchJson(buildUrl('/rtdb/write', path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(value === undefined ? null : value)
    });

  const rawUpdate = (path, value) =>
    fetchJson(buildUrl('/rtdb/update', path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(value === undefined ? null : value)
    });

  // Pre-serializa cada entrada y arma tandas dinámicas que respetan
  // el límite de bytes del Worker. Mucho más confiable que batchear
  // por cantidad fija de claves cuando los valores tienen tamaños desparejos.
  const bulkUpdate = async (path, value) => {
    if (!isPlainObject(value)) {
      return rawUpdate(path, value);
    }

    const keys = Object.keys(value);
    if (keys.length === 0) {
      return { ok: true, batches: 0, keys: 0 };
    }

    // Pre-serializar una sola vez por clave.
    const entries = keys.map((k) => {
      const v = value[k];
      const serialized = JSON.stringify(v === undefined ? null : v);
      // overhead aproximado: "key":value,
      const bytes = k.length + serialized.length + 4;
      return { key: k, value: v, bytes };
    });

    let batches = 0;
    let chunk = {};
    let chunkBytes = 2; // {}

    const flush = async () => {
      if (chunkBytes <= 2) return;
      // eslint-disable-next-line no-await-in-loop
      await rawUpdate(path, chunk);
      batches += 1;
      chunk = {};
      chunkBytes = 2;
    };

    for (const entry of entries) {
      if (entry.bytes >= HARD_LIMIT_BYTES) {
        // Una entrada sola excede el límite del Worker. Flushear lo acumulado
        // e intentar mandarla igual: probablemente devuelva 413 y propague el error
        // al llamador, pero por lo menos no envenenamos el resto del batch.
        // eslint-disable-next-line no-await-in-loop
        await flush();
        // eslint-disable-next-line no-await-in-loop
        await rawUpdate(path, { [entry.key]: entry.value });
        batches += 1;
        continue;
      }

      if (chunkBytes + entry.bytes > BULK_MAX_BYTES) {
        // eslint-disable-next-line no-await-in-loop
        await flush();
      }

      chunk[entry.key] = entry.value;
      chunkBytes += entry.bytes;
    }

    await flush();

    return { ok: true, batches, keys: entries.length };
  };

  // Heurística: si el JSON serializado completo cabe holgado en una sola request,
  // mandamos PUT/PATCH directo. Si excede, batcheamos vía bulkUpdate.
  const writeOrBulk = async (path, value, fallbackRaw) => {
    if (!isPlainObject(value)) {
      return fallbackRaw(path, value);
    }

    let serialized;
    try {
      serialized = JSON.stringify(value);
    } catch (err) {
      return fallbackRaw(path, value);
    }

    if (serialized.length <= SINGLE_SHOT_BYTES) {
      return fallbackRaw(path, value);
    }

    return bulkUpdate(path, value);
  };

  const init = async () => {
    const bootstrap = await fetchJson(`${WORKER_BASE_URL}/bootstrap`);

    if (!bootstrap || !bootstrap.firebaseConfig) {
      throw new Error('Worker sin firebaseConfig');
    }

    const appName = 'laJamonera';
    const app =
      (firebase.apps && firebase.apps.find((item) => item.name === appName)) ||
      firebase.initializeApp(bootstrap.firebaseConfig, appName);

    window.appLaJamonera = app;
    window.dbLaJamonera = app.database();
    window.storageLaJamonera = app.storage();

    window.dbLaJamoneraRest = {
      // GET /rtdb/read?path=...
      read: async (path) =>
        fetchJson(buildUrl('/rtdb/read', path)),

      // Escritura "inteligente":
      // - null/undefined => PUT real (para borrar nodos).
      // - objeto plano serializado <= SINGLE_SHOT_BYTES => PUT directo (/rtdb/write).
      // - objeto plano más grande => PATCH en tandas dinámicas por bytes (/rtdb/update).
      // - cualquier otra cosa (string/number/array) => PUT directo.
      //
      // OJO: el modo "tandas" usa PATCH, así que NO borra claves remotas que
      // no estén en `value`. Si necesitás un reemplazo total, hacé primero
      // `write(path, null)` o usá `rawWrite(path, value)` explícito.
      write: async (path, value) => {
        if (value === null || value === undefined) {
          return rawWrite(path, value);
        }
        return writeOrBulk(path, value, rawWrite);
      },

      // PATCH /rtdb/update?path=... con tandas dinámicas si supera el umbral.
      update: async (path, value) => {
        if (value === null || value === undefined) {
          return rawUpdate(path, value);
        }
        return writeOrBulk(path, value, rawUpdate);
      },

      // API de bajo nivel para casos puntuales en los que querés saltearte
      // la heurística de tamaño.
      rawWrite,
      rawUpdate,
      bulkUpdate
    };
  };

  window.laJamoneraReady = init();
})();
