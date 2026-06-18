import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import chokidar from 'chokidar';
import type { ResolvedConfig } from '../config/types.js';
import { PersistentDiscovery } from '../discovery/contracts-fast.js';
import type { RouteDescriptor } from '../discovery/types.js';
import { generate } from '../generate.js';
import { acquireLock } from './lock-file.js';

const PAGES_DEBOUNCE_MS = 150;

export interface Watcher {
  close(): Promise<void>;
}

/** No-op watcher returned when the lock is already held. */
const NO_OP_WATCHER: Watcher = { close: async () => {} };

/**
 * Start two chokidar watchers:
 *
 * 1. **Pages watcher** (`config.pages.glob`, 150 ms debounce) — runs `generate(config)` on
 *    any page file change, regenerating `pages.d.ts` and the cache manifest.
 *
 * 2. **Contracts watcher** (`config.contracts.glob`, configurable debounce — default 500 ms) —
 *    re-runs static AST route discovery via ts-morph, then re-emits `routes.ts` and (when
 *    contracts are present) `api.ts` + `index.d.ts`.
 *
 * Both watchers share a single lock file in `config.codegen.outDir`. If another live process
 * already holds the lock, logs a warning and returns a no-op watcher.
 */
export async function watch(config: ResolvedConfig, onChange?: () => void): Promise<Watcher> {
  const lock = await acquireLock(config.codegen.outDir);

  if (lock === null) {
    // Read the lock file to include the PID in the warning message
    let holderPid = 'unknown';
    try {
      const raw = await readFile(join(config.codegen.outDir, '.watcher.lock'), 'utf8');
      const data = JSON.parse(raw) as { pid?: number };
      if (data.pid !== undefined) holderPid = String(data.pid);
    } catch {
      // Lock file unreadable — fall back to generic warning
    }
    console.warn(
      `[nestjs-codegen] auto-watch skipped — another process (PID ${holderPid}) is already running the watcher in ${config.codegen.outDir}. Files will continue to regenerate from that process. To take over, stop the other watcher.`,
    );
    return NO_OP_WATCHER;
  }

  // Persistent ts-morph Project reused across every contract/DTO change. Built
  // once here; each change refreshes only the changed file(s) instead of
  // reconstructing the Project and re-parsing all controllers + DTOs. Lazily
  // (re)initialised so an initial-pass failure doesn't permanently disable it.
  let discovery: PersistentDiscovery | null = null;
  async function getDiscovery(): Promise<PersistentDiscovery> {
    if (discovery === null) {
      discovery = await PersistentDiscovery.create({
        cwd: config.codegen.cwd,
        glob: config.contracts.glob,
        ...(config.app?.tsconfig ? { tsconfig: config.app.tsconfig } : {}),
      });
      return discovery;
    }
    return discovery;
  }

  // Run an initial full pass: pages + routes + contracts (same as a one-shot `codegen` run)
  try {
    const initialRoutes = (await getDiscovery()).discover();
    await generate(config, initialRoutes);
  } catch (err) {
    // Best-effort; don't crash the watcher on initial generation failure
    console.warn(
      `[nestjs-codegen] Initial route discovery failed, falling back to pages-only: ${err instanceof Error ? err.message : String(err)}`,
    );
    try {
      await generate(config);
    } catch {
      /* fallback: pages only */
    }
  }

  // ── Pages watcher (fast path — no route discovery) ──────────────────────────
  let pagesDebounceTimer: ReturnType<typeof setTimeout> | undefined;

  // No `pages` config → watch a path that matches nothing (pages are Inertia-only).
  const pagesGlob = config.pages?.glob ?? '.nestjs-codegen-no-pages';
  const pagesWatcher = chokidar.watch(join(config.codegen.cwd, pagesGlob), {
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 20 },
  });

  function schedulePagesRegenerate(): void {
    if (pagesDebounceTimer !== undefined) {
      clearTimeout(pagesDebounceTimer);
    }
    pagesDebounceTimer = setTimeout(async () => {
      pagesDebounceTimer = undefined;
      try {
        await generate(config);
      } catch (err) {
        console.error(
          '[nestjs-codegen] Pages generation failed:',
          err instanceof Error ? err.message : err,
        );
      }
      onChange?.();
    }, PAGES_DEBOUNCE_MS);
  }

  pagesWatcher.on('add', schedulePagesRegenerate);
  pagesWatcher.on('change', schedulePagesRegenerate);
  pagesWatcher.on('unlink', schedulePagesRegenerate);

  // ── Contracts watcher (static AST discovery via ts-morph) ────────────────────
  let contractsDebounceTimer: ReturnType<typeof setTimeout> | undefined;
  // Absolute paths changed since the last rediscovery, accumulated across the
  // debounce window so a burst of edits refreshes every touched file exactly once.
  const pendingChangedPaths = new Set<string>();

  const contractsWatcher = chokidar.watch(join(config.codegen.cwd, config.contracts.glob), {
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 20 },
  });

  function scheduleContractsRegenerate(changedPath?: string): void {
    if (typeof changedPath === 'string') pendingChangedPaths.add(changedPath);
    if (contractsDebounceTimer !== undefined) {
      clearTimeout(contractsDebounceTimer);
    }
    contractsDebounceTimer = setTimeout(async () => {
      contractsDebounceTimer = undefined;
      const changed = [...pendingChangedPaths];
      pendingChangedPaths.clear();
      try {
        // Reuse the persistent Project: refresh only the changed file(s), re-glob
        // for added/removed controllers, then re-extract. Avoids reconstructing
        // the Project and re-parsing every controller + DTO on each change.
        const routes: RouteDescriptor[] = await (await getDiscovery()).rediscover(changed);

        // Route through generate() so the incremental pass honors the SAME emit
        // options as the initial pass (query / mutationClient / queryImport / fetcher
        // importPath + the validation adapter). Emitting api.ts/forms.ts directly here
        // would silently drop those settings on every contract edit.
        await generate(config, routes);
      } catch (err) {
        console.error(
          '[nestjs-codegen] Contracts generation failed:',
          err instanceof Error ? err.message : err,
        );
      }
      onChange?.();
    }, config.contracts.debounceMs);
  }

  contractsWatcher.on('add', (p) => scheduleContractsRegenerate(p));
  contractsWatcher.on('change', (p) => scheduleContractsRegenerate(p));
  contractsWatcher.on('unlink', (p) => scheduleContractsRegenerate(p));

  // ── DTO watcher (forms.ts synthesis from class-validator DTOs) ───────────────
  // DTO classes live in *.dto.ts files (not matched by the controller glob), but
  // changes to them affect the synthesized form schemas. Re-run discovery (which
  // re-emits forms.ts) on any DTO change, reusing the contracts debounce.
  const formsWatcher = chokidar.watch(join(config.codegen.cwd, config.forms.watch), {
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 20 },
  });

  formsWatcher.on('add', (p) => scheduleContractsRegenerate(p));
  formsWatcher.on('change', (p) => scheduleContractsRegenerate(p));
  formsWatcher.on('unlink', (p) => scheduleContractsRegenerate(p));

  return {
    close: async () => {
      if (pagesDebounceTimer !== undefined) {
        clearTimeout(pagesDebounceTimer);
        pagesDebounceTimer = undefined;
      }
      if (contractsDebounceTimer !== undefined) {
        clearTimeout(contractsDebounceTimer);
        contractsDebounceTimer = undefined;
      }
      await pagesWatcher.close();
      await contractsWatcher.close();
      await formsWatcher.close();
      await lock.release();
    },
  };
}
