import type { PrismaService } from '../../../prisma/prisma.service.js';
import { ProveedorSimulado } from './proveedor-simulado.js';
import { ConsultaSiiNoDisponible } from './proveedor-situacion-tributaria.js';

describe('ProveedorSimulado', () => {
  const findUnique = vi.fn();
  const proveedor = new ProveedorSimulado({
    usuario: { findUnique },
  } as unknown as PrismaService);

  beforeEach(() => {
    findUnique.mockReset();
    findUnique.mockResolvedValue({ nombre: 'Marcela', apellido: 'Soto' });
  });

  it('E10-H1 · simulado: un RUT cualquiera tiene peluquería (960200) a nombre de su cuenta y se identifica como simulado', async () => {
    const situacion = await proveedor.consultar('12345678-5');

    expect(proveedor.nombre).toBe('simulado');
    expect(situacion.actividades).toEqual([
      expect.objectContaining({ codigo: '960200', fechaInicio: '2020-01-15' }),
    ]);
    expect(situacion.contribuyente).toBe('SOTO MARCELA');
    expect(findUnique).toHaveBeenCalledWith({
      where: { rut: '12345678-5' },
      select: { nombre: true, apellido: true },
    });
  });

  it('E10-H1 · simulado: el último dígito del RUT elige el camino a probar', async () => {
    expect((await proveedor.consultar('12345670-1')).actividades).toEqual([]);
    expect(
      (await proveedor.consultar('12345671-K')).actividades.map(
        (a) => a.codigo,
      ),
    ).toEqual(['471100']);
    await expect(proveedor.consultar('12345672-3')).rejects.toBeInstanceOf(
      ConsultaSiiNoDisponible,
    );
  });

  it('SCRUM-163 · simulado: un RUT terminado en 3 tiene peluquería a nombre de otra persona', async () => {
    const situacion = await proveedor.consultar('12345673-1');

    expect(situacion.actividades.map((a) => a.codigo)).toEqual(['960200']);
    expect(situacion.contribuyente).toBe('ROJAS DIAZ PEDRO ANTONIO');
  });

  it('SCRUM-163 · simulado: sin cuenta con ese RUT no informa contribuyente', async () => {
    findUnique.mockResolvedValue(null);

    expect((await proveedor.consultar('12345678-5')).contribuyente).toBeNull();
  });
});
