export interface OwnershipContext {
  userId: number;
  scope: 'OWN' | 'ANY';
}

export function buildOwnerFilter(ctx: OwnershipContext): { user_id?: number } {
  if (ctx.scope === 'ANY') return {};
  return { user_id: ctx.userId };
}
