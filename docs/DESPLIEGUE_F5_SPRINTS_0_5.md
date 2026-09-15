# Despliegue F5 — Sprints 0 a 5 (staging → producción)

**Fecha:** 2026-09-15 · **Rama:** `feature/new-mode-ordena-hub` en todos los repos · **Estado del código:** verificado con `git` el 2026-09-15.

Este documento es autosuficiente para sacar a staging y luego a producción todo lo construido desde el 2026-09-08 (delivery por distancia) hasta el Sprint 5 (liquidación de repartidores). Cuando un paso ya está detallado en la `GUIA_OPERATIVA_MANUAL.md` se referencia la sección para no duplicar comandos.

---

## 0. Resumen en una pantalla

| Tema | Respuesta corta |
|---|---|
| Repos que cambian | `products-and-categories`, `orders`, `api-gateway`, `business`, `hubs`, `frontend`. **No cambian:** `payments`, `reportes`, `agencies`; `whatsapp-bot` solo tiene documentación. |
| Orden de despliegue | **products → orders → api-gateway → business → hubs → frontend** (motivos en §4). |
| Variables de entorno **obligatorias** nuevas | **Ninguna.** Todo lo nuevo tiene default. |
| Variables opcionales nuevas | `ORS_API_KEY` (business, rutas reales del delivery por distancia; hay que **regenerarla** porque la anterior se pegó en un chat), `PRODUCTS_SERVICE_LINK` (orders), `TEMPLATE_CUSTOMER_CONFIRMED_ES` y `CUSTOMER_NOTIFY_DISABLED` (orders), `WHATSAPP_DEFAULT_CUSTOMER_CONFIRMED_TEMPLATE_ES` (business). Detalle en §3. |
| Variables que **NO** hay que poner | `HUB_SELF_SERVE_SIGNUP` (hubs) y `NEXT_PUBLIC_HUB_SELF_SERVE_SIGNUP` (frontend): su ausencia es lo que mantiene apagado el registro público de hubs. |
| Dependencias nuevas | `orders` agrega `multer` → correr `npm install` al desplegar orders. |
| Scripts contra Mongo | `orders`: `backfillOrderNumbers` (después de desplegar orders, §5.4). `business`: `migrate-plans-v2` + `migrate-businesses-planfeatures` si no se corrieron desde el 2026-09-08 (guía §4b). `hubs`: `seedHubPlans` + `reapplyHubPlans` solo si no se corrieron desde el 2026-09-03 (guía §4). Los índices nuevos de Mongo los crea mongoose al arrancar. |
| Meta (WhatsApp) | Crear la plantilla `pedido_confirmado_cliente_es` (guía §6.6). El código funciona sin ella: el aviso al cliente falla en silencio y se reintenta en la siguiente confirmación. |
| Configuración manual en el hub tras desplegar | Ajustes (propagar efectivo y comprobante), Flujo del pedido, Qué ve el repartidor, crear repartidores, regla de pago a repartidores. Detalle en §5.5. |

---

## 1. Qué cambia, por sprint

| Sprint | Qué hace | Repos tocados |
|---|---|---|
| **Delivery por distancia** (2026-09-08, ya pusheado, sin mergear a main) | Tarifa base + km incluidos + precio por km + radio, con ruta real (ORS → OSRM público → recta×1.3) y caché 7 días; cotización autoritativa en `business`; `orders` recalcula al crear y responde 409 si el precio cambió; pin del negocio y del cliente; sugerencias de dirección en el checkout manual; distancia y pin en el detalle del pedido. | business, orders, api-gateway, hubs, frontend |
| **Roles y contraseña** (ya pusheado, sin mergear) | HUB_STAFF sin informes, usuarios, pagos, liquidaciones, plan ni identidad/marca/contacto/dominio; cambio de contraseña propio en Ajustes; el pin del cliente se oculta al negocio junto con la dirección. | hubs, frontend |
| **Sprint 0** | Favicon del hub en storefront y paneles; número de pedido persistente por negocio (`#1042`) con contador atómico y backfill; ID completo copiable; registro público de hubs apagado (403). | orders, hubs, frontend |
| **Sprint 1** | Liquidaciones a negocios con frecuencia diaria / semanal (lunes–domingo) / quincenal (1–15, 16–fin) / mensual y CSV; ticket térmico 58 y 80 mm con QR; catálogo autogestionado desde el portal del negocio con el permiso "Gestiona su catálogo" (productos con el editor completo y categorías propias). | orders, hubs, frontend |
| **Sprint 1.5** | Carrito del hub con clave canónica (directorio → tienda → checkout ya no llega vacío); opciones a $0 sin "0" pegado; efectivo contra entrega a nivel hub propagado a `payment_methods.cash`; tiempo estimado de entrega por negocio (hub o portal si el hub lo permite; SaaS/WL en Ajustes → Delivery). | business, hubs, frontend |
| **Sprint 2** | Comprobante de pago en los 13 métodos manuales: el cliente sube la captura, queda "por verificar" en drawer del hub, portal, dashboard y ticket; **no marca pagado**; destinatario del aviso de WhatsApp configurable por hub (hub / negocio / ninguno). Aplica a SaaS y WL con aviso al negocio. | products, orders, api-gateway, business, hubs, frontend |
| **Sprint 3** | Confirmación del hub opcional (`orderFlow.hubConfirms`): el pedido nace "por confirmar", el negocio no lo ve ni recibe WhatsApp hasta confirmar; rechazar devuelve stock. Bolsa de repartidores: rol `DELIVERY_DRIVER`, app `/hub-driver` (Disponibles / Mis pedidos / Entregados), toma atómica, asignación manual, estados recogido / en camino / entregado / incidencia, privacidad hacia el motorizado (teléfono apagado por defecto). | orders, hubs, frontend |
| **Sprint 4** | Aviso al cliente por WhatsApp al confirmar (plantilla `pedido_confirmado_cliente_es`, 5 variables, botón al pedido). Hub: encendido por defecto (Ajustes → Flujo del pedido). SaaS/WL: apagado por defecto, opt-in en Ajustes → WhatsApp. Envío único por pedido. | orders, business, hubs, frontend, whatsapp-bot (docs) |
| **Sprint 5** | Liquidación de repartidores: el repartidor registra cómo cobró al entregar (efectivo / billetera / no cobró → si cobró el pedido queda pagado); regla de pago por entrega (fijo, % del envío o del total, sin comisión) con excepciones por repartidor y corte diario por defecto; liquidación por período con bonos/descuentos, "pagada" con referencia, CSV; pestaña "Mi cuenta" en la app del repartidor. | orders, hubs, frontend |

---

## 2. Repos y commits

### 2.1 Pendientes de `git push` (están solo en tu máquina)

| Repo | Commits (del más nuevo al más viejo) |
|---|---|
| `ordenaapp-products-and-categories` | `9996be9` |
| `ordenaapp-orders` | `d6aab6f`, `c2837f9`, `d096606`, `3f199a5`, `6b682a1`, `2624269`, `bff150f`, `7ec6326` |
| `ordenaapp-api-gateway` | `cce2326` |
| `ordenaapp-business` | `590ffce`, `09b09f2`, `e84a358` |
| `ordenaapp-hubs` | `cfb20c3`, `22e5eef`, `06e30fd`, `4ebdd3f`, `70886dc`, `9699189`, `ed0608f`, `c692c62`, `23438b6`, `64052b9`, `6c85f84`, `c374fba`, `547613f`, `2928bb9`, `ec0adbe`, `a6bffcd`, `33cea8c`, `21b6f8a`, `c39db19` (+ el commit de este documento) |
| `ordenaapp-whatsapp-bot` | `c2812fc` (solo documentación; no requiere deploy) |
| `ordenaapp-frontend` | `aa8e53ce`, `7c569853`, `89393f1b`, `3203d2db`, `addb4072`, `3f08dde0`, `8910eff2`, `d7018834`, `cc788c08`, `fa7196a5`, `b5937425` |

### 2.2 Ya pusheados a la rama pero **sin mergear a `main`**

| Repo | Commits |
|---|---|
| `ordenaapp-orders` | `eb7cf01` (recálculo del envío por distancia) |
| `ordenaapp-api-gateway` | `c182de9` (rutas públicas de cotización y geocoder) |
| `ordenaapp-business` | `af239f0` (cotización, rutas reales, geocoder) |
| `ordenaapp-hubs` | `c8fc0af`, `d17867b`, `b70f9cb`, `f449f78` |
| `ordenaapp-frontend` | 16 commits desde `dbe66b09` (delivery por distancia, roles, contraseña) |

Estos entran en el mismo despliegue: si staging corre la rama `feature`, ya están; si corre `main`, hay que mergear todo junto.

### 2.3 Qué hay que recordar por repo

| Repo | Al desplegar |
|---|---|
| `products-and-categories` | Nuevo `POST /internal/payment-proofs` (sube al bucket de Firebase Storage). Usa el mismo `INTERNAL_HUBS_SECRET`. Sin envs nuevas. |
| `orders` | `npm install` (nuevo `multer`). Crea solos los índices: `order_counters`, `delivery_assignment.status/published_at`, `driver_id/updated_at`, `driver_id/delivered_at`. Correr `backfillOrderNumbers` después. |
| `api-gateway` | Ruta pública nueva `POST /api/orders/orders/:id/payment-proof` (más las de cotización y geocoder del 09-08). |
| `business` | Campos nuevos en el modelo (`payment_proof`, `delivery_options.estimated_delivery_minutes`, `templatesByCategory.customer_confirmed`) y PATCH internos que hubs llama para propagar. Migraciones del §4b si no se corrieron. |
| `hubs` | Rutas nuevas de flujo, repartidores y liquidaciones. `dist/` va en el commit (ya compilado). `HUB_SELF_SERVE_SIGNUP` **no** debe estar en el `.env`. |
| `frontend` | App Router: `/hub-driver` nuevo, `/hub-admin/liquidaciones/repartidores` nuevo. Sin envs nuevas obligatorias. |
| `whatsapp-bot` | Nada que desplegar. Verificar que el fix `ec14745` (saneo de parámetros, error #132018) ya corre en prod (`pm2 describe Ordena-BOT` y fecha del último deploy). |

---

## 3. Variables de entorno

| Variable | Servicio | ¿Obligatoria? | Default si falta | Para qué | Recomendación staging | Recomendación prod |
|---|---|---|---|---|---|---|
| `ORS_API_KEY` | business | No | vacío → cae a OSRM público → recta×1.3 | Rutas reales por calles en el delivery por distancia (OpenRouteService, 2,000/día gratis) | Poner una key **regenerada** | Poner la misma key regenerada o una propia de prod |
| `OSRM_URL` | business | No | vacío (no se usa OSRM propio) | Solo si algún día montas un OSRM propio | Dejar sin poner | Dejar sin poner |
| `PRODUCTS_SERVICE_LINK` | orders | No | `http://localhost:3004/api` | Subida del comprobante de pago hacia products | Dejar el default si products corre en el mismo host | Igual |
| `TEMPLATE_CUSTOMER_CONFIRMED_ES` | orders | No | `pedido_confirmado_cliente_es` | Nombre de la plantilla de Meta del aviso al cliente | Solo si la nombras distinto en Meta | Igual |
| `CUSTOMER_NOTIFY_DISABLED` | orders | No | apagado (se envía) | Kill switch global del aviso al cliente | **`true` en staging si no quieres mandar WhatsApp reales a números de prueba** | No poner |
| `WHATSAPP_DEFAULT_CUSTOMER_CONFIRMED_TEMPLATE_ES` | business | No | `pedido_confirmado_cliente_es` | Nombre que el dashboard SaaS muestra/guarda para esa categoría | Dejar default | Dejar default |
| `HUB_SELF_SERVE_SIGNUP` | hubs | No | apagado → `POST /hub-users/register` responde 403 | Registro público de hubs | **No poner** | **No poner** |
| `NEXT_PUBLIC_HUB_SELF_SERVE_SIGNUP` | frontend | No | apagado → login sin "Crear mi hub" | Pestaña de registro en el login del hub | **No poner** | **No poner** |

Variables que **ya existían** y deben seguir iguales en los 6 servicios que hablan entre sí: `INTERNAL_HUBS_SECRET` (business, orders, products, hubs, payments, reportes; hubs acepta también `INTERNAL_SHARED_SECRET`). Si `products` no la tiene, la subida de comprobantes responde 403.

---

## 4. Orden de despliegue y por qué

1. **`products-and-categories`** — expone el endpoint interno que recibe el comprobante. Si `orders` sale antes, subir un comprobante falla con 502 hasta que products esté arriba (no rompe nada más).
2. **`orders`** — `npm install` (multer). Crea contadores de número de pedido, campos de flujo/bolsa/cobro y los endpoints internos que `hubs` consume. Correr el backfill de `orderNumber` justo después (§5.4).
3. **`api-gateway`** — abre la ruta pública del comprobante (y las de cotización/geocoder si aún no estaban). Si el frontend sale antes que el gateway, el botón "Enviar comprobante" da error de red.
4. **`business`** — campos nuevos y PATCH internos de propagación (`payment-flow`, `fulfillment` con efectivo, `region-country`, `delivery-defaults`). Si `hubs` sale antes, al guardar Ajustes la propagación falla best-effort (queda en log, no rompe).
5. **`hubs`** — todo lo del hub: flujo, repartidores, liquidaciones, config nueva. Depende de que orders y business ya tengan lo suyo.
6. **`frontend`** (Vercel) — al final, para que cada pantalla nueva encuentre su endpoint.

`payments` y `reportes` no cambian. `whatsapp-bot` no cambia de código.

**Regla que ya existía y sigue vigente:** business antes que frontend (prefill de dirección) y business → orders → gateway → hubs → frontend (delivery por distancia). El orden de arriba la respeta.

---

## 5. Staging, paso a paso

### 5.1 Push de las ramas

Desde cada repo con commits locales (§2.1):

```bash
git push origin feature/new-mode-ordena-hub
```

En `ordenaapp-business` y `ordenaapp-orders` haz antes `git fetch` (su `origin/main` local estaba desactualizado; para staging no importa, para el PR a `main` sí).

### 5.2 Servicios (en el orden del §4)

Por servicio, en el servidor de staging:

```bash
git pull origin feature/new-mode-ordena-hub
```

En `orders` además:

```bash
npm install
```

Después reinicia el proceso (pm2) y revisa el log de arranque: debe conectarse a Mongo sin errores de índice. Los repos ya traen `dist/` compilado en el commit, no hace falta `npm run build` en el servidor.

### 5.3 Variables (§3)

- `business`: `ORS_API_KEY` regenerada (opcional pero recomendada para que el delivery por distancia mida rutas reales).
- `orders`: `CUSTOMER_NOTIFY_DISABLED=true` si en staging no quieres que salgan WhatsApp reales al cliente; quítala cuando quieras probar el Sprint 4.
- Confirma que `hubs` **no** tiene `HUB_SELF_SERVE_SIGNUP` y que Vercel staging **no** tiene `NEXT_PUBLIC_HUB_SELF_SERVE_SIGNUP`.

### 5.4 Scripts contra la base de staging

Después de desplegar `orders` (idempotente, guía §4c):

```bash
cd ordenaapp-orders && DRY_RUN=1 npx ts-node src/scripts/backfillOrderNumbers.ts
```

```bash
cd ordenaapp-orders && npx ts-node src/scripts/backfillOrderNumbers.ts
```

Si no se corrieron desde el 2026-09-08 (plan gate del delivery por distancia, guía §4b):

```bash
cd ordenaapp-business && npx ts-node scripts/migrate-plans-v2.ts
```

```bash
cd ordenaapp-business && npx ts-node scripts/migrate-businesses-planfeatures.ts
```

Si no se corrieron desde el 2026-09-03 (HUB_STANDARD igualado al Piloto, guía §4):

```bash
cd ordenaapp-hubs && npx ts-node src/scripts/seedHubPlans.ts
```

```bash
cd ordenaapp-hubs && npx ts-node src/scripts/reapplyHubPlans.ts
```

### 5.5 Frontend

Deploy de la rama `feature/new-mode-ordena-hub` al proyecto de staging en Vercel. Comprueba que `*.staging.ordena.app` sigue apuntando al proyecto (wildcard, guía §7.1).

### 5.6 Configuración manual en el hub de pruebas (una sola vez)

Entra a `/hub-admin` como dueño o admin del hub:

1. **Ajustes → Métodos de entrega:** apaga y vuelve a encender "Efectivo contra entrega" y guarda. Eso fuerza la propagación de `payment_methods.cash` a los negocios que ya existían (los nuevos nacen con él). Si usas "Por distancia", revisa tarifa base, km incluidos, precio por km y radio.
2. **Ajustes → Pagos con comprobante:** cambia el destinatario del aviso y vuelve a dejarlo como quieras, guarda. Propaga `payment_proof` a los negocios existentes.
3. **Ajustes → Flujo del pedido:** decide si el hub confirma los pedidos, si se publican solos en la bolsa y si se avisa al cliente por WhatsApp. Tarda hasta un minuto en aplicar a pedidos nuevos (caché de configuración en orders).
4. **Ajustes → Qué ve el repartidor:** nombre sí, teléfono según decidas (apagado por defecto).
5. **Usuarios:** crea al menos dos usuarios con rol **Repartidor** (email, contraseña, teléfono opcional). Con dos puedes probar la toma atómica.
6. **Liquidaciones → Repartidores → Regla de pago:** tipo de comisión, valor, frecuencia de corte; guarda.
7. **Negocios → cada negocio → Información:** pin del negocio (necesario para "Por distancia") y tiempo estimado de entrega.

### 5.7 Meta

Crea la plantilla `pedido_confirmado_cliente_es` siguiendo la guía §6.6 (texto literal, botón con `https://ordena.app/{{1}}`). Hasta que Meta la apruebe, el aviso al cliente no sale y `customer_notified_at` queda `null`; no bloquea nada más.

---

## 6. Guía de pruebas en staging

Marca cada punto. Donde dice "dos navegadores" usa una ventana normal y una de incógnito. Usa tus propios números de WhatsApp como cliente y como repartidor.

### A. Base y Sprint 0

- [ ] `{slug}.staging.ordena.app` abre el storefront; la pestaña muestra el logo y el nombre del hub. Igual en `/hub-admin` y `/hub-portal`.
- [ ] `/hub-admin/login` no ofrece "Crear mi hub". `POST /api/hub-users/register` responde 403.
- [ ] Un pedido nuevo muestra el mismo `#N` en hub-admin, portal del negocio, dashboard y ticket. Un pedido anterior al deploy también (efecto del backfill).
- [ ] En hub-admin → Pedidos, buscar por `#N`, por el ID completo y por sus últimos caracteres encuentra el pedido. El drawer tiene el ID completo con "Copiar".

### B. Sprint 1

- [ ] Liquidaciones → Negocios: cambia la frecuencia a semanal, calcula la semana actual, descarga el CSV, marca una pagada. Vuelve a calcular: la pagada no cambia.
- [ ] Ticket térmico: desde el drawer "Ticket térmico (58 / 80 mm)"; imprime en la térmica real de Oe Ya en 58 y en 80 (pide el modelo si aún no lo tienes). El QR abre el pedido.
- [ ] Usuarios: crea un usuario de portal para un negocio **sin** el permiso de catálogo → en `/hub-portal` no ve Productos ni Categorías. Actívale el permiso desde la fila → sin volver a iniciar sesión aparecen las pestañas; crea un producto con foto y variantes y una categoría propia. Desde otro negocio no puede tocarlos (403).

### C. Sprint 1.5

- [ ] Directorio del hub → entra a una tienda → agrega al carrito → checkout: el carrito llega lleno. Repite entrando por el `store_link` largo.
- [ ] Pantalla de pago de un negocio del hub ofrece **Efectivo**.
- [ ] Producto con una opción sin costo: se ve el nombre limpio, sin "0" pegado; una opción con `+ $0.50` sí lo muestra.
- [ ] Tiempo estimado: ponlo en Negocios → Información; si activas "Cada negocio define su tiempo estimado" el portal lo puede editar; si lo desactivas, el portal lo ve pero no lo edita.

### D. Sprint 2 — comprobante de pago

- [ ] Paga un pedido con Yape (o transferencia): la pantalla pide "Envía tu comprobante". Sube una captura ≤ 8 MB → "Comprobante enviado · pendiente de verificación".
- [ ] El pedido **sigue Pendiente de pago**. En hub-admin, portal y dashboard aparece "Comprobante por verificar" con la miniatura; en el ticket, la fila del comprobante.
- [ ] Marca pagado desde el hub-admin: la pill desaparece.
- [ ] Con "Después de confirmar, el aviso va → Al hub", el botón de WhatsApp del cliente abre el número del hub; con "Al negocio", el del negocio; con "Sin aviso", no hay botón.
- [ ] Un negocio SaaS normal (no hub): la pantalla de Yape también pide comprobante y el aviso va al negocio. (El toggle para apagarlo en el dashboard SaaS queda pendiente; el backend ya lo acepta.)

### E. Sprint 3 — confirmación y bolsa

Con "El hub confirma los pedidos" **encendido**:

- [ ] Haz un pedido de delivery → en hub-admin aparece el banner "N pedidos esperan tu confirmación" y la etiqueta "Por confirmar". El portal del negocio **no** lo lista y el negocio **no** recibe WhatsApp.
- [ ] Rechaza uno con motivo → queda cancelado y el stock vuelve al producto.
- [ ] Confirma otro con "Publicar para repartidores" marcado → el negocio recibe su WhatsApp (solo en producción; en staging el aviso al negocio está detrás de `STAGE === 'production'`) y el pedido aparece en su portal.
- [ ] `/hub-driver` en dos celulares o dos navegadores con dos repartidores: ambos ven el pedido en Disponibles; el primero que pulsa "Tomar pedido" se lo queda; el segundo ve "Otro repartidor ya tomó este pedido" y desaparece de su lista.
- [ ] El repartidor ve dirección, referencia, botones Google Maps y Waze al pin; el teléfono del cliente **no** aparece salvo que lo actives en "Qué ve el repartidor".
- [ ] Recogí → En camino → Entregado: el drawer del hub y el portal muestran repartidor y horas; `order_status` termina en Entregado. Reporta una incidencia con nota: el hub la ve en rojo.
- [ ] Asignación manual desde el drawer a un repartidor concreto; "Quitar y republicar" lo devuelve a la bolsa.

Con "El hub confirma" **apagado**: el negocio ve el pedido al instante y el hub publica a mano.

### F. Sprint 4 — aviso al cliente

Requiere la plantilla **APPROVED** en Meta y `CUSTOMER_NOTIFY_DISABLED` sin poner.

- [ ] Haz un pedido con tu número como cliente y confírmalo desde el hub → recibes "✅ ¡Hola {nombre}! Tu pedido #N en {negocio} está confirmado. Tiempo estimado: … " con el botón "Ver mi pedido" que abre el pedido.
- [ ] Vuelve a cambiar el estado a Confirmado: **no** llega un segundo mensaje. El drawer muestra "Cliente avisado por WhatsApp el …".
- [ ] Apaga "Avisar al cliente por WhatsApp al confirmar" en Ajustes → un pedido nuevo confirmado no manda nada.
- [ ] Negocio SaaS: en Ajustes → WhatsApp el toggle "Aviso al cliente al confirmar el pedido" nace apagado; enciéndelo, guarda, recarga (sigue encendido), marca un pedido como Confirmado desde el dashboard → llega el mensaje.

### G. Sprint 5 — liquidación de repartidores

- [ ] Repartidor entrega un pedido en efectivo → la app pregunta "¿Cómo te pagó el cliente?" → "En efectivo". El pedido queda **Pagado** y el drawer del hub muestra "Cobró X (efectivo)".
- [ ] Entrega un pedido ya pagado con tarjeta: la app **no** pregunta y registra "Sin cobro".
- [ ] Desde el drawer del hub cambia el cobro a "No cobró": el pago **no** se revierte (lo cambias aparte si corresponde).
- [ ] Liquidaciones → Repartidores: define la regla (por ejemplo 2.00 fijo por entrega) y guarda. Calcula el día: fila del repartidor con entregas, cobrado, comisión y el neto en el lenguaje "Entrega al hub X" o "El hub le paga X".
- [ ] Abre el detalle, agrega un bono de 5.00 y un descuento de 1.00: el neto se recalcula. Quita el descuento. Vuelve a calcular: los ajustes se conservan.
- [ ] Marca pagada con referencia, descarga el CSV. Vuelve a calcular: la pagada no cambia.
- [ ] En `/hub-driver` → Mi cuenta: "Hoy" y "Período actual" cuadran con la liquidación; la liquidación pagada aparece con su referencia y su detalle por entrega.
- [ ] Cambia la frecuencia a semanal y calcula la semana: la clave del período cambia (`2026-Www`) y las diarias anteriores se siguen viendo.

### H. Delivery por distancia (si no se probó ya en staging)

- [ ] Hub con "Por distancia" y un negocio con pin: en el checkout manual aparece "Tu ubicación en el mapa"; con GPS o buscando la dirección se pinta la ruta y el envío cambia con los km.
- [ ] Cambia la tarifa en Ajustes mientras un checkout está abierto y confirma el pedido: el checkout muestra el nuevo precio (409 `delivery_price_changed`) en vez de cobrar de más.
- [ ] Un pin fuera del radio: "fuera de cobertura".
- [ ] En Mongo `orders`: `delivery_distance_km`, `delivery_geo`, `delivery_pricing_strategy: 'distance'`; en `delivery_route_cache`, provider `ors` si pusiste la key, `osrm-public` si no.

### I. Regresión SaaS y White Label (10 minutos)

- [ ] Checkout normal de un negocio SaaS con efectivo y con tarjeta: sin cambios.
- [ ] Dashboard → Pedidos → detalle: se ve igual; el comprobante solo aparece si hay.
- [ ] Dashboard → Ajustes → WhatsApp: la plantilla de pedido nuevo se guarda como antes.
- [ ] Un negocio White Label con dominio propio: tienda, checkout y pantalla de pago funcionan; el paso de comprobante aparece en métodos manuales.
- [ ] Agency Portal: abre y lista negocios (no debería verse afectado).

---

## 7. Producción

### 7.1 Antes

1. Staging con la guía del §6 completa y sin pendientes rojos.
2. `git fetch` en `ordenaapp-business` y `ordenaapp-orders`; abrir PRs `feature/new-mode-ordena-hub → main` en los 6 repos con cambios (products, orders, api-gateway, business, hubs, frontend). El bot solo lleva docs; puede ir en el mismo PR o después.
3. Plantilla `pedido_confirmado_cliente_es` **APPROVED** (la WABA es la misma para staging y prod: se crea una vez).
4. `ORS_API_KEY` regenerada lista para el `.env` de business de prod.
5. Decidir el estado inicial de los interruptores del hub de Oe Ya (ver 7.4).

### 7.2 Despliegue

Mismo orden del §4: products → orders (`npm install`) → api-gateway → business → hubs → frontend (Vercel, rama `main`).

Variables de prod: solo `ORS_API_KEY` es nueva y recomendable. No pongas `CUSTOMER_NOTIFY_DISABLED` ni las de registro público. Confirma que `INTERNAL_HUBS_SECRET` de prod está en products (si no, 403 al subir comprobantes).

### 7.3 Scripts contra la base de prod (una vez)

```bash
cd ordenaapp-orders && DRY_RUN=1 npx ts-node src/scripts/backfillOrderNumbers.ts
```

```bash
cd ordenaapp-orders && npx ts-node src/scripts/backfillOrderNumbers.ts
```

Y, si no se hicieron ya en prod: `migrate-plans-v2` + `migrate-businesses-planfeatures` (business) y `seedHubPlans` + `reapplyHubPlans` (hubs). Todos idempotentes.

### 7.4 Configuración del hub de Oe Ya (con ellos en la llamada)

Repite el §5.6 en prod. Recomendación de arranque para no cambiarles todo el mismo día:

| Interruptor | Arranque sugerido | Cuándo encender |
|---|---|---|
| El hub confirma los pedidos | **Encendido** (lo pidieron en la reunión) | Desde el día 1 |
| Publicar para repartidores al confirmar | Encendido | Desde el día 1 |
| Avisar al cliente por WhatsApp | Encendido | En cuanto Meta apruebe la plantilla; antes no hace nada |
| Teléfono del cliente para el repartidor | Apagado | Solo si ellos lo piden |
| Comprobante de pago → aviso | Al hub | Desde el día 1 |
| Regla de pago a repartidores | La que usen en su Excel hoy | Antes del primer corte |

Crear los usuarios repartidores con su email y una contraseña inicial; que cada uno agregue `/hub-driver` a la pantalla de inicio del celular.

### 7.5 Smoke reducido en prod

Con un pedido de prueba real (márcalo después como "pedido de prueba" en el dashboard):

- [ ] Pedido → banner "por confirmar" → confirmar → llega el WhatsApp al negocio y al cliente → aparece en Disponibles de un repartidor → tomar → entregar en efectivo → pedido Pagado → Liquidaciones → Repartidores del día lo muestra.
- [ ] Comprobante con Yape en un negocio del hub visible en el drawer.
- [ ] Pedido en un negocio SaaS cualquiera: todo igual que antes.

### 7.6 Si algo sale mal (todo es aditivo)

| Síntoma | Acción sin redeploy |
|---|---|
| Llegan mensajes al cliente que no deben | `CUSTOMER_NOTIFY_DISABLED=true` en orders y reiniciar; o apagar el toggle en el hub |
| El hub no quiere confirmar todavía | Apagar "El hub confirma los pedidos": los pedidos nuevos vuelven al flujo directo (los pendientes se confirman a mano) |
| Comprobante molesta en SaaS | Apagar `payment_proof.enabled` del negocio vía `updateBusiness` (el toggle de dashboard está pendiente) |
| Cobros mal registrados | Corregir desde el drawer del pedido y recalcular la liquidación (si no está pagada) |
| Subida de comprobantes falla | Revisar `INTERNAL_HUBS_SECRET` en products y `PRODUCTS_SERVICE_LINK` en orders |

Ningún cambio borra ni migra datos existentes; revertir un servicio a la versión anterior es seguro (los campos nuevos quedan en Mongo sin usarse).

### 7.7 Riesgos a vigilar la primera semana

- **Carga del EC2 t3.micro:** la app del repartidor refresca Disponibles y Mis pedidos cada 15 s mientras está abierta. Con ~80 repartidores activos son unas 640 peticiones por minuto a hubs + orders. Vigila memoria y CPU el primer día; si aprieta, sube a t3.small (ya recomendado en el roadmap §9) o aumenta `POLL_MS` en `src/app/hub-driver/page.tsx`.
- **Plantilla de Meta:** si Meta la devuelve con cambios de texto, no hace falta tocar código mientras se respeten las 5 variables y el botón; si cambia el nombre, `TEMPLATE_CUSTOMER_CONFIRMED_ES`.
- **Caché de configuración (60 s):** al cambiar interruptores del hub, los pedidos del minuto siguiente pueden usar la configuración anterior.
- **Backfill de `orderNumber`:** córrelo fuera de hora pico; es idempotente y se puede repetir.

---

## 8. Checklist final

- [ ] Push de los 7 repos (§2.1)
- [ ] Staging desplegado en orden (§4) con `npm install` en orders
- [ ] `ORS_API_KEY` regenerada en business; `HUB_SELF_SERVE_SIGNUP` ausente en hubs
- [ ] Backfill de `orderNumber` corrido (DRY_RUN y real)
- [ ] Migraciones de business y seed de hubs verificadas o corridas
- [ ] Hub de pruebas configurado (§5.6) y repartidores creados
- [ ] Plantilla `pedido_confirmado_cliente_es` enviada a Meta
- [ ] Guía de pruebas §6 completa (A–I)
- [ ] PRs a `main` mergeados y prod desplegado en orden
- [ ] Scripts en prod
- [ ] Hub de Oe Ya configurado con ellos (§7.4)
- [ ] Smoke de prod (§7.5) y vigilancia del servidor (§7.7)
