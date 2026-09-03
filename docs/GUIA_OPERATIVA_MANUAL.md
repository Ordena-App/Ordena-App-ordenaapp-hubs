# Guía operativa — pasos manuales para staging/producción (Modo Multi-Negocio)

**Fecha:** 2026-09-01 · **Actualizada:** 2026-09-03 (estado git real + feature de
prefill de dirección) · **Alcance:** todo lo que NO se hace con código: Meta
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

## 6. Meta — 4 plantillas de WhatsApp

**Antes de empezar:** despliega orders con el fix `90f4e5c` (§3). Con él, las
4 plantillas usan la MISMA base de botón: **`https://ordena.app/{{1}}`**.

Dónde: **Meta Business Suite → WhatsApp Manager → Message templates → Create**,
en la misma WABA donde ya viven `primer_pedido_es` / `limite_pedidos_es`.
Las 4 son: **categoría Utility · idioma Español (es)** · sin header ni footer ·
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

**Tras la aprobación:** nada que configurar — los nombres coinciden con los
defaults del código. El anti-duplicado ya está en dos capas (dedupeKey del bot
+ claim mensual en hubs para el aviso de 80%).

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

---

## 10. Decisiones abiertas (para cerrar cuando quieras)

1. **Trial de 7 días del checkout** — el backend lo soporta; falta que el
   frontend lo mande (`trialDays: 7`) o crear la suscripción de Oe Ya a mano.
2. **`JWT_SECRET` de hubs** — obligatorio sobrescribir en prod.
3. **TXT de verificación de Vercel** no visible en la UI de dominios (caso
   dominio-en-otra-cuenta).
4. **`TEMPLATE_NAME_EN`** en business apunta por default a la plantilla ES
   (preexistente; solo importa para negocios en inglés).
