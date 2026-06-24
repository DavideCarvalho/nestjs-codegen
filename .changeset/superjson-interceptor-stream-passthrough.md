---
"@dudousxd/nestjs-client": patch
---

fix(client/superjson): SuperjsonInterceptor passes SSE handlers, StreamableFile, Node streams and Buffers through untouched instead of serializing them — only plain JSON payloads get the superjson envelope
