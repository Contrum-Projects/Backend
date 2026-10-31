import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import {
  COLAS,
  TRABAJOS_EVENTO_PAGO,
  TRABAJOS_PLAZO,
} from '../src/colas/colas.js';
import { ROLES } from '../src/common/dominio/roles.js';
import {
  ESTADOS_PEDIDO,
  TIPOS_DOCUMENTO,
  TIPOS_ENTREGA,
} from '../src/common/dominio/valores.js';
import { configurarApp } from '../src/configurar-app.js';
import {
  type PagoPasarela,
  PasarelaPago,
} from '../src/modulos/pagos/pasarela-pago.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// Requiere PostgreSQL y Redis levantados: `docker compose up -d db redis`.
// Con los workers reales: comprueba las tareas programadas, no solo el servicio que llaman.

const PREFIJO_CORREO = 'e2e-tareas-pago-';

class PasarelaDePrueba extends PasarelaPago {
  crearCobro(): Promise<string> {
    return Promise.resolve('https://www.mercadopago.cl/e2e');
  }

  consultarPago(): Promise<PagoPasarela | null> {
    return Promise.resolve(null);
  }

  buscarPagosDePedido(): Promise<PagoPasarela[]> {
    return Promise.resolve([]);
  }
}

describe('Pagos · tareas programadas con los workers reales (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const email = `${PREFIJO_CORREO}${randomUUID()}@prueba.cl`;

  const limpiar = async () => {
    await prisma.pedido.deleteMany({
      where: { usuario: { email: { startsWith: PREFIJO_CORREO } } },
    });
    await prisma.usuario.deleteMany({
      where: { email: { startsWith: PREFIJO_CORREO } },
    });
  };

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PasarelaPago)
      .useValue(new PasarelaDePrueba())
      .compile();
    app = configurarApp(modulo.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    await limpiar();
  });

  afterAll(async () => {
    await limpiar();
    await app.close();
  });

  it('RNF-31 · plazo vencido: el worker cancela el pedido en menos de 1 minuto', async () => {
    const usuario = await prisma.usuario.create({
      data: {
        codigoPublico: randomUUID(),
        nombre: 'Marcela',
        apellido: 'Soto',
        email,
        contrasenaHash: 'sin-uso',
        rol: ROLES.CLIENTE,
        fechaVerificacionCorreo: new Date(),
      },
    });
    const pedido = await prisma.pedido.create({
      data: {
        codigoPublico: randomUUID()
          .replaceAll('-', '')
          .slice(0, 12)
          .toUpperCase(),
        usuarioId: usuario.id,
        fechaExpiracionPago: new Date(),
        estadoActual: ESTADOS_PEDIDO.PENDIENTE_PAGO,
        tipoEntrega: TIPOS_ENTREGA.RETIRO,
        tipoDocumentoSolicitado: TIPOS_DOCUMENTO.BOLETA,
        porcentajeIva: 19,
        montoNeto: 20000,
        montoIva: 3800,
        montoTotal: 23800,
        historial: {
          create: { correlativo: 1, estado: ESTADOS_PEDIDO.PENDIENTE_PAGO },
        },
      },
    });

    await vi.waitFor(
      async () => {
        const actual = await prisma.pedido.findUniqueOrThrow({
          where: { id: pedido.id },
        });
        expect(actual.estadoActual).toBe('cancelado');
      },
      { timeout: 60_000, interval: 500 },
    );
  }, 65_000);

  it.each([
    [COLAS.PLAZOS, TRABAJOS_PLAZO.CANCELAR_IMPAGOS],
    [COLAS.EVENTOS_PAGO, TRABAJOS_EVENTO_PAGO.REVISAR_PENDIENTES],
  ])(
    'RNF-29 · Redis vuelve sin sus datos (cola %s): al reconectar crea de nuevo la tarea %s',
    async (nombreCola, tarea) => {
      const cola = app.get<Queue>(getQueueToken(nombreCola));
      await cola.removeJobScheduler(tarea);
      expect(await cola.getJobScheduler(tarea)).toBeUndefined();

      // Corta la conexión de la cola y deja que ioredis reconecte, como tras reiniciar Redis
      (await cola.getBackend().client).disconnect(true);

      await vi.waitFor(
        async () => expect(await cola.getJobScheduler(tarea)).toBeDefined(),
        { timeout: 10_000, interval: 100 },
      );
    },
    15_000,
  );
});
