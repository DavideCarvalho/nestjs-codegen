import { mkdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { ValidationAdapter } from '../adapters/types.js';
import type { ResolvedFormsConfig } from '../config/types.js';
import type { RouteDescriptor, TypeRef } from '../discovery/types.js';

/**
 * Emits `forms.ts` into `outDir`. Every validatable route is rendered through a
 * single {@link ValidationAdapter} path (IR → `adapter.renderModule`). The adapter
 * is required — `validation` is a mandatory config field.
 *
 * Two schema sources exist per route:
 *  - Neutral IR (`bodySchema`/`querySchema`) synthesized from class-validator
 *    DTOs — renderable through ANY adapter.
 *  - Hand-written zod from `defineContract` (`bodyZodText`/`queryZodText` raw
 *    source, or `bodyZodRef`/`queryZodRef` re-exports). This is genuine zod
 *    source with no IR; it passes through verbatim only when the adapter sets
 *    `acceptsRawZodSource` (the zod adapter), and is skipped with a warning
 *    under any other adapter.
 *
 * Returns `true` when a `forms.ts` was written (drives the index export).
 */
export async function emitForms(
  routes: RouteDescriptor[],
  outDir: string,
  config: ResolvedFormsConfig | undefined,
  adapter: ValidationAdapter,
): Promise<boolean> {
  if (config && config.enabled === false) return false;

  const content = buildFormsFileWithAdapter(routes, outDir, adapter, config);
  if (content === null) return false;
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, 'forms.ts'), content, 'utf8');
  return true;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** PascalCase from a single dot/identifier segment. */
function pascal(segment: string): string {
  return segment
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
}

/**
 * PascalCase base name for a route. Uses the method segment (last dot-part);
 * the full dotted name is used to disambiguate collisions.
 */
function deriveBaseName(routeName: string): { method: string; full: string } {
  const segments = routeName.split('.');
  const method = pascal(segments[segments.length - 1] ?? routeName);
  const full = segments.map(pascal).join('');
  return { method, full };
}

/** Relative import specifier from outDir to a source file (no extension). */
function relImport(outDir: string, filePath: string): string {
  let relPath = relative(outDir, filePath).replace(/\.ts$/, '');
  if (!relPath.startsWith('.')) relPath = `./${relPath}`;
  return relPath;
}

/** The root identifier of a ref name like `loginContract.body` → `loginContract`. */
function refRootIdentifier(refName: string): string {
  return refName.split('.')[0] ?? refName;
}

/**
 * A renderable form schema source. The IR is preferred (works through any
 * adapter); `zodText`/`zodRef` are the zod-only `defineContract` fallbacks.
 */
interface FormSource {
  /** Neutral IR — rendered via the active adapter. */
  schema?: import('../ir/schema-node.js').SchemaModule | null;
  /** Raw zod source text (defineContract inline / synthesized). */
  zodText?: string | null;
  /** Importable named const re-export (defineContract Path A). */
  zodRef?: TypeRef | null;
}

function hasSource(src: FormSource): boolean {
  return !!(src.schema || src.zodText || src.zodRef);
}

// ---------------------------------------------------------------------------
// Nested-schema hoisting: dedup + collision disambiguation + recursion guard.
// (Used for the zod-only `formNestedSchemas` text path.)
// ---------------------------------------------------------------------------

interface FormEntry {
  routeName: string;
  baseName: string;
  body: FormSource | undefined;
  query: FormSource | undefined;
  /** zod-only nested schemas (name → zod text) for the text path. */
  nestedSchemas: Record<string, string> | null;
  warnings: string[];
}

interface NestedSchemaPlan {
  globalSchemas: Map<string, string>;
  renamesByEntry: Map<FormEntry, Map<string, string>>;
}

function applyRenames(text: string, renames: Map<string, string> | null): string {
  if (!renames || renames.size === 0) return text;
  let out = text;
  for (const [from, to] of renames) {
    if (from === to) continue;
    out = out.replace(new RegExp(`\\b${escapeRegExp(from)}\\b`, 'g'), to);
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isSelfReferential(name: string, text: string): boolean {
  return new RegExp(`\\b${escapeRegExp(name)}\\b`).test(text);
}

/**
 * Build the global hoist registry + per-entry renames for zod-only nested
 * schema texts. See the original design notes: each unique (name, shape) is
 * declared once; same-name different-shape is suffixed; recursion is degraded.
 */
function planNestedSchemas(entries: FormEntry[]): NestedSchemaPlan {
  const globalSchemas = new Map<string, string>();
  const renamesByEntry = new Map<FormEntry, Map<string, string>>();

  for (const entry of entries) {
    if (!entry.nestedSchemas) continue;
    const local = Object.entries(entry.nestedSchemas);
    if (local.length === 0) continue;

    const rename = new Map<string, string>();
    for (const [name] of local) rename.set(name, name);

    const textFor = (name: string): string => {
      const raw = entry.nestedSchemas?.[name] ?? '';
      return applyRenames(raw, rename);
    };

    let changed = true;
    let guard = 0;
    while (changed && guard < local.length + 2) {
      changed = false;
      guard += 1;
      for (const [name] of local) {
        const finalName = rename.get(name) ?? name;
        const text = textFor(name);
        const existing = globalSchemas.get(finalName);
        if (existing === undefined) continue;
        if (existing === text) continue;
        let i = 2;
        let candidate = `${name}_${i}`;
        while (
          (globalSchemas.has(candidate) && globalSchemas.get(candidate) !== textFor(name)) ||
          [...rename.values()].includes(candidate)
        ) {
          i += 1;
          candidate = `${name}_${i}`;
        }
        rename.set(name, candidate);
        changed = true;
      }
    }

    for (const [name] of local) {
      const finalName = rename.get(name) ?? name;
      let text = textFor(name);
      if (isSelfReferential(finalName, text)) {
        text = 'z.unknown() /* recursive type — not expanded */';
      }
      const existing = globalSchemas.get(finalName);
      if (existing === undefined) {
        globalSchemas.set(finalName, text);
      }
    }

    renamesByEntry.set(entry, rename);
  }

  return { globalSchemas, renamesByEntry };
}

// ---------------------------------------------------------------------------
// Single adapter-driven forms builder
// ---------------------------------------------------------------------------

/**
 * Render `forms.ts` from the neutral validation IR via `adapter`, plus the
 * zod-only `defineContract` text/ref fallbacks (zod adapter only). Returns
 * `null` when nothing to emit.
 */
function buildFormsFileWithAdapter(
  routes: RouteDescriptor[],
  outDir: string,
  adapter: ValidationAdapter,
  config?: ResolvedFormsConfig,
): string | null {
  const acceptsRawZod = adapter.acceptsRawZodSource === true;
  const sorted = [...routes].filter((r) => r.contract).sort((a, b) => a.name.localeCompare(b.name));

  // Base-name collision pass (method-only name vs full dotted name).
  const methodNameCounts = new Map<string, number>();
  const candidates: FormEntry[] = [];
  for (const route of sorted) {
    const cs = route.contract!.contractSource;
    const body: FormSource = {
      schema: cs.bodySchema ?? null,
      zodText: cs.bodyZodText ?? null,
      zodRef: cs.bodyZodRef ?? null,
    };
    const query: FormSource = {
      schema: cs.querySchema ?? null,
      zodText: cs.queryZodText ?? null,
      zodRef: cs.queryZodRef ?? null,
    };
    if (!hasSource(body) && !hasSource(query)) continue;
    const { method, full } = deriveBaseName(route.name);
    methodNameCounts.set(method, (methodNameCounts.get(method) ?? 0) + 1);
    candidates.push({
      routeName: route.name,
      baseName: full, // resolved below
      body: hasSource(body) ? body : undefined,
      query: hasSource(query) ? query : undefined,
      nestedSchemas: cs.formNestedSchemas ?? null,
      warnings: cs.formWarnings ?? [],
    });
  }

  const entries: FormEntry[] = candidates.map((c) => {
    const { method, full } = deriveBaseName(c.routeName);
    const collision = (methodNameCounts.get(method) ?? 0) > 1;
    return { ...c, baseName: collision ? full : method };
  });

  if (entries.length === 0) return null;

  // Re-export imports (zod-only refs without inline text), grouped by file.
  const importsByFile = new Map<string, Set<string>>();
  const refAlias = new Map<string, string>();
  for (const entry of entries) {
    for (const src of [entry.body, entry.query]) {
      if (src?.zodRef && !src.zodText && !src.schema) {
        const root = refRootIdentifier(src.zodRef.name);
        const set = importsByFile.get(src.zodRef.filePath) ?? new Set<string>();
        set.add(root);
        importsByFile.set(src.zodRef.filePath, set);
      }
    }
  }

  const importLines: string[] = [];
  if (importsByFile.size > 0) {
    const emitted = new Set<string>();
    for (const [filePath, roots] of [...importsByFile.entries()].sort()) {
      const relPath = relImport(outDir, filePath);
      const specifiers: string[] = [];
      for (const root of [...roots].sort()) {
        if (emitted.has(root)) {
          const alias = `${root}_${emitted.size}`;
          specifiers.push(`${root} as ${alias}`);
          emitted.add(alias);
          refAlias.set(`${filePath}\0${root}`, alias);
        } else {
          specifiers.push(root);
          emitted.add(root);
          refAlias.set(`${filePath}\0${root}`, root);
        }
      }
      importLines.push(`import { ${specifiers.join(', ')} } from '${relPath}';`);
    }
  }

  // Hoist zod-only nested schemas (text path) once, with collision handling.
  const { globalSchemas, renamesByEntry } = planNestedSchemas(entries);

  // Hoisted IR nested schemas (rendered via adapter, deduped by name).
  const irNamed = new Map<string, string>();
  // Recursive-schema extras (zod/valibot): hoisted TS type alias + const annotation.
  const irTypeAliases = new Map<string, string>();
  const irAnnotations = new Map<string, string>();
  const decls: string[] = [];
  const mapEntries: string[] = [];
  let used = false;

  const renderSource = (
    src: FormSource,
    rename: Map<string, string> | null,
  ): { text: string; warn?: string } | null => {
    // Prefer the neutral IR — works through any adapter.
    if (src.schema) {
      const r = adapter.renderModule(src.schema);
      for (const [n, t] of r.namedNestedSchemas) irNamed.set(n, t);
      if (r.namedTypeAliases) for (const [n, t] of r.namedTypeAliases) irTypeAliases.set(n, t);
      if (r.namedAnnotations) for (const [n, a] of r.namedAnnotations) irAnnotations.set(n, a);
      return { text: r.schemaText };
    }
    // zod-only defineContract fallbacks: text or re-export ref.
    if (src.zodText) {
      if (!acceptsRawZod) {
        return {
          text: '',
          warn: `is a defineContract (zod) schema; not translated to ${adapter.name} — use the zod adapter.`,
        };
      }
      return { text: applyRenames(src.zodText, rename) };
    }
    if (src.zodRef) {
      if (!acceptsRawZod) {
        return {
          text: '',
          warn: `is a defineContract (zod) schema; not translated to ${adapter.name} — use the zod adapter.`,
        };
      }
      const root = refRootIdentifier(src.zodRef.name);
      const alias = refAlias.get(`${src.zodRef.filePath}\0${root}`) ?? root;
      const member = src.zodRef.name.slice(root.length);
      return { text: `${alias}${member}` };
    }
    return null;
  };

  for (const entry of entries) {
    const block: string[] = [];
    const rename = renamesByEntry.get(entry) ?? null;
    let bodyConst: string | undefined;

    if (entry.warnings && entry.warnings.length > 0) {
      for (const w of entry.warnings) block.push(`// warning: ${w}`);
    }

    if (entry.body) {
      const rendered = renderSource(entry.body, rename);
      if (rendered?.warn) {
        block.push(`// warning: ${entry.routeName} body ${rendered.warn}`);
      } else if (rendered) {
        used = true;
        bodyConst = `${entry.baseName}BodySchema`;
        block.push(`export const ${bodyConst} = ${rendered.text};`);
        block.push(`export type ${entry.baseName}Body = ${adapter.inferType(bodyConst)};`);
      }
    }
    if (entry.query) {
      const rendered = renderSource(entry.query, rename);
      if (rendered?.warn) {
        block.push(`// warning: ${entry.routeName} query ${rendered.warn}`);
      } else if (rendered) {
        used = true;
        const queryConst = `${entry.baseName}QuerySchema`;
        block.push(`export const ${queryConst} = ${rendered.text};`);
        block.push(`export type ${entry.baseName}Query = ${adapter.inferType(queryConst)};`);
      }
    }

    if (block.length === 0) continue;
    decls.push(`// ${entry.routeName}`, ...block, '');
    if (bodyConst) mapEntries.push(`  ${JSON.stringify(entry.routeName)}: ${bodyConst},`);
  }

  if (!used) return null;

  const lines: string[] = ['// Generated by @dudousxd/nestjs-codegen. Do not edit.'];
  if (acceptsRawZod) {
    const zodImport = config?.zodImport ?? 'zod';
    lines.push(`import { z } from '${zodImport}';`);
  } else {
    for (const imp of adapter.importStatements({ used: true })) lines.push(imp);
  }
  lines.push(...importLines);
  lines.push('');

  // Merge hoisted nested schemas: zod-only text path + IR-rendered nested.
  const allNested = new Map<string, string>();
  for (const [n, t] of globalSchemas) allNested.set(n, t);
  for (const [n, t] of irNamed) if (!allNested.has(n)) allNested.set(n, t);

  if (allNested.size > 0) {
    lines.push('// Hoisted nested schemas (shared across endpoints).');
    // Recursive schemas (zod/valibot) need their structural TS type hoisted so
    // the const can be annotated — this breaks the implicit-any self-reference
    // cycle that a bare `const X = ...lazy(() => X)...` would trigger.
    for (const [n, alias] of irTypeAliases) {
      if (allNested.has(n)) lines.push(`${alias};`);
    }
    for (const [n, t] of allNested) {
      const annotation = irAnnotations.get(n);
      lines.push(`const ${n}${annotation ? `: ${annotation}` : ''} = ${t};`);
    }
    lines.push('');
  }

  lines.push(...decls);
  lines.push('/** Route name → body schema map. */');
  lines.push('export const formSchemas = {');
  lines.push(...mapEntries);
  lines.push('} as const;');
  lines.push('');
  return lines.join('\n');
}
