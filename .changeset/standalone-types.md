---
"@dudousxd/nestjs-codegen": minor
---

`types: 'standalone'`: resolve every route's body, query, and response with the TypeScript checker and print them into the generated files, so a client in its own package (a Vite SPA, a mobile app, a shared client library) no longer type-checks the server through `ReturnType<import('<controller>')…>`. Inferred handler return types are resolved; named app types (interfaces, classes, aliases, enums) are hoisted into `types.ts`; a validation pipe handed a Standard Schema (`@Body(new ZodPipe(schema))`) types the body as the schema's input. The files the checker read are tracked as generate inputs and watched, so editing a service regenerates the client.

Also:
- `@Body(new SomePipe(...))` / `@Query(new SomePipe(...))` are read as the whole body/query (previously any decorator argument made the codegen skip the parameter), and `@Body('field')` parameters are collected into one body object.
- `@All()` / `@Head()` / `@Options()` handlers no longer emit an `api.ts` leaf calling a `fetcher.all()` that does not exist.
- Server types are imported with a `.js` specifier, which resolves under `bundler` and `nodenext` alike.
- Generated requests are cancellable: `handle.fetch({ signal })`, and the requests carry the signal to the fetcher. Needs `@dudousxd/nestjs-client` with `signal` support (this release).
