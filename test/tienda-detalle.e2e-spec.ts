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
import { PrismaService } from '../src/prisma/prisma.service.js';
import { REDIS } from '../src/redis/redis.module.js';

// Requiere PostgreSQL y Redis levantados: `docker compose up -d db redis`.

const CONTRASENA = 'Secreta123';
const RUTA = '/api/tienda';
// Todo lo que crean estas pruebas lleva este prefijo, para borrarlo al terminar
const PREFIJO = 'E2E-detalle';
// Región y comuna de prueba (códigos que no usa el CUT ni otra prueba); se borran al terminar
const REGION = '95';
const COMUNA = '95001';

interface FormatoDetalle {
  id: number;
  imagenes: string[];
  precio: number | null;
  precioMayorista?: number;
  disponibilidad: string;
}

interface ProductoDetalle {
  id: number;
  exclusivo?: boolean;
  formatos: FormatoDetalle[];
}

interface PackDetalle {
  id: number;
  imagenes: string[];
  precio: number | null;
  precioMayorista?: number;
  disponibilidad: string;
}

/** AAAA-MM-DD desplazado `dias` desde hoy en Chile. */
const diaDesdeHoy = (dias: number) => {
  const fecha = new Date(`${hoyEnLaTienda()}T00:00:00Z`);
  fecha.setUTCDate(fecha.getUTCDate() + dias);
  return new Date(`${fecha.toISOString().slice(0, 10)}T00:00:00Z`);
};

describe('Tienda · detalle de un producto (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: Redis;
  let hashContrasena: string;
  let porcentajeIva: number;
  let categoriaId: number;
  /** Ubicación de una bodega que abastece la venta online. */
  let ubicacionOnline: number;
  /** Ubicación de una bodega que no abastece la venta online. */
  let ubicacionLocal: number;
  const correosCreados: string[] = [];

  const unico = () => randomUUID().slice(0, 8);

  const tokenDe = async (rol: Rol) => {
    const email = `e2e-detalle-${randomUUID()}@prueba.cl`;
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

  /** Artículo con sus precios y dos imágenes (la principal se sube segunda, para probar el orden). */
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
    await prisma.imagenArticulo.createMany({
      data: [
        {
          articuloId: articulo.id,
          ubicacionArchivo: `articulos/${articulo.id}/reverso.jpg`,
          orden: 1,
          esPrincipal: false,
        },
        {
          articuloId: articulo.id,
          ubicacionArchivo: `articulos/${articulo.id}/principal.jpg`,
          orden: 2,
          esPrincipal: true,
        },
      ],
    });
    return articulo.id;
  };

  /** Producto con `formatos` formatos a la venta; devuelve su id y los de sus formatos. */
  const nuevoProducto = async (
    canalVenta: string = CANALES_VENTA.GENERAL,
    formatos = 1,
  ) => {
    const producto = await prisma.producto.create({
      data: {
        nombre: `${PREFIJO} Shampoo ${unico()}`,
        descripcion: 'Repara el cabello.',
        origenDescripcion: ORIGENES_DESCRIPCION.MANUAL,
        canalVenta,
        categoriaId,
      },
    });
    const ids: number[] = [];
    for (let i = 0; i < formatos; i++) {
      const id = await nuevoArticulo(TIPOS_ARTICULO.FORMATO, {
        minorista: canalVenta === CANALES_VENTA.GENERAL ? 10000 : null,
        mayorista: 8000,
      });
      await prisma.formatoProducto.create({
        data: {
          id,
          productoId: producto.id,
          nombreFormato: `${300 + i} ml`,
          pesoGramos: 320,
          altoCm: 18,
          anchoCm: 6,
          largoCm: 6,
          esPredeterminado: i === 0,
        },
      });
      ids.push(id);
    }
    return { id: producto.id, formatos: ids };
  };

  const nuevoPack = async (
    componentes: { formatoId: number; cantidad: number }[],
    extra: { canalVenta?: string; fechaFinVigencia?: Date } = {},
  ) => {
    const canalVenta = extra.canalVenta ?? CANALES_VENTA.GENERAL;
    const id = await nuevoArticulo(TIPOS_ARTICULO.PACK, {
      minorista: canalVenta === CANALES_VENTA.GENERAL ? 15000 : null,
      mayorista: 12000,
    });
    await prisma.pack.create({
      data: {
        id,
        nombre: `${PREFIJO} Dúo ${unico()}`,
        descripcion: 'Shampoo y acondicionador.',
        canalVenta,
        fechaFinVigencia: extra.fechaFinVigencia,
        componentes: { create: componentes },
      },
    });
    return id;
  };

  const ponerStock = (
    formatoId: number,
    cantidad: number,
    ubicacionId = ubicacionOnline,
  ) =>
    prisma.existencia.upsert({
      where: { formatoId_ubicacionId: { formatoId, ubicacionId } },
      update: { cantidad },
      create: { formatoId, ubicacionId, cantidad },
    });

  const detalle = (ruta: string, con?: string) => {
    const pedido = request(app.getHttpServer()).get(`${RUTA}/${ruta}`);
    if (con) pedido.auth(con, { type: 'bearer' });
    return pedido;
  };

  const limpiar = async () => {
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
    await prisma.marca.deleteMany({
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
      create: { codigoCut: REGION, nombre: 'Región de prueba detalle' },
    });
    await prisma.comuna.upsert({
      where: { codigoCut: COMUNA },
      update: {},
      create: {
        codigoCut: COMUNA,
        nombre: 'Comuna de prueba detalle',
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
    const bodegaDe = async (nombre: string, abasteceVentaOnline: boolean) => {
      const bodega = await prisma.bodega.create({
        data: {
          nombre: `${PREFIJO} ${nombre}`,
          direccion: 'Calle de prueba 300',
          tipo: 'tienda',
          comunaId: comuna.id,
          abasteceVentaOnline,
        },
      });
      return (
        await prisma.ubicacion.create({
          data: { bodegaId: bodega.id, codigo: 'GONDOLA-1' },
        })
      ).id;
    };
    ubicacionOnline = await bodegaDe('Central', true);
    ubicacionLocal = await bodegaDe('Peluquería', false);
    categoriaId = (
      await prisma.categoria.create({
        data: { nombre: `${PREFIJO} Cat ${unico()}` },
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

  it('E2-H3 · formato con stock: devuelve sus imágenes, el precio con IVA incluido y disponible', async () => {
    const producto = await nuevoProducto();
    const [formatoId] = producto.formatos;
    await ponerStock(formatoId!, 5);

    const respuesta = await detalle(`productos/${producto.id}`).expect(200);

    const { formatos } = respuesta.body as ProductoDetalle;
    expect(formatos).toHaveLength(1);
    expect(formatos[0]).toMatchObject({
      id: formatoId,
      precio: precioConIva(10000, porcentajeIva),
      disponibilidad: 'disponible',
    });
    // La principal primero, aunque se subió segunda
    expect(formatos[0]!.imagenes).toHaveLength(2);
    expect(formatos[0]!.imagenes[0]).toContain(
      `articulos/${formatoId}/principal.jpg`,
    );
    expect(formatos[0]).not.toHaveProperty('precioMayorista');
  });

  it('E2-H3 · formato sin stock: lo devuelve como agotado, aunque haya stock fuera de la venta online', async () => {
    const producto = await nuevoProducto(CANALES_VENTA.GENERAL, 3);
    const [conStock, enBodegaLocal, enUbicacionInactiva] = producto.formatos;
    await ponerStock(conStock!, 2);
    // Stock en una bodega que no abastece la venta online
    await ponerStock(enBodegaLocal!, 20, ubicacionLocal);
    // Stock en una ubicación desactivada de la bodega online
    const inactiva = await prisma.ubicacion.create({
      data: {
        bodegaId: (
          await prisma.ubicacion.findUniqueOrThrow({
            where: { id: ubicacionOnline },
          })
        ).bodegaId,
        codigo: 'GONDOLA-2',
        activa: false,
      },
    });
    await ponerStock(enUbicacionInactiva!, 20, inactiva.id);

    const respuesta = await detalle(`productos/${producto.id}`).expect(200);

    const disponibilidades = Object.fromEntries(
      (respuesta.body as ProductoDetalle).formatos.map((f) => [
        f.id,
        f.disponibilidad,
      ]),
    );
    expect(disponibilidades).toEqual({
      [conStock!]: 'disponible',
      [enBodegaLocal!]: 'agotado',
      [enUbicacionInactiva!]: 'agotado',
    });
  });

  it('E2-H3 · formato sin stock: al agotarse pasa a agotado y la bodega desactivada no cuenta', async () => {
    const producto = await nuevoProducto();
    const [formatoId] = producto.formatos;
    await ponerStock(formatoId!, 1);
    const disponibilidadActual = async () =>
      (
        (await detalle(`productos/${producto.id}`).expect(200))
          .body as ProductoDetalle
      ).formatos[0]!.disponibilidad;

    expect(await disponibilidadActual()).toBe('disponible');
    await ponerStock(formatoId!, 0);
    expect(await disponibilidadActual()).toBe('agotado');

    await ponerStock(formatoId!, 5);
    await prisma.bodega.updateMany({
      where: { ubicaciones: { some: { id: ubicacionOnline } } },
      data: { activa: false },
    });
    expect(await disponibilidadActual()).toBe('agotado');
  });

  it('E2-H3 · disponibilidad de un pack: es la de su componente más escaso', async () => {
    const shampoo = (await nuevoProducto()).formatos[0]!;
    const acondicionador = (await nuevoProducto()).formatos[0]!;
    const packId = await nuevoPack([
      { formatoId: shampoo, cantidad: 1 },
      { formatoId: acondicionador, cantidad: 2 },
    ]);
    await ponerStock(shampoo, 50);
    // El pack lleva 2 acondicionadores y solo hay 1
    await ponerStock(acondicionador, 1);

    const agotado = await detalle(`packs/${packId}`).expect(200);
    expect(agotado.body as PackDetalle).toMatchObject({
      id: packId,
      precio: precioConIva(15000, porcentajeIva),
      disponibilidad: 'agotado',
    });
    expect((agotado.body as PackDetalle).imagenes[0]).toContain(
      `articulos/${packId}/principal.jpg`,
    );

    await ponerStock(acondicionador, 2);
    const disponible = await detalle(`packs/${packId}`).expect(200);
    expect((disponible.body as PackDetalle).disponibilidad).toBe('disponible');
  });

  it('E2-H3 · un producto exclusivo solo lo ve el profesional, con el mayorista y sin el minorista (RNF-04)', async () => {
    const producto = await nuevoProducto(CANALES_VENTA.PROFESIONAL);
    const cliente = await tokenDe(ROLES.CLIENTE);
    const profesional = await tokenDe(ROLES.PROFESIONAL);

    await detalle(`productos/${producto.id}`).expect(404);
    await detalle(`productos/${producto.id}`, cliente).expect(404);
    const respuesta = await detalle(
      `productos/${producto.id}`,
      profesional,
    ).expect(200);
    expect(respuesta.body as ProductoDetalle).toMatchObject({
      exclusivo: true,
    });
    expect((respuesta.body as ProductoDetalle).formatos[0]).toMatchObject({
      precio: null,
      precioMayorista: precioConIva(8000, porcentajeIva),
    });
  });

  it('E2-H3 · el cliente no recibe el precio mayorista de un producto ni de un pack (RNF-04)', async () => {
    const producto = await nuevoProducto();
    const packId = await nuevoPack([
      { formatoId: producto.formatos[0]!, cantidad: 2 },
    ]);
    const cliente = await tokenDe(ROLES.CLIENTE);

    const deProducto = await detalle(
      `productos/${producto.id}`,
      cliente,
    ).expect(200);
    const dePack = await detalle(`packs/${packId}`, cliente).expect(200);
    expect(JSON.stringify(deProducto.body)).not.toContain('Mayorista');
    expect(JSON.stringify(dePack.body)).not.toContain('Mayorista');
    expect(deProducto.body).not.toHaveProperty('exclusivo');
  });

  it('E2-H3 · un pack fuera de vigencia o exclusivo no se muestra a quien no corresponde: 404', async () => {
    const formatoId = (await nuevoProducto()).formatos[0]!;
    const vencido = await nuevoPack([{ formatoId, cantidad: 2 }], {
      fechaFinVigencia: diaDesdeHoy(-1),
    });
    const exclusivo = await nuevoPack([{ formatoId, cantidad: 2 }], {
      canalVenta: CANALES_VENTA.PROFESIONAL,
    });
    const profesional = await tokenDe(ROLES.PROFESIONAL);

    await detalle(`packs/${vencido}`).expect(404);
    await detalle(`packs/${vencido}`, profesional).expect(404);
    await detalle(`packs/${exclusivo}`).expect(404);
    const visto = await detalle(`packs/${exclusivo}`, profesional).expect(200);
    expect(visto.body as PackDetalle).toMatchObject({
      precio: null,
      precioMayorista: precioConIva(12000, porcentajeIva),
    });
  });

  it('E2-H3 · producto inactivo, inexistente o id inválido: 404; un pack no es un producto', async () => {
    const producto = await nuevoProducto();
    const packId = await nuevoPack([
      { formatoId: producto.formatos[0]!, cantidad: 2 },
    ]);
    await prisma.producto.update({
      where: { id: producto.id },
      data: { activo: false },
    });

    await detalle(`productos/${producto.id}`).expect(404);
    await detalle(`productos/${packId}`).expect(404);
    await detalle('productos/abc').expect(404);
    await detalle('packs/0').expect(404);
  });

  it('E2-H3 · producto de una marca desactivada, o pack con un componente que pasó a exclusivo: 404', async () => {
    const producto = await nuevoProducto();
    const packId = await nuevoPack([
      { formatoId: producto.formatos[0]!, cantidad: 2 },
    ]);
    const marca = await prisma.marca.create({
      data: { nombre: `${PREFIJO} Marca ${unico()}` },
    });
    await prisma.producto.update({
      where: { id: producto.id },
      data: { marcaId: marca.id },
    });
    await detalle(`productos/${producto.id}`).expect(200);

    await prisma.marca.update({
      where: { id: marca.id },
      data: { activa: false },
    });
    await detalle(`productos/${producto.id}`).expect(404);

    await prisma.marca.update({
      where: { id: marca.id },
      data: { activa: true },
    });
    await detalle(`packs/${packId}`).expect(200);
    await prisma.producto.update({
      where: { id: producto.id },
      data: { canalVenta: CANALES_VENTA.PROFESIONAL },
    });
    await detalle(`packs/${packId}`).expect(404);
  });

  it('E2-H3 · con un token inválido responde 401, no se trata como visitante', async () => {
    const producto = await nuevoProducto();

    await detalle(`productos/${producto.id}`, 'no-es-un-token').expect(401);
    await detalle(`packs/${producto.formatos[0]}`, 'no-es-un-token').expect(
      401,
    );
  });
});
