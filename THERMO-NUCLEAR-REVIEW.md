# Thermo-Nuclear Code-Quality Review — @dudousxd/nestjs-codegen

**Verdict: NOT approved.** Behavior is fine, but there are clear structural regressions and at least two high-leverage code-judo moves that would delete whole categories of complexity. The unifying theme: this package is an *incomplete extraction* from `nestjs-inertia` — legacy identity and a legacy second pipeline still coexist with the new one.

Findings are ordered by leverage (most complexity deleted per unit of behavior change).

---

## 🔪 Code-judo #1 — Delete `dto-to-zod.ts`: one translation path, not two (BLOCKER)

`contracts-fast.ts:835-847` runs **both** `extractZodFromDto` (→ zod text) and `extractSchemaFromDto` (→ `SchemaNode` IR) on the *same* DTO. The two files are line-for-line twins (same `KNOWN_DECORATORS`, same `buildProperty`/recursion guard/`aliasFor`/`numericArgs`), and the **zod adapter already reproduces that text byte-for-byte**. So the class-validator → schema mapping table lives in **three** places (`dto-to-zod.ts`, `dto-to-ir.ts`, `adapters/zod.ts`) and every new decorator must be added thrice, in sync.

**Move:** delete `dto-to-zod.ts` entirely. `contracts-fast` produces only the IR; `emit-forms` renders the zod path through `zodAdapter.renderModule` like every other adapter.

**Cascade (HIGH):** that collapses the **two parallel forms emitters** in `emit-forms.ts:41-55` (the `collectFormEntries`/`buildFormsFile` zod arm vs `buildFormsFileWithAdapter` IR arm — note the duplicated "Base-name collision pass" at L74 *and* L175). Once the IR is the single source, `collectFormEntries`/`FormSchemaSource`/`buildFormsFile`/`planNestedSchemas` (~250 lines) delete. Only `defineContract` re-exports (`bodyZodRef`) survive as a small passthrough.

This single thread removes a ~3-way-duplicated mapping table, ~250 lines, and a whole pipeline.

---

## 🔪 Code-judo #2 — Collapse the transport/layer split to one slot (HIGH)

The extension contract carries **two** single-slot hooks (`ApiTransport` + `ApiClientLayer`, `types.ts:153-169`), two ownership-conflict branches (`resolveApiSlots`, `registry.ts:19-53`), a `transport ? renderRequest : renderFetcherRequest` fork (`emit-api.ts:480`), and a shared `ApiModuleDeps` base — yet **`apiTransport` has zero implementers** (only a hypothetical Inertia transport in the docs) and `apiClientLayer` has exactly one (tanstack). This is two abstractions and two conflict paths for one concrete consumer.

**Move:** collapse to a single `apiClientLayer` whose `buildMembers` receives the `RequestModel` and renders its own request; the default fetcher request becomes a tiny exported helper a layer can call. Delete `ApiTransport`, the transport half of `resolveApiSlots`, the `transportOwner` branch, and the L480 fork. Reintroduce a transport slot when a *second* consumer actually exists.

---

## Structural / type-contract regressions

**3. `RequestModel`/`LeafModel` is a typed façade over an implicit free-variable contract (BLOCKER)** — `buildRequestModel` (emit-api.ts:326-373). Every expression string (`urlExpr`/`optsExpr`/`queryKeyExpr`) embeds the ambient identifier `input?.…`, and tanstack's `buildMembers` hard-references `input` and `fetcher` directly (`tanstack/index.ts:48,54`) — identifiers that only exist because `renderLeaf` happens to emit them into scope. An extension author can't reason from the typed contract; they must *know* the paste target. The `bodyType` field is emitted, documented, and **never read** (dead). → Make the closure vars explicit on the model, or (better) have the transport own the entire call rendering and delete the partial-expression fields nobody recombines. Delete `bodyType`.

**4. `RouteDescriptor` is rebuilt via `as unknown as` from the tree that just destroyed it (HIGH)** — `emitApiObjectBlock` (emit-api.ts:469-479). `LeafEntry` narrows `params` to `source: string`, so on the way out a fake descriptor is hand-rebuilt and force-cast just to feed extension hooks. → Hang the real `RouteDescriptor` off the leaf node; the cast and the reconstruction block both vanish.

**5. Hidden module-global discovery context (HIGH)** — `type-ref-resolution.ts:31` keeps `let _ctx` file-scope, threaded by `setDiscoveryContext`/`restoreDiscoveryContext` save/restore around each run (`contracts-fast.ts:85-96`). It's a global masquerading as a parameter — `findType`/`resolveTypeRef` read it implicitly, and the save/restore dance exists *because* concurrent watcher triggers would corrupt it. → Make `DiscoveryContext` an explicit parameter (or a per-invocation resolver closure); the save/restore machinery and the concurrency hazard disappear.

**6. `helpers()` hook is declared, promised, and never invoked (MEDIUM)** — `ApiModuleDeps.helpers` (types.ts:150); emit only reads `.imports` (emit-api.ts:591-592). An inert typed hook is a trap. Given 0.x semver, **delete it** until a consumer needs it.

---

## Spaghetti / decomposition

**7. `>1k file: contracts-fast.ts (1136 lines)`** — three responsibilities crammed together: the driver, the zod-AST→TS translator (`zodAstToTs`/`parseDefineContractCall`), and the DTO/decorator→TS resolver. → Split into `zod-ast-to-ts.ts` + `dto-type-resolver.ts`, leaving a ~250-line walker. Two extra wins inside: (a) `extractFromSourceFile` (L914-1136) has two duplicated route-emit arms (contract vs plain-verb) with near-identical 12-line `@As` blocks that *disagree* on the empty-`@As` policy — extract `readAsDecorator`/`resolveVerb`/`buildRoute` and split into `extractContractRoute`/`extractDtoRoute`; (b) `resolveTypeNodeToString` (L372-505) is a 130-line `if`-cascade of hardcoded ORM wrapper names — replace with a `WRAPPER_TYPES: Record<string,'unwrap'|'arrayOf'>` table + `PASSTHROUGH_UTILITY` set. (Deleting `dto-to-zod` per #1 also trims this file's surface.)

**8. `buildApiFile` is a ~275-line string-`push` monolith (MEDIUM-HIGH)** — emit-api.ts:521-795. The `_RouterAt`/`ResolveByName`/`Route`/`Path` namespace blocks (L721-784) are **static text** assembled line-by-line, and the empty-routes branch (L639-668) **duplicates the entire namespace shape as `never` stubs** that must be kept in sync with the real ones. → Move static blocks to module-level template constants; the empty branch becomes "imports + same namespaces over an empty `ApiRouter`", deleting the divergent copy. Biggest legibility win + removes a sync hazard.

**9. `init.ts (917 lines)` is an Inertia scaffolder living in the codegen package (HIGH, identity)** — every template/log/gitignore string in `runInit` (L719-917) is `nestjs-inertia`, yet this is `@dudousxd/nestjs-codegen`. Most of the file is arguably out of scope. → First decide identity: if codegen `init` only needs to drop `nestjs-codegen.config.ts` + the `.d.ts` + a typecheck script, **delete** the Inertia scaffolding from this package. If it stays, decompose `runInit` into ordered step objects and route the four brittle regex/`JSON.parse` `patch*` functions through a shared `patchJsonFile(path, mutator)` + ts-morph AST edits (the package already depends on ts-morph).

---

## Boundary leaks (incomplete extraction)

**10. Legacy `nestjs-inertia` identity in the canonical path (MEDIUM)** — default `outDir` is `.nestjs-inertia` (`load-config.ts:77`) and `UserConfig` JSDoc references `nestjs-inertia.config.ts` / `@dudousxd/nestjs-inertia-client` (`types.ts:47-51`), in a package being extracted *away* from Inertia. → Default to `.nestjs-codegen` (read the legacy dir only for back-compat); move Inertia-specific examples into the Inertia extension's own docs.

**11. Request-shape policy re-derived in 3 places (MEDIUM)** — `isGet`/`isQuery`/`hasBody`/`hasQuery` are pattern-matched off raw `contractSource` in `buildRequestModel` (emit-api.ts:327-343), again in tanstack's `imports()` (index.ts:61-65), and again in `emitRouterTypeBlock` (L291). "filter-search POST counts as a read" is encoded thrice and can drift. → Compute these booleans **once** in discovery/IR and store them on the route; emit and every extension read flags instead of re-matching.

**12. Member-collision check reimplemented inline (MEDIUM)** — the api-member collision loop (emit-api.ts:489-500) is a near-duplicate of file-collision logic in `collectEmittedFiles` (registry.ts:114-143). → Extract one `mergeExclusive(target, incoming, {owner})` and use it for both.

**13. `generate.ts` constructs ts-morph + tsconfig resolution inline, wrong layer (MEDIUM)** — generate.ts:54-77 builds the Project (with a try/catch-inside-try/catch fallback, all under a swallow-all `catch {}`) and resolves tsconfig in the top-level orchestrator. → Push Project construction + sharedProps into `discovery/shared-props.ts` behind one `discoverSharedProps(config)`; orchestrator just awaits. (The independent routes/api/forms emits at L79-101 could also `Promise.all`, minor.)

**14. `pages.glob` validation only on the file path (MEDIUM)** — `loadConfig` validates it (load-config.ts:168-172) but `resolveConfig` (forRoot) skips it, so `forRoot({ pages: { glob: 123 } })` is unguarded. → Move input validation into the shared `applyDefaults` so both entry points validate identically.

---

## Genuinely clean (keep)
- The `__req` awaitable-handle (`emitReqHelper`) — a real code-judo win already landed; one runtime helper makes `await api.x.y()` work *and* gives layers a base to spread onto. Lean into it (it's what makes #2 viable).
- `registry.ts` slot resolution + lazy `Project`/live-`routes` context — tight and single-purpose (modulo the #12 dedup).
- The tree builder (`insertIntoTree`/conflict detection).
- `resolveConfig`/`loadConfig` both funnel through `applyDefaults` — defaults don't drift (modulo #14).

---

### Highest-leverage order to execute
1. **#1** (delete `dto-to-zod` + collapse the second forms emitter) — most lines/concepts deleted.
2. **#2 + #6** (one client-layer slot; drop inert `helpers`) — deletes the over-built extension surface.
3. **#3 + #4** (kill the type-safety theater around the leaf/model seam).
4. **#7 + #8** (decompose the >1k file and the static-text monolith).
5. **#9 / #10** (resolve the Inertia-identity leaks).
