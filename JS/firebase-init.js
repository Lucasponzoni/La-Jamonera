(function initFirebase() {
  if (!window.firebase) {
    throw new Error('Firebase SDK no cargado');
  }

  const WORKER_BASE_URL = 'https://jamonera.lucasponzoninovogar.workers.dev';

  // Tamaño de tanda para escrituras grandes (PATCH /rtdb/update).
  // Mantener bajo evita que Cloudflare gaste CPU parseando JSON gigantes.
  const BULK_BATCH_SIZE = 100;
  // Umbral de claves a partir del cual un objeto plano se considera "grande"
  // y se rutea automáticamente al endpoint /rtdb/update en tandas.
  const BULK_THRESHOLD = 50;

  const fetchJson = async (url, options) => {
    const response = await fetch(url, options);
    if (!response.ok) {
      const message = await response.text();
      throw new Error(`Worker ${response.status}: ${message}`);
    }
    // Algunas escrituras devuelven cuerpo vacío.
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

  // Parte un objeto plano en tandas y las envía como PATCH al endpoint /rtdb/update.
  // Esto reemplaza el viejo PUT a /rtdb/write con el árbol entero, que reventaba
  // la CPU del Worker al parsear JSONs de varios MB.
  const bulkUpdate = async (path, value, batchSize) => {
    const size = Number(batchSize) > 0 ? Number(batchSize) : BULK_BATCH_SIZE;

    if (!isPlainObject(value)) {
      return rawUpdate(path, value);
    }

    const keys = Object.keys(value);
    if (keys.length === 0) {
      return { ok: true, batches: 0, keys: 0 };
    }

    let batches = 0;
    for (let i = 0; i < keys.length; i += size) {
      const slice = keys.slice(i, i + size);
      const chunk = {};
      for (const k of slice) chunk[k] = value[k];
      // Las tandas se mandan secuencialmente para no saturar el Worker
      // ni romper invariantes de orden. Si en el futuro hace falta más
      // velocidad, usar Promise.all con un pool de concurrencia chico.
      // eslint-disable-next-line no-await-in-loop
      await rawUpdate(path, chunk);
      batches += 1;
    }

    return { ok: true, batches, keys: keys.length };
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
      // - objeto plano grande => PATCH en tandas (bulkUpdate).
      // - cualquier otra cosa (string/number/array/objeto chico) => PUT directo.
      // El comportamiento de "reemplazar todo el árbol" se preserva sólo
      // cuando el llamador ya cargó y reescribió el árbol completo (caso típico
      // en este proyecto), porque cada clave se sobrescribe vía PATCH.
      // OJO: si necesitás *eliminar* claves remotas que ya no están en `value`,
      // hacelo explícito con `write(path, null)` antes y volvé a escribir.
      write: async (path, value) => {
        if (value === null || value === undefined) {
          return rawWrite(path, value);
        }

        if (isPlainObject(value)) {
          const keyCount = Object.keys(value).length;
          if (keyCount > BULK_THRESHOLD) {
            return bulkUpdate(path, value, BULK_BATCH_SIZE);
          }
        }

        return rawWrite(path, value);
      },

      // PATCH /rtdb/update?path=... (con tandas automáticas si el objeto es grande).
      update: async (path, value) => {
        if (isPlainObject(value)) {
          const keyCount = Object.keys(value).length;
          if (keyCount > BULK_THRESHOLD) {
            return bulkUpdate(path, value, BULK_BATCH_SIZE);
          }
        }
        return rawUpdate(path, value);
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
