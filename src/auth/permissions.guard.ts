import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Logger,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from 'src/prisma.service';
import { PermissionsService } from 'src/permissions/permissions.service';
import { IS_PUBLIC_KEY } from 'src/globalConstants';
import { PERMISSIONS_KEY } from 'src/globalConstants';

@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly logger = new Logger(PermissionsGuard.name);

  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
    private permissionsService: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user as { id: number; email: string } | undefined;
    if (!user) return true;

    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, role_id: true },
    });
    if (!dbUser) {
      throw new UnauthorizedException();
    }

    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (requiredPermissions === undefined || requiredPermissions === null) {
      this.logger.debug(
        `Route ${request.method} ${request.url} has no @RequirePermissions — denying by default`,
      );
      throw new ForbiddenException();
    }

    if (requiredPermissions.length === 0) {
      return true;
    }

    if (!dbUser.role_id) {
      throw new ForbiddenException();
    }

    const userPermissions = await this.permissionsService.resolvePermissions(
      dbUser.role_id,
    );
    if (!userPermissions) {
      throw new ForbiddenException();
    }

    let effectiveScope: string | undefined;
    for (const required of requiredPermissions) {
      const scope = userPermissions.get(required);
      if (!scope) {
        this.logger.debug(`User ${user.id} lacks permission "${required}"`);
        throw new ForbiddenException();
      }
      if (!effectiveScope || scope === 'ANY') {
        effectiveScope = scope;
      }
    }

    request.permissionScope = effectiveScope ?? 'ANY';
    return true;
  }
}
