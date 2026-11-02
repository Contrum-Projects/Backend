import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import argon2 from 'argon2';
import type { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { ROLES } from '../src/common/dominio/roles.js';
import { ORIGENES_DESCRIPCION } from '../src/common/dominio/valores.js';
import { configurarApp } from '../src/configurar-app.js';
import {
  CLIENTE_IA,
  type ClienteIa,
  type LecturaReverso,
} from '../src/modulos/catalogo/cliente-ia.js';
import { MENSAJE_SUGERENCIA_INVALIDA } from '../src/modulos/catalogo/productos.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { REDIS } from '../src/redis/redis.module.js';

// Requiere PostgreSQL y Redis levantados: `docker compose up -d db redis`.
// Gemini se reemplaza por una IA de prueba: la prueba no depende de Google ni gasta cuota.

const CONTRASENA = 'Secreta123';
const PREFIJO = 'E2E-aceptar-descripcion';
const TEXTO_IA = 'Shampoo reparador para cabello dañado por procesos químicos.';
const INGREDIENTES_IA = 'Aqua, Sodium Laureth Sulfate, Glycerin';

class IaDePrueba implements ClienteIa {
  leerReverso(): Promise<LecturaReverso> {
    return Promise.resolve({
      legible: true,
      descripcion: TEXTO_IA,
      ingredientes: INGREDIENTES_IA,
    });
  }
}

interface Sugerencia {
  descripcion: string;
  ingredientes: string | null;
  firma: string;
}

interface ProductoRespuesta {
  id: number;
  descripcion: string;
  ingredientes: string | null;
  origenDescripcion: string;
}

const jpeg = () => {
  const contenido = Buffer.alloc(2048);
  contenido.set([0xff, 0xd8, 0xff, 0xe0]);
  return contenido;
};

describe('Catálogo · aceptar, editar o descartar la descripción sugerida (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: Redis;
  let token: string;
  let categoriaId: number;
  let marcaId: number;
  const correosCreados: string[] = [];

  const sugerir = async (): Promise<Sugerencia> => {
    const respuesta = await request(app.getHttpServer())
      .post('/api/catalogo/descripciones/sugerencia')
      .auth(token, { type: 'bearer' })
      .attach('imagen', jpeg(), 'reverso.jpg')
      .expect(200);
    return respuesta.body as Sugerencia;
  };

  const crear = (cuerpo: object) =>
    request(app.getHttpServer())
      .post('/api/catalogo/productos')
      .auth(token, { type: 'bearer' })
      .send({
        nombre: `${PREFIJO} ${randomUUID().slice(0, 8)}`,
        categoriaId,
        marcaId,
        canalVenta: 'general',
        ...cuerpo,
      });

  const editar = (id: number, cuerpo: object) =>
    request(app.getHttpServer())
      .patch(`/api/catalogo/productos/${id}`)
      .auth(token, { type: 'bearer' })
      .send(cuerpo);

  const enBase = (id: number) =>
    prisma.producto.findUniqueOrThrow({
      where: { id },
      select: {
        descripcion: true,
        ingredientes: true,
        origenDescripcion: true,
      },
    });

  const limpiar = async () => {
    await prisma.producto.deleteMany({
      where: { nombre: { startsWith: PREFIJO } },
    });
    await prisma.categoria.deleteMany({
      where: { nombre: { startsWith: PREFIJO } },
    });
    await prisma.marca.deleteMany({
      where: { nombre: { startsWith: PREFIJO } },
    });
  };

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CLIENTE_IA)
      .useValue(new IaDePrueba())
      .compile();
    app = configurarApp(modulo.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    redis = app.get(REDIS);
    await limpiar();

    const email = `e2e-aceptar-${randomUUID()}@prueba.cl`;
    correosCreados.push(email);
    await prisma.usuario.create({
      data: {
        codigoPublico: randomUUID(),
        nombre: 'Camila',
        apellido: 'Rojas',
        email,
        contrasenaHash: await argon2.hash(CONTRASENA),
        rol: ROLES.VENDEDOR,
        fechaVerificacionCorreo: new Date(),
      },
    });
    const sesion = await request(app.getHttpServer())
      .post('/api/cuentas/sesion')
      .send({ email, contrasena: CONTRASENA })
      .expect(200);
    token = (sesion.body as { tokenAcceso: string }).tokenAcceso;

    categoriaId = (
      await prisma.categoria.create({
        data: { nombre: `${PREFIJO} Cat ${randomUUID().slice(0, 8)}` },
      })
    ).id;
    marcaId = (
      await prisma.marca.create({
        data: { nombre: `${PREFIJO} Marca ${randomUUID().slice(0, 8)}` },
      })
    ).id;
  });

  beforeEach(async () => {
    const claves = await redis.keys('limite:*');
    if (claves.length) await redis.del(...claves);
  });

  afterAll(async () => {
    await limpiar();
    await prisma.usuario.deleteMany({
      where: { email: { in: correosCreados } },
    });
    await app.close();
  });

  it('E4-H2 · sugerencia aceptada: la API la guarda en el producto con origen «IA», junto a los ingredientes', async () => {
    const sugerencia = await sugerir();

    const respuesta = await crear({
      descripcion: sugerencia.descripcion,
      ingredientes: sugerencia.ingredientes,
      sugerencia: {
        descripcion: sugerencia.descripcion,
        firma: sugerencia.firma,
      },
    }).expect(201);

    const producto = respuesta.body as ProductoRespuesta;
    expect(producto).toMatchObject({
      descripcion: TEXTO_IA,
      ingredientes: INGREDIENTES_IA,
      origenDescripcion: ORIGENES_DESCRIPCION.IA,
    });
    expect(await enBase(producto.id)).toEqual({
      descripcion: TEXTO_IA,
      ingredientes: INGREDIENTES_IA,
      origenDescripcion: ORIGENES_DESCRIPCION.IA,
    });
  });

  it('E4-H2 · sugerencia editada: la API guarda el texto corregido con origen «IA editada»', async () => {
    const sugerencia = await sugerir();
    const corregido = 'Shampoo reparador para cabello teñido y decolorado.';

    const respuesta = await crear({
      descripcion: corregido,
      sugerencia: {
        descripcion: sugerencia.descripcion,
        firma: sugerencia.firma,
      },
    }).expect(201);

    expect(
      await enBase((respuesta.body as ProductoRespuesta).id),
    ).toMatchObject({
      descripcion: corregido,
      origenDescripcion: ORIGENES_DESCRIPCION.IA_EDITADA,
    });
  });

  it('E4-H2 · sugerencia editada en un producto existente: al editarlo con la sugerencia, queda «IA editada»', async () => {
    const creado = (await crear({ descripcion: 'Texto inicial.' }).expect(201))
      .body as ProductoRespuesta;
    const sugerencia = await sugerir();

    await editar(creado.id, {
      descripcion: `${sugerencia.descripcion} Sin sulfatos agresivos.`,
      sugerencia: {
        descripcion: sugerencia.descripcion,
        firma: sugerencia.firma,
      },
    }).expect(200);

    expect(await enBase(creado.id)).toMatchObject({
      origenDescripcion: ORIGENES_DESCRIPCION.IA_EDITADA,
    });
  });

  it('E4-H2 · sugerencia descartada: la API guarda el texto propio con origen «manual»', async () => {
    await sugerir();

    const respuesta = await crear({
      descripcion: 'Descripción escrita por el personal.',
    }).expect(201);

    expect(
      await enBase((respuesta.body as ProductoRespuesta).id),
    ).toMatchObject({
      descripcion: 'Descripción escrita por el personal.',
      origenDescripcion: ORIGENES_DESCRIPCION.MANUAL,
    });
  });

  it('E4-H2 · sin publicación automática: pedir la sugerencia no cambia ningún producto', async () => {
    const creado = (
      await crear({ descripcion: 'Texto publicado.' }).expect(201)
    ).body as ProductoRespuesta;
    const antes = await enBase(creado.id);
    const productosAntes = await prisma.producto.count();

    await sugerir();

    expect(await prisma.producto.count()).toBe(productosAntes);
    expect(await enBase(creado.id)).toEqual(antes);
  });

  it('E4-H2 · sin publicación automática: una firma que no corresponde al texto sugerido responde 400 sin cambios', async () => {
    const sugerencia = await sugerir();
    const creado = (
      await crear({ descripcion: 'Texto publicado.' }).expect(201)
    ).body as ProductoRespuesta;
    const productosAntes = await prisma.producto.count();

    const alCrear = await crear({
      descripcion: 'Texto inventado.',
      sugerencia: { descripcion: 'Texto inventado.', firma: sugerencia.firma },
    }).expect(400);
    const alEditar = await editar(creado.id, {
      descripcion: 'Texto inventado.',
      sugerencia: { descripcion: 'Texto inventado.', firma: sugerencia.firma },
    }).expect(400);

    expect((alCrear.body as { message: string }).message).toBe(
      MENSAJE_SUGERENCIA_INVALIDA,
    );
    expect((alEditar.body as { message: string }).message).toBe(
      MENSAJE_SUGERENCIA_INVALIDA,
    );
    expect(await prisma.producto.count()).toBe(productosAntes);
    expect(await enBase(creado.id)).toMatchObject({
      descripcion: 'Texto publicado.',
      origenDescripcion: ORIGENES_DESCRIPCION.MANUAL,
    });
  });

  it('E4-H2 · sugerencia sin descripción, sin firma o que no es un objeto: 400', async () => {
    const creado = (
      await crear({ descripcion: 'Texto publicado.' }).expect(201)
    ).body as ProductoRespuesta;
    const sugerencia = await sugerir();

    await editar(creado.id, {
      nombre: `${PREFIJO} otro`,
      sugerencia: {
        descripcion: sugerencia.descripcion,
        firma: sugerencia.firma,
      },
    }).expect(400);
    await crear({
      descripcion: TEXTO_IA,
      sugerencia: { descripcion: TEXTO_IA },
    }).expect(400);
    await crear({ descripcion: TEXTO_IA, sugerencia: 'ia' }).expect(400);
  });

  it('E4-H2 · ingredientes: se pueden cambiar y borrar al editar', async () => {
    const creado = (
      await crear({
        descripcion: 'Texto publicado.',
        ingredientes: 'Aqua',
      }).expect(201)
    ).body as ProductoRespuesta;

    await editar(creado.id, { ingredientes: 'Aqua, Glycerin' }).expect(200);
    expect((await enBase(creado.id)).ingredientes).toBe('Aqua, Glycerin');

    await editar(creado.id, { ingredientes: null }).expect(200);
    expect((await enBase(creado.id)).ingredientes).toBeNull();

    await editar(creado.id, { ingredientes: 'x'.repeat(3001) }).expect(400);
  });
});
