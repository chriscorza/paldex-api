import { Controller, Get, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { PrismaService } from '../prisma.service';
import { endOfDayInZone, startOfDayInZone } from '../common/timezone';
import { ListMcpActionsDto } from './dto/list-mcp-actions.dto';

/*
 * La bitácora de lo que hizo el agente por MCP. Sin @AllowApiKey a propósito:
 * una llave no puede leer (ni borrar el rastro de) lo que hizo con ella.
 */
@ApiTags('mcp-actions')
@ApiBearerAuth('jwt')
@Controller('mcp-actions')
@RequirePermissions('mcp_action:read')
export class McpActionsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({
    summary: 'Qué hizo el agente de IA',
    description:
      'Una fila por escritura hecha por MCP, con el registro antes y después, la llave y la tool. Más reciente primero. ' +
      'Las filas con entity_id nulo y sin after son reservas de client_ref de una llamada que no terminó.',
  })
  async findAll(
    @CurrentUser() user: { id: number },
    @Req() request: any,
    @Query() query: ListMcpActionsDto,
  ) {
    const scope = request.permissionScope || 'OWN';
    const where: Prisma.McpActionWhereInput = {
      ...(scope === 'OWN'
        ? { owner_user_id: request.booksOwnerId ?? user.id }
        : {}),
      ...(query.entity ? { entity: query.entity } : {}),
      ...(query.tool ? { tool: query.tool } : {}),
    };
    if (query.start_date || query.end_date) {
      where.created_at = {
        ...(query.start_date
          ? { gte: startOfDayInZone(query.start_date) }
          : {}),
        ...(query.end_date ? { lte: endOfDayInZone(query.end_date) } : {}),
      };
    }
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.mcpAction.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.mcpAction.count({ where }),
    ]);
    return { data, total, page, limit };
  }
}
