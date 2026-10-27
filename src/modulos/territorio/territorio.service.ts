import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { UbicacionOficialDto } from './dto/ubicacion-oficial.dto.js';

/**
 * Regiones de norte a sur, por su código CUT: el orden del decreto N° 1.115 de 2018. El código
 * no sigue la geografía (Arica y Parinacota es la 15 y Ñuble la 16).
 */
const REGIONES_NORTE_A_SUR = [
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

const ordenNorteSur = (codigoCut: string) => {
  const posicion = REGIONES_NORTE_A_SUR.indexOf(codigoCut);
  return posicion === -1 ? REGIONES_NORTE_A_SUR.length : posicion;
};

/** Ordena por nombre como en español (la Ñ después de la N, sin separar las tildes). */
const porNombre = new Intl.Collator('es', { sensitivity: 'base' });

const SELECCION = { codigoCut: true, nombre: true } as const;

/** Regiones y comunas de la lista oficial (transversal: direcciones, despacho, facturación). */
@Injectable()
export class TerritorioService {
  constructor(private readonly prisma: PrismaService) {}

  /** Las regiones de norte a sur. */
  async listarRegiones(): Promise<UbicacionOficialDto[]> {
    const regiones = await this.prisma.region.findMany({ select: SELECCION });
    return regiones.sort(
      (a, b) => ordenNorteSur(a.codigoCut) - ordenNorteSur(b.codigoCut),
    );
  }

  /** Las comunas de una región, por nombre. 404 si la región no existe. */
  async listarComunas(codigoRegion: string): Promise<UbicacionOficialDto[]> {
    const region = await this.prisma.region.findUnique({
      where: { codigoCut: codigoRegion },
      select: { comunas: { select: SELECCION } },
    });
    if (!region) throw new NotFoundException('La región no existe.');
    return region.comunas.sort((a, b) => porNombre.compare(a.nombre, b.nombre));
  }
}
