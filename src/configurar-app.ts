import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { errorValidacion } from './common/validacion/mensajes-validacion.js';

/**
 * Configuración común a main.ts y a los tests e2e, para que prueben la API
 * exactamente como corre: prefijo /api y validación estricta de la entrada.
 */
export function configurarApp(app: INestApplication): INestApplication {
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: errorValidacion,
    }),
  );
  return app;
}
