import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { COLAS } from '../../colas/colas.js';
import { InvitacionPersonalController } from './invitacion-personal.controller.js';
import { PersonalController } from './personal.controller.js';
import { PersonalService } from './personal.service.js';

/** Épica 13: personal de tienda y control de acceso (ver src/modulos/README.md). */
@Module({
  imports: [BullModule.registerQueue({ name: COLAS.CORREOS })],
  controllers: [PersonalController, InvitacionPersonalController],
  providers: [PersonalService],
})
export class PersonalModule {}
