import { BadRequestException, ConflictException } from '@nestjs/common';
import { errorDeCampo } from './error-de-campo.js';

describe('errorDeCampo', () => {
  it('SCRUM-150 · es la misma excepción de Nest, con el mensaje de siempre y el campo al que pertenece', () => {
    const error = errorDeCampo(
      ConflictException,
      'Ya existe un proveedor con ese RUT.',
      'rut',
    );

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getStatus()).toBe(409);
    expect(error.message).toBe('Ya existe un proveedor con ese RUT.');
    expect(error.getResponse()).toEqual({
      statusCode: 409,
      message: 'Ya existe un proveedor con ese RUT.',
      error: 'Conflict',
      errores: [
        { campo: 'rut', mensaje: 'Ya existe un proveedor con ese RUT.' },
      ],
    });
  });

  it('SCRUM-150 · con varios campos, cada uno lleva el mensaje', () => {
    const error = errorDeCampo(
      BadRequestException,
      'El correo y el RUT ya están registrados.',
      'email',
      'rut',
    );

    expect((error.getResponse() as { errores: unknown[] }).errores).toEqual([
      { campo: 'email', mensaje: 'El correo y el RUT ya están registrados.' },
      { campo: 'rut', mensaje: 'El correo y el RUT ya están registrados.' },
    ]);
  });
});
