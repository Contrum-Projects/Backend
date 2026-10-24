import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import argon2 from 'argon2';
import type { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AlmacenArchivos } from '../src/almacen/almacen-archivos.js';
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
// R2 se reemplaza por un almacén en memoria: la prueba no depende de Cloudflare.

const CONTRASENA = 'Secreta123';
// Todo lo que crean estas pruebas lleva este prefijo, para borrarlo al terminar
const PREFIJO = 'E2E-imagenes';

interface ImagenRespuesta {
  id: number;
  url: string;
  orden: number;
  esPrincipal: boolean;
}

/** Almacén de prueba: guarda las claves en memoria y puede simular que R2 falla. */
class AlmacenDePrueba extends AlmacenArchivos {
  readonly archivos = new Map<string, string>();
  fallarAlGuardar = false;

  guardar(clave: string, _contenido: Buffer, tipoContenido: string) {
    if (this.fallarAlGuardar) {
      return Promise.reject(new Error('R2 no responde'));
    }
    this.archivos.set(clave, tipoContenido);
    return Promise.resolve();
  }

  eliminar(clave: string) {
    this.archivos.delete(clave);
    return Promise.resolve();
  }
}

const jpeg = () => {
  const contenido = Buffer.alloc(2048);
  contenido.set([0xff, 0xd8, 0xff, 0xe0]);
  return contenido;
};
const png = () =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(512),
  ]);

describe('Catálogo · imágenes de artículos (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: Redis;
  let almacen: AlmacenDePrueba;
  let hashContrasena: string;
  let articuloId: number;
  let productoId: number;
  let token: string;
  const correosCreados: string[] = [];

  const tokenDe = async (rol: Rol) => {
    const email = `e2e-imagenes-${randomUUID()}@prueba.cl`;
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
  const ruta = (id: number | string = articuloId) =>
    `/api/catalogo/articulos/${id}/imagenes`;

  const subir = (
    contenido: Buffer = jpeg(),
    id: number | string = articuloId,
    con = token,
    nombre = 'foto.jpg',
  ) =>
    request(app.getHttpServer())
      .post(ruta(id))
      .auth(con, { type: 'bearer' })
      .attach('imagen', contenido, nombre);

  const listar = async (id = articuloId) => {
    const respuesta = await request(app.getHttpServer())
      .get(ruta(id))
      .auth(token, { type: 'bearer' })
      .expect(200);
    return respuesta.body as ImagenRespuesta[];
  };

  const ordenar = (cuerpo: object, id: number | string = articuloId) =>
    request(app.getHttpServer())
      .put(ruta(id))
      .auth(token, { type: 'bearer' })
      .send(cuerpo);

  const eliminar = (imagenId: number | string, id = articuloId) =>
    request(app.getHttpServer())
      .delete(`${ruta(id)}/${imagenId}`)
      .auth(token, { type: 'bearer' });

  /** Sube `n` imágenes por la API y devuelve cómo quedó el artículo. */
  const conImagenes = async (n: number) => {
    let imagenes: ImagenRespuesta[] = [];
    for (let i = 0; i < n; i++) {
      imagenes = (await subir().expect(201)).body as ImagenRespuesta[];
    }
    return imagenes;
  };

  const mensajeDe = (cuerpo: unknown) =>
    (cuerpo as { message: string | string[] }).message;

  const limpiar = async () => {
    // Las imágenes y el formato se borran en cascada con su artículo
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
    almacen = new AlmacenDePrueba();
    const modulo = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AlmacenArchivos)
      .useValue(almacen)
      .compile();
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
    almacen.archivos.clear();
    almacen.fallarAlGuardar = false;
    const categoria = await prisma.categoria.create({
      data: { nombre: `${PREFIJO} Cat ${unico()}` },
    });
    productoId = (
      await prisma.producto.create({
        data: {
          nombre: `${PREFIJO} Shampoo ${unico()}`,
          descripcion: 'Repara el cabello.',
          origenDescripcion: ORIGENES_DESCRIPCION.MANUAL,
          canalVenta: CANALES_VENTA.GENERAL,
          categoriaId: categoria.id,
        },
      })
    ).id;
    articuloId = (
      await prisma.articuloVenta.create({
        data: {
          sku: `${PREFIJO}-${unico()}`,
          tipo: TIPOS_ARTICULO.FORMATO,
          formato: {
            create: {
              productoId,
              nombreFormato: '300 ml',
              pesoGramos: 320,
              altoCm: 18,
              anchoCm: 6,
              largoCm: 4,
              esPredeterminado: true,
            },
          },
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

  describe('subir', () => {
    it('E3-H3 · imagen agregada: la guarda, la asocia al artículo como principal y la incluye en su ficha', async () => {
      const respuesta = await subir().expect(201);

      const imagenes = respuesta.body as ImagenRespuesta[];
      expect(imagenes).toEqual([
        {
          id: expect.any(Number) as number,
          url: expect.stringMatching(
            new RegExp(`articulos/${articuloId}/[0-9a-f-]{36}\\.jpg$`),
          ) as string,
          orden: 1,
          esPrincipal: true,
        },
      ]);
      const fila = await prisma.imagenArticulo.findUniqueOrThrow({
        where: { id: imagenes[0].id },
      });
      expect(fila.articuloId).toBe(articuloId);
      expect(almacen.archivos.get(fila.ubicacionArchivo)).toBe('image/jpeg');

      // La ficha del formato en el panel la incluye
      const formatos = await request(app.getHttpServer())
        .get(`/api/catalogo/productos/${productoId}/formatos`)
        .auth(token, { type: 'bearer' })
        .expect(200);
      expect(
        (formatos.body as { imagenes: ImagenRespuesta[] }[])[0].imagenes,
      ).toEqual(imagenes);
    });

    it('E3-H3 · imagen agregada: las siguientes quedan al final del orden y sin ser principales', async () => {
      await subir().expect(201);
      const respuesta = await subir(png(), articuloId, token, 'b.png').expect(
        201,
      );

      expect(
        (respuesta.body as ImagenRespuesta[]).map(({ orden, esPrincipal }) => ({
          orden,
          esPrincipal,
        })),
      ).toEqual([
        { orden: 1, esPrincipal: true },
        { orden: 2, esPrincipal: false },
      ]);
      expect([...almacen.archivos.values()]).toEqual([
        'image/jpeg',
        'image/png',
      ]);
    });

    it('E3-H3 · el administrador también puede; el bodeguero no (403) y sin sesión 401', async () => {
      const admin = await tokenDe(ROLES.ADMINISTRADOR);
      await subir(jpeg(), articuloId, admin).expect(201);

      const bodeguero = await tokenDe(ROLES.BODEGUERO);
      await subir(jpeg(), articuloId, bodeguero).expect(403);
      await request(app.getHttpServer())
        .get(ruta())
        .auth(bodeguero, { type: 'bearer' })
        .expect(403);
      await request(app.getHttpServer())
        .put(ruta())
        .auth(bodeguero, { type: 'bearer' })
        .send({ orden: [1], principalId: 1 })
        .expect(403);
      await request(app.getHttpServer())
        .delete(`${ruta()}/1`)
        .auth(bodeguero, { type: 'bearer' })
        .expect(403);
      const cliente = await tokenDe(ROLES.CLIENTE);
      await subir(jpeg(), articuloId, cliente).expect(403);

      await request(app.getHttpServer())
        .post(ruta())
        .attach('imagen', jpeg(), 'foto.jpg')
        .expect(401);
      await request(app.getHttpServer()).get(ruta()).expect(401);
      await request(app.getHttpServer())
        .put(ruta())
        .send({ orden: [1], principalId: 1 })
        .expect(401);
      await request(app.getHttpServer()).delete(`${ruta()}/1`).expect(401);
      // Solo quedó la del administrador
      expect(await listar()).toHaveLength(1);
    });

    it('E3-H3 · archivo que no es JPEG, PNG ni WebP (aunque se llame .jpg): 400 sin guardar nada', async () => {
      const respuesta = await subir(
        Buffer.from('GIF89a........', 'latin1'),
        articuloId,
        token,
        'foto.jpg',
      ).expect(400);

      expect(mensajeDe(respuesta.body)).toBe(
        'La imagen debe ser JPEG, PNG o WebP.',
      );
      expect(await listar()).toHaveLength(0);
      expect(almacen.archivos.size).toBe(0);
    });

    it('E3-H3 · sin archivo, con otro campo o con dos archivos: 400', async () => {
      const sinArchivo = await request(app.getHttpServer())
        .post(ruta())
        .auth(token, { type: 'bearer' })
        .send({})
        .expect(400);
      expect(mensajeDe(sinArchivo.body)).toBe(
        'Adjunta una imagen JPEG, PNG o WebP en el campo «imagen».',
      );

      await request(app.getHttpServer())
        .post(ruta())
        .auth(token, { type: 'bearer' })
        .attach('foto', jpeg(), 'foto.jpg')
        .expect(400);
      await request(app.getHttpServer())
        .post(ruta())
        .auth(token, { type: 'bearer' })
        .attach('imagen', jpeg(), 'a.jpg')
        .attach('imagen', jpeg(), 'b.jpg')
        .expect(400);
      expect(await listar()).toHaveLength(0);
    });

    it('E3-H3 · imagen de más de 5 MB: 413 en español sin guardar nada', async () => {
      const grande = Buffer.alloc(5 * 1024 * 1024 + 1);
      grande.set([0xff, 0xd8, 0xff, 0xe0]);

      const respuesta = await subir(grande).expect(413);

      expect(mensajeDe(respuesta.body)).toBe(
        'La imagen no puede superar los 5 MB.',
      );
      expect(await listar()).toHaveLength(0);
      expect(almacen.archivos.size).toBe(0);
    });

    it('E3-H3 · artículo inexistente o id inválido: 404', async () => {
      await subir(jpeg(), 2_000_000_000).expect(404);
      await subir(jpeg(), 'abc').expect(404);
      expect(almacen.archivos.size).toBe(0);
    });

    it('E3-H3 · artículo con 10 imágenes: la undécima responde 409', async () => {
      await conImagenes(10);

      const respuesta = await subir().expect(409);

      expect(mensajeDe(respuesta.body)).toBe(
        'El artículo ya tiene 10 imágenes: elimina una antes de subir otra.',
      );
      expect(await listar()).toHaveLength(10);
      expect(almacen.archivos.size).toBe(10);
    });

    it('E3-H3 · subidas simultáneas con 9 imágenes: solo una entra y no queda archivo huérfano', async () => {
      await conImagenes(9);

      const respuestas = await Promise.all([subir(), subir(), subir()]);

      expect(respuestas.map((r) => r.status).sort((a, b) => a - b)).toEqual([
        201, 409, 409,
      ]);
      const imagenes = await listar();
      expect(imagenes.map((i) => i.orden)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
      ]);
      expect(almacen.archivos.size).toBe(10);
    });

    it('E3-H3 · el almacén no responde: 503 en español y no queda la imagen en la base', async () => {
      almacen.fallarAlGuardar = true;

      const respuesta = await subir().expect(503);

      expect(mensajeDe(respuesta.body)).toBe(
        'No se pudo guardar la imagen. Intenta de nuevo en unos minutos.',
      );

      expect(await listar()).toHaveLength(0);
    });
  });

  describe('ordenar', () => {
    it('E3-H3 · imagen principal y orden: guarda el nuevo orden y deja una sola principal', async () => {
      const [a, b, c] = await conImagenes(3);

      const respuesta = await ordenar({
        orden: [c.id, a.id, b.id],
        principalId: b.id,
      }).expect(200);

      const esperado = [
        { id: c.id, orden: 1, esPrincipal: false },
        { id: a.id, orden: 2, esPrincipal: false },
        { id: b.id, orden: 3, esPrincipal: true },
      ];
      const resumen = (imagenes: ImagenRespuesta[]) =>
        imagenes.map(({ id, orden, esPrincipal }) => ({
          id,
          orden,
          esPrincipal,
        }));
      expect(resumen(respuesta.body as ImagenRespuesta[])).toEqual(esperado);
      expect(resumen(await listar())).toEqual(esperado);
      expect(
        await prisma.imagenArticulo.count({
          where: { articuloId, esPrincipal: true },
        }),
      ).toBe(1);
    });

    it('E3-H3 · imagen principal y orden: marcar otra como principal sin mover el orden', async () => {
      const [a, b] = await conImagenes(2);

      await ordenar({ orden: [a.id, b.id], principalId: b.id }).expect(200);

      const imagenes = await listar();
      expect(imagenes.map((i) => [i.id, i.esPrincipal])).toEqual([
        [a.id, false],
        [b.id, true],
      ]);
    });

    it('E3-H3 · dos cambios de principal simultáneos: queda una sola principal', async () => {
      const [a, b, c] = await conImagenes(3);

      await Promise.all([
        ordenar({ orden: [a.id, b.id, c.id], principalId: b.id }),
        ordenar({ orden: [c.id, b.id, a.id], principalId: c.id }),
      ]);

      const imagenes = await listar();
      expect(imagenes.filter((i) => i.esPrincipal)).toHaveLength(1);
      expect(imagenes.map((i) => i.orden)).toEqual([1, 2, 3]);
    });

    it('E3-H3 · el orden no trae exactamente las imágenes del artículo, o la principal es ajena: 400 sin cambios', async () => {
      const [a, b] = await conImagenes(2);
      const antes = await listar();

      for (const cuerpo of [
        { orden: [a.id], principalId: a.id },
        { orden: [a.id, b.id, 2_000_000_000], principalId: a.id },
        { orden: [a.id, a.id], principalId: a.id },
        { orden: [a.id, b.id], principalId: 2_000_000_000 },
        { orden: [], principalId: a.id },
        { orden: [a.id, 'x'], principalId: a.id },
        { orden: [a.id, b.id] },
        { orden: [a.id, b.id], principalId: a.id, otro: 1 },
      ]) {
        await ordenar(cuerpo).expect(400);
      }
      expect(await listar()).toEqual(antes);
    });

    it('E3-H3 · imágenes de otro artículo: 400', async () => {
      const [propia] = await conImagenes(1);
      const otroId = (
        await prisma.articuloVenta.create({
          data: { sku: `${PREFIJO}-${unico()}`, tipo: TIPOS_ARTICULO.FORMATO },
        })
      ).id;
      const [ajena] = (await subir(jpeg(), otroId).expect(201))
        .body as ImagenRespuesta[];

      const respuesta = await ordenar({
        orden: [ajena.id],
        principalId: ajena.id,
      }).expect(400);

      expect(mensajeDe(respuesta.body)).toBe(
        'Indica todas las imágenes del artículo, cada una una vez.',
      );
      expect((await listar())[0]).toMatchObject({
        id: propia.id,
        esPrincipal: true,
      });
    });
  });

  describe('eliminar', () => {
    it('E3-H3 · única imagen del artículo: no permite eliminarla (409)', async () => {
      const [unica] = await conImagenes(1);

      const respuesta = await eliminar(unica.id).expect(409);

      expect(mensajeDe(respuesta.body)).toBe(
        'El artículo debe tener al menos una imagen: sube otra antes de eliminar esta.',
      );
      expect(await listar()).toHaveLength(1);
      expect(almacen.archivos.size).toBe(1);
    });

    it('E3-H3 · elimina la principal: se borra del almacén y la siguiente pasa a ser la principal, sin huecos en el orden', async () => {
      const [a, b, c] = await conImagenes(3);
      const clave = (
        await prisma.imagenArticulo.findUniqueOrThrow({ where: { id: a.id } })
      ).ubicacionArchivo;

      const respuesta = await eliminar(a.id).expect(200);

      const esperado = [
        { id: b.id, orden: 1, esPrincipal: true },
        { id: c.id, orden: 2, esPrincipal: false },
      ];
      expect(respuesta.body).toEqual(
        esperado.map((e) => expect.objectContaining(e) as object),
      );
      expect(await listar()).toEqual(respuesta.body);
      expect(almacen.archivos.has(clave)).toBe(false);
      expect(almacen.archivos.size).toBe(2);
    });

    it('E3-H3 · dos eliminaciones simultáneas con dos imágenes: una se rechaza y queda al menos una', async () => {
      const [a, b] = await conImagenes(2);

      const respuestas = await Promise.all([eliminar(a.id), eliminar(b.id)]);

      expect(respuestas.map((r) => r.status).sort((x, y) => x - y)).toEqual([
        200, 409,
      ]);
      const imagenes = await listar();
      expect(imagenes).toHaveLength(1);
      expect(imagenes[0]).toMatchObject({ orden: 1, esPrincipal: true });
    });

    it('E3-H3 · imagen de otro artículo, inexistente o id inválido: 404', async () => {
      await conImagenes(2);
      const otroId = (
        await prisma.articuloVenta.create({
          data: { sku: `${PREFIJO}-${unico()}`, tipo: TIPOS_ARTICULO.FORMATO },
        })
      ).id;
      const [ajena] = (await subir(jpeg(), otroId).expect(201))
        .body as ImagenRespuesta[];
      await subir(jpeg(), otroId).expect(201);

      await eliminar(ajena.id).expect(404);
      await eliminar(2_000_000_000).expect(404);
      await eliminar('abc').expect(404);
      await eliminar(ajena.id, 2_000_000_000).expect(404);
      expect(await listar(otroId)).toHaveLength(2);
    });
  });
});
