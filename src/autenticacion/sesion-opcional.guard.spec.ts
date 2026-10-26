import { type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { JwtAutenticacionGuard } from './jwt-autenticacion.guard.js';
import { SesionOpcionalGuard } from './sesion-opcional.guard.js';

describe('SesionOpcionalGuard', () => {
  const contexto = (authorization?: string) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ headers: { authorization } }),
      }),
    }) as unknown as ExecutionContext;

  it('E2-H4 · sin token: deja pasar como visitante sin revisar nada', async () => {
    const jwt = { canActivate: vi.fn() };
    const guard = new SesionOpcionalGuard(
      jwt as unknown as JwtAutenticacionGuard,
    );

    await expect(guard.canActivate(contexto())).resolves.toBe(true);
    expect(jwt.canActivate).not.toHaveBeenCalled();
  });

  it('E2-H4 · con token: lo revisa como una ruta con sesión', async () => {
    const jwt = { canActivate: vi.fn().mockResolvedValue(true) };
    const guard = new SesionOpcionalGuard(
      jwt as unknown as JwtAutenticacionGuard,
    );
    const ctx = contexto('Bearer abc');

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(jwt.canActivate).toHaveBeenCalledWith(ctx);
  });

  it('E2-H4 · token inválido, vencido o revocado: responde 401', async () => {
    const jwt = {
      canActivate: vi.fn().mockRejectedValue(new UnauthorizedException()),
    };
    const guard = new SesionOpcionalGuard(
      jwt as unknown as JwtAutenticacionGuard,
    );

    await expect(guard.canActivate(contexto('Bearer malo'))).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
