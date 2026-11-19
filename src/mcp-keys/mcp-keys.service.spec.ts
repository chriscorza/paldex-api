import { Test, TestingModule } from '@nestjs/testing';
import { createHash } from 'crypto';
import { McpKeysService } from './mcp-keys.service';
import { PrismaService } from '../prisma.service';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

describe('McpKeysService', () => {
  let service: McpKeysService;
  let prisma: any;

  const storedKey = (overrides: Record<string, unknown> = {}) => ({
    id: 1,
    user_id: 9,
    owner_user_id: 1,
    token_hash: sha256('elsecreto'),
    revoked_at: null,
    expires_at: null,
    last_used_at: null,
    user: { email: 'agente@paldex.local' },
    ...overrides,
  });

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 5, invitation: { status: 'ACTIVE' } }),
      },
      mcpApiKey: {
        create: jest.fn(),
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [McpKeysService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<McpKeysService>(McpKeysService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('create', () => {
    it('devuelve el token completo una sola vez y guarda sólo el hash', async () => {
      prisma.mcpApiKey.create.mockImplementation(({ data, select }: any) => {
        expect(data.token_hash).toBeDefined();
        expect(select.id).toBe(true);
        return Promise.resolve({ id: 7, token_prefix: data.token_prefix });
      });

      const result = await service.create({
        userId: 9,
        name: 'agente',
        createdBy: 5,
      });

      expect(result.token).toMatch(/^pldx_[A-Za-z0-9_-]+_[A-Za-z0-9_-]+$/);
      expect(result.token_prefix).toBeTruthy();

      // Lo guardado es el hash del secreto, nunca el secreto ni el token.
      const guardado = prisma.mcpApiKey.create.mock.calls[0][0].data;
      const secreto = result.token.split('_').slice(2).join('_');
      expect(guardado.token_hash).toBe(sha256(secreto));
      expect(guardado.token_hash).not.toContain(secreto);
      expect(JSON.stringify(guardado)).not.toContain(secreto);
    });

    it('emite un secreto distinto cada vez', async () => {
      prisma.mcpApiKey.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 1, token_prefix: data.token_prefix }),
      );

      const a = await service.create({ userId: 9, name: 'a', createdBy: 5 });
      const b = await service.create({ userId: 9, name: 'b', createdBy: 5 });

      expect(a.token).not.toBe(b.token);
      expect(a.token_prefix).not.toBe(b.token_prefix);
    });

    it('guarda la caducidad cuando se pide', async () => {
      prisma.mcpApiKey.create.mockResolvedValue({ id: 1, token_prefix: 'x' });

      await service.create({
        userId: 9,
        name: 'a',
        expiresAt: '2027-01-01',
        createdBy: 5,
      });

      const data = prisma.mcpApiKey.create.mock.calls[0][0].data;
      expect(data.expires_at).toBeInstanceOf(Date);
    });
  });

  /*
   * Regresión. Antes el prefijo se generaba en base64url, cuyo alfabeto incluye
   * `_` —el separador—, así que una de cada ocho llaves salía con un `_` dentro
   * del prefijo, el token se partía por el sitio equivocado y la llave daba 401
   * sin explicación. Las demás pruebas no lo veían porque usaban un prefijo fijo
   * inventado; ésta usa los que genera el servicio de verdad, muchas veces.
   */
  describe('el token que emite se puede verificar (round-trip)', () => {
    const roundTrip = async () => {
      let guardado: any;
      prisma.mcpApiKey.create.mockImplementation(({ data }: any) => {
        guardado = data;
        return Promise.resolve({ id: 1, ...data });
      });

      const { token } = await service.create({
        userId: 9,
        name: 'x',
        createdBy: 5,
      });

      prisma.mcpApiKey.findUnique.mockImplementation(({ where }: any) =>
        Promise.resolve(
          where.token_prefix === guardado.token_prefix
            ? storedKey({ token_hash: guardado.token_hash })
            : null,
        ),
      );

      return { token, prefix: guardado.token_prefix };
    };

    it('vale para cualquier llave emitida, no sólo para las afortunadas', async () => {
      for (let i = 0; i < 200; i++) {
        const { token, prefix } = await roundTrip();

        await expect(service.verify(token)).resolves.not.toBeNull();
        expect(prefix).not.toContain('_');
      }
    });

    it('el prefijo nunca lleva el separador', async () => {
      for (let i = 0; i < 200; i++) {
        const { prefix } = await roundTrip();
        expect(prefix).toMatch(/^[0-9a-f]{8}$/);
      }
    });

    it('el secreto sí puede llevar el separador sin romper nada', async () => {
      // base64url sí produce `_`; el secreto es todo lo que va tras el primero.
      const conGuionBajo: string[] = [];
      for (let i = 0; i < 200 && conGuionBajo.length === 0; i++) {
        const { token } = await roundTrip();
        const secreto = token.split('_').slice(2).join('_');
        if (secreto.includes('_')) conGuionBajo.push(token);
        await expect(service.verify(token)).resolves.not.toBeNull();
      }
      expect(conGuionBajo.length).toBeGreaterThan(0);
    });
  });

  describe('verify', () => {
    it('acepta una llave válida y devuelve a su dueño', async () => {
      prisma.mcpApiKey.findUnique.mockResolvedValue(storedKey());

      await expect(service.verify('pldx_abc_elsecreto')).resolves.toEqual({
        id: 1,
        user_id: 9,
        owner_user_id: 1,
        email: 'agente@paldex.local',
      });
      expect(prisma.mcpApiKey.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { token_prefix: 'abc' } }),
      );
    });

    it('rechaza el secreto equivocado con el prefijo correcto', async () => {
      prisma.mcpApiKey.findUnique.mockResolvedValue(storedKey());

      await expect(service.verify('pldx_abc_otracosa')).resolves.toBeNull();
    });

    it('rechaza un prefijo desconocido', async () => {
      prisma.mcpApiKey.findUnique.mockResolvedValue(null);

      await expect(service.verify('pldx_nadie_loquesea')).resolves.toBeNull();
    });

    it('rechaza una llave revocada', async () => {
      prisma.mcpApiKey.findUnique.mockResolvedValue(
        storedKey({ revoked_at: new Date('2026-08-01') }),
      );

      await expect(service.verify('pldx_abc_elsecreto')).resolves.toBeNull();
    });

    it('rechaza una llave vencida', async () => {
      prisma.mcpApiKey.findUnique.mockResolvedValue(
        storedKey({ expires_at: new Date('2020-01-01') }),
      );

      await expect(service.verify('pldx_abc_elsecreto')).resolves.toBeNull();
    });

    it('acepta una llave cuya caducidad aún no llega', async () => {
      prisma.mcpApiKey.findUnique.mockResolvedValue(
        storedKey({ expires_at: new Date(Date.now() + 86_400_000) }),
      );

      await expect(
        service.verify('pldx_abc_elsecreto'),
      ).resolves.not.toBeNull();
    });

    it('rechaza cualquier cosa que no tenga la forma de una llave', async () => {
      for (const malo of [
        'no-es-una-llave',
        'pldx_',
        'pldx_soloprefijo',
        'pldx__sinprefijo',
        'Bearer pldx_abc_x',
        '',
      ]) {
        await expect(service.verify(malo)).resolves.toBeNull();
      }
      expect(prisma.mcpApiKey.findUnique).not.toHaveBeenCalled();
    });

    it('un JWT no se confunde con una llave', async () => {
      await expect(
        service.verify('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc.def'),
      ).resolves.toBeNull();
      expect(prisma.mcpApiKey.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('last_used_at', () => {
    it('lo anota la primera vez que se usa', async () => {
      prisma.mcpApiKey.findUnique.mockResolvedValue(storedKey());

      await service.verify('pldx_abc_elsecreto');

      expect(prisma.mcpApiKey.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 1 } }),
      );
    });

    it('no lo reescribe si es reciente', async () => {
      prisma.mcpApiKey.findUnique.mockResolvedValue(
        storedKey({ last_used_at: new Date(Date.now() - 60_000) }),
      );

      await service.verify('pldx_abc_elsecreto');

      expect(prisma.mcpApiKey.update).not.toHaveBeenCalled();
    });

    it('lo reescribe si ya pasó la ventana', async () => {
      prisma.mcpApiKey.findUnique.mockResolvedValue(
        storedKey({ last_used_at: new Date(Date.now() - 10 * 60_000) }),
      );

      await service.verify('pldx_abc_elsecreto');

      expect(prisma.mcpApiKey.update).toHaveBeenCalled();
    });

    /*
     * Anotar cuándo se usó una llave no puede tumbar la petición que anota.
     */
    it('si falla la anotación, la verificación sigue siendo válida', async () => {
      prisma.mcpApiKey.findUnique.mockResolvedValue(storedKey());
      prisma.mcpApiKey.update.mockRejectedValue(new Error('base caída'));

      await expect(
        service.verify('pldx_abc_elsecreto'),
      ).resolves.not.toBeNull();
    });
  });

  describe('dueño de los libros (owner_user_id)', () => {
    beforeEach(() => {
      prisma.mcpApiKey.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 1, token_prefix: data.token_prefix }),
      );
    });

    it('sin owner_user_id, se guarda el usuario que la crea (al crear, no al llamar)', async () => {
      await service.create({ userId: 9, name: 'a', createdBy: 5 });

      expect(prisma.mcpApiKey.create.mock.calls[0][0].data.owner_user_id).toBe(
        5,
      );
    });

    it('con owner_user_id explícito, se guarda ése', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 7, invitation: null });

      await service.create({
        userId: 9,
        name: 'a',
        createdBy: 5,
        ownerUserId: 7,
      });

      expect(prisma.mcpApiKey.create.mock.calls[0][0].data.owner_user_id).toBe(
        7,
      );
    });

    it('rechaza un dueño que no existe, nombrando el id, y no crea nada', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.create({ userId: 9, name: 'a', createdBy: 5, ownerUserId: 77 }),
      ).rejects.toThrow(/77/);
      expect(prisma.mcpApiKey.create).not.toHaveBeenCalled();
    });

    it('rechaza un dueño con la invitación revocada', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 7,
        invitation: { status: 'REVOKED' },
      });

      await expect(
        service.create({ userId: 9, name: 'a', createdBy: 5, ownerUserId: 7 }),
      ).rejects.toThrow(/7.*activo/);
    });

    it('re-enlazar valida al dueño y actualiza sólo owner_user_id', async () => {
      prisma.mcpApiKey.findUnique.mockResolvedValue({ id: 1 });
      prisma.user.findUnique.mockResolvedValue({ id: 3, invitation: null });

      await service.setOwner(1, 3);

      expect(prisma.mcpApiKey.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1 },
          data: { owner_user_id: 3 },
        }),
      );
    });

    it('re-enlazar a un usuario inexistente o inactivo falla sin tocar la llave', async () => {
      prisma.mcpApiKey.findUnique.mockResolvedValue({ id: 1 });
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.setOwner(1, 99)).rejects.toThrow(/99/);
      expect(prisma.mcpApiKey.update).not.toHaveBeenCalled();
    });

    it('re-enlazar una llave inexistente da 404', async () => {
      prisma.mcpApiKey.findUnique.mockResolvedValue(null);

      await expect(service.setOwner(5, 3)).rejects.toThrow(/not found/);
    });

    it('el listado proyecta owner_user_id', async () => {
      await service.findAll();

      const select = prisma.mcpApiKey.findMany.mock.calls[0][0].select;
      expect(select.owner_user_id).toBe(true);
    });
  });

  describe('listar y revocar', () => {
    it('nunca proyecta el hash', async () => {
      await service.findAll();

      const select = prisma.mcpApiKey.findMany.mock.calls[0][0].select;
      expect(select.token_hash).toBeUndefined();
      expect(select.token_prefix).toBe(true);
    });

    it('revocar marca la fila sin borrarla', async () => {
      prisma.mcpApiKey.findUnique.mockResolvedValue({
        id: 1,
        revoked_at: null,
      });

      await service.revoke(1);

      expect(prisma.mcpApiKey.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1 },
          data: { revoked_at: expect.any(Date) },
        }),
      );

      // Ni siquiera al revocar sale el hash.
      const select = prisma.mcpApiKey.update.mock.calls[0][0].select;
      expect(select.token_hash).toBeUndefined();
    });

    it('revocar dos veces no cambia la fecha original', async () => {
      const yaRevocada = new Date('2026-08-01');
      prisma.mcpApiKey.findUnique.mockResolvedValue({
        id: 1,
        revoked_at: yaRevocada,
      });

      await service.revoke(1);

      expect(prisma.mcpApiKey.update).not.toHaveBeenCalled();
    });
  });
});
