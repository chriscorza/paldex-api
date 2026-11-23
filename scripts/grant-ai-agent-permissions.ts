/*
 * Da al rol del agente de IA exactamente los permisos que piden las tools MCP,
 * leídos del registro (src/mcp/tools/*), con alcance OWN donde exista.
 *
 * Por omisión sólo muestra lo que cambiaría. Con --apply lo escribe.
 * No quita permisos que el rol ya tenga: si sobra alguno, lo lista para que
 * lo quite una persona desde /roles.
 *
 * Uso:
 *   DATABASE_URL=<destino> npx ts-node -r tsconfig-paths/register scripts/grant-ai-agent-permissions.ts [--role ai_agent] [--apply]
 */
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { McpToolkit } from '../src/mcp/toolkit';
import { McpToolsService } from '../src/mcp/mcp-tools.service';
import { McpServices } from '../src/mcp/tools/services';

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
};

export function requiredPermissions(): string[] {
  const toolkit = new McpToolkit(null as never, null as never);
  McpToolsService.defineAll(toolkit, {} as McpServices);
  return Array.from(new Set(toolkit.registry.map((d) => d.permission))).sort();
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url)
    throw new Error(
      'Define DATABASE_URL explícitamente (no se lee .env.prod).',
    );
  const roleName = arg('--role') ?? 'ai_agent';
  const apply = process.argv.includes('--apply');
  const prisma = new PrismaClient({ adapter: new PrismaMariaDb(url) });

  try {
    const role = await prisma.role.findUnique({ where: { name: roleName } });
    if (!role)
      throw new Error(`No existe el rol "${roleName}". Créalo en /roles.`);

    const granted = await prisma.rolePermission.findMany({
      where: { role_id: role.id },
      include: { permission: true },
    });
    const has = new Set(
      granted.map((g) => `${g.permission.resource}:${g.permission.action}`),
    );
    const needed = requiredPermissions();

    const toGrant: { key: string; id: number; scope: string }[] = [];
    const missingInCatalog: string[] = [];
    for (const key of needed) {
      if (has.has(key)) continue;
      const [resource, action] = key.split(':');
      const candidates = await prisma.permission.findMany({
        where: { resource, action },
      });
      const pick = candidates.find((p) => p.scope === 'OWN') ?? candidates[0];
      if (!pick) missingInCatalog.push(key);
      else toGrant.push({ key, id: pick.id, scope: pick.scope });
    }
    const extra = [...has].filter((k) => !needed.includes(k)).sort();

    console.log(`Rol: ${roleName} (id ${role.id})`);
    console.log(
      `Permisos que piden las tools: ${needed.length}; ya tiene: ${needed.length - toGrant.length - missingInCatalog.length}`,
    );
    for (const g of toGrant) console.log(`  + ${g.key} (${g.scope})`);
    for (const k of missingInCatalog)
      console.log(
        `  ! ${k}: no existe en la base; reinicia la API para sincronizar el catálogo`,
      );
    if (extra.length) {
      console.log(
        'Permisos que el rol tiene y ninguna tool usa (no se tocan):',
      );
      for (const k of extra) console.log(`  · ${k}`);
    }

    if (!apply) {
      console.log(
        toGrant.length
          ? '\nNada escrito. Repite con --apply para otorgarlos.'
          : '\nNo hay nada que otorgar.',
      );
      return;
    }
    for (const g of toGrant) {
      await prisma.rolePermission.create({
        data: { role_id: role.id, permission_id: g.id },
      });
    }
    console.log(
      `\nOtorgados ${toGrant.length}. La caché de permisos de la API se renueva al reiniciarla o al editar el rol en /roles.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
