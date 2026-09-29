import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/** The pipe most zod codebases write for themselves (Flippy's `common/zod.pipe.ts`). */
export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) throw new BadRequestException(result.error.issues);
    return result.data;
  }
}

/** A factory-style pipe: `zodPipe(schema)` rather than `new ZodPipe(schema)`. */
export function zodPipe<T>(schema: ZodType<T>): ZodPipe<T> {
  return new ZodPipe(schema);
}

/** Flippy's helper: pick one part of a contract, throwing if it is absent. */
export function contractSchema<T>(schema: ZodType<T> | undefined): ZodType<T> {
  if (!schema) throw new Error('the contract does not declare this part');
  return schema;
}

/** A library-agnostic pipe over any Standard Schema (zod 4, valibot, arktype, …). */
export class StandardSchemaPipe implements PipeTransform {
  constructor(
    private readonly schema: {
      '~standard': { validate: (value: unknown) => unknown };
    },
  ) {}

  transform(value: unknown): unknown {
    return this.schema['~standard'].validate(value);
  }
}
