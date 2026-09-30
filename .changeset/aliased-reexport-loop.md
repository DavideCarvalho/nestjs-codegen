---
'@dudousxd/nestjs-codegen': patch
---

Type discovery no longer overflows the stack on bundled declaration files. A `.d.ts` chunk that imports a type under an alias and re-publishes it bare (`import { p as ToolKind } from './chunk'; export { ToolKind }` — what tsup/rollup emit) used to be matched by the import's source name, miss, and re-enter the same file with a fresh cycle guard until `Maximum call stack size exceeded` aborted the whole `codegen` run (seen with `@dudousxd/nestjs-agent-core` 0.29 through `@dudousxd/nestjs-agent-codegen`). Imports are now matched by their local name and followed under their source name, and the cycle guard is carried through the walk (keyed by file and name).
