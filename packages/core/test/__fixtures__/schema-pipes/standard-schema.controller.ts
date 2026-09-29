import { Body, Controller, Post, Query } from '@nestjs/common';
import { StandardSchemaPipe } from './zod.pipe';

/**
 * The shape every Standard Schema library (valibot >= 1, arktype >= 2, zod >= 3.24)
 * gives its schemas. Declared by hand here so the fixture needs no library: what the
 * codegen keys on is this property, not a particular package.
 */
interface StandardSchema<Input, Output = Input> {
  readonly '~standard': {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => unknown;
    readonly types?: { readonly input: Input; readonly output: Output } | undefined;
  };
}

declare function schema<Input, Output = Input>(): StandardSchema<Input, Output>;

const renameBody = schema<{ name: string; color?: 'red' | 'blue' }>();
const filterQuery = schema<{ from?: string }, { from: Date }>();

@Controller('standard')
export class StandardSchemaController {
  @Post()
  rename(@Body(new StandardSchemaPipe(renameBody)) body: { name: string }) {
    return body;
  }

  @Post('filter')
  filter(@Query(new StandardSchemaPipe(filterQuery)) query: { from: Date }) {
    return query;
  }
}
