import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsInt,
  IsNumber,
  IsDateString,
  IsBoolean,
  Min,
  Max,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SalaryType, PayFrequency } from '@prisma/client';

@ValidatorConstraint({ name: 'payDayCoherence', async: false })
export class PayDayCoherenceConstraint implements ValidatorConstraintInterface {
  validate(_value: any, args: ValidationArguments) {
    const obj = args.object as any;
    const freq = obj.pay_frequency;

    if (freq === 'WEEKLY') {
      return obj.weekly_pay_day !== undefined && obj.weekly_pay_day !== null;
    }
    if (freq === 'BIWEEKLY') {
      return (
        obj.biweekly_first_day !== undefined &&
        obj.biweekly_second_day !== undefined
      );
    }
    if (freq === 'MONTHLY') {
      return obj.monthly_pay_day !== undefined && obj.monthly_pay_day !== null;
    }
    return true;
  }

  defaultMessage() {
    return 'pay_frequency requires its corresponding pay day configuration';
  }
}

export class CreateEmployeeDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  position?: string;

  @ApiPropertyOptional({ enum: SalaryType })
  @IsOptional()
  @IsEnum(SalaryType)
  salary_type?: SalaryType;

  @ApiProperty({ enum: PayFrequency })
  @IsEnum(PayFrequency)
  pay_frequency: PayFrequency;

  @ApiProperty()
  @IsNumber()
  base_salary: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(7)
  weekly_pay_day?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  biweekly_first_day?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  biweekly_second_day?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  monthly_pay_day?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  default_payment_account_id?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  started_at?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  ended_at?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @Validate(PayDayCoherenceConstraint)
  _validatePayDay: any;
}

export class UpdateEmployeeDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  position?: string;

  @ApiPropertyOptional({ enum: SalaryType })
  @IsOptional()
  @IsEnum(SalaryType)
  salary_type?: SalaryType;

  @ApiPropertyOptional({ enum: PayFrequency })
  @IsOptional()
  @IsEnum(PayFrequency)
  pay_frequency?: PayFrequency;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  base_salary?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(7)
  weekly_pay_day?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  biweekly_first_day?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  biweekly_second_day?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  monthly_pay_day?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  default_payment_account_id?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  started_at?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  ended_at?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class FilterEmployeesDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ enum: PayFrequency })
  @IsOptional()
  @IsEnum(PayFrequency)
  pay_frequency?: PayFrequency;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  limit?: number;
}
