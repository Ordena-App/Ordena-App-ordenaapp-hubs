# F4 — Liquidaciones y Dominio Custom

**Fecha:** 27 de agosto de 2026
**Estado:** implementado. (La afiliación de negocios existentes fue DESCARTADA: los negocios del hub nacen en el hub.)

## 1. Liquidaciones (estado de cuenta hub → negocios)

**Principio:** Ordena NO mueve dinero. El hub transfiere por fuera (su banco); la plataforma calcula, documenta y registra.

- **Comisión POR NEGOCIO**: default del hub (`hub.settlementConfig`) + overrides por negocio (`hub.commissionOverrides`) — a unos les cobra más y a otros menos. Tipos: `percent` (% de ventas), `fixed` (monto por pedido), `none`.
- **Qué entra**: pedidos **ENTREGADOS y PAGADOS** del mes calendario (en la TZ del hub), re-contados desde orders (`GET /internal/hub/:hubId/settlement-lines`, filtros espejo). Las líneas NO llevan datos del cliente (no hay PII que filtrar).
- **Snapshot congelado**: regenerar solo mientras `status != PAID`. Una liquidación pagada es un documento histórico: jamás se pisa; los ajustes entran al período siguiente.
- **Flujo**: `/hub-admin/liquidaciones` → configurar comisiones → Generar período → transferir por fuera → "Marcar pagada" (+referencia). El negocio ve su estado de cuenta en `/hub-portal/estado-de-cuenta` (solo el suyo).
- Colección: `hub_settlements` (único `{hubId, businessId, period}`).

## 2. Dominio custom del hub

- **Flujo**: Ajustes del hub-admin → "Dominio propio" → conectar (registra en Vercel vía proxies internos de business — un solo dueño del token de infraestructura) → apuntar DNS (`A @ 76.76.21.21` / `CNAME www cname.vercel-dns.com`) → Verificar.
- **Serving**: el middleware sirve el hub por dominio verificado con la MISMA lógica del subdominio (`serveHubHost` compartida). El flujo white-label va PRIMERO e intacto; el hub solo entra cuando el host no es tenant WL.
- **SEO**: con dominio verificado, `{slug}.ordena.app` redirige **308** al dominio (nunca en `.localhost`).
- **CORS del gateway**: los orígenes de dominios de hub verificados se permiten vía `resolve-by-domain` cacheado, fail-closed. El flujo WL del gateway quedó intacto (el hub es fallback tras el tenant).
- Un dominio no puede apuntar a dos hubs (candado en `POST /me/domain`).

## 3. Envs

Sin envs nuevas: hubs reutiliza `BUSINESS_SERVICE_LINK` + secreto; el gateway reutiliza `HUBS_SERVICE_URL`.

## 4. Pendiente menor

- PDF/export de la liquidación (hoy: vista en panel + detalle de líneas).
- Quitar el dominio de Vercel al desconectar (hoy solo se desconecta el estado; inofensivo).
