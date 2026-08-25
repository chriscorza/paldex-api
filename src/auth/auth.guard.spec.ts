import { UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { ALLOW_API_KEY, IS_PUBLIC_KEY } from '../globalConstants';

/*
 * `AuthGuard` es global: cualquier cosa que se decida aquí aplica a toda la API.
 * El camino de las API keys tiene que fallar cerrado, y estas pruebas son lo que
 * hace que una regresión que lo abra rompa el build.
 */
describe('AuthGuard', () => {
  let jwtService: any;
  let reflector: any;
  let mcpKeysService: any;
  let guard: AuthGuard;

  /*
   * `getAllAndOverride` se consulta con dos claves distintas —pública y
   * acepta-llave—, así que el doble responde según cuál le pregunten.
   */
  const metadata = (values: Record<string, unknown>) => ({
    getAllAndOverride: jest.fn((key: string) => values[key]),
  });

  const contextWith = (authorization?: string) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ headers: authorization ? { authorization } : {} }),
      }),
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
    }) as any;

  const build = () => new AuthGuard(jwtService, reflector, mcpKeysService);

  beforeEach(() => {
    jwtService = { verifyAsync: jest.fn() };
    reflector = metadata({});
    mcpKeysService = { verify: jest.fn() };
    guard = build();
  });

  it('should be defined', () => {
    expect(build()).toBeDefined();
  });

  it('deja pasar una ruta pública sin mirar credenciales', async () => {
    reflector = metadata({ [IS_PUBLIC_KEY]: true });

    await expect(build().canActivate(contextWith())).resolves.toBe(true);
    expect(mcpKeysService.verify).not.toHaveBeenCalled();
  });

  it('rechaza una petición sin token', async () => {
    await expect(guard.canActivate(contextWith())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  describe('camino del JWT', () => {
    it('sigue funcionando igual que antes', async () => {
      jwtService.verifyAsync.mockResolvedValue({ id: 5, email: 'a@b.c' });

      await expect(
        guard.canActivate(contextWith('Bearer un.jwt.valido')),
      ).resolves.toBe(true);
      expect(mcpKeysService.verify).not.toHaveBeenCalled();
    });

    it('rechaza un JWT inválido', async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error('firma mala'));

      await expect(
        guard.canActivate(contextWith('Bearer un.jwt.roto')),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('un JWT funciona en una ruta con @AllowApiKey, no sólo la llave', async () => {
      reflector = metadata({ [ALLOW_API_KEY]: true });
      jwtService.verifyAsync.mockResolvedValue({ id: 5, email: 'a@b.c' });

      await expect(
        build().canActivate(contextWith('Bearer un.jwt.valido')),
      ).resolves.toBe(true);
    });
  });

  describe('camino de la API key', () => {
    it('acepta una llave válida en una ruta que la permite', async () => {
      reflector = metadata({ [ALLOW_API_KEY]: true });
      mcpKeysService.verify.mockResolvedValue({
        id: 1,
        user_id: 9,
        email: 'agente@paldex.local',
      });

      const request: any = {
        headers: { authorization: 'Bearer pldx_abc_sec' },
      };
      const context = {
        switchToHttp: () => ({ getRequest: () => request }),
        getHandler: () => jest.fn(),
        getClass: () => jest.fn(),
      } as any;

      await expect(build().canActivate(context)).resolves.toBe(true);
      // La misma forma que deja el JWT, para que nada aguas abajo distinga.
      expect(request.user).toEqual({ id: 9, email: 'agente@paldex.local' });
    });

    /*
     * El caso que importa: una llave buena en una ruta que no la habilitó. Debe
     * cortarse *antes* de buscarla, y sin caer al camino del JWT.
     */
    it('rechaza una llave válida en una ruta sin @AllowApiKey', async () => {
      mcpKeysService.verify.mockResolvedValue({
        id: 1,
        user_id: 9,
        email: 'agente@paldex.local',
      });

      await expect(
        guard.canActivate(contextWith('Bearer pldx_abc_sec')),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(mcpKeysService.verify).not.toHaveBeenCalled();
      expect(jwtService.verifyAsync).not.toHaveBeenCalled();
    });

    it('rechaza una llave que el servicio no valida', async () => {
      reflector = metadata({ [ALLOW_API_KEY]: true });
      mcpKeysService.verify.mockResolvedValue(null);

      await expect(
        build().canActivate(contextWith('Bearer pldx_abc_malo')),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('no intenta verificar como JWT algo con pinta de llave', async () => {
      reflector = metadata({ [ALLOW_API_KEY]: true });
      mcpKeysService.verify.mockResolvedValue(null);

      await expect(
        build().canActivate(contextWith('Bearer pldx_loquesea')),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(jwtService.verifyAsync).not.toHaveBeenCalled();
    });

    it('sin el esquema Bearer no se autentica', async () => {
      reflector = metadata({ [ALLOW_API_KEY]: true });

      await expect(
        build().canActivate(contextWith('pldx_abc_sec')),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
});
