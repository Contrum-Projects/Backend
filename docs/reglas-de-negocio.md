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
  revocar las sesiones de la cuenta.
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
o WebP reconocidos por su contenido, hasta 5 MB (413), hasta 10 por artículo (409). Rutas, con
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
dos veces. La validación previa del pedido (agotado, rol, mínimo del peluquero) sigue siendo de
E5; como defensa, el servicio responde 400 si una cantidad no es un entero mayor que 0 o si las
unidades de un formato pasarían el máximo de int4, y 409 si un artículo no existe o es un pack sin
componentes. El resultado del descuento es interno (ubicaciones, stock y correos del personal):
nunca va en la respuesta al comprador. Sin cambios al MER.

**E5 Carrito y compra.** Carrito del visitante en el navegador; se une al de la cuenta al iniciar
sesión. Un carrito por cuenta; el carrito no guarda precios. El pedido exige sesión y correo
confirmado, rechaza si falta stock o el artículo no se vende a esa cuenta, y un doble clic crea un
solo pedido (clave de idempotencia). Al crearlo se reserva el stock (se descuenta con movimiento de
venta) y hay **15 minutos** para pagar (`PLAZO_PAGO_MINUTOS`; el plazo lo lleva una cola, con
`fechaExpiracionPago` de respaldo). El profesional necesita al menos `MINIMO_UNIDADES_PELUQUERO`
(3) unidades de **cada** formato; si no, el pedido no se crea.

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
formatos que comparten componentes la valida el pedido (E5-H3, SCRUM-45), que además exige el mínimo
del profesional. Sin cambios al MER.
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
