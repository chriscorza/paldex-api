import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../auth/permissions.decorator';
import { McpToolsService } from './mcp-tools.service';

/*
 * Qué permisos piden las tools MCP, leídos del registro: la misma fuente que
 * usa scripts/grant-ai-agent-permissions.ts. El editor de roles la usa para
 * marcar de un clic los permisos del asistente sin una lista copiada a mano en
 * el front, que se desalinearía en cuanto se agregara una tool.
 */
@ApiTags('mcp-tools')
@ApiBearerAuth('jwt')
@Controller('mcp-tools')
@RequirePermissions('permission:read')
export class McpToolsInfoController {
  constructor(private readonly tools: McpToolsService) {}

  @Get('permissions')
  @ApiOperation({
    summary: 'Permisos que necesita el rol del asistente de IA',
    description:
      'Un renglón por permiso (resource:action) con las tools que lo usan. Se recomienda otorgarlos con alcance OWN.',
  })
  permissions() {
    const byPermission = new Map<string, string[]>();
    for (const def of this.tools.registry) {
      const list = byPermission.get(def.permission) ?? [];
      list.push(def.name);
      byPermission.set(def.permission, list);
    }
    return {
      tool_count: this.tools.registry.length,
      permissions: [...byPermission.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, tools]) => ({ key, tools: tools.sort() })),
    };
  }
}
