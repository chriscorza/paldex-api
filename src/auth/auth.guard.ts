import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { env } from 'process';
import { ALLOW_API_KEY, IS_PUBLIC_KEY } from 'src/globalConstants';
import { API_KEY_PREFIX, McpKeysService } from 'src/mcp-keys/mcp-keys.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private reflector: Reflector,
    private mcpKeysService: McpKeysService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      // 💡 See this condition
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const token = this.extractTokenFromHeader(request);
    if (!token) {
      throw new UnauthorizedException();
    }

    /*
     * Este guard es global: lo que se decida aquí aplica a toda la API, así que
     * el camino de las API keys falla cerrado.
     *
     * El orden importa. Primero se mira si la ruta acepta llaves y, si no, se
     * corta —sin buscarla siquiera y sin caer al camino del JWT, que la
     * rechazaría igual pero por accidente en vez de por diseño—. Así el valor
     * por omisión de cualquier ruta existente o futura es «aquí no entran».
     */
    if (token.startsWith(API_KEY_PREFIX)) {
      const allowsApiKey = this.reflector.getAllAndOverride<boolean>(
        ALLOW_API_KEY,
        [context.getHandler(), context.getClass()],
      );
      if (!allowsApiKey) {
        throw new UnauthorizedException();
      }

      const key = await this.mcpKeysService.verify(token);
      if (!key) {
        throw new UnauthorizedException();
      }

      /*
       * La misma forma que deja el JWT (`{ id, email }`): así PermissionsGuard,
       * McpAuthorizationService y @CurrentUser no distinguen —ni tienen por qué—
       * con qué credencial llegó quien pregunta. La llave autentica; los
       * permisos siguen saliendo del rol del usuario.
       */
      request['user'] = { id: key.user_id, email: key.email };
      /*
       * Lo que el controlador MCP necesita para separar «quién llama» de «de quién
       * son los libros». Sólo lo pone esta rama: un JWT nunca lo trae.
       */
      request['apiKey'] = { id: key.id, owner_user_id: key.owner_user_id };
      return true;
    }

    try {
      const payload = await this.jwtService.verifyAsync(token, {
        secret: env.JWT_SECRET,
      });
      // 💡 We're assigning the payload to the request object here
      // so that we can access it in our route handlers
      request['user'] = payload;
    } catch {
      throw new UnauthorizedException();
    }
    return true;
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
