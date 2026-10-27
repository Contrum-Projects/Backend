import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { COMUNAS } from '../prisma/comunas.js';
import { cargarTerritorio } from '../prisma/territorio.js';
import { AppModule } from '../src/app.module.js';
import { configurarApp } from '../src/configurar-app.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// Requiere PostgreSQL y Redis levantados: `docker compose up -d db redis`. Carga regiones y
// comunas igual que la semilla (el CI no la corre); son datos de referencia y no se borran.

/** Códigos CUT de las regiones, de norte a sur (decreto N° 1.115 de 2018). */
const NORTE_A_SUR = [
  '15',
  '01',
  '02',
  '03',
  '04',
  '05',
  '13',
  '06',
  '07',
  '16',
  '08',
  '09',
  '14',
  '10',
  '11',
  '12',
];

interface Ubicacion {
  codigoCut: string;
  nombre: string;
}

describe('Territorio · regiones y comunas (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = modulo.createNestApplication();
    configurarApp(app);
    await app.init();
    await cargarTerritorio(app.get(PrismaService));
  });

  afterAll(async () => {
    await app.close();
  });

  it('E1-H5 · lista oficial: las 16 regiones, sin sesión y de norte a sur', async () => {
    const respuesta = await request(app.getHttpServer())
      .get('/api/territorio/regiones')
      .expect(200);
    const regiones = respuesta.body as Ubicacion[];

    // Otras pruebas e2e crean una región de prueba que no es del CUT: queda al final
    expect(regiones.slice(0, 16).map((r) => r.codigoCut)).toEqual(NORTE_A_SUR);
    expect(regiones[0]).toEqual({
      codigoCut: '15',
      nombre: 'Arica y Parinacota',
    });
  });

  it('E1-H5 · lista oficial: las comunas de la región con su código CUT', async () => {
    const respuesta = await request(app.getHttpServer())
      .get('/api/territorio/regiones/13/comunas')
      .expect(200);
    const comunas = respuesta.body as Ubicacion[];

    expect(comunas).toHaveLength(
      COMUNAS.filter(([codigo]) => codigo.startsWith('13')).length,
    );
    expect(comunas).toContainEqual({
      codigoCut: '13123',
      nombre: 'Providencia',
    });
    expect(comunas.every((c) => c.codigoCut.startsWith('13'))).toBe(true);
  });

  it('E1-H5 · lista oficial: están las 346 comunas del decreto', async () => {
    let total = 0;
    for (const region of NORTE_A_SUR) {
      const respuesta = await request(app.getHttpServer())
        .get(`/api/territorio/regiones/${region}/comunas`)
        .expect(200);
      total += (respuesta.body as Ubicacion[]).length;
    }

    expect(total).toBe(346);
  });

  it('E1-H5 · lista oficial: una región que no existe responde 404', async () => {
    const respuesta = await request(app.getHttpServer())
      .get('/api/territorio/regiones/00/comunas')
      .expect(404);

    expect(respuesta.body).toMatchObject({ message: 'La región no existe.' });
  });
});
