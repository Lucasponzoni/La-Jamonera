# Rediseño: de Bootstrap a Shoelace (vanilla) · estilo "B azul institucional" + modo oscuro

Fecha: 2026-10-02 · Rama: `rediseno-shoelace` · Estado: aprobado por Lucas (ejecución autónoma pedida: "continuá automáticamente hasta terminar").

## 1. Objetivo y criterios de éxito

**Lo que pidió Lucas**
- Sacar Bootstrap por completo y usar Shoelace (web components, sin framework).
- Diseño prolijo, plano, con poco redondeo. Dirección elegida: **B · azul institucional** (azules actuales, plano, radio 5–6 px), validada con bocetos.
- Controles con **la misma altura** (input = select = botón).
- **Modo oscuro** con botón manual; preferencia **por usuario guardada en Firebase**.
- **Todo Shoelace** (enfoque 2): también los inputs/selects/botones generados por JS.
- SweetAlert2 se **reemplaza** por diálogos Shoelace. flatpickr **se queda**, con el tema.
- Uso mixto PC + tablet/celular.
- Publicación **de una sola vez** desde la rama; validación **automática por Claude** (sin tocar datos).

**Éxito =**
1. Ninguna página carga Bootstrap CSS/JS ni bootstrap-icons; Shoelace vendorizado en el repo.
2. Todos los flujos actuales funcionan igual (misma lógica, mismos datos, mismas escrituras).
3. Recorrido automático completo (todas las páginas, los 11 modales y sus vistas internas, diálogos) en claro/oscuro × escritorio/celular: **0 errores JS**, 0 escrituras reales a Firebase durante pruebas.
4. Impresiones/PDF/planillas/etiquetas QR **idénticos** a hoy.

**Fuera de alcance**: cambiar lógica de negocio, estructura de datos de Firebase, contenido de impresiones/PDF.

## 2. Base técnica

- **Shoelace 2.20.1** copiado en `vendor/shoelace/` (build `cdn`: autoloader, chunks, components, themes, assets/icons). Se carga con `shoelace-autoloader.js` (type=module) y `setBasePath`. `tools/stamp-assets.js` se amplía para versionar también `./vendor/`.
- **`CSS/theme.css`**: tokens del sistema (`--lj-*`) en `:root` (claro) y `.sl-theme-dark` (oscuro) + mapeo a variables Shoelace:
  - `--sl-input-height-medium: 36px` (small 30, large 44 para táctil), `--sl-border-radius-medium: 5px`, `--sl-font-sans: Inter`.
  - Paleta primaria Shoelace remapeada al azul `#1f5fbf` (oscuro `#6ea0ff`).
  - Colores B: fondo `#f6f8fc`, superficie `#fff`, borde `#dfe5f0`, texto `#1f2a44`, apagado `#55607f`, marca `#173d73`. Oscuro: fondo `#0f1522`, superficie `#161e2e`, borde `#26324a`, texto `#e3e9f5`, apagado `#93a0bb`.
- **`CSS/utilities.css`**: reemplazo de las utilidades Bootstrap usadas (`d-none` con `!important`, `d-flex/d-block`, `m*/p*` 0–4, `gap-*`, `text-start/center/end/muted/danger/warning`, `align-items-*`, `justify-content-*`, `flex-wrap/column/grow-1`, `w-100`, `visually-hidden`, `table`, `table-responsive`, `badge`, `rounded-pill`, `container-fluid`, `bg-*`/`border-0`).
- **`CSS/style.css`**: se reescriben sus secciones al tema (colores → `var(--lj-*)`, radios ≤ 6 px, sin degradados de fondo, sin sombras pesadas). Las clases `ios-*` dejan de usarse para controles (los reemplaza Shoelace); se conservan sólo si siguen describiendo layout.
- **Modo oscuro**: `JS/ui/theme.js`.
  - Script inline mínimo en `<head>` de cada página: lee `localStorage['lj-theme']` y pone `class="sl-theme-dark"` en `<html>` antes de pintar (sin parpadeo).
  - Tras login: lee/escribe `/userPreferences/{uid}/theme` (`'light'|'dark'`); Firebase manda, localStorage es caché.
  - Botón luna/sol en la barra superior. Default: claro.
  - Charts (Chart.js) re-coloreados con tokens al cambiar tema.
  - `produccion_publica.html` (vista pública) siempre clara.
- **Tipografía/íconos**: Inter global; Font Awesome se queda; `bi bi-*` → `<sl-icon name="*">` (mismo set).

## 3. Mapeo de componentes

| Hoy | Shoelace |
|---|---|
| 11 modales Bootstrap | `<sl-dialog>` (ancho `min(1140px, 96vw)`; full-screen < 768 px) |
| Navbar colapsable + menú usuario | Encabezado propio + `<sl-drawer>` móvil + `<sl-dropdown>/<sl-menu>` |
| Dropdown "familias" (inventario) | `<sl-dropdown>` |
| `btn`/`ios-btn-*` | `<sl-button variant="primary|default|success|warning|danger|text">` (`size="small"` en acciones de tabla) |
| `form-control`/`ios-input` | `<sl-input>` / `<sl-textarea>` |
| `form-select` | `<sl-select>` + `<sl-option>` |
| `input-group` | slots `prefix`/`suffix`; contraseña → `password-toggle` |
| checkbox/switch propios | `<sl-checkbox>` / `<sl-switch>` |
| badge/pill | `<sl-badge>` / `<sl-tag>` |
| spinners propios | `<sl-spinner>` |
| notificaciones `ios-notify` | `<sl-alert>.toast()` |
| tablas | tabla HTML + estilos del tema, scroll horizontal |
| flatpickr ×31 | flatpickr con tema, enganchado al `<input>` interno del `sl-input` (o input nativo oculto) |
| `type="file"` | **se quedan nativos ocultos**, disparados por `sl-button` |
| impresiones/PDF/QR | **sin cambios** |

## 4. Formularios: reglas de conversión (zona de mayor riesgo)

Semántica Shoelace que obliga a cambiar código:
- `change` nativo **no sale** del shadow DOM → los controles emiten `sl-change`.
- `input`/`keydown`/`focus` nativos sí llegan al host (composed).
- `sl-select` no tiene `.options/.selectedIndex/<option>`; valor por `.value` (string, o array con `multiple`).
- `querySelector('input'|'select'|'textarea')` no encuentra controles Shoelace.

Medidas:
1. **Puente de eventos `JS/ui/sl-bridge.js`** (red de seguridad): escucha `sl-change` en `document` (captura) y re-despacha `new Event('change', {bubbles:true})` desde el host. Así los `addEventListener('change')` existentes —directos o delegados— siguen funcionando. Idem `sl-input` → no hace falta (el `input` nativo ya llega).
2. **Selectores por tag** se reescriben a selectores por id/clase/data-attr o a `sl-input, input` donde convivan.
3. **Selects**: plantillas `<select><option>` → `<sl-select><sl-option value>`; lecturas `.options/selectedIndex/selectedOptions/option:checked` → `.value` y búsqueda en datos.
   - Valores de `sl-option` **no admiten espacios** (Shoelace los usa como separador en `multiple`): los valores con espacios se codifican (`encodeURIComponent`) en la plantilla y se decodifican al leer, centralizado en helper `ljSelectValue(el)`.
4. **Checkbox**: `.checked` igual; `change` vía puente.
5. **Validación nativa** (`setCustomValidity/reportValidity/required`): Shoelace las implementa en el host; se verifica cada uso.
6. **`FormData`/submit**: Shoelace participa del form; login se migra con `<form>` + `sl-input name=...`.
7. **Valores tras render**: los `sl-*` se definen en forma diferida (autoloader). Toda lectura/escritura de `.value` inmediatamente después de insertar HTML se hace tras `await customElements.whenDefined(tag)` cuando haga falta; helper `ljReady(root)` espera la definición de los `sl-*` presentes en `root`.

## 5. Diálogos

### 5.1 Modales (11)
`JS/ui/modal.js` expone `LJModal.open(id)`, `LJModal.close(id)`, `LJModal.get(id)`.
- Las tarjetas del inicio pasan de `data-bs-toggle/target` a `data-lj-open="#id"`; cierre con el botón X del header.
- **Mapeo de eventos** (la lógica existente cuelga de ellos): `show.bs.modal`→`sl-show`, `shown.bs.modal`→`sl-after-show`, `hide.bs.modal`→`sl-hide`, `hidden.bs.modal`→`sl-after-hide`. Se renombran en cada archivo (~40 listeners), filtrando `event.target === dialog` (los `sl-*` hijos también emiten `sl-show/sl-hide`, p.ej. dropdowns/tooltips, y burbujean).
- Encadenado produccion→inventario: `sl-after-hide` once + `open`.
- Apilado: `sl-dialog` es top-layer por orden de apertura; visor de imágenes y usuarios abiertos sobre producción funcionan sin z-index manual. Se quita `modal-backdrop`/`inventory-image-backdrop`.
- Contenedores: `.modal-content`/`.modal-body` → `[part=panel]`/`[part=body]`; donde el código busca el contenedor de scroll o monta overlays, se usa `dialog.shadowRoot.querySelector('[part=body]')` vía helper `LJModal.body(id)` o un wrapper interno `.lj-dialog-body` en el slot por defecto (preferido: el scroll vive en el wrapper propio, no en el shadow).
- Cerrar con clic afuera: deshabilitado en modales con edición (como hoy `backdrop` estándar de Bootstrap cierra; se mantiene igual que hoy: cierra con X/Escape; clic en overlay **no** cierra para evitar perder borradores).
- `inert`/foco: `sl-dialog` gestiona foco y `inert` del resto; se elimina el manejo manual y la parte Bootstrap de `swal-a11y-guard.js` (la parte del guard de imágenes rotas se conserva en `JS/image-guard.js`).

### 5.2 Reemplazo de SweetAlert2 (`JS/ui/lj-alert.js`)
API compatible con el subconjunto usado (inventario en apéndice A), expuesta como `window.Swal` **y** `window.LJAlert`, para que las ~365 llamadas y los 9 wrappers (`openIosSwal`, `openSwal`, `openPlanillaSwal`) funcionen sin reescribir su lógica:
- `fire(options)` → Promise `{isConfirmed, isDenied, isDismissed, value, dismiss}`.
- Opciones: `title, html, text, icon (success|error|warning|info|question), showConfirmButton, showCancelButton, showDenyButton, confirmButtonText/cancelButtonText/denyButtonText, preConfirm (sync/async; false o throw = no cerrar), inputValidator, input/inputOptions/inputValue/inputPlaceholder/inputAttributes, didOpen, didRender, willClose, didClose, allowOutsideClick, allowEscapeKey, showCloseButton, width, timer, timerProgressBar, toast/position, customClass (se ignora salvo clases de layout), buttonsStyling, reverseButtons, focusConfirm, returnFocus, target, backdrop, showLoaderOnConfirm`.
- Estáticos: `close, isVisible, getPopup, getHtmlContainer, getTitle, getConfirmButton, getDenyButton, getCancelButton, getInput, showLoading, hideLoading, isLoading, showValidationMessage, resetValidationMessage, clickConfirm, clickCancel, clickDeny, update, mixin`.
- Implementado con un `<sl-dialog>` propio por llamada (top-layer, se apila sobre modales). Ícono con `sl-icon` + color de estado. Botones `sl-button`. Toast (`toast:true`) → `sl-alert.toast()`.
- **HTML interno de cada alerta** (formularios con `swal2-input/select/textarea`): se migra a `sl-input/sl-select` igual que el resto (regla §4); el `preConfirm` lee por id → `.value` del host funciona.
- Se elimina SweetAlert2 del `<head>` y ~130 selectores `.swal2*` del CSS.

## 6. Barra superior y navegación
Encabezado propio en index/informes/analisis: logo, enlaces (Inicio, Informes, Análisis), notificaciones, botón tema, menú usuario (`sl-dropdown`). < 992 px: botón hamburguesa → `sl-drawer` con los mismos enlaces. Sin dependencias Bootstrap.

## 7. Pruebas y publicación
- Banco `ui-check` (fuera del repo, en el scratchpad): Playwright + Edge, sirve la rama local, **inyecta un guard que convierte en no-op toda escritura** RTDB/Storage (las registra) y loguea con usuario real.
- Matriz: {claro, oscuro} × {escritorio 1440×900, celular 390×844}.
- Recorrido: login → inicio → cada modal → vistas internas por módulo (editor de producción, historial, salida de productos, editor de ingreso, editor de receta, ingredientes, usuarios, informe nuevo, análisis nuevo, visor de imágenes) → abrir diálogos clave (confirmaciones, formularios rápidos) y cerrarlos sin guardar.
- Criterio: 0 `pageerror`, 0 errores de consola nuevos vs. línea base, 0 escrituras reales, capturas revisadas por Claude (alineación, contraste, alturas, desbordes).
- Baseline Bootstrap capturado antes de migrar (`baseline-desktop/`): pasa 13/13 sin errores.
- Publicación: merge de `rediseno-shoelace` a `main` **sólo con OK explícito de Lucas** + `stamp-assets`.

## 8. Riesgos
| Riesgo | Mitigación |
|---|---|
| Código que escucha `change` en controles | Puente `sl-bridge.js` + revisión por archivo |
| Lecturas de `<select>` nativo | Conversión explícita + helper `ljSelectValue` |
| Valores leídos antes de que el componente se defina | `ljReady()` en renders que leen inmediatamente |
| Lógica en eventos de modal | Renombrado 1:1 con filtro `target === dialog` |
| 365 alertas | API Swal-compatible; no se reescribe su lógica |
| flatpickr sobre shadow DOM | Se engancha al input interno (`el.shadowRoot.querySelector('input')`) vía helper `ljFlatpickr(el, opts)` |
| style.css enorme | Reescritura por secciones, verificada con capturas |
| Romper impresiones | No se tocan; prueba de que las ventanas de impresión no referencian clases migradas |

## Apéndice A · Inventario (mapeo 2026-10-02)
- Bootstrap: 11 modales, 1 navbar×3 páginas, 2 dropdowns; JS solo `Modal` (9 llamadas) + ~40 eventos `*.bs.modal`; `d-none` 85 + 238 toggles; `btn` 461, `form-control` 112, `form-label` 74, `form-select` 30, `input-group` 16, `table(-responsive)` 15/17.
- SweetAlert: ~51 `Swal.fire` + ~314 llamadas a wrappers en 9 archivos; 130 selectores `.swal2*`.
- flatpickr 31; Chart.js 1; impresiones con estilos propios (no usan Bootstrap).
- Detalle de formularios/eventos por archivo: ver apéndice B (agregado al completar el inventario).

## Apéndice B · Inventario de formularios y reglas adicionales

**Volumen** (HTML + JS): `<input` 282, `<select` 41, `<textarea` 20, `<button` 616, `<option` 90, checkbox/radio 64; `addEventListener` change 91 / input 48 / submit 3; selectores por tag 49; `:checked` 32; `.checked` 94; `.files` 52; `type="file"` 26; flatpickr 31 (varios con `altInput`).
SweetAlert: `openIosSwal` 288 + `Swal.fire` ~42 directas; claves usadas: title, html, confirmButtonText, icon, showCancelButton, cancelButtonText, customClass, didOpen, preConfirm, showConfirmButton, allowOutsideClick, width, showDenyButton, denyButtonText, buttonsStyling, allowEscapeKey, target, returnFocus, willClose, willOpen, preDeny, reverseButtons, text, input (text/password) + inputValue/Placeholder/Class/Label/Attributes, scrollbarPadding. Estáticos: showValidationMessage 120, close 53, isVisible 11, getPopup 6, getHtmlContainer 6, update 1. HTML interno: `swal2-input` 91, `swal2-select/textarea` 19.

**Reglas adicionales (deciden excepciones al "todo Shoelace")**
1. **Radios** (19 grupos) → `sl-radio-group` + `sl-radio`/`sl-radio-button`. Lecturas `input[name=x]:checked` → `group.value`. Los 34 selectores `input[name…]`/`:checked` se reescriben.
2. **Checkbox** → `sl-checkbox`: `.checked` igual; selectores `:checked` → filtro JS por `.checked`.
3. **Fechas con flatpickr** (31): flatpickr necesita un `<input>` real (y crea su `altInput`). Se mantiene **`<input>` nativo** con clase `lj-input` que replica exactamente el look de `sl-input` (altura 36, radio, borde, foco, modo oscuro). Mismo criterio para `type=color`, `type=range` y `hidden` (no tienen equivalente o no se ven). `type=file` nativo oculto (26).
4. **Inputs con posición de cursor** (`selectionStart`/`setSelectionRange`: inventario 1824-1835, 7154-7214; produccion 7332): `sl-input` expone `setSelectionRange()`/`select()`; para leer `selectionStart` se usa el input interno (`el.input` — propiedad pública de `sl-input`). Helper `ljNativeInput(el)`.
5. **Disparos sintéticos** `dispatchEvent(new Event('change'))` sobre selects (inventario ×4): funcionan sobre el host; se mantienen.
6. **Selector masivo** inventario 5605 (`input:not([type=file]),select,textarea`) → `sl-input,sl-select,sl-textarea,sl-checkbox,input.lj-input`.
7. **`<option value="create">` insertado dinámicamente** (Informes 1885, 2496) → `sl-option` creado con `document.createElement('sl-option')`.
8. **Inputs nativos de SweetAlert** (`input:'password'` en Informes/Analisis, `input:'text'` en producción): LJAlert los renderiza como `sl-input` con clase `swal2-input` (para selectores existentes) y devuelve `value` en el resultado.
9. **contenteditable** (editor de informes/análisis): no es control de formulario, se mantiene; sólo se re-estiliza.
