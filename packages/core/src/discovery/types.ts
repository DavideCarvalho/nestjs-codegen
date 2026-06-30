export interface TypeRef {
  name: string;
  filePath: string;
  isArray?: boolean;
}

export type FieldTypeKind = 'string' | 'number' | 'boolean' | 'date' | 'json' | 'unknown';

/**
 * A classified filter field.
 *
 * INVARIANT — `typeRef` precedence: when `typeRef` is set it is the SOLE source
 * of truth for the emitted type; `kind`/`enumValues`/`numericEnum` are then only
 * a best-effort fallback recorded for non-emit consumers (tests/introspection),
 * NOT something the emitter reads. A discriminated union would make "carries both
 * a ref AND a literal kind" unrepresentable, but the producers and tests read
 * `kind` and `typeRef` off the same object freely, so the union ripples too
 * widely and fights the existing nullable handling. Instead this invariant is
 * concentrated in the single normalizing constructor {@link toFilterFieldType}
 * (the only place a `FilterFieldType` is built from a classification) and honored
 * by the single emit-side reader (`emitFieldTypesLiteral`). Do not branch on
 * `typeRef` vs `kind` anywhere else.
 */
export interface FilterFieldType {
  /** Field name, e.g. 'age' or 'tasks.id' (dot-notation for relations). */
  name: string;
  kind: FieldTypeKind;
  /** String/number-literal union members (enums), if any. */
  enumValues?: string[];
  /** Whether the field's TS type includes null/undefined. */
  nullable?: boolean;
  /** True when enumValues are numeric literals (emit unquoted). */
  numericEnum?: boolean;
  /**
   * When the field's type is a named enum / type alias / interface inferred from
   * a `@FilterFor` method parameter, the importable reference to that symbol.
   * The emitter references `typeRef.name` in the type map M and emits a real
   * `import type { <name> } from '<path>'` at the top of the generated file.
   * Takes precedence over `kind`/`enumValues` when present (see invariant above).
   */
  typeRef?: TypeRef;
}

export interface ContractSource {
  query: string | null;
  body: string | null;
  response: string;
  /**
   * The route's error response body type, as a TS type-source string. Discovered
   * from a `defineContract({ error })` zod schema, or an `@ApiResponse({ status,
   * type })` decorator whose `status` is a 4xx/5xx code. Absent/null means the
   * error body is untyped and resolves to `unknown` in `Route.Error<K>` (never
   * `never` — an HTTP error always carries some body).
   */
  error?: string | null;
  queryRef?: TypeRef | null;
  bodyRef?: TypeRef | null;
  responseRef?: TypeRef | null;
  /** Importable named ref for the error type (parallel to {@link responseRef}). */
  errorRef?: TypeRef | null;
  filterFields?: string[] | null;
  filterFieldTypes?: FilterFieldType[] | null;
  filterSource?: 'body' | 'query' | null;
  /** Raw zod source for the body schema (Path A inline, or Path B synthesized). */
  bodyZodText?: string | null;
  /** Importable named schema to re-export for the body (Path A). */
  bodyZodRef?: TypeRef | null;
  /** Raw zod source for the query schema (Path A inline, or Path B synthesized). */
  queryZodText?: string | null;
  /** Importable named schema to re-export for the query (Path A). */
  queryZodRef?: TypeRef | null;
  /** Hoisted nested schemas (name → zod text) referenced by body/query (Path B). */
  formNestedSchemas?: Record<string, string> | null;
  /** Unmappable-decorator warnings surfaced to console + a header comment. */
  formWarnings?: string[];
  /**
   * Neutral validation IR for the body, when synthesized from a class-validator
   * DTO. Lets `emit-forms` render via the configured adapter (valibot/arktype),
   * not only zod. `null`/absent for `defineContract` (hand-written zod) bodies.
   */
  bodySchema?: import('../ir/schema-node.js').SchemaModule | null;
  /** Neutral validation IR for the query (class-validator DTO only). */
  querySchema?: import('../ir/schema-node.js').SchemaModule | null;
  /**
   * Neutral validation IR for the success RESPONSE body, when it can be derived
   * from a class-validator-decorated response DTO. Consumed by the OpenAPI export
   * (richer `responses` schemas) and the MSW+faker mock generator (schema-shaped
   * mock data). Optional/additive: when absent the response degrades to the TS
   * type string (`response`) and mocks fall back to a permissive shape.
   */
  responseSchema?: import('../ir/schema-node.js').SchemaModule | null;
  /**
   * True when the route is a server-sent-events / streaming endpoint: it carries
   * a `@Sse()` decorator, or its handler returns `Observable<T>` /
   * `AsyncIterable<T>` / `AsyncGenerator<T>`. When set, `response` (and
   * `responseRef`) describe the streamed ELEMENT type `T` (NestJS `MessageEvent<T>`
   * wrappers are unwrapped to `T`), and the client surfaces the route as an
   * `AsyncIterable<T>` stream rather than a single awaited value.
   */
  stream?: boolean;
  /**
   * True when the route consumes `multipart/form-data` — its handler takes an
   * `@UploadedFile()` / `@UploadedFiles()` (via a Multer interceptor). The
   * uploaded-file field(s) are merged into `body` as `File | Blob`, and the
   * generated client serializes the body to a `FormData` instead of JSON.
   */
  multipart?: boolean;
}

export interface ContractDescriptor {
  contractSource: ContractSource;
}

export interface ControllerRef {
  className: string;
  methodName: string;
  filePath: string;
}

export interface RouteDescriptor {
  method: string;
  path: string;
  name: string;
  params: Array<{ name: string; source: 'path' | 'query' | 'body' | 'header' }>;
  contract?: ContractDescriptor;
  controllerRef?: ControllerRef;
}
