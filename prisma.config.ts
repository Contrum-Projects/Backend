import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // Sin `env()` a propósito: `prisma generate` (en pnpm install y en el build de Docker)
    // no necesita la base y debe funcionar sin .env. Los comandos que sí la usan
    // (migrate, seed, studio) fallan con un error claro si falta DATABASE_URL.
    url: process.env.DATABASE_URL ?? '',
  },
});
