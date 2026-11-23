import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { PermissionsService } from '../permissions/permissions.service';
import { McpKeysService } from '../mcp-keys/mcp-keys.service';
import { McpToolsService } from './mcp-tools.service';

export const AGENT_ROLE_NAME = 'ai_agent';

/* Una cuenta de servicio por dueño de libros: su correo es determinista y no recibe correo. */
export const serviceAccountEmail = (ownerUserId: number) =>
  `asistente-ia-${ownerUserId}@agente.paldex.local`;

/*
 * Prepara, de un clic, todo lo que el asistente de IA necesita para trabajar
 * con permisos propios en vez de con los de una persona:
 *
 *   1. El rol `ai_agent`, con exactamente los permisos que piden las tools MCP
 *      (leídos del registro), en alcance OWN donde exista.
 *   2. Un usuario de servicio con ese rol. Sin contraseña ni cuenta de Google:
 *      no puede iniciar sesión en la app, sólo autenticarse con su llave.
 *   3. Una llave nueva de ese usuario, ligada a los libros de quien la pide.
 *
 * Es idempotente: si el rol o el usuario ya existen se reutilizan, y al rol
 * sólo se le AGREGAN los permisos que falten —nunca se le quitan, por si
 * alguien los ajustó a mano—. Cada llamada emite una llave nueva; las viejas
 * se revocan aparte.
 */
@Injectable()
export class McpServiceAccountService {
  private readonly logger = new Logger(McpServiceAccountService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly keys: McpKeysService,
    private readonly tools: McpToolsService,
  ) {}

  async provision(params: { callerUserId: number; keyName?: string }) {
    const ownerUserId = params.callerUserId;

    const role = await this.ensureRole();
    const granted = await this.grantToolPermissions(role.id);
    const user = await this.ensureServiceUser(role.id, ownerUserId);

    const key = await this.keys.create({
      userId: user.id,
      name: params.keyName?.trim() || 'Asistente de IA',
      createdBy: params.callerUserId,
      ownerUserId,
    });

    this.logger.log(
      JSON.stringify({
        msg: 'agent service account provisioned',
        role_id: role.id,
        service_user_id: user.id,
        owner_user_id: ownerUserId,
        key_id: key.id,
        permissions_added: granted.added.length,
      }),
    );

    return {
      role: {
        id: role.id,
        name: role.name,
        permissions_added: granted.added,
        permissions_total: granted.total,
      },
      service_account: { id: user.id, name: user.name, email: user.email },
      key,
    };
  }

  private async ensureRole() {
    const existing = await this.prisma.role.findUnique({
      where: { name: AGENT_ROLE_NAME },
    });
    if (existing) return existing;
    return this.prisma.role.create({
      data: {
        name: AGENT_ROLE_NAME,
        description:
          'Asistente de IA (MCP). Sus permisos son el techo de lo que el agente puede hacer. Lo creó Paldex.',
        is_system: false,
      },
    });
  }

  /* Agrega lo que falte; no quita nada. Devuelve qué agregó y cuántos pide en total. */
  private async grantToolPermissions(roleId: number) {
    const needed = Array.from(
      new Set(this.tools.registry.map((d) => d.permission)),
    ).sort();
    const current = await this.prisma.rolePermission.findMany({
      where: { role_id: roleId },
      include: { permission: true },
    });
    const has = new Set(
      current.map((rp) => `${rp.permission.resource}:${rp.permission.action}`),
    );

    const added: string[] = [];
    for (const key of needed) {
      if (has.has(key)) continue;
      const [resource, action] = key.split(':');
      const candidates = await this.prisma.permission.findMany({
        where: { resource, action },
      });
      const pick = candidates.find((p) => p.scope === 'OWN') ?? candidates[0];
      if (!pick) {
        this.logger.warn(
          `Permission ${key} is not in the database; restart the API to sync the catalog`,
        );
        continue;
      }
      await this.prisma.rolePermission.create({
        data: { role_id: roleId, permission_id: pick.id },
      });
      added.push(`${key} (${pick.scope})`);
    }
    if (added.length) this.permissions.invalidate(roleId);
    return { added, total: needed.length };
  }

  private async ensureServiceUser(roleId: number, ownerUserId: number) {
    const email = serviceAccountEmail(ownerUserId);
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      if (existing.role_id !== roleId) {
        return this.prisma.user.update({
          where: { id: existing.id },
          data: { role_id: roleId },
        });
      }
      return existing;
    }
    return this.prisma.user.create({
      data: {
        email,
        name: 'Asistente de IA',
        password: null,
        role_id: roleId,
        locale: 'es',
      },
    });
  }
}
