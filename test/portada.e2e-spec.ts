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
} from '../src/common/dominio/valores.js';
import { configurarApp } from '../src/configurar-app.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { REDIS } from '../src/redis/redis.module.js';

// Requiere PostgreSQL y Redis levantados: `docker compose up -d db redis`.
// R2 se reemplaza por un almacén en memoria. Los slides que ya había en la base se respetan: al
// terminar se borran solo los creados aquí y los demás vuelven a su orden.

const CONTRASENA = 'Secreta123';
const PREFIJO = 'E2E-portada';
const MAXIMO = 8;

interface Slide {
  id: number;
  imagenEscritorio: string;
  imagenCelular: string | null;
  orden?: number;
  disponible?: boolean;
  destino: { tipo: string; destino: string; nombre: string | null };
}

class AlmacenDePrueba extends AlmacenArchivos {
  readonly archivos = new Map<string, string>();

  guardar(clave: string, _contenido: Buffer, tipoContenido: string) {
    this.archivos.set(clave, tipoContenido);
    return Promise.resolve();
  }

  urlTemporal(clave: string) {
    return Promise.resolve(`https://almacen.prueba/${clave}`);
  }

  eliminar(clave: string) {
    this.archivos.delete(clave);
    return Promise.resolve();
  }

  obtener(clave: string) {
    return Promise.reject(new Error(`${clave}: esta prueba no lee archivos`));
  }
}

const jpeg = () => {
  const contenido = Buffer.alloc(2048);
  contenido.set([0xff, 0xd8, 0xff, 0xe0]);
  return contenido;
};

describe('Portada del inicio (e2e, SCRUM-157)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: Redis;
  let almacen: AlmacenDePrueba;
  let hashContrasena: string;
  let token: string;
  let marcaId: number;
  let previos: { id: number; orden: number }[] = [];
  const correosCreados: string[] = [];

  const unico = () => randomUUID().slice(0, 8);
  const servidor = () => app.getHttpServer();

  const tokenDe = async (rol: Rol) => {
    const email = `e2e-portada-${randomUUID()}@prueba.cl`;
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

  const crear = (
    destino: { tipoDestino: string; destino: string },
    { celular = false, con = token } = {},
  ) => {
    const solicitud = request(servidor())
      .post('/api/portada/slides')
      .auth(con, { type: 'bearer' })
      .field('tipoDestino', destino.tipoDestino)
      .field('destino', destino.destino)
      .attach('escritorio', jpeg(), 'escritorio.jpg');
    return celular
      ? solicitud.attach('celular', jpeg(), 'celular.jpg')
      : solicitud;
  };

  const panel = async () =>
    (
      await request(servidor())
        .get('/api/portada/slides')
        .auth(token, { type: 'bearer' })
        .expect(200)
    ).body as Slide[];

  const tienda = async () =>
    (await request(servidor()).get('/api/portada').expect(200)).body as Slide[];

  const MARCA = () => ({ tipoDestino: 'marca', destino: String(marcaId) });
  const PAGINA = { tipoDestino: 'pagina', destino: 'packs' };

  const limpiar = async () => {
    const ids = previos.map((fila) => fila.id);
    await prisma.slidePortada.deleteMany({ where: { id: { notIn: ids } } });
    for (const fila of previos) {
      await prisma.slidePortada.update({
        where: { id: fila.id },
        data: { orden: fila.orden },
      });
    }
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
    almacen = new AlmacenDePrueba();
    const modulo = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AlmacenArchivos)
      .useValue(almacen)
      .compile();
    app = configurarApp(modulo.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    redis = app.get(REDIS);
    hashContrasena = await argon2.hash(CONTRASENA);
    previos = await prisma.slidePortada.findMany({
      select: { id: true, orden: true },
    });
    token = await tokenDe(ROLES.ADMINISTRADOR);
  });

  beforeEach(async () => {
    const claves = await redis.keys('limite:*');
    if (claves.length) await redis.del(...claves);
    await limpiar();
    almacen.archivos.clear();
    marcaId = (
      await prisma.marca.create({ data: { nombre: `${PREFIJO} ${unico()}` } })
    ).id;
  });

  afterAll(async () => {
    await limpiar();
    await prisma.usuario.deleteMany({
      where: { email: { in: correosCreados } },
    });
    await app.close();
  });

  it('SCRUM-157 · criterio 7: sin sesión 401; el vendedor (sin campañas) 403; la tienda no pide sesión', async () => {
    await request(servidor()).get('/api/portada/slides').expect(401);
    const vendedor = await tokenDe(ROLES.VENDEDOR);
    await request(servidor())
      .get('/api/portada/slides')
      .auth(vendedor, { type: 'bearer' })
      .expect(403);
    await crear(PAGINA, { con: vendedor }).expect(403);
    await request(servidor()).get('/api/portada').expect(200);
  });

  it('SCRUM-157 · criterio 1: escritorio obligatoria; celular opcional y se puede quitar', async () => {
    const sinEscritorio = await request(servidor())
      .post('/api/portada/slides')
      .auth(token, { type: 'bearer' })
      .field('tipoDestino', 'pagina')
      .field('destino', 'packs')
      .attach('celular', jpeg(), 'celular.jpg')
      .expect(400);
    expect(sinEscritorio.body).toMatchObject({
      errores: [{ campo: 'escritorio' }],
    });

    const slides = (await crear(MARCA(), { celular: true }).expect(201))
      .body as Slide[];
    const nuevo = slides.at(-1)!;
    expect(nuevo.imagenEscritorio).toMatch(/portada\/[0-9a-f-]{36}\.jpg$/);
    expect(nuevo.imagenCelular).toMatch(/portada\/[0-9a-f-]{36}\.jpg$/);
    expect(almacen.archivos.size).toBe(2);

    const sinCelular = (
      await request(servidor())
        .delete(`/api/portada/slides/${nuevo.id}/imagenes/celular`)
        .auth(token, { type: 'bearer' })
        .expect(200)
    ).body as Slide[];
    expect(sinCelular.find((s) => s.id === nuevo.id)?.imagenCelular).toBeNull();
    expect(almacen.archivos.size).toBe(1);
  });

  it('SCRUM-157 · criterio 2: el destino se elige de la lista; uno inexistente o no a la venta responde 400', async () => {
    const paginas = await request(servidor())
      .get('/api/portada/destinos?tipo=pagina')
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(paginas.body).toContainEqual({ destino: 'packs', nombre: 'Packs' });

    const marcas = await request(servidor())
      .get(`/api/portada/destinos?tipo=marca&buscar=${PREFIJO}`)
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(marcas.body).toContainEqual({
      destino: String(marcaId),
      nombre: expect.stringContaining(PREFIJO) as string,
    });

    await crear({ tipoDestino: 'pagina', destino: 'https://otro.cl' }).expect(
      400,
    );
    await crear({ tipoDestino: 'marca', destino: '999999999' }).expect(400);
    await crear({ tipoDestino: 'url', destino: '1' }).expect(400);

    // Un producto sin precios ni imagen no está a la venta
    const categoria = await prisma.categoria.create({
      data: { nombre: `${PREFIJO} Cat ${unico()}` },
    });
    const producto = await prisma.producto.create({
      data: {
        nombre: `${PREFIJO} Shampoo`,
        descripcion: 'Repara.',
        origenDescripcion: ORIGENES_DESCRIPCION.MANUAL,
        canalVenta: CANALES_VENTA.GENERAL,
        categoriaId: categoria.id,
      },
    });
    const error = await crear({
      tipoDestino: 'producto',
      destino: String(producto.id),
    }).expect(400);
    expect(error.body).toMatchObject({ errores: [{ campo: 'destino' }] });
  });

  it('SCRUM-157 · criterio 5: si el destino deja de estar disponible, la tienda no lo muestra y el panel lo marca', async () => {
    const slides = (await crear(MARCA()).expect(201)).body as Slide[];
    const id = slides.at(-1)!.id;
    expect((await tienda()).map((s) => s.id)).toContain(id);

    await prisma.marca.update({
      where: { id: marcaId },
      data: { activa: false },
    });
    expect((await tienda()).map((s) => s.id)).not.toContain(id);
    expect((await panel()).find((s) => s.id === id)?.disponible).toBe(false);
  });

  it('SCRUM-157 · criterio 3: cambiar destino, reemplazar imagen, reordenar y eliminar', async () => {
    await crear(MARCA()).expect(201);
    const slides = (await crear(PAGINA).expect(201)).body as Slide[];
    const [a, b] = slides.slice(-2);

    const conDestino = (
      await request(servidor())
        .patch(`/api/portada/slides/${a.id}`)
        .auth(token, { type: 'bearer' })
        .send({ tipoDestino: 'pagina', destino: 'catalogo' })
        .expect(200)
    ).body as Slide[];
    expect(conDestino.find((s) => s.id === a.id)?.destino).toEqual({
      tipo: 'pagina',
      destino: 'catalogo',
      nombre: 'Catálogo',
    });

    const reemplazada = (
      await request(servidor())
        .put(`/api/portada/slides/${a.id}/imagenes/escritorio`)
        .auth(token, { type: 'bearer' })
        .attach('imagen', jpeg(), 'nueva.jpg')
        .expect(200)
    ).body as Slide[];
    expect(reemplazada.find((s) => s.id === a.id)?.imagenEscritorio).not.toBe(
      a.imagenEscritorio,
    );
    expect(almacen.archivos.size).toBe(2);

    const orden = (await panel()).map((s) => s.id);
    const invertido = [...orden].reverse();
    const ordenados = (
      await request(servidor())
        .put('/api/portada/slides/orden')
        .auth(token, { type: 'bearer' })
        .send({ orden: invertido })
        .expect(200)
    ).body as Slide[];
    expect(ordenados.map((s) => s.id)).toEqual(invertido);
    await request(servidor())
      .put('/api/portada/slides/orden')
      .auth(token, { type: 'bearer' })
      .send({ orden: [b.id] })
      .expect(orden.length === 1 ? 200 : 400);

    const restantes = (
      await request(servidor())
        .delete(`/api/portada/slides/${b.id}`)
        .auth(token, { type: 'bearer' })
        .expect(200)
    ).body as Slide[];
    expect(restantes.map((s) => s.id)).not.toContain(b.id);
    expect(restantes.map((s) => s.orden)).toEqual(
      restantes.map((_, i) => i + 1),
    );
    await request(servidor())
      .delete(`/api/portada/slides/${b.id}`)
      .auth(token, { type: 'bearer' })
      .expect(404);
  });

  it(`SCRUM-157 · criterio 4: hasta ${MAXIMO} slides; una imagen que no es JPEG, PNG ni WebP responde 400`, async () => {
    await request(servidor())
      .post('/api/portada/slides')
      .auth(token, { type: 'bearer' })
      .field('tipoDestino', 'pagina')
      .field('destino', 'packs')
      .attach('escritorio', Buffer.from('no soy imagen'), 'falsa.jpg')
      .expect(400);

    const faltan = MAXIMO - (await prisma.slidePortada.count());
    for (let i = 0; i < faltan; i++) {
      await crear(PAGINA).expect(201);
    }
    await crear(PAGINA).expect(409);
  });
});
