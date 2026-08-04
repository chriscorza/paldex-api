import {
  IsNumber,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AddReceivableCollectionDto {
  @ApiProperty()
  @IsNumber()
  @Min(0.01)
  amount: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  collected_at?: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  account_id: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
