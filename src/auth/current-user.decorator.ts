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

/*
 * De quién son los libros que toca esta petición: el dueño si el usuario es un
 * socio ligado (`users.books_owner_id`, lo deja PermissionsGuard), si no él
 * mismo. Para lo que no pasa por OwnershipContext, como la conexión de Shopify:
 * una sola tienda por negocio, la administre quien la administre.
 */
export const BooksOwnerId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): number => {
    const request = ctx.switchToHttp().getRequest();
    return request.booksOwnerId ?? request.user.id;
  },
);
