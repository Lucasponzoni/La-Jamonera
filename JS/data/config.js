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
})();
