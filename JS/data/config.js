// Backend de datos del sitio: 'firebase' (actual) o 'supabase' (migración).
// CORTE: cambiar DEFAULT_BACKEND a 'supabase'. Para probar sin cambiar el default:
// localStorage.setItem('lj-backend', 'supabase') y recargar (o 'firebase' para volver).
(function ljBackendConfig() {
  const DEFAULT_BACKEND = 'firebase';
  let backend = DEFAULT_BACKEND;
  try {
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
