import type { StockBajoService } from '../inventario/stock-bajo.service.js';
import { ReporteStockBajoController } from './reporte-stock-bajo.controller.js';

describe('ReporteStockBajoController', () => {
  const crear = (formatos: unknown[]) => {
    const stockBajo = {
      listarBajoMinimo: vi.fn().mockResolvedValue(formatos),
    };
    return {
      stockBajo,
      controlador: new ReporteStockBajoController(
        stockBajo as unknown as StockBajoService,
      ),
    };
  };

  it('E14-H4 · formatos bajo el mínimo: devuelve cada uno con su stock actual y su mínimo', async () => {
    const formatos = [
      {
        formatoId: 11,
        sku: 'SH-300',
        producto: 'Shampoo Reparador',
        nombreFormato: '300 ml',
        activo: true,
        stockMinimo: 5,
        stockTotal: 2,
        faltante: 3,
      },
    ];
    const { controlador, stockBajo } = crear(formatos);

    await expect(controlador.stockBajoMinimo()).resolves.toEqual(formatos);
    expect(stockBajo.listarBajoMinimo).toHaveBeenCalledTimes(1);
  });

  it('E14-H4 · sin formatos bajo el mínimo: devuelve una lista vacía', async () => {
    const { controlador } = crear([]);

    await expect(controlador.stockBajoMinimo()).resolves.toEqual([]);
  });
});
