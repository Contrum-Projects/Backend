import type { ConfigService } from '@nestjs/config';
import type { Entorno } from '../../config/entorno.js';
import { FirmaSugerencia } from './firma-sugerencia.js';

const firmaDePrueba = (secreto = 's'.repeat(32)) =>
  new FirmaSugerencia({
    get: () => secreto,
  } as unknown as ConfigService<Entorno, true>);

describe('FirmaSugerencia', () => {
  const firma = firmaDePrueba();

  it('acepta la firma del mismo texto', () => {
    const texto = 'Shampoo reparador para cabello dañado.';
    expect(firma.verificar(texto, firma.firmar(texto))).toBe(true);
  });

  it('rechaza la firma si el texto sugerido cambió', () => {
    const valida = firma.firmar('Texto de la IA.');
    expect(firma.verificar('Texto de la IA!', valida)).toBe(false);
  });

  it('rechaza una firma con otro secreto o con un formato que no es hexadecimal', () => {
    const texto = 'Texto de la IA.';
    const ajena = firmaDePrueba('o'.repeat(32)).firmar(texto);
    expect(firma.verificar(texto, ajena)).toBe(false);
    expect(firma.verificar(texto, 'no-es-una-firma')).toBe(false);
    expect(firma.verificar(texto, firma.firmar(texto).toUpperCase())).toBe(
      false,
    );
  });
});
