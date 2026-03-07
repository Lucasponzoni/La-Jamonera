# Análisis interno del proyecto La Jamonera

> Documento interno para orientar próximas iteraciones de UI/UX y arquitectura.

## 1) Visión general del proyecto
- Front-end estático multipágina (`login.html`, `index.html`, `informes.html`) con JavaScript modular por funcionalidad en `JS/`.
- Diseño visual orientado a estilo iOS: bordes redondeados, fondos suaves, estados hover sutiles, sin dependencia de sombras fuertes.
- Integración con Firebase desacoplada a través de Worker HTTP para evitar exponer configuración y operar RTDB vía endpoints controlados.
- Dependencias de UI vía CDN: Bootstrap 5, SweetAlert2, Font Awesome, Bootstrap Icons, Flatpickr.

## 2) Flujo de autenticación y sesión
- Doble guardia de sesión:
  - Guardia temprana inline en `index.html` para evitar FOUC/flash de contenido protegido.
  - Guardia global en `JS/auth-guard.js` para redirecciones según estado de sesión.
- Sesión en `localStorage` con clave `laJamoneraSession` y `expiresAt` (8h).
- Login en `JS/login.js`:
  - Normaliza usuario/clave a lower-case + trim.
  - Lee credenciales desde Firebase por REST (`user`, `auth`, `/`).
  - Si valida, guarda sesión local y redirige a home.

## 3) Cómo funciona Firebase en este proyecto

### 3.1 Inicialización
- `JS/firebase-init.js` espera SDK global (`window.firebase`) y crea app nombrada `laJamonera`.
- Obtiene `firebaseConfig` desde `WORKER_BASE_URL/bootstrap`.
- Expone en `window`:
  - `appLaJamonera`
  - `dbLaJamonera` (Realtime Database SDK)
  - `storageLaJamonera` (Storage SDK)
  - `dbLaJamoneraRest` (wrapper HTTP: `read`, `write`, `update`)
  - `laJamoneraReady` (promesa de bootstrap)

### 3.2 Patrón de acceso a datos
- Los módulos esperan `await window.laJamoneraReady` antes de operar.
- Operaciones de datos críticas usan wrapper REST (`dbLaJamoneraRest`) en lugar de escribir lógica repetida de fetch.
- Endpoints actuales:
  - `GET /rtdb/read?path=`
  - `POST /rtdb/write`
  - `POST /rtdb/update`

### 3.3 Ventajas del enfoque
- Menor exposición de configuración sensible en cliente.
- Posibilidad de aplicar seguridad, auditoría y validaciones en Worker.
- Acople bajo en módulos de negocio (ingredientes, recetas, inventario, informes).

### 3.4 Riesgos/consideraciones
- Dependencia de disponibilidad del Worker para todo acceso a datos.
- Falta de retries/backoff centralizados en wrapper.
- Posible inconsistencia si en algunos módulos se mezcla SDK directo y REST sin convención explícita.

## 4) Estructura CSS actual y patrón de secciones

### 4.1 Organización por bloques con títulos
- El archivo `CSS/style.css` usa separadores homogéneos tipo:
  - `/* ========================================= ... ========================================= */`
- Secciones observadas:
  - CONFIGURACION GENERAL
  - LAYOUT BASE
  - TOPBAR / NAVEGACION
  - CONTENIDO HOME
  - FOOTER
  - LOGIN
  - MODAL
  - MODAL INGREDIENTES (LISTADO / SCROLL)
  - SELECTOR / PREVIEW DE IMAGEN
  - COMPONENTES IOS (INPUTS/BOTONES/ALERT)
  - SPINNERS Y ANIMACIONES
  - RESPONSIVE
  - INFORMES BROMATOLÓGICOS
  - INFORMES UI FIXES

### 4.2 Estilo visual dominante
- Paleta pastel y azules suaves.
- Bordes redondeados consistentes (10px–24px).
- Elevación mínima: predomina `border` y contraste de fondo por encima de sombras.
- Interacciones suaves con `transition` en color/background/opacity.
- Componentes base reutilizables:
  - `.ios-btn`, variantes (`-primary`, `-secondary`, `-success`, `-warning`)
  - `.ios-input`, `.ios-input-group`
  - `.ios-modal*`, `.ios-alert*`

### 4.3 Evaluación contra preferencia “estilo iOS sin sombras paralelas”
- El CSS actual ya está mayormente alineado: casi sin `box-shadow` decorativo.
- Recomendación permanente:
  - Mantener elevación por color/borde, no por sombras paralelas.
  - Si se requiere separación visual, preferir:
    - `border` con leve variación tonal
    - fondos en capas (`#f8f9fd` vs `#eef3ff`)
    - micro-contrastes en hover/focus

## 5) Reutilización de clases y limpieza de código

### 5.1 Reutilización ya presente
- Sistema `ios-*` bien consolidado para inputs/botones/modales/alerts.
- Patrones de tarjetas (`*-card`), avatares (`*-avatar`), grids (`*-grid`) y toolbars (`*-toolbar`).

### 5.2 Oportunidades de mejora
- Extraer utilidades comunes para elementos repetidos:
  - botones icónicos cuadrados
  - tarjetas con borde claro + fondo blanco
  - placeholders circulares
- Homologar tamaños tipográficos de subtítulos secundarios para mayor consistencia.
- Centralizar tokens de color en `:root` para mantenimiento futuro.

## 6) Guía de estilo propuesta para próximas ediciones CSS

### 6.1 Convención de secciones (mantener)
- Continuar usando encabezados bloque exactamente con el patrón actual.
- Orden recomendado fijo:
  1. CONFIGURACION GENERAL
  2. TOKENS / UTILIDADES
  3. LAYOUT
  4. COMPONENTES COMPARTIDOS
  5. FEATURES (por módulo)
  6. RESPONSIVE

### 6.2 Principios visuales (alineados a requerimiento)
- Estética iOS limpia.
- Evitar sombras paralelas (hard shadow).
- Radio consistente y transiciones suaves.
- Estados activos por color, no por elevación brusca.

### 6.3 Reglas de reutilización
- Antes de crear clase nueva:
  - verificar si existe equivalente `ios-*`.
  - extender con modificador (`.is-*` o `--variant`) en lugar de duplicar.
- Priorizar composición de clases pequeñas sobre bloques duplicados.

## 7) Próximos pasos sugeridos (solo internos)
- Definir tokens `:root` (colores, radios, espacios).
- Crear mini “design primitives” reutilizables para cards/chips/icon-buttons.
- Ejecutar pasada de deduplicación en estilos de modales (ingredientes/recetas/informes/inventario).
- Revisar consistencia responsive entre módulos de alta densidad (listas + editor).

## 8) Profundización técnica Firebase (mapa real de uso)

### 8.1 Módulos conectados a RTDB por wrapper REST
- `JS/login.js`: lectura de raíz `/`, y nodos `user` + `auth` para validar acceso.
- `JS/ingredientes.js`: lectura/escritura de `ingredientes_data` (familias, items, metadata).
- `JS/recetas.js`: CRUD completo en `recetas_data` y sincronización de catálogos de ingredientes.
- `JS/inventario.js`: gestión de stock, movimientos, alertas de umbral, trazabilidad y reservas.
- `JS/produccion.js`: configuración de producción, registros por lote, reservas y auditoría.
- `JS/Informes.js`: árbol `/informes`, índice `/informes_index`, preferencias por usuario y comentarios.

### 8.2 Patrón transversal recomendado (ya casi implementado)
1. Esperar `window.laJamoneraReady`.
2. Leer estado actual (`read`) para render inicial.
3. Transformar in-memory (normalización de objetos/listas).
4. Persistir con `write`/`update`.
5. Volver a renderizar con estado ya confirmado.

### 8.3 Riesgos detectados para estabilidad
- Escrituras concurrentes en nodos grandes (ej. índices de informes) pueden pisarse al no existir transacciones en cliente.
- La app depende de que el Worker mantenga contrato estable (`/bootstrap`, `/rtdb/*`).
- No hay cola offline: si falla red, se pierde la operación salvo reintento manual.

## 9) Profundización CSS: estructura de títulos y coherencia visual

### 9.1 Convención exacta de encabezados de bloque
Se sostiene un patrón consistente, legible y fácil de escanear:

```css
/* =========================================
   NOMBRE DEL BLOQUE
========================================= */
```

Esto ordena el archivo por dominios de UI, facilita mantenimiento y minimiza colisiones.

### 9.2 Orden práctico recomendado para mantener el estilo actual
1. **CONFIGURACION GENERAL** (reset, tipografía, base body/html).
2. **LAYOUT BASE** (shell, contenedores globales).
3. **NAVEGACIÓN / TOPBAR / FOOTER**.
4. **COMPONENTES REUTILIZABLES IOS** (botones, inputs, modales, alerts).
5. **FEATURES POR MÓDULO** (home, ingredientes, recetas, inventario, informes).
6. **ANIMACIONES Y ESTADOS DE CARGA**.
7. **RESPONSIVE** al final.

### 9.3 Principios de estilo (alineados a preferencia iOS)
- Sin sombras paralelas duras (`box-shadow` agresivo).
- Profundidad lograda por capas de fondo + bordes sutiles.
- Radios amplios y consistentes.
- Iconografía clara con color semántico (verde éxito, azul acción, naranja advertencia).
- Transiciones cortas y suaves para hover/focus/active.

### 9.4 Reutilización de clases para mantener limpieza
- Base obligatoria por composición:
  - `.ios-btn` + variante (`.ios-btn-primary`, `.ios-btn-secondary`, etc.).
  - `.ios-input` y `.ios-input-group` para cualquier formulario o SweetAlert.
  - `.ios-modal*` para estructura visual homogénea en todas las ventanas.
- Evitar crear clases monolíticas por pantalla; priorizar utilidades por rol visual.
- Si una pieza se repite 3+ veces, convertirla en clase reutilizable antes de seguir escalando estilos.

## 10) Checklist de consistencia para futuras iteraciones UI
- ¿El nuevo bloque CSS tiene encabezado con el formato estándar?
- ¿Se reutilizaron clases `ios-*` existentes antes de agregar nuevas?
- ¿La jerarquía visual se logró sin sombras paralelas?
- ¿Los estados hover/focus son visibles pero sutiles?
- ¿El responsive quedó ubicado en la sección final sin mezclar reglas base?

## 11) Mapa técnico profundo (código real)

### 11.1 Firebase: contrato real en ejecución
- Bootstrap centralizado en `JS/firebase-init.js`:
  - `WORKER_BASE_URL = https://jamonera.lucasponzoninovogar.workers.dev`
  - `GET /bootstrap` para recuperar `firebaseConfig`.
  - Exposición global de `window.laJamoneraReady`, `window.dbLaJamoneraRest`, `window.storageLaJamonera`.
- Wrapper REST uniforme:
  - `read(path)` -> `GET /rtdb/read?path=`
  - `write(path, value)` -> `POST /rtdb/write`
  - `update(path, value)` -> `POST /rtdb/update`
- Lectura directa de credenciales en login con fallback de rutas (`user`, `auth`, `/`) y normalización lower-case.

### 11.2 Nodos RTDB usados por dominio
- **Auth/Login**: `user`, `auth`, `/`, sesión local `laJamoneraSession` (8h).
- **Ingredientes**: `/ingredientes`, subida de assets a Storage en `ingredientes/*`.
- **Recetas**: `/recetas`, `/recetas_config`, `/ingredientes/config/measures`, uso de Storage para imágenes y lectura de `/deepseek`.
- **Inventario**: `/inventario`, `/ingredientes/config/measures`, `/passGeneral/pass`.
- **Producción**: `/produccion/config`, `/produccion/reservas`, `/produccion/drafts`, `/produccion/registros`, `/produccion/sequence` + sincronización con `/inventario` y lectura de `/informes/users`.
- **Informes**: `/informes`, `/informes_index`, `/informes/users`, `/informes/email_preferences` + Storage para adjuntos.

### 11.3 Estilo CSS realmente aplicado (estado actual)
- Archivo único `CSS/style.css` con secciones extensas, manteniendo el encabezado:
  - `/* ========================================= ... ========================================= */`
- El patrón se mantiene desde bloques globales hasta módulos específicos:
  - base (`CONFIGURACION GENERAL`, `LAYOUT BASE`)
  - transversales (`COMPONENTES IOS`, `SPINNERS`, `RESPONSIVE`)
  - features (`INFORMES`, `RECETAS`, `INVENTARIO`, `PRODUCCIÓN`).
- Las sombras paralelas casi no se usan:
  - predominan `box-shadow: none`.
  - aparecen únicamente sombras **inset** puntuales (micro-contraste), alineadas con estética iOS suave.

### 11.4 Reutilización efectiva de clases (limpieza)
- Sistema principal por composición:
  - `ios-btn` + variante semántica (`primary`, `secondary`, `success`, `warning`, `danger`).
  - `ios-input`, `ios-input-group`, `ios-toggle-pass`.
  - `ios-modal`, `ios-modal-header`, `ios-modal-body`, `ios-modal-title`, `ios-modal-close`.
  - `ios-alert` + subclases para SweetAlert2.
- Convención operativa recomendada:
  1. Reutilizar base `ios-*`.
  2. Añadir modificador de contexto (`.informes-*`, `.recetas-*`, `.inventario-*`, `.produccion-*`).
  3. Evitar crear variantes aisladas si el patrón ya existe.

### 11.5 Riesgos técnicos concretos observados
- Escrituras de objeto completo en nodos grandes (ej. inventario/registros/index) sin control de concurrencia transaccional.
- Dependencia total del Worker para toda E/S de RTDB (si cae el Worker, cae el backend lógico del cliente).
- Sin política de reintentos/backoff global en `fetchJson`.
- Múltiples módulos con alto volumen de lecturas secuenciales: oportunidad para agrupar/batchear lecturas donde aplique.

## 12) Criterios de estilo CSS críticos para próximas implementaciones

### 12.1 Encabezados de secciones (obligatorio)
- Mantener siempre el formato exacto de bloque:

```css
/* =========================================
   NOMBRE DEL BLOQUE
========================================= */
```

- No mezclar reglas de distintos dominios dentro de un mismo bloque.
- Dejar `RESPONSIVE` al final del archivo como zona única de media queries.

### 12.2 Principios visuales tipo iOS (obligatorio)
- Evitar **sombras paralelas** como recurso principal de jerarquía.
- Priorizar separación visual con:
  - bordes sutiles,
  - fondos por capas tonales,
  - contraste de color en estados `hover` / `active`.
- Mantener radios amplios y consistentes (estética suave, no material dura).

### 12.3 Reutilización de clases para limpieza
- Reutilizar primero componentes base (`.ios-btn`, `.ios-input`, `.ios-modal`, `.ios-alert`).
- Si surge una variante nueva, modelarla como modificador (`.is-*` o `--variant`) antes de duplicar.
- Si un patrón aparece 3+ veces, extraer clase utilitaria compartida.
- Evitar crear clases de una sola pantalla si el comportamiento visual ya existe en el sistema `ios-*`.
