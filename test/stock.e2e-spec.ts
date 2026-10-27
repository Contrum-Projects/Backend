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
  TIPOS_DOCUMENTO_PROVEEDOR,
} from '../src/common/dominio/valores.js';
import { configurarApp } from '../src/configurar-app.js';
import type { StockFormato } from '../src/modulos/inventario/stock.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { REDIS } from '../src/redis/redis.module.js';

// Requiere PostgreSQL y Redis levantados: `docker compose up -d db redis`.

const CONTRASENA = 'Secreta123';
// Todo lo que crean estas pruebas lleva este prefijo, para borrarlo al terminar
const PREFIJO = 'E2E-stock';
// Región y comuna de prueba (códigos que no usa el CUT ni otra prueba); se borran al terminar
const REGION = '94';
const COMUNA = '94001';
const RUT_PROVEEDOR_A = '76543219-7';
const RUT_PROVEEDOR_B = '77111222-6';

describe('Inventario · stock por formato (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: Redis;
  let hashContrasena: string;
  let token: string;
  let usuarioId: number;
  let formatoId: number;
  let gondolaId: number;
  let estanteId: number;
  let proveedorA: number;
  let proveedorB: number;
  const correosCreados: string[] = [];

  const unico = () => randomUUID().slice(0, 8);

  /** Crea una cuenta con ese rol, inicia sesión y devuelve su token de acceso. */
  const tokenDe = async (rol: Rol) => {
    const email = `e2e-stock-${randomUUID()}@prueba.cl`;
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

  const consultar = (id: number | string = formatoId, con = token) =>
    request(app.getHttpServer())
      .get(`/api/inventario/stock/formatos/${id}`)
      .auth(con, { type: 'bearer' });

  /** Entrada de un proveedor con un costo para el formato (solo los datos, sin tocar el stock). */
  const conEntrada = (
    proveedorId: number,
    fechaRecepcion: string,
    costoUnitarioNeto: number,
  ) =>
    prisma.entradaInventario.create({
      data: {
        proveedorId,
        usuarioId,
        fechaRecepcion: new Date(`${fechaRecepcion}T00:00:00Z`),
        tipoDocumentoProveedor: TIPOS_DOCUMENTO_PROVEEDOR.FACTURA,
        numeroDocumentoProveedor: unico().toUpperCase(),
        detalles: {
          create: { formatoId, cantidadRecibida: 5, costoUnitarioNeto },
        },
      },
    });

  const conStock = (ubicacionId: number, cantidad: number) =>
    prisma.existencia.create({ data: { formatoId, ubicacionId, cantidad } });

  const limpiar = async () => {
    await prisma.entradaInventario.deleteMany({
      where: { proveedor: { rut: { in: [RUT_PROVEEDOR_A, RUT_PROVEEDOR_B] } } },
    });
    await prisma.proveedor.deleteMany({
      where: { rut: { in: [RUT_PROVEEDOR_A, RUT_PROVEEDOR_B] } },
    });
    await prisma.existencia.deleteMany({
      where: { formato: { articulo: { sku: { startsWith: PREFIJO } } } },
    });
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
      create: { codigoCut: REGION, nombre: 'Región de prueba stock' },
    });
    await prisma.comuna.upsert({
      where: { codigoCut: COMUNA },
      update: {},
      create: {
        codigoCut: COMUNA,
        nombre: 'Comuna de prueba stock',
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
    const bodega = (nombre: string) =>
      prisma.bodega.create({
        data: {
          nombre: `${PREFIJO} ${nombre}`,
          direccion: 'Calle de prueba 300',
          tipo: 'tienda',
          comunaId: comuna.id,
        },
      });
    const central = await bodega('Bodega central');
    const tienda = await bodega('Tienda');
    estanteId = (
      await prisma.ubicacion.create({
        data: { bodegaId: central.id, codigo: 'A-01' },
      })
    ).id;
    gondolaId = (
      await prisma.ubicacion.create({
        data: { bodegaId: tienda.id, codigo: 'GONDOLA-1' },
      })
    ).id;

    const categoria = await prisma.categoria.create({
      data: { nombre: `${PREFIJO} Cat ${unico()}` },
    });
    const producto = await prisma.producto.create({
      data: {
        nombre: `${PREFIJO} Shampoo ${unico()}`,
        descripcion: 'Repara el cabello.',
        origenDescripcion: ORIGENES_DESCRIPCION.MANUAL,
        canalVenta: CANALES_VENTA.GENERAL,
        categoriaId: categoria.id,
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
    formatoId = articulo.id;

    proveedorA = (
      await prisma.proveedor.create({
        data: { rut: RUT_PROVEEDOR_A, razonSocial: `${PREFIJO} Proveedor A` },
      })
    ).id;
    proveedorB = (
      await prisma.proveedor.create({
        data: { rut: RUT_PROVEEDOR_B, razonSocial: `${PREFIJO} Proveedor B` },
      })
    ).id;

    token = await tokenDe(ROLES.BODEGUERO);
    usuarioId = (
      await prisma.usuario.findUniqueOrThrow({
        where: { email: correosCreados.at(-1) },
      })
    ).id;
  });

  afterAll(async () => {
    // Las entradas apuntan a la cuenta que las registró: primero ellas
    await limpiar();
    await prisma.usuario.deleteMany({
      where: { email: { in: correosCreados } },
    });
    await prisma.comuna.deleteMany({ where: { codigoCut: COMUNA } });
    await prisma.region.deleteMany({ where: { codigoCut: REGION } });
    await app.close();
  });

  it('E11-H5 · stock por ubicación: devuelve la cantidad en cada ubicación y el total', async () => {
    await conStock(gondolaId, 4);
    await conStock(estanteId, 6);

    const stock = (await consultar().expect(200)).body as StockFormato;

    expect(stock.formato).toMatchObject({
      id: formatoId,
      nombreFormato: '300 ml',
      activo: true,
    });
    expect(stock.ubicaciones).toEqual([
      {
        id: estanteId,
        codigo: 'A-01',
        bodega: `${PREFIJO} Bodega central`,
        activa: true,
        cantidad: 6,
      },
      {
        id: gondolaId,
        codigo: 'GONDOLA-1',
        bodega: `${PREFIJO} Tienda`,
        activa: true,
        cantidad: 4,
      },
    ]);
    expect(stock.total).toBe(10);
  });

  it('E11-H5 · stock por ubicación: omite las ubicaciones que quedaron en 0 e incluye las desactivadas con stock', async () => {
    await conStock(gondolaId, 0);
    await conStock(estanteId, 3);
    await prisma.ubicacion.update({
      where: { id: estanteId },
      data: { activa: false },
    });

    const stock = (await consultar().expect(200)).body as StockFormato;

    expect(stock.ubicaciones).toEqual([
      expect.objectContaining({ id: estanteId, activa: false, cantidad: 3 }),
    ]);
    expect(stock.total).toBe(3);
  });

  it('E11-H5 · stock por ubicación: una ubicación activa de una bodega desactivada se muestra como inactiva', async () => {
    await conStock(gondolaId, 2);
    await prisma.bodega.updateMany({
      where: { ubicaciones: { some: { id: gondolaId } } },
      data: { activa: false },
    });

    const stock = (await consultar().expect(200)).body as StockFormato;

    expect(stock.ubicaciones).toEqual([
      expect.objectContaining({ id: gondolaId, activa: false, cantidad: 2 }),
    ]);
  });

  it('E11-H5 · último proveedor y costo: devuelve el proveedor y el costo unitario de la entrada más reciente', async () => {
    await conStock(gondolaId, 10);
    // La más reciente por recepción se registra primero: manda la fecha, no el orden de registro
    await conEntrada(proveedorB, '2026-10-20', 2490.5);
    await conEntrada(proveedorA, '2026-10-10', 1990);

    const stock = (await consultar().expect(200)).body as StockFormato;

    expect(stock.ultimaEntrada).toEqual({
      fechaRecepcion: '2026-10-20',
      proveedor: {
        id: proveedorB,
        rut: RUT_PROVEEDOR_B,
        razonSocial: `${PREFIJO} Proveedor B`,
      },
      costoUnitarioNeto: 2490.5,
    });
  });

  it('E11-H5 · último proveedor y costo: entre entradas del mismo día, la registrada después', async () => {
    await conEntrada(proveedorA, '2026-10-20', 1990);
    await conEntrada(proveedorB, '2026-10-20', 2100);

    const stock = (await consultar().expect(200)).body as StockFormato;

    expect(stock.ultimaEntrada).toMatchObject({
      proveedor: { id: proveedorB },
      costoUnitarioNeto: 2100,
    });
  });

  it('E11-H5 · formato sin entradas: devuelve stock cero y ningún proveedor ni costo', async () => {
    const stock = (await consultar().expect(200)).body as StockFormato;

    expect(stock.ubicaciones).toEqual([]);
    expect(stock.total).toBe(0);
    expect(stock.ultimaEntrada).toBeNull();
  });

  it('un formato que no existe o un id imposible responde 404', async () => {
    for (const id of [2_000_000_000, 'abc', 0]) {
      const respuesta = await consultar(id).expect(404);
      expect((respuesta.body as { message: string }).message).toBe(
        'El formato no existe.',
      );
    }
  });

  it('RNF-03 · sin sesión responde 401, cliente y profesional 403, y el personal con permiso de consulta lo ve', async () => {
    await conStock(gondolaId, 2);
    await request(app.getHttpServer())
      .get(`/api/inventario/stock/formatos/${formatoId}`)
      .expect(401);

    for (const rol of [ROLES.CLIENTE, ROLES.PROFESIONAL]) {
      await consultar(formatoId, await tokenDe(rol)).expect(403);
    }
    for (const rol of [ROLES.VENDEDOR, ROLES.ADMINISTRADOR]) {
      const respuesta = await consultar(formatoId, await tokenDe(rol)).expect(
        200,
      );
      expect((respuesta.body as StockFormato).total).toBe(2);
    }
  });
});
