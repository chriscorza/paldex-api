import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { InvitationStatus } from '@prisma/client';
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
    const invitation = await this.prisma.invitation.findUnique({
      where: { email: dto.email },
    });
    if (!invitation || invitation.status !== InvitationStatus.PENDING) {
      throw new ForbiddenException(
        'Este email no tiene una invitación pendiente',
      );
    }

    const defaultRole = await this.prisma.role.findUnique({
      where: { name: 'user' },
    });

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
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

      await tx.invitation.update({
        where: { id: invitation.id },
        data: {
          status: InvitationStatus.ACTIVE,
          user_id: user.id,
          accepted_at: new Date(),
        },
      });

      return user;
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

  /*
   * Liga (o desliga, con null) una cuenta a los libros de otra: un socio del
   * mismo negocio. Desde la siguiente petición lee y escribe en los libros del
   * dueño (PermissionsGuard -> OwnershipContext.ownerUserId).
   *
   * Sólo se liga una cuenta sin libros propios: si ya registró algo, moverlo es
   * una decisión aparte y aquí se rechaza con el detalle. Sus categorías del
   * sistema, sembradas al arrancar y sin uso, se borran: en adelante usa las
   * del dueño.
   */
  async setBooksOwner(
    userId: number,
    booksOwnerId: number | null,
  ): Promise<SafeUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, book_members: { select: { id: true } } },
    });
    if (!user) throw new NotFoundException(`User with id ${userId} not found`);

    if (booksOwnerId === null) {
      return this.prisma.user.update({
        where: { id: userId },
        data: { books_owner_id: null },
        select: USER_SELECT,
      });
    }

    if (booksOwnerId === userId) {
      throw new BadRequestException(
        'Para trabajar en sus propios libros manda books_owner_id: null',
      );
    }
    const owner = await this.prisma.user.findUnique({
      where: { id: booksOwnerId },
      select: { id: true, books_owner_id: true },
    });
    if (!owner) {
      throw new BadRequestException(`User with id ${booksOwnerId} not found`);
    }
    if (owner.books_owner_id !== null) {
      throw new BadRequestException(
        `La cuenta ${booksOwnerId} trabaja a su vez en los libros de la ${owner.books_owner_id}: liga a esa`,
      );
    }
    if (user.book_members.length) {
      throw new ConflictException(
        `Otras cuentas trabajan en los libros de la ${userId} (${user.book_members.map((m) => m.id).join(', ')}): desligalas primero`,
      );
    }

    const own = await this.ownBookData(userId);
    const nonEmpty = Object.entries(own).filter(([, n]) => n > 0);
    if (nonEmpty.length) {
      throw new ConflictException(
        `La cuenta ${userId} ya tiene datos en sus propios libros (${nonEmpty
          .map(([k, n]) => `${k}: ${n}`)
          .join(
            ', ',
          )}); hay que pasarlos a los libros del dueño antes de ligarla`,
      );
    }

    // recurring_expenses.category_id no es relación en el esquema: se consulta aparte,
    // en todas las cuentas (una plantilla ajena pudo elegirla mientras se veían todas).
    const usedByTemplates = (
      await this.prisma.recurringExpense.findMany({
        select: { category_id: true },
        distinct: ['category_id'],
      })
    ).map((r) => r.category_id);

    return this.prisma.$transaction(async (tx) => {
      await tx.expenseCategory.deleteMany({
        where: {
          user_id: userId,
          is_system: true,
          expenses: { none: {} },
          id: { notIn: usedByTemplates },
        },
      });
      return tx.user.update({
        where: { id: userId },
        data: { books_owner_id: booksOwnerId },
        select: USER_SELECT,
      });
    });
  }

  /* Lo que una cuenta tiene en sus propios libros. Las categorías del sistema no cuentan. */
  private async ownBookData(userId: number) {
    const w = { user_id: userId };
    const p = this.prisma;
    const [
      expenses,
      incomes,
      accounts,
      employees,
      tax_payments,
      recurring_expenses,
      payables,
      receivables,
      fixed_assets,
      product_costs,
      shopify_connections,
      custom_categories,
    ] = await Promise.all([
      p.expense.count({ where: w }),
      p.income.count({ where: w }),
      p.account.count({ where: w }),
      p.employee.count({ where: w }),
      p.taxPayment.count({ where: w }),
      p.recurringExpense.count({ where: w }),
      p.payable.count({ where: w }),
      p.receivable.count({ where: w }),
      p.fixedAsset.count({ where: w }),
      p.productCost.count({ where: w }),
      p.shopifyConnection.count({ where: w }),
      p.expenseCategory.count({ where: { ...w, is_system: false } }),
    ]);
    return {
      expenses,
      incomes,
      accounts,
      employees,
      tax_payments,
      recurring_expenses,
      payables,
      receivables,
      fixed_assets,
      product_costs,
      shopify_connections,
      custom_categories,
    };
  }
}
