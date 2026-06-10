# Design Spec — Codegen Extension/Plugin System

Status: Design (approved direction, pending spec review)
Date: 2026-06-10
Scope: turn `@dudousxd/nestjs-codegen` into a host with a **published, versioned
extension contract**, and move Inertia / nestjs-filter / TanStack integrations OUT of
core into extension packages that live with each library.

Supersedes the "three flag axes" framing in
`2026-06-10-nestjs-codegen-extensible-architecture-design.md` for everything related to
Inertia, filter, and TanStack. The validation-adapter axis (zod/valibot/arktype) is
unchanged and orthogonal to this spec.

---

## 0. Goal

Today the core hardcodes three integrations: TanStack Query (the `query` flag), Inertia
(`mutationClient: 'inertia'` → `@inertiajs/react` import + `navigate()`), and nestjs-filter
(`filterFields` discovery + `TypedFilterQuery` emit + `filterQuery` leaf member). The goal:

- **Core becomes integration-agnostic.** No knowledge of Inertia, filter, or TanStack.
- **Extensions are explicit and installable.** `forRoot({ extensions: [nestjsInertiaCodegen()] })`.
- **Each integration's codegen lives with its library:**
  - Inertia → repurpose existing `@dudousxd/nestjs-inertia-codegen` (in `nestjs-inertia` repo).
  - Filter → new `@dudousxd/nestjs-filter-codegen` (in `nestjs-filter` repo).
  - TanStack → `@dudousxd/nestjs-codegen-tanstack` (in THIS repo — TanStack is not our lib).
- **The extension API is a published contract** exported from `@dudousxd/nestjs-codegen/extension`.
  Extensions in other repos compile against it; it is semver-bound to core (0.x = unstable).

### Locked decisions (from discussion 2026-06-10)
1. Full hooks ("completos"), not additive-only — core minimal, leaf-decorator required.
2. Explicit registration via `extensions: [...]` (no auto-detect in v1). Rationale: we
   dogfood our own extensions, and explicit is predictable/versionable (Vite/ESLint model).
3. Extensions live in each lib's repo (above). TanStack is the exception → codegen repo.
4. Extension contract is published from core at subpath `/extension`.
5. First dogfood = TanStack (in-repo, lowest risk), then filter, then Inertia.

---

## 1. The Extension contract

A `CodegenExtension` is a **build-time** object (usually returned by a factory so it can
take options). Hooks split into **multi** (every extension runs; results accumulate or
chain) and **single-slot** (at most one extension may claim it; two = hard error).

```ts
// exported from @dudousxd/nestjs-codegen/extension
export interface CodegenExtension {
  /** Unique id. Used in conflict/collision errors and deterministic ordering. */
  name: string;

  // ── multi hooks ───────────────────────────────────────────────
  /** Mutate/augment the IR before emit. Runs in registration order, chained.
   *  e.g. filter attaches `filterFields` to matching routes here. */
  transformRoutes?(routes: RouteDescriptor[], ctx: ExtensionContext): RouteDescriptor[] | void;

  /** Contribute extra output files (additive). Name collisions across extensions = error.
   *  e.g. Inertia emits `pages.d.ts` + `components.json` (does its own page discovery
   *  via ctx.project). */
  emitFiles?(ctx: ExtensionContext): EmittedFile[] | Promise<EmittedFile[]>;

  /** Contribute top-level code to `api.ts` (imports + statements). Runs in order.
   *  e.g. Inertia adds `import { router } from '@inertiajs/react'` + the `navigate()` helper. */
  apiHeader?(ctx: ExtensionContext): ApiHeaderContribution | void;

  /** Add named members to a HANDLE leaf (only present when a client layer is active).
   *  e.g. filter adds `filterQuery` to leaves whose route has `filterFields`. */
  apiMembers?(leaf: LeafModel, ctx: ExtensionContext): Record<string, string> | void;

  // ── single-slot hooks ─────────────────────────────────────────
  /** Claims HOW a single endpoint issues its request. Default (no claimer) = the
   *  neutral fetcher. e.g. Inertia routes mutations through the Inertia router; GETs
   *  stay fetcher-typed. */
  apiTransport?: ApiTransport;

  /** Claims WHAT a leaf returns. Default (no claimer) = a bare callable returning a
   *  Promise. e.g. TanStack wraps each leaf into a handle exposing
   *  `{ fetch, queryKey, queryOptions | mutationOptions }`. */
  apiClientLayer?: ApiClientLayer;
}

export interface ExtensionContext {
  cwd: string;
  outDir: string;
  routes: readonly RouteDescriptor[];
  config: ResolvedConfig;
  /** Lazily-created shared ts-morph Project for AST work (pages, decorators). */
  project(): import('ts-morph').Project;
}

export interface EmittedFile {
  /** Path relative to outDir. Collision across extensions throws. */
  path: string;
  contents: string;
}

export interface ApiHeaderContribution {
  imports?: string[];     // raw import lines, deduped by the host
  statements?: string[];  // top-level statements (e.g. the navigate() helper)
}

export interface ApiTransport {
  name: string;
  /** Render the expression that issues this endpoint's request, e.g.
   *  `fetcher.get<Res>(url, opts)` or `router.visit(url, ...)`. */
  renderRequest(leaf: LeafModel, ctx: ExtensionContext): string;
  imports?: string[];
  helpers?: string[]; // module-level helpers the rendered expr depends on
}

export interface ApiClientLayer {
  name: string;
  /** Given the request expression (from the transport), return the handle's members.
   *  Returning members flips the leaf from bare-callable to a handle. */
  buildMembers(requestExpr: string, leaf: LeafModel, ctx: ExtensionContext): Record<string, string>;
  imports?: string[];
  helpers?: string[];
}
```

`defineExtension(ext)` is exported as an identity helper for inference.

---

## 2. The LeafModel + api.ts rendering pipeline

The crux of "completos" is that `emit-api.ts` stops emitting leaf strings directly and
instead builds a **LeafModel** per route, runs the pipeline, then renders.

```ts
export interface RequestModel {
  routeName: string;                 // 'users.show'
  method: 'get'|'post'|'put'|'patch'|'delete';
  isGet: boolean; hasParams: boolean; hasBody: boolean;
  inputType: string;                 // '{ params: TA["params"]; query?: TA["query"] }' | 'Record<string, never>'
  urlExpr: string;                   // `route('users.show', input?.params) || '/api/users/:id'`
  optsExpr: string;                  // `{ query: ... }` | `{ body: input?.body }`
  responseType: string;              // `TA['response']`
}

export interface LeafModel {
  route: RouteDescriptor;
  request: RequestModel;
  /** Set by the transport (default fetcher). */
  requestExpr: string;
  /** Set by the layer + member contributors. When present, the leaf renders as a handle. */
  members?: Record<string, string>;
}
```

**Pipeline per leaf** (deterministic order):
1. Core builds `RequestModel` + `inputType` (existing logic, extracted).
2. **Transport** (resolved single-slot, default = fetcher) sets `leaf.requestExpr`.
3. **Layer** (resolved single-slot, default = none) — if present, `leaf.members = buildMembers(requestExpr, …)`.
4. **Member contributors** (`apiMembers`, multi) — only run when `leaf.members` exists;
   merged in, member-name collisions across extensions = error.
5. **Render:**
   - `members` present → `name: (input?: Input) => ({ ...members }),`
   - else → `name: (input?: Input) => requestExpr,`

This reproduces **both** current shapes exactly:
- No layer → bare callable returning `Promise` (today's `query: false`).
- TanStack layer → handle with `fetch`/`queryKey`/`queryOptions`/`mutationOptions` (today's `query: true`).
- Filter `apiMembers` → `filterQuery` member on handle leaves with `filterFields` (today's filterQuery).

### Default transport (bundled in core)
The neutral fetcher transport stays in core as the **default** (no extension needed for a
plain typed client). It renders `fetcher.<method><Res>(url, opts)` and imports the `Fetcher`
type from `@dudousxd/nestjs-client`. It is NOT a registered extension — it's the fallback.

---

## 3. Conflict & error model

- **Two transports / two layers claimed** → `CodegenError`:
  `api transport claimed by both "<a>" and "<b>" — only one extension may set apiTransport`.
- **emitFiles path collision** → error listing the two extensions + the path.
- **apiMembers name collision** → error listing the member + the two extensions.
- **Unknown member on non-handle leaf** → silently skipped (member contributors only run
  on handle leaves), documented as a known constraint (filterQuery requires a client layer).
- Multi-hook order = registration (array) order, so output is deterministic.

---

## 4. generate() flow (new)

```
discoverContractsFast(...) ──► routes
        │
        ▼
resolveExtensions(config.extensions)              // validate single-slot conflicts up front
        │
        ▼
routes = ext.transformRoutes(routes) chained      // filter attaches filterFields
        │
        ├─► emitRoutes(routes)                     // core, unchanged
        ├─► emitForms(routes, validationAdapter)   // core, unchanged
        ├─► emitApi(routes, { transport, layer, members[], headers[] })  // LeafModel pipeline
        ├─► for ext: collect ext.emitFiles(ctx)    // accumulate, collision-check, write
        └─► emitIndex(...)                          // core, aware of extra files
```

`pages` discovery + `shared-props` + `components.json` move entirely into the Inertia
extension's `transformRoutes`/`emitFiles`. Core's `generate()` loses its `if (config.pages)`
branch.

---

## 5. Config / module wiring & migration

- `UserConfig` (and therefore `forRoot` options) gains `extensions?: CodegenExtension[]`.
- **Removed from core:** `query`, `mutationClient`. `queryImport` moves into the TanStack
  extension's options.
  - `query: true`            → `extensions: [tanstackQuery()]`
  - `mutationClient:'inertia'`→ `extensions: [nestjsInertiaCodegen()]`
  - `queryImport: '@tanstack/vue-query'` → `tanstackQuery({ import: '@tanstack/vue-query' })`
- Migration: since nothing is published yet and `query` is brand-new, **hard cut** (no
  deprecated aliases). Docs + the changeset call it out.

Example consumer:

```ts
import { NestjsCodegenModule } from '@dudousxd/nestjs-codegen/nest';
import { tanstackQuery } from '@dudousxd/nestjs-codegen-tanstack';
import { nestjsInertiaCodegen } from '@dudousxd/nestjs-inertia-codegen';

NestjsCodegenModule.forRoot({
  contracts: { glob: 'src/**/*.controller.ts' },
  codegen: { outDir: 'src/generated' },
  extensions: [nestjsInertiaCodegen(), tanstackQuery()],
});
```

---

## 6. Staging (each phase keeps the suite green)

**Phase 0 — Contract (codegen repo).** Define `CodegenExtension` + `LeafModel` +
contexts + `defineExtension`; export from `/extension`; tsup entry + package export. No
behavior change. Type-level tests.

**Phase 1 — LeafModel refactor (codegen repo).** Rewrite `emit-api.ts` to build LeafModels
and render from them, with the current TanStack/Inertia/filter behavior reimplemented as
**internal** transport/layer/member implementations driven by the still-present `query`/
`mutationClient` flags. **Golden gate: byte-identical output** for every existing fixture.
De-risks the rewrite before any real extension exists.

**Phase 2 — Registry wiring (codegen repo).** Resolve `config.extensions`, run multi-hooks,
resolve single-slots, feed `emit-api`. Move pages/shared-props/filter discovery behind the
hook interfaces but keep them bundled-and-flag-driven so existing config still passes. Add
conflict/collision errors + tests.

**Phase 3 — Extract TanStack (codegen repo, FIRST DOGFOOD).** Create
`@dudousxd/nestjs-codegen-tanstack` consuming `/extension`. Remove `query`/`queryImport`
from core. Switch the repo's own tests/example to register the extension. Proves the
published contract end-to-end in-repo.

**Phase 4 — Extract filter (nestjs-filter repo).** `@dudousxd/nestjs-filter-codegen`
(mirrors `@dudousxd/nestjs-filter-client`). Remove filter discovery/emit from core.

**Phase 5 — Extract Inertia (nestjs-inertia repo).** Repurpose
`@dudousxd/nestjs-inertia-codegen` into the extension (transport + emitFiles + apiHeader/
navigate + pages/shared-props). Remove all Inertia code from core. **Core is now agnostic.**

This spec + the first implementation plan cover **Phases 0–3** (codegen repo). Phases 4–5
live in their own repos and get their own specs once the contract is published/linkable.

---

## 7. Cross-repo dogfood loop

Phases 4–5 build against the core's `/extension` contract. During development this means
linking the local core into `nestjs-filter` / `nestjs-inertia`. Known hazard: pnpm `file:`
deps break hardlinks on rebuild (see prior incident). Use a `pnpm` workspace link or the
`rsync` into `.pnpm` + restart workaround. The published contract (semver 0.x) is the
stable interface once releases flow.

---

## 8. Testing strategy

- **Phase 1 golden gate** is the linchpin: snapshot every current `api.ts`/`forms.ts`
  fixture BEFORE the refactor; assert byte-identical AFTER. No behavior may change.
- Unit tests for the registry: single-slot conflict, emitFiles collision, member collision,
  deterministic ordering.
- Per-extension tests live in each extension's package (tanstack in-repo; filter/inertia in
  their repos), each asserting the emitted output for representative routes.
- The existing 474 tests must stay green through Phases 0–2; Phase 3 updates the tests that
  asserted the `query` flag to instead register `tanstackQuery()`.

---

## 9. Risks & open questions

- **emit-api refactor risk.** ~726 lines, the most intricate emitter. Mitigated by the
  Phase 1 byte-identical golden gate (refactor with zero behavior change first).
- **Contract churn.** Getting `LeafModel`/`ApiTransport`/`ApiClientLayer` right matters —
  changing them later breaks out-of-repo extensions. Keep 0.x, iterate in-repo (tanstack)
  before committing other repos.
- **filterQuery depends on a layer.** A member contributor only fires on handle leaves, so
  `filterQuery` requires a client layer (e.g. TanStack). Matches today's behavior (filterQuery
  was `query`-gated), documented as a constraint. Open question: do we ever want a bare
  `filterQuery` helper without TanStack? Deferred.
- **Inertia GET vs mutation split.** The Inertia transport must render fetcher for GET and
  router for mutations — `renderRequest` sees `leaf.request.isGet`. Confirmed feasible.
- **Open: index.ts / `EmittedFile` awareness.** `emitIndex` must learn which extra files
  extensions produced so it can re-export/reference them. Spec leaves the exact index
  contract to the plan.
