# @dudousxd/nestjs-codegen

## 0.22.1

### Patch Changes

- da8ec39: Order routes by file path, so an unchanged source tree always generates the same client

  Route order decided the order of everything emitted from it — the groups in
  `api.ts`, the entries in `routes.ts` — and it was whatever order discovery
  happened to reach the files in. The cold path adds controllers in `fast-glob`'s
  directory-walk order, which is I/O-completion order from a concurrent walk: it
  holds while the FS cache is warm and can differ on a cold one, so regenerating
  an untouched project could move a controller group to a different position. The
  watcher appended each newly-created controller to the end of its set, so from
  the moment a file was added its output no longer matched a cold run's, for the
  rest of the session.

  Both extraction entry points now sort their roots by path. `discoverPages` has
  sorted its glob from the start, which is why only the controller-derived
  artifacts ever moved.

  Nothing about the generated client changes except the order of its blocks —
  same routes, same types, same members. Consumers who commit their generated
  directory should expect one reorder-only diff on the first run after upgrading.

## 0.22.0

### Minor Changes

- 4af626a: Hand extensions the tsconfig-seeded Project instead of making each build its own

  `ExtensionContext` gains `tsconfigProject()`: a lazily-created, memoized ts-morph
  `Project` built from the consumer's tsconfig (`app.tsconfig`, else
  `<cwd>/tsconfig.json`), so `paths` aliases resolve. `project()` is unchanged — it
  stays the bare, paths-less scratch project — and the two are now documented against
  each other.

  An extension that needs to follow a `@/api/...` import from a controller to the
  decorator target it reads had no way to get one, so it built its own from
  `tsConfigFilePath`. That has a trap: parsing a tsconfig also resolves its FILE LIST,
  and a tsconfig with no `include` walks the entire project root, so one unreadable
  directory (a docker bind mount a container chowned to its own UID) throws
  `EACCES ... scandir`. Every hand-rolled copy then fell back to a paths-less Project
  in silence, and aliased targets resolved to nothing with no error anywhere — the
  same bug, once per extension. The host now loads it correctly, once, and hands it
  out; N extensions share one parse instead of one each.

  Typed as optional (`tsconfigProject?()`) on purpose: an extension may run against an
  older host that does not provide it, so the ecosystem pattern is
  `ctx.tsconfigProject?.() ?? <own fallback>`.

## 0.21.1

### Patch Changes

- da3c66c: Load the consumer tsconfig without walking their file tree, and stop falling back from it in silence

  `createDiscoveryProject` handed `tsConfigFilePath` to ts-morph and wrapped the
  call in a bare `try/catch` that, on ANY error, rebuilt the `Project` with no
  tsconfig at all. Both halves of that were a problem.

  Parsing a tsconfig also resolves its FILE LIST, and a tsconfig with no `include`
  defaults to `**/*` — so TypeScript walks every directory under the project root.
  One directory the codegen process cannot read is enough to throw
  `EACCES: permission denied, scandir ...` and take the whole tsconfig down with
  it; a docker bind mount that a container has chowned to its own UID with
  mode-700 subdirs (Grafana, Prometheus, MinIO, a DB data dir) is exactly that
  shape. `skipAddingFilesFromTsConfig` did not help, because it discards the file
  list only after it has been computed.

  Discovery never wanted that list — only `paths`/`baseUrl`/`target`/decorator
  flags — so the tsconfig is now read through `ts.readConfigFile` +
  `ts.parseJsonConfigFileContent` with a host whose `readDirectory` returns
  nothing, and the parsed options are passed to `new Project({ compilerOptions })`.
  No directory is read, so no unreadable one can matter. `extends` still resolves,
  and passing the parsed options through wholesale preserves TypeScript's
  `pathsBasePath` (how `paths` resolves when the tsconfig sets no `baseUrl`).

  The silent fallback is what made this expensive to diagnose. A `Project` with no
  tsconfig has no `paths`, and go-to-definition is how a factory-based controller
  (`class X extends createTableController(...)`) is resolved — so an
  alias-imported factory stops resolving and every route those controllers
  contribute disappears from the generated client. The only output was the
  per-controller `contributes NO routes` warning, which blames the controller. A
  tsconfig that exists but cannot be loaded now warns once, naming the tsconfig,
  the underlying error and what it costs. A MISSING tsconfig stays silent: relative
  imports need no `paths`, so a tsconfig-less consumer is a supported setup.

  Measured against a real consumer with one unreadable directory in its root:
  313 routes and 0 factory-derived routes with 22 `contributes NO routes`
  warnings, versus 357 routes and 44 factory-derived routes with none.

  Also folds the tsconfig into the generate manifest's input hash. The freshness
  check ("up to date, skipped") did not cover it, so a tsconfig that made discovery
  generate a WRONG artifact left that artifact on disk after the tsconfig was
  fixed, and every later run skipped over it — the only way out was deleting
  `.codegen-manifest.json` by hand. Raw contents are hashed rather than the
  resolved options, because `include`/`exclude` are not compiler options and an
  added `exclude` is exactly what such a fix tends to be. The whole `extends` chain
  is hashed, not just the entry file, since that is where a shared `paths` block
  usually lives.

  Two things follow from loading the tsconfig properly, both previously wrong in the
  same direction — an alias that silently resolved to nothing:

  - `paths` now come from that single load, so a mapping declared in a tsconfig
    reached through `extends` is finally seen. The old reader parsed the entry
    file's raw JSON itself, so it saw neither `extends` nor block comments, and it
    could disagree with the options the `Project` was built from.
  - Those mappings resolve the way `tsc` resolves them — against `baseUrl` when
    set, else against the directory of the file that DECLARED them (TypeScript's
    `pathsBasePath`). They were resolved against the project root, which is not the
    same directory for a `paths` block inherited from `config/base.json`, or for a
    `baseUrl` of `./src`.

## 0.21.0

### Minor Changes

- 71b4485: Tell an overridden route from an inherited one by the class it is declared on, not by its file

  `extractApplyFilterInfo` decided whether a route was the controller's OWN by
  comparing the method's file to the factory's (`declFile !== mixin.factoryFilePath`).
  That is a proxy for the real question, and it breaks on the one shape where the
  two come apart: a controller factory declared in the SAME file as a controller
  that calls it. There, a genuine override reads as inherited, its
  `@ApplyFilter(SomeFilter)` is mistaken for the factory talking about itself, and
  the factory's `filter` option silently outranks the filter the override names —
  typing the route against a filter the runtime does not use.

  `extractDtoContract` now takes the `@Controller` class the route was discovered
  on and passes it down, so the check is `method.getParent() === controllerClass`:
  the ground truth the discovery pass already computed when it merged own and
  inherited methods. The parameter is optional — omitting it degrades to the
  previous file comparison, so an external caller of the exported
  `extractDtoContract` keeps working unchanged.

  This also settles a disagreement between packages. `@dudousxd/nestjs-filter-codegen`
  asks the same question via `controllerClass.getMethod(name)` and was already
  right about the colocated case; the two have to agree on what an override IS, not
  merely on how to rank one, or the same route ends up described twice, differently.

## 0.20.0

### Minor Changes

- f8da873: Describe a table's routes with the filter its factory was HANDED, not the one it
  generated.

  A factory given a hand-written filter through an option —
  `createTableController({ entity: Wo, filter: WoFilter })` — applies `WoFilter` to
  every route it produces, but the decorators inside the factory body can only name
  the fallback it generates internally (`@ApplyFilter(GeneratedFilter)`; the
  supplied class exists only at the call site). Discovery read that decorator
  argument and nothing else, so everything emitted for those routes came from the
  fallback:

  - the hand-written filter's `@FilterFor` virtual fields were **absent** from the
    client — filtering by them does not type-check, though the server accepts them;
  - a filter that NARROWS with `allowed` was typed with the fallback's **wider**
    entity-derived field set — the client is told it may filter by fields the
    server will reject, which type-checks at the call site and fails at runtime.

  The route's mixin binding already carried the call-site `filter` class. It is now
  consulted, in this precedence (first candidate that yields a readable field set
  wins):

  1. a filter named BY IDENTIFIER in the route's own `@ApplyFilter(SomeFilter)` —
     an overriding method is the only place a per-route statement can be made;
  2. the factory's `filter` option;
  3. the existing walk — `@ApplyFilter(<Const>.filter)` through the factory static,
     a lexically-scoped local class, then a module-level lookup.

  `@ApplyFilter(<Const>.filter)` sits below (2) deliberately, matching
  `@dudousxd/nestjs-filter-codegen`: it forwards the factory's product rather than
  naming a filter of its own, so statically it always lands on the generated
  fallback.

  Two consequences follow:

  - **`allowed` / `blocked` now narrow the emitted field set.** They gate exactly
    the auto-field set, so they are applied to the entity-derived fields;
    `@FilterFor` keys are appended afterwards, as the runtime resolves an explicit
    handler without consulting `allowed`.
  - **A hand-written filter's own `@Filterable({ entity })` wins** over the
    factory's call-site entity. The call-site entity is a repair for a GENERATED
    filter, whose `entity` names the factory's parameter and resolves to nothing; a
    hand-written filter names a real class, and that is the class the runtime
    queries. It stays a fallback for when the declared entity does not resolve.

  Nothing gets worse: a candidate that resolves but reads as empty (no properties,
  no `@Filterable`, no `@FilterFor`) is skipped rather than returned, so an opaque
  call-site filter degrades to today's result instead of to `filterFields: never`.

## 0.19.0

### Minor Changes

- 8ffea16: Discover controller factories called through a property, and warn — loudly —
  when a factory heritage clause cannot be followed at all.

  A controller whose base came from anything other than a bare function name
  contributed ZERO routes to the generated client:

  ```ts
  class A extends tables.createTableController(Entity, {}) {} // namespace import
  class B extends TableFactory.create(Entity, {}) {} // static method
  class C extends factories.table(Entity, {}) {} // re-export object
  ```

  Discovery required the callee of the factory call to be an `Identifier`, so each
  of these resolved to nothing — and unlike the earlier filter gaps, this does not
  mutilate a route's contract, it deletes the whole controller. `tsc` green,
  codegen green, no warning: the first sign is a client call that does not exist.

  The callee is now resolved through its name node, which covers a namespace import
  (`ns.factory(...)`), a static method (`Factory.create(...)`) and a property of a
  re-export object (`factories.table(...)`, including the `{ createTableController }`
  shorthand). Bare identifiers are unchanged. A callee with no name node — an
  element access (`factories['table'](...)`) or a callee that is itself a call
  (`makeFactory()(Entity)`) — would mean evaluating the program to name the
  function, so it stays unresolved.

  Unresolved is no longer silent. A `@Controller`-decorated class whose heritage is
  a factory-shaped CALL that discovery cannot follow now prints one line naming the
  file, the class, the callee and what it costs:

  ```
  [nestjs-codegen/fast] SearchUtilsController in /src/utils/search.controller.ts
  extends makeTableController()(...) but its callee is not a name that can be
  resolved statically — it contributes NO routes to the generated client.
  ```

  Scoped tightly on purpose: it is a warning and never a throw, and it stays quiet
  for `extends SomeBaseClass` (not a call) and for any class without `@Controller`
  (extending a call expression is ordinary code). So the next unsupported shape
  costs a line on stderr instead of a day.

  `MixinBinding.factoryName` now carries the resolved DECLARATION's name rather
  than the call-site text — a qualified `tables.createTableController` would never
  match the by-name lookup consumers do inside `factoryFilePath`. Identical for
  every existing bare-identifier call site, bar an import alias, where the
  declaration name is the one that resolves.

## 0.18.0

### Minor Changes

- 553e503: Resolve the entity of a controller factory called with a single options object.

  `class X extends createTableController({ entity: Util, dto: UtilDTO })` emitted
  every one of its routes with `body: never` and `filterFields: never` — the typed
  filter builder gone from the client, with `tsc` and codegen both green. Only the
  positional form (`createTableController(Util, { dto })`) worked: discovery
  collected call-site classes by scanning for identifier ARGUMENTS, and an object
  literal is not one, so the entity behind the factory's generated
  `@Filterable({ entity })` was unresolvable. Measured downstream at 22 tables
  losing their filter builder at once.

  Class-valued properties of an options-object argument are now collected too,
  keyed by property name, and the entity resolver prefers a named `entity` over the
  first positional argument. Both call forms work, so a codebase can migrate table
  by table.

  `MixinBinding` gains `namedClassArgs: Record<string, { name, filePath }>`
  alongside the unchanged positional `classArgs`. The key is what identifies an
  argument's role once there is no positional order to read it from, and consumers
  want different properties: this package resolves `entity`, while
  `@dudousxd/nestjs-filter-codegen` reads `filter` off the same binding.

## 0.17.2

### Patch Changes

- fcf816e: Resolve `@ApplyFilter(<Table>.filter)` on overridden mixin routes.

  A controller that extends a factory-produced base and overrides one of its
  routes has to re-declare `@ApplyFilter`, and the only handle on the filter the
  factory generated internally is the static it hands back — a property access,
  not an importable identifier. Discovery accepted identifiers only, so it skipped
  the decorator entirely.

  The failure was silent and total rather than partial: the route emitted with
  `body: never` and `filterFields: never`, dropping the typed filter builder from
  exactly the routes that took the override escape hatch, while `tsc` and codegen
  both stayed green. It only surfaced downstream, as a client call that could no
  longer be typed.

  Such a property access is now resolved through the factory — const → factory
  call → returned class → static property → the class declared in the factory
  body.

## 0.17.1

### Patch Changes

- Support mixin controllers that OVERRIDE an inherited route.

  Two gaps made the override pattern undiscoverable, so a subclass that customised
  one route silently lost every route it did not override:

  - **Heritage by identifier.** Discovery required a literal call expression
    (`extends factory(Entity)`). But an override has to name the factory's products
    in its own decorators (e.g. `@ApplyFilter(SomeTable.filter)`) and cannot
    reference itself at decoration time, so the factory call must be bound to a
    const first — `extends SomeTable`. That form now resolves through the const's
    initialiser.
  - **Override deduplication.** The derived class's own method now shadows the
    inherited one of the same name. Emitting both produced two routes with the same
    name (tripping the collision check); dropping the inherited siblings would have
    lost the routes the subclass left alone.

  An overriding method also keeps the route's mixin binding, so its `filterFields`
  still resolve from the call-site entity.

## 0.17.0

### Minor Changes

- abe5172: Extensions can declare input files the host's globs don't cover, via `ExtensionContext.trackInput`.

  The skip-when-unchanged hash is built from `contracts.glob`, `forms.watch` and `pages.glob`. An extension that reads outside them therefore produced output that nothing could invalidate: `@dudousxd/nestjs-filter-codegen` resolves each route's `@ApplyFilter(FilterClass)` target and turns its `@Computed` / `@Filterable({ computed })` declarations into `filterFields` entries, but a filter class matches none of those globs — so editing one left the hash untouched and the next run reported "up to date, skipped" while serving stale types. The only way out was deleting `outDir`.

  Extensions like that cannot declare their inputs up front (they need the discovered routes to know which files to read), so this works like a compiler depfile instead: paths reported during a run are recorded in the manifest as `extraInputs`, and the next run folds their contents into the hash. A file that becomes a dependency for the first time is picked up on the run after it is first read — in practice not a gap, since wiring a new filter class also edits a controller, which the globs already cover.

  Deleting a tracked file invalidates too (it hashes as a `missing` marker rather than throwing), and a tracked path a glob already covers is hashed once, not twice.

  Purely additive for existing extensions. `trackInput` is a no-op on the standalone `emitApi` path, which writes no manifest.

## 0.16.0

### Minor Changes

- Discover routes on mixin (factory-produced) controllers.

  A `@Controller` class whose heritage clause is a factory call now contributes the
  decorated methods of the class that factory returns:

  ```ts
  @Controller("base/util/search")
  export class SearchUtilController extends createTableController(Util, {
    dto: UtilDTO,
  }) {}
  ```

  NestJS already routes inherited methods at runtime via the prototype chain; the
  static discovery pass now follows the same link. Each such route carries a new
  `controllerRef.mixin` binding recording the factory and its call-site class
  arguments — the decorator arguments _inside_ a factory reference its own
  parameters, so the concrete entity is only knowable from the call site.

  That binding drives two things:

  - **`filterFields`** are derived from the call-site entity, so
    `@ApplyFilter(GeneratedFilter)` works even though the filter class is declared
    inside the factory and its `@Filterable({ entity })` names a parameter. This is
    also what flips these routes from mutation to query in the emitted client.
  - **Response types** are instantiated against the derived class, so
    `Paginated<D>` resolves to the concrete `D`. This needs the type checker, which
    needs lib files — the discovery Project sets `skipLoadingLibFiles` for
    cold-start speed, so mixin response types resolve through a second Project
    built lazily on the first mixin controller.

  **Behaviour change:** `joinPaths` now always emits a leading slash.
  `@Controller('items')` + `@Post(':id')` previously produced `items/:id` while
  `@Controller('items')` alone produced `/items` — the prefix+suffix branch was the
  only one that did not add it. The client's `buildUrl()` normalises before
  requesting, so no URL was ever broken by this, but the raw value reaches the
  emitted `ROUTES` map and the OpenAPI export, where a path without a leading slash
  is invalid.

## 0.15.0

### Minor Changes

- 20db5c0: Emit `filterFields` as a runtime `as const` array on each filter leaf, alongside the existing type-level union, plus an `isFilterField` type guard exported from the generated `api.ts`. Previously the filterable field set existed only as a type, so a field name arriving as a plain `string` from runtime state (a saved view, a user-picked column) could not be passed to `filterQuery().where()` without a cast. Now `api.route.leaf().filterFields` is a `readonly [...] as const` value and `isFilterField(leaf.filterFields, value)` narrows an arbitrary string to the field union, so dynamic field names validate at runtime instead of being asserted with `as`. The runtime array is generated from the same discovered field list as the type-level union (single source in the emitter), so the value can never drift from the type. Purely additive — the guard is emitted only when a route carries filter fields, and leaves without a filter gain no new member.
- 9b5298b: Add a `@QueryList()` param decorator and a `toStringList` normalizer to the `/nest` subpath for receiving array query params safely. Express (and Nest's default query parser) returns a bare `string` for a single-value query param (`?ids=a`) and a `string[]` only for two or more (`?ids=a&ids=b`), so `ParseArrayPipe` 400s the common single-select case. `@QueryList('ids')` normalizes `string | string[] | comma-joined string | undefined` into a clean `string[]` (`['a']`, `['a','b']`, `[]`), and `toStringList` is exported for the equivalent `class-transformer` `@Transform` on a DTO field. Pairs with the client's `arrayFormat` option: once the client sends `arrayFormat: 'repeat'`, the comma-split becomes a no-op fallback that still covers hand-rolled and `curl` callers. Documented under a new "Receiving array query params" docs page.

## 0.14.2

### Patch Changes

- 79d5e73: Fix a drift-guard false positive that permanently blocked incremental regeneration for shared configs: the config hash folded functions in via `toString()`, but the same shared config object yields different function source text per entry point (the CLI loads TS via Node's type stripping; the Nest module runs tsc/SWC-compiled dist), so a genuinely-shared config was flagged as drifted the moment both entry points touched the same outDir. Functions now hash by name only — every setting that can actually diverge is plain data and is still hashed in full. The drift error also now NAMES the top-level keys that differ (via new per-key hashes recorded in the manifest as `configKeyHashes`) instead of a generic example.

## 0.14.1

### Patch Changes

- 093f3d5: A bare `@UploadedFile()` route (no `@Body()` DTO) now emits a working multipart leaf.
  `requestShape().hasBody` ignored `multipart`, so while the ApiRouter TYPE promised
  `body: { file: File | Blob }` (the multipart intersection), the generated call accepted no
  body and sent no file. `multipart` now implies a body; routes with a `@Body()` DTO were
  already correct.

## 0.14.0

### Minor Changes

- fc78a39: feat: binary (blob) response mode, `@AsQuery()` marker, CLI↔module config-drift guard, and a `handleQuery` TanStack helper.

  - **Binary (blob) response mode.** A handler returning NestJS `StreamableFile` or Node `Buffer`
    (including `Promise<StreamableFile>`) is now discovered as `binaryResponse: true` and emitted
    with `response: RawResponse<Blob>` (never `Jsonify<...>`) — the leaf issues its request via
    `fetcher.fetchBlob(...)` instead of the verb method, so callers get `{ data, status, headers }`
    and can read `content-disposition` etc. Works on any HTTP method (`fetchBlob` already accepted
    a `method` opt); a non-GET binary route passes it explicitly since `fetchBlob` defaults to GET.
    `Observable`/`ReadableStream` handlers are unaffected — they stay on the existing SSE/stream
    path. Each `ApiRouter` leaf now also carries a `binary` flag (`Route.Binary<K>` /
    `Path.Binary<M, U>` type helpers), mirroring `stream`.
  - **`@AsQuery()` marker** (new `@dudousxd/nestjs-codegen/markers` subpath — zero-import, runtime
    no-op). Marks a non-GET route whose semantics are a read (e.g. a POST with a query-shaped
    payload) so codegen emits `queryOptions` for it, exactly like a GET or a filter-search route.
  - **CLI↔module config-drift guard.** The CLI (`nestjs-codegen.config.ts`) and the Nest module
    (`NestjsCodegenModule.forRoot()`) can target the same `outDir` from independently-resolved
    configs; if they genuinely differ (e.g. `serialization` `'json'` vs `'superjson'`), each run
    used to silently overwrite the other's `api.ts` shape. `generate()` now throws a
    `DriftGuardError` _before writing anything_ when the manifest's `entryPoint` differs from the
    current run's AND the resolved configs' hashes differ — naming both entry points and
    instructing how to fix it (share one config object, or set `driftGuard: false`). Same entry
    point (a normal config edit) or same config across entry points both proceed as before.
  - **TanStack: `handleQuery` helper**, emitted into `api.ts` whenever the TanStack layer is
    active. Wraps any `{ queryKey, fetch }`-shaped handle (a POST-as-query handle, or a runtime
    pick between two different handles) into a plain `{ queryKey, queryFn }` pair — solves the
    useQuery-overload break from spreading a ternary of `queryOptions()` calls. Also: binary GET
    routes get `queryOptions` but never `infiniteQueryOptions` (a download isn't paginated data).

## 0.13.2

### Patch Changes

- 889af1f: Resolve the members of an inline object-literal type (`{ a: Foo; b: Bar }`) in response/stream types instead of emitting the node's raw text. A named type nested in an object literal — most commonly an SSE payload's `Observable<{ data: SomeType }>`, where `SomeType` is imported from another package — was previously copied verbatim, leaving a bare, unimported identifier that is undefined in the generated file. Each member's type is now resolved (expanded inline, or reduced to `unknown` when unresolvable) like any other named reference.

## 0.13.1

### Patch Changes

- 6b51c7b: fix(multipart): intersect the uploaded-file field at emit time so it survives a named `bodyRef`, and leave deliberately-loose bodies untouched.

  Two fixes to the multipart upload routes shipped in 0.13.0:

  - **Named body refs now include the file field.** Discovery carries the uploaded-file
    field(s) in a new `multipartBody` (kept off `body`), and the emitter intersects it onto
    whichever body expression it picks — a named `bodyRef` (`BaseFileUploadDto`) or the inline
    text. Previously the merge lived on the inline `body` string, so a route whose `@Body`
    resolved to an imported DTO emitted the plain `BaseFileUploadDto` and dropped the file
    field (`api.X({ body: { ...fields, file } })` failed to type-check).

  - **Deliberately-loose bodies are left alone.** A `@Body() x: SomeDto | any` handler resolves
    to a top-level `unknown`/`any` union arm; intersecting `(Dto | unknown) & { file }` collapses
    it and wrongly tightens the type. The emitter now detects a permissive body and skips the
    intersection, keeping the author's loose `@Body()` (the route is still flagged `multipart`).

## 0.13.0

### Minor Changes

- a044e73: feat: typed `multipart/form-data` upload routes (`@UploadedFile()` / Multer interceptors).

  The codegen now understands handlers that accept uploaded files, so multipart uploads
  become first-class typed routes (`api.X({ body: { ...fields, file } })`) instead of
  needing the `fetchRaw` escape hatch.

  **core (`@dudousxd/nestjs-codegen`):**

  - Discovery detects `@UploadedFile()` / `@UploadedFiles()` handlers and reads the HTTP
    field name(s) + arity from the Multer interceptor in `@UseInterceptors(...)`:
    - `FileInterceptor('file')` → `file: File | Blob`
    - `FilesInterceptor('files')` → `files: Array<File | Blob>`
    - `FileFieldsInterceptor([{ name: 'a' }, { name: 'b' }])` → `a: Array<File | Blob>; b: Array<File | Blob>`
    - `AnyFilesInterceptor()` → flagged multipart (no statically known field names)
  - The uploaded-file field(s) are merged into the route `body` as an intersection with the
    `@Body` DTO (`SomeDto & { file: File | Blob }`), typed for the browser as `File | Blob`
    (never the server-side `Express.Multer.File`).
  - The route carries a new `multipart` flag, emitted into the generated client so the call
    passes `multipart: true` to the fetcher.

  **client (`@dudousxd/nestjs-client`):**

  - `RequestOpts` gains `multipart?: boolean`. When set, the fetcher serializes the body
    object to a `FormData` (scalars as strings, `Date` as ISO, `File`/`Blob` as file parts,
    arrays as repeated parts) instead of JSON, letting the runtime set the multipart
    boundary. `onUploadProgress` already rides the same path.

## 0.12.0

### Minor Changes

- 5a2619c: perf(core): make the boot-time watcher production-safe, non-blocking, and idempotent.

  Three changes to the `NestjsCodegenModule` `onApplicationBootstrap` path so dev-watch
  restarts no longer pay the full codegen cost on time-to-ready:

  - **Skip in production.** `NODE_ENV` is now normalized (trimmed + lowercased) before the
    production check, and the watcher is skipped with a single concise log line when it is
    `production`. A new `runInProduction?: boolean` option (default `false`) forces it on if
    ever needed; explicit `enabled` still overrides both.

  - **Non-blocking boot.** The initial discover + generate triggered by
    `onApplicationBootstrap` now runs fire-and-forget (`watch(config, undefined, { deferInitialGenerate: true })`)
    so it no longer blocks `NestFactory.create`. The lock and the chokidar watchers are
    still set up synchronously, lock NO_OP semantics are preserved, and a rejected initial
    generate is caught and logged rather than crashing the process. The one-shot CLI
    (`nestjs-codegen codegen`) stays fully synchronous.

  - **Skip-when-unchanged.** `generate()` now records a content hash (over all discovered
    controller/DTO/page source files + the serialized resolved config + the lib version) and
    the emitted output file list in `<outDir>/.codegen-manifest.json`. When the hash matches
    and every recorded output still exists, the pass is skipped — stopping HMR from rewriting
    `api.ts` (and churning downstream `tsbuildinfo`) when nothing changed. Any input change,
    a missing output, or a lib upgrade invalidates the manifest and regenerates.

## 0.11.0

### Minor Changes

- b9efd1c: fix(core): emit a clean prefix `queryKey` when a query handle is called with no input.

  Previously the generated `queryKey()` was always `[name, input]`, so calling it with
  no argument produced `[name, undefined]` — a two-element key whose trailing `undefined`
  does NOT partial-match the parametrized live queries (`[name, { params, query }]`).
  That made the bare `api.x.y().queryKey()` useless for `invalidateQueries`: it silently
  matched nothing.

  The key now omits the trailing element when `input === undefined`
  (`input === undefined ? [name] : [name, input]`), so `api.x.y().queryKey()` is a proper
  prefix that partial-matches every parametrized variant. Invalidating a whole route is now
  just `queryClient.invalidateQueries({ queryKey: api.x.y().queryKey() })` — no manual
  key construction or slicing. Passing the real input still yields `[name, input]` for an
  exact match. Keys carrying input are unchanged.

## 0.10.0

### Minor Changes

- 152a2ab: Narrow the public `ValidationOption` type to `ValidationAdapter` only. The string
  shortcuts (`'zod'` / `'valibot'` / `'arktype'`) were advertised by the type but
  `resolveAdapter` always threw a `ConfigError` for any string, so they never worked
  at runtime. The type now guides TypeScript users to import and pass an adapter
  instance (e.g. `zodAdapter` from `@dudousxd/nestjs-codegen-zod`).

  The runtime guard is retained: `resolveAdapter` still accepts a `string` and throws
  the helpful "install + import the adapter package" error, so JS callers and untyped
  configs that pass a removed string shortcut get the same actionable message.

  This is a compile-time-only breaking change for anyone still typing `validation:
'zod'` — it never produced working output at runtime, so the bump is minor.

### Patch Changes

- 81ba774: Ship TanStack Intent agent skills (SKILL.md) inside the package.

## 0.9.0

### Minor Changes

- ff9e27b: feat(core): gate schema-translation advisories behind a new `debug` config flag (default off).

  On every codegen pass the discovery layer logged a `[nestjs-codegen]` line to the
  terminal for each schema-translation advisory — `@X is not translatable to a client
validation schema and was skipped`, `T is a recursive type; ... lazy self-reference`,
  over-deep nesting, and unresolvable `@IsEnum`. On a real project these fire dozens of
  times per run and are pure noise.

  These advisories are already preserved where they matter: in the returned
  `SchemaModule.warnings` array and as `// warning:` comments in the generated output.
  The terminal copy is now opt-in: add `debug: true` to `nestjs-codegen.config.ts`
  (or `NestjsCodegenModule.forRoot({ debug: true })`) to print them again. Default is
  `false`, so a normal run is quiet. No effect on generated artifacts.

## 0.8.0

### Minor Changes

- 685583d: feat(core): synthesize the route `query` type from individual `@Query('name')` params. Handlers using named query params (e.g. `@Query('years') years?: number[]`, `@Query('q') q?: string | string[]`) now emit a typed `query` object — one property per param, keyed by the string-literal name, typed by the parameter annotation, optional when the param has `?` / a default / a `| undefined` type — instead of `query: never`. The existing whole-object `@Query() dto` form is unchanged and still wins when both forms appear on the same handler.

## 0.7.1

### Patch Changes

- b8a8ce4: fix(core): load the TypeScript config via Node's native type-stripping first, falling back to tsx — unblocks the codegen CLI on Node 25 where tsx 4.22.4's resolver appends a `?namespace=<ts>` query that Node 25's stricter `finalizeResolution` rejects with `ERR_MODULE_NOT_FOUND`. tsx remains the fallback for older Node versions without native type stripping.

## 0.7.0

### Minor Changes

- ff8ad8b: Jsonify-by-default serialized response types, with an opt-out `serialization` config option.

  The generated `api.ts` now reflects the **JSON wire shape** of each route's response rather than the in-process server return type. A controller returning `{ createdAt: Date }` now generates `response: Jsonify<{ createdAt: string }>` — because `Date.prototype.toJSON()` emits an ISO string. `Jsonify<T>` recurses arrays/objects, follows any `toJSON()` holder to its returned shape, drops non-serializable properties (functions/symbols), keeps optional properties optional, and passes `any`/`unknown` through untouched. It is a hand-rolled, type-only utility with no runtime footprint.

  - **`@dudousxd/nestjs-client`** exports the new `Jsonify<T>` type.
  - **`@dudousxd/nestjs-codegen`** wraps each route `response` field in `Jsonify<...>` by default and emits `import type { Jsonify } from '<runtime>'` (tracking `fetcher.importPath`) when at least one route is wrapped. Only the `response` field is wrapped — never `error`, `body`, or `query`.
  - New config option `serialization?: 'json' | 'superjson'` (default `'json'`). In `'superjson'` mode the raw controller return type is emitted unchanged (Dates/Maps/Sets are revived on the client), and no `Jsonify` import is emitted.

## 0.6.1

### Patch Changes

- 95c744f: Fix watcher clobbering `api.ts` with an extension-only stub on page edits. The
  pages fast path called `generate(config)` with no routes, so a route-injecting
  extension (e.g. the notifications codegen) still emitted — overwriting the full
  `api.ts` with just the injected namespace and dropping every contract-derived
  route. The watcher now caches the last discovered routes (from the initial pass
  and each contracts rediscovery) and reuses them for pages-only regenerations.

## 0.6.0

### Minor Changes

- ece130c: Fix: resolve `@Filterable({ entity })` entities imported from external npm packages so the route is still classified as a filter route. Previously, when a filter's entity (e.g. a MikroORM entity from `@dudousxd/nestjs-durable-store-mikro-orm`) was imported from `node_modules` rather than an in-repo `*.entity.ts`, the discovery type resolver returned no candidates for the bare module specifier and bailed — degrading the route to a plain bodyless route (`body: never; filterFields: never`, no `queryOptions`) and breaking the generated client (`x.queryOptions is not a function`).

  The type resolver now falls back to the TypeScript compiler's own module resolution (`getModuleSpecifierSourceFile()`) for bare node_modules specifiers, locating the package's `.d.ts` declaration file and enumerating the entity's columns from it. External-package filter entities now get the same full `filterFields` union + `body: FilterQueryResult` + TanStack `queryOptions` helper as in-repo entities.

## 0.5.2

### Patch Changes

- f432450: Internal refactors (behavior-preserving): share `renderModule` across the zod/valibot adapters via a `createChainModuleRenderer` factory, and dedupe the nested-reference array-wrap + presence tail in `buildProperty` (`dto-to-ir`) behind a single `asField` closure.

## 0.5.1

### Patch Changes

- 7dee3f6: perf: faster generation — `aliasFor` uses a maintained in-use-name set (O(n²)→O(1) over nested DTOs) and `planNestedSchemas` caches compiled rename regexes + uses a maintained Set for membership instead of rebuilding arrays. Generated output is byte-identical.

## 0.5.0

### Minor Changes

- 03b3d65: feat: ecosystem improvements across the codegen toolchain.

  - **Typed per-route errors (`Route.Error<K>` now real).** Each emitted leaf route carries a real `error` type, discovered statically from a `defineContract({ error })` schema or a 4xx/5xx `@ApiResponse({ status, type })` decorator. `ApiHttpError` is generic so `err.body` can be narrowed to a route's `Route.Error<K>`.
  - **Discriminated-union DTO support (zod / valibot / arktype).** class-transformer's `@Type(() => Base, { discriminator })` is detected and emitted as a proper tagged union (`z.discriminatedUnion`, `v.variant`, arktype alternation), with each subtype hoisted as a named schema.
  - **Generic wrapper type fidelity (e.g. `PaginatedDto<T>`).** Generic wrapper DTOs substitute their type parameters when resolving both the validation IR and the inline TS type strings, so `PaginatedDto<Item>` resolves to its real shape instead of degrading to `unknown`.
  - **SSE / streaming response typing.** Server-sent-event and streaming endpoints are recognized and emitted with accurate response types.
  - **Cross-file `@ApplyContract` identifier resolution.** Contract identifiers referenced from other files are resolved across the project, including unresolvable-reference handling.
  - **Configurable infinite-query pagination / cursor selector.** TanStack infinite-query generation supports a configurable pagination and cursor selector.
  - **OpenAPI 3.1 export.** The IR can be exported to an OpenAPI 3.1 document.
  - **MSW + mock generation.** Generates MSW handlers and mock data from the discovered IR.
  - **Dual ESM/CJS packaging + exports/types fixes.** Packages ship dual ESM/CJS builds with corrected `exports` and `types` resolution.

- 03b3d65: feat(codegen): SSE/streaming response typing + cross-file `@ApplyContract` refs.

  - **SSE / streaming response typing.** NestJS streaming endpoints are now discovered and typed. The least-magic, fully-static signal: a `@Sse()` decorator, OR a handler whose return type is `Observable<T>` / `AsyncIterable<T>` / `AsyncGenerator<T>`. `@Sse('path')` is treated as a `GET` route. The streamed element type `T` is carried through the IR/`RouteDescriptor` (`contractSource.stream` + the element as `response`/`responseRef`), unwrapping any `Promise<>` and the NestJS `MessageEvent<T>` envelope to the real payload. The emitted leaf gains a typed `stream()` member returning `AsyncIterable<T>`, the ApiRouter type block carries `stream: true|false`, and a new `Route.Stream<K>` / `Path.Stream<M, U>` type helper resolves the streamed element. A runtime SSE consumer is added to the client (`fetcher.sse<T>(path, opts)` + the exported `consumeSse` helper) that parses the `text/event-stream` wire format into a typed async iterable.
  - **Cross-file `@ApplyContract` identifier refs.** `@ApplyContract(importedConst)` where the contract is an imported identifier is now resolved across files: ts-morph follows the import (and barrel `export { X } from './mod'` / `export *` re-exports) to the declaring `defineContract` const, so a contract declared in another file is discovered and emitted. The Path A schema re-export ref now points at the const's declaring file. An identifier that genuinely cannot be resolved still warns and is skipped (prior behavior preserved).

  Backward-compatible. Golden snapshots gain the new `stream` leaf field and `Stream` namespace members. Note: a bare `Observable<T>` return type (previously mapped to `unknown` as server-only) is now a stream of `T`.

- 03b3d65: feat(codegen): type-fidelity improvements.

  - **Typed errors per route (`Route.Error<K>` / `Path.Error<M, U>`).** The emitted leaf type block now carries an `error` field, so the previously-dead `Route.Error<K>` resolves to a real type. The error type is discovered statically from either a `defineContract({ error })` zod schema or an `@ApiResponse({ status, type })` decorator whose `status` is a 4xx/5xx code (the least-magic signal — it reuses the Swagger decorator NestJS apps already write). Routes without a declared error type resolve to `unknown` (an HTTP error always carries some body). `ApiHttpError` is now generic (`ApiHttpError<TBody = unknown>`) so `err.body` can be narrowed to a route's `Route.Error<K>`.
  - **Discriminated-union DTOs.** class-transformer's `@Type(() => Base, { discriminator: { property, subTypes } })` is now detected and emitted as a proper tagged union: zod `z.discriminatedUnion`, valibot `v.variant`, arktype tuple alternation (`[a, "|", b]`). Each subtype is hoisted as a named schema.
  - **Generic wrapper fidelity (`PaginatedDto<T>`).** Generic wrapper DTOs now substitute their type parameters when resolving both the neutral validation IR (so a field typed `T`/`T[]` resolves faithfully instead of degrading to `unknown`) and the inline TS type strings used for body/query/response. `PaginatedDto<Item>` now resolves to its real shape rather than `{ data: Array<unknown> }`.

  Backward-compatible: the only golden change is the new `error` field on each emitted leaf type.

## 0.4.1

### Patch Changes

- 6a6be24: perf: memoize type and enum resolution during generation — per-`Project` `WeakMap` caches for `findType`, `resolveTypeRef`'s named-symbol arm, and `resolveEnumValues`, so a type referenced N times is resolved once. Keyed by `Project` so each (watch) run gets a fresh cache; generated output is byte-identical.

## 0.4.0

### Minor Changes

- ed04cdc: Validate recursive DTOs instead of degrading them to `unknown`.

  Self/mutually-recursive `@ValidateNested` DTOs (e.g. a `ColumnFilter` whose `and`/`or`
  reference `ColumnFilter[]`) used to be degraded to `unknown` with a warning, dropping all
  client-side validation for that field. They are now expanded with a real lazy schema:

  - **zod / valibot** hoist a structural TS `type` alias and annotate the recursive const
    (`z.ZodType<T>` / `v.GenericSchema<T>`) so the implicit-any self-reference cycle is broken;
    the recursion site uses `z.lazy` / `v.lazy`.
  - **arktype** uses the native `this` keyword for self-recursion. Mutual recursion (A ↔ B)
    cannot be expressed per-schema without a scope, so the back-edge schema still degrades to
    `unknown` with a clear warning — use the zod or valibot adapter for full validation there.

  The over-deep nesting guard is now reported separately ("nesting too deep") instead of being
  mislabelled as recursion. The raw-zod `defineContract` path is unchanged.

### Patch Changes

- ed04cdc: Fix array detection for union types. A property typed `unknown | unknown[]` (or any
  union whose text happens to end in `[]`) was mistakenly treated as an array and wrapped
  in `z.array(...)`. Array detection now uses the AST (`ArrayTypeNode`) instead of a
  `.endsWith('[]')` text check, so only genuine `T[]` properties become arrays.

## 0.3.0

### Minor Changes

- b0fcd58: BREAKING (0.x minor bump): `validation` is now a required config field, and the zod
  adapter is no longer bundled in core.

  - `zodAdapter` is no longer exported from `@dudousxd/nestjs-codegen`. Import it from
    `@dudousxd/nestjs-codegen-zod` instead.
  - The `validation: 'zod'` string shortcut no longer resolves — like `'valibot'` and
    `'arktype'`, the string forms now throw, directing you to install the adapter
    package and pass the instance.
  - `validation` must be provided. Both `loadConfig` (config file) and `resolveConfig`
    (`NestjsCodegenModule.forRoot`) throw a clear `ConfigError` when it is missing.

  Migration:

  ```ts
  import { zodAdapter } from "@dudousxd/nestjs-codegen-zod";

  export default defineConfig({
    validation: zodAdapter,
    // ...
  });
  ```

  Adapters now advertise raw-zod passthrough via the new optional
  `ValidationAdapter.acceptsRawZodSource` capability (set only by `zodAdapter`),
  decoupling `emit-forms` from a hardcoded `'zod'` name check.

## 0.2.1

### Patch Changes

- 0207fcc: docs: add a README to every published package and update the docs site to the extension architecture

  Each package now ships a README (npm package pages were previously blank), and the
  docs site documents integrations as registered `extensions: [...]` (the obsolete
  `mutationClient` option is gone) with a new "Extensions" page covering the
  `@dudousxd/nestjs-codegen/extension` contract.

## 0.2.0

### Minor Changes

- 0fe7439: Unified, awaitable leaf handles (Tuyau-style) + `infiniteQueryOptions`.

  Every generated `api.ts` leaf is now an **awaitable handle**: `await api.users.show({ params })`
  performs the request and resolves to the typed response (memoized, so repeated awaits hit the
  network once), exposing `.fetch()`/`.then`/`.catch`/`.finally` via a small `__req` runtime helper.
  When the TanStack extension is registered, the **same** handle additionally carries
  `.queryKey()`, `.queryOptions()` / `.mutationOptions()`, and now `.infiniteQueryOptions()`
  (GET routes, cursor/page pagination). No more "plain fetch OR handle" split — one call shape
  supports both `await` and the TanStack helpers.

  ```ts
  const user = await api.users.show({ params: { id } }); // request
  useQuery(api.users.show({ params: { id } }).queryOptions()); // tanstack
  useInfiniteQuery(api.users.list().infiniteQueryOptions()); // pagination
  ```

- ad80b18: Filter-search routes are treated as queries. `RequestModel.isQuery` is `true` for GET **or**
  any route carrying `filterFields` (a filtered search is a read even when POST). The TanStack
  layer now emits `.queryOptions()` for `isQuery` routes and `.mutationOptions()` for any non-GET
  — so a filter-search POST gets **both** `.queryOptions()`/`.filterQuery()` and
  `.mutationOptions()`. `.infiniteQueryOptions()` stays GET-only (page goes in the query string).
- 9c86e57: Move the runtime `filterQuery()` helper out of core into the new
  `@dudousxd/nestjs-filter-codegen` extension. Core no longer emits the `filterQuery`
  member or the `@dudousxd/nestjs-filter-client` value import in `api.ts` — register
  `nestjsFilterCodegen()` to get it. Core still discovers `filterFields`/`filterFieldTypes`
  and renders the type-level `TypedFilterQuery<…>` (query-source filters). Also decouples the
  TanStack layer from filter (it no longer imports `queryOptions` for filter-only routes).
- 5f52ecf: Move the Inertia `navigate()` helper + `@inertiajs/react` router import out of core into the
  new `@dudousxd/nestjs-inertia-codegen-extension`. The `mutationClient` config option is
  removed — register `nestjsInertiaCodegen()` instead to get `navigate()` in `api.ts`. Core's
  generated `api.ts` is now Inertia-agnostic (Inertia page discovery / `pages.d.ts` is still
  driven by the `pages` config). Same model as `query` → `tanstackQuery()` and
  `filterQuery` → `nestjsFilterCodegen()`.
- 3ff3199: Initial release: typed-client codegen for NestJS.

  - `@dudousxd/nestjs-codegen` — discovery (controllers, `defineContract`, DTOs, pages,
    shared props, filters), emitters (`routes.ts`/`api.ts`/`forms.ts`/`pages.d.ts`),
    config loader, watch mode, and the `codegen`/`init`/`doctor` CLI. Bundles the neutral
    validation IR + zod adapter.
  - `@dudousxd/nestjs-codegen-valibot`, `@dudousxd/nestjs-codegen-arktype` — validation
    adapters rendering the shared IR.
  - `@dudousxd/nestjs-client` — framework-neutral runtime: typed fetcher with a pluggable
    transport (axios via `axiosTransport`) and a superjson transformer hook.

  Highlights: pluggable validation, Tuyau-style `createApi(fetcher)` factory, optional
  TanStack Query (configurable adapter import), and nestjs-inertia + nestjs-filter
  integrations.

- 5a9b90e: Add `NestjsCodegenModule.forRoot()` — a NestJS module (exported from
  `@dudousxd/nestjs-codegen/nest`) that auto-starts the codegen watcher on app boot, the
  recommended way to wire the codegen in dev. Import it into your `AppModule` and the typed
  client regenerates as you edit controllers — no config file, no separate process. Skips the
  watcher in production by default (`enabled`/`cwd` options to override); `@nestjs/common` is an
  optional peer dependency. The one-shot CLI remains for CI/pre-deploy runs.

  Also exposes `resolveConfig(userConfig, cwd?)` for resolving config in memory, and fixes the
  watcher's incremental contracts pass to honor the full emit options (`query` /
  `mutationClient` / `queryImport` / validation adapter) instead of silently dropping them on
  each edit.

- fd032c4: TanStack Query is now an extension, not a core flag (extension system Phase 3).

  - New package `@dudousxd/nestjs-codegen-tanstack` exporting `tanstackQuery({ import? })`,
    a `CodegenExtension` whose `apiClientLayer` turns `api.ts` leaves into handles with
    `fetch`/`queryKey`/`queryOptions`|`mutationOptions`. Register it via
    `forRoot({ extensions: [tanstackQuery()] })`.
  - **Breaking (core):** the `query` and `queryImport` config options are removed. Replace
    `query: true` with `extensions: [tanstackQuery()]`, and `queryImport: '@tanstack/vue-query'`
    with `tanstackQuery({ import: '@tanstack/vue-query' })`. The default client is unchanged
    (plain typed fetch). `emitApi` now resolves the api.ts transport/layer/members from the
    registered extensions; output is byte-identical to the old flag (verified by a golden snapshot).
