import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import argon2 from 'argon2';
import type { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { ROLES, type Rol } from '../src/common/dominio/roles.js';
import { ORIGENES_DESCRIPCION } from '../src/common/dominio/valores.js';
import { configurarApp } from '../src/configurar-app.js';
import {
  CLIENTE_IA,
  type ClienteIa,
  ErrorServicioIa,
  type LecturaReverso,
} from '../src/modulos/catalogo/cliente-ia.js';
import {
  MENSAJE_FOTO_ILEGIBLE,
  MENSAJE_IA_NO_DISPONIBLE,
} from '../src/modulos/catalogo/sugerencia-descripcion.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { REDIS } from '../src/redis/redis.module.js';

// Requiere PostgreSQL y Redis levantados: `docker compose up -d db redis`.
// Gemini se reemplaza por una IA de prueba: la prueba no depende de Google ni gasta cuota.

const CONTRASENA = 'Secreta123';
const PREFIJO = 'E2E-sugerencia';
const RUTA = '/api/catalogo/descripciones/sugerencia';

/** IA de prueba: devuelve la lectura indicada o falla como un servicio caído. */
class IaDePrueba implements ClienteIa {
  lectura: LecturaReverso = {
    legible: true,
    descripcion: 'Shampoo reparador para cabello dañado por procesos químicos.',
    ingredientes: 'Aqua, Sodium Laureth Sulfate, Glycerin',
  };
  caida = false;
  llamadas = 0;

  leerReverso(): Promise<LecturaReverso> {
    this.llamadas++;
    return this.caida
      ? Promise.reject(new ErrorServicioIa('Gemini no respondió a tiempo'))
      : Promise.resolve(this.lectura);
  }
}

const jpeg = () => {
  const contenido = Buffer.alloc(2048);
  contenido.set([0xff, 0xd8, 0xff, 0xe0]);
  return contenido;
};

describe('Catálogo · sugerir la descripción desde la foto del reverso (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: Redis;
  let ia: IaDePrueba;
  let hashContrasena: string;
  let token: string;
  const correosCreados: string[] = [];

  const tokenDe = async (rol: Rol) => {
    const email = `e2e-sugerencia-${randomUUID()}@prueba.cl`;
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

  const sugerir = (con: string = token, contenido: Buffer = jpeg()) =>
    request(app.getHttpServer())
      .post(RUTA)
      .auth(con, { type: 'bearer' })
      .attach('imagen', contenido, 'reverso.jpg');

  const mensajeDe = (cuerpo: unknown) =>
    (cuerpo as { message: string | string[] }).message;

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
    ia = new IaDePrueba();
    const modulo = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CLIENTE_IA)
      .useValue(ia)
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
    ia.caida = false;
    ia.llamadas = 0;
    ia.lectura = new IaDePrueba().lectura;
    token = await tokenDe(ROLES.VENDEDOR);
  });

  afterAll(async () => {
    await limpiar();
    await prisma.usuario.deleteMany({
      where: { email: { in: correosCreados } },
    });
    await app.close();
  });

  it('E4-H1 · sugerencia generada: devuelve la descripción sugerida y los ingredientes transcritos, sin guardar nada', async () => {
    const productosAntes = await prisma.producto.count();

    const respuesta = await sugerir().expect(200);

    expect(respuesta.body).toEqual({
      descripcion:
        'Shampoo reparador para cabello dañado por procesos químicos.',
      ingredientes: 'Aqua, Sodium Laureth Sulfate, Glycerin',
      firma: expect.stringMatching(/^[0-9a-f]{64}$/) as unknown,
    });
    expect(await prisma.producto.count()).toBe(productosAntes);
  });

  it('E4-H1 · sugerencia generada: también para el administrador', async () => {
    await sugerir(await tokenDe(ROLES.ADMINISTRADOR)).expect(200);
  });

  it('E4-H1 · sin ingredientes en la foto: los devuelve como null', async () => {
    ia.lectura = {
      legible: true,
      descripcion: 'Acondicionador nutritivo.',
      ingredientes: null,
    };

    const respuesta = await sugerir().expect(200);

    expect(respuesta.body).toEqual({
      descripcion: 'Acondicionador nutritivo.',
      ingredientes: null,
      firma: expect.any(String) as unknown,
    });
  });

  it('E4-H1 · foto ilegible: responde 422 indicando que no pudo generarla', async () => {
    ia.lectura = { legible: false };

    const respuesta = await sugerir().expect(422);

    expect(mensajeDe(respuesta.body)).toBe(MENSAJE_FOTO_ILEGIBLE);
  });

  it('E4-H1 · servicio no disponible: responde 503 indicando que no pudo generarla', async () => {
    ia.caida = true;

    const respuesta = await sugerir().expect(503);

    expect(mensajeDe(respuesta.body)).toBe(MENSAJE_IA_NO_DISPONIBLE);
  });

  it('E4-H1 · servicio no disponible: no bloquea escribir la descripción a mano', async () => {
    ia.caida = true;
    await sugerir().expect(503);
    const categoria = await prisma.categoria.create({
      data: { nombre: `${PREFIJO} Cat ${randomUUID().slice(0, 8)}` },
    });
    const marca = await prisma.marca.create({
      data: { nombre: `${PREFIJO} Marca ${randomUUID().slice(0, 8)}` },
    });

    const respuesta = await request(app.getHttpServer())
      .post('/api/catalogo/productos')
      .auth(token, { type: 'bearer' })
      .send({
        nombre: `${PREFIJO} Shampoo ${randomUUID().slice(0, 8)}`,
        descripcion: 'Descripción escrita a mano por el personal.',
        categoriaId: categoria.id,
        marcaId: marca.id,
        canalVenta: 'general',
      })
      .expect(201);

    const producto = await prisma.producto.findUniqueOrThrow({
      where: { id: (respuesta.body as { id: number }).id },
    });
    expect(producto.descripcion).toBe(
      'Descripción escrita a mano por el personal.',
    );
    expect(producto.origenDescripcion).toBe(ORIGENES_DESCRIPCION.MANUAL);
  });

  it('E4-H1 · sin imagen o con un archivo que no es imagen: 400 sin llamar a la IA', async () => {
    await request(app.getHttpServer())
      .post(RUTA)
      .auth(token, { type: 'bearer' })
      .expect(400);
    await sugerir(token, Buffer.from('no soy una imagen')).expect(400);

    expect(ia.llamadas).toBe(0);
  });

  it('E4-H1 · foto de más de 5 MB: 413 sin llamar a la IA', async () => {
    const grande = Buffer.alloc(5 * 1024 * 1024 + 1);
    grande.set([0xff, 0xd8, 0xff, 0xe0]);

    const respuesta = await sugerir(token, grande).expect(413);

    expect(mensajeDe(respuesta.body)).toBe(
      'La imagen no puede superar los 5 MB.',
    );
    expect(ia.llamadas).toBe(0);
  });

  it('E4-H1 · sin sesión responde 401 y con un rol sin catalogo.gestionar, 403 (RNF-03)', async () => {
    await request(app.getHttpServer())
      .post(RUTA)
      .attach('imagen', jpeg(), 'reverso.jpg')
      .expect(401);
    await sugerir(await tokenDe(ROLES.CLIENTE)).expect(403);
    await sugerir(await tokenDe(ROLES.BODEGUERO)).expect(403);

    expect(ia.llamadas).toBe(0);
  });

  it('E4-H1 · límite: la sugerencia 16 del minuto con la misma cuenta responde 429 (RNF-09)', async () => {
    for (let i = 0; i < 15; i++) {
      await sugerir().expect(200);
    }

    await sugerir().expect(429);
    expect(ia.llamadas).toBe(15);
    // El límite es por cuenta: otra cuenta sigue pudiendo
    await sugerir(await tokenDe(ROLES.VENDEDOR)).expect(200);
  });
});
