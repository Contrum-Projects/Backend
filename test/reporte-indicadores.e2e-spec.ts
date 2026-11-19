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
  ESTADOS_ENVIO,
  ESTADOS_PEDIDO,
  ORIGENES_DESCRIPCION,
  TIPOS_ARTICULO,
  TIPOS_DOCUMENTO,
  TIPOS_ENTREGA,
  TIPOS_MOVIMIENTO,
} from '../src/common/dominio/valores.js';
import { configurarApp } from '../src/configurar-app.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { REDIS } from '../src/redis/redis.module.js';

// Requiere PostgreSQL y Redis levantados: `docker compose up -d db redis`.

const CONTRASENA = 'Secreta123';
const RUTA = '/api/reportes/indicadores';
// Todo lo que crean estas pruebas lleva este prefijo, para borrarlo al terminar
const PREFIJO = 'E2E-reporte-indicadores';
const PREFIJO_CORREO = 'e2e-reporte-indicadores-';
// Talcahuano (local) y Santiago (fuera de la zona local), por código CUT
const TALCAHUANO = '08110';
const SANTIAGO = '13101';

interface Indicador {
  codigo: string;
  meta: number;
  porcentaje: number | null;
  cumplidos: number;
  total: number;
  sinDatos: boolean;
}

interface Reporte {
  desde: string;
  hasta: string;
  indicadores: Indicador[];
}

/**
 * Los datos de estas pruebas van en junio de 2021 (y su período anterior, del 2 al 31 de mayo),
 * meses ya pasados en que no hay otros registros en la base: así los conteos son exactos. En
 * mayo y junio Chile está en UTC-4.
 */
const DESDE = '2021-06-01';
const HASTA = '2021-06-30';

describe('Reportes · indicadores de los objetivos (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: Redis;
  let hashContrasena: string;
  let tokenAdministrador: string;
  let categoriaId: number;

  const servidor = () => request(app.getHttpServer());

  const nuevaCuenta = async (rol: Rol) => {
    const email = `${PREFIJO_CORREO}${randomUUID()}@prueba.cl`;
    const usuario = await prisma.usuario.create({
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
    return { id: usuario.id, email };
  };

  const tokenDe = async (rol: Rol) => {
    const { email } = await nuevaCuenta(rol);
    const respuesta = await servidor()
      .post('/api/cuentas/sesion')
      .send({ email, contrasena: CONTRASENA })
      .expect(200);
    return (respuesta.body as { tokenAcceso: string }).tokenAcceso;
  };

  const nuevoPedido = async (
    fecha: string,
    datos: { estado?: string; montoTotal?: number; comunaCut?: string } = {},
  ) => {
    const { id: usuarioId } = await nuevaCuenta(ROLES.CLIENTE);
    const montoTotal = datos.montoTotal ?? 11900;
    const montoNeto = Math.round(montoTotal / 1.19);
    const pedido = await prisma.pedido.create({
      data: {
        codigoPublico: randomUUID().replace(/-/g, '').slice(0, 12),
        usuarioId,
        fechaPedido: new Date(fecha),
        fechaExpiracionPago: new Date(new Date(fecha).getTime() + 15 * 60_000),
        estadoActual: datos.estado ?? ESTADOS_PEDIDO.PAGADO,
        tipoEntrega: datos.comunaCut
          ? TIPOS_ENTREGA.DESPACHO
          : TIPOS_ENTREGA.RETIRO,
        tipoDocumentoSolicitado: TIPOS_DOCUMENTO.BOLETA,
        porcentajeIva: 19,
        montoNeto,
        montoIva: montoTotal - montoNeto,
        montoTotal,
      },
    });
    if (datos.comunaCut) {
      const comuna = await prisma.comuna.findUniqueOrThrow({
        where: { codigoCut: datos.comunaCut },
      });
      await prisma.envio.create({
        data: {
          pedidoId: pedido.id,
          comunaId: comuna.id,
          servicioEnvio: 'Prueba',
          costoNeto: 0,
          estadoEnvio: ESTADOS_ENVIO.PENDIENTE,
          destinatario: 'Camila Rojas',
          calle: 'Calle de prueba',
          numero: '100',
        },
      });
    }
    return pedido;
  };

  const nuevoFormato = async () => {
    const producto = await prisma.producto.create({
      data: {
        categoriaId,
        nombre: `${PREFIJO} ${randomUUID().slice(0, 8)}`,
        descripcion: 'Descripción de prueba',
        origenDescripcion: ORIGENES_DESCRIPCION.MANUAL,
        canalVenta: CANALES_VENTA.GENERAL,
      },
    });
    const articulo = await prisma.articuloVenta.create({
      data: {
        sku: `${PREFIJO}-${randomUUID().slice(0, 8)}`,
        tipo: TIPOS_ARTICULO.FORMATO,
      },
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
      },
    });
    return articulo.id;
  };

  /** Movimientos de un formato, en orden: `[tipo, cantidad, fecha]`. */
  const movimientos = async (
    formatoId: number,
    lista: [string, number, string][],
  ) => {
    for (const [tipo, cantidad, fecha] of lista) {
      await prisma.movimientoInventario.create({
        data: { formatoId, tipo, cantidad, fechaHora: new Date(fecha) },
      });
    }
  };

  const consultar = (
    desde = DESDE,
    hasta = HASTA,
    token = tokenAdministrador,
  ) =>
    servidor()
      .get(RUTA)
      .query({ desde, hasta })
      .auth(token, { type: 'bearer' });

  const indicador = (reporte: Reporte, codigo: string) =>
    reporte.indicadores.find((i) => i.codigo === codigo)!;

  const limpiarDatos = async () => {
    const usuario = { email: { startsWith: PREFIJO_CORREO } };
    await prisma.envio.deleteMany({ where: { pedido: { usuario } } });
    await prisma.pedido.deleteMany({ where: { usuario } });
    const producto = { nombre: { startsWith: PREFIJO } };
    await prisma.movimientoInventario.deleteMany({
      where: { formato: { producto } },
    });
    await prisma.formatoProducto.deleteMany({ where: { producto } });
    await prisma.articuloVenta.deleteMany({
      where: { sku: { startsWith: PREFIJO } },
    });
    await prisma.producto.deleteMany({ where: producto });
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
    await limpiarDatos();
    tokenAdministrador = await tokenDe(ROLES.ADMINISTRADOR);
    categoriaId = (await prisma.categoria.create({ data: { nombre: PREFIJO } }))
      .id;
    // Las dos comunas que usan los despachos (ya existen si la base tiene la semilla)
    for (const [region, codigoCut, nombre] of [
      ['08', TALCAHUANO, 'Talcahuano'],
      ['13', SANTIAGO, 'Santiago'],
    ]) {
      const { id: regionId } = await prisma.region.upsert({
        where: { codigoCut: region },
        update: {},
        create: { codigoCut: region, nombre: `Región ${region}` },
      });
      await prisma.comuna.upsert({
        where: { codigoCut },
        update: {},
        create: { codigoCut, nombre, regionId },
      });
    }
  });

  // Todas las peticiones salen de la misma IP: cada prueba parte sin contadores ni datos
  beforeEach(async () => {
    const claves = await redis.keys('limite:*');
    if (claves.length) await redis.del(...claves);
    await limpiarDatos();
  });

  afterAll(async () => {
    await limpiarDatos();
    await prisma.categoria.deleteMany({ where: { nombre: PREFIJO } });
    await prisma.sesion.deleteMany({
      where: { usuario: { email: { startsWith: PREFIJO_CORREO } } },
    });
    await prisma.usuario.deleteMany({
      where: { email: { startsWith: PREFIJO_CORREO } },
    });
    await app.close();
  });

  it('E14-H1 · CA1 indicadores con datos: devuelve cada indicador como porcentaje junto a su meta', async () => {
    // OE1: $100.000 en mayo y $150.000 en junio, +50 %
    await nuevoPedido('2021-05-10T12:00:00Z', { montoTotal: 100_000 });
    await nuevoPedido('2021-06-10T12:00:00Z', {
      montoTotal: 100_000,
      comunaCut: SANTIAGO,
    });
    await nuevoPedido('2021-06-11T12:00:00Z', {
      montoTotal: 50_000,
      comunaCut: TALCAHUANO,
    });
    // OE2: un quiebre en mayo y ninguno en junio, -100 %
    const formato = await nuevoFormato();
    await movimientos(formato, [
      [TIPOS_MOVIMIENTO.ENTRADA, 5, '2021-05-03T12:00:00Z'],
      [TIPOS_MOVIMIENTO.VENTA, 5, '2021-05-20T12:00:00Z'],
      [TIPOS_MOVIMIENTO.ENTRADA, 5, '2021-06-02T12:00:00Z'],
      [TIPOS_MOVIMIENTO.VENTA, 2, '2021-06-15T12:00:00Z'],
    ]);

    const respuesta = await consultar().expect(200);

    const reporte = respuesta.body as Reporte;
    expect(reporte.desde).toBe(DESDE);
    expect(reporte.hasta).toBe(HASTA);
    expect(indicador(reporte, 'OE1')).toMatchObject({
      meta: 20,
      cumplidos: 150_000,
      total: 100_000,
      porcentaje: 50,
      sinDatos: false,
    });
    expect(indicador(reporte, 'OE2')).toMatchObject({
      meta: 80,
      cumplidos: 0,
      total: 1,
      porcentaje: 100,
    });
    // OE3: el pedido de mayo no es del período; 1 de 2 se despacha fuera
    expect(indicador(reporte, 'OE3')).toMatchObject({
      meta: 30,
      cumplidos: 1,
      total: 2,
      porcentaje: 50,
    });
  });

  it('E14-H1 · OE1: solo cuentan los pedidos pagados, y el período anterior tiene los mismos días', async () => {
    // El 1 de mayo queda fuera del período anterior (2 al 31 de mayo)
    await nuevoPedido('2021-05-01T12:00:00Z', { montoTotal: 999_000 });
    await nuevoPedido('2021-05-02T12:00:00Z', { montoTotal: 100_000 });
    await nuevoPedido('2021-06-05T12:00:00Z', { montoTotal: 90_000 });
    await nuevoPedido('2021-06-06T12:00:00Z', {
      montoTotal: 500_000,
      estado: ESTADOS_PEDIDO.PENDIENTE_PAGO,
    });
    await nuevoPedido('2021-06-07T12:00:00Z', {
      montoTotal: 500_000,
      estado: ESTADOS_PEDIDO.CANCELADO,
    });

    const reporte = (await consultar().expect(200)).body as Reporte;

    expect(indicador(reporte, 'OE1')).toMatchObject({
      cumplidos: 90_000,
      total: 100_000,
      porcentaje: -10,
      estado: 'bajo-la-meta',
    });
  });

  it('E14-H1 · OE2: un quiebre es cuando el stock total del formato pasa de tener a 0; la transferencia no cambia el total', async () => {
    const formato = await nuevoFormato();
    await movimientos(formato, [
      // Mayo: llega a 0 una vez
      [TIPOS_MOVIMIENTO.ENTRADA, 3, '2021-05-05T12:00:00Z'],
      [TIPOS_MOVIMIENTO.TRANSFERENCIA, 3, '2021-05-06T12:00:00Z'],
      [TIPOS_MOVIMIENTO.MERMA_DANO, 3, '2021-05-07T12:00:00Z'],
      // Junio: dos veces (por un ajuste y por una venta), con un reingreso entre medio
      [TIPOS_MOVIMIENTO.AJUSTE_POSITIVO, 2, '2021-06-03T12:00:00Z'],
      [TIPOS_MOVIMIENTO.AJUSTE_NEGATIVO, 2, '2021-06-04T12:00:00Z'],
      [TIPOS_MOVIMIENTO.REINGRESO, 1, '2021-06-05T12:00:00Z'],
      [TIPOS_MOVIMIENTO.VENTA, 1, '2021-06-06T12:00:00Z'],
    ]);
    // Otro formato que baja sin llegar a 0 no suma quiebres
    const otro = await nuevoFormato();
    await movimientos(otro, [
      [TIPOS_MOVIMIENTO.ENTRADA, 10, '2021-05-05T12:00:00Z'],
      [TIPOS_MOVIMIENTO.VENTA, 9, '2021-06-05T12:00:00Z'],
    ]);

    const reporte = (await consultar().expect(200)).body as Reporte;

    expect(indicador(reporte, 'OE2')).toMatchObject({
      cumplidos: 2,
      total: 1,
      porcentaje: -100,
      estado: 'bajo-la-meta',
    });
  });

  it('E14-H1 · OE3: el retiro en tienda cuenta como local, y un pedido sin pagar no cuenta', async () => {
    await nuevoPedido('2021-06-05T12:00:00Z');
    await nuevoPedido('2021-06-06T12:00:00Z', { comunaCut: TALCAHUANO });
    await nuevoPedido('2021-06-07T12:00:00Z', { comunaCut: SANTIAGO });
    await nuevoPedido('2021-06-08T12:00:00Z', {
      comunaCut: SANTIAGO,
      estado: ESTADOS_PEDIDO.PENDIENTE_PAGO,
    });

    const reporte = (await consultar().expect(200)).body as Reporte;

    expect(indicador(reporte, 'OE3')).toMatchObject({
      cumplidos: 1,
      total: 3,
      porcentaje: 33.3,
      estado: 'sobre-la-meta',
    });
  });

  it('E14-H1 · los días se cortan a medianoche de Chile, con ambos extremos incluidos', async () => {
    // 1 de junio 00:30 en Chile (04:30 UTC) entra; 30 de junio 23:30 en Chile (1 jul 03:30 UTC) entra
    await nuevoPedido('2021-06-01T04:30:00Z');
    await nuevoPedido('2021-07-01T03:30:00Z');
    // 31 de mayo 23:30 en Chile y 1 de julio 00:30 en Chile quedan fuera
    await nuevoPedido('2021-06-01T03:30:00Z');
    await nuevoPedido('2021-07-01T04:30:00Z');

    const reporte = (await consultar().expect(200)).body as Reporte;

    expect(indicador(reporte, 'OE3').total).toBe(2);
  });

  it('E14-H1 · CA2 período sin datos: cada indicador indica que no hay datos para calcularlo', async () => {
    const reporte = (await consultar().expect(200)).body as Reporte;

    expect(reporte.indicadores).toEqual([
      expect.objectContaining({
        codigo: 'OE1',
        meta: 20,
        porcentaje: null,
        sinDatos: true,
      }),
      expect.objectContaining({
        codigo: 'OE2',
        meta: 80,
        porcentaje: null,
        sinDatos: true,
      }),
      expect.objectContaining({
        codigo: 'OE3',
        meta: 30,
        porcentaje: null,
        sinDatos: true,
      }),
    ]);
  });

  it('E14-H1 · CA2 OE1: con ventas en el período pero no en el anterior, no hay con qué comparar', async () => {
    await nuevoPedido('2021-06-10T12:00:00Z');

    const reporte = (await consultar().expect(200)).body as Reporte;

    expect(indicador(reporte, 'OE1')).toMatchObject({
      cumplidos: 11900,
      total: 0,
      porcentaje: null,
      sinDatos: true,
    });
  });

  it('E14-H1 · período: fechas faltantes o inválidas, rango invertido o de más de 366 días responden 400', async () => {
    await servidor()
      .get(RUTA)
      .auth(tokenAdministrador, { type: 'bearer' })
      .expect(400);
    await consultar('2021-02-30', '2021-03-31').expect(400);
    await consultar('2021-06-30', '2021-06-01').expect(400);
    await consultar('2020-01-01', '2021-01-02').expect(400);
    await consultar('0000-01-01', '0000-01-02').expect(400);
  });

  it('E14-H1 · CA3 acceso restringido: sin sesión responde 401', async () => {
    await servidor()
      .get(RUTA)
      .query({ desde: DESDE, hasta: HASTA })
      .expect(401);
  });

  it('E14-H1 · CA3 acceso restringido: bodeguero, vendedor, cliente y profesional reciben 403', async () => {
    for (const rol of [
      ROLES.BODEGUERO,
      ROLES.VENDEDOR,
      ROLES.CLIENTE,
      ROLES.PROFESIONAL,
    ]) {
      await consultar(DESDE, HASTA, await tokenDe(rol)).expect(403);
    }
  });
});
