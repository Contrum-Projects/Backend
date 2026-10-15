import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Redis } from 'ioredis';
import { PrismaService } from '../prisma/prisma.service.js';
import { REDIS } from '../redis/redis.module.js';

type Estado = 'ok' | 'caido';

/**
 * Estado del servicio, para el healthcheck de Docker y el monitoreo (RNF-21).
 * Solo PostgreSQL es obligatorio: si Redis cae, la tienda sigue vendiendo (RNF-32),
 * así que se informa sin devolver error.
 */
@ApiTags('salud')
@Controller('salud')
export class SaludController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Estado de la API, la base de datos y Redis' })
  async revisar() {
    const [baseDatos, redis] = await Promise.all([
      this.revisarBaseDatos(),
      this.revisarRedis(),
    ]);
    const cuerpo = { estado: baseDatos, baseDatos, redis };
    if (baseDatos !== 'ok') throw new ServiceUnavailableException(cuerpo);
    return cuerpo;
  }

  private async revisarBaseDatos(): Promise<Estado> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return 'ok';
    } catch {
      return 'caido';
    }
  }

  private async revisarRedis(): Promise<Estado> {
    try {
      return (await this.redis.ping()) === 'PONG' ? 'ok' : 'caido';
    } catch {
      return 'caido';
    }
  }
}
