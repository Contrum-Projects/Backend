import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import type { Entorno } from '../config/entorno.js';

/**
 * Cliente de Prisma compartido por toda la app.
 * Para escribir un dato y su historia en una misma transacción (RNF-12),
 * usa `this.prisma.$transaction(async (tx) => { ... })`.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(config: ConfigService<Entorno, true>) {
    super({
      adapter: new PrismaPg({
        connectionString: config.get('DATABASE_URL', { infer: true }),
      }),
    });
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
