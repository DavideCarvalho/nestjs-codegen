---
"@dudousxd/nestjs-codegen": patch
---

A bare `@UploadedFile()` route (no `@Body()` DTO) now emits a working multipart leaf.
`requestShape().hasBody` ignored `multipart`, so while the ApiRouter TYPE promised
`body: { file: File | Blob }` (the multipart intersection), the generated call accepted no
body and sent no file. `multipart` now implies a body; routes with a `@Body()` DTO were
already correct.
