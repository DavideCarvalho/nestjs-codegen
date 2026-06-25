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
import { setCodegenDebug } from './util/debug-log.js';

/**
 * Run one full codegen pass: discover pages, emit pages.d.ts, components.json, index.d.ts.
 * Route discovery is deliberately skipped — it requires spawning a Nest app and is
 * not appropriate for the hot path of a file watcher.
 *
 * Optionally accepts pre-discovered routes (e.g. from a full generate + route-discovery pass).
 * When routes are present, emits routes.ts.
 * When routes with contracts are present, also emits api.ts.
 */
export async function generate(
  config: ResolvedConfig,
  inputRoutes: RouteDescriptor[] = [],
): Promise<void> {
  // Gate the schema-translation advisory chatter for this pass (off by default).
  setCodegenDebug(config.debug);

  // Extensions: run transformRoutes (chained) before any emit so routes.ts/api.ts/
  // forms.ts all see the augmented IR. ctx.routes is a live getter over the active set.
  const extensions = config.extensions ?? [];
  let routes = inputRoutes;
  const ctx = createExtensionContext(config, () => routes);
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
}
