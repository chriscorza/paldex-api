export const IS_PUBLIC_KEY = 'isPublic';
export const PERMISSIONS_KEY = 'permissions';

/*
 * Marca las rutas donde se acepta una API key además de un JWT. Sin ella, una
 * llave no sirve —ni siquiera siendo válida—, así que el valor por omisión de
 * toda ruta existente y futura es «aquí las llaves no entran».
 *
 * Hoy sólo la lleva `POST /mcp`. Ponerla en otra ruta amplía a propósito lo que
 * alcanza una llave filtrada: piénsalo dos veces.
 */
export const ALLOW_API_KEY = 'allowApiKey';
