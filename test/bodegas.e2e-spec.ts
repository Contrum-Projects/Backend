import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
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

// Requiere PostgreSQL y Redis levantados: `docker compose up -d db redis`.

const CONTRASENA = 'Secreta123';
const RUTA = '/api/inventario/bodegas';
const PREFIJO = 'E2E-bodegas';
const PREFIJO_CORREO = 'e2e-bodegas-';
/** Territorio propio: el CI corre los e2e sin la semilla de comunas (SCRUM-161). */
const REGION = '86';
const COMUNA = '86001';

interface Bodega {
  id: number;
  nombre: string;
  tipo: string;
  activa: boolean;
  stock: number;
  comuna: { codigoCut: string; nombre: string };
  region: { codigoCut: string; nombre: string };
  ubicaciones: { id: number; codigo: string; activa: boolean; stock: number }[];
}

describe('Inventario · bodegas y ubicaciones (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hashContrasena: string;
  let administrador: string;
  let comuna: { codigoCut: string; region: { codigoCut: string } };

  const unico = () => randomUUID().slice(0, 8);
  const servidor = () => request(app.getHttpServer());
  const nombre = () => `${PREFIJO} ${unico()}`;

  const tokenDe = async (rol: Rol) => {
    const email = `${PREFIJO_CORREO}${randomUUID()}@prueba.cl`;
    await prisma.usuario.create({
      data: {
        codigoPublico: randomUUID(),
        nombre: 'Rosa',
        apellido: 'Pérez',
        email,
        contrasenaHash: hashContrasena,
        rol,
        fechaVerificacionCorreo: new Date(),
      },
    });
    const respuesta = await servidor()
      .post('/api/cuentas/sesion')
      .send({ email, contrasena: CONTRASENA })
      .expect(200);
    return (respuesta.body as { tokenAcceso: string }).tokenAcceso;
  };

  const crearBodega = (cuerpo: object = {}, token = administrador) =>
    servidor()
      .post(RUTA)
      .auth(token, { type: 'bearer' })
      .send({
        nombre: nombre(),
        direccion: 'Av. Matta 1234',
        comuna: comuna.codigoCut,
        tipo: 'bodega',
        ...cuerpo,
      });

  const editar = (ruta: string, cuerpo: object) =>
    servidor()
      .patch(`${RUTA}${ruta}`)
      .auth(administrador, { type: 'bearer' })
      .send(cuerpo);

  const agregarUbicacion = (bodegaId: number, cuerpo: object) =>
    servidor()
      .post(`${RUTA}/${bodegaId}/ubicaciones`)
      .auth(administrador, { type: 'bearer' })
      .send(cuerpo);

  /** Un formato con `cantidad` unidades en la ubicación. */
  const guardarStock = async (ubicacionId: number, cantidad: number) => {
    const categoria = await prisma.categoria.create({
      data: { nombre: `${PREFIJO} Cat ${unico()}` },
    });
    const producto = await prisma.producto.create({
      data: {
        nombre: `${PREFIJO} Shampoo ${unico()}`,
        descripcion: 'Repara.',
        origenDescripcion: ORIGENES_DESCRIPCION.MANUAL,
        canalVenta: CANALES_VENTA.GENERAL,
        categoriaId: categoria.id,
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
    await prisma.existencia.create({
      data: { formatoId: articulo.id, ubicacionId, cantidad },
    });
  };

  const mensaje = (cuerpo: unknown) => JSON.stringify(cuerpo);

  const limpiar = async () => {
    await prisma.existencia.deleteMany({
      where: {
        OR: [
          { ubicacion: { bodega: { nombre: { startsWith: PREFIJO } } } },
          { formato: { articulo: { sku: { startsWith: PREFIJO } } } },
        ],
      },
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
    await prisma.ubicacion.deleteMany({
      where: { bodega: { nombre: { startsWith: PREFIJO } } },
    });
    await prisma.bodega.deleteMany({
      where: { nombre: { startsWith: PREFIJO } },
    });
    await prisma.usuario.deleteMany({
      where: { email: { startsWith: PREFIJO_CORREO } },
    });
  };

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = configurarApp(modulo.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    hashContrasena = await argon2.hash(CONTRASENA);
    await limpiar();
    administrador = await tokenDe(ROLES.ADMINISTRADOR);
    const region = await prisma.region.upsert({
      where: { codigoCut: REGION },
      update: {},
      create: { codigoCut: REGION, nombre: 'Región de prueba bodegas' },
    });
    await prisma.comuna.upsert({
      where: { codigoCut: COMUNA },
      update: {},
      create: {
        codigoCut: COMUNA,
        nombre: 'Comuna de prueba bodegas',
        regionId: region.id,
      },
    });
    comuna = { codigoCut: COMUNA, region: { codigoCut: REGION } };
  });

  afterAll(async () => {
    await limpiar();
    await prisma.comuna.deleteMany({ where: { codigoCut: COMUNA } });
    await prisma.region.deleteMany({ where: { codigoCut: REGION } });
    await app.close();
  });

  it('SCRUM-151 · CA1 crear bodega: nace activa con su comuna y región, y se lista con sus ubicaciones', async () => {
    const respuesta = await crearBodega({
      tipo: 'tienda',
      abasteceVentaOnline: false,
    }).expect(201);
    const bodega = respuesta.body as Bodega;
    expect(bodega).toMatchObject({
      tipo: 'tienda',
      activa: true,
      stock: 0,
      ubicaciones: [],
      comuna: { codigoCut: comuna.codigoCut },
      region: { codigoCut: comuna.region.codigoCut },
    });

    const lista = await servidor()
      .get(RUTA)
      .auth(administrador, { type: 'bearer' })
      .expect(200);
    expect((lista.body as Bodega[]).some((b) => b.id === bodega.id)).toBe(true);
  });

  it('SCRUM-151 · CA1 crear bodega: tipo o comuna inválidos responden 400 junto al campo', async () => {
    expect(
      mensaje((await crearBodega({ tipo: 'galpon' }).expect(400)).body),
    ).toContain('El tipo debe ser uno de estos: bodega, tienda');
    expect(
      mensaje((await crearBodega({ comuna: '99999' }).expect(400)).body),
    ).toContain('La comuna no existe');
  });

  it('SCRUM-151 · CA3 ubicaciones: código en mayúsculas y único en la bodega; otra bodega puede repetirlo', async () => {
    const a = (await crearBodega().expect(201)).body as Bodega;
    const b = (await crearBodega().expect(201)).body as Bodega;

    const conUbicacion = (
      await agregarUbicacion(a.id, { codigo: ' a-01 ', zona: 'Norte' }).expect(
        201,
      )
    ).body as Bodega;
    expect(conUbicacion.ubicaciones).toMatchObject([
      { codigo: 'A-01', activa: true, stock: 0 },
    ]);

    expect(
      mensaje(
        (await agregarUbicacion(a.id, { codigo: 'A-01' }).expect(409)).body,
      ),
    ).toContain('ya tiene una ubicación con ese código');
    await agregarUbicacion(b.id, { codigo: 'A-01' }).expect(201);

    // Editar al código de otra ubicación de la misma bodega también choca
    const dos = (await agregarUbicacion(a.id, { codigo: 'A-02' }).expect(201))
      .body as Bodega;
    const a02 = dos.ubicaciones.find((u) => u.codigo === 'A-02')!;
    await editar(`/${a.id}/ubicaciones/${a02.id}`, { codigo: 'a-01' }).expect(
      409,
    );
    // Una ubicación de otra bodega no se edita por esta ruta
    await editar(`/${b.id}/ubicaciones/${a02.id}`, { nivel: '2' }).expect(404);
  });

  it('SCRUM-151 · CA2 y CA3 desactivar: con stock responde 409 y no cambia; sin stock se desactiva', async () => {
    const bodega = (await crearBodega().expect(201)).body as Bodega;
    const [ubicacion] = (
      (await agregarUbicacion(bodega.id, { codigo: 'S-01' }).expect(201))
        .body as Bodega
    ).ubicaciones;
    await guardarStock(ubicacion!.id, 5);

    expect(
      mensaje(
        (
          await editar(`/${bodega.id}/ubicaciones/${ubicacion!.id}`, {
            activa: false,
          }).expect(409)
        ).body,
      ),
    ).toContain('todavía tiene stock');
    expect(
      mensaje(
        (await editar(`/${bodega.id}`, { activa: false }).expect(409)).body,
      ),
    ).toContain('La bodega todavía tiene stock');
    const sigue = await prisma.bodega.findUniqueOrThrow({
      where: { id: bodega.id },
      include: { ubicaciones: true },
    });
    expect(sigue.activa).toBe(true);
    expect(sigue.ubicaciones[0]!.activa).toBe(true);

    await prisma.existencia.updateMany({
      where: { ubicacionId: ubicacion!.id },
      data: { cantidad: 0 },
    });
    const sinUbicacion = (
      await editar(`/${bodega.id}/ubicaciones/${ubicacion!.id}`, {
        activa: false,
      }).expect(200)
    ).body as Bodega;
    expect(sinUbicacion.ubicaciones[0]!.activa).toBe(false);
    expect(
      (
        (
          await editar(`/${bodega.id}`, {
            activa: false,
            nombre: nombre(),
          }).expect(200)
        ).body as Bodega
      ).activa,
    ).toBe(false);

    // Desactivada, ya no aparece donde se guarda stock
    const activas = await servidor()
      .get('/api/inventario/ubicaciones')
      .auth(administrador, { type: 'bearer' })
      .expect(200);
    expect(
      (activas.body as { id: number }[]).some((u) => u.id === ubicacion!.id),
    ).toBe(false);
  });

  it('SCRUM-151 · solo el administrador: el bodeguero recibe 403 y sigue viendo las ubicaciones activas', async () => {
    const bodeguero = await tokenDe(ROLES.BODEGUERO);
    await servidor().get(RUTA).auth(bodeguero, { type: 'bearer' }).expect(403);
    await crearBodega({}, bodeguero).expect(403);
    await servidor()
      .get('/api/inventario/ubicaciones')
      .auth(bodeguero, { type: 'bearer' })
      .expect(200);
    await servidor().get(RUTA).expect(401);
  });
});
