import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import argon2 from 'argon2';
import type { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { COLAS, TRABAJOS_CARRITO_ABANDONADO } from '../src/colas/colas.js';
import { ROLES } from '../src/common/dominio/roles.js';
import {
  CANALES_VENTA,
  ORIGENES_DESCRIPCION,
  TIPOS_ARTICULO,
  TIPOS_NOTIFICACION,
} from '../src/common/dominio/valores.js';
import { configurarApp } from '../src/configurar-app.js';
import { CarritosAbandonadosService } from '../src/modulos/marketing/carritos-abandonados.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// Requiere PostgreSQL y Redis levantados: `docker compose up -d db redis`.
// Con los workers reales: la tarea programada envía el primero; los plazos siguientes se prueban
// llamando al servicio con la hora que tendría el reloj.

const CONTRASENA = 'Secreta123';
const PREFIJO = 'E2E-abandono';
const PREFIJO_CORREO = 'e2e-abandono-';
const HORA = 60 * 60 * 1000;

describe('Marketing · recordatorios de carritos abandonados (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let servicio: CarritosAbandonadosService;
  let hashContrasena: string;
  let articulos: number[];
  /** Formato de un producto exclusivo para profesionales. */
  let exclusivo: number;

  const unico = () => randomUUID().slice(0, 8);
  const mas = (fecha: Date, horas: number) =>
    new Date(fecha.getTime() + horas * HORA);

  /** Cuenta de cliente que acepta ofertas y verificó su correo, con dos artículos en el carrito. */
  const cuentaConCarrito = async (
    carrito: { fechaActualizacion: Date; vacio?: boolean },
    cuenta: { aceptaMarketingEmail?: boolean } = {},
  ) => {
    const lineas = carrito.vacio ? [] : articulos;
    const email = `${PREFIJO_CORREO}${randomUUID()}@prueba.cl`;
    const usuario = await prisma.usuario.create({
      data: {
        codigoPublico: randomUUID(),
        nombre: 'Camila',
        apellido: 'Rojas',
        email,
        contrasenaHash: hashContrasena,
        rol: ROLES.CLIENTE,
        fechaVerificacionCorreo: new Date(),
        aceptaMarketingEmail: cuenta.aceptaMarketingEmail ?? true,
      },
    });
    const { id } = await prisma.carrito.create({
      data: {
        usuarioId: usuario.id,
        fechaActualizacion: carrito.fechaActualizacion,
        items: {
          create: lineas.map((articuloId) => ({ articuloId, cantidad: 1 })),
        },
      },
    });
    return { usuario, carritoId: id };
  };

  const recordatorios = (usuarioId: number) =>
    prisma.notificacion.count({
      where: { usuarioId, tipo: TIPOS_NOTIFICACION.RECORDATORIO_CARRITO },
    });

  const carrito = (id: number) =>
    prisma.carrito.findUniqueOrThrow({ where: { id } });

  const limpiar = async () => {
    await prisma.notificacion.deleteMany({
      where: { usuario: { email: { startsWith: PREFIJO_CORREO } } },
    });
    // El carrito se borra en cascada con la cuenta
    await prisma.usuario.deleteMany({
      where: { email: { startsWith: PREFIJO_CORREO } },
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

  /** Formato a la venta en la tienda: con precio e imagen, de un producto activo. */
  const nuevoFormato = async (
    categoriaId: number,
    canalVenta: string = CANALES_VENTA.GENERAL,
  ) => {
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
      data: {
        sku: `${PREFIJO}-${unico()}`,
        tipo: TIPOS_ARTICULO.FORMATO,
        precioMinoristaNeto: 10000,
        precioMayoristaNeto: 8000,
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
    await prisma.imagenArticulo.create({
      data: {
        articuloId: articulo.id,
        ubicacionArchivo: `articulos/${articulo.id}/principal.jpg`,
        orden: 1,
        esPrincipal: true,
      },
    });
    return articulo.id;
  };

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = configurarApp(modulo.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    servicio = app.get(CarritosAbandonadosService);
    hashContrasena = await argon2.hash(CONTRASENA);
    await limpiar();

    const categoria = await prisma.categoria.create({
      data: { nombre: `${PREFIJO} Cat ${unico()}` },
    });
    articulos = [
      await nuevoFormato(categoria.id),
      await nuevoFormato(categoria.id),
    ];
    exclusivo = await nuevoFormato(categoria.id, CANALES_VENTA.PROFESIONAL);
  });

  afterAll(async () => {
    await limpiar();
    await app.close();
  });

  it('E12-H4 · CA1 serie de recordatorios · RNF-31: con 1 hora sin cambios, la tarea programada registra el abandono y crea el primer recordatorio en menos de 1 minuto', async () => {
    const cambio = new Date(Date.now() - HORA - 60_000);
    const { usuario, carritoId } = await cuentaConCarrito({
      fechaActualizacion: cambio,
    });

    await vi.waitFor(
      async () => expect(await recordatorios(usuario.id)).toBe(1),
      { timeout: 60_000, interval: 500 },
    );
    const registrado = await carrito(carritoId);
    expect(registrado.recordatoriosEnviados).toBe(1);
    expect(registrado.fechaRecordatorio).not.toBeNull();
    // Registrar el recordatorio no cuenta como un cambio del carrito
    expect(registrado.fechaActualizacion).toEqual(cambio);
    const notificacion = await prisma.notificacion.findFirstOrThrow({
      where: { usuarioId: usuario.id },
    });
    expect(notificacion.asunto).toBe('Tus productos te esperan');

    // Los plazos siguientes, con la hora que tendría el reloj
    await servicio.enviarRecordatorios(mas(cambio, 24));
    expect(await recordatorios(usuario.id)).toBe(2);
    await servicio.enviarRecordatorios(mas(cambio, 72));
    expect(await recordatorios(usuario.id)).toBe(3);
    // Hasta tres
    await servicio.enviarRecordatorios(mas(cambio, 90));
    expect(await recordatorios(usuario.id)).toBe(3);
    expect((await carrito(carritoId)).recordatoriosEnviados).toBe(3);
  }, 65_000);

  it('E12-H4 · CA1 serie de recordatorios: sin aceptar publicidad o con el carrito vacío no recibe recordatorios', async () => {
    const cambio = mas(new Date(), -2);
    const sinConsentimiento = await cuentaConCarrito(
      { fechaActualizacion: cambio },
      { aceptaMarketingEmail: false },
    );
    const vacio = await cuentaConCarrito({
      fechaActualizacion: cambio,
      vacio: true,
    });

    await servicio.enviarRecordatorios(mas(cambio, 1));

    expect(await recordatorios(sinConsentimiento.usuario.id)).toBe(0);
    expect(await recordatorios(vacio.usuario.id)).toBe(0);
  });

  it('E12-H4 · RNF-04 · a un cliente no se le recuerda un carrito que solo tiene un producto exclusivo para profesionales', async () => {
    // Fechas futuras: la tarea programada, con el reloj real, no toca este carrito
    const cambio = new Date('2027-03-03T15:00:00.000Z');
    const { usuario, carritoId } = await cuentaConCarrito({
      fechaActualizacion: cambio,
      vacio: true,
    });
    await prisma.itemCarrito.create({
      data: { carritoId, articuloId: exclusivo, cantidad: 1 },
    });

    await servicio.enviarRecordatorios(mas(cambio, 1));

    expect(await recordatorios(usuario.id)).toBe(0);
    expect((await carrito(carritoId)).recordatoriosEnviados).toBe(0);
  });

  it('E12-H4 · CA2 compra o cambio del carrito: si el cliente modifica su carrito, no recibe los recordatorios restantes', async () => {
    const cambio = new Date(Date.now() - HORA - 60_000);
    const { usuario, carritoId } = await cuentaConCarrito({
      fechaActualizacion: cambio,
    });
    await servicio.enviarRecordatorios(new Date());
    expect(await recordatorios(usuario.id)).toBe(1);
    const { fechaRecordatorio } = await carrito(carritoId);

    // Quita un artículo por la API, como lo haría desde la tienda
    const sesion = await request(app.getHttpServer())
      .post('/api/cuentas/sesion')
      .send({ email: usuario.email, contrasena: CONTRASENA })
      .expect(200);
    const { tokenAcceso } = sesion.body as { tokenAcceso: string };
    await request(app.getHttpServer())
      .delete(`/api/carrito/items/${articulos[0]}`)
      .auth(tokenAcceso, { type: 'bearer' })
      .expect(200);

    // El cambio cortó la serie: el carrito quedó modificado después de su inicio
    const modificado = await carrito(carritoId);
    expect(modificado.fechaActualizacion.getTime()).toBeGreaterThan(
      fechaRecordatorio!.getTime(),
    );
    // Para no depender del día en que corre la prueba, lleva las fechas del carrito a un miércoles
    // fijo del futuro, conservando la distancia entre ellas (y la tarea programada no lo toca)
    const miercoles = new Date('2027-03-03T13:00:00.000Z'); // 10:00 en Chile
    const desplazar = (fecha: Date) =>
      new Date(fecha.getTime() - cambio.getTime() + miercoles.getTime());
    await prisma.carrito.update({
      where: { id: carritoId },
      data: {
        fechaActualizacion: desplazar(modificado.fechaActualizacion),
        fechaRecordatorio: desplazar(fechaRecordatorio!),
      },
    });

    // El segundo de la serie ya no sale a las 24 horas del abandono, y en la misma semana no
    // empieza otra (CA3)
    await servicio.enviarRecordatorios(mas(miercoles, 24));
    expect(await recordatorios(usuario.id)).toBe(1);
  });

  it('E12-H4 · CA3 una serie por semana: otro abandono en la misma semana no inicia una serie; a la semana siguiente sí', async () => {
    // Fechas futuras: la tarea programada, con el reloj real, no toca este carrito
    const lunes = new Date('2027-03-01T13:00:00.000Z'); // lunes 1 de marzo, 10:00 en Chile
    const { usuario, carritoId } = await cuentaConCarrito({
      fechaActualizacion: lunes,
    });
    await servicio.enviarRecordatorios(mas(lunes, 1));
    expect(await recordatorios(usuario.id)).toBe(1);

    // Compra a medias el jueves: cambia el carrito y lo vuelve a dejar
    const jueves = mas(lunes, 72);
    await prisma.carrito.update({
      where: { id: carritoId },
      data: { fechaActualizacion: jueves },
    });
    await servicio.enviarRecordatorios(mas(jueves, 1));
    await servicio.enviarRecordatorios(mas(jueves, 24));
    expect(await recordatorios(usuario.id)).toBe(1);

    // Lunes 8 de marzo a las 00:30 en Chile: semana siguiente, empieza una serie nueva
    const lunesSiguiente = new Date('2027-03-08T03:30:00.000Z');
    await servicio.enviarRecordatorios(lunesSiguiente);
    expect(await recordatorios(usuario.id)).toBe(2);
    const actual = await carrito(carritoId);
    expect(actual.fechaRecordatorio).toEqual(lunesSiguiente);
    // Decisión del 5 nov: sale el plazo que toca desde el último cambio (86,5 h: el tercero)
    expect(actual.recordatoriosEnviados).toBe(3);
  });

  it('RNF-29 · Redis vuelve sin sus datos: al reconectar crea de nuevo la tarea de recordatorios', async () => {
    const cola = app.get<Queue>(getQueueToken(COLAS.CARRITOS_ABANDONADOS));
    const tarea = TRABAJOS_CARRITO_ABANDONADO.RECORDAR;
    await cola.removeJobScheduler(tarea);
    expect(await cola.getJobScheduler(tarea)).toBeUndefined();

    (await cola.getBackend().client).disconnect(true);

    await vi.waitFor(
      async () => expect(await cola.getJobScheduler(tarea)).toBeDefined(),
      { timeout: 10_000, interval: 100 },
    );
  }, 15_000);
});
