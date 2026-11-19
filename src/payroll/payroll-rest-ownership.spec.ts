import 'reflect-metadata';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';

/*
 * fix-payroll-rest-ownership, de punta a punta sin base de datos: el
 * PayrollController y el PayrollService REALES contra un Prisma falso que SÍ
 * evalúa `where` anidados (`employee: { user_id }`). El `matches` de
 * mcp-attribution.spec.ts ignora los objetos anidados (los da por verdaderos),
 * así que aquí no se reutiliza: con él, un filtro de propiedad pasaría siempre.
 */

const A = 1;
const B = 2;

/** Igualdad por campo; objeto anidado => se evalúa contra la relación. */
function matches(
  row: any,
  where: any,
  rel: (row: any, key: string) => any,
): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('gte' in v || 'lte' in v || 'not' in v) return true; // no usados aquí
      const target = rel(row, k);
      return target ? matches(target, v, rel) : Object.keys(v).length === 0;
    }
    return row[k] === v;
  });
}

describe('PayrollController — propiedad REST (fix-payroll-rest-ownership)', () => {
  let controller: PayrollController;
  let employees: any[];
  let accounts: any[];
  let payments: any[];
  let nextId: number;
  let prisma: any;

  const userA = { id: A };
  const reqOwn = { permissionScope: 'OWN' };
  const reqAny = { permissionScope: 'ANY' };

  const rel = (row: any, key: string) =>
    key === 'employee'
      ? employees.find((e) => e.id === row.employee_id)
      : undefined;

  const withEmployee = (p: any) =>
    p && { ...p, employee: employees.find((e) => e.id === p.employee_id) };

  beforeEach(() => {
    nextId = 1000;
    employees = [
      {
        id: 100,
        user_id: A,
        pay_frequency: 'MONTHLY',
        default_payment_account_id: null,
        active: true,
        ended_at: null,
        base_salary: 1000,
        monthly_pay_day: 15,
        started_at: new Date('2026-01-01'),
      },
      {
        id: 200,
        user_id: B,
        pay_frequency: 'MONTHLY',
        default_payment_account_id: 20,
        active: true,
        ended_at: null,
        base_salary: 1000,
        monthly_pay_day: 15,
        started_at: new Date('2026-01-01'),
      },
    ];
    accounts = [
      { id: 10, user_id: A, is_active: true },
      { id: 20, user_id: B, is_active: true },
    ];
    payments = [
      {
        id: 1,
        employee_id: 100,
        status: 'PENDING',
        gross_amount: 1000,
        deductions: 0,
        bonuses: 0,
        net_amount: 1000,
        account_id: null,
        paid_at: null,
      },
      {
        id: 2,
        employee_id: 200,
        status: 'PENDING',
        gross_amount: 1000,
        deductions: 0,
        bonuses: 0,
        net_amount: 1000,
        account_id: null,
        paid_at: null,
      },
      {
        id: 3,
        employee_id: 200,
        status: 'PAID',
        gross_amount: 1000,
        deductions: 0,
        bonuses: 0,
        net_amount: 1000,
        account_id: 20,
        paid_at: new Date('2026-01-15'),
      },
    ];

    prisma = {
      employee: {
        findFirst: jest.fn(({ where }) =>
          Promise.resolve(
            employees.find((e) => matches(e, where, rel)) ?? null,
          ),
        ),
        findMany: jest.fn(({ where }) =>
          Promise.resolve(
            employees.filter((e) =>
              matches(
                e,
                Object.fromEntries(
                  Object.entries(where).filter(([k]) => k !== 'OR'),
                ),
                rel,
              ),
            ),
          ),
        ),
      },
      account: {
        findFirst: jest.fn(({ where }) =>
          Promise.resolve(accounts.find((a) => matches(a, where, rel)) ?? null),
        ),
        findUnique: jest.fn(({ where }) =>
          Promise.resolve(accounts.find((a) => a.id === where.id) ?? null),
        ),
      },
      payrollPayment: {
        findFirst: jest.fn(({ where }) =>
          Promise.resolve(
            withEmployee(payments.find((p) => matches(p, where, rel))) ?? null,
          ),
        ),
        findMany: jest.fn(({ where }) =>
          Promise.resolve(
            payments
              .filter((p) => matches(p, where, rel))
              .map((p) => withEmployee(p)),
          ),
        ),
        count: jest.fn(({ where }) =>
          Promise.resolve(
            payments.filter((p) => matches(p, where, rel)).length,
          ),
        ),
        create: jest.fn(({ data }) => {
          const row = { id: nextId++, ...data };
          payments.push(row);
          return Promise.resolve(withEmployee(row));
        }),
        update: jest.fn(({ where, data }) => {
          const p = payments.find((x) => x.id === where.id);
          Object.assign(p, data);
          return Promise.resolve(withEmployee(p));
        }),
        delete: jest.fn(({ where }) => {
          payments = payments.filter((x) => x.id !== where.id);
          return Promise.resolve({});
        }),
      },
      $transaction: jest.fn((ops: any[]) => Promise.all(ops)),
    };

    controller = new PayrollController(new PayrollService(prisma));
  });

  const find = (id: number) => payments.find((p) => p.id === id);

  describe('el fake aplica where anidados (guarda del propio test)', () => {
    it('un pago de B no matchea employee.user_id = A', () => {
      expect(matches(find(2), { employee: { user_id: A } }, rel)).toBe(false);
      expect(matches(find(1), { employee: { user_id: A } }, rel)).toBe(true);
    });
  });

  describe('A con scope OWN no alcanza pagos de B', () => {
    it('GET /payroll/:id → 404', async () => {
      await expect(controller.findOne(userA, reqOwn, 2)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('PATCH /payroll/:id → 404 y el pago no cambia', async () => {
      await expect(
        controller.update(userA, reqOwn, 2, { deductions: 500 }),
      ).rejects.toThrow(NotFoundException);
      expect(find(2).deductions).toBe(0);
      expect(prisma.payrollPayment.update).not.toHaveBeenCalled();
    });

    it('POST /payroll/:id/pay → 404 y conserva status, paid_at y account_id', async () => {
      await expect(
        controller.pay(userA, reqOwn, 2, { account_id: 10 }),
      ).rejects.toThrow(NotFoundException);
      expect(find(2)).toMatchObject({
        status: 'PENDING',
        paid_at: null,
        account_id: null,
      });
    });

    it('DELETE /payroll/:id → 404 y la fila sigue', async () => {
      await expect(controller.remove(userA, reqOwn, 2)).rejects.toThrow(
        NotFoundException,
      );
      expect(find(2)).toBeDefined();
      expect(prisma.payrollPayment.delete).not.toHaveBeenCalled();
    });

    it('un pago ajeno PAID da 404, no 409 (propiedad antes que estado)', async () => {
      await expect(controller.remove(userA, reqOwn, 3)).rejects.toThrow(
        NotFoundException,
      );
      await expect(controller.update(userA, reqOwn, 3, {})).rejects.toThrow(
        NotFoundException,
      );
      await expect(controller.pay(userA, reqOwn, 3, {})).rejects.toThrow(
        NotFoundException,
      );
    });

    it('el 404 de uno ajeno es idéntico al de uno inexistente', async () => {
      const foreign = await controller
        .findOne(userA, reqOwn, 2)
        .catch((e) => e);
      const missing = await controller
        .findOne(userA, reqOwn, 99999)
        .catch((e) => e);
      expect(foreign.getStatus()).toBe(missing.getStatus());
      expect(foreign.getResponse()).toEqual(missing.getResponse());
    });

    it('GET /payroll sólo trae los de A, aun pidiendo el employee_id de B', async () => {
      const all = await controller.findAll(userA, reqOwn, {} as any);
      expect(all.data.map((p) => p.id)).toEqual([1]);
      expect(all.total).toBe(1);

      const foreign = await controller.findAll(userA, reqOwn, {
        employee_id: 200,
      } as any);
      expect(foreign.data).toEqual([]);
      expect(foreign.total).toBe(0);
    });

    it('POST /payroll con empleado de B → 404; con cuenta de B → 400', async () => {
      const dto = {
        period_start: '2026-08-01',
        period_end: '2026-08-15',
        scheduled_pay_date: '2026-08-15',
        gross_amount: 100,
      };
      await expect(
        controller.create(userA, reqOwn, { ...dto, employee_id: 200 }),
      ).rejects.toThrow(NotFoundException);
      await expect(
        controller.create(userA, reqOwn, {
          ...dto,
          employee_id: 100,
          account_id: 20,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.payrollPayment.create).not.toHaveBeenCalled();
    });

    it('POST /payroll/:id/pay propio con cuenta de B → 400 y sigue PENDING', async () => {
      await expect(
        controller.pay(userA, reqOwn, 1, { account_id: 20 }),
      ).rejects.toThrow(BadRequestException);
      expect(find(1).status).toBe('PENDING');
    });
  });

  describe('A sobre lo suyo', () => {
    it('lee, edita, paga y borra', async () => {
      expect((await controller.findOne(userA, reqOwn, 1)).id).toBe(1);

      const edited = await controller.update(userA, reqOwn, 1, {
        deductions: 100,
      });
      expect(Number(edited.net_amount)).toBe(900);

      const paid = await controller.pay(userA, reqOwn, 1, {
        account_id: 10,
        paid_at: '2026-08-15',
      });
      expect(paid.status).toBe('PAID');
      expect(find(1).account_id).toBe(10);

      payments.push({ id: 4, employee_id: 100, status: 'PENDING' });
      await controller.remove(userA, reqOwn, 4);
      expect(find(4)).toBeUndefined();
    });

    it('sin ownerUserId se comporta como antes: el userId es el propietario', async () => {
      const r = await controller.findAll(userA, {}, {} as any); // sin permissionScope => OWN
      expect(r.data.map((p) => p.id)).toEqual([1]);
    });
  });

  describe('scope ANY', () => {
    it('lee el pago de B (200)', async () => {
      expect((await controller.findOne(userA, reqAny, 2)).id).toBe(2);
    });

    it('edita y borra un pago PENDING de B', async () => {
      await controller.update(userA, reqAny, 2, { notes: 'x' } as any);
      expect(find(2).notes).toBe('x');
      await controller.remove(userA, reqAny, 2);
      expect(find(2)).toBeUndefined();
    });

    it('paga un pago de B sólo con una cuenta del propietario efectivo', async () => {
      await expect(
        controller.pay(userA, reqAny, 2, { account_id: 20 }),
      ).rejects.toThrow(BadRequestException);
      expect(find(2).status).toBe('PENDING');

      const ok = await controller.pay(userA, reqAny, 2, { account_id: 10 });
      expect(ok.status).toBe('PAID');
    });

    it('un default_payment_account_id de B también se rechaza', async () => {
      await expect(controller.pay(userA, reqAny, 2, {})).rejects.toThrow(
        BadRequestException,
      );
      expect(find(2).status).toBe('PENDING');
    });

    it('generate sólo crea pagos para empleados de A', async () => {
      payments = [];
      await controller.generate(userA, reqAny, {
        start_date: '2026-08-01',
        end_date: '2026-08-31',
      });
      expect(payments.length).toBeGreaterThan(0);
      expect(payments.every((p) => p.employee_id === 100)).toBe(true);
    });

    it('alta manual con empleado de B → 404 aun con ANY', async () => {
      await expect(
        controller.create(userA, reqAny, {
          employee_id: 200,
          period_start: '2026-08-01',
          period_end: '2026-08-15',
          scheduled_pay_date: '2026-08-15',
          gross_amount: 100,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('PATCH con status PAID (Q3)', () => {
    it.each([reqOwn, reqAny])('→ 400 y el pago no cambia', async (req) => {
      await expect(
        controller.update(userA, req, 1, { status: 'PAID' }),
      ).rejects.toThrow(BadRequestException);
      expect(find(1).status).toBe('PENDING');
    });

    it('cancelar sigue permitido y un PAID ajeno-propio sigue 409', async () => {
      const r = await controller.update(userA, reqOwn, 1, {
        status: 'CANCELLED',
      });
      expect(r.status).toBe('CANCELLED');

      payments.push({ id: 5, employee_id: 100, status: 'PAID' });
      await expect(controller.remove(userA, reqOwn, 5)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  /*
   * Una ruta nueva por id sin ctx reabriría el hueco: cada handler HTTP debe
   * recibir @Req() (de ahí sale permissionScope) y @CurrentUser().
   */
  describe('guarda estructural', () => {
    const proto = PayrollController.prototype as any;
    const handlers = Object.getOwnPropertyNames(proto).filter(
      (n) =>
        n !== 'constructor' &&
        Reflect.getMetadata(METHOD_METADATA, proto[n]) !== undefined,
    );

    it('descubre los 7 handlers', () => {
      expect(handlers.sort()).toEqual(
        [
          'create',
          'findAll',
          'findOne',
          'generate',
          'pay',
          'remove',
          'update',
        ].sort(),
      );
    });

    it.each(handlers)('%s recibe @Req y @CurrentUser', (name) => {
      expect(Reflect.getMetadata(PATH_METADATA, proto[name])).toBeDefined();
      const args = Reflect.getMetadata(
        ROUTE_ARGS_METADATA,
        PayrollController,
        name,
      );
      const keys = Object.keys(args ?? {});
      expect(
        keys.some((k) => k.startsWith(`${RouteParamtypes.REQUEST}:`)),
      ).toBe(true);
      expect(keys.some((k) => k.includes('__customRouteArgs__'))).toBe(true);
    });
  });
});
