# Guía de despliegue a Staging — MVP Modo Multi-Negocio (F1 + F2)

**Fecha:** 23 de agosto de 2026
**Alcance:** todo lo commiteado en `feature/new-mode-ordena-hub` en 7 repos (frontend + hubs + business + orders + products + payments + gateway).

---

## 0. Resultado de la revisión pre-deploy

Se auditaron los cambios de F1+F2 (contratos entre servicios, aislamiento, lógica de horarios, flujos de checkout/pagos, portal). Verificado ✅:

- Todas las URLs server-to-server apuntan a rutas que existen con el método correcto (montajes `/api` verificados en business/orders/products/payments/hubs; los 14 métodos de pago de la whitelist están montados en payments; el path-rewrite del proxy del gateway produce `/api/hubs/...` correcto).
- La promoción de drafts pagados con tarjeta **sí** corre los side effects (contador del hub incluido) y el `hub_id` se sanitiza en el único punto de creación de órdenes.
- `GENERAL_API_URL` llega al bundle del cliente vía `next.config.mjs` (mismo mecanismo del Agency Portal) — el portal `/hub-admin` no necesita envs nuevas de frontend.
- Los índices nuevos se crean solos al boot (los 4 servicios conectan con `mongoose.connect` y `autoIndex` por defecto). En `orders` el índice parcial de `hub_id` se construye en background (MongoDB 4.2+), no bloquea.

Corregido durante la revisión (ya commiteado):
1. El middleware no reconocía hubs en `{slug}.staging.ordena.app` (el sufijo staging se evalúa antes que el genérico).
2. Crear un usuario `BUSINESS_VIEWER` no validaba que el negocio perteneciera al hub (no filtraba datos — el scope del token lo impide — pero dejaba un acceso roto).
3. La búsqueda del storefront hub pasaba el input crudo a `$regex` (escape agregado).
4. El modal "Agregar negocio" tenía `country_code` fijo en `+51` (ahora editable).

### ✅ Gap de productos: CERRADO (F2.1)

El dashboard hub ahora tiene la sección **Productos**: selector de negocio, crear producto con hasta 4 fotos (proxy multipart hubs→products, sube al bucket de Firebase), editar precio/stock/descripción, activar/desactivar, eliminar y **asignar categorías globales** por producto. Endpoints: `GET/POST /api/hubs/me/businesses/:businessId/products`, `PATCH/DELETE .../:productId`, `PATCH /api/hubs/me/products/:productId/hub-categories` — todos con validación de pertenencia hub→negocio y límites de plan del upstream intactos.

### 🔐 Auditoría de seguridad (segunda pasada, multi-agente adversarial)

Se auditó todo el código del hub con 5 revisores + verificación adversarial: **18 hallazgos confirmados**, todos corregidos. Los críticos:

| # | Problema | Corregido en |
|---|---|---|
| 1 | `updateProduct` no filtraba por negocio → **cualquiera podía editar productos de cualquier tienda** de la plataforma (precio, stock, visibilidad) | products |
| 2 | `patchBusinessInternal` **sin autenticación alguna** → reescribir nombre/teléfono/dirección de cualquier negocio | business |
| 3 | Secreto interno **fail-open**: sin la env, todos los endpoints internos quedaban abiertos (incluido el listado de pedidos con PII de clientes) | hubs, business, orders, products |
| 4 | `hub_id` aceptado del cliente sin verificar → inyectar pedidos en el panel de un hub ajeno | orders |
| 5 | `hubPaymentsKey` de header/cookie sin verificar → mostrar las cuentas bancarias de un hub en una tienda ajena | frontend |
| 6 | Pagos del hub se perdían en el paso 2 de `/pagar` (los 14 detalles no eran hub-aware) | frontend |
| 7 | Passthrough `--` servía tiendas de OTRO hub bajo el host de un hub | frontend (middleware) |

Además: uploads restringidos a imágenes con límites y errores 400 claros; `/hub-logo` solo toca negocios `HUB_MANAGED` y valida el secreto **antes** de consumir el archivo; el `BUSINESS_VIEWER` ya no recibe la suscripción/límites/métricas del hub; subdominios de infraestructura (`cname`, `dns`, `mx`…) nunca se tratan como hub; `*.localhost` deja de ser origen confiable en producción; y dos bugs de horarios (el editor pisaba el horario real con el default, y el layout perdía el horario al ir al checkout).

Otros menores conocidos (no bloquean): creación concurrente del mismo negocio puede dar 500 por índice único (reintentar funciona); el botón "Ver tienda" del dashboard arma la URL `*.ordena.app` (en staging apunta a prod — cosmético); el toggle `allowSalesOutsideHours` da 500 si el negocio jamás abrió sus settings (se auto-crean al primer GET — escenario raro).

---

## 1. Prerrequisitos (una sola vez)

| # | Qué | Cómo |
|---|---|---|
| 1 | **Repo GitHub para el ms hubs** | Crear `Ordena-App/ordenaapp-hubs`, agregar remote y pushear `main`, `develop` y `feature/new-mode-ordena-hub` (el repo local ya tiene las 3 ramas) |
| 2 | **Pipeline/hosting del ms hubs** | Igual que agencies: Node, `npm ci && npm start` (usa `dist/` commiteado). Puerto interno **3013** |
| 3 | **Secreto interno compartido** | Generar UNO (`openssl rand -hex 32`). Es el mismo valor en 5 envs (ver §3) — sin él los endpoints internos quedan abiertos en modo compat |
| 4 | **JWT del hub** | Generar otro secreto para `JWT_SECRET` del ms hubs (NO dejar el default `hubs-service-secret`) |
| 5 | **Wildcard DNS staging** | `*.staging.ordena.app` → CNAME al deployment de staging en Vercel, y agregar el dominio wildcard al proyecto Vercel de staging. (Para prod, más adelante: `*.ordena.app` al proyecto prod) |
| 6 | **Push de ramas** | Pushear `feature/new-mode-ordena-hub` de los otros 6 repos y mergear al branch que despliega staging según el pipeline de cada uno |

> **Sin migraciones de datos.** Todos los campos nuevos tienen default (`hubId: null`, `hub_id: null`, `operationalStatus: 'active'`, `allowSalesOutsideHours: true`, `hubCategoryIds: []`). Las colecciones `hubs`, `hub_users`, `hub_categories` se crean solas al primer insert. Los índices se crean al boot de cada servicio.

---

## 2. Orden de despliegue

```
1. ordenaapp-hubs        (nuevo — nadie depende de que exista para lo actual)
2. ordenaapp-business    (enums + endpoints hub-managed)
3. ordenaapp-orders      (hub_id + endpoints internos + increment hub)
4. ordenaapp-products    (hubCategoryIds + búsqueda hub)
5. ordenaapp-payments    (planGate isHubKey)
6. ordenaapp-api-gateway (proxy /api/hubs — va después de que hubs esté vivo)
7. ordenaapp-frontend    (último: consume todo lo anterior)
```

Todo es **aditivo y retrocompatible**: puede desplegarse en cualquier orden sin romper tiendas actuales; el orden de arriba solo evita ventanas donde una feature hub llame a algo que aún no existe.

---

## 3. Variables de entorno por repo

> `SECRETO_INTERNO` = el valor único del prerrequisito #3. Los nombres difieren por repo pero **el valor es el mismo**.

### ordenaapp-hubs (servicio nuevo — todas)

| Env | Valor staging | Nota |
|---|---|---|
| `PORT` | `3013` | |
| `DB_LINK` | Mongo compartida de staging | La misma que business/orders (shared DB) |
| `JWT_SECRET` | *(secreto propio)* | **Obligatorio** — firma los tokens de hub-users |
| `BUSINESS_SERVICE_LINK` | `http://<business-staging>:3002/api` | Con `/api` al final |
| `ORDERS_SERVICE_LINK` | `http://<orders-staging>:3005/api` | |
| `PAYMENTS_SERVICE_LINK` | `http://<payments-staging>:3006/api` | |
| `PRODUCTS_SERVICE_LINK` | `http://<products-staging>:3004/api` | Reservado (tagging de categorías) |
| `INTERNAL_HUBS_SECRET` | `SECRETO_INTERNO` | **Obligatorio.** Manda `x-ordena-secret` a business/orders/products Y valida el que le manda orders. (También se acepta `INTERNAL_SHARED_SECRET` por compat.) |

### ordenaapp-api-gateway

| Env | Valor staging |
|---|---|
| `HUBS_SERVICE_URL` | `http://<hubs-staging>:3013/api` |

### ordenaapp-orders

| Env | Valor staging |
|---|---|
| `HUBS_SERVICE_LINK` | `http://<hubs-staging>:3013/api` |
| `INTERNAL_HUBS_SECRET` | `SECRETO_INTERNO` |

### ordenaapp-business

| Env | Valor staging |
|---|---|
| `INTERNAL_HUBS_SECRET` | `SECRETO_INTERNO` |

### ordenaapp-products-and-categories

| Env | Valor staging |
|---|---|
| `INTERNAL_HUBS_SECRET` | `SECRETO_INTERNO` |

### ordenaapp-payments y ordenaapp-frontend

**Sin envs nuevas.** (Frontend usa `GENERAL_API_URL` existente; payments solo ganó el fallback `isHubKey` que lee la shared DB.)

> ⚠️ **El secreto interno es OBLIGATORIO** (cambió tras la auditoría de seguridad): los endpoints internos son ahora **fail-closed** — sin la env configurada devuelven 403 y el Modo Multi-Negocio no funciona (crear negocios, pedidos del hub, productos, logos). Antes aceptaban sin header, lo que los dejaba abiertos a internet a través del gateway.
>
> El servicio hubs acepta `INTERNAL_HUBS_SECRET` (nombre canónico) o `INTERNAL_SHARED_SECRET` (compat). **Lo más simple: usa `INTERNAL_HUBS_SECRET` con el mismo valor en los 4 servicios** (hubs, business, orders, products).

---

## 4. Qué NO hay que tocar

- `ALLOWED_CORE_ORIGINS` del gateway: los subdominios `{slug}.ordena.app` / `{slug}.staging.ordena.app` pasan por `isTrustedOrigin` automáticamente.
- Stripe/planes: F3 — el MVP funciona sin billing (los hubs nacen en `subscription.status: 'TRIAL'` con límites ilimitados por default permisivo).
- WhatsApp bot, shipping, queue, reportes, agencies, auth, users: **cero cambios**.

---

## 5. Rutas de entrada del MVP

| URL | Qué es |
|---|---|
| `staging.ordena.app/hub-admin/login` | Login + **"Crear mi hub"** (onboarding self-serve) |
| `staging.ordena.app/hub-admin` | Dashboard del hub (OWNER/ADMIN/STAFF) |
| `staging.ordena.app/hub-portal` | Portal Business (BUSINESS_VIEWER — redirige solo) |
| `{slug}.staging.ordena.app` | Storefront público del hub |
| `{slug}.staging.ordena.app/{negocio}` | Tienda del negocio (storefront clásico reutilizado) |

---

## 6. Smoke test end-to-end (checklist del §49)

1. **Crear hub**: `/hub-admin/login` → "Crear mi hub" → nombre "Hub Prueba", país Perú → entra al dashboard. ✅ esperado: `hub-prueba.staging.ordena.app` resuelve.
2. **Crear 2 negocios** en *Negocios* (ej. "Pizzería Uno", "Ferretería Dos"). ✅ ambos con su slug y estado Activo.
3. **Cargar productos**: en *Productos*, elegir el negocio → "Agregar producto" (nombre, precio, stock, descripción, fotos). ✅ el producto aparece en la lista con su imagen.
4. **Categorías globales**: crear "Pizza" y "Herramientas" en *Categorías*; en *Productos* usar el botón de etiquetas de un producto para asignarle una. ✅ el chip aparece en la card.
5. **Storefront**: abrir `hub-prueba.staging.ordena.app` → se ven negocios, categorías, productos con su negocio; buscar "pizza" filtra transversal.
6. **Compra**: entrar a `/{negocio}`, agregar al carrito, checkout con datos de prueba. ✅ la orden en Mongo trae `hub_id`; el hub la ve en *Pedidos*; el OTRO negocio no la ve.
7. **Pagos del hub**: en *Pagos* configurar una transferencia bancaria → abrir el link de pago del pedido (`/{negocio}/ordenes/{id}/pagar`) → aparece la cuenta DEL HUB (no la del negocio).
8. **Routing de estados**: cambiar el estado desde *Pedidos* del hub.
9. **Portal Business**: en *Usuarios* crear un "Portal de negocio" para Pizzería Uno → login con ese usuario → cae en `/hub-portal`, ve SOLO sus pedidos/KPIs, puede cambiar estado. Intentar `/hub-admin` → lo expulsa.
10. **Horarios**: como el negocio hub nace con venta-fuera-de-horario bloqueada, poner el horario de hoy como cerrado (vía settings del negocio en Mongo o esperar fuera de horario) → el storefront muestra el banner y no deja agregar al carrito. Probar un horario overnight (`19:00 → 04:00`).
11. **Contadores**: tras 1-2 pedidos, el dashboard del hub muestra pedidos/ventas y `hubs.usageMetrics.ordersCurrentMonth` incrementó en Mongo.
12. **Aislamiento negativo**: con el token del viewer, llamar `GET /api/hubs/me/orders?businessId=<negocio ajeno>` → 403.

---

## 7. Pendientes después de staging (recordatorio)

- **F3**: planes `hub_*` en Stripe + webhook → ms hubs, límites activos, reportes hub en ms-reportes.
- **WhatsApp al hub**: crear plantilla Meta y conectar la notificación por pedido.
- **F4**: dominio custom del hub, visibilidad configurable, conectar negocios Ordena existentes, estado de cuenta/liquidaciones.
