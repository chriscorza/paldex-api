import { McpToolsInfoController } from './mcp-tools-info.controller';
import { McpToolsService } from './mcp-tools.service';
import { McpToolkit } from './toolkit';
import { McpServices } from './tools/services';
import { requiredPermissions } from '../../scripts/grant-ai-agent-permissions';

describe('McpToolsInfoController', () => {
  it('lista los mismos permisos que el script, con las tools que los usan', () => {
    const toolkit = new McpToolkit(null as never, null as never);
    McpToolsService.defineAll(toolkit, {} as McpServices);
    const controller = new McpToolsInfoController({
      registry: toolkit.registry,
    } as unknown as McpToolsService);

    const result = controller.permissions();

    expect(result.permissions.map((p) => p.key)).toEqual(requiredPermissions());
    expect(result.tool_count).toBe(toolkit.registry.length);
    expect(
      result.permissions.find((p) => p.key === 'expense:delete')?.tools,
    ).toEqual(['expense_delete']);
  });
});
