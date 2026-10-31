import { INestApplication, ServiceUnavailableException } from '@nestjs/common';
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
import { COTIZACION_NO_DISPONIBLE } from '../src/modulos/despacho/cotizador-chilexpress.js';
import { CotizadorEnvio } from '../src/modulos/despacho/cotizador-envio.js';
import { SIN_COBERTURA } from '../src/modulos/despacho/cotizar-envio.service.js';
import { CARRITO_CAMBIADO } from '../src/modulos/pedidos/crear-pedido.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { REDIS } from '../src/redis/redis.module.js';

// Requiere PostgreSQL y Redis levantados: `docker compose up -d db redis`.

const CONTRASENA = 'Secreta123';
const RUTA = '/api/despacho/cotizacion';
// Todo lo que crean estas pruebas lleva este prefijo, para borrarlo al terminar
const PREFIJO = 'E2E-cotizar-despacho';
const PREFIJO_CORREO = 'e2e-cotizar-despacho-';
// Región y comuna de prueba (códigos que no usa el CUT ni otra prueba); se borran al terminar
const REGION = '92';
const COMUNA = '92001';

describe('Despacho · cotizar el envío con Chilexpress (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: Redis;
  let hashContrasena: string;
  let comunaId: number;
  let ubicacionId: number;
  let categoriaId: number;
  const cotizar = vi.fn<CotizadorEnvio['cotizar']>();

  const unico = () => randomUUID().slice(0, 8);
  const servidor = () => request(app.getHttpServer());

  const cuenta = async (rol: Rol = ROLES.CLIENTE) => {
    const email = `${PREFIJO_CORREO}${randomUUID()}@prueba.cl`;
    const usuario = await prisma.usuario.create({
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
    return {
      id: usuario.id,
      token: (respuesta.body as { tokenAcceso: string }).tokenAcceso,
    };
  };

  const nuevoFormato = async (stock = 5) => {
    const producto = await prisma.producto.create({
      data: {
        nombre: `${PREFIJO} Shampoo ${unico()}`,
        descripcion: 'Repara el cabello.',
        origenDescripcion: ORIGENES_DESCRIPCION.MANUAL,
        canalVenta: CANALES_VENTA.GENERAL,
        categoriaId,
      },
    });
    const { id } = await prisma.articuloVenta.create({
      data: {
        sku: `${PREFIJO}-${unico()}`,
        tipo: TIPOS_ARTICULO.FORMATO,
        precioMinoristaNeto: 1003,
        precioMayoristaNeto: 802,
      },
    });
    await prisma.imagenArticulo.create({
      data: {
        articuloId: id,
        ubicacionArchivo: `articulos/${id}/principal.jpg`,
        orden: 1,
        esPrincipal: true,
      },
    });
    await prisma.formatoProducto.create({
      data: {
        id,
        productoId: producto.id,
        nombreFormato: '300 ml',
        pesoGramos: 320,
        altoCm: 18,
        anchoCm: 6,
        largoCm: 6,
        esPredeterminado: true,
      },
    });
    await prisma.existencia.create({
      data: { formatoId: id, ubicacionId, cantidad: stock },
    });
    return id;
  };

  /** Una cuenta con una unidad en el carrito y una dirección en la comuna de prueba. */
  const compradorListo = async (rol: Rol = ROLES.CLIENTE, cantidad = 1) => {
    const comprador = await cuenta(rol);
    const articuloId = await nuevoFormato();
    await prisma.carrito.create({
      data: {
        usuarioId: comprador.id,
        items: { create: [{ articuloId, cantidad }] },
      },
    });
    const direccion = await prisma.direccion.create({
      data: {
        usuarioId: comprador.id,
        comunaId,
        calle: 'Av. Prueba',
        numero: '123',
      },
    });
    return { ...comprador, articuloId, direccionId: direccion.id };
  };

  const cotizarRuta = (token: string, direccionId: number | string) =>
    servidor().get(RUTA).query({ direccionId }).auth(token, { type: 'bearer' });

  const crearPedido = (token: string, direccionId: number) =>
    servidor().post('/api/pedidos').auth(token, { type: 'bearer' }).send({
      claveIdempotencia: randomUUID(),
      tipoEntrega: 'despacho',
      direccionId,
      tipoDocumento: 'boleta',
    });

  const itemsDelCarrito = (usuarioId: number) =>
    prisma.itemCarrito.count({ where: { carrito: { usuarioId } } });

  const pedidosDe = (usuarioId: number) =>
    prisma.pedido.count({ where: { usuarioId } });

  const borrarClaves = async (patron: string) => {
    const claves = await redis.keys(patron);
    if (claves.length) await redis.del(...claves);
  };

  const limpiar = async () => {
    const correo = { startsWith: PREFIJO_CORREO };
    const sku = { sku: { startsWith: PREFIJO } };
    await prisma.movimientoInventario.deleteMany({
      where: { formato: { articulo: sku } },
    });
    await prisma.existencia.deleteMany({
      where: { formato: { articulo: sku } },
    });
    await prisma.pedido.deleteMany({ where: { usuario: { email: correo } } });
    await prisma.itemCarrito.deleteMany({ where: { articulo: sku } });
    await prisma.articuloVenta.deleteMany({ where: sku });
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
    await prisma.usuario.deleteMany({ where: { email: correo } });
  };

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CotizadorEnvio)
      .useValue({ cotizar })
      .compile();
    app = configurarApp(modulo.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    redis = app.get(REDIS);
    hashContrasena = await argon2.hash(CONTRASENA);
    await limpiar();

    const region = await prisma.region.upsert({
      where: { codigoCut: REGION },
      update: {},
      create: { codigoCut: REGION, nombre: 'Región de prueba despacho' },
    });
    comunaId = (
      await prisma.comuna.upsert({
        where: { codigoCut: COMUNA },
        update: {},
        create: {
          codigoCut: COMUNA,
          nombre: 'Comuna de prueba despacho',
          regionId: region.id,
        },
      })
    ).id;
  });

  beforeEach(async () => {
    await borrarClaves('limite:*');
    await borrarClaves(`cache:cotizacion-envio:*:${COMUNA}:*`);
    await limpiar();
    cotizar.mockReset();
    cotizar.mockResolvedValue({ servicio: 'EXPRESS', tarifa: 7310 });

    const bodega = await prisma.bodega.create({
      data: {
        nombre: `${PREFIJO} Central`,
        direccion: 'Calle de prueba 300',
        tipo: 'tienda',
        comunaId,
        abasteceVentaOnline: true,
      },
    });
    ubicacionId = (
      await prisma.ubicacion.create({
        data: { bodegaId: bodega.id, codigo: 'GONDOLA-1' },
      })
    ).id;
    categoriaId = (
      await prisma.categoria.create({
        data: { nombre: `${PREFIJO} Cat ${unico()}` },
      })
    ).id;
  });

  afterAll(async () => {
    await borrarClaves(`cache:cotizacion-envio:*:${COMUNA}:*`);
    await limpiar();
    await prisma.comuna.deleteMany({ where: { codigoCut: COMUNA } });
    await prisma.region.deleteMany({ where: { codigoCut: REGION } });
    await app.close();
  });

  it('E7-H2 · cotización obtenida: cotiza según la comuna, el peso y las medidas, y suma el costo al total sin informar el servicio', async () => {
    const comprador = await compradorListo();

    const respuesta = await cotizarRuta(
      comprador.token,
      comprador.direccionId,
    ).expect(200);

    expect(respuesta.body).toEqual({
      costo: 7310,
      totalCarrito: 1194,
      total: 8504,
    });
    expect(cotizar.mock.calls[0]![0]).toMatchObject({
      destinoCut: COMUNA,
      bulto: { pesoGramos: 320, altoCm: 18, anchoCm: 6, largoCm: 6 },
    });
  });

  it('E7-H2 · cotización obtenida: el pedido guarda el costo neto y paga el mismo total que mostró la cotización, reutilizándola', async () => {
    const comprador = await compradorListo();
    const { body: cotizacion } = await cotizarRuta(
      comprador.token,
      comprador.direccionId,
    ).expect(200);

    const respuesta = await crearPedido(
      comprador.token,
      comprador.direccionId,
    ).expect(201);

    const pedido = respuesta.body as {
      codigoPublico: string;
      montos: { neto: number; iva: number; total: number };
      envio: { servicio: string; costo: number };
    };
    expect(pedido.montos.total).toBe((cotizacion as { total: number }).total);
    expect(pedido.montos).toEqual({ neto: 7146, iva: 1358, total: 8504 });
    expect(pedido.envio).toMatchObject({ servicio: 'EXPRESS', costo: 7310 });
    const envio = await prisma.envio.findFirstOrThrow({
      where: { pedido: { codigoPublico: pedido.codigoPublico } },
    });
    expect(Number(envio.costoNeto)).toBe(6143);
    expect(cotizar).toHaveBeenCalledOnce();
  });

  it('E7-H2 · servicio de envíos sin respuesta: responde 503 para que se ofrezca el retiro, sin crear el pedido ni vaciar el carrito', async () => {
    const comprador = await compradorListo();
    cotizar.mockRejectedValue(
      new ServiceUnavailableException(COTIZACION_NO_DISPONIBLE),
    );

    const cotizacion = await cotizarRuta(
      comprador.token,
      comprador.direccionId,
    ).expect(503);
    expect((cotizacion.body as { message: string }).message).toBe(
      COTIZACION_NO_DISPONIBLE,
    );

    await crearPedido(comprador.token, comprador.direccionId).expect(503);
    expect(await pedidosDe(comprador.id)).toBe(0);
    expect(await itemsDelCarrito(comprador.id)).toBe(1);

    // Con el courier caído, el mismo carrito se puede comprar con retiro
    await servidor()
      .post('/api/pedidos')
      .auth(comprador.token, { type: 'bearer' })
      .send({
        claveIdempotencia: randomUUID(),
        tipoEntrega: 'retiro',
        tipoDocumento: 'boleta',
      })
      .expect(201);
  });

  it('E7-H2 · comuna sin cobertura: responde 409, no crea el pedido y mantiene el carrito', async () => {
    const comprador = await compradorListo();
    cotizar.mockResolvedValue(null);

    const cotizacion = await cotizarRuta(
      comprador.token,
      comprador.direccionId,
    ).expect(409);
    expect((cotizacion.body as { message: string }).message).toBe(
      SIN_COBERTURA,
    );

    await crearPedido(comprador.token, comprador.direccionId).expect(409);
    expect(await pedidosDe(comprador.id)).toBe(0);
    expect(await itemsDelCarrito(comprador.id)).toBe(1);
  });

  it('E7-H2 · comuna de la lista oficial: una dirección nueva solo acepta una comuna que existe', async () => {
    const { token } = await cuenta();
    const crear = (comuna: string) =>
      servidor()
        .post('/api/cuentas/yo/direcciones')
        .auth(token, { type: 'bearer' })
        .send({ calle: 'Av. Prueba', numero: '123', comuna });

    const inexistente = await crear('99999').expect(400);
    expect((inexistente.body as { message: unknown }).message).toEqual(
      expect.stringContaining('La comuna no existe.'),
    );
    await crear('Concepción').expect(400);
    await crear(COMUNA).expect(201);
  });

  it('E7-H2 · permisos: sin sesión responde 401 y el personal de tienda 403', async () => {
    await servidor().get(RUTA).query({ direccionId: 1 }).expect(401);
    const vendedor = await cuenta(ROLES.VENDEDOR);
    await cotizarRuta(vendedor.token, 1).expect(403);
    expect(cotizar).not.toHaveBeenCalled();
  });

  it('E7-H2 · dirección de otra cuenta 404, dirección inválida 400 y carrito vacío 409, sin consultar a Chilexpress', async () => {
    const comprador = await compradorListo();
    const ajena = await compradorListo();
    await cotizarRuta(comprador.token, ajena.direccionId).expect(404);
    await cotizarRuta(comprador.token, 'abc').expect(400);
    await servidor()
      .get(RUTA)
      .auth(comprador.token, { type: 'bearer' })
      .expect(400);

    await prisma.itemCarrito.deleteMany({
      where: { carrito: { usuarioId: comprador.id } },
    });
    await cotizarRuta(comprador.token, comprador.direccionId).expect(409);
    expect(cotizar).not.toHaveBeenCalled();
  });

  it('E7-H2 · límite: la cuenta 11 del minuto responde 429 (RNF-09)', async () => {
    const comprador = await compradorListo();
    for (let vez = 0; vez < 10; vez++) {
      await cotizarRuta(comprador.token, comprador.direccionId).expect(200);
    }
    await cotizarRuta(comprador.token, comprador.direccionId).expect(429);
  });

  it('E7-H2 · cotización obtenida: el profesional cotiza con su total mayorista, y el cliente con el minorista (RNF-04)', async () => {
    const profesional = await compradorListo(ROLES.PROFESIONAL, 3);
    const cliente = await compradorListo(ROLES.CLIENTE, 3);

    const mayorista = await cotizarRuta(
      profesional.token,
      profesional.direccionId,
    ).expect(200);
    const minorista = await cotizarRuta(
      cliente.token,
      cliente.direccionId,
    ).expect(200);

    // 3 × 802 y 3 × 1.003 netos, con IVA; el bulto de 3 unidades cuesta lo mismo
    expect(mayorista.body).toEqual({
      costo: 7310,
      totalCarrito: 2862,
      total: 10172,
    });
    expect(minorista.body).toEqual({
      costo: 7310,
      totalCarrito: 3582,
      total: 10892,
    });
    expect(cotizar.mock.calls[0]![0].bulto).toEqual({
      pesoGramos: 960,
      altoCm: 13,
      anchoCm: 13,
      largoCm: 13,
    });
  });

  it('E7-H2 · carrito cambiado al cotizar: responde 409, no crea el pedido ni descuenta stock', async () => {
    const comprador = await compradorListo();
    cotizar.mockImplementation(async () => {
      await prisma.itemCarrito.updateMany({
        where: { carrito: { usuarioId: comprador.id } },
        data: { cantidad: 2 },
      });
      return { servicio: 'EXPRESS', tarifa: 7310 };
    });

    const respuesta = await crearPedido(
      comprador.token,
      comprador.direccionId,
    ).expect(409);

    expect((respuesta.body as { message: string }).message).toBe(
      CARRITO_CAMBIADO,
    );
    expect(await pedidosDe(comprador.id)).toBe(0);
    const { cantidad } = await prisma.existencia.findUniqueOrThrow({
      where: {
        formatoId_ubicacionId: { formatoId: comprador.articuloId, ubicacionId },
      },
    });
    expect(cantidad).toBe(5);
  });

  it('E7-H2 · artículo que ya no se vende: responde 409 sin consultar a Chilexpress', async () => {
    const comprador = await compradorListo();
    await prisma.articuloVenta.update({
      where: { id: comprador.articuloId },
      data: { activo: false },
    });

    await cotizarRuta(comprador.token, comprador.direccionId).expect(409);
    expect(cotizar).not.toHaveBeenCalled();
  });
});
