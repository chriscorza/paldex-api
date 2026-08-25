import { SetMetadata } from '@nestjs/common';
import { ALLOW_API_KEY } from '../globalConstants';

/*
 * Permite autenticar esta ruta con una API key de MCP, además de con un JWT.
 *
 * Es opt-in y nada más: `AuthGuard` rechaza una llave —aunque sea válida— en
 * cualquier ruta que no la lleve. Eso acota lo que alcanza una llave filtrada a
 * la superficie de tools de MCP, que la lista negra ya recorta aparte; son dos
 * contenciones independientes y ninguna depende de que la otra esté bien.
 */
export const AllowApiKey = () => SetMetadata(ALLOW_API_KEY, true);
