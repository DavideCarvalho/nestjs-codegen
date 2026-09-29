import { readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import fg from 'fast-glob';

import type { PageNameStrategy, ResolvedConfig } from '../config/types.js';

export interface DiscoveredPage {
  name: string;
  absolutePath: string;
  relativePath: string;
  propsSource: string | null;
  /** The Inertia scope the page belongs to: `'default'` (forRoot) or a `pages.scopes` key. */
  scope?: string;
}

export interface DiscoverPagesOptions {
  glob: string | string[];
  cwd: string;
  propsExport: string;
  componentNameStrategy: PageNameStrategy;
  /** Prepended to every discovered page name (a scope's `'<scope>/'`). Default `''`. */
  prefix?: string;
  /** Recorded on each page. Default `'default'`. */
  scope?: string;
}

// Files matching these patterns are never treated as Inertia pages even if
// they sit inside the pages directory and would match the user's glob.
// Without this filter, vitest test files (`*.test.tsx`) get registered as
// pages, their imports get pulled into the typecheck graph, and any
// transitive matcher errors leak into the user's project.
const NON_PAGE_FILE_RE = /\.(?:test|spec|stories|story)\.(?:tsx?|jsx?|vue|svelte)$/i;

/** A path segment with glob syntax in it (`*`, `?`, braces, brackets, extglob parens, `!`). */
const MAGIC_SEGMENT_RE = /[*?{}[\]()!]/;

/**
 * The static base of a glob: its leading segments up to the first one with glob syntax.
 * `inertia/pages/**\/*.tsx` → `inertia/pages`; `../{web,admin}/pages/**` → `..`.
 */
export function globStaticBase(glob: string): string {
  const segments = glob.split('/');
  const staticSegments: string[] = [];
  for (const segment of segments.slice(0, -1)) {
    if (MAGIC_SEGMENT_RE.test(segment)) break;
    staticSegments.push(segment);
  }
  return staticSegments.join('/');
}

/**
 * Discover the pages matched by one glob or several. Each page is named relative to the static
 * base of the glob that matched it (the first one, when several match the same file). Two files
 * that come out with the same name are an error: the page registry would silently keep one.
 */
export async function discoverPages(opts: DiscoverPagesOptions): Promise<DiscoveredPage[]> {
  const globs = typeof opts.glob === 'string' ? [opts.glob] : opts.glob;
  const prefix = opts.prefix ?? '';
  const scope = opts.scope ?? 'default';
  const seenFiles = new Set<string>();
  const out: DiscoveredPage[] = [];
  for (const glob of globs) {
    const files = (await fg(glob, { cwd: opts.cwd, absolute: true }))
      .filter((f) => !NON_PAGE_FILE_RE.test(f) && !seenFiles.has(f))
      .sort();
    // Page names are relative to the pages directory: glob 'inertia/pages/**/*.tsx' →
    // base 'inertia/pages', so inertia/pages/users/Show.tsx → 'users/Show'.
    const pagesBase = join(opts.cwd, globStaticBase(glob));
    for (const file of files) {
      seenFiles.add(file);
      const rel = relative(opts.cwd, file);
      const nameRel = relative(pagesBase, file).split(sep).join('/');
      const name = `${prefix}${computeName(nameRel, opts.componentNameStrategy)}`;
      const source = await readFile(file, 'utf8');
      const propsSource = extractPropsSource(source, opts.propsExport);
      out.push({ name, absolutePath: file, relativePath: rel, propsSource, scope });
    }
  }
  assertUniqueNames(out);
  return out;
}

/**
 * Discover the pages of every Inertia app in the config: the default app (`pages.glob`) and
 * each `pages.scopes` entry, whose page names carry its prefix. Returns `[]` without `pages`.
 */
export async function discoverPageScopes(config: ResolvedConfig): Promise<DiscoveredPage[]> {
  const pages = config.pages;
  if (!pages) return [];
  const common = { cwd: config.codegen.cwd, propsExport: pages.propsExport };
  const out = await discoverPages({
    ...common,
    glob: pages.glob,
    componentNameStrategy: pages.componentNameStrategy,
  });
  for (const [scope, scopeConfig] of Object.entries(pages.scopes ?? {})) {
    out.push(
      ...(await discoverPages({
        ...common,
        glob: scopeConfig.glob,
        componentNameStrategy: scopeConfig.componentNameStrategy,
        prefix: scopeConfig.prefix,
        scope,
      })),
    );
  }
  assertUniqueNames(out);
  return out;
}

/** Every page glob in the config (default app and scopes), for the watcher. */
export function allPageGlobs(config: ResolvedConfig): string[] {
  if (!config.pages) return [];
  const asList = (glob: string | string[]) => (typeof glob === 'string' ? [glob] : glob);
  return [
    ...asList(config.pages.glob),
    ...Object.values(config.pages.scopes ?? {}).flatMap((scope) => asList(scope.glob)),
  ];
}

function assertUniqueNames(pages: DiscoveredPage[]): void {
  const byName = new Map<string, DiscoveredPage>();
  for (const page of pages) {
    const previous = byName.get(page.name);
    if (previous) {
      throw new Error(
        `Two Inertia pages resolve to the component name "${page.name}": ${previous.relativePath} (scope "${previous.scope}") and ${page.relativePath} (scope "${page.scope}"). Give one of them another name, directory or scope prefix.`,
      );
    }
    byName.set(page.name, page);
  }
}

function computeName(rel: string, strat: PageNameStrategy): string {
  if (typeof strat === 'function') return strat(rel);
  const noExt = rel.replace(/\.(tsx?|vue|svelte)$/, '');
  if (strat === 'kebab') return noExt.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
  return noExt;
}

function extractPropsSource(source: string, exportName: string): string | null {
  const re = new RegExp(`export\\s+type\\s+${exportName}\\s*=\\s*`, 'm');
  const m = source.match(re);
  if (!m) return null;
  const start = m.index! + m[0].length;
  // Brace counting to capture type body
  let i = start;
  let depth = 0;
  let started = false;
  while (i < source.length) {
    const c = source[i];
    if (c === '{') {
      depth++;
      started = true;
    } else if (c === '}') {
      depth--;
      if (started && depth === 0) {
        return source.slice(start, i + 1);
      }
    } else if (c === ';' && !started) return source.slice(start, i);
    i++;
  }
  return source.slice(start);
}
