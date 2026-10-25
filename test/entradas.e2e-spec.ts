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
  TIPOS_ARTICULO,
  TIPOS_MOVIMIENTO,
} from '../src/common/dominio/valores.js';
import { configurarApp } from '../src/configurar-app.js';
import { hoyEnLaTienda } from '../src/modulos/inventario/entradas.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { REDIS } from '../src/redis/redis.module.js';

// Requiere PostgreSQL y Redis levantados: `docker compose up -d db redis`.

const CONTRASENA = 'Secreta123';
const RUTA = '/api/inventario/entradas';
// Todo lo que crean estas pruebas lleva este prefijo, para borrarlo al terminar
const PREFIJO = 'E2E-entradas';
// Región y comuna de prueba (códigos que no usa el CUT ni otra prueba); se borran al terminar
const REGION = '98';
const COMUNA = '98001';
// RUT de prueba con dígito verificador válido; se borra al terminar
const RUT_PROVEEDOR = '76086430-7';

interface EntradaRespuesta {
  id: number;
  detalles: {
    formatoId: number;
    cantidad: number;
    costoUnitarioNeto: number;
    movimientoId: number;
  }[];
}

describe('Inventario · entradas (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: Redis;
  let hashContrasena: string;
  let token: string;
  let proveedorId: number;
  let ubicacionId: number;
  let formatos: number[];
  const correosCreados: string[] = [];

  const unico = () => randomUUID().slice(0, 8);

  /** Crea una cuenta con ese rol, inicia sesión y devuelve su token de acceso. */
  const tokenDe = async (rol: Rol) => {
    const email = `e2e-entradas-${randomUUID()}@prueba.cl`;
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

  /** Formato de un producto nuevo; devuelve su id. */
  const nuevoFormato = async (categoriaId: number) => {
    const producto = await prisma.producto.create({
      data: {
        nombre: `${PREFIJO} Shampoo ${unico()}`,
        descripcion: 'Repara el cabello.',
        origenDescripcion: ORIGENES_DESCRIPCION.MANUAL,
        canalVenta: CANALES_VENTA.GENERAL,
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

  const entradaValida = (numeroDocumento = `F-${unico()}`) => ({
    proveedorId,
    fechaRecepcion: hoyEnLaTienda(),
    tipoDocumento: 'factura',
    numeroDocumento,
    ubicacionId,
    detalles: [
      { formatoId: formatos[0], cantidad: 24, costoUnitarioNeto: 3500 },
      { formatoId: formatos[1], cantidad: 6, costoUnitarioNeto: 1990.5 },
    ],
  });

  const registrar = (cuerpo: object, con = token) =>
    request(app.getHttpServer())
      .post(RUTA)
      .auth(con, { type: 'bearer' })
      .send(cuerpo);

  const stockDe = async (formatoId: number) =>
    (
      await prisma.existencia.findUnique({
        where: { formatoId_ubicacionId: { formatoId, ubicacionId } },
      })
    )?.cantidad ?? 0;

  const mensajeDe = (cuerpo: unknown) =>
    (cuerpo as { message: string | string[] }).message;

  const limpiar = async () => {
    const formatosPrueba = {
      formato: { articulo: { sku: { startsWith: PREFIJO } } },
    };
    await prisma.movimientoInventario.deleteMany({ where: formatosPrueba });
    // El detalle se borra en cascada con la entrada
    await prisma.entradaInventario.deleteMany({
      where: { proveedor: { rut: RUT_PROVEEDOR } },
    });
    await prisma.existencia.deleteMany({ where: formatosPrueba });
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
    await prisma.proveedor.deleteMany({ where: { rut: RUT_PROVEEDOR } });
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
    await limpiar();

    const region = await prisma.region.upsert({
      where: { codigoCut: REGION },
      update: {},
      create: { codigoCut: REGION, nombre: 'Región de prueba entradas' },
    });
    await prisma.comuna.upsert({
      where: { codigoCut: COMUNA },
      update: {},
      create: {
        codigoCut: COMUNA,
        nombre: 'Comuna de prueba entradas',
        regionId: region.id,
      },
    });
  });

  beforeEach(async () => {
    const claves = await redis.keys('limite:*');
    if (claves.length) await redis.del(...claves);
    await limpiar();

    const comuna = await prisma.comuna.findUniqueOrThrow({
      where: { codigoCut: COMUNA },
    });
    const bodega = await prisma.bodega.create({
      data: {
        nombre: `${PREFIJO} Tienda`,
        direccion: 'Calle de prueba 100',
        tipo: 'tienda',
        comunaId: comuna.id,
      },
    });
    ubicacionId = (
      await prisma.ubicacion.create({
        data: { bodegaId: bodega.id, codigo: 'RECEPCION' },
      })
    ).id;
    proveedorId = (
      await prisma.proveedor.create({
        data: { rut: RUT_PROVEEDOR, razonSocial: `${PREFIJO} Proveedor` },
      })
    ).id;
    const categoriaId = (
      await prisma.categoria.create({
        data: { nombre: `${PREFIJO} Cat ${unico()}` },
      })
    ).id;
    formatos = [
      await nuevoFormato(categoriaId),
      await nuevoFormato(categoriaId),
    ];
    token = await tokenDe(ROLES.BODEGUERO);
  });

  afterAll(async () => {
    // Las entradas y los movimientos apuntan a la cuenta que los registró: primero ellos
    await limpiar();
    await prisma.usuario.deleteMany({
      where: { email: { in: correosCreados } },
    });
    await prisma.comuna.deleteMany({ where: { codigoCut: COMUNA } });
    await prisma.region.deleteMany({ where: { codigoCut: REGION } });
    await app.close();
  });

  it('E11-H2 · entrada registrada: suma lo recibido al stock y deja un movimiento de entrada por formato ligado a la recepción', async () => {
    const respuesta = await registrar(entradaValida()).expect(201);
    const entrada = respuesta.body as EntradaRespuesta;

    expect(await stockDe(formatos[0])).toBe(24);
    expect(await stockDe(formatos[1])).toBe(6);
    const movimientos = await prisma.movimientoInventario.findMany({
      where: { entradaId: entrada.id },
      orderBy: { formatoId: 'asc' },
    });
    expect(movimientos).toHaveLength(2);
    expect(movimientos).toEqual(
      formatos.map((formatoId, i) =>
        expect.objectContaining({
          formatoId,
          tipo: TIPOS_MOVIMIENTO.ENTRADA,
          cantidad: i === 0 ? 24 : 6,
          ubicacionDestinoId: ubicacionId,
          ubicacionOrigenId: null,
        }),
      ),
    );
    expect(
      entrada.detalles.map((d) => d.movimientoId).sort((a, b) => a - b),
    ).toEqual(movimientos.map((m) => m.id).sort((a, b) => a - b));
    const detalles = await prisma.detalleEntrada.findMany({
      where: { entradaId: entrada.id },
      orderBy: { formatoId: 'asc' },
    });
    expect(
      detalles.map((d) => [d.cantidadRecibida, Number(d.costoUnitarioNeto)]),
    ).toEqual([
      [24, 3500],
      [6, 1990.5],
    ]);
  });

  it('E11-H2 · entrada registrada: una segunda entrada suma al stock que ya había, con guía de despacho y costo cero', async () => {
    await registrar(entradaValida()).expect(201);

    await registrar({
      ...entradaValida(),
      tipoDocumento: 'guia_despacho',
      detalles: [
        { formatoId: formatos[0], cantidad: 10, costoUnitarioNeto: 0 },
      ],
    }).expect(201);

    expect(await stockDe(formatos[0])).toBe(34);
    expect(await stockDe(formatos[1])).toBe(6);
  });

  it('E11-H2 · formato repetido: rechaza la entrada y no toca el stock', async () => {
    const respuesta = await registrar({
      ...entradaValida(),
      detalles: [
        { formatoId: formatos[0], cantidad: 24, costoUnitarioNeto: 3500 },
        { formatoId: formatos[0], cantidad: 2, costoUnitarioNeto: 3500 },
      ],
    }).expect(400);

    expect(mensajeDe(respuesta.body)).toEqual([
      'Cada formato debe aparecer una sola vez en la entrada.',
    ]);
    expect(
      await prisma.entradaInventario.count({ where: { proveedorId } }),
    ).toBe(0);
    expect(await stockDe(formatos[0])).toBe(0);
  });

  it('E11-H2 · datos faltantes: sin proveedor, documento ni costo no registra la entrada e indica lo que falta', async () => {
    const {
      proveedorId: _p,
      tipoDocumento: _t,
      numeroDocumento: _n,
      ...incompleta
    } = entradaValida();

    const respuesta = await registrar({
      ...incompleta,
      detalles: [{ formatoId: formatos[0], cantidad: 24 }],
    }).expect(400);

    expect(mensajeDe(respuesta.body)).toEqual([
      'El proveedor es obligatorio.',
      'El tipo de documento es obligatorio y debe ser uno de estos: factura, guia_despacho.',
      'El número de documento es obligatorio.',
      'El costo unitario neto es obligatorio.',
    ]);
    expect(
      await prisma.entradaInventario.count({ where: { proveedorId } }),
    ).toBe(0);
    expect(await stockDe(formatos[0])).toBe(0);
  });

  it('el mismo documento del proveedor no se registra dos veces (409)', async () => {
    await registrar(entradaValida('F-100')).expect(201);

    await registrar(entradaValida('F-100')).expect(409);

    expect(
      await prisma.entradaInventario.count({ where: { proveedorId } }),
    ).toBe(1);
    expect(await stockDe(formatos[0])).toBe(24);
  });

  it('rechaza un proveedor desactivado, una fecha futura y un formato que no existe', async () => {
    const manana = new Date(Date.now() + 36 * 60 * 60 * 1000);
    await registrar({
      ...entradaValida(),
      fechaRecepcion: hoyEnLaTienda(manana),
    }).expect(400);
    await registrar({
      ...entradaValida(),
      detalles: [
        { formatoId: 2_000_000_000, cantidad: 1, costoUnitarioNeto: 1 },
      ],
    }).expect(400);
    await prisma.proveedor.update({
      where: { id: proveedorId },
      data: { activo: false },
    });
    await registrar(entradaValida()).expect(400);

    expect(
      await prisma.entradaInventario.count({ where: { proveedorId } }),
    ).toBe(0);
  });

  it('RNF-13 · dos entradas simultáneas del mismo formato suman las dos', async () => {
    const respuestas = await Promise.all([
      registrar(entradaValida()),
      registrar(entradaValida()),
    ]);

    expect(respuestas.map((r) => r.status)).toEqual([201, 201]);
    expect(await stockDe(formatos[0])).toBe(48);
    expect(await stockDe(formatos[1])).toBe(12);
  });

  it('RNF-03 · sin sesión responde 401 y con un rol sin permiso de inventario 403', async () => {
    await request(app.getHttpServer())
      .post(RUTA)
      .send(entradaValida())
      .expect(401);

    for (const rol of [ROLES.VENDEDOR, ROLES.CLIENTE, ROLES.PROFESIONAL]) {
      await registrar(entradaValida(), await tokenDe(rol)).expect(403);
    }
    await registrar(entradaValida(), await tokenDe(ROLES.ADMINISTRADOR)).expect(
      201,
    );
    expect(
      await prisma.entradaInventario.count({ where: { proveedorId } }),
    ).toBe(1);
  });
});
