import { Global, Module } from '@nestjs/common';

import { VersionController } from './version.controller';
import { VersionService } from './version.service';

/**
 * Global porque `AppController` también publica la versión en `/health` y no
 * tiene sentido que el módulo raíz importe uno entero para leer una cadena.
 */
@Global()
@Module({
  controllers: [VersionController],
  providers: [VersionService],
  exports: [VersionService],
})
export class VersionModule {}
