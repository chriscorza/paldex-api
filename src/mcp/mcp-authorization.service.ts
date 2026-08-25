import {
  Injectable,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma.service';
import { PermissionsService } from 'src/permissions/permissions.service';
import { OwnershipContext } from 'src/common/ownership';

/*
 * One HTTP route serves every MCP tool, so `@RequirePermissions` (route-level
 * metadata) can't gate them individually — each tool handler calls this
 * instead, per call, with the specific permission the equivalent REST
 * endpoint would require. Mirrors PermissionsGuard exactly (see
 * src/auth/permissions.guard.ts) so MCP never drifts from REST authorization.
 */
@Injectable()
export class McpAuthorizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissionsService: PermissionsService,
  ) {}

  async requireContext(
    userId: number,
    permission: string,
  ): Promise<OwnershipContext> {
    const dbUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role_id: true },
    });
    if (!dbUser) {
      throw new UnauthorizedException();
    }
    if (!dbUser.role_id) {
      throw new ForbiddenException(`Missing permission: ${permission}`);
    }

    const permissions = await this.permissionsService.resolvePermissions(
      dbUser.role_id,
    );
    const scope = permissions?.get(permission);
    if (!scope) {
      throw new ForbiddenException(`Missing permission: ${permission}`);
    }

    return { userId, scope: scope as 'OWN' | 'ANY' };
  }
}
