(function swalA11yGuardModule() {
  if (!window.Swal || window.Swal.__laJamoneraA11yGuardPatched) {
    return;
  }

  const PARKING_NODE_ID = 'focusParkingNode';
  const originalFire = window.Swal.fire.bind(window.Swal);
  let parkingFocus = false;
  let releasingFocus = false;

  const blurActiveElement = () => {
    const active = document.activeElement;
    if (active && typeof active.blur === 'function') {
      active.blur();
    }
  };

  const ensureParkingNode = () => {
    let node = document.getElementById(PARKING_NODE_ID);
    if (node) {
      node.removeAttribute('aria-hidden');
      node.setAttribute('aria-label', 'focus parking');
      return node;
    }

    node = document.createElement('button');
    node.id = PARKING_NODE_ID;
    node.type = 'button';
    node.tabIndex = -1;
    node.setAttribute('aria-label', 'focus parking');
    node.style.position = 'fixed';
    node.style.opacity = '0';
    node.style.pointerEvents = 'none';
    node.style.width = '1px';
    node.style.height = '1px';
    node.style.left = '-9999px';
    node.style.top = '-9999px';
    document.body.appendChild(node);

    return node;
  };

  const parkFocus = () => {
    if (parkingFocus) {
      return;
    }

    if (document.querySelector('.modal.show')) {
      return;
    }

    parkingFocus = true;
    try {
      ensureParkingNode().focus({ preventScroll: true });
    } finally {
      window.setTimeout(() => {
        parkingFocus = false;
      }, 0);
    }
  };

  const elementContainsFocus = (element) => {
    const active = document.activeElement;
    return Boolean(element && active && active !== document.body && element.contains(active));
  };

  const moveFocusOutside = (element) => {
    if (!elementContainsFocus(element)) {
      return;
    }

    blurActiveElement();
    if (!document.querySelector('.modal.show')) {
      parkFocus();
    }
  };

  const releaseFocusFromAriaHiddenContainers = () => {
    if (releasingFocus) {
      return;
    }

    if (document.querySelector('.modal.show')) {
      return;
    }

    let current = document.activeElement;
    if (!current || current === document.body) {
      return;
    }

    while (current && current !== document.body) {
      if (current.getAttribute && current.getAttribute('aria-hidden') === 'true') {
        releasingFocus = true;
        try {
          blurActiveElement();
          parkFocus();
        } finally {
          window.setTimeout(() => {
            releasingFocus = false;
          }, 0);
        }
        return;
      }
      current = current.parentElement;
    }
  };

  const getTopVisibleModal = () => {
    const openModals = Array.from(document.querySelectorAll('.modal.show'));
    return openModals[openModals.length - 1] || null;
  };

  const resolveTargetElement = (target) => {
    if (!target) {
      return null;
    }

    if (typeof target === 'string') {
      return document.querySelector(target);
    }

    if (target instanceof Element) {
      return target;
    }

    return null;
  };

  if (!Element.prototype.__laJamoneraAriaHiddenFocusPatched) {
    const originalSetAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function patchedSetAttribute(name, value) {
      if (String(name || '').toLowerCase() === 'aria-hidden' && String(value) === 'true') {
        moveFocusOutside(this);
      }
      return originalSetAttribute.call(this, name, value);
    };
    Object.defineProperty(Element.prototype, '__laJamoneraAriaHiddenFocusPatched', { value: true });
  }

  document.addEventListener('hide.bs.modal', (event) => {
    moveFocusOutside(event.target);
  }, true);

  document.addEventListener('hidden.bs.modal', (event) => {
    moveFocusOutside(event.target);
  }, true);

  document.addEventListener('focusin', releaseFocusFromAriaHiddenContainers, true);

  window.Swal.fire = function patchedSwalFire(options = {}) {
    const opts = (options && typeof options === 'object') ? options : { title: String(options || '') };
    const targetEl = resolveTargetElement(opts.target);
    const activeModal = getTopVisibleModal();
    const mustInertActiveModal = Boolean(activeModal && (!targetEl || !activeModal.contains(targetEl)));
    const activeModalHadInert = mustInertActiveModal ? activeModal.hasAttribute('inert') : false;

    if (mustInertActiveModal) {
      activeModal.setAttribute('inert', '');
    }

    blurActiveElement();
    releaseFocusFromAriaHiddenContainers();
    if (!activeModal) {
      parkFocus();
    }

    const userWillClose = opts.willClose;
    const userDidDestroy = opts.didDestroy;
    let cleaned = false;

    const cleanup = () => {
      if (cleaned) {
        return;
      }
      cleaned = true;

      if (mustInertActiveModal && activeModal) {
        if (!activeModalHadInert) {
          activeModal.removeAttribute('inert');
        }
      }

      releaseFocusFromAriaHiddenContainers();
      if (!activeModal) {
        parkFocus();
      }
    };

    return originalFire({
      ...opts,
      returnFocus: false,
      willClose: (...args) => {
        cleanup();
        if (typeof userWillClose === 'function') {
          userWillClose(...args);
        }
      },
      didDestroy: (...args) => {
        cleanup();
        if (typeof userDidDestroy === 'function') {
          userDidDestroy(...args);
        }
      }
    });
  };

  window.Swal.__laJamoneraA11yGuardPatched = true;
})();

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
