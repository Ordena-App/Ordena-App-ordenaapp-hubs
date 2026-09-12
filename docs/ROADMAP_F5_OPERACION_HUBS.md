# Roadmap F5 — Operación real de Hubs (piloto Oe Ya Courier y venta a otros hubs)

**Estado:** borrador v1 para aprobación · **Fecha:** 2026-09-09 · **Rama:** `feature/new-mode-ordena-hub`

Origen: reunión con Noe (Oe Ya Courier) del 2026-09-08. Decisión: arrancan con lo que hay; cargan negocios, productos y configuración real; reportan mejoras desde el uso; lo nuevo se desarrolla en paralelo sin bloquear el piloto.

Principio de todo el roadmap: **nada se construye "para Oe Ya"**. Cada pieza se diseña como capacidad del producto Hub para venderla a cualquier courier o red de negocios similar. SaaS y White Label no cambian salvo que se indique.

---

## 0. Estado verificado en el código (para no repetir trabajo)

| Tema | Hoy | Consecuencia |
|---|---|---|
| Distancia real | Hecho: ruta por calles (OpenRouteService → OSRM público → recta×1.3), caché 7 días, cotización autoritativa en orders con 409, pin exacto guardado en el pedido y visible en las 3 vistas. Costo $0. | Solo falta que cada negocio tenga su pin (onboarding). |
| Favicon | El storefront público del hub solo pone ícono si existe `hub.favicon`; Ajustes no permite subirlo. El hub-admin ya usa el logo como fallback. | Fix chico. |
| ID de pedido | Hub-admin muestra los últimos 6 caracteres del `_id`; el dashboard del negocio muestra `orderNumber`. | Inconsistencia de presentación, no de datos. |
| Crear hub | Pestaña "Crear mi hub" en `/hub-admin/login` y endpoint público de registro. | Cerrar UI y endpoint. |
| Liquidaciones | Período fijo `YYYY-MM`, rango por mes calendario en la TZ del hub, índice único hub+negocio+período, "pagadas no se recalculan". | El modelo aguanta otras frecuencias cambiando la clave de período. |
| Privacidad | Matriz `businessVisibility` (nombre/teléfono/dirección) aplica a lo que ve el **negocio** y a su WhatsApp. El repartidor recibe hoy un WhatsApp con plantilla de Meta. | Con la bolsa de repartidores el hub deja de usar esa plantilla. |
| Portal del negocio | Rol `BUSINESS_VIEWER` de solo lectura (pedidos, estado de cuenta). Productos solo desde el hub-admin. | Falta el rol/permiso y las pantallas. |
| Categorías | Categorías del hub (directorio). Las categorías por negocio existen en SaaS. | Es más UI y permisos que modelo. |
| Ticket térmico | No existe. El ticket web lleva nombre, logo y teléfono del negocio. | Construir desde cero, chico. |
| Roles hub-admin | HUB_STAFF ya sin informes, usuarios, pagos, liquidaciones, plan, ni identidad/marca/contacto/dominio/contraseña. | Listo esta semana. |

---

## 1. Sprint 0 — esta semana (arranca al aprobar este documento)

Chicos, visibles y sin riesgo. Se hacen los tres juntos y salen en un solo deploy de frontend + hubs.

### 1.1 Favicon del hub
- Storefront público del hub (`/hub/[slug]` y páginas de negocios dentro del hub): ícono = `hub.favicon || hub.logo`, pisando el ícono por defecto de Ordena (misma `key` del `<link>`).
- Hub-admin y portal del negocio: ya lo hacen; se revisa que no vuelva el de Ordena al navegar entre páginas.
- Título de pestaña con el nombre del hub en el storefront.
- No se agrega subida de favicon todavía: el logo cuadrado funciona bien como ícono. Si un hub quiere uno distinto, se agrega el campo en Ajustes → Marca más adelante.

**Aceptación:** abrir `michael-hub.staging.ordena.app`, el hub-admin y el portal del negocio: pestaña con logo y nombre del hub en los tres.

### 1.2 ID del pedido consistente
- Regla única en hub-admin, portal del negocio, dashboard SaaS del negocio hub y ticket: **número visible = `orderNumber`** (ej. `#1042`); si un pedido viejo no lo tiene, últimos 8 caracteres del `_id`.
- En el detalle (drawer del hub, detalle del negocio, ticket) se muestra además el **ID completo** con botón "Copiar".
- Búsqueda por número o por ID completo en el listado del hub-admin.

**Aceptación:** el mismo pedido se identifica igual en las tres vistas y el ID completo es copiable.

### 1.3 Cerrar la creación pública de hubs
- Quitar la pestaña "Crear mi hub" del login.
- Backend: el endpoint de registro queda apagado por variable de entorno (`HUB_SELF_SERVE_SIGNUP=false` por defecto) y responde 403. Ordena crea hubs con el script/flujo interno actual tras lead → reunión → propuesta → acuerdo.
- El landing de hubs conserva el formulario de lead.

**Aceptación:** `/hub-admin/login` solo permite iniciar sesión; `POST /api/hub-users/register` responde 403 en staging y prod.

### 1.4 Onboarding de Oe Ya (operativo, sin código)
- Crear usuario dueño (ya hecho) y usuarios admin/staff según su equipo.
- Ajustes → Métodos de entrega: "Por distancia" con su tarifa base, km incluidos, precio por km y radio.
- Por cada negocio: fijar el pin en Negocios → negocio → Información. Sin pin, ese negocio cobra solo la tarifa base.
- Ajustes → Qué ve cada negocio: decidir si los negocios ven teléfono y dirección del cliente.

---

## 2. Sprint 1 — semanas 2 y 3

### 2.1 Liquidaciones configurables (para cualquier hub) — ✅ hecho 2026-09-09
Alcance:
- Frecuencia por hub en Ajustes → Liquidaciones: **diaria, semanal, quincenal, mensual**. Día de inicio de semana configurable (lunes por defecto) y quincena = días 1–15 y 16–fin de mes.
- Clave de período por frecuencia (`2026-09-09`, `2026-W37`, `2026-09-Q1`, `2026-09`). El índice único y la regla "pagadas no se recalculan" se conservan tal cual.
- Selector de período en Liquidaciones según la frecuencia; "Calcular" genera solo el período elegido; total del período y marcado de pago igual que hoy.
- Estado de cuenta del negocio en su portal con la misma frecuencia.
- Cambio de frecuencia no rompe lo ya generado: los períodos viejos quedan con su clave; los nuevos usan la nueva.
- Exportar CSV del período (pedido, negocio, bruto, comisión, neto) para conciliar con el banco.

Decisiones que necesito: día de inicio de semana por defecto y si la quincena es 1–15/16–fin o cada 14 días.

**Tamaño:** 3 días.

### 2.2 Ticket térmico 58 mm y 80 mm — ✅ hecho 2026-09-09 (pendiente prueba en impresora real)
- Ruta de impresión del pedido con dos anchos, tipografía monoespaciada y CSS de página para que el navegador imprima directo a la térmica.
- Contenido: nombre y logo del hub, **datos completos del negocio** (nombre, teléfono, dirección), número visible e ID completo, fecha/hora, cliente (respetando la matriz de visibilidad del hub), ítems con variantes y notas, subtotal, envío (con km si es por distancia), descuento, total, método de pago, dirección de entrega, referencia y **QR** al pedido para que el repartidor abra el pin.
- Botón "Imprimir ticket" en el drawer del hub-admin, en el detalle del negocio (dashboard y portal) y en el ticket web público.
- Se prueba en una impresora de 58 y una de 80 antes de darlo por cerrado (pedir a Oe Ya el modelo).

**Tamaño:** 2 días.

### 2.3 Catálogo autogestionado por el negocio (portal del negocio) — ✅ hecho 2026-09-10 (fases A y B)
Alcance completo, como pidió Noe:
- Nuevo permiso por usuario de negocio: **"gestiona su catálogo"**, que el hub concede o quita desde Usuarios. El `BUSINESS_VIEWER` actual sigue existiendo sin permiso (solo lectura).
- Portal del negocio → Productos: crear, editar, imágenes, precio, variantes básicas, **disponibilidad** con un toggle, borrar (lógico).
- Portal del negocio → Categorías: categorías propias del negocio para ordenar su tienda; las categorías del hub siguen mandando en el directorio del hub.
- El hub-admin conserva todo lo que tiene hoy y ve quién hizo cada cambio (auditoría mínima: usuario y fecha en el producto).
- Reutiliza los formularios del hub-admin y los mismos endpoints de hubs, con el candado de "solo tu negocio" que ya existe para el viewer.
- Fase A (primero): disponibilidad, precio y edición básica. Fase B: alta con imágenes, variantes y categorías propias.

**Tamaño:** 5 a 6 días (A: 2, B: 3–4).

---

## 3. Sprint 2 — semanas 4 a 6: Bolsa de pedidos para repartidores

Es el cambio que más ordena la operación y el que resuelve la privacidad hacia el motorizado sin plantillas de WhatsApp.

Flujo objetivo: `pedido listo → Publicar para repartidores → los repartidores disponibles lo ven → uno lo toma → queda asignado → recogido → entregado`.

Alcance del MVP:
- Rol **`DELIVERY_DRIVER`** en usuarios del hub (alta desde Usuarios; acceso con email o teléfono + contraseña).
- App web móvil para repartidores en `/hub-driver`: pedidos publicados del hub, botón **"Tomar pedido"**, mis pedidos, cambio de estado (recogido, entregado, incidencia), historial propio.
- Asignación **atómica**: dos repartidores no pueden tomar el mismo (actualización condicional en base de datos; el segundo ve "ya lo tomó otro").
- Registro de quién lo tomó y a qué hora, más marcas de tiempo por estado (base de los informes futuros).
- Hub-admin: el botón "Notificar a repartidor" pasa a **"Publicar para repartidores"**; el drawer muestra estado de la asignación, repartidor y tiempos; el hub puede reasignar o despublicar.
- **Privacidad:** matriz "qué ve el repartidor" en Ajustes: dirección, referencia y pin siempre; nombre y teléfono del cliente configurables, **teléfono apagado por defecto**. El repartidor navega al pin exacto sin llamar. Sin WhatsApp al repartidor en hubs → se ahorra la plantilla. SaaS y White Label siguen con su aviso por WhatsApp como hoy.
- Aviso a repartidores: en la app (lista en vivo con refresco) y, si hace falta, un WhatsApp sin plantilla solo dentro de la ventana de 24 h; notificaciones push quedan para después.
- Envíos A→B y encargos, cuando existan, entran a esta misma bolsa.

**Tamaño:** 2 a 3 semanas. Decisiones que necesito: acceso del repartidor (teléfono+PIN o email+contraseña) y si el hub puede fijar un repartidor a mano además de la bolsa (propongo que sí).

---

## 4. Sprint 3 — Envío punto A a punto B

Después de la bolsa. Reutiliza el motor de distancia, el pin y la asignación.
- Nuevo tipo de pedido **sin negocio** (`courier`): recogida, entrega, contacto en origen y destino, instrucciones, descripción del paquete.
- Tarifa por km **a nivel hub** (misma fórmula base + km incluidos + precio por km + radio) independiente de la de los negocios.
- Página pública en el storefront del hub para solicitarlo y cotizar al instante; pago en efectivo al inicio.
- Sin comisión (no hay compra); aparece en la bolsa; entra a informes y a liquidaciones como ingreso del hub.

**Tamaño:** 2 semanas.

## 5. Sprint 4 — Solicitud de compra (encargos)

Al final, por lo difuso del monto: el cliente describe qué comprar y dónde, se cotiza solo el envío y la tarifa de servicio, el repartidor registra el monto real de la compra al entregar (con foto del recibo) y el total se ajusta. Requiere el flujo de ajuste de total, que no existe hoy.

**Tamaño:** 2 a 3 semanas.

## 6. Informes

Se construyen cuando haya 3 a 4 semanas de datos reales del piloto. Desde ya se guardan los datos que los harán posibles: km por pedido (ya), repartidor asignado y tiempos por estado (bolsa), tipo de pedido (A→B, encargo).

---

## 7. Planes y precio (decidido el 2026-09-09)

Principio: **todos los planes incluyen todas las funciones**. Lo que cambia es cuánto pueden procesar. Dos niveles autoservicio y un Empresarial que se cotiza en reunión.

| | Hub | Hub Pro | Empresarial |
|---|---|---|---|
| Precio mensual | **$249** | **$399** | desde $699, a medida |
| Precio anual (1.5 meses gratis) | **$2,600** | **$4,190** | negociado |
| Negocios incluidos | 20 | 50 | 100 o más |
| Productos | 100 por negocio | 300 por negocio | sin límite |
| Pedidos al mes | 1,800 | 5,000 | 15,000 o más |
| Negocio extra sin upgrade | $5/mes | $5/mes | negociado |
| Pedido extra sin upgrade | $0.10 | $0.08 | negociado |
| Paquete +100 productos para un negocio | $5/mes | $5/mes | no aplica |
| Funciones | todas | todas | todas + onboarding asistido, soporte dedicado, factura a medida |

Por qué así:
- **$249 / $399:** con todo incluido, el escalón tiene que estar en capacidad. El salto de $150 hace que el upgrade convenga justo cuando toca: quedarse en Hub y pagar 30 negocios extra cuesta lo mismo que el Pro, pero con 1,800 pedidos en vez de 5,000. Cada negocio le sale al hub $12.45, menos que un solo Básico de SaaS ($12.99).
- **Negocio extra a $5** en ambos, por debajo del costo dentro del plan a propósito: cada negocio trae pedidos y los pedidos son lo que escala la cuenta.
- **Pedido extra** un poco por encima del costo dentro del plan; cubre los WhatsApp reales de cada pedido.
- **Productos por negocio** y no un total del hub: un negocio grande no se come el cupo de los demás.
- **Anual** con 1.5 meses gratis (12.5%): suficiente para cobrar por adelantado sin regalar de más.

**Oe Ya (fundadores del piloto):**
1. Meses 1 a 3: gracia sin costo, mientras salen Sprint 0, liquidaciones, tickets, catálogo autogestionado y bolsa.
2. Meses 4 a 15: **precio fundador $149** (Plan Piloto existente, 40% bajo lista) con los límites del Hub; si necesitan límites de Pro, $100 de descuento sobre $399.
3. Después: recomendado mantener el precio fundador mientras la suscripción siga activa (cliente de referencia); alternativa: lista con 60 días de aviso.
4. Acuerdo piloto de una página: cadencia de feedback, logo y caso de éxito, precio fundador atado al plan Hub.

**Qué implica en el producto (Sprint 1):** límite de productos por negocio y paquete extra en el modelo de planes de hub, uso contra límites en la página Plan, bloqueo al crear productos al llegar al tope con aviso de paquete o upgrade, y los dos planes nuevos en Stripe (lookup keys mensual y anual). Los excedentes de negocios y pedidos ya se cobran con el sistema actual. Un día de trabajo.

---

## 8. Cronograma resumido (actualizado 2026-09-11 tras la 2.ª reunión con Oe Ya, ver §11)

| Semana | Entregable | Estado |
|---|---|---|
| 1 | Favicon, ID de pedido, cierre de "Crear hub", onboarding Oe Ya. | ✅ |
| 2–3 | Liquidaciones configurables; ticket térmico; catálogo autogestionado A y B. | ✅ |
| 4 | **Sprint 1.5 — arreglos de la 2.ª reunión:** carrito vacío en el checkout del hub, efectivo contra entrega en la pantalla de pago, opciones a $0 sin "0" pegado y precio extra desde $0.01, tiempo estimado por negocio (dato). | siguiente |
| 5–7 | **Sprint 2 — Flujo del pedido y bolsa de repartidores:** confirmación del hub (configurable), estados del negocio y de entrega, bolsa con "Tomar pedido", asignación manual, app móvil del repartidor, privacidad hacia el motorizado. | |
| 8 | **Sprint 3 — Pagos manuales con comprobante:** el cliente adjunta el comprobante y "Confirma pago"; destinatario del aviso configurable (hub o negocio); métodos de pago a nivel hub propagados. Aplica también a SaaS y WL. | |
| 9 | **Sprint 4 — Avisos al cliente por WhatsApp:** plantilla de pedido confirmado con tiempo estimado por negocio (pedir a Meta desde ya). | |
| 10–11 | **Sprint 5 — Liquidación de repartidores:** comisión global o por repartidor, cobros que retiene (efectivo/Yape), bonos y ajustes, cortes diario/semanal/quincenal/mensual, dashboard del repartidor. | |
| 12–13 | Envío A→B (entra a la bolsa). | |
| 14–16 | Solicitud de compra. | |
| Después | Informes con datos reales. | |

## 9. Riesgos y dependencias
- **Servidor de producción:** el EC2 es un t3.micro con la memoria al límite. Antes de la bolsa de repartidores (más usuarios conectados) conviene subir a t3.small.
- **Meta:** con la bolsa, los hubs no necesitan plantillas nuevas. Si en algún momento se quiere avisar al repartidor por WhatsApp fuera de la ventana de 24 h, hay que pedir plantilla con semanas de anticipación.
- **Migraciones:** al deployar el delivery por distancia hay que correr `migrate-plans-v2` y `migrate-businesses-planfeatures` en business (guía operativa §4b).
- **Datos personales:** con repartidores como usuarios, revisar el aviso de privacidad del hub hacia sus clientes.

## 10. Decisiones
1. ✅ Orden de sprints aprobado (2026-09-09). Sprint 0 en curso.
2. ✅ Precio: Hub $249 / Hub Pro $399 / Empresarial desde $699; anual con 1.5 meses gratis; Oe Ya con gracia de 3 meses y precio fundador $149 (§7).
3. ✅ Liquidaciones: semana de lunes a domingo; quincena 1–15 y 16–fin de mes.
4. Bolsa: acceso del repartidor (teléfono+PIN o email+contraseña) y si el hub puede asignar a mano además de la bolsa.
5. Repartidor: teléfono del cliente apagado por defecto (propuesta) o encendido.

---

## 11. Segunda reunión con Oe Ya (2026-09-10): qué entra, dónde y cómo se configura

Regla que se mantiene: **todo lo de esta lista se construye como opción del producto Hub, configurable por cada hub**, no como desarrollo para Oe Ya. Cada punto indica su interruptor.

### 11.1 Arreglos inmediatos (Sprint 1.5, esta semana)

| Reporte | Qué es | Qué se hace |
|---|---|---|
| "Agrega al carrito y el checkout sale vacío" en el hub | Bug. El carrito vive por tienda en el navegador; dentro del hub una misma tienda se abre con dos identificadores (el corto del directorio y el `store_link` con sufijo), y el checkout no encuentra el carrito que se llenó con el otro. | Unificar la clave del carrito por negocio dentro del hub y probar el recorrido directorio → tienda → checkout. |
| "No sale efectivo" en la pantalla de pago del hub | Configuración faltante. La pantalla solo ofrece efectivo si el negocio lo tiene activo en sus métodos de pago; los negocios creados por el hub no lo traen. | Métodos de pago **a nivel hub** (efectivo contra entrega, Yape, transferencia, etc.) propagados a todos sus negocios, igual que hoy Delivery/Recoger. Entra completo en el Sprint 3; el efectivo se activa ya en 1.5. |
| "Arroz0" en opciones sin costo y precio extra desde $0.01 | Bug de presentación: el nombre de la opción se concatena con el precio aunque sea 0. | Mostrar solo el nombre cuando el extra es 0; mostrar "+ $0.01" o más solo cuando aplica. Revisar producto, carrito, ticket y mensajes. |
| Tiempo estimado por negocio | Dato nuevo. Una zapatería entrega en 25 min y una carnicería en una hora. | Campo "tiempo estimado de entrega" por negocio, editable por el hub (y por el negocio si tiene permiso de catálogo). Lo usa el aviso al cliente del Sprint 4 y el portal. |

### 11.2 Flujo del pedido con confirmación del hub (se une al Sprint 2)

- **Interruptor por hub:** "El hub confirma los pedidos antes de pasarlos al negocio" (apagado = flujo actual: el negocio lo recibe al instante).
- Con el interruptor encendido: el pedido nace **Pendiente de confirmación** y solo lo ve el hub-admin. Al confirmar: (1) se avisa al negocio por WhatsApp y aparece en su portal, (2) se publica en la bolsa de repartidores, (3) se dispara el aviso al cliente (Sprint 4) con el tiempo estimado del negocio.
- **Estados del negocio:** En preparación → Preparado → Listo para recoger. **Estados de entrega** (repartidor o admin): Asignado → Recogido → En camino → Entregado, más Incidencia/Cancelado. El hub ve todo; el negocio solo los suyos; el repartidor los de entrega.
- El hub puede **asignar un pedido a un repartidor concreto** además de publicarlo en la bolsa (decisión 4, ahora propuesta como "sí").
- **Qué ve el negocio del pedido:** ítems, opciones, cantidades, nota del pedido y método de entrega siempre; nombre, teléfono y dirección del cliente según la matriz de visibilidad que ya existe. Lo mismo alimenta el WhatsApp del negocio y el ticket térmico (que ya respeta la matriz).
- Se hace junto con la bolsa porque los estados de entrega y la asignación son la misma máquina de estados. Añade unos 4 días al Sprint 2.

### 11.3 Pagos manuales con comprobante (Sprint 3, 1 semana)

Hoy, con Yape, transferencia y los demás métodos manuales, la pantalla de pago muestra la cuenta y un botón que abre WhatsApp al negocio; no hay forma de adjuntar el comprobante y el pedido nunca refleja que el cliente pagó.

- **El cliente adjunta el comprobante** (foto o captura) en esa misma pantalla y pulsa **"Confirmar pago"**. El pedido pasa a *Pago por confirmar* y guarda la imagen.
- **El comprobante se ve** en el detalle del pedido del hub-admin, del negocio (dashboard y portal) y en el ticket como referencia. Quien confirma el pago (hub o negocio, según el flujo) lo marca *Pagado* con un clic.
- **Interruptores por hub:** (a) pedir comprobante sí/no; (b) el botón de WhatsApp después de confirmar va **al número del hub o al del negocio**; (c) si el aviso por WhatsApp se muestra o no. Oe Ya: comprobante sí, aviso al hub. Otro hub puede querer que llegue al negocio.
- **Aplica a los 15 métodos manuales** que ya existen, no solo Yape y transferencia.
- **SaaS y White Label** reciben lo mismo con el aviso al negocio, que es su único destinatario posible. Es una mejora general del producto.
- Requiere subida de archivos desde una página pública: se hace con enlace firmado por pedido y límite de tamaño, para que nadie pueda subir a pedidos ajenos.

### 11.4 Avisos al cliente por WhatsApp (Sprint 4, 2–3 días + aprobación de Meta)

Hoy el cliente no recibe ningún mensaje del pedido. Se agrega **un solo mensaje** cuando el hub (o el negocio, si el hub no confirma) marca el pedido como confirmado: "Tu pedido en {negocio} está confirmado. Tiempo estimado de entrega: {tiempo}. El repartidor se comunicará contigo al llegar." con el tiempo estimado del negocio.

- Es plantilla de Meta (el cliente no ha escrito al número del bot, así que no cabe mensaje libre). **Hay que pedirla esta semana** para tenerla aprobada al llegar al Sprint 4. Una sola plantilla sirve para hubs, SaaS y WL.
- **Interruptor por hub:** avisar al cliente sí/no; texto del tiempo por negocio; número que firma el mensaje (el del bot).
- Costo real: un mensaje de utilidad de Meta por pedido (centavos). Está considerado en el precio, ver §11.7.

### 11.5 Liquidación de repartidores y su dashboard (Sprint 5, 1.5–2 semanas)

Reemplaza el Excel de Oe Ya y sirve a cualquier courier que pague a motorizados.

- **Comisión por pedido al repartidor:** regla general del hub (monto fijo o %) con **excepción por repartidor**, igual que hoy la comisión a negocios.
- **Cobros que retiene el repartidor:** efectivo contra entrega y pagos que le llegan a su Yape/cuenta quedan registrados en el pedido (método de cobro + quién cobró). La liquidación calcula: cobrado − comisión = lo que entrega al hub, o al revés si el hub le debe.
- **Bonos y ajustes** manuales por período (feriados, incentivos, descuentos) con concepto y monto.
- **Cortes** diario, semanal, quincenal o mensual reutilizando el motor de períodos de las liquidaciones a negocios, con marca de pagado y referencia.
- **Dashboard del repartidor** en su app: pedidos del día y del período, lo cobrado, su comisión y lo que debe entregar. **Vista del hub:** una fila por repartidor y período, con detalle por pedido y CSV.
- Depende de la bolsa (Sprint 2) porque necesita saber quién entregó cada pedido y cómo cobró.

### 11.6 Orden final propuesto

Sprint 1.5 arreglos → Sprint 2 flujo + bolsa → Sprint 3 pagos con comprobante → Sprint 4 aviso al cliente → Sprint 5 liquidación de repartidores → A→B → solicitud de compra → informes. La bolsa va antes que los pagos porque desbloquea la operación diaria y la liquidación de repartidores; los pagos con comprobante son un flujo cerrado y rápido que puede hacerse en paralelo si conviene.

### 11.7 Impacto en el precio

Lo nuevo es un **módulo completo de operación de motorizados** (bolsa, app, estados, liquidación) más pagos con comprobante y avisos al cliente. Sube el valor del producto y mete un costo variable real (mensajes de Meta). Propuesta, manteniendo el principio de "todos los planes incluyen todo":

| | Hub | Hub Pro | Empresarial |
|---|---|---|---|
| Precio mensual | $249 | $399 | desde $699 |
| Negocios / productos por negocio / pedidos al mes | 20 / 100 / 1,800 | 50 / 300 / 5,000 | 100+ / sin límite / 15,000+ |
| **Repartidores incluidos (nuevo)** | **5** | **15** | sin límite |
| Repartidor extra | $5/mes | $5/mes | negociado |
| Negocio extra / pedido extra / paquete +100 productos | $5 / $0.10 / $5 | $5 / $0.08 / $5 | negociado |
| Aviso al cliente por WhatsApp | incluido, 1 por pedido | incluido, 1 por pedido | incluido |

- **Repartidores como tercera dimensión de límite** es lo más natural: un courier grande tiene más motorizados, y cada uno es un usuario más de la app y una liquidación más. Escala el ingreso con el tamaño real de la operación sin cobrar funciones por separado.
- El mensaje al cliente cuesta centavos y ya cabe en la economía por pedido del plan; el pedido extra a $0.10 lo cubre con margen.
- Con el módulo de motorizados en producción conviene **revisar la lista para hubs nuevos** a $279 / $449. No lo subiría hoy: primero que exista y se vea funcionando en Oe Ya.
- Oe Ya conserva el precio fundador de §7 con los límites del Hub; los repartidores extra se le cobran igual que a cualquiera cuando pase el período de gracia.

### 11.8 Decisiones que necesito

1. Orden de sprints de §11.6, o mover pagos con comprobante antes de la bolsa.
2. Confirmar la tercera dimensión de repartidores (5 / 15 / ilimitado, $5 extra) o dejar repartidores ilimitados en todos los planes.
3. Pedir ya la plantilla de Meta del aviso al cliente (necesito el nombre del negocio/hub que la firma y el número del bot que se usará).
4. Confirmar que el hub puede asignar repartidor a mano además de la bolsa, y el acceso del repartidor (teléfono + PIN o email + contraseña).
