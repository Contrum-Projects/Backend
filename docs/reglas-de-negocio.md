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
| `profesional` | Peluquero con la verificación aprobada | Compra a precio mayorista; ve los productos exclusivos |
| `vendedor` | Personal de tienda | Catálogo, consultar stock y pedidos (matriz de E13-H2) |
| `bodeguero` | Personal de tienda | Recibe el aviso de stock bajo; proveedores, inventario y pedidos (matriz de E13-H2) |
| `administrador` | La dueña | Todos los permisos del panel; aviso de stock bajo, oferta de cumpleaños |

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
  Inicio de sesión (decisión del 17 oct, E1-H2): cuentan solo los fallidos, 5 por correo + IP y
  20 por IP en 15 min (`LIMITE_INICIO_SESION`); un inicio correcto reinicia el del correo.
  Registro y confirmación del correo: 5/min por IP cada uno (decisión del 14 oct, E1-H1).
  Los límites se declaran por ruta con `LIMITES` (`src/limites/limites.ts`); si Redis no
  responde, la petición pasa (RNF-32). La IP se toma de la conexión; detrás de proxies propios
  (Cloudflare, Nginx, balanceador) hay que indicar cuántos en `PROXIES_CONFIABLES`, o todos los
  usuarios compartirían el mismo contador.
- Cierre de sesión, desactivación de cuenta y cambio de rol rigen de inmediato, sin esperar a que
  caduque el token (RNF-28): el token lleva su sesión (`sid`) y `JwtAutenticacionGuard` revisa en
  SESION que no esté revocada (decisión del 18 oct, E1-H3). Desactivar o cambiar el rol debe
  revocar las sesiones de la cuenta. **Excepción** (decisión del 3 nov, E10-H4): el ascenso de
  cliente a profesional al aprobar la verificación no revoca, porque el token anterior solo da
  permisos de cliente; al renovar la sesión el rol se lee de la base.
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
Decisiones del 17 oct (E1-H2): para iniciar sesión la cuenta debe tener `activo` verdadero **y**
el correo confirmado (si no, 403, y solo se informa con la contraseña correcta); correo inexistente
y contraseña errónea responden el mismo 401. El token de acceso (`JWT_ACCESS_TTL`, con `sub` =
`codigoPublico` y el rol) va en la respuesta; el de refresco (`JWT_REFRESH_TTL`) va en una cookie
httpOnly y en SESION solo su hash.
Decisiones del 18 oct (E1-H3): el token de acceso lleva `sid` = `SESION.codigoPublico` (UUID). El
cierre en el dispositivo se identifica con todas las cookies `refresco` que lleguen (no pide token
de acceso, es idempotente y tiene un límite de 30/min por IP, `LIMITES.CIERRE_SESION`); el cierre en
todos pide token de acceso. La revocación queda en `SESION.fechaRevocacion` y
`JwtAutenticacionGuard` la consulta en la base en cada petición (sin Redis: una marca perdida
dejaría pasar un token revocado). Los tokens de acceso van con HS256 y audiencia `cp-acceso`.
Decisiones del 24 oct (renovación de la sesión): `POST /api/cuentas/sesion/renovar` lee las
cookies `refresco` y, si corresponden a **una sola** sesión abierta, vigente y de una cuenta activa
con el correo confirmado, entrega un token de acceso nuevo (con el rol leído de la base) y cambia
el token de refresco por otro con una condición atómica: cada token de refresco sirve una vez. La
sesión no se alarga (vence en la fecha del inicio de sesión). Cookies de dos sesiones vigentes,
sesión cerrada o vencida, o cuenta desactivada: 401 y se borra la cookie. Límite de 30/min por IP
(`LIMITES.RENOVAR_SESION`). Dos renovaciones simultáneas con el mismo token: gana una, la otra
recibe 401.
Decisiones del 26 oct (E1-H4): `POST /api/cuentas/recuperar-contrasena` con el correo responde
siempre el mismo 200, tenga o no cuenta (no revela qué correos están registrados); solo una cuenta
`activo` recibe el enlace, sea cliente, profesional o personal, con o sin el correo confirmado.
El enlace (`TIPOS_TOKEN.RECUPERACION_CONTRASENA`) dura 1 h (`RECUPERACION_CONTRASENA_HORAS`), va
a `URL_TIENDA/restablecer-contrasena?token=...` y pedir otro deja sin efecto los anteriores (con
la fila de la cuenta bloqueada). `POST /api/cuentas/restablecer-contrasena` con el token y la
contraseña nueva (mismas reglas que el registro) consume el token con una condición atómica y, en
la misma transacción, guarda la contraseña, confirma el correo si no lo estaba, invalida los demás
enlaces de recuperación y la invitación del personal pendiente, y revoca todas las sesiones de la
cuenta. Token inexistente, de otro tipo, usado o vencido, o cuenta desactivada: 400 que pide un
enlace nuevo. Cada ruta tiene un límite de 5 cada 15 min por IP (`LIMITES.RECUPERAR_CONTRASENA`).
Además, cada correo recibe a lo más 3 enlaces por hora desde cualquier IP
(`LIMITE_RECUPERACION_POR_CORREO`, contado en Redis con el hash del correo, tenga o no cuenta);
pasado el tope se responde el mismo 200 sin enviar nada ni anular el último enlace. Si Redis no
responde, la solicitud pasa (RNF-32). Por confirmar con el jefe de proyecto.
Decisiones del 20 oct (E1-H5): «mi cuenta» (`/api/cuentas/yo` y `/api/cuentas/yo/direcciones`)
es solo para cliente y profesional (`CompradorGuard`; el personal recibe 403). El correo no se
edita en esta historia. El RUT no se cambia ni se borra (403) si la cuenta es profesional o tiene
una solicitud de verificación `pendiente` o `revision_manual`; el RUT de otra cuenta responde 409.
El cambio se lee y guarda con la fila de la cuenta bloqueada (`bloquearCuenta`): **la aprobación
de E10 debe tomar el mismo bloqueo antes de leer el RUT**. Editar los datos tiene un límite de
10/hora por cuenta (`LIMITES.EDITAR_DATOS`, `LimitePorCuentaGuard`), que frena probar RUT en serie;
la caché no guarda datos de cuentas, solo el contador. Las direcciones se identifican por su id dentro de la cuenta del token (la de
otra cuenta responde 404), sin `codigoPublico` ni cambio al MER; la comuna se indica por su código
CUT. La primera dirección queda como principal; al borrar la principal pasa a serlo la más
reciente de las que quedan. Una sola principal se garantiza con la misma transacción con
`bloquearCuenta` (`SELECT ... FOR UPDATE`), sin índice parcial.
Decisiones del 1 nov (E1-H6, SCRUM-78): el worker de la cola `correos` (módulo `notificaciones`) envía
por Resend los **6 tipos** de correo que ya se encolan (confirmación, recuperación, invitación, pago
confirmado, cambio de estado y stock bajo), con las plantillas de la página «Correos» de Figma, en
TypeScript. Recuperación e invitación no tienen diseño propio: usan la base de confirmación. El correo
de pago **no adjunta el PDF** (Figma lo mostraba): dice que se descarga desde el detalle del pedido.
Confirmación y recuperación **no llevan el nombre** (Figma lo mostraba): la dirección aún no está
confirmada, y un nombre inventado serviría para enviar texto engañoso a un correo ajeno.
Los datos del pedido y del stock se leen de la base al enviar. Un rechazo de Resend o su silencio por
15 s se reintenta (5 intentos, espera exponencial desde 5 s) y al agotarlos la NOTIFICACION queda
`fallida`, sin tocar la cuenta; `intentos` cuenta cada envío probado. Cada trabajo se llama
`correo-<id de la notificación>` y lleva una clave de idempotencia, para no duplicar el correo.
**Revisión de pendientes:** cada minuto toma las `pendiente` de más de 2 min que no estén en la cola y
las reencola. Las de 5 o más intentos quedan `fallida`. Como solo se guarda el hash del token, un
correo con enlace recibe un **token nuevo en la misma fila, con el vencimiento original** (el enlace
anterior deja de servir); queda `fallida` si no hay enlace vigente, la cuenta está desactivada, el
correo ya se confirmó o hay un correo más nuevo del mismo tipo. NOTIFICACION no guarda el formato, así
que un stock bajo reencolado sale sin cifras y remite al panel, y ningún stock bajo se envía a una
cuenta desactivada o sin rol de bodega o administración; un cambio de estado reencolado avisa el
estado actual del pedido, con el asunto de ese estado, y queda `fallida` si ese estado no lleva aviso. **Entorno:**
`RESEND_API_KEY` reemplaza a `SMTP_URL`; sin ella, fuera de producción, los correos se simulan y solo
se registra el id de la notificación; en producción la app no arranca sin ella, y con ella
`CORREO_REMITENTE` es obligatorio. `CORREOS_WORKER_ACTIVO=false` apaga el worker (los e2e leen los
enlaces desde la cola). Sin cambios al MER. Rutas de los correos (alineadas
con el frontend el 6 nov, SCRUM-150): el pedido lleva a `/cuenta/pedidos/<código>` y el stock bajo a
`/panel/inventario`. El pie **no enlaza** ayuda, términos ni privacidad mientras esas páginas no
existan en la tienda (sus textos están pendientes); cuando existan irán a `/ayuda`,
`/terminos-y-condiciones` y `/politica-de-privacidad`.

**E13 Personal y acceso.** El administrador crea y desactiva cuentas del personal; la desactivada
pierde el acceso de inmediato. Cada acción del panel exige un permiso del rol (guard en backend).
Cliente y profesional no entran al panel.
Decisiones del 19 oct (E13-H2): los permisos son fijos en el código
(`src/common/dominio/permisos.ts`), uno por área del panel, y cada ruta exige uno con
`@RequierePermiso(...)` y `PermisosGuard` (sin decorador, 403). Cliente y profesional no tienen
ninguno. El administrador tiene todos, también los que se agreguen.

| Permiso | Cubre | Administrador | Vendedor | Bodeguero |
| --- | --- | :-: | :-: | :-: |
| `personal.gestionar` | Cuentas del personal (E13) | ✅ | | |
| `proveedores.gestionar` | Proveedores (E11-H1) | ✅ | | ✅ |
| `inventario.registrar` | Entradas, salidas, ajustes y transferencias (E11-H2 a H4) | ✅ | | ✅ |
| `inventario.consultar` | Stock por formato y ubicación (E11-H5) | ✅ | ✅ | ✅ |
| `catalogo.gestionar` | Productos, formatos, imágenes, marcas, categorías y packs (E3, E4) | ✅ | ✅ | |
| `precios.gestionar` | Precio minorista y mayorista (E3-H5) | ✅ | | |
| `pedidos.gestionar` | Ver pedidos y cambiar su estado en el panel (E8-H2) | ✅ | ✅ | ✅ |
| `facturacion.gestionar` | Registrar la factura emitida en el SII (E9-H3) | ✅ | ✅ | |
| `verificacion.gestionar` | Revisión manual de profesionales (E10-H3) | ✅ | | |
| `campanas.gestionar` | Campañas de correo (E12-H3) | ✅ | | |
| `reportes.ver` | Indicadores y reportes (E14) | ✅ | | |
Decisiones del 18 oct (E13-H1): el administrador crea la cuenta con nombre, apellido, correo y un
único rol (`vendedor`, `bodeguero` o `administrador`); la cuenta nace con una contraseña aleatoria
que nadie conoce y se envía una invitación de un uso (`TIPOS_TOKEN.INVITACION_PERSONAL`, 72 h,
`INVITACION_PERSONAL_HORAS`) a `URL_TIENDA/personal/activar?token=...`; al aceptarla la persona
define su contraseña (mismas reglas que el registro) y queda con el correo confirmado. El
administrador puede reenviar la invitación (invalida la anterior) mientras la cuenta esté activa y
sin contraseña definida, y listar al personal. Desactivar pone `activo` en falso, revoca todas sus
sesiones e invalida su invitación pendiente, en una transacción; el administrador no puede
desactivarse a sí mismo (409) y quien crea, reinvita o desactiva debe seguir activo dentro de la
transacción (403), así que siempre queda al menos un administrador activo. El guard JWT rechaza
también las sesiones de cuentas desactivadas. No hay reactivación (no está en la historia).
Decisiones del 4 nov (E13-H3, SCRUM-148, RF-13.04): `PATCH /api/cuentas/:codigoPublico/rol`
(`{ rol, motivo? }`, UUID de la cuenta) con `personal.gestionar`; va en `cuentas` porque el
profesional no es parte del personal. **Solo baja el rol:** administrador → `vendedor` o
`bodeguero`, y profesional → `cliente`. Otro rol de destino responde 400; un cambio que no
corresponde al rol actual (vendedor ↔ bodeguero, cliente, etc.), 409. **Motivo:** se recorta, de
10 a 1000 caracteres; obligatorio al pasar a cliente (400 «El motivo es obligatorio al quitar el rol
profesional.»), opcional para el personal. **Cambio al MER:** tabla `historial_rol`
(`id_usuario`, `id_usuario_responsable`, `rol_anterior`, `rol_nuevo`, `motivo`, `fecha_cambio`):
guarda cada cambio, quién y cuándo. En una transacción, con los administradores activos bloqueados
(`FOR UPDATE`, como al desactivar) y luego la cuenta: quien pide debe seguir siendo administrador
activo (403); cuenta desactivada, 409; **nunca queda la tienda sin administrador** (409 si es el
único activo). El administrador **puede bajarse a sí mismo** si queda otro activo. Se guarda el rol y
su historial y **se revocan todas las sesiones** de la cuenta (RNF-28): el token anterior responde
401 y al volver a entrar el rol se lee de la base. **Profesional → cliente:** en la misma
transacción se **quitan del carrito los artículos exclusivos** (formatos de productos y packs con
`canal_venta = profesional`) y se registra la NOTIFICACION `rol_profesional_retirado`; el correo
(asunto «Tu cuenta volvió a ser de cliente», **PROPUESTA** de texto, sin diseño en Figma) se encola
después del commit y lleva el motivo, que se lee de `historial_rol` al enviar (no viaja en Redis).
El precio mayorista deja de verse porque la sesión se revoca y el carrito ya calcula por rol. **Los
pedidos ya creados no se tocan**, tampoco uno pendiente de pago (RNF-11). `POST /api/pedidos` relee
el rol de la cuenta con la fila bloqueada y responde 409 si ya no es el del token: un pedido que
esperaba el bloqueo no sale al precio mayorista. Por lo mismo (auditoría del 4 nov), las escrituras
del carrito bloquean la cuenta con `bloquearCuentaConRol` y responden 409 `ROL_CAMBIADO` si el rol
de la base ya no es el del token, y el **inicio de sesión** crea la sesión con la fila de la cuenta
bloqueada y firma el token con el rol releído ahí: un login simultáneo con el cambio no queda con
el rol anterior. El 409 también le puede tocar al cliente recién aprobado (E10-H4) que no renovó la
sesión: el frontend debe renovarla ante ese 409. La verificación no cambia: el ex profesional no
puede volver a solicitarla (sigue el 409 «ya fue aprobada»); el perfil profesional se conserva.

**E3 Administración del catálogo.** Producto: nombre, descripción, marca (de una lista), categoría,
canal de venta. Formatos con SKU y código de barras únicos, contenido, peso, medidas, stock mínimo,
uno predeterminado, fecha de vencimiento **opcional** que solo se muestra en el panel (no se usa
para vender ni avisar). Cada artículo tiene al menos una imagen y una sola principal. Categorías
sin ciclos. Cada cambio de precio queda en HISTORIAL_PRECIO con vigencia, quién y motivo. Producto
exclusivo: solo precio mayorista. Un pack solo tiene formatos como componentes, no tiene stock
propio y puede tener vigencia.
Decisiones del 24 oct (E3-H2): el formato nace activo y **sin precios**
(`articulo_venta.precio_mayorista_neto` pasa a aceptar NULL, cambio al MER); los fija E3-H5 y,
mientras falten, la tienda no lo muestra. Rutas: `POST` y `GET /api/catalogo/productos/:id/formatos`
y `PATCH /api/catalogo/formatos/:id`, con `catalogo.gestionar`. SKU obligatorio, sin espacios,
hasta 50, único entre todos los artículos (formatos y packs). Código de barras opcional: 8, 12, 13
o 14 dígitos, sin revisar el dígito verificador, único entre los formatos. El SKU o el código de
barras repetido responde 409 indicando cuál. Contenido y unidad (`UNIDADES_MEDIDA`: `ml`, `g`,
`unidades`) van juntos o no van. El primer formato del producto queda predeterminado; marcar
otro desmarca el anterior en la misma transacción con la fila del producto bloqueada (`FOR
UPDATE`, sin índice parcial); el predeterminado no se desmarca (400): se marca otro. La fecha de
vencimiento solo sale en las respuestas del panel. Desactivar formatos queda fuera de la historia.
Decisiones del 24 oct (E3-H3): las imágenes se guardan en **Cloudflare R2** (API S3, variables
`R2_*`; sin ellas subir responde 503) y `imagen_articulo.ubicacion_archivo` guarda la clave del
objeto (`articulos/<id>/<uuid>.<ext>`); la URL se arma con `R2_URL_PUBLICA` al responder. JPEG, PNG
o WebP reconocidos por su contenido, hasta 4 MB (413), hasta 10 por artículo (409). Rutas, con
`catalogo.gestionar`: `POST` (multipart, campo `imagen`), `GET` y `PUT`
`/api/catalogo/articulos/:id/imagenes` y `DELETE /api/catalogo/articulos/:id/imagenes/:imagenId`
(el id del artículo es el del formato). La primera imagen queda principal; `PUT` recibe todas las
imágenes en su nuevo orden y la principal. El orden queda 1..n sin huecos. La única imagen no se
elimina (409); si se elimina la principal, la siguiente pasa a serlo. Los cambios bloquean la fila
del artículo. El archivo se sube antes de la transacción (y se borra si la base falla) y se borra
del almacén después del commit. Un formato puede existir sin imágenes: la tienda no lo muestra.
Decisiones del 24 oct (E3-H5): `PUT` y `GET /api/catalogo/articulos/:id/precios` (id del formato o
del pack), con `precios.gestionar` (solo administrador). `PUT` recibe `precioMinoristaNeto`,
`precioMayoristaNeto` (al menos uno; el que no llega no cambia) y `motivo`, **obligatorio siempre**
(1 a 500 caracteres). Netos positivos con hasta dos decimales y hasta 9.999.999.999,99; no se
compara el mayorista con el minorista. Cada precio que cambia cierra la fila vigente de
HISTORIAL_PRECIO (`fecha_fin_vigencia`) y crea otra con el mismo instante como inicio, quién y el
motivo, en una transacción con la fila del artículo bloqueada. Un precio igual al vigente no se
registra; si ninguno cambia, no se escribe nada. Un artículo exclusivo (canal `profesional` del
producto o del pack) rechaza el precio minorista con 400. La vigencia rige desde el momento del
cambio (sin precios programados). `GET` devuelve los netos vigentes, `exclusivo` y el historial,
del más reciente al más antiguo, con nombre y apellido de quien fijó cada precio. Se bloquean la
fila del artículo y la de su producto o pack, así el canal no cambia mientras se fijan precios.
Decisión del 24 oct: si un producto con precio minorista pasa a exclusivo (`PATCH` de E3-H1), el
minorista **queda guardado** (no se borra ni se cierra su vigencia en HISTORIAL_PRECIO) por si el
producto vuelve a venderse a todo público; mientras es exclusivo, `GET` lo muestra, `PUT` no lo
cambia (400) y la tienda no lo muestra. Al volver a `general`, rige de nuevo ese minorista. La
historia de E2 que muestre exclusivos al profesional debe dejar de exigir el minorista en
`FORMATO_VENDIBLE` para ese canal.
El precio con IVA de la tienda es `precioConIva()` (`montos.ts`): el neto se redondea al peso y
luego se le suma el IVA; el pedido (E5) debe usar la misma función.
Decisiones del 26 oct (E3-H6): rutas `POST` y `GET /api/catalogo/packs`, `GET` y `PATCH
/api/catalogo/packs/:id`, con `catalogo.gestionar`. El pack trae SKU (mismas reglas y unicidad
que el formato, 409), nombre, descripción, canal de venta, vigencia opcional y sus componentes
(`formatoId` y `cantidad`). Nace activo, **sin precios** (los fija el administrador con
`PUT /api/catalogo/articulos/:id/precios`, E3-H5) y sin stock propio: no tiene existencias. Lleva
al menos un formato, hasta 20 distintos, cada uno una vez, con cantidad entera de 1 a 99 y al
menos 2 unidades en total (un «3x2» de un mismo formato vale). Cada componente debe ser un
formato de producto: otro pack (incluido él mismo) responde 400; un id inexistente, o un formato o
producto desactivado, también 400. Un pack `general` no lleva formatos de productos exclusivos
(400); uno `profesional` sí. Vigencia: fechas AAAA-MM-DD, ambas opcionales, días incluidos en hora
de Chile; el término no puede ser anterior al inicio (400). `PATCH` cambia solo lo que llega,
`null` quita una fecha y `componentes` reemplaza la lista completa; si cambian el canal o los
componentes se revisan otra vez las reglas, con la fila del pack bloqueada. El panel devuelve
`vigente` calculado con el día de hoy.

**E2 Catálogo público.** Precio según rol calculado en el backend. Disponibilidad desde el stock
vendible (solo bodegas con `abasteceVentaOnline`); la de un pack es la de su componente más escaso.
Búsqueda por nombre, marca, categoría o subcategoría; filtros combinables. Caché permitida solo
para el árbol de categorías y marcas (RNF-30).
Decisiones del 24 oct (E2-H2): la búsqueda es el parámetro `buscar` de `GET /api/tienda/productos`
(no un endpoint aparte) y se combina con `categoriaId`, `marcaId` y la paginación. Se separa en
palabras y **cada** palabra debe estar en el nombre del producto, en el de su marca o en el de su
categoría o una superior (una categoría alcanza a sus subcategorías). Ignora mayúsculas pero no
tildes (sin `unaccent`). Vacío o solo espacios no filtra; más de 100 caracteres o más de 5 palabras (cada palabra suma
condiciones a la consulta) responde 400; caracteres de control, también 400.
`%`, `_` y `\` se buscan como texto: Prisma no escapa los comodines de ILIKE en `contains`, hay
que escaparlos antes. Sin coincidencias responde 200 con la lista vacía; sin caché.
Decisiones del 26 oct (E2-H4): `GET /api/tienda/productos` acepta sesión **opcional**
(`SesionOpcionalGuard`): sin `Authorization` es un visitante; con un token inválido, vencido o de
una sesión cerrada responde 401 (no se trata como visitante). Se usa el rol del token, que es
confiable porque cambiar el rol revoca las sesiones (RNF-28). Solo el rol `profesional` ve los
productos exclusivos (canal `profesional`) junto a los generales, al explorar, buscar y filtrar;
cliente, visitante y **personal** ven solo los generales, con una consulta que no lee el
mayorista. Para el profesional, cada producto trae `precio` (minorista con IVA; `null` si es
exclusivo, aunque tenga uno guardado), `precioMayorista` (con IVA, `precioConIva()`) y
`exclusivo`; los dos precios salen del mismo formato: el predeterminado o el de mayorista más
barato. El formato de un exclusivo se vende con mayorista e imagen (sin exigir minorista); el de
uno general sigue exigiendo los dos precios. Alcance: solo el listado; el detalle (E2-H3) debe
reutilizar esta regla.
Que solo el profesional compre exclusivos lo valida E5 al crear el pedido.
Decisiones del 26 oct (E3-H6): los packs se listan aparte en `GET /api/tienda/packs` (paginado,
por nombre, sesión opcional como E2-H4, sin caché). Solo salen los packs vigentes hoy en hora de
Chile, con el artículo activo, imagen y todos sus componentes activos (formato, producto y marca).
Visitante, cliente y personal ven solo los generales con los dos precios, sin leer el mayorista; el
profesional ve además los exclusivos (solo con mayorista) y recibe `precioMayorista` y `exclusivo`
(`precio` en `null` si es exclusivo). Un pack general con un componente cuyo producto pasó a
exclusivo deja de mostrarse. Cada pack trae `vigenteHasta` y sus componentes (producto, formato,
cantidad). La disponibilidad (componente más escaso) no se muestra, igual que en los productos.
Decisiones del 26 oct (E2-H3): el detalle es `GET /api/tienda/productos/:id` y
`GET /api/tienda/packs/:id`, con sesión opcional como E2-H4 y sin caché. Se ve con la **misma
regla del listado** (`productoALaVenta`, `packsGenerales` y `packsProfesional`): lo que el listado
no muestra a ese rol (inactivo, sin formato vendible, de marca desactivada, fuera de vigencia o
exclusivo para quien no es profesional) responde 404, sin revelar que existe. El producto trae sus
formatos vendibles (el predeterminado primero), cada uno con todas sus imágenes (la principal
primero), su precio con IVA y su `disponibilidad`; el pack, lo mismo que en el listado más sus
imágenes y su `disponibilidad`. El profesional recibe además el mayorista, como en E2-H4.
**Stock vendible:** la suma de EXISTENCIA en ubicaciones activas de bodegas activas con
`abasteceVentaOnline` (`EXISTENCIA_VENDIBLE`, `src/modulos/catalogo/disponibilidad.ts`). La
disponibilidad es `DISPONIBILIDADES`: `disponible` con al menos una unidad, `agotado` si no; no se
informa cuántas unidades hay. La de un pack es la de su componente más escaso contando las
unidades que lleva: `min(floor(stock / cantidad))`. **El carrito y el pedido (E5) deben rechazar
un artículo agotado** usando `stockVendible`, `unidadesDePack` y `disponibilidad` de ese archivo
(criterio 2 de E2-H3); `stockVendible` acepta el cliente de una transacción. Consecuencia
aceptada del criterio 3: cruzando un formato con los packs que lo llevan (p. ej. 3 unidades) se
deduce un umbral de stock (0, 1-2, 3 o más), nunca la cifra exacta.

**E11 Inventario.** Sin lotes. Stock por formato y ubicación (EXISTENCIA). El stock nunca queda bajo
cero ni cambia sin un MOVIMIENTO que lo explique. Entrada: proveedor, documento y detalle (un
formato una sola vez por entrada) → suma stock y crea un movimiento por formato ligado a la entrada.
Salidas que no son venta: merma por vencimiento, merma por daño, consumo en la peluquería. Ajustes
y transferencias. La venta descuenta siguiendo el orden del código de ubicación; un pack descuenta
de sus componentes; la cancelación reingresa. Bajo el stock mínimo: aviso en el panel y correo a
bodegueros y administradores.
Decisiones del 25 oct (E11-H2): `POST /api/inventario/entradas` con `inventario.registrar`. La
entrada trae proveedor (activo), fecha de recepción (no posterior a hoy en Chile), documento del
proveedor (`TIPOS_DOCUMENTO_PROVEEDOR`: `factura` o `guia_despacho`, solo como respaldo; no se emite
nada), número, **una ubicación de destino para toda la entrada** (activa, de bodega activa) y, por
formato (una vez, hasta 200 por entrada), cantidad entera > 0 y costo unitario neto ≥ 0 (se admite
0). El número de documento se guarda sin espacios y en mayúsculas, y el mismo documento (proveedor,
tipo y número) no se registra dos veces: 409 por un índice único nuevo en `entrada_inventario`
(cambio al MER). Si la suma pasaría el máximo de `existencia.cantidad` (int4), 400 sin cambios. Un formato desactivado sí se puede recibir. En una
transacción: entrada + detalle, stock sumado con `INSERT ... ON CONFLICT` en EXISTENCIA y un
movimiento `TIPOS_MOVIMIENTO.ENTRADA` por formato con `id_entrada` y ubicación de destino.
PENDIENTE: ninguna historia crea bodegas ni ubicaciones (ni las comunas que la bodega exige).
Decisiones del 25 oct (E11-H3): `POST /api/inventario/salidas` con `inventario.registrar`. Una
salida es de **un formato en una ubicación**, con tipo (`TIPOS_SALIDA`: `merma_vencimiento`,
`merma_dano` o `consumo_peluqueria`), cantidad entera > 0 y observación opcional (hasta 500). Se
admiten formatos, ubicaciones y bodegas desactivados: su stock físico también vence o se daña. En
una transacción: el stock se descuenta con condición atómica (`cantidad >= n`) y se crea un
movimiento con el tipo de la salida y `id_ubicacion_origen`. Si la ubicación no tiene stock
suficiente (o no tiene existencia del formato), 400 indicando cuánto hay, sin cambios. Sin
cambios al MER: la salida es solo el MOVIMIENTO.
Decisiones del 25 oct (E11-H4): `POST /api/inventario/ajustes` y
`POST /api/inventario/transferencias`, ambos con `inventario.registrar`. El **ajuste** es de un
formato en una ubicación, con la diferencia **con signo** (entero distinto de 0: positiva suma,
negativa descuenta) y un **motivo obligatorio** (hasta 500) que queda en la observación del
movimiento. Positivo: suma con `INSERT ... ON CONFLICT` (crea la existencia; 400 si pasaría el
máximo de int4) y movimiento `ajuste_positivo` con `id_ubicacion_destino`. Negativo: descuenta con
condición atómica (400 indicando cuánto hay si no alcanza) y movimiento `ajuste_negativo` con
`id_ubicacion_origen`. La cantidad del movimiento siempre es positiva. Se admiten formatos y
ubicaciones desactivados, como en las salidas. La **transferencia** mueve una cantidad entera > 0
de un formato de un origen a un destino distinto (400 si son el mismo), de la misma bodega o de
otra; el destino debe ser una ubicación activa de bodega activa y el origen puede estar
desactivado (para vaciarlo). En una transacción: descuento atómico en el origen (400 sin cambios
si no alcanza), suma en el destino y **un** movimiento `transferencia` con ambas ubicaciones y
observación opcional (hasta 500). Las existencias se tocan en orden de id de ubicación, para que
dos transferencias cruzadas simultáneas no se bloqueen. Sin cambios al MER.
Decisiones del 27 oct (E11-H5): `GET /api/inventario/stock/formatos/:id` con `inventario.consultar`
(administrador, vendedor y bodeguero; el vendedor también ve el costo). Devuelve el formato, las
ubicaciones **con stock > 0** (también las desactivadas o de bodega desactivada, con `activa` en
falso), el total y la última entrada: proveedor y costo unitario neto de la entrada de **fecha de
recepción** más reciente (empate: la registrada después, id mayor); sin entradas, `null` y total 0.
Un formato desactivado se consulta; uno inexistente o un id imposible, 404. Solo lectura desde
PostgreSQL, sin caché. Sin listado de formatos en esta historia. Sin cambios al MER.
Decisiones del 28 oct (E11-H6): se compara el **stock total** del formato (todas sus ubicaciones,
también las desactivadas) con `stock_minimo`. El correo sale solo cuando un movimiento lo hace
**cruzar** (antes ≥ mínimo, después < mínimo); los movimientos siguientes, ya bajo el mínimo, no lo
repiten. Con mínimo 0 nunca hay aviso. Hoy lo revisan la salida y el ajuste negativo (la venta lo
hará con `StockBajoService`); la transacción bloquea la fila del formato (`FOR NO KEY UPDATE`, que
no choca con los INSERT con llave foránea al formato de transferencias y entradas) antes del
descuento, para que dos movimientos simultáneos no repitan ni pierdan el aviso. Los correos de un
aviso se encolan juntos (`addBulk`), con un solo plazo de espera si Redis no responde. En la misma
transacción se crea una NOTIFICACION `TIPOS_NOTIFICACION.STOCK_BAJO` (`pendiente`) por cada
bodeguero y administrador **activo con el correo confirmado**, y el trabajo `stock-bajo` se encola
después del commit. El aviso del panel no se guarda: `GET /api/inventario/stock/bajo-minimo` con
`inventario.registrar` (bodeguero y administrador; **el vendedor no lo ve**) calcula al consultar
los formatos con mínimo > 0 y total bajo él, con el faltante, del que más falta al que menos; un
formato sale de la lista al reponerlo. Sin cambios al MER.
Decisiones del 28 oct (E11-H7): sin rutas propias. `VentaStockService` (exportado por
`InventarioModule`) lo llaman, **dentro de su propia transacción**, la creación del pedido (E5)
con `descontarPorPedido(tx, pedidoId, lineas)` y la cancelación (E6-H3, E8-H3) con
`reingresarPorPedido(tx, pedidoId, usuarioId | null)`; los avisos de stock bajo que devuelve el
descuento se encolan con `encolarAvisos` después del commit. Un pack se descuenta de sus formatos
(cantidad del componente × packs) y un formato que llega suelto y dentro de un pack se suma. La
venta descuenta **solo stock vendible** (`EXISTENCIA_VENDIBLE`, lo mismo que la tienda muestra
disponible), agotando cada ubicación en orden de **código** (desempate: id de ubicación) con
condición atómica, y deja un movimiento `TIPOS_MOVIMIENTO.VENTA` por formato y ubicación con
`id_pedido`, `id_ubicacion_origen` y sin usuario (el comprador está en el pedido). Si un formato
no alcanza responde 409 «No hay stock suficiente de <producto formato>» (sin decir cuánto hay) y
la transacción entera se revierte. Los formatos se bloquean en orden de id (`stockAntes` de
E11-H6) y sus existencias en orden de id de ubicación, como las transferencias. El reingreso
bloquea la fila del pedido, devuelve lo vendido menos lo ya reingresado a **la misma ubicación de
donde salió** (aunque esté desactivada) con un movimiento `TIPOS_MOVIMIENTO.REINGRESO` con
`id_ubicacion_destino` y quien cancela (`null` si es automática); llamarlo otra vez no reingresa
dos veces. La validación previa del pedido (agotado, rol) sigue siendo de
E5; como defensa, el servicio responde 400 si una cantidad no es un entero mayor que 0 o si las
unidades de un formato pasarían el máximo de int4, y 409 si un artículo no existe o es un pack sin
componentes. El resultado del descuento es interno (ubicaciones, stock y correos del personal):
nunca va en la respuesta al comprador. Sin cambios al MER.

**E5 Carrito y compra.** Carrito del visitante en el navegador; se une al de la cuenta al iniciar
sesión. Un carrito por cuenta; el carrito no guarda precios. El pedido exige sesión y correo
confirmado, rechaza si falta stock o el artículo no se vende a esa cuenta, y un doble clic crea un
solo pedido (clave de idempotencia). Al crearlo se reserva el stock (se descuenta con movimiento de
venta) y hay **15 minutos** para pagar (`PLAZO_PAGO_MINUTOS`; el plazo lo lleva una cola, con
`fechaExpiracionPago` de respaldo). El profesional compra al precio mayorista desde una unidad, sin
mínimo por formato (cambio de la clienta, SCRUM-146: ver E5-H4).

Decisiones del 27 oct (E5-H1): `GET /api/carrito`, `POST /api/carrito/items`, `PATCH` y `DELETE
/api/carrito/items/:articuloId` (id del artículo de venta), solo para cliente y profesional con
sesión (el personal recibe 403). El carrito guarda solo artículo y cantidad; cada consulta recalcula
precio (con la misma `precioConIva` de la tienda; el mayorista solo se lee para el profesional,
RNF-04), subtotales y total. Agregar suma a las unidades que ya había. Cada escritura bloquea la
cuenta (`bloquearCuenta`) y responde con el carrito completo. Al consultar, una línea con más
unidades que el stock vendible (el de E2-H3, un pack por su componente más escaso) sale con
`stockSuficiente: false` e `impideCrearPedido: true`, y el carrito con `puedeCrearPedido: false`;
nunca se informa cuántas unidades hay (decisión de E2-H3). **PROPUESTAS por confirmar:** (1) agregar o cambiar con más unidades que el stock se rechaza con 400 en vez de aceptar
y señalar; (2) un artículo que deja de venderse (desactivado, sin precio, pack vencido o exclusivo
tras perder el rol) queda en el carrito sin precio, fuera del total y señalado, y solo se puede
quitar; (3) tope de 999 unidades por línea. El stock se revisa por línea: la suma entre packs y
formatos que comparten componentes la valida el pedido (E5-H3, SCRUM-45). Ya no hay mínimo de
unidades para el profesional (E5-H4, SCRUM-146). Sin cambios al MER.
Decisiones del 28 oct (E5-H2): el carrito del visitante vive en el navegador y la API no lo guarda.
`POST /api/carrito/cotizar` es **pública** y solo calcula: recibe `{ articulos: [{ articuloId,
cantidad }] }` y responde con la forma de `GET /api/carrito`, siempre como visitante (minorista,
solo generales, sin leer el mayorista aunque llegue un token). Un artículo que no se vende sin
cuenta (inexistente, desactivado, exclusivo...) sale con `aLaVenta: false` y sin `tipo`, nombre ni
imagen, para no revelar si existe. Al iniciar sesión, el frontend llama `POST /api/carrito/unir`
(cliente y profesional; personal 403) con la misma lista y después vacía el carrito del navegador.
La unión bloquea la cuenta, crea el carrito si no hay, **suma** las unidades de un artículo que ya
estaba, descarta lo que la tienda no vende a esa cuenta o está agotado y deja en 999 una suma que
pasa del tope. **No recorta al stock** (auditoría del 28 oct: devolver la cantidad recortada
revelaba cuántas unidades hay): la línea queda con `stockSuficiente: false` e
`impideCrearPedido: true`, como en `GET /api/carrito`. Cada caso va en `ajustes`
(`AJUSTES_UNION_CARRITO`: `no_disponible`, `agotado`, `cantidad_ajustada`). La lista lleva de 1 a
50 artículos distintos con cantidades de 1 a 999 (400). `cotizar` tiene un límite de 60 por
minuto por IP (`LIMITES.COTIZAR_CARRITO`, RNF-09): frena sondear el stock probando cantidades sin
cuenta. Sin cambios al MER.
Decisiones del 30 oct (E5-H3): `POST /api/pedidos` (cliente y profesional; personal 403) recibe
`claveIdempotencia` (UUID), `tipoEntrega`, `tipoDocumento`, `direccionId` (obligatoria con despacho,
rechazada con retiro) y `datosFacturacionId` (con factura, ver E9-H1; rechazado con boleta; activo).
Una dirección o datos de otra cuenta responden 404. Responde 201 con la forma del detalle de E8-H1.
**Cambio al MER:** `pedido.clave_idempotencia` (nullable), única por cuenta. Con la cuenta bloqueada,
repetir la clave devuelve el mismo pedido (201); el pedido **vacía el carrito** en la misma
transacción. Contra agotar el stock con reservas sin pagar: **5 solicitudes por minuto por cuenta**
(`LIMITES.CREAR_PEDIDO`, 429) y **un solo pedido `pendiente_pago` por cuenta**: con otra clave
responde 409, también si su plazo ya venció y aún no se cancela (lo libera E6-H3 o el personal al
cancelarlo). Correo sin confirmar: 403. Artículo que ya no se vende: 409 con su nombre. Sin stock: 409 de `VentaStockService`,
que suma formatos sueltos y en packs y nombra el formato (también si viene de un pack). Los montos se
suman **por línea** (`montosPorLineas`): el total es el del carrito y el IVA puede diferir unos pesos
de aplicar la tasa al neto total. La línea guarda el neto vigente y su tipo de precio. El despacho se
crea con `estado_envio = pendiente` y el costo que cotiza E7-H2 (SCRUM-51). **Pendiente de otras historias:** la
cancelación por impago es de E6-H3 (SCRUM-49), que toma el plazo desde `fechaExpiracionPago`: esta
historia no encola el trabajo. No envía correo al cliente.
Decisiones del 1 nov (E5-H4, SCRUM-146): cambio de último minuto de la clienta, que **reemplaza** el
mínimo de 3 unidades por formato que se había definido el 30 oct (SCRUM-46). El profesional verificado
compra cualquier cantidad (desde 1 unidad) de un formato o de un pack y se le guarda el precio
mayorista en cada línea. `POST /api/pedidos` ya no responde 409 por unidades mínimas ni nombra
formatos que no alcanzan. El carrito de la cuenta ya no trae el campo `bajoMinimo` en sus líneas:
`impideCrearPedido` y `puedeCrearPedido` dependen solo de que el artículo siga a la venta y de que
el stock alcance. Se eliminó la variable de entorno `MINIMO_UNIDADES_PELUQUERO`. El requerimiento
RF-05.10 vive fuera de este repositorio: hay que actualizarlo en el documento de requerimientos.
Sin cambios al MER.

**E6 Pago.** Solo Mercado Pago. La notificación se responde de inmediato y se procesa en la cola
`eventos-pago` (RNF-15: MP espera 22 s). Cada evento se procesa una vez (`idEventoExterno` único).
Reintentos; al agotarlos queda marcado para revisión humana. Un solo pago aprobado por pedido y por
el total. Sin pago a los 15 minutos: se cancela y se libera el stock, **pero antes se aplican los
pagos recibidos** (RNF-29). Correo al recibir el pago. Sin reembolsos.
Decisiones del 30 oct (E6-H1): **Checkout Pro** con el SDK oficial `mercadopago`, envuelto en
`PasarelaPago` (sin `MERCADOPAGO_ACCESS_TOKEN` la app arranca y pagar responde 503). Valores nuevos
en `valores.ts`: `ESTADOS_PAGO` (`aprobado`, `rechazado`, `pendiente`; de Mercado Pago, `approved`
aprueba, `rejected` y `cancelled` rechazan y todo lo demás queda pendiente). Rutas para cliente y
profesional (`CompradorGuard`; personal 403; pedido de otra cuenta 404):
`POST /api/pedidos/:codigoPedido/pago` crea una preferencia por el **total del pedido** en CLP
(`external_reference` = código del pedido, `binary_mode`, vence en `fechaExpiracionPago`, regreso a
`URL_TIENDA/pedidos/:codigo/pago`) y responde `{ urlPago, pagarHasta }`; 409 si el pedido ya está
pagado, cancelado o con el plazo vencido. Tras un rechazo se puede pedir otra vez dentro del plazo.
`POST /api/pedidos/:codigoPedido/pago/confirmar` con `{ pagoId }` (el `payment_id` con que vuelve el
comprador): la API **consulta el pago a Mercado Pago** (nunca usa lo que manda el navegador) y lo
aplica con `AplicarPagoService`, que reutilizará la notificación de E6-H2. Responde
`{ estadoPago, pedido }` (detalle de E8-H1). La aplicación bloquea la fila del pedido; cada intento
es un PAGO (`id_transaccion_externa` = id de Mercado Pago, `medio_pago` = `payment_method_id`, sin
datos de la tarjeta). Aprobado por el total: PAGO `aprobado`, pedido `pagado` e historial sin
usuario, en una transacción. Rechazado o pendiente: queda el intento y el pedido sigue
`pendiente_pago`. El mismo pago otra vez no cambia nada. Pago de otro pedido o inexistente: 400.
Además (decididas por el responsable de la historia): (1) un aprobado con el plazo vencido se
aplica si el pedido sigue `pendiente_pago` (RNF-29: antes de cancelar se aplican los pagos
recibidos); (2) un **segundo pago aprobado**, o uno de un pedido cancelado, **no se registra** (409)
y queda una advertencia en el log para revisarlo a mano (registrarlo para revisión es de E6-H3);
(3) un aprobado por otro monto o moneda no se aplica (400). Límite (RNF-09): **10 solicitudes por
minuto por cuenta** en cada ruta (`LIMITES.PAGAR_PEDIDO`, 429): cada una consulta a Mercado Pago y
agotar la cuota del token dejaría sin pagar a todos. Sin cambios al MER.
Decisiones del 31 oct (E6-H2): `POST /api/pagos/notificaciones` es pública y la protege la firma
(`x-signature`, con `WebhookSignatureValidator` del SDK y `MERCADOPAGO_WEBHOOK_SECRET`). Sin firma
válida responde 401 y no guarda nada; sin el secreto, 503 para que Mercado Pago reintente. No se
limita la antigüedad de `ts`, porque Mercado Pago reintenta durante horas y repetir no tiene efecto.
Un aviso firmado que no es de pago responde 200 sin guardarse; uno de pago sin sus identificadores,
400. La URL y el secreto se configuran en el panel de Mercado Pago (sin `notification_url`).
Se guarda un EVENTO_PAGO (`id_evento_externo` = `id` del cuerpo; `contenido_recibido` solo con id,
tipo, acción e id del pago) y se responde 200 aunque Redis no responda. El worker de `eventos-pago`
consulta el pago a Mercado Pago y usa `AplicarPagoService`. `ESTADOS_EVENTO_PAGO`: `pendiente`,
`procesado` y `descartado` (reintentar no lo arregla: pago de otra tienda, otro monto, pedido
cancelado o ya pagado; queda la advertencia en el log; E6-H3 dejó en `revision_manual` los aprobados
no aplicados). Hasta 5 intentos
con espera exponencial desde 5 s (también si Mercado Pago aún no conoce el pago); al agotarlos sigue
`pendiente` con `intentos = 5` y **marcarlo para revisión es de E6-H3**. Un job repetible cada minuto
reencola los `pendiente` con menos de 5 intentos si Redis se cayó o se vació (RNF-29).
El correo nace en `AplicarPagoService`, cuando el pedido pasa a pagado, sea por el regreso del
comprador o por la notificación: NOTIFICACION `pago_confirmado` (pendiente) en la misma transacción
y trabajo `pago-confirmado` en la cola `correos` después del commit (`{ notificacionId, destinatario,
nombre, codigoPedido, montoTotal }`). Así sale una sola vez aunque Mercado Pago repita o cambie el
`id` del aviso. El texto y el envío son del worker de correos (E1-H6, SCRUM-78). Índice único parcial
`pago(id_pedido) WHERE estado = 'aprobado'` como respaldo del bloqueo del pedido: solo vive en la
migración, porque Prisma no lo declara en `schema.prisma`. Sin cambios a tablas ni columnas del MER.
Decisiones del 31 oct (E6-H3): sin rutas. Un job repetible de la cola `plazos`, cada 30 s (RNF-31),
toma los `pendiente_pago` con `fechaExpiracionPago` vencida, de a 100 y del más antiguo al más
reciente. La fecha vive en la base: si Redis se cae, la pasada siguiente los alcanza. Por cada pedido
**consulta a Mercado Pago** los pagos con su código (`external_reference`) y aplica los aprobados con
`AplicarPagoService` (RNF-29); si el pedido sigue pendiente, lo cancela en una transacción con la fila
bloqueada: reingreso sin usuario, historial sin usuario con el comentario «Plazo de pago vencido.» y
`estado_actual`. Decididas por el responsable de la historia: (1) si Mercado Pago no responde, da una
respuesta incompleta o no hay `MERCADOPAGO_ACCESS_TOKEN`, **no se cancela** y la pasada se corta hasta
la siguiente, porque no hay reembolsos; mientras tanto el stock y el pedido pendiente de la cuenta
siguen retenidos, igual que con Redis caído, porque la tarea no corre. **El cobro cierra 2 minutos
antes del plazo** (`pagarHastaDe`, `MARGEN_CIERRE_COBRO_MINUTOS`): con el plazo de 15, Mercado Pago
deja pagar hasta el minuto 13 (`expiration_date_to`), iniciar el pago responde 409 desde entonces y
`pagarHasta` informa esa hora, para que un pago de último momento alcance a figurar en la búsqueda
antes de cancelar; `fechaExpiracionPago` sigue siendo el minuto 15 y el atraso de RNF-31 corre desde
ahí. Un aprobado que llega en esos 2 minutos se aplica. (2) El
valor `ESTADOS_EVENTO_PAGO.REVISION_MANUAL` (`revision_manual`) marca lo que revisa una persona: el
evento `pendiente` con 5 intentos, que la revisión de cada minuto marca, y el pago **aprobado** que no
se pudo aplicar (otro monto, pedido cancelado o ya pagado). (3) Sigue `descartado` lo que no es de
esta tienda: un pago sin código o de un pedido inexistente. Además: un aprobado que no se puede
aplicar no impide cancelar, porque no cubre el pedido; si falla la cancelación de un pedido (por
ejemplo, si la ubicación superaría el máximo), queda en el log, se sigue con los demás y se reintenta.
**Pendiente:** el motivo solo queda en el log (guardarlo cambiaría el MER) y no hay pantalla ni ruta
de revisión. Un aprobado no aplicado en el regreso del comprador o durante esta consulta no crea
evento: se marca cuando llega su notificación; si no llega, solo queda la advertencia en el log. No
envía correo al cliente y no restaura el carrito. Sin cambios al MER.

**E7 Despacho.** Despacho a domicilio (cotiza Blue Express por comuna, peso y medidas; caché 15 min
de la cotización repetida) o retiro en tienda (sin costo). Región y comuna de la lista oficial. Si
Chilexpress no responde, se informa y se ofrece retiro. Costo del envío guardado neto.
Decisión del 26 oct: el courier es Chilexpress, no Blue Express (notas técnicas de E7-H2 y E7-H3).
Decisiones del 31 oct (E7-H1): la forma de entrega se elige en `POST /api/pedidos` (E5-H3), sin
endpoint propio. Retiro: sin `ENVIO` ni costo, y `direccionId` responde 400. Despacho: `direccionId`
obligatoria y de la cuenta (400 sin ella, 404 si es de otra); `ENVIO` guarda una copia de la dirección.
La cotización del criterio 2 se entrega en E7-H2 (SCRUM-51). Sin cambios al MER.
Decisiones del 31 oct (E7-H2): `GET /api/despacho/cotizacion?direccionId=` (cliente y profesional;
personal 403; 10 por minuto por cuenta, `LIMITES.COTIZAR_ENVIO`) responde `{ costo, totalCarrito,
total }` con IVA, **sin informar el servicio**. `POST /api/pedidos` vuelve a cotizar con el carrito de
la cuenta antes de abrir la transacción; con la cuenta bloqueada comprueba que la comuna y el bulto
sean los cotizados (409 si cambiaron). No consulta al courier con clave repetida, correo sin
confirmar, pedido pendiente, dirección ajena o carrito vacío. **Origen:** la primera bodega (por id)
activa con `abasteceVentaOnline`, hoy la central de Concepción; sin bodega responde 503. **Servicio:**
el más barato entre Prioritario, Express, Extendido, Extremos y Encomiendas Grandes (códigos 2, 3, 4,
5 y 41); Chilexpress lista al mismo precio servicios de logística de devolución, que no se cobran.
`envio.servicio` sí sale en el pedido, porque E7-H3 lo exige. **Bulto:** una unidad, con sus medidas
reales; varias, peso total y un cubo con el volumen total, redondeando el lado hacia arriba; un pack
va por sus formatos (comentario en SCRUM-51: si causa múltiples errores al comprar, se pide cambiarla
en un ticket nuevo). **Costo:** la tarifa se trata como IVA incluido; `costo_neto = tarifa / (1 + IVA)`
redondeado (`netoDesdeConIva`), y por el redondeo el cliente puede pagar un peso de diferencia.
**Sin respuesta** (error, plazo de 10 s, 5xx, sin `CHILEXPRESS_CLAVE_COTIZACION`): 503. **Sin
cobertura** (ningún servicio para esa comuna y bulto): 409. En ambos casos el mensaje ofrece retiro, no
se crea el pedido y el carrito no cambia. **Comunas:** `ineCountyCode` de Chilexpress no es el CUT; el
cruce se hizo por nombre y región y está en `codigos-chilexpress.ts`, así que la API de Cobertura no se
consulta al vender y su clave no es una variable de entorno. Con un artículo que ya no se vende, cotizar
responde 409, igual que crear el pedido. La región no se recibe en la API:
la indica el código CUT. **Caché:** 15 min en Redis por origen, destino, peso y medidas; solo la tarifa
del courier, sin precios de productos ni datos de cuentas; sin Redis se consulta directo. Se envía
`declaredWorth: 0`: es obligatorio y en el sandbox no cambió la tarifa. Sin cambios al MER.
Decisiones del 1 nov (E7-H3): la orden de transporte se crea fuera de la API y **el personal ingresa su
número** en `POST /api/pedidos/:codigoPedido/estado` (`codigoSeguimiento`, solo dígitos, hasta 15, porque
Chilexpress lo recibe como número JSON).
Es obligatorio al pasar a despachado y en otro cambio responde 400; esto reemplaza lo que E8-H2 dejó sin
exigir. `ESTADOS_ENVIO`: `pendiente`, `en_transito`, `en_reparto`, `entregado`, `con_problema`. Al
despachar queda `en_transito`; el pedido lo devuelve en `envio` (E8-H1). **Consulta:** un job repetible
cada 30 min en su propia cola, `seguimiento-envios`, para que un courier lento no atrase la cancelación
por impago (RNF-31). Revisa los pedidos despachados con código; un estado desconocido no cambia el valor
y queda en el log, y si Chilexpress no responde se conserva el último estado. Cada actualización bloquea
la fila del pedido, igual que los cambios del personal.
**Entrega:** si Chilexpress la informa, en una transacción quedan entregados el envío y el pedido, el
historial sin usuario y la NOTIFICACION; el correo se encola después. **Correcciones:** volver de despachado
a en preparación borra el código y deja el envío `pendiente`; marcar entregado a mano deja el envío
`entregado`; volver de entregado a despachado lo deja `con_problema`. Un pedido que ya estuvo entregado no
se vuelve a consultar, aunque se le ingrese otro código: lo cierra el personal. Sin cambios al MER.
**Tracking:** `POST /transport-orders/api/v1.0/tracking` con `CHILEXPRESS_CLAVE_ENVIOS` y
`CHILEXPRESS_RUT_EMPRESA`; sin alguna de las dos, los envíos conservan el último estado. Se usa el evento
conocido más reciente por `code.eventCode`: 4 y 11 `en_transito`, 13 `en_reparto`, 14 `entregado`. Son los
únicos códigos que muestra la documentación. **`statusCode` -41** (OT no disponible): sigue con el siguiente
envío. Otro rechazo de esa OT o una respuesta ilegible queda en el log y también sigue con el siguiente; la
pasada se corta solo ante una falla general (red, plazo, 5xx, 401, 403, 429). El código no puede ser cero.
**OT:** cada una es de un solo pedido (`envio.codigo_seguimiento` es único; el equipo lo pidió el 1 nov):
repetirla responde 409 y volver el pedido a en preparación la libera. Sin ceros a la izquierda, porque `0123`
y `123` serían la misma OT. **Referencia:** el personal crea la OT con `pedido.codigo_publico` como
referencia, y ese valor se envía como `reference`. Cambia el MER: agrega la restricción de unicidad.
**PENDIENTE:** (1) `con_problema` no tiene código de Chilexpress conocido, así que hoy solo lo asigna la
corrección del personal. (2) Falta probar contra el sandbox con una OT real.

**E9 Facturación.** Boleta: el comprobante de Mercado Pago. Factura: el cliente elige uno de sus
datos de facturación; el personal registra la factura emitida en el SII con folio (único por tipo)
y archivo; el documento guarda copia de los datos del receptor y de los montos.
Decisiones del 27 oct (E9-H2): `GET`, `POST`, `PATCH /:id` y `DELETE /:id` en
`/api/cuentas/yo/facturacion`, solo para cliente y profesional (`CompradorGuard`; el personal
recibe 403). Cada registro lleva RUT (se guarda como `12345678-K`, con dígito verificador
válido), razón social (hasta 150), giro (150), dirección (200) y comuna (código CUT, que el MER
exige para copiarla al documento), más un correo de facturación opcional. Falta cualquiera de
los obligatorios: 400 y el mensaje nombra cada dato que falta. Una cuenta tiene tantos registros
como quiera y `GET` devuelve los activos, del más antiguo al más reciente. Los registros se
identifican por su id dentro de la cuenta del token (el de otra cuenta, o uno ya eliminado,
responde 404). `DELETE` lo **desactiva** (`activo = false`) en vez de borrarlo, porque los
pedidos lo referencian. Los cambios y las altas toman `bloquearCuenta`, como las direcciones.
PROPUESTAS por confirmar: (1) la historia solo pide guardar y consultar; editar y eliminar se
agregaron porque en el RF-09.02 dice administrar. (2) El mismo RUT puede repetirse en varios
registros de la cuenta (una empresa con sucursales); no hay límite de registros. (3) El RUT de
facturación puede ser distinto del RUT personal de la cuenta (E1-H5) y no se compara con él.
Decisiones del 31 oct (E9-H3): `POST /api/pedidos/:codigoPedido/factura` con `facturacion.gestionar`
(permiso nuevo, solo administrador y vendedor; bodeguero, cliente y profesional reciben 403 y sin
sesión 401). El equipo lo confirmó el 31 oct, junto con el PDF de hasta 4 MB, la fecha de emisión
opcional, el archivo privado y el estado `emitido`. Es
`multipart/form-data`: el PDF en el campo `archivo`, el `folio` (entero positivo que cabe en la
base) y, opcional, la `fechaEmision` (AAAA-MM-DD, no futura; sin ella, hoy en la zona horaria de la
tienda). El PDF se reconoce por su contenido, no por la extensión. Un código inexistente o mal
formado, 404; sin PDF, un archivo que no es PDF, folio o fecha inválidos o campos de más, 400; un
PDF de más de 4 MB, 413; el almacén sin configurar o caído, 503. 409 si el pedido pidió boleta,
no está pagado (pendiente de pago o cancelado; cualquier estado posterior sirve), ya tiene una
factura vigente (`id_documento_anulador` nulo) o el folio ya existe entre las facturas. En **una
transacción** bloquea la fila del pedido (`FOR NO KEY UPDATE`) y crea el `DOCUMENTO_TRIBUTARIO`
(`tipo` factura, `estado` `emitido`) con una copia de los datos del receptor (RUT, razón social,
giro, dirección y nombre de la comuna) y de los montos del pedido: no cambian si después se
edita o se desactiva el dato de facturación. El PDF se sube **antes** de la transacción, en la
clave `facturas/<id del pedido>/<uuid>.pdf`, y se borra si la base no lo registra (folio repetido
a la vez, error). Responde 201 `{ codigoPedido, tipo, folio, fechaEmision, estado }` y no revela
la clave del archivo. El PDF es privado (`Cache-Control: private, no-store`): no se publica con URL;
lo entregará solo la API al dueño del pedido (E9-H4). El MER no define los valores de `estado` del
documento: por ahora solo `emitido` (`ESTADOS_DOCUMENTO`), y más adelante se podrían fijar más.
PROPUESTAS por confirmar (se las presentó al equipo sin objeciones): (1) Un pedido tiene una sola
factura vigente; reemplazarla o anularla (nota de crédito) queda fuera de la historia. (2) Se puede
registrar con el pedido en cualquier estado posterior a pagado. (3) La boleta no se registra aquí:
es el comprobante de Mercado Pago (E9-H1). Cambio a la matriz de permisos del 19 oct (E13-H2): se
agrega `facturacion.gestionar` para vendedor y administrador. Sin cambios al MER.
Decisiones del 31 oct (E9-H4): `GET /api/pedidos/:codigoPedido/documento` solo para cliente y
profesional (`CompradorGuard`; el personal recibe 403, sin sesión 401) y siempre sobre un pedido
de la cuenta del token: el de otra cuenta, uno inexistente o con un código mal formado responde
404. Entrega el PDF de la factura vigente (`id_documento_anulador` nulo y con archivo) como
descarga (`Content-Type: application/pdf`, `Content-Disposition: attachment;
filename="factura-<folio>.pdf"`, `Cache-Control: private, no-store`, `X-Content-Type-Options:
nosniff`): la API lo lee de R2 con `AlmacenArchivos.obtener` y nunca devuelve una URL ni la clave
del archivo. Si la factura aún no se registra, 404 «El documento del pedido aún no está
disponible.» sin archivo; si R2 no está configurado o no responde, 503 sin detalles del error. El
detalle del pedido (`GET /api/pedidos/:codigoPedido`, E8-H1) suma el campo `documento`: si el
pedido pidió factura, `{ tipo: 'factura', estado, folio, fechaEmision }` con `estado` `pendiente`
(folio y fecha en `null`) o `disponible`; si pidió boleta, o está cancelado y sin factura, `null`.
El equipo lo confirmó el 1 nov: el campo `documento` y su `null` para la boleta, el 404 del
documento pendiente y que la boleta se vea en E9-H1. Además pidió que **vendedor y administrador**
también puedan descargar: `GET /api/pedidos/:codigoPedido/factura` con `facturacion.gestionar`
(bodeguero, cliente y profesional reciben 403, sin sesión 401), para cualquier pedido y con el mismo
PDF, encabezados y errores (404 pedido inexistente, mal formado o factura pendiente o anulada; 503
almacén). Un correo al cliente cuando se registre la factura se mencionó como idea («quizás»): no
es parte de esta historia ni de E9-H3, y queda como posible mejora junto al worker de correos.
PROPUESTAS por confirmar: (1) Los valores `pendiente` y `disponible` (la historia solo pide
«indicar que está pendiente»). (2) La boleta no se descarga aquí: es el comprobante de Mercado Pago
(E9-H1) y su presentación se decide allí. Sin cambios al MER.
Decisiones del 1 nov (E9-H1): se elige en `POST /api/pedidos` (E5-H3). **Boleta:** no crea
`DOCUMENTO_TRIBUTARIO`; el comprobante lo emite Mercado Pago y la API guarda su referencia,
`pago.id_transaccion_externa`, que ya registra E6-H1. El detalle del pedido suma
`idTransaccionPago`: ese id con boleta y pago aprobado; `null` si pidió factura o aún no hay pago
aprobado. No se guarda archivo ni URL del comprobante. **Factura:** con `datosFacturacionId` de un
registro activo de la cuenta, lo asocia al pedido. Sin ningún registro activo en la cuenta (también
si todos están desactivados), con o sin id, 409 «Debes registrar tus datos de facturación antes de
pedir factura.». Con registros activos: sin id, 400; con un id ajeno o desactivado, 404. Por eso el
DTO deja pasar la factura sin id: solo el servicio conoce la cuenta, y lo revisa con ella bloqueada.
Con despacho, la cotización va antes de la transacción: si Chilexpress no responde, el 503 llega
antes que este 409. PROPUESTAS por confirmar: (1) Mostrar solo el id de transacción como
presentación de la boleta, que E9-H4 dejó para esta historia. (2) El código 409, que la historia no
define. Sin cambios al MER.
Decisión del 6 nov (SCRUM-150), para cuando se haga SCRUM-55 (panel de facturas, `GET /api/gestion/facturas`): el estado de la factura de cada pedido es `ESTADOS_FACTURA_GESTION` (`por_emitir` o `emitida`), deducido de si ya tiene su documento registrado; sin factura registrada, el campo `factura` viene `null`.

**E8 Pedidos.** Estados: pendiente de pago, pagado, en preparación, despachado, entregado, listo
para retiro, retirado, cancelado (`ESTADOS_PEDIDO`). Cada cambio guarda fecha, quién y comentario,
y avisa por correo. Solo el personal cancela, y solo pedidos pendientes de pago; el cliente no.

Decisiones del 28 oct (E8-H3): `POST /api/pedidos/:codigoPedido/cancelar` con `pedidos.gestionar`
(administrador, bodeguero y vendedor); cliente y profesional reciben 403 y sin sesión 401. Cuerpo
opcional `{ comentario }` (hasta 500 caracteres, se recorta). En **una transacción**: bloquea la
fila del pedido (`FOR NO KEY UPDATE`) antes de mirar su estado, devuelve el stock con
`VentaStockService.reingresarPorPedido(tx, pedidoId, usuarioId)` a nombre de quien cancela, agrega
al historial el cambio `cancelado` (siguiente correlativo, con quién y el comentario) y cambia
`estado_actual`. Solo se cancela un pedido `pendiente_pago`; cualquier otro estado (pagado, en
preparación, ya cancelado…) responde 409 «Solo se puede cancelar un pedido pendiente de pago.», y
un código inexistente o mal formado, 404. Dos cancelaciones simultáneas: una gana y la otra recibe
409; el stock vuelve una sola vez. Responde `{ codigoPublico, estado }`. Si el stock no se puede
devolver (la ubicación superaría el máximo permitido) responde 409 y no cambia nada. **El pago
(E6-H2) debe bloquear la fila del pedido de la misma forma** antes de aplicar un pago, para que
pago y cancelación no se pisen. PROPUESTA por confirmar: esta historia no envía correo al cliente;
el aviso por cambio de estado (RF-08.03) lo define E8-H2 (SCRUM-58), y la cancelación automática
por impago (E6-H3) reutilizará este mismo reingreso. Sin cambios al MER.

Decisiones del 29 oct (E8-H2): `POST /api/pedidos/:codigoPedido/estado` con `pedidos.gestionar`
(administrador, bodeguero y vendedor); cliente y profesional reciben 403 y sin sesión 401. Cuerpo
`{ estado, comentario? }` (el comentario, hasta 500 caracteres, se recorta). En **una transacción**:
bloquea la fila del pedido (`FOR NO KEY UPDATE`) antes de mirar su estado, agrega al historial el
cambio (siguiente correlativo, quién y comentario) y cambia `estado_actual`. Responde
`{ codigoPublico, estado }`. Un código inexistente o mal formado, 404; un estado que no existe o un
comentario inválido, 400; un cambio que la secuencia no permite, 409 «No se puede cambiar un pedido
de «X» a «Y».». Dos cambios simultáneos: uno gana y el otro recibe 409. El equipo pidió **poder
volver atrás** y **avisar por correo solo los cambios clave**, para no llenar de correos al cliente.
PROPUESTAS por confirmar (la historia no define la secuencia): (1) Avanzar: pagado → en preparación
→ despachado → entregado, o, si el pedido es retiro en tienda, en preparación → listo para retiro →
retirado. (2) Volver atrás de a un paso por el mismo camino (en preparación → pagado, despachado →
en preparación, entregado → despachado, listo para retiro → en preparación, retirado → listo para
retiro) con comentario obligatorio (400 si falta); nunca a pendiente de pago ni desde cancelado.
(3) Pasar a pagado es del pago (E6) y a cancelado de la cancelación (E8-H3): esta ruta no lo hace.
(4) Avisan al cliente solo despachado, listo para retiro, entregado y retirado
(`ESTADOS_CON_AVISO`; «en preparación» no), y solo al avanzar (el equipo lo confirmó el 30 oct).
Se guarda la NOTIFICACION `cambio_estado_pedido` (pendiente, con `pedidoId` y la cuenta
del comprador) en la misma transacción y el trabajo `cambio-estado-pedido` se encola en la cola
`correos` después del commit (`{ notificacionId, destinatario, nombre, codigoPedido, estado,
tipoEntrega }`); con Redis caído el cambio igual se guarda (RNF-32). El texto y el envío del correo
son del worker de correos (E1-H6, SCRUM-78, a cargo de Ana). (5) El comentario es una nota interna:
no va en el correo. (6) No se exige el código de seguimiento al despachar ni se toca el estado del
envío: el código de seguimiento y el paso automático a entregado con Chilexpress son de E7-H3
(SCRUM-52). Sin cambios al MER.

**E4 IA.** Descripción sugerida e ingredientes desde la foto del reverso; nunca se publica sin
revisión; se guarda el origen: manual, IA o IA editada.
Decisiones del 2 nov (E4-H1): proveedor **Gemini Flash** (`@google/genai`, modelo en
`GEMINI_MODELO`, por defecto `gemini-2.5-flash`). Ruta `POST /api/catalogo/descripciones/sugerencia`
con `catalogo.gestionar`: recibe la foto (JPEG, PNG o WebP hasta 4 MB, campo `imagen`) y devuelve
`{ descripcion, ingredientes }` (`ingredientes` es `null` si la foto no los muestra). No guarda la
foto ni la sugerencia: aceptarla, editarla y registrar el origen es de E4-H2. Foto ilegible: 422;
IA caída, sin respuesta en 30 s (un solo intento) o sin `GEMINI_API_KEY`: 503. En ambos casos la
descripción se escribe a mano, y crear o editar productos nunca depende de la IA. Límite: 15/min por
cuenta (`LIMITES.SUGERIR_DESCRIPCION`). La clave es opcional, también en producción. El servidor
rechaza (503) una descripción de más de 1000 caracteres o ingredientes de más de 3000, aunque el
modelo los devuelva; en E4-H2 la sugerencia se guarda solo por el DTO del producto y se muestra
como texto plano. Sin cambios al
MER; ojo para E4-H2: PRODUCTO no tiene dónde guardar los ingredientes.
Decisiones del 2 nov (E4-H2): la sugerencia vuelve con `firma` (HMAC-SHA256 de la descripción
sugerida; la clave sale de `JWT_ACCESS_SECRET` con separación de dominio, sin variable nueva).
`POST /api/catalogo/productos` y `PATCH /api/catalogo/productos/:id` aceptan `sugerencia:
{ descripcion, firma }` cuando el texto partió de la IA: igual a la sugerida, origen `ia`; distinta,
`ia_editada`; sin `sugerencia` al crear, `manual`. Firma que no corresponde al texto sugerido: 400
sin cambios; en el PATCH, `sugerencia` sin `descripcion`: 400. PATCH de la descripción sin
`sugerencia`: se mantiene la regla de E3-H1 (`ia` que cambia pasa a `ia_editada`; `ia_editada` y
`manual` no cambian). La sugerencia sola nunca escribe nada: solo se guarda lo que el personal
envía al crear o editar. **Cambio al MER:** `producto.ingredientes` (texto opcional, hasta 3000;
en el PATCH `null` lo borra). Solo sale en las respuestas del panel; mostrarlo en la tienda no
está en la historia.

**E10 Verificación.** Requiere RUT. Flujo (cambio del 2 nov 2026, SCRUM-62 a 67): primero se
consulta el **inicio de actividades en el SII** y, si no aprueba, el cliente adjunta documentos
que revisa el personal. Ya no hay OCR (Google Cloud Vision) ni factores de confianza con puntaje.
Aprobación automática solo con el giro **960200** (Peluquería y otros tratamientos de belleza)
vigente; todo lo demás, o una consulta que falla, pide documentos (E10-H2) y va a revisión manual.
**El sistema nunca rechaza solo** (RNF-27). Rechazo manual exige motivo. Al aprobar: rol
`profesional` de inmediato y correo (E10-H4). Archivos se borran 30 días después de resuelta,
conservando la solicitud y el resultado de la consulta al SII (E10-H6). Por confirmar: la
detección del mismo documento (hash) en otra cuenta no aparece en las historias nuevas.

Decisiones del 2 nov (E10-H1, SCRUM-62): `POST /api/verificaciones` (sin cuerpo) y
`GET /api/verificaciones/yo`, solo para cliente y profesional. La consulta pasa por la interfaz
`ProveedorSituacionTributaria`; el proveedor es **Khipu** (`POST /v1/cl/services/sii.cl/tax-situation`,
clave en `KHIPU_API_KEY`, URL en `KHIPU_URL_BASE`), así se puede cambiar sin tocar el servicio.
La consulta es síncrona, con plazo de **10 s**; sin clave la app arranca, pero toda consulta falla y
se piden documentos. `SII_PROVEEDOR=simulado` es solo para desarrollo (último dígito del RUT:
0 sin actividades, 1 otro giro, 2 falla, otro peluquería) y la app no arranca con él en producción.
**Regla de aprobación:** alguna actividad con `Code` `960200` y `Date` ya cumplida; Khipu no trae un
campo de vigencia, así que «vigente» es «está en la lista del SII y su fecha de inicio ya pasó».
Una fecha que falta no aprueba. Estados: `aprobada` si aprueba (sin resolutor: la aprobó el
sistema); si no, `pendiente`, que significa «falta que adjunte documentos» (`requiereDocumentos`
en la respuesta), y `revision_manual` cuando los envíe (E10-H2). Se guarda en la solicitud la fecha
de la consulta, el resultado (`aprobado`, `sin_inicio_actividades`, `otro_giro` o `no_disponible`),
los giros recibidos, el proveedor y el id de la operación; quien solicita nunca los ve. **409** si
la cuenta no tiene RUT, ya es profesional, o tiene una solicitud `pendiente`, `revision_manual` o
`aprobada`; tras un rechazo puede enviar otra y se consulta de nuevo. La consulta se hace antes de
la transacción (no se espera a Khipu con la cuenta bloqueada); al registrar se bloquea la fila de la
cuenta, como al editar el RUT, y si el RUT cambió mientras tanto responde 409. Límite de 5 envíos
por hora por cuenta (`LIMITES.SOLICITAR_VERIFICACION`): cada consulta es una llamada que cobra
Khipu. Al aprobar, la cuenta pasa a profesional y se avisa por correo (E10-H4, ver abajo).
**Cambio al MER:** cinco columnas nuevas en
`solicitud_verificacion` (`fecha_consulta_sii`, `resultado_consulta_sii`, `giros_sii`,
`proveedor_consulta_sii`, `operacion_consulta_sii`). `puntaje_confianza`, `version_reglas`,
`resultado_factor_confianza` y los campos de OCR de `antecedente` quedan sin uso por el flujo
nuevo y no se eliminaron: decidirlo con el equipo.

Decisiones del 2 nov (E10-H2, SCRUM-63): `POST /api/verificaciones/yo/documentos` (multipart:
`archivos` de 1 a 5 y un `tipos` por archivo, en el mismo orden), solo para cliente y profesional,
sobre la solicitud más reciente de la cuenta, que debe estar `pendiente` (la verificación
automática no la aprobó). Pasa a `revision_manual`. **Tipos de documento (propuesta, por confirmar
con el equipo):** `titulo`, `certificado` (un certificado de curso vale) y `otro`; el inicio de
actividades ya no se adjunta porque se consulta al SII, y el carnet no se pide. PDF, JPG o PNG de
hasta 4 MB cada uno, reconocidos por su contenido y no por la extensión. Los archivos se suben
privados a `verificaciones/<cuenta>/<uuid>` antes de la transacción y se borran si la base no
llega a registrarlos. **409** si la solicitud ya fue aprobada, ya tiene documentos en revisión o fue
rechazada (hay que enviar una nueva, que vuelve a consultar al SII); **404** si la cuenta nunca
solicitó; **400** sin documentos, más de 5, formato inválido o tipos que no calzan; **413** sobre
4 MB. Cada antecedente guarda su hash SHA-256 y `estado_ocr` `no_aplica` (sin OCR, la columna
obligatoria queda con ese valor). El motivo por el que se piden documentos (sin inicio de
actividades, otro giro o consulta no disponible) ya está en `resultado_consulta_sii` de la
solicitud (E10-H1): el personal lo lee de ahí. La fila de la cuenta se bloquea, como al solicitar:
dos envíos a la vez no guardan dos veces los documentos. Límite de 5 envíos por hora por cuenta
(`LIMITES.ADJUNTAR_DOCUMENTOS`). `GET /api/verificaciones/yo` ahora incluye `documentos` (tipo y
nombre, nunca la ubicación ni el hash). Sin cambios al MER.

Decisiones del 3 nov (E10-H3, SCRUM-64): `POST /api/verificaciones/:codigoPublico/aprobar` (sin
cuerpo) y `POST /api/verificaciones/:codigoPublico/rechazar` (`{ motivo }`), con el permiso
`verificacion.gestionar`. `:codigoPublico` es el UUID de la **cuenta** (la solicitud no tiene código
público, RNF-07) y la ruta actúa sobre su solicitud más reciente, que debe estar `revision_manual`.
Guarda el estado, `resolutor` y `fecha_resolucion`; al rechazar, también `motivo_rechazo`.
**Motivo:** obligatorio, se recorta, de **10 a 1000** caracteres (vacío o en blanco: «El motivo del
rechazo es obligatorio.»). **404** si la cuenta no existe o nunca solicitó; **409** si la solicitud
está `pendiente` (aún sin documentos), `aprobada` o `rechazada`. **Aprobar** exige además que la
cuenta siga activa y con rol `cliente` (si la desactivaron o cambió de rol, 409 sin cambios), para
que E10-H4 no dé el precio mayorista a quien no corresponde; rechazar se permite siempre. Se bloquea la fila de la cuenta,
como al solicitar y al adjuntar, y el cambio exige `revision_manual` en la misma sentencia: dos
resoluciones a la vez aplican solo una, y la otra recibe 409. Al aprobar cambia el rol y se envía
el correo (E10-H4). Sin cambios al MER.

Decisiones del 3 nov (E10-H4, SCRUM-65): sin rutas nuevas. Toda aprobación, automática
(`POST /api/verificaciones`) o manual (`POST /api/verificaciones/:codigoPublico/aprobar`), deja en
la **misma transacción** la solicitud `aprobada`, el rol `profesional` y la NOTIFICACION
`verificacion_aprobada` pendiente (RNF-12); el correo se encola después del commit, con prioridad
de cuenta, y si Redis no responde la aprobación no falla (lo reencola la revisión de pendientes).
El rol cambia con una condición atómica (cuenta activa y `cliente`, con la fila ya bloqueada): si
no se cumple, 409 sin cambios. **Sesiones:** no se revocan (excepción de RNF-28 para el ascenso);
el frontend llama a `POST /api/cuentas/sesion/renovar`, que entrega el token con el rol
`profesional` y desde ahí el catálogo muestra el mayorista. **Correo:** diseño «Verificación
aprobada» de Figma, asunto «Tu cuenta profesional está activa», con tres cambios: un mismo texto
para la aprobación automática y la manual («Aprobamos tu verificación…», la automática no revisa
documentos); sin el recuadro de «al menos 3 unidades de cada formato» (ya no rige, SCRUM-146); y
sin «Completa tu perfil profesional» hasta que exista el perfil (RF-10.11). El botón «Ver precios
profesionales» lleva a `URL_TIENDA/catalogo` (**PROPUESTA** por confirmar con frontend). Si al
enviarlo o reencolarlo la cuenta está desactivada o ya no es profesional, queda `fallida`. Sin
cambios al MER.

Decisiones del 3 nov (E10-H7, SCRUM-147), todas con `verificacion.gestionar`:
`GET /api/verificaciones/revision-manual` (paginado con `pagina` y `limite`),
`GET /api/verificaciones/:codigoPublico` y `GET /api/verificaciones/:codigoPublico/documentos/:numero`.
Solo leen. **Listado:** las solicitudes en `revision_manual`, de la más antigua a la más reciente
(`fecha_solicitud`, luego id), con `codigoPublicoCuenta`, nombre, apellido, RUT, `fechaEnvio` y
`motivoRevision`, que sale de `resultado_consulta_sii`: `sin_inicio_actividades`, `otro_giro` o
`no_disponible` (la consulta falló). La «fecha de envío» es la de la solicitud: no se guarda cuándo se
adjuntaron los documentos. **Detalle:** `:codigoPublico` es el UUID de la cuenta y se muestra su
solicitud más reciente **en cualquier estado** (también una ya resuelta): datos de la cuenta (nombre,
RUT, correo, teléfono), estado, `resolutor`, motivo del rechazo (solo si fue rechazada), `consultaSii`
(fecha, resultado y los giros que informó el SII, `null` si falló), `documentos` (`numero` desde 1,
tipo, nombre y `fechaEliminacion`) y `solicitudesAnteriores` con su estado, fechas, resolutor y
motivo, de la más reciente a la más antigua. Nunca salen la ubicación del archivo ni su hash.
**Documento:** devuelve `{ url, venceEn, tipo, nombreArchivo }` con una URL firmada de R2 que vence a
los **60 segundos** (`SEGUNDOS_ENLACE_DOCUMENTO`) y abre el archivo en el navegador con su nombre; los
archivos siguen siendo privados. El equipo eligió la URL firmada (no entregar el archivo por la API) y
pidió un plazo corto: el enlace se abre sin sesión mientras vive, así que el frontend lo pide al
hacer clic y no lo guarda. El documento se identifica por su posición en la solicitud (no hay
código público, RNF-07). **404** si la cuenta no existe o nunca solicitó, o si no hay documento con ese
número; **410** con la fecha («El documento se eliminó el 02-12-2026.») si el archivo ya se borró
(E10-H6), sin enlace; **503** si R2 no está configurado. Los documentos solo se ven de la solicitud
más reciente: al abrir una nueva tras un rechazo, los de la anterior ya no se piden por la API.
Nueva dependencia `@aws-sdk/s3-request-presigner` (fijada en la misma versión que `client-s3`) y
nuevo método `AlmacenArchivos.urlTemporal`. Sin cambios al MER.

Decisiones del 4 nov (E10-H5, SCRUM-66): `PUT /api/perfil-profesional/yo` (crea o reemplaza el
perfil entero) y `GET /api/perfil-profesional/yo` (**404** si aún no lo completa). «Verificación
aprobada» es tener el rol `profesional`: el cliente y el personal reciben **403** y sin sesión,
**401**. Un cliente recién aprobado debe renovar la sesión para entrar. Al guardar, se bloquea la
fila de la cuenta y el rol se vuelve a leer de la base (profesional y activa). **Obligatorios:**
años de experiencia (entero de **0 a 40**), una modalidad de trabajo y al menos una especialidad,
sin repetir. **Opcionales:** `nombreLugarTrabajo` (texto, hasta 150) y `redSocial` (hasta 255; no
está en la historia y se agregó por decisión del equipo); `null`, un texto vacío o no enviarlos los
deja sin valor. `redSocial` solo acepta el enlace `https://` al perfil en **Instagram, Facebook o
TikTok**: el dominio debe ser exactamente `instagram.com`, `facebook.com` o `tiktok.com`, con o sin
`www` (`DOMINIOS_RED_SOCIAL`), sin usuario, clave ni puerto en el enlace, con una ruta al perfil y
sin espacios, comillas ni caracteres de control. Se revisa el texto y también cómo lo interpreta
`URL`, así `https://instagram.com@otro.sitio` no pasa. Un `@usuario` suelto, otros sitios, los
subdominios móviles (`m.facebook.com`) y los acortadores (`fb.com`, `vm.tiktok.com`) responden 400.
Así lo que se guarda y se muestra como enlace es siempre de esas redes y no permite XSS guardado. La comuna del perfil (`id_comuna`) no se pide aquí: se obtiene de otra
parte. Si falta un obligatorio, **400** con un mensaje por cada dato que falta y no se guarda nada.
**Modalidades y especialidades (PROPUESTA del 4 nov, por confirmar con la clienta):** las listas
`MODALIDADES_TRABAJO` (7) y `ESPECIALIDADES` (16) de `valores.ts`; una sola modalidad, sin opción
«otra» y fijas en el código. Siguen abiertas: modalidad múltiple (cambiaría RF-10.11 y el MER), la
opción «otra», listas editables desde el panel y su relación con la segmentación de campañas (E12).
Sin cambios al MER.

Decisiones del 5 nov (E10-H6, SCRUM-67): sin rutas nuevas. Una tarea programada (job repetible de
BullMQ en la cola `limpieza-verificaciones`, **cada hora**) borra de R2 los archivos de las
solicitudes `aprobada` o `rechazada` con `fecha_resolucion` de hace **30 × 24 horas o más** (justo
30 días ya se elimina; menos, o sin resolver, se conserva). Del antecedente solo se borra el
archivo: quedan `tipo`, `nombre_archivo`, `hash_archivo` y `ubicacion_archivo` (obligatoria), y se
registra `fecha_eliminacion_archivo`, desde la que E10-H7 responde 410. La solicitud, su resolución
y la consulta al SII no se tocan. Primero se borra en R2 y después se registra la fecha (con la
condición de que siga vacía): si la base falla, la pasada siguiente vuelve a borrar sin error; si
R2 falla con un archivo, se sigue con los demás y ese queda para la pasada siguiente. Sin R2
configurado la tarea no marca nada. Los logs nunca llevan la ubicación del archivo. Sin cambios al
MER.

**E12 Marketing.** Publicidad solo a quien la aceptó (cuenta activa con correo verificado o
suscriptor confirmado); el consentimiento se revisa de nuevo al enviar. Baja desde cualquier
correo, por dirección. Campaña con vista previa y confirmación; sale una vez y llega una vez a cada
dirección. Recordatorios de carrito a 1, 24 y 72 h, una serie por semana. Saludo de cumpleaños
anual. Registrar apertura, clic y rebote. Todo correo publicitario lleva remitente y enlace de baja
(RNF-26). Prioridad de correos: pedido y cuenta > suscripción > publicidad (RNF-16).
Decisiones del 3 nov (E12-H1): `POST /api/marketing/suscripciones` `{ email }` es pública y responde
**202** con el mismo mensaje para todo correo válido (no revela si ya estaba suscrito, pendiente,
dado de baja o con cuenta). Un correo nuevo crea LEAD con `activo = false`, `fecha_baja` nula y
`origen = 'formulario_web'` (`ORIGENES_LEAD`), y en la misma transacción una NOTIFICACION
`confirmacion_suscripcion` (con `id_lead`); el correo se encola después del commit con la
prioridad de suscripción, sin esperar la cola (un correo ya confirmado no se distingue por el tiempo
de respuesta). Si ya está confirmado no se envía nada; si está pendiente o dado de baja se reenvía
la confirmación sin tocar LEAD, **como máximo una cada 15 min por dirección**
(`LIMITE_CONFIRMACION_SUSCRIPCION`, contado en NOTIFICACION con la fila de LEAD bloqueada, así rige
desde cualquier IP y sin Redis). `POST /api/marketing/suscripciones/confirmar` `{ token }`
deja `activo = true`, `fecha_baja` nula y `fecha_suscripcion` en la fecha de confirmación; confirmar
dos veces responde lo mismo; enlace inválido o vencido, **400**. Como LEAD no guarda tokens, el enlace
va **firmado** (RNF-08): correo + emisión + vencimiento con HMAC-SHA256, con clave derivada de
`JWT_ACCESS_SECRET` con separación de dominio (sin variable nueva ni cambios al MER). Dura
`CONFIRMACION_CORREO_HORAS` (24 h). Un enlace emitido antes de una baja ya no la deshace. Límite de
5/min por IP en cada ruta (`LIMITES.SUSCRIPCION`). La revisión de pendientes (RNF-29) rearma el
enlace con la fecha de la notificación, con el mismo vencimiento. PROPUESTA por confirmar con
frontend: la pantalla de confirmación es `/suscripcion/confirmar?token=…`. El token va firmado pero
no cifrado: el correo se puede leer en la URL. Decisión del equipo del 3 nov (opción A): lo resuelve
frontend (SCRUM-138), con `Referrer-Policy: no-referrer` en esa página y quitando el token de la URL
con `history.replaceState` antes de cargar analítica o scripts de terceros.
Decisiones del 4 nov (E12-H2): `PUT /api/cuentas/yo/consentimiento-marketing` `{ acepta }` (cliente y
profesional; 401 sin sesión, 403 al personal; 400 si `acepta` falta o no es booleano) responde
`{ acepta, fechaConsentimiento }`, que también sale en `GET /api/cuentas/yo` como
`consentimientoMarketing`. Activar guarda `fecha_consentimiento_marketing`; repetirlo no la cambia;
desactivar la **conserva** (última vez que aceptó). Desactivar también da de baja, en la misma
transacción, la suscripción sin cuenta (LEAD) con el mismo correo, como la baja desde el correo
(decisión del equipo del 4 nov: quien no quiere ofertas no las recibe por ningún registro);
activar no la reactiva. `POST /api/marketing/bajas` `{ token }` es
pública (`LIMITES.SUSCRIPCION`) y da de baja **la dirección** en una transacción: la cuenta queda
con `acepta_marketing_email = false` y LEAD con `activo = false` y `fecha_baja` en la fecha de
esta baja (aunque estuviera pendiente o ya de baja: así ningún enlace de confirmación anterior la
activa). Responde 200 con el mismo mensaje exista o no la dirección y aunque se repita; firma
inválida, **400**. El enlace va firmado (HMAC-SHA256 del correo, clave derivada de
`JWT_ACCESS_SECRET` con su propio dominio, `FirmaBaja`) y **no vence**: la baja funciona desde
cualquier correo antiguo. La pantalla es `/ofertas/baja?token=…` (la de la
tienda, SCRUM-139; alineado el 6 nov, SCRUM-150). Al enviar, todo correo de campaña o con tipo en
`TIPOS_NOTIFICACION_PUBLICIDAD` revisa otra vez el consentimiento (cuenta activa, con correo
verificado y que acepta; o LEAD activo); si no lo tiene, no se envía y queda **`cancelada`**
(nuevo valor de `ESTADOS_NOTIFICACION`). Sin cambios al MER.
Decisiones del 4 nov (E12-H4): sin rutas. Un job repetible cada 30 s (RNF-31) en su propia cola
`carritos-abandonados` revisa los carritos **con artículos** de cuentas cliente o profesional
activas, con correo verificado y que aceptan publicidad. Los plazos (1, 24 y 72 h) se cuentan desde
`fechaActualizacion` del carrito, que cambia con cada modificación y con la compra (que lo vacía).
El abandono se registra **sin cambios al MER**: `fecha_recordatorio` es el inicio de la última serie
y `recordatorios_enviados` el último recordatorio enviado de ella (1 a 3); cada recordatorio es una
NOTIFICACION `recordatorio_carrito` (en `TIPOS_NOTIFICACION_PUBLICIDAD`, prioridad de publicidad),
de donde E14 puede contar abandonos y recuperaciones. Registrar un recordatorio no cuenta como cambio
(conserva `fechaActualizacion`). La serie sigue solo si empezó después del último cambio: comprar o
modificar el carrito la corta (CA2). **Semana = lunes a domingo en hora de Chile:** una serie nueva
no empieza en la semana en que **empezó** la anterior (CA3; confirmado el 5 nov: una serie que empezó
el domingo no impide otra el lunes). Si el abandono quedó bloqueado por la semana, la semana
siguiente sale el recordatorio que toca por los plazos desde el último cambio (puede ser el 2.º o
el 3.º, o ninguno pasadas 96 h), no se reinicia en el 1.º (confirmado el 5 nov). Si la tarea se atrasó y venció el plazo
siguiente, sale ese y no los atrasados; un carrito sin cambios hace **96 h** o más ya no se recuerda.
Cada envío va con la cuenta bloqueada (como los cambios del carrito) y en una transacción con su
NOTIFICACION; se encola después del commit. Al enviar se revisa otra vez el consentimiento y, si el
carrito cambió después de decidirse o quedó vacío, el correo queda `cancelada`. Solo cuentan los
artículos que la tienda le vende hoy a esa cuenta (la regla de `articulosALaVenta` del carrito): un
exclusivo nunca se le nombra a un cliente (RNF-04), y un carrito sin ninguno no se recuerda (y si
pasa al enviar, queda `cancelada`). El correo nombra hasta 5 artículos con su cantidad, **sin precios**, con botón al carrito (PROPUESTA por confirmar con
frontend: `/carrito`) y el enlace de baja firmado (`FirmaBaja`, RNF-26). Texto PROPUESTA por
confirmar con el equipo.
Decisiones del 5 nov (E12-H6, SCRUM-73): **seguimiento propio, solo en la publicidad** (correos de
campaña y tipos de `TIPOS_NOTIFICACION_PUBLICIDAD`: recordatorio de carrito y saludo de
cumpleaños). No se usa el de Resend, que se activa por
dominio y reescribiría también los enlaces con token de los correos de cuenta (RNF-08). Cada
correo publicitario lleva una imagen invisible
`GET /api/marketing/seguimiento/apertura/:token` y sus enlaces pasan por
`GET /api/marketing/seguimiento/clic/:token?destino=…` (302), salvo el de baja, que va directo. El
token es el id de la NOTIFICACION firmado con HMAC-SHA256 (`FirmaSeguimiento`, clave derivada de
`JWT_ACCESS_SECRET` con su propio dominio); el del clic firma también el destino, que además debe
ser de `URL_TIENDA`; otro destino o una firma inválida llevan a la portada de la tienda
(auditoría del 5 nov): no hay redirección abierta. **Excepción a RNF-07** (decisión del equipo
del 5 nov): el token deja ver el id correlativo de la NOTIFICACION. No se puede falsificar ni da
acceso a ningún dato; solo permite estimar cuántos correos envía la tienda, y se aceptó ese riesgo
bajo. **No
vence.** Se guarda solo la **primera** fecha (`fecha_apertura`, `fecha_clic`, con la condición de
que siga nula); un clic también cuenta como apertura si faltaba, porque muchos programas de correo
bloquean las imágenes. Con una firma inválida o la base caída la imagen responde igual y el clic
redirige igual, sin registrar. Rutas públicas con límite de **120/min por IP**
(`LIMITES.SEGUIMIENTO_CORREO`, holgado porque Gmail carga las imágenes desde servidores
compartidos). Las URL salen de la variable nueva `URL_API` (dirección pública de la API, sin
`/api`); sin ella los correos salen sin seguimiento. **Rebotes:** `POST /api/marketing/rebotes` es el
webhook de Resend (evento `email.bounced`, rechazo permanente). Se valida la firma Standard Webhooks
(`svix-id`, `svix-timestamp`, `svix-signature`) sobre el cuerpo tal como llegó (`rawBody: true` en
el arranque), con `RESEND_WEBHOOK_SECRET` (`whsec_…`); sin ella responde 503 y con firma inválida o
de hace más de 5 minutos, 401. Otros eventos, y un rebote marcado `Transient` (pasajero), responden
200 sin hacer nada. Cada envío lleva la etiqueta de Resend `notificacion=<id>`, que vuelve en el
aviso. Cuenta el rebote de **cualquier** correo (decisión del 5 nov): en una transacción la
NOTIFICACION pasa a **`rebotada`** (nuevo valor de `ESTADOS_NOTIFICACION`, solo desde `pendiente` o
`enviada`), **solo si su destinatario está entre las direcciones del aviso** (auditoría del 5 nov:
otro ambiente que comparta la cuenta de Resend repite ids), y cada dirección del aviso queda **como con la baja
desde el correo** (cuenta sin `acepta_marketing_email`, LEAD inactivo con `fecha_baja`), así la
revisión de consentimiento al enviar ya no le manda publicidad. El mismo aviso otra vez deja todo
igual. El detalle de una campaña cuenta también los `rebotados`. Sin cambios al MER.
Decisiones del 5 nov (E12-H3, SCRUM-70): rutas en `/api/marketing/campanas` con
`campanas.gestionar` (solo administrador; 401 sin sesión, 403 sin el permiso), identificadas por
**id** (la campaña no tiene `codigoPublico` y solo la ve el panel). `POST` crea un borrador
`envio_unico` con `{ asunto (1-200), cuerpo (1-10.000), segmento }`; `GET` lista (más nueva
primero, paginado) y `GET /:id` da el detalle con los correos por estado; `PATCH /:id` edita solo
un borrador (enviada: 409; cuerpo vacío: 400). El asunto va en una sola línea, sin caracteres de
control (400; auditoría del 5 nov). **Cuerpo en texto plano:** se escapa siempre (el
HTML no se interpreta); una línea en blanco separa párrafos. El correo usa la base de los demás,
con el asunto como título, remitente y enlace de baja firmado (RNF-26); sin diseño en Figma.
**Segmento** (JSON en `campana.segmento`): `tipos` (al menos uno de `TIPOS_DESTINATARIO_CAMPANA`:
`cliente`, `profesional`, `suscriptor`) y, opcionales, `categorias` y `marcas` (hasta 50 cada
una; deben existir, si no 400). Con categorías o marcas solo entran las cuentas con un pedido
pagado (todo estado salvo `ESTADOS_SIN_VENTA`) con algún producto de esas categorías (incluidas
sus subcategorías) **o** de esas marcas; un pack cuenta por sus formatos. Los suscriptores sin
cuenta no tienen compras: pedirlos con un filtro de compras responde 400. **Vista previa:**
`POST /:id/vista-previa` devuelve `{ asunto, html, texto, destinatarios, confirmacion }`; el
enlace de baja de la vista previa lleva a `/ofertas/baja` sin token (no da de baja a nadie).
`confirmacion` es `emisión.firma`: un HMAC-SHA256 de id + asunto + cuerpo + segmento + emisión
(clave derivada de `JWT_ACCESS_SECRET` con su propio dominio, `HuellaCampana`; sin variable ni
columna nueva). **Vence a la hora** (`VIGENCIA_VISTA_PREVIA_MS`): pasada, 409 «más de una hora»
y hay que pedir otra vista previa. **Vista previa en vivo** (decisión del 6 nov, SCRUM-150): `POST /vista-previa` `{ asunto, cuerpo }` arma el correo con la misma plantilla mientras se redacta y responde `{ asunto, html, texto }`; no guarda nada, no cuenta destinatarios y **nunca** entrega la `confirmacion` (no sirve para enviar).
**Envío:** `POST /:id/envio` `{ confirmacion }` responde **202** `{ id, fechaEnvio,
destinatarios }`. En una transacción con la campaña bloqueada (`FOR UPDATE`): ya enviada, 409
(CA2); huella distinta (cambió después de la vista previa), 409 «Pide otra vista previa»; sin
destinatarios, 409 y sigue como borrador. Calcula ahí los destinatarios (CA3: cuentas activas,
con correo verificado y que aceptan; LEAD activos; el personal nunca), **una vez por dirección**.
Si el correo de un LEAD es el de una cuenta, **decide la cuenta** (decisión del 5 nov): la
suscripción no hace recibir publicidad a una cuenta que no la acepta, que no verificó el correo o
que es del personal. Luego el envío marca `fecha_encolado`, guarda el
segmento usado y crea una NOTIFICACION `campana` (con `id_campana`) por dirección (RNF-12). Se
encolan después del commit en `correos` con prioridad de publicidad, en lotes de 500; el asunto y
el cuerpo se leen de la base al enviar, la revisión de pendientes las reencola (RNF-29) y al
enviar se revisa otra vez el consentimiento (queda `cancelada`, E12-H2). En toda publicidad, esa
revisión también exige que la cuenta siga siendo cliente o profesional y que un LEAD no tenga una
cuenta con su mismo correo. La cola `campanas` no se
usa. Una campaña enviada no se edita ni tiene vista previa (409). PROPUESTA por confirmar: texto
del pie del correo y que la vista previa de una enviada responda 409. Sin cambios al MER.
Decisiones del 5 nov (E12-H5, SCRUM-72): la **oferta es texto libre** que redacta el administrador
(el backend no aplica descuentos ni cupones). El saludo vive en **una sola fila de CAMPANA con tipo
`cumpleanos`**: asunto (1-200, una línea) y saludo (1-10.000, texto plano escapado) editables, y la
oferta en `campana.segmento` como `{ "activo", "oferta": { "activa", "texto" } }` (texto 1-1.000, obligatorio
si está activa; inactiva se conserva). `GET` y `PUT /api/marketing/cumpleanos` con
`campanas.gestionar` (401 sin sesión, 403 sin el permiso, 400 datos inválidos u oferta activa sin
texto); el `PUT` reemplaza todo y la primera vez crea la fila (autor: quien guarda), con un candado
de transacción (`CANDADOS.SALUDO_CUMPLEANOS`) para que no haya dos. Sin configurar rige un saludo
por defecto sin oferta (`configurado: false`); textos PROPUESTA por confirmar. **Encendido y cifras** (decisión del 6 nov, SCRUM-150): `activo` (obligatorio en el `PUT`, que reemplaza todo) apaga el saludo: el job no saluda a nadie y lo revisa otra vez con la cuenta bloqueada. Sin configurar o en una fila guardada antes, el saludo está **activo** (como hasta ahora). `GET` y `PUT` devuelven además `programadosEsteMes` (cuentas que cumplen años este mes en Chile y recibirían el saludo: mismas condiciones que el envío; 0 con el saludo apagado) y `porcentajeAperturaUltimoMes` (saludos `enviada` del mes calendario anterior en Chile con apertura registrada, 0 a 100 redondeado al entero; `null` si no salió ninguno). La fila no aparece en
`/api/marketing/campanas` (solo `envio_unico`). **Envío:** job repetible cada 30 s en su propia cola
`cumpleanos` (RNF-20, RNF-31). Saluda a cuentas cliente o profesional activas, con correo
verificado, que aceptan publicidad y con `fecha_nacimiento` (CA3; los LEAD no tienen fecha), el
**día del cumpleaños en hora de Chile, desde las 9:00**; quien nació un **29 de febrero se saluda el
28** en los años no bisiestos. Si la tarea estuvo detenida sale más tarde ese mismo día, **nunca al
día siguiente**: un saludo en cola que llega a enviarse otro día de Chile, o cuando la cuenta ya no
está de cumpleaños hoy (borró la fecha o la cambió a otro día), queda `cancelada`. **Una vez
en el año calendario de Chile:** con la cuenta bloqueada, si ya tiene una NOTIFICACION `cumpleanos`
creada desde el 1 de enero (en cualquier estado, también cancelada) no se crea otra. La NOTIFICACION
(`cumpleanos`, en `TIPOS_NOTIFICACION_PUBLICIDAD`, con `id_campana` si está configurado) se crea en
la transacción y se encola después en `correos` con prioridad de publicidad; la revisión de
pendientes la reencola (RNF-29). Al enviar se revisa otra vez el consentimiento (E12-H2) y el saludo
y la oferta se leen de la base: **la oferta va si está activa al enviarse** (CA2). El correo usa la
base de los demás («Hola, {nombre}:», el saludo, la oferta en un recuadro y botón a `/catalogo`),
con remitente y enlace de baja firmado (RNF-26); sin diseño en Figma. Sin cambios al MER.
PENDIENTE (auditoría del 5 nov): la cuenta puede editar su fecha de nacimiento (solo se valida que
no sea futura), así que puede poner la de hoy para recibir la oferta, una vez al año por cuenta. Hay
que decidir si se acepta (la oferta se canjea a mano) o si se limita (fecha no editable una vez
fijada, o no saludar si cambió hace poco, que cambiaría el MER).

**E14 Reportes.** Solo administrador. OE1 30 %, OE2 70 % en 48 h, OE3 80 %; ventas por período y
tipo de cliente; carritos abandonados y recuperados; resultado de campañas; stock bajo el mínimo.
Decisiones del 30 oct (E14-H4): `GET /api/reportes/stock-bajo-minimo` con `reportes.ver` (solo
administrador; bodeguero, vendedor, cliente y profesional reciben 403 y sin sesión 401).
Reutiliza `StockBajoService.listarBajoMinimo()`, el mismo cálculo del aviso del panel de bodega
(E11-H6, `GET /api/inventario/stock/bajo-minimo`): formatos con mínimo > 0 y stock total (todas las
ubicaciones) bajo él, con `stockTotal`, `stockMinimo` y `faltante`, del que más falta al que menos;
se calcula al consultar, sin caché, y si ninguno está bajo su mínimo responde una lista vacía. Los
formatos desactivados también salen, marcados con `activo = false`. PROPUESTA por confirmar: el
reporte no pagina ni filtra (la historia no lo pide). Sin cambios al MER.
Decisiones del 4 nov (E14-H2): `GET /api/reportes/ventas?desde=AAAA-MM-DD&hasta=AAAA-MM-DD` con
`reportes.ver` (401 sin sesión, 403 sin el permiso). Ambas fechas son obligatorias e inclusivas, en
hora de Chile: cuenta `fecha_pedido` desde las 00:00 de `desde` hasta antes de las 00:00 del día
siguiente a `hasta` en `America/Santiago`. **400** si una fecha no es válida, si `hasta` es anterior
a `desde` o si el período pasa de **366 días**. Solo cuentan los pedidos **pagados**: todo estado
salvo `pendiente_pago` y `cancelado` (`ESTADOS_SIN_VENTA`). El tipo de cliente es el **precio
aplicado al comprar** (`detalle_pedido.tipo_precio`, igual en todas las líneas del pedido), no el
rol actual: si un cliente pasa a profesional, sus compras anteriores siguen siendo minoristas.
Responde `minorista`, `mayorista` y `total`, cada uno con `pedidos`, `montoNeto`, `montoIva` y
`montoTotal`: los montos cerrados del pedido, con el despacho incluido. Sin pedidos, todo en cero.
Se calcula al consultar con una sola consulta agregada, sin caché (los montos no van a Redis).
Sin cambios al MER.
Decisiones del 5 nov (E14-H1, SCRUM-74): `GET /api/reportes/indicadores?desde=AAAA-MM-DD&hasta=AAAA-MM-DD`
con `reportes.ver` (401 sin sesión, 403 sin el permiso). El período sigue las reglas del de ventas
(obligatorio, inclusivo, hora de Chile, máximo 366 días; si no, 400), ahora en una función común
(`validarPeriodo`). Responde `desde`, `hasta` e `indicadores`: por cada objetivo `codigo` (`OE1`,
`OE2`, `OE3`), `nombre`, `meta` (30, 70 y 80), `porcentaje` con un decimal, `cumplidos`, `total` y
`sinDatos`. **Sin datos** (total 0) el porcentaje es `null` y `sinDatos` es `true` (CA2); con datos
y ninguno que cumpla, 0 %. Cómo se mide cada uno (decisión del 5 nov):
**OE1** de las cuentas cuya solicitud quedó `aprobada` con `fecha_resolucion` en el período,
cuántas tienen al menos un pedido pagado (todo estado salvo `ESTADOS_SIN_VENTA`) desde su
aprobación hasta el fin del período. **OE2** de las solicitudes con `fecha_solicitud` en el
período, cuántas quedaron `aprobada` o `rechazada` a **48 h o menos** de presentarse (una aprobada
sola por el SII cuenta al instante); se mide desde la presentación porque no se guarda cuándo
adjuntó los documentos. Una solicitud sin resolver que **aún está dentro de sus 48 h** no se puede
medir y queda fuera del total; una sin resolver con más de 48 h cuenta y no cumple. **OE3** de los
productos con `fecha_creacion` en el período, cuántos tienen `origen_descripcion` `ia` o
`ia_editada` (la sugerencia aceptada tal cual o corregida), **también los que después se
desactivaron** (decisión del 5 nov: OE3 mide cómo se hizo la descripción al crearlo, y eso no cambia
al desactivarlo). Se calcula al consultar, una consulta
agregada por indicador, sin caché. Sin cambios al MER.
Decisiones del 6 nov (E14-H3, SCRUM-76): dos rutas con `reportes.ver` (401 sin sesión, 403 sin el
permiso). **Carritos:** `GET /api/reportes/carritos-abandonados?desde=AAAA-MM&hasta=AAAA-MM`, ambos
meses obligatorios e incluidos, en hora de Chile; **400** si un mes no es válido (AAAA-MM, años
1900 a 2099: PostgreSQL no tiene año 0, auditoría del 6 nov), si `hasta` es
anterior a `desde` o si el período pasa de **24 meses**. Responde `meses` (cada uno con `mes`,
`abandonados` y `recuperados`, en cero si no hubo) y `total`. Un **abandono es una serie de
recordatorios** de E12-H4 y cuenta en el mes de su primer recordatorio, en cualquier estado del
correo (el carrito se abandonó aunque el correo quedara cancelado o fallido). Como la NOTIFICACION
no guarda su serie, se deduce de la regla de E12-H4: un recordatorio abre serie si es de otra
semana (lunes a domingo, hora de Chile) que el inicio de la serie anterior y salió **95 h o más**
después de él (`DURACION_MAXIMA_SERIE_HORAS`: ningún recordatorio sale pasadas 96 h del último
cambio, y el primero sale 1 h después). Se acepta un caso que se cuenta como una sola serie: una
que empezó el fin de semana y otra que empezó el lunes siguiente dentro de esas 95 h porque el
cliente volvió a cambiar el carrito. Un abandono está **recuperado** si la misma cuenta hizo un
pedido pagado (todo estado salvo `ESTADOS_SIN_VENTA`) después del primer recordatorio, dentro de
**7 días** (`DIAS_PARA_RECUPERAR`) y antes de que empiece su serie siguiente; cuenta en el mes del
abandono. **Campañas:** `GET /api/reportes/campanas/:id` responde `{ id, tipo, asunto, fechaEnvio,
envios }` con `total`, `pendientes`, `enviados`, `abiertos`, `clics`, `rebotados`, `cancelados` y
`fallidos`. Los estados no se solapan (cada correo está en uno, como en el detalle de la campaña);
`abiertos` y `clics` cuentan los correos con `fecha_apertura` o `fecha_clic` (E12-H6). Sirve para
las campañas de envío único y para el saludo de cumpleaños (sin `fechaEnvio`); un borrador sin
enviar responde **409** y una campaña inexistente, 404. Ambos se calculan al consultar, sin caché.
`ESTADOS_SIN_VENTA` pasó a `common/dominio/valores.ts`. Sin cambios al MER.
Decisión del 6 nov (SCRUM-150, pantalla de SCRUM-144): **campañas por período**, `GET
/api/reportes/campanas?desde=AAAA-MM-DD&hasta=AAAA-MM-DD` (mismas reglas de período que E14-H2:
ambos incluidos, hora de Chile, hasta 366 días; 400 si no). Responde `{ desde, hasta, campanas }`,
las más recientes primero: cada campaña de envío único **confirmada** en el período (`fecha`: la
del envío, ISO) y una fila **automática** por mes con los saludos de cumpleaños creados ese mes
(`fecha` AAAA-MM, `nombre` «Saludo de cumpleaños», `segmento` null, `id` el del saludo o null si
nunca se configuró). Cada fila trae `id`, `nombre`, `segmento` (el guardado, estructurado),
`enviados`, `rebotados`, `cancelados`, `fallidos` y `porcentajeAbiertos` / `porcentajeClic`:
de los correos `enviada`, cuántos tienen apertura o clic, 0 a 100 redondeado al entero; `null`
si no salió ninguno (RNF-03).

## Rendimiento y operación

- 95 % de las peticiones en ≤ 500 ms; crear un pedido ≤ 1 s sin contar servicios externos (RNF-18).
- Sin estado en memoria: varias instancias del backend deben funcionar igual; cada tarea programada
  corre una sola vez (RNF-20) — usa los jobs repetibles de BullMQ, no `setInterval`.
- Tareas con plazo con ≤ 1 min de atraso (RNF-31).
- **Subidas de archivos (decisión del 6 nov, SCRUM-150):** cada archivo pesa hasta **4 MB**
  (imágenes de productos, foto para la sugerencia de descripción, PDF de la factura y cada documento
  de verificación; 413 con el mensaje en español). Bajó de 5 MB porque las subidas pasan por el
  proxy de la tienda, y si se despliega en Vercel sus funciones aceptan cuerpos de unos 4,5 MB.
  **Deuda técnica:** subir directo a R2 con una URL prefirmada (el backend firma y luego confirma
  la subida). Hasta entonces, el envío de verificación con **varios** documentos en una sola
  petición (hasta 5 de 4 MB) puede pasar del límite del proxy aunque cada archivo lo cumpla.
