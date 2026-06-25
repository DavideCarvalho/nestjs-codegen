# Skill spec — nestjs-codegen (autonomous pass)

Generated without a maintainer interview. Every API named below is grounded in repo source
(`packages/*/src/**`) or `apps/docs/content/docs/**`. Interview-only knowledge is recorded under
"Remaining Gaps".

## Scope decision

Primary client-facing packages (the ones a consumer actually imports to get a working client):

1. `@dudousxd/nestjs-codegen` (core) — the module + CLI + config.
2. `@dudousxd/nestjs-client` (client) — the runtime fetcher the generated client uses.
3. `@dudousxd/nestjs-codegen-tanstack` (tanstack) — the headline optional TanStack Query layer.

Out of scope (listed in gaps): the zod/valibot/arktype adapter packages get no own skill folder —
their single public export (`zodAdapter`/`valibotAdapter`/`arktypeAdapter`) is taught inside the
core setup skill. Inertia / filter extension layers are deferred.

## Skills (flat, all type `core`; <5 per package, no router)

### packages/core/skills/codegen-setup
Wire `NestjsCodegenModule.forRoot()` from `@dudousxd/nestjs-codegen/nest`; pass a validation
ADAPTER INSTANCE (`zodAdapter`); share one `defineConfig` file between the dev module and the CI
CLI; run `nestjs-codegen codegen` as a CI drift gate. Mistakes: bare `validation: 'zod'` string
(throws ConfigError), running the watcher in production, hand-rolling a second config that drifts.

### packages/core/skills/codegen-serialization-output
The generated artifacts (`routes.ts` + `route()`, `api.ts` `createApi`, `forms.ts`) and the
`serialization` seam. `'json'` (default) wraps every response in `Jsonify<...>` (Date->string);
`'superjson'` emits raw types and MUST be paired with the runtime. Mistakes: treating a `Date`
response as a runtime Date under json mode, flipping config to superjson without the interceptor,
committing nothing / not gating drift.

### packages/client/skills/nestjs-client-runtime
`createApi(createFetcher(...))`, `FetcherOptions` (baseUrl/headers/transport/transformer/deserialize),
`axiosTransport`, transformer pipelines via array, and the `/superjson` opt-in subpath
(`superjsonFetcherOptions`/`withSuperjson`/`SuperjsonInterceptor`). Mistakes: double base URL with
axios, dropping caller headers when adding superjson (use `withSuperjson`), assuming a custom
`Transport` returns the parsed body (it returns normalized `{ ok,status,text() }`).

### packages/tanstack/skills/tanstack-query-extension
Register `tanstackQuery()` in `extensions:[...]`; point `import` at your framework adapter
(`@tanstack/vue-query` etc.); use `.queryOptions()` (GET) / `.mutationOptions()` (writes) /
`.infiniteQueryOptions()` / `.queryKey()` on each leaf. Mistakes: calling `.queryOptions()` without
registering the extension, using the wrong framework `import`, expecting `mutationOptions()` on a GET
route (GET = query, others = mutation).

## Remaining Gaps (interview would have resolved)

- New-user default validation lib priority (assumed zod).
- The `validation: 'zod'` string vs adapter-instance doc/source inconsistency — source throws; flagged.
- Real AI-agent failure modes (inferred from source invariants; `gh issue list` empty here).
- Production watcher posture and any perf caveats of the boot-time watcher on large controller globs.
- Inertia/filter extension factory names + import paths (not exported from the in-scope packages).
- `defineContract` authoring ergonomics (lives upstream; excluded to avoid ungrounded imports).
