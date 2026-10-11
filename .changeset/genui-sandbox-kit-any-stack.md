---
"@dudousxd/nestjs-codegen": minor
---

`genuiSandboxKit()` takes the same options as the agent's Vite plugin: `components` (files, globs, directories or packages), `styles` (the app's style entries: the model is told the Tailwind tokens or the CSS class vocabulary, and the theme's variables), `wrapper`, `stylesDocs`, `tsconfig` and `output`. The stylesheets and what they `@import` are tracked as inputs.

**Breaking:** `include` and `entry` are now `components`, and `css` is now `styles`. Passing the old options throws a `CodegenError` naming the replacement. It needs `@dudousxd/nestjs-agent-core` >= 0.53.0.
