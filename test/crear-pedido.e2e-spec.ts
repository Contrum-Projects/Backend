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
const RUTA = '/api/pedidos';
// Todo lo que crean estas pruebas lleva este prefijo, para borrarlo al terminar
const PREFIJO = 'E2E-crear-pedido';
const PREFIJO_CORREO = 'e2e-crear-pedido-';
// Región y comuna de prueba (códigos que no usa el CUT ni otra prueba); se borran al terminar
const REGION = '91';
const COMUNA = '91001';

interface Pedido {
  codigoPublico: string;
  estado: string;
  pagarHasta: string;
  tipoEntrega: string;
  tipoDocumento: string;
  porcentajeIva: number;
  montos: { neto: number; iva: number; total: number };
  items: { articuloId: number; cantidad: number; subtotal: number }[];
  envio: { servicio: string; costo: number; estado: string } | null;
  historial: { estado: string }[];
}

describe('Pedidos · crear el pedido desde el carrito (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: Redis;
  let hashContrasena: string;
  let comunaId: number;
  let categoriaId: number;
  let ubicacionId: number;

  const unico = () => randomUUID().slice(0, 8);
  const servidor = () => request(app.getHttpServer());

  const cuenta = async (rol: Rol) => {
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

  const nuevoArticulo = async (tipo: string, neto: number) => {
    const articulo = await prisma.articuloVenta.create({
      data: {
        sku: `${PREFIJO}-${unico()}`,
        tipo,
        precioMinoristaNeto: neto,
        precioMayoristaNeto: Math.round(neto * 0.8),
      },
    });
    await prisma.imagenArticulo.create({
      data: {
        articuloId: articulo.id,
        ubicacionArchivo: `articulos/${articulo.id}/principal.jpg`,
        orden: 1,
        esPrincipal: true,
      },
    });
    return articulo.id;
  };

  const nuevoFormato = async (stock: number, neto = 1003) => {
    const producto = await prisma.producto.create({
      data: {
        nombre: `${PREFIJO} Shampoo ${unico()}`,
        descripcion: 'Repara el cabello.',
        origenDescripcion: ORIGENES_DESCRIPCION.MANUAL,
        canalVenta: CANALES_VENTA.GENERAL,
        categoriaId,
      },
    });
    const id = await nuevoArticulo(TIPOS_ARTICULO.FORMATO, neto);
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
    return { id, nombre: producto.nombre };
  };

  const nuevoPack = async (
    componentes: { formatoId: number; cantidad: number }[],
  ) => {
    const id = await nuevoArticulo(TIPOS_ARTICULO.PACK, 1500);
    await prisma.pack.create({
      data: {
        id,
        nombre: `${PREFIJO} Dúo ${unico()}`,
        descripcion: 'Dos productos.',
        canalVenta: CANALES_VENTA.GENERAL,
        componentes: { create: componentes },
      },
    });
    return id;
  };

  const llenarCarrito = (
    usuarioId: number,
    items: { articuloId: number; cantidad: number }[],
  ) =>
    prisma.carrito.create({
      data: { usuarioId, items: { create: items } },
    });

  const confirmar = (token: string, cuerpo: object = {}) =>
    servidor()
      .post(RUTA)
      .auth(token, { type: 'bearer' })
      .send({
        claveIdempotencia: randomUUID(),
        tipoEntrega: 'retiro',
        tipoDocumento: 'boleta',
        ...cuerpo,
      });

  const stockDe = async (formatoId: number) =>
    (
      await prisma.existencia.findUniqueOrThrow({
        where: { formatoId_ubicacionId: { formatoId, ubicacionId } },
      })
    ).cantidad;

  const itemsDelCarrito = (usuarioId: number) =>
    prisma.itemCarrito.count({ where: { carrito: { usuarioId } } });

  const pedidosDe = (usuarioId: number) =>
    prisma.pedido.count({ where: { usuarioId } });

  const limpiar = async () => {
    const correo = { startsWith: PREFIJO_CORREO };
    await prisma.movimientoInventario.deleteMany({
      where: { formato: { articulo: { sku: { startsWith: PREFIJO } } } },
    });
    await prisma.existencia.deleteMany({
      where: { formato: { articulo: { sku: { startsWith: PREFIJO } } } },
    });
    // El detalle, el historial y el envío se borran en cascada con el pedido
    await prisma.pedido.deleteMany({ where: { usuario: { email: correo } } });
    await prisma.datosFacturacion.deleteMany({
      where: { usuario: { email: correo } },
    });
    await prisma.itemCarrito.deleteMany({
      where: { articulo: { sku: { startsWith: PREFIJO } } },
    });
    await prisma.articuloVenta.deleteMany({
      where: { sku: { startsWith: PREFIJO }, tipo: TIPOS_ARTICULO.PACK },
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
    // Las direcciones y el carrito se borran en cascada con la cuenta
    await prisma.usuario.deleteMany({ where: { email: correo } });
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
      create: { codigoCut: REGION, nombre: 'Región de prueba crear pedido' },
    });
    comunaId = (
      await prisma.comuna.upsert({
        where: { codigoCut: COMUNA },
        update: {},
        create: {
          codigoCut: COMUNA,
          nombre: 'Comuna de prueba crear pedido',
          regionId: region.id,
        },
      })
    ).id;
  });

  beforeEach(async () => {
    const claves = await redis.keys('limite:*');
    if (claves.length) await redis.del(...claves);
    await limpiar();

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
    await limpiar();
    await prisma.comuna.deleteMany({ where: { codigoCut: COMUNA } });
    await prisma.region.deleteMany({ where: { codigoCut: REGION } });
    await app.close();
  });

  it('E5-H3 · pedido creado: guarda los montos que mostró el carrito, reserva el stock y da 15 minutos para pagar', async () => {
    const comprador = await cuenta(ROLES.CLIENTE);
    const formato = await nuevoFormato(5);
    await llenarCarrito(comprador.id, [
      { articuloId: formato.id, cantidad: 3 },
    ]);
    const carrito = await servidor()
      .get('/api/carrito')
      .auth(comprador.token, { type: 'bearer' })
      .expect(200);
    const antes = Date.now();

    const respuesta = await confirmar(comprador.token).expect(201);

    const pedido = respuesta.body as Pedido;
    expect(pedido.codigoPublico).toMatch(/^[A-Z2-9]{12}$/);
    expect(pedido.estado).toBe('pendiente_pago');
    expect(pedido.montos).toEqual({ neto: 3009, iva: 573, total: 3582 });
    expect(pedido.montos.total).toBe((carrito.body as { total: number }).total);
    expect(pedido.items).toMatchObject([
      { articuloId: formato.id, cantidad: 3, subtotal: 3582 },
    ]);
    expect(pedido.historial).toMatchObject([{ estado: 'pendiente_pago' }]);
    expect(pedido.envio).toBeNull();
    const plazo = new Date(pedido.pagarHasta).getTime() - antes;
    expect(plazo).toBeGreaterThan(14 * 60_000);
    expect(plazo).toBeLessThanOrEqual(15 * 60_000 + 5_000);

    expect(await stockDe(formato.id)).toBe(2);
    const guardado = await prisma.pedido.findUniqueOrThrow({
      where: { codigoPublico: pedido.codigoPublico },
      include: { movimientos: true, detalles: true },
    });
    expect(guardado.movimientos).toMatchObject([
      {
        formatoId: formato.id,
        tipo: TIPOS_MOVIMIENTO.VENTA,
        cantidad: 3,
        ubicacionOrigenId: ubicacionId,
      },
    ]);
    expect(guardado.detalles[0].tipoPrecio).toBe('minorista');
    expect(Number(guardado.detalles[0].precioUnitarioNetoAplicado)).toBe(1003);
    expect(await itemsDelCarrito(comprador.id)).toBe(0);
  });

  it('E5-H3 · pedido creado: el total no depende de lo que mande el navegador', async () => {
    const comprador = await cuenta(ROLES.CLIENTE);
    const formato = await nuevoFormato(5);
    await llenarCarrito(comprador.id, [
      { articuloId: formato.id, cantidad: 1 },
    ]);

    await confirmar(comprador.token, { montoTotal: 1 }).expect(400);

    expect(await pedidosDe(comprador.id)).toBe(0);
  });

  it('E5-H3 · pedido creado: el despacho exige dirección de la cuenta y queda con costo 0 provisional', async () => {
    const comprador = await cuenta(ROLES.CLIENTE);
    const ajena = await cuenta(ROLES.CLIENTE);
    const formato = await nuevoFormato(5);
    await llenarCarrito(comprador.id, [
      { articuloId: formato.id, cantidad: 1 },
    ]);
    const datosDireccion = {
      comunaId,
      calle: 'Av. Prueba',
      numero: '123',
    };
    const propia = await prisma.direccion.create({
      data: { usuarioId: comprador.id, ...datosDireccion },
    });
    const otra = await prisma.direccion.create({
      data: { usuarioId: ajena.id, ...datosDireccion },
    });

    await confirmar(comprador.token, { tipoEntrega: 'despacho' }).expect(400);
    await confirmar(comprador.token, {
      tipoEntrega: 'despacho',
      direccionId: otra.id,
    }).expect(404);

    const respuesta = await confirmar(comprador.token, {
      tipoEntrega: 'despacho',
      direccionId: propia.id,
    }).expect(201);

    const pedido = respuesta.body as Pedido;
    expect(pedido.tipoEntrega).toBe('despacho');
    expect(pedido.montos.total).toBe(1194);
    expect(pedido.envio).toMatchObject({
      servicio: 'por_cotizar',
      costo: 0,
      estado: 'pendiente',
      destinatario: 'Marcela Soto',
      calle: 'Av. Prueba',
    });
  });

  it('E5-H3 · pedido creado: la factura exige datos activos de la cuenta', async () => {
    const comprador = await cuenta(ROLES.CLIENTE);
    const formato = await nuevoFormato(5);
    await llenarCarrito(comprador.id, [
      { articuloId: formato.id, cantidad: 1 },
    ]);
    const datos = {
      usuarioId: comprador.id,
      comunaId,
      rut: '11111111-1',
      razonSocial: 'Peluquería de Prueba',
      giro: 'Peluquería',
      direccion: 'Av. Prueba 123',
    };
    const inactivos = await prisma.datosFacturacion.create({
      data: { ...datos, activo: false },
    });
    const activos = await prisma.datosFacturacion.create({ data: datos });

    await confirmar(comprador.token, {
      tipoDocumento: 'factura',
      datosFacturacionId: inactivos.id,
    }).expect(404);

    const respuesta = await confirmar(comprador.token, {
      tipoDocumento: 'factura',
      datosFacturacionId: activos.id,
    }).expect(201);

    expect((respuesta.body as Pedido).tipoDocumento).toBe('factura');
  });

  it('E5-H3 · stock insuficiente: no crea el pedido, nombra el artículo y deja stock y carrito intactos', async () => {
    const comprador = await cuenta(ROLES.CLIENTE);
    const conStock = await nuevoFormato(5);
    const sinStock = await nuevoFormato(1);
    await llenarCarrito(comprador.id, [
      { articuloId: conStock.id, cantidad: 2 },
      { articuloId: sinStock.id, cantidad: 2 },
    ]);

    const respuesta = await confirmar(comprador.token).expect(409);

    expect((respuesta.body as { message: string }).message).toBe(
      `No hay stock suficiente de ${sinStock.nombre} 300 ml.`,
    );
    expect(await pedidosDe(comprador.id)).toBe(0);
    expect(await stockDe(conStock.id)).toBe(5);
    expect(await stockDe(sinStock.id)).toBe(1);
    expect(await itemsDelCarrito(comprador.id)).toBe(2);
  });

  it('E5-H3 · stock insuficiente: suma un formato suelto con el mismo formato dentro de un pack', async () => {
    const comprador = await cuenta(ROLES.CLIENTE);
    const compartido = await nuevoFormato(3);
    const otro = await nuevoFormato(5);
    const pack = await nuevoPack([
      { formatoId: compartido.id, cantidad: 2 },
      { formatoId: otro.id, cantidad: 1 },
    ]);
    // Cada línea cabe por separado (2 y 2 de 3), pero juntas piden 4
    await llenarCarrito(comprador.id, [
      { articuloId: compartido.id, cantidad: 2 },
      { articuloId: pack, cantidad: 1 },
    ]);

    const respuesta = await confirmar(comprador.token).expect(409);

    expect((respuesta.body as { message: string }).message).toBe(
      `No hay stock suficiente de ${compartido.nombre} 300 ml.`,
    );
    expect(await pedidosDe(comprador.id)).toBe(0);
    expect(await stockDe(compartido.id)).toBe(3);
  });

  it('E5-H3 · pedido creado: un pack descuenta de sus formatos y cobra el precio del pack', async () => {
    const comprador = await cuenta(ROLES.CLIENTE);
    const shampoo = await nuevoFormato(5);
    const balsamo = await nuevoFormato(5);
    const pack = await nuevoPack([
      { formatoId: shampoo.id, cantidad: 2 },
      { formatoId: balsamo.id, cantidad: 1 },
    ]);
    await llenarCarrito(comprador.id, [{ articuloId: pack, cantidad: 2 }]);

    const respuesta = await confirmar(comprador.token).expect(201);

    // 2 × 1.500 neto: 2 × 1.785 con IVA
    expect((respuesta.body as Pedido).montos).toEqual({
      neto: 3000,
      iva: 570,
      total: 3570,
    });
    expect(await stockDe(shampoo.id)).toBe(1);
    expect(await stockDe(balsamo.id)).toBe(3);
  });

  it('E5-H3 · pedido creado: el profesional paga el mayorista y la línea lo guarda', async () => {
    const profesional = await cuenta(ROLES.PROFESIONAL);
    const formato = await nuevoFormato(5);
    await llenarCarrito(profesional.id, [
      { articuloId: formato.id, cantidad: 3 },
    ]);

    const respuesta = await confirmar(profesional.token).expect(201);

    // 3 × 802 neto mayorista: 3 × 954 con IVA
    const pedido = respuesta.body as Pedido;
    expect(pedido.montos).toEqual({ neto: 2406, iva: 456, total: 2862 });
    const [detalle] = await prisma.detallePedido.findMany({
      where: { pedido: { codigoPublico: pedido.codigoPublico } },
    });
    expect(detalle.tipoPrecio).toBe('mayorista');
    expect(Number(detalle.precioUnitarioNetoAplicado)).toBe(802);
  });

  it('E5-H3 · stock insuficiente: un cliente no puede comprar un producto exclusivo', async () => {
    const comprador = await cuenta(ROLES.CLIENTE);
    const formato = await nuevoFormato(5);
    await llenarCarrito(comprador.id, [
      { articuloId: formato.id, cantidad: 1 },
    ]);
    await prisma.producto.updateMany({
      where: { nombre: formato.nombre },
      data: { canalVenta: CANALES_VENTA.PROFESIONAL },
    });

    await confirmar(comprador.token).expect(409);

    expect(await pedidosDe(comprador.id)).toBe(0);
    expect(await stockDe(formato.id)).toBe(5);
  });

  it('E5-H3 · stock insuficiente: un artículo que ya no se vende impide el pedido y se nombra', async () => {
    const comprador = await cuenta(ROLES.CLIENTE);
    const formato = await nuevoFormato(5);
    await llenarCarrito(comprador.id, [
      { articuloId: formato.id, cantidad: 1 },
    ]);
    await prisma.articuloVenta.update({
      where: { id: formato.id },
      data: { activo: false },
    });

    const respuesta = await confirmar(comprador.token).expect(409);

    expect((respuesta.body as { message: string }).message).toContain(
      formato.nombre,
    );
    expect(await pedidosDe(comprador.id)).toBe(0);
  });

  it('E5-H3 · correo sin confirmar: no crea el pedido e indica que debe confirmarlo', async () => {
    // El inicio de sesión ya rechaza un correo sin confirmar: se quita con la sesión abierta
    const comprador = await cuenta(ROLES.CLIENTE);
    await prisma.usuario.update({
      where: { id: comprador.id },
      data: { fechaVerificacionCorreo: null },
    });
    const formato = await nuevoFormato(5);
    await llenarCarrito(comprador.id, [
      { articuloId: formato.id, cantidad: 1 },
    ]);

    const respuesta = await confirmar(comprador.token).expect(403);

    expect((respuesta.body as { message: string }).message).toBe(
      'Debes confirmar tu correo antes de comprar.',
    );
    expect(await pedidosDe(comprador.id)).toBe(0);
    expect(await stockDe(formato.id)).toBe(5);
  });

  it('E5-H3 · doble confirmación: dos solicitudes simultáneas con la misma clave crean un solo pedido', async () => {
    const comprador = await cuenta(ROLES.CLIENTE);
    const formato = await nuevoFormato(5);
    await llenarCarrito(comprador.id, [
      { articuloId: formato.id, cantidad: 2 },
    ]);
    const claveIdempotencia = randomUUID();

    const [primera, segunda] = await Promise.all([
      confirmar(comprador.token, { claveIdempotencia }),
      confirmar(comprador.token, { claveIdempotencia }),
    ]);

    expect([primera.status, segunda.status]).toEqual([201, 201]);
    expect((primera.body as Pedido).codigoPublico).toBe(
      (segunda.body as Pedido).codigoPublico,
    );
    expect(await pedidosDe(comprador.id)).toBe(1);
    expect(await stockDe(formato.id)).toBe(3);
  });

  it('E5-H3 · doble confirmación: dos solicitudes simultáneas del mismo carrito con distinta clave crean un solo pedido', async () => {
    const comprador = await cuenta(ROLES.CLIENTE);
    const formato = await nuevoFormato(5);
    await llenarCarrito(comprador.id, [
      { articuloId: formato.id, cantidad: 2 },
    ]);

    const respuestas = await Promise.all([
      confirmar(comprador.token),
      confirmar(comprador.token),
    ]);

    expect(respuestas.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await pedidosDe(comprador.id)).toBe(1);
    expect(await stockDe(formato.id)).toBe(3);
  });

  it('E5-H3 · la clave repetida devuelve el pedido aunque ya no quede carrito, y otra cuenta puede usar la misma clave', async () => {
    const comprador = await cuenta(ROLES.CLIENTE);
    const otro = await cuenta(ROLES.CLIENTE);
    const formato = await nuevoFormato(5);
    await llenarCarrito(comprador.id, [
      { articuloId: formato.id, cantidad: 1 },
    ]);
    await llenarCarrito(otro.id, [{ articuloId: formato.id, cantidad: 1 }]);
    const claveIdempotencia = randomUUID();

    const primero = await confirmar(comprador.token, {
      claveIdempotencia,
    }).expect(201);
    const repetido = await confirmar(comprador.token, {
      claveIdempotencia,
    }).expect(201);
    const ajeno = await confirmar(otro.token, { claveIdempotencia }).expect(
      201,
    );

    expect((repetido.body as Pedido).codigoPublico).toBe(
      (primero.body as Pedido).codigoPublico,
    );
    expect((ajeno.body as Pedido).codigoPublico).not.toBe(
      (primero.body as Pedido).codigoPublico,
    );
  });

  it('E5-H3 · pedido pendiente: con uno sin pagar no crea otro, y al dejar de estar pendiente sí', async () => {
    const comprador = await cuenta(ROLES.CLIENTE);
    const formato = await nuevoFormato(5);
    await llenarCarrito(comprador.id, [
      { articuloId: formato.id, cantidad: 1 },
    ]);
    const primero = await confirmar(comprador.token).expect(201);
    await prisma.itemCarrito.create({
      data: {
        carrito: { connect: { usuarioId: comprador.id } },
        articulo: { connect: { id: formato.id } },
        cantidad: 1,
      },
    });

    const rechazo = await confirmar(comprador.token).expect(409);

    expect((rechazo.body as { message: string }).message).toContain(
      'pedido pendiente de pago',
    );
    expect(await pedidosDe(comprador.id)).toBe(1);
    expect(await stockDe(formato.id)).toBe(4);
    expect(await itemsDelCarrito(comprador.id)).toBe(1);

    await prisma.pedido.update({
      where: { codigoPublico: (primero.body as Pedido).codigoPublico },
      data: { estadoActual: 'pagado' },
    });
    await confirmar(comprador.token).expect(201);
    expect(await pedidosDe(comprador.id)).toBe(2);
  });

  it('E5-H3 · límite por cuenta: la sexta solicitud del minuto responde 429 y no afecta a otra cuenta', async () => {
    const comprador = await cuenta(ROLES.CLIENTE);
    const otra = await cuenta(ROLES.CLIENTE);

    for (let intento = 0; intento < 5; intento += 1) {
      await confirmar(comprador.token).expect(409);
    }
    await confirmar(comprador.token).expect(429);
    await confirmar(otra.token).expect(409);
  });

  it('E5-H3 · carrito vacío: responde 409', async () => {
    const comprador = await cuenta(ROLES.CLIENTE);

    await confirmar(comprador.token).expect(409);
  });

  it('E5-H3 · pedido creado: el precio mayorista no sale hacia el cliente (RNF-04)', async () => {
    const comprador = await cuenta(ROLES.CLIENTE);
    const formato = await nuevoFormato(5);
    await llenarCarrito(comprador.id, [
      { articuloId: formato.id, cantidad: 1 },
    ]);

    const respuesta = await confirmar(comprador.token).expect(201);

    expect(JSON.stringify(respuesta.body)).not.toMatch(/mayorista/i);
    expect(JSON.stringify(respuesta.body)).not.toContain('ubicacion');
  });

  it('E5-H3 · sin sesión responde 401 y el personal 403 (RNF-03)', async () => {
    await servidor().post(RUTA).send({}).expect(401);
    const vendedor = await cuenta(ROLES.VENDEDOR);

    await confirmar(vendedor.token).expect(403);
  });
});
