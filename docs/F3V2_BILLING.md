# F3 v2 — Facturación de Hubs con Stripe

**Fecha:** 27 de agosto de 2026
**Estado:** F3 v2 COMPLETA — fases 1, 2 y bloque C (informes). Planes + suscripción + cobro de excedente + nudge 80% + escalación de mora + informes consolidados.

---

## 1. Arquitectura en una pantalla

```
hub_plans (Mongo, ms hubs)  ←  FUENTE DE VERDAD de límites y precios de exhibición
        │  applyPlanToHub() — único camino de escritura
        ▼
hub.subscription.limits     ←  snapshot desnormalizado (camino caliente de cada pedido)

Stripe ──webhook──▶ payments ──PATCH interno──▶ hubs (aplica plan + snapshot)
   ▲                                              ▲
   └── checkout/portal ◀── hubs ◀── /hub-admin/plan (HUB_OWNER)
```

- **La bifurcación por sujeto ocurre en el switch del webhook, ANTES de los handlers de negocio.** Un evento de hub jamás entra a la ruta SAAS/WL (cuyo mapeador degrada lookup keys desconocidos a "gratis").
- Detección de evento de hub: `metadata.hubId` (lo escribe nuestro checkout) o prefijo `hub_` en el lookup key, con fallback al registro local y al metadata del customer.
- Un **plan negociado** para un hub nuevo = 1 documento en `hub_plans` (`isPublic: false`) + 1 price en Stripe. **Cero deploys.**

## 2. Checklist en Stripe (lo haces tú en el dashboard, una vez)

### Trato de Oe Ya (HUB_PILOTO): 7 días gratis → $149 → $199 al mes 7

1. **Producto** "Ordena Hub — Piloto" con DOS precios (los precios en Stripe son inmutables — no se edita, se crean dos):
   - `hub_piloto_monthly_v1` → **US$149/mes** (lookup key exacto)
   - `hub_piloto_monthly_v2` → **US$199/mes** (lookup key exacto)
2. El operador entra a `/hub-admin/plan` → "Elegir plan" → paga el checkout (el trial de 7 días lo pasa el backend con `trial_period_days`; la tarjeta se pide desde el registro con `payment_method_collection: 'always'` para que el día 8 no falle el cobro).
3. Tras el checkout, en Stripe: abrir la suscripción → **convertirla en Subscription Schedule** con dos fases:
   - Fase 1: price `..._v1` ($149) · 6 iteraciones mensuales
   - Fase 2: price `..._v2` ($199) · indefinida
   Stripe hace la transición solo en el mes 7. El webhook recibe el mismo `customer.subscription.updated` de siempre; como **ambos lookup keys apuntan al MISMO plan** (`HUB_PILOTO` los lista los dos en `lookupKeys`), los límites no cambian y no hay código que tocar.

### Plan estándar (HUB_STANDARD, $199 — "a los demás sí completo")

- Un producto con un price `hub_standard_monthly_v1` a US$199/mes.

### Plan negociado futuro (ej. "HUB_ACME")

1. Documento en `hub_plans` (copiar HUB_PILOTO como plantilla, `isPublic: false`, sus límites).
2. Producto + price en Stripe con lookup key `hub_acme_monthly_v1` (el prefijo `hub_` es OBLIGATORIO — es lo que bifurca el webhook).
3. El hub entra a `/hub-admin/plan` → como el plan no es público no aparece en la vitrina; darle el checkout por link directo o marcarlo `isPublic: true` temporalmente. (Alternativa simple: crear la suscripción desde Stripe con `metadata.hubId`.)

> ⚠️ **Regla de oro de los lookup keys:** todos los de hub empiezan con `hub_`, y NINGÚN plan CORE debe empezar así. Es el discriminador del webhook.

## 3. Qué quedó implementado (fase 1)

| Pieza | Dónde |
|---|---|
| Catálogo `hub_plans` (fuente de verdad, multikey unique en lookupKeys) | `hubs/src/models/hubPlanModel.ts` |
| Seed idempotente (HUB_PILOTO + HUB_STANDARD; montos editables en Mongo) | `hubs/src/scripts/seedHubPlans.ts` → `npx ts-node src/scripts/seedHubPlans.ts` |
| `applyPlanToHub` (único camino de escritura del snapshot) | `hubs/src/utils/applyHubPlan.ts` |
| PATCH interno `/api/hubs/internal/:hubId/subscription` (fail-closed) | `hubs/src/controllers/hubBilling.controller.ts` |
| Catálogo público `GET /api/hubs/plans` + `GET /me/billing` + checkout/portal (HUB_OWNER) | `hubs/src/routes/hubBilling.routes.ts` |
| Bifurcación por sujeto en el webhook + handlers de hub (paid/failed/updated/deleted/checkout) | `payments/src/webhooks/stripeWebhook.ts` |
| `POST /api/stripe/hub/create-checkout-session` y `/hub/create-portal-session` (internos, x-ordena-secret) | `payments/src/controllers/stripeHub.controller.ts` |
| `stripe_subscriptions` gana `subjectKind` ('BUSINESS' default / 'HUB') + `hubId` | `payments/src/models/stripeSubscription.model.ts` |
| Rotación mensual del contador AHORA ATÓMICA (pipeline update condicionado) | `hubs/src/controllers/hubs.controller.ts` |
| Excedente de negocios SIN bloquear (solo `businessesHardCap` frena) | `hubs/src/controllers/hubBusinesses.controller.ts` |
| Página `/hub-admin/plan` (uso, barras, excedente proyectado, vitrina, portal) | `frontend/src/app/hub-admin/(portal)/plan/page.tsx` |

**Decisión de mora (implementada):** `past_due` solo marca `PAST_DUE` y muestra el banner en el panel — **la operación pública de los N negocios nunca se toca** por la tarjeta del operador.

## 4. Envs nuevas (payments)

| Env | Valor |
|---|---|
| `HUBS_SERVICE_LINK` | `http://<hubs>:3013/api` |
| `INTERNAL_HUBS_SECRET` | el MISMO valor que en hubs/business/orders/products |
| `HUB_APP_SUCCESS_URL` | `https://<host>/hub-admin/plan?checkout=success` |
| `HUB_APP_CANCEL_URL` | `https://<host>/hub-admin/plan?checkout=cancel` |

(hubs no necesita envs nuevas: reutiliza `PAYMENTS_SERVICE_LINK` + el secreto.)

**Pasos de deploy adicionales:** correr `npx ts-node src/scripts/seedHubPlans.ts` en hubs (una vez por entorno) y crear los prices en Stripe (§2) antes de probar el checkout.

## 5. Fase 2 — IMPLEMENTADA (27/08/2026)

Decisiones cerradas con el usuario: pedido facturable = **creado** · negocios extra **al ledger mensual** (no subscription item) · mora día 15 = **bloquear solo crear negocios/usuarios**.

- **Ledger `hub_usage_ledgers`** (único `{hubId, period}`): sella lo facturable de cada período de suscripción cerrado. La cifra sale de RE-CONTAR orders (summary interno, filtros espejo) — nunca del contador. Incluye pedidos extra Y negocios extra en la misma línea.
- **Cobro en `invoice.upcoming`**: payments sella el ledger (claim interno a hubs), crea el invoice item en la factura que viene y marca INVOICED. **Doble idempotencia**: status del ledger + idempotency key de Stripe `hub-overage-{hubId}-{period}` — un retry jamás duplica el cargo.
- **Nudge del 80%**: claim atómico mensual en hubs (`nudge80MonthKey`) + envío desde orders con la plantilla `uso_hub_es` (⚠️ crearla en Meta como Utility — texto y variables en `PLANTILLAS_REPARTIDOR_Y_HUB.md` §4b). Env opcional: `TEMPLATE_HUB_USAGE_ES`.
- **Escalación de mora**: `subscription.pastDueSince` lo sella/limpia el PATCH interno; a los 15 días de mora se bloquea SOLO crear negocios y usuarios (403 con `reason: past_due_lock`). Storefronts y pedidos jamás se tocan.
- El panel `/me/billing` ahora devuelve también `lastLedger` (último período cerrado) para que la factura nunca sorprenda.

## 6. Bloque C — Informes (IMPLEMENTADO 27/08/2026)

- **ms-reportes** (primer cambio de ese repo en la rama): `hubReportService` APARTE del de negocios (cero riesgo de regresión), agrupa por `hub_id` con los mismos filtros espejo y `$toDouble` sobre `total_amount`. Rutas `/api/reports/hub/:hubId/overview` y `/customers/summary`, guard `x-ordena-secret` FAIL-CLOSED (el tenantMiddleware de Firebase no aplica), montadas ANTES de las rutas generales.
- **hubs**: proxy `GET /api/hubs/me/reports/*` con roles de hub (el BUSINESS_VIEWER queda fuera; su resumen vive en el Portal). La zona horaria del cálculo es la del HUB.
- **frontend**: `/hub-admin/informes` — KPIs con tendencia, serie de ventas, por negocio, top productos, métodos de pago, mejores clientes (7/30/90 días).
- **Envs nuevas**: reportes → `INTERNAL_HUBS_SECRET` (mismo valor que el resto); hubs → `REPORTS_SERVICE_LINK` (`http://<reportes>:3010/api`).

## 7. Pendiente (menor, no bloquea)

- Sincronía de `quantity` para negocios extra (subscription item con proration) — solo si algún hub escala mucho; el ledger mensual ya los cobra.
- Script `reapplyHubPlans` para propagar cambios de catálogo a los snapshots.
- Export CSV/Excel de los informes del hub (los de negocio ya existen; portar cuando se pida).
