import { FixedAssetClass, FixedAssetKind } from '@prisma/client';

/*
 * Vida útil sugerida por clase: 100 % entre la tasa máxima anual de la LISR
 * (art. 34 para activos fijos; art. 33 para gastos diferidos como el
 * software), redondeada a meses enteros.
 *
 * Sólo propone el valor al crear el activo: `useful_life_months` se guarda
 * siempre en la fila, así que cambiar esta tabla no altera activos existentes.
 */
export const ASSET_CLASS_DEFAULTS: Record<
  FixedAssetClass,
  { annual_rate: number; useful_life_months: number; kind: FixedAssetKind }
> = {
  COMPUTER: { annual_rate: 30, useful_life_months: 40, kind: 'TANGIBLE' },
  VEHICLE: { annual_rate: 25, useful_life_months: 48, kind: 'TANGIBLE' },
  FURNITURE: { annual_rate: 10, useful_life_months: 120, kind: 'TANGIBLE' },
  MACHINERY: { annual_rate: 10, useful_life_months: 120, kind: 'TANGIBLE' },
  LEASEHOLD_IMPROVEMENT: {
    annual_rate: 5,
    useful_life_months: 240,
    kind: 'TANGIBLE',
  },
  SOFTWARE: { annual_rate: 15, useful_life_months: 80, kind: 'INTANGIBLE' },
  OTHER: { annual_rate: 10, useful_life_months: 120, kind: 'TANGIBLE' },
};
