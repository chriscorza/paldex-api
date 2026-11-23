import {
  McpServiceAccountService,
  serviceAccountEmail,
} from './mcp-service-account.service';
import { McpToolsService } from './mcp-tools.service';

describe('McpServiceAccountService', () => {
  const tools = {
    registry: [
      { permission: 'expense:read' },
      { permission: 'expense:create' },
      { permission: 'expense:read' },
      { permission: 'tax:read' },
    ],
  } as unknown as McpToolsService;

  const catalog = [
    { id: 1, resource: 'expense', action: 'read', scope: 'ANY' },
    { id: 2, resource: 'expense', action: 'read', scope: 'OWN' },
    { id: 3, resource: 'expense', action: 'create', scope: 'OWN' },
    { id: 4, resource: 'tax', action: 'read', scope: 'ANY' },
  ];

  let roles: any[];
  let rolePermissions: any[];
  let users: any[];
  let prisma: any;
  let keys: { create: jest.Mock };
  let permissions: { invalidate: jest.Mock };

  const service = () =>
    new McpServiceAccountService(
      prisma,
      permissions as any,
      keys as any,
      tools,
    );

  beforeEach(() => {
    roles = [];
    rolePermissions = [];
    users = [{ id: 1, email: 'chris@x', role_id: 100 }];
    let nextId = 50;
    prisma = {
      role: {
        findUnique: jest.fn(({ where }) =>
          Promise.resolve(roles.find((r) => r.name === where.name) ?? null),
        ),
        create: jest.fn(({ data }) => {
          const r = { id: nextId++, ...data };
          roles.push(r);
          return Promise.resolve(r);
        }),
      },
      rolePermission: {
        findMany: jest.fn(({ where }) =>
          Promise.resolve(
            rolePermissions
              .filter((rp) => rp.role_id === where.role_id)
              .map((rp) => ({
                ...rp,
                permission: catalog.find((p) => p.id === rp.permission_id),
              })),
          ),
        ),
        create: jest.fn(({ data }) => {
          rolePermissions.push(data);
          return Promise.resolve(data);
        }),
      },
      permission: {
        findMany: jest.fn(({ where }) =>
          Promise.resolve(
            catalog.filter(
              (p) => p.resource === where.resource && p.action === where.action,
            ),
          ),
        ),
      },
      user: {
        findUnique: jest.fn(({ where }) =>
          Promise.resolve(users.find((u) => u.email === where.email) ?? null),
        ),
        create: jest.fn(({ data }) => {
          const u = { id: nextId++, ...data };
          users.push(u);
          return Promise.resolve(u);
        }),
        update: jest.fn(({ where, data }) => {
          const u = users.find((x) => x.id === where.id);
          Object.assign(u, data);
          return Promise.resolve(u);
        }),
      },
    };
    keys = {
      create: jest.fn((p) =>
        Promise.resolve({
          id: 9,
          token: 'pldx_abc',
          user_id: p.userId,
          owner_user_id: p.ownerUserId,
        }),
      ),
    };
    permissions = { invalidate: jest.fn() };
  });

  it('crea el rol con los permisos de las tools en OWN, un usuario sin contraseña y una llave ligada a quien llama', async () => {
    const result = await service().provision({ callerUserId: 1 });

    expect(roles).toHaveLength(1);
    expect(roles[0].name).toBe('ai_agent');
    expect(rolePermissions.map((rp) => rp.permission_id).sort()).toEqual([
      2, 3, 4,
    ]);
    expect(permissions.invalidate).toHaveBeenCalledWith(roles[0].id);

    const agent = users.find((u) => u.email === serviceAccountEmail(1));
    expect(agent).toMatchObject({
      password: null,
      role_id: roles[0].id,
      name: 'Asistente de IA',
    });

    expect(keys.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: agent.id,
        ownerUserId: 1,
        createdBy: 1,
        name: 'Asistente de IA',
      }),
    );
    expect(result.key.token).toBe('pldx_abc');
    expect(result.role.permissions_total).toBe(3);
  });

  it('repetirlo reutiliza rol y usuario, no duplica permisos y emite otra llave', async () => {
    await service().provision({ callerUserId: 1 });
    const second = await service().provision({
      callerUserId: 1,
      keyName: 'Llave 2',
    });

    expect(roles).toHaveLength(1);
    expect(
      users.filter((u) => u.email === serviceAccountEmail(1)),
    ).toHaveLength(1);
    expect(rolePermissions).toHaveLength(3);
    expect(second.role.permissions_added).toEqual([]);
    expect(keys.create).toHaveBeenCalledTimes(2);
    expect(keys.create.mock.calls[1][0].name).toBe('Llave 2');
  });

  it('no quita permisos que alguien agregó a mano al rol', async () => {
    roles.push({ id: 77, name: 'ai_agent' });
    rolePermissions.push({ role_id: 77, permission_id: 1 });

    await service().provision({ callerUserId: 1 });

    expect(rolePermissions.map((rp) => rp.permission_id).sort()).toEqual([
      1, 3, 4,
    ]);
  });
});
