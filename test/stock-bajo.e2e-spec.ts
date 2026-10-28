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
  ESTADOS_NOTIFICACION,
  ORIGENES_DESCRIPCION,
  TIPOS_ARTICULO,
  TIPOS_MOVIMIENTO,
  TIPOS_NOTIFICACION,
} from '../src/common/dominio/valores.js';
import { configurarApp } from '../src/configurar-app.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { REDIS } from '../src/redis/redis.module.js';

// Requiere PostgreSQL y Redis levantados: `docker compose up -d db redis`.

const CONTRASENA = 'Secreta123';
const RUTA_AVISO = '/api/inventario/stock/bajo-minimo';
// Todo lo que crean estas pruebas lleva este prefijo, para borrarlo al terminar
const PREFIJO = 'E2E-stock-bajo';
// Región y comuna de prueba (códigos que no usa el CUT ni otra prueba); se borran al terminar
const REGION = '93';
const COMUNA = '93001';

interface FormatoBajoMinimo {
  formatoId: number;
  stockMinimo: number;
  stockTotal: number;
  faltante: number;
}

describe('Inventario · aviso de stock bajo el mínimo (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: Redis;
  let hashContrasena: string;
  let token: string;
  let ubicacionId: number;
  let otraUbicacionId: number;
  let formatoId: number;
  const correosCreados: string[] = [];

  const unico = () => randomUUID().slice(0, 8);

  /** Crea una cuenta con ese rol y devuelve su id. */
  const nuevaCuenta = async (
    rol: Rol,
    { activo = true, confirmada = true } = {},
  ) => {
    const email = `e2e-stock-bajo-${randomUUID()}@prueba.cl`;
    correosCreados.push(email);
    const cuenta = await prisma.usuario.create({
      data: {
        codigoPublico: randomUUID(),
        nombre: 'Camila',
        apellido: 'Rojas',
        email,
        contrasenaHash: hashContrasena,
        rol,
        activo,
        fechaVerificacionCorreo: confirmada ? new Date() : null,
      },
    });
    return { id: cuenta.id, email };
  };

  /** Crea una cuenta con ese rol, inicia sesión y devuelve su token de acceso. */
  const tokenDe = async (rol: Rol) => {
    const { email } = await nuevaCuenta(rol);
    const respuesta = await request(app.getHttpServer())
      .post('/api/cuentas/sesion')
      .send({ email, contrasena: CONTRASENA })
      .expect(200);
    return (respuesta.body as { tokenAcceso: string }).tokenAcceso;
  };

  /** Formato de un producto nuevo con ese stock mínimo; devuelve su id. */
  const nuevoFormato = async (categoriaId: number, stockMinimo: number) => {
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
    return articulo.id;
  };

  const conStock = (cantidad: number, en = ubicacionId) =>
    prisma.existencia.create({
      data: { formatoId, ubicacionId: en, cantidad },
    });

  const salida = (cantidad: number, en = ubicacionId, con = token) =>
    request(app.getHttpServer())
      .post('/api/inventario/salidas')
      .auth(con, { type: 'bearer' })
      .send({
        formatoId,
        ubicacionId: en,
        tipo: TIPOS_MOVIMIENTO.MERMA_DANO,
        cantidad,
      });

  const ajuste = (cantidad: number) =>
    request(app.getHttpServer())
      .post('/api/inventario/ajustes')
      .auth(token, { type: 'bearer' })
      .send({
        formatoId,
        ubicacionId,
        cantidad,
        observacion: 'Conteo físico',
      });

  /** Notificaciones de stock bajo de este formato (el asunto lleva el nombre del producto). */
  const avisos = async () => {
    const { producto } = await prisma.formatoProducto.findUniqueOrThrow({
      where: { id: formatoId },
      select: { producto: { select: { nombre: true } } },
    });
    return prisma.notificacion.findMany({
      where: {
        tipo: TIPOS_NOTIFICACION.STOCK_BAJO,
        asunto: { contains: producto.nombre },
      },
    });
  };

  const avisoDelPanel = async (con = token) => {
    const respuesta = await request(app.getHttpServer())
      .get(RUTA_AVISO)
      .auth(con, { type: 'bearer' })
      .expect(200);
    return (respuesta.body as FormatoBajoMinimo[]).find(
      (f) => f.formatoId === formatoId,
    );
  };

  const limpiar = async () => {
    const formatosPrueba = {
      formato: { articulo: { sku: { startsWith: PREFIJO } } },
    };
    await prisma.notificacion.deleteMany({
      where: {
        tipo: TIPOS_NOTIFICACION.STOCK_BAJO,
        asunto: { contains: PREFIJO },
      },
    });
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
      create: { codigoCut: REGION, nombre: 'Región de prueba stock bajo' },
    });
    await prisma.comuna.upsert({
      where: { codigoCut: COMUNA },
      update: {},
      create: {
        codigoCut: COMUNA,
        nombre: 'Comuna de prueba stock bajo',
        regionId: region.id,
      },
    });
    token = await tokenDe(ROLES.BODEGUERO);
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
        direccion: 'Calle de prueba 300',
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
    const categoriaId = (
      await prisma.categoria.create({
        data: { nombre: `${PREFIJO} Cat ${unico()}` },
      })
    ).id;
    formatoId = await nuevoFormato(categoriaId, 5);
  });

  afterAll(async () => {
    // Las notificaciones y los movimientos apuntan a las cuentas: primero ellos
    await limpiar();
    await prisma.usuario.deleteMany({
      where: { email: { in: correosCreados } },
    });
    await prisma.comuna.deleteMany({ where: { codigoCut: COMUNA } });
    await prisma.region.deleteMany({ where: { codigoCut: REGION } });
    await app.close();
  });

  it('E11-H6 · stock bajo el mínimo: una salida que lo cruza deja el aviso en el panel y una notificación pendiente para bodega y administración', async () => {
    const administrador = await nuevaCuenta(ROLES.ADMINISTRADOR);
    const bodeguero = await nuevaCuenta(ROLES.BODEGUERO);
    const vendedor = await nuevaCuenta(ROLES.VENDEDOR);
    const desactivado = await nuevaCuenta(ROLES.BODEGUERO, { activo: false });
    const sinConfirmar = await nuevaCuenta(ROLES.ADMINISTRADOR, {
      confirmada: false,
    });
    await conStock(6);

    await salida(2).expect(201);

    const notificaciones = await avisos();
    const destinatarios = notificaciones.map((n) => n.usuarioId);
    expect(destinatarios).toEqual(
      expect.arrayContaining([administrador.id, bodeguero.id]),
    );
    expect(destinatarios).not.toContain(vendedor.id);
    expect(destinatarios).not.toContain(desactivado.id);
    expect(destinatarios).not.toContain(sinConfirmar.id);
    expect(new Set(destinatarios).size).toBe(destinatarios.length);
    expect(
      notificaciones.every(
        (n) => n.estadoEnvio === ESTADOS_NOTIFICACION.PENDIENTE,
      ),
    ).toBe(true);

    expect(await avisoDelPanel()).toEqual(
      expect.objectContaining({
        formatoId,
        stockMinimo: 5,
        stockTotal: 4,
        faltante: 1,
      }),
    );
  });

  it('E11-H6 · stock bajo el mínimo: un ajuste negativo que lo cruza también avisa', async () => {
    await conStock(5);

    await ajuste(-1).expect(201);

    expect((await avisos()).length).toBeGreaterThan(0);
    expect(await avisoDelPanel()).toMatchObject({ stockTotal: 4 });
  });

  it('E11-H6 · stock bajo el mínimo: se compara el total de todas las ubicaciones', async () => {
    await conStock(3);
    await conStock(4, otraUbicacionId);

    // 7 → 5: el total queda en el mínimo aunque la góndola quede en 1
    await salida(2).expect(201);
    expect(await avisos()).toHaveLength(0);

    // 5 → 4: ahora sí queda bajo el mínimo
    await salida(1, otraUbicacionId).expect(201);
    expect((await avisos()).length).toBeGreaterThan(0);
  });

  it('E11-H6 · stock sobre el mínimo: si queda igual o sobre el mínimo no hay aviso', async () => {
    await conStock(8);

    await salida(2).expect(201);
    await salida(1).expect(201);

    expect(await avisos()).toHaveLength(0);
    expect(await avisoDelPanel()).toBeUndefined();
  });

  it('E11-H6 · stock ya bajo el mínimo: otro movimiento no repite el correo', async () => {
    await conStock(6);
    await salida(2).expect(201);
    const primeras = (await avisos()).length;

    await salida(1).expect(201);

    expect(await avisos()).toHaveLength(primeras);
    expect(await avisoDelPanel()).toMatchObject({ stockTotal: 3 });
  });

  it('E11-H6 · stock repuesto: el formato sale del aviso del panel', async () => {
    await conStock(6);
    await salida(2).expect(201);

    await ajuste(3).expect(201);

    expect(await avisoDelPanel()).toBeUndefined();
  });

  it('RNF-13 · dos salidas simultáneas que cruzan el mínimo: el aviso sale una sola vez', async () => {
    await nuevaCuenta(ROLES.ADMINISTRADOR);
    await conStock(3);
    await conStock(3, otraUbicacionId);

    // 6 → 4 entre las dos: solo una de ellas cruza el mínimo de 5
    const respuestas = await Promise.all([
      salida(1),
      salida(1, otraUbicacionId),
    ]);

    expect(respuestas.map((r) => r.status)).toEqual([201, 201]);
    const destinatarios = (await avisos()).map((n) => n.usuarioId);
    expect(destinatarios.length).toBeGreaterThan(0);
    expect(new Set(destinatarios).size).toBe(destinatarios.length);
  });

  it('RNF-13 · transferencias y salidas simultáneas del mismo formato: no se bloquean entre sí', async () => {
    await conStock(20);
    await conStock(20, otraUbicacionId);

    const transferencia = () =>
      request(app.getHttpServer())
        .post('/api/inventario/transferencias')
        .auth(token, { type: 'bearer' })
        .send({
          formatoId,
          ubicacionOrigenId: ubicacionId,
          ubicacionDestinoId: otraUbicacionId,
          cantidad: 1,
        });
    const respuestas = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        i % 2 === 0 ? transferencia() : salida(1),
      ),
    );

    expect(respuestas.map((r) => r.status)).toEqual(Array(6).fill(201));
    const total = await prisma.existencia.aggregate({
      where: { formatoId },
      _sum: { cantidad: true },
    });
    expect(total._sum.cantidad).toBe(37);
  });

  it('RNF-03 · aviso del panel: sin sesión 401; vendedor, cliente y profesional 403; bodeguero y administrador lo ven', async () => {
    await request(app.getHttpServer()).get(RUTA_AVISO).expect(401);

    for (const rol of [ROLES.VENDEDOR, ROLES.CLIENTE, ROLES.PROFESIONAL]) {
      const tokenRol = await tokenDe(rol);
      await request(app.getHttpServer())
        .get(RUTA_AVISO)
        .auth(tokenRol, { type: 'bearer' })
        .expect(403);
    }
    await conStock(4);
    expect(
      await avisoDelPanel(await tokenDe(ROLES.ADMINISTRADOR)),
    ).toMatchObject({ stockTotal: 4, faltante: 1 });
  });
});
