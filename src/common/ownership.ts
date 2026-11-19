/*
 * Dos identidades en un mismo contexto, a propósito:
 *  - `userId`: quien llama. Sólo sirve para autorizar (rol y scope).
 *  - `ownerUserId`: de quién son los libros que se leen y se escriben. Cuando
 *    falta, es el propio `userId` (REST y dashboard: comportamiento idéntico).
 * Una llave MCP de una cuenta de servicio trae `ownerUserId` distinto: el agente
 * autoriza con SU rol pero sus filas caen en los libros del dueño.
 */
export interface OwnershipContext {
  userId: number;
  scope: 'OWN' | 'ANY';
  ownerUserId?: number;
}

/** El propietario efectivo: de quién son los libros que toca este contexto. */
export function effectiveOwnerId(ctx: OwnershipContext): number {
  return ctx.ownerUserId ?? ctx.userId;
}

export function buildOwnerFilter(ctx: OwnershipContext): { user_id?: number } {
  if (ctx.scope === 'ANY') return {};
  return { user_id: effectiveOwnerId(ctx) };
}

/*
 * «Actuar en nombre de otra cuenta»: el llamante trae un propietario efectivo
 * distinto de sí mismo (llave MCP re-enlazada). Una llave sin re-enlazar —su
 * dueño es la propia cuenta del agente— no cuenta: se comporta como siempre.
 */
export function isDelegated(ctx: OwnershipContext): boolean {
  return ctx.ownerUserId !== undefined && ctx.ownerUserId !== ctx.userId;
}

/*
 * Para validar a qué estructuras (cuentas, categorías, empleados) puede apuntar
 * una ESCRITURA. Con scope OWN, o cuando se actúa en nombre de otro, sólo las del
 * propietario efectivo — aunque el scope del rol sea ANY: el scope amplía lo que
 * se LEE, no a qué libros se puede aventar una fila. Si no, `{}`.
 */
export function buildWriteTargetFilter(ctx: OwnershipContext): {
  user_id?: number;
} {
  if (ctx.scope === 'OWN' || isDelegated(ctx)) {
    return { user_id: effectiveOwnerId(ctx) };
  }
  return {};
}
