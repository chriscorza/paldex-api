import { IsOptional, IsInt, IsDateString, Min, Max } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class MonthlyReportQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(2000)
  year?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  month?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  start_date?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  end_date?: string;
}

export class ExpensesBreakdownQueryDto extends MonthlyReportQueryDto {}

export class FiscalReportQueryDto extends MonthlyReportQueryDto {}

export class PayrollReportQueryDto extends MonthlyReportQueryDto {}

export class SalesWithoutCostQueryDto extends MonthlyReportQueryDto {}
