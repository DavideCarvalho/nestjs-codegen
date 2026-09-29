---
"@dudousxd/nestjs-codegen": minor
---

Several page globs and several Inertia apps (scopes).

- `pages.glob` takes one glob or an array. Each page is named relative to the static base of
  the glob that matched it (brace globs included: the base stops at the first segment with
  glob syntax), and two files resolving to the same page name are an error.
- `pages.scopes` declares more Inertia apps, one per `InertiaModule.forFeature({ scope })`:
  `{ glob, prefix?, componentNameStrategy? }`. A scope's page names get the prefix
  `'<scope>/'` by default (`minimal/pages/Home.tsx` → `minimal/Home`). Every page lands in
  `InertiaPages`/`InertiaPageName`; `pages.d.ts` also exports `InertiaScopePages` and
  `InertiaScopePageName<S>`, `components.json` records each page's `scope`, and the watcher and
  the skip-if-unchanged hash cover every scope's pages.
- The top-level `scopes` option never had an effect; it is deprecated and now warns.
