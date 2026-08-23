# ordenaapp-hubs

Microservicio del **Modo Multi-Negocio** de Ordena App: la entidad **Hub/Operator** que administra múltiples negocios bajo una sola cuenta y suscripción (ej. Oe Ya Courier con ~20 negocios).

> Documento de evaluación y plan completo: [`docs/EVALUACION_MODO_MULTINEGOCIO.md`](docs/EVALUACION_MODO_MULTINEGOCIO.md)

## Qué es dueño de este servicio

- **hubs** — entidad Hub (branding, slug, timezone, dominio, suscripción, métricas de uso, visibilidad hacia negocios)
- **hub_users** — usuarios con JWT propio y roles: `HUB_OWNER`, `HUB_ADMIN`, `HUB_STAFF`, `BUSINESS_VIEWER` (Portal Business, con `business_id` fijo en el token)
- **hub_categories** — categorías globales del hub (transversales a sus negocios)

La relación con los negocios vive en business-service (`business.hubId` + `context: 'HUB_MANAGED'`).

## Auth

Igual patrón que agencies: **JWT propio del servicio, no Firebase**. El api-gateway expone `/api/hubs` y `/api/hub-users` como rutas públicas y este servicio valida el token y la pertenencia hub↔business en cada operación.

**Regla de oro de aislamiento:** toda operación sobre un negocio pasa por `assertBusinessBelongsToHub()` y todo acceso de un `BUSINESS_VIEWER` por `resolveScopedBusinessId()`. Nunca se confía en IDs sueltos del cliente.

## Endpoints (F1)

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/api/hub-users/register` | pública | Onboarding self-serve: crea Hub + HUB_OWNER, devuelve token. El slug queda vivo como `{slug}.ordena.app` |
| POST | `/api/hub-users/login` | pública | Login de todos los roles (incl. Portal Business) |
| GET/POST/DELETE | `/api/hub-users` | OWNER/ADMIN | Gestión de usuarios del hub |
| GET | `/api/hubs/resolve?slug=` | pública | Resolución del hub para middleware/storefront |
| GET/PUT | `/api/hubs/me` | JWT | Datos y configuración del hub |
| GET/POST/PUT/DELETE | `/api/hubs/me/categories` | JWT (escritura OWNER/ADMIN) | Categorías globales |
| GET/POST | `/api/hubs/me/businesses` | roles hub | Listar / crear negocios del hub |
| PATCH | `/api/hubs/me/businesses/:id/operational-status` | roles hub | `active` \| `paused` \| `temporarily_closed` |

## Contrato F1 pendiente en otros repos

Este servicio define el contrato; estas contrapartes deben aterrizar para que los endpoints de negocios funcionen end-to-end (mientras tanto responden 502 explicando el upstream):

- **ordenaapp-business**
  - `POST /business/hub-managed` — crea Business con `context: 'HUB_MANAGED'`, `hubId`, `planRef.kind: 'HUB_PLAN'`, sin cuenta Firebase del dueño
  - `GET /businesses/hub/:hubId` — espejo de `GET /businesses/agency/:agencyId`
  - Enums: `context` += `HUB_MANAGED`; `planRef.kind` += `HUB_PLAN`; `subscription.source` += `HUB`; `payer.kind` += `HUB`; tercera rama del resolver de planFeatures
  - `businessSettings.operationalStatus` (`active`/`paused`/`temporarily_closed`)
- **ordenaapp-orders** — `order.hub_id` + endpoint by-hub + notificación WhatsApp adicional al hub
- **ordenaapp-products-and-categories** — `product.hubCategoryIds[]` + agregación de búsqueda scoped por hub (patrón de `getProductsByParams`, SIN tocar `/ordena-market`, reservado para el shop propio de Ordena)
- **ordenaapp-api-gateway** — proxy `HUBS_SERVICE_URL` (`:3013`) + política `public` para `/api/hubs` y `/api/hub-users`
- **ordenaapp-frontend** — middleware wildcard `{slug}.ordena.app`, storefront hub, dashboard hub, Portal Business

## Comandos

```bash
npm run dev      # nodemon src/index.ts
npm run build    # tsc → dist/ (dist se commitea; el deploy lo usa)
npm start        # node dist/index.js
```

Variables: ver `.env.example`. Puerto por defecto: **3013**.
