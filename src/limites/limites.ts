/**
 * Límites de peticiones por IP (RNF-09). Se aplican con
 * `@Throttle({ default: LIMITES.X })` junto a `@UseGuards(ThrottlerGuard)`.
 */
export const LIMITES = {
  /**
   * Probar un cupón sobre el carrito (SCRUM-150, decisión del 7 nov 2026): 10/min por cuenta, con
   * `LimitePorCuentaGuard`. Alcanza para escribirlo mal un par de veces y frena adivinar códigos.
   */
  VALIDAR_CUPON: { limit: 10, ttl: 60_000 },
  /** Registro y confirmación del correo (E1-H1, decisión del 14 oct 2026): 5/min. */
  REGISTRO: { limit: 5, ttl: 60_000 },
  /**
   * Suscribirse a las ofertas y confirmar la suscripción (E12-H1, RNF-09): 5/min por IP en cada
   * ruta. Son públicas: frena llenar buzones ajenos con confirmaciones.
   */
  SUSCRIPCION: { limit: 5, ttl: 60_000 },
  /**
   * Imagen de apertura y enlaces de clic de la publicidad (E12-H6, decisión del 5 nov 2026): 120/min
   * por IP. Holgado porque Gmail y otros cargan las imágenes desde sus propios servidores, que
   * comparten IP entre muchos destinatarios; frena llenar la base probando enlaces.
   */
  SEGUIMIENTO_CORREO: { limit: 120, ttl: 60_000 },
  /** Cierre de sesión en el dispositivo (E1-H3, decisión del 18 oct 2026): 30/min. */
  CIERRE_SESION: { limit: 30, ttl: 60_000 },
  /**
   * Renovar la sesión con el token de refresco (decisión del 24 oct 2026): 30/min, como el cierre.
   * Un navegador renueva cada 15 min; el tope frena probar tokens en serie.
   */
  RENOVAR_SESION: { limit: 30, ttl: 60_000 },
  /** Aceptar la invitación del personal (E13-H1, decisión del 18 oct 2026): 5/min, como el registro. */
  ACEPTAR_INVITACION: { limit: 5, ttl: 60_000 },
  /**
   * Recuperar la contraseña (E1-H4, RNF-09, decisión del 26 oct 2026): 5 cada 15 min por IP,
   * aparte para solicitar el enlace y para definir la contraseña nueva.
   */
  RECUPERAR_CONTRASENA: { limit: 5, ttl: 15 * 60_000 },
  /**
   * Editar los datos personales (E1-H5, decisión del 20 oct 2026): 10/hora por cuenta, con
   * `LimitePorCuentaGuard`. Alcanza para corregir datos y frena probar RUT en serie (el 409
   * indica si un RUT ya tiene cuenta).
   */
  EDITAR_DATOS: { limit: 10, ttl: 60 * 60_000 },
  /**
   * Cotizar el carrito del visitante (E5-H2, decisión del 28 oct 2026): 60/min por IP. Holgado
   * para quien arma su carrito y encarece sondear el stock probando cantidades sin cuenta.
   */
  COTIZAR_CARRITO: { limit: 60, ttl: 60_000 },
  /**
   * Crear un pedido (E5-H3, decisión del 30 oct 2026): 5/min por cuenta, con
   * `LimitePorCuentaGuard`. Cada pedido reserva stock: frena agotarlo con pedidos sin pagar.
   */
  CREAR_PEDIDO: { limit: 5, ttl: 60_000 },
  /**
   * Ir a pagar y confirmar el pago (E6-H1, decisión del 30 oct 2026): 10/min por cuenta en cada
   * ruta, con `LimitePorCuentaGuard`. Cada llamada consulta a Mercado Pago: frena agotar la cuota
   * del token de la tienda, que dejaría sin pagar a todos los compradores.
   */
  PAGAR_PEDIDO: { limit: 10, ttl: 60_000 },
  /**
   * Cotizar el despacho (E7-H2, decisión del 31 oct 2026): 10/min por cuenta, con
   * `LimitePorCuentaGuard`. Cada cotización nueva consulta a Chilexpress: frena agotar su cuota.
   */
  COTIZAR_ENVIO: { limit: 10, ttl: 60_000 },
  /**
   * Sugerir la descripción desde la foto del reverso (E4-H1, decisión del 2 nov 2026): 15/min por
   * cuenta, con `LimitePorCuentaGuard`. Cada sugerencia es una llamada pagada a Gemini.
   */
  SUGERIR_DESCRIPCION: { limit: 15, ttl: 60_000 },
  /**
   * Solicitar la verificación como profesional (E10-H1, decisión del 2 nov 2026): 5/hora por
   * cuenta, con `LimitePorCuentaGuard`. Cada envío consulta al SII a través de Khipu, que cobra
   * por consulta: frena gastar la cuota del proveedor repitiendo la solicitud.
   */
  SOLICITAR_VERIFICACION: { limit: 5, ttl: 60 * 60_000 },
  /**
   * Adjuntar los documentos de la verificación (E10-H2, decisión del 2 nov 2026): 5/hora por
   * cuenta, con `LimitePorCuentaGuard`. Cada envío sube hasta 5 archivos de 4 MB al almacén: frena
   * llenarlo.
   */
  ADJUNTAR_DOCUMENTOS: { limit: 5, ttl: 60 * 60_000 },
} as const;

/**
 * Enlaces de recuperación de la contraseña por correo (E1-H4, RNF-09, decisión del 26 oct
 * 2026): 3 por hora, desde cualquier IP. Frena llenar el buzón de alguien y anular su enlace
 * una y otra vez. Pasado el tope se responde lo mismo, sin enviar nada.
 */
export const LIMITE_RECUPERACION_POR_CORREO = {
  maximo: 3,
  ventanaMs: 60 * 60_000,
} as const;

/**
 * Correos de confirmación de la suscripción a ofertas por dirección (E12-H1, RNF-09, decisión del
 * 3 nov 2026): uno cada 15 min, desde cualquier IP. Frena llenar el buzón de alguien desde muchas
 * IP. Se cuenta en PostgreSQL (NOTIFICACION), así rige aunque Redis no responda (RNF-32). Pasado el
 * tope se responde lo mismo, sin enviar nada.
 */
export const LIMITE_CONFIRMACION_SUSCRIPCION = {
  ventanaMs: 15 * 60_000,
} as const;

/**
 * Intentos fallidos de inicio de sesión (RNF-09, E1-H2, decisión del 17 oct 2026).
 * Se cuentan en Redis por correo + IP y, como tope, por IP; solo los fallidos.
 * Al llegar al máximo, los nuevos intentos responden 429 hasta que vence la ventana.
 */
export const LIMITE_INICIO_SESION = {
  fallidosPorCorreo: 5,
  fallidosPorIp: 20,
  ventanaMs: 15 * 60_000,
} as const;
