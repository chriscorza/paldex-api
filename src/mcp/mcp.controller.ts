import { Controller, Post, Req, Res } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { RequirePermissions } from '../auth/permissions.decorator';
import { AllowApiKey } from '../auth/allow-api-key.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { McpToolsService } from './mcp-tools.service';

/*
 * @RequirePermissions() with no arguments = the /user/me special case:
 * authentication only, no specific permission. That's deliberate — this one
 * route serves every tool, each with a different permission requirement
 * decided at call time, so per-tool authorization happens inside
 * McpAuthorizationService instead of via route-level metadata. See
 * openspec/changes/add-mcp-server/design.md decision #4.
 */
@Controller('mcp')
export class McpController {
  constructor(private readonly mcpToolsService: McpToolsService) {}

  @Post()
  @RequirePermissions()
  /*
   * La única ruta de la API que acepta una API key. En cualquier otra, una
   * llave —aunque sea válida— se rechaza con 401, así que lo que alcanza una
   * llave filtrada se queda en la superficie de tools de MCP.
   */
  @AllowApiKey()
  @ApiExcludeEndpoint()
  async handle(
    @Req() req: Request,
    @Res() res: Response,
    @CurrentUser() user: { id: number; email: string },
  ) {
    const server = this.mcpToolsService.buildServer(user.id);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on('close', () => {
        transport.close();
        server.close();
      });
    } catch {
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  }
}
