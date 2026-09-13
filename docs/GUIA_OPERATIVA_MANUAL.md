# Guía operativa — pasos manuales para staging/producción (Modo Multi-Negocio)

**Fecha:** 2026-09-01 · **Actualizada:** 2026-09-08 (delivery **por distancia**:
§2 `ORS_API_KEY`, §3 orden de deploy, §4b migración de planes, §8 punto 14) ·
**Alcance:** todo lo que NO se hace con código: Meta
(WhatsApp), Stripe, Vercel/DNS, variables de entorno, seed de Mongo y orden de
despliegue. Cada dato de esta guía fue verificado contra el código de los repos
(rama `feature/new-mode-ordena-hub`).

**Orden recomendado:** §1 secreto → §2 envs → §3 deploy → §4 seed Mongo →
§5 Stripe → §6 Meta → §7 Vercel/DNS → §8 smoke test.

---

## 1. Generar el secreto interno (una sola vez por entorno)

`INTERNAL_HUBS_SECRET` es **UNA variable con el MISMO valor en 6 servicios**:
hubs (emisor) + business, orders, products-and-categories, payments, reportes
(receptores). Los 5 receptores son fail-closed: si les falta, responden 403 y
el hub queda mudo sin error visible en el emisor.

Genera un valor por entorno (staging y prod distintos):

```bash
openssl rand -hex 32
```

(En Windows PowerShell: `-join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Max 16) })`.)

⚠️ NO uses `INTERNAL_SHARED_SECRET` como nombre: solo el ms de hubs lo lee
(fallback legacy). En los otros 5 repos únicamente vale `INTERNAL_HUBS_SECRET`.

---

## 2. Variables de entorno por servicio

Solo se listan las del Modo Multi-Negocio; las que ya tienes (DB, Stripe keys,
etc.) no cambian. **Trampa de nombres**: el gateway usa sufijo `_URL`; hubs,
orders y payments usan `_LINK`. Setear la equivocada deja el default
`localhost` en silencio.

### ordenaapp-hubs (:3013)
| Env | Valor | Crítica |
|---|---|---|
| `INTERNAL_HUBS_SECRET` | el del §1 | ✅ |
| `JWT_SECRET` | valor propio fuerte | ✅ **el default está en el repo — sin override cualquiera forja un token de HUB_OWNER** |
| `HUB_SELF_SERVE_SIGNUP` | **no ponerla** (o `false`) | Registro público de hubs (`POST /hub-users/register`). Apagado por defecto: los hubs los crea Ordena tras lead → reunión → propuesta → acuerdo. Solo `true` si algún día se abre el autoservicio. En el frontend la pestaña "Crear mi hub" del login también está apagada salvo `NEXT_PUBLIC_HUB_SELF_SERVE_SIGNUP=true`. |
| `BUSINESS_SERVICE_LINK` | `http://<business>:3002/api` | ✅ |
| `ORDERS_SERVICE_LINK` | `http://<orders>:3005/api` | ✅ |
| `PRODUCTS_SERVICE_LINK` | `http://<products>:3004/api` | ✅ |
| `PAYMENTS_SERVICE_LINK` | `http://<payments>:3006/api` | ✅ (checkout del plan) |
| `REPORTS_SERVICE_LINK` | `http://<reportes>:3010/api` | ✅ (informes) |

### ordenaapp-business (:3002)
| Env | Valor | Para qué |
|---|---|---|
| `INTERNAL_HUBS_SECRET` | el del §1 | endpoints internos de hub |
| `VERCEL_ACCESS_TOKEN` | token de Vercel (§7.2) | dominios custom (el token vive AQUÍ, no en hubs) |
| `VERCEL_PROJECT_ID` | id del proyecto frontend en Vercel | dominios custom |
| `ORS_API_KEY` | key **gratis** de openrouteservice.org (plan Standard: 2,000 rutas/día, 40/min) | delivery **por distancia**: ruta real por calles negocio → cliente. *Opcional*: sin ella se usa el OSRM público y, si tampoco responde, línea recta × 1.3 (`estimated`). Cada ruta se cachea 7 días en Mongo (`delivery_route_cache`), así que la cuota rinde para miles de pedidos/mes. ⚠️ La key que se pegó en el chat el 2026-09-08 debe **regenerarse** en el panel de ORS antes de usarla. |
| `OSRM_URL` / `ORS_BASE_URL` / `OSRM_PUBLIC_URL` | *no tocar* (defaults: vacío / `https://api.heigit.org/openrouteservice` / `https://router.project-osrm.org`) | solo si algún día se monta un OSRM propio o ORS cambia de host |

### ordenaapp-orders (:3005)
| Env | Valor | Para qué |
|---|---|---|
| `INTERNAL_HUBS_SECRET` | el del §1 | endpoints internos + contador de uso |
| `HUBS_SERVICE_LINK` | `http://<hubs>:3013/api` | notificaciones y uso del hub |
| `WHATSAPP_SHARED_SECRET` | el que ya usa el bot | sin él no salen las notificaciones |
| `TEMPLATE_HUB_ORDER_ES` / `TEMPLATE_BUSINESS_HUB_ES` / `TEMPLATE_HUB_USAGE_ES` / `TEMPLATE_DELIVERY_ES` | *opcionales* | solo si en Meta las nombras distinto a los defaults (`pedido_hub_es`, `pedido_negocio_hub_es`, `uso_hub_es`, `pedido_repartidor_es`) |

### ordenaapp-products-and-categories (:3004)
| Env | Valor |
|---|---|
| `INTERNAL_HUBS_SECRET` | el del §1 |

### ordenaapp-payments (:3006) — las 4 son NUEVAS (hoy no están en ningún .env)
| Env | Valor | Nota |
|---|---|---|
| `INTERNAL_HUBS_SECRET` | el del §1 | |
| `HUBS_SERVICE_LINK` | `http://<hubs>:3013/api` | |
| `HUB_APP_SUCCESS_URL` | `https://<host frontend>/hub-admin/plan?checkout=success` | **fail-closed**: sin ella el checkout devuelve 500 |
| `HUB_APP_CANCEL_URL` | `https://<host frontend>/hub-admin/plan?checkout=cancel` | **fail-closed** |

### ordenaapp-reportes (:3010)
| Env | Valor |
|---|---|
| `INTERNAL_HUBS_SECRET` | el del §1 (ya lo agregaste en el despliegue actual) |

### ordenaapp-api-gateway (:3100)
| Env | Valor | Nota |
|---|---|---|
| `HUBS_SERVICE_URL` | `http://<hubs>:3013/api` | ⚠️ sufijo `_URL` |
| `NODE_ENV` | `production` | si no, el gateway confía en cualquier `*.localhost` |

El gateway NO usa `INTERNAL_HUBS_SECRET`. Los subdominios `*.ordena.app` pasan
por wildcard interno — no hay que listarlos en `ALLOWED_CORE_ORIGINS`.

---

## 3. Push, merge y despliegue

**Estado real (verificado con git el 2026-09-03):**

- Falta **pushear** (todo en `feature/new-mode-ordena-hub`):
  - `ordenaapp-frontend`: 1 commit (`35006818`, prefill de dirección).
  - `ordenaapp-business`: 1 commit (`4e3a2b8`, prefill + modo manual hub).
  - `ordenaapp-hubs`: los commits desde `994756e` (precios Piloto `26c9d83`/`a1ffd8e`,
    prefill `eab3065` y esta guía).
  - `ordenaapp-orders`: 1 commit (`90f4e5c`, fix de los links de las plantillas —
    **desplegarlo ANTES de registrar las plantillas en Meta**).
- Ya pusheados en su feature branch (solo falta PR + deploy): `api-gateway`
  (con los 3 fixes CORS), `products-and-categories`, `payments`, `reportes`.
- Los 9 repos siguen **sin mergear a main** (PRs pendientes en todos).
- Antes de abrir PR en `ordenaapp-business` y `ordenaapp-orders`: `git fetch`
  (su `origin/main` local está desactualizado frente a GitHub — puede haber
  conflictos con lo que otros mergearon).

**Orden de despliegue sugerido** (por dependencias):
1. `ordenaapp-hubs` (nuevo servicio, :3013) — con sus envs del §2.
2. `ordenaapp-business`, `ordenaapp-orders`, `ordenaapp-products-and-categories`,
   `ordenaapp-payments`, `ordenaapp-reportes` — con `INTERNAL_HUBS_SECRET`.
3. `ordenaapp-api-gateway` — incluye los 3 fixes CORS (`3e70fb9`, `49d46ed`,
   `a594622`) sin los cuales el dev local contra el gateway falla.
4. `ordenaapp-frontend` (Vercel).

⚠️ **Orden OBLIGATORIO business → frontend** (feature de prefill de dirección):
si el frontend sale con el `ordenaapp-business` viejo, mongoose descarta
`default_delivery_location` en silencio — el botón "Guardar ubicación" del
dashboard muestra éxito sin persistir nada. No rompe nada, pero la sección
nueva funciona "en falso" hasta desplegar business. El resto de repos no
tiene acoplamiento de orden entre sí (hubs↔business se hablan best-effort).

⚠️ **Delivery por distancia (2026-09-08) — orden `business → orders → gateway → hubs → frontend`:**
- `ordenaapp-business` primero: expone `GET /business/:id/delivery-quote` y
  `GET /geocode/search`, acepta `location` y `delivery_options.distance_pricing`.
- `ordenaapp-orders` después: en `createOrder` llama a esa cotización para
  recalcular el envío (fail-open: si business no responde acepta el precio del
  cliente; si el servidor cobra MÁS responde `409 delivery_price_changed` y el
  checkout refresca la tarifa; nunca se cobra de más en silencio).
- `ordenaapp-api-gateway`: abre los dos GET públicos anteriores. Si el frontend
  sale antes que el gateway, la cotización por distancia falla y el checkout
  cae a la tarifa base (no rompe, pero no mide distancia).
- `ordenaapp-hubs`: `fulfillment.pricingMode` + `fulfillment.distance` (se
  propagan a los negocios vía business).
- `ordenaapp-frontend` al final. Repos tocados por esta feature: business,
  orders, api-gateway, hubs, agencies (solo catálogo de features) y frontend.

---

## 4. Mongo: seed del catálogo de planes (`hub_plans`)

Una vez por entorno, desde el repo `ordenaapp-hubs` apuntando `DB_LINK` a la
base del entorno:

```bash
npx ts-node src/scripts/seedHubPlans.ts
```

Es idempotente (upsert por `code`). Crea:

| | HUB_PILOTO | HUB_STANDARD |
|---|---|---|
| Precio exhibición | $149/mes | $199/mes |
| lookupKeys | `hub_piloto_monthly_v1`, `hub_piloto_monthly_v2` | `hub_standard_monthly_v1` |
| Negocios incluidos | 20 | 20 |
| Pedidos/mes | 1,800 | 1,800 |
| Negocio extra | $5 | $5 |
| Pedido extra | $0.10 | $0.10 |
| Visible en vitrina | **no** (isPublic:false) | sí |

Ambos planes comparten límites a propósito — la única diferencia es el precio
de exhibición ($149 preferente de Oe Ya vs $199 estándar).

Los montos/límites se pueden editar en Mongo sin deploy, pero cambiar el
catálogo NO re-aplica los snapshots de hubs ya suscritos (la tarjeta "Uso del
plan" lee `hub.subscription.limits`, no el catálogo). Tras cambiar planes:

```bash
npx ts-node src/scripts/reapplyHubPlans.ts
```

Re-aplica los límites del catálogo a todos los hubs suscritos. Solo toca
`subscription.limits` (no pisa estado/periodo/lookupKey — seguro sobre la
sub manual de Oe Ya). Es un cambio de datos: no hace falta redeploy ni
restart, con recargar la página del plan basta.

---

## 4b. Mongo: plan gate del delivery por distancia (`canUseDistancePricing`)

La estrategia **Por distancia** está disponible en CORE desde **Profesional y
Empresarial** (mensual o anual); en White Label la agencia la activa/desactiva
en su plan (`canUseDistancePricing`, catálogo de agencias); los hubs la tienen
siempre. El backend valida `planFeatures.canUseDistancePricing === false` al
guardar la estrategia y el dashboard la muestra bloqueada. Mientras NO se
corra la migración, el snapshot de los negocios CORE viejos toma el default del
schema (`true`) — el dashboard ya bloquea por tier, pero para que el backend
también lo haga hay que refrescar los snapshots (en business, contra la DB de
cada entorno):

```bash
cd ordenaapp-business && npx ts-node scripts/migrate-plans-v2.ts
```

```bash
cd ordenaapp-business && npx ts-node scripts/migrate-businesses-planfeatures.ts
```

Ambos scripts son idempotentes y solo añaden la key nueva (`FREE`/`BASIC`
= false, `PRO`/`ENTERPRISE` = true). No hace falta redeploy después.

---

## 4c. Mongo: número de pedido por negocio (`orderNumber`) — orders

Desde el Sprint 0 de F5 cada pedido nuevo recibe un número correlativo **por negocio**
(`#1, #2, …`) con un contador atómico (`order_counters`). Los pedidos anteriores no lo
tienen: el listado del negocio se los calcula por posición cronológica, pero el hub-admin,
el ticket público y los WhatsApp mostraban un fragmento del `_id`. El backfill numera lo
existente con **el mismo número que el negocio ya veía** y deja el contador al día.
Idempotente: se puede correr varias veces. Correr **después** de deployar orders.

```bash
cd ordenaapp-orders && DRY_RUN=1 npx ts-node src/scripts/backfillOrderNumbers.ts   # solo reporta
```

```bash
cd ordenaapp-orders && npx ts-node src/scripts/backfillOrderNumbers.ts            # aplica
```

Opcional: `npx ts-node src/scripts/backfillOrderNumbers.ts <businessId>` para un solo negocio.

## 4d. Liquidaciones por frecuencia (Sprint 1)

Cada hub elige en **Liquidaciones → Comisiones → Frecuencia de corte**: diaria, semanal
(lunes a domingo), quincenal (1–15 y 16–fin de mes) o mensual. Se guarda en
`hub.settlementConfig.frequency` (default `monthly`, así los hubs existentes no cambian).
La clave del período depende de la frecuencia (`YYYY-MM-DD`, `YYYY-Www`, `YYYY-MM-Q1|Q2`,
`YYYY-MM`) y el corte se calcula en la zona horaria del hub. Cambiar la frecuencia no toca
lo ya generado. Sin migración: no hay nada que correr.

**Catálogo autogestionado (portal del negocio):** el hub concede por usuario de portal el
permiso "Gestiona su catálogo" (Usuarios → toggle en la fila, o casilla al crearlo). Con él,
el negocio ve en su portal las pestañas Productos (mismo editor del hub: fotos, variantes,
precio, stock, disponibilidad) y Categorías (propias de su tienda). El backend exige el
permiso en cada request y lo acota a SU negocio; el hub sigue viendo y editando todo. Sin
migración: los usuarios existentes quedan en solo lectura hasta que se les active.

**Ticket térmico:** `/{store_link}/ordenes/{id}/ticket?w=58|80&print=1` (público, como el
ticket web). Botones en el ticket web, en el detalle del pedido del dashboard, en el drawer
del hub-admin y en el portal del negocio. Probar en una impresora real de 58 y otra de 80
antes de darlo por cerrado (pedir modelo a Oe Ya).

## 4e. Flujo del pedido y bolsa de repartidores (Sprint 3)

Sin variables nuevas ni migraciones: los campos nuevos del pedido (`hub_confirmation`,
`delivery_assignment`) nacen con el pedido y los índices los crea mongoose al arrancar
orders. Orden de deploy: **orders → hubs → frontend**.

**Interruptores del hub (Ajustes):**

| Sección | Interruptor | Qué hace | Default |
|---|---|---|---|
| Flujo del pedido | El hub confirma los pedidos antes de pasarlos al negocio | El pedido nace “por confirmar”: solo lo ve el hub-admin, el negocio no lo ve en su portal ni recibe `pedido_negocio_hub_es` hasta que el hub lo confirma. Rechazar cancela el pedido y devuelve stock y cupón. | apagado |
| Flujo del pedido | Publicar para repartidores al confirmar | Al confirmar, los pedidos de delivery entran solos a la bolsa (desmarcable pedido a pedido). | encendido |
| Qué ve el repartidor | Nombre / Teléfono del cliente | Dirección, referencia y pin van siempre; el teléfono va apagado por defecto. | nombre sí, teléfono no |

`hub.orderFlow` lo lee orders vía `notification-config` con caché de **60 s**: encender o
apagar la confirmación tarda hasta un minuto en aplicar a pedidos nuevos.

**Repartidores:** Usuarios → Nuevo usuario → rol **Repartidor** (email, contraseña y
teléfono opcional). Entran en **`/hub-driver`** con el mismo login del hub
(`{slug}.ordena.app/hub-admin/login` o `ordena.app/hub-admin/login`); cada rol se
redirige solo a su app. La app muestra Disponibles (bolsa), Mis pedidos y Entregados, se
refresca sola cada 15 s y abre Google Maps / Waze en el pin exacto del cliente. No usa
WhatsApp ni plantillas de Meta. Conviene que el repartidor la agregue a la pantalla de
inicio del celular.

**Máquina de estados** (`order.delivery_assignment.status`): `none → published →
assigned → picked_up → on_the_way → delivered`, con `incident` como marca lateral (se
retoma con el siguiente estado) y `cancelled` al rechazar. La toma desde la bolsa es un
`findOneAndUpdate` condicionado a `published`: el segundo repartidor recibe 409
`already_taken`. El hub puede asignar a mano, reasignar, quitar y republicar, o marcar
recogido / en camino / entregado él mismo. `order_status` se espeja (`Recogido`,
`En camino`, `Entregado`) para que ticket, negocio y cliente sigan viendo el avance.
Cada cambio queda en `delivery_assignment.history` (base de los informes y de la
liquidación de repartidores del Sprint 5).

**El negocio** (portal) solo maneja *En preparación* y *Listo para recoger*; ve
“Repartidor: nombre · estado” pero no la auditoría, y nunca ve pedidos por confirmar.

**El botón “Notificar a repartidor” por WhatsApp** (plantilla `pedido_repartidor_es`)
sigue disponible como opción secundaria en el drawer solo si el hub tiene ese número en
Contacto → “WhatsApp del repartidor”; con la bolsa ya no hace falta.

---

## 5. Stripe (paso a paso)

> Hazlo primero completo en **modo Test**; repite en Live cuando el smoke pase.

### 5.1 Productos y precios (lookup keys)
Dashboard → **Product catalog → + Add product**:

1. Producto **"Ordena Hub — Piloto"** con DOS precios recurrentes mensuales USD
   (los precios en Stripe son inmutables, por eso son dos):
   - $149.00/mes → lookup key **`hub_piloto_monthly_v1`**
   - $199.00/mes → lookup key **`hub_piloto_monthly_v2`**
2. Producto **"Ordena Hub — Standard"**:
   - $199.00/mes → lookup key **`hub_standard_monthly_v1`**

El campo *Lookup key* aparece al crear/editar el precio (en "More pricing
options"/opciones avanzadas; también se puede poner por API). El precio debe
quedar **activo**.

**Regla de oro:** todo lookup key de hub empieza con `hub_` y NINGÚN plan CORE
debe empezar así — es el discriminador del webhook. Un lookup key no puede
repetirse entre planes (índice unique en `hub_plans`).

### 5.2 Webhook
En el endpoint **existente** `POST /api/stripe/webhook` (el mismo de CORE, con
su `STRIPE_WEBHOOK_SECRET` actual), **añade** estos eventos si no están:

- `checkout.session.completed`
- `invoice.paid`
- `invoice.payment_failed`
- **`invoice.upcoming`** ← imprescindible y fácil de olvidar: sin él NO se
  cobra ningún excedente (pedidos/negocios extra)
- `customer.subscription.updated` ← dispara la transición de fase del Schedule
- `customer.subscription.deleted`

No hay endpoint nuevo ni secreto nuevo de webhook. El de Connect es otro y no
participa.

### 5.3 Alta del trato de Oe Ya (7 días gratis → $149 × 6 → $199)

El plan Piloto NO está en la vitrina (`isPublic:false` a propósito) y el
checkout de la UI hoy no envía trial, así que el trato se da de alta como
**suscripción manual** desde el Dashboard de Stripe (Live). La cascada del
webhook resuelve el hub por `subscription.metadata.hubId` primero (fallback:
`customer.metadata.hubId`) — verificado en código.

1. **hubId de Oe Ya** (24 hex): abre
   `https://api2.ordena.app/api/hubs/resolve?slug=oe-ya` y copia
   `data.hub._id` (o en Mongo: `db.hubs.findOne({slug:'oe-ya'})._id`).
2. **Customers → + Add customer** con el email del operador. Agrega metadata
   `hubId = <ese id>` al customer (fallback de la cascada).
3. **Subscriptions → + Create subscription**:
   - Price: `hub_piloto_monthly_v1` ($149)
   - **Free trial: 7 días**
   - **Metadata de la SUSCRIPCIÓN: `hubId = <ese id>`** ← lo crítico
4. **Tarjeta**: la sub nace en trial sin método de pago. Durante los 7 días el
   operador entra a `/hub-admin/plan` → **"Gestionar facturación"** (Billing
   Portal de Stripe) y agrega su tarjeta — el día 8 Stripe cobra solo. Plan B
   si el portal no abriera: compartirle el link del portal desde el Dashboard.
5. Abrir la suscripción → **⋯ → Convert to subscription schedule** → dos fases:
   - Fase 1: `hub_piloto_monthly_v1` ($149) · **6 iteraciones**
   - Fase 2: `hub_piloto_monthly_v2` ($199) · indefinida
   Stripe transiciona sola en el mes 7; como ambos lookup keys apuntan al
   MISMO plan (`HUB_PILOTO`), los límites no cambian y no hay código que tocar.
6. Verificación: en cuanto el webhook procese `customer.subscription.created/
   updated`, `/hub-admin/plan` de Oe Ya muestra 20 negocios / 1,800 pedidos.

*(Alternativa si se prefiere que pague desde la UI: fix de `trialDays` en el
checkout + `isPublic:true` temporal — pendiente en §9.)*

### 5.4 Excedentes (no requiere acción)
Al llegar `invoice.upcoming`, payments cierra el ledger del período en hubs y
crea un invoice item "Excedente {período}: N pedidos extra + M negocios extra"
con idempotencia `hub-overage-{hubId}-{period}`. Si hubs está caído, el evento
falla a propósito y Stripe reintenta.

### 5.5 Plan negociado futuro
Copiar HUB_PILOTO como plantilla en `hub_plans` (`HUB_<NOMBRE>`,
`isPublic:false`, sus límites) + producto/price en Stripe con lookup key
`hub_<nombre>_monthly_v1` listado en `lookupKeys`. Checkout por link directo, o
suscripción manual desde Stripe con `metadata.hubId`.

---

## 6. Meta — 5 plantillas de WhatsApp

**Antes de empezar:** despliega orders con el fix `90f4e5c` (§3). Con él, las
Las 5 plantillas usan la MISMA base de botón: **`https://ordena.app/{{1}}`**.

Dónde: **Meta Business Suite → WhatsApp Manager → Message templates → Create**,
en la misma WABA donde ya viven `primer_pedido_es` / `limite_pedidos_es`.
Las 5 son: **categoría Utility · idioma Español (es)** · sin header ni footer ·
un botón de tipo **URL dinámica**. Meta pide un valor de ejemplo por variable —
usa los de las tablas. Los nombres deben ser EXACTOS (si cambias alguno, setea
la env `TEMPLATE_*` correspondiente en orders).

### 6.1 `pedido_repartidor_es`
**Body:**
```
🛵 Nuevo envío asignado.

Pedido: #{{1}}
Recoger en: {{2}} — {{3}}
Cliente: {{4}} · Tel: {{5}}
Entregar en: {{6}}
Referencia: {{7}}
Total del pedido: {{8}}
Cobro: {{9}}

Abre el enlace para ver el detalle completo.
```
**Botón:** URL dinámica · texto `Ver pedido` · URL `https://ordena.app/{{1}}`
(ejemplo del sufijo: `pizzeria-luigi--ab12cd/ordenes/68f0a1b2c3d4e5f6a7b8c9d0`).
**Ejemplos:** 1 `A1B2C3` · 2 `Pizzería Luigi` · 3 `Av. España 1234, Trujillo` ·
4 `María Rodríguez` · 5 `+51 987 654 321` · 6 `Jr. Bolívar 456, Dpto 302` ·
7 `Portón azul, frente al parque` · 8 `S/ 45.00` · 9 `COBRAR S/ 45.00 en efectivo`.

### 6.2 `pedido_hub_es`
**Body:**
```
🧾 Nuevo pedido en {{1}}.

Negocio: {{2}}
Pedido: #{{3}}
Cliente: {{4}} · Tel: {{5}}
Entrega: {{6}}
Total: {{7}}
Pago: {{8}}

Revisa el detalle en tu panel desde el enlace.
```
**Botón:** URL dinámica · texto `Ver en el panel` · URL `https://ordena.app/{{1}}`
(sufijo real: `hub-admin/pedidos`).
**Ejemplos:** 1 `Oe Ya Courier` · 2 `Pizzería Luigi` · 3 `A1B2C3` ·
4 `María Rodríguez` · 5 `+51 987 654 321` · 6 `Delivery — Jr. Bolívar 456` ·
7 `S/ 45.00` · 8 `Efectivo — pendiente`.

### 6.3 `pedido_negocio_hub_es`
**Body:**
```
📦 Nuevo pedido para {{1}}.

Pedido: #{{2}}
Cliente: {{3}}
Teléfono: {{4}}
Entrega: {{5}}
Dirección: {{6}}
Total: {{7}}
Pago: {{8}}

Prepáralo y revisa el detalle en el enlace.
```
**Botón:** URL dinámica · texto `Ver pedido` · URL `https://ordena.app/{{1}}`
(sufijo real: `{store_link}/ordenes/{orderId}`).
**Ejemplos:** 1 `Pizzería Luigi` · 2 `A1B2C3` · 3 `María Rodríguez` ·
4 `+51 987 654 321` · 5 `Delivery` · 6 `Jr. Bolívar 456` · 7 `S/ 45.00` ·
8 `Efectivo — pendiente`.
*(Los campos que la privacidad del hub no comparta llegan como `—`; una sola
plantilla cubre todas las combinaciones.)*

### 6.4 `uso_hub_es`
**Body:**
```
📊 {{1}}: vas {{2}} de {{3}} pedidos incluidos en tu plan este mes.

Los pedidos por encima del límite se facturan como excedente al cierre del período — tu operación no se detiene.

Revisa tu uso y tu plan desde el enlace.
```
**Botón:** URL dinámica · texto `Ver mi plan` · URL `https://ordena.app/{{1}}`
(sufijo real: `hub-admin/plan`).
**Ejemplos:** 1 `Oe Ya Courier` · 2 `1500` · 3 `1800`.
*Nota: el body arranca con el emoji antes de `{{1}}`, así que cumple la regla
de Meta de no EMPEZAR con variable. Si aun así la rechazara, antepón
`Hola — ` y listo (no requiere cambio de código).*

### 6.5 Si un envío falla: dónde mirar y qué significa

Cada intento queda en Mongo (`whatsapp_log`: `status`, `error`, `wamid`) y el
detalle literal de Meta (`error_data.details`) en el log del bot (en prod el
proceso pm2 se llama `Ordena-BOT`, no `Bot`):

```bash
grep -n -B6 -A10 "1320" ~/.pm2/logs/Ordena-BOT-error.log | tail -80
```

| `details` de Meta | Causa | Qué hacer |
|---|---|---|
| `Param text cannot have new-line/tab characters or more than 4 consecutive spaces` (#132018) | Un valor (dirección/referencia de un textarea) traía Enter/tab | Resuelto en el bot (commit 2026-09-08: `toValidText` normaliza); si reaparece, el bot de prod está desactualizado |
| `number of ... params does not match` (#132000) | Conteo de variables del body distinto al de la tabla del §6 | Corregir la plantilla en Meta |
| Botón con `%7B%7B1%7D%7D` en la URL | Se escribieron las llaves a mano; Meta las guardó como texto | Insertar la variable con el chip `{{1}}` (debe leerse 24/2000) |
| `template name does not exist` (#132001) | Nombre o idioma distinto (`es_MX` en vez de `es`) | Renombrar o setear la env `TEMPLATE_*` |
| *(sin error de Meta)* el mensaje al cliente (`pedido_confirmado_cliente_es`, §6.6) no llega | Toggle apagado, teléfono con menos de 8 dígitos, pedido aún por confirmar, `CUSTOMER_NOTIFY_DISABLED=true`, o el bot falló | Revisar `customer_notified_at` en el pedido: si quedó `null`, el bot falló (o nunca se intentó) y se reintenta en la próxima confirmación; si tiene fecha, ya se envió (a `customer_notified_to`; buscar en `whatsapp_log` el `dedupeKey` `{orderId}:cliente`). Revisar el toggle correspondiente: hub → Ajustes → Flujo del pedido; SaaS/WL → Ajustes → WhatsApp (nace apagado) |

Para verificar cómo quedó una plantilla de verdad (no la UI), desde la
carpeta del bot con sus envs cargadas:

```bash
curl -s "https://graph.facebook.com/v22.0/$WHATSAPP_BUSINESS_ID/message_templates?name=pedido_hub_es&fields=name,status,language,parameter_format,components" -H "Authorization: Bearer $WHATSAPP_TOKEN" | python3 -m json.tool
```

Debe decir `APPROVED`, `es`, `POSITIONAL` y botón `https://ordena.app/{{1}}`.

**Tras la aprobación:** nada que configurar — los nombres coinciden con los
defaults del código. El anti-duplicado ya está en dos capas (dedupeKey del bot
+ claim mensual en hubs para el aviso de 80%).

---

### 6.6 `pedido_confirmado_cliente_es` (aviso al cliente — Sprint 4)
Se envía **UNA vez por pedido**, cuando el pedido pasa a **confirmado**. Es el único
mensaje que recibe el cliente final; como no ha escrito al número del bot, no cabe
mensaje libre: tiene que ser plantilla. Una sola plantilla sirve para hubs, SaaS y White
Label, y la firma el mismo número del bot que envía las otras cuatro. En Meta solo hay que
crearla y esperar la aprobación; el código ya está listo y calza con este texto.

- **Nombre:** `pedido_confirmado_cliente_es` · **Categoría:** Utilidad · **Idioma:** Español (`es`)
- **Env opcional en orders:** `TEMPLATE_CUSTOMER_CONFIRMED_ES` (default `pedido_confirmado_cliente_es`;
  solo si en Meta la nombras distinto, §2).
- **Kill switch:** `CUSTOMER_NOTIFY_DISABLED=true` en el .env de orders (y reiniciar orders)
  apaga el aviso en TODOS los contextos (hubs, SaaS y WL) sin tocar ningún toggle.

**Body** (5 variables posicionales, pegar literal):
```
✅ ¡Hola {{1}}! Tu pedido #{{2}} en {{3}} está confirmado.

Tiempo estimado: {{4}}.
{{5}}

Puedes seguir tu pedido en el enlace.
```
**Botón:** URL dinámica (índice 0) · texto `Ver mi pedido` · URL `https://ordena.app/{{1}}`
(sufijo real: `{store_link}/ordenes/{orderId}`, igual que `pedido_repartidor_es`).
**Ejemplos:** 1 `María` · 2 `1042` · 3 `Cafe Cena Fonseca` · 4 `35 a 40 minutos` ·
5 `Te lo llevamos a la dirección indicada. Ten listo el pago de 45.00 (efectivo).`
**Destinatario:** `order.customer_number` reducido a solo dígitos (se quitan `+`, espacios y
guiones). Si quedan **menos de 8 dígitos no se envía** (el pedido queda con
`customer_notified_at` en `null`).

**Qué manda orders en cada variable** (ningún parámetro va vacío ni con saltos de línea —
el bot además normaliza espacios/saltos con `toValidText`):

| # | Variable | Regla | Ejemplo |
|---|---|---|---|
| 1 | Primer nombre del cliente | primera palabra de `order.customer_name`, recortada a 40 caracteres; sin nombre → `👋` | `María` |
| 2 | Número de pedido | `order.orderNumber`; si no existe, últimos 6 del `_id` en mayúsculas | `1042` (o `A1B2C3`) |
| 3 | Nombre del negocio | `businesses.name` | `Cafe Cena Fonseca` |
| 4 | Tiempo estimado del **negocio** | `businesses.delivery_options.estimated_delivery_minutes {min,max}`: min y max válidos (>0) → `35 a 40 minutos`; solo max o solo min → `40 minutos`; ninguno → `lo antes posible` | `35 a 40 minutos` |
| 5 | Línea de cierre según método y pago | una de las 4 variantes de la tabla siguiente | ver abajo |

**Variantes de {{5}}.** *Método:* es **pickup** si `delivery_method` (en minúsculas) es o
contiene uno de `self pick-up`, `self pickup`, `pickup`, `en tienda`, `in store`,
`recoger en local`; si no, **delivery**. *Pagado:* si `payment_status` (en minúsculas) es
uno de `paid`, `pagado`, `approved`, `aprobado`, `completed`. `{total}` =
`order.total_amount` (o `order.order_total`); `{método de pago}` = `order.payment_type`
→ `order.payment.payment_method` → `efectivo`.

| Método | Pago | Texto de {{5}} |
|---|---|---|
| delivery | no pagado | `Te lo llevamos a la dirección indicada. Ten listo el pago de {total} ({método de pago}).` |
| delivery | pagado | `Te lo llevamos a la dirección indicada. Tu pago ya está registrado.` |
| pickup | no pagado | `Pásalo a recoger al local en el tiempo indicado. Pagas {total} ({método de pago}) al recibirlo.` |
| pickup | pagado | `Pásalo a recoger al local en el tiempo indicado. Tu pago ya está registrado.` |

**Cuándo se dispara** (siempre al pasar a confirmado, nunca antes):

| Contexto | Disparo |
|---|---|
| Hub con “El hub confirma los pedidos” encendido | Cuando el hub **confirma** el pedido desde hub-admin (acción `confirm` del flujo del §4e). |
| Hub sin confirmación y portal del negocio | Cuando el estado del pedido pasa a `Confirmado`/`Confirmed` por el PATCH interno de estado. |
| SaaS / White Label | Cuando el negocio marca `Confirmed` desde su dashboard (`PATCH /orders/:id`, `changeOrderValues`) o cuando el pago con tarjeta deja el pedido en `Confirmed` (`markOrderPaidInternal`). |

Nunca se envía mientras el pedido está pendiente de confirmación del hub
(`order.hub_confirmation.status === 'pending'`).

**Interruptores:**

| Dónde | Interruptor | Default |
|---|---|---|
| Hub → **Ajustes → Flujo del pedido** | “Avisar al cliente por WhatsApp al confirmar” (`hub.orderFlow.notifyCustomerOnConfirm`; llega a orders vía `notification-config`, caché de 60 s como el resto del `orderFlow`) | **encendido** |
| SaaS / WL → dashboard → **Ajustes → WhatsApp** | “Aviso al cliente al confirmar el pedido” (`business_settings.whatsapp.templatesByCategory.customer_confirmed.enabled`) | **apagado** (opt-in: cuesta un mensaje de Meta por pedido) |
| Global (env de orders) | `CUSTOMER_NOTIFY_DISABLED=true` | no puesta |

**Envío único por pedido** (mismo patrón que `delivery_notified_at` del aviso al repartidor):
antes de llamar al bot, orders reserva el candado con un CAS
`findOneAndUpdate({ _id, customer_notified_at: null }, { $set: { customer_notified_at, customer_notified_to } })`;
si el bot falla, el candado vuelve a `null` y se reintenta en la próxima confirmación /
cambio de estado. Segunda red: `dedupeKey` `{orderId}:cliente` en el bot (`whatsapp_log`).
Un pedido con `customer_notified_at` con fecha ya no vuelve a avisar aunque se reconfirme.

**Cómo cargarla en Meta Business (paso a paso):**

| Paso | Dónde | Qué hacer |
|---|---|---|
| 1 | Meta Business Suite → WhatsApp Manager → **Plantillas de mensajes** (misma WABA de `primer_pedido_es`) | **Crear plantilla** |
| 2 | Categoría | **Utilidad** (no Marketing) |
| 3 | Nombre | `pedido_confirmado_cliente_es` — exacto, en minúsculas |
| 4 | Idioma | **Español** (`es`; NO `es_MX` ni `es_ES`) |
| 5 | Encabezado y pie de página | ninguno |
| 6 | Cuerpo | pegar el body de arriba **literal** (5 variables, con los saltos de línea tal cual). Insertar cada variable con el chip `{{1}}`…`{{5}}`, no escribiendo las llaves a mano |
| 7 | Botones | Añadir botón → **Visitar sitio web** → tipo de URL **Dinámica** → texto `Ver mi pedido` → URL `https://ordena.app/{{1}}` → ejemplo del sufijo: `cafe-cena-fonseca--ab12cd/ordenes/68f0a1b2c3d4e5f6a7b8c9d0` |
| 8 | Ejemplos de variables (Meta los pide) | 1 `María` · 2 `1042` · 3 `Cafe Cena Fonseca` · 4 `35 a 40 minutos` · 5 `Te lo llevamos a la dirección indicada. Ten listo el pago de 45.00 (efectivo).` |
| 9 | Enviar | **Enviar para revisión**. Al aprobarse, verificar con el curl del §6.5 (`name=pedido_confirmado_cliente_es`): debe decir `APPROVED`, `es`, `POSITIONAL` y botón `https://ordena.app/{{1}}` |

Tras la aprobación no hay nada que configurar: el nombre coincide con el default del
código. Si la nombraste distinto, `TEMPLATE_CUSTOMER_CONFIRMED_ES=<nombre>` en orders (§2).

---

## 7. Vercel y DNS

### 7.1 Wildcard de subdominios (los hubs viven en `{slug}.ordena.app`)
Sin esto, `michael-hub.staging.ordena.app` ni siquiera llega al middleware.

1. **Vercel** → proyecto del frontend (staging) → Settings → Domains → añadir
   **`*.staging.ordena.app`** (y más adelante `*.ordena.app` en el de prod).
2. **DNS** (donde administras `ordena.app`): registro wildcard
   `*.staging` → `CNAME` → `cname.vercel-dns.com` (para prod: `*` → CNAME
   igual, o seguir la instrucción que Vercel muestre al añadir el dominio).
3. Verificar: abrir `cualquiercosa.staging.ordena.app` → si el slug no es un
   hub, el middleware redirige a `ordena.app` (comportamiento esperado); si es
   un hub, sirve su storefront.

### 7.2 Dominios custom de hubs (F4)
1. **Token:** Vercel → Account Settings → Tokens → crear token → va en
   `VERCEL_ACCESS_TOKEN` del ms de **business** (no de hubs).
2. **Project ID:** Vercel → proyecto frontend → Settings → General → Project ID
   → `VERCEL_PROJECT_ID` en business.
3. El operador del hub configura su dominio en `/hub-admin` (Ajustes) y la UI
   le muestra los registros que debe crear:
   - Apex: `A  @ → 76.76.21.21`
   - `CNAME  www → cname.vercel-dns.com`
4. Pulsa "Verificar" en la UI hasta que pase a `verified` (ahí el subdominio
   `{slug}.ordena.app` empieza a redirigir 308 al dominio custom).

**Limitaciones conocidas (documentadas, no bugs nuevos):**
- Recomienda al operador registrar el dominio **sin `www.`** (apex): hay una
  asimetría de normalización entre hubs y business con el prefijo www.
- Si el dominio ya está usado en OTRA cuenta/proyecto de Vercel, Vercel exige
  un TXT de verificación que nuestra UI aún no muestra — se quedaría en
  `pending`; resuélvelo desde el dashboard de Vercel.
- "Desconectar" en la UI no elimina el dominio del proyecto Vercel (solo deja
  de servirse); límpialo a mano en Vercel si reciclas el dominio.

---

## 8. Smoke test end-to-end (staging)

En orden — cada punto valida una pieza de la configuración:

1. `{slug}.staging.ordena.app` abre el storefront del hub (→ §7.1 wildcard).
2. Login en `/hub-admin` (título de pestaña = nombre del hub + favicon).
3. Crear negocio con foto → crear producto con variantes/imágenes → asignarle
   categorías del hub (→ secreto interno en business/products).
4. Storefront: buscar y filtrar por categoría (→ gateway con los fixes CORS).
5. Hacer un pedido → llega `pedido_hub_es` al WhatsApp del hub y
   `pedido_negocio_hub_es` al negocio (→ §6 + WHATSAPP_SHARED_SECRET).
6. "Notificar a repartidor" → llega `pedido_repartidor_es` con el link del
   pedido funcionando (→ fix 90f4e5c desplegado).
7. `/ordenes/{id}/pagar` muestra los métodos del HUB (→ payments + secreto).
8. `/hub-admin/informes` con gráfico y tráfico de visitas (→ reportes con
   secreto + REPORTS_SERVICE_LINK en hubs).
9. Stripe TEST: checkout desde `/hub-admin/plan` → la página muestra el plan y
   los límites (→ §4 seed + §5.1 prices + webhook `customer.subscription.*`).
10. Excedente: en Stripe test, adelantar el reloj de la suscripción o usar
    `stripe trigger invoice.upcoming` y verificar el invoice item (→ §5.2).
11. Dominio custom con un dominio de prueba (→ §7.2).
12. Prefill de dirección: `/hub-admin/ajustes` → sección **Zona de entrega** →
    elegir Departamento y Ciudad → guardar → abrir el checkout de un negocio
    del hub: el formulario manual llega con país + departamento + ciudad ya
    puestos y editables (→ business desplegado ANTES que frontend, §3).
    Extra SaaS: en el dashboard clásico, Ajustes → Delivery → "Ubicación de
    entrega por defecto" hace lo mismo para un negocio normal.
13. Métodos de entrega: `/hub-admin/ajustes` → sección **Métodos de entrega**
    (Delivery / Recoger en local + tarifa) → guardar → el checkout de TODOS
    los negocios del hub ofrece exactamente esos métodos con esa tarifa.
    ⚠️ Los negocios de hub creados ANTES de este deploy nacieron con delivery
    apagado: basta con **guardar Ajustes una vez** tras el deploy para que la
    propagación los sincronice (no hay backfill automático).
14. Delivery **por distancia** (hub): `/hub-admin/ajustes` → Métodos de entrega
    → "Por distancia" → tarifa base / km incluidos / precio por km / radio →
    guardar. Luego `/hub-admin/negocios/{id}` → **Ubicación en el mapa** →
    "Usar mi ubicación" o "Buscar por la dirección" → ajustar el pin → guardar.
    En el checkout de ese negocio: modo manual muestra el paso "Tu ubicación en
    el mapa"; al fijar el pin aparece la ruta pintada (línea continua = ruta
    real; punteada = aproximación) con los km y el precio; fuera del radio
    sale "fuera del radio" y no deja pedir. Sin pin del negocio, cobra solo la
    tarifa base (aviso ámbar en el detalle del negocio).
    Extra SaaS: dashboard clásico → Ajustes → Delivery → tarjeta **Por
    distancia** (bloqueada en Gratis/Básico) → fijar ubicación + tarifas →
    "Guardar cobro por distancia". Verificación de servidor: crear el pedido y
    en Mongo `orders` ver `delivery_distance_km`, `delivery_geo`,
    `delivery_pricing_strategy: 'distance'`; en `delivery_route_cache` debe
    aparecer la ruta (provider `ors` si hay key, `osrm-public` si no).

---

## 9. Checklist exprés del pase a PROD

Todo lo de la guía aplica por entorno; esto es lo que CAMBIA al pasar de
staging a producción (en orden):

1. ☐ Mergear los PR de `feature/new-mode-ordena-hub` → `main` en los 9 repos
   (§3; `git fetch` antes en business y orders) y desplegar en el orden del §3.
2. ☐ `INTERNAL_HUBS_SECRET` NUEVO (distinto al de staging) en los 6 servicios
   de prod + resto de envs del §2 con los hosts de prod (`HUB_APP_*` con
   `https://ordena.app/...`).
3. ☐ `JWT_SECRET` propio en hubs de prod (crítico).
4. ☐ Seed de `hub_plans` contra la DB de prod (§4).
5. ☐ Stripe **Live**: recrear los 3 prices con sus lookup keys (los de test NO
   se copian solos) + los 6 eventos en el webhook de prod (§5.2).
6. ☐ Meta: nada — las plantillas son de la WABA, sirven para todos los
   entornos (registrarlas una vez, §6).
7. ☐ Vercel: añadir `*.ordena.app` al proyecto de PROD + wildcard DNS
   (`*` → CNAME `cname.vercel-dns.com`). Los subdominios existentes
   (api2, market, staging…) no se ven afectados: sus registros explícitos
   ganan al wildcard, y el middleware además los excluye por lista.
8. ☐ `VERCEL_ACCESS_TOKEN` + `VERCEL_PROJECT_ID` (del proyecto de PROD) en
   business de prod (§7.2).
9. ☐ Repetir el smoke test del §8 sobre prod con un hub de prueba (y borrarlo
   o dejarlo como demo).
10. ☐ Alta de Oe Ya con la sub manual del §5.3.
11. ☐ `ORS_API_KEY` (regenerada) en business de prod (§2) + correr los dos
    scripts del §4b contra la DB de prod + smoke del punto 14 del §8.
12. ☐ Tras deployar orders: `backfillOrderNumbers` del §4c contra la DB de prod
    (primero con `DRY_RUN=1`). Verificar que un pedido viejo muestre el mismo `#N`
    en dashboard del negocio, hub-admin y ticket.
13. ☐ Confirmar que `HUB_SELF_SERVE_SIGNUP` NO está en el .env de hubs de prod y que
    `/hub-admin/login` ya no ofrece "Crear mi hub".
14. ☐ Sprint 1.5: tras deployar business + hubs + frontend, entrar a **Ajustes del hub →
    Guardar cambios** una vez (propaga "Efectivo contra entrega" a `payment_methods.cash`
    de los negocios existentes; los nuevos ya nacen con él). Verificar en el checkout de un
    negocio del hub que la pantalla de pago ofrece efectivo y que el carrito llega lleno al
    checkout entrando por el directorio del hub.
15. ☐ Crear en Meta la plantilla del §6.6 (aviso al cliente) para que esté aprobada al
    llegar al Sprint 4.
17. ☐ Sprint 3 (flujo + bolsa): deployar **orders → hubs → frontend** (sin envs ni
    migraciones, §4e). En el hub: Usuarios → crear un repartidor; Ajustes → “Flujo del
    pedido” (encender la confirmación solo si el hub lo quiere) y “Qué ve el repartidor”
    → Guardar. Smoke: hacer un pedido de delivery → (si confirma) aparece el banner “N
    pedidos esperan tu confirmación” y el portal del negocio NO lo lista → Confirmar con
    “Publicar” marcado → en el celular, `/hub-driver` lo muestra en Disponibles → Tomar
    pedido (desde un segundo repartidor debe salir “Otro repartidor ya tomó este pedido”)
    → Recogí / En camino / Entregado → el drawer del hub y el portal muestran repartidor
    y tiempos; `order_status` termina en `Entregado`.
16. ☐ Sprint 2 (comprobante de pago): deployar **products** (nuevo endpoint interno de
    subida), **orders** (correr `npm install`: nueva dependencia `multer`), gateway,
    business, hubs y frontend. `PRODUCTS_SERVICE_LINK` en orders es opcional (por
    defecto `http://localhost:3004/api`, que es donde corre products en cada host);
    products y orders ya comparten `INTERNAL_HUBS_SECRET`. Luego, en el hub: Ajustes →
    “Pagos con comprobante” → Guardar una vez (propaga a los negocios existentes; los
    nuevos nacen con la config). Smoke: pagar un pedido con Yape en un negocio del hub,
    adjuntar una captura, y verla en el drawer del hub, en el portal del negocio, en el
    detalle del dashboard y en el ticket.
18. ☐ Sprint 4 (aviso al cliente): deployar **orders → hubs → business → frontend** (sin
    migraciones; envs opcionales del §6.6). Confirmar que `pedido_confirmado_cliente_es`
    está **APPROVED** en Meta (curl del §6.5). En el hub: Ajustes → “Flujo del pedido” →
    verificar que “Avisar al cliente por WhatsApp al confirmar” está encendido (viene así
    por defecto) → Guardar. Smoke: hacer un pedido en un negocio del hub poniendo **tu
    propio número** como cliente → confirmar el pedido (o pasarlo a Confirmado si el hub
    no confirma) → te llega el mensaje con el **tiempo estimado del negocio** y la línea
    de pago correcta → un segundo intento de confirmación / cambio de estado **no
    duplica** el mensaje (`customer_notified_at` ya tiene fecha). En SaaS/WL el toggle
    nace apagado (Ajustes → WhatsApp): encenderlo solo en los negocios que lo pidan.

---

## 10. Decisiones abiertas (para cerrar cuando quieras)

1. **Trial de 7 días del checkout** — el backend lo soporta; falta que el
   frontend lo mande (`trialDays: 7`) o crear la suscripción de Oe Ya a mano.
2. **`JWT_SECRET` de hubs** — obligatorio sobrescribir en prod.
3. **TXT de verificación de Vercel** no visible en la UI de dominios (caso
   dominio-en-otra-cuenta).
4. **`TEMPLATE_NAME_EN`** en business apunta por default a la plantilla ES
   (preexistente; solo importa para negocios en inglés).
