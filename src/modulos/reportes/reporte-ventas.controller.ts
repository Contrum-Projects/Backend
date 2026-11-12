import {
  Controller,
  Get,
  Header,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAutenticacionGuard } from '../../autenticacion/jwt-autenticacion.guard.js';
import {
  PermisosGuard,
  RequierePermiso,
} from '../../autenticacion/permisos.guard.js';
import { PERMISOS } from '../../common/dominio/permisos.js';
import { ReporteVentasDto } from './dto/reporte-ventas.dto.js';
import {
  type ReporteVentas,
  ReporteVentasService,
} from './reporte-ventas.service.js';

/** Reportes del panel: solo el administrador, con `reportes.ver` (E14). */
@ApiTags('reportes')
@ApiBearerAuth()
@Controller('reportes')
@UseGuards(JwtAutenticacionGuard, PermisosGuard)
@RequierePermiso(PERMISOS.REPORTES_VER)
@ApiUnauthorizedResponse({ description: 'Falta iniciar sesión.' })
@ApiForbiddenResponse({
  description: 'El rol no tiene el permiso de ver los reportes.',
})
export class ReporteVentasController {
  constructor(private readonly reporte: ReporteVentasService) {}

  @Get('ventas')
  @ApiOperation({
    summary: 'Ventas por período y tipo de cliente (E14-H2)',
    description:
      'Cantidad de pedidos pagados y sus montos (neto, IVA y total, con el despacho incluido) entre las dos fechas, ambas incluidas y en hora de Chile, separados en minorista y mayorista según el precio que se aplicó al comprar, más el total. Los pedidos pendientes de pago y los cancelados no cuentan. Sin pedidos, todo en cero.',
  })
  @ApiOkResponse({
    description:
      '`desde`, `hasta` y, para `minorista`, `mayorista` y `total`: `pedidos`, `montoNeto`, `montoIva` y `montoTotal` en pesos.',
  })
  @ApiBadRequestResponse({
    description:
      'Fechas inválidas, la fecha hasta anterior a la desde o un período de más de 366 días.',
  })
  ventas(@Query() periodo: ReporteVentasDto): Promise<ReporteVentas> {
    return this.reporte.ventasPorTipoCliente(periodo.desde, periodo.hasta);
  }

  @Get('ventas/exportar')
  // Trae montos de cada pedido: no debe quedar en cachés compartidas ni interpretarse como otro tipo
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @ApiOperation({
    summary: 'Exportar las ventas pedido a pedido en CSV (E14-H5, SCRUM-159)',
    description:
      'Los mismos pedidos que suma `GET /api/reportes/ventas` para el período, uno por fila y del más antiguo al más reciente: código del pedido, fecha y hora de Chile, estado, tipo de cliente, tipo de entrega, documento solicitado, descuento, neto, IVA y total en pesos. Sin datos personales del comprador. CSV para Excel en Chile: UTF-8 con BOM, separador `;`. Sin pedidos, solo los encabezados.',
  })
  @ApiProduces('text/csv')
  @ApiOkResponse({
    description: 'El archivo `ventas-<desde>-<hasta>.csv` como descarga.',
  })
  @ApiBadRequestResponse({
    description:
      'Fechas inválidas, la fecha hasta anterior a la desde o un período de más de 366 días.',
  })
  async exportar(@Query() periodo: ReporteVentasDto): Promise<StreamableFile> {
    const csv = await this.reporte.exportarVentas(periodo.desde, periodo.hasta);
    const contenido = Buffer.from(csv, 'utf-8');
    return new StreamableFile(contenido, {
      type: 'text/csv; charset=utf-8',
      // Las fechas ya vienen validadas como AAAA-MM-DD: no pueden romper el encabezado
      disposition: `attachment; filename="ventas-${periodo.desde}-${periodo.hasta}.csv"`,
      length: contenido.length,
    });
  }
}
