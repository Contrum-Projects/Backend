import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import argon2 from 'argon2';
import type { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { COLAS, TRABAJOS_CORREO } from '../src/colas/colas.js';
import { ROLES, type Rol } from '../src/common/dominio/roles.js';
import {
  CANALES_VENTA,
  ESTADOS_PEDIDO,
  ORIGENES_DESCRIPCION,
  ORIGENES_LEAD,
  TIPOS_ARTICULO,
  TIPOS_DOCUMENTO,
  TIPOS_ENTREGA,
  ESTADOS_NOTIFICACION,
  TIPOS_NOTIFICACION,
  TIPOS_PRECIO,
} from '../src/common/dominio/valores.js';
import { configurarApp } from '../src/configurar-app.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// Requiere PostgreSQL y Redis levantados: `docker compose up -d db redis`.

const CONTRASENA = 'Secreta123';
const RUTA = '/api/marketing/campanas';
// Todo lo que crean estas pruebas lleva este prefijo, para borrarlo al terminar
const PREFIJO = 'E2E-campanas';
const PREFIJO_CORREO = 'e2e-campanas-';

interface Cuenta {
  id: number;
  email: string;
}

interface Vista {
  destinatarios: number;
  confirmacion: string;
  html: string;
}

describe('Marketing · campañas de correo (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let correos: Queue;
  let hashContrasena: string;
  let tokenAdministrador: string;
  let categoriaPadre: number;
  let marca: number;
  /** Formato de una subcategoría de `categoriaPadre`, sin marca. */
  let formatoCategoria: number;
  /** Formato de otra categoría, con `marca`. */
  let formatoMarca: number;
  /** Formato de otra categoría y sin marca: no entra al segmento. */
  let formatoOtro: number;
  /** Pack con `formatoCategoria`: cuenta por sus componentes. */
  let pack: number;
  const campanas: number[] = [];

  const servidor = () => request(app.getHttpServer());
  const unico = () => randomUUID().slice(0, 8);

  const nuevaCuenta = async (
    rol: Rol,
    datos: {
      acepta?: boolean;
      verificada?: boolean;
      activo?: boolean;
      email?: string;
    } = {},
  ): Promise<Cuenta> => {
    const email = datos.email ?? `${PREFIJO_CORREO}${randomUUID()}@prueba.cl`;
    const usuario = await prisma.usuario.create({
      data: {
        codigoPublico: randomUUID(),
        nombre: 'Camila',
        apellido: 'Rojas',
        email,
        contrasenaHash: hashContrasena,
        rol,
        fechaVerificacionCorreo: datos.verificada === false ? null : new Date(),
        aceptaMarketingEmail: datos.acepta ?? true,
        activo: datos.activo ?? true,
      },
    });
    return { id: usuario.id, email };
  };

  const tokenDe = async (rol: Rol) => {
    const { email } = await nuevaCuenta(rol, { acepta: false });
    const respuesta = await servidor()
      .post('/api/cuentas/sesion')
      .send({ email, contrasena: CONTRASENA })
      .expect(200);
    return (respuesta.body as { tokenAcceso: string }).tokenAcceso;
  };

  const nuevoPedido = async (
    usuarioId: number,
    articuloId: number,
    estado: string = ESTADOS_PEDIDO.ENTREGADO,
  ) => {
    await prisma.pedido.create({
      data: {
        codigoPublico: randomUUID().replace(/-/g, '').slice(0, 12),
        usuarioId,
        fechaExpiracionPago: new Date(Date.now() + 15 * 60_000),
        estadoActual: estado,
        tipoEntrega: TIPOS_ENTREGA.RETIRO,
        tipoDocumentoSolicitado: TIPOS_DOCUMENTO.BOLETA,
        porcentajeIva: 19,
        montoNeto: 10000,
        montoIva: 1900,
        montoTotal: 11900,
        detalles: {
          create: [
            {
              articuloId,
              cantidad: 1,
              precioUnitarioNetoAplicado: 10000,
              tipoPrecio: TIPOS_PRECIO.MINORISTA,
            },
          ],
        },
      },
    });
  };

  const nuevoFormato = async (categoriaId: number, marcaId?: number) => {
    const producto = await prisma.producto.create({
      data: {
        nombre: `${PREFIJO} Shampoo ${unico()}`,
        descripcion: 'Repara el cabello.',
        origenDescripcion: ORIGENES_DESCRIPCION.MANUAL,
        canalVenta: CANALES_VENTA.GENERAL,
        categoriaId,
        marcaId,
      },
    });
    const articulo = await prisma.articuloVenta.create({
      data: {
        sku: `${PREFIJO}-${unico()}`,
        tipo: TIPOS_ARTICULO.FORMATO,
        precioMinoristaNeto: 10000,
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

  const nuevaCategoria = async (padreId?: number) =>
    (
      await prisma.categoria.create({
        data: { nombre: `${PREFIJO} Cat ${unico()}`, padreId },
      })
    ).id;

  const crearCampana = async (
    segmento: object,
    token = tokenAdministrador,
  ): Promise<number> => {
    const respuesta = await servidor()
      .post(RUTA)
      .auth(token, { type: 'bearer' })
      .send({
        asunto: `${PREFIJO} Novedades`,
        cuerpo: 'Llegó la línea reparadora.\n\nEncuéntrala en la tienda.',
        segmento,
      })
      .expect(201);
    const { id } = respuesta.body as { id: number };
    campanas.push(id);
    return id;
  };

  const vistaPrevia = async (id: number): Promise<Vista> =>
    (
      await servidor()
        .post(`${RUTA}/${id}/vista-previa`)
        .auth(tokenAdministrador, { type: 'bearer' })
        .expect(200)
    ).body as Vista;

  const enviar = (id: number, confirmacion: string) =>
    servidor()
      .post(`${RUTA}/${id}/envio`)
      .auth(tokenAdministrador, { type: 'bearer' })
      .send({ confirmacion });

  const correosDe = (campanaId: number) =>
    prisma.notificacion.findMany({
      where: { campanaId },
      select: { id: true, usuarioId: true, leadId: true, tipo: true },
    });

  const limpiar = async () => {
    const notificaciones = await prisma.notificacion.findMany({
      where: {
        OR: [
          { campanaId: { in: campanas } },
          { campana: { asunto: { startsWith: PREFIJO } } },
          { usuario: { email: { startsWith: PREFIJO_CORREO } } },
          { lead: { email: { startsWith: PREFIJO_CORREO } } },
        ],
      },
      select: { id: true },
    });
    // Los trabajos de la cola apuntan a estas notificaciones: no deben quedar para otras pruebas
    if (correos) {
      await Promise.all(
        notificaciones.map(({ id }) => correos.remove(`correo-${id}`)),
      );
    }
    await prisma.notificacion.deleteMany({
      where: { id: { in: notificaciones.map(({ id }) => id) } },
    });
    await prisma.campana.deleteMany({
      where: { asunto: { startsWith: PREFIJO } },
    });
    await prisma.pedido.deleteMany({
      where: { usuario: { email: { startsWith: PREFIJO_CORREO } } },
    });
    await prisma.usuario.deleteMany({
      where: { email: { startsWith: PREFIJO_CORREO } },
    });
    await prisma.lead.deleteMany({
      where: { email: { startsWith: PREFIJO_CORREO } },
    });
    // El formato y el pack se borran en cascada con su artículo; primero el pack, que usa el formato
    await prisma.articuloVenta.deleteMany({
      where: { sku: { startsWith: `${PREFIJO}-pack-` } },
    });
    await prisma.articuloVenta.deleteMany({
      where: { sku: { startsWith: PREFIJO } },
    });
    await prisma.producto.deleteMany({
      where: { nombre: { startsWith: PREFIJO } },
    });
    await prisma.marca.deleteMany({
      where: { nombre: { startsWith: PREFIJO } },
    });
    await prisma.categoria.deleteMany({
      where: { nombre: { startsWith: PREFIJO }, padreId: { not: null } },
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
    correos = app.get<Queue>(getQueueToken(COLAS.CORREOS));
    hashContrasena = await argon2.hash(CONTRASENA);
    await limpiar();

    tokenAdministrador = await tokenDe(ROLES.ADMINISTRADOR);
    categoriaPadre = await nuevaCategoria();
    const subcategoria = await nuevaCategoria(categoriaPadre);
    marca = (
      await prisma.marca.create({
        data: { nombre: `${PREFIJO} Marca ${unico()}` },
      })
    ).id;
    formatoCategoria = await nuevoFormato(subcategoria);
    const otraCategoria = await nuevaCategoria();
    formatoMarca = await nuevoFormato(otraCategoria, marca);
    formatoOtro = await nuevoFormato(otraCategoria);

    const articuloPack = await prisma.articuloVenta.create({
      data: { sku: `${PREFIJO}-pack-${unico()}`, tipo: TIPOS_ARTICULO.PACK },
    });
    await prisma.pack.create({
      data: {
        id: articuloPack.id,
        nombre: `${PREFIJO} Pack`,
        descripcion: 'Dúo',
        canalVenta: CANALES_VENTA.GENERAL,
        componentes: {
          create: [{ formatoId: formatoCategoria, cantidad: 2 }],
        },
      },
    });
    pack = articuloPack.id;
  });

  afterAll(async () => {
    await limpiar();
    await app.close();
  });

  /** Cuentas con compras: solo las tres primeras deben recibir la campaña filtrada. */
  const prepararCompradores = async () => {
    const porCategoria = await nuevaCuenta(ROLES.CLIENTE);
    await nuevoPedido(porCategoria.id, formatoCategoria);
    const porMarca = await nuevaCuenta(ROLES.PROFESIONAL);
    await nuevoPedido(porMarca.id, formatoMarca);
    const porPack = await nuevaCuenta(ROLES.CLIENTE);
    await nuevoPedido(porPack.id, pack);

    const excluidas = await Promise.all([
      nuevaCuenta(ROLES.CLIENTE, { acepta: false }),
      nuevaCuenta(ROLES.CLIENTE, { verificada: false }),
      nuevaCuenta(ROLES.CLIENTE, { activo: false }),
      nuevaCuenta(ROLES.VENDEDOR),
    ]);
    for (const cuenta of excluidas) {
      await nuevoPedido(cuenta.id, formatoCategoria);
    }
    const impaga = await nuevaCuenta(ROLES.CLIENTE);
    await nuevoPedido(
      impaga.id,
      formatoCategoria,
      ESTADOS_PEDIDO.PENDIENTE_PAGO,
    );
    const otraCompra = await nuevaCuenta(ROLES.CLIENTE);
    await nuevoPedido(otraCompra.id, formatoOtro);

    return {
      incluidas: [porCategoria, porMarca, porPack],
      excluidas: [...excluidas, impaga, otraCompra],
    };
  };

  const SEGMENTO_COMPRAS = () => ({
    tipos: ['cliente', 'profesional'],
    categorias: [categoriaPadre],
    marcas: [marca],
  });

  it('E12-H3 · CA1 campaña enviada · CA3 destinatarios sin consentimiento: tras la vista previa, encola solo a quienes compraron, aceptan publicidad y verificaron su correo, y guarda el segmento', async () => {
    const { incluidas, excluidas } = await prepararCompradores();
    const id = await crearCampana(SEGMENTO_COMPRAS());

    const vista = await vistaPrevia(id);
    expect(vista.destinatarios).toBe(3);
    expect(vista.html).toContain('Llegó la línea reparadora.');

    const respuesta = await enviar(id, vista.confirmacion).expect(202);
    expect(respuesta.body).toMatchObject({ id, destinatarios: 3 });

    const enviados = await correosDe(id);
    expect(enviados.map((c) => c.usuarioId).sort((a, b) => a! - b!)).toEqual(
      incluidas.map((c) => c.id).sort((a, b) => a - b),
    );
    expect(enviados.every((c) => c.tipo === TIPOS_NOTIFICACION.CAMPANA)).toBe(
      true,
    );
    const idsExcluidas = excluidas.map((c) => c.id);
    expect(enviados.some((c) => idsExcluidas.includes(c.usuarioId!))).toBe(
      false,
    );

    // Encolados con prioridad de publicidad
    const trabajo = await correos.getJob(`correo-${enviados[0].id}`);
    expect(trabajo?.name).toBe(TRABAJOS_CORREO.CAMPANA);
    expect(trabajo?.opts.priority).toBe(10);

    const guardada = await prisma.campana.findUniqueOrThrow({ where: { id } });
    expect(guardada.fechaEncolado).not.toBeNull();
    expect(JSON.parse(guardada.segmento!)).toEqual({
      tipos: ['cliente', 'profesional'],
      categorias: [categoriaPadre],
      marcas: [marca],
    });

    const detalle = await servidor()
      .get(`${RUTA}/${id}`)
      .auth(tokenAdministrador, { type: 'bearer' })
      .expect(200);
    expect(detalle.body).toMatchObject({
      enviada: true,
      envios: { total: 3, pendientes: 3 },
    });
  });

  it('SCRUM-150 · listado: cada borrador dice a cuántos llegaría hoy y cada enviada a cuántos salió y su apertura, con los contadores de contactos', async () => {
    await prepararCompradores();
    const borrador = await crearCampana(SEGMENTO_COMPRAS());
    const enviada = await crearCampana(SEGMENTO_COMPRAS());
    const vista = await vistaPrevia(enviada);
    await enviar(enviada, vista.confirmacion).expect(202);
    // Dos de los tres correos salieron y uno se abrió
    const correos = await correosDe(enviada);
    await prisma.notificacion.updateMany({
      where: { id: { in: correos.slice(0, 2).map((c) => c.id) } },
      data: { estadoEnvio: ESTADOS_NOTIFICACION.ENVIADA },
    });
    await prisma.notificacion.update({
      where: { id: correos[0].id },
      data: { fechaApertura: new Date() },
    });

    const respuesta = await servidor()
      .get(RUTA)
      .query({ limite: 50 })
      .auth(tokenAdministrador, { type: 'bearer' })
      .expect(200);

    const cuerpo = respuesta.body as {
      contactos: Record<string, number>;
      items: {
        id: number;
        destinatarios: number;
        porcentajeApertura: number | null;
      }[];
    };
    const fila = (id: number) => cuerpo.items.find((item) => item.id === id);
    // El borrador cuenta como la vista previa, que es lo que saldría hoy
    expect(fila(borrador)).toMatchObject({
      destinatarios: (await vistaPrevia(borrador)).destinatarios,
      porcentajeApertura: null,
    });
    // A cuántos salió y 1 abierto de 2 enviados
    expect(fila(enviada)).toMatchObject({
      destinatarios: vista.destinatarios,
      porcentajeApertura: 50,
    });
    const { contactos } = cuerpo;
    expect(contactos.cuentasVerificadas).toBeGreaterThanOrEqual(3);
    expect(contactos.aceptanPublicidad).toBe(
      contactos.cuentasVerificadas + contactos.suscriptoresSinCuenta,
    );
    expect(contactos.conRebote).toBeGreaterThanOrEqual(0);
  });

  it('E12-H3 · CA2 envío repetido: una campaña enviada no se reenvía, no se edita ni tiene otra vista previa', async () => {
    await prepararCompradores();
    const id = await crearCampana(SEGMENTO_COMPRAS());
    const { confirmacion } = await vistaPrevia(id);
    await enviar(id, confirmacion).expect(202);
    const antes = (await correosDe(id)).length;

    await enviar(id, confirmacion).expect(409);
    await servidor()
      .patch(`${RUTA}/${id}`)
      .auth(tokenAdministrador, { type: 'bearer' })
      .send({ asunto: `${PREFIJO} Otro asunto` })
      .expect(409);
    await servidor()
      .post(`${RUTA}/${id}/vista-previa`)
      .auth(tokenAdministrador, { type: 'bearer' })
      .expect(409);

    expect((await correosDe(id)).length).toBe(antes);
  });

  it('E12-H3 · CA2 envío repetido: dos confirmaciones simultáneas envían la campaña una sola vez', async () => {
    await prepararCompradores();
    const id = await crearCampana(SEGMENTO_COMPRAS());
    const { confirmacion, destinatarios } = await vistaPrevia(id);

    const respuestas = await Promise.all([
      enviar(id, confirmacion),
      enviar(id, confirmacion),
    ]);

    expect(respuestas.map((r) => r.status).sort()).toEqual([202, 409]);
    expect((await correosDe(id)).length).toBe(destinatarios);
  });

  it('E12-H3 · CA2 llega una vez a cada dirección: quien tiene cuenta y suscripción con el mismo correo recibe uno solo; el suscriptor dado de baja, ninguno', async () => {
    const conCuenta = await nuevaCuenta(ROLES.CLIENTE);
    const mismoCorreo = await prisma.lead.create({
      data: {
        email: conCuenta.email,
        origen: ORIGENES_LEAD.FORMULARIO_WEB,
        activo: true,
      },
    });
    const suscriptor = await prisma.lead.create({
      data: {
        email: `${PREFIJO_CORREO}${randomUUID()}@prueba.cl`,
        origen: ORIGENES_LEAD.FORMULARIO_WEB,
        activo: true,
      },
    });
    const deBaja = await prisma.lead.create({
      data: {
        email: `${PREFIJO_CORREO}${randomUUID()}@prueba.cl`,
        origen: ORIGENES_LEAD.FORMULARIO_WEB,
        activo: false,
        fechaBaja: new Date(),
      },
    });
    const id = await crearCampana({ tipos: ['cliente', 'suscriptor'] });
    const { confirmacion } = await vistaPrevia(id);

    await enviar(id, confirmacion).expect(202);

    const enviados = await correosDe(id);
    expect(enviados.filter((c) => c.usuarioId === conCuenta.id)).toHaveLength(
      1,
    );
    const leads = enviados.map((c) => c.leadId);
    expect(leads).not.toContain(mismoCorreo.id);
    expect(leads).toContain(suscriptor.id);
    expect(leads).not.toContain(deBaja.id);
  });

  it.each([
    ['no acepta ofertas', ROLES.CLIENTE],
    ['es del personal', ROLES.VENDEDOR],
  ])(
    'E12-H3 · CA3 · si la cuenta %s, no recibe la campaña aunque tenga una suscripción activa con el mismo correo',
    async (_caso, rol) => {
      const cuenta = await nuevaCuenta(rol, {
        acepta: rol === ROLES.VENDEDOR,
      });
      const lead = await prisma.lead.create({
        data: {
          email: cuenta.email,
          origen: ORIGENES_LEAD.FORMULARIO_WEB,
          activo: true,
        },
      });
      const id = await crearCampana({ tipos: ['cliente', 'suscriptor'] });
      const { confirmacion } = await vistaPrevia(id);

      await enviar(id, confirmacion).expect(202);

      const enviados = await correosDe(id);
      expect(enviados.map((c) => c.usuarioId)).not.toContain(cuenta.id);
      expect(enviados.map((c) => c.leadId)).not.toContain(lead.id);
    },
  );

  it('E12-H3 · si la campaña cambió después de la vista previa, el envío responde 409 y pide otra', async () => {
    await prepararCompradores();
    const id = await crearCampana(SEGMENTO_COMPRAS());
    const { confirmacion } = await vistaPrevia(id);
    await servidor()
      .patch(`${RUTA}/${id}`)
      .auth(tokenAdministrador, { type: 'bearer' })
      .send({ cuerpo: 'Texto corregido.' })
      .expect(200);

    const respuesta = await enviar(id, confirmacion).expect(409);
    expect((respuesta.body as { message: string }).message).toContain(
      'vista previa',
    );
    expect(await correosDe(id)).toHaveLength(0);

    const nueva = await vistaPrevia(id);
    await enviar(id, nueva.confirmacion).expect(202);
  });

  it.each([
    ['sin destinatarios', { tipos: [] }],
    ['con un tipo desconocido', { tipos: ['vendedor'] }],
    [
      'con suscriptores y un filtro de compras',
      { tipos: ['suscriptor'], marcas: [1] },
    ],
    [
      'con una categoría que no existe',
      { tipos: ['cliente'], categorias: [2_000_000_000] },
    ],
    [
      'con más de 50 categorías',
      {
        tipos: ['cliente'],
        categorias: Array.from({ length: 51 }, (_v, i) => i + 1),
      },
    ],
  ])('E12-H3 · un segmento %s responde 400', async (_caso, segmento) => {
    await servidor()
      .post(RUTA)
      .auth(tokenAdministrador, { type: 'bearer' })
      .send({ asunto: `${PREFIJO} A`, cuerpo: 'B', segmento })
      .expect(400);
  });

  it.each([
    ['un asunto de más de 200 caracteres', { asunto: 'a'.repeat(201) }],
    ['un cuerpo de más de 10.000 caracteres', { cuerpo: 'a'.repeat(10_001) }],
    ['un asunto en blanco', { asunto: '   ' }],
    ['un asunto de varias líneas', { asunto: 'Ofertas\r\nBcc: otro@x.cl' }],
  ])('E12-H3 · redactar con %s responde 400', async (_caso, cambio) => {
    await servidor()
      .post(RUTA)
      .auth(tokenAdministrador, { type: 'bearer' })
      .send({
        asunto: `${PREFIJO} A`,
        cuerpo: 'B',
        segmento: { tipos: ['cliente'] },
        ...cambio,
      })
      .expect(400);
  });

  it('E12-H3 · editar un borrador sin ningún campo responde 400', async () => {
    const id = await crearCampana({ tipos: ['cliente'] });

    await servidor()
      .patch(`${RUTA}/${id}`)
      .auth(tokenAdministrador, { type: 'bearer' })
      .send({})
      .expect(400);
  });

  it('E12-H3 · enviar sin la confirmación de la vista previa responde 400', async () => {
    const id = await crearCampana({ tipos: ['cliente'] });

    await enviar(id, '').expect(400);
  });

  it('E12-H3 · una campaña que no existe responde 404', async () => {
    await servidor()
      .get(`${RUTA}/999999999`)
      .auth(tokenAdministrador, { type: 'bearer' })
      .expect(404);
  });

  describe('SCRUM-150 · vista previa en vivo', () => {
    it('SCRUM-150 · arma el correo de lo que se escribe, sin guardar campaña ni entregar la confirmación', async () => {
      const antes = await prisma.campana.count();
      const respuesta = await servidor()
        .post(`${RUTA}/vista-previa`)
        .auth(tokenAdministrador, { type: 'bearer' })
        .send({
          asunto: 'Novedades en vivo',
          cuerpo: ['Hola:', '', 'Llegó la línea.'].join('\n'),
        })
        .expect(200);

      expect(respuesta.body).toEqual({
        asunto: 'Novedades en vivo',
        html: expect.stringContaining('Llegó la línea.'),
        texto: expect.stringContaining('Llegó la línea.'),
      });
      expect(respuesta.body).not.toHaveProperty('confirmacion');
      expect(await prisma.campana.count()).toBe(antes);
    });

    it('SCRUM-150 · asunto vacío o un segmento (que no corresponde) responden 400', async () => {
      await servidor()
        .post(`${RUTA}/vista-previa`)
        .auth(tokenAdministrador, { type: 'bearer' })
        .send({ asunto: '', cuerpo: 'Hola' })
        .expect(400);
      await servidor()
        .post(`${RUTA}/vista-previa`)
        .auth(tokenAdministrador, { type: 'bearer' })
        .send({ asunto: 'A', cuerpo: 'Hola', segmento: { tipos: ['cliente'] } })
        .expect(400);
    });
  });

  describe('RNF-03 · permisos', () => {
    const rutas = [
      ['get', RUTA],
      ['post', RUTA],
      ['get', `${RUTA}/1`],
      ['patch', `${RUTA}/1`],
      ['post', `${RUTA}/1/vista-previa`],
      ['post', `${RUTA}/vista-previa`],
      ['post', `${RUTA}/1/envio`],
    ] as const;

    it.each(rutas)('E12-H3 · %s %s sin sesión: 401', async (metodo, ruta) => {
      await servidor()[metodo](ruta).expect(401);
    });

    it.each([
      ROLES.VENDEDOR,
      ROLES.BODEGUERO,
      ROLES.CLIENTE,
      ROLES.PROFESIONAL,
    ])('E12-H3 · %s no gestiona campañas: 403 en cada ruta', async (rol) => {
      const token = await tokenDe(rol);
      for (const [metodo, ruta] of rutas) {
        await servidor()
          [metodo](ruta)
          .auth(token, { type: 'bearer' })
          .expect(403);
      }
    });
  });
});
