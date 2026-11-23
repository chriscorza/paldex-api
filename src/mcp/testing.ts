import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpToolkit, ToolCaller } from './toolkit';
import { McpToolsService } from './mcp-tools.service';
import { McpServices } from './tools/services';
import { McpAuthorizationService } from './mcp-authorization.service';
import { PrismaService } from '../prisma.service';

/*
 * Arma el registro real de tools con servicios dobles y un cliente MCP en
 * memoria: el protocolo (tools/list, tools/call, validación zod) es el de
 * verdad. Sólo para pruebas.
 */
export async function connectTestClient(opts: {
  services?: Partial<McpServices>;
  authorization: Pick<McpAuthorizationService, 'requireContext'>;
  prisma?: unknown;
  caller?: ToolCaller;
}) {
  const prisma = (opts.prisma ?? opts.services?.prisma ?? {}) as PrismaService;
  const toolkit = new McpToolkit(
    prisma,
    opts.authorization as McpAuthorizationService,
  );
  McpToolsService.defineAll(toolkit, {
    prisma,
    ...opts.services,
  } as McpServices);
  const server = new McpServer({ name: 'paldex-mcp-test', version: '0.0.0' });
  toolkit.register(server, opts.caller ?? { userId: 1 });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return { client, toolkit };
}
