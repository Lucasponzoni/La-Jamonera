// Guard de imágenes rotas de Firebase Storage (antes vivía al final de swal-a11y-guard.js).
(function storageImageGuardModule() {
  // v2: la lista anterior era permanente, asi que un corte de red puntual dejaba
  // la foto en blanco para siempre. Ahora cada marca caduca y se revalida.
  const STORAGE_KEY = 'laJamoneraBrokenFirebaseImages.v2';
  const LEGACY_STORAGE_KEYS = ['laJamoneraBrokenFirebaseImages'];
  const EMPTY_IMAGE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
  const MAX_STORED = 250;
  const BROKEN_TTL_MS = 6 * 60 * 60 * 1000;
  const VERIFY_DELAY_MS = 1200;

  const normalizeUrl = (value) => String(value || '').trim();
  const isFirebaseStorageUrl = (value) => /firebasestorage\.googleapis\.com|\.firebasestorage\.app/i.test(normalizeUrl(value));
  const isOffline = () => navigator.onLine === false;

  LEGACY_STORAGE_KEYS.forEach((key) => {
    try { localStorage.removeItem(key); } catch (_) {}
  });

  const readStored = () => {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      if (!Array.isArray(parsed)) return [];
      const limit = Date.now() - BROKEN_TTL_MS;
      return parsed
        .map((entry) => (entry && typeof entry === 'object' ? entry : null))
        .filter((entry) => entry && normalizeUrl(entry.url) && Number(entry.ts || 0) > limit)
        .map((entry) => [normalizeUrl(entry.url), Number(entry.ts)]);
    } catch (_) {
      return [];
    }
  };

  // url -> timestamp del ultimo fallo confirmado
  const brokenUrls = new Map(readStored());
  const pendingVerification = new Set();

  const persist = () => {
    try {
      const entries = Array.from(brokenUrls.entries())
        .slice(-MAX_STORED)
        .map(([url, ts]) => ({ url, ts }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch (_) {}
  };

  const markBroken = (url) => {
    const safeUrl = normalizeUrl(url);
    if (!safeUrl || !isFirebaseStorageUrl(safeUrl)) return;
    brokenUrls.set(safeUrl, Date.now());
    persist();
  };

  const forgetBroken = (url) => {
    const safeUrl = normalizeUrl(url);
    if (!safeUrl || !brokenUrls.has(safeUrl)) return;
    brokenUrls.delete(safeUrl);
    persist();
  };

  const isBroken = (url) => {
    const safeUrl = normalizeUrl(url);
    const ts = brokenUrls.get(safeUrl);
    if (!ts) return false;
    if (Date.now() - ts > BROKEN_TTL_MS) {
      brokenUrls.delete(safeUrl);
      persist();
      return false;
    }
    return true;
  };

  const neutralizeImage = (img, url) => {
    if (!(img instanceof HTMLImageElement)) return;
    const failedUrl = normalizeUrl(url || img.currentSrc || img.src || img.getAttribute('src'));
    if (failedUrl) {
      img.dataset.failedSrc = failedUrl;
    }
    img.removeAttribute('srcset');
    img.removeAttribute('sizes');
    img.src = EMPTY_IMAGE;
    img.classList.add('is-loaded', 'is-broken-image');
    const wrapper = img.closest('.thumb-loading, .family-circle-thumb, .ingrediente-avatar, .inventario-print-photo-wrap, .user-avatar-thumb, .receta-thumb-wrap, .produccion-hero-avatar, .inventario-trace-avatar, .recipe-inline-avatar-wrap, .recipe-suggest-avatar-wrap, .produccion-trace-ingredient-avatar');
    wrapper?.querySelector('.thumb-loading')?.remove();
  };

  // Devuelve la imagen a su URL original (se vuelve a intentar la descarga).
  const restoreImages = (url) => {
    const safeUrl = normalizeUrl(url);
    document.querySelectorAll('img[data-failed-src]').forEach((img) => {
      if (safeUrl && normalizeUrl(img.dataset.failedSrc) !== safeUrl) return;
      const originalUrl = normalizeUrl(img.dataset.failedSrc);
      if (!originalUrl) return;
      delete img.dataset.failedSrc;
      img.classList.remove('is-broken-image');
      img.src = originalUrl;
    });
  };

  const withCacheBuster = (url) => `${url}${url.includes('?') ? '&' : '?'}_lj=${Date.now()}`;

  // Un solo error no alcanza para condenar la foto: se reintenta fuera del DOM y
  // recien si ese reintento tambien falla se guarda la marca.
  const verifyBroken = (url) => {
    const safeUrl = normalizeUrl(url);
    if (!safeUrl || pendingVerification.has(safeUrl)) return;
    pendingVerification.add(safeUrl);
    setTimeout(() => {
      if (isOffline()) {
        pendingVerification.delete(safeUrl);
        return;
      }
      const probe = new Image();
      probe.onload = () => {
        pendingVerification.delete(safeUrl);
        forgetBroken(safeUrl);
        restoreImages(safeUrl);
      };
      probe.onerror = () => {
        pendingVerification.delete(safeUrl);
        markBroken(safeUrl);
      };
      probe.src = withCacheBuster(safeUrl);
    }, VERIFY_DELAY_MS);
  };

  const suppressIfKnownBroken = (img) => {
    if (!(img instanceof HTMLImageElement)) return;
    const url = normalizeUrl(img.currentSrc || img.src || img.getAttribute('src'));
    if (url && isBroken(url)) {
      neutralizeImage(img, url);
    }
  };

  document.addEventListener('error', (event) => {
    const img = event.target;
    if (!(img instanceof HTMLImageElement)) return;
    const url = normalizeUrl(img.currentSrc || img.src || img.getAttribute('src'));
    if (!isFirebaseStorageUrl(url)) return;
    neutralizeImage(img, url);
    if (isOffline()) return;
    verifyBroken(url);
  }, true);

  document.addEventListener('load', (event) => {
    const img = event.target;
    if (!(img instanceof HTMLImageElement)) return;
    img.classList.remove('is-broken-image');
    const url = normalizeUrl(img.currentSrc || img.src || img.getAttribute('src'));
    if (isFirebaseStorageUrl(url)) forgetBroken(url);
  }, true);

  // Al recuperar conexion las marcas viejas dejan de ser confiables: se limpian
  // y se reintentan todas las fotos que habian quedado en blanco.
  window.addEventListener('online', () => {
    brokenUrls.clear();
    persist();
    restoreImages('');
  });

  const scanImages = (root = document) => {
    if (root instanceof HTMLImageElement) {
      suppressIfKnownBroken(root);
      return;
    }
    if (!root?.querySelectorAll) return;
    root.querySelectorAll('img').forEach(suppressIfKnownBroken);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => scanImages(), { once: true });
  } else {
    scanImages();
  }

  new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach(scanImages);
    });
  }).observe(document.documentElement, { childList: true, subtree: true });

  const reset = () => {
    brokenUrls.clear();
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
    restoreImages('');
    return true;
  };

  const list = () => Array.from(brokenUrls.entries()).map(([url, ts]) => ({ url, failedAt: new Date(ts).toISOString() }));

  window.LaJamoneraImageGuard = {
    isBroken,
    markBroken,
    forgetBroken,
    neutralizeImage,
    isFirebaseStorageUrl,
    restoreImages,
    reset,
    list
  };
})();
