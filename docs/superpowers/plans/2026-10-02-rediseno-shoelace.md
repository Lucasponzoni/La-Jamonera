# Rediseño Bootstrap → Shoelace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar Bootstrap + SweetAlert2 por Shoelace 2.20.1 (vanilla) en todo el sitio, con el estilo "B azul institucional" (plano, radio ≤ 6 px, controles de 36 px) y modo oscuro por usuario, sin cambiar lógica de negocio.

**Architecture:** Capa base nueva en `JS/ui/` (tema, puente de eventos de formularios, modales, alertas Swal-compatibles) + tokens CSS. Después cada módulo (un archivo JS + su CSS) se migra contra esas interfaces con reglas fijas y un linter de patrones heredados. Validación con un banco Playwright que bloquea escrituras a Firebase.

**Tech Stack:** Shoelace 2.20.1 (vendorizado), vanilla JS, Firebase RTDB compat 8.10.1, flatpickr, Apache ECharts 5 (reemplaza Chart.js), Playwright-core + Edge (sólo pruebas, fuera del repo).

**Spec:** `docs/superpowers/specs/2026-10-02-rediseno-shoelace-design.md`

## Global Constraints

- Shoelace **2.20.1** vendorizado en `vendor/shoelace/` (nada de CDN para Shoelace).
- Bootstrap CSS/JS y bootstrap-icons: **0 referencias** al final. SweetAlert2: **0 referencias** al final (la API `Swal` la provee `JS/ui/lj-alert.js`).
- Altura de controles: `--sl-input-height-medium: 36px`; radio `--sl-border-radius-medium: 5px` (máx. 6 px en superficies).
- Colores claro: fondo `#f6f8fc`, superficie `#ffffff`, superficie-2 `#f2f5fb`, borde `#dfe5f0`, borde fuerte `#cfd8e8`, texto `#1f2a44`, apagado `#55607f`, marca `#173d73`, acento `#1f5fbf`. Oscuro: fondo `#0f1522`, superficie `#161e2e`, superficie-2 `#1c2638`, borde `#26324a`, borde fuerte `#334262`, texto `#e3e9f5`, apagado `#93a0bb`, marca `#cddcff`, acento `#6ea0ff`.
- Modo oscuro: clase `sl-theme-dark` en `<html>`; caché `localStorage['lj-theme']`; fuente de verdad `/userPreferences/{uid}/theme` (`'light'|'dark'`); default claro; `produccion_publica.html` siempre claro.
- Font Awesome se queda. `bi bi-x` → `<sl-icon name="x">`.
- Gráficos con **Apache ECharts 5** vendorizado (`vendor/echarts/`); Chart.js: 0 referencias al final.
- Impresiones/PDF/planillas/QR: **no se modifican**.
- No cambiar lógica de negocio, rutas de Firebase ni forma de los datos.
- `<input>` nativo permitido sólo para: `type=file` (oculto), `type=color`, `type=range`, `type=hidden`, y campos con flatpickr (clase `lj-input`).
- Botones con contenido compuesto (tarjetas/tiles con imagen) pueden seguir siendo `<button class="lj-tile ...">`; toda otra acción es `sl-button`/`sl-icon-button`.
- Tipografía Inter.
- Publicación a `main` sólo con OK explícito de Lucas.

## Review Focus

1. **Selects con valores con espacios** (nombres de proveedores, ingredientes, "Esta semana"): `sl-option value` no admite espacios → el valor leído debe ser idéntico al anterior. Test en Task 4 (`ljSelectValue` round-trip con `"LAS CAMELIAS S.A"`).
2. **Leer `.value` justo después de renderizar** un `sl-input` creado por template (antes de que el autoloader lo defina) → debe devolver el valor del atributo. Test en Task 4 (`ljReady`).
3. **Escuchas `change` delegadas** en contenedores (producción `dispatchView`, recetas `recipeEditorForm`) → deben seguir disparando con `sl-select`/`sl-checkbox`/`sl-input`. Test en Task 4 (puente, delegado en contenedor).
4. **Alertas apiladas sobre un modal abierto** (confirmar producción dentro del modal Producción; visor de imágenes sobre otro modal) → foco y clic en el diálogo de arriba, el modal de abajo no se cierra con Escape. Test en Task 6 (`Swal.fire` con `sl-dialog` abierto debajo).
5. **`preConfirm` que devuelve `false` o llama `showValidationMessage`** → la alerta no se cierra y muestra el mensaje; async preConfirm que tira error → mensaje y queda abierta. Test en Task 6.

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `vendor/shoelace/` | Build `cdn` de Shoelace 2.20.1 (autoloader, chunks, components, themes, assets/icons) |
| `CSS/theme.css` | Tokens `--lj-*` claro/oscuro + mapeo a variables Shoelace + estilos base (`body`, `lj-input`, tablas, `lj-tile`) |
| `CSS/utilities.css` | Utilidades que reemplazan a Bootstrap |
| `CSS/base.css` + `CSS/modules/*.css` | `style.css` partido por sección (mismo orden de cascada) |
| `JS/ui/theme.js` | Modo oscuro: aplicar, alternar, persistir (localStorage + Firebase), botón |
| `JS/ui/forms.js` | Puente `sl-change`→`change`, `ljReady`, `ljSelectValue`/`ljOptionValue`, `ljNativeInput`, `ljFlatpickr` |
| `JS/ui/modal.js` | `LJModal` sobre `sl-dialog` + activadores `data-lj-open` |
| `JS/ui/lj-alert.js` | `Swal`/`LJAlert` compatibles implementados con `sl-dialog` |
| `JS/ui/header.js` | Encabezado: drawer móvil, menú usuario, botón tema |
| `JS/image-guard.js` | Parte de guard de imágenes rotas extraída de `swal-a11y-guard.js` |
| `tools/stamp-assets.js` | Versiona también `./vendor/` |
| Banco (fuera del repo) `…/scratchpad/e2e/` | `ui-check.js` (recorrido), `lint-legacy.js` (patrones prohibidos), `unit/` + `unit-run.js` (tests de la capa UI) |

Ruta del banco: `E2E=C:/Users/Lucas/AppData/Local/Temp/claude/C--Users-Lucas-Documents-GitHub-La-Jamonera/d91dfb01-adfd-47ad-8832-1b2f57e2741c/scratchpad/e2e`. Credenciales por env `LJ_USER`/`LJ_PASS` (nunca en archivos).

---

### Task 1: Banco de pruebas (linter + unit runner + escenarios)

**Files:**
- Create: `$E2E/lint-legacy.js`, `$E2E/unit-run.js`, `$E2E/unit/smoke.test.html`
- Modify: `$E2E/ui-check.js` (escenarios por módulo, matriz)

**Interfaces:**
- Produces: `node lint-legacy.js <archivos...>` → exit 1 y lista `archivo:línea regla` si hay patrones heredados; `node unit-run.js [filtro]` → corre cada `unit/*.test.html`, que debe setear `window.__result = {pass, fail, details}`; `node ui-check.js <out> [--theme dark] [--mobile] [--only a,b]` con escenarios por módulo registrados en `SCENARIOS`.

- [ ] **Step 1: Escribir `lint-legacy.js`**

```js
// Detecta patrones de Bootstrap/SweetAlert/controles nativos que deben migrar.
const fs = require('fs');
const RULES = [
  ['bootstrap-data', /data-bs-[a-z]+/],
  ['bootstrap-js', /bootstrap\.(Modal|Collapse|Dropdown|Tooltip|Popover|Toast|Tab|Offcanvas)|window\.bootstrap/],
  ['bootstrap-event', /\.bs\.(modal|collapse|dropdown)/],
  ['bootstrap-class', /class(Name)?\s*=\s*\\?["'`][^"'`]*\b(btn|btn-\w+|form-control|form-select|form-label|form-check\w*|input-group(-text)?|modal(-\w+)?|navbar(-\w+)?|dropdown(-\w+)?|nav-link|nav-item|badge|container-fluid)\b/],
  ['bootstrap-css-link', /bootstrap(@|\.min\.css|\.bundle|-icons)/],
  ['sweetalert-lib', /sweetalert2/],
  ['native-select', /<select\b|<option\b|createElement\(\s*['"](select|option)['"]/],
  ['native-textarea', /<textarea\b(?![^>]*\blj-raw\b)/],
  ['native-input', /<input\b(?![^>]*type=\\?["'](file|color|range|hidden)\\?["'])(?![^>]*\blj-input\b)/],
  ['native-button', /<button\b(?![^>]*\blj-tile\b)/],
  ['bi-icon', /\bbi bi-[\w-]+/],
  ['bootstrap-dom', /\.modal\.show|\.modal-content|\.modal-body|modal-backdrop/],
  ['tag-selector', /querySelector(All)?\(\s*['"`](input|select|textarea|option)\b/],
  ['checked-pseudo', /:checked/],
  ['ios-legacy', /\bios-(btn|input|input-group|toggle-pass|modal)\b/]
];
const files = process.argv.slice(2);
let hits = 0;
for (const f of files) {
  const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const [name, re] of RULES) if (re.test(line)) { hits += 1; console.log(`${f}:${i + 1} ${name} :: ${line.trim().slice(0, 140)}`); }
  });
}
console.log(`\n${hits} patrones heredados`);
process.exit(hits ? 1 : 0);
```

- [ ] **Step 2: Correr el linter contra el repo actual (debe fallar con cientos de hits)**

Run: `node $E2E/lint-legacy.js C:/Users/Lucas/Documents/GitHub/La-Jamonera/JS/*.js C:/Users/Lucas/Documents/GitHub/La-Jamonera/*.html | tail -1`
Expected: `N patrones heredados` con N > 1000, exit 1.

- [ ] **Step 3: Escribir `unit-run.js`** (sirve repo en `/` y `$E2E/unit` en `/__unit/`, corre cada test)

```js
const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright-core');
const REPO = 'C:/Users/Lucas/Documents/GitHub/La-Jamonera';
const UNIT = path.join(__dirname, 'unit');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  const f = u.startsWith('/__unit/') ? path.join(UNIT, u.slice(8)) : path.join(REPO, u);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(fs.readFileSync(f));
}).listen(8098);
(async () => {
  const filter = process.argv[2] || '';
  const tests = fs.readdirSync(UNIT).filter((f) => f.endsWith('.test.html') && f.includes(filter));
  const browser = await chromium.launch({ channel: 'msedge' });
  let failed = 0;
  for (const t of tests) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://localhost:8098/__unit/${t}`);
    const result = await page.waitForFunction(() => window.__result, null, { timeout: 30000 }).then((h) => h.jsonValue()).catch(() => ({ pass: 0, fail: 1, details: ['timeout'] }));
    if (errors.length) { result.fail += errors.length; result.details.push(...errors.map((e) => `pageerror: ${e}`)); }
    failed += result.fail;
    console.log(`${result.fail ? 'FAIL' : 'PASS'} ${t} · ${result.pass} ok, ${result.fail} fallas`);
    result.details.filter((d) => d.startsWith('✗') || d.startsWith('pageerror') || d === 'timeout').forEach((d) => console.log('   ', d));
    await page.close();
  }
  await browser.close(); server.close();
  process.exit(failed ? 1 : 0);
})();
```

- [ ] **Step 4: Mini framework de test y smoke test** — `$E2E/unit/harness.js`:

```js
window.__tests = [];
window.test = (name, fn) => window.__tests.push({ name, fn });
window.assert = (cond, msg) => { if (!cond) throw new Error(msg || 'assert'); };
window.assertEq = (a, b, msg) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg || 'eq'}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };
window.tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
window.runTests = async () => {
  const details = []; let pass = 0; let fail = 0;
  for (const t of window.__tests) {
    try { await t.fn(); pass += 1; details.push(`✓ ${t.name}`); } catch (e) { fail += 1; details.push(`✗ ${t.name}: ${e.message}`); }
  }
  window.__result = { pass, fail, details };
};
```

`$E2E/unit/smoke.test.html`:

```html
<!doctype html><meta charset="utf-8"><script src="/__unit/harness.js"></script>
<script>test('harness funciona', () => assertEq(1 + 1, 2)); runTests();</script>
```

- [ ] **Step 5: Correr** `node $E2E/unit-run.js smoke` → Expected: `PASS smoke.test.html · 1 ok, 0 fallas`.

- [ ] **Step 6: Escenarios por módulo en `ui-check.js`.** Agregar un registro `SCENARIOS` (nombre → `async (page, shot, step)`) que abra el modal del módulo y recorra sus vistas internas sin guardar: producción (lista, abrir editor de una receta y cancelar, historial, salida de productos), inventario (lista, abrir un ingrediente, abrir editor de ingreso y cancelar), recetas (lista, abrir editor), ingredientes (lista, abrir alta y cancelar), usuarios (lista), informes (abrir "nuevo informe"), análisis (abrir "nuevo análisis"). Cada paso: `click` por texto visible (`page.getByText`/`getByRole`) para que sobreviva a la migración, captura y `Escape`. Los escenarios se seleccionan con `--only`. Además, correr la matriz con `--theme dark` y `--mobile`.

- [ ] **Step 7: Capturar línea base Bootstrap** de la matriz completa: `baseline-desktop`, `baseline-mobile` (claro). Expected: 0 `pageerror`, 0 escrituras.

---

### Task 2: Vendorizar Shoelace y versionado de assets

**Files:**
- Create: `vendor/shoelace/**` (copiado de `$E2E/node_modules/@shoelace-style/shoelace/cdn`, sin `react/`, sin `*.d.ts`, sin `custom-elements.json`)
- Modify: `tools/stamp-assets.js` (regex de assets locales)

**Interfaces:**
- Produces: `./vendor/shoelace/themes/light.css`, `./vendor/shoelace/themes/dark.css`, `./vendor/shoelace/shoelace-autoloader.js`, `./vendor/shoelace/assets/icons/*.svg`.

- [ ] **Step 1: Test** — `$E2E/unit/vendor.test.html` carga el autoloader local y verifica que `sl-button` se define y que el ícono `x-lg` resuelve:

```html
<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="/vendor/shoelace/themes/light.css">
<script src="/__unit/harness.js"></script>
<script type="module">
  import { setBasePath } from '/vendor/shoelace/utilities/base-path.js';
  setBasePath('/vendor/shoelace');
  await import('/vendor/shoelace/shoelace-autoloader.js');
  document.body.innerHTML = '<sl-button>Hola</sl-button><sl-icon name="x-lg"></sl-icon>';
  test('sl-button se define', async () => { await customElements.whenDefined('sl-button'); assert(customElements.get('sl-button')); });
  test('ícono local carga', async () => { const r = await fetch('/vendor/shoelace/assets/icons/x-lg.svg'); assertEq(r.status, 200); });
  runTests();
</script>
```

- [ ] **Step 2:** `node $E2E/unit-run.js vendor` → FAIL (404).
- [ ] **Step 3: Copiar el build**

```bash
SRC="$E2E/node_modules/@shoelace-style/shoelace/cdn"; DST=C:/Users/Lucas/Documents/GitHub/La-Jamonera/vendor/shoelace
mkdir -p "$DST" && cp -r "$SRC"/. "$DST"/ && rm -rf "$DST/react" && find "$DST" -name "*.d.ts" -delete && rm -f "$DST/custom-elements.json"
```

- [ ] **Step 4:** `node $E2E/unit-run.js vendor` → PASS.
- [ ] **Step 5: stamp-assets** — en `tools/stamp-assets.js` cambiar la expresión de assets locales para incluir `vendor`:

```js
// antes: /(\s(?:src|href)=")(\.\/(?:JS|CSS)\/[^"?]+)(\?[^"]*)?(")/g
const ASSET_RE = /(\s(?:src|href)=")(\.\/(?:JS|CSS|vendor)\/[^"?]+)(\?[^"]*)?(")/g;
```

Verificar con `node tools/stamp-assets.js --check` (sigue pasando: aún no hay refs a vendor).
- [ ] **Step 6: Commit** `git add vendor tools/stamp-assets.js && git commit -m "Vendorizar Shoelace 2.20.1 y versionar ./vendor"`

---

### Task 3: Partir `style.css` por módulo (sin cambio visual)

**Files:**
- Create: `CSS/base.css` (secciones generales: config, spinner overlay, layout, topbar, home, footer, componentes iOS, responsive general), `CSS/modules/login.css`, `ingredientes.css`, `informes.css`, `recetas.css`, `inventario.css`, `produccion.css`, `planilla.css`, `trazabilidad.css`, `reparto.css`, `usuarios.css` (cortes en los encabezados de sección de style.css: LOGIN L622, MODAL L726, INFORMES L2018, RECETAS L3252, INVENTARIO L4744, PRODUCCIÓN L6506, PLANILLA L12346, TRAZABILIDAD L13276, REPARTOS XLSX L14172, USERS L14649; verificar línea exacta con `grep -n "^/\* =" CSS/style.css` antes de cortar)
- Modify: los 6 HTML: reemplazar `<link ... style.css>` por la lista de archivos **en el mismo orden** en que estaban las secciones.
- Delete: `CSS/style.css` (al final del task)

- [ ] **Step 1:** Script de corte (Node) que lee `style.css`, corta por los encabezados de sección listados y escribe cada archivo; concatenar todos en orden debe dar exactamente el archivo original: `diff <(cat CSS/base.css CSS/modules/...) CSS/style.css` sin diferencias (el script lo verifica y aborta si no).
- [ ] **Step 2:** Actualizar `<link>` en los HTML (mismo orden). `planilla_produccion.js` abre ventanas de impresión que cargan `./CSS/style.css` (líneas ~936-941): pasar a cargar `./CSS/base.css` + `./CSS/modules/planilla.css` + `./CSS/modules/trazabilidad.css`.
- [ ] **Step 3:** `ui-check` matriz claro escritorio + móvil → comparar capturas contra `baseline-*` (deben ser iguales a ojo; 0 errores).
- [ ] **Step 4: Commit** "Partir style.css por módulo sin cambios visuales".

---

### Task 4: Tema, utilidades y capa de formularios

**Files:**
- Create: `CSS/theme.css`, `CSS/utilities.css`, `JS/ui/theme.js`, `JS/ui/forms.js`
- Test: `$E2E/unit/theme.test.html`, `$E2E/unit/forms.test.html`

**Interfaces:**
- Produces (globales en `window`):
  - `LJTheme.get(): 'light'|'dark'`, `LJTheme.set(mode, {persist=true})`, `LJTheme.toggle()`, `LJTheme.syncFromUser(uid): Promise<void>`, `LJTheme.mountToggle(container: Element)`; evento `lj-theme-change` en `document` con `detail.mode`.
  - `ljReady(root=document): Promise<void>` — espera `customElements.whenDefined` de todos los `sl-*` presentes en `root`.
  - `ljOptionValue(raw: string): string` — codifica valor para `sl-option value` (sin espacios).
  - `ljSelectValue(el): string|string[]` — lee `sl-select.value` decodificado (o `.value` de cualquier control).
  - `ljSetSelectValue(el, raw)`.
  - `ljNativeInput(el): HTMLInputElement|HTMLTextAreaElement|null` — input interno de `sl-input/sl-textarea` o el propio elemento nativo.
  - `ljFlatpickr(el, opts)` — `flatpickr(ljNativeInput(el) || el, opts)`.
  - Puente automático: todo `sl-change` re-despachado como `change` nativo burbujeante desde el host.

- [ ] **Step 1: Tests de formularios** (`forms.test.html`):

```html
<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="/vendor/shoelace/themes/light.css">
<script src="/__unit/harness.js"></script>
<script src="/JS/ui/forms.js"></script>
<script type="module">
  import { setBasePath } from '/vendor/shoelace/utilities/base-path.js';
  setBasePath('/vendor/shoelace'); await import('/vendor/shoelace/shoelace-autoloader.js');

  test('ljOptionValue/ljSelectValue round-trip con espacios', async () => {
    const raw = 'LAS CAMELIAS S.A';
    document.body.insertAdjacentHTML('beforeend', `<sl-select id="s1" value="${ljOptionValue(raw)}"><sl-option value="${ljOptionValue(raw)}">${raw}</sl-option><sl-option value="${ljOptionValue('ACROS S.R.L.')}">Acros</sl-option></sl-select>`);
    const s = document.getElementById('s1'); await ljReady(document.body); await s.updateComplete;
    assertEq(ljSelectValue(s), raw);
    ljSetSelectValue(s, 'ACROS S.R.L.'); await s.updateComplete; assertEq(ljSelectValue(s), 'ACROS S.R.L.');
  });
  test('ljReady permite leer value apenas renderizado', async () => {
    const box = document.createElement('div'); box.innerHTML = '<sl-input id="i1" value="0407-00015540"></sl-input>'; document.body.append(box);
    await ljReady(box); assertEq(document.getElementById('i1').value, '0407-00015540');
  });
  test('puente: change delegado en contenedor dispara con sl-checkbox', async () => {
    const box = document.createElement('div'); box.innerHTML = '<sl-checkbox id="c1">x</sl-checkbox>'; document.body.append(box);
    await ljReady(box); let got = null; box.addEventListener('change', (e) => { got = e.target.id; });
    document.getElementById('c1').click(); await tick(50); assertEq(got, 'c1');
  });
  test('puente: change en sl-select', async () => {
    const s = document.getElementById('s1'); let n = 0; s.addEventListener('change', () => { n += 1; });
    s.dispatchEvent(new CustomEvent('sl-change', { bubbles: true, composed: true })); await tick(10); assertEq(n, 1);
  });
  test('ljNativeInput devuelve el input interno', async () => { const el = document.getElementById('i1'); assertEq(ljNativeInput(el).tagName, 'INPUT'); });
  runTests();
</script>
```

- [ ] **Step 2:** `node $E2E/unit-run.js forms` → FAIL (`ljOptionValue is not defined`).
- [ ] **Step 3: Implementar `JS/ui/forms.js`**

```js
(function ljForms() {
  // sl-change no sale como 'change' nativo: lo re-despachamos para que los listeners existentes sigan andando.
  document.addEventListener('sl-change', (event) => {
    const host = event.target;
    if (!host || !host.tagName || !host.tagName.startsWith('SL-')) return;
    if (!['SL-INPUT', 'SL-SELECT', 'SL-TEXTAREA', 'SL-CHECKBOX', 'SL-SWITCH', 'SL-RADIO-GROUP', 'SL-RANGE', 'SL-RATING', 'SL-COLOR-PICKER'].includes(host.tagName)) return;
    host.dispatchEvent(new Event('change', { bubbles: true }));
  }, true);

  const ENC = '~';
  window.ljOptionValue = (raw) => encodeURIComponent(String(raw ?? '')).replace(/%20/g, ENC + '20').replace(/%/g, ENC);
  const decode = (v) => decodeURIComponent(String(v ?? '').replace(new RegExp(ENC, 'g'), '%'));
  window.ljSelectValue = (el) => {
    if (!el) return '';
    const v = el.value;
    if (el.tagName === 'SL-SELECT') return Array.isArray(v) ? v.map(decode) : decode(v);
    return v;
  };
  window.ljSetSelectValue = (el, raw) => {
    if (!el) return;
    el.value = el.tagName === 'SL-SELECT' ? (Array.isArray(raw) ? raw.map(window.ljOptionValue) : window.ljOptionValue(raw)) : raw;
  };
  window.ljReady = async (root = document) => {
    const tags = new Set([...(root.querySelectorAll ? root.querySelectorAll('*') : [])].map((n) => n.localName).filter((t) => t.startsWith('sl-')));
    await Promise.all([...tags].map((t) => customElements.whenDefined(t)));
    await Promise.all([...root.querySelectorAll([...tags].join(',') || 'sl-none')].map((n) => n.updateComplete));
  };
  window.ljNativeInput = (el) => {
    if (!el) return null;
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return el;
    return el.input || el.shadowRoot?.querySelector('input,textarea') || null;
  };
  window.ljFlatpickr = (el, opts) => window.flatpickr(window.ljNativeInput(el) || el, opts);
})();
```

Nota de codificación: `ljOptionValue('A B') === 'A~20B'`, `ljOptionValue('100%') === '100~25'`; sin espacios ni `%`.

- [ ] **Step 4:** `node $E2E/unit-run.js forms` → PASS.
- [ ] **Step 5: Test de tema** (`theme.test.html`): con `localStorage['lj-theme']='dark'` y el snippet de head aplicado, `<html>` tiene `sl-theme-dark`; `LJTheme.toggle()` cambia a claro, emite `lj-theme-change`, guarda en localStorage; `LJTheme.syncFromUser('u1')` con un `window.dbLaJamonera` simulado (`ref(path).once('value')` → `{val:()=>'dark'}`, `ref(path).set(v)` registra) aplica `dark`; `set('light')` escribe en `/userPreferences/u1/theme`.
- [ ] **Step 6:** FAIL → implementar `JS/ui/theme.js`:

```js
(function ljTheme() {
  const KEY = 'lj-theme';
  const root = document.documentElement;
  let uid = '';
  const read = () => { try { return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light'; } catch (_) { return 'light'; } };
  const apply = (mode) => {
    const dark = mode === 'dark' && !root.hasAttribute('data-lj-force-light');
    root.classList.toggle('sl-theme-dark', dark);
    root.classList.toggle('sl-theme-light', !dark);
    document.dispatchEvent(new CustomEvent('lj-theme-change', { detail: { mode: dark ? 'dark' : 'light' } }));
    document.querySelectorAll('[data-lj-theme-toggle]').forEach((b) => { b.name = dark ? 'sun' : 'moon'; b.label = dark ? 'Modo claro' : 'Modo oscuro'; });
  };
  const db = () => window.dbLaJamonera || (window.firebase?.apps?.length ? window.firebase.app('laJamonera').database() : null);
  window.LJTheme = {
    get: () => (root.classList.contains('sl-theme-dark') ? 'dark' : 'light'),
    set(mode, { persist = true } = {}) {
      const m = mode === 'dark' ? 'dark' : 'light';
      try { localStorage.setItem(KEY, m); } catch (_) {}
      apply(m);
      if (persist && uid && db()) db().ref(`/userPreferences/${uid}/theme`).set(m).catch(() => {});
    },
    toggle() { this.set(this.get() === 'dark' ? 'light' : 'dark'); },
    async syncFromUser(userId) {
      uid = userId || '';
      if (!uid || !db()) return;
      try {
        const snap = await db().ref(`/userPreferences/${uid}/theme`).once('value');
        const remote = snap.val();
        if (remote === 'dark' || remote === 'light') this.set(remote, { persist: false });
      } catch (_) {}
    },
    mountToggle(container) {
      if (!container) return;
      const b = document.createElement('sl-icon-button');
      b.setAttribute('data-lj-theme-toggle', '');
      b.className = 'lj-theme-toggle';
      b.addEventListener('click', () => this.toggle());
      container.append(b);
      apply(this.get());
    }
  };
  apply(read());
  const auth = () => window.authLaJamonera || (window.firebase?.apps?.length ? window.firebase.app('laJamonera').auth() : null);
  const hook = () => { const a = auth(); if (!a) return false; a.onAuthStateChanged((u) => { if (u) window.LJTheme.syncFromUser(u.uid); }); return true; };
  if (!hook()) window.addEventListener('load', hook, { once: true });
})();
```

Snippet inline obligatorio al inicio del `<head>` de cada página (antes de CSS):

```html
<script>try{if(localStorage.getItem('lj-theme')==='dark')document.documentElement.classList.add('sl-theme-dark')}catch(e){}</script>
```

(En `produccion_publica.html`: `<html lang="es" data-lj-force-light>` y sin snippet.)

- [ ] **Step 7:** PASS → **`CSS/theme.css`** (tokens + mapeo Shoelace + base):

```css
:root, .sl-theme-light {
  --lj-bg: #f6f8fc; --lj-surface: #ffffff; --lj-surface-2: #f2f5fb; --lj-border: #dfe5f0; --lj-border-strong: #cfd8e8;
  --lj-text: #1f2a44; --lj-muted: #55607f; --lj-brand: #173d73; --lj-accent: #1f5fbf; --lj-accent-soft: #eef3fc;
  --lj-success: #1f7a4c; --lj-success-soft: #e3f5ec; --lj-warning: #9a6200; --lj-warning-soft: #fff3dd;
  --lj-danger: #b42338; --lj-danger-soft: #ffecef; --lj-overlay: rgba(23, 34, 58, .35); --lj-shadow: 0 1px 2px rgba(23, 34, 58, .06);
  --lj-radius: 5px; --lj-radius-lg: 6px;
}
.sl-theme-dark {
  --lj-bg: #0f1522; --lj-surface: #161e2e; --lj-surface-2: #1c2638; --lj-border: #26324a; --lj-border-strong: #334262;
  --lj-text: #e3e9f5; --lj-muted: #93a0bb; --lj-brand: #cddcff; --lj-accent: #6ea0ff; --lj-accent-soft: #16233d;
  --lj-success: #5fd39a; --lj-success-soft: #12301f; --lj-warning: #f2b75a; --lj-warning-soft: #33260f;
  --lj-danger: #ff8a9a; --lj-danger-soft: #3a1820; --lj-overlay: rgba(0, 0, 0, .55); --lj-shadow: none;
}
:root {
  --sl-font-sans: Inter, "Segoe UI", Arial, sans-serif;
  --sl-input-height-small: 30px; --sl-input-height-medium: 36px; --sl-input-height-large: 44px;
  --sl-input-font-size-medium: 13px; --sl-button-font-size-medium: 13px; --sl-input-spacing-medium: 10px;
  --sl-border-radius-small: 4px; --sl-border-radius-medium: 5px; --sl-border-radius-large: 6px; --sl-border-radius-x-large: 6px;
  --sl-color-primary-50: #eef3fc; --sl-color-primary-100: #dce7f8; --sl-color-primary-200: #b9cff1; --sl-color-primary-300: #8fb1e6;
  --sl-color-primary-400: #5f8fd9; --sl-color-primary-500: #2f6fd0; --sl-color-primary-600: #1f5fbf; --sl-color-primary-700: #174c9c;
  --sl-color-primary-800: #133f80; --sl-color-primary-900: #0f3266; --sl-color-primary-950: #0a2147;
  --sl-input-border-color: var(--lj-border-strong); --sl-input-focus-ring-color: rgba(31, 95, 191, .25);
  --sl-panel-border-color: var(--lj-border); --sl-z-index-dialog: 1000; --sl-z-index-toast: 1100;
}
.sl-theme-dark {
  --sl-color-primary-50: #16233d; --sl-color-primary-100: #1d2f52; --sl-color-primary-500: #6ea0ff; --sl-color-primary-600: #4d86f0; --sl-color-primary-700: #3a6fd6;
  --sl-input-background-color: #111827; --sl-input-background-color-hover: #131c2d; --sl-input-background-color-focus: #131c2d;
  --sl-input-border-color: var(--lj-border-strong); --sl-input-color: var(--lj-text); --sl-input-placeholder-color: #6f7c97;
  --sl-input-focus-ring-color: rgba(110, 160, 255, .3); --sl-panel-background-color: var(--lj-surface);
}
html, body { background: var(--lj-bg); color: var(--lj-text); }
body { font-family: var(--sl-font-sans); font-size: 14px; }
/* Input nativo con look de sl-input (flatpickr, color, etc.) */
.lj-input { height: var(--sl-input-height-medium); padding: 0 var(--sl-input-spacing-medium); font: inherit; font-size: var(--sl-input-font-size-medium);
  color: var(--lj-text); background: var(--sl-input-background-color, var(--lj-surface)); border: 1px solid var(--lj-border-strong);
  border-radius: var(--sl-border-radius-medium); width: 100%; outline: none; }
.lj-input:focus { border-color: var(--sl-color-primary-600); box-shadow: 0 0 0 3px var(--sl-input-focus-ring-color); }
.lj-input::placeholder { color: var(--sl-input-placeholder-color, var(--lj-muted)); }
/* Superficies y tablas */
.lj-surface { background: var(--lj-surface); border: 1px solid var(--lj-border); border-radius: var(--lj-radius-lg); }
.table { width: 100%; border-collapse: collapse; font-size: 13px; color: var(--lj-text); }
.table th { text-align: left; padding: 8px; color: var(--lj-muted); font-weight: 600; background: var(--lj-surface-2); border-bottom: 1px solid var(--lj-border); }
.table td { padding: 8px; border-top: 1px solid var(--lj-border); vertical-align: middle; }
.table-responsive { overflow-x: auto; -webkit-overflow-scrolling: touch; }
/* Tiles: botones compuestos (tarjetas del inicio, grupos de recetas) */
.lj-tile { font: inherit; color: inherit; background: var(--lj-surface); border: 1px solid var(--lj-border); border-radius: var(--lj-radius-lg); cursor: pointer; }
.lj-tile:hover { border-color: var(--lj-border-strong); }
.lj-tile:focus-visible { outline: 2px solid var(--lj-accent); outline-offset: 2px; }
/* Diálogos */
sl-dialog::part(panel) { border: 1px solid var(--lj-border); border-radius: var(--lj-radius-lg); background: var(--lj-surface); box-shadow: 0 12px 32px rgba(0, 0, 0, .18); }
sl-dialog::part(overlay) { background: var(--lj-overlay); }
sl-dialog::part(header) { border-bottom: 1px solid var(--lj-border); }
sl-dialog::part(title) { font-size: 16px; font-weight: 700; color: var(--lj-brand); padding: 14px 16px; }
sl-dialog::part(body) { padding: 16px; }
sl-dialog::part(footer) { border-top: 1px solid var(--lj-border); padding: 12px 16px; }
sl-dialog.lj-modal { --width: min(1140px, 96vw); }
@media (max-width: 767.98px) { sl-dialog.lj-modal { --width: 100vw; } sl-dialog.lj-modal::part(panel) { max-height: 100dvh; height: 100dvh; border-radius: 0; } }
/* flatpickr con tema */
.flatpickr-calendar { background: var(--lj-surface); border: 1px solid var(--lj-border); border-radius: var(--lj-radius-lg); box-shadow: 0 8px 24px rgba(0,0,0,.15); color: var(--lj-text); }
.flatpickr-day { color: var(--lj-text); border-radius: 4px; }
.flatpickr-day.selected, .flatpickr-day.startRange, .flatpickr-day.endRange { background: var(--lj-accent); border-color: var(--lj-accent); color: #fff; }
.flatpickr-day.inRange { background: var(--lj-accent-soft); border-color: var(--lj-accent-soft); box-shadow: none; }
.flatpickr-months .flatpickr-month, .flatpickr-weekdays, span.flatpickr-weekday, .flatpickr-current-month input.cur-year { color: var(--lj-text); fill: var(--lj-text); background: transparent; }
.sl-theme-dark .flatpickr-day.flatpickr-disabled { color: #4a5671; }
```

- [ ] **Step 8: `CSS/utilities.css`**

```css
.d-none { display: none !important; } .d-block { display: block !important; } .d-flex { display: flex !important; } .d-inline-flex { display: inline-flex !important; }
.flex-wrap { flex-wrap: wrap !important; } .flex-column { flex-direction: column !important; } .flex-grow-1 { flex-grow: 1 !important; }
.align-items-center { align-items: center !important; } .align-items-start { align-items: flex-start !important; } .align-items-end { align-items: flex-end !important; }
.justify-content-between { justify-content: space-between !important; } .justify-content-center { justify-content: center !important; } .justify-content-end { justify-content: flex-end !important; } .justify-content-start { justify-content: flex-start !important; }
.gap-1 { gap: 4px !important; } .gap-2 { gap: 8px !important; } .gap-3 { gap: 16px !important; }
.w-100 { width: 100% !important; } .text-start { text-align: left !important; } .text-center { text-align: center !important; } .text-end { text-align: right !important; }
.text-muted { color: var(--lj-muted) !important; } .text-danger { color: var(--lj-danger) !important; } .text-warning { color: var(--lj-warning) !important; } .text-dark { color: var(--lj-text) !important; }
.bg-transparent { background: transparent !important; } .bg-light { background: var(--lj-surface-2) !important; } .bg-warning { background: var(--lj-warning-soft) !important; } .border-0 { border: 0 !important; } .shadow { box-shadow: var(--lj-shadow) !important; }
.visually-hidden { position: absolute !important; width: 1px !important; height: 1px !important; padding: 0 !important; margin: -1px !important; overflow: hidden !important; clip: rect(0,0,0,0) !important; white-space: nowrap !important; border: 0 !important; }
.container-fluid { width: 100%; padding-left: 12px; padding-right: 12px; margin: 0 auto; }
.rounded-pill { border-radius: 999px !important; }
.m-0 { margin: 0 !important; } .mt-1 { margin-top: 4px !important; } .mt-2 { margin-top: 8px !important; } .mt-3 { margin-top: 16px !important; } .mt-4 { margin-top: 24px !important; }
.mb-0 { margin-bottom: 0 !important; } .mb-1 { margin-bottom: 4px !important; } .mb-2 { margin-bottom: 8px !important; } .mb-3 { margin-bottom: 16px !important; }
.me-1 { margin-right: 4px !important; } .me-2 { margin-right: 8px !important; } .ms-1 { margin-left: 4px !important; } .ms-2 { margin-left: 8px !important; } .mx-3 { margin-left: 16px !important; margin-right: 16px !important; }
.p-0 { padding: 0 !important; } .px-0 { padding-left: 0 !important; padding-right: 0 !important; } .px-2 { padding-left: 8px !important; padding-right: 8px !important; } .py-2 { padding-top: 8px !important; padding-bottom: 8px !important; } .py-3 { padding-top: 16px !important; padding-bottom: 16px !important; }
```

- [ ] **Step 9:** Run `node $E2E/unit-run.js` → todos PASS. **Commit** "Agregar tema, utilidades y capa de formularios Shoelace".

---

### Task 5: Modales (`LJModal`)

**Files:**
- Create: `JS/ui/modal.js`; Test: `$E2E/unit/modal.test.html`

**Interfaces:**
- Consumes: Shoelace `sl-dialog` (`open`, `show()`, `hide()`, eventos `sl-show/sl-after-show/sl-hide/sl-after-hide/sl-request-close`).
- Produces: `LJModal.open(idOrEl)`, `LJModal.close(idOrEl)`, `LJModal.get(idOrEl): SlDialog`, `LJModal.isOpen(idOrEl): boolean`, `LJModal.onceClosed(idOrEl): Promise<void>`, `LJModal.body(idOrEl): HTMLElement` (= `.lj-dialog-body` dentro del dialog), `LJModal.topOpen(): SlDialog|null`. Activadores: clic en `[data-lj-open="#id"]` abre; `[data-lj-close]` dentro del dialog cierra. Los dialogs con atributo `data-lj-keep-open-on-overlay` (default para todos los `.lj-modal`) ignoran el clic en overlay (`sl-request-close` con `detail.source === 'overlay'` → `preventDefault()`).
- Markup estándar de modal:

```html
<sl-dialog id="produccionModal" class="lj-modal" label="Producción">
  <div slot="label" class="lj-dialog-title">…título + badges…</div>
  <div class="lj-dialog-body">…contenido que antes iba en .modal-body…</div>
</sl-dialog>
```

`sl-dialog::part(body)` sin padding y sin scroll propio; el scroll lo hace `.lj-dialog-body` (`max-height: calc(100dvh - 120px); overflow:auto; padding:16px`), para que el código que preserva el scroll siga apuntando a un elemento propio.

- [ ] **Step 1: Test** — abre por `data-lj-open`, eventos en orden `sl-show→sl-after-show`, filtro de target (un `sl-dropdown` hijo que emite `sl-show` no debe confundirse: helper `LJModal.on(id, 'show'|'shown'|'hide'|'hidden', fn)` sólo llama a `fn` si `event.target === dialog`), overlay no cierra, Escape cierra, dos modales apilados: cerrar el de arriba deja el de abajo abierto.
- [ ] **Step 2:** FAIL → implementar:

```js
(function ljModal() {
  const resolve = (x) => (typeof x === 'string' ? document.getElementById(x.replace(/^#/, '')) : x);
  const MAP = { show: 'sl-show', shown: 'sl-after-show', hide: 'sl-hide', hidden: 'sl-after-hide' };
  window.LJModal = {
    get: resolve,
    open(x) { const d = resolve(x); if (d && !d.open) d.show(); return d; },
    close(x) { const d = resolve(x); if (d && d.open) d.hide(); return d; },
    isOpen(x) { return Boolean(resolve(x)?.open); },
    body(x) { const d = resolve(x); return d?.querySelector(':scope > .lj-dialog-body') || d; },
    on(x, kind, fn, opts) {
      const d = resolve(x); if (!d) return () => {};
      const handler = (event) => { if (event.target === d) fn(event); };
      d.addEventListener(MAP[kind] || kind, handler, opts);
      return () => d.removeEventListener(MAP[kind] || kind, handler, opts);
    },
    onceClosed(x) { const d = resolve(x); return new Promise((r) => { if (!d?.open) return r(); this.on(d, 'hidden', () => r(), { once: true }); }); },
    topOpen() { const all = [...document.querySelectorAll('sl-dialog[open]')]; return all[all.length - 1] || null; }
  };
  document.addEventListener('click', (event) => {
    const opener = event.target.closest?.('[data-lj-open]');
    if (opener) { event.preventDefault(); window.LJModal.open(opener.getAttribute('data-lj-open')); return; }
    const closer = event.target.closest?.('[data-lj-close]');
    if (closer) { const d = closer.closest('sl-dialog'); if (d) d.hide(); }
  });
  document.addEventListener('sl-request-close', (event) => {
    const d = event.target;
    if (d?.tagName === 'SL-DIALOG' && d.classList.contains('lj-modal') && event.detail?.source === 'overlay') event.preventDefault();
  });
})();
```

Nota: `LJModal.on(id, 'shown', fn, {once:true})` con `once` removería el listener aunque el target no coincida; por eso `onceClosed` se basa en `on` + `once` sólo para el propio dialog (los hijos no emiten `sl-after-hide` del dialog… pero sí `sl-after-hide` de dropdowns) → implementar `once` manualmente dentro del handler: si `opts?.once`, remover sólo cuando `event.target === d`. Ajustar el código: `const handler = (event) => { if (event.target !== d) return; if (opts?.once) d.removeEventListener(type, handler); fn(event); }` y llamar `addEventListener(type, handler)` sin `opts`.

- [ ] **Step 3:** PASS → **Commit** "Agregar LJModal sobre sl-dialog".

---

### Task 6: Alertas (`Swal`/`LJAlert` sobre Shoelace)

**Files:**
- Create: `JS/ui/lj-alert.js`; Test: `$E2E/unit/alert.test.html`

**Interfaces:**
- Produces: `window.Swal` y `window.LJAlert` con `fire(opts) → Promise<{isConfirmed,isDenied,isDismissed,value,dismiss}>`, `close(result?)`, `isVisible()`, `getPopup()` (el `.lj-alert` interno), `getHtmlContainer()`, `getTitle()`, `getConfirmButton()`, `getDenyButton()`, `getCancelButton()`, `getInput()`, `showValidationMessage(msg)`, `resetValidationMessage()`, `showLoading()`, `hideLoading()`, `isLoading()`, `clickConfirm()`, `clickDeny()`, `clickCancel()`, `update(opts)`, `mixin(defaults)`; `DismissReason = {cancel:'cancel', backdrop:'backdrop', close:'close', esc:'esc', timer:'timer'}`.
- Opciones soportadas: ver spec §5.2 y apéndice B. `customClass.popup` → clases en el wrapper `.lj-alert` (light DOM, para que el CSS existente tipo `.produccion-confirm-alert .pc-…` siga aplicando); `customClass.confirmButton/denyButton/cancelButton` → variante del `sl-button` por palabra clave (`success|danger|warning|primary|secondary|default`; `deny-critical`→danger; default confirm=primary, deny=warning, cancel=default); `target` se ignora (siempre `document.body`, top-layer por orden); `returnFocus`, `buttonsStyling`, `scrollbarPadding`, `scrollBehavior`, `focusConfirm` se ignoran.

Estructura renderizada:

```html
<sl-dialog class="lj-alert-dialog" no-header label="…título…">
  <div class="lj-alert {customClass.popup}">
    <div class="lj-alert-icon is-{icon}"><sl-icon name="…"></sl-icon></div>
    <h2 class="lj-alert-title {customClass.title}">…</h2>
    <div class="lj-alert-html {customClass.htmlContainer}">…html…</div>
    <sl-input class="swal2-input lj-alert-input" …></sl-input>   <!-- sólo si opts.input -->
    <div class="lj-alert-validation" hidden></div>
    <div class="lj-alert-actions">[cancel] [deny] [confirm] (reverseButtons invierte)</div>
  </div>
</sl-dialog>
```

Íconos: success→`check-circle`, error→`x-circle`, warning→`exclamation-triangle`, info→`info-circle`, question→`question-circle`. Ancho: `width` numérico→px; string→tal cual; default `32rem`.

Comportamiento:
- Una alerta a la vez (como SweetAlert): `fire` con otra abierta la cierra resolviendo `{isDismissed:true, dismiss:'close'}` y abre la nueva.
- Orden de hooks: `willOpen(popup)` antes de `show()`, `didRender(popup)` + `didOpen(popup)` tras `sl-after-show`; `willClose(popup)` al iniciar cierre; `didClose()` tras `sl-after-hide`; el elemento se remueve del DOM al final.
- Confirmar: si hay `preConfirm`, `showLoading()`, `await preConfirm(inputValue)`; si devuelve `false` o hay mensaje de validación visible → `hideLoading()`, no cerrar; si tira error → `showValidationMessage(error.message)`, no cerrar; si no, cerrar con `{isConfirmed:true, value: retorno ?? inputValue ?? true}`. Igual `preDeny` para deny (`value:false` por defecto).
- `allowOutsideClick:false` → bloquea `sl-request-close` source `overlay`; `allowEscapeKey:false` → bloquea `keyboard`. Por defecto ambos permitidos.
- `close()` sin args → `{isDismissed:true, dismiss:'close'}`; overlay → `'backdrop'`; Escape → `'esc'`; botón cancelar → `'cancel'`; timer → `'timer'`.
- `showValidationMessage(m)` muestra `.lj-alert-validation` con `role=alert`; `isVisible()` true mientras el dialog esté abierto o abriéndose.
- `update(opts)` re-renderiza title/html/textos de botones sin cerrar.

- [ ] **Step 1: Tests** (`alert.test.html`): (a) confirm resuelve `isConfirmed`; (b) cancel → `isDismissed` + `dismiss:'cancel'`; (c) deny; (d) `preConfirm` false no cierra; (e) `preConfirm` con `showValidationMessage` muestra texto y no cierra, al corregir y confirmar cierra con valor; (f) `preConfirm` async que tira → mensaje, sigue abierta; (g) `didOpen` recibe popup con el html dentro y `getElementById` encuentra un `sl-input` del html; (h) `allowOutsideClick:false` ignora overlay; (i) con un `sl-dialog.lj-modal` abierto debajo, `fire` abre arriba, Escape cierra sólo la alerta y el modal sigue `open`; (j) `customClass.popup:'produccion-confirm-alert'` presente en `.lj-alert`; (k) `input:'password'` devuelve `result.value` y `document.querySelector('.swal2-input')` encuentra el control; (l) `Swal.close()` resuelve la promesa abierta; (m) `fire` estando otra abierta la reemplaza.
- [ ] **Step 2:** FAIL → **Step 3: implementar `JS/ui/lj-alert.js`** según la interfaz y comportamiento de arriba (≈300 líneas, sin dependencias salvo Shoelace). Puntos de implementación obligatorios:

```js
(function ljAlert() {
  const ICONS = { success: 'check-circle', error: 'x-circle', warning: 'exclamation-triangle', info: 'info-circle', question: 'question-circle' };
  const DismissReason = { cancel: 'cancel', backdrop: 'backdrop', close: 'close', esc: 'esc', timer: 'timer' };
  const variantFrom = (cls, fallback) => {
    const c = String(cls || '');
    if (/deny-critical|danger/.test(c)) return 'danger';
    if (/success/.test(c)) return 'success';
    if (/warning/.test(c)) return 'warning';
    if (/primary/.test(c)) return 'primary';
    if (/secondary|default|light/.test(c)) return 'default';
    return fallback;
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  let current = null; // { dialog, popup, opts, resolve, loading }
  // render(opts) arma el sl-dialog descripto en el plan; finish(result) cierra y resuelve una sola vez;
  // onConfirm/onDeny aplican preConfirm/preDeny; listeners de sl-request-close aplican allowOutsideClick/allowEscapeKey.
  // ... (implementación completa en el archivo; ver tests a–m)
  window.LJAlert = window.Swal = { fire, close, isVisible, getPopup, getHtmlContainer, getTitle, getConfirmButton, getDenyButton, getCancelButton, getInput,
    showValidationMessage, resetValidationMessage, showLoading, hideLoading, isLoading, clickConfirm, clickDeny, clickCancel, update, mixin, DismissReason };
})();
```

(El esqueleto anterior fija nombres; la implementación completa se escribe en el archivo y se valida con los 13 tests.)

- [ ] **Step 4:** Estilos en `CSS/theme.css` (sección "Alertas"): `.lj-alert{display:grid;gap:12px;text-align:center}`, `.lj-alert-icon` 44 px con color por estado (success `--lj-success`, error/danger `--lj-danger`, warning `--lj-warning`, info/question `--lj-accent`), `.lj-alert-title{font-size:18px;font-weight:700;color:var(--lj-brand)}`, `.lj-alert-html{text-align:left;color:var(--lj-text)}`, `.lj-alert-actions{display:flex;justify-content:center;gap:8px;flex-wrap:wrap}`, `.lj-alert-validation{background:var(--lj-danger-soft);color:var(--lj-danger);padding:8px 10px;border-radius:var(--lj-radius);text-align:left}`; `sl-dialog.lj-alert-dialog{--width:32rem}`; en < 576 px botones `width:100%`.
- [ ] **Step 5:** `node $E2E/unit-run.js alert` → 13 PASS. **Commit** "Agregar LJAlert compatible con la API de SweetAlert usada".

---

### Task 7: Encabezado, páginas y modales estáticos

**Files:**
- Create: `JS/ui/header.js`, `JS/image-guard.js`
- Modify: `index.html`, `informes.html`, `analisis.html`, `login.html`, `firebase_optimizador.html`, `produccion_publica.html`, `JS/swal-a11y-guard.js` (se elimina tras extraer `image-guard.js`), `CSS/base.css` (topbar/home), `CSS/modules/login.css`

**Interfaces:**
- Consumes: Task 4 (`theme.js`, `forms.js`), Task 5 (`modal.js`), Task 6 (`lj-alert.js`).
- Produces: orden de carga estándar en `<head>` de cada página:

```html
<script>try{if(localStorage.getItem('lj-theme')==='dark')document.documentElement.classList.add('sl-theme-dark')}catch(e){}</script>
<link rel="stylesheet" href="./vendor/shoelace/themes/light.css?v=">
<link rel="stylesheet" href="./vendor/shoelace/themes/dark.css?v=">
<link rel="stylesheet" href="./CSS/theme.css?v="> <link rel="stylesheet" href="./CSS/utilities.css?v=">
<link rel="stylesheet" href="./CSS/base.css?v="> <!-- + módulos que usa la página -->
<script type="module">import { setBasePath } from './vendor/shoelace/utilities/base-path.js'; setBasePath('./vendor/shoelace'); import('./vendor/shoelace/shoelace-autoloader.js');</script>
<script defer src="./JS/ui/forms.js?v="></script> <script defer src="./JS/ui/theme.js?v="></script>
<script defer src="./JS/ui/modal.js?v="></script> <script defer src="./JS/ui/lj-alert.js?v="></script> <script defer src="./JS/ui/header.js?v="></script>
```

(se quitan Bootstrap CSS/JS, bootstrap-icons, sweetalert2 y `swal-a11y-guard.js`; se suma `JS/image-guard.js` donde estaba el guard).
- Encabezado (index/informes/analisis):

```html
<header class="lj-header">
  <a class="lj-header-brand" href="./index.html">…logo + "La Jamonera"…</a>
  <nav class="lj-header-nav"><a href="./index.html" class="is-active">Inicio</a><a href="./informes.html">Informes</a><a href="./analisis.html">Análisis</a></nav>
  <div class="lj-header-actions">
    <!-- campana de notificaciones existente (mismo id) -->
    <span data-lj-theme-slot></span>
    <sl-dropdown placement="bottom-end" class="lj-user-menu"><sl-button slot="trigger" variant="text" caret>…avatar + nombre (mismos ids)…</sl-button>
      <sl-menu><sl-menu-item value="logout">…mismo id/acción de "Cerrar sesión"…</sl-menu-item></sl-menu></sl-dropdown>
    <sl-icon-button class="lj-header-burger" name="list" label="Menú" data-lj-drawer-open></sl-icon-button>
  </div>
</header>
<sl-drawer class="lj-header-drawer" label="Menú" placement="start">…mismos links…</sl-drawer>
```

`header.js`: monta `LJTheme.mountToggle` en `[data-lj-theme-slot]`, abre/cierra el drawer, y re-cablea el "cerrar sesión" existente (buscar en `app.js` el handler actual del menú de usuario y conservar el id del item). CSS en `base.css`: header 56 px, superficie, borde inferior, nav oculta < 992 px y burger visible.
- Modales estáticos: los 11 `.modal` → markup estándar de Task 5 (mismos ids; título y badges del header en `slot="label"`; botón X propio eliminado, lo trae `sl-dialog`). Tarjetas del inicio: `data-bs-toggle/target` → `data-lj-open="#id"` y clase `lj-tile`.
- Login: `#loginForm` con `sl-input id="usernameInput" name="username"`, `sl-input id="passwordInput" type="password" password-toggle`, `sl-button id="loginButton" type="submit" variant="primary"`; se elimina `#togglePassword` y su handler en `login.js` (lo cubre `password-toggle`).

- [ ] **Step 1:** `node $E2E/lint-legacy.js` sobre los 6 HTML → FAIL (lista).
- [ ] **Step 2:** Aplicar cambios de `<head>`, encabezado, modales y login. `image-guard.js` = líneas 211-410 de `swal-a11y-guard.js` tal cual (IIFE `window.LaJamoneraImageGuard`).
- [ ] **Step 3:** lint de los 6 HTML → PASS (0 hits).
- [ ] **Step 4:** `ui-check` (claro/oscuro, desktop/móvil) sólo `index,informes,analisis` → login funciona, modales abren (con contenido todavía sin migrar: puede verse mixto), 0 `pageerror` atribuibles a Bootstrap ausente **salvo** los de JS de módulos aún no migrados (anotar y resolver en sus tasks).
- [ ] **Step 5: Commit** "Migrar páginas, encabezado y modales estáticos a Shoelace".

---

### Tasks 8–16: Migración por módulo

Cada task migra **un archivo JS + su CSS de módulo** aplicando la **Receta R** (abajo). Archivos independientes → pueden ejecutarse en paralelo (agentes distintos) porque no comparten archivos.

| Task | JS | CSS | Escenario `ui-check` |
|---|---|---|---|
| 8 | `JS/ingredientes.js` | `modules/ingredientes.css` | ingredientes |
| 9 | `JS/usuarios.js`, `JS/Notificaciones.js`, `JS/app.js`, `JS/login.js` | `modules/usuarios.css`, `modules/login.css` | usuarios, login |
| 10 | `JS/panelcontrol.js`: **reemplazar Chart.js por ECharts 5** (vendorizar `vendor/echarts/echarts.min.js`, quitar Chart.js de index.html, mismos datos/series/tipos que hoy incl. el selector de tipo de gráfico, colores desde `--lj-*`, `chart.dispose()`+re-init en `lj-theme-change`, `resize` en cambio de tamaño; cargar skill `dataviz` antes de escribir el gráfico) | `CSS/panel.css` | index |
| 11 | `JS/recetas.js` | `modules/recetas.css` | recetas |
| 12 | `JS/inventario.js` | `modules/inventario.css` | inventario |
| 13 | `JS/produccion.js` líneas 1–6000 (core, editor, planes, lotes) | `modules/produccion.css` (secciones editor/lista) | produccion |
| 14 | `JS/produccion.js` líneas 6000–fin (reparto/XLSX, historial, confirmación, eventos de modal) | `modules/reparto.css`, resto de `modules/produccion.css` | produccion (historial, salida de productos) |
| 15 | `JS/Informes.js`, `JS/Analisis.js` | `modules/informes.css` | informes, analisis |
| 16 | `JS/planilla_produccion.js`, `JS/produccion_publica.js`, `JS/firebase-optimizador.js` | `modules/planilla.css`, `modules/trazabilidad.css` | publica |

Tasks 13 y 14 tocan el mismo archivo: **se ejecutan en serie** (13 antes que 14).

**Receta R (aplicar en orden, en cada archivo del task):**

- [ ] **R1 — Test que falla:** `node $E2E/lint-legacy.js <archivos JS del task>` → FAIL (anotar N).
- [ ] **R2 — Eventos de modal:** `el.addEventListener('show.bs.modal', fn)` → `LJModal.on(el, 'show', fn)`; `shown`→`'shown'`, `hide`→`'hide'`, `hidden`→`'hidden'`; `{once:true}` se pasa igual. `bootstrap.Modal.getOrCreateInstance(x).show()` → `LJModal.open(x)`; `.hide()` → `LJModal.close(x)`; `new bootstrap.Modal(x)` → eliminar (usar `LJModal`). Encadenados "cerrar A y abrir B": `LJModal.close(A); await LJModal.onceClosed(A); LJModal.open(B);`.
- [ ] **R3 — DOM de modal:** `.modal.show .modal-content` / `.modal-content` → `LJModal.topOpen()?.querySelector('.lj-dialog-body')` (o `LJModal.body(id)`); `.modal-body` → `.lj-dialog-body`; `modal.classList.contains('show')` → `LJModal.isOpen(modal)`; quitar manejo manual de `inert`, `aria-hidden` y backdrops.
- [ ] **R4 — Wrappers de alertas** (`openIosSwal`, `openSwal`, `openPlanillaSwal`): eliminar `target`, `returnFocus`, `buttonsStyling`, la búsqueda de `.modal.show`, y el `inert` en `willClose`; conservar `customClass` (LJAlert mapea variantes). No cambiar las llamadas.
- [ ] **R5 — Botones:** `<button class="btn ios-btn ios-btn-primary X" id=… data-…>Texto</button>` → `<sl-button variant="primary" class="X" id=… data-…>Texto</sl-button>` (secondary→`default`, success/warning/danger igual, `ios-btn-deny-critical`→`danger`, `btn-link`→`variant="text"`, `btn-sm`/acciones de tabla→`size="small"`). Ícono FA al inicio → `<i slot="prefix" class="fa-…">`. Botones sólo-ícono → `<sl-icon-button name="…" label="…">` (FA: `<sl-button variant="text" size="small" class="lj-icon-btn"><i class="fa-…"></i></sl-button>` para conservar el ícono FA). `disabled` igual. Tiles compuestos (imagen + textos) → `<button class="lj-tile …">`. `type="submit"` se mantiene en `sl-button`.
- [ ] **R6 — Inputs:** `<input class="form-control ios-input" …>` → `<sl-input …>` conservando `id`, `name`, `type` (text/number/email/password/search/tel), `placeholder`, `value`, `min/max/step`, `maxlength`, `readonly`, `disabled`, `required`, `autocomplete`, `data-*`. Etiquetas `<label class="form-label">X</label>` → atributo `label="X"` del control si están pegadas; si no, `<label class="lj-label">`. `input-group` con texto → slot `prefix`/`suffix`. `<textarea>` → `<sl-textarea resize="auto">`. Fechas con flatpickr / color / range → `<input class="lj-input" …>` nativo. `type=file` → nativo con `hidden` + disparador `sl-button`. Bindings de flatpickr sobre `sl-input` → `ljFlatpickr(el, opts)`.
- [ ] **R7 — Selects:** `<select class="form-select" id=…>${items.map(i => `<option value="${v}">${t}</option>`)}</select>` → `<sl-select id=… value="${ljOptionValue(sel)}">${items.map(i => `<sl-option value="${ljOptionValue(v)}">${t}</sl-option>`)}</sl-select>`; lecturas `x.value` de esos selects → `ljSelectValue(x)`; escrituras `x.value = v` → `ljSetSelectValue(x, v)`. `createElement('option')` → `createElement('sl-option')` con `value = ljOptionValue(v)`. Opción vacía `value=""` → `placeholder` del `sl-select` + `clearable` si correspondía.
- [ ] **R8 — Checkbox/radio:** checkbox → `<sl-checkbox …>Texto</sl-checkbox>` (o `sl-switch` donde el diseño era un switch); radios del mismo `name` → `<sl-radio-group name=… value=…><sl-radio value=…>…</sl-radio></sl-radio-group>`; lecturas `querySelector('input[name=x]:checked')?.value` → `querySelector('sl-radio-group[name=x]').value`; `:checked` sobre checkboxes → `[...querySelectorAll('sl-checkbox[...]')].filter((c) => c.checked)`.
- [ ] **R9 — Selectores por tag:** `querySelector('input…')`/`select`/`textarea` → por id/clase/data-attr o `'sl-input, sl-select, sl-textarea, input.lj-input'`. Inventario 5605 → `'sl-input, sl-select, sl-textarea, sl-checkbox, input.lj-input'` (sin file).
- [ ] **R10 — Lecturas justo tras render:** si después de `innerHTML = …` el código lee `.value`/`.checked` en el mismo tick, anteponer `await ljReady(container)` (la función ya debe ser async o encadenar `.then`). Caret: `el.selectionStart` → `ljNativeInput(el).selectionStart`.
- [ ] **R11 — Íconos Bootstrap:** `<i class="bi bi-NAME"></i>` → `<sl-icon name="NAME"></sl-icon>` (mismas clases extra).
- [ ] **R12 — CSS del módulo:** colores fijos → `var(--lj-*)` (fondos claros→`--lj-surface`/`--lj-surface-2`; bordes→`--lj-border`; textos→`--lj-text`/`--lj-muted`; azules→`--lj-accent`/`--lj-brand`; estados→`--lj-success/warning/danger(-soft)`); `border-radius` > 6 px → `var(--lj-radius-lg)` (salvo círculos/avatars `50%` y pastillas de estado que pasan a `sl-badge`); quitar degradados y sombras grandes; selectores a clases `ios-btn/ios-input/swal2-*/modal-*` eliminados o reapuntados a `sl-*`/`.lj-alert`. Verificar contraste en oscuro.
- [ ] **R13 — Verificación:** `lint-legacy` del task → 0 hits. `ui-check --only <escenario>` en {claro, oscuro} × {desktop, móvil} → 0 `pageerror`, 0 errores de consola nuevos, 0 escrituras, capturas revisadas (alineación 36 px, desbordes, contraste). Comparar comportamiento con `baseline-*` (mismos datos visibles).
- [ ] **R14 — Commit:** `git add <archivos del task> && git commit -m "Migrar <módulo> a Shoelace"`.

---

### Task 17: Limpieza global

**Files:** `CSS/base.css`, `CSS/modules/*.css`, `JS/*.js`, HTML

- [ ] **Step 1:** `lint-legacy` sobre **todo** `JS/*.js` y `*.html` → 0 hits.
- [ ] **Step 2:** `grep -rn "swal2\|ios-alert\|ios-btn\|ios-input\|modal-backdrop\|--bs-" CSS/` → eliminar reglas muertas.
- [ ] **Step 3:** `grep -rn "bootstrap\|sweetalert" *.html JS CSS` → 0.
- [ ] **Step 4:** `node tools/stamp-assets.js && node tools/stamp-assets.js --check` → OK.
- [ ] **Step 5: Commit** "Limpieza final de Bootstrap y SweetAlert".

### Task 18: Verificación integral

- [ ] **Step 1:** `ui-check` matriz completa (4 combinaciones, todos los escenarios) → 0 `pageerror`, 0 escrituras.
- [ ] **Step 2:** Revisar todas las capturas; corregir lo que se vea mal (cada corrección: commit propio).
- [ ] **Step 3:** Impresiones: abrir una planilla de producción, una etiqueta QR y un PDF de receta en el banco (sin guardar) y comparar con la línea base.
- [ ] **Step 4:** Revisión final de la rama completa (code review) y resumen para Lucas con capturas antes/después. **No** mergear a `main` sin su OK.
