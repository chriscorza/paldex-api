import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma.service';
import { PermissionsService } from 'src/permissions/permissions.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { USER_SELECT, SafeUser } from './entities/user.entity';

@Injectable()
export class UserService {
  constructor(
    private prisma: PrismaService,
    private permissionsService: PermissionsService,
  ) {}

  async createUser(dto: CreateUserDto): Promise<SafeUser> {
    const defaultRole = await this.prisma.role.findUnique({
      where: { name: 'user' },
    });
    return this.prisma.user.create({
      data: {
        email: dto.email,
        password: dto.password,
        name: dto.name,
        photo_url: dto.photo_url,
        locale: dto.locale,
        ...(defaultRole && { role: { connect: { id: defaultRole.id } } }),
      },
      select: USER_SELECT,
    });
  }

  async findMe(userId: number): Promise<SafeUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: USER_SELECT,
    });
    if (!user) {
      throw new NotFoundException(`User with id ${userId} not found`);
    }
    return user;
  }

  async updateMe(userId: number, dto: UpdateUserDto): Promise<SafeUser> {
    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
      select: USER_SELECT,
    });
    if (!existing) {
      throw new NotFoundException(`User with id ${userId} not found`);
    }

    if (dto.email !== undefined && dto.email !== existing.email) {
      const conflict = await this.prisma.user.findFirst({
        where: { email: dto.email, id: { not: userId } },
      });
      if (conflict) {
        throw new ConflictException('Email is already in use by another user');
      }
    }

    try {
      return await this.prisma.user.update({
        where: { id: userId },
        data: {
          ...(dto.email !== undefined && { email: dto.email }),
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.photo_url !== undefined && { photo_url: dto.photo_url }),
          ...(dto.locale !== undefined && { locale: dto.locale }),
        },
        select: USER_SELECT,
      });
    } catch (error: any) {
      if (error?.code === 'P2002') {
        throw new ConflictException('Email is already in use by another user');
      }
      throw error;
    }
  }

  async removeMe(userId: number): Promise<SafeUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: USER_SELECT,
    });
    if (!user) {
      throw new NotFoundException(`User with id ${userId} not found`);
    }
    return this.prisma.user.delete({
      where: { id: userId },
      select: USER_SELECT,
    });
  }

  async findAll(page: number, limit: number, search?: string) {
    const where = search
      ? {
          OR: [{ email: { contains: search } }, { name: { contains: search } }],
        }
      : {};

    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: USER_SELECT,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async assignRole(userId: number, roleId: number): Promise<SafeUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role_id: true },
    });
    if (!user) {
      throw new NotFoundException(`User with id ${userId} not found`);
    }

    const role = await this.prisma.role.findUnique({
      where: { id: roleId },
      select: { id: true, name: true },
    });
    if (!role) {
      throw new BadRequestException(`Role with id ${roleId} not found`);
    }

    if (user.role_id !== roleId && user.role_id) {
      const oldRole = await this.prisma.role.findUnique({
        where: { id: user.role_id },
        select: { name: true },
      });
      if (oldRole?.name === 'admin') {
        const adminCount = await this.prisma.user.count({
          where: { role_id: user.role_id },
        });
        if (adminCount <= 1) {
          throw new ConflictException('Cannot remove the last admin user');
        }
      }
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { role_id: roleId },
      select: USER_SELECT,
    });

    if (user.role_id) {
      this.permissionsService.invalidate(user.role_id);
    }
    this.permissionsService.invalidate(roleId);

    return updated;
  }
}
