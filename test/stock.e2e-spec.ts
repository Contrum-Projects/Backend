import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import argon2 from 'argon2';
import type { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import type { Prisma } from '../src/generated/prisma/client.js';
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
    await prisma.movimientoInventario.deleteMany({
      where: { formato: { articulo: { sku: { startsWith: PREFIJO } } } },
    });
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

  describe('listado', () => {
    interface FilaStock {
      formatoId: number;
      sku: string;
      producto: string;
      nombreFormato: string;
      imagen: string | null;
      ubicaciones: { id: number; codigo: string }[];
      stock: number;
      stockMinimo: number;
      bajoMinimo: boolean;
      ultimaEntrada: {
        costoUnitarioNeto: number;
        proveedor: { id: number; razonSocial: string };
      } | null;
    }
    interface Listado {
      items: FilaStock[];
      total: number;
      pagina: number;
      limite: number;
      totalBajoMinimo: number;
    }

    /** Otro formato de prueba, con su producto (el nombre decide el orden del listado). */
    const otroFormato = async (nombreProducto: string, stockMinimo: number) => {
      const { categoriaId } = await prisma.producto.findFirstOrThrow({
        where: { nombre: { startsWith: PREFIJO } },
      });
      const producto = await prisma.producto.create({
        data: {
          nombre: `${PREFIJO} ${nombreProducto}`,
          descripcion: 'Producto de prueba.',
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
          nombreFormato: '1 litro',
          stockMinimo,
          pesoGramos: 1000,
          altoCm: 25,
          anchoCm: 8,
          largoCm: 8,
          esPredeterminado: true,
        },
      });
      return articulo.id;
    };

    const listar = async (query: object, con = token) =>
      (
        await request(app.getHttpServer())
          .get('/api/inventario/stock')
          .query({ buscar: PREFIJO, ...query })
          .auth(con, { type: 'bearer' })
          .expect(200)
      ).body as Listado;

    /** El formato principal bajo su mínimo (7 de 10, en dos bodegas) y otros dos que no lo están. */
    const prepararListado = async () => {
      await prisma.formatoProducto.update({
        where: { id: formatoId },
        data: { stockMinimo: 10 },
      });
      await conStock(estanteId, 4);
      await conStock(gondolaId, 3);
      await conEntrada(proveedorA, '2026-10-01', 3500);
      // Nunca recibido, sin mínimo: stock 0 y sin proveedor ni costo (criterio 3)
      const sinEntradas = await otroFormato('Acondicionador', 0);
      // Sobre su mínimo
      const conMinimo = await otroFormato('Tinte', 2);
      await prisma.existencia.create({
        data: { formatoId: conMinimo, ubicacionId: estanteId, cantidad: 5 },
      });
      const { bodegaId: tiendaId } = await prisma.ubicacion.findUniqueOrThrow({
        where: { id: gondolaId },
      });
      return { sinEntradas, conMinimo, tiendaId };
    };

    it('E11-H5 · stock: cada formato con sus ubicaciones, su stock, el último costo y proveedor, y si está bajo el mínimo', async () => {
      const { sinEntradas, conMinimo } = await prepararListado();

      const listado = await listar({});

      expect(listado.items.map((fila) => fila.formatoId)).toEqual([
        sinEntradas,
        formatoId,
        conMinimo,
      ]);
      expect(listado).toMatchObject({
        total: 3,
        pagina: 1,
        limite: 20,
        totalBajoMinimo: 1,
      });
      expect(listado.items[0]).toMatchObject({
        stock: 0,
        stockMinimo: 0,
        ubicaciones: [],
        bajoMinimo: false,
        ultimaEntrada: null,
        imagen: null,
      });
      expect(listado.items[1]).toMatchObject({
        stock: 7,
        stockMinimo: 10,
        bajoMinimo: true,
        ubicaciones: [
          { id: estanteId, codigo: 'A-01' },
          { id: gondolaId, codigo: 'GONDOLA-1' },
        ],
        ultimaEntrada: {
          costoUnitarioNeto: 3500,
          proveedor: { id: proveedorA, razonSocial: `${PREFIJO} Proveedor A` },
        },
      });
    });

    it('E11-H5 · stock: con bodega, solo sus formatos, ubicaciones y unidades; el mínimo se mide con el total', async () => {
      const { tiendaId } = await prepararListado();

      const listado = await listar({ bodegaId: tiendaId });

      expect(listado).toMatchObject({ total: 1, totalBajoMinimo: 1 });
      expect(listado.items).toEqual([
        expect.objectContaining({
          formatoId,
          stock: 3,
          ubicaciones: [{ id: gondolaId, codigo: 'GONDOLA-1' }],
          bajoMinimo: true,
        }),
      ]);
    });

    it('E11-H5 · stock: «bajo el mínimo» deja solo esos formatos y el chip cuenta los de la búsqueda', async () => {
      await prepararListado();

      const listado = await listar({ bajoMinimo: 'true' });

      expect(listado.items.map((fila) => fila.formatoId)).toEqual([formatoId]);
      expect(listado).toMatchObject({ total: 1, totalBajoMinimo: 1 });
    });

    it('RNF-03 · el listado lo ve el personal con permiso de consulta; el cliente recibe 403', async () => {
      const vendedor = await tokenDe(ROLES.VENDEDOR);
      const cliente = await tokenDe(ROLES.CLIENTE);
      await listar({}, vendedor);
      await request(app.getHttpServer())
        .get('/api/inventario/stock')
        .auth(cliente, { type: 'bearer' })
        .expect(403);
      await request(app.getHttpServer())
        .get('/api/inventario/stock')
        .query({ bodegaId: 'x' })
        .auth(token, { type: 'bearer' })
        .expect(400);
    });
  });

  describe('movimientos', () => {
    interface Movimiento {
      id: number;
      fechaHora: string;
      tipo: string;
      formato: { id: number; producto: string; nombreFormato: string };
      cantidad: number;
      ubicacion: { id: number; codigo: string; bodega: string };
      destino: { id: number; codigo: string; bodega: string } | null;
      referencia: string | null;
      registradoPor: { nombre: string } | null;
    }
    interface Listado {
      items: Movimiento[];
      total: number;
      pagina: number;
      limite: number;
    }

    const listar = async (query: object, con = token) =>
      (
        await request(app.getHttpServer())
          .get('/api/inventario/movimientos')
          .query({ buscar: PREFIJO, ...query })
          .auth(con, { type: 'bearer' })
          .expect(200)
      ).body as Listado;

    const movimiento = (
      data: Omit<Prisma.MovimientoInventarioUncheckedCreateInput, 'formatoId'>,
    ) => prisma.movimientoInventario.create({ data: { formatoId, ...data } });

    /** Una entrada a la central, una merma en ella, una transferencia a la tienda y una venta. */
    const prepararMovimientos = async () => {
      const entrada = await conEntrada(proveedorA, '2026-10-01', 3500);
      const recibido = await movimiento({
        tipo: 'entrada',
        cantidad: 5,
        ubicacionDestinoId: estanteId,
        entradaId: entrada.id,
        usuarioId,
        fechaHora: new Date('2026-10-01T15:00:00Z'),
      });
      const merma = await movimiento({
        tipo: 'merma_dano',
        cantidad: 1,
        ubicacionOrigenId: estanteId,
        usuarioId,
        observacion: 'Envase roto',
        fechaHora: new Date('2026-10-02T15:00:00Z'),
      });
      const transferencia = await movimiento({
        tipo: 'transferencia',
        cantidad: 2,
        ubicacionOrigenId: estanteId,
        ubicacionDestinoId: gondolaId,
        usuarioId,
        fechaHora: new Date('2026-10-03T15:00:00Z'),
      });
      // La venta la registra el sistema; aunque tenga cuenta, no se muestra quién
      const venta = await movimiento({
        tipo: 'venta',
        cantidad: 1,
        ubicacionOrigenId: gondolaId,
        usuarioId,
        fechaHora: new Date('2026-10-04T15:00:00Z'),
      });
      return { entrada, recibido, merma, transferencia, venta };
    };

    it('E11-H5 · movimientos: del más reciente al más antiguo, con signo, referencia y quién los registró', async () => {
      const { entrada, recibido, merma, transferencia, venta } =
        await prepararMovimientos();

      const listado = await listar({});

      expect(listado.items.map((fila) => fila.id)).toEqual([
        venta.id,
        transferencia.id,
        merma.id,
        recibido.id,
      ]);
      expect(listado).toMatchObject({ total: 4, pagina: 1, limite: 20 });
      const [vendido, transferido, mermado, recibidoFila] = listado.items;
      expect(vendido).toMatchObject({
        tipo: 'venta',
        cantidad: -1,
        ubicacion: {
          id: gondolaId,
          codigo: 'GONDOLA-1',
          bodega: `${PREFIJO} Tienda`,
        },
        destino: null,
        registradoPor: null,
      });
      expect(transferido).toMatchObject({
        cantidad: 2,
        ubicacion: { id: estanteId, codigo: 'A-01' },
        destino: { id: gondolaId, codigo: 'GONDOLA-1' },
        registradoPor: { nombre: 'Camila Rojas' },
      });
      expect(mermado).toMatchObject({
        cantidad: -1,
        referencia: 'Envase roto',
      });
      expect(recibidoFila).toMatchObject({
        tipo: 'entrada',
        cantidad: 5,
        fechaHora: '2026-10-01T15:00:00.000Z',
        formato: { id: formatoId, nombreFormato: '300 ml' },
        ubicacion: { id: estanteId },
        referencia: entrada.numeroDocumentoProveedor,
      });
    });

    it('E11-H5 · movimientos: filtra por grupo, por bodega (origen o destino) y por período en hora de Chile', async () => {
      const { recibido, merma, transferencia, venta } =
        await prepararMovimientos();
      const ids = (listado: Listado) => listado.items.map((fila) => fila.id);
      const { bodegaId: tiendaId } = await prisma.ubicacion.findUniqueOrThrow({
        where: { id: gondolaId },
      });

      expect(ids(await listar({ grupo: 'entradas' }))).toEqual([recibido.id]);
      expect(ids(await listar({ grupo: 'salidas' }))).toEqual([merma.id]);
      expect(ids(await listar({ grupo: 'ventas' }))).toEqual([venta.id]);
      expect(ids(await listar({ bodegaId: tiendaId }))).toEqual([
        venta.id,
        transferencia.id,
      ]);
      // 2026-10-02T15:00Z es el 2 de octubre en Chile; el 3 entra completo
      expect(
        ids(await listar({ desde: '2026-10-02', hasta: '2026-10-03' })),
      ).toEqual([transferencia.id, merma.id]);
      expect(ids(await listar({ buscar: 'envase roto' }))).toEqual([merma.id]);
    });

    it('RNF-03 · los ve el personal con permiso de consulta; el cliente recibe 403 y un período al revés, 400', async () => {
      const vendedor = await tokenDe(ROLES.VENDEDOR);
      const cliente = await tokenDe(ROLES.CLIENTE);
      await listar({}, vendedor);
      await request(app.getHttpServer())
        .get('/api/inventario/movimientos')
        .auth(cliente, { type: 'bearer' })
        .expect(403);
      const respuesta = await request(app.getHttpServer())
        .get('/api/inventario/movimientos')
        .query({ desde: '2026-10-05', hasta: '2026-10-01' })
        .auth(token, { type: 'bearer' })
        .expect(400);
      expect(respuesta.body).toMatchObject({
        errores: [{ campo: 'hasta' }],
      });
      await request(app.getHttpServer())
        .get('/api/inventario/movimientos')
        .query({ grupo: 'otro' })
        .auth(token, { type: 'bearer' })
        .expect(400);
    });
  });
});
