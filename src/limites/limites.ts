/**
 * Límites de peticiones por IP (RNF-09). Se aplican con
 * `@Throttle({ default: LIMITES.X })` junto a `@UseGuards(ThrottlerGuard)`.
 */
export const LIMITES = {
  /** Registro y confirmación del correo (E1-H1, decisión del 14 oct 2026): 5/min. */
  REGISTRO: { limit: 5, ttl: 60_000 },
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
 * Intentos fallidos de inicio de sesión (RNF-09, E1-H2, decisión del 17 oct 2026).
 * Se cuentan en Redis por correo + IP y, como tope, por IP; solo los fallidos.
 * Al llegar al máximo, los nuevos intentos responden 429 hasta que vence la ventana.
 */
export const LIMITE_INICIO_SESION = {
  fallidosPorCorreo: 5,
  fallidosPorIp: 20,
  ventanaMs: 15 * 60_000,
} as const;
