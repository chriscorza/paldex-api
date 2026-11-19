import { IsInt } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateMcpKeyDto {
  @ApiProperty({
    description:
      'Re-enlaza la llave: a partir de la siguiente petición lee y escribe en los libros de ' +
      'esta cuenta. Debe existir y estar activa.',
    example: 1,
  })
  @IsInt()
  owner_user_id: number;
}
