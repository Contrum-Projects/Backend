import { z } from 'zod';

/**
 * Variables de entorno del backend. La app no arranca si falta una obligatoria
 * o tiene un valor inválido (RNF-10: las credenciales viven solo en el entorno).
 */
export const esquemaEntorno = z.object({
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

  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_REFRESH_TTL: z.string().default('30d'),

  IVA_PORCENTAJE: z.coerce.number().min(0).max(100).default(19),
  MINIMO_UNIDADES_PELUQUERO: z.coerce.number().int().positive().default(3),
  PLAZO_PAGO_MINUTOS: z.coerce.number().int().positive().default(15),

  MERCADOPAGO_ACCESS_TOKEN: z.string().optional(),
  MERCADOPAGO_WEBHOOK_SECRET: z.string().optional(),
  BLUEEXPRESS_API_KEY: z.string().optional(),
  SMTP_URL: z.string().optional(),
  CORREO_REMITENTE: z.string().optional(),
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
