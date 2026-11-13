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
    /**
     * Correo al que se escribe para dejar de recibir publicidad: va en el pie de todo correo
     * publicitario (RNF-26, decisión del 11 nov). PLACEHOLDER hasta que el equipo defina la casilla.
     */
    CORREO_CONTACTO: z.email().default('contacto@cabelloperfecto.cl'),
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
    /**
     * Tarjeta Cliente Chilexpress (TCC) con que se crean las OT al despachar (SCRUM-153). Sin ella
     * (o sin la clave de Envíos), la OT se crea en el portal y el personal escribe su número.
     */
    CHILEXPRESS_TCC: opcional(z.string().regex(/^\d{1,12}$/)),
    /** Remitente de las OT (SCRUM-153): Chilexpress exige nombre, teléfono y correo. */
    CHILEXPRESS_REMITENTE_NOMBRE: opcional(z.string().max(100)),
    CHILEXPRESS_REMITENTE_TELEFONO: opcional(z.string().max(15)),
    CHILEXPRESS_REMITENTE_CORREO: opcional(z.email()),
    /** Sin ella se usa el sandbox, salvo en producción con clave: ahí la app no arranca. */
    CHILEXPRESS_URL_BASE: opcional(
      z.url({ protocol: /^https$/ }).transform((v) => v.replace(/\/+$/, '')),
    ),
    /**
     * Clave de la API de Resend (E1-H6). Sin ella, fuera de producción, los correos se simulan: no
     * sale nada. En producción la app no arranca sin ella.
     */
    RESEND_API_KEY: opcional(z.string()),
    /** Obligatorio con la clave de Resend. Su dominio debe estar verificado allá. */
    CORREO_REMITENTE: opcional(z.string()),
    /**
     * Secreto con que Resend firma sus avisos (E12-H6): `whsec_…`, en el detalle del webhook en
     * Resend. Sin él la app arranca, pero el aviso de rebote responde 503 y no se registra nada.
     */
    RESEND_WEBHOOK_SECRET: opcional(
      z.string().regex(/^whsec_[A-Za-z0-9+/=]+$/),
    ),
    /**
     * Dirección pública de esta API, sin `/api` (E12-H6): la imagen de apertura y los enlaces de
     * clic de la publicidad apuntan a ella. Sin ella los correos salen sin seguimiento.
     */
    URL_API: opcional(z.url().transform((v) => v.replace(/\/+$/, ''))),
    /**
     * Clave de la API de Gemini (E4-H1, decisión del 2 nov 2026). Sin ella la app arranca, pero
     * sugerir la descripción desde la foto responde 503 y se escribe a mano.
     */
    GEMINI_API_KEY: opcional(z.string()),
    /** Modelo de Gemini con visión que lee el reverso del producto. */
    GEMINI_MODELO: z.string().min(1).default('gemini-3.8-flash'),
    /**
     * Modelo de Gemini que se prueba si el principal falla (503, 504, sin respuesta a tiempo).
     * Más liviano y rápido. Vacío, no hay respaldo de Gemini.
     */
    GEMINI_MODELO_RESPALDO: z
      .string()
      .default('gemini-3.5-flash-lite')
      .transform((valor) => valor.trim()),
    /**
     * Clave de la API de Groq: el último respaldo de la sugerencia, si Gemini no responde
     * (decisión del 7 nov 2026). Vacía, no se usa Groq.
     */
    GROQ_API_KEY: opcional(z.string()),
    /** Modelo de Groq con visión que lee el reverso cuando Gemini falla. */
    GROQ_MODELO: z.string().min(1).default('qwen/qwen3.8-27b'),
    /**
     * Cliente OAuth de Khipu (E10-H1, decisión del 2 nov 2026), que consulta la «Situación
     * tributaria de terceros» del SII: «Id de cobrador» y «Llave» de la cuenta. Con ellos se pide
     * el JWT (`client_credentials`); Khipu retira el `x-api-key`. Sin ellos la app arranca, pero
     * la consulta falla y quien solicita la verificación debe adjuntar documentos.
     */
    KHIPU_CLIENT_ID: opcional(z.string()),
    KHIPU_CLIENT_SECRET: opcional(z.string()),
    /** Sin ella se usa la de producción de Khipu. */
    KHIPU_URL_BASE: opcional(
      z.url({ protocol: /^https$/ }).transform((v) => v.replace(/\/+$/, '')),
    ),
    /** Servidor de autorización de Khipu, que entrega el token. Sin ella, el de producción. */
    KHIPU_URL_AUTH: opcional(
      z.url({ protocol: /^https$/ }).transform((v) => v.replace(/\/+$/, '')),
    ),
    /**
     * Quién responde la consulta al SII. `simulado` es solo para desarrollo: responde según el
     * último dígito del RUT, sin consultar a nadie. En producción la app no arranca con él.
     */
    SII_PROVEEDOR: z.enum(['khipu', 'simulado']).default('khipu'),
    /** `false` apaga el envío en esta instancia: los e2e leen los trabajos de la cola. */
    CORREOS_WORKER_ACTIVO: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
  })
  .superRefine((entorno, contexto) => {
    // En producción un correo sin enviar deja a la persona sin poder activar su cuenta (E1-H6)
    if (entorno.NODE_ENV === 'production' && !entorno.RESEND_API_KEY) {
      contexto.addIssue({
        code: 'custom',
        path: ['RESEND_API_KEY'],
        message: 'es obligatoria en producción',
      });
    }
    if (entorno.RESEND_API_KEY && !entorno.CORREO_REMITENTE) {
      contexto.addIssue({
        code: 'custom',
        path: ['CORREO_REMITENTE'],
        message: 'es obligatorio si hay clave de Resend',
      });
    }
    // Media credencial no es «sin configurar»: es un error al copiarla, y no debe pasar callado
    if (!entorno.KHIPU_CLIENT_ID !== !entorno.KHIPU_CLIENT_SECRET) {
      contexto.addIssue({
        code: 'custom',
        path: [
          entorno.KHIPU_CLIENT_ID ? 'KHIPU_CLIENT_SECRET' : 'KHIPU_CLIENT_ID',
        ],
        message: 'van juntos: falta uno de los dos datos del cliente de Khipu',
      });
    }
    // Con el simulado, cualquiera con RUT acabado en 3..9 sería profesional sin serlo (E10-H1)
    if (
      entorno.NODE_ENV === 'production' &&
      entorno.SII_PROVEEDOR === 'simulado'
    ) {
      contexto.addIssue({
        code: 'custom',
        path: ['SII_PROVEEDOR'],
        message: 'no puede ser «simulado» en producción',
      });
    }
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
