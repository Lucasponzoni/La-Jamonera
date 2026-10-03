// Backend de datos del sitio: 'firebase' (actual) o 'supabase' (migración).
// CORTE: cambiar DEFAULT_BACKEND a 'supabase'. Para probar sin cambiar el default:
// localStorage.setItem('lj-backend', 'supabase') y recargar (o 'firebase' para volver).
(function ljBackendConfig() {
  const DEFAULT_BACKEND = 'supabase';
  // JS/data/backend.js (cargado antes, sin defer) ya decidió el backend y bajó el SDK si hacía falta.
  let backend = window.LJ_BACKEND === 'firebase' || window.LJ_BACKEND === 'supabase' ? window.LJ_BACKEND : DEFAULT_BACKEND;
  if (!window.LJ_BACKEND) try {
    const override = localStorage.getItem('lj-backend');
    if (override === 'firebase' || override === 'supabase') backend = override;
  } catch (_) { /* almacenamiento bloqueado: default */ }
  window.LJ_BACKEND = backend;
  // Clave publicable (pública por diseño: la seguridad está en RLS / Edge Functions).
  window.LJ_SUPABASE = {
    url: 'https://bpbsqhdxbfhdticbnnnm.supabase.co',
    key: 'sb_publishable_rImpkWVzA815uOiCSciiYA_kvBrtxG1',
    functionsBase: 'https://bpbsqhdxbfhdticbnnnm.supabase.co/functions/v1/api',
    bucket: 'archivos',
    sdk: 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.min.js',
    sdkIntegrity: 'sha384-WgXwGL6fUsYJWNaKJgVbrJKGRQwc1vieh2oy4kw9nXqpNDz3tdSsqEYUgeHD/NuF'
  };
  document.documentElement.dataset.ljBackend = backend;
  // Miniaturas: las portadas originales pesan 1-3 MB. Para listas y avatares se pide a Supabase
  // una versión redimensionada (webp, ~10 KB). Impresiones y visores siguen usando la URL original.
  const PUBLIC_PREFIX = `${window.LJ_SUPABASE.url}/storage/v1/object/public/`;
  window.ljThumb = (url, px = 160) => {
    const src = String(url || '');
    if (!src.startsWith(PUBLIC_PREFIX) || /\.(svg|gif|pdf)(\?|$)/i.test(src)) return src;
    const [pathPart] = src.slice(PUBLIC_PREFIX.length).split('?');
    return `${window.LJ_SUPABASE.url}/storage/v1/render/image/public/${pathPart}?width=${Math.round(px)}&resize=contain`;
  };
  // Si la versión redimensionada falla, se vuelve a la original antes de que el sitio muestre el placeholder.
  const RENDER_PREFIX = `${window.LJ_SUPABASE.url}/storage/v1/render/image/public/`;
  document.addEventListener('error', (event) => {
    const img = event.target;
    if (!(img instanceof HTMLImageElement) || !img.src.startsWith(RENDER_PREFIX)) return;
    event.stopPropagation();
    img.src = PUBLIC_PREFIX + img.src.slice(RENDER_PREFIX.length).split('?')[0];
  }, true);
})();
