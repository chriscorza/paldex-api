import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ProvisionAgentDto {
  @ApiPropertyOptional({
    example: 'Asistente de IA — Claude',
    description:
      'Nombre de la llave nueva, para reconocerla en la lista. Por omisión "Asistente de IA".',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  key_name?: string;
}
