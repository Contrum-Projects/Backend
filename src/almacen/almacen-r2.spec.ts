import { ServiceUnavailableException } from '@nestjs/common';
import { AlmacenNoConfigurado, AlmacenR2 } from './almacen-r2.js';

describe('AlmacenR2 · enlace temporal', () => {
  const almacen = new AlmacenR2({
    cuenta: 'cuentaprueba',
    idClave: 'clave-id',
    claveSecreta: 'clave-secreta',
    bucket: 'cabello-perfecto',
  });

  it('E10-H7 · el enlace firma el archivo con su vencimiento y se abre con el nombre indicado, sin guardarse en cachés', async () => {
    const url = new URL(
      await almacen.urlTemporal('verificaciones/7/a.pdf', {
        segundos: 300,
        nombreArchivo: 'título del alumno.pdf',
      }),
    );

    expect(url.hostname).toBe(
      'cabello-perfecto.cuentaprueba.r2.cloudflarestorage.com',
    );
    expect(url.pathname).toContain('verificaciones/7/a.pdf');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.searchParams.get('X-Amz-Signature')).toBeTruthy();
    // El nombre va codificado: conserva las tildes y no rompe la cabecera
    expect(url.searchParams.get('response-content-disposition')).toBe(
      "inline; filename*=UTF-8''t%C3%ADtulo%20del%20alumno.pdf",
    );
    expect(url.searchParams.get('response-cache-control')).toBe(
      'private, no-store',
    );
  });

  it('E10-H7 · sin nombre de archivo el enlace solo pide abrirlo', async () => {
    const url = new URL(
      await almacen.urlTemporal('verificaciones/7/a.pdf', { segundos: 60 }),
    );

    expect(url.searchParams.get('X-Amz-Expires')).toBe('60');
    expect(url.searchParams.get('response-content-disposition')).toBe('inline');
  });

  it('E10-H7 · sin R2 configurado el enlace responde 503', async () => {
    await expect(
      new AlmacenNoConfigurado().urlTemporal(),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
