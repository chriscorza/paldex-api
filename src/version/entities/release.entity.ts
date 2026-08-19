import { ApiProperty } from '@nestjs/swagger';

import { ParsedRelease } from '../changelog.parser';

export class ReleaseChangesEntity {
  @ApiProperty({ type: [String], description: 'Lo que se agregó.' })
  added: string[];

  @ApiProperty({
    type: [String],
    description: 'Lo que cambió de comportamiento.',
  })
  changed: string[];

  @ApiProperty({ type: [String], description: 'Lo que se corrigió.' })
  fixed: string[];

  @ApiProperty({ type: [String], description: 'Lo que se quitó.' })
  removed: string[];
}

export class ReleaseEntity {
  @ApiProperty({ example: '1.0.0' })
  version: string;

  @ApiProperty({ example: '2026-08-18' })
  released_at: string;

  @ApiProperty({
    type: ReleaseChangesEntity,
    description:
      'Los cambios ya agrupados por tipo, como texto plano listo para mostrar. ' +
      'El cliente pinta la lista; no interpreta Markdown.',
  })
  changes: ReleaseChangesEntity;

  constructor(release: ParsedRelease) {
    this.version = release.version;
    this.released_at = release.released_at;
    this.changes = release.changes;
  }
}
