import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import argon2 from 'argon2';
import type { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { ROLES, type Rol } from '../src/common/dominio/roles.js';
import { ESTADOS_SOLICITUD } from '../src/common/dominio/valores.js';
import { configurarApp } from '../src/configurar-app.js';
import type {
  ClienteDetalleDto,
  ListadoClientesDto,
} from '../src/modulos/personal/dto/cliente-respuesta.dto.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { REDIS } from '../src/redis/redis.module.js';

// Requiere PostgreSQL y Redis levantados: `docker compose up -d db redis`. La base es compartida:
// cada búsqueda usa una marca única en el apellido para ver solo las cuentas de esta prueba.

const CONTRASENA = 'Secreta123';
const PREFIJO_CORREO = 'e2e-clientes-';
/** Ruta de quien compra: con sesión vigente responde 200. */
const RUTA_COMPRADOR = '/api/cuentas/yo';

/** RUT válido al azar (el RUT es único en la base compartida), normalizado y con puntos. */
const rutAleatorio = () => {
  const cuerpo = String(30_000_000 + Math.floor(Math.random() * 9_000_000));
  let suma = 0;
  let factor = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const resto = 11 - (suma % 11);
  const digito = resto === 11 ? '0' : resto === 10 ? 'K' : String(resto);
  return {
    rut: `${cuerpo}-${digito}`,
    conPuntos: `${cuerpo.slice(0, 2)}.${cuerpo.slice(2, 5)}.${cuerpo.slice(5)}-${digito}`,
  };
};

interface Sesion {
  id: number;
  email: string;
  codigoPublico: string;
  token: string;
}

describe('Clientes · gestionar clientes y profesionales (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: Redis;
  let hashContrasena: string;
  let admin: Sesion;

  const servidor = () => request(app.getHttpServer());

  const iniciar = (email: string) =>
    servidor()
      .post('/api/cuentas/sesion')
      .send({ email, contrasena: CONTRASENA });

  const cuenta = async (
    rol: Rol,
    datos: { apellido?: string; rut?: string; activo?: boolean } = {},
  ): Promise<Sesion> => {
    const email = `${PREFIJO_CORREO}${randomUUID()}@prueba.cl`;
    const usuario = await prisma.usuario.create({
      data: {
        codigoPublico: randomUUID(),
        nombre: 'Andrea',
        apellido: datos.apellido ?? 'Soto',
        email,
        rut: datos.rut,
        contrasenaHash: hashContrasena,
        rol,
        fechaVerificacionCorreo: new Date(),
        activo: datos.activo ?? true,
      },
    });
    const token =
      datos.activo === false
        ? ''
        : ((await iniciar(email).expect(200)).body as { tokenAcceso: string })
            .tokenAcceso;
    return {
      id: usuario.id,
      email,
      codigoPublico: usuario.codigoPublico,
      token,
    };
  };

  const obtener = (ruta: string, token: string = admin.token) =>
    servidor().get(ruta).auth(token, { type: 'bearer' });

  const accion = (
    codigo: string,
    nombre: 'desactivar' | 'reactivar',
    token: string = admin.token,
  ) =>
    servidor()
      .post(`/api/clientes/${codigo}/${nombre}`)
      .auth(token, { type: 'bearer' });

  const listar = async (consulta: string) =>
    (await obtener(`/api/clientes?${consulta}`).expect(200))
      .body as ListadoClientesDto;

  const limpiar = async () => {
    const deCuenta = { email: { startsWith: PREFIJO_CORREO } };
    await prisma.historialRol.deleteMany({
      where: { OR: [{ usuario: deCuenta }, { responsable: deCuenta }] },
    });
    await prisma.solicitudVerificacion.deleteMany({
      where: { solicitante: deCuenta },
    });
    await prisma.usuario.deleteMany({ where: deCuenta });
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
  });

  // Todas las peticiones salen de la misma IP: cada prueba parte sin contadores
  beforeEach(async () => {
    const claves = await redis.keys('limite:*');
    if (claves.length) await redis.del(...claves);
    admin = await cuenta(ROLES.ADMINISTRADOR);
  });

  afterAll(async () => {
    await limpiar();
    await app.close();
  });

  it('RNF-03 · solo el administrador gestiona clientes: sin sesión 401; vendedor, bodeguero o profesional 403', async () => {
    const objetivo = await cuenta(ROLES.CLIENTE);
    await servidor().get('/api/clientes').expect(401);
    for (const rol of [ROLES.VENDEDOR, ROLES.BODEGUERO, ROLES.PROFESIONAL]) {
      const otra = await cuenta(rol);
      await obtener('/api/clientes', otra.token).expect(403);
      await obtener(
        `/api/clientes/${objetivo.codigoPublico}`,
        otra.token,
      ).expect(403);
      await accion(objetivo.codigoPublico, 'desactivar', otra.token).expect(
        403,
      );
    }
    const guardada = await prisma.usuario.findUniqueOrThrow({
      where: { id: objetivo.id },
    });
    expect(guardada.activo).toBe(true);
  });

  it('E13-H4 · listado: solo clientes y profesionales, filtrados por rol y estado, con los conteos', async () => {
    const marca = `Marca${randomUUID().slice(0, 8)}`;
    const cliente = await cuenta(ROLES.CLIENTE, { apellido: marca });
    const profesional = await cuenta(ROLES.PROFESIONAL, { apellido: marca });
    const desactivado = await cuenta(ROLES.CLIENTE, {
      apellido: marca,
      activo: false,
    });
    await cuenta(ROLES.VENDEDOR, { apellido: marca });

    const todos = await listar(`buscar=${marca}`);
    expect(todos.items.map((c) => c.codigoPublico)).toEqual([
      desactivado.codigoPublico,
      profesional.codigoPublico,
      cliente.codigoPublico,
    ]);
    expect(todos.conteos).toEqual({
      todos: 3,
      clientes: 2,
      profesionales: 1,
      desactivados: 1,
    });
    expect(todos.items[2]).toEqual({
      codigoPublico: cliente.codigoPublico,
      nombre: 'Andrea',
      apellido: marca,
      email: cliente.email,
      rut: null,
      rol: ROLES.CLIENTE,
      activo: true,
      fechaRegistro: expect.any(String) as unknown,
      correoConfirmado: true,
    });

    const profesionales = await listar(`buscar=${marca}&rol=profesional`);
    expect(profesionales.items.map((c) => c.codigoPublico)).toEqual([
      profesional.codigoPublico,
    ]);
    const inactivos = await listar(`buscar=${marca}&activo=false`);
    expect(inactivos.items.map((c) => c.codigoPublico)).toEqual([
      desactivado.codigoPublico,
    ]);
    const pagina = await listar(`buscar=${marca}&limite=2&pagina=2`);
    expect(pagina).toMatchObject({ total: 3, pagina: 2, limite: 2 });
    expect(pagina.items).toHaveLength(1);
  });

  it('E13-H4 · listado: busca por nombre y apellido, por correo y por RUT con puntos', async () => {
    const marca = `Marca${randomUUID().slice(0, 8)}`;
    const { rut, conPuntos } = rutAleatorio();
    const buscada = await cuenta(ROLES.CLIENTE, { apellido: marca, rut });

    for (const buscar of [`andrea ${marca}`, buscada.email, conPuntos]) {
      const listado = await listar(`buscar=${encodeURIComponent(buscar)}`);
      expect(listado.items.map((c) => c.codigoPublico)).toContain(
        buscada.codigoPublico,
      );
    }
    await obtener('/api/clientes?rol=vendedor').expect(400);
    await obtener('/api/clientes?activo=quizas').expect(400);
  });

  it('E13-H4 · detalle: datos, verificación, pedidos e historial de rol; el personal responde 404', async () => {
    const profesional = await cuenta(ROLES.PROFESIONAL);
    await prisma.solicitudVerificacion.create({
      data: {
        solicitanteId: profesional.id,
        estado: ESTADOS_SOLICITUD.APROBADA,
        fechaResolucion: new Date(),
      },
    });
    await prisma.historialRol.create({
      data: {
        usuarioId: profesional.id,
        responsableId: admin.id,
        rolAnterior: ROLES.CLIENTE,
        rolNuevo: ROLES.PROFESIONAL,
      },
    });

    const detalle = (
      await obtener(`/api/clientes/${profesional.codigoPublico}`).expect(200)
    ).body as ClienteDetalleDto;
    expect(detalle).toMatchObject({
      codigoPublico: profesional.codigoPublico,
      rol: ROLES.PROFESIONAL,
      perfilProfesional: null,
      verificacion: { estado: ESTADOS_SOLICITUD.APROBADA },
      pedidos: 0,
      historialRol: [
        {
          rolAnterior: ROLES.CLIENTE,
          rolNuevo: ROLES.PROFESIONAL,
          motivo: null,
          responsable: 'Andrea Soto',
        },
      ],
    });

    const vendedor = await cuenta(ROLES.VENDEDOR);
    await obtener(`/api/clientes/${vendedor.codigoPublico}`).expect(404);
    await obtener(`/api/clientes/${randomUUID()}`).expect(404);
    await obtener('/api/clientes/no-es-uuid').expect(400);
  });

  it('E13-H4 · desactivar: cierra sus sesiones y no puede iniciar sesión; repetir no cambia nada', async () => {
    const cliente = await cuenta(ROLES.CLIENTE);
    await obtener(RUTA_COMPRADOR, cliente.token).expect(200);

    await accion(cliente.codigoPublico, 'desactivar').expect(204);
    await obtener(RUTA_COMPRADOR, cliente.token).expect(401);
    // Credenciales correctas de una cuenta desactivada: 403 «Tu cuenta está desactivada.»
    await iniciar(cliente.email).expect(403);
    await accion(cliente.codigoPublico, 'desactivar').expect(204);

    const guardada = await prisma.usuario.findUniqueOrThrow({
      where: { id: cliente.id },
    });
    expect(guardada.activo).toBe(false);
  });

  it('E13-H4 · reactivar: vuelve a entrar con su contraseña; la sesión anterior sigue cerrada', async () => {
    const profesional = await cuenta(ROLES.PROFESIONAL);
    await accion(profesional.codigoPublico, 'desactivar').expect(204);

    await accion(profesional.codigoPublico, 'reactivar').expect(204);
    await obtener(RUTA_COMPRADOR, profesional.token).expect(401);
    const { tokenAcceso } = (await iniciar(profesional.email).expect(200))
      .body as { tokenAcceso: string };
    await obtener(RUTA_COMPRADOR, tokenAcceso).expect(200);
    await accion(profesional.codigoPublico, 'reactivar').expect(204);
  });

  it('E13-H4 · alcance: desactivar o reactivar una cuenta del personal responde 404 sin cambios', async () => {
    const vendedor = await cuenta(ROLES.VENDEDOR, { activo: false });
    await accion(vendedor.codigoPublico, 'reactivar').expect(404);
    await accion(admin.codigoPublico, 'desactivar').expect(404);
    const guardada = await prisma.usuario.findUniqueOrThrow({
      where: { id: vendedor.id },
    });
    expect(guardada.activo).toBe(false);
  });
});
