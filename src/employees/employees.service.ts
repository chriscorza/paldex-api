import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import {
  CreateEmployeeDto,
  UpdateEmployeeDto,
  FilterEmployeesDto,
} from './dto/create-employee.dto';
import {
  EmployeeEntity,
  EMPLOYEE_PUBLIC_SELECT,
  parseSalesDays,
} from './entities/employee.entity';
import { OwnershipContext, buildOwnerFilter } from '../common/ownership';
import { PayFrequency, Prisma } from '@prisma/client';
import { startOfDayInZone, endOfDayInZone } from '../common/timezone';

@Injectable()
export class EmployeesService {
  constructor(private prisma: PrismaService) {}

  async findAll(ctx: OwnershipContext, filters: FilterEmployeesDto) {
    const where: any = { ...buildOwnerFilter(ctx) };

    if (filters.active !== undefined) {
      where.active = filters.active;
    }
    if (filters.pay_frequency) {
      where.pay_frequency = filters.pay_frequency;
    }
    if (filters.search) {
      where.name = { contains: filters.search };
    }

    const page = filters.page || 1;
    const limit = filters.limit || 50;
    const skip = (page - 1) * limit;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.employee.findMany({
        where,
        select: EMPLOYEE_PUBLIC_SELECT,
        skip,
        take: limit,
        orderBy: { name: 'asc' },
      }),
      this.prisma.employee.count({ where }),
    ]);

    return { data: data.map((e) => new EmployeeEntity(e)), total, page, limit };
  }

  async findOne(ctx: OwnershipContext, id: number) {
    const employee = await this.prisma.employee.findFirst({
      where: { id, ...buildOwnerFilter(ctx) },
      select: EMPLOYEE_PUBLIC_SELECT,
    });
    if (!employee) throw new NotFoundException('Employee not found');
    return new EmployeeEntity(employee);
  }

  async create(ctx: OwnershipContext, dto: CreateEmployeeDto) {
    this.validatePayDayCoherence(dto);
    this.validatePayDayRanges(dto);

    if (dto.default_payment_account_id) {
      await this.validateAccount(ctx, dto.default_payment_account_id);
    }

    const active = dto.active ?? true;

    /*
     * La comprobación de solape y la escritura van en la misma transacción: si
     * no, dos altas simultáneas pasan las dos la comprobación y acaban con el
     * mismo día repartido entre dos personas, que es justo lo que haría contar
     * esas ventas dos veces en el reporte.
     */
    const employee = await this.prisma.$transaction(async (tx) => {
      if (active && dto.sales_days?.length) {
        await this.validateSalesDaysExclusivity(tx, ctx.userId, dto.sales_days);
      }

      return tx.employee.create({
        data: {
          name: dto.name,
          position: dto.position ?? null,
          salary_type: dto.salary_type ?? 'SALARIED',
          pay_frequency: dto.pay_frequency,
          base_salary: dto.base_salary,
          weekly_pay_day: dto.weekly_pay_day ?? null,
          biweekly_first_day: dto.biweekly_first_day ?? null,
          biweekly_second_day: dto.biweekly_second_day ?? null,
          monthly_pay_day: dto.monthly_pay_day ?? null,
          default_payment_account_id: dto.default_payment_account_id ?? null,
          started_at: dto.started_at
            ? startOfDayInZone(dto.started_at)
            : new Date(),
          /*
           * Fin de jornada, no medianoche: `ended_at` es el último día que se
           * trabajó, y con la medianoche el pago de ese mismo día caía fuera.
           */
          ended_at: dto.ended_at ? endOfDayInZone(dto.ended_at) : null,
          active,
          user_id: ctx.userId,
          sales_days: dto.sales_days ?? Prisma.DbNull,
        },
        select: EMPLOYEE_PUBLIC_SELECT,
      });
    });

    return new EmployeeEntity(employee);
  }

  async update(ctx: OwnershipContext, id: number, dto: UpdateEmployeeDto) {
    const existing = await this.prisma.employee.findFirst({
      where: { id, ...buildOwnerFilter(ctx) },
    });
    if (!existing) throw new NotFoundException('Employee not found');

    if (dto.default_payment_account_id) {
      await this.validateAccount(ctx, dto.default_payment_account_id);
    }

    const updateData: any = {};
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.position !== undefined) updateData.position = dto.position;
    if (dto.salary_type !== undefined) updateData.salary_type = dto.salary_type;
    if (dto.pay_frequency !== undefined)
      updateData.pay_frequency = dto.pay_frequency;
    if (dto.base_salary !== undefined) updateData.base_salary = dto.base_salary;
    if (dto.weekly_pay_day !== undefined)
      updateData.weekly_pay_day = dto.weekly_pay_day;
    if (dto.biweekly_first_day !== undefined)
      updateData.biweekly_first_day = dto.biweekly_first_day;
    if (dto.biweekly_second_day !== undefined)
      updateData.biweekly_second_day = dto.biweekly_second_day;
    if (dto.monthly_pay_day !== undefined)
      updateData.monthly_pay_day = dto.monthly_pay_day;
    if (dto.default_payment_account_id !== undefined)
      updateData.default_payment_account_id = dto.default_payment_account_id;
    if (dto.started_at !== undefined)
      updateData.started_at = new Date(dto.started_at);
    if (dto.ended_at !== undefined)
      updateData.ended_at = dto.ended_at ? new Date(dto.ended_at) : null;
    if (dto.active !== undefined) updateData.active = dto.active;
    if (dto.sales_days !== undefined) updateData.sales_days = dto.sales_days;

    this.validatePayDayCoherence({ ...existing, ...updateData });

    /*
     * Con qué días y en qué estado queda el empleado después de esta edición:
     * lo que no venga en el body se queda como estaba.
     */
    const resultingDays =
      dto.sales_days !== undefined
        ? dto.sales_days
        : parseSalesDays(existing.sales_days);
    const resultingActive =
      dto.active !== undefined ? dto.active : existing.active;

    /*
     * Reactivar también reclama días. Sin esta segunda condición, un empleado
     * inactivo con el fin de semana asignado se reactivaba sin más y el reporte
     * pasaba a contar dos veces las ventas del sábado y el domingo.
     */
    const claimsDays =
      resultingActive &&
      resultingDays.length > 0 &&
      (dto.sales_days !== undefined ||
        (dto.active === true && !existing.active));

    const employee = await this.prisma.$transaction(async (tx) => {
      if (claimsDays) {
        await this.validateSalesDaysExclusivity(
          tx,
          existing.user_id,
          resultingDays,
          id,
        );
      }

      return tx.employee.update({
        where: { id },
        data: updateData,
        select: EMPLOYEE_PUBLIC_SELECT,
      });
    });

    return new EmployeeEntity(employee);
  }

  /*
   * Un día pertenece como mucho a un empleado activo: si dos lo reclaman, sus
   * ventas se suman en los dos renglones del reporte y el total deja de cuadrar
   * con el reporte mensual.
   *
   * La unicidad no la puede imponer MySQL sobre una columna JSON, así que se
   * comprueba aquí, dentro de la transacción que escribe. Los inactivos no
   * bloquean días —quien ya no trabaja no tiene turno—, pero reactivarlos sí
   * vuelve a pasar por aquí.
   *
   * El dueño se recibe explícito y no sale de `buildOwnerFilter`: con alcance
   * `ANY` ese filtro va vacío, y el lunes de un negocio chocaría con el lunes de
   * otro. Los turnos sólo compiten entre los empleados de un mismo dueño.
   */
  private async validateSalesDaysExclusivity(
    tx: Prisma.TransactionClient,
    ownerId: number,
    days: number[],
    excludeEmployeeId?: number,
  ) {
    const others = await tx.employee.findMany({
      where: {
        user_id: ownerId,
        active: true,
        ...(excludeEmployeeId ? { id: { not: excludeEmployeeId } } : {}),
      },
      select: { id: true, name: true, sales_days: true },
    });

    const wanted = new Set(days);

    for (const other of others) {
      const taken = parseSalesDays(other.sales_days).filter((d) =>
        wanted.has(d),
      );
      if (taken.length > 0) {
        throw new ConflictException(
          `Los días [${taken.join(', ')}] ya están asignados a ${other.name}. ` +
            'Un día sólo puede pertenecer a un empleado activo.',
        );
      }
    }
  }

  async remove(ctx: OwnershipContext, id: number) {
    const existing = await this.prisma.employee.findFirst({
      where: { id, ...buildOwnerFilter(ctx) },
    });
    if (!existing) throw new NotFoundException('Employee not found');

    const paymentCount = await this.prisma.payrollPayment.count({
      where: { employee_id: id },
    });

    if (paymentCount > 0) {
      throw new ConflictException(
        `Cannot delete employee with ${paymentCount} payroll payments. Deactivate the employee instead.`,
      );
    }

    await this.prisma.employee.delete({ where: { id } });
  }

  async findPayments(
    ctx: OwnershipContext,
    id: number,
    startDate?: string,
    endDate?: string,
    status?: string,
  ) {
    const employee = await this.prisma.employee.findFirst({
      where: { id, ...buildOwnerFilter(ctx) },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    const where: any = { employee_id: id };
    if (startDate)
      where.scheduled_pay_date = {
        ...where.scheduled_pay_date,
        gte: new Date(startDate),
      };
    if (endDate)
      where.scheduled_pay_date = {
        ...where.scheduled_pay_date,
        lte: new Date(endDate),
      };
    if (status) where.status = status;

    return this.prisma.payrollPayment.findMany({
      where,
      orderBy: { scheduled_pay_date: 'desc' },
    });
  }

  private validatePayDayCoherence(dto: any) {
    const freq = dto.pay_frequency as PayFrequency;

    if (freq === 'WEEKLY') {
      const day = dto.weekly_pay_day ?? null;
      if (day === null || day === undefined) {
        throw new BadRequestException(
          'weekly_pay_day is required for WEEKLY pay frequency',
        );
      }
      if (
        dto.biweekly_first_day !== undefined &&
        dto.biweekly_first_day !== null
      ) {
        throw new BadRequestException(
          'biweekly_first_day must not be set for WEEKLY pay frequency',
        );
      }
      if (dto.monthly_pay_day !== undefined && dto.monthly_pay_day !== null) {
        throw new BadRequestException(
          'monthly_pay_day must not be set for WEEKLY pay frequency',
        );
      }
    } else if (freq === 'BIWEEKLY') {
      if (
        dto.biweekly_first_day === undefined ||
        dto.biweekly_first_day === null ||
        dto.biweekly_second_day === undefined ||
        dto.biweekly_second_day === null
      ) {
        throw new BadRequestException(
          'biweekly_first_day and biweekly_second_day are required for BIWEEKLY pay frequency',
        );
      }
      if (dto.weekly_pay_day !== undefined && dto.weekly_pay_day !== null) {
        throw new BadRequestException(
          'weekly_pay_day must not be set for BIWEEKLY pay frequency',
        );
      }
      if (dto.monthly_pay_day !== undefined && dto.monthly_pay_day !== null) {
        throw new BadRequestException(
          'monthly_pay_day must not be set for BIWEEKLY pay frequency',
        );
      }
    } else if (freq === 'MONTHLY') {
      const day = dto.monthly_pay_day ?? null;
      if (day === null || day === undefined) {
        throw new BadRequestException(
          'monthly_pay_day is required for MONTHLY pay frequency',
        );
      }
      if (dto.weekly_pay_day !== undefined && dto.weekly_pay_day !== null) {
        throw new BadRequestException(
          'weekly_pay_day must not be set for MONTHLY pay frequency',
        );
      }
      if (
        dto.biweekly_first_day !== undefined &&
        dto.biweekly_first_day !== null
      ) {
        throw new BadRequestException(
          'biweekly_first_day must not be set for MONTHLY pay frequency',
        );
      }
    }
  }

  private validatePayDayRanges(dto: any) {
    if (dto.weekly_pay_day !== undefined && dto.weekly_pay_day !== null) {
      if (dto.weekly_pay_day < 1 || dto.weekly_pay_day > 7) {
        throw new BadRequestException('weekly_pay_day must be between 1 and 7');
      }
    }
    if (
      dto.biweekly_first_day !== undefined &&
      dto.biweekly_first_day !== null
    ) {
      if (dto.biweekly_first_day < 1 || dto.biweekly_first_day > 31) {
        throw new BadRequestException(
          'biweekly_first_day must be between 1 and 31',
        );
      }
    }
    if (
      dto.biweekly_second_day !== undefined &&
      dto.biweekly_second_day !== null
    ) {
      if (dto.biweekly_second_day < 1 || dto.biweekly_second_day > 31) {
        throw new BadRequestException(
          'biweekly_second_day must be between 1 and 31',
        );
      }
      if (dto.biweekly_first_day === dto.biweekly_second_day) {
        throw new BadRequestException('biweekly pay days must be different');
      }
    }
    if (dto.monthly_pay_day !== undefined && dto.monthly_pay_day !== null) {
      if (dto.monthly_pay_day < 1 || dto.monthly_pay_day > 31) {
        throw new BadRequestException(
          'monthly_pay_day must be between 1 and 31',
        );
      }
    }
  }

  private async validateAccount(ctx: OwnershipContext, accountId: number) {
    const account = await this.prisma.account.findFirst({
      where: { id: accountId, ...buildOwnerFilter(ctx) },
    });
    if (!account) {
      throw new BadRequestException('Payment account not found');
    }
    if (!account.is_active) {
      throw new BadRequestException(
        'Cannot use an inactive account as default payment account',
      );
    }
  }
}
