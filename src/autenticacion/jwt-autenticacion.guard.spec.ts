import { type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ROLES } from '../common/dominio/roles.js';
import {
  AUDIENCIA_TOKEN_ACCESO,
  type UsuarioAutenticado,
} from './carga-token.js';
import { JwtAutenticacionGuard } from './jwt-autenticacion.guard.js';
import type { RevocacionSesiones } from './revocacion-sesiones.js';

const SECRETO = 'secreto-de-prueba-con-al-menos-32-caracteres';
const opciones = { expiresIn: 900, audience: AUDIENCIA_TOKEN_ACCESO };
const carga = {
  sub: '0b5c7f6e-3a0e-4c55-9d43-2f0f8e2b1a11',
  sid: '5d2f9a1c-7b3e-4f60-8a91-c4e2d7f3b8a0',
  rol: ROLES.CLIENTE,
};

describe('JwtAutenticacionGuard', () => {
  let jwt: JwtService;
  let revocacion: { estaRevocada: ReturnType<typeof vi.fn> };
  let guard: JwtAutenticacionGuard;

  const contexto = (peticion: object) =>
    ({
      switchToHttp: () => ({ getRequest: () => peticion }),
    }) as unknown as ExecutionContext;

  const conToken = (token: string) => ({
    headers: { authorization: `Bearer ${token}` },
  });

  beforeEach(() => {
    jwt = new JwtService({ secret: SECRETO });
    revocacion = { estaRevocada: vi.fn().mockResolvedValue(false) };
    guard = new JwtAutenticacionGuard(
      jwt,
      revocacion as unknown as RevocacionSesiones,
    );
  });

  it('E1-H3 · token vigente de una sesión abierta: deja pasar y deja la cuenta en la petición', async () => {
    const peticion: { headers: object; usuario?: UsuarioAutenticado } =
      conToken(await jwt.signAsync(carga, opciones));

    await expect(guard.canActivate(contexto(peticion))).resolves.toBe(true);
    expect(revocacion.estaRevocada).toHaveBeenCalledWith(carga.sid);
    expect(peticion.usuario).toEqual({
      codigoPublico: carga.sub,
      rol: ROLES.CLIENTE,
      sesion: carga.sid,
    });
  });

  it('E1-H3 · cierre de sesión: el token de una sesión revocada responde 401', async () => {
    revocacion.estaRevocada.mockResolvedValue(true);
    const token = await jwt.signAsync(carga, opciones);

    await expect(guard.canActivate(contexto(conToken(token)))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('RNF-03 · sin token, con firma ajena, caducado, sin sesión o de otra audiencia o algoritmo: 401', async () => {
    const ajeno = await new JwtService({
      secret: 'otro-secreto-de-al-menos-32-caracteres',
    }).signAsync(carga, opciones);
    const caducado = await jwt.signAsync(carga, {
      ...opciones,
      expiresIn: -10,
    });
    const sinSesion = await jwt.signAsync(
      { sub: carga.sub, rol: carga.rol },
      opciones,
    );
    // Mismo secreto, pero firmado para otro uso
    const otraAudiencia = await jwt.signAsync(carga, {
      ...opciones,
      audience: 'otro-uso',
    });
    const sinAudiencia = await jwt.signAsync(carga, { expiresIn: 900 });
    const otroAlgoritmo = await jwt.signAsync(carga, {
      ...opciones,
      algorithm: 'HS512',
    });

    for (const peticion of [
      { headers: {} },
      { headers: { authorization: 'Basic abc' } },
      conToken(ajeno),
      conToken(caducado),
      conToken(sinSesion),
      conToken(otraAudiencia),
      conToken(sinAudiencia),
      conToken(otroAlgoritmo),
    ]) {
      await expect(guard.canActivate(contexto(peticion))).rejects.toThrow(
        UnauthorizedException,
      );
    }
    expect(revocacion.estaRevocada).not.toHaveBeenCalled();
  });
});
