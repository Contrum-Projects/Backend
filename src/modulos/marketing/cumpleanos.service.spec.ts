import { NotFoundException } from '@nestjs/common';
import { TIPOS_CAMPANA } from '../../common/dominio/valores.js';
import { CANDADOS } from '../../prisma/bloqueos.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { CumpleanosService } from './cumpleanos.service.js';
import { SALUDO_POR_DEFECTO } from './saludo-cumpleanos.js';

const CODIGO = '6f1c1b1e-0000-4000-8000-000000000009';
const FILA = {
  asunto: '¡Feliz cumpleaños!',
  cuerpo: 'Te deseamos un gran día.',
  segmento: '{"oferta":{"activa":true,"texto":"20 % en toda la tienda"}}',
};
const DTO = {
  asunto: '¡Feliz cumpleaños!',
  cuerpo: 'Te deseamos un gran día.',
  oferta: { activa: true, texto: '20 % en toda la tienda' },
};

const crear = (actual: { id: number } | null) => {
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(0),
    campana: {
      findFirst: vi.fn().mockResolvedValue(actual),
      update: vi.fn().mockResolvedValue(FILA),
      create: vi.fn().mockResolvedValue(FILA),
    },
    usuario: { findUnique: vi.fn().mockResolvedValue({ id: 1 }) },
  };
  const prisma = {
    campana: { findFirst: vi.fn().mockResolvedValue(null) },
    $transaction: vi.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  const servicio = new CumpleanosService(prisma as unknown as PrismaService);
  return { prisma, tx, servicio };
};

describe('CumpleanosService', () => {
  it('E12-H5 · CA1 saludo enviado: sin configurar, muestra el saludo por defecto, sin oferta', async () => {
    const { servicio } = crear(null);

    await expect(servicio.obtener()).resolves.toEqual({
      ...SALUDO_POR_DEFECTO,
      configurado: false,
    });
  });

  it('E12-H5 · CA2 saludo con oferta: muestra el saludo guardado con su oferta', async () => {
    const { prisma, servicio } = crear(null);
    prisma.campana.findFirst.mockResolvedValue(FILA);

    await expect(servicio.obtener()).resolves.toEqual({
      asunto: '¡Feliz cumpleaños!',
      cuerpo: 'Te deseamos un gran día.',
      oferta: { activa: true, texto: '20 % en toda la tienda' },
      configurado: true,
    });
    expect(prisma.campana.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tipo: TIPOS_CAMPANA.CUMPLEANOS } }),
    );
  });

  it('E12-H5 · CA2 saludo con oferta: la primera vez crea la única campaña de cumpleaños, con el candado tomado', async () => {
    const { tx, servicio } = crear(null);

    const respuesta = await servicio.configurar(DTO, CODIGO);

    const [consulta, candado] = tx.$executeRaw.mock.calls[0] as [
      TemplateStringsArray,
      number,
    ];
    expect(consulta.join('?')).toContain('pg_advisory_xact_lock');
    expect(candado).toBe(CANDADOS.SALUDO_CUMPLEANOS);
    expect(tx.campana.create).toHaveBeenCalledWith({
      data: {
        asunto: DTO.asunto,
        cuerpo: DTO.cuerpo,
        segmento: FILA.segmento,
        usuarioId: 1,
        tipo: TIPOS_CAMPANA.CUMPLEANOS,
      },
      select: { asunto: true, cuerpo: true, segmento: true },
    });
    expect(respuesta.oferta).toEqual(DTO.oferta);
  });

  it('E12-H5 · CA2 saludo con oferta: después actualiza esa misma fila (desactivar la oferta conserva su texto)', async () => {
    const { tx, servicio } = crear({ id: 4 });

    await servicio.configurar(
      { ...DTO, oferta: { activa: false, texto: '20 % en toda la tienda' } },
      CODIGO,
    );

    expect(tx.campana.create).not.toHaveBeenCalled();
    expect(tx.campana.update).toHaveBeenCalledWith({
      where: { id: 4 },
      data: {
        asunto: DTO.asunto,
        cuerpo: DTO.cuerpo,
        segmento:
          '{"oferta":{"activa":false,"texto":"20 % en toda la tienda"}}',
      },
      select: { asunto: true, cuerpo: true, segmento: true },
    });
  });

  it('E12-H5 · si la cuenta de quien guarda ya no existe, responde 404', async () => {
    const { tx, servicio } = crear(null);
    tx.usuario.findUnique.mockResolvedValue(null);

    await expect(servicio.configurar(DTO, CODIGO)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
