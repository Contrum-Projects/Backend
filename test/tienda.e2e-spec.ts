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
  precio: number;
  imagen: string;
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

  const nuevaCategoria = async (padreId?: number) =>
    (
      await prisma.categoria.create({
        data: { nombre: nombreUnico('Cat'), padreId },
      })
    ).id;

  const nuevaMarca = async (activa = true) =>
    (
      await prisma.marca.create({
        data: { nombre: nombreUnico('Marca'), activa },
      })
    ).id;

  interface OpcionesProducto {
    categoriaId: number;
    marcaId?: number | null;
    activo?: boolean;
    canalVenta?: string;
    /** Formatos del producto; por defecto uno vendible de $10.000 neto con imagen. */
    formatos?: {
      minorista: number | null;
      predeterminado?: boolean;
      activo?: boolean;
      imagen?: boolean;
    }[];
  }

  /** Crea un producto con sus formatos, artículos e imágenes directamente en la base. */
  const nuevoProducto = async ({
    categoriaId,
    marcaId: marca = marcaId,
    activo = true,
    canalVenta = CANALES_VENTA.GENERAL,
    formatos = [{ minorista: 10000 }],
  }: OpcionesProducto) => {
    const producto = await prisma.producto.create({
      data: {
        nombre: nombreUnico('Producto'),
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
          precioMayoristaNeto: 7777,
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

  const listar = (consulta: object = {}) =>
    request(app.getHttpServer()).get(`${RUTA}/productos`).query(consulta);

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
