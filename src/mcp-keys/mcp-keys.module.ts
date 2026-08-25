import { Global, Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma.module';
import { McpKeysService } from './mcp-keys.service';
import { McpKeysController } from './mcp-keys.controller';

/*
 * Global porque `AuthGuard` —que se registra como APP_GUARD en el módulo raíz—
 * inyecta `McpKeysService`, y ese guard corre para toda la aplicación.
 */
@Global()
@Module({
  imports: [PrismaModule],
  controllers: [McpKeysController],
  providers: [McpKeysService],
  exports: [McpKeysService],
})
export class McpKeysModule {}
