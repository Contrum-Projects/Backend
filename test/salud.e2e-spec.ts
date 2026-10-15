import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configurarApp } from '../src/configurar-app.js';

// Requiere PostgreSQL y Redis levantados: `docker compose up -d db redis`.
describe('Salud (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = configurarApp(modulo.createNestApplication());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/salud responde ok con la base de datos y Redis arriba', () => {
    return request(app.getHttpServer())
      .get('/api/salud')
      .expect(200)
      .expect({ estado: 'ok', baseDatos: 'ok', redis: 'ok' });
  });
});
