import {
  BadRequestException,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Entorno } from '../../config/entorno.js';
import { type ClienteIa, ErrorServicioIa } from './cliente-ia.js';
import { FirmaSugerencia } from './firma-sugerencia.js';
import { TAMANO_MAXIMO_IMAGEN_BYTES } from './imagenes.service.js';
import {
  MENSAJE_FOTO_ILEGIBLE,
  MENSAJE_IA_NO_DISPONIBLE,
  SugerenciaDescripcionService,
} from './sugerencia-descripcion.service.js';

const jpeg = () => {
  const buffer = Buffer.alloc(1024);
  buffer.set([0xff, 0xd8, 0xff, 0xe0]);
  return { buffer, size: buffer.length };
};

describe('SugerenciaDescripcionService', () => {
  const leerReverso = vi.fn<ClienteIa['leerReverso']>();
  const firma = new FirmaSugerencia({
    get: () => 's'.repeat(32),
  } as unknown as ConfigService<Entorno, true>);
  const servicio = new SugerenciaDescripcionService({ leerReverso }, firma);

  beforeEach(() => {
    leerReverso.mockReset();
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('E4-H1 · sugerencia generada: devuelve la descripción sugerida y los ingredientes transcritos', async () => {
    leerReverso.mockResolvedValue({
      legible: true,
      descripcion: 'Shampoo reparador para cabello dañado.',
      ingredientes: 'Aqua, Glycerin',
    });
    const archivo = jpeg();

    await expect(servicio.sugerir(archivo)).resolves.toEqual({
      descripcion: 'Shampoo reparador para cabello dañado.',
      ingredientes: 'Aqua, Glycerin',
      firma: firma.firmar('Shampoo reparador para cabello dañado.'),
    });
    expect(leerReverso).toHaveBeenCalledWith(archivo.buffer, {
      tipoContenido: 'image/jpeg',
      extension: 'jpg',
    });
  });

  it('E4-H1 · foto ilegible: responde 422 con el aviso de escribirla a mano', async () => {
    leerReverso.mockResolvedValue({ legible: false });

    await expect(servicio.sugerir(jpeg())).rejects.toThrow(
      new UnprocessableEntityException(MENSAJE_FOTO_ILEGIBLE),
    );
  });

  it('E4-H1 · servicio no disponible: responde 503 con el aviso de escribirla a mano y registra solo el motivo', async () => {
    leerReverso.mockRejectedValue(
      new ErrorServicioIa('Gemini no respondió a tiempo'),
    );
    const advertir = vi.spyOn(Logger.prototype, 'warn');

    await expect(servicio.sugerir(jpeg())).rejects.toThrow(
      new ServiceUnavailableException(MENSAJE_IA_NO_DISPONIBLE),
    );
    expect(advertir).toHaveBeenCalledWith(
      expect.stringContaining('Gemini no respondió a tiempo'),
    );
  });

  it('E4-H1 · un error que no es del servicio de IA no se disfraza de 503', async () => {
    leerReverso.mockRejectedValue(new TypeError('falla interna'));

    await expect(servicio.sugerir(jpeg())).rejects.toBeInstanceOf(TypeError);
  });

  it('E4-H1 · sin imagen, no es JPEG, PNG ni WebP o pasa de 5 MB: 400 sin llamar a la IA', async () => {
    await expect(servicio.sugerir(undefined)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    const texto = Buffer.from('no soy una imagen');
    await expect(
      servicio.sugerir({ buffer: texto, size: texto.length }),
    ).rejects.toThrow('La imagen debe ser JPEG, PNG o WebP.');
    await expect(
      servicio.sugerir({
        ...jpeg(),
        size: TAMANO_MAXIMO_IMAGEN_BYTES + 1,
      }),
    ).rejects.toThrow('La imagen no puede superar los 5 MB.');
    expect(leerReverso).not.toHaveBeenCalled();
  });
});
