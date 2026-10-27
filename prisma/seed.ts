/**
 * Datos iniciales: las 16 regiones y las 346 comunas de Chile (código CUT, decreto
 * N° 1.115 de 2018; ver prisma/comunas.ts) y una cuenta de administrador para entrar al
 * panel en desarrollo.
 *
 * Ejecutar: pnpm db:seed  (es idempotente: se puede correr varias veces)
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import argon2 from 'argon2';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { ROLES } from '../src/common/dominio/roles.js';
import { COMUNAS } from './comunas.js';
import { cargarTerritorio, REGIONES } from './territorio.js';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  await cargarTerritorio(prisma);

  const email = (
    process.env.SEED_ADMIN_EMAIL ?? 'admin@cabelloperfecto.local'
  ).toLowerCase();
  const contrasena = process.env.SEED_ADMIN_PASSWORD ?? 'Cambiar.123456';
  await prisma.usuario.upsert({
    where: { email },
    update: {},
    create: {
      codigoPublico: randomUUID(),
      nombre: 'Administración',
      apellido: 'Cabello Perfecto',
      email,
      contrasenaHash: await argon2.hash(contrasena),
      rol: ROLES.ADMINISTRADOR,
      fechaVerificacionCorreo: new Date(),
    },
  });

  console.log(
    `Semilla lista: ${REGIONES.length} regiones, ${COMUNAS.length} comunas y la cuenta ${email}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
