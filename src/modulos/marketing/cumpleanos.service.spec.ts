import { NotFoundException } from '@nestjs/common';
import { TIPOS_CAMPANA } from '../../common/dominio/valores.js';
import { CANDADOS } from '../../prisma/bloqueos.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { CumpleanosService } from './cumpleanos.service.js';
import { SALUDO_POR_DEFECTO } from './saludo-cumpleanos.js';

const CODIGO = '6f1c1b1e-0000-4000-8000-000000000009';
/** Jueves 5 de noviembre de 2026, 10:00 en Chile. */
const AHORA = new Date('2026-11-05T13:00:00.000Z');
const FILA = {
  asunto: '¡Feliz cumpleaños!',
  cuerpo: 'Te deseamos un gran día.',
  segmento:
    '{"activo":true,"oferta":{"activa":true,"texto":"20 % en toda la tienda"}}',
};
const DTO = {
  activo: true,
  asunto: '¡Feliz cumpleaños!',
  cuerpo: 'Te deseamos un gran día.',
  oferta: { activa: true, texto: '20 % en toda la tienda' },
};

/** Lo que responden las dos consultas de cifras, en el orden en que se piden. */
const cifras = (programados: number, enviados: number, abiertos: number) => [
  [{ total: BigInt(programados) }],
  [{ enviados: BigInt(enviados), abiertos: BigInt(abiertos) }],
];

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
  const consultas = vi.fn();
  const prisma = {
    campana: { findFirst: vi.fn().mockResolvedValue(null) },
    $transaction: vi.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    $queryRaw: consultas,
  };
  const conCifras = (respuestas: unknown[][]) => {
    for (const respuesta of respuestas)
      consultas.mockResolvedValueOnce(respuesta);
  };
  conCifras(cifras(0, 0, 0));
  const servicio = new CumpleanosService(prisma as unknown as PrismaService);
  return { prisma, tx, servicio, conCifras, consultas };
};

/** El SQL de la consulta n (las plantillas de `$queryRaw` llegan como arreglo de trozos). */
const sqlDe = (consultas: ReturnType<typeof vi.fn>, n: number) =>
  (consultas.mock.calls[n][0] as TemplateStringsArray).join('?');

describe('CumpleanosService', () => {
  it('E12-H5 · CA1 saludo enviado: sin configurar, muestra el saludo por defecto, activo y sin oferta', async () => {
    const { servicio } = crear(null);

    await expect(servicio.obtener(AHORA)).resolves.toEqual({
      ...SALUDO_POR_DEFECTO,
      activo: true,
      configurado: false,
      programadosEsteMes: 0,
      porcentajeAperturaUltimoMes: null,
    });
  });

  it('E12-H5 · CA2 saludo con oferta: muestra el saludo guardado con su oferta', async () => {
    const { prisma, servicio } = crear(null);
    prisma.campana.findFirst.mockResolvedValue(FILA);

    await expect(servicio.obtener(AHORA)).resolves.toMatchObject({
      activo: true,
      asunto: '¡Feliz cumpleaños!',
      cuerpo: 'Te deseamos un gran día.',
      oferta: { activa: true, texto: '20 % en toda la tienda' },
      configurado: true,
    });
    expect(prisma.campana.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tipo: TIPOS_CAMPANA.CUMPLEANOS } }),
    );
  });

  it('SCRUM-150 · una fila guardada antes de poder apagarlo (sin activo) se muestra activa', async () => {
    const { prisma, servicio } = crear(null);
    prisma.campana.findFirst.mockResolvedValue({
      ...FILA,
      segmento: '{"oferta":{"activa":false,"texto":null}}',
    });

    await expect(servicio.obtener(AHORA)).resolves.toMatchObject({
      activo: true,
    });
  });

  it('SCRUM-150 · cuenta los programados de este mes y el porcentaje de apertura del mes anterior', async () => {
    const { servicio, consultas, conCifras } = crear(null);
    consultas.mockReset();
    conCifras(cifras(12, 40, 17));

    const respuesta = await servicio.obtener(AHORA);

    expect(respuesta.programadosEsteMes).toBe(12);
    // 17 de 40 = 42,5 % → 43
    expect(respuesta.porcentajeAperturaUltimoMes).toBe(43);
    const programados = sqlDe(consultas, 0);
    expect(programados).toContain('u.acepta_marketing_email');
    expect(programados).toContain('u.fecha_verificacion_correo IS NOT NULL');
    expect(programados).toContain("to_char(u.fecha_nacimiento, 'MM')");
    const apertura = sqlDe(consultas, 1);
    expect(apertura).toContain('COUNT(fecha_apertura)');
  });

  it('SCRUM-150 · con el saludo apagado no hay programados (0), y sin envíos el mes anterior la apertura es null', async () => {
    const { prisma, servicio, consultas, conCifras } = crear(null);
    prisma.campana.findFirst.mockResolvedValue({
      ...FILA,
      segmento: '{"activo":false,"oferta":{"activa":false,"texto":null}}',
    });
    consultas.mockReset();
    conCifras([[{ enviados: 0n, abiertos: 0n }]]);

    const respuesta = await servicio.obtener(AHORA);

    expect(respuesta).toMatchObject({
      activo: false,
      programadosEsteMes: 0,
      porcentajeAperturaUltimoMes: null,
    });
    // Solo se pidió la apertura: no cuenta programados de un saludo apagado
    expect(consultas).toHaveBeenCalledTimes(1);
  });

  it('E12-H5 · CA2 saludo con oferta: la primera vez crea la única campaña de cumpleaños, con el candado tomado', async () => {
    const { tx, servicio } = crear(null);

    const respuesta = await servicio.configurar(DTO, CODIGO, AHORA);

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
    expect(respuesta.activo).toBe(true);
  });

  it('E12-H5 · CA2 saludo con oferta: después actualiza esa misma fila (desactivar la oferta conserva su texto)', async () => {
    const { tx, servicio } = crear({ id: 4 });

    await servicio.configurar(
      { ...DTO, oferta: { activa: false, texto: '20 % en toda la tienda' } },
      CODIGO,
      AHORA,
    );

    expect(tx.campana.create).not.toHaveBeenCalled();
    expect(tx.campana.update).toHaveBeenCalledWith({
      where: { id: 4 },
      data: {
        asunto: DTO.asunto,
        cuerpo: DTO.cuerpo,
        segmento:
          '{"activo":true,"oferta":{"activa":false,"texto":"20 % en toda la tienda"}}',
      },
      select: { asunto: true, cuerpo: true, segmento: true },
    });
  });

  it('SCRUM-150 · apagar el saludo lo guarda apagado y conserva la oferta', async () => {
    const { tx, servicio } = crear({ id: 4 });
    const apagado =
      '{"activo":false,"oferta":{"activa":true,"texto":"20 % en toda la tienda"}}';
    tx.campana.update.mockResolvedValue({ ...FILA, segmento: apagado });

    const respuesta = await servicio.configurar(
      { ...DTO, activo: false },
      CODIGO,
      AHORA,
    );

    expect(tx.campana.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ segmento: apagado }) as object,
      }),
    );
    expect(respuesta).toMatchObject({
      activo: false,
      oferta: { activa: true, texto: '20 % en toda la tienda' },
      programadosEsteMes: 0,
    });
  });

  it('E12-H5 · si la cuenta de quien guarda ya no existe, responde 404', async () => {
    const { tx, servicio } = crear(null);
    tx.usuario.findUnique.mockResolvedValue(null);

    await expect(
      servicio.configurar(DTO, CODIGO, AHORA),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
