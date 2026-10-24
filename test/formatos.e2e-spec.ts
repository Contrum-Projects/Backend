import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import argon2 from 'argon2';
import type { Redis } from 'ioredis';
import { randomInt, randomUUID } from 'node:crypto';
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
import { PrismaService } from '../src/prisma/prisma.service.js';
import { REDIS } from '../src/redis/redis.module.js';

// Requiere PostgreSQL y Redis levantados: `docker compose up -d db redis`.

const CONTRASENA = 'Secreta123';
// Todo lo que crean estas pruebas lleva este prefijo, para borrarlo al terminar
const PREFIJO = 'E2E-formatos';

interface FormatoRespuesta {
  id: number;
  productoId: number;
  sku: string;
  codigoBarras: string | null;
  nombreFormato: string;
  contenido: number | null;
  unidadMedida: string | null;
  fechaVencimiento: string | null;
  stockMinimo: number;
  pesoGramos: number;
  altoCm: number;
  anchoCm: number;
  largoCm: number;
  esPredeterminado: boolean;
  activo: boolean;
  imagenes: unknown[];
}

describe('Catálogo · formatos de venta (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: Redis;
  let hashContrasena: string;
  let categoriaId: number;
  let marcaId: number;
  let productoId: number;
  let token: string;
  const correosCreados: string[] = [];

  /** Crea una cuenta con ese rol, inicia sesión y devuelve su token de acceso. */
  const tokenDe = async (rol: Rol) => {
    const email = `e2e-formatos-${randomUUID()}@prueba.cl`;
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

  const unico = () => randomUUID().slice(0, 8);
  /** Código de barras EAN-13 al azar que empieza con 99, para no chocar con datos reales. */
  const codigoUnico = () =>
    `99${String(randomInt(0, 99_999_999_999)).padStart(11, '0')}`;

  const datosValidos = (extra: object = {}) => ({
    sku: `${PREFIJO}-${unico()}`,
    codigoBarras: codigoUnico(),
    nombreFormato: '300 ml',
    contenido: 300,
    unidadMedida: 'ml',
    stockMinimo: 5,
    pesoGramos: 320,
    altoCm: 18.5,
    anchoCm: 6,
    largoCm: 4.25,
    ...extra,
  });

  const crear = (
    cuerpo: object,
    id: number | string = productoId,
    con = token,
  ) =>
    request(app.getHttpServer())
      .post(`/api/catalogo/productos/${id}/formatos`)
      .auth(con, { type: 'bearer' })
      .send(cuerpo);

  const editar = (id: number | string, cuerpo: object) =>
    request(app.getHttpServer())
      .patch(`/api/catalogo/formatos/${id}`)
      .auth(token, { type: 'bearer' })
      .send(cuerpo);

  const listar = async (id = productoId) => {
    const respuesta = await request(app.getHttpServer())
      .get(`/api/catalogo/productos/${id}/formatos`)
      .auth(token, { type: 'bearer' })
      .expect(200);
    return respuesta.body as FormatoRespuesta[];
  };

  /** Crea un formato por la API y devuelve su respuesta. */
  const nuevo = async (extra: object = {}) => {
    const respuesta = await crear(datosValidos(extra)).expect(201);
    return respuesta.body as FormatoRespuesta;
  };

  const mensajeDe = (cuerpo: unknown) =>
    (cuerpo as { message: string | string[] }).message;

  const limpiar = async () => {
    // El formato se borra en cascada con su artículo
    await prisma.articuloVenta.deleteMany({
      where: { sku: { startsWith: PREFIJO } },
    });
    await prisma.producto.deleteMany({
      where: { nombre: { startsWith: PREFIJO } },
    });
    await prisma.marca.deleteMany({
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
    marcaId = (
      await prisma.marca.create({
        data: { nombre: `${PREFIJO} Marca ${unico()}` },
      })
    ).id;
    productoId = (
      await prisma.producto.create({
        data: {
          nombre: `${PREFIJO} Shampoo ${unico()}`,
          descripcion: 'Repara el cabello.',
          origenDescripcion: ORIGENES_DESCRIPCION.MANUAL,
          canalVenta: CANALES_VENTA.GENERAL,
          categoriaId,
          marcaId,
        },
      })
    ).id;
    token = await tokenDe(ROLES.VENDEDOR);
  });

  afterAll(async () => {
    await limpiar();
    await prisma.usuario.deleteMany({
      where: { email: { in: correosCreados } },
    });
    await app.close();
  });

  describe('crear', () => {
    it('E3-H2 · formato creado: la API lo agrega al producto con sus datos, activo y sin precios', async () => {
      const cuerpo = datosValidos();

      const creado = await nuevo(cuerpo);

      expect(creado).toEqual({
        id: expect.any(Number) as number,
        productoId,
        sku: cuerpo.sku,
        codigoBarras: cuerpo.codigoBarras,
        nombreFormato: '300 ml',
        contenido: 300,
        unidadMedida: 'ml',
        fechaVencimiento: null,
        stockMinimo: 5,
        pesoGramos: 320,
        altoCm: 18.5,
        anchoCm: 6,
        largoCm: 4.25,
        esPredeterminado: true,
        activo: true,
        imagenes: [],
      });
      const articulo = await prisma.articuloVenta.findUniqueOrThrow({
        where: { id: creado.id },
        include: { formato: true },
      });
      expect(articulo).toMatchObject({
        tipo: 'formato',
        precioMinoristaNeto: null,
        precioMayoristaNeto: null,
        formato: { productoId },
      });
      expect(await listar()).toEqual([creado]);
    });

    it('E3-H2 · formato creado: el administrador también puede; el bodeguero no (403) y sin sesión 401', async () => {
      const admin = await tokenDe(ROLES.ADMINISTRADOR);
      await crear(datosValidos(), productoId, admin).expect(201);

      const bodeguero = await tokenDe(ROLES.BODEGUERO);
      await crear(datosValidos(), productoId, bodeguero).expect(403);

      await request(app.getHttpServer())
        .post(`/api/catalogo/productos/${productoId}/formatos`)
        .send(datosValidos())
        .expect(401);
      await request(app.getHttpServer())
        .patch('/api/catalogo/formatos/1')
        .auth(bodeguero, { type: 'bearer' })
        .send({ nombreFormato: 'X' })
        .expect(403);
      await request(app.getHttpServer())
        .patch('/api/catalogo/formatos/1')
        .send({ nombreFormato: 'X' })
        .expect(401);
      await request(app.getHttpServer())
        .get(`/api/catalogo/productos/${productoId}/formatos`)
        .auth(bodeguero, { type: 'bearer' })
        .expect(403);
      await request(app.getHttpServer())
        .get(`/api/catalogo/productos/${productoId}/formatos`)
        .expect(401);
      // Cliente y profesional no tienen permisos del panel
      const cliente = await tokenDe(ROLES.CLIENTE);
      await crear(datosValidos(), productoId, cliente).expect(403);
    });

    it('E3-H2 · producto inexistente o id inválido: responde 404', async () => {
      await crear(datosValidos(), 2_000_000_000).expect(404);
      await crear(datosValidos(), 'abc').expect(404);
    });

    it('E3-H2 · datos inválidos: responde 400 con los mensajes en español y no guarda nada', async () => {
      const respuesta = await crear(
        datosValidos({ sku: '', pesoGramos: 0, unidadMedida: undefined }),
      ).expect(400);

      expect(mensajeDe(respuesta.body)).toEqual(
        expect.arrayContaining([
          'El SKU es obligatorio.',
          expect.stringContaining('El peso debe ser') as string,
        ]),
      );
      expect(await listar()).toHaveLength(0);
    });
  });

  describe('datos repetidos', () => {
    it('E3-H2 · SKU repetido: rechaza el formato con 409 e indica el SKU', async () => {
      const primero = await nuevo();

      const respuesta = await crear(datosValidos({ sku: primero.sku })).expect(
        409,
      );

      expect(mensajeDe(respuesta.body)).toBe(
        'El SKU ya pertenece a otro artículo.',
      );
      expect(await listar()).toHaveLength(1);
    });

    it('E3-H2 · código de barras repetido: rechaza el formato con 409 e indica el código de barras', async () => {
      const primero = await nuevo();

      const respuesta = await crear(
        datosValidos({ codigoBarras: primero.codigoBarras }),
      ).expect(409);

      expect(mensajeDe(respuesta.body)).toBe(
        'El código de barras ya pertenece a otro artículo.',
      );
    });

    it('E3-H2 · SKU de un pack: también lo rechaza', async () => {
      const sku = `${PREFIJO}-pack-${unico()}`;
      await prisma.articuloVenta.create({
        data: {
          sku,
          tipo: TIPOS_ARTICULO.PACK,
          pack: {
            create: {
              nombre: `${PREFIJO} Pack`,
              descripcion: 'Pack de prueba.',
              canalVenta: CANALES_VENTA.GENERAL,
            },
          },
        },
      });

      const respuesta = await crear(datosValidos({ sku })).expect(409);

      expect(mensajeDe(respuesta.body)).toBe(
        'El SKU ya pertenece a otro artículo.',
      );
    });

    it('E3-H2 · SKU de un artículo de otro producto: también lo rechaza', async () => {
      const otroProducto = await prisma.producto.create({
        data: {
          nombre: `${PREFIJO} Acondicionador ${unico()}`,
          descripcion: 'Suaviza.',
          origenDescripcion: ORIGENES_DESCRIPCION.MANUAL,
          canalVenta: CANALES_VENTA.GENERAL,
          categoriaId,
          marcaId,
        },
      });
      const ajeno = (await crear(datosValidos(), otroProducto.id).expect(201))
        .body as FormatoRespuesta;

      await crear(datosValidos({ sku: ajeno.sku })).expect(409);
    });

    it('E3-H2 · SKU repetido al editar: responde 409 y el formato no cambia', async () => {
      const primero = await nuevo();
      const segundo = await nuevo();

      const respuesta = await editar(segundo.id, {
        sku: primero.sku,
        nombreFormato: 'Cambiado',
      }).expect(409);

      expect(mensajeDe(respuesta.body)).toBe(
        'El SKU ya pertenece a otro artículo.',
      );
      const [, enBase] = await listar();
      expect(enBase).toMatchObject({
        sku: segundo.sku,
        nombreFormato: '300 ml',
      });
      // Volver a guardar su propio SKU no choca consigo mismo
      await editar(segundo.id, { sku: segundo.sku }).expect(200);
    });

    it('E3-H2 · dos guardados simultáneos con el mismo SKU: solo uno se crea, el otro responde 409', async () => {
      const cuerpo = datosValidos();

      const respuestas = await Promise.all([
        crear(cuerpo),
        crear({ ...cuerpo, codigoBarras: codigoUnico() }),
      ]);

      expect(respuestas.map((r) => r.status).sort((a, b) => a - b)).toEqual([
        201, 409,
      ]);
      expect(await listar()).toHaveLength(1);
    });
  });

  describe('fecha de vencimiento', () => {
    it('E3-H2 · fecha de vencimiento opcional: se guarda y el panel la devuelve', async () => {
      const creado = await nuevo({ fechaVencimiento: '2027-12-31' });

      expect(creado.fechaVencimiento).toBe('2027-12-31');
      expect((await listar())[0].fechaVencimiento).toBe('2027-12-31');

      const editado = await editar(creado.id, {
        fechaVencimiento: null,
      }).expect(200);
      expect((editado.body as FormatoRespuesta).fechaVencimiento).toBeNull();
    });

    it('E3-H2 · fecha de vencimiento: la tienda no la devuelve', async () => {
      const creado = await nuevo({ fechaVencimiento: '2027-12-31' });
      // Precio e imagen para que la tienda lo muestre (E3-H5 y la historia de imágenes)
      await prisma.articuloVenta.update({
        where: { id: creado.id },
        data: {
          precioMinoristaNeto: 10000,
          precioMayoristaNeto: 7000,
          imagenes: {
            create: {
              ubicacionArchivo: `productos/${creado.id}/principal.jpg`,
              orden: 1,
              esPrincipal: true,
            },
          },
        },
      });

      const respuesta = await request(app.getHttpServer())
        .get('/api/tienda/productos')
        .query({ marcaId })
        .expect(200);

      const texto = JSON.stringify(respuesta.body);
      expect(texto).toContain(String(productoId));
      expect(texto).not.toContain('fechaVencimiento');
      expect(texto).not.toContain('2027-12-31');
    });

    it('E3-H2 · formato sin los dos precios: la tienda no lo muestra', async () => {
      const creado = await nuevo();
      // Con minorista e imagen, pero sin mayorista
      await prisma.articuloVenta.update({
        where: { id: creado.id },
        data: {
          precioMinoristaNeto: 10000,
          imagenes: {
            create: {
              ubicacionArchivo: `productos/${creado.id}/principal.jpg`,
              orden: 1,
              esPrincipal: true,
            },
          },
        },
      });

      const respuesta = await request(app.getHttpServer())
        .get('/api/tienda/productos')
        .query({ marcaId })
        .expect(200);

      expect((respuesta.body as { total: number }).total).toBe(0);
    });
  });

  describe('formato predeterminado', () => {
    it('E3-H2 · formato predeterminado: con varios formatos, marcar uno lo deja como el único predeterminado', async () => {
      const primero = await nuevo();
      const segundo = await nuevo();
      const tercero = await nuevo();
      expect(primero.esPredeterminado).toBe(true);
      expect(segundo.esPredeterminado).toBe(false);

      await editar(tercero.id, { esPredeterminado: true }).expect(200);

      const formatos = await listar();
      expect(formatos.filter((f) => f.esPredeterminado)).toEqual([
        expect.objectContaining({ id: tercero.id }),
      ]);
      expect(formatos[0].id).toBe(tercero.id);
    });

    it('E3-H2 · formato predeterminado: un formato nuevo marcado reemplaza al anterior', async () => {
      await nuevo();

      const nuevoPredeterminado = await nuevo({ esPredeterminado: true });

      const predeterminados = (await listar()).filter(
        (f) => f.esPredeterminado,
      );
      expect(predeterminados.map((f) => f.id)).toEqual([
        nuevoPredeterminado.id,
      ]);
    });

    it('E3-H2 · formato predeterminado: marcar dos a la vez deja solo uno', async () => {
      await nuevo();
      const segundo = await nuevo();
      const tercero = await nuevo();

      await Promise.all([
        editar(segundo.id, { esPredeterminado: true }).expect(200),
        editar(tercero.id, { esPredeterminado: true }).expect(200),
      ]);

      const predeterminados = (await listar()).filter(
        (f) => f.esPredeterminado,
      );
      expect(predeterminados).toHaveLength(1);
    });

    it('E3-H2 · formato predeterminado: no se puede desmarcar (400)', async () => {
      const primero = await nuevo();

      await editar(primero.id, { esPredeterminado: false }).expect(400);

      expect((await listar())[0].esPredeterminado).toBe(true);
    });
  });

  describe('editar', () => {
    it('cambia solo lo que llega y responde 404 si el formato no existe', async () => {
      const creado = await nuevo();

      const respuesta = await editar(creado.id, {
        nombreFormato: '500 ml',
        contenido: 500,
        unidadMedida: 'ml',
        codigoBarras: null,
      }).expect(200);

      expect(respuesta.body).toEqual({
        ...creado,
        nombreFormato: '500 ml',
        contenido: 500,
        codigoBarras: null,
      });
      await editar(2_000_000_000, { nombreFormato: 'X' }).expect(404);
      await editar(creado.id, {}).expect(400);
    });
  });
});
