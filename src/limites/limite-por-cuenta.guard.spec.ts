import { Reflector } from '@nestjs/core';
import type {
  ThrottlerModuleOptions,
  ThrottlerStorage,
} from '@nestjs/throttler';
import { LimitePorCuentaGuard } from './limite-por-cuenta.guard.js';

/** Expone `getTracker` para probarlo. */
class GuardDePrueba extends LimitePorCuentaGuard {
  rastrear(peticion: Record<string, unknown>) {
    return this.getTracker(peticion);
  }
}

describe('LimitePorCuentaGuard', () => {
  const guard = new GuardDePrueba(
    { throttlers: [] } as ThrottlerModuleOptions,
    {} as ThrottlerStorage,
    new Reflector(),
  );

  it('cuenta por la cuenta del token, no por la IP', async () => {
    expect(
      await guard.rastrear({
        ip: '10.0.0.1',
        usuario: { codigoPublico: 'abc' },
      }),
    ).toBe('cuenta:abc');
  });

  it('sin cuenta en la petición, cuenta por IP', async () => {
    expect(await guard.rastrear({ ip: '10.0.0.1' })).toBe('10.0.0.1');
  });
});
