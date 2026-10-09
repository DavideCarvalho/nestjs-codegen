---
"@dudousxd/nestjs-codegen": minor
---

New built-in `genuiSandboxKit()` extension: writes the generative-UI sandbox-kit docs (`.genui/sandbox-kit.json`, the component names and props of your shadcn `components/ui` read from their TypeScript types) for `@dudousxd/nestjs-agent`, on every generate and in watch mode. It calls `writeSandboxKitDocs` from the optional peer `@dudousxd/nestjs-agent-core/genui/kit` (>=0.50.0), or a `generate` function you pass.

Watch mode now also watches the files extensions declare with `ctx.trackInput` (so editing an extension's out-of-glob dependency, such as a filter class or a kit component, regenerates without waiting for an unrelated change), and a tracked directory hashes as its file listing, so adding a file to it invalidates the skip-when-unchanged check.
