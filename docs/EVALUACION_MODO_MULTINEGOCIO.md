# Evaluación técnica — Modo Multi-Negocio (Ordena Hub)

**Fecha:** 23 de agosto de 2026
**Estado:** Evaluación completada · Decisiones cerradas · F1 en desarrollo
**Repos analizados:** 14 (frontend + 13 microservicios)

---

## 1. Resumen ejecutivo

Se evaluó la incorporación de la modalidad **Multi-Negocio** (un Operador/Hub administra N negocios bajo una sola cuenta y suscripción, con storefront público agregado). Conclusión:

> **Viable y de bajo riesgo arquitectónico.** No se construye una plataforma nueva: la plataforma ya contiene las dos piezas centrales del producto, construidas y en producción — el patrón de "entidad superior al negocio" (servicio de **agencias**) y el patrón de "storefront agregado multi-negocio" (**market.ordena.app**). El Modo Multi-Negocio es la combinación de ambos patrones más una capa de billing propia.

La modalidad se implementa como **capa opcional**: un negocio con `hubId: null` sigue funcionando exactamente igual que hoy. Cero impacto en clientes CORE y White Label existentes.

---

## 2. Decisiones cerradas

| # | Tema | Decisión | Justificación |
|---|---|---|---|
| 1 | URL pública | **`{slug}.ordena.app`** (subdominio) | Wildcard configurado una sola vez → onboarding 100% self-serve. Cero colisión con el namespace de `store_link`. Transición natural a dominio custom (F4) con la infraestructura de dominios ya existente |
| 2 | Backend | **Nuevo microservicio `ordenaapp-hubs`** (puerto 3013) | Clona el patrón probado de agencies (JWT propio + roles). No se mezclan productos comerciales distintos en un codebase. Cambios quirúrgicos en los demás servicios |
| 3 | Billing | **Stripe directo al Hub** (como CORE, no como agency) | Tiers `hub_*` por webhook existente + ítem con `quantity` por negocio extra + invoice item por pedidos extra. Los negocios del hub **no pagan nada** a Ordena |
| 4 | Pagos del checkout | **Centralizados del Hub** | El hub configura SUS métodos de pago y aparecen en los checkouts de todos sus negocios. El cliente final le paga al hub; el hub liquida a las tiendas por fuera (estado de cuenta formal = F4) |
| 5 | Portal Business | **Read-only + cambio de estado de pedidos** | Rol `BUSINESS_VIEWER` con `businessId` fijo en el token. Todo su tráfico pasa por `/api/hubs/portal/*` con validación de pertenencia server-side |
| 6 | Carrito | **Un solo Business por carrito (MVP)** | Ya es el comportamiento actual: el carrito del storefront es por-tienda (`cartItems:{storeLink}`). El storefront del hub descubre; la compra ocurre en la tienda del negocio |
| 7 | Nombre en UI | "Negocio" (no "proveedor") | Según documento original |

---

## 3. Principio arquitectónico

```
                 Hub  (cliente de Ordena · 1 suscripción Stripe)
                  │
      ┌───────────┼───────────┐
      ▼           ▼           ▼
  Business A  Business B  Business C     ← context: 'HUB_MANAGED', hubId
      │           │           │             (business sigue siendo la entidad
   Products    Products    Products          comercial: inventario, horarios,
      │           │           │              WhatsApp, estadísticas propias)
    Orders      Orders      Orders       ← order.hub_id + business_id
      │           │           │
      ▼           ▼           ▼
    Portal      Portal      Portal       ← BUSINESS_VIEWER (solo SU negocio)
```

`business.context` sigue siendo **el discriminador** de la plataforma, ahora con tres valores que nunca mezclan caminos:

```
context: 'SAAS'         → CORE (Stripe directo al negocio)
context: 'WHITE_LABEL'  → Agencia (plan de agencia, billing de agencia)
context: 'HUB_MANAGED'  → Hub (plan del hub, billing del hub)        ← NUEVO
```

Con sus discriminadores confirmatorios: `planRef.kind: 'HUB_PLAN'`, `subscription.source: 'HUB'`, `payer.kind: 'HUB'`.

---

## 4. Respuestas a las preguntas del documento original

**1. ¿Qué cambios requiere la arquitectura para introducir Hub sin afectar tiendas normales?**
Campo opcional `hubId` en business + tercer valor del enum `context` + tercera rama del resolver de planFeatures. Todo aditivo; una tienda sin `hubId` no toca ningún código nuevo.

**2. ¿Se puede reutilizar Business como entidad secundaria del Hub?**
Sí. Tres fricciones identificadas y resueltas: (a) `business.email` es required+unique → los negocios hub usan email opcional/derivado (definido en el endpoint `POST /business/hub-managed`); (b) `store_link` es único global → los slugs de negocios hub se namespacean internamente y la URL pública es `{hub}.ordena.app/{slug-del-negocio}`; (c) `subscription.planRef` es required → apunta al plan del hub (`HUB_PLAN`).

**3. ¿Estrategia de permisos Hub ↔ Business?**
JWT propio del servicio hubs (patrón agencies, ya probado en producción) con roles `HUB_OWNER / HUB_ADMIN / HUB_STAFF / BUSINESS_VIEWER`. El BUSINESS_VIEWER lleva su `businessId` **dentro del token**; el servidor lo usa como único scope posible.

**4. ¿Complejidad de consultas agregadas?**
Baja. El pipeline de agregación cross-business con `$lookup` a businesses ya existe (market). Reportes y orders ya leen por `businessId`; el filtro hub es `bussiness_id: { $in: [...] }` o el campo `hub_id` directo.

**5. ¿Categorías globales vs propias?**
Colección `hub_categories` (servicio hubs) + campo `product.hubCategoryIds[]` (products-service, indexado). El producto conserva sus categorías internas intactas.

**6. ¿Cambios en Order?**
Solo `hub_id: string | null` + índice `{hub_id, created_at}`. El resto del pedido no cambia.

**7. ¿Impacto en checkout?**
Mínimo. El flujo del hub desemboca en la tienda/checkout existente; al crear la orden se adjunta `hub_id` y los métodos de pago mostrados son los del hub (consulta por `hubId` en payments en lugar de `businessId`).

**8. ¿Cambios en WhatsApp?**
El routing por negocio **ya existe** (config por-business + dedupe en el bot). Se agrega: si la orden tiene `hub_id`, notificación adicional al número del hub. Sin riesgo de duplicados (dedupeKey por template+pedido ya implementado).

**9. ¿Horarios múltiples y cruce de medianoche?**
Múltiples intervalos por día (hasta 4) **ya existían**. El cruce de medianoche (19:00→04:00) **ya fue implementado** como parte de esta evaluación (backend + frontend + editor de horarios, incluye días especiales y el caso "8am-1pm + 7pm-4am"). También ya existe el bloqueo de venta fuera de horario (`allowSalesOutsideHours`), que en negocios hub tendrá default "no vender cerrado".

**10. ¿Abierto / cerrado / pausado / cierre temporal?**
Abierto/cerrado se derivan del horario (ya existe). Se agrega `operationalStatus: 'active' | 'paused' | 'temporarily_closed'` en businessSettings, consultado junto al horario. "Pausado" = dentro de horario pero sin aceptar pedidos.

**11-12. ¿Qué se reutiliza para Portal Business y Dashboard Hub?**
Portal Business: componentes read-only del dashboard actual (listado de pedidos, resumen, top productos). Dashboard Hub: estructura del Agency Portal (`/app/agency/(portal)`) cambiando el data source a `/api/hubs`.

**13-14. ¿Riesgos de seguridad / aislamiento entre Businesses?**
El mismo modelo que protege a las agencias: (a) toda operación valida pertenencia hub↔business server-side (`assertBusinessBelongsToHub`); (b) el scope del BUSINESS_VIEWER viene del token, jamás del request (`resolveScopedBusinessId`); (c) la administración hub **nunca** pasa por los endpoints admin actuales — el gateway ata esos endpoints a `token.email === business.email` (modelo 1:1 incompatible con un operador de N negocios). Todo por `/api/hubs`.

**15. ¿Cambios al sistema de suscripciones?**
Planes `hub_*` en Stripe; el webhook de payments (ya maneja lookupKeys, upgrades, past_due, cancelaciones) hace PATCH al servicio hubs en lugar de business.

**16. ¿Sistema de límites?**
`hub.usageMetrics` (businessesCount, ordersCurrentMonth) con rotación mensual — patrón idéntico al `usageMetrics` de business que ya funciona. El increment de pedidos del hub se dispara desde orders cuando la orden trae `hub_id`.

**17. ¿Infraestructura de dominios?**
Wildcard `*.ordena.app` (configuración única en Vercel). El middleware ya resuelve por host; se agrega la rama "subdominio de ordena.app → resolver hub". Dominio custom del hub (F4) reutiliza `vercelDomain.service` tal cual.

**18. ¿Extensión vs módulos nuevos?**
Nuevo: servicio hubs, storefront hub, dashboard hub, portal business. Extensión quirúrgica: business (enums + 2 endpoints), orders (1 campo + 1 endpoint + 1 notificación), products (1 campo + 1 query scoped), payments (métodos por hubId + planes hub), gateway (1 proxy + política), frontend middleware (1 rama).

**19. ¿Alcance recomendado del MVP?**
F1 + F2 (ver §7). Con eso Oe Ya opera completo con pagos validados manualmente (como hoy). F3 agrega el cobro automático de Ordena al hub.

**20. ¿Qué se modifica del documento original?**
Dos ajustes: (a) URL por subdominio en lugar de path (misma autonomía, cero colisiones); (b) pagos del checkout centralizados en el hub desde el MVP (el doc los dejaba por-negocio; el modelo del operador tipo Oe Ya, que controla el dinero, pide centralización). Todo lo demás se valida tal como está — incluida la exclusión explícita del §48 (carrito multi-negocio, payouts automáticos, GPS, etc.).

---

## 5. Mapa de reuso (verificado en código)

| Pieza existente | Se convierte en |
|---|---|
| `ordenaapp-agencies` (JWT + roles, entidad superior, portal App Router) | **Plantilla del servicio hubs y del dashboard hub** |
| `market.ordena.app` + `getProductsByParams` (agregación `$lookup` cross-business) | **Patrón del storefront agregado del hub** (endpoints nuevos scoped por hub; `/ordena-market` NO se toca — reservado para el shop propio de Ordena) |
| Storefront + carrito + checkout por tienda | **Se reutiliza tal cual** con `hub_id` adjunto y métodos de pago del hub |
| `businessHours` (multi-intervalo + timezone + specialHours + overnight + allowSalesOutsideHours) | **Horarios por negocio del hub** — ya listo |
| Notificaciones WhatsApp por negocio + dedupe | **Routing de pedidos al negocio correcto** — ya listo; solo se suma la copia al hub |
| Webhook Stripe de payments | **Billing del hub** (planes `hub_*`) |
| `usageMetrics` + rotación mensual + held_by_limit/nudge | **Límites del plan hub** (pedidos/negocios) |
| Tenant resolve + `vercelDomain.service` | **Dominios custom de hub (F4)** |
| Middleware host-based | **Resolución de `{slug}.ordena.app`** |

---

## 6. Riesgos y mitigaciones

| Riesgo | Severidad | Mitigación |
|---|---|---|
| Fuga de información entre negocios del hub | Alta | Validación de pertenencia server-side en TODA operación; scope del viewer en el token; QA específico de aislamiento antes del piloto |
| Administración hub por endpoints admin actuales (gateway valida email 1:1) | Alta | Regla de diseño: la administración hub SOLO existe bajo `/api/hubs`. Documentado en el README del servicio |
| Slug squatting / colisiones de subdominios | Media | Lista de slugs reservados + validación de disponibilidad + unicidad en DB |
| Bugs de borde en horarios overnight (día siguiente, días especiales) | Media | Implementado con reglas estrictas (máx. 1 overnight por día, debe ser el último) + validación espejo front/back |
| Emails de negocios hub (campo unique requerido) | Media | Definición en `POST /business/hub-managed` (email opcional/derivado del hub) |
| Contabilidad de límites del hub con pedidos concurrentes | Baja | `$inc` atómico de Mongo, mismo patrón del increment-order actual |

---

## 7. Fases de implementación

### F1 — Núcleo backend *(en desarrollo)*
- ✅ Horarios overnight + doble turno (business + frontend) — **hecho**
- ✅ Bloqueo de venta fuera de horario (`allowSalesOutsideHours`) — **hecho**
- ✅ Scaffold `ordenaapp-hubs`: entity, auth JWT + roles, onboarding self-serve, CRUD usuarios, categorías globales, gestión de negocios (contrato definido) — **hecho**
- ⬜ business-service: `context HUB_MANAGED` + `POST /business/hub-managed` + `GET /businesses/hub/:hubId` + resolver planFeatures + `operationalStatus`
- ⬜ orders: `hub_id` + endpoint by-hub + notificación WhatsApp al hub + increment de uso del hub
- ⬜ products: `hubCategoryIds` + búsqueda scoped por hub
- ⬜ gateway: proxy `/api/hubs` + `/api/hub-users` públicos

### F2 — Experiencia (MVP comercial junto a F1)
- ⬜ Middleware frontend: wildcard `{slug}.ordena.app` → storefront hub
- ⬜ Storefront hub: home con negocios/categorías, búsqueda global, página de negocio (reuso del storefront actual), checkout con `hub_id` y métodos de pago del hub
- ⬜ Dashboard Hub (base Agency Portal): pedidos consolidados con filtros, gestión de negocios, categorías, usuarios, branding
- ⬜ Portal Business: resumen, pedidos propios, top productos, cambiar estado de pedidos

### F3 — Comercial
- ⬜ Planes `hub_*` en Stripe + webhook → servicio hubs
- ⬜ Límites activos (negocios incluidos con quantity item; pedidos con invoice item / retención)
- ⬜ Reportes hub en ms-reportes (ventas por negocio, top negocios, clientes del hub)

### F4 — Post-MVP
- ⬜ Dominio custom del hub · permisos de visibilidad configurables · conectar negocios Ordena existentes a un hub · estado de cuenta / liquidaciones · pedidos programados

**MVP con valor comercial = F1 + F2** — cubre completo el flujo del §49 del documento original con pagos validados manualmente por el hub (como opera Oe Ya hoy).

---

## 8. Estimación de complejidad

| Bloque | Esfuerzo relativo |
|---|---|
| F1 restante (business + orders + products + gateway) | ~1.5–2 semanas-persona |
| F2 storefront hub | ~1.5 semanas-persona |
| F2 dashboard hub + portal business | ~2 semanas-persona |
| F3 billing + límites + reportes | ~1.5 semanas-persona |

Los números asumen reuso agresivo de los patrones señalados en §5 y una sola persona full-time por bloque; son paralelizables por repo.
