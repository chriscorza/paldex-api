import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FixedAsset, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import {
  OwnershipContext,
  buildOwnerFilter,
  buildWriteTargetFilter,
  effectiveOwnerId,
} from '../common/ownership';
import { startOfDayInZone } from '../common/timezone';
import { toMoneyNumber } from '../common/money';
import { CreateFixedAssetDto } from './dto/create-fixed-asset.dto';
import { UpdateFixedAssetDto } from './dto/update-fixed-asset.dto';
import { DisposeFixedAssetDto } from './dto/dispose-fixed-asset.dto';
import { FilterFixedAssetsDto } from './dto/filter-fixed-assets.dto';
import { FixedAssetEntity } from './entities/fixed-asset.entity';
import { ASSET_CLASS_DEFAULTS } from './asset-classes';
import {
  accumulatedAt,
  bookValueAt,
  disposalResult,
  monthlySchedule,
} from './depreciation';

const Decimal = Prisma.Decimal;

const SORTABLE = ['name', 'acquisition_cost', 'in_service_at', 'created_at'];

/*
 * Las fechas de un activo son de calendario: el día de la compra, el de entrada
 * en uso, el de la baja. Se toma sólo `YYYY-MM-DD` y se ancla a la medianoche
 * de la zona del negocio. El formulario del front manda `YYYY-MM-DDT00:00:00Z`;
 * tomado como instante, en CDMX eso es el día anterior a las 18:00, y un activo
 * puesto en uso el 1 de abril se depreciaría desde abril en vez de mayo.
 */
const toInstant = (value: string) => startOfDayInZone(value.slice(0, 10));

@Injectable()
export class FixedAssetsService {
  constructor(private prisma: PrismaService) {}

  async findAll(ctx: OwnershipContext, filters: FilterFixedAssetsDto) {
    const where: Prisma.FixedAssetWhereInput = { ...buildOwnerFilter(ctx) };
    if (filters.asset_class) where.asset_class = filters.asset_class;
    if (filters.search) where.name = { contains: filters.search };
    if (filters.include_disposed === false) where.disposed_at = null;

    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    const sortBy =
      filters.sort_by && SORTABLE.includes(filters.sort_by)
        ? filters.sort_by
        : 'in_service_at';
    const order = filters.order === 'asc' ? 'asc' : 'desc';
    const asOf = filters.as_of ? toInstant(filters.as_of) : new Date();

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.fixedAsset.findMany({
        where,
        orderBy: { [sortBy]: order },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.fixedAsset.count({ where }),
    ]);

    return {
      data: rows.map((row) => this.project(row, asOf)),
      total,
      page,
      limit,
    };
  }

  async findOne(ctx: OwnershipContext, id: number, asOf?: string) {
    const row = await this.getOwned(ctx, id);
    return this.project(row, asOf ? toInstant(asOf) : new Date());
  }

  async create(ctx: OwnershipContext, dto: CreateFixedAssetDto) {
    const defaults = ASSET_CLASS_DEFAULTS[dto.asset_class];
    const data = {
      name: dto.name,
      asset_class: dto.asset_class,
      kind: dto.kind ?? defaults.kind,
      acquisition_cost: new Decimal(dto.acquisition_cost),
      acquired_at: toInstant(dto.acquired_at),
      in_service_at: toInstant(dto.in_service_at),
      useful_life_months: dto.useful_life_months ?? defaults.useful_life_months,
      salvage_value: new Decimal(dto.salvage_value ?? 0),
      expense_id: dto.expense_id ?? null,
      notes: dto.notes ?? null,
    };

    this.assertCoherent(data);
    if (data.expense_id) await this.assertCapexExpense(ctx, data.expense_id);

    const row = await this.prisma.fixedAsset.create({
      data: { ...data, user_id: effectiveOwnerId(ctx) },
    });
    return this.project(row, new Date());
  }

  async update(ctx: OwnershipContext, id: number, dto: UpdateFixedAssetDto) {
    const existing = await this.getOwned(ctx, id);

    const data: Prisma.FixedAssetUncheckedUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.asset_class !== undefined) data.asset_class = dto.asset_class;
    if (dto.kind !== undefined) data.kind = dto.kind;
    if (dto.acquisition_cost !== undefined)
      data.acquisition_cost = new Decimal(dto.acquisition_cost);
    if (dto.acquired_at !== undefined)
      data.acquired_at = toInstant(dto.acquired_at);
    if (dto.in_service_at !== undefined)
      data.in_service_at = toInstant(dto.in_service_at);
    if (dto.useful_life_months !== undefined)
      data.useful_life_months = dto.useful_life_months;
    if (dto.salvage_value !== undefined)
      data.salvage_value = new Decimal(dto.salvage_value);
    if (dto.expense_id !== undefined) data.expense_id = dto.expense_id;
    if (dto.notes !== undefined) data.notes = dto.notes;

    const merged = { ...existing, ...data } as FixedAsset;
    this.assertCoherent(merged);
    if (dto.expense_id && dto.expense_id !== existing.expense_id) {
      await this.assertCapexExpense(ctx, dto.expense_id);
    }

    const row = await this.prisma.fixedAsset.update({ where: { id }, data });
    return this.project(row, new Date());
  }

  async dispose(ctx: OwnershipContext, id: number, dto: DisposeFixedAssetDto) {
    const existing = await this.getOwned(ctx, id);
    const disposedAt = toInstant(dto.disposed_at);
    if (disposedAt < existing.in_service_at) {
      throw new BadRequestException(
        'disposed_at no puede ser anterior a in_service_at',
      );
    }

    const row = await this.prisma.fixedAsset.update({
      where: { id },
      data: {
        disposed_at: disposedAt,
        disposal_amount: new Decimal(dto.disposal_amount),
      },
    });
    return this.project(row, new Date());
  }

  async remove(ctx: OwnershipContext, id: number) {
    await this.getOwned(ctx, id);
    await this.prisma.fixedAsset.delete({ where: { id } });
    return { id };
  }

  private async getOwned(ctx: OwnershipContext, id: number) {
    const row = await this.prisma.fixedAsset.findFirst({
      where: { id, ...buildOwnerFilter(ctx) },
    });
    if (!row) throw new NotFoundException(`Fixed asset ${id} not found`);
    return row;
  }

  private assertCoherent(asset: {
    acquisition_cost: Prisma.Decimal | number;
    salvage_value: Prisma.Decimal | number;
    acquired_at: Date;
    in_service_at: Date;
    disposed_at?: Date | null;
  }) {
    const cost = new Decimal(asset.acquisition_cost);
    if (new Decimal(asset.salvage_value).gte(cost)) {
      throw new BadRequestException(
        'salvage_value debe ser menor que acquisition_cost',
      );
    }
    if (asset.in_service_at < asset.acquired_at) {
      throw new BadRequestException(
        'in_service_at no puede ser anterior a acquired_at',
      );
    }
    if (asset.disposed_at && asset.disposed_at < asset.in_service_at) {
      throw new BadRequestException(
        'disposed_at no puede ser anterior a in_service_at',
      );
    }
  }

  /*
   * La compra de un activo es flujo, no gasto: si el gasto vinculado sigue en
   * otra categoría, el estado de resultados lo restaría como gasto Y como
   * depreciación. No se recategoriza solo, porque mover un gasto de categoría
   * cambia meses que quizá ya se cerraron: eso lo decide una persona.
   */
  private async assertCapexExpense(ctx: OwnershipContext, expenseId: number) {
    const expense = await this.prisma.expense.findFirst({
      where: { id: expenseId, ...buildWriteTargetFilter(ctx) },
      include: { category: { select: { name: true, type: true } } },
    });
    if (!expense) throw new NotFoundException(`Expense ${expenseId} not found`);
    if (expense.category?.type !== 'CAPEX') {
      const current = expense.category?.name ?? 'sin categoría';
      throw new BadRequestException(
        `El gasto ${expenseId} está en la categoría "${current}". Pásalo a ` +
          '"Compra de activo fijo" antes de vincularlo: si no, se contaría como gasto y como depreciación.',
      );
    }
  }

  private project(row: FixedAsset, asOf: Date): FixedAssetEntity {
    const schedule = monthlySchedule(row);
    const accumulated = accumulatedAt(row, asOf);
    const depreciable = new Decimal(row.acquisition_cost).minus(
      row.salvage_value,
    );
    const result = disposalResult(row);

    return new FixedAssetEntity({
      id: row.id,
      name: row.name,
      kind: row.kind,
      asset_class: row.asset_class,
      acquisition_cost: toMoneyNumber(row.acquisition_cost)!,
      acquired_at: row.acquired_at,
      in_service_at: row.in_service_at,
      useful_life_months: row.useful_life_months,
      salvage_value: toMoneyNumber(row.salvage_value)!,
      disposed_at: row.disposed_at,
      disposal_amount: toMoneyNumber(row.disposal_amount),
      expense_id: row.expense_id,
      notes: row.notes,
      monthly_depreciation: schedule.length ? schedule[0].amount.toNumber() : 0,
      accumulated_depreciation: accumulated.toNumber(),
      book_value: bookValueAt(row, asOf).toNumber(),
      disposal_result: result ? result.toNumber() : null,
      fully_depreciated: accumulated.gte(depreciable),
      created_at: row.created_at,
    });
  }
}
