import { IsString, IsNotEmpty, IsNumber, Min, Max } from 'class-validator';

/*
 * rate es un porcentaje (21 = 21 %), no una fracción (0.21).
 * Quien calcule importes de impuestos debe dividir entre 100.
 */
export class CreateTaxDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsNumber()
  @Min(0)
  @Max(100)
  rate: number;
}
