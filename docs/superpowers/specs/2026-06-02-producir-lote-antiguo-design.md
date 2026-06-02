# Diseño — "Producir lote antiguo" (producción retroactiva)

Fecha: 2026-06-02
Archivo principal afectado: `JS/produccion.js`

## Objetivo

Agregar, en el modal "Producción" (vista index), dentro del menú de tres
puntitos de cada receta (debajo de "Producir sin trazabilidad"), una nueva
opción **"Producir lote antiguo"**.

Permite documentar producciones **retroactivas** con fechas antiguas (de hace
uno o dos meses, o cualquier fecha pasada). El sistema busca los lotes de
ingredientes que **existían y no estaban vencidos** a esa fecha y deja producir.

Lo esencial: esta producción **NO toca inventario**:
- No descuenta stock de ingredientes.
- No deja movimiento/registro en el producto (no suma stock de producto).
- Sí genera la **planilla** (igual que cualquier producción, on-demand desde el
  registro) y la **trazabilidad** (registro + página pública/QR).

## Decisiones tomadas

| Tema | Decisión |
|------|----------|
| Persistencia de trazabilidad | Crea un **registro de producción aparte**, marcado como lote antiguo, **sin movimientos de inventario**. Aparece en el historial. |
| Fuente de lotes | **Historial de ingresos** = los `entries` del inventario (persisten tras consumo con `lotStatus: 'consumido_en_produccion'`). Se filtran por ventana histórica. |
| Restricción de fecha | **Cualquier fecha pasada** (sin mínimo). Tope: anterior a hoy. |
| Faltante de lotes | **Avisar pero permitir**: si los lotes históricos no cubren los kg, mostrar aviso y dejar confirmar igual. |
| Reversión | **Anulable**: se puede borrar el registro + trazabilidad. No hay stock que restituir. |
| Borrador | **Sin borrador** ni reserva. Flujo rápido; si se sale, se pierde. |

## Contexto del código actual

Flujo de confirmación normal (`confirmProduction`, ~`produccion.js:9665-9786`):

1. `applyPlanOnInventory(..., 'consume')` → descuenta stock de ingredientes (FEFO).
2. `writeInventoryRecordsForPlans(inventarioNext, revalidated)` → persiste inventario.
3. Escribe `registro` en `/produccion/registros/${id}` → **trazabilidad**.
4. `publishPublicTrace(registro)` → página pública / QR → **trazabilidad**.
5. `appendRecipeMovement(recipe.id, { type: 'ingreso', ... })` → suma stock al producto.
6. Escribe `productIndex` del producto en reparto.

**Lote antiguo mantiene 3 y 4; saltea 1, 2, 5, 6.**

Datos relevantes:
- `state.sinTrazabilidad` (`produccion.js:75`) es el patrón a espejar para el flag nuevo.
- `renderEditor(recipeId, options)` (`produccion.js:8498`) renderiza el editor; recibe
  `options.sinTrazabilidad`. Agregar `options.loteAntiguo`.
- `buildPlanForRecipe(recipe, qtyKg, productionDateIso, options)` (`produccion.js:1839`)
  arma el plan con asignación FEFO sobre stock disponible a la fecha. Agregar modo
  `loteAntiguo` que asigne desde entries históricos ignorando `availableQty`.
- Filtro de estado de lote ya existente (`analyzeRecipe` / `allocateAcrossFefoGroup`):
  `expired` si `expiry < productionDateIso`, `future` si `entryDate > productionDateIso`,
  `ok` en otro caso. La ventana histórica = entries con estado `ok` a la fecha vieja.
- Menú tres puntitos: `produccion.js:8276-8296`. El item nuevo va junto a
  `data-produce-sin-trazabilidad` (`8281`).

## Diseño

### 1. Entrada en el menú (tres puntitos)

En `produccion.js` ~`8281`, agregar item bajo "Producir sin trazabilidad":

```html
<button type="button" class="produccion-more-item" data-produce-lote-antiguo="${recipe.id}">
  <span class="produccion-more-item-icon"><i class="bi bi-calendar-minus"></i></span>
  <span class="produccion-more-item-body">
    <span class="produccion-more-item-label">Producir lote antiguo</span>
    <span class="produccion-more-item-desc">Producción retroactiva, sin tocar stock</span>
  </span>
</button>
```

Handler (junto al de `data-produce-sin-trazabilidad`): abre
`renderEditor(recipeId, { loteAntiguo: true })`.

### 2. Estado

- Nuevo flag `state.loteAntiguo` (default `false`), reseteado al salir del editor
  (junto a donde se resetea `state.sinTrazabilidad`, p.ej. `9841` y back).
- `renderEditor` setea `state.loteAntiguo = !isViewOnly && Boolean(options.loteAntiguo)`.

### 3. Editor en modo retroactivo

- **Banner** naranja (similar a `produccion-sin-traz-banner`): "Modo lote antiguo —
  producción retroactiva. No descuenta stock ni registra en producto/ingredientes."
- **Input de fecha**: `max` = ayer (cualquier fecha pasada). Sin mínimo.
- **Cantidad**: libre, sin tope por stock (como `sinTrazabilidad`, `editorMaxKg` alto).
- Sin reserva ni borrador: no llamar a `saveEditorDraft` / `releaseReservation` en
  este modo; el botón "Guardar borrador" no aplica.

### 4. Selección de lotes (ventana histórica)

`buildPlanForRecipe` en modo `loteAntiguo`:
- Para cada ingrediente, considerar los `entries` cuyo estado a `productionDateIso`
  sea `ok`: `entryDate <= productionDateIso && (expiry >= productionDateIso || no perecedero)`.
- **Ignorar `availableQty`**: usar la cantidad original del lote (`entry.qty`), porque
  lotes ya consumidos persisten como entries con disponible 0 pero siguen siendo
  válidos para la trazabilidad histórica.
- Asignar esos lotes al `ingredientPlan.lots` para alimentar la trazabilidad.
- No marcar conflictos por stock; sólo computar si los lotes cubren los kg (ver 5).

### 5. Faltante de lotes (avisar pero permitir)

- Si la suma de lotes históricos de un ingrediente no cubre los kg requeridos,
  mostrar aviso no bloqueante en el editor y en el resumen de confirmación
  ("Los lotes de esa fecha no cubren X kg de {ingrediente}").
- `canConfirm` **no** se bloquea por este faltante en modo lote antiguo.

### 6. Confirmación retroactiva

Rama dedicada en `confirmProduction` cuando `state.loteAntiguo`:

- Construir `registro` igual que el normal, más:
  - `loteAntiguo: true`
  - `status: 'confirmada'`
  - `traceability`, `publicTraceUrl`, `lots` (snapshot histórico)
- Persistir:
  - ✅ `dbLaJamoneraRest.write('${REGISTROS_PATH}/${productionId}', registro)`
  - ✅ `publishPublicTrace(registro)`
  - ✅ `dbLaJamoneraRest.write(SEQUENCE_PATH, nextSequence)` (mismo esquema de ID)
  - ✅ `appendAudit({ action: 'produccion_lote_antiguo', ... })`
- **Saltear**:
  - ❌ `applyPlanOnInventory` / `applyPendingExpiryActionsOnInventory`
  - ❌ `writeInventoryRecordsForPlans`
  - ❌ `appendRecipeMovement` (no suma stock al producto)
  - ❌ `productIndex`
  - ❌ reserva/borrador (`releaseReservation`, `discardDraft`)
- Planilla: se genera on-demand desde el registro con el botón existente, sin
  cambios — el registro alimenta `planilla_produccion.js` como cualquier otro.

### 7. Historial y badge

- El registro aparece en el historial de producción normal.
- Badge "Lote antiguo" donde se listan los registros (espejar el patrón de badges
  existente, p.ej. junto al estado de la producción), condicionado a
  `registro.loteAntiguo`.

### 8. Anulación

- Permitir anular un registro `loteAntiguo` desde el mismo flujo de anulación
  existente, pero en la rama de anulación **saltear** el
  `applyPlanOnInventory(..., 'restore')` (`produccion.js:7531/7636`) cuando
  `registro.loteAntiguo` es true — no hay stock que restituir.
- La anulación borra/marca el registro y su trazabilidad pública.

## Unidades y límites

- **Menú + handler**: dispara el modo. Depende sólo de `renderEditor`.
- **`renderEditor` (modo loteAntiguo)**: UI + validación retroactiva. Depende de
  `buildPlanForRecipe` y del estado.
- **`buildPlanForRecipe` (modo loteAntiguo)**: asignación de lotes históricos.
  Pura sobre `state.inventario`. Testeable en aislamiento (entries de prueba +
  fecha vieja → lots esperados).
- **`confirmProduction` (rama loteAntiguo)**: persistencia selectiva. Depende del
  registro construido; no toca inventario.
- **Anulación (rama loteAntiguo)**: saltea restitución de stock.

## Riesgos / notas

- Lotes consumidos hace tiempo pueden haber sido **purgados** del inventario; en
  ese caso no aparecerán (limitación aceptada — la fuente es el inventario actual).
- El vencimiento del producto (`productionDate + shelfLife`) caerá en el pasado;
  es correcto para documentación retroactiva.
- Asegurar que `state.loteAntiguo` se resetee en todas las salidas del editor para
  no contaminar una producción normal posterior.
