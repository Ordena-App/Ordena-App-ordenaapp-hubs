# Plan de F3 v2 (comercial) y F4 — Ordena Hub

> Generado por el arquitecto de la auditoría del 26/08/2026 (ver `AUDITORIA_F2_F3V1.md`).
> Las decisiones marcadas como "recomendación" están abiertas hasta que el equipo las confirme.



---

# F3 v2 — Comercial

## 1. Lo que ya existe y se reutiliza sin tocar

| Pieza | Ubicación | Qué aporta |
|---|---|---|
| `hub.subscription.limits` + `hub.usageMetrics` | `ordenaapp-hubs/src/models/hubModel.ts:57-85, 110-118` | Contrato ya definido: `businessesIncluded`, `ordersPerMonth`, `extraBusinessPrice`, `extraOrderPrice`, contadores + `extraOrdersCurrentMonth` |
| Contador de pedidos del hub | `ordenaapp-hubs/src/controllers/hubs.controller.ts:175-249` + `ordenaapp-orders/src/service/businessUsage.service.ts:103-136` | Rota el mes, incrementa y **ya calcula `isExtra`**. Nadie consume `isExtra` todavía: eso es exactamente el hueco de F3 v2 |
| Webhook de Stripe completo | `ordenaapp-payments/src/webhooks/stripeWebhook.ts` | `invoice.paid` (create/cycle/update), `payment_failed`, `subscription.updated/deleted`, `invoice.upcoming`, verificación de firma. Solo hay que meterle una rama por sujeto |
| `isHubKey()` | `ordenaapp-payments/src/lib/businessPlan.ts:44-59` | Ya sabe distinguir un hubId de un businessId leyendo la colección `hubs` de la DB compartida |
| Resolver de planFeatures HUB_MANAGED | `ordenaapp-business/src/utils/resolvePlanFeaturesForBusiness.ts:135-142` | Los negocios del hub ya nacen permisivos: ningún gate per-business los va a bloquear cuando el plan del hub cambie |
| Patrón de "plan como documento" | `ordenaapp-business/src/models/planModel.ts` (colección `plans`) + `src/utils/corePlanFeatures.ts` | El molde exacto de lo que pide el usuario: límites en DB, código que solo los lee |
| Nudge del 80 % | `ordenaapp-business/src/services/orderLimitNudge.service.ts` | Reclamo atómico del mes con `findOneAndUpdate` para no mandar dos avisos. Se clona tal cual para el hub |
| Resumen agregado del hub | `ordenaapp-orders/src/controllers/orders.controller.ts:3843-3947` (`getHubOrdersSummaryInternal`) | `totals`, `byStatus`, `byBusiness`, `topProducts` ya salen de un `$facet`. Es la base de los reportes |
| Proxy `/api/hubs` público con JWT propio | `ordenaapp-api-gateway/src/app.ts:104, 296, 563-565` | Cualquier endpoint nuevo bajo `/api/hubs` **no necesita tocar el gateway** |
| Cliente HTTP del dashboard | `ordenaapp-frontend/src/app/hub-admin/_lib/hubApi.ts` | Bearer + 401 → login. Solo se le agregan funciones |

## 2. Decisiones que faltan (con mi recomendación)

**2.1 ¿Dónde viven los planes del hub?**
→ **Colección nueva `hub_plans` en `ordenaapp-hubs`**, no en `plans` de business. `plans` tiene `code` con enum `["FREE","BASIC","PRO","ENTERPRISE"]` y `unique` (`planModel.ts:5`): meter tiers de hub ahí obliga a mutar un enum de producción de otro producto. Además el hub tiene límites que un negocio no tiene (`businessesIncluded`).

**2.2 ¿`hub.subscription.limits` se elimina en favor del plan?**
→ **No: se conserva como snapshot desnormalizado.** `incrementHubOrderUsage` lee `hub.subscription.limits.ordersPerMonth` (`hubs.controller.ts:219`) en el camino caliente de cada pedido. Que el plan sea la fuente de verdad significa *"se edita en un solo lugar"*, no *"se hace un join por pedido"*. El snapshot se reescribe **solo** cuando el webhook cambia el plan. Fuente de verdad = `hub_plans`; caché = `subscription.limits`.

**2.3 ¿Un endpoint de checkout nuevo en payments o se reutiliza el de negocios?**
→ **Endpoint nuevo, y expuesto a través de `ordenaapp-hubs`, no del gateway.** El de negocios está atado a `businessId` en tres capas: `validateBusinessId` (`stripe.routes.ts:19`), validación explícita (`stripe.controller.ts:86-89`) y `customers.search({query: "metadata['businessId']:'…'"})` (`stripe.controller.ts:103-105`). Sobrecargarlo es garantía de bug. Y si el endpoint de hub se cuelga del gateway hay que abrir una policy pública nueva — ruta a la que cualquiera podría pegarle con un hubId ajeno. Colgándolo de `/api/hubs/me/billing/*` con `verifyHubJWT` + `requireHubRole("HUB_OWNER")`, el hubId sale del token y no del request. Cero cambios en el gateway.

**2.4 ¿Cómo se implementa "mes 1 gratis → $149 → $199" para Oe Ya?**
→ **Trial de Stripe de 30 días sobre un price propio `hub_piloto_monthly_v1` de $149**, y el salto a $199 se hace **a mano en Stripe** cuando toque (un solo cliente). No construyas un ramp de precios programado para un caso único. Dos cosas ya juegan a favor: `mapStripeStatusToBusinessStatus` mapea `trialing → ACTIVE` (`stripeWebhook.ts:29-32`), y `hub.subscription.status` ya acepta `"TRIAL"`. El cambio de precio dispara `customer.subscription.updated`, que ya tiene la rama de cambio de plan (`stripeWebhook.ts:524-537`).
No uses el mecanismo de `COUPON_PRIMER_MES` / `PROMO_PRIMER_MES` (`payments/src/config.ts:32-39`): está cableado a lookup keys de CORE y a `isEligibleForPrimerMes`, que consulta `getStripeInfoByBusinessId`.

**2.5 ¿Cómo se cobra el excedente de pedidos?**
→ **En mora (arrears), por invoice item, sobre el período YA cerrado, y con el monto reconstruido desde `orders`, no desde el contador.** `runHubUsageIncrement` es best-effort con un retry (`orders.controller.ts:272-280`); un fallo permanente pierde un pedido facturable en silencio. El contador sirve para pintar la barra de uso en el dashboard; **la factura se arma re-contando `orders` por `hub_id` + rango**. El invoice item se crea en `invoice.upcoming` (evento ya suscrito, `stripeWebhook.ts:866-872`).

**2.6 ¿Cómo se cobran los negocios de más?**
→ **Subscription item con `quantity`** (es la decisión #3 del `EVALUACION_MODO_MULTINEGOCIO.md` §2 y es la correcta: un negocio extra es costo recurrente, no un consumo puntual), con `proration_behavior: 'create_prorations'`. Se sincroniza al crear/eliminar un negocio por encima de `businessesIncluded`.

**2.7 ¿Qué pasa cuando el hub cae en `past_due`?**
→ **La operación pública NO se toca, nunca.** Tumbar el storefront del hub castiga a N negocios y a sus clientes finales por la tarjeta de un tercero — es el mismo error que ya se corrigió en CORE cambiando el 403 por `held_by_limit` (`orders.controller.ts:1359-1379`). Recomendación concreta: banner duro en `/hub-admin` desde el día 1 de mora; a partir del día 15, se bloquea **crear negocios y crear usuarios**, nada más. `hub.status` sigue `ACTIVE` (ese campo es para suspensión manual por abuso, no para mora).

**2.8 ¿Plan anual?**
→ **No por ahora.** Un solo ciclo mensual. `billingCycle` ya está en el modelo y el webhook ya lo propaga; agregar `hub_*_yearly_v1` después es media hora.

**2.9 ¿El `BUSINESS_VIEWER` ve reportes del hub?**
→ **No.** Su resumen propio ya existe en `/hub-portal`. Las rutas `/me/reports/*` van con `requireHubRole("HUB_OWNER","HUB_ADMIN","HUB_STAFF")`. Además `getMyHub` ya le recorta suscripción y métricas (`hubs.controller.ts:62-66`): mantener esa línea.

**2.10 ¿`isTestHub` factura?**
→ **No.** Todo job de facturación y de sincronía de quantity filtra `isTestHub: { $ne: true }`.

## 3. Orden de implementación

### Paso 1 — `ordenaapp-hubs`: el plan como fuente de verdad

1. `src/models/hubPlanModel.ts` (colección `hub_plans`):
   ```
   { code: 'HUB_PILOTO'|'HUB_STARTER'|'HUB_PRO'|'HUB_SCALE' (unique),
     name, price, currency: 'USD',
     lookupKeyMonthly,            // 'hub_pro_monthly_v1' — unique sparse
     limits: {
       businessesIncluded, ordersPerMonth,
       extraBusinessPrice, extraOrderPrice,
       overageAllowed: true, businessesHardCap,
       upgradeNudgeThreshold: 0.8,
       hubUsersLimit, productsPerBusiness
     },
     isPublic: Boolean,           // false para HUB_PILOTO (Oe Ya no aparece en la vitrina)
     is_active, created_at, updated_at }
   ```
   Convención idéntica a la del catálogo: `-1` = ilimitado, `0` = bloqueado.
2. `src/scripts/seedHubPlans.ts` — semilla idempotente por `code`. `HUB_PILOTO` a $149 con `lookupKeyMonthly: 'hub_piloto_monthly_v1'`.
3. `src/utils/applyHubPlan.ts` — `applyPlanToHub(hubId, plan, {status, period, billingCycle})`: escribe `subscription.planRef.{kind:'HUB_PLAN', code, lookupKey}` **y** vuelca `plan.limits` en `subscription.limits` (el snapshot de 2.2).
4. `src/routes/hubs.routes.ts`: `GET /plans` público (catálogo con `isPublic: true`) para pintar la página de planes sin hardcodear precios.

### Paso 2 — `ordenaapp-payments`: el webhook aprende a distinguir el sujeto

5. `src/models/stripeSubscription.model.ts`: agregar `hubId: { type: String, index: true, sparse: true }` y `subjectKind: { type: String, enum:['BUSINESS','HUB'], default:'BUSINESS' }`; relajar `businessId` a `required: function(){ return this.subjectKind !== 'HUB' }` (hoy es `required: true`, línea 17-21). Nuevos métodos en `src/services/stripe.service.ts`: `getStripeInfoByHubId`.
6. `src/webhooks/helpers/stripe-webhook.helpers.ts`: `export const isHubLookupKey = (k: string) => /^hub_/i.test(k)` y una `mapHubLookupKey()`. **Crítico:** `mapLookupKeyToPlan` hace `default: return { plan: 'gratis' }` (líneas 27-28); si un lookup key de hub llega a la rama de negocio, degrada una tienda a gratis. La bifurcación por sujeto tiene que ocurrir **antes** de llamar a `mapLookupKeyToPlan`.
7. `src/webhooks/stripeWebhook.ts`: extraer un `resolveSubject(invoice|subscription): {kind:'BUSINESS'|'HUB', id}` que use `metadata.hubId` → `subscription.metadata.hubId` → `customer.metadata.hubId` → `getStripeInfoByHubId`, con la misma cascada de fallbacks que ya hace para `businessId` (líneas 220-268). Bifurcar los 4 handlers: `handleInvoicePaid`, `handleSubscriptionUpdated`, `handleSubscriptionDeleted`, `handleInvoiceUpcoming`.
8. `src/externals/hubs.external.ts` (nuevo): `patchHubSubscription(hubId, payload)` → `PATCH ${HUBS_SERVICE_LINK}/hubs/internal/:hubId/subscription` con `x-ordena-secret`. Es el espejo de `updateBusinessPlan` (líneas 47-113).
9. `src/controllers/stripe.controller.ts`: `createHubCheckoutSession` y `createHubPortalSession` (`metadata.hubId`, `customers.search` por `metadata['hubId']`). `src/routes/stripe.routes.ts`: `POST /hub/create-checkout-session`, `POST /hub/create-portal-session`, **protegidos por `x-ordena-secret`** (los llama hubs, no el navegador).
10. `src/config.ts`: `HUBS_SERVICE_LINK`, `INTERNAL_HUBS_SECRET`, `HUB_APP_SUCCESS_URL`, `HUB_APP_CANCEL_URL`. Ojo: `APP_SUCCESS_URL` trae el placeholder `:businessId` (se usa así en `stripeWebhook.ts:762`) — no sirve para el hub.

### Paso 3 — `ordenaapp-hubs`: endpoints de billing

11. `src/routes/hubBilling.routes.ts` (archivo propio; no lo apiles en `hubOrders.routes.ts`, que ya carga los `payment-accounts` en las líneas 45-63):
    - `PATCH /api/hubs/internal/:hubId/subscription` — interno, `isValidInternalCall` (mismo guard fail-closed de `hubs.controller.ts:163-167`). Busca el `hub_plans` por `lookupKey` y llama `applyPlanToHub`.
    - `GET /api/hubs/internal/:hubId/billing/overage?period=YYYY-MM` — interno, devuelve lo facturable del período cerrado.
    - `POST /api/hubs/me/billing/checkout-session` (`HUB_OWNER`) → proxy a payments.
    - `POST /api/hubs/me/billing/portal-session` (`HUB_OWNER`).
    - `GET /api/hubs/me/billing` (`HUB_OWNER`/`HUB_ADMIN`) — plan actual, límites, uso, excedente proyectado del mes.
12. `src/app.ts`: `app.use('/api/hubs', hubBillingRoutes)`.

### Paso 4 — Excedente sin bloquear

13. **Quitar el bloqueo duro de negocios.** `src/controllers/hubBusinesses.controller.ts:63-72` devuelve 403 al llegar a `businessesIncluded`. Reemplazar por: permitir; si `count >= businessesIncluded`, `$inc usageMetrics.extraBusinessesCount` y disparar la sincronía del subscription item. Bloquear **solo** si `count >= limits.businessesHardCap`.
14. `src/models/hubUsageLedgerModel.ts` (colección `hub_usage_ledgers`), calcado de `ordenaapp-agencies/src/models/agencyBusinessLedger.ts`:
    ```
    { hubId, period:'YYYY-MM',
      ordersTotal, ordersIncluded, extraOrders, extraOrderPrice, extraOrdersAmount,
      extraBusinesses, extraBusinessPrice,
      totalAmount, currency,
      status:'DRAFT'|'INVOICED'|'PAID',
      stripeInvoiceItemId, computedAt }
    índice único { hubId, period }   ← la idempotencia de la factura
    ```
15. `src/services/hubUsageReconcile.service.ts`: recuenta desde `orders` vía `GET /internal/hub/:hubId/summary?from=&to=` (`orders.routes.ts:41`) y sella el ledger. **Este número, no `usageMetrics`, es el que se factura** (decisión 2.5).
16. `src/services/hubLimitNudge.service.ts`: clon de `ordenaapp-business/src/services/orderLimitNudge.service.ts` con el reclamo atómico mensual; avisa al WhatsApp del hub (`hub.contact.whatsapp`) al cruzar `upgradeNudgeThreshold`. Requiere plantilla Meta Utility nueva — documéntala en `ordenaapp-whatsapp-bot/PLANTILLAS_REPARTIDOR_Y_HUB.md`.
17. `src/services/stripeItems.service.ts`: `syncExtraBusinessQuantity(hubId)` → payments → `stripe.subscriptionItems.update`.

### Paso 5 — `invoice.upcoming` cobra el excedente

18. En `handleInvoiceUpcoming` (`stripeWebhook.ts:676-786`), rama `subject.kind === 'HUB'`: pide el ledger del período cerrado a hubs, y si `totalAmount > 0` crea `stripe.invoiceItems.create({customer, amount, currency, description: 'Excedente <period>: N pedidos extra'})`. Idempotencia por `stripeInvoiceItemId` en el ledger. Respeta la estructura de dos zonas que ya tiene ese handler (evaluación que nunca lanza / envío que sí lanza para que Stripe reintente).

### Paso 6 — Reportes en `ordenaapp-reportes`

19. `src/models/orderModel.ts`: agregar `hub_id: { type: String, default: null }`. El índice real ya vive en orders (`orderModel.ts:531-534`, parcial sobre `hub_id`); este modelo solo lee la colección compartida.
20. `src/routes/hubReportRoutes.ts` (nuevo, **no** usa `tenantMiddleware`): `reportRoutes.ts:10` hace `router.use(tenantMiddleware)` y ese middleware exige un ID token de Firebase válido cuyo email sea dueño del negocio (`src/middleware/tenantMiddleware.ts`) — el JWT del hub jamás pasaría. Guard nuevo por `x-ordena-secret`, montado en `/api/reports/hub`, llamado solo server-to-server desde hubs.
    Endpoints: `GET /hub/:hubId/overview`, `/sales/timeseries`, `/businesses/top`, `/products/top`, `/customers/summary`, `/payment-methods`, `/export`.
21. `src/services/reportService.ts`: las agregaciones existentes cambian `{ bussiness_id }` por `{ hub_id }` conservando los filtros espejo (`deleted`, `is_draft`, `held_by_limit`) que ya usa `getHubOrdersSummaryInternal`.
22. hubs: `src/services/reportsService.external.ts` + rutas `GET /api/hubs/me/reports/*` con `requireHubRole` (decisión 2.9).
23. `ordenaapp-api-gateway`: **sin cambios**. Todo entra por `/api/hubs`, que ya es público con JWT propio.

### Paso 7 — Frontend

24. `src/app/hub-admin/(portal)/plan/page.tsx` — plan actual, barras de uso (`usageMetrics` vs `subscription.limits`), excedente del mes, "Cambiar plan" → checkout, "Gestionar facturación" → portal de Stripe. **Los números salen de `GET /api/hubs/me/billing` y `GET /api/hubs/plans`**; en el frontend solo copy. No repliques `src/config/plans-config.ts` (2.2: un solo lugar).
25. `src/app/hub-admin/(portal)/informes/page.tsx`.
26. `src/app/hub-admin/_components/HubPortalShell.tsx:25-32` — dos entradas nuevas en `NAV` (`/hub-admin/informes`, `/hub-admin/plan`) + claves en `src/lib/i18n/translations/hub-admin/{es,en}.ts`.
27. `src/app/hub-admin/_lib/hubApi.ts` — `getHubBilling`, `createHubCheckoutSession`, `createHubPortalSession`, `getHubReport*`.
28. Banner de mora: reutiliza el lenguaje visual de `src/components/specific/subscriptions/SubscriptionLimitBanner.tsx`.

## 4. Riesgos reales de F3 v2

1. **La rotación mensual del contador no es atómica.** `hubs.controller.ts:196-217` lee `hub.usageMetrics.lastRotatedAt`, decide, y luego escribe. Dos pedidos concurrentes en el cambio de mes pueden rotar los dos: el segundo pone `ordersCurrentMonth: 0` pisando el incremento del primero. Hoy es cosmético; con dinero encima deja de serlo. **Arréglalo en el Paso 1**: condiciona el `updateOne` (`{_id, "usageMetrics.lastRotatedAt": {$lt: inicioDeMesUTC}}`) para que solo un llamador gane. El re-conteo del Paso 15 lo tapa a efectos de factura, pero el dashboard mentiría.
2. **`mapLookupKeyToPlan` degrada a `'gratis'` por defecto.** Si un evento de hub cae por error en la rama de negocio con un `businessId` resoluble, `updateBusinessPlan` deja esa tienda en gratis. Bifurcar por sujeto antes del mapeo (Paso 6-7) no es estilo: es la mitigación.
3. **Snapshot de límites fail-open.** `hub.subscription.limits` nace en `-1` (ilimitado) por diseño (`hubModel.ts:70-75`). Si el `PATCH /internal/:hubId/subscription` falla, el hub queda ilimitado y gratis en silencio. Es el default correcto (coherente con `buildPermissiveDefaults`), pero **necesita log de error explícito + alerta**, no un fail-closed.
4. **Un solo webhook, un solo `STRIPE_WEBHOOK_SECRET`.** Los eventos de hub caen en el mismo endpoint. `handleInvoicePaid` hace `return` temprano cuando no encuentra `businessId` (líneas 260-267): con un evento de hub eso se traduciría en "factura pagada y plan nunca aplicado", sin ruido. La resolución de sujeto debe pasar antes de ese `return`.
5. **`runHubUsageIncrement` es best-effort.** `orders.controller.ts:272-280` + un retry. Ya cubierto por el re-conteo (2.5), pero solo si el re-conteo se implementa; si se factura desde `usageMetrics`, se pierde ingreso.
6. **`held_by_limit` no aplica a negocios de hub.** `resolveForHubManaged` devuelve permisivos, así que el gate de `orders.controller.ts:1349-1379` nunca dispara para ellos. Correcto y deseado — pero significa que el **único** freno del hub es el que construyas ahora. Sin `businessesHardCap`, un hub en mora puede crear 500 negocios.
7. **`isExtra` se calcula con el límite ya desnormalizado.** Si cambias un `hub_plans` a mano en Mongo sin reaplicarlo a los hubs, los snapshots quedan viejos. Deja el `applyPlanToHub` como único camino de escritura y un script `reapplyHubPlans.ts` para propagar cambios de catálogo.

---

# F4 — Dominio custom · Negocios existentes · Liquidaciones

Orden recomendado: **liquidaciones → dominio custom → afiliación de negocios existentes.** Las liquidaciones son el mayor valor para Oe Ya con riesgo de plataforma cero; la afiliación va última porque es la única con preguntas de producto y legales sin resolver.

## A. Estado de cuenta / liquidaciones del hub hacia sus negocios

Es el bloque más valioso y el mejor soportado por lo existente: el hub cobra centralizado (decisión #4 de la evaluación) y hoy liquida a sus tiendas **fuera del sistema**.

**Molde a copiar (invirtiendo la dirección — aquí el hub *debe* dinero, no lo cobra):**
`ordenaapp-agencies/src/models/agencyBusinessLedger.ts`, `src/models/agencyInvoices.ts`, `src/controllers/billing.controller.ts`, `src/routes/billing.routes.ts` (fíjate en `getInvoiceProjection` / `generateLedger` / `generateInvoice` / `payInvoice` y en el índice único `{agencyId, businessId, period}`, líneas 64-67).

**Modelo nuevo** `ordenaapp-hubs/src/models/hubSettlementModel.ts` (colección `hub_settlements`):
```
{ hubId, businessId, period:'YYYY-MM' | {from,to},
  grossSales, ordersCount,
  deductions: [{ concept:'commission'|'delivery'|'adjustment', rate?, amount, note }],
  netPayable, currency,
  lines: [{ orderId, date, total, paymentType, commissionAmount }],   ← SNAPSHOT
  status:'DRAFT'|'ISSUED'|'PAID'|'DISPUTED',
  issuedAt, paidAt, paidMethod, reference }
índice único { hubId, businessId, period }
```

**Config nueva en `hubModel.ts`** (junto a `businessVisibility`):
```
settlement: { commissionType:'percent'|'fixed'|'none', commissionValue,
              deliveryFeeOwner:'hub'|'business', payoutDay,
              includeOrderStatuses:[...], includePaymentStatuses:[...] }
```

**Endpoints:**
- `POST /api/hubs/me/settlements/generate` (`HUB_OWNER`/`HUB_ADMIN`), body `{period, businessId?}`
- `GET /api/hubs/me/settlements`, `GET /me/settlements/:id`, `PATCH /me/settlements/:id/status`
- `GET /api/hubs/me/settlements/:id/pdf`
- `GET /api/hubs/portal/settlements` — **BUSINESS_VIEWER**, solo el suyo. Este es el "estado de cuenta" que ve el negocio.
- `GET /internal/hub/:hubId/settlement-lines?businessId=&from=&to=&statuses=` en `ordenaapp-orders` (`src/routes/orders.routes.ts`, junto a las tres internas de las líneas 40-42): un `$group` por negocio, **no** pagines miles de pedidos por HTTP a través del listado existente.

**Decisiones (con recomendación):**
- *¿Qué pedidos entran?* → **Solo `order_status` entregado/completado Y `payment_status` pagado.** Nunca creados.
- *¿Se recalcula si un pedido cambia de estado después?* → **No: las `lines` se congelan al generar.** Misma filosofía que el snapshot de comisiones que ya corre en `applyCommissionSnapshotForOrder`. Un ajuste posterior entra como `deductions[{concept:'adjustment'}]` en el período siguiente, con nota.
- *¿Ordena mueve el dinero?* → **No.** El §48 lo excluye explícitamente y no hay Connect entre hub y negocio. El entregable es el documento + "marcar como pagado". Vender payouts automáticos aquí es meterse en licencias de dinero.
- *¿Qué ve el negocio en el PDF?* → Sus totales sí; **datos del cliente final, filtrados por la matriz de privacidad**. Reutiliza `stripOrderPII` (`ordenaapp-hubs/src/controllers/hubOrders.controller.ts:31-48`) sobre las `lines` antes de renderizar.

**Frontend:** `src/app/hub-admin/(portal)/liquidaciones/page.tsx` + entrada en `HubPortalShell.tsx:25-32`; y una pestaña "Estado de cuenta" en `src/app/hub-portal/`.

## B. Dominio custom del hub

**Ya existe y se reutiliza sin escribir código nuevo de infraestructura:**
- `hub.domain` con `requestedDomain / verifiedDomain / sslEnabled / status` — ya está en `hubModel.ts:41-55`, previsto desde F1.
- `ordenaapp-business/src/services/vercelDomain.service.ts`: `normalizeDomain` (:16), `addDomainToVercel` (:64), `getDomainInfoFromVercel` (:73).
- `GET /api/business/tenants/resolve` (`src/routes/whiteLabel.routes.ts:20`) y el caché de tenants del middleware.

**Decisión: ¿hubs duplica el token de Vercel o llama a business?**
→ **Llama a business.** Exponer `POST /api/business/internal/domains` y `GET /api/business/internal/domains/status?domain=` (guard `x-ordena-secret`, junto a los internos que ya existen ahí). Duplicar `VERCEL_TOKEN`/`VERCEL_PROJECT_ID` en un quinto servicio multiplica la superficie de un secreto de infraestructura sin ganar nada.

**Pasos:**
1. business: los dos endpoints internos de arriba.
2. hubs: `POST /api/hubs/me/domain` (`HUB_OWNER`), `GET /api/hubs/me/domain/status`, y público `GET /api/hubs/resolve-by-domain?host=`.
3. `ordenaapp-frontend/src/middleware.ts`: hoy la rama de hub solo entra por `getHubCandidateSlug` (~línea 106) y un host desconocido cae a `resolveTenant` (white-label). Agrega: si `resolveTenant` da 404, intenta `resolveHubByDomain(host)` antes de rendirse — una llamada extra **solo** en hosts desconocidos, cacheada en el `hubCache` que ya existe (líneas 111-140). Todo el bloque de reescritura (`/{negocio}` → `{seg}--{hubId6}`, líneas ~364-378) funciona igual bajo el dominio propio sin tocarse.
4. `ordenaapp-api-gateway`: **este es el punto que se olvida.** `isOrdenaSubdomainOrigin` (`src/app.ts:84-95`) solo confía en `*.ordena.app`; un `Origin: https://oeya.com` sería rechazado por CORS. `corsOptions` ya es **async** y ya hace una llamada externa (`resolveTenant`, líneas 259-278), así que la solución limpia encaja: agregar un fallback `resolveHubByDomain` cacheado en esa misma función. Para el piloto sirve un `ALLOWED_HUB_ORIGINS` por env; la resolución cacheada es la versión que escala. **El gateway no tiene Mongo** (verificado: `mongoose` no está en su `package.json`), así que no hay atajo por DB.
5. Cuando `domain.status === 'verified'`, **308 desde `{slug}.ordena.app` al dominio verificado** en el middleware. Si no, el mismo storefront queda indexable en dos hosts.

## C. Conectar negocios Ordena ya existentes a un hub

**Recomendación fuerte: no conviertas el `context`. Introduce una afiliación ligera.**

Convertir un negocio SAAS a `HUB_MANAGED` implica, todo junto: cancelarle su Stripe, reescribir `subscription.planRef`/`payer`, re-resolver `planFeatures`, y —lo que rompe de verdad— **cambiarle el `store_link`**, que es `unique` global (`businessModel.ts:106`) y que el middleware del hub espera namespaceado como `{slug}--{hubId6}` por reescritura **mecánica, sin lookup** (`src/middleware.ts:~364-378`). Ese link ya está en códigos QR impresos, estados de WhatsApp y en Google. Además el dueño tiene su dashboard con Firebase; los negocios de hub se administran desde `/hub-admin` con `BUSINESS_VIEWER`: quedan dos superficies de administración sobre el mismo negocio.

**Modelo propuesto — afiliación, no absorción.** En `businessModel.ts`, junto a `hubId`/`hubSlug` (líneas 120-126):
```
hubAffiliation: {
  hubId, hubSlug,
  status: 'PENDING'|'ACTIVE'|'REVOKED',
  invitedAt, acceptedAt, revokedAt,
  centralizedPayments: { type: Boolean, default: false },
  shareOrdersWithHub:  { type: Boolean, default: true }
}
```
El negocio conserva `context: 'SAAS'`, su plan, su Stripe, su `store_link`, sus métodos de pago y su dinero. El hub gana: aparece en su storefront agregado, puede etiquetarlo con `hubCategoryIds`, y ve sus pedidos si el negocio lo autoriza.

**Piezas a tocar:**
- `ordenaapp-business`: subschema + `POST /api/business/:id/hub-invite/accept` y `.../revoke` (**los ejecuta el dueño con su token de Firebase**, no el hub).
- `ordenaapp-hubs`: `src/models/hubInviteModel.ts` (token de un solo uso con expiración), `POST /api/hubs/me/businesses/invite`, `GET /me/invites`, `DELETE /me/invites/:id`.
- `ordenaapp-frontend`: pantalla de aceptación en el dashboard del negocio + UI de invitación en `src/app/hub-admin/(portal)/negocios/page.tsx`.
- `src/utils/hubPaymentsKey.ts`: hoy devuelve la key del hub con solo comparar `business.hubId === claimed`. Un negocio afiliado con `centralizedPayments: false` **debe seguir cobrando a su propia cuenta**. Ese archivo necesita consultar `hubAffiliation.centralizedPayments`, o un afiliado empezaría a mandarle su dinero al hub sin haberlo aceptado.
- `src/middleware.ts`: un afiliado legado **no** tiene el sufijo `--{hubId6}`, así que la reescritura mecánica lo manda a un 404. Necesita una excepción con lookup (cacheado) para el slug del afiliado.
- La conversión total SAAS → `HUB_MANAGED` sí debe existir, pero como endpoint **de soporte**, `POST /api/business/internal/:id/convert-to-hub-managed`, con doble opt-in del dueño, conservando el `store_link` original y cancelando el Stripe `at_period_end`. Es una migración rara, no un botón del dashboard.

## D. Riesgos reales de F4

1. **CORS del gateway con dominio custom** (B.4) — es el fallo silencioso clásico: la página carga, todas las llamadas API mueren. Verifícalo antes de anunciar la feature.
2. **SEO duplicado** entre subdominio y dominio propio si no se pone el 308 (B.5).
3. **Reescritura mecánica del middleware** — el diseño que hace el storefront del hub barato (sin lookups) es exactamente lo que rompe con negocios afiliados legados (C).
4. **`hubPaymentsKey` y el dinero del afiliado** (C) — un descuido aquí desvía cobros reales a la cuenta equivocada. Es la misma clase de bug que ya se corrigió en la auditoría (hallazgo #5 del `DEPLOY_STAGING_MVP.md`).
5. **Liquidación sobre datos vivos** — si las `lines` no se congelan, un cambio de estado de un pedido reescribe una liquidación ya pagada y el hub pierde la trazabilidad de por qué pagó lo que pagó.
6. **PII en el PDF de liquidación** — el filtro de privacidad es server-side por diseño (`hubOrders.controller.ts:31-48`); un generador de PDF que lea los pedidos por su cuenta se lo salta.
7. **Ambigüedad de propiedad del cliente en la afiliación** — es una pregunta de producto, no técnica, y conviene cerrarla antes de escribir código: si un cliente compra en un negocio afiliado desde el storefront del hub, ¿de quién es ese cliente en los reportes de cada uno? Recomendación: **de ambos**, sin deduplicar, y que cada reporte lo cuente en su propio scope.