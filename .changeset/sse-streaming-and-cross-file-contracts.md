---
"@dudousxd/nestjs-codegen": minor
"@dudousxd/nestjs-client": minor
---

feat(codegen): SSE/streaming response typing + cross-file `@ApplyContract` refs.

- **SSE / streaming response typing.** NestJS streaming endpoints are now discovered and typed. The least-magic, fully-static signal: a `@Sse()` decorator, OR a handler whose return type is `Observable<T>` / `AsyncIterable<T>` / `AsyncGenerator<T>`. `@Sse('path')` is treated as a `GET` route. The streamed element type `T` is carried through the IR/`RouteDescriptor` (`contractSource.stream` + the element as `response`/`responseRef`), unwrapping any `Promise<>` and the NestJS `MessageEvent<T>` envelope to the real payload. The emitted leaf gains a typed `stream()` member returning `AsyncIterable<T>`, the ApiRouter type block carries `stream: true|false`, and a new `Route.Stream<K>` / `Path.Stream<M, U>` type helper resolves the streamed element. A runtime SSE consumer is added to the client (`fetcher.sse<T>(path, opts)` + the exported `consumeSse` helper) that parses the `text/event-stream` wire format into a typed async iterable.
- **Cross-file `@ApplyContract` identifier refs.** `@ApplyContract(importedConst)` where the contract is an imported identifier is now resolved across files: ts-morph follows the import (and barrel `export { X } from './mod'` / `export *` re-exports) to the declaring `defineContract` const, so a contract declared in another file is discovered and emitted. The Path A schema re-export ref now points at the const's declaring file. An identifier that genuinely cannot be resolved still warns and is skipped (prior behavior preserved).

Backward-compatible. Golden snapshots gain the new `stream` leaf field and `Stream` namespace members. Note: a bare `Observable<T>` return type (previously mapped to `unknown` as server-only) is now a stream of `T`.
