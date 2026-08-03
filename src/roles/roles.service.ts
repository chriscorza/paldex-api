import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma.service';
import { PermissionsService } from 'src/permissions/permissions.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { SetRolePermissionsDto } from './dto/set-role-permissions.dto';
import { PaginatedRoleResponse } from './entities/role.entity';

@Injectable()
export class RolesService {
  constructor(
    private prisma: PrismaService,
    private permissionsService: PermissionsService,
  ) {}

  async findAll(
    page = 1,
    limit = 20,
    search?: string,
  ): Promise<PaginatedRoleResponse> {
    const where = search ? { name: { contains: search } } : {};
    const [data, total] = await this.prisma.$transaction([
      this.prisma.role.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { name: 'asc' },
      }),
      this.prisma.role.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: number) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: {
        permissions: {
          include: { permission: true },
        },
      },
    });
    if (!role) throw new NotFoundException(`Role with id ${id} not found`);
    return role;
  }

  async create(dto: CreateRoleDto) {
    const existing = await this.prisma.role.findUnique({
      where: { name: dto.name },
    });
    if (existing) {
      throw new ConflictException(`Role "${dto.name}" already exists`);
    }
    return this.prisma.role.create({ data: dto });
  }

  async update(id: number, dto: UpdateRoleDto) {
    const role = await this.prisma.role.findUnique({ where: { id } });
    if (!role) throw new NotFoundException(`Role with id ${id} not found`);
    if (role.is_system && dto.name) {
      throw new ConflictException('Cannot rename system roles');
    }
    if (dto.name) {
      const conflict = await this.prisma.role.findFirst({
        where: { name: dto.name, id: { not: id } },
      });
      if (conflict)
        throw new ConflictException(`Role "${dto.name}" already exists`);
    }
    return this.prisma.role.update({ where: { id }, data: dto });
  }

  async remove(id: number) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: { _count: { select: { users: true } } },
    });
    if (!role) throw new NotFoundException(`Role with id ${id} not found`);
    if (role.is_system) {
      throw new ConflictException('Cannot delete system roles');
    }
    if (role._count.users > 0) {
      throw new ConflictException(
        `Cannot delete role: ${role._count.users} users are assigned`,
      );
    }
    await this.prisma.role.delete({ where: { id } });
    this.permissionsService.invalidate(id);
  }

  async setPermissions(id: number, dto: SetRolePermissionsDto) {
    const role = await this.prisma.role.findUnique({ where: { id } });
    if (!role) throw new NotFoundException(`Role with id ${id} not found`);

    if (dto.permission_ids.length > 0) {
      const count = await this.prisma.permission.count({
        where: { id: { in: dto.permission_ids } },
      });
      if (count !== dto.permission_ids.length) {
        throw new BadRequestException('One or more permission_ids are invalid');
      }
    }

    if (role.name === 'admin') {
      const adminPerms = await this.prisma.permission.findMany({
        where: { id: { in: dto.permission_ids } },
      });
      const hasRoleUpdate = adminPerms.some(
        (p) => p.resource === 'role' && p.action === 'update',
      );
      const hasAssignRole = adminPerms.some(
        (p) => p.resource === 'user' && p.action === 'assign_role',
      );
      if (!hasRoleUpdate || !hasAssignRole) {
        throw new ConflictException(
          'Admin role must retain role:update and user:assign_role permissions',
        );
      }
    }

    await this.prisma.rolePermission.deleteMany({ where: { role_id: id } });
    if (dto.permission_ids.length > 0) {
      await this.prisma.rolePermission.createMany({
        data: dto.permission_ids.map((pid) => ({
          role_id: id,
          permission_id: pid,
        })),
      });
    }

    this.permissionsService.invalidate(id);
    return this.findOne(id);
  }

  async countUsersByRole(roleId: number): Promise<number> {
    return this.prisma.user.count({ where: { role_id: roleId } });
  }
}
