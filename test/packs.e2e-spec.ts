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
// Todo lo que crean estas pruebas lleva este prefijo, para borrarlo al terminar
const PREFIJO = 'E2E-packs';

interface PackRespuesta {
  id: number;
  sku: string;
  nombre: string;
  canalVenta: string;
  fechaInicioVigencia: string | null;
  fechaFinVigencia: string | null;
  vigente: boolean;
  componentes: { formatoId: number; cantidad: number }[];
}

interface PackTiendaRespuesta {
  id: number;
  nombre: string;
  precio: number | null;
  precioMayorista?: number;
  exclusivo?: boolean;
}

/** AAAA-MM-DD desplazado `dias` desde hoy en Chile. */
const diaDesdeHoy = (dias: number) => {
  const fecha = new Date(`${hoyEnLaTienda()}T00:00:00Z`);
  fecha.setUTCDate(fecha.getUTCDate() + dias);
  return fecha.toISOString().slice(0, 10);
};

describe('Catálogo · packs (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: Redis;
  let hashContrasena: string;
  let porcentajeIva: number;
  let categoriaId: number;
  let token: string;
  const correosCreados: string[] = [];

  const unico = () => randomUUID().slice(0, 8);

  const tokenDe = async (rol: Rol) => {
    const email = `e2e-packs-${randomUUID()}@prueba.cl`;
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

  /** Formato con una imagen de un producto nuevo del canal indicado; devuelve su id. */
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
    return articulo.id;
  };

  const crear = (cuerpo: object, con = token) =>
    request(app.getHttpServer())
      .post('/api/catalogo/packs')
      .auth(con, { type: 'bearer' })
      .send(cuerpo);

  const editar = (id: number, cuerpo: object, con = token) =>
    request(app.getHttpServer())
      .patch(`/api/catalogo/packs/${id}`)
      .auth(con, { type: 'bearer' })
      .send(cuerpo);

  const packTienda = async (con?: string) => {
    const pedido = request(app.getHttpServer()).get(
      '/api/tienda/packs?limite=100',
    );
    if (con) pedido.auth(con, { type: 'bearer' });
    const respuesta = await pedido.expect(200);
    return (respuesta.body as { items: PackTiendaRespuesta[] }).items.filter(
      (pack) => pack.nombre.startsWith(PREFIJO),
    );
  };

  /** Pack con dos formatos, sus precios fijados por el administrador y una imagen. */
  const packALaVenta = async (extra: object = {}) => {
    const componentes = [
      { formatoId: await nuevoFormato(), cantidad: 1 },
      { formatoId: await nuevoFormato(), cantidad: 1 },
    ];
    const respuesta = await crear({
      sku: `${PREFIJO}-${unico()}`,
      nombre: `${PREFIJO} Dúo ${unico()}`,
      descripcion: 'Shampoo y acondicionador.',
      canalVenta: CANALES_VENTA.GENERAL,
      componentes,
      ...extra,
    }).expect(201);
    const pack = respuesta.body as PackRespuesta;
    // Un pack exclusivo solo lleva precio mayorista (E3-H5)
    const exclusivo = pack.canalVenta === CANALES_VENTA.PROFESIONAL;
    await request(app.getHttpServer())
      .put(`/api/catalogo/articulos/${pack.id}/precios`)
      .auth(token, { type: 'bearer' })
      .send({
        precioMinoristaNeto: exclusivo ? undefined : 10000,
        precioMayoristaNeto: 8000,
        motivo: 'Precio de la promoción',
      })
      .expect(200);
    await prisma.imagenArticulo.create({
      data: {
        articuloId: pack.id,
        ubicacionArchivo: `articulos/${pack.id}/principal.jpg`,
        orden: 1,
        esPrincipal: true,
      },
    });
    return pack;
  };

  const mensajeDe = (cuerpo: unknown) =>
    (cuerpo as { message: string | string[] }).message;

  const limpiar = async () => {
    // Pack, formato, componentes, imágenes e historial se borran en cascada con su artículo;
    // primero los packs, que apuntan a los formatos
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
    token = await tokenDe(ROLES.ADMINISTRADOR);
  });

  afterAll(async () => {
    // El historial de precios apunta a la cuenta que los fijó: primero los artículos
    await limpiar();
    await prisma.usuario.deleteMany({
      where: { email: { in: correosCreados } },
    });
    await app.close();
  });

  it('E3-H6 · pack creado: guarda el SKU y sus formatos con sus cantidades, sin precios ni stock propio', async () => {
    const shampoo = await nuevoFormato();
    const acondicionador = await nuevoFormato();
    const sku = `${PREFIJO}-${unico()}`;
    const vendedor = await tokenDe(ROLES.VENDEDOR);

    const respuesta = await crear(
      {
        sku,
        nombre: `${PREFIJO} Dúo reparador`,
        descripcion: 'Shampoo y acondicionador.',
        canalVenta: CANALES_VENTA.GENERAL,
        fechaInicioVigencia: diaDesdeHoy(0),
        fechaFinVigencia: diaDesdeHoy(30),
        componentes: [
          { formatoId: shampoo, cantidad: 2 },
          { formatoId: acondicionador, cantidad: 1 },
        ],
      },
      vendedor,
    ).expect(201);

    const pack = respuesta.body as PackRespuesta;
    expect(pack).toMatchObject({
      sku,
      canalVenta: 'general',
      fechaInicioVigencia: diaDesdeHoy(0),
      fechaFinVigencia: diaDesdeHoy(30),
      vigente: true,
      componentes: [
        { formatoId: shampoo, cantidad: 2 },
        { formatoId: acondicionador, cantidad: 1 },
      ],
    });
    const articulo = await prisma.articuloVenta.findUniqueOrThrow({
      where: { id: pack.id },
    });
    expect(articulo).toMatchObject({
      sku,
      tipo: TIPOS_ARTICULO.PACK,
      precioMinoristaNeto: null,
      precioMayoristaNeto: null,
    });
    // Sin stock propio: el pack no es un formato y no tiene existencias
    expect(
      await prisma.formatoProducto.findUnique({ where: { id: pack.id } }),
    ).toBeNull();
    expect(
      await prisma.existencia.count({ where: { formatoId: pack.id } }),
    ).toBe(0);

    const visto = await request(app.getHttpServer())
      .get(`/api/catalogo/packs/${pack.id}`)
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect((visto.body as PackRespuesta).componentes).toHaveLength(2);
  });

  it('E3-H6 · pack creado: sus precios se fijan después, con el historial de E3-H5', async () => {
    const pack = await packALaVenta();

    const precios = await request(app.getHttpServer())
      .get(`/api/catalogo/articulos/${pack.id}/precios`)
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(precios.body).toMatchObject({
      articuloId: pack.id,
      precioMinoristaNeto: 10000,
      precioMayoristaNeto: 8000,
    });
  });

  it('E3-H6 · componente no permitido: otro pack como componente responde 400 y no guarda nada', async () => {
    const pack = await packALaVenta();
    const formato = await nuevoFormato();
    const sku = `${PREFIJO}-${unico()}`;

    const respuesta = await crear({
      sku,
      nombre: `${PREFIJO} Pack de packs`,
      descripcion: 'No se puede.',
      canalVenta: CANALES_VENTA.GENERAL,
      componentes: [
        { formatoId: formato, cantidad: 1 },
        { formatoId: pack.id, cantidad: 1 },
      ],
    }).expect(400);

    expect(mensajeDe(respuesta.body)).toBe(
      'Un pack solo admite formatos de producto como componentes, no otros packs.',
    );
    expect(await prisma.articuloVenta.count({ where: { sku } })).toBe(0);
  });

  it('E3-H6 · componente no permitido: al editar tampoco admite un pack, ni a sí mismo', async () => {
    const pack = await packALaVenta();
    const otro = await packALaVenta();

    for (const formatoId of [otro.id, pack.id]) {
      const respuesta = await editar(pack.id, {
        componentes: [{ formatoId, cantidad: 2 }],
      }).expect(400);
      expect(mensajeDe(respuesta.body)).toBe(
        'Un pack solo admite formatos de producto como componentes, no otros packs.',
      );
    }
    expect(
      await prisma.componentePack.count({ where: { packId: pack.id } }),
    ).toBe(2);
  });

  it('E3-H6 · pack fuera de vigencia: la tienda no lo devuelve', async () => {
    const vigente = await packALaVenta({
      fechaInicioVigencia: diaDesdeHoy(0),
      fechaFinVigencia: diaDesdeHoy(0),
    });
    const vencido = await packALaVenta({
      fechaInicioVigencia: diaDesdeHoy(-10),
      fechaFinVigencia: diaDesdeHoy(-1),
    });
    const futuro = await packALaVenta({ fechaInicioVigencia: diaDesdeHoy(1) });
    const profesional = await tokenDe(ROLES.PROFESIONAL);

    for (const con of [undefined, profesional]) {
      const ids = (await packTienda(con)).map((pack) => pack.id);
      expect(ids).toContain(vigente.id);
      expect(ids).not.toContain(vencido.id);
      expect(ids).not.toContain(futuro.id);
    }

    // Al extender la vigencia vuelve a la tienda
    await editar(vencido.id, { fechaFinVigencia: null }).expect(200);
    expect((await packTienda()).map((pack) => pack.id)).toContain(vencido.id);
  });

  it('E3-H6 · la tienda muestra el pack con IVA y sin el mayorista a quien no es profesional (RNF-04)', async () => {
    const pack = await packALaVenta();
    const cliente = await tokenDe(ROLES.CLIENTE);

    for (const con of [undefined, cliente]) {
      const [visto] = (await packTienda(con)).filter((p) => p.id === pack.id);
      expect(visto).toMatchObject({
        precio: precioConIva(10000, porcentajeIva),
      });
      expect(visto).not.toHaveProperty('precioMayorista');
    }
    const [paraProfesional] = (
      await packTienda(await tokenDe(ROLES.PROFESIONAL))
    ).filter((p) => p.id === pack.id);
    expect(paraProfesional).toMatchObject({
      precioMayorista: precioConIva(8000, porcentajeIva),
      exclusivo: false,
    });
  });

  it('E3-H6 · un pack exclusivo solo lo ve el profesional', async () => {
    const pack = await packALaVenta({ canalVenta: CANALES_VENTA.PROFESIONAL });

    expect((await packTienda()).map((p) => p.id)).not.toContain(pack.id);
    const [visto] = (await packTienda(await tokenDe(ROLES.PROFESIONAL))).filter(
      (p) => p.id === pack.id,
    );
    expect(visto).toMatchObject({ precio: null, exclusivo: true });
  });

  it('un pack general no lleva formatos de productos exclusivos', async () => {
    const respuesta = await crear({
      sku: `${PREFIJO}-${unico()}`,
      nombre: `${PREFIJO} Mezcla`,
      descripcion: 'No se puede.',
      canalVenta: CANALES_VENTA.GENERAL,
      componentes: [
        { formatoId: await nuevoFormato(), cantidad: 1 },
        {
          formatoId: await nuevoFormato(CANALES_VENTA.PROFESIONAL),
          cantidad: 1,
        },
      ],
    }).expect(400);

    expect(mensajeDe(respuesta.body)).toMatch(/exclusivo para profesionales/);
  });

  it('el SKU repetido responde 409', async () => {
    const pack = await packALaVenta();
    const formato = await nuevoFormato();

    const respuesta = await crear({
      sku: pack.sku,
      nombre: `${PREFIJO} Otro`,
      descripcion: 'Repite el SKU.',
      canalVenta: CANALES_VENTA.GENERAL,
      componentes: [{ formatoId: formato, cantidad: 2 }],
    }).expect(409);

    expect(mensajeDe(respuesta.body)).toBe(
      'El SKU ya pertenece a otro artículo.',
    );
  });

  it('solo con el permiso de catálogo: el bodeguero y el cliente reciben 403 y sin sesión 401', async () => {
    const cuerpo = {
      sku: `${PREFIJO}-${unico()}`,
      nombre: `${PREFIJO} Sin permiso`,
      descripcion: 'No se guarda.',
      canalVenta: CANALES_VENTA.GENERAL,
      componentes: [{ formatoId: await nuevoFormato(), cantidad: 2 }],
    };

    const pack = await packALaVenta();

    for (const rol of [ROLES.BODEGUERO, ROLES.CLIENTE, ROLES.PROFESIONAL]) {
      const otro = await tokenDe(rol);
      await crear(cuerpo, otro).expect(403);
      await editar(pack.id, { nombre: `${PREFIJO} Cambio` }, otro).expect(403);
      for (const ruta of [
        '/api/catalogo/packs',
        `/api/catalogo/packs/${pack.id}`,
      ]) {
        await request(app.getHttpServer())
          .get(ruta)
          .auth(otro, { type: 'bearer' })
          .expect(403);
      }
    }
    await request(app.getHttpServer())
      .post('/api/catalogo/packs')
      .send(cuerpo)
      .expect(401);
    await request(app.getHttpServer()).get('/api/catalogo/packs').expect(401);
  });
});
