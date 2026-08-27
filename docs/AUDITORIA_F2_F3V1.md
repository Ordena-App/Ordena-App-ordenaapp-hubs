# Auditoría F1+F2+F3 v1 — Modo Multi-Negocio (Ordena Hub)

**Fecha:** 26 de agosto de 2026
**Método:** 18 agentes en 3 fases — 8 dimensiones de auditoría en paralelo, un verificador adversarial independiente por dimensión (intenta REFUTAR cada hallazgo antes de aceptarlo), un crítico de completitud que revisó superficies que nadie miró, y un arquitecto que preparó el roadmap de F3 v2 / F4 (ver `ROADMAP_F3V2_F4.md`).
**Alcance:** todo `feature/new-mode-ordena-hub` en los 8 repos tocados (frontend, hubs, business, orders, products, payments, gateway, whatsapp-bot). 880 lecturas de código.

## Resumen

| | |
|---|---|
| Hallazgos confirmados | **66** (3 críticos · 11 altos · 22 medios · 30 bajos) |
| Descartados por el verificador | 5 falsos positivos |
| Verificaciones en positivo | **127** cosas revisadas y confirmadas CORRECTAS (ver §5) |

**Veredicto general:** la arquitectura está sana — contratos entre servicios exactos, matriz de roles coherente, variables de las 3 plantillas de WhatsApp verificadas una por una contra el contrato, defaults de privacidad consistentes en las 4 capas, `dist/` sincronizado en los 6 backends, y la afirmación "sin migraciones" del doc de deploy es correcta. Lo que sigue son los defectos reales que sobrevivieron a la verificación adversarial, ordenados por severidad. Los 3 críticos y varios altos son **bloqueantes de staging**.

---

# 1. Hallazgos confirmados


## 🔴 Crítico (3)

### `hub-business-email-es-credencial-del-dashboard-clasico` — El "Email del negocio" que pide el hub-admin es, de hecho, la credencial de acceso al dashboard clásico de ese negocio

**🔴 Crítico** · Crítico de completitud

**Archivos:** `ordenaapp-frontend/src/app/hub-admin/(portal)/negocios/page.tsx:687` · `ordenaapp-backend/ordenaapp-business/src/controllers/business.controller.ts:3776` · `ordenaapp-backend/ordenaapp-api-gateway/src/app.ts:448`

**Escenario de fallo:** El operador del hub crea «Pizzería Luigi» y escribe el email real del dueño, luigi@gmail.com (es lo que la UI pide). Luigi —o cualquiera con acceso a ese buzón— crea una cuenta Firebase con luigi@gmail.com en ordena.app/registrar. Con ese token y `x-business-id: {hubBusinessId}` entra al dashboard clásico del negocio del hub y obtiene: (a) el detalle completo de los pedidos con TODA la PII del cliente (nombre, teléfono, dirección, email), saltándose por completo la matriz `hub.businessVisibility` que el hub filtra server-side en hubOrders.controller.ts:31-48; (b) el botón «Notificar a repartidor», que dispara POST /admin/orders/:orderId/notify-delivery — el número lo resuelve orders desde `order.hub_id` (orders.controller.ts:4058-4060), o sea manda el mensaje al repartidor DEL HUB, cobra la plantilla y quema el candado `delivery_notified_at` de una sola vez, exactamente lo que ordenaapp-hubs prohíbe al BUSINESS_VIEWER (hubOrders.routes.ts:30-35); (c) settings, horarios, productos y métodos de pago del negocio. Todo el modelo de privacidad y de roles del Modo Multi-Negocio queda evitable con un registro gratuito.

**Fix sugerido:** Dos cambios, cualquiera de los dos corta la cadena: (1) en el gateway, negar acceso `business_required` cuando `business.context === 'HUB_MANAGED'` salvo que la llamada venga del secreto interno — esos negocios no tienen dashboard clásico por diseño; (2) en createHubManagedBusiness, NUNCA usar el email provisto como `business.email`: sintetizar siempre `hub-{sufijo}-{hubSlug}@hubs.ordena.app` y guardar el email del dueño en un campo aparte (p.ej. `contact_email`) que no participe en la autorización. Además, cambiar el label de la UI para que no sugiera que es un email de acceso.

---

### `pedidos-usesearchparams-build-fail` — useSearchParams() sin Suspense en /hub-admin/pedidos rompe `next build`

**🔴 Crítico** · Frontend del hub

**Archivos:** `ordenaapp-frontend/src/app/hub-admin/(portal)/pedidos/page.tsx:5` · `ordenaapp-frontend/src/app/hub-admin/(portal)/pedidos/page.tsx:133` · `ordenaapp-frontend/src/app/layout.tsx:108` · `ordenaapp-frontend/next.config.mjs:5`

**Escenario de fallo:** `npm run build` / deploy en Vercel: al prerenderizar la ruta estatica /hub-admin/pedidos, Next lanza `useSearchParams() should be wrapped in a suspense boundary at page "/hub-admin/pedidos"` (missing-suspense-with-csr-bailout) y el build falla con exit != 0. Bloquea el deploy de TODO el frontend, no solo del hub.

**Matiz del verificador:** Precision menor sobre la evidencia: el error no depende de que la pagina sea 'estatica' por eleccion, sino de que ninguna ruta del App Router esta marcada como dinamica en este repo. Fix minimo: envolver el cuerpo en <Suspense> o anadir `export const dynamic = 'force-dynamic'` en pedidos/page.tsx.

**Fix sugerido:** Anadir `export const dynamic = 'force-dynamic';` en (portal)/pedidos/page.tsx, o mover el cuerpo a un componente hijo y envolverlo en <Suspense> dentro de la page. (force-dynamic es lo mas barato: la pagina es 100% client-fetched, no gana nada con prerender).

---

### `hub-payment-account-takeover` — Cualquiera (sin auth) puede crear/editar los metodos de pago CENTRALIZADOS de un hub: los IDs de cuenta ahora son publicos y el scope de escritura sale del path/body, no del header validado

**🔴 Crítico** · Pagos del hub

**Archivos:** `ordenaapp-backend/ordenaapp-api-gateway/src/app.ts:116` · `ordenaapp-backend/ordenaapp-api-gateway/src/app.ts:300` · `ordenaapp-backend/ordenaapp-payments/src/utils/middleware.ts:13` · `ordenaapp-backend/ordenaapp-payments/src/routes/zelle.routes.ts:21`

**Escenario de fallo:** Atacante hace `GET /api/hubs/resolve?slug=oe-ya` -> hubId `68f0...ab12cd`. `GET /api/payments/zelle/68f0...` -> `{_id:'6900...', email:'pagos@hub.com'}`. `PATCH /api/payments/zelle/68f0.../6900...` con header `x-business-id: <id de cualquier tienda publica>` y body `{email:'atacante@gmail.com'}`. Desde ese instante TODOS los negocios del hub muestran en /pagar/zelle el correo del atacante y los clientes le transfieren a el. Sin token, sin cookie, dos curls.

**Matiz del verificador:** La cadena es real y no requiere token, pero la ATRIBUCION del agente esta parcialmente equivocada: el agujero de ESCRITURA es PREEXISTENTE, no lo introduce esta rama. `git diff develop...HEAD --stat -- src` en ordenaapp-payments toca SOLO src/lib/businessPlan.ts y src/middlewares/planGate.ts — zelle.routes.ts, bankAccount.routes.ts y utils/middleware.ts estan intactos respecto a develop. Es decir, PATCH/DELETE/POST sin token ya reescribia la cuenta de CUALQUIER negocio antes del hub. Lo NUEVO de la rama es (a) app.ts:116 hace publico el GET de 12 metodos manuales (paypal y bank-accounts ya eran publicos en develop) y (b) que ahora existe una key unica (hubId) que concentra el cobro de TODAS las tiendas del hub, lo que multiplica el blast radius. Severidad critical se sostiene igual.

**Fix sugerido:** En payments: derivar el owner del recurso del header YA validado y rechazar cuando `req.params.businessId !== req.headers['x-business-id']` (y en POST, `req.body.businessId !== header`). Para las escrituras con key de hub, exigir el secreto interno (`x-ordena-secret` / INTERNAL_HUBS_SECRET) que ya usa ordenaapp-hubs contra orders, y que el proxy `paymentsService.external.ts` lo mande. En el gateway, exigir token en `business_required` para metodos mutantes.

---


## 🟠 Alto (11)

### `viewer-pii-bypass-ship-to` — La privacidad del hub (businessVisibility) se rompe: stripOrderPII es una lista negra sobre el documento completo y NO borra ship_to.*, payment.payer_email ni delivery_notified_to

**🟠 Alto** · Aislamiento de tenants

**Archivos:** `ordenaapp-hubs/src/controllers/hubOrders.controller.ts:31-48` · `ordenaapp-hubs/src/controllers/hubOrders.controller.ts:80-92` · `ordenaapp-orders/src/models/orderModel.ts:263-270` · `ordenaapp-orders/src/models/orderModel.ts:56`

**Escenario de fallo:** Un hub configura businessVisibility = { customerName:false, customerPhone:false, customerAddress:false } (defaults del modelo para phone/address, hubModel.ts:123-127). Un BUSINESS_VIEWER hace GET /api/hubs/me/orders con su token. Para toda orden de delivery recibe customer_name=null y delivery_address=null, pero en el MISMO objeto llega ship_to.name = nombre completo del cliente y ship_to.address_line1 + city_locality + state_province + postal_code = su direccion exacta. Si la orden se pago con tarjeta llega ademas payment.payer_email y card_last4/card_brand. Y en cuanto el operador pulsa "Notificar a repartidor" en esa orden, el viewer ve delivery_notified_to = el numero de WhatsApp del repartidor del hub, que es informacion del operador que el diseno oculta explicitamente en getMyHub/login. La funcion F3 de privacidad queda anulada para el 100% de los pedidos con delivery.

**Matiz del verificador:** stripOrderPII debe ser lista BLANCA (o anular tambien ship_to, payment.payer_email/card_last4/card_brand y delivery_notified_to). Mejor aun: proyectar en getOrdersByHubInternal.

**Fix sugerido:** Invertir la logica: en vez de anular campos (lista negra), construir la respuesta con una lista blanca explicita de campos que el Portal Business puede ver (_id, bussiness_id, created_at, order_status, payment_status, payment_type, total_amount, order_total, delivery_method, delivery_cost, items, order_note, y los campos de cliente segun visibility). Alternativamente, anadir al menos ship_to, payment.payer_email, payment.card_last4, payment.card_brand, delivery_notified_to, delivery_notified_at, customer_id y seller_ref al saneo, pero la lista blanca es la unica que no vuelve a romperse cuando orders anada un campo nuevo.

---

### `hub-storefront-canonicaliza-a-ordena-app-y-huerfaniza-pedidos` — El storefront del hub se auto-canonicaliza a ordena.app, y esa URL sirve la misma tienda SIN contexto de hub: los pedidos hechos ahí nacen huérfanos (hub_id=null)

**🟠 Alto** · Crítico de completitud

**Archivos:** `ordenaapp-frontend/src/utils/products/seo.ts:53` · `ordenaapp-frontend/src/pages/[storeName].tsx:416` · `ordenaapp-frontend/src/middleware.ts:401` · `ordenaapp-frontend/src/pages/[storeName]/checkout/index.tsx:1815`

**Escenario de fallo:** Un cliente comparte por WhatsApp la tienda que vio en oe-ya.ordena.app/pizzeria: el preview usa og:url → https://www.ordena.app/pizzeria--ab12cd. Todos los que abren ese enlace compran en la versión sin hub. Cada uno de esos pedidos se guarda con hub_id=null y por tanto: no aparece en GET /internal/hub/:hubId/orders (filtra por hub_id, orders.controller.ts:3796) → invisible en /hub-admin/pedidos y en el dashboard del operador; no dispara incrementHubOrderUsage → no cuenta para el límite ni para la facturación del hub; no dispara el aviso de WhatsApp al operador (orders.controller.ts:309-314 se activa con `order?.hub_id`); si alguien lo notifica, notify-delivery cae a la rama SaaS y busca `delivery_options.delivery_person_whatsapp` del negocio en vez del repartidor del hub (orders.controller.ts:4058-4062); y el /pagar de esa ruta ofrece los métodos del NEGOCIO, no las cuentas centralizadas del hub. En SEO el efecto es simétrico: el canonical le dice a Google que la página buena es la de ordena.app, así que el subdominio del hub nunca indexa y todo el tráfico orgánico del hub aterriza en la versión rota.

**Fix sugerido:** (1) En seo.ts, añadir rama de hub: si el negocio tiene `hubId`/`hubSlug`, el origen es `https://{hub.slug}.ordena.app` y la ruta el `hubSlug` bonito, no el store_link namespaceado. (2) En middleware.ts, en la rama de core host, redirigir 301 cualquier `/{algo}--{6hex}` cuyo sufijo resuelva a un hub hacia el subdominio correspondiente, en lugar de servirlo. (3) Defensa en profundidad en orders: si `data.hub_id` queda null pero el `business` consultado tiene `hubId`, estamparlo — el hub_id debe derivarse del negocio, no del cliente.

---

### `internal-hub-secret-never-configured` — El secreto interno se envía con un nombre de env y se valida con otro; no está puesto en ningún .env → todo hub-admin devuelve 502

**🟠 Alto** · Contratos entre servicios

**Archivos:** `ordenaapp-backend/ordenaapp-hubs/src/config/config.ts:18` · `ordenaapp-backend/ordenaapp-business/src/config.ts:34` · `ordenaapp-backend/ordenaapp-orders/src/config.ts:29` · `ordenaapp-backend/ordenaapp-products-and-categories/src/controllers/product.controller.ts:2467`

**Escenario de fallo:** Con la configuración actual, un HUB_OWNER abre /hub-admin y pulsa cualquier cosa: GET /api/hubs/me/businesses → hubs llama GET /api/businesses/hub/:hubId sin secreto válido → business responde 403 «Llamada interna no autorizada» → hubs lo traduce a 502 «No se pudo listar los negocios (business-service respondió 403)». Lo mismo para crear negocio, productos, logo, horarios, pedidos y resumen. Y aunque se ponga `INTERNAL_HUBS_SECRET` solo en hubs, seguiría fallando: el emisor lo tomaría pero los receptores seguirían con la env vacía.

**Matiz del verificador:** El titular es inexacto: NO hay divergencia de nombres. El emisor (ordenaapp-hubs/src/config/config.ts:18-19) lee `process.env.INTERNAL_HUBS_SECRET || process.env.INTERNAL_SHARED_SECRET || ''`, es decir acepta el nombre canónico con prioridad. El defecto real y único es que los tres receptores no tienen NINGÚN valor puesto: verifiqué los .env locales y business/orders/products no definen INTERNAL_HUBS_SECRET (0 ocurrencias), mientras hubs solo define INTERNAL_SHARED_SECRET. Además los .env están gitignoreados (business/.gitignore:3 → `git check-ignore` confirma), así que su ausencia local NO prueba ausencia en producción; en Render/host puede ya estar configurada. El arreglo es de configuración (una env con el mismo valor en 4 servicios), no de código, por eso lo bajo de critical a high: no hay vector de seguridad ni pérdida de datos, solo indisponibilidad total del feature mientras la env falte.

**Fix sugerido:** Definir INTERNAL_HUBS_SECRET con el MISMO valor en los 4 despliegues (hubs, business, orders, products). Si se prefiere conservar INTERNAL_SHARED_SECRET, añadir el mismo fallback `process.env.INTERNAL_HUBS_SECRET || process.env.INTERNAL_SHARED_SECRET` en los tres receptores, no solo en el emisor.

---

### `agencies-internal-patch-403` — business exige x-ordena-secret en patchBusinessInternal y rompe al unico llamador existente: ordenaapp-agencies

**🟠 Alto** · Preparación de deploy

**Archivos:** `ordenaapp-backend/ordenaapp-business/src/controllers/business.controller.ts:2840` · `ordenaapp-backend/ordenaapp-business/src/controllers/business.controller.ts:3698` · `ordenaapp-backend/ordenaapp-business/src/routes/business.routes.ts:68` · `ordenaapp-backend/ordenaapp-agencies/src/services/billing.service.ts:196`

**Escenario de fallo:** Se despliega ordenaapp-business (paso 2 del orden del doc). Una agencia WHITE_LABEL existente paga su factura -> markInvoicePaid (billing.service.ts:833) recorre los ledgers con onboardingCharge CHARGED y llama updateBusinessOnboardingFeeStatus -> el business service responde 403 -> el campo whiteLabelMeta.onboardingFeeStatus del negocio se queda en "PENDING" para siempre. Consecuencia visible: el Agency Portal muestra "Fee: PENDING" permanentemente (frontend/src/app/agency/(portal)/businesses/page.tsx:430 y dashboard/page.tsx:621) y el reporte financiero cuenta ese negocio en onboardingPendingCount / pendingOnboardingBusinesses para siempre (billing.service.ts:1049, financialAnalytics.service.ts:532). El doble cobro NO ocurre porque hay una segunda barrera por ledger (billing.service.ts:409 alreadyCharged), pero el estado queda corrupto y no hay forma de repararlo desde el producto. Esto invalida ademas la afirmacion del doc §2 ("Todo es aditivo y retrocompatible: puede desplegarse en cualquier orden sin romper tiendas actuales") — no hay orden de despliegue que evite esta ventana porque el llamador roto nunca se despliega.

**Matiz del verificador:** Bajo de critical a high. No hay pérdida de datos, ni caída de servicio, ni agujero de seguridad: lo que queda mal es un campo de metadata (`whiteLabelMeta.onboardingFeeStatus`) que se congela en PENDING. Además el propio hallazgo ya reconoce que el doble cobro está bloqueado por la barrera del ledger (billing.service.ts:409). Es una regresión real y silenciosa sobre funcionalidad existente de agencias WHITE_LABEL, pero su impacto es de reporting/estado, no operativo. Fix trivial: añadir el header en agencies, o excluir la rama `whiteLabelMeta` del guard.

**Fix sugerido:** Antes de desplegar business: (a) agregar INTERNAL_HUBS_SECRET a ordenaapp-agencies y mandar el header en billing.service.ts:200 (`headers: INTERNAL_HUBS_SECRET ? { 'x-ordena-secret': INTERNAL_HUBS_SECRET } : {}`), desplegando agencies ANTES que business; o (b) dejar patchBusinessInternal sin el guard y mover la superficie nueva del hub (name/description/phone/address/operationalStatus) a un endpoint separado con requireInternalHubSecret, como ya se hizo con /business/:id/hub-logo. Ademas, agregar agencies al orden de despliegue del doc §2 y quitarlo de la lista "cero cambios" de §4.

---

### `notify-delivery-i18n-keys-missing` — El boton "Notificar a repartidor" muestra la clave i18n cruda en el detalle de pedido de TODOS los negocios

**🟠 Alto** · Preparación de deploy

**Archivos:** `ordenaapp-frontend/src/pages/admin/tiendas/[businessId]/pedidos/[orderId]/index.tsx:1008` · `ordenaapp-frontend/src/contexts/I18nContext.tsx:68`

**Escenario de fallo:** Cualquier dueno de tienda (SAAS, WHITE_LABEL o hub) abre /admin/tiendas/{id}/pedidos/{orderId} y ve, junto a Imprimir/Descargar, un boton cuyo texto literal es `orders.detail.actions.notifyDelivery`. Tras notificar, pasa a `orders.detail.actions.notifyDeliveryDone 26/08/2026 10:31`. Si el envio falla sin mensaje del backend, el toast dice `orders.toast.errorGeneric`. Es una regresion visible en una pantalla que hoy funciona, en todos los negocios de la plataforma.

**Matiz del verificador:** El hallazgo se queda corto: además de las 3 claves citadas falta `detail.actions.notifyDeliveryAlready` (index.tsx:1010, atributo `title` del botón deshabilitado). Mantengo high: es cosmético, pero es texto crudo tipo `orders.detail.actions.notifyDelivery` visible en una pantalla que hoy funciona bien, en TODOS los tenants de la plataforma incluidos los White Label de agencias — eso normalmente es bloqueante de release.

**Fix sugerido:** Agregar en src/lib/i18n/translations/orders/es.ts y en.ts, dentro de `detail.actions` (linea ~436): notifyDelivery, notifyDeliverySending, notifyDeliveryDone, notifyDeliveryAlready, notifyDeliverySuccess; y `toast.errorGeneric` en `detail.toast` (linea ~477). Los `{ defaultValue: ... }` pueden quedarse (son inertes) pero conviene quitarlos para no repetir el patron.

---

### `branches-not-pushed` — 6 de 8 repos tienen commits locales sin pushear y el whatsapp-bot no tiene la rama en origin: el pipeline desplegaria codigo viejo

**🟠 Alto** · Preparación de deploy

**Archivos:** `ordenaapp-backend/ordenaapp-hubs:HEAD` · `ordenaapp-backend/ordenaapp-whatsapp-bot:HEAD` · `ordenaapp-frontend:HEAD`

**Escenario de fallo:** Se ejecuta el prerequisito #6 del doc ("mergear al branch que despliega staging") sobre lo que hay en GitHub. Como origin/feature/new-mode-ordena-hub esta 5 commits atras en hubs, 4 en orders y 3 en business, staging queda con F1+F2 pero sin F3 v1: el ms hubs no expone /internal/:hubId/notification-config, y orders (si se pushea) lo llama y falla; el smoke test 13-17 del doc no puede pasar. En whatsapp-bot no hay nada que mergear (PLANTILLAS_REPARTIDOR_Y_HUB.md, el unico cambio, solo existe local). Nota: la comparacion usa refs remotas locales sin `git fetch`, asi que conviene confirmar con un fetch antes de actuar.

**Matiz del verificador:** Mantengo high pero acoto el escenario: en whatsapp-bot el gap es SOLO un .md de documentación (0 líneas de código), así que no rompe nada del smoke test — el bot no necesita despliegue. El riesgo real está concentrado en hubs (5 commits = todo F3 v1) y orders (4 commits), donde sí hay un acoplamiento: orders llama a `/internal/:hubId/notification-config` de hubs.

**Fix sugerido:** `git fetch --all` en los 8 repos y luego push de feature/new-mode-ordena-hub en hubs, business, orders, products-and-categories, api-gateway, frontend y whatsapp-bot (este ultimo con -u, la rama no existe en origin). Actualizar tambien el prerequisito #1 del doc: el repo remoto de hubs ya existe (origin = https://github.com/Ordena-App/Ordena-App-ordenaapp-hubs.git, con main/develop/feature ya publicados).

---

### `viewer-pii-via-status-patch` — Un BUSINESS_VIEWER recupera la PII completa del cliente cambiando el estado del pedido — stripOrderPII no se aplica en esa ruta

**🟠 Alto** · F3 v1 — WhatsApp y privacidad

**Archivos:** `ordenaapp-backend/ordenaapp-hubs/src/controllers/hubOrders.controller.ts:126` · `ordenaapp-backend/ordenaapp-hubs/src/routes/hubOrders.routes.ts:36` · `ordenaapp-backend/ordenaapp-orders/src/controllers/orders.controller.ts:3992`

**Escenario de fallo:** Hub con `businessVisibility = { customerName: true, customerPhone: false, customerAddress: false }` (el default del modelo). El negocio entra a su Portal, ve el pedido con teléfono y dirección en null. Cambia el estado a "en preparación" (acción normal, un clic) y la respuesta del PATCH trae `customer_number`, `customer_email`, `delivery_address`, `delivery_city`, `delivery_department` y `delivery_reference` completos. Con eso el negocio se salta la política de privacidad del hub y se queda con el contacto directo del cliente final — exactamente lo que el operador quiso evitar. Basta abrir DevTools, o directamente PATCH /api/hubs/me/orders/:id/status con el token del viewer.

**Matiz del verificador:** Sin corrección: el hallazgo es exacto, incluidos los números de línea y el mecanismo.

**Fix sugerido:** En `updateMyHubOrderStatus`, cuando `ctx.role === "BUSINESS_VIEWER"`, aplicar el mismo `stripOrderPII` al `resp.data.order` antes de responder (extraer la lectura de `hub.businessVisibility` a un helper compartido). Alternativa más robusta: que `updateHubOrderStatusInternal` acepte un flag y devuelva solo `{ _id, order_status, payment_status, updated_at }`.

---

### `notify-delivery-sin-token` — POST /admin/orders/:orderId/notify-delivery se puede disparar sin token: gasta el mensaje y quema el candado de una sola vez

**🟠 Alto** · F3 v1 — WhatsApp y privacidad

**Archivos:** `ordenaapp-backend/ordenaapp-orders/src/routes/orders.routes.ts:76` · `ordenaapp-backend/ordenaapp-orders/src/utils/middlewares.ts:13` · `ordenaapp-backend/ordenaapp-api-gateway/src/app.ts:300` · `ordenaapp-backend/ordenaapp-api-gateway/src/app.ts:449`

**Escenario de fallo:** Nota: el hueco del gateway es PREEXISTENTE y afecta a toda ruta `business_required`; lo que F3 añade es un endpoint que cuesta dinero y es de un solo uso. Un atacante que consiga un `businessId` (aparece en URLs públicas del dashboard y en varios payloads) y un `orderId` (los ids de pedido se exponen en el storefront `/{tienda}/ordenes/{orderId}`) hace `POST /api/orders/admin/orders/<orderId>/notify-delivery` con `x-business-id: <businessId>` y sin Authorization: se envía una plantilla utility de pago al repartidor del hub con nombre, teléfono y dirección del cliente, y el pedido queda marcado con `delivery_notified_at` — el operador legítimo ya no puede notificar nunca ese pedido (recibe 409 para siempre, sin forma de resetear desde la UI). Repetido sobre muchos pedidos es cobro de mensajes + denegación de servicio del flujo de delivery.

**Matiz del verificador:** El hueco de autenticación del gateway es PREEXISTENTE y afecta a toda ruta `business_required` (el hallazgo ya lo dice); lo nuevo de F3 es exponer ahí una acción con costo y de un solo uso. Requiere conocer un par (businessId, orderId) coherente — el orderId lo tiene al menos el propio cliente del pedido vía /{tienda}/ordenes/{orderId}. Mantengo high.

**Fix sugerido:** Corto plazo, en el endpoint de orders: exigir `x-ordena-secret === INTERNAL_HUBS_SECRET` para pedidos con `hub_id` (que es como llega desde ordenaapp-hubs) y, para SaaS/WL, propagar el email verificado del gateway (`x-user-email`, que ya se inyecta) y contrastarlo con el email del negocio. Aparte, cerrar el hueco general: en el gateway, `business_required` debe devolver 401 cuando no hay token, igual que hace `token_no_business` (app.ts:495-503). Y añadir un endpoint/acción para limpiar `delivery_notified_at` cuando el envío no llegó.

---

### `operational-status-cosmetic` — operationalStatus 'paused' / 'temporarily_closed' está etiquetado como "no acepta pedidos" pero no bloquea nada en ningún repo

**🟠 Alto** · Horarios comerciales

**Archivos:** `ordenaapp-frontend/src/app/hub-admin/(portal)/negocios/[businessId]/page.tsx:67` · `ordenaapp-backend/ordenaapp-hubs/src/controllers/hubBusinesses.controller.ts:127` · `ordenaapp-backend/ordenaapp-orders/src/controllers/orders.controller.ts:1254` · `ordenaapp-frontend/src/pages/hub/[hubSlug]/index.tsx:170`

**Escenario de fallo:** La cocina se satura un viernes. El HUB_ADMIN pone "Pizzería X" en Pausado. El home del hub muestra el badge "Pausado" — pero el storefront directo `{hub}.ordena.app/pizzeria-x` (y cualquier link ya compartido por WhatsApp, que es el canal principal) se sirve idéntico: sin badge, sin banner, con el botón de agregar al carrito activo, y `POST /orders` acepta la orden. La pausa no detiene ni un pedido.

**Matiz del verificador:** Preciso: el estado operativo si se persiste y valida en el backend (hubBusinesses.controller.ts:142-156 -> business.controller.ts:2888-2895), asi que no es 'no se guarda'; lo que no existe es ningun consumidor que lo haga cumplir. Falta gatearlo en createOrder (ordenaapp-orders) y/o en CartContext/storefront, y propagarlo al storefront del negocio, no solo al home del hub.

**Fix sugerido:** Enforcement en dos capas, como se hizo con `allowSalesOutsideHours`: (a) pasar `operationalStatus` al storefront y hacer que `isSalesBlockedNow`/`blockIfOutsideHours` lo consideren; (b) rechazar en `createOrder` cuando el negocio no está `active`. Mientras no exista (b), cambiar la etiqueta del selector para no prometer lo que no hace.

---

### `plangate-bypass-body-hubkey` — planGate: `req.body.businessId` tiene prioridad sobre el header y el fallback `isHubKey` solo comprueba existencia -> se salta el gate de plan con cualquier hubId

**🟠 Alto** · Pagos del hub

**Archivos:** `ordenaapp-backend/ordenaapp-payments/src/middlewares/planGate.ts:10` · `ordenaapp-backend/ordenaapp-payments/src/middlewares/planGate.ts:65` · `ordenaapp-backend/ordenaapp-payments/src/lib/businessPlan.ts:47`

**Escenario de fallo:** Negocio en plan Gratis (canUseOnlinePayments=false) hace `POST /api/payments/zelle` con header `x-business-id: <su propio id>` (pasa el gateway y el check de email del token) y body `{businessId:'<hubId cualquiera>', email:'...'}`. planGate lee el body -> no es negocio -> isHubKey true -> next(). Se crea el registro bajo la key del hub: el gate de plan queda saltado Y ademas se inyecta un metodo de cobro en el checkout de todas las tiendas de ese hub (createZelle solo falla si el hub ya tenia uno).

**Matiz del verificador:** Una cita esta mal: bankAccount.controller.ts NO esta detras de planGate. bankAccount.routes.ts:31 es `router.post('/', validateBusinessId, createBankAccount)` — sin `requirePlanFeature`, y el comentario de lineas 22-30 explica que se quito a proposito. Asi que el bypass del gate NO aplica a transferencia bancaria (ahi nunca hubo gate). Si aplica a los 13 POST que si lo montan: zelle.routes.ts:15, sinpe, nequi, daviplata, mercadopago, yape, tigomoney, yappy, wise, blik, oxxo, revolut, paypal (paypal.routes.ts:20) y wompi.routes.ts:16.

**Fix sugerido:** En `extractBusinessId` invertir la precedencia (header validado primero, body nunca) y en el fallback de hub exigir marca de llamada interna (secreto compartido) en vez de `isHubKey` a secas.

---

### `hub-pay-links-off-host` — Los enlaces de pedido/pago de un negocio de hub se construyen contra ordena.app, donde NO hay contexto de hub: el /pagar sirve los metodos del NEGOCIO en vez de los del hub

**🟠 Alto** · Pagos del hub

**Archivos:** `ordenaapp-frontend/src/utils/agencyContext.ts:56` · `ordenaapp-frontend/src/pages/admin/tiendas/[businessId]/pedidos/[orderId]/index.tsx:708` · `ordenaapp-frontend/src/middleware.ts:387` · `ordenaapp-frontend/src/utils/hubPaymentsKey.ts:20`

**Escenario de fallo:** Pedido de hub creado en oe-ya.ordena.app. El negocio abre su panel y usa "enviar mensaje de WhatsApp": el cliente recibe https://ordena.app/pizzeria--ab12cd/ordenes/{id}/pagar. Ahi el /pagar sirve las cuentas del NEGOCIO (o ninguna si el negocio no configuro nada) en vez de las cuentas centralizadas del hub -> el dinero del pedido del hub se transfiere a la cuenta del negocio, o el cliente se queda sin forma de pagar. Corolario del mismo agujero: si el cliente entra a comprar por ordena.app/{slug}--{hubId6}, el checkout no adjunta `hub_id` (checkout/index.tsx:1815 lee la cookie que ahi no existe) y el pedido nunca aparece en el panel del hub.

**Matiz del verificador:** Matiz sobre el vector principal: el enlace de pedidos/[orderId]/index.tsx:708 vive en el dashboard CLASICO (src/pages/admin/tiendas/...), y los negocios de hub tienen ademas su propio portal (src/app/hub-portal/), que no construye ningun enlace de pago (grep de 'pagar|store_link|wa.me' en src/app/hub-portal -> 0 resultados). Asi que el vector via WhatsApp del panel depende de que el negocio HUB_MANAGED use el dashboard clasico. El COROLARIO, en cambio, no depende de nada: ordena.app/{slug}--{hubId6} es servible y no lleva contexto de hub.

**Fix sugerido:** Un helper `getHubStoreUrl(business, hubSlug)` que devuelva `https://{hubSlug}.ordena.app/{slugBonito}` para HUB_MANAGED y usarlo en los 3 puntos que arman enlaces; y/o redirigir en middleware.ts (rama core) `/{slug}--{hubId6}` al subdominio del hub.

---


## 🟡 Medio (22)

### `hub-resolve-leaks-delivery-whatsapp` — GET /api/hubs/resolve (publico, sin auth) devuelve el subdocumento contact completo, incluido deliveryWhatsapp y el email/telefono del operador

**🟡 Medio** · Aislamiento de tenants

**Archivos:** `ordenaapp-hubs/src/controllers/hubs.controller.ts:23-25` · `ordenaapp-hubs/src/models/hubModel.ts:16-33` · `ordenaapp-hubs/src/routes/hubs.routes.ts:13` · `ordenaapp-api-gateway/src/app.ts:106-108`

**Escenario de fallo:** curl 'https://<api>/api/hubs/resolve?slug=oe-ya' sin cabecera Authorization devuelve data.hub.contact.deliveryWhatsapp — el numero personal del repartidor del hub — mas contact.email y contact.phone del operador. Cualquiera que sepa (o enumere) el slug de un hub cosecha esos numeros; un competidor o un spammer puede scrapear todos los hubs. Ademas es incoherente: un BUSINESS_VIEWER autenticado NO puede ver ese numero, pero un anonimo si.

**Matiz del verificador:** Severidad medium: exposicion de datos de contacto internos, no de PII de clientes ni acceso privilegiado.

**Fix sugerido:** Proyectar solo los campos publicos que el storefront usa, por ejemplo select('name slug description logo favicon branding timezone country currency language status') y anadir el contacto publico como campos explicitos: 'contact.whatsapp contact.instagram contact.facebook contact.tiktok contact.website'. Nunca contact.deliveryWhatsapp ni contact.email/phone. Revisar tambien 'domain', que no lo necesita el middleware.

---

### `hub-jwt-default-secret` — JWT_SECRET del servicio de hubs tiene fallback hardcodeado 'hubs-service-secret': sin la env, cualquiera firma un token HUB_OWNER de cualquier hub

**🟡 Medio** · Aislamiento de tenants

**Archivos:** `ordenaapp-hubs/src/config/config.ts:7` · `ordenaapp-hubs/src/utils/auth.ts:33-45` · `ordenaapp-hubs/src/utils/auth.ts:62-86`

**Escenario de fallo:** Si el servicio se despliega sin JWT_SECRET (o con el valor de ejemplo), un atacante que lea el repo firma jwt.sign({ userId:'x', email:'x@x', hubId:'<id del hub victima>', role:'HUB_OWNER', businessId:null }, 'hubs-service-secret') y con ese Bearer obtiene control total del hub ajeno: GET /api/hubs/me (suscripcion, limites, metricas, deliveryWhatsapp), GET /api/hubs/me/orders (PII de todos los clientes de todos sus negocios), PUT /api/hubs/me, CRUD de negocios, productos, usuarios y cuentas de pago. El hubId es facil de obtener: viene en texto plano en la respuesta publica de /api/hubs/resolve?slug=... y en la cookie hubId que el middleware del frontend setea en cada visita al storefront.

**Matiz del verificador:** Es condicional a misconfiguracion. Fix: eliminar el fallback y hacer throw en arranque si falta JWT_SECRET; y quitar el valor real de .env.example.

**Fix sugerido:** Eliminar el fallback: `export const JWT_SECRET = process.env.JWT_SECRET || '';` y abortar el arranque (process.exit(1)) o hacer que verifyHubJWT/signHubToken devuelvan 500 si esta vacio, igual que el patron fail-closed ya adoptado para INTERNAL_HUBS_SECRET.

---

### `gateway-passthrough-sin-token` — El gateway deja pasar rutas business_required sin Authorization: basta un x-business-id valido — expone el nuevo endpoint POST /admin/orders/:orderId/notify-delivery

**🟡 Medio** · Aislamiento de tenants

**Archivos:** `ordenaapp-api-gateway/src/app.ts:300` · `ordenaapp-api-gateway/src/app.ts:449-452` · `ordenaapp-api-gateway/src/app.ts:232-238` · `ordenaapp-orders/src/routes/orders.routes.ts:76-78`

**Escenario de fallo:** curl -X POST 'https://<api>/api/orders/admin/orders/<orderId>/notify-delivery' -H 'x-business-id: <businessId>' sin Authorization y sin Origin. El gateway lo deja pasar, orders encuentra la orden y dispara una plantilla de WhatsApp de pago (US$0.02) hacia el repartidor del hub con el nombre, telefono y direccion del cliente y el monto a cobrar. Ademas consume el candado delivery_notified_at, asi que el operador legitimo ya NO podra notificar a su repartidor para esa orden (recibira 409, orders.controller.ts:4035-4042): denegacion de servicio del flujo operativo, orden por orden. El mismo agujero aplica a todo el resto de rutas business_required de todos los servicios.

**Matiz del verificador:** Real pero preexistente en el gateway y de impacto acotado (coste + DoS del aviso, sin exfiltracion). El fix correcto es en app.ts:449: exigir token en policy 'business_required' en vez de condicionar la comprobacion a request.userEmail.

**Fix sugerido:** En el gateway, para policy === 'business_required' exigir token: si no hay request.userEmail, responder 401 antes del proxy (el mismo patron que ya existe para 'token_no_business' en app.ts:487-494). Como defensa en profundidad, el endpoint notify-delivery deberia aceptar tambien x-ordena-secret y no confiar solo en la presencia de x-business-id.

---

### `business-viewer-marca-pedidos-pagados` — BUSINESS_VIEWER puede fijar payment_status (y order_status) a cualquier string arbitrario en los pedidos de su negocio, incluido 'paid'

**🟡 Medio** · Aislamiento de tenants

**Archivos:** `ordenaapp-hubs/src/routes/hubOrders.routes.ts:36-41` · `ordenaapp-hubs/src/controllers/hubOrders.controller.ts:106-130` · `ordenaapp-orders/src/controllers/orders.controller.ts:3971-3982`

**Escenario de fallo:** Un BUSINESS_VIEWER hace PATCH /api/hubs/me/orders/<suOrderId>/status con { payment_status: 'paid' }. Como paidStatuses en orders incluye 'paid' (orders.controller.ts:4080-4082), a partir de ahi el aviso al repartidor dice "Ya pagado" en vez de "COBRAR <monto>": el repartidor entrega sin cobrar y el hub pierde el efectivo. Ademas el pedido cuenta como cobrado en el resumen del hub (getHubOrdersSummaryInternal) y contaminara las liquidaciones de F4. Con order_status/payment_status libres tambien se pueden persistir strings que ningun consumidor espera y romper agrupaciones por estado.

**Matiz del verificador:** El viewer solo puede tocar SUS pedidos (el scope si esta bien impuesto en hubOrders.controller.ts:108-116 y re-validado en orders); lo que falta es la lista blanca de campos/valores por rol.

**Fix sugerido:** En updateMyHubOrderStatus, restringir por rol: si ctx.role === 'BUSINESS_VIEWER', ignorar payment_status y aceptar order_status solo dentro de una whitelist operativa (p.ej. preparing/ready). En orders, validar order_status y payment_status contra enums cerrados en vez de truncar a 60 caracteres.

---

### `negocios-de-hub-listados-en-el-marketplace-y-sitemap-de-ordena` — Los negocios y productos de un hub se publican en el marketplace y en el sitemap de Ordena, con enlaces a ordena.app y exponiendo business.email

**🟡 Medio** · Crítico de completitud

**Archivos:** `ordenaapp-backend/ordenaapp-business/src/controllers/business.controller.ts:2053` · `ordenaapp-backend/ordenaapp-business/src/controllers/business.controller.ts:2098` · `ordenaapp-frontend/src/app/sitemap.ts:294` · `ordenaapp-backend/ordenaapp-products-and-categories/src/controllers/product.controller.ts:542`

**Escenario de fallo:** El operador del hub monta su marca en oe-ya.ordena.app. Sus 30 negocios aparecen automáticamente en market.ordena.app, con nombre, logo y enlace a https://www.ordena.app/{hubSlug}--ab12cd — es decir, Ordena publicita la cartera del hub bajo su propia marca y desvía a sus clientes a la URL sin contexto de hub del hallazgo anterior. En paralelo, el sitemap de ordena.app le pide a Google que indexe esas mismas URLs. Y el feed de productos del marketplace devuelve, sin token, el `business.email` de cada negocio del hub — que es exactamente el email real que el operador tecleó en «Email del negocio» y que, por el hallazgo hub-business-email-es-credencial-del-dashboard-clasico, es la credencial de acceso a ese negocio.

**Fix sugerido:** En getBusinessesByCountry, filtrar explícitamente: `query.context = { $nin: ['HUB_MANAGED', 'WHITE_LABEL'] }` y `query.status = 'ACTIVE'`. Quitar `email: 1` del $project de getProductsByParams y añadir el mismo filtro por contexto tras el $lookup del negocio. Si a futuro se quiere que un hub opte por aparecer, que sea un flag explícito del hub, no el default.

---

### `sin-revocacion-de-sesion-en-hub-users` — Borrar un usuario del hub no revoca su sesión: el JWT de 7 días sigue siendo válido y no existe ningún endpoint para cambiar contraseña, suspender o forzar logout

**🟡 Medio** · Crítico de completitud

**Archivos:** `ordenaapp-backend/ordenaapp-hubs/src/utils/auth.ts:47` · `ordenaapp-backend/ordenaapp-hubs/src/controllers/hubUsers.controller.ts:327` · `ordenaapp-backend/ordenaapp-hubs/src/routes/hubUsers.routes.ts:14` · `ordenaapp-frontend/src/app/hub-admin/_lib/hubApi.ts:45`

**Escenario de fallo:** El operador despide a un HUB_ADMIN y lo borra desde /hub-admin/usuarios. El ex-empleado sigue teniendo acceso completo durante hasta 7 días con el token que ya está en su localStorage: lee todos los pedidos del hub con PII íntegra, cambia estados, crea y borra usuarios, edita los métodos de pago centralizados y borra negocios de la lista. Lo mismo aplica a un BUSINESS_VIEWER cuyo negocio sale del hub. Y si una contraseña se filtra, no hay absolutamente ninguna forma de rotarla: el usuario no puede cambiar la suya y el OWNER solo puede borrarlo y recrearlo con otro email (el email es unique global, hubUserModel.ts:15, así que ni siquiera puede reusar el mismo).

**Fix sugerido:** Añadir `token_version: Number` al hubUser, incluirlo en el JWT y comprobarlo en verifyHubJWT con un findById cacheado corto (o al menos exigir que el usuario exista y esté ACTIVE). Incrementarlo en delete/suspend/cambio de contraseña. Y exponer los endpoints que faltan: PATCH /api/hub-users/:id (status, role, business_id) y PATCH /api/hub-users/me/password.

---

### `agencies-broken-by-internal-guard` — El guard nuevo en PATCH /business/:id/internal rompe a ordenaapp-agencies, que llama ese endpoint sin x-ordena-secret

**🟡 Medio** · Contratos entre servicios

**Archivos:** `ordenaapp-backend/ordenaapp-business/src/controllers/business.controller.ts:2844` · `ordenaapp-backend/ordenaapp-agencies/src/services/billing.service.ts:202`

**Escenario de fallo:** Se cobra el onboarding fee de una agencia (billing.service.ts:833 llama updateBusinessOnboardingFeeStatus(businessId,'CHARGED')) → business responde 403 → el catch se traga el error y devuelve false → `whiteLabelMeta.onboardingFeeStatus` nunca pasa a CHARGED. En la siguiente corrida de facturación el negocio vuelve a verse como pendiente de onboarding fee y se re-cobra. Falla en silencio: solo queda un console.error. Y es incondicional: mientras INTERNAL_HUBS_SECRET esté vacío el guard rechaza todo, y en cuanto se configure agencies seguirá sin mandarlo.

**Matiz del verificador:** El escenario de doble cobro está REFUTADO. En ordenaapp-agencies/src/services/billing.service.ts:405-424 el cargo de onboarding tiene una segunda barrera que no depende de business: `alreadyCharged = await agencyBusinessLedgerModel.exists({... $or: [{onboardingCharge exists, period != period}, {'onboardingCharge.status': 'CHARGED'}]})`, y el propio ledger se marca CHARGED localmente en billing.service.ts:818-825 ANTES de llamar a business. Es decir, aunque el PATCH falle, el ledger impide re-cobrar. El impacto real es de consistencia/reporte, no financiero: `whiteLabelMeta.onboardingFeeStatus` se queda en PENDING para siempre, así el portal de agencia muestra el badge equivocado (frontend .../agency/(portal)/businesses/page.tsx:430-432 y dashboard/page.tsx:621) y financialAnalytics.service.ts:532 + billing.service.ts:1049 cuentan ese negocio como 'onboarding pendiente' de por vida. Por eso bajo high → medium.

**Fix sugerido:** O bien mandar `x-ordena-secret` desde agencies/billing.service.ts (leyendo la misma env), o bien separar el endpoint del hub: dejar PATCH /business/:id/internal como estaba y crear /business/:id/hub-internal con el guard, apuntando ahí patchBusinessInternal de ordenaapp-hubs (businessService.external.ts:91).

---

### `hub-whatsapp-business-name-empty` — El aviso de pedido al operador del hub manda siempre «—» en el nombre del negocio: el productor nunca devuelve businessName

**🟡 Medio** · Contratos entre servicios

**Archivos:** `ordenaapp-backend/ordenaapp-orders/src/controllers/orders.controller.ts:366` · `ordenaapp-backend/ordenaapp-orders/src/service/businessUsage.service.ts:147` · `ordenaapp-backend/ordenaapp-hubs/src/controllers/hubs.controller.ts:282`

**Escenario de fallo:** Entra un pedido en cualquier negocio de un hub → sendHubOrderWhatsapp arma el body con la variable 2 = '—' → el operador recibe en WhatsApp «Nuevo pedido en Oe Ya Courier. Negocio: — Pedido: #A1B2C3…» y no sabe a qué negocio ir, que es justo el dato que la plantilla existe para dar. Ocurre en el 100% de los pedidos de hub y cada mensaje es una plantilla Utility de pago.

**Fix sugerido:** En sendHubOrderWhatsapp (orders.controller.ts:355-379) resolver el nombre del negocio como ya lo hace notifyDeliveryPerson: `GET ${BUSINESS_SERVICE_LINK}/business/${order.bussiness_id}` → `biz?.name` (patrón exacto de orders.controller.ts:4051-4057). Alternativamente pasar businessId como query al endpoint del hub y que este lo resuelva, pero lo primero es más barato.

---

### `storelink-namespace-hijack` — store_link es de libre elección del usuario: cualquier tienda SaaS puede secuestrar un slug bonito del storefront de un hub

**🟡 Medio** · Modelo de datos

**Archivos:** `ordenaapp-frontend/src/middleware.ts:371` · `ordenaapp-frontend/src/middleware.ts:363` · `ordenaapp-backend/ordenaapp-business/src/controllers/business.controller.ts:330` · `ordenaapp-backend/ordenaapp-business/src/controllers/business.controller.ts:3766`

**Escenario de fallo:** El hub `oe-ya` tiene _id `...ffab12cd`; su storefront vive en `oe-ya.ordena.app` y el hubId6 es `ab12cd` (visible en la cookie `hubId` de cualquier visitante). Un tercero se registra en ordena.app con el plan Gratis y pone su `store_link = "promociones--ab12cd"` (es único globalmente, así que el insert pasa). A partir de ese momento `oe-ya.ordena.app/promociones` → el middleware reescribe a `/promociones--ab12cd` → se renderiza la tienda del tercero bajo el dominio y la marca del hub, con las cookies `hubId`/`hubSlug` del hub inyectadas. Además el hub queda impedido para siempre de usar `promociones` como slug de uno de sus negocios: `createHubManagedBusiness` detectaría `store_link` ocupado y caería al fallback `promociones-2--ab12cd`, y entonces `oe-ya.ordena.app/promociones` seguiría sirviendo la tienda del atacante mientras que el negocio real del hub sólo sería alcanzable por la URL fea.

La MISMA falla ocurre sin atacante, por colisión de sufijos: los últimos 6 hex de un ObjectId son los 3 bytes de contador (inicializado al azar por proceso), o sea 2^24 ≈ 16.7M valores. Por cumpleaños, con ~1.000 hubs hay ~3% de probabilidad de que algún par comparta sufijo; con ~5.000 hubs, ~54%. Si además ambos hubs tienen un negocio cuyo nombre normaliza al mismo slug ("Pizzería" es realista), el hub B sirve la tienda del hub A en su propio subdominio.

Mitigantes que SÍ funcionan y limitan el daño a "tienda equivocada bajo mi marca" (no hay fuga de dinero ni de pedidos): `orders.controller.ts:1766-1783` descarta el `hub_id` reclamado si el negocio no pertenece a ese hub, y `hubPaymentsKey.ts:26-29` exige `business.hubId === claimed` antes de mostrar las cuentas bancarias del hub.

**Matiz del verificador:** El mecanismo es real, pero el escenario de 'colisión sin atacante' entre dos hubs es secundario y la severidad práctica es media, no alta: el daño tope es contenido de otro tenant servido bajo el dominio del hub (confusión de marca / phishing) + bloqueo permanente de ese slug. No hay fuga de datos ni de dinero.

**Fix sugerido:** Dos arreglos independientes, ambos baratos:
1. Validar `store_link` server-side en business (crear y actualizar): `/^[a-z0-9]([a-z0-9-]{1,38})[a-z0-9]$/` y **rechazar la subcadena `--`**, que queda reservada al namespacing de hubs. Esto cierra el vector deliberado por completo.
2. Dejar de derivar el destino con 6 caracteres: enlazar los negocios del hub por su `store_link` real en vez del `hubSlug` bonito (`src/pages/hub/[hubSlug]/index.tsx:362` usa `href={/${b.hubSlug}}`), o hacer que el rewrite resuelva el negocio contra la lista de `store_link` del hub (ya se piden en el SSR del landing) en vez de concatenar. Si se quiere conservar el rewrite mecánico, usar el hubId COMPLETO de 24 chars como sufijo elimina la colisión por cumpleaños.

---

### `delivery-notify-send-before-cas` — El aviso al repartidor se ENVÍA antes del CAS: dos clics simultáneos cobran dos mensajes y ambos responden 200

**🟡 Medio** · F3 v1 — WhatsApp y privacidad

**Archivos:** `ordenaapp-backend/ordenaapp-orders/src/controllers/orders.controller.ts:4037` · `ordenaapp-backend/ordenaapp-orders/src/controllers/orders.controller.ts:4098` · `ordenaapp-backend/ordenaapp-orders/src/controllers/orders.controller.ts:4117`

**Escenario de fallo:** El operador tiene el pedido abierto en dos pestañas (o hace doble clic; el `disabled` del botón solo se aplica tras la respuesta, ver frontend `pedidos/page.tsx:223` y `[orderId]/index.tsx:789`). Ambas peticiones pasan el chequeo de la línea 4037 con `delivery_notified_at === null`, ambas llaman a `sendWhatsappSMS`, se envían DOS plantillas utility (2 × US$0.02, y el repartidor recibe el pedido dos veces). Solo una gana el findOneAndUpdate, pero las dos responden 200 con `delivery_notified_at: now`. La "segunda red" del `dedupeKey` solo salvaría si el bot tiene DB_LINK configurado y si el findOne de dedupe (whatsapp-bot `notifications.controller.ts:69`) alcanza a ver el insert de la otra petición — que es un `void ... .catch()` posterior al envío (línea 110), o sea que en una carrera real tampoco lo ve. Variante 2: el envío sale bien pero el findOneAndUpdate lanza (Mongo caído/timeout) → catch → 500 → el pedido queda SIN marcar y el operador reintenta → segundo cobro.

**Matiz del verificador:** El bug de ordenamiento (enviar antes de reclamar, e ignorar `claimed === null` al responder 200) es real. Pero el escenario de 'doble clic' está mitigado client-side; la explotación requiere concurrencia real (2 pestañas) o llamada directa a la API. Impacto: 1 mensaje duplicado y US$0.02, sin pérdida de datos ni fuga. Severidad correcta: medium.

**Fix sugerido:** Invertir el orden: hacer el CAS PRIMERO (reservar `delivery_notified_at` con findOneAndUpdate sobre `{delivery_notified_at: null}`), y solo si `claimed` no es null enviar el WhatsApp; si el envío falla, liberar la marca ($set a null) para permitir reintento. Y en cualquier caso, si `claimed === null` devolver 409, no 200.

---

### `hub-delivery-phone-public` — El WhatsApp del repartidor y el del operador se exponen en el endpoint PÚBLICO de resolución del hub

**🟡 Medio** · F3 v1 — WhatsApp y privacidad

**Archivos:** `ordenaapp-backend/ordenaapp-hubs/src/controllers/hubs.controller.ts:25` · `ordenaapp-backend/ordenaapp-hubs/src/models/hubModel.ts:26` · `ordenaapp-backend/ordenaapp-api-gateway/src/app.ts:103`

**Escenario de fallo:** `GET https://api.../api/hubs/resolve?slug=oe-ya` sin ninguna credencial devuelve `contact.deliveryWhatsapp` (el número personal del repartidor del hub), `contact.whatsapp` (el número operativo que recibe todos los pedidos) y `contact.email`. Cualquiera que conozca el slug — que es público, está en la URL `{slug}.ordena.app` — obtiene el teléfono del repartidor. Además de la fuga de dato personal de un tercero que no es usuario de la plataforma, ese número es el destinatario de las plantillas: habilita spam/suplantación dirigida.

**Matiz del verificador:** Real, pero es la fuga de UN campo (contact.deliveryWhatsapp) que se coló al reutilizar el subdocumento `contact` ya público. El resto de `contact` es público a propósito. Severidad correcta: medium (fuga de dato personal de un tercero), no high.

**Fix sugerido:** En `resolveHubBySlug` no seleccionar `contact` en bruto: proyectar solo los canales pensados para el storefront (`contact.whatsapp` si el diseño lo requiere, instagram/facebook/website) y excluir siempre `deliveryWhatsapp` y `email`. Lo más limpio es sacar `deliveryWhatsapp` de `contact` y ponerlo en un subdocumento operativo (p.ej. `operations.deliveryWhatsapp`) que ningún select público toque.

---

### `hub-template-business-name-empty` — La variable 2 de pedido_hub_es (nombre del negocio) siempre sale '—': ni el config ni la orden traen ese campo

**🟡 Medio** · F3 v1 — WhatsApp y privacidad

**Archivos:** `ordenaapp-backend/ordenaapp-orders/src/controllers/orders.controller.ts:366` · `ordenaapp-backend/ordenaapp-hubs/src/controllers/hubs.controller.ts:280`

**Escenario de fallo:** El hub recibe por cada pedido: "🧾 Nuevo pedido en Oe Ya Courier. / Negocio: — / Pedido: #A1B2C3 ...". El campo que le dice a QUÉ negocio ir a recoger, que es el único dato que distingue un pedido de otro en un hub con N negocios, llega vacío en el 100% de los mensajes. Contradice directamente la fila 2 de la tabla de §3 del contrato PLANTILLAS_REPARTIDOR_Y_HUB.md.

**Matiz del verificador:** Sin corrección. Nota adicional: el fix natural es que `sendHubOrderWhatsapp` reutilice `businessData.business?.name` (ya lo resuelve `sendNewOrderWhatsapp` líneas antes) o que orders consulte business por `order.bussiness_id` como ya hace `notifyDeliveryPerson` (~4055).

**Fix sugerido:** Resolver el nombre del negocio en `sendHubOrderWhatsapp` con la misma llamada a `${BUSINESS_SERVICE_LINK}/business/${order.bussiness_id}` que ya usa `notifyDeliveryPerson` (línea 4053), o pasar el `businessData.business?.name` que `sendNewOrderWhatsapp` ya obtuvo unas líneas antes en el mismo flujo de `runOrderCreationSideEffects`.

---

### `hub-whatsapp-sin-guard-de-stage` — El aviso automático al hub se envía en TODOS los entornos; el aviso al negocio solo en producción

**🟡 Medio** · F3 v1 — WhatsApp y privacidad

**Archivos:** `ordenaapp-backend/ordenaapp-orders/src/controllers/orders.controller.ts:288` · `ordenaapp-backend/ordenaapp-orders/src/controllers/orders.controller.ts:355`

**Escenario de fallo:** Cualquier pedido de prueba creado contra staging (o en local con las envs de WhatsApp puestas) en un negocio con `hub_id` dispara una plantilla utility real al número del operador: se cobra US$0.02 por cada prueba y el operador recibe pedidos falsos en su WhatsApp durante el QA. Con `HELD_BY_LIMIT` y `releaseHeldOrders` (línea 3683) se repite en cada liberación. El dedupeKey no ayuda: son pedidos distintos, claves distintas.

**Matiz del verificador:** Sin corrección de fondo. La condición práctica es que el entorno no-producción apunte a un bot con credenciales reales de Meta; si staging usa credenciales de prueba, el impacto es sólo ruido. Severidad medium se sostiene por costo real + confusión del operador durante QA.

**Fix sugerido:** Aplicar el mismo guard `if (STAGE !== 'production') return;` al inicio de `sendHubOrderWhatsapp` (y decidir conscientemente qué hacer con `notifyDeliveryPerson`, que hoy también envía en cualquier STAGE — ahí es una acción manual, así que puede ser deliberado, pero conviene dejarlo explícito).

---

### `hub-resolve-leaks-delivery-whatsapp` — El WhatsApp del repartidor y el contacto interno del hub se publican en el HTML del storefront

**🟡 Medio** · Frontend del hub

**Archivos:** `ordenaapp-backend/ordenaapp-hubs/src/controllers/hubs.controller.ts:25` · `ordenaapp-frontend/src/pages/hub/[hubSlug]/index.tsx:452` · `ordenaapp-frontend/src/storeNameSections/HubTopBar.tsx:46` · `ordenaapp-frontend/src/app/hub-admin/login/page.tsx:52`

**Escenario de fallo:** Cualquier visitante anonimo abre https://{slug}.ordena.app, hace 'ver codigo fuente' y busca 'deliveryWhatsapp' en el JSON de __NEXT_DATA__ -> obtiene el numero personal del repartidor del hub (y su email/telefono internos). Tambien queda indexable por buscadores y accesible sin navegador via `GET /api/hubs/resolve?slug=...`.

**Matiz del verificador:** El fix correcto es en el backend (hubs.controller.ts:25): proyectar campos concretos, p.ej. `contact.whatsapp contact.instagram contact.facebook contact.website`, en vez de `contact`. Arreglarlo solo en el SSR del frontend no basta, porque GET /api/hubs/resolve?slug=... es accesible directamente.

**Fix sugerido:** En resolveHubBySlug, proyectar solo los campos publicos de contacto (whatsapp, instagram, facebook, tiktok, website) o mapear explicitamente el objeto de respuesta; y en el getServerSideProps del storefront construir el objeto `hub` campo por campo en vez de JSON.parse(JSON.stringify(hub)).

---

### `hub-logo-no-se-puede-quitar` — Quitar el logo del hub en Ajustes es un no-op silencioso

**🟡 Medio** · Frontend del hub

**Archivos:** `ordenaapp-frontend/src/app/hub-admin/(portal)/ajustes/page.tsx:93` · `ordenaapp-frontend/src/app/hub-admin/(portal)/ajustes/page.tsx:263` · `ordenaapp-backend/ordenaapp-hubs/src/controllers/hubs.controller.ts:119`

**Escenario de fallo:** El operador borra el logo, pulsa 'Guardar cambios', recibe el toast 'Configuracion guardada' y el check verde. `refreshHub()` re-lee el hub y el logo viejo reaparece en la sidebar y en el storefront publico. Repetir la accion nunca funciona; no hay forma de quitar el logo desde la UI.

**Matiz del verificador:** Matiz de la evidencia: no es que 'axios elimine' el campo lo que causa el bug — aunque llegara como null, el backend tampoco lo aplicaria salvo que se envie explicitamente '' o null y se cambie el guard. El fix limpio es enviar `logo: form.logo.trim()` (string vacio) y que el backend acepte '' como borrado.

**Fix sugerido:** Enviar `logo: form.logo.trim()` (cadena vacia explicita) en vez de `|| undefined`; el backend ya distingue undefined de ''.

---

### `hub-logo-data-url-base64` — El logo del hub se guarda como data URL base64 y se reenvia en cada request publica

**🟡 Medio** · Frontend del hub

**Archivos:** `ordenaapp-frontend/src/app/hub-admin/(portal)/ajustes/page.tsx:142` · `ordenaapp-frontend/src/app/hub-admin/(portal)/ajustes/page.tsx:145` · `ordenaapp-frontend/src/app/hub-admin/_lib/hubApi.ts:51` · `ordenaapp-frontend/src/middleware.ts:127`

**Escenario de fallo:** Un operador sube un PNG de 1.8 MB. La home del hub pasa a servir ~2.5 MB extra de HTML por visita (sin cachear como imagen, sin CDN); el JSON de 'hub-data' se acerca al limite de ~5 MB de localStorage y `saveHubSessionData` puede lanzar QuotaExceededError; y el cache del middleware Edge acumula varios MB por instancia.

**Matiz del verificador:** El escenario de QuotaExceededError es plausible pero no demostrado: con un solo logo de 1.8 MB el JSON de 'hub-data' queda por debajo del limite tipico de 5 MB. Lo verificable y seguro es el coste por request (SSR + resolve publico + cache Edge), no el fallo de localStorage.

**Fix sugerido:** Anadir un endpoint de subida de logo del hub (mismo patron que /me/businesses/:id/logo, que ya sube al bucket) y guardar solo la URL; mientras tanto, rechazar en el backend valores de `logo` que empiecen por `data:`.

---

### `middleware-cachea-404-del-resolve` — Un 5xx transitorio del servicio de hubs saca a todos los visitantes del hub durante 60 s

**🟡 Medio** · Frontend del hub

**Archivos:** `ordenaapp-frontend/src/middleware.ts:126` · `ordenaapp-frontend/src/middleware.ts:299` · `ordenaapp-frontend/src/middleware.ts:55`

**Escenario de fallo:** El servicio ordenaapp-hubs (o el gateway) devuelve 502 durante 2 segundos por un redeploy. Esa instancia Edge cachea `null` para el slug y, durante los 60 s siguientes, cada visitante de {slug}.ordena.app es redirigido a https://ordena.app/ — pierden el carrito, la tienda y el contexto del hub, aunque el backend ya se haya recuperado. En staging el redirect ademas apunta a produccion, porque `{slug}.staging.ordena.app` tambien cumple `endsWith('.ordena.app')`.

**Matiz del verificador:** Matiz: el impacto es por instancia Edge, no global — cada region/instancia tiene su propio Map en memoria, asi que la ventana de 60 s afecta a las instancias que hicieron el fetch durante el 5xx, no necesariamente a todo el trafico.

**Fix sugerido:** Cachear null solo cuando `resp.status === 404`; ante 5xx devolver null sin cachear (o servir el ultimo valor bueno). Y derivar el host del redirect del hostname actual en vez de hardcodear https://ordena.app/.

---

### `no-server-side-hours-enforcement` — allowSalesOutsideHours no se aplica en el servidor: se puede crear la orden con la tienda cerrada (incluso desde la UI, sin tocar la API)

**🟡 Medio** · Horarios comerciales

**Archivos:** `ordenaapp-backend/ordenaapp-orders/src/routes/orders.routes.ts:45` · `ordenaapp-backend/ordenaapp-orders/src/controllers/orders.controller.ts:1254` · `ordenaapp-frontend/src/contexts/CartContext.tsx:126` · `ordenaapp-frontend/src/pages/[storeName]/checkout/index.tsx:3778`

**Escenario de fallo:** Negocio de hub (nace con `allowSalesOutsideHours: false`), horario 08:00–20:00. El cliente arma el carrito a las 19:55 y no envía. El carrito se persiste en localStorage (`persistCartToLS`). A las 22:30 abre `/{negocio}/checkout` (o simplemente recarga), pulsa "Confirmar pedido" y la orden se crea normalmente: el banner de OutOfHoursBanner ni siquiera se monta sobre el botón de checkout y el servidor no valida nada. El negocio recibe un pedido a las 22:30 cuando la política del hub dice que no acepta pedidos fuera de horario. Vía `curl -X POST /api/orders/orders` es todavía más directo: cero fricción, endpoint público.

**Matiz del verificador:** Version correcta: el bloqueo fuera de horario es 100% client-side y solo cubre addToCart / aumentos de cantidad (CartContext.tsx:185, 208, 258). El handler de 'Confirmar pedido' del checkout no llama isSalesBlockedNow, asi que un carrito persistido en localStorage se puede enviar con la tienda cerrada; y POST /orders (orders.routes.ts:45) es publico y no valida horario. El banner SI se muestra en el checkout (StorefrontLayout.tsx:173 + fallback de settings en :111-138), asi que el usuario no queda a ciegas. Severidad real: medium (bypass de politica operativa, no de seguridad).

**Fix sugerido:** Añadir en `createOrder` (antes del gate de drafts, junto al lookup de negocio que ya existe en orders.controller.ts:1332-1348) una lectura de `business_settings.businessHours` y rechazar 409/403 si `allowSalesOutsideHours === false` y la hora actual en `businessHours.timezone` cae fuera del horario. Extraer la lógica de `businessHours.ts` (spill overnight incluido) a un helper compartido para no re-implementarla con otra convención.

---

### `hub-business-timezone-hardcoded-sv` — Los negocios de hub nacen con timezone America/El_Salvador y el hub no tiene forma de cambiarlo: horarios desalineados hasta 3 horas

**🟡 Medio** · Horarios comerciales

**Archivos:** `ordenaapp-backend/ordenaapp-business/src/controllers/business.controller.ts:3843` · `ordenaapp-backend/ordenaapp-business/src/controllers/businessSettings.controller.ts:177` · `ordenaapp-backend/ordenaapp-hubs/src/models/hubModel.ts:98` · `ordenaapp-frontend/src/app/hub-admin/(portal)/negocios/[businessId]/page.tsx:142`

**Escenario de fallo:** Hub en Santiago de Chile (UTC-3). Crea "Pizzería X" con horario 08:00–20:00 y `allowSalesOutsideHours: false`. La tienda se evalúa en UTC-6: a las 10:59 hora Santiago son 07:59 en El Salvador → `getBusinessStatus` devuelve `isOpen: false`, el OutOfHoursBanner se muestra y `addToCart` rechaza con toast "Tienda fuera de horario" durante las tres primeras horas del día real del negocio. Simétricamente, de 20:00 a 23:00 hora Santiago la tienda sigue aceptando pedidos ya cerrada. El hub no tiene ninguna UI para corregirlo.

**Matiz del verificador:** Es un hueco de UI, no de contrato: el endpoint PATCH /api/hubs/me/businesses/:id/hours ya acepta y persiste `timezone` (hubBusinesses.controller.ts:275 -> businessSettings.controller.ts:1626). Lo que falta es un selector de zona horaria en la pestana Horario del hub-admin (y/o heredar hub.timezone en createBusinessForMyHub). Severidad medium: latente hasta que exista un hub con offset distinto al de America/El_Salvador.

**Fix sugerido:** Propagar `hub.timezone` en `createBusinessForMyHub` → `createHubBusiness` → `defaults.businessHours.timezone` en business.controller.ts:3845, y exponer un selector de zona horaria en la tarjeta de horario del hub-admin (el PATCH ya acepta `timezone`: hubBusinesses.controller.ts:278).

---

### `hub-admin-default-week-overwrite` — El editor de horarios del hub-admin reintroduce el bug de DEFAULT_WEEK: si el detalle llega sin businessHours, muestra 09:00–18:00 inventado y al guardar pisa el horario real

**🟡 Medio** · Horarios comerciales

**Archivos:** `ordenaapp-frontend/src/app/hub-admin/(portal)/negocios/[businessId]/page.tsx:141` · `ordenaapp-frontend/src/app/hub-admin/(portal)/negocios/[businessId]/page.tsx:187` · `ordenaapp-frontend/src/app/hub-admin/(portal)/negocios/[businessId]/page.tsx:190` · `ordenaapp-frontend/src/app/hub-admin/(portal)/negocios/[businessId]/page.tsx:276`

**Escenario de fallo:** `INTERNAL_HUBS_SECRET` no está seteada en el entorno de hubs (o business-service devuelve 5xx un segundo). El HUB_OWNER abre /hub-admin/negocios/{id}, pestaña Horario: ve Lun–Dom 09:00–18:00 sin ningún aviso de error. Cambia el domingo a cerrado y pulsa "Guardar horario". El PATCH escribe los 7 días 09:00–18:00 sobre el horario real del negocio (p.ej. 06:00–22:00 con doble turno), que se pierde. Como estos negocios tienen `allowSalesOutsideHours: false`, el storefront empieza a bloquear ventas de 06:00 a 09:00 y de 18:00 a 22:00 al día siguiente.

**Matiz del verificador:** El bug de UI es real (falta un estado 'no cargado' que deshabilite Guardar), pero la causa no es el secreto interno: GET /business-settings/:businessId es publico (businessSettings.routes.ts:22). businessHours llega null solo con settings inexistentes o error transitorio. El camino reproducible sin fallos es weeklyHours: [] (horario deshabilitado desde el dashboard clasico, ajustes/general/index.tsx:1047-1051): el hub-admin muestra 09:00-18:00 inventado y al guardar lo materializa. Severidad medium.

**Fix sugerido:** Distinguir "no cargado" de "cargado vacío": arrancar `week` en `null` y renderizar la tarjeta de horario solo cuando `businessHours` llegó; si `getMyHubBusinessDetail` no pudo leer settings, devolver un marcador explícito (o 502) y deshabilitar el botón Guardar. Idem para `weeklyHours: []` — no sustituirlo por DEFAULT_WEEK en silencio.

---

### `all-days-closed-fails-open` — Semana entera cerrada (o weeklyHours vacío) desactiva el bloqueo en vez de aplicarlo: fail-open justo en el caso 'cerrado'

**🟡 Medio** · Horarios comerciales

**Archivos:** `ordenaapp-frontend/src/utils/businessHours.ts:263` · `ordenaapp-frontend/src/utils/businessHours.ts:253` · `ordenaapp-frontend/src/storeNameSections/OutOfHoursBanner.tsx:41`

**Escenario de fallo:** Un negocio del hub cierra dos semanas por vacaciones. El HUB_ADMIN entra al editor de horario y marca los 7 días como cerrados (es la acción más natural; no hay un "cerrar temporalmente" que funcione — ver hallazgo operational-status-cosmetic). Resultado: `hasConfiguredHours` → false → `isSalesBlockedNow` → false. El storefront no muestra banner, no muestra badge de cerrado, y acepta pedidos con normalidad los 14 días.

**Matiz del verificador:** El fix correcto es distinguir 'sin horario configurado' de 'cerrado toda la semana': isSalesBlockedNow (businessHours.ts:263-270) deberia consultar getBusinessStatus cuando weeklyHours tiene los 7 dias con isClosed:true, en vez de salir por el guard de hasConfiguredHours (linea 268). Severidad medium.

**Fix sugerido:** El guard de `hasConfiguredHours` existe para no romper negocios que nunca configuraron horario; pero "7 días cerrados" es configuración explícita, no ausencia de ella. Distinguir 'nunca configurado' (`weeklyHours.length === 0`) de 'configurado todo cerrado' y, en el segundo caso, devolver `true`. El mismo criterio hace falta en el bloqueo server-side del primer hallazgo.

---

### `hub-empty-methods-silent-fallback` — Fallback silencioso al negocio cuando el hub no tiene metodos: el listado ofrece un metodo que la pagina de detalle no puede mostrar (y cobra a la cuenta equivocada)

**🟡 Medio** · Pagos del hub

**Archivos:** `ordenaapp-frontend/src/pages/[storeName]/ordenes/[orderId]/pagar/index.tsx:436` · `ordenaapp-frontend/src/pages/[storeName]/ordenes/[orderId]/pagar/index.tsx:443` · `ordenaapp-frontend/src/utils/hubPaymentsKey.ts:35`

**Escenario de fallo:** Hub sin ningun metodo configurado, negocio con una cuenta bancaria propia. /pagar (index) hace fallback y pinta la tarjeta "Transferencia bancaria" con los datos del negocio; el cliente entra a /pagar/transferencia, que consulta `bank-accounts/{hubId}` -> lista vacia -> pantalla sin cuentas. Callejon sin salida. Y en el caso en que el detalle si tuviera datos, el cobro centralizado del hub se convierte en cobro a la cuenta del negocio sin que nadie lo note.

**Matiz del verificador:** Bajo de high a medium: el bug solo se materializa en una condicion de configuracion concreta (hub con CERO metodos y negocio con alguno propio) y no hay perdida ni exposicion de datos, es un callejon sin salida en el checkout. La segunda mitad del escenario ('el cobro centralizado se convierte en cobro al negocio') no es un defecto sino el fallback documentado y deliberado de rollout — el defecto real es la DISCREPANCIA entre index y detalle.

**Fix sugerido:** Decidir una sola politica: o el fallback existe en las 15 pantallas (pasando el flag por props/query al detalle) o no existe en ninguna y el index muestra un estado explicito "el operador aun no configuro metodos de pago".

---


## ⚪ Bajo (30)

### `hub-sirve-storefront-de-otro-hub` — El middleware deja pasar /hub/{cualquierSlug} tal cual: el subdominio de un hub sirve el storefront completo de otro hub, con las cookies hubId del host

**⚪ Bajo** · Aislamiento de tenants

**Archivos:** `ordenaapp-frontend/src/middleware.ts:339-341` · `ordenaapp-frontend/src/middleware.ts:314-319` · `ordenaapp-frontend/src/pages/hub/[hubSlug]/index.tsx:417-424`

**Escenario de fallo:** Visitar https://hubA.ordena.app/hub/hubB renderiza el storefront entero de hubB — su marca, su banner, sus categorias globales, su directorio de negocios y su catalogo de productos — bajo el subdominio de hubA, mientras setHubCookies escribe hubId=<id de hubA> y hubSlug=hubA en el navegador (middleware.ts:314-319). Un operador puede publicar ese enlace y hacer pasar el catalogo de un competidor como propio (o al reves, difamar), y el visitante navega con un hubId incoherente con el hub cuyo contenido esta viendo. Lo mismo funciona en el host core: https://ordena.app/hub/hubB.

**Matiz del verificador:** Sin fuga de datos (contenido publico) y sin efecto sobre pedidos; el impacto real es confusion de marca y una cookie hubId incoherente. Severidad low.

**Fix sugerido:** En la rama /hub/, comparar el segmento con el slug resuelto por el host: `const wanted = pathname.split('/')[2]; if (wanted && wanted !== String(hub.slug)) return setHubCookies(NextResponse.redirect(new URL('/', req.url)));`. Y en getServerSideProps de /hub/[hubSlug], preferir la cabecera x-hub-slug / x-hub-id que inyecta el middleware sobre ctx.params, o al menos exigir que coincidan.

---

### `hub-suffix-6-hex-colisionable` — El aislamiento del storefront entre hubs depende de 6 caracteres hex del hubId (24 bits): una colision hace que un hub sirva la tienda de otro

**⚪ Bajo** · Aislamiento de tenants

**Archivos:** `ordenaapp-frontend/src/middleware.ts:309` · `ordenaapp-frontend/src/middleware.ts:363-378` · `ordenaapp-backend/ordenaapp-business/src/controllers/business.controller.ts:3766-3772`

**Escenario de fallo:** El hub A (id ...ab12cd) y el hub B (id ...ab12cd) comparten sufijo y ambos tienen un negocio con hubSlug 'pizzeria'. El de B se creo primero y ocupa store_link 'pizzeria--ab12cd'; el de A recibe 'pizzeria-2--ab12cd'. Desde ese momento hubA.ordena.app/pizzeria se reescribe mecanicamente a /pizzeria--ab12cd y sirve la tienda del negocio del HUB B bajo el dominio del hub A, con cookies hubId=<hubA>; y el propio negocio del hub A queda inalcanzable por su URL bonita. Ademas hubA.ordena.app/pizzeria--ab12cd pasa el check de linea 364 aunque la tienda no sea suya. Los pedidos que se generen ahi quedan sin hub (createOrder descarta el hub_id incoherente), asi que no aparecen en el panel de ningun hub.

**Matiz del verificador:** Probabilidad muy sobreestimada ('primeras colisiones a unos cientos' es falso; ~0.3% a 300 hubs). Riesgo futuro de escala: low. Fix natural = anadir un lookup real de store_link o alargar el sufijo.

**Fix sugerido:** No usar un sufijo truncado como candado de tenant. Opciones: (a) resolver store_link consultando el negocio por (hubId, hubSlug) en vez de construirlo por string; (b) usar el hubId completo o el hubSlug del hub en el namespace del store_link; (c) como minimo, al crear el negocio verificar colision del par (sufijo, hubSlug) contra OTROS hubs y alargar el sufijo hasta que sea unico.

---

### `duplicate-product-cross-tenant` — duplicateProduct ignora x-business-id y toma el businessId del propio producto: escritura cross-tenant en products

**⚪ Bajo** · Aislamiento de tenants

**Archivos:** `ordenaapp-backend/ordenaapp-products-and-categories/src/controllers/product.controller.ts:2389-2396` · `ordenaapp-backend/ordenaapp-products-and-categories/src/routes/product.routes.ts:29`

**Escenario de fallo:** Un llamador con un x-business-id cualquiera (o, combinado con el hallazgo gateway-passthrough-sin-token, sin ningun token) hace POST /api/products/product/<idDeProductoAjeno>/duplicate. El producto se clona DENTRO del negocio victima: se le consume cupo de skusLimit, se le duplican imagenes en el bucket y se le ensucia el catalogo publico. Repetido, agota el limite de SKUs del plan de la victima.

**Matiz del verificador:** Preexistente en develop, no introducido por feature/new-mode-ordena-hub. Reportarlo como hallazgo aparte, no como bloqueante de esta rama.

**Fix sugerido:** Acotar igual que update/delete: `const original = await productModel.findOne({ _id: id, businessId: String(req.headers['x-business-id']) }).lean();` y devolver 404 si no coincide.

---

### `hub-admin-borra-hub-owner` — Un HUB_ADMIN puede eliminar cuentas HUB_OWNER del hub

**⚪ Bajo** · Aislamiento de tenants

**Archivos:** `ordenaapp-hubs/src/routes/hubUsers.routes.ts:20` · `ordenaapp-hubs/src/controllers/hubUsers.controller.ts:301-327`

**Escenario de fallo:** Un hub con dos HUB_OWNER (socios) y un HUB_ADMIN contratado. El admin llama DELETE /api/hub-users/<idDeUnOwner> y borra a uno de los propietarios; repitiendo no puede vaciar del todo, pero si dejar a un solo owner elegido por el (borrando al otro), incluido el que paga la suscripcion. Escalada lateral dentro del hub, sin recuperacion (no hay flujo de reset ni de restauracion de usuarios).

**Matiz del verificador:** Simetrico: el mismo controller tampoco impide que un HUB_ADMIN cree usuarios HUB_OWNER, asi que la escalada es en las dos direcciones (crear y borrar).

**Fix sugerido:** Anadir en deleteHubUser: si ctx.role !== 'HUB_OWNER' y user.role === 'HUB_OWNER', responder 403. Idem para impedir que un HUB_ADMIN borre a otro HUB_ADMIN si se quiere ser estricto.

---

### `listas-de-subdominios-desalineadas` — NON_HUB_SUBDOMAINS (frontend) y RESERVED_SLUGS (hubs) no coinciden: subdominios de infraestructura no listados se redirigen duro a ordena.app

**⚪ Bajo** · Aislamiento de tenants

**Archivos:** `ordenaapp-frontend/src/middleware.ts:88-108` · `ordenaapp-frontend/src/middleware.ts:299-306` · `ordenaapp-hubs/src/utils/slug.ts:5-11`

**Escenario de fallo:** Dos direcciones. (a) docs.ordena.app / status.ordena.app / blog.ordena.app apuntados a esta app Next: el middleware los toma como slug de hub, /api/hubs/resolve responde 404 y todo el subdominio se redirige a https://ordena.app/ — el sitio queda inaccesible hasta que alguien recuerde tocar NON_HUB_SUBDOMAINS. (b) Un hub puede registrar el slug 'cname', 'dns', 'ns1' o 'vercel' (no estan en RESERVED_SLUGS): el registro se acepta, pero su URL nunca funciona porque el middleware la excluye — hub muerto sin mensaje de error.

**Matiz del verificador:** El escenario (a) es hipotetico (depende de DNS no verificable); el que sostiene el hallazgo es (b): slugs aceptados por hubs que el middleware nunca resolvera. Fix: una sola lista compartida.

**Fix sugerido:** Extraer una unica lista canonica compartida (o duplicarla identica en ambos lados con un comentario que lo indique) que sea la union de las dos, y hacer que isValidSlug la use. El redirect duro del caso (a) deberia ser un NextResponse.next() cuando el subdominio esta en la lista de infraestructura.

---

### `hub-suspendido-sigue-operando-7-dias` — Suspender un hub solo corta el login y el storefront público; los tokens ya emitidos siguen operando el panel durante 7 días

**⚪ Bajo** · Crítico de completitud

**Archivos:** `ordenaapp-backend/ordenaapp-hubs/src/controllers/hubs.controller.ts:24` · `ordenaapp-backend/ordenaapp-hubs/src/controllers/hubUsers.controller.ts:153` · `ordenaapp-backend/ordenaapp-hubs/src/controllers/hubs.controller.ts:67`

**Escenario de fallo:** F3 v2 introduce la suspensión por impago. El equipo pone `hub.status='SUSPENDED'`: el subdominio deja de resolver (bien) y nadie puede volver a entrar (bien), pero cualquier sesión de hub-admin abierta en ese momento sigue creando negocios, editando métodos de pago y quemando avisos de WhatsApp de pago durante los días que le queden al token. Peor: la caída del storefront es inmediata y silenciosa para el operador, que ve su panel funcionando y sus tiendas caídas sin ningún mensaje que lo explique.

**Fix sugerido:** Comprobar `hub.status === 'ACTIVE'` en verifyHubJWT (o en un middleware `requireActiveHub` aplicado a todo /me), devolviendo un 403 con código distinguible para que la UI muestre «tu hub está suspendido» en vez de un error genérico.

---

### `robots-permite-indexar-hub-admin-y-apunta-al-sitemap-de-ordena` — robots.txt se sirve idéntico en todos los subdominios de hub: permite rastrear /hub-admin y /hub-portal y declara el sitemap de ordena.app

**⚪ Bajo** · Crítico de completitud

**Archivos:** `ordenaapp-frontend/src/app/robots.ts:9` · `ordenaapp-frontend/src/app/robots.ts:22` · `ordenaapp-frontend/src/middleware.ts:161`

**Escenario de fallo:** Google rastrea e indexa oe-ya.ordena.app/hub-admin/login y /hub-portal — la pantalla de acceso del operador y la del negocio aparecen en resultados de búsqueda del nombre del hub, y el robots del hub le señala a los buscadores el sitemap de un dominio ajeno (ordena.app) mientras que las páginas reales del hub (su home y las tiendas) no están en ningún sitemap. No es una fuga de datos —esas rutas son client-side y exigen token— pero es una superficie de login pública indexada y una señal de SEO cruzada entre marcas que deberían estar separadas.

**Fix sugerido:** Convertir robots.ts en host-aware (leer el header host): en subdominios de hub, devolver disallow de ['/api/','/admin/','/hub-admin/','/hub-portal/','/_next/'] y un `sitemap: https://{slug}.ordena.app/sitemap.xml`, y añadir un sitemap por hub con la home y las tiendas del hub.

---

### `orders-hubs-link-missing-env` — orders no tiene HUBS_SERVICE_LINK en su configuración: en producción los contadores y avisos del hub apuntarían a localhost:3013 y morirían en silencio

**⚪ Bajo** · Contratos entre servicios

**Archivos:** `ordenaapp-backend/ordenaapp-orders/src/config.ts:28` · `ordenaapp-backend/ordenaapp-orders/src/service/businessUsage.service.ts:106` · `ordenaapp-backend/ordenaapp-orders/src/service/businessUsage.service.ts:161`

**Escenario de fallo:** Se despliega orders sin HUBS_SERVICE_LINK → cada pedido de hub intenta PATCH http://localhost:3013/api/hubs/internal/:hubId/usage/increment-order → ECONNREFUSED → dos intentos, log y sigue. Resultado: usageMetrics.ordersCurrentMonth del hub se queda en 0 para siempre (base de los límites de plan de F3 v2) y getHubNotificationConfig devuelve null, así que ni el operador recibe pedido_hub_es ni el negocio recibe pedido_negocio_hub_es con la matriz de privacidad — y como todo es best-effort, el pedido se crea normalmente y nadie se entera.

**Matiz del verificador:** Dos matices que el hallazgo omite y que le quitan gravedad. (1) En desarrollo el default ES el valor correcto: orders/src/config.ts:28 cae a http://localhost:3013/api, que es justo donde corre hubs (PORT=3013), y lo mismo con PAYMENTS_SERVICE_LINK → localhost:3006. O sea local no se rompe por esto. (2) Los .env están gitignoreados, así que su contenido local no dice nada de la configuración de producción. (3) Lo que SÍ está roto hoy, incluso en local, no es el link sino el secreto: orders tampoco define INTERNAL_HUBS_SECRET, así que manda la petición sin header (businessUsage.service.ts:106-107 y 160-166 solo ponen el header si la env existe) y hubs la rechaza fail-closed en hubs.controller.ts:162-166. Eso ya está cubierto por el hallazgo 1; el aporte propio de este hallazgo es solo el checklist de despliegue.

**Fix sugerido:** Añadir HUBS_SERVICE_LINK (y INTERNAL_HUBS_SECRET) al deploy de orders, y PAYMENTS_SERVICE_LINK al de hubs. Conviene además que incrementOrderUsageForHub/getHubNotificationConfig loguen con nivel error distinguible o incrementen una métrica, porque hoy un hub sin contador es indistinguible de un hub sin pedidos.

---

### `hubslug-storelink-divergence` — Al colisionar el store_link global, hubSlug y store_link dejan de encajar y la reescritura mecánica del middleware da 404

**⚪ Bajo** · Contratos entre servicios

**Archivos:** `ordenaapp-backend/ordenaapp-business/src/controllers/business.controller.ts:3767` · `ordenaapp-frontend/src/middleware.ts:374`

**Escenario de fallo:** Dos hubs cuyos ObjectId terminan en los mismos 6 hex crean cada uno un negocio con el mismo nombre: el segundo obtiene hubSlug='pizzeria' (libre en SU hub) pero store_link='pizzeria-2--abc123' porque 'pizzeria--abc123' ya existía. El visitante entra a https://hub2.ordena.app/pizzeria → el middleware reescribe a /pizzeria--abc123 → ese store_link es del negocio del OTRO hub, o no existe → 404 (o peor, sirve la tienda ajena bajo el host de este hub). Probabilidad baja (colisión de sufijo de 6 hex + mismo slug), pero el fallo es silencioso y solo se ve en producción.

**Matiz del verificador:** Un matiz sobre la 'defensa' que podría parecer que lo refuta: el middleware SÍ tiene un guard cruzado en src/middleware.ts:363-370 (`if (seg.includes('--')) { if (seg.endsWith('--'+hubId6)) pasa; else redirect a '/' }`), que normalmente impediría servir la tienda de otro hub. Pero NO ayuda en este escenario, porque la premisa del hallazgo es precisamente que ambos hubs comparten los mismos 6 hex finales, o sea el mismo hubId6: el guard aprueba la reescritura y sí se podría servir el negocio del hub ajeno bajo este host, con las cookies hubId/hubSlug de ESTE hub inyectadas. También descarté vías de disparo más probables: no existe ningún camino de renombrado de hubSlug (grep de hubSlug en business.controller.ts solo lo escribe en la creación, líneas 3757-3771 y 3815; en ordenaapp-hubs solo se lee, hubBusinesses.controller.ts:193 y hubOrders.controller.ts:167), y los dos bucles no filtran soft-deletes de forma asimétrica. Queda entonces solo la colisión de sufijo de 6 hex + mismo slug base, que es rarísima.

**Fix sugerido:** Derivar los dos del mismo valor: mover el bucle de unicidad global al hubSlug (recalculando storeLink = `${hubSlug}--${hubSuffix}` en cada iteración), de modo que hubSlug siempre satisfaga store_link === `${hubSlug}--${hubSuffix}`.

---

### `gateway-proxy-v3-onerror-ignored` — buildProxy del gateway usa la API v2 de http-proxy-middleware pero está instalada la v3: onError/onProxyRes nunca se ejecutan

**⚪ Bajo** · Contratos entre servicios

**Archivos:** `ordenaapp-backend/ordenaapp-api-gateway/src/app.ts:544` · `ordenaapp-backend/ordenaapp-api-gateway/src/app.ts:564` · `ordenaapp-backend/ordenaapp-api-gateway/package.json:24`

**Escenario de fallo:** Se cae ordenaapp-hubs (o cualquier microservicio). El gateway no responde el JSON `{message:'Proxy error'}` con 502 que el código pretende: cae en el manejador por defecto de HPM v3, que devuelve un 500/504 con cuerpo no-JSON. hubHttp del frontend (hub-admin/_lib/hubApi.ts:29-42) intenta leer error.response.data.message, no lo encuentra, y el operador ve un fallo genérico sin pista de que el servicio está caído; el log `PROXY ERROR:` de la línea 545 tampoco se emite.

**Matiz del verificador:** Faltó decir lo más importante para priorizarlo: NO es una regresión de esta rama. `git diff develop...HEAD -- src/app.ts` toca 46 líneas y buildProxy no está entre ellas; el diff solo añade las dos líneas nuevas `app.use('/api/hub-users', ...)` y `app.use('/api/hubs', ...)` (app.ts:564-565). El bug es preexistente y afecta por igual a los 12 proxies desde antes del Modo Multi-Negocio, así que no bloquea este merge.

**Fix sugerido:** Migrar buildProxy a la forma v3: `createProxyMiddleware({ target, changeOrigin, xfwd, proxyTimeout, timeout, on: { proxyRes, error } })` y quitar el `as any` para que TypeScript valide el resto de las opciones.

---

### `orphan-hub-slug-squat` — El onboarding crea el Hub antes que su HUB_OWNER sin rollback: un fallo intermedio deja un hub huérfano ocupando el slug único para siempre

**⚪ Bajo** · Modelo de datos

**Archivos:** `ordenaapp-backend/ordenaapp-hubs/src/controllers/hubUsers.controller.ts:62` · `ordenaapp-backend/ordenaapp-hubs/src/controllers/hubUsers.controller.ts:73` · `ordenaapp-backend/ordenaapp-hubs/src/models/hubModel.ts:87`

**Escenario de fallo:** Dos personas registran hubs con slugs distintos pero el MISMO email a la vez (típico: un operador probando con su cuenta en dos pestañas / dos ambientes). Ambas pasan `emailTaken === false`. Ambas crean su hub (slugs distintos, sin conflicto). Luego una gana el `hubUserModel.create` y la otra recibe E11000 sobre `hub_users.email` → 500. Queda un documento en `hubs` con `status: 'ACTIVE'`, sin ningún `hub_users` asociado, ocupando su slug de forma permanente: el usuario reintenta con el mismo nombre y recibe siempre 409 "Ese nombre de hub ya está en uso", y nadie —ni él ni soporte— tiene endpoint para liberarlo (hay que borrar a mano en Mongo).

El mismo desenlace ocurre con cualquier fallo transitorio entre las líneas 62 y 73 (reinicio del pod durante un deploy, timeout de Mongo, error de bcrypt). Peor: ese hub huérfano es públicamente resolvible — `GET /api/hubs/resolve?slug=...` filtra por `{ slug, status: 'ACTIVE' }` (hubs.controller.ts:24), así que `{slug}.ordena.app` sirve un storefront vacío al que nadie puede entrar a administrar.

**Matiz del verificador:** Los hechos son correctos pero el disparador realista no es la carrera de emails simultáneos (muy contrived), sino un fallo transitorio entre hubModel.create y hubUserModel.create. Impacto: un slug único bloqueado que hay que limpiar a mano en Mongo. Es operativo, no de producción rota → low.

**Fix sugerido:** Invertir el orden o compensar: crear el `hub_users` primero (con `hub_id` de un ObjectId pregenerado) y el hub después, o envolver ambos inserts en un `try/catch` que haga `hubModel.deleteOne({ _id: hub._id })` si el owner falla. Alternativa mínima: añadir un endpoint interno de borrado de hubs sin negocios ni usuarios, para poder recuperar slugs.

---

### `hub-usage-rotation-not-atomic` — La rotación mensual de usageMetrics del hub son dos writes separados (read → $set 0 → $inc): pierde pedidos y desalinea ordersPreviousMonth

**⚪ Bajo** · Modelo de datos

**Archivos:** `ordenaapp-backend/ordenaapp-hubs/src/controllers/hubs.controller.ts:196` · `ordenaapp-backend/ordenaapp-hubs/src/controllers/hubs.controller.ts:222` · `ordenaapp-backend/ordenaapp-business/src/controllers/business.controller.ts:2376`

**Escenario de fallo:** (a) Pérdida de conteo en el cambio de mes. El hub cerró julio con `ordersCurrentMonth = 340`. El 1 de agosto entran dos pedidos casi simultáneos: A y B leen ambos `lastRotatedAt = julio`. A rota (previous=340, current=0) e incrementa (current=1). B —con su snapshot viejo— también rota: vuelve a poner `current = 0`, **borrando el pedido de A**, y luego incrementa a 1. Resultado: 2 pedidos, el contador dice 1. Con `subscription.limits.ordersPerMonth` activo (F3 v2) eso es facturación por debajo de lo real y un `isExtra` mal calculado. Si el proceso muere entre write #1 y write #2, el pedido también se pierde.

(b) `ordersPreviousMonth` miente cuando hay un mes sin pedidos. Hub con 340 pedidos en enero y 0 en febrero: la rotación no corre en febrero porque nadie llama al endpoint. El primer pedido de marzo dispara la rotación y escribe `ordersPreviousMonth = 340` — el total de ENERO — que el dashboard del hub muestra como "mes anterior" (se expone tal cual en hubOrders.controller.ts:228).

**Matiz del verificador:** El defecto de atomicidad es real, pero hoy es inerte: subscription.limits.ordersPerMonth tiene default -1 (hubModel.ts:80), así que isExtra nunca se dispara y no hay facturación por uso todavía (F3 v2 pendiente). El impacto actual se reduce a un contador que puede perder 1 pedido en el cambio de mes y a ordersPreviousMonth desfasado cuando hay un mes sin pedidos.

**Fix sugerido:** Colapsar rotación + incremento en un único `findByIdAndUpdate` condicionado, igual que business: filtro `{ _id: hubId, 'usageMetrics.lastRotatedAt': { $lt: inicioDelMesUTC } }` con `$set: { ordersPreviousMonth: <snapshot>, ordersCurrentMonth: 1, lastRotatedAt: now }`; si `modifiedCount === 0` (otro ya rotó, o estamos en el mismo mes) caer al `$inc` normal. Para (b), al rotar comparar cuántos meses pasaron: si `last` no es el mes inmediatamente anterior, poner `ordersPreviousMonth: 0`.

---

### `hub-businessescount-drift` — usageMetrics.businessesCount es un contador denormalizado que se desincroniza y nunca se reconcilia; es el que aplica el límite del plan

**⚪ Bajo** · Modelo de datos

**Archivos:** `ordenaapp-backend/ordenaapp-hubs/src/controllers/hubBusinesses.controller.ts:64` · `ordenaapp-backend/ordenaapp-hubs/src/controllers/hubBusinesses.controller.ts:74` · `ordenaapp-backend/ordenaapp-hubs/src/controllers/hubBusinesses.controller.ts:101`

**Escenario de fallo:** El hub crea un negocio y el POST a `${BUSINESS_SERVICE_LINK}/business/hub-managed` tarda más que el timeout de axios (`createHubBusiness` en businessService.external.ts). El business-service **igual persiste el documento** (businessModel.create en business.controller.ts:3838); hubs recibe ETIMEDOUT, entra en `upstreamError` y nunca ejecuta el `$inc`. Resultado permanente: el negocio existe y aparece en `/hub-admin/negocios`, pero `businessesCount` quedó una unidad por debajo. Con `businessesIncluded = 5`, ese hub puede llegar a operar 6 negocios pagando por 5, y el mensaje de error del gate ("Alcanzaste el límite de 5 negocios… current: 4") le mostrará al operador un número que contradice su propia lista.

Menor pero real: el gate también es TOCTOU — dos creaciones concurrentes leen el mismo `businessesCount` y ambas pasan, dejando al hub uno por encima del límite.

**Matiz del verificador:** Real como defecto de diseño, pero hoy no puede causar el daño descrito: businessesIncluded tiene default -1 (hubModel.ts:78), y el gate de hubBusinesses.controller.ts:64 solo actúa si limit !== -1. Mientras no aterrice F3 v2 con planes que fijen límite, el contador desalineado no bloquea ni desbloquea nada.

**Fix sugerido:** No mantener el contador como fuente de verdad del gate: contar los negocios reales antes de crear (ya existe `GET /businesses/hub/:hubId`, o mejor un `countDocuments({ hubId })` interno) y dejar `usageMetrics.businessesCount` sólo como caché de display, refrescada desde ese conteo. Si se quiere conservar el `$inc`, moverlo a un update condicionado (`{ _id, 'usageMetrics.businessesCount': { $lt: limit } }`) ANTES de crear, y decrementar si la creación falla.

---

### `hubplan-unhandled-in-plan-resolvers` — El nuevo enum planRef.kind='HUB_PLAN' no está contemplado en resolvePlanDetails/resolveProductLimitForPlan: business_admin devuelve 404 para negocios de hub y el fallback del frontend no lo detecta

**⚪ Bajo** · Modelo de datos

**Archivos:** `ordenaapp-backend/ordenaapp-business/src/controllers/business.controller.ts:1107` · `ordenaapp-backend/ordenaapp-business/src/controllers/business.controller.ts:161` · `ordenaapp-backend/ordenaapp-business/src/controllers/business.controller.ts:1169` · `ordenaapp-frontend/src/api/routes/routes.ts:52`

**Escenario de fallo:** Cualquiera abre el dashboard clásico de un negocio HUB_MANAGED (el operador desde "Ver panel del negocio", o soporte de Ordena entrando por `/admin/tiendas/{id}`): `GET /api/business/business_admin/{id}` → 404 `{"message":"Plan no encontrado"}` → `GET_BUSINESS_BY_ID` (routes.ts:35) relanza → `useBusinessCache` (hooks/useBusinessCache.ts:12) y `AgencyBrandingContext` (línea 102) quedan en error, y las páginas que lo llaman desde `getServerSideProps` con `await GET_BUSINESS_BY_ID(businessId, cookies)` (p.ej. `pages/admin/tienda-lista/[businessId]/index.tsx:148`, `.../affiliates/index.tsx:1783`) revientan el SSR. El storefront público NO se ve afectado: usa `GET_BUSINESS_BY_STORE_LINK` (`pages/[storeName].tsx:226,1123`).

Secundario: si alguna vez se llama `resolveProductLimitForPlan` sobre un negocio de hub, devuelve 0 = "sin productos permitidos" en lugar de ilimitado, que es lo que sí hace correctamente `resolveForHubManaged()` en el otro resolver (resolvePlanFeaturesForBusiness.ts:135-141).

**Matiz del verificador:** El defecto de código es exacto, pero el escenario de fallo está inflado: NO existe ningún 'Ver panel del negocio' que lleve al dashboard clásico. El panel del hub es /app/hub-admin/(portal)/negocios/[businessId] y consume la API de ordenaapp-hubs; grep de 'admin/tiendas' en src/app/hub-admin y src/app/hub-portal no devuelve NADA. Además los negocios HUB_MANAGED no tienen cuenta Firebase (email sintetizado, business.controller.ts:3777-3786), así que nadie puede iniciar sesión en /admin/tiendas/{id} para ese negocio. Y el segundo síntoma citado es falso: la llamada de AgencyBrandingContext está dentro de un try/catch (AgencyBrandingContext.tsx:100-113), no revienta nada. El reclamo secundario también es moot: el único caller de resolveProductLimitForPlan es updateBusinessPlan (business.controller.ts:1377), que jamás se invoca sobre un negocio de hub.

**Fix sugerido:** Añadir la rama HUB_PLAN a los dos resolvers en business.controller.ts: en `resolvePlanDetails` devolver `{ name: 'Plan del Hub', features: buildPermissiveDefaults() }` (o leer `hub.subscription` de la colección compartida), y en `resolveProductLimitForPlan` devolver `-1`. Como red adicional, ampliar el `isAgencyPlanError` de routes.ts:52 para incluir `'Plan no encontrado'` / `HUB_PLAN`, o mejor: que el fallback dispare ante cualquier 404 con mensaje de plan.

---

### `hubuser-email-globally-unique` — hub_users.email es único GLOBAL, no por hub: bloquea que una misma persona tenga acceso a dos negocios o a dos hubs

**⚪ Bajo** · Modelo de datos

**Archivos:** `ordenaapp-backend/ordenaapp-hubs/src/models/hubUserModel.ts:15` · `ordenaapp-backend/ordenaapp-hubs/src/controllers/hubUsers.controller.ts:237`

**Escenario de fallo:** Un mismo dueño opera dos locales dentro del hub "Oe Ya" (por ejemplo dos sucursales, cada una un `business` distinto). Necesita un BUSINESS_VIEWER por negocio, porque `business_id` es escalar y el JWT estampa uno solo. Al crear el segundo acceso con su correo real recibe 409 "Ya existe un usuario con ese email" y hay que inventarle un alias (`+sucursal2`), que después no puede usar para recuperar contraseña si su proveedor no soporta subdirecciones. Lo mismo si un consultor administra dos hubs distintos: no puede usar su email en ambos.

Efecto lateral: un HUB_ADMIN del hub A puede enumerar si un email existe en el hub B (el 409 se dispara con datos de otro tenant).

**Matiz del verificador:** Es una consecuencia FORZADA del diseño de login, no un descuido: loginHubUser busca por email sin ningún scope de hub (hubUsers.controller.ts:125, `findOne({ email })`), porque en el login no hay hub context (no hay subdominio ni hubId en el body). Hacer el email único por hub rompería el login: dos usuarios con el mismo email serían indistinguibles. O sea, el índice es correcto DADO el login actual; el arreglo real es cambiar el login (email+hub o email+password determinista), no el índice.

**Fix sugerido:** Si el objetivo es "una identidad por hub", cambiar a índice compuesto `hubUserSchema.index({ hub_id: 1, email: 1 }, { unique: true })` y quitar el `unique` del campo — pero entonces el login (`hubUsers.controller.ts:121 findOne({ email })`) necesita también el hub, lo cual sólo es viable si el login vive bajo el host del hub. Si se prefiere mantener el email global, al menos scopear el pre-chequeo de creación por `hub_id` para no filtrar existencia entre tenants, y permitir varios `business_id` por usuario (array) para cubrir el caso de dos sucursales.

---

### `hubcategory-slug-edge-cases` — Renombrar una categoría global del hub no revalida el slug único (E11000 → 500) y un nombre sin caracteres latinos produce slug vacío que viola `required`

**⚪ Bajo** · Modelo de datos

**Archivos:** `ordenaapp-backend/ordenaapp-hubs/src/controllers/hubCategories.controller.ts:87` · `ordenaapp-backend/ordenaapp-hubs/src/controllers/hubCategories.controller.ts:42` · `ordenaapp-backend/ordenaapp-hubs/src/models/hubCategoryModel.ts:22` · `ordenaapp-backend/ordenaapp-hubs/src/utils/slug.ts:12`

**Escenario de fallo:** (a) El hub tiene las categorías "Pizzas" (slug `pizzas`) y "Pizzería" (slug `pizzeria`). El operador renombra "Pizzería" → "Pizzas": el update escribe `slug: 'pizzas'`, choca con el índice único, la excepción cae en el catch genérico (:110-117) y el usuario recibe **500 "Error interno del servidor"** en vez del 409 claro que sí obtendría creándola.

(b) El operador crea una categoría llamada "寿司" o "🍕": `normalizeSlug` devuelve `""`, el `exists({slug: ""})` no encuentra nada, `hubCategoryModel.create` lanza ValidationError por `slug` requerido → 500 sin explicación. (Nota: no es un problema de índice — la primera con slug vacío ni siquiera llega a insertarse.)

**Matiz del verificador:** Ambos sub-casos verificados tal cual. Precisión sobre (b): el fallo lo produce el validador `required: true` de Mongoose sobre string vacío (hubCategoryModel.ts:12), no el índice único — el hallazgo ya lo aclara correctamente. Es puramente calidad de error (500 genérico donde debería ir 409/400), sin corrupción de datos.

**Fix sugerido:** En `updateHubCategory`, replicar el `exists({ hub_id, slug, _id: { $ne: id } })` antes del update y devolver 409. En `createHubCategory`/`updateHubCategory`, si `normalizeSlug(name)` sale vacío, caer a un slug derivado (`categoria-<sufijo>`) o devolver 400 con un mensaje útil. Y capturar `error.code === 11000` en ambos catch para mapearlo a 409.

---

### `gateway-node-env-undocumented` — El gateway confia en *.localhost como origen core salvo que NODE_ENV=production, y NODE_ENV no esta en la guia de despliegue

**⚪ Bajo** · Preparación de deploy

**Archivos:** `ordenaapp-backend/ordenaapp-api-gateway/src/app.ts:80` · `ordenaapp-backend/ordenaapp-api-gateway/src/config.ts:16`

**Escenario de fallo:** Se despliega el gateway de staging (y luego el de produccion) con el arranque tipico `npm ci && npm start` sin NODE_ENV explicito -> NODE_ENV cae al default 'development' -> isOrdenaSubdomainOrigin devuelve true para cualquier origen que termine en .localhost -> el gateway responde Access-Control-Allow-Origin: <ese origen> con credentials:true y ademas salta la validacion de tenant (coreOrigin=true en app.ts:408), tratando esa peticion como si viniera de ordena.app. La mitigacion documentada queda inactiva sin que nada lo avise.

**Matiz del verificador:** Bajo de medium a low. Lo que queda en pie es un hueco de documentación (NODE_ENV no está en DEPLOY_STAGING_MVP.md §3, pese a que la auditoría del doc afirma que '*.localhost deja de ser origen confiable en producción' — afirmación que depende de esa env). El vector de ataque descrito es prácticamente inalcanzable desde fuera de la máquina de la víctima, y la parte del escenario sobre 'saltar la validación de tenant' es incorrecta: en app.ts:408 el camino coreOrigin devuelve 400 si falta businessId en rutas business_required.

**Fix sugerido:** Agregar `NODE_ENV=production` a la tabla de envs del gateway en DEPLOY_STAGING_MVP.md §3 (staging incluido, ya que la intencion es que *.localhost no sea confiable fuera de la maquina del dev), o invertir el default en config.ts:16 a 'production' para que la ausencia de la env sea la opcion segura.

---

### `doc-products-link-reservado` — El doc marca PRODUCTS_SERVICE_LINK de hubs como "Reservado", pero sin ella la seccion Productos del dashboard del hub no funciona

**⚪ Bajo** · Preparación de deploy

**Archivos:** `ordenaapp-backend/ordenaapp-hubs/docs/DEPLOY_STAGING_MVP.md:1` · `ordenaapp-backend/ordenaapp-hubs/src/services/productsService.external.ts:3` · `ordenaapp-backend/ordenaapp-hubs/src/services/productsService.external.ts:106`

**Escenario de fallo:** Quien aprovisione staging lee "Reservado" como "opcional", no setea la env, y hubs cae al default http://localhost:3004/api. Los pasos 3 y 4 del smoke test (crear producto con fotos, asignar categorias globales) fallan con ECONNREFUSED y el diagnostico apunta al ms products en vez de a una env faltante del ms hubs.

**Matiz del verificador:** Es un error de documentación, no un riesgo de despliegue. La corrección concreta: cambiar la nota de la fila PRODUCTS_SERVICE_LINK en DEPLOY_STAGING_MVP.md:93 de 'Reservado (tagging de categorías)' a algo como 'Obligatoria — CRUD de productos del hub + tagging de categorías'. El escenario de 'no la setea y falla el smoke test 3 y 4' es poco probable porque la env sí figura en la tabla de envs a configurar, bajo un encabezado que dice explícitamente 'todas'.

**Fix sugerido:** Cambiar la nota de esa fila a "Obligatoria — CRUD de productos del hub + tagging de categorias globales".

---

### `dedupe-index-sparse-partial` — El índice único del dedupeKey nunca se crea: MongoDB no admite sparse + partialFilterExpression juntos

**⚪ Bajo** · F3 v1 — WhatsApp y privacidad

**Archivos:** `ordenaapp-backend/ordenaapp-whatsapp-bot/src/models/whatsappLog.model.ts:26`

**Escenario de fallo:** Nota: este archivo es preexistente (commit ab4309e, whatsapp_log fase 1), pero F3 lo declara explícitamente como la "segunda red" contra el doble cobro (PLANTILLAS_REPARTIDOR_Y_HUB.md §5, y el comentario de orders.controller.ts:4014). Con el índice ausente, esa red no existe: en la carrera del hallazgo `delivery-notify-send-before-cas` los dos envíos pasan el findOne (ninguno ve todavía el documento del otro) y se insertan DOS filas con el mismo dedupeKey sin que nada las rechace. Resultado: doble mensaje, doble cobro, y el log deja de ser fuente fiable para el conteo/monitoreo de costo.

**Matiz del verificador:** Real como defecto (el índice no se crea), pero la consecuencia práctica es sólo que el log puede contener filas duplicadas y que no hay guarda atómica; el 'segundo cobro' lo causa el ordenamiento de orders (hallazgo delivery-notify-send-before-cas), no la ausencia de este índice. Severidad: low.

**Fix sugerido:** Quitar `sparse: true` y dejar solo `{ unique: true, partialFilterExpression: { status: 'sent', dedupeKey: { $type: 'string' } } }` (el partial ya excluye los documentos sin clave). Verificar en el arranque con un listener `Model.on('index', err => ...)` para que un fallo de creación no pase inadvertido. E igualmente, el candado fuerte debe estar en orders (CAS antes del envío).

---

### `template-button-deeplink-roto` — El botón 'Ver pedido'/'Ver en el panel' de las dos plantillas nuevas manda solo el orderId, y no existe ninguna ruta que lo acepte suelto

**⚪ Bajo** · F3 v1 — WhatsApp y privacidad

**Archivos:** `ordenaapp-backend/ordenaapp-orders/src/controllers/orders.controller.ts:363` · `ordenaapp-backend/ordenaapp-orders/src/controllers/orders.controller.ts:4104` · `ordenaapp-frontend/src/app/hub-admin/(portal)/pedidos/page.tsx:133`

**Escenario de fallo:** En cuanto las plantillas se registren en Meta con la base documentada, el repartidor pulsa "Ver pedido" y aterriza en `https://<base>/68f3...` → 404, porque ninguna ruta del frontend acepta un orderId sin storeName. El operador pulsa "Ver en el panel" y aterriza en `https://<base>/68f3...` → 404, porque /hub-admin/pedidos no tiene subruta por pedido. El aviso llega bien pero el CTA, que es la mitad del valor del mensaje, no lleva a ningún sitio.

**Matiz del verificador:** Real como incoherencia de contrato pendiente de resolver ANTES de registrar las plantillas (o de crear la ruta /hub-admin/pedidos/[orderId] y una vista de detalle por orderId), no como fallo desplegado. Severidad: low.

**Fix sugerido:** Decidir el destino antes de registrar en Meta: (a) para el repartidor, construir el sufijo completo `{storeName}/ordenes/{orderId}` (o publicar una ruta corta tipo `/o/{orderId}` que redirija); (b) para el hub, añadir soporte de `?order={orderId}` en `hub-admin/(portal)/pedidos/page.tsx` para abrir el panel lateral y mandar `pedidos?order=<id>` como sufijo. Y unificar el convenio con `pedido_negocio_hub_es` (sufijo en las tres, no URL absoluta en una).

---

### `productos-ignora-businessid-query` — /hub-admin/productos ignora ?businessId y abre siempre el primer negocio

**⚪ Bajo** · Frontend del hub

**Archivos:** `ordenaapp-frontend/src/app/hub-admin/(portal)/productos/page.tsx:36` · `ordenaapp-frontend/src/app/hub-admin/(portal)/productos/page.tsx:53` · `ordenaapp-frontend/src/app/hub-admin/(portal)/negocios/[businessId]/page.tsx:416` · `ordenaapp-frontend/src/app/hub-admin/(portal)/negocios/page.tsx:320`

**Escenario de fallo:** El operador esta en el detalle de 'Pizzeria Luigi', pulsa 'Ver productos', y aterriza en el catalogo de otro negocio (el primero de la lista) sin ningun aviso — el selector muestra el otro nombre pero el usuario viene de un contexto claro. Editar precio, desactivar o pulsar 'Eliminar' ahi destruye/modifica el producto del negocio equivocado (el borrado ni siquiera es reversible desde la UI).

**Matiz del verificador:** El riesgo de borrado descrito esta sobrevalorado: el selector de negocio en la linea 201 muestra el nombre real del negocio cargado, asi que el estado equivocado es visible, no silencioso.

**Fix sugerido:** Inicializar `businessId` desde `useSearchParams().get('businessId')` y solo caer al primero de la lista si la query esta vacia o el id no pertenece al hub (recordando envolver en Suspense / force-dynamic, mismo caveat que la pagina de pedidos).

---

### `hubtopbar-ausente-en-checkout-de-pago` — La barra del hub desaparece en las paginas de pago y en la de la orden

**⚪ Bajo** · Frontend del hub

**Archivos:** `ordenaapp-frontend/src/components/layout/StorefrontLayout.tsx:172` · `ordenaapp-frontend/src/pages/[storeName]/ordenes/[orderId]/pagar/index.tsx:566` · `ordenaapp-frontend/src/pages/[storeName]/checkout/index.tsx:3778`

**Escenario de fallo:** El cliente entra por oe-ya.ordena.app, ve la barra del hub en la tienda y en el checkout, confirma el pedido y aterriza en /ordenes/{id}/pagar (y luego en /pagar/transferencia): la barra del operador desaparece justo en la pantalla donde tiene que transferir dinero a una cuenta del HUB, y no le queda ningun camino de vuelta al hub salvo editar la URL. Es exactamente el punto donde la cohesion de marca mas importa.

**Matiz del verificador:** No es un descuido accidental: pagar/index.tsx:566 documenta que la pagina esta deliberadamente fuera del getLayout/CartProvider. El fix requiere montar HubTopBar por separado (o un layout ligero sin CartProvider), no simplemente anadir getLayout.

**Fix sugerido:** Anadir `Page.getLayout = withStorefrontLayout()` a ordenes/[orderId]/index.tsx y a las paginas de pagar/*, o montar <HubTopBar /> directamente en esas paginas (es autonomo: se auto-oculta si no hay cookie hubSlug).

---

### `hub-storefront-precio-hydration` — Los precios del storefront del hub causan mismatch de hidratacion

**⚪ Bajo** · Frontend del hub

**Archivos:** `ordenaapp-frontend/src/pages/hub/[hubSlug]/index.tsx:92` · `ordenaapp-frontend/src/pages/hub/[hubSlug]/index.tsx:334` · `ordenaapp-frontend/src/pages/hub/[hubSlug]/index.tsx:411`

**Escenario de fallo:** Hub peruano (currency PEN): el HTML del servidor imprime 'PEN 12.00' y el cliente re-renderiza 'S/ 12.00'. React 18 loguea 'Text content did not match' y descarta el HTML servidor de ese subarbol; el usuario ve un parpadeo de precios en la primera pintura y se pierde el beneficio del SSR en la grilla de productos.

**Matiz del verificador:** La segunda mitad de la evidencia es incorrecta: `new Date().getFullYear()` (linea 411) NO es el mismo patron — el ano es identico en servidor y cliente salvo en el instante exacto del cambio de ano, asi que no produce mismatch de hidratacion. Solo formatPrice (linea 92) es el problema; el fix es pasar un locale explicito derivado de hub.language/hub.country.

**Fix sugerido:** Pasar un locale determinista derivado de `hub.language`/`hub.country` (p. ej. 'es-PE') en vez de `undefined`, en formatPrice y en el resto de Intl del storefront del hub.

---

### `middleware-hub-cruzado-en-ruta-hub` — El subdominio de un hub puede servir la home de cualquier otro hub

**⚪ Bajo** · Frontend del hub

**Archivos:** `ordenaapp-frontend/src/middleware.ts:339` · `ordenaapp-frontend/src/middleware.ts:363`

**Escenario de fallo:** https://oe-ya.ordena.app/hub/hub-rival renderiza la home completa (marca, categorias, productos) del hub rival bajo el dominio de oe-ya, y ademas le inyecta las cookies hubId/hubSlug de oe-ya. Sirve para suplantacion de marca y genera contenido duplicado indexable en N subdominios. Los pagos no se ven afectados porque resolveHubPaymentsKey revalida business.hubId contra el hubId reclamado.

**Matiz del verificador:** Nota adicional: la incoherencia va mas alla del branding — se sirve la home del hub B con las cookies hubId/hubSlug del hub A ya escritas en el navegador, lo que puede confundir al checkout si el visitante navega luego a una tienda.

**Fix sugerido:** Aplicar la misma comprobacion que la rama de tiendas: si el segmento tras /hub/ no es `hub.slug`, redirigir a '/'.

---

### `horario-default-sobrescribe-real` — Si falla el fetch de settings, la pantalla de horarios muestra 9-18 y puede sobrescribir el horario real

**⚪ Bajo** · Frontend del hub

**Archivos:** `ordenaapp-frontend/src/app/hub-admin/(portal)/negocios/[businessId]/page.tsx:187` · `ordenaapp-frontend/src/app/hub-admin/(portal)/negocios/[businessId]/page.tsx:141` · `ordenaapp-backend/ordenaapp-hubs/src/controllers/hubBusinesses.controller.ts:183`

**Escenario de fallo:** business-service esta caido 30 s. El operador abre 'Horarios' de un negocio que abre de 11:00 a 23:00, ve 09:00-18:00 (cree que esta mal configurado), pulsa 'Guardar horario' y el PATCH escribe 9-18 + allowSalesOutsideHours:false encima del horario real. La tienda queda cerrada para los clientes en su franja de mayor venta.

**Matiz del verificador:** Detalle a anadir: hay una segunda inconsistencia independiente del fallo — `allowOutside` arranca en false mientras que la rama con datos usa `!== false` (default true), asi que el estado inicial no representa el default real del backend.

**Fix sugerido:** Distinguir 'no cargado' de 'sin configurar': si `businessHours` viene null, marcar un flag y bloquear el boton 'Guardar horario' con un mensaje de 'no pudimos leer el horario, reintenta'.

---

### `enlaces-ordena-app-hardcodeados` — 'Ver hub publico' apunta a produccion desde staging y localhost

**⚪ Bajo** · Frontend del hub

**Archivos:** `ordenaapp-frontend/src/app/hub-admin/(portal)/ajustes/page.tsx:178` · `ordenaapp-frontend/src/app/hub-admin/_components/HubPortalShell.tsx:90` · `ordenaapp-frontend/src/app/hub-admin/_lib/hubApi.ts:143`

**Escenario de fallo:** En staging o en desarrollo local, el operador pulsa 'Ver hub publico' desde Ajustes y se va al hub de PRODUCCION (o a un dominio inexistente si el hub solo existe en staging); no puede previsualizar sus cambios de branding recien guardados.

**Matiz del verificador:** Matiz sobre HubPortalShell: ahi el href es correcto (usa el helper); lo unico incorrecto es la etiqueta visible. El unico enlace realmente roto fuera de produccion es ajustes/page.tsx:178.

**Fix sugerido:** Usar `hubStorefrontBase(hub.slug)` en ajustes/page.tsx:178 y derivar tambien el texto mostrado en HubPortalShell.tsx:90 del mismo helper.

---

### `hub-settings-create-silent-fallback` — Si falla la creación de settings del negocio de hub, el comentario promete un auto-create que no existe y la política allowSalesOutsideHours=false queda desactivada para siempre

**⚪ Bajo** · Horarios comerciales

**Archivos:** `ordenaapp-backend/ordenaapp-business/src/controllers/business.controller.ts:3862` · `ordenaapp-backend/ordenaapp-business/src/controllers/businessSettings.controller.ts:1145` · `ordenaapp-backend/ordenaapp-business/src/controllers/businessSettings.controller.ts:192` · `ordenaapp-frontend/src/components/layout/StorefrontLayout.tsx:122`

**Escenario de fallo:** El insert de settings falla al crear un negocio de hub (índice duplicado, hipo de Mongo, validación). El negocio se crea igual con 201. Como `getBusinessSettingsByStoreLink` responde 404, el storefront nunca conoce `allowSalesOutsideHours: false` ni el horario: sin banner, sin badge, sin bloqueo — el negocio vende 24/7 en contra de la política del Modo Multi-Negocio, y nadie se entera hasta que alguien guarda el horario desde el hub-admin (que es lo que dispara el auto-create... con `allowSalesOutsideHours: true` por defecto si el body no manda el flag).

**Matiz del verificador:** Real pero de bajo impacto y contingente. Lo accionable concreto es: (1) corregir el comentario mentiroso en business.controller.ts:3862-3864, y (2) hacer fatal (o reintentable) el fallo de creacion de settings en createHubBusiness, porque un negocio HUB_MANAGED sin documento de settings pierde tema, hero y horario a la vez — no solo allowSalesOutsideHours.

**Fix sugerido:** O bien hacer fatal el fallo (rollback del negocio), o bien reintentar/completar el settings en `getBusinessSettingsByStoreLink` cuando `business.context === 'HUB_MANAGED'`. Como mínimo corregir el comentario, que hoy justifica no tratar el error.

---

### `hub-admin-badge-ignores-specialhours` — El badge Abierto/Cerrado del hub-admin ignora specialHours y contradice al storefront en feriados

**⚪ Bajo** · Horarios comerciales

**Archivos:** `ordenaapp-frontend/src/app/hub-admin/(portal)/negocios/[businessId]/page.tsx:88` · `ordenaapp-frontend/src/utils/businessHours.ts:177`

**Escenario de fallo:** El negocio tiene una excepción para el 25 de diciembre con `isClosed: true`. Ese día el storefront muestra "Cerrado hoy" y bloquea el carrito, mientras el HUB_ADMIN ve en el detalle del negocio el badge verde "Abierto ahora · Según el horario de America/El_Salvador". Diagnóstico contradictorio para el operador que recibe la queja del cliente.

**Matiz del verificador:** Confirmado tal cual. Nota adicional: la aritmetica overnight de getCurrentStoreState si es equivalente a la de la util compartida, asi que la unica divergencia real es specialHours (y, por lo mismo, tambien ignora el spill overnight proveniente de una excepcion de ayer).

**Fix sugerido:** Reutilizar `getBusinessStatus` de `@/utils/businessHours` en la página del hub-admin (el detalle ya devuelve `specialHours` dentro de `businessHours`) en lugar de mantener una cuarta copia de la lógica.

---

### `footer-metodos-no-hub-aware` — El footer del storefront de hub anuncia los metodos de pago del NEGOCIO, no los del hub que realmente se cobraran

**⚪ Bajo** · Pagos del hub

**Archivos:** `ordenaapp-frontend/src/storeNameSections/StoreFooter.tsx:158` · `ordenaapp-frontend/src/utils/storefrontPaymentMethods.ts:64` · `ordenaapp-frontend/src/api/routes/routes.ts:1176`

**Escenario de fallo:** Tienda dentro de un hub cuyo negocio tiene Zelle configurado a titulo propio y el hub solo tiene transferencia: el footer muestra el sello de Zelle en toda la tienda, pero en /pagar solo aparece transferencia del hub. Promesa visible que el checkout no cumple.

**Fix sugerido:** Aceptar la key del hub en `GET_PAYMENT_METHODS_SUMMARY` (mismo par key/omitBusinessHeader del helper) y anadir `/api/payments/payment-methods/[^/]+` a las policies public del gateway, o esconder la fila de sellos en storefronts de hub.

---

### `tarjeta-no-centralizada-en-hub` — En el storefront de hub la tarjeta (Stripe Connect / GlobalPay) sigue siendo del negocio: la centralizacion solo cubre los metodos manuales

**⚪ Bajo** · Pagos del hub

**Archivos:** `ordenaapp-frontend/src/pages/[storeName]/ordenes/[orderId]/pagar/index.tsx:1430` · `ordenaapp-frontend/src/pages/[storeName]/ordenes/[orderId]/pagar/index.tsx:1447`

**Escenario de fallo:** En un mismo checkout de hub, el cliente que elige transferencia paga al HUB y el que elige tarjeta paga directo a la cuenta Stripe del NEGOCIO. La liquidacion del hub queda incompleta y no hay forma de conciliarla (F4 liquidaciones asume que todo entro por el hub).

**Matiz del verificador:** Es cierto tecnicamente, pero se solapa con alcance declarado como PENDIENTE: 'F3 v2 (comercial: Stripe, ...)' es precisamente la fase donde la tarjeta se centraliza. Lo trato como hallazgo real y no como no-issue (a diferencia de hub-sin-enforcement-de-suscripcion) porque aqui SI hay un camino de dinero activo hoy: si un negocio de hub tiene Stripe Connect o GlobalPay conectado, el cobro con tarjeta se va a su cuenta sin ningun aviso ni bloqueo en la UI.

**Fix sugerido:** Decision de producto de F3 v2, pero mientras tanto ocultar tarjeta en storefronts de hub (con `hubPaymentsKey` ya disponible en la pagina) o documentar explicitamente que la tarjeta liquida al negocio.

---


# 2. Falsos positivos descartados por el verificador

Reportados por un auditor, refutados al leer el código completo — se listan para que nadie los 're-descubra':

- **phone-only-strips-plus** (f3-whatsapp): El número del repartidor/hub solo se limpia de '+': los espacios del formato que la propia UI sugiere rompen el envío
- **hub-sin-enforcement-de-suscripcion** (pagos): Suscripcion del hub vencida o cancelada: los metodos de pago se siguen sirviendo (nada lee subscription.status y nada pone status=SUSPENDED)
- **allowsalesoutsidehours-toggle-500** (datos): El toggle allowSalesOutsideHours no hace upsert: 500 en negocios preexistentes que nunca abrieron sus ajustes
- **hubs-db-boot-fail-silent** (deploy): ordenaapp-hubs arranca y responde aunque DB_LINK sea invalido o falte: el error de conexion se traga
- **hubs-no-engines-field** (deploy): ordenaapp-hubs no declara `engines`: el codigo requiere Node >= 18 (FormData/Blob globales, express 5, mongoose 9)


# 3. Qué quedó SIN revisar (declarado por los propios auditores)

- [contratos] Los valores reales de las variables de entorno en staging/producción (Railway/Vercel). Los hallazgos 1 y 4 se basan en los archivos .env presentes en los repos locales; si el deploy las inyecta por otra vía, verificarlo antes de actuar.
- [contratos] Seguridad de las 12 rutas GET de métodos de pago que esta rama volvió públicas en el gateway (app.ts:116). Son necesarias para /pagar y siguen el precedente de paypal/bank-accounts, pero devuelven titular/teléfono/enlace de cobro de CUALQUIER businessId sin token. Es dimensión de seguridad, no de contratos.
- [contratos] El bot de WhatsApp no tiene cambios en src en esta rama (git diff develop...HEAD -- src vacío; solo el .md de plantillas). No verifiqué que sendNotification valide el número de variables del body contra la plantilla registrada en Meta, así que un desajuste de aridad en pedido_repartidor_es (9 vars) / pedido_hub_es (8) / pedido_negocio_hub_es (8) fallaría en Meta, no aquí.
- [contratos] ms-reportes (ordenaapp-reportes): no revisé si sus agregados excluyen o atribuyen correctamente las órdenes con hub_id. Es parte de F3 v2 (reportes) según el plan.
- [contratos] Stripe y GlobalPay en el checkout de un hub: paymentsService.external.ts solo cubre los 14 métodos manuales; el flujo de tarjeta con la key del hub queda para F3 v2.
- [contratos] La ruta PUT /api/hubs/me/payment-accounts/:method/:accountId existe en el backend (hubOrders.routes.ts:56) pero ningún cliente la llama — hubApi.ts solo expone get/create/delete. No es un desajuste, pero es superficie sin ejercitar.
- [contratos] Aislamiento efectivo del rol BUSINESS_VIEWER más allá del reenvío de businessId (leí resolveScopedBusinessId y stripOrderPII, pero el análisis de fugas de PII es de la dimensión de seguridad).
- [aislamiento] Rate limiting / proteccion contra fuerza bruta en POST /api/hub-users/login y /register: la ruta es publica en el gateway y no vi ningun limitador (ni en hubs/src/app.ts ni en el gateway). Credential stuffing y enumeracion de hubs por registro de slug quedan sin evaluar.
- [aislamiento] Flujo de recuperacion de contrasena del hub: hubUserModel tiene password_reset_token_hash / password_reset_expires_at (hubUserModel.ts:26-27) pero no existe ningun endpoint que los use. Si se anade despues, hay que revisar su aislamiento por hub.
- [aislamiento] No revise los otros 13 controllers de metodos de pago de ordenaapp-payments (solo sinpe). El commit 793a4416 dice que los 14 quedaron hub-aware, pero solo verifique que sinpe acota por (id, businessId).
- [aislamiento] Impacto de haber hecho publicos los GET de los 12 metodos manuales en el gateway (app.ts, patron /api/payments/(sinpe|nequi|daviplata|...)/[^/]+): no revise que campos devuelve cada uno ni si alguno expone datos que no deberian verse sin pasar por un pedido (p.ej. titular completo de cuenta, documento de identidad).
- [aislamiento] Endpoints legacy de orders con validateBusinessId que solo comprueba presencia de cabecera (getOrdersByBussinessId, getBusinessResume, getCustomerOrderCount, abandoned-carts, test-flag): quedan expuestos por el mismo agujero del gateway descrito en gateway-passthrough-sin-token, pero no los audite uno a uno.
- [aislamiento] No verifique el comportamiento en runtime de ninguno de los hallazgos (soy read-only y no levante los servicios). Todo esta derivado de lectura de codigo.
- [aislamiento] Autorizacion en el frontend de /hub-admin y /hub-portal (que un BUSINESS_VIEWER no pueda navegar al panel de operador): el backend rechaza con 403 en cada endpoint, pero no revise si la UI se rompe o filtra datos cacheados de hub-data en localStorage al cambiar de rol en el mismo navegador.
- [aislamiento] Reportes (ms-reportes) y cualquier otro consumidor que lea la coleccion orders directamente: si alguno agrupa por bussiness_id sin considerar hub_id, podria mezclar datos, pero ese repo no estaba en el alcance.
- [f3-whatsapp] No verifiqué en un Mongo real que el `createIndex` de whatsappLog falle (hallazgo dedupe-index-sparse-partial): la afirmación se basa en la restricción documentada de MongoDB de no combinar `sparse` con `partialFilterExpression`. Se confirma en 10 segundos con `db.whatsapp_log.getIndexes()` en el entorno donde corre el bot.
- [f3-whatsapp] No comprobé si un negocio HUB_MANAGED puede iniciar sesión en el dashboard clásico (/admin/tiendas/[businessId]). `createBusinessForMyHub` guarda un `email` en el negocio (ordenaapp-hubs/src/controllers/hubBusinesses.controller.ts:82) y el gateway autoriza comparando el email del token Firebase con `business.email` (api-gateway/src/app.ts:449-470). Si ese email llega a tener cuenta Firebase, el negocio vería el detalle del pedido con TODA la PII (la página no aplica la matriz de privacidad) y tendría el botón "Notificar a repartidor", que dispararía al repartidor del HUB y quemaría el candado de una sola vez — justo lo que ordenaapp-hubs prohíbe al BUSINESS_VIEWER. Merece una comprobación explícita.
- [f3-whatsapp] No revisé si `orders.controller.ts` (ni ningún otro consumidor del listado clásico `GET /orders/bussiness/:id`) filtra PII para negocios de hub: ese endpoint devuelve los pedidos completos y no conoce `businessVisibility`. Si un negocio del hub tiene acceso al dashboard clásico, es una segunda vía de salto de la matriz de privacidad.
- [f3-whatsapp] No verifiqué el comportamiento real de la Graph API de Meta ante un `to` con espacios (hallazgo phone-only-strips-plus): asumo rechazo por parámetro inválido. Sea rechazo o normalización silenciosa, la falta de normalización sigue siendo el defecto.
- [f3-whatsapp] No revisé el reporte/analytics de ms-reportes ni ningún otro servicio que lea la colección `orders` directamente por Mongoose; si alguno expone pedidos a un usuario del portal del negocio, la matriz de privacidad tampoco se aplicaría ahí.
- [f3-whatsapp] No evalué el impacto de la caché de 60s de `getHubNotificationConfig` (businessUsage.service.ts:150) sobre el cambio de la matriz de privacidad: durante hasta un minuto tras desactivar un campo, los avisos de WhatsApp al negocio pueden seguir incluyéndolo. Es un comportamiento consciente por diseño, pero no está documentado en el .md.
- [frontend-hub] Renderizado real de la tienda de un negocio dentro del hub (/{negocio} -> /[storeName] con el store_link namespaceado): solo verifique la reescritura del middleware, no el SSR de [storeName].tsx bajo ese prefijo.
- [frontend-hub] Las 15 subpaginas de /pagar/* (transferencia, yape, sinpe...) mas alla de confirmar que importan paymentAccountsKey y que no tienen getLayout; no revise si cada una resuelve bien la key del hub en runtime.
- [frontend-hub] No pude ejecutar `next build` ni `npx tsc --noEmit` para confirmar empiricamente el fallo de useSearchParams (hay dev servers corriendo); el diagnostico es por lectura de codigo + version de Next + ausencia de escape hatches en next.config.mjs.
- [frontend-hub] Comportamiento del middleware ante dominio custom del hub (F4, pendiente): hubModel tiene subdocumento `domain` y el resolve lo proyecta, pero el middleware no lo usa todavia.
- [frontend-hub] Si products-service valida que los hubCategoryIds enviados desde /hub-admin/productos pertenecen al hub (el controller de hubs delega esa revalidacion al endpoint interno de products).
- [frontend-hub] Accesibilidad y responsive de las pantallas del hub-admin (solo mire clases, no probe en viewport real).
- [frontend-hub] Comportamiento del boton 'Notificar a repartidor' end-to-end (plantillas Meta, CAS del envio unico): solo verifique el contrato frontend<->hubs y el manejo del 409 en pedidos/page.tsx:235-249.
- [pagos] No ejecute ninguna peticion real: la cadena del hallazgo critico esta derivada del codigo (rutas, middlewares y policies) y conviene confirmarla con dos curls contra staging antes de priorizar.
- [pagos] La UI de administracion de metodos de pago del hub (src/app/hub-admin/**) mas alla de comprobar que llama al proxy con JWT (hubApi.ts:193-197): no revise validaciones de formulario ni manejo de errores.
- [pagos] El flujo /pago-link/[storeName] para negocios de hub (esta en HUB_RESERVED_SEGMENTS, middleware.ts:144) — redirige a /{store_link}/ordenes/{id}/pagar de forma relativa, pero no verifique el SSR de esa pagina.
- [pagos] Las plantillas de WhatsApp al CLIENTE (no al negocio) por si alguna incluye el enlace de pago con base ordena.app; solo confirme la del negocio (orders.controller.ts:293) y la base del bot (whatsapp-bot/src/config.ts:7).
- [pagos] El resto de metodos de pago fuera de la whitelist del hub (stripe, globalpay, wompi) en contexto de hub: solo verifique que no son alcanzables desde el proxy.
- [pagos] Si existe algun job/webhook externo (fuera de estos 8 repos) que escriba `hub.status` o `hub.subscription.status`.
- [horarios] Transiciones reales de DST (marzo/noviembre) con zonas que sí las tienen (America/Santiago, America/Asuncion). El razonamiento sobre `Date.now() - 24h` sugiere que aguanta, pero no lo ejecuté contra fechas concretas de cambio de hora.
- [horarios] El ORDEN de los intervalos dentro de un día no se normaliza en ningún lado: `normalizeWeeklyHours` (timeHelpers.ts:59-86) ordena los DÍAS pero no los intervalos, y `validateIntervals` solo ordena una copia local (línea 29). Si un día llega como [19:00-04:00, 08:00-13:00] vía API directa, `isOpen` sigue siendo correcto (el bucle recorre todos), pero el `statusText` de 'próxima apertura' (businessHours.ts:243-247) devuelve el PRIMER intervalo del array con start futuro, no el más temprano — a las 06:00 diría 'Abre 7:00 PM' en vez de 'Abre 8:00 AM'. Por la UI actual es difícil de producir (el editor añade siempre después del último `end`, línea 4469); no verifiqué si algún import/seed lo genera.
- [horarios] Si el bot de WhatsApp (ordenaapp-whatsapp-bot) puede originar pedidos por un camino distinto a `POST /orders`. Solo confirmé que `createOrder` en orders no valida horario; no rastreé todos sus llamadores.
- [horarios] Decisión de producto, no bug: una excepción de specialHours que marca HOY como cerrado NO cancela el spill overnight de ayer, porque el bloque de spill (businessHours.ts:211-220) corre antes de leer el horario de hoy. Es defendible (el turno nocturno de ayer termina), pero conviene que alguien confirme que es lo que se quiere para feriados.
- [horarios] `getHubBusinessesPublic` (business.controller.ts:3943) hace `$match` solo por `hubId`, sin filtrar por `status`/borrado lógico. Lo noté de paso al revisar de dónde salen los `businessHours` del home del hub; queda para la dimensión de visibilidad/tenancy, no la revisé a fondo.
- [datos] No revisé el diff del frontend fuera de lo estrictamente necesario para trazar el modelo de datos: middleware.ts, hubPaymentsKey.ts, routes.ts, businessHours.ts y las páginas de /hub-admin, /hub-portal y /hub/[hubSlug]. La revisión completa de UI, cookies y flujo de checkout del storefront del hub corresponde a otra dimensión.
- [datos] No ejecuté nada contra una base de datos real: no verifiqué el estado actual de los índices en staging/producción (`db.businesses.getIndexes()`, `db.orders.getIndexes()`), ni si ya existe algún índice con nombre `hubId_1_hubSlug_1` u opciones distintas que provocaría un IndexOptionsConflict al arrancar. Tampoco medí cuánto tarda en construirse `products.hubCategoryIds` sobre el volumen real de la colección `products`.
- [datos] No revisé `ordenaapp-reportes` ni `ordenaapp-agencies`. En reportes vi de pasada que `trackController.ts:149` discrimina con `business.context === 'WHITE_LABEL'`, lo que implica que un negocio HUB_MANAGED se trata como SAAS a efectos de tracking — no verifiqué si eso es lo deseado ni qué hacen el resto de agregaciones de reportes con `context: 'HUB_MANAGED'`, `planRef.kind: 'HUB_PLAN'` o `subscription.source: 'HUB'`, que son valores de enum que ese servicio nunca había visto.
- [datos] No verifiqué el modelo de datos de `whatsapp_log` en ordenaapp-whatsapp-bot (el diff de src está vacío en ese repo), ni si el `dedupeKey` `{orderId}:{template}` que usan los avisos nuevos (`${order._id}:hub` en orders.controller.ts:373, y el del repartidor) tiene índice único que garantice el envío único por costo.
- [datos] No revisé las migraciones/scripts existentes en `src/scripts/` de cada repo para confirmar que ninguno se rompe con los enums ampliados (por ejemplo `migrate-plans-v2.ts` en business o `backfillProviderInOrderItems.ts` en orders, que recorren todos los negocios/órdenes).
- [datos] No evalué el impacto de que `getOrdersByHubInternal` (orders.controller.ts:3793-3798) NO filtre `held_by_limit: { $ne: true }` mientras que `getHubOrdersSummaryInternal` (:3868) sí lo hace — el listado y los KPIs del panel del hub pueden discrepar en el conteo. Es una inconsistencia de consulta, no de modelo, y la dejo para la dimensión de lógica de negocio.
- [deploy] La logica de autorizacion interna de los controllers de ordenaapp-hubs (roles HUB_OWNER/ADMIN/STAFF/BUSINESS_VIEWER, scope del token, filtrado de PII por businessVisibility) — es la dimension de seguridad, no la de despliegue.
- [deploy] Si la plataforma de hosting elegida para el ms hubs hace healthcheck HTTP o solo TCP. No hay ruta de health (app.ts:30 es un catch-all 404, GET / devuelve 404), igual que en ordenaapp-agencies; si el pipeline de agencies usa TCP no hay problema, si usa HTTP GET / esperando 200 el servicio se marcaria unhealthy en bucle.
- [deploy] Estado real de aprobacion en Meta de pedido_repartidor_es, pedido_hub_es y pedido_negocio_hub_es (categoria Utility). Sin ellas aprobadas, los pasos 14-17 del smoke test fallan aunque el codigo este bien.
- [deploy] Tiempo real de construccion del indice parcial {hub_id, created_at} sobre la coleccion `orders` de produccion (no tengo acceso a su tamano). Es hibrido/no bloqueante desde MongoDB 4.2, pero conviene medirlo antes del deploy a prod.
- [deploy] Que `npm ci` resuelva de verdad mongoose@^9.2.1, mongodb@^7.1.0, express@^5.2.1 y multer@^2.2.0 contra el registry en la version de Node del pipeline — solo verifique que el lock esta coherente y que node_modules local (Node 22) resuelve 9.9.3/7.5.0/5.2.1.
- [deploy] ordenaapp-reportes, queue-service, shipping-usa y ordenaapp-authentication/users: no tienen la rama feature/new-mode-ordena-hub y no los revise. ordenaapp-agencies solo lo mire para rastrear el llamador de patchBusinessInternal — puede tener otras integraciones con business afectadas que no audite.
- [deploy] Configuracion real del wildcard DNS/Vercel (*.staging.ordena.app) y si el proyecto de staging ya tiene el dominio wildcard agregado — prerequisito #5 del doc, no verificable desde el codigo.
- [deploy] Comportamiento del proxy multipart hubs->products/business bajo carga real (limites de multer, tamano de imagen, timeout de 30s en uploadBusinessLogoExternal) — solo verifique que el codigo compila y que el gateway no rompe el stream.


# 4. Verificado CORRECTO (127 comprobaciones en positivo)

Cada línea es algo que un auditor revisó a fondo y confirmó que está bien — vale tanto como un hallazgo:

- [contratos] hubs→business: las 6 URLs de businessService.external.ts existen tal cual en el destino — POST /business/hub-managed (business.routes.ts:52), GET /businesses/hub/:hubId (:53), PATCH /business/:id/hub-logo (:55), PATCH /business/:id/internal (:68), GET /business/:id (:87), GET /business-settings/:businessId (businessSettings.routes.ts:22) y PATCH /business-settings/:businessId/hours/weekly (:48). Sin /api duplicado ni faltante: BUSINESS_SERVICE_LINK ya trae el /api (hubs/config.ts:9) y business monta `app.use('/api', businessRoutes)` (business/app.ts:38-39).
- [contratos] hubs→orders: GET /internal/hub/:hubId/orders, GET /internal/hub/:hubId/summary y PATCH /internal/hub/:hubId/orders/:orderId/status (ordersService.external.ts:22,31,45) coinciden en ruta Y verbo con orders.routes.ts:40,41,42. POST /admin/orders/:orderId/notify-delivery (ordersService.external.ts:59) coincide con orders.routes.ts:78, y su middleware validateBusinessId solo exige presencia de x-business-id, que hubs sí manda (ordersService.external.ts:61).
- [contratos] hubs→products: GET /productbusiness-admin/:id, GET/PATCH/DELETE /product/:id, POST /product y PATCH /internal/hub/:hubId/product/:productId/hub-categories (productsService.external.ts:22,36,48,82,92,107) existen todos en product.routes.ts:20,18,26,27,30,15, con los verbos correctos. Los nombres de query también encajan: {page,limit,name} (productsService.external.ts:19) ↔ getProductsByBusinessIdAdmin (product.controller.ts:624-632).
- [contratos] hubs→payments: el desdoblamiento de verbo es correcto — bank-accounts usa PUT /:businessId/:accountId (bankAccount.routes.ts:48) y el resto PATCH /:businessId/:id (p.ej. sinpe.routes.ts:21), que es exactamente lo que hace updateHubPaymentAccount (paymentsService.external.ts:55-63). Los 14 métodos de HUB_PAYMENT_METHODS (paymentsService.external.ts:9-24) tienen su router montado en payments/app.ts:78-97.
- [contratos] El planGate de payments SÍ reconoce una key de hub, así que POST de un método de pago del hub no se bloquea: cuando getBusinessPlanData no encuentra negocio, cae en `if (await isHubKey(...)) return next()` (planGate.ts:67-74), e isHubKey consulta la colección 'hubs' (businessPlan.ts:47-59) — que es la que registra el modelo del servicio (`model<IHub>("hubs", hubSchema)`, hubModel.ts, última línea). Mismo chequeo para hub_categories y hub_users.
- [contratos] El proxy del gateway compone bien el path pese al doble prefijo: `app.use('/api/hubs', buildProxy(`${HUBS_SERVICE_URL}/hubs`))` (api-gateway/app.ts:565) con HUBS_SERVICE_URL='http://localhost:3013/api' (config.ts:29) → Express deja req.url='/me/orders' → llega a /api/hubs/me/orders, que es donde hubs monta sus routers (hubs/app.ts:23-28). Idéntico patrón para /api/hub-users.
- [contratos] El bypass de Firebase para /api/hubs y /api/hub-users (api-gateway/app.ts:296) NO expone los endpoints internos: aunque la política los marca 'public' (app.ts:104-105), los dos handlers internos revalidan el secreto dentro del controller y son fail-closed — isValidInternalCall en hubs.controller.ts:163-167, usado en incrementHubOrderUsage (:177) y getHubNotificationConfig (:259). Lo mismo del lado business: createHubManagedBusiness (:3736), getBusinessesByHubId (:3894) y updateHubBusinessLogo (:4000) llevan guard aunque business.routes.ts no monte middleware.
- [contratos] Ninguna ruta pública quedó tras el auth: /api/hubs/resolve (hubs.routes.ts:13) y /api/hub-users/login|register (hubUsers.routes.ts:14-15) caen bajo la política 'public' del gateway y bajo el bypass de Firebase, así que el middleware del frontend (middleware.ts:122) y la pantalla de login llegan sin token.
- [contratos] Envelopes: los extractores toleran las dos formas correctamente. GET /business/:id devuelve el documento PELADO (business.controller.ts getBusinessById → `res.status(200).json(data)`) y assertBusinessBelongsToHub encadena `resp?.data?.business ?? resp?.business ?? resp?.data ?? resp` (businessService.external.ts:78), que resuelve al doc. GET /product/:id también devuelve el producto pelado y hubProducts.controller.ts:48 usa la misma cadena. Ningún `resp.data.data` sobre un objeto plano.
- [contratos] Envelopes de orders→hubs: los tres endpoints internos emiten {status,statusCode,message,data:{...}} (orders.controller.ts:3822-3827, 3921-3944, 3985-3990) y hubs lee exactamente ese nivel — `resp?.data?.orders` (hubOrders.controller.ts:87), `summaryResp?.data` (:157 y :213), `businessesResp?.data?.businesses` (:211). El frontend cierra la cadena igual: negocios/page.tsx:130 lee data.businesses y productos/page.tsx:72 contempla el {data:{products}} de products.
- [contratos] Los nombres de query viajan intactos de punta a punta: hubApi.ts:95-102 {page,limit,businessId,status,from,to} → hubOrders.controller.ts:69-76 → ordersService.external.ts:12-19 → orders.controller.ts:3789-3810 (mismos identificadores). Igual para el storefront: {name,hubCategoryId,businessSlug,page,limit} en routes.ts:1203 ↔ product.controller.ts:2499-2508.
- [contratos] orderModel declara `hub_id: { type: String, default: null }` (orderModel.ts:10), así que los guards `typeof order?.hub_id === 'string'` de runHubUsageIncrement (orders.controller.ts:273) y sendHubOrderWhatsapp (:356) sí disparan — no hay el clásico fallo de comparar un ObjectId contra 'string'.
- [contratos] createOrder no confía en el hub_id del cliente: lo acepta solo si tiene forma de ObjectId y business-service confirma que el negocio pertenece a ese hub, y si la verificación falla lo descarta en vez de etiquetar (orders.controller.ts:1765-1785). El filtro de mutación de orders vuelve a exigir hub_id + bussiness_id (orders.controller.ts:3976).
- [contratos] El checkout omite x-business-id cuando la key es un hub — que es lo correcto, porque el gateway validaría el hubId como negocio y daría 404: paymentAccountsKey devuelve omitBusinessHeader (hubPaymentsKey.ts:35-43), paymentMethodsSsrConfig lo respeta (routes.ts, `omitBusinessHeader ? { headers: {} } : {...}`), y los 14 getters aceptan el flag (routes.ts:1231 a 1550, uno por método). Las 14 rutas GET correspondientes están en la lista pública del gateway (app.ts:114,116,119).
- [contratos] products lee INTERNAL_HUBS_SECRET a nivel de módulo (product.controller.ts:2467) pero no hay carrera con dotenv: el import de '../config' en la línea 6 ejecuta config() antes (products/src/config.ts:1-3).
- [contratos] El servicio hubs arranca pese a estar en Express 5 mientras el resto usa Express 4: cargando dist/app.js el mount de los 6 routers y el catch-all `app.use('', ...)` resuelven sin excepción. axios es ^1.13.5, así que el FormData nativo de uploadBusinessLogoExternal (businessService.external.ts:128) y createBusinessProduct (productsService.external.ts:70) se serializa con boundary correcto hacia el multer del destino (upload.single('image') en business.routes.ts:55, upload.array('images',4) en product.routes.ts:27).
- [contratos] El borrado de categorías globales deja hubCategoryIds colgantes a propósito y no rompe nada: las ids inexistentes simplemente no matchean en el $match del storefront (hubCategories.controller.ts, comentario tras deleteOne; product.controller.ts:2552 `matchFilter.hubCategoryIds = String(hubCategoryId)`).
- [aislamiento] ordenaapp-hubs/src/routes/*.ts — matriz de roles revisada endpoint por endpoint y es coherente: BUSINESS_VIEWER solo aparece en 3 rutas (GET /me/portal/summary, GET /me/orders, PATCH /me/orders/:orderId/status — hubOrders.routes.ts:17-41) y en las que no llevan requireHubRole (GET /me y GET /me/categories). Queda fuera de negocios, productos, usuarios y cuentas de pago (hubBusinesses.routes.ts:45-89, hubProducts.routes.ts:47-78, hubUsers.routes.ts:18-20, hubOrders.routes.ts:44-67).
- [aislamiento] ordenaapp-hubs/src/controllers/hubs.controller.ts:63-68 — la proyeccion de getMyHub para BUSINESS_VIEWER es una lista BLANCA ('name slug logo favicon branding timezone country currency language'): deja fuera subscription, usageMetrics, businessVisibility, contact (incluido deliveryWhatsapp), domain e isTestHub. Correcto.
- [aislamiento] ordenaapp-hubs/src/controllers/hubUsers.controller.ts:148-152 — el snapshot del login para BUSINESS_VIEWER usa la misma lista blanca (+status). No filtra suscripcion, limites ni el telefono del repartidor al localStorage del negocio. Correcto.
- [aislamiento] ordenaapp-hubs/src/utils/auth.ts:123-130 — resolveScopedBusinessId es correcto: para BUSINESS_VIEWER devuelve null si no hay businessId en el token o si el businessId pedido difiere del suyo, y ambos callers traducen ese null a 403/400 sin filtrar informacion (hubOrders.controller.ts:60-67 y 142-149).
- [aislamiento] ordenaapp-hubs — inventario completo de assertBusinessBelongsToHub: presente en las 5 mutaciones/lecturas de hubBusinesses (154, 177, 218, 249, 275), en las 4 de hubProducts (68, 90, 128, 159), en portal/summary (hubOrders 152), en notify-delivery (hubOrders 265) y en la creacion de BUSINESS_VIEWER (hubUsers 226). Las 3 ausencias son deliberadas y estan cubiertas aguas abajo (ver items siguientes).
- [aislamiento] ordenaapp-hubs/src/controllers/hubOrders.controller.ts:69-76 y 121-125 — getMyHubOrders y updateMyHubOrderStatus no llaman assertBusinessBelongsToHub, pero no hace falta: orders acota SIEMPRE por hub_id (orders.controller.ts:3796 filter.hub_id y :3976 filter { _id, hub_id }), asi que un businessId ajeno pasado por query/body simplemente no devuelve nada. El businessId del viewer se aplica ademas como filtro extra.
- [aislamiento] ordenaapp-hubs/src/controllers/hubProducts.controller.ts:169-184 — setMyProductHubCategories no valida en hubs, pero products re-valida la cadena producto->negocio->hub server-side (product.controller.ts, setProductHubCategories: lee product.businessId y comprueba businessMap.has(...) contra los negocios del hubId, devolviendo 403). El hubId que se envia es ctx.hubId del token, nunca del body.
- [aislamiento] ordenaapp-hubs/src/controllers/hubProducts.controller.ts:44-61 — assertProductBelongsToBusiness es un candado extra correcto (compara product.businessId con el businessId de la ruta y lanza 403), aplicado en update y delete antes de tocar products.
- [aislamiento] ordenaapp-orders/src/controllers/orders.controller.ts:1766-1785 — createOrder NO confia en el hub_id que manda el checkout: valida forma de ObjectId y consulta business-service para confirmar que business.hubId === claimedHubId, y si falla la verificacion deja hub_id=null (fail-closed). Esto cierra el vector obvio de la cookie hubId manipulable (frontend checkout/index.tsx:1812-1819). Correcto y bien comentado.
- [aislamiento] ordenaapp-frontend/src/utils/hubPaymentsKey.ts:16-27 — resolveHubPaymentsKey solo acepta el hubId reclamado por cabecera/cookie si business.hubId coincide; si no, cae a la key del negocio. Impide que un visitante haga que una tienda muestre las cuentas bancarias de un hub ajeno.
- [aislamiento] Guard del secreto interno FAIL-CLOSED confirmado en los 4 servicios: hubs (hubs.controller.ts:163-167, aplicado en incrementHubOrderUsage :177 y getHubNotificationConfig :266), business (business.controller.ts:3698-3701 en createHubManagedBusiness/getBusinessesByHubId/updateHubBusinessLogo, mas utils/internalHubGuard.ts:8-13 aplicado como middleware ANTES de multer en la ruta hub-logo), orders (orders.controller.ts:3780-3781, 3850-3851, 3962-3963 en los 3 endpoints /internal/hub/*) y products (product.controller.ts isValidInternalHubCall, `if (!INTERNAL_HUBS_SECRET) return false`). En los cuatro, sin env configurada devuelven 403 — ninguno tiene el 'modo compat' que dejaria abierto el endpoint.
- [aislamiento] ordenaapp-hubs/src/routes/hubs.routes.ts:8-10 — las dos rutas /internal/* no llevan middleware en la definicion de la ruta, pero ambos controllers llaman isValidInternalCall como primera sentencia. No hay endpoint interno sin guard en ningun servicio.
- [aislamiento] ordenaapp-products-and-categories/src/controllers/product.controller.ts:1324-1326 y :1893 — updateProduct y deleteProduct SI filtran por businessId ademas del _id. La escritura final de updateProduct (findByIdAndUpdate por _id solo, :1716) es segura porque la pertenencia ya se comprobo al leer currentProduct, y la ruta lleva validateBusinessId (product.routes.ts:26) asi que la cabecera siempre esta presente y nunca cae a la rama findById sin filtro.
- [aislamiento] ordenaapp-business/src/controllers/business.controller.ts:3928-3971 — getHubBusinessesPublic (publico) proyecta lista blanca sin email ni phone: _id, name, hubSlug, store_link, image_url, description, industry, operationalStatus, region_settings.country/currency y businessHours. En cambio getBusinessesByHubId (interno, :3889-3906) sí incluye email/phone y esta detras del guard del secreto. Separacion correcta.
- [aislamiento] ordenaapp-hubs/src/controllers/hubPayments.controller.ts — los 4 endpoints usan SIEMPRE ctx.hubId del token; el hubId nunca llega por params/body. Y aguas abajo payments acota por ambos: SinpeService.updateSinpe(id, businessId, ...) y deleteSinpe(id, businessId) (sinpe.controller.ts:215, 262). Un hub no puede tocar la cuenta de otro por accountId.
- [aislamiento] ordenaapp-hubs/src/controllers/hubCategories.controller.ts:94-98 y :129 — updateHubCategory y deleteHubCategory filtran por { _id: id, hub_id: ctx.hubId }, asi que un hub no puede editar ni borrar categorias de otro pasando un _id ajeno.
- [aislamiento] ordenaapp-orders/src/controllers/orders.controller.ts:4022-4026 — notifyDeliveryPerson exige que la orden sea del negocio de la cabecera ({ _id: orderId, bussiness_id: headerBusinessId }), y hubs valida antes que ese negocio sea del hub (hubOrders.controller.ts:265). Un operador no puede notificar sobre pedidos de otro hub.
- [aislamiento] ordenaapp-frontend/src/middleware.ts:363-368 — el passthrough namespaceado SI tiene candado: un store_link cuyo sufijo no sea el del hub del host se redirige a /. La debilidad esta en el tamano del sufijo (ver hallazgo hub-suffix-6-hex-colisionable), no en la ausencia del check.
- [aislamiento] ordenaapp-frontend/src/middleware.ts:96-108 — getHubCandidateSlug maneja bien el orden staging/apex y rechaza subdominios anidados (sub.includes('.')), asi que a.b.ordena.app no se toma como hub. www/market/staging/api/admin/login/cname/dns estan excluidos.
- [aislamiento] ordenaapp-frontend/src/middleware.ts:314-319 — las cookies hubId/hubSlug se setean sin atributo domain, o sea host-only: no se comparten entre subdominios de hubs. Y las cookies token/businessId del dashboard clasico tampoco fijan domain (authProvider.ts:13, authService.ts:106,142), asi que el token Firebase de ordena.app no viaja a {slug}.ordena.app.
- [aislamiento] ordenaapp-api-gateway/src/app.ts:80-90 — isOrdenaSubdomainOrigin exige el punto ('.ordena.app'), asi que un dominio tipo malicioso-ordena.app no pasa como origen de confianza, y la rama *.localhost esta correctamente limitada a NODE_ENV !== 'production'.
- [aislamiento] ordenaapp-whatsapp-bot — la rama solo anade PLANTILLAS_REPARTIDOR_Y_HUB.md (doc). Cero cambios de codigo, cero superficie de auth nueva.
- [f3-whatsapp] Conteo y ORDEN de las variables del body: los TRES bodies coinciden exactamente con el contrato de PLANTILLAS_REPARTIDOR_Y_HUB.md, variable por variable. pedido_repartidor_es (9 vars, orders.controller.ts:4086-4096): [id-6, negocio, dirección recogida, cliente, tel, dirección entrega, referencia, total, línea de cobro] == §2. pedido_hub_es (8 vars, orders.controller.ts:364-373): [hub, negocio, id-6, cliente, tel, entrega, total, pago] == §3. pedido_negocio_hub_es (8 vars, orders.controller.ts:322-331): [negocio, id-6, cliente, tel, método de entrega, dirección, total, pago] == §4. No hay desfase de índice en ninguna de las tres.
- [f3-whatsapp] Matriz de privacidad COHERENTE en las cuatro capas, con el mismo default (nombre sí, teléfono no, dirección no): modelo `businessVisibility` con defaults true/false/false (ordenaapp-hubs/src/models/hubModel.ts:123-127); `stripOrderPII` en el listado del portal usa `customerName !== false` / `customerPhone === true` / `customerAddress === true` (ordenaapp-hubs/src/controllers/hubOrders.controller.ts:83-85); la plantilla del negocio usa esas mismas tres expresiones (ordenaapp-orders/src/controllers/orders.controller.ts:317-319); y el formulario del panel las repite al hidratar (ordenaapp-frontend/src/app/hub-admin/(portal)/ajustes/page.tsx:74-77). No hay ningún `!== false` donde debería haber `=== true` ni al revés.
- [f3-whatsapp] stripOrderPII cubre más de lo que exige la matriz de tres campos y lo hace bien: al ocultar el teléfono también anula `customer_email`, y al ocultar la dirección anula `delivery_city`, `delivery_department` y `delivery_reference` además de `delivery_address` (ordenaapp-hubs/src/controllers/hubOrders.controller.ts:36-46). El filtrado es server-side y solo se salta la copia del PATCH de estado (ver hallazgo viewer-pii-via-status-patch).
- [f3-whatsapp] El resumen del Portal Business no filtra PII porque no la devuelve: `getMyBusinessPortalSummary` solo expone totales, byStatus y topProducts (ordenaapp-hubs/src/controllers/hubOrders.controller.ts:156-172), y el agregado de orders para topProducts agrupa por product_id/nombre sin tocar campos del cliente (ordenaapp-orders/src/controllers/orders.controller.ts:3838-3849). El dashboard del hub (getMyHubDashboard) está además cerrado a BUSINESS_VIEWER en la ruta (ordenaapp-hubs/src/routes/hubOrders.routes.ts:15).
- [f3-whatsapp] Ningún fallo del bot rompe la creación del pedido: `sendNewOrderWhatsapp` tiene try/catch global (orders.controller.ts:288-347), `sendHubOrderWhatsapp` también (orders.controller.ts:358-377), `runHubUsageIncrement` también (orders.controller.ts:274-279) y `sendWhatsappSMS` nunca lanza — devuelve `{status:false}` (src/service/whatsapp.service.ts:41-48). En `releaseHeldOrders` el bloque de side effects va dentro de su propio try/catch por pedido (orders.controller.ts:3679-3685).
- [f3-whatsapp] La resolución del número por contexto es correcta: si `order.hub_id` existe se toma `config.deliveryWhatsapp` del hub, si no el `biz.delivery_options.delivery_person_whatsapp` del negocio (orders.controller.ts:4060-4065), y el mensaje de error 400 distingue los dos casos ("El hub no tiene configurado..." vs "Configura el WhatsApp del repartidor en Ajustes → Delivery propio", líneas 4072-4075). El campo existe en el modelo de business (ordenaapp-business/src/models/businessModel.ts:309) y `GET /business/:id` devuelve el documento completo, así que `bizResp?.data?.data ?? bizResp?.data` resuelve al objeto correcto (ordenaapp-business/src/controllers/business.controller.ts:97).
- [f3-whatsapp] Los endpoints internos del servicio de hubs son fail-closed de verdad: `isValidInternalCall` devuelve false cuando `INTERNAL_SHARED_SECRET` no está configurado, antes de comparar el header (ordenaapp-hubs/src/controllers/hubs.controller.ts:163-167), y tanto `getHubNotificationConfig` (línea 177) como `incrementHubOrderUsage` (línea 259) lo comprueban en la primera línea. Lo mismo del lado de orders en los tres `/internal/hub/*` (`if (!INTERNAL_HUBS_SECRET || secretHeader !== INTERNAL_HUBS_SECRET) return 403`).
- [f3-whatsapp] `notifyDeliveryForMyHubOrder` no permite cruzar hubs: llama a `assertBusinessBelongsToHub(ctx.hubId, businessId)` antes de proxear (ordenaapp-hubs/src/controllers/hubOrders.controller.ts:265), y orders vuelve a acotar la búsqueda por `{_id: orderId, bussiness_id: headerBusinessId}` (ordenaapp-orders/src/controllers/orders.controller.ts:4029-4033). El BUSINESS_VIEWER además está excluido de esa ruta en el router (ordenaapp-hubs/src/routes/hubOrders.routes.ts:33).
- [f3-whatsapp] El CAS `{ _id, delivery_notified_at: null }` sí cubre los pedidos anteriores a F3: en MongoDB `{campo: null}` empareja tanto el valor null como el campo ausente, así que los pedidos creados antes de que existiera el campo se pueden notificar una vez. Y el 409 de reintento devuelve `delivery_notified_at`/`delivery_notified_to` para que la UI se sincronice, cosa que los dos frontends aprovechan correctamente (pedidos/page.tsx:238-246 y [orderId]/index.tsx:801-805).
- [f3-whatsapp] La verificación de `hub_id` en createOrder es correcta y fail-closed: exige forma de ObjectId, consulta el negocio y solo etiqueta si `String(biz.hubId) === claimedHubId`; si la consulta falla, el pedido se crea SIN hub_id en vez de confiar en el body (ordenaapp-orders/src/controllers/orders.controller.ts:1760-1785). `hubId` existe como ObjectId en el modelo de business (ordenaapp-business/src/models/businessModel.ts:125), así que la comparación por String funciona.
- [f3-whatsapp] El bot sustituye vacíos por '—' antes de llamar a la Graph API (`PLACEHOLDER_EMPTY`, ordenaapp-whatsapp-bot/src/services/whatsapp.service.ts:47-55), aplicándolo a body, header y botón. Por eso los campos que la privacidad manda como '' en pedido_negocio_hub_es no rompen el envío, tal como promete §4 del contrato.
- [frontend-hub] i18n del hub: TODAS las claves usadas existen en es y en en. HubPortalShell.tsx:25-33,108,123 usa navigation.dashboard/orders/businesses/products/categories/users/payments/settings/signOut y HubUi.tsx:90-92,135,168 usa common.today/last7Days/last30Days/unlimited/loading/noResults — todas presentes en translations/hub-admin/es.ts:2-31 y en.ts:2-30 (ambos 82 lineas, misma estructura). El namespace `hubAdmin` esta registrado en translations/index.ts:26-27, 68 y 83. El storefront usa common.store.hub.* (backToHub, searchPlaceholder, allCategories, resultsTitle, featuredProducts, noProducts, businessesTitle, noBusinesses, paused, temporarilyClosed) y todas existen en common/es.ts:120-131 y common/en.ts:120-131. No encontre ninguna clave literal que se fuera a renderizar.
- [frontend-hub] Sin riesgo de hidratacion en hub-admin ni en hub-portal: todos los `new Date()` / `toLocaleString` de esos arboles (dashboard/page.tsx:196,229,352; pedidos/page.tsx:293; hubUi.ts:37,62; hub-portal/pedidos/page.tsx:76) se ejecutan sobre datos que llegan por useEffect, y en el primer render (servidor y cliente) esos datos son null. `lastUpdated` arranca en null en ambos lados (dashboard/page.tsx:164).
- [frontend-hub] Los shells no producen mismatch pese a leer localStorage en render: HubPortalShell.tsx:53 y BusinessPortalShell.tsx:35 evaluan `!ready || !hasHubToken()`, y `ready` es false en el primer render del cliente (HubAuthContext.tsx:52, se pone a true en useEffect), asi que servidor y cliente pintan exactamente el mismo spinner.
- [frontend-hub] getCurrentStoreState (negocios/[businessId]/page.tsx:88-125) usa `new Date()` en render, pero es inofensivo: cuando se evalua por primera vez `loading` es true y la pagina retorna el spinner (linea 335) antes de renderizar nada que dependa de el.
- [frontend-hub] El estado Abierto/Cerrado del storefront del hub NO tiene riesgo de hidratacion: getBusinessStatus (utils/businessHours.ts:198-250) calcula dia y hora con la timezone explicita del negocio (getCurrentDayInTimezone/getCurrentTimeInTimezone) y formatTime (linea 26-31) es puro, asi que SSR y cliente coinciden.
- [frontend-hub] hub-portal no monta I18nProvider (hub-portal/layout.tsx:8-13, a diferencia de hub-admin/(portal)/layout.tsx que si usa HubProviders) pero NINGUN componente bajo /hub-portal llama useTranslation — page.tsx, pedidos/page.tsx y BusinessPortalShell.tsx tienen los textos en duro. No revienta con el throw de useI18n.
- [frontend-hub] Cada funcion de hubApi.ts corresponde a una ruta real, con metodo y path exactos: login/register (hubUsers.routes.ts:14-15), GET/PUT /hubs/me (hubs.routes.ts:16-17), dashboard/portal-summary/orders/notify-delivery/orders/:id/status (hubOrders.routes.ts:15-41), payment-accounts GET/POST/DELETE (hubOrders.routes.ts:44-67), businesses list/create/detail/patch/logo/hours/operational-status (hubBusinesses.routes.ts:45-89), productos y hub-categories (hubProducts.routes.ts:47-78), categorias (hubCategories.routes.ts:12-15), hub-users (hubUsers.routes.ts:18-20). No encontre ni un path ni un verbo desalineado.
- [frontend-hub] Como se lee la respuesta coincide con lo que devuelve cada controller: `data.orders/total/totalPages` (orders.controller.ts:3829 del servicio de orders), `data.businesses` (hubBusinesses.controller.ts:122-127), `data.users` (hubUsers.controller.ts:287), `data.categories` y `data.category` (hubCategories.controller.ts:16,64,111), `data.business` + `data.businessHours` (hubBusinesses.controller.ts:186-201), `data.hub` (hubs.controller.ts:81), `data.user/hub/token` en login (hubUsers.controller.ts:181). El caso ambiguo de productos esta cubierto por partida doble en productos/page.tsx:72 (`Array.isArray(resp.data) ? resp.data : resp.data.products`).
- [frontend-hub] Fuga de datos del Portal Business cerrada por los dos caminos: el login proyecta el hub para BUSINESS_VIEWER (hubUsers.controller.ts:150-153) Y getMyHub tambien lo hace (hubs.controller.ts:63-68), que es el que dispara HubAuthContext.tsx:64 al montar. Sin esa segunda proyeccion el refresco silencioso habria vuelto a meter subscription/limits/deliveryWhatsapp en el localStorage del negocio.
- [frontend-hub] Los 7 metodos de pago que ofrece la UI del hub (pagos/page.tsx:18-26: bank-accounts, yape, nequi, daviplata, sinpe, tigomoney, paypal) estan todos en la whitelist HUB_PAYMENT_METHODS del backend (paymentsService.external.ts:9-24); ninguno provoca el 400 de validMethod.
- [frontend-hub] El anti-spoofing de pagos del hub funciona: resolveHubPaymentsKey (utils/hubPaymentsKey.ts:20-27) solo acepta el x-hub-id/cookie hubId si `business.hubId === claimed`, y ademas exige formato ObjectId. Se usa tanto en SSR (pagar/index.tsx:1421) como en el refetch cliente (pagar/index.tsx:541, donde el valor viene ya validado desde props). Un visitante no puede forzar que una tienda muestre las cuentas bancarias de otro hub.
- [frontend-hub] El bug de `businessHours` perdido al navegar al checkout esta efectivamente arreglado: StorefrontLayout.tsx:97-109 solo resetea el horario cuando cambia storeLink y, en la misma tienda, unicamente lo pisa si llega uno nuevo por SSR; ademas el fetch de respaldo (lineas 114-139) ahora se dispara tambien cuando falta el horario, no solo el theme.
- [frontend-hub] Orden de deteccion de subdominio correcto en el middleware: `.staging.ordena.app` se comprueba ANTES que `.ordena.app` (middleware.ts:99-105), asi que {slug}.staging.ordena.app no cae en el rechazo por 'sub con punto'; NON_HUB_SUBDOMAINS (lineas 88-93) cubre www/market/staging/login/api/admin/app mas los nombres de infra (cname, dns, mx, ns1, ns2, smtp, ftp, vercel, assets, img, cdn2); y turbomarketplace, market y los core hosts cortocircuitan antes de llegar a la rama de hub (lineas 242, 282, 294).
- [frontend-hub] Guardia anti-cruce de tiendas entre hubs presente y correcta: middleware.ts:363-368 solo deja pasar un store_link namespaceado si termina en `--{ultimos6DelHubId}` de ESTE hub; si no, redirige a '/' en vez de servir la tienda de otro operador con las cookies de este.
- [frontend-hub] CORS del gateway ya contempla el wildcard: isOrdenaSubdomainOrigin (api-gateway/src/app.ts:84-95) trata cualquier *.ordena.app como origen core (y *.localhost solo fuera de produccion), y /api/hubs + /api/hub-users estan declarados como policy 'public' (lineas 104-105) porque usan su propio JWT. El dashboard del hub funciona igual desde ordena.app que desde {slug}.ordena.app.
- [frontend-hub] El default de `allowSalesOutsideHours` en la UI (`businessHours.allowSalesOutsideHours !== false`, negocios/[businessId]/page.tsx:189) es consistente con el backend: los negocios HUB_MANAGED nacen con el flag en false (ordenaapp-business/src/controllers/business.controller.ts:3845) y el schema por defecto lo pone en true (models/businessSettings.ts:525). En ambos casos el toggle refleja el valor real.
- [frontend-hub] Payload de creacion de usuarios alineado: usuarios/page.tsx:118-124 y negocios/[businessId]/page.tsx:307-310 mandan `businessId` (no business_id) y el backend lo lee con ese nombre y valida pertenencia al hub antes de crear el BUSINESS_VIEWER (hubUsers.controller.ts:202, 224-234).
- [frontend-hub] Los estados de carga/error/vacio estan cubiertos en todas las pantallas del hub-admin, con reintento explicito: dashboard (skeletons + banner de datos obsoletos + Reintentar, lineas 388-413), pedidos (skeleton/error/empty, 488-533), pagos (194-216), negocios, categorias y el detalle de negocio (335-350). No encontre ninguna pantalla que se quede en blanco ante un fallo de red.
- [pagos] `resolveHubPaymentsKey` es correcto y NO permite servir metodos ajenos (C:/Users/iamic/Desktop/ordenaapp-frontend/src/utils/hubPaymentsKey.ts:20-27): valida forma de ObjectId y exige `String(business.hubId) === claimed`. Un negocio sin hubId -> null; un negocio del hub B con `x-hub-id` del hub A -> null. Aunque `x-hub-id` y la cookie `hubId` sean manipulables por el visitante, lo unico que puede lograr un atacante es que se sirvan los metodos del hub AL QUE EL NEGOCIO YA PERTENECE, que es el comportamiento correcto.
- [pagos] El payload que alimenta esa comparacion si trae `hubId`: `getBusinessByStoreName` devuelve el documento completo (`...business[0].toObject()`, ordenaapp-business/src/controllers/business.controller.ts:245-261) y `hubId` existe en el schema (ordenaapp-business/src/models/businessModel.ts:125). No hay proyeccion que lo recorte.
- [pagos] Las 14 paginas de detalle usan TODAS el helper, ninguna quedo con la key vieja (verificado con grep de `ACCOUNTS_BY_BUSINESS_ID(` en el directorio, cero llamadas con `business._id`): blik.tsx:305, daviplata.tsx:305, mercadopago.tsx:295, nequi.tsx:305, oxxo.tsx:305, paypal.tsx:433, revolut.tsx:318, sinpe.tsx:308, tigomoney.tsx:315, transferencia.tsx:477, wise.tsx:305, yape.tsx:315, yappy.tsx:299, zelle.tsx:305 — todas bajo C:/Users/iamic/Desktop/ordenaapp-frontend/src/pages/[storeName]/ordenes/[orderId]/pagar/. El index.tsx:1421 usa `resolveHubPaymentsKey` y canaliza los 14 GET por `loadCheckoutPaymentAccountsByKey` (index.tsx:200-271).
- [pagos] `omitBusinessHeader` no rompe el flujo SaaS/WL: `paymentMethodsSsrConfig` (routes.ts:1209-1224) con el flag en false produce exactamente `{headers:{'x-business-id': businessId}}`, identico al comportamiento previo, y el diff de las paginas confirma que la unica diferencia en SaaS/WL es pasar `undefined` en el parametro `cookies` que antes tampoco se pasaba (`git diff develop...HEAD` de transferencia.tsx y zelle.tsx).
- [pagos] El proxy de hubs no puede escribir en la cuenta de otro hub: los 4 handlers toman el hubId SOLO de `req.hubContext!.hubId` (JWT), nunca de params/body (ordenaapp-hubs/src/controllers/hubPayments.controller.ts:44,57,70,83), las rutas exigen `verifyHubJWT` + `requireHubRole('HUB_OWNER','HUB_ADMIN')` (ordenaapp-hubs/src/routes/hubOrders.routes.ts:42-67) y `validMethod` (hubPayments.controller.ts:14-25) valida contra el Set literal `HUB_PAYMENT_METHODS`, lo que ademas descarta path traversal en `:method`.
- [pagos] Los servicios de payments si scopean update/delete por owner+id (`Zelle.findOne({_id:id, businessId})` y `findOneAndDelete({_id:id, businessId})`, ordenaapp-payments/src/services/zelle.service.ts:57-100), asi que a traves del proxy de hubs un hub no puede tocar filas de otro aunque adivine un accountId.
- [pagos] Los GET no filtran secretos porque no hay secretos que filtrar: los 14 modelos de la whitelist guardan solo datos de exhibicion (paypal.model.ts:10 `paypal_link`, mercadopago.model.ts:8 `mercadopago_link`, zelle: email/titular, bankAccount.model.ts:18-49 numero de cuenta/banco/instrucciones). Las credenciales de pasarela viven en modelos fuera de la whitelist (globalpayTransaction, wompiConfig, stripeSubscription), inalcanzables desde el proxy del hub.
- [pagos] La validacion server-side de `hub_id` en la creacion de pedidos es solida y fail-closed (ordenaapp-orders/src/controllers/orders.controller.ts:1760-1786): descarta el valor del cliente por defecto (`data.hub_id = null`), exige forma de ObjectId, consulta business-service y solo lo acepta si `biz.hubId === claimed`; si la consulta falla, el pedido se crea SIN hub_id. Un cliente no puede inyectar pedidos en el panel de un hub ajeno. El checkout lo adjunta desde la cookie que deja el middleware, tambien con regex de ObjectId (frontend checkout/index.tsx:1815-1819).
- [pagos] El middleware del hub no sirve la tienda de otro hub bajo su host: si el segmento ya viene namespaceado y el sufijo no coincide con `hubId6`, redirige a `/` (frontend src/middleware.ts:363-368).
- [pagos] `resolveHubBySlug` filtra `status:'ACTIVE'` (ordenaapp-hubs/src/controllers/hubs.controller.ts:24), asi que un hub marcado SUSPENDED/INACTIVE deja de resolver el subdominio y su storefront cae entero (el hueco es que nadie escribe ese estado — ver hallazgo).
- [pagos] Detalle menor sin impacto: `omitBusinessHeader` no garantiza al 100% que no se mande `x-business-id` (el interceptor de axios lo re-inyecta desde cookie/localStorage si existe, axiosInstance.ts:121-128), pero es inofensivo: la ruta es publica en el gateway y el scope real sale del path (el hubId), no del header.
- [horarios] PARIDAD DE VALIDACIÓN front/back: correcta y exacta. `validateDayIntervals` en C:/Users/iamic/Desktop/ordenaapp-frontend/src/pages/admin/tiendas/[businessId]/ajustes/general/index.tsx:869-903 es un espejo línea por línea de `validateIntervals` en C:/Users/iamic/Desktop/ordenaapp-backend/ordenaapp-business/src/utils/timeHelpers.ts:10-46: misma regla `start === end` inválido (884 vs 18), mismo `overnightCount > 1` (889 vs 30-33), y el mismo truco de `effectivePrevEnd = isOvernight ? 24*60 : end` para forzar que el overnight sea el último del día (897 vs 41). No hay divergencia posible en qué horarios se aceptan.
- [horarios] ARITMÉTICA OVERNIGHT verificada caso por caso con Lun 19:00→04:00 en businessHours.ts:208-240. Lun 23:59 (cur=1439): `isTimeInInterval` línea 110-112 detecta end(240)<start(1140) y devuelve cur>=1140 → ABIERTO. Mar 00:00 (cur=0): el bloque de spill (211-220) mira el horario de AYER, `isOvernightInterval` true y 0 < 240 → ABIERTO. Mar 00:01 y 03:59 → ABIERTO. Mar 04:00 (240 < 240 = false) → el spill NO aplica y cae al horario de hoy → CERRADO. Mar 04:01 → CERRADO. Los dos lados usan fin exclusivo de forma consistente (línea 114 `cur < endMinutes`, línea 216 `cur < toMinutes(interval.end)`), así que no hay ni hueco ni solape de un minuto en la medianoche ni en el cierre.
- [horarios] DOBLE TURNO: ambos intervalos se evalúan. El bucle de businessHours.ts:236-240 recorre TODOS los intervalos del día, no solo el primero. Con Lun 08:00-13:00 + 19:00-04:00: 12:00 → abierto por el primero; 15:00 → cerrado con 'Abre 7:00 PM' (bucle 243-247); 20:00 → abierto por el segundo. El editor además impide añadir un intervalo después de uno overnight (`if (intervals.some((x) => isOvernightIt(x))) return prevList`, ajustes/general/index.tsx:4468), lo que refuerza la regla del backend desde la UI.
- [horarios] DEFAULT DE allowSalesOutsideHours: correcto en las 3 capas y a prueba de `undefined`. Modelo `businessSettings.ts:525  allowSalesOutsideHours: { type: Boolean, default: true }`; constructor de defaults `businessSettings.controller.ts:189  allowSalesOutsideHours: true`; y TODAS las lecturas usan `!== false`: businessHours.ts:265, ajustes/general/index.tsx:613 y :643, hub-admin page.tsx:189. Un documento legacy de SaaS sin el campo (undefined) se lee como `true` en todos los caminos, incluidos los que evitan los defaults de Mongoose — el `$project` del agregado de business.controller.ts:3946-3969 devuelve `businessHours` crudo y el front sigue leyendo `!== false`. Ningún SaaS antiguo cambia de comportamiento.
- [horarios] BUG DE DEFAULT_WEEK EN EL DASHBOARD CLÁSICO: CERRADO. `businessSettings` llega por `getServerSideProps` (ajustes/general/index.tsx:4656-4674), no por fetch async, así que `initialBusinessHours` (540-566) ya tiene los `weeklyHours` reales en el primer render y `DEFAULT_WEEK` solo actúa cuando el backend realmente no trae nada. El efecto de sincronización (618-652) fue escrito deliberadamente para NO tocar `weeklyHours` — solo mergea `specialHours` con comparación por JSON ordenado (647-650) y refresca los dos flags. El pisado ya no puede ocurrir por este camino. (El bug sí reaparece en el hub-admin: ver hallazgo hub-admin-default-week-overwrite.)
- [horarios] ZONA HORARIA USADA EN EL CÁLCULO: siempre la del NEGOCIO, nunca la del navegador ni la del servidor. `getCurrentDayInTimezone`/`getCurrentTimeInTimezone`/`getCurrentDateInTimezone` y sus variantes de ayer (businessHours.ts:34-145) pasan `businessHours.timezone` a `Intl.DateTimeFormat`. El único fallback al reloj local está en el `catch` de las líneas 65-66, que solo se alcanza con un identificador de timezone inválido. El cálculo del día anterior usa `Date.now() - 24h` formateado en la misma zona (118-129), que resiste los saltos de DST de ±1h.
- [horarios] El spill overnight respeta specialHours de AYER: `getScheduleForDate` (businessHours.ts:177-195) resuelve special-por-fecha con prioridad sobre weeklyHours y se usa tanto para hoy (223) como para el chequeo de ayer (213). Una excepción de ayer con horario nocturno propio se propaga correctamente a la madrugada de hoy.
- [horarios] El endpoint de días especiales valida con las MISMAS reglas: `upsertSpecialHours` llama `validateIntervals(intervals)` (businessSettings.controller.ts:1755) y rechaza intervalos en días marcados `isClosed` (1737-1744). No hay una puerta trasera para meter un overnight ilegal por specialHours.
- [horarios] El atajo de PATCH de solo-flag es seguro: `updateWeeklyHours` con `weeklyHours === undefined` y `allowSalesOutsideHours` booleano hace un `$set` puntual de `businessHours.allowSalesOutsideHours` sin tocar el horario (businessSettings.controller.ts:1543-1566). El toggle del dashboard (ajustes/general/index.tsx:3896-3911) lo usa así y hace rollback optimista del estado si el PATCH falla. No hay riesgo de borrar el horario al mover el switch.
- [horarios] No hay ruta que escriba el carrito saltándose el gate: `grep persistCartToLS|addOrUpdateCartItem` fuera de CartContext.tsx solo devuelve definiciones internas en src/utils/cartUtils.ts. Todas las mutaciones pasan por el provider, y el bloqueo se evalúa en el momento del click (no con estado stale) — `blockIfOutsideHours` llama `isSalesBlockedNow` en cada invocación (CartContext.tsx:128-129). Bajar cantidad o quitar items sigue permitido con la tienda cerrada, que es el comportamiento correcto.
- [horarios] El rewrite del hub no rompe la carga del horario: el middleware reescribe a `/{slug}--{hubId6}` (src/middleware.ts:363-377) y ese valor namespaceado ES el `store_link` real guardado en la colección `businesses`, así que `getBusinessSettingsByStoreLink` (businessSettings.controller.ts:1145) lo resuelve con un `findOne({ store_link })` directo. El horario del negocio de hub llega bien al storefront.
- [horarios] El home del hub reutiliza la util compartida en vez de duplicarla: `getBusinessStatus`/`hasConfiguredHours` importados en src/pages/hub/[hubSlug]/index.tsx:26-28 y usados en :176-178, alimentados por `getHubBusinessesPublic`, que trae `businessHours` con un `$lookup` a business_settings (business.controller.ts:3943-3968). El estado Abierto/Cerrado del listado del hub coincide con el del storefront individual.
- [horarios] La aritmética overnight de la copia del hub-admin es equivalente: `getCurrentStoreState` (app/hub-admin/(portal)/negocios/[businessId]/page.tsx:111-118) reproduce correctamente `openToday` (con el caso end<start) y `openFromPrevious` (spill del día anterior con `(dayIndex + 6) % 7`). El único desvío es que ignora specialHours (reportado aparte como low).
- [datos] NINGÚN índice único nuevo puede fallar al construirse sobre datos existentes — lo verifiqué uno por uno. (1) `hubs.slug` (hubModel.ts:87) y (2) `hub_users.email` (hubUserModel.ts:15) son `unique` sobre campos `required` en COLECCIONES NUEVAS y vacías. (3) `hub_categories.{hub_id, slug}` (hubCategoryModel.ts:22), ídem, ambos campos required. (4) El único unique nuevo sobre una colección con datos, `businesses.{hubId, hubSlug}`, está correctamente parcializado: `partialFilterExpression: { hubSlug: { $type: 'string' } }` (businessModel.ts:629-632) — ningún documento preexistente tiene `hubSlug`, así que el índice nace vacío y los millones de negocios SAAS/WL no chocan entre sí por múltiples `null`. `$type` es un operador soportado en partialFilterExpression desde MongoDB 3.2. Este era el escenario clásico de "revienta con el segundo documento vacío" y está bien resuelto.
- [datos] Los tres índices NO únicos nuevos son inofensivos y además utilizables por el planner: `orders.{hub_id, created_at:-1}` con `partialFilterExpression: { hub_id: { $type: 'string' } }` (orderModel.ts:531-535) — las consultas del hub filtran con igualdad sobre un string (`filter.hub_id = hubId` en orders.controller.ts:3796 y :3863), que el optimizador reconoce como subconjunto del `$type: 'string'`, así que el índice SÍ se usa y no engorda con las órdenes de tiendas normales (`hub_id: null` queda fuera). `businesses.{hubId, created_at:-1}` (businessModel.ts:634) y `products.hubCategoryIds` (productModel.ts:138) son índices simples sin unicidad.
- [datos] `autoIndex` está en su default (true) en los cuatro servicios que declaran índices nuevos: `ordenaapp-hubs/src/config/database.ts:7`, `ordenaapp-business/src/database.ts:7`, `ordenaapp-orders/src/database.ts:7`, `ordenaapp-products-and-categories/src/database.ts:7` — todos llaman `connect(DB_LINK)` sin opciones, y `grep -rn 'autoIndex'` no devuelve ninguna desactivación. La afirmación del doc de deploy ("Los índices nuevos se crean solos al boot") es correcta.
- [datos] La afirmación **"Sin migraciones de datos" del doc (`ordenaapp-hubs/docs/DEPLOY_STAGING_MVP.md`, §1) es CORRECTA en su conclusión**, aunque su justificación está mal redactada. No hay ningún script de backfill necesario ni antes ni después del deploy. La redacción imprecisa: `hubId` NO tiene default (businessModel.ts:126 es sólo `{ type: Types.ObjectId, ref: 'hubs' }`, el campo queda ausente, no `null`), y el `default: true` de `allowSalesOutsideHours` no reescribe los documentos `business_settings` YA guardados. Da igual, porque todas las lecturas están escritas a prueba de `undefined` (ver los dos puntos siguientes).
- [datos] Enumeración completa de los campos nuevos y su comportamiento en documentos VIEJOS — todos correctos: `businessSettings.businessHours.allowSalesOutsideHours` se lee SIEMPRE con `!== false` (utils/businessHours.ts:265, ajustes/general/index.tsx:613 y :643, hub-admin/negocios/[businessId]/page.tsx:189), así que `undefined` = permitir vender, que es el comportamiento legacy. `businesses.operationalStatus` se lee siempre con `|| 'active'` o con `=== 'paused'`/`=== 'temporarily_closed'` (hubBusinesses.controller.ts:200, hubOrders.controller.ts:234-236, product.controller.ts:2608, hub-admin/negocios/page.tsx:170/261/294/489/545, pages/hub/[hubSlug]/index.tsx:170-173) — `undefined` = activo. `orders.hub_id` sólo se usa como `typeof order?.hub_id === 'string'` (orders.controller.ts:273, :356) o como filtro de igualdad. `products.hubCategoryIds` ausente = array vacío, no matchea ninguna búsqueda de categoría de hub. `businesses.delivery_options.delivery_person_whatsapp` es `default: null` y se comprueba por truthiness. No encontré ni un solo `=== true`/`!== undefined` sobre un campo nuevo que rompa con datos preexistentes.
- [datos] `hub.businessVisibility` (hubModel.ts:123-127) se lee con la polaridad fail-safe correcta en los dos consumidores: `customerName !== false` / `customerPhone === true` / `customerAddress === true` (hubOrders.controller.ts:83-85 y orders.controller.ts:316-318). Un hub creado durante F1/F2, antes de que el campo existiera, muestra el nombre y oculta teléfono y dirección — que es el default conservador correcto, no una fuga.
- [datos] El PATCH del hub aplica los objetos anidados por DOT-PATH (`hubs.controller.ts:115-126`: `patch[`${field}.${key}`] = inner` para `branding`, `contact` y `businessVisibility`), así que mandar `{ businessVisibility: { customerPhone: true } }` NO borra `customerAddress` ni `customerName`, y mandar `contact` con dos claves no se lleva por delante `deliveryWhatsapp`. Es el arreglo correcto del bug de `$set` de objeto entero que el propio comentario documenta.
- [datos] El conteo de pedidos del hub NO se duplica entre los tres caminos de creación. Cada uno está protegido por un CAS y sólo el ganador ejecuta los side effects: creación normal corre `runOrderCreationSideEffects` una vez y sólo si `!isDraftRequest` (orders.controller.ts:1817-1819); la conversión de draft a efectivo usa `findOneAndUpdate({ _id, is_draft: true, 'draft.status': 'awaiting_payment' })` y sólo llama a los side effects si el CAS devolvió documento (:1180-1195); la promoción por pago aprobado usa el mismo patrón con el flag `promotedDraft` (:3070-3115); y `releaseHeldOrders` hace `updateOne({ _id, held_by_limit: true }, ...)` y sigue con `if (claim.modifiedCount !== 1) continue` antes de incrementar (:3672-3681). Además `runOrderCreationSideEffects` retorna temprano cuando `held_by_limit === true` (:398-403), así que un pedido retenido se cuenta al liberarse y no dos veces.
- [datos] Los tipos de `hubId` son consistentes entre servicios: ObjectId donde el campo es ObjectId (`businesses.hubId` — product.controller.ts:2484 hace `new mongoose.Types.ObjectId(hubId)` al leer la colección compartida; business.controller.ts:3899 y :3936 igual) y String donde el campo es String (`orders.hub_id` — orders.controller.ts:3796, :3863, :3976). No hay ninguna consulta cruzada con el tipo equivocado, que habría devuelto cero resultados en silencio.
- [datos] El email sintetizado `hub-{hubId6}-{hubSlug}@hubs.ordena.app` (business.controller.ts:3782-3789) respeta el `unique` de `businesses.email`: hay un bucle de desambiguación que consulta `businessModel.exists({ email })` y sufija `-2`, `-3`… hasta 50. El dominio `hubs.ordena.app` no es un dominio de correo registrable, así que la colisión con el email real de un cliente CORE es despreciable. Lo único que queda expuesto es la carrera TOCTOU (dos creaciones simultáneas del mismo nombre → E11000 → 500), que el propio doc de deploy ya lista como conocida y que se resuelve reintentando.
- [datos] El `hubSlug` no se puede renombrar después de creado, así que el `store_link` namespaceado nunca queda desalineado con él por edición: `patchBusinessInternal` sólo acepta `name`, `description`, `phone`, `address`, `status`, `operationalStatus`, `whiteLabelMeta` y `usageMetrics` (business.controller.ts:2866-2905), y en ordenaapp-hubs `grep -rn 'hubSlug' src/` sólo devuelve dos lecturas de proyección (hubBusinesses.controller.ts:193, hubOrders.controller.ts:167). Ninguna ruta escribe `hubSlug` fuera de la creación.
- [datos] El relajamiento de `validateIntervals` para horarios overnight (business/src/utils/timeHelpers.ts:15-42) es aditivo y no invalida datos existentes: sólo pasó a rechazar `start === end` (antes rechazaba todo `start >= end`), limita a un intervalo overnight por día y exige que sea el último. Ningún horario ya guardado deja de validar.
- [datos] Los pagos del hub no introducen colección ni índice nuevo: el diff de `ordenaapp-payments` es sólo `lib/businessPlan.ts` (+`isHubKey`, que hace un `findOne` por `_id` en la colección `hubs`) y `middlewares/planGate.ts` (fallback cuando la key no es un business). Los métodos se guardan bajo el hubId en la misma estructura que un businessId; al ser ObjectIds de colecciones distintas no hay riesgo de colisión de claves.
- [deploy] dist/ SINCRONIZADO en los 6 repos backend. Compile cada repo con `npx tsc -p tsconfig.json --outDir <temp>` (sin tocar el dist del repo) y compare con `diff -rq`: 0 diferencias de contenido en ordenaapp-business, ordenaapp-orders, ordenaapp-products-and-categories, ordenaapp-payments, ordenaapp-api-gateway y ordenaapp-hubs. El unico extra es C:/Users/iamic/Desktop/ordenaapp-backend/ordenaapp-orders/dist/scripts/migrateOrdersAddProductDetails.js, un artefacto viejo sin impacto. El deploy que usa dist/ va a correr exactamente el src de la rama.
- [deploy] `npx tsc --noEmit` limpio en ordenaapp-hubs (tsconfig strict:true).
- [deploy] ordenaapp-hubs/package-lock.json (lockfileVersion 3) coincide 1:1 con package.json — las 13 dependencies y 5 devDependencies estan en el lock y el bloque root.dependencies es identico. `npm ci` no va a fallar por lock desincronizado.
- [deploy] Todos los imports externos de ordenaapp-hubs/src estan declarados: axios, bcrypt, dotenv, express, jsonwebtoken, mongoose, morgan, multer (+ `buffer`, builtin, en businessService.external.ts:126). `cors` y `mongodb` estan declarados y sin usar — inofensivo. Ninguna dependencia sin declarar.
- [deploy] ordenaapp-hubs NO necesita CORS propio ni /health: el dashboard del hub llama siempre via gateway (frontend/src/app/hub-admin/_lib/hubApi.ts:13 usa baseURL = GENERAL_API_URL), y ordenaapp-agencies — el patron que el doc dice replicar — tampoco tiene cors ni healthcheck ni engines. Nada hardcodeado a localhost fuera de los defaults de config.ts:5-12.
- [deploy] La matematica de paths del proxy del gateway es correcta: `app.use('/api/hubs', buildProxy(`${HUBS_SERVICE_URL}/hubs`))` con HUBS_SERVICE_URL=http://host:3013/api produce /api/hubs/resolve en el destino, que es exactamente lo que monta ordenaapp-hubs/src/app.ts:24-28. Idem /api/hub-users. (api-gateway/src/app.ts:564-565)
- [deploy] El gateway no monta ningun body parser (no hay express.json/urlencoded en api-gateway/src/app.ts), asi que los POST/PATCH JSON y los multipart del hub se streamean intactos al ms hubs. No hace falta fixRequestBody.
- [deploy] El contrato del resolve del hub calza con el middleware: hubs.controller.ts:40-45 devuelve `{ data: { hub, categories } }` y frontend/src/middleware.ts:293 lee `hubResp?.data?.hub` + `hub._id`. El `.select(...)` de la linea 25 conserva _id y slug. Sin shadowing de rutas: ningun router montado antes de hubsRoutes declara un `/:param` a nivel raiz.
- [deploy] GENERAL_API_URL llega al Edge Runtime del middleware: esta inlineada en frontend/next.config.mjs:24-26 (`env: { GENERAL_API_URL: ... }`). El doc lo afirmaba y es correcto.
- [deploy] Inventario de envs contrastado con el doc — sin envs documentadas que ya no existan (b) y sin faltantes salvo NODE_ENV del gateway (ver hallazgo). Lo que el codigo nuevo lee, en total: hubs = PORT, DB_LINK, JWT_SECRET, BUSINESS/ORDERS/PRODUCTS/PAYMENTS_SERVICE_LINK, INTERNAL_HUBS_SECRET|INTERNAL_SHARED_SECRET (config/config.ts:5-19, las 8 documentadas); orders = HUBS_SERVICE_LINK, INTERNAL_HUBS_SECRET, TEMPLATE_DELIVERY_ES, TEMPLATE_HUB_ORDER_ES, TEMPLATE_BUSINESS_HUB_ES (src/config.ts, las 5 documentadas); business = INTERNAL_HUBS_SECRET (src/config.ts:34, documentada); products = INTERNAL_HUBS_SECRET (product.controller.ts:2467, documentada); payments = ninguna nueva (el doc lo dice y es cierto); frontend = ninguna nueva.
- [deploy] El secreto interno es fail-closed de verdad en los 4 receptores, como afirma el doc: business/src/utils/internalHubGuard.ts:10, business/src/controllers/business.controller.ts:3698, products/src/controllers/product.controller.ts:2470-2473, orders/src/controllers/orders.controller.ts:4026 y las variantes de summary/status. Solo hubs avisa por consola al arrancar sin la env (config/config.ts:21); business/orders/products fallan mudos con 403 — vale la pena saberlo al diagnosticar. Ojo: el comentario de business/src/config.ts:30-33 sigue diciendo "se acepta sin header" (comentario stale, el codigo NO lo hace).
- [deploy] payments lee la MISMA shared DB: isHubKey (lib/businessPlan.ts:47-58) usa `mongoose.connection.db.collection('hubs')`, la misma conexion que ya usaba getBusinessPlanData para la coleccion `businesses`. No hace falta env nueva en payments — el doc acierta.
- [deploy] El banner de fuera-de-horario y el bloqueo del carrito son INVISIBLES para todo negocio existente: isSalesBlockedNow (frontend/src/utils/businessHours.ts:265) retorna false salvo que allowSalesOutsideHours === false, y ese campo es nuevo con default true (business/src/models/businessSettings.ts:525). Por eso el cambio de OutOfHoursBanner a `fixed bottom-0 z-[60]` cuando no hay slot no puede tapar contenido en tiendas SAAS/WL actuales.
- [deploy] El cambio `useTranslation()` -> `useTranslation('common')` en CartContext.tsx:124 y OutOfHoursBanner.tsx:30 es un ARREGLO, no una regresion: el diccionario esta namespaceado por seccion (lib/i18n/translations/index.ts:55) y las claves viven en common.store.hours.* (common/es.ts:136). Antes `t('store.hours.salesBlockedTitle')` no resolvia y devolvia la clave cruda.
- [deploy] El fetch fallback de StorefrontLayout.tsx:114-138 no entra en bucle infinito pese a depender de resolvedHours: GET /api/business/business-settings-store/:store_link devuelve el doc entero y businessHours siempre viene poblado porque todos sus subpaths tienen default en el schema (business/src/models/businessSettings.ts:506-526), asi que setResolvedHours corta la recursion en el segundo render. Si la respuesta es 404 el catch no toca estado y tampoco hay bucle.
- [deploy] Hacer publicos en el gateway los 12 metodos de pago manuales (api-gateway/src/app.ts:116) NO amplia la exposicion real de negocios existentes: bajo la politica anterior (business_required) esas GET ya eran alcanzables sin token con solo mandar x-business-id, porque el chequeo de email solo corre `if (request.userEmail && ...)` (app.ts:~440). Es el mismo precedente que bank-accounts y paypal, ya publicos.
- [deploy] ordenaapp-whatsapp-bot no necesita cambios de codigo, como dice el doc: ya soporta dedupeKey (controllers/notifications.controller.ts:24,67) y ya sustituye los parametros vacios por '—' antes de mandarlos a Meta (services/whatsapp.service.ts:46-53, toValidText), que es justo lo que asume la plantilla de privacidad de orders (orders.controller.ts:326-336 manda '' para los campos ocultos). Su src esta identico a develop; el unico cambio de la rama es PLANTILLAS_REPARTIDOR_Y_HUB.md.
- [deploy] La nota 16 del smoke test del doc es exacta: sendNewOrderWhatsapp esta envuelto en `if (STAGE === 'production')` preexistente (orders/src/controllers/orders.controller.ts:289), mientras que sendHubOrderWhatsapp (linea 351) y notifyDeliveryPerson (linea 4020) no lo estan y SI van a mandar WhatsApp reales desde staging.
- [deploy] resolvePlanFeaturesForBusiness no altera SAAS ni WHITE_LABEL: solo se agrega la rama `if (context === 'HUB_MANAGED')` (business/src/utils/resolvePlanFeaturesForBusiness.ts:61) y se ensanchan uniones de tipos. Los enums del modelo (context, subscription.source, planRef.kind, payer.kind) solo suman valores, nunca quitan, asi que ningun documento existente deja de validar.
- [deploy] Los indices nuevos son aditivos y no bloqueantes: orders {hub_id:1, created_at:-1} es parcial sobre `hub_id: {$type:'string'}` (orders/src/models/orderModel.ts:531), businesses {hubId,hubSlug} es unico pero parcial sobre hubSlug string (business/src/models/businessModel.ts:628) — ningun documento actual tiene esos campos, asi que no puede fallar por duplicados —, y products {hubCategoryIds:1} es un multikey vacio en tiendas normales.
- [deploy] El middleware de hubs no captura hosts existentes: getHubCandidateSlug (frontend/src/middleware.ts:94) excluye www/market/staging/login/api/admin/app y la infraestructura (cname, dns, mx, ns1/2, smtp, ftp, vercel...), evalua `.staging.ordena.app` antes que `.ordena.app`, rechaza cualquier sub con punto, y el apex ordena.app no termina en `.ordena.app`. market.ordena.app y login.turbomarketplace.com se resuelven en bloques anteriores. El matcher (linea final) excluye _next/, api/, assets/ y todo path con punto.
- [deploy] updateProduct ahora filtra por x-business-id (products/src/controllers/product.controller.ts:1319) con fallback a findById cuando el header no viene, asi que ningun llamador interno existente sin header se rompe; y el dashboard siempre manda el header del negocio dueno.

