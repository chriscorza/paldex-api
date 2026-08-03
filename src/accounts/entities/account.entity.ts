import { Account } from '@prisma/client';
import { toMoneyNumber } from '../../common/money';

export class AccountEntity {
  id: number;
  name: string;
  balance: number;
  credit_limit: number | null;
  type: string;
  currency: string;
  is_active: boolean;
  initial_balance: number;
  created_at: Date;
  user_id: number;

  constructor(partial: any) {
    this.id = partial.id;
    this.name = partial.name;
    this.balance = toMoneyNumber(partial.balance) ?? 0;
    this.credit_limit = toMoneyNumber(partial.credit_limit);
    this.type = partial.type;
    this.currency = partial.currency ?? 'MXN';
    this.is_active = partial.is_active ?? true;
    this.initial_balance = toMoneyNumber(partial.initial_balance) ?? 0;
    this.created_at = partial.created_at;
    this.user_id = partial.user_id;
  }
}

export interface AccountDetail extends Account {
  incomes_count: number;
  expenses_count: number;
}

export interface PaginatedAccountResponse {
  data: AccountEntity[];
  total: number;
  page: number;
  limit: number;
}
