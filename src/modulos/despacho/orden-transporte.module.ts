import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Entorno } from '../../config/entorno.js';
import { GenerarOtService } from './generar-ot.service.js';
import {
  CreadorOrdenTransporte,
  CreadorOtNoConfigurado,
  URL_SANDBOX_CHILEXPRESS,
} from './orden-transporte.js';
import { CreadorOtChilexpress } from './orden-transporte-chilexpress.js';

/**
 * Crear la OT al despachar (SCRUM-153). Va aparte del módulo de despacho para que el cambio de
 * estado del pedido la use sin importar ese módulo, que ya importa el del cambio de estado.
 */
@Module({
  providers: [
    {
      provide: CreadorOrdenTransporte,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Entorno, true>) => {
        const clave = config.get('CHILEXPRESS_CLAVE_ENVIOS', { infer: true });
        const tarjeta = config.get('CHILEXPRESS_TCC', { infer: true });
        const nombre = config.get('CHILEXPRESS_REMITENTE_NOMBRE', {
          infer: true,
        });
        const telefono = config.get('CHILEXPRESS_REMITENTE_TELEFONO', {
          infer: true,
        });
        const correo = config.get('CHILEXPRESS_REMITENTE_CORREO', {
          infer: true,
        });
        if (!clave || !tarjeta || !nombre || !telefono || !correo) {
          new Logger('Chilexpress').log(
            'Sin la clave de Envíos, la TCC o el remitente: la OT se crea en el portal.',
          );
          return new CreadorOtNoConfigurado();
        }
        return new CreadorOtChilexpress(
          clave,
          tarjeta,
          { nombre, telefono, correo },
          config.get('CHILEXPRESS_URL_BASE', { infer: true }) ??
            URL_SANDBOX_CHILEXPRESS,
        );
      },
    },
    GenerarOtService,
  ],
  exports: [GenerarOtService],
})
export class OrdenTransporteModule {}
