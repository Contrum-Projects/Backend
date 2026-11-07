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
  ESTADOS_DOCUMENTO,
  ESTADOS_PEDIDO,
  TIPOS_DOCUMENTO,
  TIPOS_ENTREGA,
} from '../src/common/dominio/valores.js';
import { configurarApp } from '../src/configurar-app.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { REDIS } from '../src/redis/redis.module.js';

// Requiere PostgreSQL y Redis levantados: `docker compose up -d db redis`.

const CONTRASENA = 'Secreta123';
const PREFIJO_CORREO = 'e2e-gestion-panel-';
// Región y comuna de prueba (códigos que no usa el CUT ni otra prueba); se borran al terminar
const REGION = '88';
const COMUNA = '88001';

interface PedidoListado {
  codigoPublico: string;
  cliente: string;
  estado: string;
  total: number;
  unidades: number;
}
interface ListadoPedidos {
  items: PedidoListado[];
  total: number;
  grupos: { clave: string; nombre: string; cantidad: number | null }[];
  grupo: string;
}
interface FacturaListada {
  codigoPedido: string;
  razonSocial: string;
  rut: string;
  estado: string;
  folio: number | null;
}

describe('Panel · pedidos y facturas (e2e, SCRUM-150)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: Redis;
  let hashContrasena: string;
  let compradorId: number;
  let comunaId: number;
  let datosId: number;
  let apellido: string;
  const correoComprador = `${PREFIJO_CORREO}comprador-${randomUUID()}@prueba.cl`;
  const correosCreados: string[] = [correoComprador];

  const servidor = () => request(app.getHttpServer());

  const tokenDe = async (rol: Rol) => {
    const email = `${PREFIJO_CORREO}${randomUUID()}@prueba.cl`;
    correosCreados.push(email);
    await prisma.usuario.create({
      data: {
        codigoPublico: randomUUID(),
        nombre: 'Marcela',
        apellido: 'Soto',
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

  /** Un pedido del comprador, con su historial y una línea sin artículo de venta. */
  const nuevoPedido = async ({
    estado = ESTADOS_PEDIDO.PAGADO as string,
    tipoDocumento = TIPOS_DOCUMENTO.BOLETA as string,
    tipoEntrega = TIPOS_ENTREGA.RETIRO as string,
    hace = 1,
  } = {}) => {
    const codigoPublico = randomUUID()
      .replaceAll('-', '')
      .slice(0, 12)
      .toUpperCase();
    const fecha = new Date(Date.now() - hace * 60_000);
    await prisma.pedido.create({
      data: {
        codigoPublico,
        usuarioId: compradorId,
        datosFacturacionId:
          tipoDocumento === TIPOS_DOCUMENTO.FACTURA ? datosId : null,
        fechaPedido: fecha,
        fechaExpiracionPago: new Date(fecha.getTime() + 15 * 60_000),
        estadoActual: estado,
        tipoEntrega,
        tipoDocumentoSolicitado: tipoDocumento,
        porcentajeIva: 19,
        montoNeto: 10000,
        montoIva: 1900,
        montoTotal: 11900,
        historial: {
          create: [{ correlativo: 1, estado, fechaHora: fecha }],
        },
      },
    });
    return codigoPublico;
  };

  const limpiar = async () => {
    // Los documentos no se borran en cascada con el pedido
    await prisma.documentoTributario.deleteMany({
      where: { pedido: { usuario: { email: { startsWith: PREFIJO_CORREO } } } },
    });
    await prisma.pedido.deleteMany({
      where: { usuario: { email: { startsWith: PREFIJO_CORREO } } },
    });
    await prisma.datosFacturacion.deleteMany({
      where: { usuario: { email: { startsWith: PREFIJO_CORREO } } },
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
      create: { codigoCut: REGION, nombre: 'Región de prueba gestión' },
    });
    comunaId = (
      await prisma.comuna.upsert({
        where: { codigoCut: COMUNA },
        update: {},
        create: {
          codigoCut: COMUNA,
          nombre: 'Comuna de prueba gestión',
          regionId: region.id,
        },
      })
    ).id;
    apellido = `Zq${randomUUID().slice(0, 8)}`;
    compradorId = (
      await prisma.usuario.create({
        data: {
          codigoPublico: randomUUID(),
          nombre: 'Camila',
          apellido,
          email: correoComprador,
          telefono: '+56911112222',
          contrasenaHash: 'sin-uso',
          rol: ROLES.CLIENTE,
          fechaVerificacionCorreo: new Date(),
        },
      })
    ).id;
  });

  beforeEach(async () => {
    const claves = await redis.keys('limite:*');
    if (claves.length) await redis.del(...claves);
    await limpiar();
    datosId = (
      await prisma.datosFacturacion.create({
        data: {
          usuarioId: compradorId,
          comunaId,
          rut: '76123456-0',
          razonSocial: `Peluquería ${apellido} Ltda.`,
          giro: 'Servicios de peluquería',
          direccion: 'Calle Falsa 123',
        },
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

  describe('GET /gestion/pedidos', () => {
    const listar = async (token: string, query: object = {}) =>
      (
        await servidor()
          .get('/api/gestion/pedidos')
          .query({ q: apellido, ...query })
          .auth(token, { type: 'bearer' })
          .expect(200)
      ).body as ListadoPedidos;

    it('E8-H2 · por defecto «por preparar» (pagados y en preparación), del más reciente al más antiguo, con los conteos de los grupos que lo muestran', async () => {
      const token = await tokenDe(ROLES.BODEGUERO);
      const pagado = await nuevoPedido({ hace: 3 });
      const preparando = await nuevoPedido({
        estado: ESTADOS_PEDIDO.EN_PREPARACION,
        hace: 2,
      });
      const listo = await nuevoPedido({
        estado: ESTADOS_PEDIDO.LISTO_PARA_RETIRO,
      });
      await nuevoPedido({ estado: ESTADOS_PEDIDO.ENTREGADO });

      const listado = await listar(token);

      expect(listado.grupo).toBe('por_preparar');
      expect(listado.items.map((p) => p.codigoPublico)).toEqual([
        preparando,
        pagado,
      ]);
      expect(listado.items[0]).toMatchObject({
        cliente: `Camila ${apellido}`,
        total: 11900,
        unidades: 0,
      });
      expect(listado.grupos).toEqual([
        { clave: 'por_preparar', nombre: 'Por preparar', cantidad: 2 },
        {
          clave: 'listos_para_retiro',
          nombre: 'Listos para retiro',
          cantidad: 1,
        },
        { clave: 'despachados', nombre: 'Despachados', cantidad: null },
        {
          clave: 'pendientes_pago',
          nombre: 'Pendientes de pago',
          cantidad: null,
        },
        { clave: 'todos', nombre: 'Todos', cantidad: null },
      ]);
      expect(
        (await listar(token, { grupo: 'listos_para_retiro' })).items.map(
          (p) => p.codigoPublico,
        ),
      ).toEqual([listo]);
      expect((await listar(token, { grupo: 'todos' })).total).toBe(4);
    });

    it('E8-H2 · busca por código y por razón social; con factura, el cliente es la razón social', async () => {
      const token = await tokenDe(ROLES.VENDEDOR);
      const conFactura = await nuevoPedido({
        tipoDocumento: TIPOS_DOCUMENTO.FACTURA,
      });

      const porCodigo = await listar(token, {
        q: conFactura.toLowerCase(),
        grupo: 'todos',
      });
      expect(porCodigo.items).toEqual([
        expect.objectContaining({
          codigoPublico: conFactura,
          cliente: `Peluquería ${apellido} Ltda.`,
        }),
      ]);
      expect((await listar(token, { q: `peluquería ${apellido}` })).total).toBe(
        1,
      );
      await servidor()
        .get('/api/gestion/pedidos')
        .query({ grupo: 'otro' })
        .auth(token, { type: 'bearer' })
        .expect(400);
    });

    it('E8-H2 · detalle: cliente, historial con quién lo hizo, cambios permitidos y si se puede cancelar', async () => {
      const token = await tokenDe(ROLES.BODEGUERO);
      const codigo = await nuevoPedido({
        estado: ESTADOS_PEDIDO.EN_PREPARACION,
        tipoEntrega: TIPOS_ENTREGA.RETIRO,
      });
      const pedido = await prisma.pedido.findUniqueOrThrow({
        where: { codigoPublico: codigo },
      });
      await prisma.historialEstadoPedido.create({
        data: {
          pedidoId: pedido.id,
          correlativo: 2,
          estado: ESTADOS_PEDIDO.EN_PREPARACION,
          usuarioId: compradorId,
          comentario: 'Prueba',
        },
      });

      const detalle = (
        await servidor()
          .get(`/api/gestion/pedidos/${codigo}`)
          .auth(token, { type: 'bearer' })
          .expect(200)
      ).body as Record<string, unknown>;

      expect(detalle).toMatchObject({
        codigoPublico: codigo,
        estado: ESTADOS_PEDIDO.EN_PREPARACION,
        cliente: {
          nombre: `Camila ${apellido}`,
          correo: correoComprador,
          telefono: '+56911112222',
        },
        historial: [
          { estado: ESTADOS_PEDIDO.EN_PREPARACION, realizadoPor: 'Sistema' },
          {
            estado: ESTADOS_PEDIDO.EN_PREPARACION,
            comentario: 'Prueba',
            realizadoPor: 'Cliente',
          },
        ],
        // Retiro: avanza a listo para retiro (avisa) o vuelve a pagado (no avisa)
        cambiosPermitidos: [
          {
            estado: ESTADOS_PEDIDO.LISTO_PARA_RETIRO,
            sentido: 'avance',
            pideCodigoSeguimiento: false,
            avisaAlCliente: true,
          },
          {
            estado: ESTADOS_PEDIDO.PAGADO,
            sentido: 'retroceso',
            pideCodigoSeguimiento: false,
            avisaAlCliente: false,
          },
        ],
        sePuedeCancelar: false,
      });

      const pendiente = await nuevoPedido({
        estado: ESTADOS_PEDIDO.PENDIENTE_PAGO,
      });
      expect(
        (
          await servidor()
            .get(`/api/gestion/pedidos/${pendiente}`)
            .auth(token, { type: 'bearer' })
            .expect(200)
        ).body,
      ).toMatchObject({ cambiosPermitidos: [], sePuedeCancelar: true });
      await servidor()
        .get('/api/gestion/pedidos/NOEXISTE0000')
        .auth(token, { type: 'bearer' })
        .expect(404);
    });

    it('RNF-03 · sin sesión 401; un cliente, 403', async () => {
      await servidor().get('/api/gestion/pedidos').expect(401);
      const cliente = await tokenDe(ROLES.CLIENTE);
      await servidor()
        .get('/api/gestion/pedidos')
        .auth(cliente, { type: 'bearer' })
        .expect(403);
    });
  });

  describe('GET /gestion/facturas', () => {
    /** Registra la factura del pedido como la deja E9-H3: vigente y con su PDF. */
    const emitir = async (codigo: string, folio: number, fecha: string) => {
      const { id } = await prisma.pedido.findUniqueOrThrow({
        where: { codigoPublico: codigo },
      });
      await prisma.documentoTributario.create({
        data: {
          pedidoId: id,
          tipo: TIPOS_DOCUMENTO.FACTURA,
          folio,
          fechaEmision: new Date(`${fecha}T00:00:00Z`),
          estado: ESTADOS_DOCUMENTO.EMITIDO,
          montoNeto: 10000,
          montoIva: 1900,
          montoTotal: 11900,
          ubicacionArchivo: `facturas/${codigo}.pdf`,
          rutReceptor: '76123456-0',
          razonSocialReceptor: 'Razón copiada S.A.',
          giroReceptor: 'Giro copiado',
          direccionReceptor: 'Dirección copiada 1',
          comunaReceptor: 'Comuna copiada',
        },
      });
    };
    const folioNuevo = () =>
      800_000_000 + Math.floor(Math.random() * 99_000_000);

    it('E9-H3 · lista: primero las por emitir (la más antigua arriba), después las emitidas (la más reciente arriba); no entran boletas ni pendientes', async () => {
      const token = await tokenDe(ROLES.VENDEDOR);
      const factura = { tipoDocumento: TIPOS_DOCUMENTO.FACTURA as string };
      const antigua = await nuevoPedido({ ...factura, hace: 30 });
      const nueva = await nuevoPedido({ ...factura, hace: 20 });
      const emitidaVieja = await nuevoPedido({ ...factura, hace: 40 });
      const emitidaNueva = await nuevoPedido({ ...factura, hace: 50 });
      await emitir(emitidaVieja, folioNuevo(), '2026-10-01');
      await emitir(emitidaNueva, folioNuevo(), '2026-10-20');
      await nuevoPedido();
      await nuevoPedido({ ...factura, estado: ESTADOS_PEDIDO.PENDIENTE_PAGO });
      await nuevoPedido({ ...factura, estado: ESTADOS_PEDIDO.CANCELADO });

      const respuesta = (
        await servidor()
          .get('/api/gestion/facturas')
          .query({ limite: 100 })
          .auth(token, { type: 'bearer' })
          .expect(200)
      ).body as { items: FacturaListada[]; porEmitir: number; total: number };
      const propias = respuesta.items.filter((item) =>
        [antigua, nueva, emitidaVieja, emitidaNueva].includes(
          item.codigoPedido,
        ),
      );

      expect(propias.map((item) => item.codigoPedido)).toEqual([
        antigua,
        nueva,
        emitidaNueva,
        emitidaVieja,
      ]);
      expect(propias[0]).toMatchObject({
        razonSocial: `Peluquería ${apellido} Ltda.`,
        rut: '76123456-0',
        estado: 'por_emitir',
        folio: null,
      });
      expect(propias[2]).toMatchObject({
        razonSocial: 'Razón copiada S.A.',
        estado: 'emitida',
      });
      expect(respuesta.porEmitir).toBeGreaterThanOrEqual(2);
    });

    it('E9-H3 · detalle: por emitir, el receptor de los datos de facturación; emitida, lo que copió la factura', async () => {
      const token = await tokenDe(ROLES.VENDEDOR);
      const porEmitir = await nuevoPedido({
        tipoDocumento: TIPOS_DOCUMENTO.FACTURA,
      });
      const emitida = await nuevoPedido({
        tipoDocumento: TIPOS_DOCUMENTO.FACTURA,
      });
      const folio = folioNuevo();
      await emitir(emitida, folio, '2026-10-20');
      const ver = async (codigo: string) =>
        (
          await servidor()
            .get(`/api/gestion/facturas/${codigo}`)
            .auth(token, { type: 'bearer' })
            .expect(200)
        ).body as Record<string, unknown>;

      expect(await ver(porEmitir)).toEqual({
        codigoPedido: porEmitir,
        estado: 'por_emitir',
        receptor: {
          razonSocial: `Peluquería ${apellido} Ltda.`,
          rut: '76123456-0',
          giro: 'Servicios de peluquería',
          direccion: 'Calle Falsa 123',
          comuna: 'Comuna de prueba gestión',
        },
        montos: { neto: 10000, iva: 1900, total: 11900 },
        porcentajeIva: 19,
        folio: null,
        fechaEmision: null,
      });
      expect(await ver(emitida)).toMatchObject({
        estado: 'emitida',
        receptor: {
          razonSocial: 'Razón copiada S.A.',
          comuna: 'Comuna copiada',
        },
        folio,
        fechaEmision: '2026-10-20',
      });

      // Una boleta no tiene factura que emitir
      const boleta = await nuevoPedido();
      await servidor()
        .get(`/api/gestion/facturas/${boleta}`)
        .auth(token, { type: 'bearer' })
        .expect(404);
    });

    it('RNF-03 · el bodeguero no gestiona la facturación: 403', async () => {
      const bodeguero = await tokenDe(ROLES.BODEGUERO);
      await servidor()
        .get('/api/gestion/facturas')
        .auth(bodeguero, { type: 'bearer' })
        .expect(403);
    });
  });
});
