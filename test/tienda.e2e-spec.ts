import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import argon2 from 'argon2';
import type { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { calcularMontos } from '../src/common/dominio/montos.js';
import { ROLES } from '../src/common/dominio/roles.js';
import {
  CANALES_VENTA,
  ORIGENES_DESCRIPCION,
  TIPOS_ARTICULO,
} from '../src/common/dominio/valores.js';
import { configurarApp } from '../src/configurar-app.js';
import { CLAVES_CACHE } from '../src/modulos/catalogo/cache-catalogo.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { REDIS } from '../src/redis/redis.module.js';

// Requiere PostgreSQL y Redis levantados: `docker compose up -d db redis`.

const CONTRASENA = 'Secreta123';
const RUTA = '/api/tienda';
// Todo lo que crean estas pruebas lleva este prefijo, para borrarlo al terminar
const PREFIJO = 'E2E-tienda';

interface ProductoTienda {
  id: number;
  nombre: string;
  marca: { id: number; nombre: string } | null;
  categoria: { id: number; nombre: string };
  precio: number | null;
  imagen: string;
  precioMayorista?: number;
  exclusivo?: boolean;
}

interface ListadoRespuesta {
  items: ProductoTienda[];
  total: number;
  pagina: number;
  limite: number;
}

interface NodoCategoria {
  id: number;
  nombre: string;
  subcategorias: NodoCategoria[];
}

describe('Tienda · explorar el catálogo (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: Redis;
  let porcentajeIva: number;
  let marcaId: number;
  const correosCreados: string[] = [];

  const nombreUnico = (base: string) =>
    `${PREFIJO} ${base} ${randomUUID().slice(0, 8)}`;

  const nuevaCategoria = async (padreId?: number, nombre = 'Cat') =>
    (
      await prisma.categoria.create({
        data: { nombre: nombreUnico(nombre), padreId },
      })
    ).id;

  const nuevaMarca = async (activa = true, nombre = 'Marca') =>
    (
      await prisma.marca.create({
        data: { nombre: nombreUnico(nombre), activa },
      })
    ).id;

  /** Palabra que no aparece en ningún otro dato de la base, para buscarla. */
  const palabraUnica = () => `zq${randomUUID().slice(0, 8)}`;

  interface OpcionesProducto {
    categoriaId: number;
    /** Parte del nombre; el nombre completo lleva además el prefijo y un sufijo único. */
    nombre?: string;
    marcaId?: number | null;
    activo?: boolean;
    canalVenta?: string;
    /** Formatos del producto; por defecto uno vendible de $10.000 neto con imagen. */
    formatos?: {
      minorista: number | null;
      /** Por defecto $7.777 neto. */
      mayorista?: number | null;
      predeterminado?: boolean;
      activo?: boolean;
      imagen?: boolean;
    }[];
  }

  /** Crea un producto con sus formatos, artículos e imágenes directamente en la base. */
  const nuevoProducto = async ({
    categoriaId,
    nombre = 'Producto',
    marcaId: marca = marcaId,
    activo = true,
    canalVenta = CANALES_VENTA.GENERAL,
    formatos = [{ minorista: 10000 }],
  }: OpcionesProducto) => {
    const producto = await prisma.producto.create({
      data: {
        nombre: nombreUnico(nombre),
        descripcion: 'Producto de prueba.',
        origenDescripcion: ORIGENES_DESCRIPCION.MANUAL,
        canalVenta,
        activo,
        categoriaId,
        marcaId: marca,
      },
    });
    for (const [i, formato] of formatos.entries()) {
      const articulo = await prisma.articuloVenta.create({
        data: {
          sku: `${PREFIJO}-${randomUUID().slice(0, 8)}`,
          tipo: TIPOS_ARTICULO.FORMATO,
          precioMinoristaNeto: formato.minorista,
          precioMayoristaNeto:
            formato.mayorista === undefined ? 7777 : formato.mayorista,
          activo: formato.activo ?? true,
        },
      });
      await prisma.formatoProducto.create({
        data: {
          id: articulo.id,
          productoId: producto.id,
          nombreFormato: `${i + 1}00 ml`,
          pesoGramos: 350,
          altoCm: 18,
          anchoCm: 6,
          largoCm: 6,
          esPredeterminado: formato.predeterminado ?? false,
        },
      });
      if (formato.imagen ?? true) {
        await prisma.imagenArticulo.createMany({
          data: [
            {
              articuloId: articulo.id,
              ubicacionArchivo: `productos/${articulo.id}/secundaria.jpg`,
              orden: 1,
            },
            {
              articuloId: articulo.id,
              ubicacionArchivo: `productos/${articulo.id}/principal.jpg`,
              orden: 2,
              esPrincipal: true,
            },
          ],
        });
      }
    }
    return producto;
  };

  const listar = (consulta: object = {}, token?: string) => {
    const peticion = request(app.getHttpServer())
      .get(`${RUTA}/productos`)
      .query(consulta);
    return token ? peticion.auth(token, { type: 'bearer' }) : peticion;
  };

  /** Crea una cuenta con el rol indicado, inicia sesión y devuelve su token de acceso. */
  const tokenDe = async (rol: string) => {
    const email = `e2e-tienda-${randomUUID()}@prueba.cl`;
    correosCreados.push(email);
    await prisma.usuario.create({
      data: {
        codigoPublico: randomUUID(),
        nombre: 'Camila',
        apellido: 'Rojas',
        email,
        contrasenaHash: await argon2.hash(CONTRASENA),
        rol,
        fechaVerificacionCorreo: new Date(),
      },
    });
    const sesion = await request(app.getHttpServer())
      .post('/api/cuentas/sesion')
      .send({ email, contrasena: CONTRASENA })
      .expect(200);
    return (sesion.body as { tokenAcceso: string }).tokenAcceso;
  };

  const conIva = (neto: number) => calcularMontos(neto, porcentajeIva).total;

  const limpiar = async () => {
    // El formato y las imágenes se borran en cascada con su artículo
    await prisma.articuloVenta.deleteMany({
      where: { sku: { startsWith: PREFIJO } },
    });
    await prisma.producto.deleteMany({
      where: { nombre: { startsWith: PREFIJO } },
    });
    await prisma.marca.deleteMany({
      where: { nombre: { startsWith: PREFIJO } },
    });
    // Primero las subcategorías, que apuntan a su padre
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
    redis = app.get(REDIS);
    porcentajeIva = app.get(ConfigService).get<number>('IVA_PORCENTAJE')!;
  });

  beforeEach(async () => {
    const claves = await redis.keys('limite:*');
    if (claves.length) await redis.del(...claves);
    await redis.del(CLAVES_CACHE.CATEGORIAS, CLAVES_CACHE.MARCAS);
    await limpiar();
    marcaId = await nuevaMarca();
  });

  afterAll(async () => {
    await limpiar();
    await redis.del(CLAVES_CACHE.CATEGORIAS, CLAVES_CACHE.MARCAS);
    await prisma.usuario.deleteMany({
      where: { email: { in: correosCreados } },
    });
    await app.close();
  });

  describe('GET /tienda/productos', () => {
    it('E2-H1 · categoría con productos: devuelve los suyos y los de sus subcategorías, con imagen, nombre y precio', async () => {
      const raiz = await nuevaCategoria();
      const hija = await nuevaCategoria(raiz);
      const nieta = await nuevaCategoria(hija);
      const otra = await nuevaCategoria();
      const enRaiz = await nuevoProducto({ categoriaId: raiz });
      const enNieta = await nuevoProducto({ categoriaId: nieta });
      await nuevoProducto({ categoriaId: otra });

      // Sin sesión: el catálogo es público
      const respuesta = await listar({ categoriaId: raiz }).expect(200);

      const cuerpo = respuesta.body as ListadoRespuesta;
      expect(cuerpo.total).toBe(2);
      expect(cuerpo.items.map((p) => p.id)).toEqual(
        expect.arrayContaining([enRaiz.id, enNieta.id]),
      );
      const item = cuerpo.items.find((p) => p.id === enNieta.id)!;
      expect(item).toEqual({
        id: enNieta.id,
        nombre: enNieta.nombre,
        marca: { id: marcaId, nombre: expect.any(String) as string },
        categoria: { id: nieta, nombre: expect.any(String) as string },
        precio: conIva(10000),
        imagen: expect.stringMatching(/principal\.jpg$/) as string,
      });
    });

    it('E2-H1 · categoría con productos: nunca envía el precio mayorista (RNF-04)', async () => {
      const categoria = await nuevaCategoria();
      await nuevoProducto({ categoriaId: categoria });

      const respuesta = await listar({ categoriaId: categoria }).expect(200);

      expect(respuesta.text).not.toMatch(/mayorista/i);
      expect(respuesta.text).not.toContain('7777');
    });

    it('E2-H1 · precio del formato predeterminado; si no hay, el del más barato', async () => {
      const categoria = await nuevaCategoria();
      const conPredeterminado = await nuevoProducto({
        categoriaId: categoria,
        formatos: [
          { minorista: 5000 },
          { minorista: 20000, predeterminado: true },
        ],
      });
      const sinPredeterminado = await nuevoProducto({
        categoriaId: categoria,
        formatos: [{ minorista: 8000 }, { minorista: 3000 }],
      });

      const { items } = (await listar({ categoriaId: categoria }).expect(200))
        .body as ListadoRespuesta;

      const precioDe = (id: number) => items.find((p) => p.id === id)?.precio;
      expect(precioDe(conPredeterminado.id)).toBe(conIva(20000));
      expect(precioDe(sinPredeterminado.id)).toBe(conIva(3000));
    });

    it('E2-H1 · categoría sin productos: devuelve una lista vacía', async () => {
      const categoria = await nuevaCategoria();

      const respuesta = await listar({ categoriaId: categoria }).expect(200);

      expect(respuesta.body).toEqual({
        items: [],
        total: 0,
        pagina: 1,
        limite: 20,
      });
    });

    it('E2-H1 · categoría sin productos activos: no cuentan los inactivos, exclusivos, de marca desactivada ni sin formato vendible', async () => {
      const categoria = await nuevaCategoria();
      await nuevoProducto({ categoriaId: categoria, activo: false });
      await nuevoProducto({
        categoriaId: categoria,
        canalVenta: CANALES_VENTA.PROFESIONAL,
      });
      await nuevoProducto({
        categoriaId: categoria,
        marcaId: await nuevaMarca(false),
      });
      await nuevoProducto({ categoriaId: categoria, formatos: [] });
      await nuevoProducto({
        categoriaId: categoria,
        formatos: [{ minorista: null }],
      });
      await nuevoProducto({
        categoriaId: categoria,
        formatos: [{ minorista: 10000, activo: false }],
      });
      await nuevoProducto({
        categoriaId: categoria,
        formatos: [{ minorista: 10000, imagen: false }],
      });

      const respuesta = await listar({ categoriaId: categoria }).expect(200);

      expect(respuesta.body).toMatchObject({ items: [], total: 0 });
    });

    it('E2-H1 · producto sin marca: se muestra', async () => {
      const categoria = await nuevaCategoria();
      const sinMarca = await nuevoProducto({
        categoriaId: categoria,
        marcaId: null,
      });

      const { items } = (await listar({ categoriaId: categoria }).expect(200))
        .body as ListadoRespuesta;

      expect(items).toEqual([
        expect.objectContaining({ id: sinMarca.id, marca: null }),
      ]);
    });

    it('E2-H1 · navegación por marca: devuelve solo los productos de esa marca', async () => {
      const categoria = await nuevaCategoria();
      const otraMarca = await nuevaMarca();
      const deLaMarca = await nuevoProducto({ categoriaId: categoria });
      await nuevoProducto({ categoriaId: categoria, marcaId: otraMarca });

      const respuesta = await listar({ marcaId }).expect(200);

      const cuerpo = respuesta.body as ListadoRespuesta;
      expect(cuerpo.total).toBe(1);
      expect(cuerpo.items).toEqual([
        expect.objectContaining({
          id: deLaMarca.id,
          marca: expect.objectContaining({ id: marcaId }) as object,
        }),
      ]);
    });

    it('E2-H1 · categoría y marca a la vez: solo los productos que cumplen las dos', async () => {
      const categoria = await nuevaCategoria();
      const otraCategoria = await nuevaCategoria();
      const ambos = await nuevoProducto({ categoriaId: categoria });
      await nuevoProducto({ categoriaId: otraCategoria });
      await nuevoProducto({
        categoriaId: categoria,
        marcaId: await nuevaMarca(),
      });

      const { items } = (
        await listar({ categoriaId: categoria, marcaId }).expect(200)
      ).body as ListadoRespuesta;

      expect(items.map((p) => p.id)).toEqual([ambos.id]);
    });

    it('E2-H1 · categoría o marca inexistente, o marca desactivada: 404', async () => {
      await listar({ categoriaId: 2_000_000_000 }).expect(404);
      await listar({ marcaId: 2_000_000_000 }).expect(404);
      await listar({ marcaId: await nuevaMarca(false) }).expect(404);
    });

    it('E2-H1 · filtros inválidos: 400', async () => {
      await listar({ categoriaId: 'abc' }).expect(400);
      await listar({ limite: 500 }).expect(400);
      await listar({ incluirInactivos: 'true' }).expect(400);
    });
  });

  describe('GET /tienda/productos?buscar=', () => {
    const ids = (respuesta: { body: unknown }) =>
      (respuesta.body as ListadoRespuesta).items
        .map((p) => p.id)
        .sort((a, b) => a - b);

    it('E2-H2 · búsqueda con resultados: coincide por nombre, marca, categoría o subcategoría, sin distinguir mayúsculas', async () => {
      const palabra = palabraUnica();
      const raiz = await nuevaCategoria();
      const porNombre = await nuevoProducto({
        categoriaId: raiz,
        nombre: `Shampoo ${palabra}`,
      });
      const porMarca = await nuevoProducto({
        categoriaId: raiz,
        marcaId: await nuevaMarca(true, `Marca ${palabra}`),
      });
      const categoria = await nuevaCategoria(undefined, `Cat ${palabra}`);
      const subcategoria = await nuevaCategoria(categoria);
      const porCategoria = await nuevoProducto({ categoriaId: categoria });
      const enSubcategoria = await nuevoProducto({ categoriaId: subcategoria });
      const otraSub = await nuevaCategoria(raiz, `Sub ${palabra}`);
      const porSubcategoria = await nuevoProducto({ categoriaId: otraSub });
      await nuevoProducto({ categoriaId: raiz });

      const respuesta = await listar({
        buscar: `  ${palabra.toUpperCase()} `,
      }).expect(200);

      expect(ids(respuesta)).toEqual(
        [
          porNombre.id,
          porMarca.id,
          porCategoria.id,
          enSubcategoria.id,
          porSubcategoria.id,
        ].sort((a, b) => a - b),
      );
      expect((respuesta.body as ListadoRespuesta).total).toBe(5);
      expect(JSON.stringify(respuesta.body)).not.toContain('7777');
    });

    it('E2-H2 · búsqueda con resultados: cada palabra debe coincidir en algún campo', async () => {
      const deProducto = palabraUnica();
      const deMarca = palabraUnica();
      const categoria = await nuevaCategoria();
      const marca = await nuevaMarca(true, `Marca ${deMarca}`);
      const ambas = await nuevoProducto({
        categoriaId: categoria,
        nombre: `Shampoo ${deProducto}`,
        marcaId: marca,
      });
      await nuevoProducto({
        categoriaId: categoria,
        nombre: `Shampoo ${deProducto}`,
      });
      await nuevoProducto({ categoriaId: categoria, marcaId: marca });

      const respuesta = await listar({
        buscar: `${deProducto} ${deMarca}`,
      }).expect(200);

      expect(ids(respuesta)).toEqual([ambas.id]);
    });

    it('E2-H2 · búsqueda sin resultados: devuelve una lista vacía', async () => {
      await nuevoProducto({ categoriaId: await nuevaCategoria() });

      const respuesta = await listar({ buscar: palabraUnica() }).expect(200);

      expect(respuesta.body).toEqual({
        items: [],
        total: 0,
        pagina: 1,
        limite: 20,
      });
    });

    it('E2-H2 · búsqueda sin resultados: no cuenta inactivos, exclusivos ni de marca desactivada', async () => {
      const palabra = palabraUnica();
      const categoria = await nuevaCategoria();
      const nombre = `Shampoo ${palabra}`;
      await nuevoProducto({ categoriaId: categoria, nombre, activo: false });
      await nuevoProducto({
        categoriaId: categoria,
        nombre,
        canalVenta: CANALES_VENTA.PROFESIONAL,
      });
      await nuevoProducto({
        categoriaId: categoria,
        nombre,
        marcaId: await nuevaMarca(false),
      });

      const respuesta = await listar({ buscar: palabra }).expect(200);

      expect((respuesta.body as ListadoRespuesta).total).toBe(0);
    });

    it('E2-H2 · búsqueda sin resultados: %, _ y la barra invertida se buscan como texto', async () => {
      const palabra = palabraUnica();
      await nuevoProducto({
        categoriaId: await nuevaCategoria(),
        nombre: `${palabra}abc`,
      });
      const literal = await nuevoProducto({
        categoriaId: await nuevaCategoria(),
        nombre: `${palabra} 50% _a\\b`,
      });

      await listar({ buscar: `${palabra}%c` })
        .expect(200)
        .expect(({ body }) => expect(body).toMatchObject({ total: 0 }));
      await listar({ buscar: `${palabra}_bc` })
        .expect(200)
        .expect(({ body }) => expect(body).toMatchObject({ total: 0 }));
      // El escape no debe quedar doble: el texto literal sí se encuentra
      for (const buscar of ['50%', '_a', '\\b']) {
        expect(
          ids(await listar({ buscar: `${palabra} ${buscar}` }).expect(200)),
        ).toEqual([literal.id]);
      }
    });

    it('E2-H2 · búsqueda con caracteres de control o repetida como arreglo: 400', async () => {
      await listar({ buscar: 'abc\u0000' }).expect(400);
      await request(app.getHttpServer())
        .get(`${RUTA}/productos?buscar=a&buscar=b`)
        .expect(400);
    });

    it('E2-H2 · búsqueda sin resultados: no ignora las tildes', async () => {
      const palabra = palabraUnica();
      await nuevoProducto({
        categoriaId: await nuevaCategoria(),
        nombre: `Coloración ${palabra}`,
      });

      const respuesta = await listar({
        buscar: `coloracion ${palabra}`,
      }).expect(200);

      expect((respuesta.body as ListadoRespuesta).total).toBe(0);
    });

    it('E2-H2 · filtros combinados: búsqueda, marca y subcategoría a la vez', async () => {
      const palabra = palabraUnica();
      const nombre = `Shampoo ${palabra}`;
      const categoria = await nuevaCategoria();
      const subcategoria = await nuevaCategoria(categoria);
      const otraMarca = await nuevaMarca();
      const cumpleTodo = await nuevoProducto({
        categoriaId: subcategoria,
        nombre,
      });
      await nuevoProducto({ categoriaId: subcategoria });
      await nuevoProducto({
        categoriaId: subcategoria,
        nombre,
        marcaId: otraMarca,
      });
      await nuevoProducto({ categoriaId: await nuevaCategoria(), nombre });

      const porSubcategoria = await listar({
        buscar: palabra,
        marcaId,
        categoriaId: subcategoria,
      }).expect(200);
      const porCategoria = await listar({
        buscar: palabra,
        marcaId,
        categoriaId: categoria,
      }).expect(200);

      expect(ids(porSubcategoria)).toEqual([cumpleTodo.id]);
      expect(ids(porCategoria)).toEqual([cumpleTodo.id]);
    });

    it('E2-H2 · búsqueda vacía: no filtra por texto', async () => {
      const categoria = await nuevaCategoria();
      const producto = await nuevoProducto({ categoriaId: categoria });

      const respuesta = await listar({
        buscar: '   ',
        categoriaId: categoria,
      }).expect(200);

      expect(ids(respuesta)).toEqual([producto.id]);
    });

    it('E2-H2 · búsqueda de más de 100 caracteres: 400', async () => {
      const respuesta = await listar({ buscar: 'a'.repeat(101) }).expect(400);

      expect(JSON.stringify(respuesta.body)).toContain(
        'La búsqueda no puede superar los 100 caracteres.',
      );
    });

    it('E2-H2 · búsqueda de más de 5 palabras: 400; con 5 se acepta', async () => {
      const respuesta = await listar({ buscar: 'a b c d e f' }).expect(400);

      expect(JSON.stringify(respuesta.body)).toContain(
        'La búsqueda admite hasta 5 palabras.',
      );
      await listar({ buscar: '  a  b c d e ' }).expect(200);
    });
  });

  describe('GET /tienda/productos según el rol (E2-H4)', () => {
    /** Una categoría con un producto general y uno exclusivo que solo tiene mayorista. */
    const catalogoMixto = async () => {
      const categoria = await nuevaCategoria();
      const general = await nuevoProducto({
        categoriaId: categoria,
        nombre: 'General',
        formatos: [{ minorista: 10000, mayorista: 7000 }],
      });
      const exclusivo = await nuevoProducto({
        categoriaId: categoria,
        nombre: 'Exclusivo',
        canalVenta: CANALES_VENTA.PROFESIONAL,
        formatos: [{ minorista: null, mayorista: 5000 }],
      });
      return { categoria, general, exclusivo };
    };

    it('E2-H4 · precio mayorista: el profesional recibe el mayorista con IVA junto al minorista', async () => {
      const { categoria, general } = await catalogoMixto();
      const token = await tokenDe(ROLES.PROFESIONAL);

      const { items } = (
        await listar({ categoriaId: categoria }, token).expect(200)
      ).body as ListadoRespuesta;

      expect(items.find((p) => p.id === general.id)).toEqual({
        id: general.id,
        nombre: general.nombre,
        marca: { id: marcaId, nombre: expect.any(String) as string },
        categoria: { id: categoria, nombre: expect.any(String) as string },
        precio: conIva(10000),
        precioMayorista: conIva(7000),
        exclusivo: false,
        imagen: expect.stringMatching(/principal\.jpg$/) as string,
      });
    });

    it('E2-H4 · productos exclusivos: el profesional los ve al explorar, sin precio minorista', async () => {
      const { categoria, general, exclusivo } = await catalogoMixto();
      const token = await tokenDe(ROLES.PROFESIONAL);

      const cuerpo = (
        await listar({ categoriaId: categoria }, token).expect(200)
      ).body as ListadoRespuesta;

      expect(cuerpo.total).toBe(2);
      expect(cuerpo.items.map((p) => p.id)).toEqual(
        expect.arrayContaining([general.id, exclusivo.id]),
      );
      expect(cuerpo.items.find((p) => p.id === exclusivo.id)).toMatchObject({
        precio: null,
        precioMayorista: conIva(5000),
        exclusivo: true,
      });
    });

    it('E2-H4 · productos exclusivos: el profesional los encuentra al buscar', async () => {
      const categoria = await nuevaCategoria();
      const palabra = palabraUnica();
      const exclusivo = await nuevoProducto({
        categoriaId: categoria,
        nombre: palabra,
        canalVenta: CANALES_VENTA.PROFESIONAL,
        formatos: [{ minorista: null, mayorista: 5000 }],
      });
      const token = await tokenDe(ROLES.PROFESIONAL);

      const conSesion = (await listar({ buscar: palabra }, token).expect(200))
        .body as ListadoRespuesta;
      const sinSesion = (await listar({ buscar: palabra }).expect(200))
        .body as ListadoRespuesta;

      expect(conSesion.items.map((p) => p.id)).toEqual([exclusivo.id]);
      expect(sinSesion).toMatchObject({ items: [], total: 0 });
    });

    it('E2-H4 · productos exclusivos: sin precio mayorista, inactivo o sin imagen no se muestra', async () => {
      const categoria = await nuevaCategoria();
      const exclusivo = {
        categoriaId: categoria,
        canalVenta: CANALES_VENTA.PROFESIONAL,
      };
      await nuevoProducto({
        ...exclusivo,
        formatos: [{ minorista: 10000, mayorista: null }],
      });
      await nuevoProducto({ ...exclusivo, activo: false });
      await nuevoProducto({
        ...exclusivo,
        formatos: [{ minorista: null, imagen: false }],
      });
      // Un general sin minorista tampoco se vende, ni siquiera al profesional
      await nuevoProducto({
        categoriaId: categoria,
        formatos: [{ minorista: null }],
      });
      const token = await tokenDe(ROLES.PROFESIONAL);

      const respuesta = await listar({ categoriaId: categoria }, token).expect(
        200,
      );

      expect(respuesta.body).toMatchObject({ items: [], total: 0 });
    });

    it.each([
      ['visitante', undefined],
      ['cliente', ROLES.CLIENTE],
      ['vendedor', ROLES.VENDEDOR],
    ])(
      'E2-H4 · usuario no verificado (%s): solo el minorista, sin exclusivos ni precio mayorista',
      async (_nombre, rol) => {
        const { categoria, general } = await catalogoMixto();
        const token = rol ? await tokenDe(rol) : undefined;

        const respuesta = await listar(
          { categoriaId: categoria },
          token,
        ).expect(200);

        const cuerpo = respuesta.body as ListadoRespuesta;
        expect(cuerpo.total).toBe(1);
        expect(cuerpo.items.map((p) => p.id)).toEqual([general.id]);
        expect(cuerpo.items[0]!.precio).toBe(conIva(10000));
        expect(respuesta.text).not.toMatch(/mayorista|exclusivo/i);
        expect(respuesta.text).not.toContain(String(conIva(7000)));
      },
    );

    it('E2-H4 · token inválido o de una sesión cerrada: 401', async () => {
      const categoria = await nuevaCategoria();
      const token = await tokenDe(ROLES.PROFESIONAL);
      await request(app.getHttpServer())
        .delete('/api/cuentas/sesion/todas')
        .auth(token, { type: 'bearer' })
        .expect(204);

      await listar({ categoriaId: categoria }, 'no-es-un-token').expect(401);
      await listar({ categoriaId: categoria }, token).expect(401);
    });
  });

  describe('GET /tienda/categorias y /tienda/marcas', () => {
    it('E2-H1 · árbol de categorías: público, con las subcategorías anidadas y en caché', async () => {
      const raiz = await nuevaCategoria();
      const hija = await nuevaCategoria(raiz);

      const respuesta = await request(app.getHttpServer())
        .get(`${RUTA}/categorias`)
        .expect(200);

      const nodo = (respuesta.body as NodoCategoria[]).find(
        (c) => c.id === raiz,
      );
      expect(nodo?.subcategorias.map((c) => c.id)).toEqual([hija]);
      expect(await redis.ttl(CLAVES_CACHE.CATEGORIAS)).toBeGreaterThan(0);
    });

    it('E2-H1 · marcas: públicas, solo las activas, y la caché se invalida al crear una desde el panel', async () => {
      const inactiva = await nuevaMarca(false);
      const antes = (
        await request(app.getHttpServer()).get(`${RUTA}/marcas`).expect(200)
      ).body as { id: number; nombre: string }[];
      expect(antes.map((m) => m.id)).toContain(marcaId);
      expect(antes.map((m) => m.id)).not.toContain(inactiva);
      expect(Object.keys(antes[0]!).sort()).toEqual(['id', 'nombre']);

      // Crear una marca desde el panel borra la copia en caché
      const email = `e2e-tienda-${randomUUID()}@prueba.cl`;
      correosCreados.push(email);
      await prisma.usuario.create({
        data: {
          codigoPublico: randomUUID(),
          nombre: 'Camila',
          apellido: 'Rojas',
          email,
          contrasenaHash: await argon2.hash(CONTRASENA),
          rol: ROLES.VENDEDOR,
          fechaVerificacionCorreo: new Date(),
        },
      });
      const sesion = await request(app.getHttpServer())
        .post('/api/cuentas/sesion')
        .send({ email, contrasena: CONTRASENA })
        .expect(200);
      const nueva = await request(app.getHttpServer())
        .post('/api/catalogo/marcas')
        .auth((sesion.body as { tokenAcceso: string }).tokenAcceso, {
          type: 'bearer',
        })
        .send({ nombre: nombreUnico('Marca') })
        .expect(201);

      const despues = (
        await request(app.getHttpServer()).get(`${RUTA}/marcas`).expect(200)
      ).body as { id: number }[];
      expect(despues.map((m) => m.id)).toContain(
        (nueva.body as { id: number }).id,
      );
    });
  });
});
