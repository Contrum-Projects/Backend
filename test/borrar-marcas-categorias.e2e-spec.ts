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
} from '../src/common/dominio/valores.js';
import { configurarApp } from '../src/configurar-app.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { REDIS } from '../src/redis/redis.module.js';

// Requiere PostgreSQL y Redis levantados: `docker compose up -d db redis`.

const CONTRASENA = 'Secreta123';
const PREFIJO = 'E2E-borrar';

describe('Borrar marcas y categorías (e2e, SCRUM-158)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: Redis;
  let hashContrasena: string;
  let token: string;
  const correosCreados: string[] = [];

  const unico = () => randomUUID().slice(0, 8);
  const servidor = () => app.getHttpServer();

  const tokenDe = async (rol: Rol) => {
    const email = `e2e-borrar-${randomUUID()}@prueba.cl`;
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
    const respuesta = await request(servidor())
      .post('/api/cuentas/sesion')
      .send({ email, contrasena: CONTRASENA })
      .expect(200);
    return (respuesta.body as { tokenAcceso: string }).tokenAcceso;
  };

  const borrar = (que: 'marcas' | 'categorias', id: number, con = token) =>
    request(servidor())
      .delete(`/api/catalogo/${que}/${id}`)
      .auth(con, { type: 'bearer' });

  const nuevaCategoria = (padreId?: number) =>
    prisma.categoria.create({
      data: { nombre: `${PREFIJO} Cat ${unico()}`, padreId },
    });
  const nuevaMarca = () =>
    prisma.marca.create({ data: { nombre: `${PREFIJO} Marca ${unico()}` } });

  const limpiar = async () => {
    await prisma.producto.deleteMany({
      where: { nombre: { startsWith: PREFIJO } },
    });
    // Las subcategorías primero: la raíz no se borra con hijas
    await prisma.categoria.deleteMany({
      where: { nombre: { startsWith: PREFIJO }, padreId: { not: null } },
    });
    await prisma.categoria.deleteMany({
      where: { nombre: { startsWith: PREFIJO } },
    });
    await prisma.marca.deleteMany({
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
    token = await tokenDe(ROLES.VENDEDOR);
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

  it('SCRUM-158 · criterio 5: sin sesión 401; sin el permiso del catálogo (bodeguero) 403', async () => {
    const marca = await nuevaMarca();
    await request(servidor())
      .delete(`/api/catalogo/marcas/${marca.id}`)
      .expect(401);
    const bodeguero = await tokenDe(ROLES.BODEGUERO);
    await borrar('marcas', marca.id, bodeguero).expect(403);
    await borrar('categorias', marca.id, bodeguero).expect(403);
  });

  it('SCRUM-158 · criterios 2 y 4: una marca y una categoría sin usos se borran y desaparecen de la tienda', async () => {
    const marca = await nuevaMarca();
    const categoria = await nuevaCategoria();

    await borrar('marcas', marca.id).expect(204);
    await borrar('categorias', categoria.id).expect(204);

    expect(await prisma.marca.findUnique({ where: { id: marca.id } })).toBe(
      null,
    );
    const marcas = await request(servidor())
      .get('/api/tienda/marcas')
      .expect(200);
    expect((marcas.body as { id: number }[]).map((m) => m.id)).not.toContain(
      marca.id,
    );
    const arbol = JSON.stringify(
      (await request(servidor()).get('/api/tienda/categorias').expect(200))
        .body,
    );
    expect(arbol).not.toContain(categoria.nombre);
  });

  it('SCRUM-158 · criterio 3: una marca o categoría con productos no se borra y dice cuántos', async () => {
    const marca = await nuevaMarca();
    const categoria = await nuevaCategoria();
    await prisma.producto.create({
      data: {
        nombre: `${PREFIJO} Shampoo`,
        descripcion: 'Repara.',
        origenDescripcion: ORIGENES_DESCRIPCION.MANUAL,
        canalVenta: CANALES_VENTA.GENERAL,
        categoriaId: categoria.id,
        marcaId: marca.id,
      },
    });

    const marcaEnUso = await borrar('marcas', marca.id).expect(409);
    expect((marcaEnUso.body as { message: string }).message).toBe(
      'No se puede borrar: la usa 1 producto. Cámbialos a otra marca antes de borrarla.',
    );
    await borrar('categorias', categoria.id).expect(409);
    expect(await prisma.marca.findUnique({ where: { id: marca.id } })).not.toBe(
      null,
    );
  });

  it('SCRUM-158 · criterio 3: una categoría con subcategorías no se borra', async () => {
    const raiz = await nuevaCategoria();
    await nuevaCategoria(raiz.id);

    const respuesta = await borrar('categorias', raiz.id).expect(409);
    expect((respuesta.body as { message: string }).message).toContain(
      '1 subcategoría',
    );
  });

  it('una marca o categoría que no existe responde 404', async () => {
    await borrar('marcas', 999999999).expect(404);
    await borrar('categorias', 999999999).expect(404);
  });
});
