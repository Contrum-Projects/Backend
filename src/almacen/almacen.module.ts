import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Entorno } from '../config/entorno.js';
import { AlmacenArchivos } from './almacen-archivos.js';
import { AlmacenNoConfigurado, AlmacenR2 } from './almacen-r2.js';

const VARIABLES_R2 = [
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET',
  'R2_URL_PUBLICA',
] as const;

/**
 * Almacén de archivos (Cloudflare R2). Se inyecta como `AlmacenArchivos`. Las variables de R2
 * van todas o ninguna: a medias, la app no arranca (RNF-10).
 */
@Module({
  providers: [
    {
      provide: AlmacenArchivos,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Entorno, true>): AlmacenArchivos => {
        const faltan = VARIABLES_R2.filter(
          (nombre) => !config.get(nombre, { infer: true }),
        );
        if (faltan.length === VARIABLES_R2.length) {
          new Logger('Almacen').warn(
            'R2 sin configurar: subir imágenes responderá 503.',
          );
          return new AlmacenNoConfigurado();
        }
        if (faltan.length > 0) {
          throw new Error(
            `Variables de entorno inválidas: faltan ${faltan.join(', ')} para R2.`,
          );
        }
        return new AlmacenR2({
          cuenta: config.get('R2_ACCOUNT_ID', { infer: true }) as string,
          idClave: config.get('R2_ACCESS_KEY_ID', { infer: true }) as string,
          claveSecreta: config.get('R2_SECRET_ACCESS_KEY', {
            infer: true,
          }) as string,
          bucket: config.get('R2_BUCKET', { infer: true }) as string,
        });
      },
    },
  ],
  exports: [AlmacenArchivos],
})
export class AlmacenModule {}
