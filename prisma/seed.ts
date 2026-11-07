/**
 * Datos iniciales: las 16 regiones y las 346 comunas de Chile (código CUT, decreto
 * N° 1.115 de 2018; ver prisma/comunas.ts) y una cuenta de administrador para entrar al
 * panel en desarrollo. Fuera de producción agrega además dos bodegas de prueba con sus
 * ubicaciones (SCRUM-150): ninguna historia crea bodegas, y sin ellas no se puede registrar
 * ninguna entrada de inventario.
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

/** Bodegas y ubicaciones de prueba: solo para desarrollo, con nombres que lo dicen. */
const BODEGAS_DESARROLLO = [
  {
    nombre: 'Bodega de desarrollo',
    tipo: 'bodega',
    ubicaciones: ['A-01', 'A-02', 'B-01'],
  },
  {
    nombre: 'Sala de ventas de desarrollo',
    tipo: 'tienda',
    ubicaciones: ['S-01'],
  },
];
/** Comuna de Santiago (CUT 13101); las bodegas de prueba no representan una dirección real. */
const COMUNA_DESARROLLO = '13101';

/** Crea lo que falte de las bodegas de prueba; no toca las que ya existen. */
async function cargarBodegasDesarrollo() {
  const comuna = await prisma.comuna.findUniqueOrThrow({
    where: { codigoCut: COMUNA_DESARROLLO },
  });
  let ubicaciones = 0;
  for (const { nombre, tipo, ubicaciones: codigos } of BODEGAS_DESARROLLO) {
    const bodega =
      (await prisma.bodega.findFirst({ where: { nombre } })) ??
      (await prisma.bodega.create({
        data: {
          nombre,
          tipo,
          direccion: 'Dirección de prueba 100',
          comunaId: comuna.id,
        },
      }));
    for (const codigo of codigos) {
      const existe = await prisma.ubicacion.findFirst({
        where: { bodegaId: bodega.id, codigo },
      });
      if (!existe) {
        await prisma.ubicacion.create({
          data: { bodegaId: bodega.id, codigo },
        });
      }
      ubicaciones += 1;
    }
  }
  return ubicaciones;
}

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

  const bodegas =
    process.env.NODE_ENV === 'production'
      ? ''
      : `, ${BODEGAS_DESARROLLO.length} bodegas de prueba con ${await cargarBodegasDesarrollo()} ubicaciones`;

  console.log(
    `Semilla lista: ${REGIONES.length} regiones, ${COMUNAS.length} comunas${bodegas} y la cuenta ${email}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
