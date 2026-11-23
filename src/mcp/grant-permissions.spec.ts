import { requiredPermissions } from '../../scripts/grant-ai-agent-permissions';
import { PERMISSION_CATALOG } from '../permissions/permission-catalog';

describe('permisos del agente', () => {
  it('cada permiso que pide una tool existe en el catálogo', () => {
    const catalog = new Set(
      PERMISSION_CATALOG.map((p) => `${p.resource}:${p.action}`),
    );

    const missing = requiredPermissions().filter((p) => !catalog.has(p));

    expect(missing).toEqual([]);
  });

  it('ninguna tool pide permisos de administración', () => {
    expect(
      requiredPermissions().filter((p) =>
        /^(user|role|permission|invitation|mcp_key|shopify_connection|monthly_close:update)/.test(
          p,
        ),
      ),
    ).toEqual([]);
  });
});
