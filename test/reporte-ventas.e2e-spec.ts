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
  ESTADOS_PEDIDO,
  TIPOS_ARTICULO,
  TIPOS_DOCUMENTO,
  TIPOS_ENTREGA,
  TIPOS_PRECIO,
} from '../src/common/dominio/valores.js';
import { configurarApp } from '../src/configurar-app.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { REDIS } from '../src/redis/redis.module.js';

// Requiere PostgreSQL y Redis levantados: `docker compose up -d db redis`.

const CONTRASENA = 'Secreta123';
const RUTA = '/api/reportes/ventas';
const RUTA_EXPORTAR = '/api/reportes/ventas/exportar';
// Todo lo que crean estas pruebas lleva este prefijo, para borrarlo al terminar
const PREFIJO = 'E2E-reporte-ventas';
const PREFIJO_CORREO = 'e2e-reporte-ventas-';

interface Totales {
  pedidos: number;
  montoNeto: number;
  montoIva: number;
  montoTotal: number;
}

interface Reporte {
  desde: string;
  hasta: string;
  minorista: Totales;
  mayorista: Totales;
  total: Totales;
}

const CERO: Totales = { pedidos: 0, montoNeto: 0, montoIva: 0, montoTotal: 0 };

/**
 * Los pedidos de estas pruebas van en marzo de 2031, un mes en que no hay otros pedidos en la
 * base: así los totales son exactos. En marzo Chile está en UTC-3.
 */
describe('Reportes · ventas por período y tipo de cliente (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: Redis;
  let hashContrasena: string;
  let tokenAdministrador: string;
  let articuloId: number;
  let clienteId: number;
  let profesionalId: number;

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

  /** Pedido con montos fijos (neto + IVA = total) y una línea con ese tipo de precio. */
  const nuevoPedido = async (datos: {
    usuarioId: number;
    fecha: string;
    tipoPrecio: string;
    estado?: string;
    neto: number;
  }) => {
    const iva = Math.round(datos.neto * 0.19);
    await prisma.pedido.create({
      data: {
        codigoPublico: randomUUID().replace(/-/g, '').slice(0, 12),
        usuarioId: datos.usuarioId,
        fechaPedido: new Date(datos.fecha),
        fechaExpiracionPago: new Date(
          new Date(datos.fecha).getTime() + 15 * 60_000,
        ),
        estadoActual: datos.estado ?? ESTADOS_PEDIDO.PAGADO,
        tipoEntrega: TIPOS_ENTREGA.RETIRO,
        tipoDocumentoSolicitado: TIPOS_DOCUMENTO.BOLETA,
        porcentajeIva: 19,
        montoNeto: datos.neto,
        montoIva: iva,
        montoTotal: datos.neto + iva,
        detalles: {
          create: [
            {
              articuloId,
              cantidad: 1,
              precioUnitarioNetoAplicado: datos.neto,
              tipoPrecio: datos.tipoPrecio,
            },
          ],
        },
      },
    });
  };

  const consultar = (
    desde: string,
    hasta: string,
    token = tokenAdministrador,
  ) =>
    servidor()
      .get(RUTA)
      .query({ desde, hasta })
      .auth(token, { type: 'bearer' });

  /** E14-H5 · Descarga el CSV como texto (con su BOM) y lo separa en líneas, sin la última vacía. */
  const exportar = (desde: string, hasta: string, token = tokenAdministrador) =>
    servidor()
      .get(RUTA_EXPORTAR)
      .query({ desde, hasta })
      .auth(token, { type: 'bearer' })
      .buffer(true)
      .parse((res, listo) => {
        const partes: Buffer[] = [];
        res.on('data', (parte: Buffer) => partes.push(parte));
        res.on('end', () =>
          listo(null, Buffer.concat(partes).toString('utf-8')),
        );
      });

  const lineas = (csv: unknown) => (csv as string).split('\r\n').slice(0, -1);

  const limpiar = async () => {
    // Las líneas se borran en cascada con el pedido
    await prisma.pedido.deleteMany({
      where: { usuario: { email: { startsWith: PREFIJO_CORREO } } },
    });
    await prisma.articuloVenta.deleteMany({
      where: { sku: { startsWith: PREFIJO } },
    });
    await prisma.usuario.deleteMany({
      where: { email: { startsWith: PREFIJO_CORREO } },
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

    tokenAdministrador = await tokenDe(ROLES.ADMINISTRADOR);
    clienteId = (await nuevaCuenta(ROLES.CLIENTE)).id;
    profesionalId = (await nuevaCuenta(ROLES.PROFESIONAL)).id;
    articuloId = (
      await prisma.articuloVenta.create({
        data: {
          sku: `${PREFIJO}-${randomUUID().slice(0, 8)}`,
          tipo: TIPOS_ARTICULO.FORMATO,
          precioMinoristaNeto: 10000,
          precioMayoristaNeto: 8000,
        },
      })
    ).id;
  });

  // Todas las peticiones salen de la misma IP: cada prueba parte sin contadores
  beforeEach(async () => {
    const claves = await redis.keys('limite:*');
    if (claves.length) await redis.del(...claves);
    await prisma.pedido.deleteMany({
      where: { usuario: { email: { startsWith: PREFIJO_CORREO } } },
    });
  });

  afterAll(async () => {
    await limpiar();
    await app.close();
  });

  it('E14-H2 · ventas del período: devuelve la cantidad de pedidos y sus montos separados por tipo de cliente', async () => {
    await nuevoPedido({
      usuarioId: clienteId,
      fecha: '2031-03-05T15:00:00Z',
      tipoPrecio: TIPOS_PRECIO.MINORISTA,
      neto: 10000,
    });
    await nuevoPedido({
      usuarioId: clienteId,
      fecha: '2031-03-20T15:00:00Z',
      tipoPrecio: TIPOS_PRECIO.MINORISTA,
      estado: ESTADOS_PEDIDO.ENTREGADO,
      neto: 20000,
    });
    await nuevoPedido({
      usuarioId: profesionalId,
      fecha: '2031-03-10T15:00:00Z',
      tipoPrecio: TIPOS_PRECIO.MAYORISTA,
      estado: ESTADOS_PEDIDO.RETIRADO,
      neto: 8000,
    });

    const respuesta = await consultar('2031-03-01', '2031-03-31').expect(200);

    expect(respuesta.body as Reporte).toEqual({
      desde: '2031-03-01',
      hasta: '2031-03-31',
      minorista: {
        pedidos: 2,
        montoNeto: 30000,
        montoIva: 5700,
        montoTotal: 35700,
      },
      mayorista: {
        pedidos: 1,
        montoNeto: 8000,
        montoIva: 1520,
        montoTotal: 9520,
      },
      total: {
        pedidos: 3,
        montoNeto: 38000,
        montoIva: 7220,
        montoTotal: 45220,
      },
    });
  });

  it('E14-H2 · ventas del período: los pendientes de pago y los cancelados no cuentan', async () => {
    for (const estado of [
      ESTADOS_PEDIDO.PENDIENTE_PAGO,
      ESTADOS_PEDIDO.CANCELADO,
    ]) {
      await nuevoPedido({
        usuarioId: clienteId,
        fecha: '2031-03-05T15:00:00Z',
        tipoPrecio: TIPOS_PRECIO.MINORISTA,
        estado,
        neto: 10000,
      });
    }

    const respuesta = await consultar('2031-03-01', '2031-03-31').expect(200);

    expect((respuesta.body as Reporte).total).toEqual(CERO);
  });

  it('E14-H2 · ventas del período: el tipo es el precio aplicado al comprar, aunque la cuenta cambie de rol', async () => {
    const { id } = await nuevaCuenta(ROLES.CLIENTE);
    await nuevoPedido({
      usuarioId: id,
      fecha: '2031-03-05T15:00:00Z',
      tipoPrecio: TIPOS_PRECIO.MINORISTA,
      neto: 10000,
    });
    // Después se verificó como profesional (E10-H4)
    await prisma.usuario.update({
      where: { id },
      data: { rol: ROLES.PROFESIONAL },
    });

    const reporte = (await consultar('2031-03-01', '2031-03-31').expect(200))
      .body as Reporte;

    expect(reporte.minorista.pedidos).toBe(1);
    expect(reporte.mayorista).toEqual(CERO);
  });

  it('E14-H2 · ventas del período: los días se cortan a medianoche de Chile, con ambos extremos incluidos', async () => {
    // 23:30 del 9 de marzo en Chile (UTC-3): en UTC ya es el día 10, pero es del día 9
    await nuevoPedido({
      usuarioId: clienteId,
      fecha: '2031-03-10T02:30:00Z',
      tipoPrecio: TIPOS_PRECIO.MINORISTA,
      neto: 10000,
    });
    // 23:30 del 10 de marzo en Chile: en UTC ya es el día 11, pero es del día 10
    await nuevoPedido({
      usuarioId: clienteId,
      fecha: '2031-03-11T02:30:00Z',
      tipoPrecio: TIPOS_PRECIO.MINORISTA,
      neto: 20000,
    });

    const delDia = (await consultar('2031-03-10', '2031-03-10').expect(200))
      .body as Reporte;
    const anterior = (await consultar('2031-03-09', '2031-03-09').expect(200))
      .body as Reporte;
    const siguiente = (await consultar('2031-03-11', '2031-03-11').expect(200))
      .body as Reporte;

    expect(anterior.minorista).toMatchObject({ pedidos: 1, montoNeto: 10000 });
    expect(delDia.minorista).toMatchObject({ pedidos: 1, montoNeto: 20000 });
    expect(siguiente.total).toEqual(CERO);
    // Los dos días juntos: ambos extremos incluidos
    const ambos = (await consultar('2031-03-09', '2031-03-10').expect(200))
      .body as Reporte;
    expect(ambos.minorista).toMatchObject({ pedidos: 2, montoNeto: 30000 });
  });

  it('E14-H2 · período sin ventas: devuelve los totales en cero', async () => {
    await nuevoPedido({
      usuarioId: clienteId,
      fecha: '2031-03-05T15:00:00Z',
      tipoPrecio: TIPOS_PRECIO.MINORISTA,
      neto: 10000,
    });

    const respuesta = await consultar('2031-04-01', '2031-04-30').expect(200);

    expect(respuesta.body as Reporte).toEqual({
      desde: '2031-04-01',
      hasta: '2031-04-30',
      minorista: CERO,
      mayorista: CERO,
      total: CERO,
    });
  });

  it('E14-H2 · período: fechas faltantes o inválidas, rango invertido o de más de 366 días responden 400', async () => {
    await servidor()
      .get(RUTA)
      .auth(tokenAdministrador, { type: 'bearer' })
      .expect(400);
    await consultar('2031-02-30', '2031-03-31').expect(400);
    await consultar('31-03-2031', '2031-03-31').expect(400);
    await consultar('2031-03-31', '2031-03-01').expect(400);
    await consultar('2030-01-01', '2031-01-02').expect(400);
  });

  it('RNF-03 · reporte de ventas: sin sesión responde 401', async () => {
    await servidor()
      .get(RUTA)
      .query({ desde: '2031-03-01', hasta: '2031-03-31' })
      .expect(401);
  });

  it('RNF-03 · reporte de ventas: bodeguero, vendedor, cliente y profesional reciben 403', async () => {
    for (const rol of [
      ROLES.BODEGUERO,
      ROLES.VENDEDOR,
      ROLES.CLIENTE,
      ROLES.PROFESIONAL,
    ]) {
      await consultar('2031-03-01', '2031-03-31', await tokenDe(rol)).expect(
        403,
      );
    }
  });

  describe('exportación pedido a pedido (E14-H5, SCRUM-159)', () => {
    it('E14-H5 · descarga del período: CSV con una fila por pedido pagado, en hora de Chile', async () => {
      // 23:30 del 4 de marzo en Chile (UTC-3)
      await nuevoPedido({
        usuarioId: clienteId,
        fecha: '2031-03-05T02:30:00Z',
        tipoPrecio: TIPOS_PRECIO.MINORISTA,
        neto: 10000,
      });
      await nuevoPedido({
        usuarioId: profesionalId,
        fecha: '2031-03-10T15:00:00Z',
        tipoPrecio: TIPOS_PRECIO.MAYORISTA,
        estado: ESTADOS_PEDIDO.RETIRADO,
        neto: 8000,
      });

      const respuesta = await exportar('2031-03-01', '2031-03-31').expect(200);

      expect(respuesta.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(respuesta.headers['content-disposition']).toBe(
        'attachment; filename="ventas-2031-03-01-2031-03-31.csv"',
      );
      expect(respuesta.headers['cache-control']).toBe('private, no-store');
      const [encabezados, ...filas] = lineas(respuesta.body);
      expect(encabezados).toBe(
        '﻿Código pedido;Fecha;Estado;Tipo de cliente;Tipo de entrega;Documento;Descuento;Neto;IVA;Total',
      );
      expect(filas).toHaveLength(2);
      expect(filas[0]).toMatch(
        /^[0-9a-f]{12};2031-03-04 23:30;pagado;minorista;retiro;boleta;0;10000;1900;11900$/,
      );
      expect(filas[1]).toMatch(
        /^[0-9a-f]{12};2031-03-10 12:00;retirado;mayorista;retiro;boleta;0;8000;1520;9520$/,
      );
    });

    it('E14-H5 · coherente con el reporte: mismas filas y montos que el reporte de ventas', async () => {
      for (const estado of Object.values(ESTADOS_PEDIDO)) {
        await nuevoPedido({
          usuarioId: clienteId,
          fecha: '2031-03-05T15:00:00Z',
          tipoPrecio: TIPOS_PRECIO.MINORISTA,
          estado,
          neto: 10000,
        });
      }

      const reporte = (await consultar('2031-03-01', '2031-03-31').expect(200))
        .body as Reporte;
      const filas = lineas(
        (await exportar('2031-03-01', '2031-03-31').expect(200)).body,
      ).slice(1);

      expect(filas).toHaveLength(reporte.total.pedidos);
      const sumaTotal = filas.reduce(
        (suma, fila) => suma + Number(fila.split(';')[9]),
        0,
      );
      expect(sumaTotal).toBe(reporte.total.montoTotal);
    });

    it('E14-H5 · período sin ventas: el CSV trae solo los encabezados', async () => {
      const respuesta = await exportar('2031-04-01', '2031-04-30').expect(200);

      expect(lineas(respuesta.body)).toHaveLength(1);
    });

    it('E14-H5 · período inválido: rango invertido o de más de 366 días responde 400', async () => {
      await exportar('2031-03-31', '2031-03-01').expect(400);
      await exportar('2030-01-01', '2031-01-02').expect(400);
      await exportar('2031-02-30', '2031-03-31').expect(400);
    });

    it('RNF-03 · exportación de ventas: sin sesión 401; bodeguero, vendedor, cliente y profesional 403', async () => {
      await servidor()
        .get(RUTA_EXPORTAR)
        .query({ desde: '2031-03-01', hasta: '2031-03-31' })
        .expect(401);
      for (const rol of [
        ROLES.BODEGUERO,
        ROLES.VENDEDOR,
        ROLES.CLIENTE,
        ROLES.PROFESIONAL,
      ]) {
        await exportar('2031-03-01', '2031-03-31', await tokenDe(rol)).expect(
          403,
        );
      }
    });
  });
});
