import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import argon2 from 'argon2';
import type { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { ROLES, type Rol } from '../src/common/dominio/roles.js';
import { configurarApp } from '../src/configurar-app.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { REDIS } from '../src/redis/redis.module.js';

// Requiere PostgreSQL y Redis levantados: `docker compose up -d db redis`.

const CONTRASENA = 'Secreta123';
const RUTA_MARCAS = '/api/catalogo/marcas';
const RUTA_CATEGORIAS = '/api/catalogo/categorias';
// Todo lo que crean estas pruebas lleva este prefijo, para borrarlo al terminar
const PREFIJO = 'E2E-catalogo';

interface Nodo {
  id: number;
  nombre: string;
  subcategorias: Nodo[];
}

describe('Catálogo · marcas y categorías (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: Redis;
  let hashContrasena: string;
  const correosCreados: string[] = [];

  /** Crea una cuenta con ese rol, inicia sesión y devuelve su token de acceso. */
  const tokenDe = async (rol: Rol) => {
    const email = `e2e-catalogo-${randomUUID()}@prueba.cl`;
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

  const nombreUnico = (base: string) =>
    `${PREFIJO} ${base} ${randomUUID().slice(0, 8)}`;

  const crearMarca = (token: string, nombre: string) =>
    request(app.getHttpServer())
      .post(RUTA_MARCAS)
      .auth(token, { type: 'bearer' })
      .send({ nombre });

  const crearCategoria = (token: string, cuerpo: object) =>
    request(app.getHttpServer())
      .post(RUTA_CATEGORIAS)
      .auth(token, { type: 'bearer' })
      .send(cuerpo);

  const mover = (token: string, id: number, padreId: number | null) =>
    request(app.getHttpServer())
      .patch(`${RUTA_CATEGORIAS}/${id}`)
      .auth(token, { type: 'bearer' })
      .send({ padreId });

  /** Crea una categoría y devuelve su id. */
  const nueva = async (token: string, base: string, padreId?: number) => {
    const respuesta = await crearCategoria(token, {
      nombre: nombreUnico(base),
      padreId,
    }).expect(201);
    return (respuesta.body as { id: number }).id;
  };

  const limpiar = async () => {
    // Sin distinguir mayúsculas: una prueba crea marcas escritas en mayúsculas
    await prisma.marca.deleteMany({
      where: { nombre: { startsWith: PREFIJO, mode: 'insensitive' } },
    });
    // Una sola sentencia: la base revisa la clave del padre al final de ella
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
  });

  afterAll(async () => {
    await limpiar();
    await prisma.usuario.deleteMany({
      where: { email: { in: correosCreados } },
    });
    await app.close();
  });

  describe('marcas', () => {
    it('E3-H4 · marca creada: el personal la guarda y queda en la lista de marcas', async () => {
      const token = await tokenDe(ROLES.VENDEDOR);
      const nombre = nombreUnico('Kerastase');

      const respuesta = await crearMarca(token, `  ${nombre}  `).expect(201);

      expect(respuesta.body).toMatchObject({ nombre, activa: true });
      const lista = await request(app.getHttpServer())
        .get(RUTA_MARCAS)
        .auth(token, { type: 'bearer' })
        .expect(200);
      expect(
        (lista.body as { nombre: string }[]).some(
          (marca) => marca.nombre === nombre,
        ),
      ).toBe(true);
    });

    it('E3-H4 · marca repetida: rechaza el nombre aunque cambien las mayúsculas', async () => {
      const token = await tokenDe(ROLES.VENDEDOR);
      const nombre = nombreUnico('Wella');
      await crearMarca(token, nombre).expect(201);

      await crearMarca(token, nombre).expect(409);
      await crearMarca(token, nombre.toUpperCase()).expect(409);

      expect(
        await prisma.marca.count({
          where: { nombre: { equals: nombre, mode: 'insensitive' } },
        }),
      ).toBe(1);
    });

    it('E3-H4 · dos marcas simultáneas con el mismo nombre: solo una se crea', async () => {
      const token = await tokenDe(ROLES.ADMINISTRADOR);
      const nombre = nombreUnico('Loreal');

      const respuestas = await Promise.all([
        crearMarca(token, nombre),
        crearMarca(token, nombre.toUpperCase()),
      ]);

      expect(respuestas.map((r) => r.status).sort((a, b) => a - b)).toEqual([
        201, 409,
      ]);
      expect(
        await prisma.marca.count({
          where: { nombre: { equals: nombre, mode: 'insensitive' } },
        }),
      ).toBe(1);
    });

    it('rechaza con 400 un nombre vacío o ausente', async () => {
      const token = await tokenDe(ROLES.VENDEDOR);

      await crearMarca(token, '  ').expect(400);
      await request(app.getHttpServer())
        .post(RUTA_MARCAS)
        .auth(token, { type: 'bearer' })
        .send({})
        .expect(400);
    });
  });

  describe('categorías', () => {
    it('E3-H4 · subcategoría creada: se guarda dentro de su categoría y se muestra bajo ella', async () => {
      const token = await tokenDe(ROLES.VENDEDOR);
      const categoriaId = await nueva(token, 'Cuidado');

      const subcategoriaId = await nueva(token, 'Shampoos', categoriaId);

      const arbol = await request(app.getHttpServer())
        .get(RUTA_CATEGORIAS)
        .auth(token, { type: 'bearer' })
        .expect(200);
      const raiz = (arbol.body as Nodo[]).find(
        (nodo) => nodo.id === categoriaId,
      );
      expect(raiz?.subcategorias.map((nodo) => nodo.id)).toEqual([
        subcategoriaId,
      ]);
      // La subcategoría no aparece también como raíz
      expect(
        (arbol.body as Nodo[]).some((nodo) => nodo.id === subcategoriaId),
      ).toBe(false);
    });

    it('rechaza con 404 una subcategoría dentro de una categoría que no existe', async () => {
      const token = await tokenDe(ROLES.VENDEDOR);

      await crearCategoria(token, {
        nombre: nombreUnico('Huérfana'),
        padreId: 2_000_000_000,
      }).expect(404);
    });

    it('E3-H4 · ciclo de categorías: rechaza mover una categoría dentro de una de sus subcategorías', async () => {
      const token = await tokenDe(ROLES.ADMINISTRADOR);
      const abuela = await nueva(token, 'Abuela');
      const hija = await nueva(token, 'Hija', abuela);
      const nieta = await nueva(token, 'Nieta', hija);

      await mover(token, abuela, nieta).expect(409);
      await mover(token, abuela, hija).expect(409);
      await mover(token, abuela, abuela).expect(409);

      const guardada = await prisma.categoria.findUniqueOrThrow({
        where: { id: abuela },
      });
      expect(guardada.padreId).toBeNull();
    });

    it('mueve una categoría a otra rama y a la raíz cuando no hay ciclo', async () => {
      const token = await tokenDe(ROLES.VENDEDOR);
      const a = await nueva(token, 'A');
      const b = await nueva(token, 'B');
      const hijaDeA = await nueva(token, 'HijaDeA', a);

      await mover(token, hijaDeA, b).expect(200);
      expect(
        (await prisma.categoria.findUniqueOrThrow({ where: { id: hijaDeA } }))
          .padreId,
      ).toBe(b);

      await mover(token, hijaDeA, null).expect(200);
      expect(
        (await prisma.categoria.findUniqueOrThrow({ where: { id: hijaDeA } }))
          .padreId,
      ).toBeNull();
    });

    it('dos movimientos simultáneos que juntos formarían un ciclo: solo uno se aplica', async () => {
      const token = await tokenDe(ROLES.ADMINISTRADOR);
      const a = await nueva(token, 'Carrera A');
      const b = await nueva(token, 'Carrera B');

      const respuestas = await Promise.all([
        mover(token, a, b),
        mover(token, b, a),
      ]);

      expect(respuestas.map((r) => r.status).sort((x, y) => x - y)).toEqual([
        200, 409,
      ]);
      const [filaA, filaB] = await Promise.all([
        prisma.categoria.findUniqueOrThrow({ where: { id: a } }),
        prisma.categoria.findUniqueOrThrow({ where: { id: b } }),
      ]);
      expect(filaA.padreId === b && filaB.padreId === a).toBe(false);
    });

    it('cambia el nombre y la descripción, y rechaza un cuerpo vacío o una categoría inexistente', async () => {
      const token = await tokenDe(ROLES.VENDEDOR);
      const id = await nueva(token, 'Editable');
      const nombre = nombreUnico('Renombrada');

      const respuesta = await request(app.getHttpServer())
        .patch(`${RUTA_CATEGORIAS}/${id}`)
        .auth(token, { type: 'bearer' })
        .send({ nombre, descripcion: 'Nueva descripción' })
        .expect(200);
      expect(respuesta.body).toMatchObject({
        id,
        nombre,
        descripcion: 'Nueva descripción',
      });

      await request(app.getHttpServer())
        .patch(`${RUTA_CATEGORIAS}/${id}`)
        .auth(token, { type: 'bearer' })
        .send({})
        .expect(400);
      await mover(token, 2_000_000_000, null).expect(404);
    });
  });

  it('E13-H2 · catalogo.gestionar: sin sesión 401; cliente, profesional y bodeguero 403 y sin modificar datos', async () => {
    const nombre = nombreUnico('Prohibida');
    await request(app.getHttpServer())
      .post(RUTA_MARCAS)
      .send({ nombre })
      .expect(401);
    await request(app.getHttpServer()).get(RUTA_MARCAS).expect(401);
    await request(app.getHttpServer()).get(RUTA_CATEGORIAS).expect(401);
    await request(app.getHttpServer())
      .patch(`${RUTA_CATEGORIAS}/1`)
      .send({ nombre })
      .expect(401);

    // El bodeguero es personal del panel, pero la matriz no le da catalogo.gestionar
    for (const rol of [ROLES.CLIENTE, ROLES.PROFESIONAL, ROLES.BODEGUERO]) {
      const token = await tokenDe(rol);
      await crearMarca(token, nombre).expect(403);
      await crearCategoria(token, { nombre }).expect(403);
      await mover(token, 1, null).expect(403);
      await request(app.getHttpServer())
        .get(RUTA_CATEGORIAS)
        .auth(token, { type: 'bearer' })
        .expect(403);
    }
    expect(await prisma.marca.count({ where: { nombre } })).toBe(0);
    expect(await prisma.categoria.count({ where: { nombre } })).toBe(0);
  });
});
