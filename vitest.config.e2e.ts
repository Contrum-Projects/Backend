import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Comparten la base y los contadores de Redis (limpian `limite:*`): uno a la vez
    fileParallelism: false,
  },
});
