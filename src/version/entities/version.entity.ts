import { ApiProperty } from '@nestjs/swagger';

import { VersionInfo } from '../version.service';

export class VersionEntity {
  @ApiProperty({
    description:
      'Versión del producto completo, no de este servicio: la entrada más ' +
      'reciente de CHANGELOG.md.',
    example: '1.0.0',
  })
  version: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Fecha declarada en el changelog para esta versión, no la del despliegue: ' +
      'es la única que no cambia porque el contenedor se reinicie. `null` si el ' +
      'changelog no se pudo leer.',
    example: '2026-08-18',
  })
  released_at: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Commit del que se construyó la imagen, del build arg `SOURCE_COMMIT` que ' +
      'inyecta Coolify. `null` en una construcción local: no se sabe, y decir ' +
      '"unknown" sería inventarlo.',
  })
  commit: string | null;

  @ApiProperty({
    description: 'Desde cuándo lleva corriendo este proceso.',
  })
  started_at: string;

  constructor(info: VersionInfo) {
    this.version = info.version;
    this.released_at = info.released_at;
    this.commit = info.commit;
    this.started_at = info.started_at;
  }
}
