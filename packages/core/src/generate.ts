import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Project } from 'ts-morph';
import type { ResolvedConfig } from './config/types.js';
import { discoverPages } from './discovery/pages.js';
import type { SharedPropsResult } from './discovery/shared-props.js';
import { discoverSharedProps } from './discovery/shared-props.js';
import type { RouteDescriptor } from './discovery/types.js';
import { emitApi } from './emit/emit-api.js';
import { emitCache } from './emit/emit-cache.js';
import { emitForms } from './emit/emit-forms.js';
import { emitIndex } from './emit/emit-index.js';
import { emitPages } from './emit/emit-pages.js';
import { emitRoutes } from './emit/emit-routes.js';
import {
  applyTransformRoutes,
  collectEmittedFiles,
  createExtensionContext,
} from './extension/registry.js';

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

    let sharedProps: SharedPropsResult | null = null;
    if (config.app?.moduleEntry) {
      try {
        const tsconfigPath = config.app.tsconfig ?? join(config.codegen.cwd, 'tsconfig.json');
        let project: Project;
        try {
          project = new Project({
            tsConfigFilePath: tsconfigPath,
            skipAddingFilesFromTsConfig: true,
            skipLoadingLibFiles: true,
            skipFileDependencyResolution: true,
          });
        } catch {
          project = new Project({
            skipAddingFilesFromTsConfig: true,
            skipLoadingLibFiles: true,
            skipFileDependencyResolution: true,
            compilerOptions: { allowJs: true, strict: false },
          });
        }
        sharedProps = discoverSharedProps(project, config.app.moduleEntry);
      } catch {
        // Graceful fallback — skip shared props if anything goes wrong
      }
    }

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
      extensions,
      ctx,
    });
  }

  const hasForms = await emitForms(routes, config.codegen.outDir, config.forms, config.validation);

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
