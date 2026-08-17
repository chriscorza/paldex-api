import { Test, TestingModule } from '@nestjs/testing';
import { EmployeesService } from './employees.service';
import { PrismaService } from '../prisma.service';
import {
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';

const ctx = { userId: 1, scope: 'ANY' as const };

describe('EmployeesService', () => {
  let service: EmployeesService;
  let prisma: any;

  const mockEmployee = {
    id: 1,
    name: 'Juan',
    position: 'Developer',
    salary_type: 'SALARIED',
    pay_frequency: 'MONTHLY',
    base_salary: 30000,
    weekly_pay_day: null,
    biweekly_first_day: null,
    biweekly_second_day: null,
    monthly_pay_day: 15,
    default_payment_account_id: null,
    started_at: new Date('2026-01-01'),
    ended_at: null,
    active: true,
    user_id: 1,
  };

  beforeEach(async () => {
    prisma = {
      employee: {
        findMany: jest.fn(),
        count: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      account: {
        findFirst: jest.fn(),
      },
      payrollPayment: {
        count: jest.fn(),
        findMany: jest.fn(),
      },
      /*
       * Las dos formas: `findAll` pasa un array de consultas, y `create` y
       * `update` pasan un callback para comprobar el solape de turnos y escribir
       * en la misma transacción.
       */
      $transaction: jest.fn((arg: any) =>
        Array.isArray(arg) ? Promise.all(arg) : arg(prisma),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmployeesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<EmployeesService>(EmployeesService);
  });

  describe('create - frequency validation', () => {
    const baseDto = {
      name: 'Juan',
      pay_frequency: 'MONTHLY' as const,
      base_salary: 30000,
      monthly_pay_day: 15,
    };

    it('should create employee with valid MONTHLY config', async () => {
      prisma.employee.create.mockResolvedValue(mockEmployee);

      const result = await service.create(ctx, baseDto as any);
      expect(result.id).toBe(1);
    });

    it('should reject WEEKLY without weekly_pay_day', async () => {
      await expect(
        service.create(ctx, {
          ...baseDto,
          pay_frequency: 'WEEKLY',
          monthly_pay_day: undefined,
          weekly_pay_day: undefined,
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject BIWEEKLY without both days', async () => {
      await expect(
        service.create(ctx, {
          ...baseDto,
          pay_frequency: 'BIWEEKLY',
          monthly_pay_day: undefined,
          biweekly_first_day: 15,
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject MONTHLY without monthly_pay_day', async () => {
      await expect(
        service.create(ctx, {
          ...baseDto,
          monthly_pay_day: undefined,
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject WEEKLY with monthly_pay_day set', async () => {
      await expect(
        service.create(ctx, {
          ...baseDto,
          pay_frequency: 'WEEKLY',
          weekly_pay_day: 3,
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject BIWEEKLY with weekly_pay_day set', async () => {
      await expect(
        service.create(ctx, {
          ...baseDto,
          pay_frequency: 'BIWEEKLY',
          monthly_pay_day: undefined,
          biweekly_first_day: 15,
          biweekly_second_day: 30,
          weekly_pay_day: 3,
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject MONTHLY with weekly_pay_day set', async () => {
      await expect(
        service.create(ctx, {
          ...baseDto,
          weekly_pay_day: 3,
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject invalid weekly_pay_day range', async () => {
      await expect(
        service.create(ctx, {
          name: 'Juan',
          pay_frequency: 'WEEKLY',
          base_salary: 1000,
          weekly_pay_day: 8,
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject biweekly days that are the same', async () => {
      await expect(
        service.create(ctx, {
          name: 'Juan',
          pay_frequency: 'BIWEEKLY',
          base_salary: 1000,
          biweekly_first_day: 15,
          biweekly_second_day: 15,
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject invalid monthly_pay_day range', async () => {
      await expect(
        service.create(ctx, {
          name: 'Juan',
          pay_frequency: 'MONTHLY',
          base_salary: 1000,
          monthly_pay_day: 32,
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject inactive payment account', async () => {
      (prisma.account.findFirst as jest.Mock).mockResolvedValue({
        id: 99,
        is_active: false,
      });

      await expect(
        service.create(ctx, {
          ...baseDto,
          default_payment_account_id: 99,
        } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  /*
   * Los turnos de venta: un día pertenece como mucho a un empleado activo,
   * porque si dos lo reclaman sus ventas se suman en los dos renglones del
   * reporte y el total deja de cuadrar con el reporte mensual.
   */
  describe('sales_days', () => {
    const baseDto = {
      name: 'Luis',
      pay_frequency: 'MONTHLY' as const,
      base_salary: 30000,
      monthly_pay_day: 15,
    };

    it('guarda los días al dar de alta', async () => {
      prisma.employee.findMany.mockResolvedValue([]);
      prisma.employee.create.mockResolvedValue({
        ...mockEmployee,
        sales_days: [1, 2, 3, 4, 5],
      });

      const result = await service.create(ctx, {
        ...baseDto,
        sales_days: [1, 2, 3, 4, 5],
      } as any);

      expect(result.sales_days).toEqual([1, 2, 3, 4, 5]);
      expect(prisma.employee.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ sales_days: [1, 2, 3, 4, 5] }),
        }),
      );
    });

    it('asigna días a un empleado que no tenía', async () => {
      prisma.employee.findFirst.mockResolvedValue({
        ...mockEmployee,
        sales_days: null,
      });
      prisma.employee.findMany.mockResolvedValue([]);
      prisma.employee.update.mockResolvedValue({
        ...mockEmployee,
        sales_days: [6, 7],
      });

      const result = await service.update(ctx, 1, {
        sales_days: [6, 7],
      } as any);

      expect(result.sales_days).toEqual([6, 7]);
    });

    it('deja quitar todos los días con una lista vacía', async () => {
      prisma.employee.findFirst.mockResolvedValue({
        ...mockEmployee,
        sales_days: [6, 7],
      });
      prisma.employee.update.mockResolvedValue({
        ...mockEmployee,
        sales_days: [],
      });

      const result = await service.update(ctx, 1, { sales_days: [] } as any);

      expect(result.sales_days).toEqual([]);
      /* Sin días que reclamar no hace falta ir a buscar solapes. */
      expect(prisma.employee.findMany).not.toHaveBeenCalled();
    });

    it('devuelve null en un empleado dado de alta antes de los turnos', async () => {
      prisma.employee.findFirst.mockResolvedValue(mockEmployee);

      const result = await service.findOne(ctx, 1);

      expect(result.sales_days).toBeNull();
    });

    it('rechaza con 409 el día que ya tiene otro empleado activo', async () => {
      prisma.employee.findFirst.mockResolvedValue({
        ...mockEmployee,
        id: 2,
        name: 'Félix',
        sales_days: [6, 7],
      });
      prisma.employee.findMany.mockResolvedValue([
        { id: 1, name: 'Luis', sales_days: [1, 2, 3, 4, 5] },
      ]);

      await expect(
        service.update(ctx, 2, { sales_days: [5, 6, 7] } as any),
      ).rejects.toThrow(ConflictException);
      expect(prisma.employee.update).not.toHaveBeenCalled();
    });

    it('nombra el día y a quien lo tiene', async () => {
      prisma.employee.findMany.mockResolvedValue([
        { id: 1, name: 'Luis', sales_days: [1, 2, 3, 4, 5] },
      ]);

      await expect(
        service.create(ctx, { ...baseDto, sales_days: [5, 6] } as any),
      ).rejects.toThrow(/\[5\].*Luis/);
    });

    /* Quien ya no trabaja no tiene turno: no bloquea el día. */
    it('no bloquea el día si quien lo tenía está inactivo', async () => {
      prisma.employee.findMany.mockResolvedValue([]);
      prisma.employee.create.mockResolvedValue({
        ...mockEmployee,
        sales_days: [6, 7],
      });

      const result = await service.create(ctx, {
        ...baseDto,
        sales_days: [6, 7],
      } as any);

      expect(result.sales_days).toEqual([6, 7]);
      expect(prisma.employee.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ active: true }),
        }),
      );
    });

    /*
     * El caso que se escapaba: reactivar también reclama días. Sin comprobarlo,
     * el reporte pasaba a contar dos veces las ventas del fin de semana.
     */
    it('rechaza reactivar a un inactivo cuyos días ya están tomados', async () => {
      prisma.employee.findFirst.mockResolvedValue({
        ...mockEmployee,
        id: 2,
        name: 'Félix',
        active: false,
        sales_days: [6, 7],
      });
      prisma.employee.findMany.mockResolvedValue([
        { id: 1, name: 'Luis', sales_days: [5, 6, 7] },
      ]);

      await expect(
        service.update(ctx, 2, { active: true } as any),
      ).rejects.toThrow(ConflictException);
      expect(prisma.employee.update).not.toHaveBeenCalled();
    });

    it('deja reactivar cuando sus días siguen libres', async () => {
      prisma.employee.findFirst.mockResolvedValue({
        ...mockEmployee,
        id: 2,
        name: 'Félix',
        active: false,
        sales_days: [6, 7],
      });
      prisma.employee.findMany.mockResolvedValue([
        { id: 1, name: 'Luis', sales_days: [1, 2, 3, 4, 5] },
      ]);
      prisma.employee.update.mockResolvedValue({
        ...mockEmployee,
        id: 2,
        name: 'Félix',
        sales_days: [6, 7],
      });

      const result = await service.update(ctx, 2, { active: true } as any);

      expect(result.sales_days).toEqual([6, 7]);
    });

    /*
     * Con alcance ANY el filtro de propiedad va vacío, y sin acotar por dueño el
     * lunes de un negocio chocaría con el lunes de otro.
     */
    it('sólo compara turnos entre empleados del mismo dueño', async () => {
      prisma.employee.findMany.mockResolvedValue([]);
      prisma.employee.create.mockResolvedValue({
        ...mockEmployee,
        sales_days: [1],
      });

      await service.create(ctx, { ...baseDto, sales_days: [1] } as any);

      expect(prisma.employee.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ user_id: ctx.userId }),
        }),
      );
    });
  });

  describe('remove - deactivation vs delete', () => {
    it('should throw 409 when employee has payroll payments', async () => {
      prisma.employee.findFirst.mockResolvedValue({ id: 1, active: true });
      prisma.payrollPayment.count.mockResolvedValue(3);

      await expect(service.remove(ctx, 1)).rejects.toThrow(ConflictException);
    });

    it('should delete employee with no payments', async () => {
      prisma.employee.findFirst.mockResolvedValue({ id: 1, active: true });
      prisma.payrollPayment.count.mockResolvedValue(0);
      prisma.employee.delete.mockResolvedValue({});

      await service.remove(ctx, 1);
      expect(prisma.employee.delete).toHaveBeenCalledWith({ where: { id: 1 } });
    });

    it('should throw NotFoundException', async () => {
      prisma.employee.findFirst.mockResolvedValue(null);
      await expect(service.remove(ctx, 9999)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findPayments', () => {
    it('should return payments for employee', async () => {
      prisma.employee.findFirst.mockResolvedValue({ id: 1 });
      prisma.payrollPayment.findMany.mockResolvedValue([
        { id: 1, net_amount: 30000, status: 'PAID' },
      ]);

      const result = await service.findPayments(ctx, 1);
      expect(result).toHaveLength(1);
    });

    it('should throw NotFoundException for non-existent employee', async () => {
      prisma.employee.findFirst.mockResolvedValue(null);
      await expect(service.findPayments(ctx, 9999)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
