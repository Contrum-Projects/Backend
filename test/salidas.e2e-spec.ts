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
  TIPOS_MOVIMIENTO,
} from '../src/common/dominio/valores.js';
import { configurarApp } from '../src/configurar-app.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { REDIS } from '../src/redis/redis.module.js';

// Requiere PostgreSQL y Redis levantados: `docker compose up -d db redis`.

const CONTRASENA = 'Secreta123';
const RUTA = '/api/inventario/salidas';
// Todo lo que crean estas pruebas lleva este prefijo, para borrarlo al terminar
const PREFIJO = 'E2E-salidas';
// Región y comuna de prueba (códigos que no usa el CUT ni otra prueba); se borran al terminar
const REGION = '97';
const COMUNA = '97001';

interface SalidaRespuesta {
  movimientoId: number;
  tipo: string;
  cantidad: number;
  stockRestante: number;
}

describe('Inventario · salidas (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: Redis;
  let hashContrasena: string;
  let token: string;
  let ubicacionId: number;
  let formatoId: number;
  const correosCreados: string[] = [];

  const unico = () => randomUUID().slice(0, 8);

  /** Crea una cuenta con ese rol, inicia sesión y devuelve su token de acceso. */
  const tokenDe = async (rol: Rol) => {
    const email = `e2e-salidas-${randomUUID()}@prueba.cl`;
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
    const respuesta = await request(app.getHttpServer())
      .post('/api/cuentas/sesion')
      .send({ email, contrasena: CONTRASENA })
      .expect(200);
    return (respuesta.body as { tokenAcceso: string }).tokenAcceso;
  };

  /** Formato de un producto nuevo; devuelve su id. */
  const nuevoFormato = async (categoriaId: number) => {
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
        pesoGramos: 320,
        altoCm: 18,
        anchoCm: 6,
        largoCm: 6,
        esPredeterminado: true,
      },
    });
    return articulo.id;
  };

  const salidaValida = (cantidad = 4) => ({
    formatoId,
    ubicacionId,
    tipo: TIPOS_MOVIMIENTO.MERMA_DANO,
    cantidad,
  });

  const registrar = (cuerpo: object, con = token) =>
    request(app.getHttpServer())
      .post(RUTA)
      .auth(con, { type: 'bearer' })
      .send(cuerpo);

  const conStock = (cantidad: number) =>
    prisma.existencia.create({ data: { formatoId, ubicacionId, cantidad } });

  const stock = async () =>
    (
      await prisma.existencia.findUnique({
        where: { formatoId_ubicacionId: { formatoId, ubicacionId } },
      })
    )?.cantidad ?? 0;

  const movimientos = () =>
    prisma.movimientoInventario.findMany({ where: { formatoId } });

  const mensajeDe = (cuerpo: unknown) =>
    (cuerpo as { message: string | string[] }).message;

  const limpiar = async () => {
    const formatosPrueba = {
      formato: { articulo: { sku: { startsWith: PREFIJO } } },
    };
    await prisma.movimientoInventario.deleteMany({ where: formatosPrueba });
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
      create: { codigoCut: REGION, nombre: 'Región de prueba salidas' },
    });
    await prisma.comuna.upsert({
      where: { codigoCut: COMUNA },
      update: {},
      create: {
        codigoCut: COMUNA,
        nombre: 'Comuna de prueba salidas',
        regionId: region.id,
      },
    });
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
        direccion: 'Calle de prueba 200',
        tipo: 'tienda',
        comunaId: comuna.id,
      },
    });
    ubicacionId = (
      await prisma.ubicacion.create({
        data: { bodegaId: bodega.id, codigo: 'GONDOLA-1' },
      })
    ).id;
    const categoriaId = (
      await prisma.categoria.create({
        data: { nombre: `${PREFIJO} Cat ${unico()}` },
      })
    ).id;
    formatoId = await nuevoFormato(categoriaId);
    token = await tokenDe(ROLES.BODEGUERO);
  });

  afterAll(async () => {
    // Los movimientos apuntan a la cuenta que los registró: primero ellos
    await limpiar();
    await prisma.usuario.deleteMany({
      where: { email: { in: correosCreados } },
    });
    await prisma.comuna.deleteMany({ where: { codigoCut: COMUNA } });
    await prisma.region.deleteMany({ where: { codigoCut: REGION } });
    await app.close();
  });

  it('E11-H3 · salida registrada: descuenta el stock de la ubicación y deja un movimiento con el tipo de salida', async () => {
    await conStock(10);

    const respuesta = await registrar({
      ...salidaValida(4),
      observacion: 'Envase roto al reponer',
    }).expect(201);
    const salida = respuesta.body as SalidaRespuesta;

    expect(await stock()).toBe(6);
    expect(salida).toMatchObject({
      tipo: TIPOS_MOVIMIENTO.MERMA_DANO,
      cantidad: 4,
      stockRestante: 6,
    });
    expect(await movimientos()).toEqual([
      expect.objectContaining({
        id: salida.movimientoId,
        tipo: TIPOS_MOVIMIENTO.MERMA_DANO,
        cantidad: 4,
        ubicacionOrigenId: ubicacionId,
        ubicacionDestinoId: null,
        entradaId: null,
        observacion: 'Envase roto al reponer',
      }),
    ]);
  });

  it('E11-H3 · salida registrada: cada tipo (vencimiento, daño, consumo) queda en su movimiento y puede dejar el stock en 0', async () => {
    await conStock(3);

    for (const tipo of [
      TIPOS_MOVIMIENTO.MERMA_VENCIMIENTO,
      TIPOS_MOVIMIENTO.MERMA_DANO,
      TIPOS_MOVIMIENTO.CONSUMO_PELUQUERIA,
    ]) {
      await registrar({ ...salidaValida(1), tipo }).expect(201);
    }

    expect(await stock()).toBe(0);
    expect((await movimientos()).map((m) => m.tipo)).toEqual(
      expect.arrayContaining([
        TIPOS_MOVIMIENTO.MERMA_VENCIMIENTO,
        TIPOS_MOVIMIENTO.MERMA_DANO,
        TIPOS_MOVIMIENTO.CONSUMO_PELUQUERIA,
      ]),
    );
    expect(await movimientos()).toHaveLength(3);
  });

  it('E11-H3 · salida registrada: se admite desde una ubicación y un formato desactivados', async () => {
    await conStock(5);
    await prisma.ubicacion.update({
      where: { id: ubicacionId },
      data: { activa: false },
    });
    await prisma.articuloVenta.update({
      where: { id: formatoId },
      data: { activo: false },
    });

    await registrar(salidaValida(5)).expect(201);
    expect(await stock()).toBe(0);
  });

  it('E11-H3 · cantidad mayor al stock: rechaza la salida, el stock no cambia y no queda movimiento', async () => {
    await conStock(3);

    const respuesta = await registrar(salidaValida(5)).expect(400);

    expect(mensajeDe(respuesta.body)).toBe(
      'No hay stock suficiente en esa ubicación: hay 3 y la salida es de 5.',
    );
    expect(await stock()).toBe(3);
    expect(await movimientos()).toHaveLength(0);
  });

  it('E11-H3 · cantidad mayor al stock: sin stock del formato en la ubicación también se rechaza', async () => {
    await registrar(salidaValida(1)).expect(400);

    expect(await movimientos()).toHaveLength(0);
  });

  it('RNF-13 · dos salidas simultáneas por el último stock: solo una se registra', async () => {
    await conStock(5);

    const respuestas = await Promise.all([
      registrar(salidaValida(3)),
      registrar(salidaValida(3)),
    ]);

    expect(respuestas.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      201, 400,
    ]);
    expect(await stock()).toBe(2);
    expect(await movimientos()).toHaveLength(1);
  });

  it('rechaza un tipo que no es salida y un formato que no existe', async () => {
    await conStock(5);

    await registrar({ ...salidaValida(), tipo: 'entrada' }).expect(400);
    const respuesta = await registrar({
      ...salidaValida(),
      formatoId: 2_000_000_000,
    }).expect(400);
    expect(mensajeDe(respuesta.body)).toBe('El formato no existe.');
    expect(await stock()).toBe(5);
  });

  it('RNF-03 · sin sesión responde 401 y con un rol sin permiso de inventario 403', async () => {
    await conStock(10);
    await request(app.getHttpServer())
      .post(RUTA)
      .send(salidaValida())
      .expect(401);

    for (const rol of [ROLES.VENDEDOR, ROLES.CLIENTE, ROLES.PROFESIONAL]) {
      await registrar(salidaValida(), await tokenDe(rol)).expect(403);
    }
    await registrar(salidaValida(), await tokenDe(ROLES.ADMINISTRADOR)).expect(
      201,
    );
    expect(await stock()).toBe(6);
  });
});
