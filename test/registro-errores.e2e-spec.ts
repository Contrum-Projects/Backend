import {
  Controller,
  Get,
  INestApplication,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Redis } from 'ioredis';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configurarApp } from '../src/configurar-app.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { REDIS } from '../src/redis/redis.module.js';

// Requiere PostgreSQL y Redis levantados: `docker compose up -d db redis`.

/** Rutas solo de esta prueba, para provocar un error no controlado y uno esperado. */
class InventarioDePruebaService {
  calcular(): never {
    throw new TypeError(
      "Cannot read properties of undefined (reading 'stock')",
    );
  }
}

@Controller('prueba-errores')
class PruebaErroresController {
  private readonly servicio = new InventarioDePruebaService();

  @Get('falla')
  falla() {
    return this.servicio.calcular();
  }

  @Get('no-existe')
  noExiste() {
    throw new NotFoundException('No existe.');
  }
}

describe('Registro de errores (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: Redis;
  const codigos: string[] = [];

  /** El registro se guarda después de responder: espera a que aparezca. */
  const registroDe = async (codigoSeguimiento: string) => {
    for (let intento = 0; intento < 20; intento++) {
      const fila = await prisma.registroError.findFirst({
        where: { codigoSeguimiento },
      });
      if (fila) return fila;
      await new Promise((listo) => setTimeout(listo, 100));
    }
    return null;
  };

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [PruebaErroresController],
    }).compile();
    app = configurarApp(modulo.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    redis = app.get(REDIS);
  });

  beforeEach(async () => {
    const claves = await redis.keys('limite:*');
    if (claves.length) await redis.del(...claves);
  });

  afterAll(async () => {
    await prisma.registroError.deleteMany({
      where: { codigoSeguimiento: { in: codigos } },
    });
    await app.close();
  });

  it('SCRUM-168 · criterio 1: un error no controlado queda registrado con fecha, ruta, componente y código', async () => {
    const respuesta = await request(app.getHttpServer())
      .get('/api/prueba-errores/falla?token=secreto')
      .expect(500);

    const cuerpo = respuesta.body as {
      message: string;
      codigoSeguimiento: string;
    };
    codigos.push(cuerpo.codigoSeguimiento);
    expect(cuerpo.message).toBe('Internal server error');
    expect(respuesta.headers['x-request-id']).toBe(cuerpo.codigoSeguimiento);

    const fila = await registroDe(cuerpo.codigoSeguimiento);
    expect(fila).toMatchObject({
      origen: 'api',
      componente: 'InventarioDePruebaService.calcular',
      metodo: 'GET',
      ruta: '/api/prueba-errores/falla',
      estadoHttp: 500,
      tipoError: 'TypeError',
    });
    expect(fila?.fechaHora).toBeInstanceOf(Date);
  });

  it('SCRUM-168 · usa el código que manda el proxy de Next', async () => {
    const codigo = 'e2e-registro-errores-0001';
    codigos.push(codigo);

    const respuesta = await request(app.getHttpServer())
      .get('/api/prueba-errores/falla')
      .set('x-request-id', codigo)
      .expect(500);

    expect(respuesta.headers['x-request-id']).toBe(codigo);
    expect(await registroDe(codigo)).not.toBeNull();
  });

  it('SCRUM-168 · criterio 2: un 404 responde como siempre y no se registra', async () => {
    const codigo = 'e2e-registro-errores-0002';
    codigos.push(codigo);

    const respuesta = await request(app.getHttpServer())
      .get('/api/prueba-errores/no-existe')
      .set('x-request-id', codigo)
      .expect(404);

    expect(respuesta.body).toEqual({
      statusCode: 404,
      message: 'No existe.',
      error: 'Not Found',
    });
    await new Promise((listo) => setTimeout(listo, 300));
    expect(
      await prisma.registroError.count({
        where: { codigoSeguimiento: codigo },
      }),
    ).toBe(0);
  });

  it('SCRUM-168 · criterio 3: un error del navegador queda registrado sin la query de la ruta', async () => {
    const respuesta = await request(app.getHttpServer())
      .post('/api/registros/errores-cliente')
      .send({
        origen: 'navegador',
        componente: 'app/(tienda)/carrito',
        tipoError: 'TypeError',
        mensaje: 'x is undefined',
        ruta: '/carrito?token=secreto',
      })
      .expect(201);

    const { codigoSeguimiento } = respuesta.body as {
      codigoSeguimiento: string;
    };
    codigos.push(codigoSeguimiento);
    expect(await registroDe(codigoSeguimiento)).toMatchObject({
      origen: 'navegador',
      componente: 'app/(tienda)/carrito',
      ruta: '/carrito',
      estadoHttp: null,
    });
  });

  it('SCRUM-168 · un reporte incompleto responde 400 con el campo', async () => {
    const respuesta = await request(app.getHttpServer())
      .post('/api/registros/errores-cliente')
      .send({ origen: 'api', componente: '', mensaje: 'x' })
      .expect(400);

    const campos = (
      respuesta.body as { errores: { campo: string }[] }
    ).errores.map(({ campo }) => campo);
    expect(campos).toEqual(expect.arrayContaining(['origen', 'componente']));
  });
});
