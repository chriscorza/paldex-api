import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import {
  GeneratePayrollDto,
  CreatePayrollPaymentDto,
  PayPayrollDto,
  UpdatePayrollPaymentDto,
  FilterPayrollDto,
} from './dto/payroll.dto';
import {
  PayrollPaymentEntity,
  PAYROLL_PUBLIC_SELECT,
} from './entities/payroll.entity';
import { OwnershipContext, buildOwnerFilter } from '../common/ownership';
import { calculatePayDates } from './payroll-schedule';
import { Prisma as PrismaClient } from '@prisma/client';
const Decimal = PrismaClient.Decimal;
type Decimal = PrismaClient.Decimal;
import { PayrollStatus } from '@prisma/client';

const VALID_TRANSITIONS: Record<PayrollStatus, PayrollStatus[]> = {
  PENDING: ['PAID', 'CANCELLED', 'SKIPPED'],
  SCHEDULED: ['PENDING', 'CANCELLED', 'SKIPPED'],
  PAID: [],
  CANCELLED: [],
  SKIPPED: [],
};

@Injectable()
export class PayrollService {
  constructor(private prisma: PrismaService) {}

  async generate(ctx: OwnershipContext, dto: GeneratePayrollDto) {
    const employees = await this.prisma.employee.findMany({
      /*
       * Los que ya no laboran entran si tienen fecha de baja: hace falta para
       * cargar su histórico, y no hay riesgo de generarles de más porque
       * `ended_at` corta los periodos posteriores. Un inactivo sin fecha de
       * baja sí queda fuera: nada lo acotaría.
       */
      where: {
        ...buildOwnerFilter(ctx),
        OR: [{ active: true }, { ended_at: { not: null } }],
      },
    });

    const rangeStart = new Date(dto.start_date);
    const rangeEnd = new Date(dto.end_date);
    let created = 0;
    let paid = 0;
    const skipped: string[] = [];

    for (const emp of employees) {
      const effectiveEnd =
        emp.ended_at && emp.ended_at < rangeEnd ? emp.ended_at : rangeEnd;

      const payDates = calculatePayDates(
        {
          frequency: emp.pay_frequency as any,
          weekly_day: emp.weekly_pay_day,
          biweekly_first_day: emp.biweekly_first_day,
          biweekly_second_day: emp.biweekly_second_day,
          monthly_day: emp.monthly_pay_day,
        },
        rangeStart,
        effectiveEnd,
      );

      for (const period of payDates) {
        if (period.scheduled_pay_date < emp.started_at) continue;
        if (emp.ended_at && period.scheduled_pay_date > emp.ended_at) continue;

        const netAmount = new Decimal(emp.base_salary).toNumber();

        /* Lo que aún no ha vencido no se da por pagado ni pidiéndolo. */
        const alreadyPaid =
          dto.already_paid === true && period.scheduled_pay_date <= new Date();

        try {
          await this.prisma.payrollPayment.create({
            data: {
              employee_id: emp.id,
              period_start: period.period_start,
              period_end: period.period_end,
              scheduled_pay_date: period.scheduled_pay_date,
              pay_frequency_snapshot: emp.pay_frequency,
              gross_amount: emp.base_salary,
              deductions: 0,
              bonuses: 0,
              net_amount: netAmount,
              status: alreadyPaid ? 'PAID' : 'PENDING',
              paid_at: alreadyPaid ? period.scheduled_pay_date : null,
              auto_generated: true,
            },
          });
          created++;
          if (alreadyPaid) paid++;
        } catch (error: any) {
          if (error.code === 'P2002') {
            skipped.push(
              `employee ${emp.id} on ${period.scheduled_pay_date.toISOString()}`,
            );
          } else {
            throw error;
          }
        }
      }
    }

    return { created, paid, skipped: skipped.length, skipped_details: skipped };
  }

  async createManual(ctx: OwnershipContext, dto: CreatePayrollPaymentDto) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: dto.employee_id, ...buildOwnerFilter(ctx) },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    const deductions = dto.deductions ?? 0;
    const bonuses = dto.bonuses ?? 0;
    const netAmount = new Decimal(dto.gross_amount)
      .minus(new Decimal(deductions))
      .plus(new Decimal(bonuses))
      .toNumber();

    const payment = await this.prisma.payrollPayment.create({
      data: {
        employee_id: dto.employee_id,
        period_start: new Date(dto.period_start),
        period_end: new Date(dto.period_end),
        scheduled_pay_date: new Date(dto.scheduled_pay_date),
        pay_frequency_snapshot: employee.pay_frequency,
        gross_amount: dto.gross_amount,
        deductions,
        bonuses,
        net_amount: netAmount,
        account_id: dto.account_id ?? null,
        status: 'PENDING',
        auto_generated: false,
        notes: dto.notes ?? null,
      },
      select: PAYROLL_PUBLIC_SELECT,
    });
    return new PayrollPaymentEntity(payment);
  }

  async findAll(ctx: OwnershipContext, filters: FilterPayrollDto) {
    const where: any = {};

    if (filters.employee_id) {
      where.employee_id = filters.employee_id;
    }
    if (filters.status) {
      where.status = filters.status;
    }

    if (ctx.scope === 'OWN') {
      where.employee = { user_id: ctx.userId };
    }

    const dateField = filters.date_field || 'scheduled_pay_date';
    if (filters.start_date) {
      where[dateField] = {
        ...where[dateField],
        gte: new Date(filters.start_date),
      };
    }
    if (filters.end_date) {
      where[dateField] = {
        ...where[dateField],
        lte: new Date(filters.end_date),
      };
    }

    const page = filters.page || 1;
    const limit = filters.limit || 50;
    const skip = (page - 1) * limit;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.payrollPayment.findMany({
        where,
        select: PAYROLL_PUBLIC_SELECT,
        skip,
        take: limit,
        orderBy: { scheduled_pay_date: 'desc' },
      }),
      this.prisma.payrollPayment.count({ where }),
    ]);

    return {
      data: data.map((p) => new PayrollPaymentEntity(p)),
      total,
      page,
      limit,
    };
  }

  async findOne(id: number) {
    const payment = await this.prisma.payrollPayment.findUnique({
      where: { id },
      select: PAYROLL_PUBLIC_SELECT,
    });
    if (!payment) throw new NotFoundException('Payroll payment not found');
    return new PayrollPaymentEntity(payment);
  }

  async update(id: number, dto: UpdatePayrollPaymentDto) {
    const existing = await this.prisma.payrollPayment.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Payroll payment not found');

    if (existing.status === 'PAID') {
      throw new ConflictException('Cannot edit a paid payroll payment');
    }

    const deductions = dto.deductions ?? Number(existing.deductions);
    const bonuses = dto.bonuses ?? Number(existing.bonuses);
    const netAmount = new Decimal(existing.gross_amount)
      .minus(new Decimal(deductions))
      .plus(new Decimal(bonuses))
      .toNumber();

    const newStatus = dto.status ?? existing.status;
    if (dto.status && dto.status !== existing.status) {
      this.validateTransition(existing.status, newStatus as PayrollStatus);
    }

    const payment = await this.prisma.payrollPayment.update({
      where: { id },
      data: {
        deductions,
        bonuses,
        net_amount: netAmount,
        ...(dto.notes !== undefined && { notes: dto.notes }),
        ...(dto.status !== undefined && { status: dto.status }),
      },
      select: PAYROLL_PUBLIC_SELECT,
    });
    return new PayrollPaymentEntity(payment);
  }

  async pay(id: number, dto: PayPayrollDto) {
    const existing = await this.prisma.payrollPayment.findUnique({
      where: { id },
      include: { employee: true },
    });
    if (!existing) throw new NotFoundException('Payroll payment not found');

    if (existing.status === 'PAID') {
      throw new ConflictException('Payroll payment is already paid');
    }

    const accountId =
      dto.account_id ??
      existing.account_id ??
      existing.employee.default_payment_account_id;
    if (!accountId) {
      throw new BadRequestException('No payment account available');
    }

    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
    });
    if (!account || !account.is_active) {
      throw new BadRequestException(
        'Cannot use an inactive account for payment',
      );
    }

    const paid_at = dto.paid_at ? new Date(dto.paid_at) : new Date();
    const net_amount = dto.net_amount ?? existing.net_amount;

    const payment = await this.prisma.payrollPayment.update({
      where: { id },
      data: {
        status: 'PAID',
        paid_at,
        account_id: accountId,
        net_amount,
      },
      select: PAYROLL_PUBLIC_SELECT,
    });
    return new PayrollPaymentEntity(payment);
  }

  async remove(id: number) {
    const existing = await this.prisma.payrollPayment.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Payroll payment not found');

    if (existing.status === 'PAID') {
      throw new ConflictException('Cannot delete a paid payroll payment');
    }

    await this.prisma.payrollPayment.delete({ where: { id } });
  }

  private validateTransition(current: PayrollStatus, next: PayrollStatus) {
    const allowed = VALID_TRANSITIONS[current];
    if (!allowed || !allowed.includes(next)) {
      throw new ConflictException(
        `Invalid transition from ${current} to ${next}. Allowed: ${allowed?.join(', ') || 'none'}`,
      );
    }
  }
}
