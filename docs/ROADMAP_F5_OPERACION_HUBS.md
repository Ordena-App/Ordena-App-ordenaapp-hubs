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

### 2.1 Liquidaciones configurables (para cualquier hub)
Alcance:
- Frecuencia por hub en Ajustes → Liquidaciones: **diaria, semanal, quincenal, mensual**. Día de inicio de semana configurable (lunes por defecto) y quincena = días 1–15 y 16–fin de mes.
- Clave de período por frecuencia (`2026-09-09`, `2026-W37`, `2026-09-Q1`, `2026-09`). El índice único y la regla "pagadas no se recalculan" se conservan tal cual.
- Selector de período en Liquidaciones según la frecuencia; "Calcular" genera solo el período elegido; total del período y marcado de pago igual que hoy.
- Estado de cuenta del negocio en su portal con la misma frecuencia.
- Cambio de frecuencia no rompe lo ya generado: los períodos viejos quedan con su clave; los nuevos usan la nueva.
- Exportar CSV del período (pedido, negocio, bruto, comisión, neto) para conciliar con el banco.

Decisiones que necesito: día de inicio de semana por defecto y si la quincena es 1–15/16–fin o cada 14 días.

**Tamaño:** 3 días.

### 2.2 Ticket térmico 58 mm y 80 mm
- Ruta de impresión del pedido con dos anchos, tipografía monoespaciada y CSS de página para que el navegador imprima directo a la térmica.
- Contenido: nombre y logo del hub, **datos completos del negocio** (nombre, teléfono, dirección), número visible e ID completo, fecha/hora, cliente (respetando la matriz de visibilidad del hub), ítems con variantes y notas, subtotal, envío (con km si es por distancia), descuento, total, método de pago, dirección de entrega, referencia y **QR** al pedido para que el repartidor abra el pin.
- Botón "Imprimir ticket" en el drawer del hub-admin, en el detalle del negocio (dashboard y portal) y en el ticket web público.
- Se prueba en una impresora de 58 y una de 80 antes de darlo por cerrado (pedir a Oe Ya el modelo).

**Tamaño:** 2 días.

### 2.3 Catálogo autogestionado por el negocio (portal del negocio)
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

## 7. Precio: cómo cobrar lo que sale del alcance base

Planes actuales: **Plan Piloto $149/mes** y **Plan Hub $199/mes**, ambos con 20 negocios y 1,800 pedidos incluidos, $5 por negocio extra y $0.10 por pedido extra.

Referencias de valor:
- Un negocio en SaaS paga **$12.99/mes (Básico)** por administrar su propio catálogo y pedidos. Dar autogestión a 20 negocios de un hub tiene un valor de mercado de unos $260/mes.
- Para el hub, el valor es tiempo del operador: mantener 20 catálogos a mano son horas cada semana.
- El costo de infraestructura de estas funciones es casi cero.

**Recomendación: empaquetar por niveles, no vender piezas sueltas.**

| Plan | Precio | Incluye |
|---|---|---|
| Plan Hub (actual) | $199/mes | Todo lo de hoy; el hub administra los catálogos; liquidación mensual; ticket térmico. |
| **Plan Hub Pro (nuevo)** | **$249/mes** | Lo anterior + catálogo autogestionado por los negocios + liquidaciones configurables + bolsa de repartidores + envíos A→B cuando estén. Mismos límites y extras. |

Por qué $249: son $50 más por mes, $2.50 por negocio si usa los 20, cinco veces menos que lo que pagarían esos negocios en SaaS, y deja margen de sobra. Es un número que se explica en una frase.

Alternativa si prefieres a la carta: complemento **"Autogestión de catálogo" a $2 por negocio activo al mes**, mínimo $20. Para Oe Ya con 20 negocios son $40. Funciona, pero cada hub nuevo obliga a negociar piezas.

Para Oe Ya, por ser piloto: propongo incluir el nivel Pro sin costo durante 3 meses a cambio del feedback que ya están dando, y pasarlos a $249 al terminar. Es tu decisión.

---

## 8. Cronograma resumido

| Semana | Entregable |
|---|---|
| 1 | Favicon, ID de pedido, cierre de "Crear hub", onboarding Oe Ya. |
| 2 | Liquidaciones configurables; ticket térmico. |
| 3 | Catálogo autogestionado fase A y B. |
| 4–6 | Bolsa de repartidores (con privacidad hacia el motorizado). |
| 7–8 | Envío A→B. |
| 9–11 | Solicitud de compra. |
| Después | Informes con datos reales. |

## 9. Riesgos y dependencias
- **Servidor de producción:** el EC2 es un t3.micro con la memoria al límite. Antes de la bolsa de repartidores (más usuarios conectados) conviene subir a t3.small.
- **Meta:** con la bolsa, los hubs no necesitan plantillas nuevas. Si en algún momento se quiere avisar al repartidor por WhatsApp fuera de la ventana de 24 h, hay que pedir plantilla con semanas de anticipación.
- **Migraciones:** al deployar el delivery por distancia hay que correr `migrate-plans-v2` y `migrate-businesses-planfeatures` en business (guía operativa §4b).
- **Datos personales:** con repartidores como usuarios, revisar el aviso de privacidad del hub hacia sus clientes.

## 10. Decisiones pendientes de tu lado
1. Aprobar el orden de sprints o moverlo.
2. Precio: niveles ($249 Pro) o complemento por negocio ($2), y qué hacer con Oe Ya durante el piloto.
3. Liquidaciones: día de inicio de semana y definición de quincena.
4. Bolsa: acceso del repartidor (teléfono+PIN o email+contraseña) y si el hub puede asignar a mano además de la bolsa.
5. Repartidor: teléfono del cliente apagado por defecto (propuesta) o encendido.
