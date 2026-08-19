import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags, ApiExcludeEndpoint, ApiOperation } from '@nestjs/swagger';
import { AppService } from './app.service';
import { PrismaService } from './prisma.service';
import { Public } from './auth/auth.decorator';
import { VersionService } from './version/version.service';

@ApiTags('health')
@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly prisma: PrismaService,
    private readonly version: VersionService,
  ) {}

  @Public()
  @Get()
  @ApiExcludeEndpoint()
  getHello(): string {
    return this.appService.getHello();
  }

  /**
   * Healthcheck para Coolify/Docker: comprueba que la app responde y que la
   * conexión a MySQL está viva. Devuelve 503 si la base de datos no responde,
   * para que el orquestador no mande tráfico a un contenedor roto.
   */
  @Public()
  @Get('health')
  @ApiOperation({
    summary: 'Estado del servicio y de la conexión a la base de datos',
  })
  async health() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({
        status: 'error',
        database: 'down',
      });
    }

    return {
      status: 'ok',
      database: 'up',
      // Para saber qué hay desplegado sin abrir la app ni pedir un token.
      version: this.version.getVersionInfo().version,
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
