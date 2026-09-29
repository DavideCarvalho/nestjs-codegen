import { type Decorator, Node, type Project } from 'ts-morph';
import {
  type SchemaField,
  acceptsUndefined,
  inferSchema,
  requestFieldsOf,
  requestTypeOf,
} from './schema-type-inference.js';
import { resolveImportedVariable } from './type-ref-resolution.js';
import { zodAstToTs } from './zod-ast-to-ts.js';

/**
 * The request shape a validation pipe on a `@Body()` / `@Query()` / `@Param()`
 * parameter declares.
 *
 * Many codebases validate with a schema pipe instead of a DTO class or
 * `@ApplyContract`:
 *
 *     @Post()
 *     create(@Body(new ZodPipe(createBody)) body: z.infer<typeof createBody>) {}
 *
 * The parameter's annotation (`z.infer<typeof createBody>`) is not something the
 * syntactic resolvers can expand, but the pipe's argument IS the schema. Any
 * pipe — `new X(schema)` or a factory call `x(schema)` — whose argument is a schema
 * counts, and "is a schema" is decided by the type checker through Standard Schema,
 * so this is not tied to zod or to a particular pipe class: a valibot or arktype
 * pipe is read the same way, and `new ParseIntPipe()` / `new DefaultValuePipe(1)`
 * / `new ValidationPipe({ … })` are left alone because their arguments are not
 * schemas.
 */
export interface PipeSchema {
  /** The request type (the schema's input — see `schema-type-inference.ts`). */
  type: string;
  /** Whether the schema accepts `undefined`, i.e. the value may be omitted. */
  optional: boolean;
  /** Per-field types when the input is an object (for a whole `@Param()` schema). */
  fields: SchemaField[] | null;
}

/**
 * Read the schema a param decorator's pipe argument validates with. Null when the
 * decorator carries no schema pipe.
 */
export function pipeSchemaOf(decorator: Decorator, project: Project): PipeSchema | null {
  for (const pipe of decorator.getArguments()) {
    if (!Node.isNewExpression(pipe) && !Node.isCallExpression(pipe)) continue;
    for (const arg of pipe.getArguments()) {
      if (!couldBeSchema(arg)) continue;
      const inferred = inferSchema(arg, project);
      if (inferred.kind === 'schema') {
        return {
          type: requestTypeOf(inferred.types),
          optional: acceptsUndefined(inferred.types),
          fields: requestFieldsOf(inferred.types),
        };
      }
      if (inferred.kind === 'unresolved') {
        const fallback = syntacticZodType(arg, project);
        if (fallback) {
          return { type: fallback, optional: fallback.endsWith('| undefined'), fields: null };
        }
      }
    }
  }
  return null;
}

/**
 * A cheap syntactic pre-check, so `new ParseIntPipe({ … })` or
 * `new DefaultValuePipe(10)` never makes the checker build its program: a schema is
 * a reference (`schema`, `contract.body`) or a call (`z.object(…)`), never a literal.
 */
function couldBeSchema(arg: Node): boolean {
  return (
    Node.isIdentifier(arg) ||
    Node.isPropertyAccessExpression(arg) ||
    Node.isCallExpression(arg) ||
    Node.isAsExpression(arg) ||
    Node.isSatisfiesExpression(arg) ||
    Node.isParenthesizedExpression(arg)
  );
}

/**
 * When the checker cannot type the argument (the schema library is not resolvable
 * from the project — e.g. an in-memory source), fall back to the syntactic zod
 * walker, following an identifier to its `const` initializer. Only a result the
 * walker actually recognized counts; anything it cannot read is not assumed to be
 * a schema.
 */
function syntacticZodType(arg: Node, project: Project): string | null {
  let expr: Node | undefined = arg;
  if (Node.isIdentifier(arg)) {
    const resolved = resolveImportedVariable(arg.getText(), arg.getSourceFile(), project);
    expr = resolved?.decl.getInitializer();
  }
  if (!expr || !Node.isCallExpression(expr)) return null;
  const type = zodAstToTs(expr);
  return type === 'unknown' ? null : type;
}
