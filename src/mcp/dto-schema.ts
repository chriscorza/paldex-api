import 'reflect-metadata';
import { z } from 'zod';
import { getMetadataStorage } from 'class-validator';
import type { ValidationMetadata } from 'class-validator/types/metadata/ValidationMetadata';

/*
 * El esquema que ve el agente se deriva del DTO del endpoint REST, no se
 * escribe a mano.
 *
 * Con 80 tools, un esquema zod escrito al lado de cada DTO acabaría
 * desalineado: el agente vería un campo opcional que la API exige, o no vería
 * uno nuevo. Aquí se leen los decoradores de class-validator (tipo, enum,
 * mínimos, opcional) y la descripción de @ApiProperty. La validación de verdad
 * sigue siendo el DTO con class-validator (ver McpToolkit.validate): este
 * esquema sólo describe y filtra lo grueso, así que un decorador que no se
 * traduzca aquí cae en `z.any()` y el DTO lo sigue validando.
 */

type Ctor = new (...args: unknown[]) => object;

const describeFrom = (target: Ctor, property: string): string | undefined => {
  const meta = Reflect.getMetadata(
    'swagger/apiModelProperties',
    target.prototype,
    property,
  ) as { description?: string; example?: unknown } | undefined;
  if (!meta) return undefined;
  const parts: string[] = [];
  if (meta.description) parts.push(meta.description);
  if (meta.example !== undefined && typeof meta.example !== 'object') {
    parts.push(`Ejemplo: ${String(meta.example)}`);
  }
  return parts.length ? parts.join(' ') : undefined;
};

const enumValues = (constraint: unknown): string[] | null => {
  if (Array.isArray(constraint)) return constraint.map(String);
  if (constraint && typeof constraint === 'object') {
    return Array.from(new Set(Object.values(constraint).map(String)));
  }
  return null;
};

function propertySchema(rules: ValidationMetadata[]): z.ZodTypeAny {
  const has = (name: string) => rules.find((r) => r.name === name);
  const each = rules.some((r) => r.each);

  let base: z.ZodTypeAny;
  const isEnum = has('isEnum');
  const isIn = has('isIn');
  if (isEnum || isIn) {
    const values = enumValues((isEnum ?? isIn)!.constraints?.[0]);
    base =
      values && values.length
        ? z.enum(values as [string, ...string[]])
        : z.string();
  } else if (has('isInt')) {
    let n = z.number().int();
    const min = has('min')?.constraints?.[0] as number | undefined;
    const max = has('max')?.constraints?.[0] as number | undefined;
    if (min !== undefined) n = n.min(min);
    if (max !== undefined) n = n.max(max);
    base = n;
  } else if (has('isNumber') || has('isPositive')) {
    let n = z.number();
    const min = has('min')?.constraints?.[0] as number | undefined;
    const max = has('max')?.constraints?.[0] as number | undefined;
    if (min !== undefined) n = n.min(min);
    if (max !== undefined) n = n.max(max);
    if (has('isPositive')) n = n.positive();
    base = n;
  } else if (has('isBoolean')) {
    base = z.boolean();
  } else if (has('isDateString') || has('isISO8601')) {
    base = z.string().describe('Fecha YYYY-MM-DD');
  } else if (has('isString') || has('isNotEmpty') || has('isEmail')) {
    let s = z.string();
    if (has('isNotEmpty')) s = s.min(1);
    const maxLength = has('maxLength')?.constraints?.[0] as number | undefined;
    if (maxLength !== undefined) s = s.max(maxLength);
    base = s;
  } else {
    base = z.any();
  }

  if (has('isArray') || each) base = z.array(base);
  return base;
}

/** El shape zod de un DTO, para `inputSchema` de una tool. */
export function dtoToZodShape(
  dto: Ctor,
  options: { partial?: boolean; omit?: string[] } = {},
): Record<string, z.ZodTypeAny> {
  const metadata = getMetadataStorage().getTargetValidationMetadatas(
    dto,
    '',
    true,
    false,
  );
  const byProperty = new Map<string, ValidationMetadata[]>();
  for (const m of metadata) {
    if (options.omit?.includes(m.propertyName)) continue;
    const list = byProperty.get(m.propertyName) ?? [];
    list.push(m);
    byProperty.set(m.propertyName, list);
  }

  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [property, rules] of byProperty) {
    let schema = propertySchema(rules);
    const description = describeFrom(dto, property);
    if (description) schema = schema.describe(description);
    const optional =
      options.partial || rules.some((r) => r.name === 'isOptional');
    shape[property] = optional ? schema.optional() : schema;
  }
  return shape;
}
