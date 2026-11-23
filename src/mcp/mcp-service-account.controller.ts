import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { McpServiceAccountService } from './mcp-service-account.service';
import { ProvisionAgentDto } from './dto/provision-agent.dto';

/*
 * Crea rol, usuario de servicio y llave del asistente de un clic. Pide los
 * permisos de todo lo que toca: emitir llaves, crear y editar roles y asignar
 * un rol a un usuario. Sin @AllowApiKey: una llave no puede fabricar otra.
 */
@ApiTags('mcp-keys')
@ApiBearerAuth('jwt')
@Controller('mcp-keys')
export class McpServiceAccountController {
  constructor(private readonly service: McpServiceAccountService) {}

  @Post('service-account')
  @RequirePermissions(
    'mcp_key:create',
    'role:create',
    'role:update',
    'user:assign_role',
  )
  @ApiOperation({
    summary: 'Crear la cuenta del asistente de IA',
    description:
      'Crea (o reutiliza) el rol ai_agent con exactamente los permisos que piden las tools MCP en alcance OWN, ' +
      'un usuario de servicio con ese rol que no puede iniciar sesión, y una llave nueva de ese usuario ligada a ' +
      'los libros de quien llama. Devuelve el token completo una sola vez. Al rol sólo se le agregan permisos, ' +
      'nunca se le quitan. Las llaves anteriores no se revocan solas.',
  })
  provision(
    @CurrentUser() user: { id: number },
    @Body() dto: ProvisionAgentDto,
  ) {
    return this.service.provision({
      callerUserId: user.id,
      keyName: dto.key_name,
    });
  }
}
