import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import argon2 from 'argon2';
import type { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { calcularMontos } from '../src/common/dominio/montos.js';
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
// Todo lo que crean estas pruebas lleva este prefijo, para borrarlo al terminar
const PREFIJO = 'E2E-precios';

interface CambioRespuesta {
  id: number;
  tipoPrecio: string;
  precioNeto: number;
  fechaInicioVigencia: string;
  fechaFinVigencia: string | null;
  motivo: string | null;
  fijadoPor: { codigoPublico: string; nombre: string; apellido: string };
}

interface PreciosRespuesta {
  articuloId: number;
  exclusivo: boolean;
  precioMinoristaNeto: number | null;
  precioMayoristaNeto: number | null;
  historial: CambioRespuesta[];
}

describe('Catálogo · precios minorista y mayorista (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: Redis;
  let hashContrasena: string;
  let porcentajeIva: number;
  let categoriaId: number;
  let token: string;
  const correosCreados: string[] = [];

  const unico = () => randomUUID().slice(0, 8);

  /** Crea una cuenta con ese rol, inicia sesión y devuelve su código público y su token. */
  const cuentaDe = async (rol: Rol) => {
    const email = `e2e-precios-${randomUUID()}@prueba.cl`;
    correosCreados.push(email);
    const codigoPublico = randomUUID();
    await prisma.usuario.create({
      data: {
        codigoPublico,
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
    return {
      codigoPublico,
      token: (respuesta.body as { tokenAcceso: string }).tokenAcceso,
    };
  };

  /** Formato sin precios, con una imagen, de un producto nuevo del canal indicado. */
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
    await prisma.imagenArticulo.create({
      data: {
        articuloId: articulo.id,
        ubicacionArchivo: `articulos/${articulo.id}/principal.jpg`,
        orden: 1,
        esPrincipal: true,
      },
    });
    return { productoId: producto.id, articuloId: articulo.id };
  };

  const fijar = (id: number | string, cuerpo: object, con = token) =>
    request(app.getHttpServer())
      .put(`/api/catalogo/articulos/${id}/precios`)
      .auth(con, { type: 'bearer' })
      .send(cuerpo);

  const ver = (id: number | string, con = token) =>
    request(app.getHttpServer())
      .get(`/api/catalogo/articulos/${id}/precios`)
      .auth(con, { type: 'bearer' });

  const mensajeDe = (cuerpo: unknown) =>
    (cuerpo as { message: string | string[] }).message;

  const limpiar = async () => {
    // El formato, las imágenes y el historial se borran en cascada con su artículo
    await prisma.articuloVenta.deleteMany({
      where: { sku: { startsWith: PREFIJO } },
    });
    await prisma.producto.deleteMany({
      where: { nombre: { startsWith: PREFIJO } },
    });
    await prisma.categoria.deleteMany({
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
  });

  beforeEach(async () => {
    const claves = await redis.keys('limite:*');
    if (claves.length) await redis.del(...claves);
    await limpiar();
    categoriaId = (
      await prisma.categoria.create({
        data: { nombre: `${PREFIJO} Cat ${unico()}` },
      })
    ).id;
    ({ token } = await cuentaDe(ROLES.ADMINISTRADOR));
  });

  afterAll(async () => {
    // El historial apunta a la cuenta que fijó el precio: primero los artículos
    await limpiar();
    await prisma.usuario.deleteMany({
      where: { email: { in: correosCreados } },
    });
    await app.close();
  });

  it('E3-H5 · cambio de precio: aplica el nuevo neto y guarda en el historial su vigencia, quién lo fijó y el motivo', async () => {
    const { articuloId } = await nuevoFormato();
    await fijar(articuloId, {
      precioMinoristaNeto: 10000,
      precioMayoristaNeto: 8000,
      motivo: 'Precios iniciales',
    }).expect(200);

    const respuesta = await fijar(articuloId, {
      precioMinoristaNeto: 10500.5,
      motivo: '  Alza del proveedor  ',
    }).expect(200);

    const precios = respuesta.body as PreciosRespuesta;
    expect(precios).toMatchObject({
      articuloId,
      exclusivo: false,
      precioMinoristaNeto: 10500.5,
      precioMayoristaNeto: 8000,
    });
    const fijadoPor = {
      nombre: 'Marcela',
      apellido: 'Soto',
    };
    const [nuevo, mayorista, anterior] = [
      precios.historial.find(
        (c) => c.tipoPrecio === 'minorista' && c.fechaFinVigencia === null,
      )!,
      precios.historial.find((c) => c.tipoPrecio === 'mayorista')!,
      precios.historial.find(
        (c) => c.tipoPrecio === 'minorista' && c.fechaFinVigencia !== null,
      )!,
    ];
    expect(precios.historial).toHaveLength(3);
    expect(nuevo).toMatchObject({
      precioNeto: 10500.5,
      motivo: 'Alza del proveedor',
      fijadoPor,
    });
    expect(anterior).toMatchObject({
      precioNeto: 10000,
      motivo: 'Precios iniciales',
      fijadoPor,
    });
    // La vigencia del anterior termina cuando empieza la del nuevo
    expect(anterior.fechaFinVigencia).toBe(nuevo.fechaInicioVigencia);
    expect(mayorista).toMatchObject({
      precioNeto: 8000,
      fechaFinVigencia: null,
    });
    expect(precios.historial[0]).toEqual(nuevo);

    const articulo = await prisma.articuloVenta.findUniqueOrThrow({
      where: { id: articuloId },
    });
    expect(Number(articulo.precioMinoristaNeto)).toBe(10500.5);
    expect((await ver(articuloId).expect(200)).body).toEqual(precios);
  });

  it('E3-H5 · cambio de precio: un precio igual al vigente no se registra', async () => {
    const { articuloId } = await nuevoFormato();
    await fijar(articuloId, {
      precioMinoristaNeto: 10000,
      precioMayoristaNeto: 8000,
      motivo: 'Precios iniciales',
    }).expect(200);

    const respuesta = await fijar(articuloId, {
      precioMinoristaNeto: 10000,
      precioMayoristaNeto: 8000,
      motivo: 'Sin cambio',
    }).expect(200);

    expect((respuesta.body as PreciosRespuesta).historial).toHaveLength(2);
  });

  it('E3-H5 · cambio de precio: sin precio, sin motivo o con un neto inválido responde 400', async () => {
    const { articuloId } = await nuevoFormato();

    const sinPrecio = await fijar(articuloId, { motivo: 'Alza' }).expect(400);
    expect(mensajeDe(sinPrecio.body)).toBe(
      'Indica el precio minorista, el mayorista o ambos.',
    );
    const sinMotivo = await fijar(articuloId, {
      precioMinoristaNeto: 1000,
    }).expect(400);
    expect(mensajeDe(sinMotivo.body)).toEqual(['El motivo es obligatorio.']);
    await fijar(articuloId, {
      precioMinoristaNeto: 10.123,
      motivo: 'Alza',
    }).expect(400);
    await fijar(articuloId, {
      precioMinoristaNeto: 1000,
      motivo: 'Alza',
      tipoPrecio: 'minorista',
    }).expect(400);
    expect(await prisma.historialPrecio.count({ where: { articuloId } })).toBe(
      0,
    );
  });

  it('E3-H5 · artículo exclusivo para profesionales: exige solo el precio mayorista y rechaza el minorista', async () => {
    const { articuloId } = await nuevoFormato(CANALES_VENTA.PROFESIONAL);

    const rechazo = await fijar(articuloId, {
      precioMinoristaNeto: 9000,
      precioMayoristaNeto: 7000,
      motivo: 'Precio inicial',
    }).expect(400);
    expect(mensajeDe(rechazo.body)).toMatch(/exclusivo para profesionales/);

    const respuesta = await fijar(articuloId, {
      precioMayoristaNeto: 7000,
      motivo: 'Precio inicial',
    }).expect(200);
    expect(respuesta.body).toMatchObject({
      exclusivo: true,
      precioMinoristaNeto: null,
      precioMayoristaNeto: 7000,
    });
  });

  it('E3-H5 · precio guardado en neto: la tienda lo devuelve con el IVA incluido, calculado a partir del neto', async () => {
    const { productoId, articuloId } = await nuevoFormato();

    await fijar(articuloId, {
      precioMinoristaNeto: 8403.36,
      precioMayoristaNeto: 6722.69,
      motivo: 'Precios iniciales',
    }).expect(200);

    const articulo = await prisma.articuloVenta.findUniqueOrThrow({
      where: { id: articuloId },
    });
    expect(articulo.precioMinoristaNeto?.toString()).toBe('8403.36');
    const tienda = await request(app.getHttpServer())
      .get('/api/tienda/productos')
      .query({ categoriaId })
      .expect(200);
    const producto = (
      tienda.body as { items: { id: number; precio: number }[] }
    ).items.find((item) => item.id === productoId);
    expect(producto?.precio).toBe(calcularMontos(8403, porcentajeIva).total);
    expect(JSON.stringify(tienda.body)).not.toContain('6722');
  });

  it('E3-H5 · solo con el permiso de precios: el vendedor y el bodeguero reciben 403 y sin sesión 401', async () => {
    const { articuloId } = await nuevoFormato();
    const cuerpo = { precioMinoristaNeto: 1000, motivo: 'Alza' };

    for (const rol of [ROLES.VENDEDOR, ROLES.BODEGUERO, ROLES.CLIENTE]) {
      const { token: otro } = await cuentaDe(rol);
      await fijar(articuloId, cuerpo, otro).expect(403);
      await ver(articuloId, otro).expect(403);
    }
    await request(app.getHttpServer())
      .put(`/api/catalogo/articulos/${articuloId}/precios`)
      .send(cuerpo)
      .expect(401);
    await request(app.getHttpServer())
      .get(`/api/catalogo/articulos/${articuloId}/precios`)
      .expect(401);
    expect(await prisma.historialPrecio.count({ where: { articuloId } })).toBe(
      0,
    );
  });

  it('E3-H5 · artículo inexistente: responde 404', async () => {
    const cuerpo = { precioMinoristaNeto: 1000, motivo: 'Alza' };

    await fijar(2_147_483_000, cuerpo).expect(404);
    await fijar('abc', cuerpo).expect(404);
    await ver(2_147_483_000).expect(404);
  });

  it('E3-H5 · artículo exclusivo para profesionales: al pasar a exclusivo el minorista queda guardado y vuelve a regir si deja de serlo (decisión del 24 oct)', async () => {
    const { productoId, articuloId } = await nuevoFormato();
    await fijar(articuloId, {
      precioMinoristaNeto: 10000,
      precioMayoristaNeto: 8000,
      motivo: 'Precios iniciales',
    }).expect(200);
    const cambiarCanal = (canalVenta: string) =>
      request(app.getHttpServer())
        .patch(`/api/catalogo/productos/${productoId}`)
        .auth(token, { type: 'bearer' })
        .send({ canalVenta })
        .expect(200);
    const enTienda = async () => {
      const tienda = await request(app.getHttpServer())
        .get('/api/tienda/productos')
        .query({ categoriaId })
        .expect(200);
      return (
        tienda.body as { items: { id: number; precio: number }[] }
      ).items.find((item) => item.id === productoId);
    };

    await cambiarCanal(CANALES_VENTA.PROFESIONAL);

    const exclusivo = (await ver(articuloId).expect(200))
      .body as PreciosRespuesta;
    expect(exclusivo).toMatchObject({
      exclusivo: true,
      precioMinoristaNeto: 10000,
      precioMayoristaNeto: 8000,
    });
    // Mientras es exclusivo no se cambia su minorista ni se muestra a todo público
    await fijar(articuloId, {
      precioMinoristaNeto: 11000,
      motivo: 'Alza',
    }).expect(400);
    expect(await enTienda()).toBeUndefined();

    await cambiarCanal(CANALES_VENTA.GENERAL);

    expect((await enTienda())?.precio).toBe(
      calcularMontos(10000, porcentajeIva).total,
    );
  });
});
