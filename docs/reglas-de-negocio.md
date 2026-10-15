# Reglas de negocio para el backend

Resumen, para el desarrollo, de los documentos del equipo: requerimientos y MER (9 oct 2026),
épicas (8 oct) e historias de usuario (10 oct). **Si este resumen y los documentos difieren,
valen los documentos** (documento vivo de requerimientos:
https://claude.ai/code/artifact/685b1c22-d596-43a5-aa2e-378b9b62ac31). Las historias, con sus
criterios de aceptación, están en Jira (proyecto SCRUM).

Lo que aparece como **PENDIENTE** no está decidido: no lo inventes, pregunta al equipo.

## Actores y roles

Cinco roles fijos en el código (`src/common/dominio/roles.ts`); una cuenta tiene un solo rol.

| Rol | Quién | Qué puede |
| --- | --- | --- |
| `cliente` | Consumidor final con cuenta | Compra a precio minorista |
| `profesional` | Peluquero con la verificación aprobada | Compra a precio mayorista desde 3 unidades por formato; ve los productos exclusivos |
| `vendedor` | Personal de tienda | PENDIENTE: permisos por definir |
| `bodeguero` | Personal de tienda | Recibe el aviso de stock bajo; resto PENDIENTE |
| `administrador` | La dueña | Reportes, cuentas del personal, aviso de stock bajo, oferta de cumpleaños |

El visitante (sin sesión) ve el catálogo con precio minorista, sin productos exclusivos, y puede
suscribirse a ofertas. No hay compra como invitado.

## Seguridad (RNF-01 a RNF-10, RNF-28)

- Contraseñas solo como hash con sal (argon2). Tokens de sesión y de correo: solo su hash; los de
  correo son de un uso y caducan; las sesiones caducan y se revocan.
- **La autorización es siempre del backend** (RNF-03): 401 sin JWT válido, 403 con rol sin permiso.
  El frontend solo oculta opciones.
- **El precio mayorista nunca sale de la API** hacia visitantes ni clientes: ni en catálogo, ni en
  carrito, ni en pedido (RNF-04). Los productos exclusivos tampoco.
- No se guardan datos de tarjetas (RNF-05). Se valida la firma de cada notificación de Mercado Pago
  (RNF-06). Los enlaces de confirmación y de baja van firmados (RNF-08).
- En las URL, cuentas y pedidos se identifican con `codigoPublico` no adivinable, nunca con el id
  correlativo (RNF-07). Pedir el pedido de otra cuenta devuelve error.
- Límite de peticiones (RNF-09): 5/min por IP en suscripción; 5 intentos de inicio de sesión en
  15 min; también la recuperación de contraseña. Responde 429. Contador común en Redis.
  Registro y confirmación del correo: 5/min por IP cada uno (decisión del 14 oct, E1-H1).
  Los límites se declaran por ruta con `LIMITES` (`src/limites/limites.ts`); si Redis no
  responde, la petición pasa (RNF-32).
- Cierre de sesión, desactivación de cuenta y cambio de rol rigen de inmediato, sin esperar a que
  caduque el token (RNF-28): Redis recuerda qué cuentas deben renovar su token.
- Credenciales solo en variables de entorno (RNF-10); gitleaks corre en CI.

## Montos e integridad (RNF-11 a RNF-14, RNF-29)

- Precios guardados **netos**; el IVA se calcula aparte con la tasa de configuración
  (`IVA_PORCENTAJE`). El catálogo muestra precios con IVA incluido calculado al consultar.
- El pedido guarda cerrados neto, IVA, total y `porcentajeIva`; cada línea guarda el precio
  aplicado y si fue minorista o mayorista. Un cambio posterior de precio o tasa no toca pedidos.
  Usa `calcularMontos()` (`src/common/dominio/montos.ts`): total = neto + IVA siempre.
- El backend **recalcula todo** al crear el pedido; nunca usa precios enviados por el navegador.
- Cada dato y su historia se escriben en **una misma transacción**: estado del pedido + historial,
  stock + movimiento, cambio + correo que lo avisa (RNF-12). El correo se registra en NOTIFICACION
  dentro de la transacción y se encola después.
- Compras simultáneas no venden dos veces la última unidad (RNF-13): descuenta con
  `UPDATE ... WHERE cantidad >= n` o bloqueo de fila dentro de la transacción.
- Todo dato del negocio vive en PostgreSQL; Redis solo guarda colas, contadores y copias temporales
  (RNF-29). Si Redis cae, la tienda sigue vendiendo (RNF-32).

## Por épica (lo que el backend debe respetar)

**E1 Cuentas.** Registro con nombre, apellido, correo y contraseña; teléfono, RUT, fecha de
nacimiento y género opcionales. Correo en minúsculas; RUT en formato único; ninguno se repite.
Hay que confirmar el correo para comprar. Recuperación de contraseña con enlace de un uso.
Direcciones con una sola principal. Sin inicio de sesión con Google.
Decisiones del 14 oct (E1-H1): «cuenta inactiva» = `activo` verdadero con
`fechaVerificacionCorreo` vacía (`activo` falso queda para la desactivación); el enlace de
confirmación dura 24 h (`CONFIRMACION_CORREO_HORAS`); contraseña de 8+ caracteres con letra y
número; RUT guardado como `12345678-K`. Valores nuevos en `valores.ts`: `TIPOS_TOKEN`
(`confirmacion_correo`), `TIPOS_NOTIFICACION` (`confirmacion_correo`) y `ESTADOS_NOTIFICACION`
(`pendiente`, `enviada`, `fallida`).

**E13 Personal y acceso.** El administrador crea y desactiva cuentas del personal; la desactivada
pierde el acceso de inmediato. Cada acción del panel exige un permiso del rol (guard en backend).
Cliente y profesional no entran al panel. PENDIENTE: matriz de permisos de vendedor y bodeguero.

**E3 Administración del catálogo.** Producto: nombre, descripción, marca (de una lista), categoría,
canal de venta. Formatos con SKU y código de barras únicos, contenido, peso, medidas, stock mínimo,
uno predeterminado, fecha de vencimiento **opcional** que solo se muestra en el panel (no se usa
para vender ni avisar). Cada artículo tiene al menos una imagen y una sola principal. Categorías
sin ciclos. Cada cambio de precio queda en HISTORIAL_PRECIO con vigencia, quién y motivo. Producto
exclusivo: solo precio mayorista. Un pack solo tiene formatos como componentes, no tiene stock
propio y puede tener vigencia.

**E2 Catálogo público.** Precio según rol calculado en el backend. Disponibilidad desde el stock
vendible (solo bodegas con `abasteceVentaOnline`); la de un pack es la de su componente más escaso.
Búsqueda por nombre, marca, categoría o subcategoría; filtros combinables. Caché permitida solo
para el árbol de categorías y marcas (RNF-30).

**E11 Inventario.** Sin lotes. Stock por formato y ubicación (EXISTENCIA). El stock nunca queda bajo
cero ni cambia sin un MOVIMIENTO que lo explique. Entrada: proveedor, documento y detalle (un
formato una sola vez por entrada) → suma stock y crea un movimiento por formato ligado a la entrada.
Salidas que no son venta: merma por vencimiento, merma por daño, consumo en la peluquería. Ajustes
y transferencias. La venta descuenta siguiendo el orden del código de ubicación; un pack descuenta
de sus componentes; la cancelación reingresa. Bajo el stock mínimo: aviso en el panel y correo a
bodegueros y administradores.

**E5 Carrito y compra.** Carrito del visitante en el navegador; se une al de la cuenta al iniciar
sesión. Un carrito por cuenta; el carrito no guarda precios. El pedido exige sesión y correo
confirmado, rechaza si falta stock o el artículo no se vende a esa cuenta, y un doble clic crea un
solo pedido (clave de idempotencia). Al crearlo se reserva el stock (se descuenta con movimiento de
venta) y hay **15 minutos** para pagar (`PLAZO_PAGO_MINUTOS`; el plazo lo lleva una cola, con
`fechaExpiracionPago` de respaldo). El profesional necesita al menos `MINIMO_UNIDADES_PELUQUERO`
(3) unidades de **cada** formato; si no, el pedido no se crea.

**E6 Pago.** Solo Mercado Pago. La notificación se responde de inmediato y se procesa en la cola
`eventos-pago` (RNF-15: MP espera 22 s). Cada evento se procesa una vez (`idEventoExterno` único).
Reintentos; al agotarlos queda marcado para revisión humana. Un solo pago aprobado por pedido y por
el total. Sin pago a los 15 minutos: se cancela y se libera el stock, **pero antes se aplican los
pagos recibidos** (RNF-29). Correo al recibir el pago. Sin reembolsos.

**E7 Despacho.** Despacho a domicilio (cotiza Blue Express por comuna, peso y medidas; caché 15 min
de la cotización repetida) o retiro en tienda (sin costo). Región y comuna de la lista oficial. Si
Blue Express no responde, se informa y se ofrece retiro. Costo del envío guardado neto.

**E9 Facturación.** Boleta: el comprobante de Mercado Pago. Factura: el cliente elige uno de sus
datos de facturación; el personal registra la factura emitida en el SII con folio (único por tipo)
y archivo; el documento guarda copia de los datos del receptor y de los montos.

**E8 Pedidos.** Estados: pendiente de pago, pagado, en preparación, despachado, entregado, listo
para retiro, retirado, cancelado (`ESTADOS_PEDIDO`). Cada cambio guarda fecha, quién y comentario,
y avisa por correo. Solo el personal cancela, y solo pedidos pendientes de pago; el cliente no.

**E4 IA.** Descripción sugerida e ingredientes desde la foto del reverso; nunca se publica sin
revisión; se guarda el origen: manual, IA o IA editada. PENDIENTE: proveedor de IA.

**E10 Verificación.** Requiere RUT. OCR (Google Cloud Vision) de cada documento, factores de
confianza con puntaje y versión de reglas. Aprobación automática solo con un único documento
legible, puntaje sobre el umbral y ningún factor fallido; todo lo demás va a revisión manual.
**El sistema nunca rechaza solo** (RNF-27). Rechazo manual exige motivo. Al aprobar: rol
`profesional` de inmediato y correo. Detecta el mismo documento (hash) en otra cuenta. Archivos
se borran 30 días después de resuelta, conservando el texto. PENDIENTE: factores, pesos y umbral.

**E12 Marketing.** Publicidad solo a quien la aceptó (cuenta activa con correo verificado o
suscriptor confirmado); el consentimiento se revisa de nuevo al enviar. Baja desde cualquier
correo, por dirección. Campaña con vista previa y confirmación; sale una vez y llega una vez a cada
dirección. Recordatorios de carrito a 1, 24 y 72 h, una serie por semana. Saludo de cumpleaños
anual. Registrar apertura, clic y rebote. Todo correo publicitario lleva remitente y enlace de baja
(RNF-26). Prioridad de correos: pedido y cuenta > suscripción > publicidad (RNF-16).

**E14 Reportes.** Solo administrador. OE1 30 %, OE2 70 % en 48 h, OE3 80 %; ventas por período y
tipo de cliente; carritos abandonados y recuperados; resultado de campañas; stock bajo el mínimo.

## Rendimiento y operación

- 95 % de las peticiones en ≤ 500 ms; crear un pedido ≤ 1 s sin contar servicios externos (RNF-18).
- Sin estado en memoria: varias instancias del backend deben funcionar igual; cada tarea programada
  corre una sola vez (RNF-20) — usa los jobs repetibles de BullMQ, no `setInterval`.
- Tareas con plazo con ≤ 1 min de atraso (RNF-31).
