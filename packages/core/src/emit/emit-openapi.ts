/**
 * OpenAPI 3.1 exporter. Lowers the discovered {@link RouteDescriptor} set + the
 * neutral validation IR (`SchemaModule`) into a valid `openapi.json` (OpenAPI
 * 3.1, whose schema dialect *is* JSON Schema 2020-12).
 *
 * Why 3.1 (vs 3.0): 3.1 aligns its schema object with JSON Schema 2020-12, so
 * our IR lowering ({@link schemaModuleToJsonSchema}) maps cleanly — `type` arrays
 * for nullability, `const`, `$ref` recursion, and `oneOf` + `discriminator` for
 * discriminated unions all work without the 3.0 `nullable`/`x-` workarounds. This
 * mirrors what openapi-typescript / Hey API consume and what Orval/Kubb publish.
 *
 * Coverage:
 *  - paths: one entry per route, NestJS `:param` → OpenAPI `{param}`, method,
 *    path/query parameters, request body (non-GET), and responses.
 *  - responses: the success response, plus the typed error response now carried
 *    in the IR (`error`/`errorRef`) emitted under a 4xx code (`default` is also
 *    populated so any error status resolves).
 *  - streaming routes (`stream: true`): success response content type is
 *    `text/event-stream`.
 *  - components/schemas: every named schema reachable from a route's body/query
 *    IR (`SchemaModule.named`) — including discriminated unions, arrays, enums and
 *    recursion via `$ref`. TS-type-only positions (no IR) degrade to a permissive
 *    schema annotated with the original TS type string, so the spec stays valid.
 *
 * The exporter never boots Nest; it reads only the static IR + descriptors.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ContractSource, RouteDescriptor } from '../discovery/types.js';
import { type JsonSchema, schemaModuleToJsonSchema } from '../ir/schema-node-to-json-schema.js';
import type { SchemaModule } from '../ir/schema-node.js';

export interface OpenApiInfo {
  title?: string;
  version?: string;
  description?: string;
}

export interface OpenApiEmitOptions {
  info?: OpenApiInfo;
  /** Output file name within `outDir`. Default `'openapi.json'`. */
  fileName?: string;
}

export interface OpenApiDocument {
  openapi: '3.1.0';
  info: { title: string; version: string; description?: string };
  paths: Record<string, Record<string, unknown>>;
  components: { schemas: Record<string, JsonSchema> };
}

const REF_PREFIX = '#/components/schemas/';

/** NestJS path `/users/:id` → OpenAPI path `/users/{id}`. */
function toOpenApiPath(path: string): string {
  return path.replace(/:([^/]+)/g, '{$1}');
}

/**
 * Lower a route position (body/query/response/error) to a JSON Schema, hoisting
 * any named IR schemas into the shared `components` map. Falls back to a
 * permissive schema annotated with the TS type string when no IR is available.
 */
function positionSchema(
  schema: SchemaModule | null | undefined,
  tsType: string | null | undefined,
  components: Record<string, JsonSchema>,
): JsonSchema {
  if (schema) {
    const { root, named } = schemaModuleToJsonSchema(schema, { refPrefix: REF_PREFIX });
    for (const [name, node] of Object.entries(named)) {
      // First writer wins; later identical names are assumed structurally equal
      // (they reference the same DTO class across routes).
      if (!(name in components)) components[name] = node;
    }
    return root;
  }
  // No rich IR — emit a permissive schema carrying the TS type as documentation.
  return tsType ? { description: tsType } : {};
}

function buildParameters(route: RouteDescriptor): unknown[] {
  const params: unknown[] = [];
  for (const p of route.params) {
    if (p.source === 'path') {
      params.push({
        name: p.name,
        in: 'path',
        required: true,
        schema: { type: 'string' },
      });
    } else if (p.source === 'query') {
      params.push({
        name: p.name,
        in: 'query',
        required: false,
        schema: { type: 'string' },
      });
    } else if (p.source === 'header') {
      params.push({
        name: p.name,
        in: 'header',
        required: false,
        schema: { type: 'string' },
      });
    }
  }
  return params;
}

function buildResponses(
  cs: ContractSource,
  components: Record<string, JsonSchema>,
): Record<string, unknown> {
  const responses: Record<string, unknown> = {};

  const successSchema = positionSchema(
    // Prefer rich response IR when present; otherwise fall back to the TS type.
    cs.responseSchema ?? null,
    cs.response,
    components,
  );
  const successContentType = cs.stream ? 'text/event-stream' : 'application/json';
  responses['200'] = {
    description: cs.stream ? 'Server-sent event stream' : 'Successful response',
    content: { [successContentType]: { schema: successSchema } },
  };

  // Typed error response now carried in the IR. We don't know the exact status
  // code statically, so publish it under `default` (and a representative 4xx).
  const errorSchema = positionSchema(null, cs.error ?? null, components);
  const errorBody = {
    description: 'Error response',
    content: { 'application/json': { schema: errorSchema } },
  };
  if (cs.error || cs.errorRef) {
    responses['400'] = errorBody;
    responses.default = errorBody;
  } else {
    responses.default = {
      description: 'Error response',
      content: { 'application/json': { schema: {} } },
    };
  }

  return responses;
}

function buildOperation(
  route: RouteDescriptor,
  components: Record<string, JsonSchema>,
): Record<string, unknown> {
  const cs = route.contract!.contractSource;
  const op: Record<string, unknown> = {
    operationId: route.name,
    parameters: buildParameters(route),
    responses: buildResponses(cs, components),
  };

  const method = route.method.toUpperCase();
  const hasBody = method !== 'GET' && method !== 'HEAD' && method !== 'DELETE';
  if (hasBody && (cs.bodySchema || cs.body)) {
    const bodySchema = positionSchema(cs.bodySchema, cs.body, components);
    op.requestBody = {
      required: true,
      content: { 'application/json': { schema: bodySchema } },
    };
  }

  return op;
}

/** Build the OpenAPI 3.1 document object from the route set. Pure (no I/O). */
export function buildOpenApiSpec(
  routes: RouteDescriptor[],
  opts: OpenApiEmitOptions = {},
): OpenApiDocument {
  const components: Record<string, JsonSchema> = {};
  const paths: Record<string, Record<string, unknown>> = {};

  for (const route of routes) {
    if (!route.contract) continue;
    const oaPath = toOpenApiPath(route.path);
    const method = route.method.toLowerCase();
    let pathItem = paths[oaPath];
    if (!pathItem) {
      pathItem = {};
      paths[oaPath] = pathItem;
    }
    pathItem[method] = buildOperation(route, components);
  }

  const info = opts.info ?? {};
  const doc: OpenApiDocument = {
    openapi: '3.1.0',
    info: {
      title: info.title ?? 'NestJS API',
      version: info.version ?? '1.0.0',
      ...(info.description ? { description: info.description } : {}),
    },
    paths,
    components: { schemas: components },
  };
  return doc;
}

/** Emit `openapi.json` into `outDir` for all contracted routes. */
export async function emitOpenApi(
  routes: RouteDescriptor[],
  outDir: string,
  opts: OpenApiEmitOptions = {},
): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const doc = buildOpenApiSpec(routes, opts);
  const fileName = opts.fileName ?? 'openapi.json';
  await writeFile(join(outDir, fileName), `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
}
