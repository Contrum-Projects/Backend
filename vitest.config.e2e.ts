import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Los e2e leen los enlaces desde la cola y nunca envían correos reales: el worker parte apagado
    // (`correos-envio` lo enciende con un cliente simulado) y la clave de un `.env` no se usa.
    // Tampoco crean OT reales: sin las claves de Envíos, despachar sin número no llama a
    // Chilexpress (SCRUM-153); `ot-automatica` usa su propio creador de prueba
    env: {
      CORREOS_WORKER_ACTIVO: 'false',
      RESEND_API_KEY: '',
      CHILEXPRESS_CLAVE_ENVIOS: '',
      CHILEXPRESS_RUT_EMPRESA: '',
    },
    // Comparten la base y los contadores de Redis (limpian `limite:*`): uno a la vez
    fileParallelism: false,
  },
});
