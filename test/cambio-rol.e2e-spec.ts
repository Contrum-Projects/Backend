import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import argon2 from 'argon2';
import type { Job, Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import {
  COLAS,
  TRABAJOS_CORREO,
  type TrabajoRolProfesionalRetirado,
} from '../src/colas/colas.js';
import { precioConIva } from '../src/common/dominio/montos.js';
import { ROLES, type Rol } from '../src/common/dominio/roles.js';
import {
  CANALES_VENTA,
  ESTADOS_NOTIFICACION,
  ESTADOS_PEDIDO,
  ORIGENES_DESCRIPCION,
  TIPOS_ARTICULO,
  TIPOS_NOTIFICACION,
  TIPOS_PRECIO,
} from '../src/common/dominio/valores.js';
import { configurarApp } from '../src/configurar-app.js';
import type { CarritoCuenta } from '../src/modulos/carrito/carrito.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { REDIS } from '../src/redis/redis.module.js';

// Requiere PostgreSQL y Redis levantados: `docker compose up -d db redis`. El worker de correos está
// apagado en los e2e: el correo se lee desde la cola.
//
// El criterio 3 (último administrador) se prueba en `cambio-rol.service.spec.ts`: aquí la base
// compartida tiene otros administradores activos (el de desarrollo) y no se pueden desactivar.

const CONTRASENA = 'Secreta123';
const PREFIJO_CORREO = 'e2e-cambio-rol-';
const PREFIJO = 'E2E-cambio-rol';
const MINORISTA_NETO = 10000;
const MAYORISTA_NETO = 8000;
const MOTIVO = 'Dejó de ejercer como peluquera según nos informó.';
/** Ruta que solo el administrador puede usar (`personal.gestionar`). */
const RUTA_SOLO_ADMIN = '/api/personal';
/** Ruta de quien compra: el profesional que sigue con sesión responde 200. */
const RUTA_COMPRADOR = '/api/cuentas/yo';
/** Ruta que el vendedor puede usar (`inventario.consultar`). */
const RUTA_VENDEDOR = '/api/inventario/stock/formatos';

interface Sesion {
  id: number;
  email: string;
  codigoPublico: string;
  token: string;
}

describe('Personal · bajar el rol de una cuenta (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: Redis;
  let correos: Queue<TrabajoRolProfesionalRetirado>;
  let hashContrasena: string;
  let porcentajeIva: number;
  let articuloGeneral: number;
  let articuloExclusivo: number;
  let admin: Sesion;
  const correosCreados: string[] = [];

  const servidor = () => request(app.getHttpServer());

  const iniciar = async (email: string): Promise<string> =>
    (
      (
        await servidor()
          .post('/api/cuentas/sesion')
          .send({ email, contrasena: CONTRASENA })
          .expect(200)
      ).body as { tokenAcceso: string }
    ).tokenAcceso;

  const cuenta = async (rol: Rol): Promise<Sesion> => {
    const email = `${PREFIJO_CORREO}${randomUUID()}@prueba.cl`;
    correosCreados.push(email);
    const usuario = await prisma.usuario.create({
      data: {
        codigoPublico: randomUUID(),
        nombre: 'Andrea',
        apellido: 'Soto',
        email,
        contrasenaHash: hashContrasena,
        rol,
        fechaVerificacionCorreo: new Date(),
      },
    });
    return {
      id: usuario.id,
      email,
      codigoPublico: usuario.codigoPublico,
      token: await iniciar(email),
    };
  };

  const cambiarRol = (
    codigo: string,
    cuerpo: object,
    token: string = admin.token,
  ) =>
    servidor()
      .patch(`/api/cuentas/${codigo}/rol`)
      .auth(token, { type: 'bearer' })
      .send(cuerpo);

  const obtener = (ruta: string, token: string) =>
    servidor().get(ruta).auth(token, { type: 'bearer' });

  const crearFormato = async (
    nombre: string,
    canalVenta: string,
    precioMinoristaNeto: number | null,
  ): Promise<number> => {
    const categoria = await prisma.categoria.create({
      data: { nombre: `${PREFIJO} ${nombre} ${randomUUID().slice(0, 6)}` },
    });
    const producto = await prisma.producto.create({
      data: {
        nombre: `${PREFIJO} ${nombre}`,
        descripcion: 'Producto de prueba.',
        origenDescripcion: ORIGENES_DESCRIPCION.MANUAL,
        canalVenta,
        categoriaId: categoria.id,
      },
    });
    const articulo = await prisma.articuloVenta.create({
      data: {
        sku: `${PREFIJO}-${randomUUID().slice(0, 8)}`,
        tipo: TIPOS_ARTICULO.FORMATO,
        precioMinoristaNeto,
        precioMayoristaNeto: MAYORISTA_NETO,
      },
    });
    await prisma.imagenArticulo.create({
      data: {
        articuloId: articulo.id,
        ubicacionArchivo: `articulos/${articulo.id}/principal.jpg`,
        orden: 1,
        esPrincipal: true,
      },
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

  const trabajosDe = async (email: string) => {
    const trabajos: Job<TrabajoRolProfesionalRetirado>[] =
      await correos.getJobs(['prioritized', 'waiting', 'delayed']);
    return trabajos.filter((t) => t.data?.destinatario === email);
  };

  const limpiarCorreos = async () => {
    const trabajos: Job<TrabajoRolProfesionalRetirado>[] =
      await correos.getJobs(['prioritized', 'waiting', 'delayed']);
    await Promise.all(
      trabajos
        .filter((t) => t.data?.destinatario?.startsWith(PREFIJO_CORREO))
        .map((t) => t.remove()),
    );
  };

  const limpiar = async () => {
    const deCuenta = { email: { startsWith: PREFIJO_CORREO } };
    await prisma.historialRol.deleteMany({
      where: { OR: [{ usuario: deCuenta }, { responsable: deCuenta }] },
    });
    await prisma.notificacion.deleteMany({ where: { usuario: deCuenta } });
    await prisma.pedido.deleteMany({ where: { usuario: deCuenta } });
    await prisma.usuario.deleteMany({ where: deCuenta });
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
    correos = app.get(getQueueToken(COLAS.CORREOS));
    porcentajeIva = app.get(ConfigService).get<number>('IVA_PORCENTAJE')!;
    hashContrasena = await argon2.hash(CONTRASENA);
    await limpiarCorreos();
    await limpiar();

    articuloGeneral = await crearFormato(
      'Shampoo',
      CANALES_VENTA.GENERAL,
      MINORISTA_NETO,
    );
    // El exclusivo solo necesita el precio mayorista (E2-H4)
    articuloExclusivo = await crearFormato(
      'Tratamiento profesional',
      CANALES_VENTA.PROFESIONAL,
      null,
    );
  });

  // Todas las peticiones salen de la misma IP: cada prueba parte sin contadores
  beforeEach(async () => {
    const claves = await redis.keys('limite:*');
    if (claves.length) await redis.del(...claves);
    admin = await cuenta(ROLES.ADMINISTRADOR);
  });

  afterAll(async () => {
    await limpiarCorreos();
    await limpiar();
    await app.close();
  });

  describe('permisos', () => {
    it('E13-H3 · sin sesión responde 401', async () => {
      await servidor()
        .patch(`/api/cuentas/${randomUUID()}/rol`)
        .send({ rol: ROLES.VENDEDOR })
        .expect(401);
    });

    it('E13-H3 · el personal sin permiso de gestionar cuentas y el profesional reciben 403', async () => {
      const objetivo = await cuenta(ROLES.ADMINISTRADOR);
      for (const rol of [ROLES.VENDEDOR, ROLES.BODEGUERO, ROLES.PROFESIONAL]) {
        const otra = await cuenta(rol);
        await cambiarRol(
          objetivo.codigoPublico,
          { rol: ROLES.VENDEDOR },
          otra.token,
        ).expect(403);
      }
      const guardada = await prisma.usuario.findUniqueOrThrow({
        where: { id: objetivo.id },
      });
      expect(guardada.rol).toBe(ROLES.ADMINISTRADOR);
    });
  });

  describe('rol del personal degradado (criterio 1)', () => {
    it('E13-H3 · rol del personal degradado: guarda el rol, registra quién y cuándo, y le niega lo que el rol nuevo no permite', async () => {
      const otroAdmin = await cuenta(ROLES.ADMINISTRADOR);
      const antes = new Date();

      const respuesta = await cambiarRol(otroAdmin.codigoPublico, {
        rol: ROLES.VENDEDOR,
      }).expect(200);

      expect(respuesta.body).toMatchObject({
        codigoPublico: otroAdmin.codigoPublico,
        rolAnterior: ROLES.ADMINISTRADOR,
        rol: ROLES.VENDEDOR,
      });
      const guardada = await prisma.usuario.findUniqueOrThrow({
        where: { id: otroAdmin.id },
      });
      expect(guardada.rol).toBe(ROLES.VENDEDOR);
      const historial = await prisma.historialRol.findMany({
        where: { usuarioId: otroAdmin.id },
      });
      expect(historial).toHaveLength(1);
      expect(historial[0]).toMatchObject({
        responsableId: admin.id,
        rolAnterior: ROLES.ADMINISTRADOR,
        rolNuevo: ROLES.VENDEDOR,
        motivo: null,
      });
      expect(historial[0].fechaCambio.getTime()).toBeGreaterThanOrEqual(
        antes.getTime() - 1000,
      );

      // Con una sesión nueva entra como vendedor: lo del vendedor sí, el panel del personal no
      const token = await iniciar(otroAdmin.email);
      await obtener(RUTA_SOLO_ADMIN, token).expect(403);
      await obtener(`${RUTA_VENDEDOR}/${articuloGeneral}`, token).expect(200);
    });

    it('E13-H3 · el administrador puede bajarse a sí mismo si hay otro activo, y pierde el acceso de inmediato', async () => {
      await cambiarRol(admin.codigoPublico, { rol: ROLES.BODEGUERO }).expect(
        200,
      );

      await obtener(RUTA_SOLO_ADMIN, admin.token).expect(401);
      const token = await iniciar(admin.email);
      await obtener(RUTA_SOLO_ADMIN, token).expect(403);
    });

    it('E13-H3 · cambios que no bajan el rol responden 409 y no cambian nada', async () => {
      const vendedor = await cuenta(ROLES.VENDEDOR);
      const cliente = await cuenta(ROLES.CLIENTE);

      await cambiarRol(vendedor.codigoPublico, {
        rol: ROLES.BODEGUERO,
      }).expect(409);
      await cambiarRol(cliente.codigoPublico, {
        rol: ROLES.CLIENTE,
        motivo: MOTIVO,
      }).expect(409);

      // Las sesiones siguen abiertas: no hubo cambio
      await obtener(
        `${RUTA_VENDEDOR}/${articuloGeneral}`,
        vendedor.token,
      ).expect(200);
      expect(
        await prisma.historialRol.count({
          where: { usuarioId: { in: [vendedor.id, cliente.id] } },
        }),
      ).toBe(0);
    });

    it('E13-H3 · un rol de destino no permitido responde 400 y una cuenta inexistente 404', async () => {
      const otroAdmin = await cuenta(ROLES.ADMINISTRADOR);

      await cambiarRol(otroAdmin.codigoPublico, {
        rol: ROLES.PROFESIONAL,
      }).expect(400);
      await cambiarRol(randomUUID(), { rol: ROLES.VENDEDOR }).expect(404);
      await cambiarRol('no-es-uuid', { rol: ROLES.VENDEDOR }).expect(400);
    });
  });

  describe('sesiones abiertas (criterio 2)', () => {
    it('E13-H3 · sesiones abiertas: la siguiente petición con el token anterior se rechaza en todos los dispositivos', async () => {
      const otroAdmin = await cuenta(ROLES.ADMINISTRADOR);
      const segundoDispositivo = await iniciar(otroAdmin.email);
      await obtener(RUTA_SOLO_ADMIN, otroAdmin.token).expect(200);
      await obtener(RUTA_SOLO_ADMIN, segundoDispositivo).expect(200);

      await cambiarRol(otroAdmin.codigoPublico, {
        rol: ROLES.VENDEDOR,
      }).expect(200);

      for (const token of [otroAdmin.token, segundoDispositivo]) {
        await obtener(RUTA_SOLO_ADMIN, token).expect(401);
      }
    });
  });

  describe('profesional que vuelve a cliente (criterios 4 y 5)', () => {
    it('E13-H3 · profesional que vuelve a cliente: sin motivo responde 400 y sigue siendo profesional', async () => {
      const profesional = await cuenta(ROLES.PROFESIONAL);

      await cambiarRol(profesional.codigoPublico, {
        rol: ROLES.CLIENTE,
      }).expect(400);

      await obtener(RUTA_COMPRADOR, profesional.token).expect(200);
      const guardada = await prisma.usuario.findUniqueOrThrow({
        where: { id: profesional.id },
      });
      expect(guardada.rol).toBe(ROLES.PROFESIONAL);
    });

    it('E13-H3 · profesional que vuelve a cliente: carrito a precio minorista sin los exclusivos, sin mayorista, y correo con el motivo', async () => {
      const profesional = await cuenta(ROLES.PROFESIONAL);
      await prisma.carrito.create({
        data: {
          usuarioId: profesional.id,
          items: {
            create: [
              { articuloId: articuloGeneral, cantidad: 2 },
              { articuloId: articuloExclusivo, cantidad: 1 },
            ],
          },
        },
      });

      await cambiarRol(profesional.codigoPublico, {
        rol: ROLES.CLIENTE,
        motivo: `  ${MOTIVO}  `,
      }).expect(200);

      // El token de profesional ya no sirve: vuelve a entrar y el rol se lee de la base
      await obtener('/api/carrito', profesional.token).expect(401);
      const token = await iniciar(profesional.email);
      const carrito = (await obtener('/api/carrito', token).expect(200))
        .body as CarritoCuenta;
      expect(carrito.items.map((i) => i.articuloId)).toEqual([articuloGeneral]);
      const precio = precioConIva(MINORISTA_NETO, porcentajeIva);
      expect(carrito.items[0]).toMatchObject({
        precioUnitario: precio,
        subtotal: precio * 2,
      });
      expect(JSON.stringify(carrito)).not.toContain('precioMayorista');

      // El catálogo ya no le muestra el exclusivo ni el mayorista
      const producto = await prisma.formatoProducto.findUniqueOrThrow({
        where: { id: articuloExclusivo },
      });
      await obtener(
        `/api/tienda/productos/${producto.productoId}`,
        token,
      ).expect(404);

      // Historial con el motivo recortado y correo registrado y encolado, sin el motivo en Redis
      const [cambio] = await prisma.historialRol.findMany({
        where: { usuarioId: profesional.id },
      });
      expect(cambio).toMatchObject({
        rolAnterior: ROLES.PROFESIONAL,
        rolNuevo: ROLES.CLIENTE,
        motivo: MOTIVO,
        responsableId: admin.id,
      });
      const [notificacion, ...otras] = await prisma.notificacion.findMany({
        where: {
          usuarioId: profesional.id,
          tipo: TIPOS_NOTIFICACION.ROL_PROFESIONAL_RETIRADO,
        },
      });
      expect(otras).toHaveLength(0);
      expect(notificacion).toMatchObject({
        estadoEnvio: ESTADOS_NOTIFICACION.PENDIENTE,
        asunto: 'Tu cuenta volvió a ser de cliente',
      });
      const trabajos = await trabajosDe(profesional.email);
      expect(trabajos).toHaveLength(1);
      expect(trabajos[0].name).toBe(TRABAJOS_CORREO.ROL_PROFESIONAL_RETIRADO);
      expect(trabajos[0].data).toEqual({
        notificacionId: notificacion.id,
        destinatario: profesional.email,
        nombre: 'Andrea',
      });
    });

    it('E13-H3 · pedidos ya creados: el pedido a precio mayorista conserva sus montos y el tipo de precio de sus líneas', async () => {
      const profesional = await cuenta(ROLES.PROFESIONAL);
      const pedido = await prisma.pedido.create({
        data: {
          codigoPublico: randomUUID()
            .replace(/-/g, '')
            .slice(0, 12)
            .toUpperCase(),
          usuarioId: profesional.id,
          fechaExpiracionPago: new Date(Date.now() + 15 * 60_000),
          estadoActual: ESTADOS_PEDIDO.PENDIENTE_PAGO,
          tipoEntrega: 'retiro',
          tipoDocumentoSolicitado: 'boleta',
          porcentajeIva,
          montoNeto: MAYORISTA_NETO,
          montoIva:
            precioConIva(MAYORISTA_NETO, porcentajeIva) - MAYORISTA_NETO,
          montoTotal: precioConIva(MAYORISTA_NETO, porcentajeIva),
          detalles: {
            create: {
              articuloId: articuloGeneral,
              cantidad: 1,
              precioUnitarioNetoAplicado: MAYORISTA_NETO,
              tipoPrecio: TIPOS_PRECIO.MAYORISTA,
            },
          },
        },
        include: { detalles: true },
      });

      await cambiarRol(profesional.codigoPublico, {
        rol: ROLES.CLIENTE,
        motivo: MOTIVO,
      }).expect(200);

      const despues = await prisma.pedido.findUniqueOrThrow({
        where: { id: pedido.id },
        include: { detalles: true },
      });
      expect(despues).toEqual(pedido);
    });
  });
});
