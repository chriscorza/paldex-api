import {
  IsInt,
  IsString,
  IsNotEmpty,
  IsOptional,
  IsDateString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateMcpKeyDto {
  @ApiProperty({
    description:
      'A quién pertenece la llave. Normalmente la cuenta de servicio del agente.',
    example: 9,
  })
  @IsInt()
  user_id: number;

  @ApiProperty({
    description:
      'Para qué es, en palabras. Es lo que vas a ver al listarlas y lo que te dice cuál revocar.',
    example: 'Asistente de IA — producción',
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({
    description:
      'Cuándo deja de servir. Sin esto no vence: nada vigila la caducidad todavía, y un ' +
      'agente muerto en silencio a las 3am es su propio problema.',
    example: '2027-01-01',
  })
  @IsOptional()
  @IsDateString()
  expires_at?: string;

  @ApiPropertyOptional({
    description:
      'Cuyos libros lee y escribe la llave (sus filas caen ahí). Si se omite, el usuario ' +
      'que la crea. La autorización sigue saliendo del rol de `user_id`, no del de esta cuenta.',
    example: 1,
  })
  @IsOptional()
  @IsInt()
  owner_user_id?: number;
}
