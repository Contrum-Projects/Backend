import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import argon2 from 'argon2';
import type { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { ROLES, type Rol } from '../src/common/dominio/roles.js';
import {
  CANALES_VENTA,
  ORIGENES_DESCRIPCION,
  TIPOS_ARTICULO,
} from '../src/common/dominio/valores.js';
import { configurarApp } from '../src/configurar-app.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { REDIS } from '../src/redis/redis.module.js';

// Requiere PostgreSQL y Redis levantados: `docker compose up -d db redis`.

const CONTRASENA = 'Secreta123';
const RUTA = '/api/reportes/stock-bajo-minimo';
// Todo lo que crean estas pruebas lleva este prefijo, para borrarlo al terminar
const PREFIJO = 'E2E-reporte-stock-bajo';
const PREFIJO_CORREO = 'e2e-reporte-stock-bajo-';
// Región y comuna de prueba (códigos que no usa el CUT ni otra prueba); se borran al terminar
const REGION = '91';
const COMUNA = '91001';

interface FilaReporte {
  formatoId: number;
  sku: string;
  stockMinimo: number;
  stockTotal: number;
  faltante: number;
}

describe('Reportes · formatos con stock bajo el mínimo (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: Redis;
  let hashContrasena: string;
  let tokenAdministrador: string;
  let categoriaId: number;
  let ubicacionId: number;
  let otraUbicacionId: number;
  const correosCreados: string[] = [];

  const unico = () => randomUUID().slice(0, 8);
  const servidor = () => request(app.getHttpServer());

  const tokenDe = async (rol: Rol) => {
    const email = `${PREFIJO_CORREO}${randomUUID()}@prueba.cl`;
    correosCreados.push(email);
    await prisma.usuario.create({
      data: {
        codigoPublico: randomUUID(),
        nombre: 'Camila',
        apellido: 'Rojas',
        email,
        contrasenaHash: hashContrasena,
        rol,
        fechaVerificacionCorreo: new Date(),
      },
    });
    const respuesta = await servidor()
      .post('/api/cuentas/sesion')
      .send({ email, contrasena: CONTRASENA })
      .expect(200);
    return (respuesta.body as { tokenAcceso: string }).tokenAcceso;
  };

  /** Formato de un producto nuevo con ese stock mínimo y ese stock por ubicación. */
  const nuevoFormato = async (
    stockMinimo: number,
    existencias: [ubicacion: number, cantidad: number][],
  ) => {
    const producto = await prisma.producto.create({
      data: {
        nombre: `${PREFIJO} Shampoo ${unico()}`,
        descripcion: 'Repara el cabello.',
        origenDescripcion: ORIGENES_DESCRIPCION.MANUAL,
        canalVenta: CANALES_VENTA.GENERAL,
        categoriaId,
      },
    });
    const articulo = await prisma.articuloVenta.create({
      data: { sku: `${PREFIJO}-${unico()}`, tipo: TIPOS_ARTICULO.FORMATO },
    });
    await prisma.formatoProducto.create({
      data: {
        id: articulo.id,
        productoId: producto.id,
        nombreFormato: '300 ml',
        stockMinimo,
        pesoGramos: 320,
        altoCm: 18,
        anchoCm: 6,
        largoCm: 6,
        esPredeterminado: true,
      },
    });
    for (const [ubicacion, cantidad] of existencias) {
      await prisma.existencia.create({
        data: { formatoId: articulo.id, ubicacionId: ubicacion, cantidad },
      });
    }
    return articulo.id;
  };

  /** El reporte, solo con los formatos de estas pruebas (la base puede tener otros). */
  const reporte = async (token = tokenAdministrador) => {
    const respuesta = await servidor()
      .get(RUTA)
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(Array.isArray(respuesta.body)).toBe(true);
    return (respuesta.body as FilaReporte[]).filter((fila) =>
      fila.sku.startsWith(PREFIJO),
    );
  };

  const limpiar = async () => {
    const formatosPrueba = {
      formato: { articulo: { sku: { startsWith: PREFIJO } } },
    };
    await prisma.existencia.deleteMany({ where: formatosPrueba });
    await prisma.articuloVenta.deleteMany({
      where: { sku: { startsWith: PREFIJO } },
    });
    await prisma.producto.deleteMany({
      where: { nombre: { startsWith: PREFIJO } },
    });
    await prisma.categoria.deleteMany({
      where: { nombre: { startsWith: PREFIJO } },
    });
    await prisma.ubicacion.deleteMany({
      where: { bodega: { nombre: { startsWith: PREFIJO } } },
    });
    await prisma.bodega.deleteMany({
      where: { nombre: { startsWith: PREFIJO } },
    });
  };

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = configurarApp(modulo.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    redis = app.get(REDIS);
    hashContrasena = await argon2.hash(CONTRASENA);
    await limpiar();

    const region = await prisma.region.upsert({
      where: { codigoCut: REGION },
      update: {},
      create: { codigoCut: REGION, nombre: 'Región de prueba reporte' },
    });
    await prisma.comuna.upsert({
      where: { codigoCut: COMUNA },
      update: {},
      create: {
        codigoCut: COMUNA,
        nombre: 'Comuna de prueba reporte',
        regionId: region.id,
      },
    });
    tokenAdministrador = await tokenDe(ROLES.ADMINISTRADOR);
  });

  beforeEach(async () => {
    const claves = await redis.keys('limite:*');
    if (claves.length) await redis.del(...claves);
    await limpiar();

    const comuna = await prisma.comuna.findUniqueOrThrow({
      where: { codigoCut: COMUNA },
    });
    const bodega = await prisma.bodega.create({
      data: {
        nombre: `${PREFIJO} Tienda`,
        direccion: 'Calle de prueba 500',
        tipo: 'tienda',
        comunaId: comuna.id,
      },
    });
    ubicacionId = (
      await prisma.ubicacion.create({
        data: { bodegaId: bodega.id, codigo: 'GONDOLA-1' },
      })
    ).id;
    otraUbicacionId = (
      await prisma.ubicacion.create({
        data: { bodegaId: bodega.id, codigo: 'BODEGA-1' },
      })
    ).id;
    categoriaId = (
      await prisma.categoria.create({
        data: { nombre: `${PREFIJO} Cat ${unico()}` },
      })
    ).id;
  });

  afterAll(async () => {
    await limpiar();
    await prisma.usuario.deleteMany({
      where: { email: { in: correosCreados } },
    });
    await prisma.comuna.deleteMany({ where: { codigoCut: COMUNA } });
    await prisma.region.deleteMany({ where: { codigoCut: REGION } });
    await app.close();
  });

  it('E14-H4 · formatos bajo el mínimo: el administrador los ve con su stock actual y su mínimo, del que más falta al que menos', async () => {
    // Total de todas las ubicaciones: 3 + 1 = 4 de 10 (faltan 6)
    const muyBajo = await nuevoFormato(10, [
      [ubicacionId, 3],
      [otraUbicacionId, 1],
    ]);
    // 4 de 5 (falta 1)
    const poco = await nuevoFormato(5, [[ubicacionId, 4]]);
    // Sin existencias: 0 de 3 (faltan 3)
    const agotado = await nuevoFormato(3, []);
    // En el mínimo, sobre el mínimo y sin mínimo definido: no aparecen
    await nuevoFormato(5, [[ubicacionId, 5]]);
    await nuevoFormato(5, [[ubicacionId, 9]]);
    await nuevoFormato(0, [[ubicacionId, 0]]);

    const filas = await reporte();

    expect(
      filas.map(({ formatoId, stockMinimo, stockTotal, faltante }) => ({
        formatoId,
        stockMinimo,
        stockTotal,
        faltante,
      })),
    ).toEqual([
      { formatoId: muyBajo, stockMinimo: 10, stockTotal: 4, faltante: 6 },
      { formatoId: agotado, stockMinimo: 3, stockTotal: 0, faltante: 3 },
      { formatoId: poco, stockMinimo: 5, stockTotal: 4, faltante: 1 },
    ]);
  });

  it('E14-H4 · sin formatos bajo el mínimo: ninguno de los formatos con stock suficiente aparece y la respuesta sigue siendo una lista', async () => {
    await nuevoFormato(5, [[ubicacionId, 5]]);
    await nuevoFormato(5, [
      [ubicacionId, 4],
      [otraUbicacionId, 6],
    ]);
    await nuevoFormato(0, []);

    expect(await reporte()).toEqual([]);
  });

  it('E14-H4 · se calcula al consultar: un formato repuesto sale del reporte', async () => {
    const formatoId = await nuevoFormato(5, [[ubicacionId, 2]]);
    expect((await reporte()).map((f) => f.formatoId)).toEqual([formatoId]);

    await prisma.existencia.update({
      where: { formatoId_ubicacionId: { formatoId, ubicacionId } },
      data: { cantidad: 8 },
    });

    expect(await reporte()).toEqual([]);
  });

  it('RNF-03 · reporte de stock bajo: sin sesión 401; bodeguero, vendedor, cliente y profesional 403 (solo el administrador)', async () => {
    await nuevoFormato(5, [[ubicacionId, 1]]);

    await servidor().get(RUTA).expect(401);
    for (const rol of [
      ROLES.BODEGUERO,
      ROLES.VENDEDOR,
      ROLES.CLIENTE,
      ROLES.PROFESIONAL,
    ]) {
      const token = await tokenDe(rol);
      await servidor().get(RUTA).auth(token, { type: 'bearer' }).expect(403);
    }
  });
});
