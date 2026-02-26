# Análisis técnico integral — La Jamonera

## 1) Lectura general del proyecto

El repositorio implementa un **back office web estático** (HTML + CSS + JS vanilla) con Bootstrap como base visual/layout y Firebase v8 como backend indirecto (mediado por Workers).

### Estructura
- `index.html`: pantalla principal, topbar, módulo de ingredientes en modal y footer.
- `login.html`: pantalla de acceso.
- `CSS/style.css`: estilos globales, sistema visual tipo iOS, login, modal, ingredientes y responsive.
- `JS/auth-guard.js`: protección de rutas por sesión local.
- `JS/firebase-init.js`: bootstrap de Firebase vía Worker + API REST propia para RTDB.
- `JS/login.js`: validación de credenciales contra RTDB.
- `JS/ingredientes.js`: CRUD de familias/ingredientes, imagen (archivo o IA), render de listas y alertas.
- `JS/app.js`: utilidades de app (año en footer y cierre de sesión).

---

## 2) Cómo funciona Firebase en este proyecto

## 2.1 Patrón actual
No se expone `firebaseConfig` en el front de forma hardcoded. En su lugar:
1. `firebase-init.js` llama a `WORKER_BASE_URL/bootstrap`.
2. El Worker devuelve `firebaseConfig`.
3. Se inicializa una app Firebase con nombre fijo `laJamonera`.
4. Se guardan referencias en `window`:
   - `window.appLaJamonera`
   - `window.dbLaJamonera`
   - `window.storageLaJamonera`
5. Adicionalmente, se monta un cliente REST custom `window.dbLaJamoneraRest` con:
   - `read(path)`
   - `write(path, value)`
   - `update(path, value)`

## 2.2 Flujo de autenticación
- `login.js` espera `window.laJamoneraReady`.
- Lee credenciales desde RTDB por rutas candidatas (`user`, `auth`, `/`) usando `dbLaJamoneraRest.read`.
- Compara contra usuario/clave ingresados.
- Si coincide, guarda sesión en `localStorage` con expiración de 8 h (`laJamoneraSession`).
- `auth-guard.js` redirige automáticamente:
  - si no hay sesión activa y no estás en login → `login.html`
  - si ya hay sesión y estás en login → `index.html`

## 2.3 Flujo de ingredientes
- `ingredientes.js` carga `'/ingredientes'` desde RTDB.
- Estructura de estado en memoria:
  - `familias`
  - `items`
  - `config.measures`
- Las escrituras se hacen con `dbLaJamoneraRest.write('/ingredientes', state.ingredientes)`.

## 2.4 Evaluación técnica del enfoque Firebase

### Fortalezas
- Evita publicar credenciales/config del proyecto de forma estática en el frontend.
- Unifica acceso a RTDB detrás de un Worker (ideal para aplicar validaciones adicionales).
- Fácil de mantener para una app pequeña sin build step.

### Riesgos / deuda técnica
- El login compara credenciales en frontend contra datos leídos desde backend (modelo simple, no robusto para escala/seguridad fuerte).
- Depende fuertemente de `window` global (acoplamiento entre módulos).
- No hay token-based auth (Firebase Auth/JWT), sino sesión local manual.
- El `read` de rutas múltiples para credenciales indica que el esquema no está totalmente normalizado.

### Recomendación evolutiva
- Migrar autenticación a **Firebase Auth** o a un endpoint de login en Worker con hash/secret server-side.
- Mantener RTDB para datos de negocio, pero con reglas más estrictas y payloads validados en Worker.

---

## 3) Estructura CSS actual y criterio de organización

Se observa una organización por bloques temáticos con separadores del estilo:

```css
/* =========================================
   RESPONSIVE
========================================= */
```

El archivo está ordenado por “capas de interfaz”, lo cual está bien:
1. Configuración general
2. Layout
3. Navegación
4. Home
5. Footer
6. Login
7. Componentes iOS reutilizables
8. Ingredientes
9. Responsive por breakpoints

## 3.1 Estilo visual identificado
- Lenguaje **iOS-like**: radios altos, superficies limpias, bordes suaves, tipografía legible, feedback por color.
- Paleta pastel/azulada consistente.
- Muy poco uso de sombras; predominan bordes y contrastes suaves de superficie.

Esto está alineado con tu preferencia de **evitar sombras paralelas** (drop shadows pesadas).

## 3.2 Reutilización de clases (estado actual)
Ya hay una base reusable correcta:
- Botones base: `.ios-btn`, con variantes de color.
- Inputs base: `.ios-input`, `.ios-input-group`.
- Modales/alertas: `.ios-modal-*`, `.ios-alert-*`.
- Patrones de cards/listas con radios consistentes.

## 3.3 Oportunidades de limpieza (sin romper estilo)

### A) Consolidar tokens visuales con `:root`
Definir variables de diseño para mantener coherencia y facilitar iteración:
- Colores (`--c-bg`, `--c-surface`, `--c-primary`, etc.)
- Radios (`--r-sm`, `--r-md`, `--r-pill`)
- Bordes (`--b-soft`)
- Espaciados (`--space-1..6`)

### B) Sistema de utilidades internas
Agregar utilidades semánticas pequeñas para evitar repetición:
- `.u-surface`
- `.u-border-soft`
- `.u-round-md`, `.u-round-pill`
- `.u-text-muted`
- `.u-flex-center`

### C) Convención de naming más estricta
Mantener BEM ligero para módulos complejos:
- `ingredientes-card__title`, `ingredientes-card__meta`
- `family-circle--active`

### D) Estados visuales homogéneos
Estandarizar pseudoestados en todos los componentes:
- `:hover`, `:focus-visible`, `.is-active`, `.is-loading`, `.is-disabled`

### E) Sombras
Dado que no querés sombras paralelas:
- Mantener `box-shadow: none` como default.
- Si hace falta jerarquía, usar únicamente:
  - borde + cambio de color de fondo
  - micro-contraste por overlay
  - elevación por escala/transición leve, no sombra marcada

---

## 4) Propuesta de blueprint CSS (compatible con tu estilo)

Orden recomendado dentro de `style.css`:

1. `/* TOKENS */`
2. `/* RESET + BASE */`
3. `/* LAYOUT */`
4. `/* COMPONENTES GENERALES (IOS UI KIT) */`
5. `/* MÓDULOS: TOPBAR */`
6. `/* MÓDULOS: HOME */`
7. `/* MÓDULOS: LOGIN */`
8. `/* MÓDULOS: INGREDIENTES */`
9. `/* ESTADOS GLOBALES */`
10. `/* UTILIDADES */`
11. `/* RESPONSIVE */`

Con el mismo formato de separadores que usás actualmente.

---

## 5) Calidad de código frontend

## 5.1 Fortalezas
- JS modular por IIFE (aislamiento razonable sin bundler).
- Uso de `return` temprano cuando el módulo no aplica en la vista.
- UI feedback consistente (SweetAlert custom iOS).
- Manejo básico de errores en lectura de backend.

## 5.2 Mejoras recomendadas
- Separar en `services` (API/Firebase) + `ui` (render) + `state` para reducir tamaño de `ingredientes.js`.
- Reemplazar dependencias globales por inyección mínima de servicios.
- Normalizar esquema RTDB (paths fijos y versionados).
- Agregar capa de validación de datos (front + worker).

---

## 6) Conclusión

El proyecto ya está bien orientado al estilo iOS limpio que buscás: superficies suaves, bordes claros, tipografía moderna y componentes reutilizables. La base de Firebase vía Worker también es una decisión sólida para ocultar configuración y centralizar acceso. El mayor salto de madurez estaría en reforzar autenticación/seguridad y terminar de convertir el CSS en un mini design system con tokens + utilidades para reducir duplicación.
