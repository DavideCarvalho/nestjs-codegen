---
'@dudousxd/nestjs-codegen': patch
---

Order routes by file path, so an unchanged source tree always generates the same client

Route order decided the order of everything emitted from it — the groups in
`api.ts`, the entries in `routes.ts` — and it was whatever order discovery
happened to reach the files in. The cold path adds controllers in `fast-glob`'s
directory-walk order, which is I/O-completion order from a concurrent walk: it
holds while the FS cache is warm and can differ on a cold one, so regenerating
an untouched project could move a controller group to a different position. The
watcher appended each newly-created controller to the end of its set, so from
the moment a file was added its output no longer matched a cold run's, for the
rest of the session.

Both extraction entry points now sort their roots by path. `discoverPages` has
sorted its glob from the start, which is why only the controller-derived
artifacts ever moved.

Nothing about the generated client changes except the order of its blocks —
same routes, same types, same members. Consumers who commit their generated
directory should expect one reorder-only diff on the first run after upgrading.
