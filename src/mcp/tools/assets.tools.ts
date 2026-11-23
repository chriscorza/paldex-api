import { z } from 'zod';
import { McpToolkit, ToolDef, clientRefSchema } from '../toolkit';
import { dtoToZodShape } from '../dto-schema';
import { McpServices } from './services';
import { WRITE_RULE, idArg, rangeInput } from './shared';
import { CreateFixedAssetDto } from '../../fixed-assets/dto/create-fixed-asset.dto';
import { UpdateFixedAssetDto } from '../../fixed-assets/dto/update-fixed-asset.dto';
import { DisposeFixedAssetDto } from '../../fixed-assets/dto/dispose-fixed-asset.dto';
import { FilterFixedAssetsDto } from '../../fixed-assets/dto/filter-fixed-assets.dto';
import {
  CreateProductCostDto,
  FilterProductCostsDto,
  UpdateProductCostDto,
} from '../../product-costs/dto/product-cost.dto';

export function defineAssetTools(k: McpToolkit, s: McpServices) {
  /* ---- Activos fijos ---- */
  k.define({
    name: 'fixed_assets_list',
    title: 'List fixed assets',
    kind: 'read',
    permission: 'fixed_asset:read',
    description:
      'Activos fijos con su depreciación mensual, acumulada y valor en libros a una fecha (GET /fixed-assets).',
    input: dtoToZodShape(FilterFixedAssetsDto),
    dto: FilterFixedAssetsDto,
    handler: (ctx, _args, dto) => s.fixedAssets.findAll(ctx, dto),
  });

  k.define({
    name: 'fixed_asset_create',
    title: 'Create fixed asset',
    kind: 'create',
    entity: 'fixed_asset',
    permission: 'fixed_asset:create',
    description:
      'Registra un activo fijo (POST /fixed-assets): equipo, mobiliario, vehículo, adaptaciones al local o software. Se deprecia desde el mes ' +
      'siguiente a in_service_at; si omites la vida útil se usa la del SAT para la clase. Si vinculas expense_id, el gasto debe estar en la ' +
      'categoría CAPEX "Compra de activo fijo" (si no, recategorízalo antes con expense_update). ' +
      WRITE_RULE,
    input: dtoToZodShape(CreateFixedAssetDto),
    dto: CreateFixedAssetDto,
    load: (ctx, id) => s.fixedAssets.findOne(ctx, id),
    handler: (ctx, _args, dto) => s.fixedAssets.create(ctx, dto),
    dateOf: (e) => e?.in_service_at,
  });

  k.define({
    name: 'fixed_asset_update',
    title: 'Update fixed asset',
    kind: 'update',
    entity: 'fixed_asset',
    permission: 'fixed_asset:update',
    description:
      'Corrige un activo (PATCH /fixed-assets/:id). Cambia la depreciación de todos sus meses, cerrados incluidos.',
    input: {
      id: idArg('Id del activo.'),
      ...dtoToZodShape(UpdateFixedAssetDto, { partial: true }),
    },
    dto: UpdateFixedAssetDto,
    idArgs: ['id'],
    targetId: (a) => a.id,
    load: (ctx, id) => s.fixedAssets.findOne(ctx, id),
    handler: (ctx, args, dto) => s.fixedAssets.update(ctx, args.id, dto),
    dateOf: (e) => e?.in_service_at,
  });

  k.define({
    name: 'fixed_asset_dispose',
    title: 'Dispose of a fixed asset',
    kind: 'action',
    action: 'dispose',
    entity: 'fixed_asset',
    permission: 'fixed_asset:update',
    description:
      'Da de baja un activo vendido, robado o desechado (POST /fixed-assets/:id/dispose). disposal_amount es lo recibido (0 si nada). ' +
      'Deja de depreciarse ese mes y la ganancia o pérdida va al estado de resultados.',
    input: {
      id: idArg('Id del activo.'),
      ...dtoToZodShape(DisposeFixedAssetDto),
    },
    dto: DisposeFixedAssetDto,
    idArgs: ['id'],
    targetId: (a) => a.id,
    load: (ctx, id) => s.fixedAssets.findOne(ctx, id),
    handler: (ctx, args, dto) => s.fixedAssets.dispose(ctx, args.id, dto),
    dateOf: (e) => e?.disposed_at,
  });

  k.define({
    name: 'fixed_asset_delete',
    title: 'Delete fixed asset',
    kind: 'delete',
    entity: 'fixed_asset',
    permission: 'fixed_asset:delete',
    description:
      'Borra un activo que registró el agente (DELETE /fixed-assets/:id), en dos pasos. Si se vendió o se tiró, usa fixed_asset_dispose: borrarlo ' +
      'quita su depreciación de todos los meses.',
    input: { id: idArg('Id del activo.') },
    targetId: (a) => a.id,
    load: (ctx, id) => s.fixedAssets.findOne(ctx, id),
    handler: (ctx, args) => s.fixedAssets.remove(ctx, args.id),
  });

  /* ---- Costos de producto ---- */
  k.define({
    name: 'product_costs_list',
    title: 'List product costs',
    kind: 'read',
    permission: 'product_cost:read',
    description:
      'Catálogo de costos unitarios por variante o SKU (GET /product-costs).',
    input: dtoToZodShape(FilterProductCostsDto),
    dto: FilterProductCostsDto,
    handler: (ctx, _args, dto) => s.productCosts.findAll(ctx, dto),
  });

  k.define({
    name: 'product_costs_missing',
    title: 'Products sold without cost',
    kind: 'read',
    permission: 'product_cost:read',
    description:
      'Productos vendidos en un rango que no tienen costo capturado (GET /product-costs/missing). Capturarlos mejora la utilidad bruta.',
    input: rangeInput,
    handler: (ctx, args) =>
      s.productCosts.getMissing(ctx, args.start_date, args.end_date),
  });

  const productCostCreate: ToolDef = k.define({
    name: 'product_cost_create',
    title: 'Create product cost',
    kind: 'create',
    entity: 'product_cost',
    permission: 'product_cost:create',
    description:
      'Captura el costo unitario de un producto (POST /product-costs), por variante de Shopify o por SKU, vigente desde effective_from. ' +
      'Un cambio de precio es un renglón nuevo con otra fecha, no una edición.',
    input: dtoToZodShape(CreateProductCostDto),
    dto: CreateProductCostDto,
    load: (ctx, id) => s.productCosts.findOne(ctx, id),
    handler: (ctx, _args, dto) => s.productCosts.create(ctx, dto),
  });

  k.define({
    name: 'product_cost_update',
    title: 'Update product cost',
    kind: 'update',
    entity: 'product_cost',
    permission: 'product_cost:update',
    description:
      'Corrige un costo mal capturado (PATCH /product-costs/:id). Para un cambio de precio real usa product_cost_create.',
    input: {
      id: idArg('Id del costo.'),
      ...dtoToZodShape(UpdateProductCostDto, { partial: true }),
    },
    dto: UpdateProductCostDto,
    idArgs: ['id'],
    targetId: (a) => a.id,
    load: (ctx, id) => s.productCosts.findOne(ctx, id),
    handler: (ctx, args, dto) => s.productCosts.update(ctx, args.id, dto),
  });

  k.define({
    name: 'product_cost_delete',
    title: 'Delete product cost',
    kind: 'delete',
    entity: 'product_cost',
    permission: 'product_cost:delete',
    description:
      'Borra un costo que capturó el agente (DELETE /product-costs/:id), en dos pasos.',
    input: { id: idArg('Id del costo.') },
    targetId: (a) => a.id,
    load: (ctx, id) => s.productCosts.findOne(ctx, id),
    handler: (ctx, args) => s.productCosts.remove(ctx, args.id),
  });

  k.define({
    name: 'product_costs_bulk',
    title: 'Create many product costs',
    kind: 'create',
    entity: 'product_cost',
    permission: 'product_cost:create',
    description:
      'Captura hasta 100 costos de producto de una vez (lista de proveedor), cada uno por product_cost_create con su client_ref. ' +
      'Resultado por renglón y resumen.',
    input: {
      items: z
        .array(
          z.object({
            ...dtoToZodShape(CreateProductCostDto),
            client_ref: clientRefSchema,
          }),
        )
        .min(1)
        .max(100),
    },
    bulk: productCostCreate,
    handler: async () => undefined,
  });
}
