import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { mensajesValidacion } from '../../../common/validacion/mensajes-validacion.js';
import {
  CancelarPedidoDto,
  MAXIMO_COMENTARIO_CANCELACION,
} from './cancelar-pedido.dto.js';

const probar = async (entrada: object) => {
  const dto = plainToInstance(CancelarPedidoDto, entrada);
  const errores = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return { dto, mensajes: mensajesValidacion(errores) };
};

describe('CancelarPedidoDto', () => {
  it('el comentario es opcional', async () => {
    const { dto, mensajes } = await probar({});

    expect(mensajes).toEqual([]);
    expect(dto.comentario).toBeUndefined();
  });

  it('acepta un comentario hasta el máximo y lo recorta', async () => {
    const { dto, mensajes } = await probar({ comentario: '  Duplicado.  ' });
    expect(mensajes).toEqual([]);
    expect(dto.comentario).toBe('Duplicado.');

    expect(
      (await probar({ comentario: 'x'.repeat(MAXIMO_COMENTARIO_CANCELACION) }))
        .mensajes,
    ).toEqual([]);
  });

  it('rechaza un comentario demasiado largo o que no es texto, en español', async () => {
    expect(
      (
        await probar({
          comentario: 'x'.repeat(MAXIMO_COMENTARIO_CANCELACION + 1),
        })
      ).mensajes,
    ).toEqual([
      `El comentario no puede superar los ${MAXIMO_COMENTARIO_CANCELACION} caracteres.`,
    ]);
    expect((await probar({ comentario: 123 })).mensajes).toEqual([
      'El comentario debe ser un texto.',
    ]);
  });

  it('no admite campos de más', async () => {
    expect((await probar({ estado: 'pagado' })).mensajes).toEqual([
      'El campo «estado» no se admite.',
    ]);
  });
});
