import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { COLAS } from '../../colas/colas.js';
import { CambioRolController } from './cambio-rol.controller.js';
import { CambioRolService } from './cambio-rol.service.js';
import { ClientesController } from './clientes.controller.js';
import { ClientesService } from './clientes.service.js';
import { InvitacionPersonalController } from './invitacion-personal.controller.js';
import { PersonalController } from './personal.controller.js';
import { PersonalService } from './personal.service.js';

/**
 * Épica 13: personal de tienda y control de acceso (ver src/modulos/README.md). Incluye la
 * gestión de las cuentas de clientes y profesionales (E13-H4).
 */
@Module({
  imports: [BullModule.registerQueue({ name: COLAS.CORREOS })],
  controllers: [
    PersonalController,
    InvitacionPersonalController,
    CambioRolController,
    ClientesController,
  ],
  providers: [PersonalService, CambioRolService, ClientesService],
})
export class PersonalModule {}
