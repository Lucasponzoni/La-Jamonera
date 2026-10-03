// Decide el backend de datos ANTES de cargar cualquier otra cosa y descarga el SDK de Firebase
// sólo cuando hace falta. Se carga sin defer, en el lugar donde antes estaban los <script> de Firebase.
//   Volver a Firebase: cambiar DEFAULT_BACKEND a 'firebase' (y en JS/data/config.js), o probar con
//   localStorage.setItem('lj-backend', 'firebase') y recargar.
// En páginas con scripts defer, la etiqueta lleva data-defer para que el SDK conserve ese orden.
(function ljBackend() {
  const DEFAULT_BACKEND = 'supabase';
  let backend = DEFAULT_BACKEND;
  try {
    const override = localStorage.getItem('lj-backend');
    if (override === 'firebase' || override === 'supabase') backend = override;
  } catch (_) { /* almacenamiento bloqueado: default */ }
  window.LJ_BACKEND = backend;
  if (backend !== 'firebase') return;
  const defer = document.currentScript && document.currentScript.hasAttribute('data-defer') ? ' defer' : '';
  ['app', 'auth', 'database', 'storage'].forEach((mod) => {
    document.write(`<script${defer} src="https://www.gstatic.com/firebasejs/8.10.1/firebase-${mod}.js"><\/script>`);
  });
})();
