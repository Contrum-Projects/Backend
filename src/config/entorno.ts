import { z } from 'zod';
import { FORMATO_DURACION } from './duracion.js';

/** Variable opcional: vacía (`R2_BUCKET=` en el .env) cuenta como ausente. */
const opcional = <T extends z.ZodType>(esquema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), esquema.optional());

/**
 * Variables de entorno del backend. La app no arranca si falta una obligatoria
 * o tiene un valor inválido (RNF-10: las credenciales viven solo en el entorno).
 */
export const esquemaEntorno = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    CORS_ORIGINS: z
      .string()
      .default('')
      .transform((v) =>
        v
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean),
      ),

    /**
     * Cuántos proxies (balanceador, Cloudflare, Nginx) hay delante del backend. Con 0 la IP es la
     * de la conexión; detrás de un proxy hay que indicarlo, o todos los límites por IP (RNF-09)
     * contarían a la vez a todos los usuarios. Nunca más de los que hay: la IP sería falsificable.
     */
    PROXIES_CONFIABLES: z.coerce.number().int().min(0).max(5).default(0),
    DATABASE_URL: z.url(),
    REDIS_URL: z.url(),

    JWT_ACCESS_SECRET: z.string().min(32),
    /** Duraciones como 15m o 30d (ver config/duracion.ts). */
    JWT_ACCESS_TTL: z.string().regex(FORMATO_DURACION).default('15m'),
    JWT_REFRESH_SECRET: z.string().min(32),
    JWT_REFRESH_TTL: z.string().regex(FORMATO_DURACION).default('30d'),

    /** Base de los enlaces que van en los correos (confirmación, recuperación). */
    URL_TIENDA: z.url().default('http://localhost:3001'),
    /** Vigencia del enlace de confirmación del correo (E1-H1, decisión del 14 oct). */
    CONFIRMACION_CORREO_HORAS: z.coerce.number().int().positive().default(24),
    /** Vigencia del enlace de invitación al personal (E13-H1, decisión del 18 oct). */
    INVITACION_PERSONAL_HORAS: z.coerce.number().int().positive().default(72),
    /** Vigencia del enlace de recuperación de la contraseña (E1-H4, decisión del 26 oct). */
    RECUPERACION_CONTRASENA_HORAS: z.coerce
      .number()
      .int()
      .positive()
      .default(1),

    IVA_PORCENTAJE: z.coerce.number().min(0).max(100).default(19),
    MINIMO_UNIDADES_PELUQUERO: z.coerce.number().int().positive().default(3),
    PLAZO_PAGO_MINUTOS: z.coerce.number().int().positive().default(15),
    /** Vigencia en Redis del árbol de categorías y de las marcas de la tienda (E2-H1, RNF-30). */
    CACHE_CATALOGO_SEGUNDOS: z.coerce.number().int().positive().default(300),

    /**
     * Cloudflare R2 (API S3) para las imágenes del catálogo (E3-H3, decisión del 24 oct). Van
     * las cinco o ninguna: sin ellas la app arranca, pero subir imágenes responde 503.
     */
    R2_ACCOUNT_ID: opcional(z.string()),
    R2_ACCESS_KEY_ID: opcional(z.string()),
    R2_SECRET_ACCESS_KEY: opcional(z.string()),
    R2_BUCKET: opcional(z.string()),
    /** Dominio público del bucket, base de las URL de las imágenes (se le quita el `/` final). */
    R2_URL_PUBLICA: opcional(
      z.url({ protocol: /^https$/ }).transform((v) => v.replace(/\/+$/, '')),
    ),

    MERCADOPAGO_ACCESS_TOKEN: z.string().optional(),
    MERCADOPAGO_WEBHOOK_SECRET: z.string().optional(),
    /** Clave de la API Cotizador (E7-H2). Sin ella la app arranca, pero cotizar responde 503. */
    CHILEXPRESS_CLAVE_COTIZACION: opcional(z.string()),
    /** Clave de la API Envíos (E7-H3). Sin ella o sin el RUT, los envíos conservan su último estado. */
    CHILEXPRESS_CLAVE_ENVIOS: opcional(z.string()),
    /** RUT de la empresa dueña de las OT, sin puntos ni dígito verificador (E7-H3). */
    CHILEXPRESS_RUT_EMPRESA: opcional(
      z
        .string()
        .regex(/^\d{7,8}$/)
        .transform(Number),
    ),
    /** Sin ella se usa el sandbox, salvo en producción con clave: ahí la app no arranca. */
    CHILEXPRESS_URL_BASE: opcional(
      z.url({ protocol: /^https$/ }).transform((v) => v.replace(/\/+$/, '')),
    ),
    SMTP_URL: z.string().optional(),
    CORREO_REMITENTE: z.string().optional(),
  })
  .superRefine((entorno, contexto) => {
    // Nunca cobrar tarifas de prueba a clientes reales por olvidar la URL (E7-H2)
    if (
      entorno.NODE_ENV === 'production' &&
      (entorno.CHILEXPRESS_CLAVE_COTIZACION ||
        entorno.CHILEXPRESS_CLAVE_ENVIOS) &&
      !entorno.CHILEXPRESS_URL_BASE
    ) {
      contexto.addIssue({
        code: 'custom',
        path: ['CHILEXPRESS_URL_BASE'],
        message: 'es obligatoria en producción si hay clave de Chilexpress',
      });
    }
  });

export type Entorno = z.infer<typeof esquemaEntorno>;

export function validarEntorno(config: Record<string, unknown>): Entorno {
  const resultado = esquemaEntorno.safeParse(config);
  if (!resultado.success) {
    const detalle = resultado.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Variables de entorno inválidas:\n${detalle}`);
  }
  return resultado.data;
}
