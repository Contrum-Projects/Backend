import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import {
  datosDelError,
  respuestaDeError,
  rutaSinQuery,
} from './datos-error.js';

class PedidosServiceDePrueba {
  crear(): never {
    throw new TypeError("Cannot read properties of undefined (reading 'id')");
  }
}

describe('respuestaDeError', () => {
  it('SCRUM-168 · una HttpException responde su estado y su cuerpo, igual que Nest', () => {
    expect(respuestaDeError(new NotFoundException('No existe.'))).toEqual({
      estado: 404,
      cuerpo: { statusCode: 404, message: 'No existe.', error: 'Not Found' },
    });
  });

  it('SCRUM-168 · un error que no es HttpException responde 500 con el mensaje genérico de Nest', () => {
    expect(respuestaDeError(new Error('se cayó la base'))).toEqual({
      estado: 500,
      cuerpo: { statusCode: 500, message: 'Internal server error' },
    });
  });

  it('SCRUM-168 · un error con statusCode (multer, body-parser) mantiene su estado', () => {
    const error = Object.assign(new Error('Archivo muy grande'), {
      statusCode: 413,
    });
    expect(respuestaDeError(error).estado).toBe(413);
  });

  it('SCRUM-168 · una HttpException con texto arma el cuerpo de Nest', () => {
    const error = new BadRequestException();
    expect(respuestaDeError(error).cuerpo).toMatchObject({ statusCode: 400 });
  });
});

describe('datosDelError', () => {
  it('SCRUM-168 · qué pasó y en qué componente: tipo, mensaje y Clase.método del primer marco propio', () => {
    let capturado: unknown;
    try {
      new PedidosServiceDePrueba().crear();
    } catch (error) {
      capturado = error;
    }

    const datos = datosDelError(capturado);

    expect(datos.tipoError).toBe('TypeError');
    expect(datos.mensaje).toBe(
      "Cannot read properties of undefined (reading 'id')",
    );
    expect(datos.componente).toBe('PedidosServiceDePrueba.crear');
    expect(datos.traza).toMatch(/^at /);
  });

  it('SCRUM-168 · criterio 4: la traza no repite el mensaje del error', () => {
    const datos = datosDelError(new Error('correo ana@prueba.cl'));
    expect(datos.traza).not.toContain('ana@prueba.cl');
  });

  it('SCRUM-168 · criterio 4: de un error de Prisma guarda solo el motivo y el código, sin los argumentos', () => {
    const error = Object.assign(
      new Error(
        [
          'Invalid `prisma.usuario.create()` invocation:',
          '',
          '{ data: { email: "ana@prueba.cl" } }',
          '',
          'Unique constraint failed on the fields: (`email`)',
        ].join('\n'),
      ),
      { name: 'PrismaClientKnownRequestError', code: 'P2002' },
    );

    expect(datosDelError(error).mensaje).toBe(
      '[P2002] Unique constraint failed on the fields: (`email`)',
    );
  });

  it('SCRUM-168 · salta los marcos de dependencias y del cliente generado', () => {
    const error = new Error('falló');
    error.stack = [
      'Error: falló',
      '    at Foo.bar (C:\\app\\node_modules\\@prisma\\client\\runtime.js:1:1)',
      '    at async Object.create (file:///app/src/generated/prisma/client.js:2:2)',
      '    at async CambiarEstadoPedidoService.cambiar (file:///app/dist/modulos/pedidos/x.js:3:3)',
    ].join('\n');

    expect(datosDelError(error).componente).toBe(
      'CambiarEstadoPedidoService.cambiar',
    );
  });

  it('SCRUM-168 · sin marcos propios, el componente queda sin valor', () => {
    const error = new Error('falló');
    error.stack = 'Error: falló\n    at node:internal/process:1:1';
    expect(datosDelError(error).componente).toBeNull();
  });

  it('SCRUM-168 · un valor lanzado que no es Error se registra igual', () => {
    expect(datosDelError('texto')).toMatchObject({
      tipoError: 'string',
      componente: null,
      traza: null,
    });
  });

  it('SCRUM-168 · el mensaje se recorta al largo de la columna', () => {
    const datos = datosDelError(
      new InternalServerErrorException('x'.repeat(2000)),
    );
    expect(datos.mensaje).toHaveLength(1000);
  });
});

describe('rutaSinQuery', () => {
  it('SCRUM-168 · criterio 4: quita la query, que puede llevar tokens', () => {
    expect(rutaSinQuery('/api/cuentas/confirmar?token=abc#x')).toBe(
      '/api/cuentas/confirmar',
    );
  });

  it('SCRUM-168 · criterio 4: oculta el token del seguimiento, que va en el camino', () => {
    expect(rutaSinQuery('/api/marketing/seguimiento/clic/abc?destino=x')).toBe(
      '/api/marketing/seguimiento/clic/[Redacted]',
    );
  });
});
