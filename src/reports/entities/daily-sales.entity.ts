import { ApiProperty } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { toMoneyNumber } from '../../common/money';

type Decimal = Prisma.Decimal;

export class DailySalesRowEntity {
  @ApiProperty({
    example: '2026-08-05',
    description:
      'Día del calendario en la zona del negocio, no en UTC: una venta de las 19:00 en CDMX pertenece a este día aunque en UTC ya sea el siguiente.',
  })
  date: string;

  @ApiProperty({ example: 12450.5 })
  net_sales: number;

  @ApiProperty({ example: 13200 })
  gross_sales: number;

  @ApiProperty({ example: 300 })
  discounts: number;

  @ApiProperty({ example: 449.5 })
  fees: number;

  @ApiProperty({ example: 0 })
  shipping_charged: number;

  @ApiProperty({
    example: 8,
    description: 'Cero en un día sin ventas; el día sigue apareciendo.',
  })
  sales_count: number;

  constructor(partial: {
    date: string;
    net_sales: Decimal | number;
    gross_sales: Decimal | number;
    discounts: Decimal | number;
    fees: Decimal | number;
    shipping_charged: Decimal | number;
    sales_count: number;
  }) {
    this.date = partial.date;
    this.net_sales = toMoneyNumber(partial.net_sales) ?? 0;
    this.gross_sales = toMoneyNumber(partial.gross_sales) ?? 0;
    this.discounts = toMoneyNumber(partial.discounts) ?? 0;
    this.fees = toMoneyNumber(partial.fees) ?? 0;
    this.shipping_charged = toMoneyNumber(partial.shipping_charged) ?? 0;
    this.sales_count = partial.sales_count;
  }
}

export class DailySalesTotalsEntity {
  @ApiProperty({ example: 312450.5 })
  net_sales: number;

  @ApiProperty({ example: 330200 })
  gross_sales: number;

  @ApiProperty({ example: 6300 })
  discounts: number;

  @ApiProperty({ example: 11449.5 })
  fees: number;

  @ApiProperty({ example: 0 })
  shipping_charged: number;

  @ApiProperty({ example: 214 })
  sales_count: number;

  @ApiProperty({
    example: 31,
    description: 'Días del rango, incluidos los que no vendieron nada.',
  })
  days: number;

  @ApiProperty({
    example: 28,
    description: 'Cuántos de esos días tuvieron al menos una venta.',
  })
  days_with_sales: number;

  constructor(partial: DailySalesTotalsEntity) {
    Object.assign(this, partial);
  }
}

export class DailySalesReportEntity {
  @ApiProperty({
    description:
      'Inicio del rango: 00:00:00.000 de `start_date` en la zona del negocio.',
  })
  start_date: Date;

  @ApiProperty({
    description:
      'Fin del rango: 23:59:59.999 de `end_date` en la zona del negocio, incluido.',
  })
  end_date: Date;

  @ApiProperty({ example: 'America/Mexico_City' })
  time_zone: string;

  @ApiProperty({
    type: [DailySalesRowEntity],
    description:
      'Un renglón por día del rango, en orden ascendente. Los días sin ventas van en cero, nunca se omiten: sin ellos no se distingue «no vendió» de «no hay dato».',
  })
  days: DailySalesRowEntity[];

  @ApiProperty({ type: DailySalesTotalsEntity })
  totals: DailySalesTotalsEntity;

  constructor(partial: DailySalesReportEntity) {
    Object.assign(this, partial);
  }
}
