// Zoom y desplazamiento del visor de adjuntos (facturas, PT). Lo usan Inventario/Producción y la trazabilidad pública.
// Con los dedos: pellizcar para zoom, arrastrar para mover, doble toque para acercar o volver.
// Con mouse: rueda y arrastre. En celular los PDF se muestran como imágenes, porque dentro de un iframe no se ven bien.
(() => {
  const ESCALA_MAX = 6;
  const PASO_BOTON = 1.5;
  const ESCALA_DOBLE_TOQUE = 2.5;
  const ANCHO_PAGINA_PDF = 1600;
  const PDF_LIB = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/pdf.min.js';
  const PDF_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/pdf.worker.min.js';

  const estilos = document.createElement('style');
  estilos.textContent = `
    .viewer-stage.is-image { touch-action: none; overscroll-behavior: contain; }
    .viewer-stage #viewerImage { touch-action: none; }
    .viewer-stage #viewerImage.lj-visor-suave { transition: transform .18s ease; }
    @media (max-width: 767.98px) {
      .image-viewer-modal::part(panel) { width: 100vw; max-width: 100vw; height: 100dvh; max-height: 100dvh; border-radius: 0; margin: 0; }
      .image-viewer-modal::part(header) { display: none; }
      .image-viewer-modal::part(body) { padding: 8px; display: flex; min-height: 0; overflow: hidden; }
      .image-viewer-modal .lj-dialog-body { flex: 1; min-height: 0; max-height: none; height: 100%; gap: 8px; }
      .image-viewer-modal .image-viewer-controls.image-viewer-controls-inventario { display: flex; flex-wrap: nowrap; gap: 4px; }
      .image-viewer-modal .image-viewer-controls.image-viewer-controls-inventario > * { flex: 1 1 0; min-width: 0; }
      .image-viewer-modal #viewerBackBtn span, .image-viewer-modal #viewerDownloadBtn span { display: none; }
      .image-viewer-modal .image-viewer-controls.image-viewer-controls-inventario #viewerBackBtn,
      .image-viewer-modal .image-viewer-controls.image-viewer-controls-inventario #viewerDownloadBtn { flex: 1 1 0; }
      .image-viewer-modal .image-viewer-controls sl-button { width: auto; }
      .image-viewer-modal .image-viewer-controls sl-button::part(base) { width: 100%; min-width: 0; padding: 0; }
      .image-viewer-modal .image-viewer-controls sl-button::part(label),
      .image-viewer-modal .image-viewer-controls sl-button::part(prefix) { padding: 0; }
      .image-viewer-modal .viewer-stage { min-height: 0; height: 100%; }
      .image-viewer-modal .viewer-stage #viewerImage { position: absolute; inset: 0; margin: auto; }
      .image-viewer-modal .viewer-document { min-height: 100%; height: 100%; }
    }`;
  document.head.append(estilos);

  const attach = ({ stage, image, zoomIn, zoomOut }) => {
    if (!stage || !image) return null;
    let escala = 1;
    let x = 0;
    let y = 0;
    let pinch = null;
    let arrastre = null;
    let ultimoToque = null;
    let ultimoTipo = '';
    const punteros = new Map();
    const visible = () => !image.classList.contains('d-none');

    const aplicar = () => {
      const r = stage.getBoundingClientRect();
      const maxX = Math.max(0, (image.clientWidth * escala - r.width) / 2);
      const maxY = Math.max(0, (image.clientHeight * escala - r.height) / 2);
      x = Math.min(maxX, Math.max(-maxX, x));
      y = Math.min(maxY, Math.max(-maxY, y));
      image.style.transform = `translate(${x}px, ${y}px) scale(${escala})`;
    };
    // Punto relativo al centro del visor: la imagen está centrada y escala desde su centro.
    const relativo = (clientX, clientY) => {
      const r = stage.getBoundingClientRect();
      return { px: clientX - r.left - r.width / 2, py: clientY - r.top - r.height / 2 };
    };
    // Cambia la escala dejando quieto lo que está debajo del punto indicado.
    const zoomEn = (nueva, px = 0, py = 0) => {
      const n = Math.max(1, Math.min(ESCALA_MAX, nueva));
      x = px - ((px - x) / escala) * n;
      y = py - ((py - y) / escala) * n;
      escala = n;
      aplicar();
    };
    const suave = () => {
      image.classList.add('lj-visor-suave');
      setTimeout(() => image.classList.remove('lj-visor-suave'), 220);
    };
    const iniciarPinch = () => {
      const [a, b] = [...punteros.values()];
      const c = relativo((a.x + b.x) / 2, (a.y + b.y) / 2);
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, escala, x, y, ...c };
      arrastre = null;
    };

    stage.addEventListener('pointerdown', (e) => {
      if (!visible()) return;
      e.preventDefault();
      ultimoTipo = e.pointerType;
      try { stage.setPointerCapture(e.pointerId); } catch (_) { /* puntero ya liberado */ }
      punteros.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (punteros.size === 2) iniciarPinch();
      else if (punteros.size === 1) arrastre = { sx: e.clientX - x, sy: e.clientY - y };
    });
    stage.addEventListener('pointermove', (e) => {
      if (!punteros.has(e.pointerId)) return;
      punteros.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && punteros.size >= 2) {
        const [a, b] = [...punteros.values()];
        const n = Math.max(1, Math.min(ESCALA_MAX, pinch.escala * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d)));
        const c = relativo((a.x + b.x) / 2, (a.y + b.y) / 2);
        x = c.px - ((pinch.px - pinch.x) / pinch.escala) * n;
        y = c.py - ((pinch.py - pinch.y) / pinch.escala) * n;
        escala = n;
        aplicar();
      } else if (arrastre && escala > 1) {
        x = e.clientX - arrastre.sx;
        y = e.clientY - arrastre.sy;
        aplicar();
      }
    });
    const soltar = (e) => {
      if (!punteros.has(e.pointerId)) return;
      const inicio = punteros.get(e.pointerId);
      punteros.delete(e.pointerId);
      pinch = null;
      if (punteros.size === 1) {
        // Queda un dedo: sigue moviendo desde donde está, sin saltar.
        const p = [...punteros.values()][0];
        arrastre = { sx: p.x - x, sy: p.y - y };
        return;
      }
      arrastre = null;
      if (e.type !== 'pointerup' || e.pointerType === 'mouse') return;
      const ahora = Date.now();
      if (ultimoToque && ahora - ultimoToque.t < 320 && Math.hypot(inicio.x - ultimoToque.x, inicio.y - ultimoToque.y) < 30) {
        const c = relativo(inicio.x, inicio.y);
        suave();
        if (escala > 1.05) zoomEn(1); else zoomEn(ESCALA_DOBLE_TOQUE, c.px, c.py);
        ultimoToque = null;
      } else {
        ultimoToque = { t: ahora, x: inicio.x, y: inicio.y };
      }
    };
    stage.addEventListener('pointerup', soltar);
    stage.addEventListener('pointercancel', soltar);
    stage.addEventListener('dblclick', (e) => {
      if (!visible() || ultimoTipo !== 'mouse') return; // el doble toque ya se resolvió en pointerup
      const c = relativo(e.clientX, e.clientY);
      suave();
      if (escala > 1.05) zoomEn(1); else zoomEn(ESCALA_DOBLE_TOQUE, c.px, c.py);
    });
    stage.addEventListener('wheel', (e) => {
      if (!visible()) return;
      e.preventDefault();
      const c = relativo(e.clientX, e.clientY);
      zoomEn(escala * (e.deltaY < 0 ? 1.2 : 1 / 1.2), c.px, c.py);
    }, { passive: false });
    zoomIn?.addEventListener('click', () => { suave(); zoomEn(escala * PASO_BOTON); });
    zoomOut?.addEventListener('click', () => { suave(); zoomEn(escala / PASO_BOTON); });
    image.addEventListener('load', aplicar);
    window.addEventListener('resize', aplicar);

    return {
      reset: () => {
        escala = 1;
        x = 0;
        y = 0;
        pinch = null;
        arrastre = null;
        punteros.clear();
        aplicar();
      },
      estado: () => ({ escala, x, y })
    };
  };

  // ---------- PDF como imágenes en celular ----------
  const usarPaginas = () => window.matchMedia('(pointer: coarse), (max-width: 767.98px)').matches;

  const cargarPdfLib = () => new Promise((ok, mal) => {
    if (window.pdfjsLib) { ok(window.pdfjsLib); return; }
    const s = document.createElement('script');
    s.src = PDF_LIB;
    s.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER;
      ok(window.pdfjsLib);
    };
    s.onerror = () => mal(new Error('No se pudo cargar el lector de PDF'));
    document.head.append(s);
  });

  const cache = new Map();
  const pdfAPaginas = (url) => {
    if (cache.has(url)) return cache.get(url);
    const tarea = (async () => {
      const lib = await cargarPdfLib();
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`PDF ${resp.status}`);
      const doc = await lib.getDocument({ data: await resp.arrayBuffer() }).promise;
      const paginas = [];
      for (let n = 1; n <= doc.numPages; n += 1) {
        const page = await doc.getPage(n);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: ANCHO_PAGINA_PDF / base.width });
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport }).promise;
        const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.88));
        paginas.push(URL.createObjectURL(blob));
        canvas.width = 1;
        canvas.height = 1;
      }
      try { await doc.destroy(); } catch (_) { /* nada que liberar */ }
      if (!paginas.length) throw new Error('PDF sin páginas');
      return paginas;
    })();
    tarea.catch(() => cache.delete(url));
    cache.set(url, tarea);
    return tarea;
  };

  // Reemplaza en la lista el PDF de la posición indicada por sus páginas. Devuelve false si no se pudo.
  const expandirPdf = async (lista, indice) => {
    const item = lista[indice];
    try {
      const paginas = await pdfAPaginas(item.src);
      if (lista[indice] !== item) return false;
      lista.splice(indice, 1, ...paginas.map((src) => ({ src, original: item.src })));
      return true;
    } catch (error) {
      console.warn('[visor] PDF como imagen', error);
      item.sinPaginas = true;
      return false;
    }
  };

  window.LJVisorZoom = { attach, usarPaginas, pdfAPaginas, expandirPdf };
})();
