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
  ESTADOS_PEDIDO,
  ORIGENES_DESCRIPCION,
  TIPOS_ARTICULO,
  TIPOS_DOCUMENTO,
  TIPOS_ENTREGA,
  TIPOS_PRECIO,
} from '../src/common/dominio/valores.js';
import { configurarApp } from '../src/configurar-app.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { REDIS } from '../src/redis/redis.module.js';

// Requiere PostgreSQL y Redis levantados: `docker compose up -d db redis`.

const CONTRASENA = 'Secreta123';
const RUTA = '/api/catalogo/productos';
// Todo lo que crean estas pruebas lleva este prefijo, para borrarlo al terminar
const PREFIJO = 'E2E-productos';

interface ProductoRespuesta {
  id: number;
  nombre: string;
  descripcion: string;
  canalVenta: string;
  origenDescripcion: string;
  activo: boolean;
  marca: { id: number; nombre: string } | null;
  categoria: { id: number; nombre: string };
}

interface ListadoRespuesta {
  items: ProductoRespuesta[];
  total: number;
  pagina: number;
  limite: number;
}

describe('Catálogo · productos (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: Redis;
  let hashContrasena: string;
  let categoriaId: number;
  let marcaId: number;
  const correosCreados: string[] = [];

  /** Crea una cuenta con ese rol, inicia sesión y devuelve su token de acceso. */
  const tokenDe = async (rol: Rol) => {
    const email = `e2e-productos-${randomUUID()}@prueba.cl`;
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

  const nombreUnico = (base: string) =>
    `${PREFIJO} ${base} ${randomUUID().slice(0, 8)}`;

  const datosValidos = (extra: object = {}) => ({
    nombre: nombreUnico('Shampoo'),
    descripcion: 'Repara el cabello dañado por procesos químicos.',
    categoriaId,
    marcaId,
    canalVenta: 'general',
    ...extra,
  });

  const crear = (token: string, cuerpo: object) =>
    request(app.getHttpServer())
      .post(RUTA)
      .auth(token, { type: 'bearer' })
      .send(cuerpo);

  const editar = (token: string, id: number | string, cuerpo: object) =>
    request(app.getHttpServer())
      .patch(`${RUTA}/${id}`)
      .auth(token, { type: 'bearer' })
      .send(cuerpo);

  const desactivar = (token: string, id: number | string) =>
    request(app.getHttpServer())
      .patch(`${RUTA}/${id}/desactivar`)
      .auth(token, { type: 'bearer' });

  const listar = (token: string, consulta: object = {}) =>
    request(app.getHttpServer())
      .get(RUTA)
      .auth(token, { type: 'bearer' })
      .query(consulta);

  /** Crea un producto por la API y devuelve su respuesta. */
  const nuevo = async (token: string, extra: object = {}) => {
    const respuesta = await crear(token, datosValidos(extra)).expect(201);
    return respuesta.body as ProductoRespuesta;
  };

  const mensajesDe = (cuerpo: unknown) =>
    (cuerpo as { message: string[] }).message;

  const limpiar = async () => {
    // Los pedidos primero: su detalle se va con ellos y libera al artículo
    await prisma.pedido.deleteMany({
      where: { codigoPublico: { startsWith: 'E2EPRO' } },
    });
    // El formato se borra en cascada con su artículo
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
  });

  beforeEach(async () => {
    const claves = await redis.keys('limite:*');
    if (claves.length) await redis.del(...claves);
    await limpiar();
    // Marca y categoría activas para los productos de cada prueba
    categoriaId = (
      await prisma.categoria.create({ data: { nombre: nombreUnico('Cat') } })
    ).id;
    marcaId = (
      await prisma.marca.create({ data: { nombre: nombreUnico('Marca') } })
    ).id;
  });

  afterAll(async () => {
    await limpiar();
    await prisma.usuario.deleteMany({
      where: { email: { in: correosCreados } },
    });
    await app.close();
  });

  describe('crear', () => {
    it('E3-H1 · producto creado: queda activo, con su marca y categoría, y sin formatos todavía', async () => {
      const token = await tokenDe(ROLES.VENDEDOR);
      const cuerpo = datosValidos({ canalVenta: 'general' });

      const respuesta = await crear(token, cuerpo).expect(201);

      const creado = respuesta.body as ProductoRespuesta;
      expect(creado).toMatchObject({
        nombre: cuerpo.nombre,
        descripcion: cuerpo.descripcion,
        canalVenta: 'general',
        activo: true,
        origenDescripcion: ORIGENES_DESCRIPCION.MANUAL,
        marca: { id: marcaId },
        categoria: { id: categoriaId },
      });
      const enBase = await prisma.producto.findUniqueOrThrow({
        where: { id: creado.id },
        include: { formatos: true },
      });
      expect(enBase.activo).toBe(true);
      // Listo para agregar sus formatos: existe y aún no tiene ninguno
      expect(enBase.formatos).toHaveLength(0);

      const detalle = await request(app.getHttpServer())
        .get(`${RUTA}/${creado.id}`)
        .auth(token, { type: 'bearer' })
        .expect(200);
      expect((detalle.body as ProductoRespuesta).id).toBe(creado.id);
    });

    it('recorta los espacios y el administrador también puede crear', async () => {
      const token = await tokenDe(ROLES.ADMINISTRADOR);
      const nombre = nombreUnico('Con espacios');

      const respuesta = await crear(
        token,
        datosValidos({ nombre: `  ${nombre}  `, canalVenta: ' general ' }),
      ).expect(201);

      expect(respuesta.body).toMatchObject({ nombre, canalVenta: 'general' });
    });

    it('E3-H1 · canal de venta: acepta general y profesional, y rechaza cualquier otro valor', async () => {
      const token = await tokenDe(ROLES.VENDEDOR);

      for (const canalVenta of ['general', 'profesional']) {
        const respuesta = await crear(
          token,
          datosValidos({ canalVenta }),
        ).expect(201);
        expect(respuesta.body).toMatchObject({ canalVenta });
      }
      for (const canalVenta of ['mayorista', 'General', 'online']) {
        const respuesta = await crear(
          token,
          datosValidos({ canalVenta }),
        ).expect(400);
        expect(mensajesDe(respuesta.body)).toEqual([
          'El canal de venta debe ser uno de estos: general, profesional.',
        ]);
      }
    });

    it('E3-H1 · datos obligatorios faltantes: no guarda nada y señala cada campo que falta', async () => {
      const token = await tokenDe(ROLES.VENDEDOR);

      const respuesta = await crear(token, {}).expect(400);

      expect(mensajesDe(respuesta.body).sort()).toEqual(
        [
          'El nombre del producto es obligatorio.',
          'La descripción del producto es obligatoria.',
          'La categoría del producto es obligatoria.',
          'La marca del producto es obligatoria.',
          'El canal de venta es obligatorio.',
        ].sort(),
      );
      expect(
        await prisma.producto.count({
          where: { nombre: { startsWith: PREFIJO } },
        }),
      ).toBe(0);
    });

    it('E3-H1 · datos obligatorios faltantes: señala solo el que falta, también si llega vacío o en blanco', async () => {
      const token = await tokenDe(ROLES.VENDEDOR);
      const { nombre: _nombre, ...sinNombre } = datosValidos();
      const { categoriaId: _categoriaId, ...sinCategoria } = datosValidos();
      const { marcaId: _marcaId, ...sinMarca } = datosValidos();

      const casos: [object, string][] = [
        [sinNombre, 'El nombre del producto es obligatorio.'],
        [
          datosValidos({ nombre: '   ' }),
          'El nombre del producto es obligatorio.',
        ],
        [
          datosValidos({ descripcion: '' }),
          'La descripción del producto es obligatoria.',
        ],
        [sinCategoria, 'La categoría del producto es obligatoria.'],
        [sinMarca, 'La marca del producto es obligatoria.'],
        [
          datosValidos({ marcaId: null }),
          'La marca del producto es obligatoria.',
        ],
        [
          datosValidos({ canalVenta: ' ' }),
          'El canal de venta es obligatorio.',
        ],
      ];
      for (const [cuerpo, mensaje] of casos) {
        const respuesta = await crear(token, cuerpo).expect(400);
        expect(mensajesDe(respuesta.body)).toEqual([mensaje]);
      }
      expect(
        await prisma.producto.count({
          where: { nombre: { startsWith: PREFIJO } },
        }),
      ).toBe(0);
    });

    it('rechaza con 400 campos de más, un id imposible y textos demasiado largos', async () => {
      const token = await tokenDe(ROLES.VENDEDOR);

      // `activo` no se decide al crear: el producto nace activo
      await crear(token, datosValidos({ activo: false })).expect(400);
      const idImposible = await crear(
        token,
        datosValidos({ categoriaId: 99_999_999_999 }),
      ).expect(400);
      expect(mensajesDe(idImposible.body)).toEqual([
        'La categoría indicada no es válida.',
      ]);
      await crear(token, datosValidos({ categoriaId: '3' })).expect(400);
      await crear(token, datosValidos({ nombre: 'x'.repeat(201) })).expect(400);
      await crear(token, datosValidos({ canalVenta: 'x'.repeat(31) })).expect(
        400,
      );
    });

    it('E3-H1 · categoría o marca que no existe: 404; marca desactivada: 400; no guarda nada', async () => {
      const token = await tokenDe(ROLES.VENDEDOR);

      await crear(token, datosValidos({ categoriaId: 2_000_000_000 })).expect(
        404,
      );
      await crear(token, datosValidos({ marcaId: 2_000_000_000 })).expect(404);
      await prisma.marca.update({
        where: { id: marcaId },
        data: { activa: false },
      });
      const respuesta = await crear(token, datosValidos()).expect(400);
      expect((respuesta.body as { message: string }).message).toBe(
        'La marca está desactivada.',
      );

      expect(
        await prisma.producto.count({
          where: { nombre: { startsWith: PREFIJO } },
        }),
      ).toBe(0);
    });
  });

  describe('editar', () => {
    it('E3-H1 · edita solo los campos que llegan y puede cambiar la marca', async () => {
      const token = await tokenDe(ROLES.VENDEDOR);
      const producto = await nuevo(token);
      const otraCategoria = (
        await prisma.categoria.create({ data: { nombre: nombreUnico('Otra') } })
      ).id;
      const nombre = nombreUnico('Renombrado');

      const cambiado = await editar(token, producto.id, {
        nombre,
        categoriaId: otraCategoria,
      }).expect(200);

      expect(cambiado.body).toMatchObject({
        nombre,
        descripcion: producto.descripcion,
        categoria: { id: otraCategoria },
        marca: { id: marcaId },
        activo: true,
      });

      const otraMarca = (
        await prisma.marca.create({
          data: { nombre: nombreUnico('Otra marca') },
        })
      ).id;
      const conOtraMarca = await editar(token, producto.id, {
        marcaId: otraMarca,
        canalVenta: 'profesional',
      }).expect(200);
      expect(conOtraMarca.body).toMatchObject({
        marca: { id: otraMarca },
        canalVenta: 'profesional',
      });
    });

    it('E3-H1 · una edición no puede dejar vacío un dato obligatorio', async () => {
      const token = await tokenDe(ROLES.VENDEDOR);
      const producto = await nuevo(token);

      for (const cuerpo of [
        { nombre: '  ' },
        { nombre: null },
        { descripcion: '' },
        { categoriaId: null },
        // La marca es obligatoria: se cambia, no se quita
        { marcaId: null },
        { canalVenta: null },
        { canalVenta: 'otro' },
      ]) {
        await editar(token, producto.id, cuerpo).expect(400);
      }
      await editar(token, producto.id, {}).expect(400);
      // `activo` solo cambia con la ruta de desactivar
      await editar(token, producto.id, { activo: false }).expect(400);

      const enBase = await prisma.producto.findUniqueOrThrow({
        where: { id: producto.id },
      });
      expect(enBase).toMatchObject({
        nombre: producto.nombre,
        descripcion: producto.descripcion,
        categoriaId,
        activo: true,
      });
    });

    it('producto, categoría o marca que no existe: 404; marca desactivada: 400', async () => {
      const token = await tokenDe(ROLES.VENDEDOR);
      const producto = await nuevo(token);

      await editar(token, 2_000_000_000, { nombre: 'X' }).expect(404);
      await editar(token, producto.id, { categoriaId: 2_000_000_000 }).expect(
        404,
      );
      await editar(token, producto.id, { marcaId: 2_000_000_000 }).expect(404);
      const marcaApagada = (
        await prisma.marca.create({
          data: { nombre: nombreUnico('Apagada'), activa: false },
        })
      ).id;
      await editar(token, producto.id, { marcaId: marcaApagada }).expect(400);
    });

    it('RF-04.04 · cambiar una descripción sugerida por IA la marca como «IA editada»', async () => {
      const token = await tokenDe(ROLES.VENDEDOR);
      const producto = await nuevo(token);
      await prisma.producto.update({
        where: { id: producto.id },
        data: { origenDescripcion: ORIGENES_DESCRIPCION.IA },
      });

      const respuesta = await editar(token, producto.id, {
        descripcion: 'Texto corregido por el personal.',
      }).expect(200);

      expect(respuesta.body).toMatchObject({
        origenDescripcion: ORIGENES_DESCRIPCION.IA_EDITADA,
      });
    });
  });

  describe('desactivar', () => {
    it('E3-H1 · producto desactivado: deja de listarse, no se borra y conserva sus pedidos anteriores', async () => {
      const token = await tokenDe(ROLES.VENDEDOR);
      const producto = await nuevo(token);

      // Un pedido anterior que incluye un formato de este producto
      const cliente = await prisma.usuario.create({
        data: {
          codigoPublico: randomUUID(),
          nombre: 'Clara',
          apellido: 'Soto',
          email: `e2e-productos-${randomUUID()}@prueba.cl`,
          contrasenaHash: hashContrasena,
          rol: ROLES.CLIENTE,
          fechaVerificacionCorreo: new Date(),
        },
      });
      correosCreados.push(cliente.email);
      const articulo = await prisma.articuloVenta.create({
        data: {
          sku: `${PREFIJO}-${randomUUID().slice(0, 8)}`,
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
          pesoGramos: 350,
          altoCm: 18,
          anchoCm: 6,
          largoCm: 6,
        },
      });
      const pedido = await prisma.pedido.create({
        data: {
          codigoPublico: `E2EPRO${randomUUID().slice(0, 6)}`,
          usuarioId: cliente.id,
          fechaExpiracionPago: new Date(Date.now() + 15 * 60 * 1000),
          estadoActual: ESTADOS_PEDIDO.PAGADO,
          tipoEntrega: TIPOS_ENTREGA.RETIRO,
          tipoDocumentoSolicitado: TIPOS_DOCUMENTO.BOLETA,
          porcentajeIva: 19,
          montoNeto: 10000,
          montoIva: 1900,
          montoTotal: 11900,
          detalles: {
            create: {
              articuloId: articulo.id,
              cantidad: 1,
              precioUnitarioNetoAplicado: 10000,
              tipoPrecio: TIPOS_PRECIO.MINORISTA,
            },
          },
        },
      });

      const respuesta = await desactivar(token, producto.id).expect(200);

      expect(respuesta.body).toMatchObject({ id: producto.id, activo: false });
      // Sale del listado normal, pero sigue en el de «incluir desactivados»
      const activos = (await listar(token).expect(200))
        .body as ListadoRespuesta;
      expect(activos.items.map((i) => i.id)).not.toContain(producto.id);
      const todos = (
        await listar(token, { incluirInactivos: 'true' }).expect(200)
      ).body as ListadoRespuesta;
      expect(todos.items.map((i) => i.id)).toContain(producto.id);
      // No se borra nada: el producto, su formato y el pedido siguen como estaban
      expect(
        await prisma.producto.findUniqueOrThrow({ where: { id: producto.id } }),
      ).toMatchObject({ activo: false });
      expect(
        await prisma.formatoProducto.count({
          where: { productoId: producto.id },
        }),
      ).toBe(1);
      const pedidoEnBase = await prisma.pedido.findUniqueOrThrow({
        where: { id: pedido.id },
        include: { detalles: true },
      });
      expect(pedidoEnBase.estadoActual).toBe(ESTADOS_PEDIDO.PAGADO);
      expect(pedidoEnBase.montoTotal).toBe(11900);
      expect(pedidoEnBase.detalles).toHaveLength(1);
      expect(pedidoEnBase.detalles[0]?.articuloId).toBe(articulo.id);
    });

    it('repetir la acción sobre un producto ya desactivado no falla ni cambia nada', async () => {
      const token = await tokenDe(ROLES.VENDEDOR);
      const producto = await nuevo(token);

      await desactivar(token, producto.id).expect(200);
      const segunda = await desactivar(token, producto.id).expect(200);

      expect(segunda.body).toMatchObject({ id: producto.id, activo: false });
    });

    it('un producto que no existe responde 404', async () => {
      const token = await tokenDe(ROLES.VENDEDOR);

      await desactivar(token, 2_000_000_000).expect(404);
    });
  });

  describe('listar y ver', () => {
    it('lista solo los activos por defecto, filtra y pagina', async () => {
      const token = await tokenDe(ROLES.VENDEDOR);
      const otraCategoria = (
        await prisma.categoria.create({ data: { nombre: nombreUnico('Otra') } })
      ).id;
      const otraMarca = (
        await prisma.marca.create({
          data: { nombre: nombreUnico('Otra marca') },
        })
      ).id;
      const a = await nuevo(token, { nombre: nombreUnico('Acondicionador') });
      const b = await nuevo(token, {
        nombre: nombreUnico('Tinte'),
        categoriaId: otraCategoria,
        marcaId: otraMarca,
      });
      const c = await nuevo(token, { nombre: nombreUnico('Mascarilla') });
      await desactivar(token, c.id).expect(200);

      const porDefecto = (await listar(token, { buscar: PREFIJO }).expect(200))
        .body as ListadoRespuesta;
      expect(porDefecto.items.map((i) => i.id)).toEqual([a.id, b.id]);
      expect(porDefecto).toMatchObject({ total: 2, pagina: 1, limite: 20 });

      const porCategoria = (
        await listar(token, { categoriaId: otraCategoria }).expect(200)
      ).body as ListadoRespuesta;
      expect(porCategoria.items.map((i) => i.id)).toEqual([b.id]);

      const porMarca = (
        await listar(token, { marcaId, buscar: 'acondicionador' }).expect(200)
      ).body as ListadoRespuesta;
      expect(porMarca.items.map((i) => i.id)).toEqual([a.id]);

      const paginado = (
        await listar(token, {
          buscar: PREFIJO,
          incluirInactivos: 'true',
          limite: 2,
          pagina: 2,
        }).expect(200)
      ).body as ListadoRespuesta;
      expect(paginado).toMatchObject({ total: 3, pagina: 2, limite: 2 });
      // Orden por nombre: Acondicionador, Mascarilla, Tinte
      expect(paginado.items.map((i) => i.id)).toEqual([b.id]);
    });

    it('rechaza filtros inválidos y responde 404 a un id que no puede existir', async () => {
      const token = await tokenDe(ROLES.VENDEDOR);

      await listar(token, { limite: 101 }).expect(400);
      await listar(token, { pagina: 0 }).expect(400);
      await listar(token, { categoriaId: 'abc' }).expect(400);
      await listar(token, { incluirInactivos: 'quizas' }).expect(400);
      for (const id of ['abc', '0', '-1', '99999999999']) {
        await request(app.getHttpServer())
          .get(`${RUTA}/${id}`)
          .auth(token, { type: 'bearer' })
          .expect(404);
      }
    });
  });

  it('RNF-03 · sin sesión responde 401; solo administrador y vendedor gestionan productos', async () => {
    const admin = await tokenDe(ROLES.ADMINISTRADOR);
    const producto = await nuevo(admin);

    await request(app.getHttpServer())
      .post(RUTA)
      .send(datosValidos())
      .expect(401);
    await request(app.getHttpServer()).get(RUTA).expect(401);
    await request(app.getHttpServer())
      .get(`${RUTA}/${producto.id}`)
      .expect(401);
    await request(app.getHttpServer())
      .patch(`${RUTA}/${producto.id}`)
      .send({ nombre: 'X' })
      .expect(401);
    await request(app.getHttpServer())
      .patch(`${RUTA}/${producto.id}/desactivar`)
      .expect(401);

    for (const rol of [ROLES.BODEGUERO, ROLES.CLIENTE, ROLES.PROFESIONAL]) {
      const token = await tokenDe(rol);
      await crear(token, datosValidos()).expect(403);
      await listar(token).expect(403);
      await request(app.getHttpServer())
        .get(`${RUTA}/${producto.id}`)
        .auth(token, { type: 'bearer' })
        .expect(403);
      await editar(token, producto.id, { nombre: 'X' }).expect(403);
      await desactivar(token, producto.id).expect(403);
    }
    expect(
      await prisma.producto.findUniqueOrThrow({ where: { id: producto.id } }),
    ).toMatchObject({ nombre: producto.nombre, activo: true });
  });
});
