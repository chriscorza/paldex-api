import { ApiProperty } from '@nestjs/swagger';
import { toMoneyNumber } from '../../common/money';

class TransferAccountRef {
  @ApiProperty()
  id: number;

  @ApiProperty()
  name: string;
}

class TransferCreatorRef {
  @ApiProperty()
  id: number;

  @ApiProperty({ nullable: true, type: String })
  name: string | null;

  @ApiProperty()
  email: string;
}

/* Un traspaso entre dos cuentas del mismo dueño. No es ingreso ni gasto. */
export class AccountTransferEntity {
  @ApiProperty()
  id: number;

  @ApiProperty()
  from_account_id: number;

  @ApiProperty()
  to_account_id: number;

  @ApiProperty({ type: TransferAccountRef, nullable: true })
  from_account: TransferAccountRef | null;

  @ApiProperty({ type: TransferAccountRef, nullable: true })
  to_account: TransferAccountRef | null;

  @ApiProperty()
  amount: number;

  @ApiProperty({ description: 'Medianoche del día en la zona del negocio.' })
  date: Date;

  @ApiProperty()
  fee_amount: number;

  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Gasto que registra la comisión. Nulo si no hubo.',
  })
  fee_expense_id: number | null;

  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Categoría del gasto de la comisión.',
  })
  fee_category_id: number | null;

  @ApiProperty({ nullable: true, type: String })
  notes: string | null;

  @ApiProperty()
  user_id: number;

  @ApiProperty({ nullable: true, type: Number })
  created_by: number | null;

  @ApiProperty({ type: TransferCreatorRef, nullable: true })
  creator: TransferCreatorRef | null;

  @ApiProperty()
  created_at: Date;

  @ApiProperty()
  updated_at: Date;

  constructor(row: any) {
    this.id = row.id;
    this.from_account_id = row.from_account_id;
    this.to_account_id = row.to_account_id;
    this.from_account = row.from_account
      ? { id: row.from_account.id, name: row.from_account.name }
      : null;
    this.to_account = row.to_account
      ? { id: row.to_account.id, name: row.to_account.name }
      : null;
    this.amount = toMoneyNumber(row.amount) ?? 0;
    this.date = row.date;
    this.fee_amount = toMoneyNumber(row.fee_amount) ?? 0;
    this.fee_expense_id = row.fee_expense_id ?? null;
    this.fee_category_id = row.fee_expense?.category_id ?? null;
    this.notes = row.notes ?? null;
    this.user_id = row.user_id;
    this.created_by = row.created_by ?? null;
    this.creator = row.creator
      ? {
          id: row.creator.id,
          name: row.creator.name ?? null,
          email: row.creator.email,
        }
      : null;
    this.created_at = row.created_at;
    this.updated_at = row.updated_at;
  }
}

export class PaginatedAccountTransfersEntity {
  @ApiProperty({ type: [AccountTransferEntity] })
  data: AccountTransferEntity[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;
}
