---
'@dudousxd/nestjs-codegen': patch
---

Fix a drift-guard false positive that permanently blocked incremental regeneration for shared configs: the config hash folded functions in via `toString()`, but the same shared config object yields different function source text per entry point (the CLI loads TS via Node's type stripping; the Nest module runs tsc/SWC-compiled dist), so a genuinely-shared config was flagged as drifted the moment both entry points touched the same outDir. Functions now hash by name only — every setting that can actually diverge is plain data and is still hashed in full. The drift error also now NAMES the top-level keys that differ (via new per-key hashes recorded in the manifest as `configKeyHashes`) instead of a generic example.
