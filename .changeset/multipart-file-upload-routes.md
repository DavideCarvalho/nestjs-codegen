---
"@dudousxd/nestjs-codegen": minor
"@dudousxd/nestjs-client": minor
---

feat: typed `multipart/form-data` upload routes (`@UploadedFile()` / Multer interceptors).

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
