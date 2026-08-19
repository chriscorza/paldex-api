import { Controller, Get } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { Public } from '../auth/auth.decorator';
import { RequirePermissions } from '../auth/permissions.decorator';
import { ReleaseEntity } from './entities/release.entity';
import { VersionEntity } from './entities/version.entity';
import { VersionService } from './version.service';

@ApiTags('version')
@Controller()
export class VersionController {
  constructor(private readonly version: VersionService) {}

  /**
   * Público, como `/health`: es información de operación y tiene que poder
   * leerse con un `curl` desde un monitor, sin token.
   */
  @Public()
  @Get('version')
  @ApiOperation({
    summary: 'Versión del producto y metadatos de este build',
    description:
      'Qué versión de Paldex está desplegada, de cuándo es y de qué commit salió. ' +
      'Comparar este commit con el que reporta el frontend es lo que hace visible ' +
      'un despliegue a medias.',
  })
  @ApiOkResponse({ type: VersionEntity })
  getVersion(): VersionEntity {
    return new VersionEntity(this.version.getVersionInfo());
  }

  /**
   * Sólo exige sesión, ningún permiso concreto: atar las notas de versión a un
   * permiso las escondería justo de quien menos permisos tiene, que es quien
   * más necesita que le expliquen qué cambió.
   */
  @Get('releases')
  @RequirePermissions()
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: 'Historial de versiones, de la más reciente a la más antigua',
    description:
      'El changelog ya parseado. Devuelve una lista vacía —nunca un error— si el ' +
      'archivo falta o no se pudo interpretar.',
  })
  @ApiOkResponse({ type: [ReleaseEntity] })
  getReleases(): ReleaseEntity[] {
    return this.version
      .getReleases()
      .map((release) => new ReleaseEntity(release));
  }
}
