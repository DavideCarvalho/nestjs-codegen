import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  type ClassDeclaration,
  type InterfaceDeclaration,
  Node,
  type Project,
  type SourceFile,
  type TypeNode,
} from 'ts-morph';
import type { TypeRef } from './types.js';

/**
 * Type-reference resolution: the leaf module of the discovery DAG. Owns the
 * per-invocation discovery context (project root + tsconfig path aliases) and
 * the "follow a name/TypeNode to its declaring file" machinery shared by every
 * other discovery module.
 */

// ---------------------------------------------------------------------------
// Discovery context — scoped per `discoverContractsFast` invocation.
// Keyed off the per-invocation ts-morph `Project` (every resolution entry point
// already threads it), so concurrent invocations each get an isolated context
// with no shared mutable global to corrupt.
// ---------------------------------------------------------------------------

export interface DiscoveryContext {
  projectRoot: string;
  tsconfigPaths: Record<string, string[]> | null;
}

const _EMPTY_CTX: DiscoveryContext = { projectRoot: '', tsconfigPaths: null };

/** Per-`Project` discovery context. WeakMap so contexts die with their project. */
const _ctxByProject = new WeakMap<Project, DiscoveryContext>();

/** Associate a discovery context with a `Project` for the duration of a run. */
export function setDiscoveryContext(project: Project, ctx: DiscoveryContext): void {
  _ctxByProject.set(project, ctx);
}

function _ctxFor(project: Project): DiscoveryContext {
  return _ctxByProject.get(project) ?? _EMPTY_CTX;
}

const _debug = process.env.NESTJS_INERTIA_DEBUG === '1';
export function dbg(...args: unknown[]) {
  if (_debug) console.log('[codegen:debug]', ...args);
}

export function loadTsconfigPaths(tsconfigPath: string): Record<string, string[]> | null {
  try {
    const raw = readFileSync(tsconfigPath, 'utf8');
    // Strip single-line comments (tsconfig allows them)
    const stripped = raw.replace(/\/\/.*$/gm, '');
    const parsed = JSON.parse(stripped) as {
      compilerOptions?: { paths?: Record<string, string[]> };
    };
    return parsed.compilerOptions?.paths ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Type-declaration lookup
// ---------------------------------------------------------------------------

export type TypeDeclResult =
  | { kind: 'class'; decl: ClassDeclaration; file: SourceFile }
  | { kind: 'interface'; decl: InterfaceDeclaration; file: SourceFile }
  | { kind: 'typeAlias'; typeNode: TypeNode | undefined; file: SourceFile; text: string }
  | { kind: 'enum'; members: string[] };

/**
 * Try to find a type declaration (class, interface, type alias, enum) in a source file.
 */
export function findTypeInFile(name: string, file: SourceFile): TypeDeclResult | null {
  const cls = file.getClass(name);
  if (cls) return { kind: 'class', decl: cls, file };

  const iface = file.getInterface(name);
  if (iface) return { kind: 'interface', decl: iface, file };

  const alias = file.getTypeAlias(name);
  if (alias) {
    const typeNode = alias.getTypeNode();
    return {
      kind: 'typeAlias',
      typeNode,
      file,
      text: typeNode ? typeNode.getText() : 'unknown',
    };
  }

  const enumDecl = file.getEnum(name);
  if (enumDecl) {
    const members = enumDecl.getMembers().map((m) => {
      const val = m.getValue();
      // String value → quoted literal ("active"); numeric value → numeric
      // literal (1). Fall back to the member NAME only when the value can't be
      // resolved statically (e.g. a computed member).
      if (typeof val === 'string' || typeof val === 'number') return JSON.stringify(val);
      return JSON.stringify(m.getName());
    });
    return { kind: 'enum', members };
  }

  return null;
}

/**
 * Follow import declarations to find a type in another file.
 */
export function resolveModuleSpecifier(
  moduleSpecifier: string,
  sourceFile: SourceFile,
  project: Project,
): string[] {
  if (moduleSpecifier.startsWith('.')) {
    const dir = dirname(sourceFile.getFilePath());
    // Strip an explicit ESM `.js`/`.ts` extension so `./x.dto.js` resolves to
    // `./x.dto.ts` (NodeNext import style).
    const noExt = moduleSpecifier.replace(/\.(js|ts)$/, '');
    return [
      resolve(dir, `${noExt}.ts`),
      resolve(dir, `${moduleSpecifier}.ts`),
      resolve(dir, moduleSpecifier, 'index.ts'),
    ];
  }

  // Try to resolve path aliases via tsconfig paths (read directly from JSON)
  const ctx = _ctxFor(project);
  const baseUrl = ctx.projectRoot;
  const tsconfigPaths = ctx.tsconfigPaths;

  dbg(
    'resolveModuleSpecifier',
    moduleSpecifier,
    'paths:',
    JSON.stringify(tsconfigPaths),
    'baseUrl:',
    baseUrl,
  );

  if (tsconfigPaths) {
    for (const [pattern, mappings] of Object.entries(tsconfigPaths)) {
      const prefix = pattern.replace('*', '');
      if (moduleSpecifier.startsWith(prefix)) {
        const rest = moduleSpecifier.slice(prefix.length);
        const candidates: string[] = [];
        for (const mapping of mappings) {
          const resolved = resolve(baseUrl, mapping.replace('*', rest));
          candidates.push(`${resolved}.ts`, resolve(resolved, 'index.ts'));
        }
        dbg('  resolved candidates:', candidates);
        return candidates;
      }
    }
  }

  return [];
}

export function resolveImportedType(
  name: string,
  sourceFile: SourceFile,
  project: Project,
): TypeDeclResult | null {
  for (const importDecl of sourceFile.getImportDeclarations()) {
    const namedImport = importDecl.getNamedImports().find((n) => n.getName() === name);
    if (!namedImport) continue;

    const moduleSpecifier = importDecl.getModuleSpecifierValue();
    const candidates = resolveModuleSpecifier(moduleSpecifier, sourceFile, project);
    if (candidates.length === 0) continue;

    for (const candidate of candidates) {
      let importedFile = project.getSourceFile(candidate);
      if (!importedFile) {
        try {
          importedFile = project.addSourceFileAtPath(candidate);
        } catch {
          continue;
        }
      }
      const result = findTypeInFile(name, importedFile);
      if (result) return result;
      // The target module may itself re-export the symbol from elsewhere
      // (`export { X } from './mod'` or `import { X } ...; export { X }`).
      const viaReExport = resolveReExportedType(name, importedFile, project, new Set());
      if (viaReExport) return viaReExport;
    }
  }
  // The current file may re-export the symbol from another module.
  return resolveReExportedType(name, sourceFile, project, new Set());
}

/**
 * Follow `export { X } from './mod'` / `export * from './mod'` re-exports, and
 * bare `export { X }` statements that re-publish a previously-imported symbol,
 * to find a type declaration in a sibling module. Guards against import cycles
 * via `seen`.
 */
function resolveReExportedType(
  name: string,
  file: SourceFile,
  project: Project,
  seen: Set<string>,
): TypeDeclResult | null {
  const filePath = file.getFilePath();
  if (seen.has(filePath)) return null;
  seen.add(filePath);

  for (const exportDecl of file.getExportDeclarations()) {
    const moduleSpecifier = exportDecl.getModuleSpecifierValue();
    const namedExports = exportDecl.getNamedExports();

    // `export { X } from './mod'` — only follow when X (or its alias source) matches.
    if (moduleSpecifier) {
      const hasStar = namedExports.length === 0; // `export * from './mod'`
      const reExportsName = namedExports.some(
        (n) => (n.getAliasNode()?.getText() ?? n.getName()) === name,
      );
      if (!hasStar && !reExportsName) continue;
      // The source-side name (before any alias rename).
      const sourceName = hasStar
        ? name
        : (namedExports
            .find((n) => (n.getAliasNode()?.getText() ?? n.getName()) === name)
            ?.getName() ?? name);
      const target = followModuleForType(sourceName, moduleSpecifier, file, project, seen);
      if (target) return target;
      continue;
    }

    // `export { X }` (no module specifier) — X was imported above into this file.
    const reExportsName = namedExports.some(
      (n) => (n.getAliasNode()?.getText() ?? n.getName()) === name,
    );
    if (!reExportsName) continue;
    const sourceName =
      namedExports.find((n) => (n.getAliasNode()?.getText() ?? n.getName()) === name)?.getName() ??
      name;
    const local = findTypeInFile(sourceName, file);
    if (local) return local;
    const imported = resolveImportedType(sourceName, file, project);
    if (imported) return imported;
  }
  return null;
}

function followModuleForType(
  name: string,
  moduleSpecifier: string,
  fromFile: SourceFile,
  project: Project,
  seen: Set<string>,
): TypeDeclResult | null {
  const candidates = resolveModuleSpecifier(moduleSpecifier, fromFile, project);
  for (const candidate of candidates) {
    let importedFile = project.getSourceFile(candidate);
    if (!importedFile) {
      try {
        importedFile = project.addSourceFileAtPath(candidate);
      } catch {
        continue;
      }
    }
    const result = findTypeInFile(name, importedFile);
    if (result) return result;
    const viaReExport = resolveReExportedType(name, importedFile, project, seen);
    if (viaReExport) return viaReExport;
  }
  return null;
}

/**
 * Per-`Project` memoization of {@link findType}. Within one discovery run the
 * `Project` is effectively immutable (`addSourceFileAtPath` is idempotent and
 * `getSourceFile` returns the existing instance), so the same `(file, name)`
 * pair always resolves to the same declaration. The same type/enum would
 * otherwise be fully re-resolved on every reference — O(routes × DTOs × imports).
 *
 * Keyed by `Project` via a WeakMap so the cache dies with its project and there
 * is no cross-run staleness: every `discoverContractsFast` call (and every watch
 * change) builds a fresh `Project`, hence a fresh cache. Null results are cached
 * too (use `.has` to distinguish "cached null" from "not yet computed").
 */
const _findTypeCache = new WeakMap<Project, Map<string, TypeDeclResult | null>>();

/**
 * Find a type declaration by name: first in the current file, then by following imports.
 */
export function findType(
  name: string,
  sourceFile: SourceFile,
  project: Project,
): TypeDeclResult | null {
  let byKey = _findTypeCache.get(project);
  if (byKey === undefined) {
    byKey = new Map();
    _findTypeCache.set(project, byKey);
  }
  const key = `${sourceFile.getFilePath()} ${name}`;
  if (byKey.has(key)) return byKey.get(key) ?? null;
  const local = findTypeInFile(name, sourceFile);
  const result = local ?? resolveImportedType(name, sourceFile, project);
  byKey.set(key, result);
  return result;
}

// ---------------------------------------------------------------------------
// Importable named-ref resolution
// ---------------------------------------------------------------------------

/** The declaration kinds a `resolveTypeRef` call will accept as an importable ref. */
export type TypeRefKind = 'class' | 'interface' | 'typeAlias' | 'enum';

export interface ResolveTypeRefOptions {
  /**
   * Declaration kinds accepted as an importable named ref (applied identically
   * to local and imported declarations). The two call sites differ only here:
   *   - body/query/response refs accept class + interface;
   *   - `@FilterFor` param refs also accept enum + type alias.
   */
  kinds: TypeRefKind[];
  /**
   * Honour a bare (node_modules) import specifier — emit `{ name, filePath: spec }`
   * so the emitter imports straight from the package. tsconfig path aliases are
   * excluded (they resolve to files instead). Off for the body/query/response
   * path (which only ever points at project source files).
   */
  allowBareSpecifier?: boolean;
  /**
   * Unwrap `Promise<T>`, `Array<T>` and `T[]` to the inner named type (marking
   * array forms with `isArray`). Used for the body/query/response path which
   * receives a raw return/param `TypeNode`; the `@FilterFor` path passes a bare
   * symbol name and needs no unwrapping.
   */
  unwrapContainers?: boolean;
}

/** Skip-list of primitive / well-known names that never resolve to a named ref. */
const _NON_REF_NAMES = new Set(['string', 'number', 'boolean', 'void', 'unknown', 'any', 'Date']);

/** Does an exported declaration found by `findTypeInFile` match the accepted kinds? */
function _localDeclForKinds(name: string, file: SourceFile, kinds: TypeRefKind[]): boolean {
  if (kinds.includes('class') && file.getClass(name)?.isExported()) return true;
  if (kinds.includes('interface') && file.getInterface(name)?.isExported()) return true;
  if (kinds.includes('typeAlias') && file.getTypeAlias(name)?.isExported()) return true;
  if (kinds.includes('enum') && file.getEnum(name)?.isExported()) return true;
  return false;
}

/**
 * Resolve a type reference to an importable `TypeRef` — the symbol name plus the
 * absolute path of its declaring source file (for a relative import) OR the bare
 * module specifier (for a node_modules package). Accepts either a raw `TypeNode`
 * (with `unwrapContainers` to peel `Promise`/`Array`) or a bare symbol name.
 *
 * Walks: local exported decl → `{ name, thisFile }`; else the file's import
 * declarations to a matching exported decl → `{ name, importedFile }`. The
 * accepted declaration kinds (and bare-specifier / container-unwrap support) are
 * controlled by `opts`, letting both former resolvers share this one body.
 * Returns null when the symbol is not exported, not resolvable, or its import
 * path cannot be safely computed.
 */
export function resolveTypeRef(
  nodeOrName: TypeNode | string,
  sourceFile: SourceFile,
  project: Project,
  opts: ResolveTypeRefOptions,
): TypeRef | null {
  // ── Resolve the bare symbol name (peeling containers for the TypeNode form) ──
  let name: string;
  if (typeof nodeOrName === 'string') {
    name = nodeOrName;
  } else {
    const typeNode = nodeOrName;

    if (opts.unwrapContainers && Node.isArrayTypeNode(typeNode)) {
      const inner = resolveTypeRef(typeNode.getElementTypeNode(), sourceFile, project, opts);
      return inner ? { ...inner, isArray: true } : null;
    }

    if (!Node.isTypeReference(typeNode)) return null;
    const typeName = typeNode.getTypeName();
    const refName = Node.isIdentifier(typeName) ? typeName.getText() : null;
    if (!refName) return null;

    if (opts.unwrapContainers && refName === 'Promise') {
      const first = typeNode.getTypeArguments()[0];
      return first ? resolveTypeRef(first, sourceFile, project, opts) : null;
    }
    if (opts.unwrapContainers && refName === 'Array') {
      const first = typeNode.getTypeArguments()[0];
      if (!first) return null;
      const inner = resolveTypeRef(first, sourceFile, project, opts);
      return inner ? { ...inner, isArray: true } : null;
    }

    if (_NON_REF_NAMES.has(refName)) return null;
    name = refName;
  }

  // The bare-symbol resolution below is deterministic in (file, name, kinds,
  // allowBareSpecifier) within a run, so it is memoized per-Project.
  return _resolveNamedRef(name, sourceFile, project, opts);
}

/**
 * Per-`Project` memoization of the bare-symbol resolution arm of
 * {@link resolveTypeRef} (steps 1 & 2). Keyed by `(file, name, kinds,
 * allowBareSpecifier)` — the only inputs the import-following walk depends on.
 * `unwrapContainers` is excluded because container peeling happens in the caller
 * before this point. Same WeakMap-by-Project safety as {@link findType}: fresh
 * Project per run ⇒ fresh cache, no cross-run staleness. Null results cached too.
 *
 * Returns a fresh object copy on a cache hit so callers (which may spread
 * `{ ...ref, isArray: true }` or otherwise treat the ref as owned) never share a
 * mutable cached instance.
 */
const _resolveNamedRefCache = new WeakMap<Project, Map<string, TypeRef | null>>();

function _resolveNamedRef(
  name: string,
  sourceFile: SourceFile,
  project: Project,
  opts: ResolveTypeRefOptions,
): TypeRef | null {
  let byKey = _resolveNamedRefCache.get(project);
  if (byKey === undefined) {
    byKey = new Map();
    _resolveNamedRefCache.set(project, byKey);
  }
  const kindsKey = [...opts.kinds].sort().join(',');
  const key = `${sourceFile.getFilePath()}\0${name}\0${kindsKey}\0${opts.allowBareSpecifier ? 1 : 0}`;
  if (byKey.has(key)) {
    const cached = byKey.get(key) ?? null;
    return cached ? { ...cached } : null;
  }
  const computed = _computeNamedRef(name, sourceFile, project, opts);
  byKey.set(key, computed);
  return computed ? { ...computed } : null;
}

function _computeNamedRef(
  name: string,
  sourceFile: SourceFile,
  project: Project,
  opts: ResolveTypeRefOptions,
): TypeRef | null {
  // 1. Declared (and exported) in the current file → relative import to it.
  if (_localDeclForKinds(name, sourceFile, opts.kinds)) {
    return { name, filePath: sourceFile.getFilePath() };
  }

  // 2. Imported from another module — follow the import declaration.
  for (const importDecl of sourceFile.getImportDeclarations()) {
    const namedImport = importDecl.getNamedImports().find((n) => n.getName() === name);
    if (!namedImport) continue;
    const moduleSpecifier = importDecl.getModuleSpecifierValue();

    // Bare specifier (node_modules package) → import directly by specifier.
    if (
      opts.allowBareSpecifier &&
      !moduleSpecifier.startsWith('.') &&
      !moduleSpecifier.startsWith('/')
    ) {
      // Only honour it if not a tsconfig path alias (those resolve to files).
      const tsconfigPaths = _ctxFor(project).tsconfigPaths;
      const isAlias =
        tsconfigPaths != null &&
        Object.keys(tsconfigPaths).some((p) => {
          const prefix = p.replace('*', '');
          return moduleSpecifier.startsWith(prefix);
        });
      if (!isAlias) {
        return { name, filePath: moduleSpecifier };
      }
    }

    // Local / aliased source file → resolve to its absolute path so the emitter
    // can compute a relative import from the generated output dir.
    const candidates = resolveModuleSpecifier(moduleSpecifier, sourceFile, project);
    for (const candidate of candidates) {
      let importedFile = project.getSourceFile(candidate);
      if (!importedFile) {
        try {
          importedFile = project.addSourceFileAtPath(candidate);
        } catch {
          continue;
        }
      }
      if (_localDeclForKinds(name, importedFile, opts.kinds)) {
        return { name, filePath: importedFile.getFilePath() };
      }
    }
  }

  return null;
}
