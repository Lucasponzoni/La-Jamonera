// Diagrama de trazabilidad (Mermaid) con visor propio: encabezado con controles (−, %, +, ajustar, pantalla
// completa), arrastrar para mover, pellizcar / Ctrl+rueda para zoom. Lo usan Producción (index.html) y la vista
// pública del QR (produccion_publica.html).
//   await LJTraceDiagram.render(host, definicionMermaid)   → arma el visor dentro de host (lanza si falla)
//   LJTraceDiagram.mermaidConfig()                         → configuración común para mermaid.initialize
(function ljTraceDiagram() {
  const isMobile = () => Boolean(window.matchMedia && window.matchMedia('(max-width: 768px)').matches);

  const mermaidConfig = () => ({
    startOnLoad: false,
    securityLevel: 'loose',
    theme: 'base',
    themeVariables: {
      fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      fontSize: '15px',
      primaryColor: '#eef4ff',
      primaryTextColor: '#1f3a6e',
      primaryBorderColor: '#b9cdf2',
      lineColor: '#7d93c2',
      tertiaryColor: '#ffffff',
      edgeLabelBackground: '#ffffff'
    },
    // useMaxWidth:false = tamaño real del SVG (nítido); el visor se encarga de encajarlo.
    flowchart: { htmlLabels: true, useMaxWidth: false, padding: 14, nodeSpacing: 34, rankSpacing: 54, curve: 'basis' }
  });

  let seq = 0;
  async function render(host, definition) {
    if (!host || !window.mermaid) throw new Error('mermaid no disponible');
    // Las etiquetas se miden con la fuente: si Inter todavía no cargó, el texto queda cortado dentro de las cajas.
    try { await document.fonts?.ready; } catch (_) { /* sigue */ }
    seq += 1;
    const { svg } = await window.mermaid.render(`lj_trace_${Date.now()}_${seq}`, definition);
    if (!svg) throw new Error('diagrama vacío');
    host.innerHTML = `
      <div class="lj-trace-dia">
        <div class="lj-trace-dia-head">
          <span class="lj-trace-dia-title"><i class="fa-solid fa-diagram-project" aria-hidden="true"></i><span class="lj-trace-dia-title-long">Diagrama de trazabilidad</span><span class="lj-trace-dia-title-short">Diagrama</span></span>
          <div class="lj-trace-dia-tools" role="toolbar" aria-label="Zoom del diagrama">
            <button type="button" class="lj-trace-dia-btn" data-dia="out" aria-label="Alejar" title="Alejar"><i class="fa-solid fa-minus"></i></button>
            <span class="lj-trace-dia-zoom" data-dia-zoom>100%</span>
            <button type="button" class="lj-trace-dia-btn" data-dia="in" aria-label="Acercar" title="Acercar"><i class="fa-solid fa-plus"></i></button>
            <button type="button" class="lj-trace-dia-btn" data-dia="fit" aria-label="Ajustar a la pantalla" title="Ajustar"><i class="fa-solid fa-expand"></i></button>
            <button type="button" class="lj-trace-dia-btn" data-dia="full" aria-label="Pantalla completa" title="Pantalla completa"><i class="fa-solid fa-maximize"></i></button>
          </div>
        </div>
        <div class="lj-trace-dia-viewport" data-dia-viewport>
          <div class="lj-trace-dia-canvas" data-dia-canvas>${svg}</div>
          <span class="lj-trace-dia-hint" data-dia-hint>${isMobile() ? 'Deslizá para mover · pellizcá para zoom' : 'Arrastrá para mover · Ctrl + rueda para zoom'}</span>
        </div>
      </div>`;
    setup(host.querySelector('.lj-trace-dia'), { vertical: /^\s*(flowchart|graph)\s+(TB|TD|BT)\b/m.test(definition) });
  }

  function setup(root, { vertical = false } = {}) {
    const viewport = root.querySelector('[data-dia-viewport]');
    const canvas = root.querySelector('[data-dia-canvas]');
    const svg = canvas.querySelector('svg');
    const label = root.querySelector('[data-dia-zoom]');
    const hint = root.querySelector('[data-dia-hint]');
    const fullBtn = root.querySelector('[data-dia="full"]');
    // Tamaño natural del SVG (sin max-width de mermaid).
    const vb = svg.viewBox && svg.viewBox.baseVal;
    const natW = (vb && vb.width) || svg.getBoundingClientRect().width || 800;
    const natH = (vb && vb.height) || svg.getBoundingClientRect().height || 400;
    svg.setAttribute('width', natW);
    svg.setAttribute('height', natH);
    svg.style.maxWidth = 'none';
    canvas.style.width = `${natW}px`;
    canvas.style.height = `${natH}px`;

    let zoom = 1; let panX = 0; let panY = 0;
    const MIN = 0.2; const MAX = 3;
    const apply = () => {
      canvas.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
      label.textContent = `${Math.round(zoom * 100)}%`;
    };
    const hideHint = () => hint && hint.classList.add('is-hidden');
    const setZoom = (next, ox = viewport.clientWidth / 2, oy = viewport.clientHeight / 2) => {
      const z = Math.min(MAX, Math.max(MIN, next));
      const wx = (ox - panX) / zoom; const wy = (oy - panY) / zoom;
      zoom = z; panX = ox - wx * zoom; panY = oy - wy * zoom;
      apply();
    };
    // Al abrir: a lo ancho pero nunca más chico que un tamaño legible (el resto se ve moviendo). "Ajustar" (all)
    // muestra el diagrama entero. Si no entra, arranca por el comienzo del recorrido: a la izquierda en los
    // diagramas horizontales y arriba al centro en los verticales.
    const LEGIBLE = () => (isMobile() ? 0.55 : 0.6);
    const fit = (all = false) => {
      const vw = viewport.clientWidth - 24;
      const vh = viewport.clientHeight - 24;
      const full = root.classList.contains('is-fullscreen');
      let z = Math.min(1, vw / natW, (all || full) ? vh / natH : Infinity);
      if (!all) z = Math.max(z, Math.min(1, LEGIBLE()));
      zoom = Math.max(MIN, z);
      const w = natW * zoom; const h = natH * zoom;
      panX = (viewport.clientWidth - w) / 2;
      panY = (viewport.clientHeight - h) / 2;
      // No entra: se encuadra el primer nodo (la empresa, comienzo del recorrido).
      const first = !all && (w > vw || h > vh) ? rootPoint() : null;
      if (first) {
        const horizontal = !vertical;
        const tx = horizontal ? Math.min(viewport.clientWidth * 0.3, 40 + first.w * zoom / 2) : viewport.clientWidth / 2;
        const ty = horizontal ? viewport.clientHeight / 2 : 24 + first.h * zoom / 2;
        if (w > vw) panX = tx - first.x * zoom;
        if (h > vh) panY = ty - first.y * zoom;
      }
      apply();
    };
    // Centro del primer nodo en coordenadas del SVG sin zoom.
    let rootCache = null;
    function rootPoint() {
      if (rootCache) return rootCache;
      const node = svg.querySelector('g.node');
      if (!node) return null;
      const sr = svg.getBoundingClientRect(); const nr = node.getBoundingClientRect();
      if (!sr.width) return null;
      const k = sr.width / natW;
      rootCache = { x: (nr.left + nr.width / 2 - sr.left) / k, y: (nr.top + nr.height / 2 - sr.top) / k, w: nr.width / k, h: nr.height / k };
      return rootCache;
    }
    // Alto del visor según el diagrama (sin espacio vacío de más), dentro de un máximo.
    const sizeViewport = () => {
      if (root.classList.contains('is-fullscreen')) { viewport.style.height = ''; return; }
      const maxH = isMobile() ? Math.round(window.innerHeight * 0.62) : 520;
      const z = Math.max(Math.min(1, LEGIBLE()), Math.min(1, (viewport.clientWidth - 24) / natW));
      viewport.style.height = `${Math.max(240, Math.min(maxH, Math.round(natH * z + 28)))}px`;
    };

    // Arrastre y pellizco (punteros). En celular, un dedo vertical sigue scrolleando la página (touch-action: pan-y)
    // salvo en pantalla completa.
    const pointers = new Map(); let drag = null; let pinch = null;
    viewport.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      viewport.setPointerCapture?.(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      hideHint();
      if (pointers.size === 1) { drag = { x: e.clientX, y: e.clientY, px: panX, py: panY }; viewport.classList.add('is-dragging'); }
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom, panX, panY };
      }
    });
    viewport.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size >= 2 && pinch && pinch.d > 0) {
        const [a, b] = [...pointers.values()];
        const r = viewport.getBoundingClientRect();
        const cx = (a.x + b.x) / 2 - r.left; const cy = (a.y + b.y) / 2 - r.top;
        const z = Math.min(MAX, Math.max(MIN, pinch.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d)));
        const wx = (cx - pinch.panX) / pinch.zoom; const wy = (cy - pinch.panY) / pinch.zoom;
        zoom = z; panX = cx - wx * zoom; panY = cy - wy * zoom;
        apply();
        return;
      }
      if (!drag) return;
      panX = drag.px + (e.clientX - drag.x);
      panY = drag.py + (e.clientY - drag.y);
      apply();
    });
    const end = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (!pointers.size) { drag = null; viewport.classList.remove('is-dragging'); }
      else { const [p] = [...pointers.values()]; drag = { x: p.x, y: p.y, px: panX, py: panY }; }
    };
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => viewport.addEventListener(ev, end));
    // Rueda: zoom con Ctrl/⌘ (o siempre en pantalla completa); si no, se deja scrollear la página.
    viewport.addEventListener('wheel', (e) => {
      if (!(e.ctrlKey || e.metaKey || root.classList.contains('is-fullscreen'))) return;
      e.preventDefault();
      const r = viewport.getBoundingClientRect();
      hideHint();
      setZoom(zoom * (e.deltaY < 0 ? 1.12 : 0.89), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });

    const setFullIcon = (on) => {
      fullBtn.innerHTML = `<i class="fa-solid ${on ? 'fa-minimize' : 'fa-maximize'}"></i>`;
      fullBtn.setAttribute('aria-label', on ? 'Salir de pantalla completa' : 'Pantalla completa');
      fullBtn.title = on ? 'Salir de pantalla completa' : 'Pantalla completa';
    };
    const toggleFull = async () => {
      const on = !root.classList.contains('is-fullscreen');
      root.classList.toggle('is-fullscreen', on);
      document.documentElement.classList.toggle('lj-trace-dia-open', on);
      setFullIcon(on);
      try {
        if (on && root.requestFullscreen && !document.fullscreenElement) await root.requestFullscreen();
        else if (!on && document.fullscreenElement === root) await document.exitFullscreen();
      } catch (_) { /* sin API de pantalla completa (iPhone): queda el modo fijo por CSS */ }
      requestAnimationFrame(() => { sizeViewport(); fit(on); });
    };
    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement && root.classList.contains('is-fullscreen')) {
        root.classList.remove('is-fullscreen');
        document.documentElement.classList.remove('lj-trace-dia-open');
        setFullIcon(false);
        requestAnimationFrame(() => { sizeViewport(); fit(); });
      }
    });
    root.addEventListener('keydown', (e) => { if (e.key === 'Escape' && root.classList.contains('is-fullscreen')) { e.stopPropagation(); toggleFull(); } });

    root.querySelector('[data-dia="in"]').addEventListener('click', () => { hideHint(); setZoom(zoom * 1.2); });
    root.querySelector('[data-dia="out"]').addEventListener('click', () => { hideHint(); setZoom(zoom / 1.2); });
    root.querySelector('[data-dia="fit"]').addEventListener('click', () => fit(true));
    fullBtn.addEventListener('click', toggleFull);

    // El visor puede montarse dentro de una ventana que todavía anima: esperar a tener ancho.
    const start = () => { sizeViewport(); fit(); };
    if (viewport.clientWidth > 0) start();
    if (window.ResizeObserver) {
      let lastW = viewport.clientWidth;
      new ResizeObserver(() => {
        const w = viewport.clientWidth;
        if (w > 0 && Math.abs(w - lastW) > 4) { lastW = w; start(); }
      }).observe(viewport);
    }
  }

  window.LJTraceDiagram = { render, mermaidConfig, isMobile };
})();
