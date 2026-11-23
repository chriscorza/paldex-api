import { IsDateString, IsNumber, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class DisposeFixedAssetDto {
  @ApiProperty({
    example: '2027-08-20',
    description: 'Desde ese mes deja de depreciarse.',
  })
  @IsDateString()
  disposed_at: string;

  @ApiProperty({
    example: 5000,
    description: 'Lo que se recibió. 0 si se tiró o se rompió.',
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  disposal_amount: number;
}
