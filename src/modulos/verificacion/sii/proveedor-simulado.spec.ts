import { ProveedorSimulado } from './proveedor-simulado.js';
import { ConsultaSiiNoDisponible } from './proveedor-situacion-tributaria.js';

describe('ProveedorSimulado', () => {
  const proveedor = new ProveedorSimulado();

  it('E10-H1 · simulado: un RUT cualquiera tiene peluquería (960200) y se identifica como simulado', async () => {
    const situacion = await proveedor.consultar('12345678-5');

    expect(proveedor.nombre).toBe('simulado');
    expect(situacion.actividades).toEqual([
      expect.objectContaining({ codigo: '960200', fechaInicio: '2020-01-15' }),
    ]);
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
});
