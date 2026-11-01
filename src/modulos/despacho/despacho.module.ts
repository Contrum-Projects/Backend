import { BullModule } from '@nestjs/bullmq';
import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { COLAS } from '../../colas/colas.js';
import type { Entorno } from '../../config/entorno.js';
import { CarritoModule } from '../carrito/carrito.module.js';
import { CambiarEstadoPedidoModule } from '../pedidos/cambiar-estado-pedido.module.js';
import { ActualizarEnviosService } from './actualizar-envios.service.js';
import {
  CotizadorChilexpress,
  CotizadorNoConfigurado,
} from './cotizador-chilexpress.js';
import { CotizadorEnvio } from './cotizador-envio.js';
import { CotizarEnvioService } from './cotizar-envio.service.js';
import { DespachoController } from './despacho.controller.js';
import {
  SeguimientoEnvio,
  SeguimientoNoConfigurado,
} from './seguimiento-envio.js';
import { SeguimientoProcessor } from './seguimiento.processor.js';

const URL_SANDBOX = 'https://testservices.wschilexpress.com';

/**
 * Épica 7: cotización del despacho con Chilexpress (ver src/modulos/README.md). El courier se
 * inyecta como `CotizadorEnvio`; sin `CHILEXPRESS_CLAVE_COTIZACION` la app arranca, pero cotizar
 * responde 503.
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: COLAS.SEGUIMIENTO_ENVIOS }),
    CambiarEstadoPedidoModule,
    CarritoModule,
  ],
  controllers: [DespachoController],
  providers: [
    {
      provide: CotizadorEnvio,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Entorno, true>): CotizadorEnvio => {
        const clave = config.get('CHILEXPRESS_CLAVE_COTIZACION', {
          infer: true,
        });
        if (!clave) {
          new Logger('Despacho').warn(
            'Chilexpress sin configurar: cotizar el despacho responderá 503.',
          );
          return new CotizadorNoConfigurado();
        }
        return new CotizadorChilexpress(
          clave,
          config.get('CHILEXPRESS_URL_BASE', { infer: true }) ?? URL_SANDBOX,
        );
      },
    },
    CotizarEnvioService,
    // E7-H3: se reemplaza por el adaptador de Chilexpress al tener el contrato de su API de tracking
    { provide: SeguimientoEnvio, useClass: SeguimientoNoConfigurado },
    ActualizarEnviosService,
    SeguimientoProcessor,
  ],
  exports: [CotizarEnvioService],
})
export class DespachoModule {}
