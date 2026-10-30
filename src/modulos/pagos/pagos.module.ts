import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Entorno } from '../../config/entorno.js';
import { MisPedidosModule } from '../pedidos/mis-pedidos.module.js';
import { AplicarPagoService } from './aplicar-pago.service.js';
import { PagarPedidoController } from './pagar-pedido.controller.js';
import { PagarPedidoService } from './pagar-pedido.service.js';
import {
  PasarelaMercadoPago,
  PasarelaNoConfigurada,
} from './pasarela-mercado-pago.js';
import { PasarelaPago } from './pasarela-pago.js';

/**
 * Épica 6: pago con Mercado Pago (ver src/modulos/README.md). La pasarela se inyecta como
 * `PasarelaPago`; sin `MERCADOPAGO_ACCESS_TOKEN` la app arranca, pero pagar responde 503.
 */
@Module({
  imports: [MisPedidosModule],
  controllers: [PagarPedidoController],
  providers: [
    {
      provide: PasarelaPago,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Entorno, true>): PasarelaPago => {
        const token = config.get('MERCADOPAGO_ACCESS_TOKEN', { infer: true });
        if (!token) {
          new Logger('Pagos').warn(
            'Mercado Pago sin configurar: pagar responderá 503.',
          );
          return new PasarelaNoConfigurada();
        }
        return new PasarelaMercadoPago(token);
      },
    },
    AplicarPagoService,
    PagarPedidoService,
  ],
  exports: [AplicarPagoService, PasarelaPago],
})
export class PagosModule {}
