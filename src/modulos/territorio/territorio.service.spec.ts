import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { TerritorioService } from './territorio.service.js';

const crearPrisma = () => ({
  region: { findMany: vi.fn(), findUnique: vi.fn() },
});

describe('TerritorioService', () => {
  let prisma: ReturnType<typeof crearPrisma>;
  let servicio: TerritorioService;

  beforeEach(() => {
    prisma = crearPrisma();
    servicio = new TerritorioService(prisma as unknown as PrismaService);
  });

  it('E1-H5 · lista oficial: las regiones van de norte a sur, no por código', async () => {
    prisma.region.findMany.mockResolvedValue([
      { codigoCut: '01', nombre: 'Tarapacá' },
      { codigoCut: '16', nombre: 'Ñuble' },
      { codigoCut: '13', nombre: 'Metropolitana de Santiago' },
      { codigoCut: '15', nombre: 'Arica y Parinacota' },
      { codigoCut: '12', nombre: 'Magallanes y de la Antártica Chilena' },
      { codigoCut: '08', nombre: 'Biobío' },
    ]);

    const regiones = await servicio.listarRegiones();

    expect(regiones.map((r) => r.codigoCut)).toEqual([
      '15',
      '01',
      '13',
      '16',
      '08',
      '12',
    ]);
  });

  it('E1-H5 · lista oficial: las comunas de la región van por nombre, con la Ñ después de la N', async () => {
    prisma.region.findUnique.mockResolvedValue({
      comunas: [
        { codigoCut: '13120', nombre: 'Ñuñoa' },
        { codigoCut: '13119', nombre: 'Maipú' },
        { codigoCut: '13101', nombre: 'Santiago' },
        { codigoCut: '13118', nombre: 'Macul' },
        { codigoCut: '13506', nombre: 'Nogales' },
      ],
    });

    const comunas = await servicio.listarComunas('13');

    expect(prisma.region.findUnique).toHaveBeenCalledWith({
      where: { codigoCut: '13' },
      select: { comunas: { select: { codigoCut: true, nombre: true } } },
    });
    expect(comunas.map((c) => c.nombre)).toEqual([
      'Macul',
      'Maipú',
      'Nogales',
      'Ñuñoa',
      'Santiago',
    ]);
  });

  it('E1-H5 · lista oficial: una región que no existe responde 404', async () => {
    prisma.region.findUnique.mockResolvedValue(null);

    await expect(servicio.listarComunas('99')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
