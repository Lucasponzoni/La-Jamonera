(function proxyClientModule() {
  // URL base de la Cloud Function (reemplaza a cors.sh).
  // Alias estable de 2da gen: https://<region>-<project>.cloudfunctions.net/<function>
  const PROXY_BASE = 'https://southamerica-east1-fg-lj-d6325.cloudfunctions.net/api';

  const getAuth = () => window.authLaJamonera
    || (window.firebase && firebase.app('laJamonera').auth());

  // Firebase ID token del usuario logueado (la function lo verifica).
  const getToken = async () => {
    const auth = getAuth();
    const user = auth && auth.currentUser;
    if (!user) throw new Error('proxy: usuario no autenticado');
    return user.getIdToken();
  };

  // POST JSON autenticado. Devuelve el Response tal cual (igual que fetch).
  const postJson = async (path, body) => {
    const token = await getToken();
    return fetch(`${PROXY_BASE}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(body || {})
    });
  };

  // GET de imagen de Storage a traves del proxy (cabeceras CORS para canvas/print).
  const imageResponse = async (url) => {
    const token = await getToken();
    return fetch(`${PROXY_BASE}/image?url=${encodeURIComponent(url)}`, {
      cache: 'force-cache',
      headers: { Authorization: `Bearer ${token}` }
    });
  };

  window.laJamoneraProxy = {
    base: PROXY_BASE,
    getToken,
    postJson,
    imageResponse
  };
})();
