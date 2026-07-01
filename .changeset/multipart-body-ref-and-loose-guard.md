---
"@dudousxd/nestjs-codegen": patch
---

fix(multipart): intersect the uploaded-file field at emit time so it survives a named `bodyRef`, and leave deliberately-loose bodies untouched.

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
