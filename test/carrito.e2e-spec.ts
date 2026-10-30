import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import argon2 from 'argon2';
import type { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { hoyEnLaTienda } from '../src/common/dominio/fechas.js';
import { precioConIva } from '../src/common/dominio/montos.js';
import { ROLES, type Rol } from '../src/common/dominio/roles.js';
import {
  CANALES_VENTA,
  ORIGENES_DESCRIPCION,
  TIPOS_ARTICULO,
} from '../src/common/dominio/valores.js';
import { configurarApp } from '../src/configurar-app.js';
import { LIMITES } from '../src/limites/limites.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { REDIS } from '../src/redis/redis.module.js';

// Requiere PostgreSQL y Redis levantados: `docker compose up -d db redis`.

const CONTRASENA = 'Secreta123';
const RUTA = '/api/carrito';
// Todo lo que crean estas pruebas lleva este prefijo, para borrarlo al terminar
const PREFIJO = 'E2E-carrito';
// Región y comuna de prueba (códigos que no usa el CUT ni otra prueba); se borran al terminar
const REGION = '94';
const COMUNA = '94001';

interface Linea {
  articuloId: number;
  tipo: string;
  nombre: string;
  nombreFormato: string | null;
  imagen: string | null;
  cantidad: number;
  precioUnitario: number | null;
  subtotal: number | null;
  aLaVenta: boolean;
  stockSuficiente: boolean | null;
  bajoMinimo: boolean;
  impideCrearPedido: boolean;
}

interface Carrito {
  items: Linea[];
  total: number;
  puedeCrearPedido: boolean;
}

/** AAAA-MM-DD desplazado `dias` desde hoy en Chile. */
const diaDesdeHoy = (dias: number) => {
  const fecha = new Date(`${hoyEnLaTienda()}T00:00:00Z`);
  fecha.setUTCDate(fecha.getUTCDate() + dias);
  return new Date(`${fecha.toISOString().slice(0, 10)}T00:00:00Z`);
};

describe('Carrito · agregar, cambiar y quitar artículos (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: Redis;
  let hashContrasena: string;
  let porcentajeIva: number;
  let categoriaId: number;
  /** Ubicación de una bodega que abastece la venta online. */
  let ubicacionOnline: number;
  const correosCreados: string[] = [];

  const unico = () => randomUUID().slice(0, 8);

  const tokenDe = async (rol: Rol) => {
    const email = `e2e-carrito-${randomUUID()}@prueba.cl`;
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
    const respuesta = await request(app.getHttpServer())
      .post('/api/cuentas/sesion')
      .send({ email, contrasena: CONTRASENA })
      .expect(200);
    return (respuesta.body as { tokenAcceso: string }).tokenAcceso;
  };

  const nuevoArticulo = async (
    tipo: string,
    precios: { minorista: number | null; mayorista: number },
  ) => {
    const articulo = await prisma.articuloVenta.create({
      data: {
        sku: `${PREFIJO}-${unico()}`,
        tipo,
        precioMinoristaNeto: precios.minorista,
        precioMayoristaNeto: precios.mayorista,
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

  /** Un producto con un formato a la venta (minorista 10.000 y mayorista 8.000 netos). */
  const nuevoFormato = async (canalVenta: string = CANALES_VENTA.GENERAL) => {
    const producto = await prisma.producto.create({
      data: {
        nombre: `${PREFIJO} Shampoo ${unico()}`,
        descripcion: 'Repara el cabello.',
        origenDescripcion: ORIGENES_DESCRIPCION.MANUAL,
        canalVenta,
        categoriaId,
      },
    });
    const id = await nuevoArticulo(TIPOS_ARTICULO.FORMATO, {
      minorista: canalVenta === CANALES_VENTA.GENERAL ? 10000 : null,
      mayorista: 8000,
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
    return { id, productoId: producto.id };
  };

  const nuevoPack = async (
    componentes: { formatoId: number; cantidad: number }[],
    extra: { fechaFinVigencia?: Date } = {},
  ) => {
    const id = await nuevoArticulo(TIPOS_ARTICULO.PACK, {
      minorista: 15000,
      mayorista: 12000,
    });
    await prisma.pack.create({
      data: {
        id,
        nombre: `${PREFIJO} Dúo ${unico()}`,
        descripcion: 'Shampoo y acondicionador.',
        canalVenta: CANALES_VENTA.GENERAL,
        fechaFinVigencia: extra.fechaFinVigencia,
        componentes: { create: componentes },
      },
    });
    return id;
  };

  const ponerStock = (formatoId: number, cantidad: number) =>
    prisma.existencia.upsert({
      where: {
        formatoId_ubicacionId: { formatoId, ubicacionId: ubicacionOnline },
      },
      update: { cantidad },
      create: { formatoId, ubicacionId: ubicacionOnline, cantidad },
    });

  const servidor = () => request(app.getHttpServer());

  const agregar = (token: string, articuloId: number, cantidad: number) =>
    servidor()
      .post(`${RUTA}/items`)
      .auth(token, { type: 'bearer' })
      .send({ articuloId, cantidad });

  const ver = async (token: string) =>
    (await servidor().get(RUTA).auth(token, { type: 'bearer' }).expect(200))
      .body as Carrito;

  const limpiar = async () => {
    await prisma.itemCarrito.deleteMany({
      where: { articulo: { sku: { startsWith: PREFIJO } } },
    });
    await prisma.existencia.deleteMany({
      where: { ubicacion: { bodega: { nombre: { startsWith: PREFIJO } } } },
    });
    // Pack, formato, componentes e imágenes se borran en cascada con su artículo; primero los
    // packs, que apuntan a los formatos
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
  };

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = configurarApp(modulo.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    redis = app.get(REDIS);
    porcentajeIva = app.get(ConfigService).get<number>('IVA_PORCENTAJE')!;
    hashContrasena = await argon2.hash(CONTRASENA);
    await limpiar();

    const region = await prisma.region.upsert({
      where: { codigoCut: REGION },
      update: {},
      create: { codigoCut: REGION, nombre: 'Región de prueba carrito' },
    });
    await prisma.comuna.upsert({
      where: { codigoCut: COMUNA },
      update: {},
      create: {
        codigoCut: COMUNA,
        nombre: 'Comuna de prueba carrito',
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
        nombre: `${PREFIJO} Central`,
        direccion: 'Calle de prueba 300',
        tipo: 'tienda',
        comunaId: comuna.id,
        abasteceVentaOnline: true,
      },
    });
    ubicacionOnline = (
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
    // El carrito se borra en cascada con la cuenta
    await prisma.usuario.deleteMany({
      where: { email: { in: correosCreados } },
    });
    await prisma.comuna.deleteMany({ where: { codigoCut: COMUNA } });
    await prisma.region.deleteMany({ where: { codigoCut: REGION } });
    await app.close();
  });

  it('E5-H1 · artículo agregado con stock suficiente: lo suma al carrito y devuelve los totales con los precios vigentes', async () => {
    const formato = await nuevoFormato();
    await ponerStock(formato.id, 5);
    const token = await tokenDe(ROLES.CLIENTE);

    const respuesta = await agregar(token, formato.id, 2).expect(201);

    const unitario = precioConIva(10000, porcentajeIva);
    const esperado = {
      items: [
        expect.objectContaining({
          articuloId: formato.id,
          tipo: TIPOS_ARTICULO.FORMATO,
          nombreFormato: '300 ml',
          cantidad: 2,
          precioUnitario: unitario,
          subtotal: unitario * 2,
          aLaVenta: true,
          stockSuficiente: true,
          impideCrearPedido: false,
        }),
      ],
      total: unitario * 2,
      puedeCrearPedido: true,
    };
    expect(respuesta.body).toMatchObject(esperado);
    expect((respuesta.body as Carrito).items[0]!.imagen).toContain(
      `articulos/${formato.id}/principal.jpg`,
    );
    expect(await ver(token)).toMatchObject(esperado);
  });

  it('E5-H1 · agregar otra vez el mismo artículo suma las unidades, y un pack se agrega como un solo artículo', async () => {
    const formato = await nuevoFormato();
    const otro = await nuevoFormato();
    await ponerStock(formato.id, 10);
    await ponerStock(otro.id, 10);
    const pack = await nuevoPack([
      { formatoId: formato.id, cantidad: 2 },
      { formatoId: otro.id, cantidad: 1 },
    ]);
    const token = await tokenDe(ROLES.CLIENTE);

    await agregar(token, formato.id, 1).expect(201);
    await agregar(token, formato.id, 2).expect(201);
    await agregar(token, pack, 3).expect(201);

    const carrito = await ver(token);
    expect(carrito.items).toHaveLength(2);
    expect(
      carrito.items.find((i) => i.articuloId === formato.id),
    ).toMatchObject({ cantidad: 3 });
    const lineaPack = carrito.items.find((i) => i.articuloId === pack)!;
    expect(lineaPack).toMatchObject({
      tipo: TIPOS_ARTICULO.PACK,
      cantidad: 3,
      nombreFormato: null,
      precioUnitario: precioConIva(15000, porcentajeIva),
      stockSuficiente: true,
    });
    expect(carrito.total).toBe(
      3 * precioConIva(10000, porcentajeIva) +
        3 * precioConIva(15000, porcentajeIva),
    );
  });

  it('E5-H1 · agregar más unidades de las que hay: responde 400 sin dar la cifra y no guarda nada', async () => {
    const formato = await nuevoFormato();
    await ponerStock(formato.id, 3);
    const token = await tokenDe(ROLES.CLIENTE);
    await agregar(token, formato.id, 2).expect(201);

    const respuesta = await agregar(token, formato.id, 2).expect(400);

    expect((respuesta.body as { message: string }).message).toBe(
      'No hay stock suficiente para esa cantidad.',
    );
    expect((await ver(token)).items[0]).toMatchObject({ cantidad: 2 });
  });

  it('E5-H1 · el stock de un pack lo marca su componente más escaso', async () => {
    const abundante = await nuevoFormato();
    const escaso = await nuevoFormato();
    await ponerStock(abundante.id, 50);
    await ponerStock(escaso.id, 5);
    // Con 5 unidades del escaso y 2 por pack caben 2 packs
    const pack = await nuevoPack([
      { formatoId: abundante.id, cantidad: 1 },
      { formatoId: escaso.id, cantidad: 2 },
    ]);
    const token = await tokenDe(ROLES.CLIENTE);

    await agregar(token, pack, 3).expect(400);
    await agregar(token, pack, 2).expect(201);
  });

  it('E5-H1 · cantidad mayor al stock al consultar: señala el artículo e indica que impide crear el pedido', async () => {
    const formato = await nuevoFormato();
    const otro = await nuevoFormato();
    await ponerStock(formato.id, 5);
    await ponerStock(otro.id, 5);
    const token = await tokenDe(ROLES.CLIENTE);
    await agregar(token, formato.id, 4).expect(201);
    await agregar(token, otro.id, 1).expect(201);
    // El stock baja después de agregar
    await ponerStock(formato.id, 2);

    const carrito = await ver(token);

    expect(
      carrito.items.find((i) => i.articuloId === formato.id),
    ).toMatchObject({
      aLaVenta: true,
      stockSuficiente: false,
      impideCrearPedido: true,
    });
    expect(carrito.items.find((i) => i.articuloId === otro.id)).toMatchObject({
      stockSuficiente: true,
      impideCrearPedido: false,
    });
    expect(carrito.puedeCrearPedido).toBe(false);
    // No se informa cuántas unidades hay
    expect(JSON.stringify(carrito)).not.toMatch(/disponibles|existencias/);
  });

  it('E5-H1 · artículo quitado: lo elimina del carrito y recalcula los totales', async () => {
    const formato = await nuevoFormato();
    const otro = await nuevoFormato();
    await ponerStock(formato.id, 5);
    await ponerStock(otro.id, 5);
    const token = await tokenDe(ROLES.CLIENTE);
    await agregar(token, formato.id, 2).expect(201);
    await agregar(token, otro.id, 1).expect(201);

    const respuesta = await servidor()
      .delete(`${RUTA}/items/${formato.id}`)
      .auth(token, { type: 'bearer' })
      .expect(200);

    const unitario = precioConIva(10000, porcentajeIva);
    expect(respuesta.body).toMatchObject({
      items: [expect.objectContaining({ articuloId: otro.id })],
      total: unitario,
    });
    await servidor()
      .delete(`${RUTA}/items/${formato.id}`)
      .auth(token, { type: 'bearer' })
      .expect(404);
  });

  it('E5-H1 · cambiar la cantidad deja la cantidad indicada, recalcula el total y respeta el stock', async () => {
    const formato = await nuevoFormato();
    await ponerStock(formato.id, 5);
    const token = await tokenDe(ROLES.CLIENTE);
    await agregar(token, formato.id, 1).expect(201);

    const respuesta = await servidor()
      .patch(`${RUTA}/items/${formato.id}`)
      .auth(token, { type: 'bearer' })
      .send({ cantidad: 4 })
      .expect(200);
    expect(respuesta.body).toMatchObject({
      items: [expect.objectContaining({ cantidad: 4 })],
      total: 4 * precioConIva(10000, porcentajeIva),
    });

    await servidor()
      .patch(`${RUTA}/items/${formato.id}`)
      .auth(token, { type: 'bearer' })
      .send({ cantidad: 6 })
      .expect(400);
    const otro = await nuevoFormato();
    await servidor()
      .patch(`${RUTA}/items/${otro.id}`)
      .auth(token, { type: 'bearer' })
      .send({ cantidad: 1 })
      .expect(404);
    expect((await ver(token)).items[0]).toMatchObject({ cantidad: 4 });
  });

  it('E5-H1 · la cantidad debe ser un entero de 1 a 999 y el artículo debe existir', async () => {
    const formato = await nuevoFormato();
    await ponerStock(formato.id, 5);
    const token = await tokenDe(ROLES.CLIENTE);

    for (const cantidad of [0, -1, 1.5, 1000, '2']) {
      const respuesta = await servidor()
        .post(`${RUTA}/items`)
        .auth(token, { type: 'bearer' })
        .send({ articuloId: formato.id, cantidad })
        .expect(400);
      expect(JSON.stringify(respuesta.body)).toContain('La cantidad');
    }
    await servidor()
      .post(`${RUTA}/items`)
      .auth(token, { type: 'bearer' })
      .send({ cantidad: 1 })
      .expect(400);
    const inexistente = await agregar(token, 2_000_000_000, 1).expect(400);
    expect((inexistente.body as { message: string }).message).toBe(
      'El artículo no existe o no está a la venta.',
    );
    expect((await ver(token)).items).toEqual([]);
  });

  it('el precio sale del rol: el cliente paga el minorista y el profesional el mayorista, que nunca se muestra al cliente', async () => {
    const formato = await nuevoFormato();
    await ponerStock(formato.id, 10);
    const cliente = await tokenDe(ROLES.CLIENTE);
    const profesional = await tokenDe(ROLES.PROFESIONAL);

    const delCliente = (await agregar(cliente, formato.id, 1).expect(201))
      .body as Carrito;
    const delProfesional = (
      await agregar(profesional, formato.id, 1).expect(201)
    ).body as Carrito;

    expect(delCliente.items[0]!.precioUnitario).toBe(
      precioConIva(10000, porcentajeIva),
    );
    expect(delProfesional.items[0]!.precioUnitario).toBe(
      precioConIva(8000, porcentajeIva),
    );
    expect(JSON.stringify(delCliente)).not.toMatch(/mayorista/i);
  });

  it('E5-H4 · bajo el mínimo: el carrito del profesional lo señala hasta llegar a 3 unidades; el del cliente, nunca', async () => {
    const formato = await nuevoFormato();
    await ponerStock(formato.id, 10);
    const cliente = await tokenDe(ROLES.CLIENTE);
    const profesional = await tokenDe(ROLES.PROFESIONAL);

    const delCliente = (await agregar(cliente, formato.id, 1).expect(201))
      .body as Carrito;
    expect(delCliente.items[0]).toMatchObject({
      bajoMinimo: false,
      impideCrearPedido: false,
    });
    expect(delCliente.puedeCrearPedido).toBe(true);

    const conDos = (await agregar(profesional, formato.id, 2).expect(201))
      .body as Carrito;
    expect(conDos.items[0]).toMatchObject({
      cantidad: 2,
      stockSuficiente: true,
      bajoMinimo: true,
      impideCrearPedido: true,
    });
    expect(conDos.puedeCrearPedido).toBe(false);

    const conTres = (await agregar(profesional, formato.id, 1).expect(201))
      .body as Carrito;
    expect(conTres.items[0]).toMatchObject({
      cantidad: 3,
      bajoMinimo: false,
      impideCrearPedido: false,
    });
    expect(conTres.puedeCrearPedido).toBe(true);
  });

  it('E5-H4 · cotizar sin cuenta no aplica el mínimo, aunque llegue un token de profesional', async () => {
    const formato = await nuevoFormato();
    await ponerStock(formato.id, 10);
    const profesional = await tokenDe(ROLES.PROFESIONAL);

    const respuesta = await servidor()
      .post('/api/carrito/cotizar')
      .auth(profesional, { type: 'bearer' })
      .send({ articulos: [{ articuloId: formato.id, cantidad: 1 }] })
      .expect(200);

    const carrito = respuesta.body as Carrito;
    expect(carrito.items[0]!.bajoMinimo).toBe(false);
    expect(carrito.puedeCrearPedido).toBe(true);
  });

  it('un producto exclusivo solo lo agrega el profesional', async () => {
    const exclusivo = await nuevoFormato(CANALES_VENTA.PROFESIONAL);
    await ponerStock(exclusivo.id, 10);
    const cliente = await tokenDe(ROLES.CLIENTE);
    const profesional = await tokenDe(ROLES.PROFESIONAL);

    await agregar(cliente, exclusivo.id, 1).expect(400);
    const respuesta = await agregar(profesional, exclusivo.id, 1).expect(201);

    expect((respuesta.body as Carrito).items[0]).toMatchObject({
      precioUnitario: precioConIva(8000, porcentajeIva),
      aLaVenta: true,
    });
    expect((await ver(cliente)).items).toEqual([]);
  });

  it('no se agregan artículos desactivados, sin precio, ni packs fuera de su vigencia', async () => {
    const desactivado = await nuevoFormato();
    const sinPrecio = await nuevoFormato();
    const vigente = await nuevoFormato();
    await Promise.all(
      [desactivado, sinPrecio, vigente].map((f) => ponerStock(f.id, 10)),
    );
    await prisma.articuloVenta.update({
      where: { id: desactivado.id },
      data: { activo: false },
    });
    await prisma.articuloVenta.update({
      where: { id: sinPrecio.id },
      data: { precioMinoristaNeto: null },
    });
    const vencido = await nuevoPack([{ formatoId: vigente.id, cantidad: 2 }], {
      fechaFinVigencia: diaDesdeHoy(-1),
    });
    const token = await tokenDe(ROLES.CLIENTE);

    for (const id of [desactivado.id, sinPrecio.id, vencido]) {
      await agregar(token, id, 1).expect(400);
    }
    expect((await ver(token)).items).toEqual([]);
  });

  it('un artículo que deja de venderse queda señalado, sin precio y fuera del total, y se puede quitar', async () => {
    const quedara = await nuevoFormato();
    const dejara = await nuevoFormato();
    await ponerStock(quedara.id, 5);
    await ponerStock(dejara.id, 5);
    const token = await tokenDe(ROLES.CLIENTE);
    await agregar(token, quedara.id, 1).expect(201);
    await agregar(token, dejara.id, 1).expect(201);
    await prisma.articuloVenta.update({
      where: { id: dejara.id },
      data: { activo: false },
    });

    const carrito = await ver(token);

    expect(carrito.items.find((i) => i.articuloId === dejara.id)).toMatchObject(
      {
        aLaVenta: false,
        precioUnitario: null,
        subtotal: null,
        stockSuficiente: null,
        impideCrearPedido: true,
      },
    );
    expect(carrito.total).toBe(precioConIva(10000, porcentajeIva));
    expect(carrito.puedeCrearPedido).toBe(false);
    await servidor()
      .patch(`${RUTA}/items/${dejara.id}`)
      .auth(token, { type: 'bearer' })
      .send({ cantidad: 2 })
      .expect(400);

    await servidor()
      .delete(`${RUTA}/items/${dejara.id}`)
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect((await ver(token)).puedeCrearPedido).toBe(true);
  });

  it('cada cuenta ve solo su carrito, y sin artículos responde vacío', async () => {
    const formato = await nuevoFormato();
    await ponerStock(formato.id, 5);
    const duena = await tokenDe(ROLES.CLIENTE);
    const otra = await tokenDe(ROLES.CLIENTE);
    await agregar(duena, formato.id, 1).expect(201);

    expect(await ver(otra)).toEqual({
      items: [],
      total: 0,
      puedeCrearPedido: false,
    });
    await servidor()
      .delete(`${RUTA}/items/${formato.id}`)
      .auth(otra, { type: 'bearer' })
      .expect(404);
    expect((await ver(duena)).items).toHaveLength(1);
  });

  it('sin sesión responde 401 y el personal de tienda 403 en todas las rutas', async () => {
    const peticiones = [
      () => servidor().get(RUTA),
      () => servidor().post(`${RUTA}/items`),
      () => servidor().patch(`${RUTA}/items/1`),
      () => servidor().delete(`${RUTA}/items/1`),
      () =>
        servidor()
          .post(`${RUTA}/unir`)
          .send({ articulos: [{ articuloId: 1, cantidad: 1 }] }),
    ];

    for (const peticion of peticiones) await peticion().expect(401);

    const vendedor = await tokenDe(ROLES.VENDEDOR);
    for (const peticion of peticiones) {
      await peticion().auth(vendedor, { type: 'bearer' }).expect(403);
    }
  });

  describe('E5-H2 · carrito del navegador', () => {
    const cotizar = (articulos: object[], token?: string) => {
      const peticion = servidor().post(`${RUTA}/cotizar`);
      if (token) peticion.auth(token, { type: 'bearer' });
      return peticion.send({ articulos });
    };

    const unir = (token: string, articulos: object[]) =>
      servidor()
        .post(`${RUTA}/unir`)
        .auth(token, { type: 'bearer' })
        .send({ articulos });

    it('E5-H2 · carrito sin sesión: devuelve precios y disponibilidad vigentes sin cuenta y no guarda un carrito', async () => {
      const formato = await nuevoFormato();
      const otro = await nuevoFormato();
      await ponerStock(formato.id, 2);
      await ponerStock(otro.id, 10);
      const pack = await nuevoPack([
        { formatoId: formato.id, cantidad: 1 },
        { formatoId: otro.id, cantidad: 1 },
      ]);
      const carritosAntes = await prisma.carrito.count();

      const respuesta = await cotizar([
        { articuloId: otro.id, cantidad: 3 },
        { articuloId: formato.id, cantidad: 3 },
        { articuloId: pack, cantidad: 1 },
      ]).expect(200);

      const unitario = precioConIva(10000, porcentajeIva);
      const precioPack = precioConIva(15000, porcentajeIva);
      const carrito = respuesta.body as Carrito;
      expect(carrito).toEqual({
        items: [
          expect.objectContaining({
            articuloId: otro.id,
            tipo: TIPOS_ARTICULO.FORMATO,
            nombreFormato: '300 ml',
            precioUnitario: unitario,
            subtotal: unitario * 3,
            aLaVenta: true,
            stockSuficiente: true,
            impideCrearPedido: false,
          }),
          expect.objectContaining({
            articuloId: formato.id,
            stockSuficiente: false,
            impideCrearPedido: true,
          }),
          expect.objectContaining({
            articuloId: pack,
            tipo: TIPOS_ARTICULO.PACK,
            precioUnitario: precioPack,
            stockSuficiente: true,
          }),
        ],
        total: unitario * 6 + precioPack,
        puedeCrearPedido: false,
      });
      expect(JSON.stringify(carrito)).not.toMatch(/mayorista|"stock":/i);
      expect(await prisma.carrito.count()).toBe(carritosAntes);
    });

    it('E5-H2 · sin cuenta un exclusivo, un desactivado o un id inexistente no se cotizan ni revelan sus datos; tampoco con token de profesional', async () => {
      const general = await nuevoFormato();
      const exclusivo = await nuevoFormato(CANALES_VENTA.PROFESIONAL);
      const desactivado = await nuevoFormato();
      await Promise.all(
        [general, exclusivo, desactivado].map((f) => ponerStock(f.id, 5)),
      );
      await prisma.articuloVenta.update({
        where: { id: desactivado.id },
        data: { activo: false },
      });
      const profesional = await tokenDe(ROLES.PROFESIONAL);

      const respuesta = await cotizar(
        [
          { articuloId: general.id, cantidad: 1 },
          { articuloId: exclusivo.id, cantidad: 1 },
          { articuloId: desactivado.id, cantidad: 1 },
          { articuloId: 2_000_000_000, cantidad: 1 },
        ],
        profesional,
      ).expect(200);

      const carrito = respuesta.body as Carrito;
      expect(carrito.items[0]!.precioUnitario).toBe(
        precioConIva(10000, porcentajeIva),
      );
      for (const linea of carrito.items.slice(1)) {
        expect(linea).toEqual(
          expect.objectContaining({
            tipo: null,
            nombre: '',
            nombreFormato: null,
            imagen: null,
            precioUnitario: null,
            aLaVenta: false,
            impideCrearPedido: true,
          }),
        );
      }
      expect(carrito.total).toBe(precioConIva(10000, porcentajeIva));
    });

    it('E5-H2 · la lista del navegador lleva de 1 a 50 artículos distintos con cantidades de 1 a 999', async () => {
      const malas = [
        [],
        [
          { articuloId: 1, cantidad: 1 },
          { articuloId: 1, cantidad: 1 },
        ],
        [{ articuloId: 1, cantidad: 1000 }],
        Array.from({ length: 51 }, (_, i) => ({
          articuloId: i + 1,
          cantidad: 1,
        })),
      ];
      const token = await tokenDe(ROLES.CLIENTE);

      for (const articulos of malas) {
        await cotizar(articulos).expect(400);
        await unir(token, articulos).expect(400);
      }
    });

    it('E5-H2 · unión al iniciar sesión: une el carrito del navegador al guardado de la cuenta, sumando lo repetido', async () => {
      const guardado = await nuevoFormato();
      const nuevo = await nuevoFormato();
      await ponerStock(guardado.id, 10);
      await ponerStock(nuevo.id, 10);
      const token = await tokenDe(ROLES.CLIENTE);
      await agregar(token, guardado.id, 2).expect(201);

      const respuesta = await unir(token, [
        { articuloId: nuevo.id, cantidad: 2 },
        { articuloId: guardado.id, cantidad: 3 },
      ]).expect(200);

      const unitario = precioConIva(10000, porcentajeIva);
      const esperado = {
        items: [
          expect.objectContaining({ articuloId: guardado.id, cantidad: 5 }),
          expect.objectContaining({ articuloId: nuevo.id, cantidad: 2 }),
        ],
        total: unitario * 7,
        puedeCrearPedido: true,
      };
      expect(respuesta.body).toMatchObject({ ...esperado, ajustes: [] });
      expect(await ver(token)).toMatchObject(esperado);
    });

    it('E5-H2 · una cuenta sin carrito guardado queda con el del navegador', async () => {
      const formato = await nuevoFormato();
      await ponerStock(formato.id, 5);
      const token = await tokenDe(ROLES.CLIENTE);

      await unir(token, [{ articuloId: formato.id, cantidad: 2 }]).expect(200);

      expect((await ver(token)).items).toEqual([
        expect.objectContaining({ articuloId: formato.id, cantidad: 2 }),
      ]);
    });

    it('E5-H2 · al unir se descarta lo agotado y lo que la tienda no vende a la cuenta; lo que supera el stock se une marcado, sin revelar cuántas hay', async () => {
      const escaso = await nuevoFormato();
      const agotado = await nuevoFormato();
      const exclusivo = await nuevoFormato(CANALES_VENTA.PROFESIONAL);
      await ponerStock(escaso.id, 3);
      await ponerStock(exclusivo.id, 5);
      const token = await tokenDe(ROLES.CLIENTE);

      const respuesta = await unir(token, [
        { articuloId: escaso.id, cantidad: 5 },
        { articuloId: agotado.id, cantidad: 1 },
        { articuloId: exclusivo.id, cantidad: 1 },
      ]).expect(200);

      const carrito = respuesta.body as Carrito & { ajustes: unknown[] };
      expect(carrito.items).toEqual([
        expect.objectContaining({
          articuloId: escaso.id,
          cantidad: 5,
          stockSuficiente: false,
          impideCrearPedido: true,
        }),
      ]);
      expect(carrito.ajustes).toEqual([
        { articuloId: agotado.id, motivo: 'agotado' },
        { articuloId: exclusivo.id, motivo: 'no_disponible' },
      ]);
      expect(carrito.puedeCrearPedido).toBe(false);
    });

    it(`E5-H2 · cotizar sin cuenta tiene un límite de ${LIMITES.COTIZAR_CARRITO.limit} peticiones por minuto por IP`, async () => {
      const formato = await nuevoFormato();
      await ponerStock(formato.id, 5);
      const articulos = [{ articuloId: formato.id, cantidad: 1 }];

      for (let i = 0; i < LIMITES.COTIZAR_CARRITO.limit; i++) {
        await cotizar(articulos).expect(200);
      }
      await cotizar(articulos).expect(429);
    });

    it('E5-H2 · el profesional une a precio mayorista y puede unir exclusivos', async () => {
      const exclusivo = await nuevoFormato(CANALES_VENTA.PROFESIONAL);
      await ponerStock(exclusivo.id, 5);
      const token = await tokenDe(ROLES.PROFESIONAL);

      const respuesta = await unir(token, [
        { articuloId: exclusivo.id, cantidad: 1 },
      ]).expect(200);

      expect((respuesta.body as Carrito).items[0]).toMatchObject({
        precioUnitario: precioConIva(8000, porcentajeIva),
        aLaVenta: true,
      });
    });

    it('E5-H4 · bajo el mínimo: unir deja la línea del profesional señalada', async () => {
      const formato = await nuevoFormato();
      await ponerStock(formato.id, 5);
      const token = await tokenDe(ROLES.PROFESIONAL);

      const respuesta = await unir(token, [
        { articuloId: formato.id, cantidad: 1 },
      ]).expect(200);

      const carrito = respuesta.body as Carrito;
      expect(carrito.items[0]).toMatchObject({
        bajoMinimo: true,
        impideCrearPedido: true,
      });
      expect(carrito.puedeCrearPedido).toBe(false);
    });

    it('E5-H4 · bajo el mínimo: cambiar la cantidad a menos de 3 se acepta y queda señalado', async () => {
      const formato = await nuevoFormato();
      await ponerStock(formato.id, 5);
      const token = await tokenDe(ROLES.PROFESIONAL);
      await agregar(token, formato.id, 3).expect(201);

      const respuesta = await servidor()
        .patch(`${RUTA}/items/${formato.id}`)
        .auth(token, { type: 'bearer' })
        .send({ cantidad: 2 })
        .expect(200);

      const carrito = respuesta.body as Carrito;
      expect(carrito.items[0]).toMatchObject({
        cantidad: 2,
        bajoMinimo: true,
        impideCrearPedido: true,
      });
      expect(carrito.puedeCrearPedido).toBe(false);
    });
  });
});
