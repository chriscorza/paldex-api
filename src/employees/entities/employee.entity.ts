import { toMoneyNumber } from '../../common/money';

export class EmployeeEntity {
  id: number;
  name: string;
  position: string | null;
  salary_type: string;
  pay_frequency: string;
  base_salary: number;
  weekly_pay_day: number | null;
  biweekly_first_day: number | null;
  biweekly_second_day: number | null;
  monthly_pay_day: number | null;
  default_payment_account_id: number | null;
  started_at: Date;
  ended_at: Date | null;
  active: boolean;
  user_id: number;

  constructor(partial: any) {
    this.id = partial.id;
    this.name = partial.name;
    this.position = partial.position ?? null;
    this.salary_type = partial.salary_type;
    this.pay_frequency = partial.pay_frequency;
    this.base_salary = toMoneyNumber(partial.base_salary) ?? 0;
    this.weekly_pay_day = partial.weekly_pay_day ?? null;
    this.biweekly_first_day = partial.biweekly_first_day ?? null;
    this.biweekly_second_day = partial.biweekly_second_day ?? null;
    this.monthly_pay_day = partial.monthly_pay_day ?? null;
    this.default_payment_account_id =
      partial.default_payment_account_id ?? null;
    this.started_at = partial.started_at;
    this.ended_at = partial.ended_at ?? null;
    this.active = partial.active;
    this.user_id = partial.user_id;
  }
}

export const EMPLOYEE_PUBLIC_SELECT = {
  id: true,
  name: true,
  position: true,
  salary_type: true,
  pay_frequency: true,
  base_salary: true,
  weekly_pay_day: true,
  biweekly_first_day: true,
  biweekly_second_day: true,
  monthly_pay_day: true,
  default_payment_account_id: true,
  started_at: true,
  ended_at: true,
  active: true,
  user_id: true,
} as const;
