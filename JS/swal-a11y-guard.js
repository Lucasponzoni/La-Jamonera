(function swalA11yGuardModule() {
  if (!window.Swal || window.Swal.__laJamoneraA11yGuardPatched) {
    return;
  }

  const PARKING_NODE_ID = 'focusParkingNode';
  const originalFire = window.Swal.fire.bind(window.Swal);
  let parkingFocus = false;

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
      blurActiveElement();
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
    let current = document.activeElement;
    if (!current || current === document.body) {
      return;
    }

    while (current && current !== document.body) {
      if (current.getAttribute && current.getAttribute('aria-hidden') === 'true') {
        blurActiveElement();
        if (!document.querySelector('.modal.show')) {
          parkFocus();
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
  const STORAGE_KEY = 'laJamoneraBrokenFirebaseImages';
  const EMPTY_IMAGE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
  const MAX_STORED = 250;

  const normalizeUrl = (value) => String(value || '').trim();
  const isFirebaseStorageUrl = (value) => /firebasestorage\.googleapis\.com|\.firebasestorage\.app/i.test(normalizeUrl(value));

  const readStored = () => {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(parsed) ? parsed.filter(Boolean).slice(-MAX_STORED) : [];
    } catch (_) {
      return [];
    }
  };

  const brokenUrls = new Set(readStored());

  const persist = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(brokenUrls).slice(-MAX_STORED)));
    } catch (_) {}
  };

  const markBroken = (url) => {
    const safeUrl = normalizeUrl(url);
    if (!safeUrl || !isFirebaseStorageUrl(safeUrl)) return;
    brokenUrls.add(safeUrl);
    persist();
  };

  const isBroken = (url) => brokenUrls.has(normalizeUrl(url));

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
    markBroken(url);
    neutralizeImage(img, url);
  }, true);

  document.addEventListener('load', (event) => {
    const img = event.target;
    if (!(img instanceof HTMLImageElement)) return;
    img.classList.remove('is-broken-image');
  }, true);

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

  window.LaJamoneraImageGuard = {
    isBroken,
    markBroken,
    neutralizeImage,
    isFirebaseStorageUrl
  };
})();
