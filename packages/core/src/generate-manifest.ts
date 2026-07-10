import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import fg from 'fast-glob';
import type { ResolvedConfig } from './config/types.js';
import { VERSION } from './index.js';

/** File name of the manifest persisted alongside generated output in `outDir`. */
export const MANIFEST_FILE = '.codegen-manifest.json';

/** Lock file name, excluded from the recorded output set (it is not generated output). */
const LOCK_FILE = '.watcher.lock';

/**
 * Which entry point produced a generate pass: the one-shot/`--watch` CLI
 * (reads `nestjs-codegen.config.ts` from disk), or the Nest module
 * (`NestjsCodegenModule.forRoot()`, options passed in-process). Recorded in
 * the manifest so {@link CodegenManifest.configHash} drift between the two can
 * be detected — see {@link DriftGuardError}.
 */
export type EntryPoint = 'cli' | 'module';

/**
 * Thrown by `generate()` when the drift guard (see `driftGuard` in
 * {@link import('./config/types.js').UserConfig}) detects that the CLI and the
 * Nest module are writing the same `outDir` from two different resolved
 * configs. Distinguished from a generic `Error` so callers (the watcher's
 * initial-pass fallback) can single it out instead of treating it as a
 * transient discovery failure to retry.
 */
export class DriftGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DriftGuardError';
  }
}

/**
 * Persisted record of the last successful generate, written to
 * `<outDir>/.codegen-manifest.json`. Used to skip regeneration when nothing
 * relevant changed (see {@link isManifestFresh}), and to detect CLI↔module
 * config drift (see {@link DriftGuardError}).
 */
export interface CodegenManifest {
  /** Lib version that produced the output. A lib upgrade invalidates the manifest. */
  version: string;
  /** Content hash over all generate inputs (source files + resolved config + version). */
  hash: string;
  /**
   * Which entry point produced this manifest. Absent on manifests written before
   * this field existed — treated as "unknown", which never trips the drift guard.
   */
  entryPoint?: EntryPoint;
  /**
   * Hash of ONLY the serialized resolved config (not source files / version) —
   * a narrower signal than {@link hash}, used to tell "same config, different
   * entry point" (fine) apart from "different config" (drift) regardless of
   * unrelated source-file changes. Absent on pre-drift-guard manifests.
   */
  configHash?: string;
  /** Generated output files, relative to `outDir`, recorded after the last run. */
  files: string[];
}

interface ManifestShape {
  version: string;
  hash: string;
  entryPoint?: EntryPoint;
  configHash?: string;
  files: string[];
}

function isEntryPoint(value: unknown): value is EntryPoint {
  return value === 'cli' || value === 'module';
}

function isManifestShape(value: unknown): value is ManifestShape {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.version !== 'string') return false;
  if (typeof candidate.hash !== 'string') return false;
  if (candidate.entryPoint !== undefined && !isEntryPoint(candidate.entryPoint)) return false;
  if (candidate.configHash !== undefined && typeof candidate.configHash !== 'string') return false;
  if (!Array.isArray(candidate.files)) return false;
  return candidate.files.every((entry) => typeof entry === 'string');
}

/**
 * Stable JSON serialization of the resolved config for hashing. Functions
 * (extensions, validation adapter methods, component-name strategies) are folded
 * in via `toString()` so a change to their source invalidates the hash; anything
 * non-serializable degrades to a marker rather than throwing.
 */
function serializeConfig(config: ResolvedConfig): string {
  try {
    return JSON.stringify(config, (_key, value) => {
      if (typeof value === 'function') return `[fn:${value.name}]${value.toString()}`;
      return value;
    });
  } catch {
    // Non-serializable config (e.g. a cyclic extension) — fall back to a coarse
    // marker so the hash still varies by a few stable fields. Worst case the
    // skip never triggers and we always regenerate, which is safe.
    return `unserializable:${config.codegen.outDir}:${config.contracts.glob}`;
  }
}

/**
 * Globs the input source files that determine generate output: controllers
 * (`contracts.glob`), DTOs (`forms.watch`), and — when configured — Inertia pages
 * (`pages.glob`). All resolved relative to `config.codegen.cwd`.
 */
async function discoverInputFiles(config: ResolvedConfig): Promise<string[]> {
  const globs = [config.contracts.glob, config.forms.watch];
  if (config.pages) globs.push(config.pages.glob);

  const cwd = config.codegen.cwd;
  const matched = await fg(globs, { cwd, absolute: true, onlyFiles: true });
  // Sort for a deterministic hash regardless of glob/FS ordering.
  return [...new Set(matched)].sort();
}

/**
 * Compute a content hash over everything that determines generate output: the
 * contents of all discovered input source files, the serialized resolved config,
 * and the lib version. A change to any input — a controller edit, a config tweak,
 * or a lib upgrade — produces a different hash.
 */
export async function computeInputsHash(config: ResolvedConfig): Promise<string> {
  const hash = createHash('sha256');
  hash.update(`version:${VERSION}\n`);
  hash.update(`config:${serializeConfig(config)}\n`);

  const inputFiles = await discoverInputFiles(config);
  const cwd = config.codegen.cwd;
  for (const file of inputFiles) {
    const contents = await readFile(file, 'utf8');
    // Hash the relative path too, so a rename (same contents) still invalidates.
    hash.update(`file:${relative(cwd, file)}\n`);
    hash.update(contents);
    hash.update('\n');
  }

  return hash.digest('hex');
}

/** Read and validate the manifest in `outDir`, or `null` if absent/unreadable/malformed. */
export async function readManifest(outDir: string): Promise<CodegenManifest | null> {
  try {
    const raw = await readFile(join(outDir, MANIFEST_FILE), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!isManifestShape(parsed)) return null;
    return {
      version: parsed.version,
      hash: parsed.hash,
      ...(parsed.entryPoint ? { entryPoint: parsed.entryPoint } : {}),
      ...(parsed.configHash ? { configHash: parsed.configHash } : {}),
      files: parsed.files,
    };
  } catch {
    return null;
  }
}

/**
 * Hash of ONLY the serialized resolved config — narrower than
 * {@link computeInputsHash} (which also folds in source-file contents and the
 * lib version). Used by the drift guard to tell "same config, different entry
 * point" apart from an actual config divergence between the CLI and the Nest
 * module, independent of unrelated source-file edits.
 */
export function computeConfigHash(config: ResolvedConfig): string {
  return createHash('sha256').update(serializeConfig(config)).digest('hex');
}

/** Write the manifest to `outDir`. */
export async function writeManifest(outDir: string, manifest: CodegenManifest): Promise<void> {
  await writeFile(join(outDir, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

/**
 * List the generated output files currently in `outDir` (recursively), relative to
 * `outDir`. The manifest and the watcher lock are excluded — they are bookkeeping,
 * not generated output.
 */
export async function listOutputFiles(outDir: string): Promise<string[]> {
  const found: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
      } else if (entry.isFile()) {
        const rel = relative(outDir, abs);
        if (rel === MANIFEST_FILE || rel === LOCK_FILE) continue;
        found.push(rel);
      }
    }
  }

  await walk(outDir);
  return found.sort();
}

/** True when every path (relative to `outDir`) still exists on disk. */
async function allOutputsExist(outDir: string, files: string[]): Promise<boolean> {
  const present = new Set(await listOutputFiles(outDir));
  return files.every((file) => present.has(file));
}

/**
 * Decide whether the persisted manifest still matches the current inputs: same lib
 * version, same content hash, and every recorded output file still on disk. When
 * true, the caller may skip the generate entirely.
 */
export async function isManifestFresh(
  outDir: string,
  manifest: CodegenManifest | null,
  inputsHash: string,
): Promise<boolean> {
  if (manifest === null) return false;
  if (manifest.version !== VERSION) return false;
  if (manifest.hash !== inputsHash) return false;
  if (manifest.files.length === 0) return false;
  return allOutputsExist(outDir, manifest.files);
}
