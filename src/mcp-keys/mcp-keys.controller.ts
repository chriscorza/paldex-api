import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  ParseIntPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiCreatedResponse,
  ApiOkResponse,
} from '@nestjs/swagger';
import { McpKeysService } from './mcp-keys.service';
import { CreateMcpKeyDto } from './dto/create-mcp-key.dto';
import { McpKeyEntity, CreatedMcpKeyEntity } from './entities/mcp-key.entity';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';

@ApiTags('mcp-keys')
@ApiBearerAuth('jwt')
@Controller('mcp-keys')
@RequirePermissions('mcp_key:read')
export class McpKeysController {
  constructor(private readonly mcpKeysService: McpKeysService) {}

  @Post()
  @RequirePermissions('mcp_key:create')
  @ApiOperation({
    summary: 'Emitir una API key para el servidor MCP',
    description:
      'Devuelve el token completo **una sola vez**: no se guarda de forma recuperable ni ' +
      'hay endpoint que lo vuelva a mostrar. Cópialo a la configuración del conector en ' +
      'ese momento. ' +
      'La llave sólo sirve en `POST /mcp`; en cualquier otra ruta de la API se rechaza con ' +
      '401 aunque sea válida. ' +
      'Autentica pero no autoriza: lo que puede hacer sale del rol de la cuenta dueña, ' +
      'igual que con un JWT. ' +
      'Para rotar sin cortar el servicio: emite la nueva, cámbiala en el conector y ' +
      'revoca la vieja.',
  })
  @ApiCreatedResponse({ type: CreatedMcpKeyEntity })
  async create(
    @CurrentUser() user: { id: number },
    @Body() dto: CreateMcpKeyDto,
  ) {
    const created = await this.mcpKeysService.create({
      userId: dto.user_id,
      name: dto.name,
      expiresAt: dto.expires_at,
      createdBy: user.id,
    });

    return new CreatedMcpKeyEntity(created as CreatedMcpKeyEntity);
  }

  @Get()
  @ApiOperation({
    summary: 'Listar las API keys emitidas',
    description:
      'Nunca devuelve el secreto ni su hash: sólo el prefijo, que sirve para reconocer una ' +
      'llave sin poder usarla. Las revocadas se quedan en la lista, marcadas, porque ' +
      '`last_used_at` es justo lo que quieres mirar si sospechas que una se filtró.',
  })
  @ApiOkResponse({ type: [McpKeyEntity] })
  async findAll(@Query('user_id') userId?: string) {
    const rows = await this.mcpKeysService.findAll(
      userId ? parseInt(userId, 10) : undefined,
    );
    return rows.map((row) => new McpKeyEntity(row as McpKeyEntity));
  }

  @Delete(':id')
  @RequirePermissions('mcp_key:delete')
  @ApiOperation({
    summary: 'Revocar una API key',
    description:
      'Surte efecto en la siguiente petición: cada llamada comprueba el estado de la llave ' +
      'contra la base, sin caché. La fila no se borra, para no destruir el rastro de uso ' +
      'justo cuando importa.',
  })
  @ApiOkResponse({ type: McpKeyEntity })
  async revoke(@Param('id', ParseIntPipe) id: number) {
    const revoked = await this.mcpKeysService.revoke(id);
    return new McpKeyEntity(revoked as unknown as McpKeyEntity);
  }
}
