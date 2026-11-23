import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { PrismaService } from '../prisma.service';
import { OwnershipContext, effectiveOwnerId } from '../common/ownership';
import { dateKeyInZone } from '../common/timezone';
import { McpAuthorizationService } from './mcp-authorization.service';

/*
 * Todo lo que una tool necesita pasa por aquí, en este orden:
 *   autorización → validación con el DTO de REST → idempotencia → handler →
 *   avisos → bitácora (mcp_actions) → respuesta.
 * Una tool sólo se declara con `defineTool`; no hay forma de registrar una que
 * se salte la autorización o la bitácora. Ver openspec/changes/expand-mcp-agent.
 */

/*
 * Las dos identidades de una llamada. `userId` es quien llama (autoriza: su rol
 * y su scope). `ownerUserId` es de quién son los libros: viene de la llave y
 * jamás de los argumentos de una tool. `null` = llave sin dueño (se rechaza al
 * escribir); `undefined` = no hay llave (JWT de pruebas): se actúa como uno mismo.
 */
export interface ToolCaller {
  userId: number;
  keyId?: number;
  ownerUserId?: number | null;
}

export type ToolKind = 'read' | 'create' | 'update' | 'delete' | 'action';

export interface ToolWarning {
  code: string;
  message: string;
  [extra: string]: unknown;
}

type Ctor = new (...args: unknown[]) => object;
type Args = Record<string, any>;

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  permission: string;
  kind: ToolKind;
  input: Record<string, z.ZodTypeAny>;
  /** Entidad que se escribe, para la bitácora y para la regla de borrado. */
  entity?: string;
  /** DTO de REST con el que se valida. Recibe los argumentos menos `idArgs`, `client_ref` y `confirmation_token`. */
  dto?: Ctor;
  /** Argumentos que no son del DTO (ids de la ruta). */
  idArgs?: string[];
  /** Id de la entidad sobre la que actúa (update, delete, action). */
  targetId?: (args: Args) => number;
  /** Proyección pública de la entidad: estado previo, vista previa del borrado, relectura idempotente. */
  load?: (ctx: OwnershipContext, id: number) => Promise<unknown>;
  handler: (ctx: OwnershipContext, args: Args, dto: any) => Promise<unknown>;
  /** Fecha de dominio de lo escrito, para el aviso de mes cerrado. */
  dateOf?: (entity: any, args: Args) => Date | string | null | undefined;
  /** Avisos que se calculan antes de escribir (posibles duplicados). */
  preWarnings?: (
    ctx: OwnershipContext,
    args: Args,
    dto: any,
  ) => Promise<ToolWarning[]>;
  /** Id de la entidad creada si no es `result.id`. */
  resultId?: (result: any) => number | undefined;
  /** Nombre de la acción en la bitácora; por omisión, el `kind`. */
  action?: string;
  /** Tool masiva: aplica esta tool individual a cada elemento de `args.items`. */
  bulk?: ToolDef;
}

const MAX_BULK = 100;

const STRIPPED = ['client_ref', 'confirmation_token'];
const TOKEN_TTL_MS = 10 * 60 * 1000;

export const clientRefSchema = z
  .string()
  .min(1)
  .max(100)
  .optional()
  .describe(
    'Referencia única de lo que se registra (folio del ticket, línea del estado de cuenta, UUID de la factura, o un uuid tuyo). ' +
      'Mándala siempre: si repites la llamada con la misma, no se duplica y te regresa el registro original con duplicate: true.',
  );

export const confirmationTokenSchema = z
  .string()
  .optional()
  .describe(
    'Omítelo en la primera llamada: recibirás una vista previa y un token. Muéstrale al usuario qué se va a borrar y, ' +
      'si confirma, repite la llamada con ese token (vence en 10 minutos).',
  );

const flatten = (errors: ValidationError[], prefix = ''): string[] =>
  errors.flatMap((e) => [
    ...Object.values(e.constraints ?? {}).map((m) =>
      prefix ? `${prefix}.${m}` : m,
    ),
    ...flatten(
      e.children ?? [],
      prefix ? `${prefix}.${e.property}` : e.property,
    ),
  ]);

export const describeError = (error: unknown): string => {
  if (error instanceof HttpException) {
    const response = error.getResponse() as { message?: unknown } | string;
    const detail = typeof response === 'string' ? response : response?.message;
    const text = Array.isArray(detail) ? detail.join('; ') : detail;
    return `${error.getStatus()}: ${typeof text === 'string' && text ? text : error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
};

const asPlain = (value: unknown): Prisma.InputJsonValue | undefined =>
  value === undefined || value === null
    ? undefined
    : (JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue);

const isUniqueViolation = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

@Injectable()
export class McpToolkit {
  private readonly logger = new Logger('McpTools');
  private readonly defs: ToolDef[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: McpAuthorizationService,
  ) {}

  /** Lo registrado, para la prueba del registro y el script de permisos. */
  get registry(): readonly ToolDef[] {
    return this.defs;
  }

  define(def: ToolDef): ToolDef {
    if (def.kind !== 'read' && !def.entity) {
      throw new Error(`Tool ${def.name}: a write tool needs an entity`);
    }
    if (this.defs.some((d) => d.name === def.name)) {
      throw new Error(`Tool ${def.name} defined twice`);
    }
    this.defs.push(def);
    return def;
  }

  register(server: McpServer, caller: ToolCaller): void {
    for (const def of this.defs) {
      const input: Record<string, z.ZodTypeAny> = { ...def.input };
      if (def.kind === 'create' && !def.bulk)
        input.client_ref ??= clientRefSchema;
      if (def.kind === 'delete') {
        input.confirmation_token ??= confirmationTokenSchema;
      }
      server.registerTool(
        def.name,
        {
          title: def.title,
          description: def.description,
          inputSchema: input,
          annotations: {
            title: def.title,
            readOnlyHint: def.kind === 'read',
            destructiveHint: def.kind === 'delete',
            idempotentHint:
              def.kind === 'read' ||
              def.kind === 'create' ||
              def.kind === 'update',
            openWorldHint: false,
          },
        },
        async (args: Args) => this.invoke(caller, def, args),
      );
    }
  }

  async invoke(caller: ToolCaller, def: ToolDef, args: Args) {
    const log = (outcome: string, row_id?: unknown) =>
      this.logger.log(
        JSON.stringify({
          tool: def.name,
          key_id: caller.keyId ?? null,
          caller_user_id: caller.userId,
          owner_user_id: caller.ownerUserId ?? null,
          outcome,
          row_id: row_id ?? null,
        }),
      );
    try {
      const ctx = await this.authorize(caller, def);
      const result = await this.perform(caller, ctx, def, args);
      log('ok', (result as any)?.entity?.id ?? (result as any)?.id);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    } catch (error) {
      const message = describeError(error);
      log(`error: ${message}`);
      /*
       * El agente tiene que poder corregir: un 400 de Nest trae el detalle en
       * `response.message` (a veces un arreglo) y su `message` sólo dice "Bad
       * Request Exception". Se devuelve el detalle como resultado de error.
       */
      return {
        isError: true,
        content: [{ type: 'text' as const, text: message }],
      };
    }
  }

  /*
   * Para tools que juntan varias partes (context_get): el contexto con el que se
   * puede leer `permission`, conservando el dueño de la llave, o `null` si el rol
   * no lo tiene. Una parte sin permiso se informa como tal, no como lista vacía.
   */
  async contextFor(
    ctx: OwnershipContext,
    permission: string,
  ): Promise<OwnershipContext | null> {
    try {
      const base = await this.authorization.requireContext(
        ctx.userId,
        permission,
      );
      return ctx.ownerUserId === undefined
        ? base
        : { ...base, ownerUserId: ctx.ownerUserId };
    } catch (error) {
      if (error instanceof ForbiddenException) return null;
      throw error;
    }
  }

  async authorize(caller: ToolCaller, def: ToolDef): Promise<OwnershipContext> {
    const base = await this.authorization.requireContext(
      caller.userId,
      def.permission,
    );
    if (def.kind !== 'read' && caller.ownerUserId === null) {
      throw new ForbiddenException(
        `MCP key ${caller.keyId} has no owner_user_id; rebind it (PATCH /mcp-keys/${caller.keyId}) before writing`,
      );
    }
    return caller.ownerUserId == null
      ? base
      : { ...base, ownerUserId: caller.ownerUserId };
  }

  /*
   * Ejecuta una tool ya autorizada. Las tools masivas la llaman por cada
   * elemento con la definición de la tool individual: mismo camino, mismas reglas.
   */
  async perform(
    caller: ToolCaller,
    ctx: OwnershipContext,
    def: ToolDef,
    args: Args,
  ): Promise<unknown> {
    if (def.bulk) return this.performBulk(caller, ctx, def.bulk, args.items);

    const dto = def.dto ? await this.validate(def, args) : undefined;

    if (def.kind === 'read') return def.handler(ctx, args, dto);
    if (def.kind === 'delete')
      return this.performDelete(caller, ctx, def, args, dto);

    const warnings: ToolWarning[] = [];
    const targetId = def.targetId?.(args);
    const before =
      targetId !== undefined && def.load
        ? await def.load(ctx, targetId)
        : undefined;

    let reservationId: number | undefined;
    const clientRef =
      def.kind === 'create'
        ? (args.client_ref as string | undefined)
        : undefined;
    if (clientRef) {
      const reserved = await this.reserve(caller, ctx, def, clientRef);
      if ('duplicate' in reserved) return reserved.duplicate;
      reservationId = reserved.id;
    }

    if (def.preWarnings)
      warnings.push(...(await def.preWarnings(ctx, args, dto)));

    let entity: unknown;
    try {
      entity = await def.handler(ctx, args, dto);
    } catch (error) {
      if (reservationId !== undefined) {
        await this.prisma.mcpAction
          .delete({ where: { id: reservationId } })
          .catch(() => undefined);
      }
      throw error;
    }

    warnings.push(...(await this.closedMonthWarnings(ctx, def, entity, args)));

    const entityId =
      def.resultId?.(entity) ??
      (entity as { id?: number } | null)?.id ??
      targetId;
    const actionId = await this.record(caller, ctx, def, {
      reservationId,
      entityId,
      before,
      after: entity,
      warnings,
    });
    return { entity, warnings, action_id: actionId };
  }

  /*
   * Cada elemento pasa por la tool individual (validación, idempotencia,
   * avisos, bitácora). Un error en uno no detiene a los demás: en un estado de
   * cuenta, una fila mala no debe frenar las otras 99, y reenviar el lote con
   * los mismos client_ref sólo agrega lo que faltaba.
   */
  private async performBulk(
    caller: ToolCaller,
    ctx: OwnershipContext,
    single: ToolDef,
    items: Args[] | undefined,
  ) {
    if (!Array.isArray(items) || items.length === 0) {
      throw new BadRequestException('items must be a non-empty array');
    }
    if (items.length > MAX_BULK) {
      throw new BadRequestException(
        `items must have at most ${MAX_BULK} elements`,
      );
    }
    const results: Args[] = [];
    for (const [index, item] of items.entries()) {
      try {
        const out = (await this.perform(caller, ctx, single, item)) as Args;
        results.push({
          index,
          status: out.duplicate ? 'duplicate' : 'created',
          entity: out.entity,
          warnings: out.warnings,
          action_id: out.action_id,
        });
      } catch (error) {
        const message = describeError(error);
        results.push({
          index,
          status: 'error',
          client_ref: item?.client_ref,
          error: message,
        });
      }
    }
    const count = (status: string) =>
      results.filter((r) => r.status === status).length;
    return {
      results,
      summary: {
        total: items.length,
        created: count('created'),
        duplicates: count('duplicate'),
        errors: count('error'),
      },
    };
  }

  async validate(def: ToolDef, args: Args): Promise<object> {
    const omit = new Set([...STRIPPED, ...(def.idArgs ?? [])]);
    const payload = Object.fromEntries(
      Object.entries(args).filter(([k, v]) => !omit.has(k) && v !== undefined),
    );
    const instance = plainToInstance(def.dto!, payload, {
      enableImplicitConversion: true,
    });
    const errors = await validate(instance, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    if (errors.length) {
      throw new BadRequestException(flatten(errors));
    }
    return instance;
  }

  /*
   * Reserva el `client_ref` ANTES de escribir: la fila con `entity_id` nulo
   * ocupa el índice único, así que de dos llamadas simultáneas con la misma
   * referencia sólo una llega al handler. Reservar después dejaría escribir a
   * las dos y fallar sólo a la bitácora.
   */
  private async reserve(
    caller: ToolCaller,
    ctx: OwnershipContext,
    def: ToolDef,
    clientRef: string,
  ): Promise<{ id: number } | { duplicate: unknown }> {
    const owner = effectiveOwnerId(ctx);
    try {
      const row = await this.prisma.mcpAction.create({
        data: {
          key_id: caller.keyId ?? null,
          caller_user_id: caller.userId,
          owner_user_id: owner,
          tool: def.name,
          entity: def.entity!,
          action: def.action ?? def.kind,
          client_ref: clientRef,
        },
      });
      return { id: row.id };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const existing = await this.prisma.mcpAction.findFirst({
        where: { owner_user_id: owner, tool: def.name, client_ref: clientRef },
      });
      if (!existing?.entity_id) {
        throw new ConflictException(
          `Una llamada con client_ref "${clientRef}" sigue en curso; reintenta en unos segundos.`,
        );
      }
      const entity = def.load
        ? await def.load(ctx, existing.entity_id).catch(() => existing.after)
        : existing.after;
      return {
        duplicate: {
          entity,
          duplicate: true,
          warnings: [
            {
              code: 'DUPLICATE_CLIENT_REF',
              message: `Ya se había registrado con client_ref "${clientRef}"; no se creó nada nuevo.`,
            },
          ],
          action_id: existing.id,
        },
      };
    }
  }

  /*
   * La bitácora se escribe después del dominio, no en la misma transacción (ver
   * design.md, decisión 3). Si falla dos veces, el registro existe sin rastro y
   * se avisa: el agente ya no podrá borrarlo.
   */
  private async record(
    caller: ToolCaller,
    ctx: OwnershipContext,
    def: ToolDef,
    data: {
      reservationId?: number;
      entityId?: number;
      before?: unknown;
      after?: unknown;
      warnings: ToolWarning[];
      action?: string;
    },
  ): Promise<number | null> {
    const write = () =>
      data.reservationId !== undefined
        ? this.prisma.mcpAction.update({
            where: { id: data.reservationId },
            data: {
              entity_id: data.entityId ?? null,
              after: asPlain(data.after),
            },
          })
        : this.prisma.mcpAction.create({
            data: {
              key_id: caller.keyId ?? null,
              caller_user_id: caller.userId,
              owner_user_id: effectiveOwnerId(ctx),
              tool: def.name,
              entity: def.entity!,
              entity_id: data.entityId ?? null,
              action: data.action ?? def.action ?? def.kind,
              before: asPlain(data.before),
              after: asPlain(data.after),
            },
          });
    try {
      return (await write()).id;
    } catch {
      try {
        return (await write()).id;
      } catch (error) {
        this.logger.error(
          JSON.stringify({
            msg: 'mcp_action not recorded',
            tool: def.name,
            entity_id: data.entityId ?? null,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        data.warnings.push({
          code: 'ACTION_NOT_LOGGED',
          message:
            'Se guardó, pero no quedó en la bitácora del agente: no podrás borrarlo desde aquí.',
        });
        return null;
      }
    }
  }

  /*
   * Borrado en dos pasos y sólo de lo que creó el agente (cualquier llave del
   * mismo dueño, para que rotar la llave no deje huérfano lo ya creado).
   */
  private async performDelete(
    caller: ToolCaller,
    ctx: OwnershipContext,
    def: ToolDef,
    args: Args,
    dto: unknown,
  ) {
    const id = def.targetId!(args);
    const preview = def.load ? await def.load(ctx, id) : { id };

    const created = await this.prisma.mcpAction.findFirst({
      where: {
        owner_user_id: effectiveOwnerId(ctx),
        entity: def.entity!,
        entity_id: id,
        action: 'create',
      },
      select: { id: true },
    });
    if (!created) {
      throw new ForbiddenException(
        `Este registro (${def.entity} ${id}) no lo creó el agente: sólo se puede borrar desde la app.`,
      );
    }

    const token = args.confirmation_token as string | undefined;
    if (!token) {
      const expiresAt = Date.now() + TOKEN_TTL_MS;
      return {
        preview,
        confirmation_token: this.sign(caller, def.name, id, expiresAt),
        expires_at: new Date(expiresAt).toISOString(),
        message:
          'No se borró nada. Muéstrale al usuario lo que se va a borrar y, si confirma, repite la llamada con confirmation_token.',
      };
    }
    this.verify(caller, def.name, id, token);

    const result = await def.handler(ctx, args, dto);
    const warnings: ToolWarning[] = [];
    const actionId = await this.record(caller, ctx, def, {
      entityId: id,
      before: preview,
      warnings,
      action: 'delete',
    });
    return {
      entity: result ?? preview,
      deleted: true,
      warnings,
      action_id: actionId,
    };
  }

  private secret(): string {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET is not set');
    return secret;
  }

  sign(
    caller: ToolCaller,
    tool: string,
    id: number,
    expiresAt: number,
  ): string {
    const body = `${caller.keyId ?? `u${caller.userId}`}:${tool}:${id}:${expiresAt}`;
    const mac = createHmac('sha256', this.secret())
      .update(body)
      .digest('base64url');
    return `${expiresAt}.${mac}`;
  }

  private verify(caller: ToolCaller, tool: string, id: number, token: string) {
    const [exp, mac] = token.split('.');
    const expiresAt = Number(exp);
    const expected = this.sign(caller, tool, id, expiresAt).split('.')[1];
    const valid =
      Number.isFinite(expiresAt) &&
      mac !== undefined &&
      mac.length === expected.length &&
      timingSafeEqual(Buffer.from(mac), Buffer.from(expected));
    if (!valid) {
      throw new BadRequestException(
        'confirmation_token no corresponde a este registro: pide una vista previa nueva (llama sin token).',
      );
    }
    if (Date.now() > expiresAt) {
      throw new BadRequestException(
        'confirmation_token venció: pide una vista previa nueva (llama sin token).',
      );
    }
  }

  /* El mes se toma en la zona del negocio: el 31 a las 20:00 en CDMX es ese mes, no el siguiente. */
  private async closedMonthWarnings(
    ctx: OwnershipContext,
    def: ToolDef,
    entity: unknown,
    args: Args,
  ): Promise<ToolWarning[]> {
    const raw = def.dateOf?.(entity, args);
    if (!raw) return [];
    const date = raw instanceof Date ? raw : new Date(raw);
    if (Number.isNaN(date.getTime())) return [];
    const [year, month] = dateKeyInZone(date).split('-').map(Number);
    const close = await this.prisma.monthlyClose.findUnique({
      where: {
        user_id_year_month: { user_id: effectiveOwnerId(ctx), year, month },
      },
      select: { status: true },
    });
    if (close?.status !== 'CLOSED') return [];
    const label = `${year}-${String(month).padStart(2, '0')}`;
    return [
      {
        code: 'CLOSED_MONTH',
        month: label,
        message:
          `Se registró en ${label}, que ya estaba cerrado: su cierre quedó desactualizado. ` +
          'Sólo el dueño puede reabrirlo y volver a cerrarlo desde la app.',
      },
    ];
  }
}
