import { ApiProperty } from '@nestjs/swagger';
import { IsInt, ValidateIf } from 'class-validator';

export class SetBooksOwnerDto {
  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Id de la cuenta en cuyos libros trabajará este usuario (un socio). null = sus propios libros.',
  })
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  books_owner_id: number | null;
}
