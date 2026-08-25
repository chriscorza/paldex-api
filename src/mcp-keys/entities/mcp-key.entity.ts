import { ApiProperty } from '@nestjs/swagger';

/*
 * Lo que se puede ver de una llave después de crearla. `token_hash` no está —ni
 * puede estar— y el secreto tampoco: el token completo existe una sola vez, en
 * la respuesta de creación.
 */
export class McpKeyEntity {
  @ApiProperty()
  id: number;

  @ApiProperty({ description: 'La cuenta a la que pertenece la llave.' })
  user_id: number;

  @ApiProperty({ example: 'Asistente de IA — producción' })
  name: string;

  @ApiProperty({
    description:
      'La parte identificable del token, para reconocer cuál es sin poder usarla.',
    example: 'k3Jd9aQ2',
  })
  token_prefix: string;

  @ApiProperty({
    nullable: true,
    description:
      'Última vez que se usó, con hasta 5 minutos de retraso. Es lo que dice si una llave ' +
      'filtrada llegó a usarse antes de revocarla.',
  })
  last_used_at: Date | null;

  @ApiProperty({ nullable: true })
  expires_at: Date | null;

  @ApiProperty({
    nullable: true,
    description:
      'Si está puesta, la llave ya no sirve. La fila se conserva a propósito.',
  })
  revoked_at: Date | null;

  @ApiProperty()
  created_at: Date;

  /*
   * Campo por campo y no `Object.assign`: así, si algún día un `select` de
   * Prisma arrastra `token_hash`, se queda fuera igual. La proyección de la base
   * ya lo excluye, pero eso es una salvaguarda a la que hay que acordarse de no
   * romper; ésta no depende de acordarse.
   */
  constructor(partial: McpKeyEntity) {
    this.id = partial.id;
    this.user_id = partial.user_id;
    this.name = partial.name;
    this.token_prefix = partial.token_prefix;
    this.last_used_at = partial.last_used_at ?? null;
    this.expires_at = partial.expires_at ?? null;
    this.revoked_at = partial.revoked_at ?? null;
    this.created_at = partial.created_at;
  }
}

export class CreatedMcpKeyEntity extends McpKeyEntity {
  @ApiProperty({
    description:
      'El token completo. **Es la única vez que se muestra**: no se guarda de forma ' +
      'recuperable ni hay endpoint que lo devuelva. Si se pierde, emite otra llave y ' +
      'revoca ésta.',
    example: 'pldx_k3Jd9aQ2_v8s...',
  })
  token: string;

  constructor(partial: CreatedMcpKeyEntity) {
    super(partial);
    this.token = partial.token;
  }
}
