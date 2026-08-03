import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/*
 * Devuelve el payload del JWT verificado por AuthGuard.
 * Forma: { id: number; email: string }.
 *
 * Depende de que AuthGuard haya ejecutado antes.
 * En una ruta @Public() devuelve undefined porque el guard no corre.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.user as { id: number; email: string };
  },
);
