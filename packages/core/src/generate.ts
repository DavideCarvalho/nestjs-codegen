import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ResolvedConfig } from './config/types.js';
import { discoverPages } from './discovery/pages.js';
import { discoverSharedPropsFromConfig } from './discovery/shared-props.js';
import type { RouteDescriptor } from './discovery/types.js';
import { emitApi } from './emit/emit-api.js';
import { emitCache } from './emit/emit-cache.js';
import { emitForms } from './emit/emit-forms.js';
import { emitIndex } from './emit/emit-index.js';
import { emitMocks } from './emit/emit-mocks.js';
import { emitOpenApi } from './emit/emit-openapi.js';
import { emitPages } from './emit/emit-pages.js';
import { emitRoutes } from './emit/emit-routes.js';
import {
  applyTransformRoutes,
  collectEmittedFiles,
  createExtensionContext,
} from './extension/registry.js';
import {
  DriftGuardError,
  type EntryPoint,
  computeConfigHash,
  computeConfigKeyHashes,
  computeInputsHash,
  diffConfigKeyHashes,
  isManifestFresh,
  listOutputFiles,
  readManifest,
  writeManifest,
} from './generate-manifest.js';
import { VERSION } from './index.js';
import { setCodegenDebug } from './util/debug-log.js';

/**
 * Build the drift-guard error message. Named exactly like the throw site so a
 * caller catching {@link DriftGuardError} can log/report it verbatim.
 */
function driftGuardMessage(
  outDir: string,
  previousEntryPoint: EntryPoint,
  currentEntryPoint: EntryPoint,
  differingKeys: string[],
): string {
  // Older manifests carry no per-key hashes, so the differing keys can be
  // unknown — name them when we can, and never guess when we can't.
  const differ =
    differingKeys.length > 0
      ? `their resolved configs differ at: ${differingKeys.map((key) => `\`${key}\``).join(', ')}`
      : 'their resolved configs differ (re-run after this generate records per-key hashes to see which keys)';
  return `[nestjs-codegen] Config drift detected in "${outDir}": the last generate ran from the "${previousEntryPoint}" entry point, this run is from the "${currentEntryPoint}" entry point, and ${differ}. Both entry points must read the SAME config — export a shared config object (e.g. codegen.config.ts) and import it from BOTH nestjs-codegen.config.ts (CLI) and NestjsCodegenModule.forRoot() (Nest module), or set \`driftGuard: false\` on either config to opt out of this check.`;
}

/**
 * Run one full codegen pass: discover pages, emit pages.d.ts, components.json, index.d.ts.
 * Route discovery is deliberately skipped — it requires spawning a Nest app and is
 * not appropriate for the hot path of a file watcher.
 *
 * Optionally accepts pre-discovered routes (e.g. from a full generate + route-discovery pass).
 * When routes are present, emits routes.ts.
 * When routes with contracts are present, also emits api.ts.
 *
 * `entryPoint` identifies which caller is running — the CLI or the Nest module — and is
 * recorded in the manifest for the {@link DriftGuardError} check below.
 */
export async function generate(
  config: ResolvedConfig,
  inputRoutes: RouteDescriptor[] = [],
  entryPoint: EntryPoint = 'cli',
): Promise<void> {
  // Gate the schema-translation advisory chatter for this pass (off by default).
  setCodegenDebug(config.debug);

  // Skip-when-unchanged: if the inputs (source files + resolved config + lib
  // version) hash-match the last run AND every recorded output still exists, this
  // pass is a no-op. This stops watch/HMR from rewriting api.ts when nothing
  // changed, which would otherwise churn downstream tsbuildinfo. Computed per
  // call so an actual file change still regenerates.
  // The manifest is read FIRST: it carries the extra input files extensions
  // reported last run (`ExtensionContext.trackInput`), and those take part in
  // the hash. Without them an extension that reads outside the host's globs —
  // the filter extension reads each route's `@ApplyFilter` target — produces
  // output that nothing invalidates.
  const manifest = await readManifest(config.codegen.outDir);
  const inputsHash = await computeInputsHash(config, manifest?.extraInputs ?? []);
  if (await isManifestFresh(config.codegen.outDir, manifest, inputsHash)) {
    console.log(`[nestjs-codegen] ${config.codegen.outDir} up to date, skipped`);
    return;
  }

  // Drift guard: the CLI and the Nest module can both target the same `outDir`
  // from independently-resolved configs. If the last generate ran from a
  // DIFFERENT entry point than this one AND the resolved configs actually
  // differ, refuse to overwrite — this is the ping-pong-churn case (e.g. one
  // entry point set `serialization: 'superjson'`, the other left the default
  // `'json'`). Same entry point (a normal config edit) or same configHash
  // (harmless cross-entry-point agreement) both proceed as usual; the manifest
  // written at the end of this run always updates `entryPoint`/`configHash` to
  // the current run's values.
  const configHash = computeConfigHash(config);
  const configKeyHashes = computeConfigKeyHashes(config);
  if (
    config.driftGuard &&
    manifest?.entryPoint &&
    manifest.entryPoint !== entryPoint &&
    manifest.configHash &&
    manifest.configHash !== configHash
  ) {
    throw new DriftGuardError(
      driftGuardMessage(
        config.codegen.outDir,
        manifest.entryPoint,
        entryPoint,
        // A pre-key-hash manifest can't tell us WHICH keys differ — pass none
        // rather than diffing against {} (which would name every key).
        manifest.configKeyHashes
          ? diffConfigKeyHashes(manifest.configKeyHashes, configKeyHashes)
          : [],
      ),
    );
  }

  // Extensions: run transformRoutes (chained) before any emit so routes.ts/api.ts/
  // forms.ts all see the augmented IR. ctx.routes is a live getter over the active set.
  const extensions = config.extensions ?? [];
  let routes = inputRoutes;
  const trackedInputs = new Set<string>();
  const ctx = createExtensionContext(config, () => routes, trackedInputs);
  if (extensions.length > 0) {
    routes = await applyTransformRoutes(routes, extensions, ctx);
  }

  // Inertia page discovery is opt-in — skip entirely when `pages` isn't configured.
  if (config.pages) {
    const pagesConfig = config.pages;
    const pages = await discoverPages({
      glob: pagesConfig.glob,
      cwd: config.codegen.cwd,
      propsExport: pagesConfig.propsExport,
      componentNameStrategy: pagesConfig.componentNameStrategy,
    });

    const sharedProps = discoverSharedPropsFromConfig(config);

    await emitPages(pages, config.codegen.outDir, {
      propsExport: pagesConfig.propsExport,
      sharedProps,
    });
    await emitCache(pages, config.codegen.outDir);
  }

  const hasRoutes = routes.length > 0;
  const hasContracts = routes.some((r) => r.contract);

  if (hasRoutes) {
    await emitRoutes(routes, config.codegen.outDir);
  }

  if (hasContracts) {
    await emitApi(routes, config.codegen.outDir, {
      ...(config.fetcher?.importPath ? { fetcherImportPath: config.fetcher.importPath } : {}),
      serialization: config.serialization,
      extensions,
      ctx,
    });
  }

  const hasForms = await emitForms(routes, config.codegen.outDir, config.forms, config.validation);

  // OpenAPI 3.1 spec export (opt-in). Lowers routes + validation IR into a spec.
  if (hasContracts && config.openapi.enabled) {
    await emitOpenApi(routes, config.codegen.outDir, {
      fileName: config.openapi.fileName,
      info: {
        title: config.openapi.title,
        version: config.openapi.version,
        ...(config.openapi.description ? { description: config.openapi.description } : {}),
      },
    });
  }

  // MSW + faker mock handlers (opt-in).
  if (hasContracts && config.mocks.enabled) {
    await emitMocks(routes, config.codegen.outDir, {
      fileName: config.mocks.fileName,
      seed: config.mocks.seed,
      baseUrl: config.mocks.baseUrl,
    });
  }

  await emitIndex(config.codegen.outDir, hasContracts, hasForms);

  // Extensions: write any extra files (collision-checked against each other + core files).
  if (extensions.length > 0) {
    const extraFiles = await collectEmittedFiles(extensions, ctx);
    for (const file of extraFiles) {
      const dest = join(config.codegen.outDir, file.path);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, file.contents, 'utf8');
    }
  }

  // Record the inputs hash + the output file set, so the next call can skip when
  // nothing changed. Recorded after a successful pass; a throw above leaves the
  // old manifest (or none) in place, so the next run regenerates.
  const outputFiles = await listOutputFiles(config.codegen.outDir);
  const extraInputs = [...trackedInputs].sort();
  // Re-hash with the dependencies THIS run actually reported, not the ones the
  // previous manifest carried. Otherwise the first run after an extension's
  // dependency set changes would store a hash the next run cannot reproduce,
  // costing one spurious regeneration before it settles.
  const recordedHash =
    extraInputs.length > 0 ? await computeInputsHash(config, extraInputs) : inputsHash;
  await writeManifest(config.codegen.outDir, {
    version: VERSION,
    hash: recordedHash,
    entryPoint,
    configHash,
    configKeyHashes,
    files: outputFiles,
    ...(extraInputs.length > 0 ? { extraInputs } : {}),
  });
}
