(function swalA11yGuardModule() {
  if (!window.Swal || window.Swal.__laJamoneraA11yGuardPatched) {
    return;
  }

  const PARKING_NODE_ID = 'focusParkingNode';
  const originalFire = window.Swal.fire.bind(window.Swal);

  const blurActiveElement = () => {
    const active = document.activeElement;
    if (active && typeof active.blur === 'function') {
      active.blur();
    }
  };

  const ensureParkingNode = () => {
    let node = document.getElementById(PARKING_NODE_ID);
    if (node) {
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
    ensureParkingNode().focus({ preventScroll: true });
  };

  const releaseFocusFromAriaHiddenContainers = () => {
    let current = document.activeElement;
    if (!current || current === document.body) {
      return;
    }

    while (current && current !== document.body) {
      if (current.getAttribute && current.getAttribute('aria-hidden') === 'true') {
        blurActiveElement();
        parkFocus();
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

  window.Swal.fire = function patchedSwalFire(options = {}) {
    const opts = (options && typeof options === 'object') ? options : { title: String(options || '') };
    const targetEl = resolveTargetElement(opts.target);
    const activeModal = getTopVisibleModal();
    const mustInertActiveModal = Boolean(activeModal && (!targetEl || !activeModal.contains(targetEl)));
    const activeModalHadInert = mustInertActiveModal ? activeModal.hasAttribute('inert') : false;

    blurActiveElement();
    releaseFocusFromAriaHiddenContainers();
    parkFocus();

    if (mustInertActiveModal) {
      activeModal.setAttribute('inert', '');
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
      parkFocus();
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
