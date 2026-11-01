import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { mensajesValidacion } from '../../../common/validacion/mensajes-validacion.js';
import {
  CambiarEstadoPedidoDto,
  MAXIMO_CODIGO_SEGUIMIENTO,
  MAXIMO_COMENTARIO_ESTADO,
} from './cambiar-estado-pedido.dto.js';

const probar = async (entrada: object) => {
  const dto = plainToInstance(CambiarEstadoPedidoDto, entrada);
  const errores = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return { dto, mensajes: mensajesValidacion(errores) };
};

describe('CambiarEstadoPedidoDto', () => {
  it('acepta un estado válido y el comentario es opcional', async () => {
    const { dto, mensajes } = await probar({ estado: 'en_preparacion' });

    expect(mensajes).toEqual([]);
    expect(dto.estado).toBe('en_preparacion');
    expect(dto.comentario).toBeUndefined();
  });

  it('recorta el estado y el comentario', async () => {
    const { dto, mensajes } = await probar({
      estado: ' despachado ',
      comentario: '  Entregado a Chilexpress.  ',
    });

    expect(mensajes).toEqual([]);
    expect(dto.estado).toBe('despachado');
    expect(dto.comentario).toBe('Entregado a Chilexpress.');
  });

  it('el estado es obligatorio y debe ser uno de la lista, en español', async () => {
    expect((await probar({})).mensajes).toEqual(['El estado es obligatorio.']);
    expect((await probar({ estado: 'volando' })).mensajes).toEqual([
      expect.stringContaining('El estado debe ser uno de estos:'),
    ]);
  });

  it('rechaza un comentario demasiado largo o que no es texto', async () => {
    expect(
      (
        await probar({
          estado: 'pagado',
          comentario: 'x'.repeat(MAXIMO_COMENTARIO_ESTADO + 1),
        })
      ).mensajes,
    ).toEqual([
      `El comentario no puede superar los ${MAXIMO_COMENTARIO_ESTADO} caracteres.`,
    ]);
    expect(
      (await probar({ estado: 'pagado', comentario: 123 })).mensajes,
    ).toEqual(['El comentario debe ser un texto.']);
  });

  it('E7-H3 · envío registrado: recorta el código de seguimiento y solo admite letras y números hasta 100 caracteres', async () => {
    const { dto, mensajes } = await probar({
      estado: 'despachado',
      codigoSeguimiento: ' 990000000001 ',
    });
    expect(mensajes).toEqual([]);
    expect(dto.codigoSeguimiento).toBe('990000000001');

    expect(
      (await probar({ estado: 'despachado', codigoSeguimiento: '99-00 1' }))
        .mensajes,
    ).toEqual(['El código de seguimiento solo admite letras y números.']);
    expect(
      (
        await probar({
          estado: 'despachado',
          codigoSeguimiento: '9'.repeat(MAXIMO_CODIGO_SEGUIMIENTO + 1),
        })
      ).mensajes,
    ).toEqual([
      `El código de seguimiento no puede superar los ${MAXIMO_CODIGO_SEGUIMIENTO} caracteres.`,
    ]);
    expect(
      (await probar({ estado: 'despachado', codigoSeguimiento: 123 })).mensajes,
    ).toEqual(['El código de seguimiento debe ser un texto.']);
  });

  it('no admite campos de más', async () => {
    expect((await probar({ estado: 'pagado', usuarioId: 1 })).mensajes).toEqual(
      ['El campo «usuarioId» no se admite.'],
    );
  });
});
