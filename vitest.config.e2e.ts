import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Los e2e leen los enlaces desde la cola y nunca envían correos reales: el worker parte apagado
    // (`correos-envio` lo enciende con un cliente simulado) y la clave de un `.env` no se usa
    env: { CORREOS_WORKER_ACTIVO: 'false', RESEND_API_KEY: '' },
    // Comparten la base y los contadores de Redis (limpian `limite:*`): uno a la vez
    fileParallelism: false,
  },
});
