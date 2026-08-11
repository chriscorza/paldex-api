import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma.service';
import { PERMISSION_CATALOG } from './permission-catalog';

/*
 * Cache de permisos por rol.
 * Por proceso — con más de una instancia de la API la invalidación no se propaga.
 * Ver design.md §6 y §Riesgos.
 */
@Injectable()
export class PermissionsService implements OnModuleInit {
  private readonly logger = new Logger(PermissionsService.name);
  private cache = new Map<number, Map<string, string>>();

  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    await this.syncCatalog();
  }

  async syncCatalog() {
    const adminRole = await this.prisma.role.findUnique({
      where: { name: 'admin' },
    });

    for (const perm of PERMISSION_CATALOG) {
      const scope = 'scope' in perm ? perm.scope : 'ANY';
      let permission = await this.prisma.permission.findFirst({
        where: {
          resource: perm.resource,
          action: perm.action,
          scope: scope as any,
        },
      });
      if (!permission) {
        permission = await this.prisma.permission.create({
          data: {
            resource: perm.resource,
            action: perm.action,
            scope: scope as any,
          },
        });
        this.logger.log(
          `Created permission: ${perm.resource}:${perm.action} (${scope})`,
        );
      }

      /*
       * El rol admin es el superusuario del sistema: cualquier permiso del
       * catálogo que le falte se le otorga automáticamente al arrancar, para
       * que dar de alta un recurso nuevo no requiera un paso manual aparte
       * en /roles. Ver design.md de invite-only-registration.
       */
      if (adminRole) {
        const grant = await this.prisma.rolePermission.findFirst({
          where: { role_id: adminRole.id, permission_id: permission.id },
        });
        if (!grant) {
          await this.prisma.rolePermission.create({
            data: { role_id: adminRole.id, permission_id: permission.id },
          });
          this.logger.log(
            `Granted ${perm.resource}:${perm.action} (${scope}) to admin role`,
          );
        }
      }
    }

    const catalogKeys = PERMISSION_CATALOG.map(
      (p) => `${p.resource}:${p.action}`,
    );
    const allInDb = await this.prisma.permission.findMany({
      select: { id: true, resource: true, action: true },
    });
    const orphans = allInDb.filter(
      (p) => !catalogKeys.includes(`${p.resource}:${p.action}`),
    );
    if (orphans.length > 0) {
      this.logger.warn(
        `Orphaned permissions in DB (not in catalog): ${orphans.map((o) => `${o.resource}:${o.action}`).join(', ')}`,
      );
    }
  }

  async resolvePermissions(
    roleId: number,
  ): Promise<Map<string, string> | null> {
    if (this.cache.has(roleId)) {
      return this.cache.get(roleId)!;
    }

    const rolePermissions = await this.prisma.rolePermission.findMany({
      where: { role_id: roleId },
      include: { permission: true },
    });

    const perms = new Map<string, string>();
    for (const rp of rolePermissions) {
      const key = `${rp.permission.resource}:${rp.permission.action}`;
      const existing = perms.get(key);
      if (!existing || rp.permission.scope === 'ANY') {
        perms.set(key, rp.permission.scope);
      }
    }

    this.cache.set(roleId, perms);
    return perms;
  }

  invalidate(roleId: number) {
    this.cache.delete(roleId);
  }

  invalidateAll() {
    this.cache.clear();
  }
}
