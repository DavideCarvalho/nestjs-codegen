# Design Spec — Extensible `nestjs-codegen`: source/IR/emit plugin architecture

Status: Design (architecture overview + decomposition)
Date: 2026-06-10
Scope: extract and generalize the codegen into a **standalone repo**, `~/personal/nestjs-codegen`

> **Relocation note (2026-06-10):** this is now its own repository
> (`~/personal/nestjs-codegen`), not a set of packages inside the `nestjs-inertia`
> monorepo. The new repo owns the **generic core + validation adapters**;
> `nestjs-inertia` keeps the **Inertia preset** (pages/shared-props/router mode) and
> will consume the published `@dudousxd/nestjs-codegen`.
>
> **Implemented (all five pillars, 83 tests, typecheck + build + lint green):**
> - `packages/core` — validation IR, `ValidationAdapter` + bundled zod adapter,
>   `resolveAdapter` registry, `extractSchemaFromDto` (class-validator → IR, golden gate
>   reproduces the old emitter byte-for-byte), route model + config, and the
>   `routes.ts`/`api.ts`/`forms.ts` emit pipeline + `generate()`.
> - `packages/valibot`, `packages/arktype` — the other two validation adapters.
> - `packages/client` (`@dudousxd/nestjs-client`) — neutral runtime fetcher with the
>   superjson transformer hook.
> - api.ts emit: `query: true` → `@tanstack/query-core` queryOptions/mutationOptions;
>   `mutationClient: 'inertia'` → Inertia router visits (the nestjs-inertia integration).
>
> **Still to port (productionization):** full NestJS controller/contract discovery
> (controllers → `RouteDescriptor[]`), the CLI + watch mode, and the Inertia preset
> package that lives in `nestjs-inertia` and consumes this core.

## 0. Goal

Today the codegen lives in one package, `@dudousxd/nestjs-inertia-codegen`, and is
hard-wired to Inertia and to zod. The goal is to turn it into a **NestJS codegen that
works without Inertia**, with three independent extension axes:

1. **Validation lib is pluggable** — emit zod (default), valibot, or arktype, via a
   neutral schema IR and adapters designed around the **Standard Schema** spec.
2. **TanStack Query is opt-in and framework-agnostic** — emit pure
   `queryOptions`/`mutationOptions` from `@tanstack/query-core` only when enabled
   (no React-specific hooks).
3. **superjson is opt-in** — when enabled, wire the transformer into the fetcher and
   preserve rich types (Date survives) in the emitted types.

Inertia stops being the substrate and becomes **one preset** layered on a generic core.

## 1. Grounding in the real source

All paths under `/home/dudousxd/personal/nestjs-inertia/packages/codegen/`.

**Generic (moves to core):**
- `src/discovery/contracts-fast.ts` — `defineContract` parse, controller route extraction.
- `src/discovery/dto-to-zod.ts` — class-validator decorators → zod **text** (480L). This
  is the biggest refactor target: it becomes `dto-to-ir.ts` producing `SchemaNode`.
- `src/discovery/enum-resolution.ts`, `filter-field-types.ts`, `filter-for.ts`,
  `type-ref-resolution.ts`, `types.ts` — generic AST helpers + `RouteDescriptor`.
- `src/emit/emit-routes.ts` — `routes.ts` (ROUTES map, `RouteName`, `route()`). Generic.
- `src/emit/emit-api.ts` (726L) — `api.ts`. **Mostly** generic but hardcodes
  `import { router } from '@inertiajs/react'` (line ~514) for mutations and
  `import ... from '@tanstack/react-query'` (line ~506). Both become mode-driven.
- `src/emit/emit-forms.ts` (366L) — `forms.ts`. Emits zod text; becomes adapter-driven.
- `src/config/*`, `src/cli/*`, `src/watch/*`, `src/generate.ts`, `src/index.ts`.

**Inertia-specific (moves to the preset):**
- `src/discovery/pages.ts` — Inertia page discovery.
- `src/discovery/shared-props.ts` — `InertiaModule.forRoot({ share })` discovery.
- `src/emit/emit-pages.ts` — `pages.d.ts` + `declare module '@dudousxd/nestjs-inertia'`.
- `src/emit/emit-cache.ts` — `components.json`.
- The `export * from './pages.js'` line in `src/emit/emit-index.ts`.
- The `@inertiajs/react` router mutation path in `emit-api.ts`.

**Runtime (separate concern, see §6):** `packages/client/src/fetcher/*`,
`contract/contract.ts`, `invalidate.ts` are already Inertia-agnostic but live in
`@dudousxd/nestjs-inertia-client`.

## 2. Architecture — the plugin pipeline

```
   sources[]            normalize              emitters[]
 ┌───────────┐   ┌───────────────────┐   ┌────────────────────┐
 │  nestjs   │──▶│   ProjectModel    │──▶│ routes / api / forms│──▶ outDir/*
 │ (inertia) │   │  (RouteDescriptor │   │ (+ inertia: pages,  │
 └───────────┘   │   + SchemaNode    │   │  components.json)   │
                 │   + extensions)   │   └─────────┬──────────┘
                 └───────────────────┘             │ uses
                                                    ▼
                                          ValidationAdapter
                                       (zod | valibot | arktype)
```

Three extension axes, each an interface in the core:

- **Source** — discovers AST → contributes to `ProjectModel`. Core ships `nestjsSource`
  (controllers/routes/contracts/DTOs/filters). The preset adds an `inertiaSource`
  (pages, shared props) into the model's typed extension bag.
- **ValidationAdapter** — `SchemaNode` → source text. Core defines the interface +
  `SchemaNode` IR. Adapters ship as separate packages.
- **Emitter** — reads `ProjectModel` + active `ValidationAdapter`, writes a file. Core:
  `routes`, `api`, `forms`. Preset: `pages`, `components`, shared-props block.

## 3. The IR

```ts
// Neutral validation IR — produced by dto-to-ir AND by parsing defineContract zod-ASTs.
type SchemaNode =
  | { kind: 'object'; fields: Record<string, SchemaNode>; }
  | { kind: 'array'; element: SchemaNode; }
  | { kind: 'string'; checks?: StringCheck[]; }   // email|url|uuid|regex|min|max|length
  | { kind: 'number'; checks?: NumberCheck[]; }    // int|min|max|positive|negative
  | { kind: 'boolean' }
  | { kind: 'date' }
  | { kind: 'enum'; values: string[]; }
  | { kind: 'literal'; value: string | number | boolean; }
  | { kind: 'union'; options: SchemaNode[]; }
  | { kind: 'optional'; inner: SchemaNode; }
  | { kind: 'nullable'; inner: SchemaNode; }
  | { kind: 'ref'; name: string; }                 // hoisted named (nested DTO / recursion)
  | { kind: 'unknown'; reason: string; };           // graceful fallback w/ warning

interface SchemaModule {
  root: SchemaNode;
  named: Map<string, SchemaNode>;   // hoisted nested/recursive schemas
  warnings: string[];
}
```

- `RouteDescriptor` (already in `discovery/types.ts`) is generalized; its `contract`
  body/query references become `SchemaModule` instead of raw zod text.
- `ProjectModel` aggregates `routes: RouteDescriptor[]` plus a typed `extensions` bag
  where sources stash framework-specific data (e.g. `extensions.inertia.pages`).

## 4. ValidationAdapter interface

```ts
interface ValidationAdapter {
  name: string;                                  // 'zod' | 'valibot' | 'arktype'
  /** Import lines needed for the rendered text (deduped by the emitter). */
  importStatements(used: AdapterUsage): string[];
  /** Render a SchemaNode to source text in this lib's syntax. */
  render(node: SchemaNode, ctx: RenderContext): string;
  /** Optional: how to express the schema's inferred TS type, if not via import. */
  inferType?(node: SchemaNode): string;
}
```

- Modeled so any **Standard Schema**-compliant lib is addable by implementing `render`.
- Resolution: `validation: 'zod'` → core dynamically imports
  `@dudousxd/nestjs-codegen-zod`; a missing adapter package yields a clear error. A
  custom adapter object can be passed directly in config.

## 5. Packages

| Package | Role |
|---|---|
| `@dudousxd/nestjs-codegen` | **Core**: CLI/bin, config, `nestjsSource`, IR, emitters (routes/api/forms), adapter registry. No Inertia, no validation-lib deps. |
| `@dudousxd/nestjs-codegen-zod` | Default validation adapter (peer-dep `zod`). |
| `@dudousxd/nestjs-codegen-valibot` | Valibot adapter (peer-dep `valibot`). |
| `@dudousxd/nestjs-codegen-arktype` | ArkType adapter (peer-dep `arktype`). |
| `@dudousxd/nestjs-inertia-codegen` | **Inertia preset**: depends on core, registers `inertiaSource` + inertia emitters, sets api emitter to `inertia` mutation mode. **Keeps current package name + CLI bin** for back-compat. |
| `@dudousxd/nestjs-client` | **Neutral runtime** (see §6): fetcher + query builders + `defineContract` + `invalidate`, extracted from `nestjs-inertia-client`. |

## 6. Runtime (decided: extract neutral package)

The emitted `api.ts` needs a runtime to import. Today it would import from
`@dudousxd/nestjs-inertia-client`, but a non-Inertia project should not depend on a
package named "inertia". Decision: extract `@dudousxd/nestjs-client` holding the
already-agnostic runtime (`createFetcher`, `buildUrl`, `setGlobalHeaders`,
`ApiHttpError`, `defineContract`, `invalidate`, query builders).
`@dudousxd/nestjs-inertia-client` re-exports from it, so existing Inertia consumers are
unaffected.

## 7. Config

```ts
defineConfig({
  validation: 'zod',           // 'zod' | 'valibot' | 'arktype' | ValidationAdapter
  query: false,                // false | true → @tanstack/query-core queryOptions/mutationOptions
  transformer: false,          // false | 'superjson'
  mutationClient: 'fetcher',   // 'fetcher' (plain) | 'inertia' (set by the preset)
  // existing: pages, contracts, scopes, codegen, app, fetcher, forms
})
```

- The Inertia preset's `defineConfig` defaults `mutationClient` to `'inertia'` and turns
  on page/shared-props discovery; the core default is `'fetcher'`.
- `forms.zodImport` generalizes to adapter-driven imports (the adapter owns its import).

## 8. Emit behavior changes

**api.ts**
- Query block emitted only when `query: true`; uses `@tanstack/query-core`
  (`queryOptions`/`mutationOptions`), dropping the hardcoded `@tanstack/react-query`.
- Mutations: `mutationClient: 'fetcher'` → call the runtime `fetcher`;
  `'inertia'` → keep `import { router } from '@inertiajs/react'`. The Inertia import is
  emitted only in inertia mode.
- `transformer: 'superjson'` → fetcher is created/imported with the superjson transform;
  response types preserve rich types.

**forms.ts**
- `dto-to-zod` → `dto-to-ir` produces `SchemaNode`. `emit-forms` renders via the active
  `ValidationAdapter`. With `validation: 'zod'` the output is byte-compatible with today.

**emit-index.ts**
- `export * from './pages.js'` becomes a contribution of the inertia preset's emitter set
  rather than a hardcoded line.

## 9. Decomposition (ordered sub-projects)

Each sub-project gets its own spec → plan → implementation cycle.

1. **IR + ValidationAdapter abstraction** *(foundation, no package split yet)*
   - Add `SchemaNode`/`SchemaModule` IR. Refactor `dto-to-zod.ts` → `dto-to-ir.ts`.
   - Define `ValidationAdapter`; implement the zod adapter in-tree.
   - Make `emit-forms.ts` (and the form-schema parts of `emit-api.ts`) adapter-driven.
   - **Invariant:** with `validation: 'zod'`, generated output is unchanged (golden tests).

2. **Package split: core + inertia preset**
   - Extract `@dudousxd/nestjs-codegen` (generic). Move Inertia discovery/emit + the
     inertia mutation mode into `@dudousxd/nestjs-inertia-codegen` (preset on core).
   - Source/emitter registry; CLI/config plumbing; adapter dynamic-import resolution.

3. **Neutral runtime + query-agnostic + plain-mode mutations + superjson**
   - Extract `@dudousxd/nestjs-client`; `nestjs-inertia-client` re-exports it.
   - `emit-api.ts`: `mutationClient` modes, `query` opt-in via `@tanstack/query-core`,
     `transformer: 'superjson'` wiring.

4. **valibot + arktype adapters** *(separate packages)*
   - `@dudousxd/nestjs-codegen-valibot`, `@dudousxd/nestjs-codegen-arktype`, each
     implementing `ValidationAdapter.render` against the shared `SchemaNode` IR + golden
     tests per lib.

**First sub-project to spec in full: #1 (IR + ValidationAdapter abstraction)** — every
other piece depends on the IR and the adapter interface, and it is the lowest-risk slice
(pure refactor with a behavior-preservation invariant).

## 10. Risks & open questions

- **dto-to-zod fidelity:** moving from "decorators → zod text" to "decorators → IR →
  zod text" must preserve all current refinements. Mitigate with golden snapshot tests
  captured before the refactor.
- **defineContract zod-AST → IR:** contracts are hand-written zod; parsing arbitrary zod
  back into the IR is lossy for exotic schemas. Fallback: `kind: 'unknown'` keeps the
  original text verbatim for the zod adapter (perfect parity) and emits a warning for
  non-zod adapters that cannot translate it.
- **arktype/valibot coverage:** some zod refinements have no 1:1 mapping; adapters emit a
  documented best-effort + warning rather than failing the build.
