import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { CANALES_VENTA } from '../../../common/dominio/valores.js';
import { FechaSinHora } from '../../../common/validacion/fecha-sin-hora.js';
import { TextoObligatorio } from '../../../common/validacion/texto-obligatorio.js';
import { CanalVenta } from './canal-venta.decorator.js';
import {
  ComponentePackDto,
  ListaComponentes,
  MINIMO_UNIDADES_PACK,
} from './crear-pack.dto.js';
import { Sku } from './formato.validadores.js';

/**
 * Cambios sobre un pack (E3-H6). Solo se modifica lo que llega; `null` borra una fecha de
 * vigencia. `componentes` reemplaza la lista completa y sigue las mismas reglas que al crear.
 * Los precios no van aquí: son de E3-H5.
 */
export class ActualizarPackDto {
  @ApiPropertyOptional({ example: 'PACK-REP-DUO', maxLength: 50 })
  @Sku({ presencia: 'puedeFaltar' })
  sku?: string;

  @ApiPropertyOptional({ example: 'Dúo reparador', maxLength: 200 })
  @TextoObligatorio({
    etiqueta: 'El nombre del pack',
    maximo: 200,
    puedeFaltar: true,
  })
  nombre?: string;

  @ApiPropertyOptional({ maxLength: 5000 })
  @TextoObligatorio({
    etiqueta: 'La descripción del pack',
    maximo: 5000,
    femenino: true,
    puedeFaltar: true,
  })
  descripcion?: string;

  @ApiPropertyOptional({
    enum: Object.values(CANALES_VENTA),
    example: CANALES_VENTA.GENERAL,
  })
  @CanalVenta({ puedeFaltar: true })
  canalVenta?: string;

  @ApiPropertyOptional({
    example: '2026-11-01',
    format: 'date',
    nullable: true,
    description: '`null` quita el inicio de la vigencia.',
  })
  @FechaSinHora({ etiqueta: 'La fecha de inicio de la vigencia' })
  fechaInicioVigencia?: string | null;

  @ApiPropertyOptional({
    example: '2026-11-30',
    format: 'date',
    nullable: true,
    description: '`null` quita el término de la vigencia.',
  })
  @FechaSinHora({ etiqueta: 'La fecha de término de la vigencia' })
  fechaFinVigencia?: string | null;

  @ApiPropertyOptional({
    type: [ComponentePackDto],
    description: `Reemplaza todos los componentes; cada formato una sola vez y al menos ${MINIMO_UNIDADES_PACK} unidades en total.`,
  })
  @Type(() => ComponentePackDto)
  @ListaComponentes({ puedeFaltar: true })
  componentes?: ComponentePackDto[];
}
