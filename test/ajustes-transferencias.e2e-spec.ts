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
import { PrismaService } from '../src/prisma/prisma.service.js';
import { REDIS } from '../src/redis/redis.module.js';

// Requiere PostgreSQL y Redis levantados: `docker compose up -d db redis`.

const CONTRASENA = 'Secreta123';
const RUTA_AJUSTES = '/api/inventario/ajustes';
const RUTA_TRANSFERENCIAS = '/api/inventario/transferencias';
// Todo lo que crean estas pruebas lleva este prefijo, para borrarlo al terminar
const PREFIJO = 'E2E-ajustes';
// Región y comuna de prueba (códigos que no usa el CUT ni otra prueba); se borran al terminar
const REGION = '96';
const COMUNA = '96001';

interface AjusteRespuesta {
  movimientoId: number;
  tipo: string;
  cantidad: number;
  stockResultante: number;
}

interface TransferenciaRespuesta {
  movimientoId: number;
  origen: { id: number; stock: number };
  destino: { id: number; stock: number };
  cantidad: number;
}

describe('Inventario · ajustes y transferencias (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: Redis;
  let hashContrasena: string;
  let token: string;
  let bodegaId: number;
  let origenId: number;
  let destinoId: number;
  let formatoId: number;
  const correosCreados: string[] = [];

  const unico = () => randomUUID().slice(0, 8);

  /** Crea una cuenta con ese rol, inicia sesión y devuelve su token de acceso. */
  const tokenDe = async (rol: Rol) => {
    const email = `e2e-ajustes-${randomUUID()}@prueba.cl`;
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

  const ajusteValido = (cantidad: number) => ({
    formatoId,
    ubicacionId: origenId,
    cantidad,
    observacion: 'Conteo físico del 25 de octubre',
  });

  const transferenciaValida = (cantidad = 4) => ({
    formatoId,
    ubicacionOrigenId: origenId,
    ubicacionDestinoId: destinoId,
    cantidad,
  });

  const enviar = (ruta: string, cuerpo: object, con = token) =>
    request(app.getHttpServer())
      .post(ruta)
      .auth(con, { type: 'bearer' })
      .send(cuerpo);

  const ajustar = (cuerpo: object, con = token) =>
    enviar(RUTA_AJUSTES, cuerpo, con);
  const transferir = (cuerpo: object, con = token) =>
    enviar(RUTA_TRANSFERENCIAS, cuerpo, con);

  const conStock = (ubicacionId: number, cantidad: number) =>
    prisma.existencia.create({ data: { formatoId, ubicacionId, cantidad } });

  const stock = async (ubicacionId: number) =>
    (
      await prisma.existencia.findUnique({
        where: { formatoId_ubicacionId: { formatoId, ubicacionId } },
      })
    )?.cantidad ?? 0;

  const movimientos = () =>
    prisma.movimientoInventario.findMany({ where: { formatoId } });

  const mensajeDe = (cuerpo: unknown) =>
    (cuerpo as { message: string | string[] }).message;

  const limpiar = async () => {
    const formatosPrueba = {
      formato: { articulo: { sku: { startsWith: PREFIJO } } },
    };
    await prisma.movimientoInventario.deleteMany({ where: formatosPrueba });
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
      create: { codigoCut: REGION, nombre: 'Región de prueba ajustes' },
    });
    await prisma.comuna.upsert({
      where: { codigoCut: COMUNA },
      update: {},
      create: {
        codigoCut: COMUNA,
        nombre: 'Comuna de prueba ajustes',
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
    bodegaId = (
      await prisma.bodega.create({
        data: {
          nombre: `${PREFIJO} Tienda`,
          direccion: 'Calle de prueba 300',
          tipo: 'tienda',
          comunaId: comuna.id,
        },
      })
    ).id;
    origenId = (
      await prisma.ubicacion.create({
        data: { bodegaId, codigo: 'BODEGA-1' },
      })
    ).id;
    destinoId = (
      await prisma.ubicacion.create({
        data: { bodegaId, codigo: 'GONDOLA-1' },
      })
    ).id;
    const categoriaId = (
      await prisma.categoria.create({
        data: { nombre: `${PREFIJO} Cat ${unico()}` },
      })
    ).id;
    formatoId = await nuevoFormato(categoriaId);
    token = await tokenDe(ROLES.BODEGUERO);
  });

  afterAll(async () => {
    // Los movimientos apuntan a la cuenta que los registró: primero ellos
    await limpiar();
    await prisma.usuario.deleteMany({
      where: { email: { in: correosCreados } },
    });
    await prisma.comuna.deleteMany({ where: { codigoCut: COMUNA } });
    await prisma.region.deleteMany({ where: { codigoCut: REGION } });
    await app.close();
  });

  describe('ajustes', () => {
    it('E11-H4 · ajuste positivo: suma el stock y deja un movimiento ajuste_positivo con el motivo', async () => {
      await conStock(origenId, 10);

      const respuesta = await ajustar(ajusteValido(3)).expect(201);
      const ajuste = respuesta.body as AjusteRespuesta;

      expect(await stock(origenId)).toBe(13);
      expect(ajuste).toMatchObject({
        tipo: TIPOS_MOVIMIENTO.AJUSTE_POSITIVO,
        cantidad: 3,
        stockResultante: 13,
      });
      expect(await movimientos()).toEqual([
        expect.objectContaining({
          id: ajuste.movimientoId,
          tipo: TIPOS_MOVIMIENTO.AJUSTE_POSITIVO,
          cantidad: 3,
          ubicacionOrigenId: null,
          ubicacionDestinoId: origenId,
          observacion: 'Conteo físico del 25 de octubre',
        }),
      ]);
    });

    it('E11-H4 · ajuste positivo: crea la existencia si la ubicación no tenía stock del formato', async () => {
      await ajustar(ajusteValido(2)).expect(201);

      expect(await stock(origenId)).toBe(2);
    });

    it('E11-H4 · ajuste negativo: descuenta el stock y deja un movimiento ajuste_negativo con la cantidad sin signo', async () => {
      await conStock(origenId, 10);

      const respuesta = await ajustar(ajusteValido(-10)).expect(201);

      expect(await stock(origenId)).toBe(0);
      expect(respuesta.body).toMatchObject({
        tipo: TIPOS_MOVIMIENTO.AJUSTE_NEGATIVO,
        cantidad: -10,
        stockResultante: 0,
      });
      expect(await movimientos()).toEqual([
        expect.objectContaining({
          tipo: TIPOS_MOVIMIENTO.AJUSTE_NEGATIVO,
          cantidad: 10,
          ubicacionOrigenId: origenId,
          ubicacionDestinoId: null,
        }),
      ]);
    });

    it('E11-H4 · ajuste negativo mayor que el stock: lo rechaza, el stock no cambia y no queda movimiento', async () => {
      await conStock(origenId, 3);

      const respuesta = await ajustar(ajusteValido(-5)).expect(400);

      expect(mensajeDe(respuesta.body)).toBe(
        'No hay stock suficiente en esa ubicación: hay 3 y el ajuste es de 5.',
      );
      expect(await stock(origenId)).toBe(3);
      expect(await movimientos()).toHaveLength(0);
    });

    it('E11-H4 · ajuste de stock: rechaza la cantidad 0 y la falta de motivo', async () => {
      await conStock(origenId, 3);

      await ajustar(ajusteValido(0)).expect(400);
      const respuesta = await ajustar({
        ...ajusteValido(1),
        observacion: '  ',
      }).expect(400);
      expect(mensajeDe(respuesta.body)).toEqual([
        'El motivo del ajuste es obligatorio.',
      ]);
      expect(await stock(origenId)).toBe(3);
    });

    it('E11-H4 · ajuste de stock: se admite en una ubicación desactivada', async () => {
      await conStock(origenId, 4);
      await prisma.ubicacion.update({
        where: { id: origenId },
        data: { activa: false },
      });

      await ajustar(ajusteValido(-4)).expect(201);
      expect(await stock(origenId)).toBe(0);
    });

    it('RNF-03 · ajustes: sin sesión responde 401 y con un rol sin permiso de inventario 403', async () => {
      await request(app.getHttpServer())
        .post(RUTA_AJUSTES)
        .send(ajusteValido(1))
        .expect(401);

      for (const rol of [ROLES.VENDEDOR, ROLES.CLIENTE, ROLES.PROFESIONAL]) {
        await ajustar(ajusteValido(1), await tokenDe(rol)).expect(403);
      }
      await ajustar(ajusteValido(1), await tokenDe(ROLES.ADMINISTRADOR)).expect(
        201,
      );
      expect(await stock(origenId)).toBe(1);
    });
  });

  describe('transferencias', () => {
    it('E11-H4 · transferencia: resta en el origen, suma en el destino y deja un movimiento con ambas ubicaciones', async () => {
      await conStock(origenId, 10);
      await conStock(destinoId, 1);

      const respuesta = await transferir({
        ...transferenciaValida(4),
        observacion: 'Reposición de la góndola',
      }).expect(201);
      const transferencia = respuesta.body as TransferenciaRespuesta;

      expect(await stock(origenId)).toBe(6);
      expect(await stock(destinoId)).toBe(5);
      expect(transferencia).toMatchObject({
        origen: { id: origenId, stock: 6 },
        destino: { id: destinoId, stock: 5 },
        cantidad: 4,
      });
      expect(await movimientos()).toEqual([
        expect.objectContaining({
          id: transferencia.movimientoId,
          tipo: TIPOS_MOVIMIENTO.TRANSFERENCIA,
          cantidad: 4,
          ubicacionOrigenId: origenId,
          ubicacionDestinoId: destinoId,
          observacion: 'Reposición de la góndola',
        }),
      ]);
    });

    it('E11-H4 · transferencia: crea la existencia del destino y puede vaciar un origen desactivado', async () => {
      await conStock(origenId, 4);
      await prisma.ubicacion.update({
        where: { id: origenId },
        data: { activa: false },
      });

      await transferir(transferenciaValida(4)).expect(201);

      expect(await stock(origenId)).toBe(0);
      expect(await stock(destinoId)).toBe(4);
    });

    it('E11-H4 · transferencia: se admite hacia una ubicación de otra bodega', async () => {
      await conStock(origenId, 4);
      const otraBodega = await prisma.bodega.create({
        data: {
          nombre: `${PREFIJO} Bodega central`,
          direccion: 'Calle de prueba 301',
          tipo: 'bodega',
          comunaId: (
            await prisma.bodega.findUniqueOrThrow({ where: { id: bodegaId } })
          ).comunaId,
        },
      });
      const lejana = await prisma.ubicacion.create({
        data: { bodegaId: otraBodega.id, codigo: 'RACK-1' },
      });

      await transferir({
        ...transferenciaValida(3),
        ubicacionDestinoId: lejana.id,
      }).expect(201);
      expect(await stock(lejana.id)).toBe(3);
    });

    it('E11-H4 · transferencia sin stock: la rechaza y ni el origen ni el destino cambian', async () => {
      await conStock(origenId, 3);
      await conStock(destinoId, 2);

      const respuesta = await transferir(transferenciaValida(5)).expect(400);

      expect(mensajeDe(respuesta.body)).toBe(
        'No hay stock suficiente en esa ubicación: hay 3 y la transferencia es de 5.',
      );
      expect(await stock(origenId)).toBe(3);
      expect(await stock(destinoId)).toBe(2);
      expect(await movimientos()).toHaveLength(0);
    });

    it('E11-H4 · transferencia sin stock: también se rechaza en sentido inverso (destino con id menor) sin crear la existencia del destino', async () => {
      // Con el destino de id menor se suma antes de descontar: la transacción debe deshacerlo
      await conStock(destinoId, 1);

      await transferir({
        ...transferenciaValida(2),
        ubicacionOrigenId: destinoId,
        ubicacionDestinoId: origenId,
      }).expect(400);

      expect(await stock(destinoId)).toBe(1);
      expect(
        await prisma.existencia.findUnique({
          where: {
            formatoId_ubicacionId: { formatoId, ubicacionId: origenId },
          },
        }),
      ).toBeNull();
      expect(await movimientos()).toHaveLength(0);
    });

    it('E11-H4 · transferencia: rechaza un destino desactivado y el mismo origen y destino', async () => {
      await conStock(origenId, 5);

      const misma = await transferir({
        ...transferenciaValida(1),
        ubicacionDestinoId: origenId,
      }).expect(400);
      expect(mensajeDe(misma.body)).toBe(
        'La ubicación de destino debe ser distinta de la de origen.',
      );

      await prisma.bodega.update({
        where: { id: bodegaId },
        data: { activa: false },
      });
      const inactivo = await transferir(transferenciaValida(1)).expect(400);
      expect(mensajeDe(inactivo.body)).toBe(
        'La ubicación o su bodega está desactivada: elige otra ubicación.',
      );
      expect(await stock(origenId)).toBe(5);
      expect(await movimientos()).toHaveLength(0);
    });

    it('RNF-13 · dos transferencias simultáneas por el último stock: solo una se registra', async () => {
      await conStock(origenId, 5);

      const respuestas = await Promise.all([
        transferir(transferenciaValida(3)),
        transferir(transferenciaValida(3)),
      ]);

      expect(respuestas.map((r) => r.status).sort((a, b) => a - b)).toEqual([
        201, 400,
      ]);
      expect(await stock(origenId)).toBe(2);
      expect(await stock(destinoId)).toBe(3);
      expect(await movimientos()).toHaveLength(1);
    });

    it('RNF-13 · dos transferencias cruzadas simultáneas (A→B y B→A): las dos se registran sin bloquearse', async () => {
      await conStock(origenId, 5);
      await conStock(destinoId, 5);

      const respuestas = await Promise.all([
        transferir(transferenciaValida(2)),
        transferir({
          ...transferenciaValida(3),
          ubicacionOrigenId: destinoId,
          ubicacionDestinoId: origenId,
        }),
      ]);

      expect(respuestas.map((r) => r.status)).toEqual([201, 201]);
      expect(await stock(origenId)).toBe(6);
      expect(await stock(destinoId)).toBe(4);
    });

    it('RNF-03 · transferencias: sin sesión responde 401 y con un rol sin permiso de inventario 403', async () => {
      await conStock(origenId, 10);
      await request(app.getHttpServer())
        .post(RUTA_TRANSFERENCIAS)
        .send(transferenciaValida())
        .expect(401);

      for (const rol of [ROLES.VENDEDOR, ROLES.CLIENTE, ROLES.PROFESIONAL]) {
        await transferir(transferenciaValida(), await tokenDe(rol)).expect(403);
      }
      await transferir(
        transferenciaValida(),
        await tokenDe(ROLES.ADMINISTRADOR),
      ).expect(201);
      expect(await stock(origenId)).toBe(6);
    });
  });
});
