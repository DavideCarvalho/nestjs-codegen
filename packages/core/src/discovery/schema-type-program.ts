import { FileSystemRefreshResult, Node, Project, type SourceFile, ts } from 'ts-morph';
import { DiskFingerprints } from './disk-fingerprints.js';

/**
 * The type-checked program schema inference runs in, kept as small as the schemas
 * allow.
 *
 * Discovery's own Project skips lib files and dependency resolution for speed, and a
 * checker without them cannot instantiate a generic schema type, so inference needs
 * a second, lib-loading program. Built naively — the controllers plus everything
 * they import — that program is the whole backend: a controller imports its
 * services, they import the database layer and every SDK, and in a 750-route app it
 * came to 4,000 files and several seconds per discovery pass, for schemas that need
 * a handful.
 *
 * So every project source file enters this program PRUNED: its text with each
 * `import`/`export … from` that nothing relevant references blanked out (replaced
 * by spaces, so every node keeps its position and a discovery node maps onto its
 * counterpart by offset). What is relevant starts from the schema positions — the
 * arguments of `@Body`/`@Query`/`@Param`/`@ApplyContract` and `defineContract`
 * calls — and closes over the file's own top-level declarations they name; a kept
 * import then asks the file it points to for exactly the names it imports, which
 * is pruned the same way, until nothing new is needed. Only `node_modules` (the
 * schema libraries) is read unpruned. Whatever else a file references just fails
 * to resolve, which costs nothing: the checker only looks at what is queried.
 */

/** What a file must keep: its schema positions, and/or names other files import from it. */
interface Needs {
  schema: boolean;
  /** Every top-level declaration (a namespace import, `export *` of everything). */
  all: boolean;
  names: Set<string>;
}

type Want = { schema?: boolean; all?: boolean; names?: string[] };

/** One file's pruned text, and what it asked of the files it imports. */
interface Pruned {
  text: string;
  requests: Array<{ path: string; want: Want }>;
  /** Every import resolved, so the same source and needs prune the same way again. */
  resolved: boolean;
}

/** The param decorators whose pipes discovery reads schemas from. */
const PARAM_DECORATORS = new Set(['Body', 'Query', 'Param']);

export class SchemaTypeProgram {
  readonly project: Project;
  private readonly options: ts.CompilerOptions;
  /** Parses a file that is not in discovery's Project, without adding it there. */
  private readonly scratch = new Project({
    skipAddingFilesFromTsConfig: true,
    skipLoadingLibFiles: true,
    skipFileDependencyResolution: true,
  });
  private readonly needs = new Map<string, Needs>();
  /** Pruned text per file, as last written into {@link project}. */
  private readonly written = new Map<string, string>();
  /** What {@link project} read from disk unpruned (packages, declaration files). */
  private readonly externalFiles = new DiskFingerprints();
  private readonly scratchFiles = new DiskFingerprints();
  /** The last pruning of each file, with the source text and needs it was pruned for. */
  private readonly pruned = new Map<string, Pruned & { source: string; needs: string }>();

  constructor(private readonly discovery: Project) {
    const base = discovery.getCompilerOptions();
    this.options = {
      ...base,
      // A tsconfig-less consumer gets ES5 by default, whose lib has no `Map`/`Set`/
      // `Promise` for the schema libraries' declarations to lean on.
      target: base.target ?? ts.ScriptTarget.ES2022,
      // With neither set, resolve the way a bundler does: package `exports`
      // (`zod/v4`) and extensionless or `.js` relative imports all resolve.
      ...(base.module === undefined && base.moduleResolution === undefined
        ? { module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler }
        : {}),
      // Without it `.nullable()` and `.optional()` would erase to the bare type.
      strictNullChecks: true,
      // No ambient `@types/*` (a tsconfig's `types: ['node']`): a schema does not
      // need them, and they are a hundred-odd files of program to build.
      types: [],
      noEmit: true,
    };
    this.project = new Project({
      skipAddingFilesFromTsConfig: true,
      compilerOptions: this.options,
    });
    this.requestDiscoveryFiles();
  }

  /**
   * Bring the program up to date with discovery's files and the disk, keeping the
   * lib and package declarations it has already parsed and checked. Leaves it
   * holding exactly the files a new program built now would hold, with the same
   * text. Returns false when a file the program read unpruned has changed on disk
   * (a package was reinstalled, a `.d.ts` was edited): the caller builds a new
   * program instead.
   */
  refresh(): boolean {
    const program = this.project.getProgram().compilerObject;
    const external = program
      .getSourceFiles()
      .filter(
        (file) => !program.isSourceFileDefaultLibrary(file) && !this.written.has(file.fileName),
      )
      .map((file) => ({ path: file.fileName, text: file.text }));
    if (this.externalFiles.changed(external).length > 0) return false;

    const scratch = this.scratch
      .getSourceFiles()
      .map((sf) => ({ path: sf.getFilePath(), text: sf.getFullText() }));
    for (const path of this.scratchFiles.changed(scratch)) {
      const sf = this.scratch.getSourceFile(path);
      if (sf?.refreshFromFileSystemSync() === FileSystemRefreshResult.Deleted) {
        this.scratchFiles.forget(path);
      }
    }

    // What a file must keep depends on what every other file asks of it, so the
    // closure is recomputed from the roots; only files whose pruned text changed
    // are written again.
    this.needs.clear();
    this.requestDiscoveryFiles();
    for (const path of [...this.written.keys()]) {
      if (this.needs.has(path)) continue;
      const sf = this.project.getSourceFile(path);
      if (sf) this.project.removeSourceFile(sf);
      this.written.delete(path);
    }
    return true;
  }

  /**
   * Everything discovery holds now (the controllers) goes in before the first
   * query: a file added afterwards discards the program and its checker, and
   * rebuilding them once per controller is exactly the cost this avoids.
   */
  private requestDiscoveryFiles(): void {
    for (const sf of this.discovery.getSourceFiles()) {
      this.request(sf.getFilePath(), { schema: true });
    }
    this.flush();
  }

  /**
   * The typed copy of a discovery file, with its schema positions kept. Adding one
   * that was not there yet (a contract file discovery reached lazily) rebuilds the
   * program once.
   */
  sourceFileFor(sf: SourceFile): SourceFile | undefined {
    this.request(sf.getFilePath(), { schema: true });
    this.flush();
    return this.project.getSourceFile(sf.getFilePath());
  }

  // -------------------------------------------------------------------------

  private readonly queue: string[] = [];

  private request(path: string, want: Want): void {
    let needs = this.needs.get(path);
    const isNew = !needs;
    needs ??= { schema: false, all: false, names: new Set() };
    let grew = isNew;
    if (want.schema && !needs.schema) {
      needs.schema = true;
      grew = true;
    }
    if (want.all && !needs.all) {
      needs.all = true;
      grew = true;
    }
    for (const name of want.names ?? []) {
      if (!needs.names.has(name)) {
        needs.names.add(name);
        grew = true;
      }
    }
    this.needs.set(path, needs);
    if (grew) this.queue.push(path);
  }

  /** Run the worklist to a fixpoint, then write every changed file into the program. */
  private flush(): void {
    const changed = new Map<string, string | undefined>();
    while (this.queue.length > 0) {
      const path = this.queue.pop() as string;
      const original = this.original(path);
      if (!original) {
        if (this.written.has(path)) changed.set(path, undefined);
        continue;
      }
      const { text, requests } = this.pruneCached(path, original, this.needs.get(path) as Needs);
      for (const { path: target, want } of requests) this.request(target, want);
      if (this.written.get(path) !== text) changed.set(path, text);
    }
    for (const [path, text] of changed) {
      if (text === undefined) {
        const sf = this.project.getSourceFile(path);
        if (sf) this.project.removeSourceFile(sf);
        this.written.delete(path);
        continue;
      }
      this.project.createSourceFile(path, text, { overwrite: true });
      this.written.set(path, text);
    }
  }

  /** The file as discovery sees it (its in-memory text), else as it is on disk. */
  private original(path: string): SourceFile | undefined {
    return (
      this.discovery.getSourceFile(path) ??
      this.scratch.getSourceFile(path) ??
      this.scratch.addSourceFileAtPathIfExists(path)
    );
  }

  /** {@link prune}, reusing the last result while the file's text and needs are the same. */
  private pruneCached(path: string, sf: SourceFile, needs: Needs): Pruned {
    const source = sf.getFullText();
    const key = `${needs.schema}:${needs.all}:${[...needs.names].sort().join(',')}`;
    const last = this.pruned.get(path);
    if (last && last.source === source && last.needs === key) return last;
    const result = this.prune(sf, needs);
    if (result.resolved) this.pruned.set(path, { ...result, source, needs: key });
    else this.pruned.delete(path);
    return result;
  }

  /**
   * `sf`'s text with every import/re-export nothing in `needs` references blanked,
   * and the names each kept one brings in from its target.
   */
  private prune(sf: SourceFile, needs: Needs): Pruned {
    const requests: Pruned['requests'] = [];
    let resolved = true;
    const resolveFrom = (specifier: string) => {
      const target = this.resolve(specifier, sf);
      if (target === null) resolved = false;
      return target ?? undefined;
    };
    const locals = topLevelDeclarations(sf);
    const roots: Node[] = [];
    if (needs.all) roots.push(...sf.getStatements());
    if (needs.schema) roots.push(...schemaPositions(sf));
    // Names other files import: the declarations, or the re-exports, that provide them.
    const reexported = new Map<string, Array<{ from: string; name: string }>>();
    for (const exp of sf.getExportDeclarations()) {
      const spec = exp.getModuleSpecifierValue();
      if (spec === undefined) {
        // `export { a as b }` — a local alias.
        for (const named of exp.getNamedExports()) {
          const exposed = (named.getAliasNode() ?? named.getNameNode()).getText();
          if (needs.all || needs.names.has(exposed)) roots.push(named.getNameNode());
        }
        continue;
      }
      if (exp.isNamespaceExport() || exp.getNamedExports().length === 0) continue;
      for (const named of exp.getNamedExports()) {
        const exposed = (named.getAliasNode() ?? named.getNameNode()).getText();
        const list = reexported.get(exposed) ?? [];
        list.push({ from: spec, name: named.getNameNode().getText() });
        reexported.set(exposed, list);
      }
    }
    const unresolvedNames: string[] = [];
    for (const name of needs.names) {
      const decls = name === 'default' ? defaultExport(sf) : (locals.get(name) ?? []);
      if (decls.length > 0) roots.push(...decls);
      else if (!reexported.has(name)) unresolvedNames.push(name);
    }

    // Close over the file's own declarations the roots name.
    const referenced = new Set<string>();
    const queue = [...roots];
    const seen = new Set<Node>(queue);
    while (queue.length > 0) {
      const node = queue.pop() as Node;
      const ids = Node.isIdentifier(node)
        ? [node]
        : node.getDescendantsOfKind(ts.SyntaxKind.Identifier);
      for (const id of ids) {
        const name = id.getText();
        if (referenced.has(name)) continue;
        referenced.add(name);
        for (const local of locals.get(name) ?? []) {
          if (seen.has(local)) continue;
          seen.add(local);
          queue.push(local);
        }
      }
    }

    const chars = sf.getFullText().split('');
    const blank = (node: Node) => {
      for (let i = node.getStart(); i < node.getEnd(); i++) {
        if (chars[i] !== '\n' && chars[i] !== '\r') chars[i] = ' ';
      }
    };

    for (const decl of sf.getImportDeclarations()) {
      const target = resolveFrom(decl.getModuleSpecifierValue());
      const namespace = decl.getNamespaceImport()?.getText();
      const def = decl.getDefaultImport()?.getText();
      const named = decl
        .getNamedImports()
        .map((n) => ({
          local: (n.getAliasNode() ?? n.getNameNode()).getText(),
          imported: n.getName(),
        }))
        .filter((n) => referenced.has(n.local));
      const wantsNamespace = namespace !== undefined && referenced.has(namespace);
      const wantsDefault = def !== undefined && referenced.has(def);
      if (!wantsNamespace && !wantsDefault && named.length === 0) {
        blank(decl);
        continue;
      }
      if (target) {
        requests.push({
          path: target,
          want: {
            all: wantsNamespace,
            names: [...(wantsDefault ? ['default'] : []), ...named.map((n) => n.imported)],
          },
        });
      }
    }

    for (const exp of sf.getExportDeclarations()) {
      const spec = exp.getModuleSpecifierValue();
      if (spec === undefined) continue;
      const target = resolveFrom(spec);
      if (exp.isNamespaceExport() || exp.getNamedExports().length === 0) {
        // `export * from` — it may provide any name this file was asked for and
        // does not declare itself.
        if (!needs.all && unresolvedNames.length === 0) {
          blank(exp);
        } else if (target) {
          requests.push({ path: target, want: { all: needs.all, names: unresolvedNames } });
        }
        continue;
      }
      const wanted = exp
        .getNamedExports()
        .filter(
          (n) => needs.all || needs.names.has((n.getAliasNode() ?? n.getNameNode()).getText()),
        )
        .map((n) => n.getNameNode().getText());
      if (wanted.length === 0) blank(exp);
      else if (target) requests.push({ path: target, want: { names: wanted } });
    }

    return { text: chars.join(''), requests, resolved };
  }

  /**
   * The project source file a module specifier resolves to; undefined for a
   * package or a declaration file (read unpruned by the program itself), null for
   * one that does not resolve.
   */
  private resolve(specifier: string, from: SourceFile): string | null | undefined {
    const resolved = ts.resolveModuleName(
      specifier,
      from.getFilePath(),
      this.options,
      ts.sys,
    ).resolvedModule;
    if (!resolved) return null;
    if (resolved.isExternalLibraryImport) return undefined;
    const file = resolved.resolvedFileName;
    if (file.endsWith('.d.ts') || !/\.(m|c)?tsx?$/.test(file)) return undefined;
    return file;
  }
}

/**
 * The expressions discovery reads schemas from: a pipe's ARGUMENTS in a param
 * decorator (`new ZodPipe(schema)` needs `schema`, not the `ZodPipe` class — whose
 * file would drag in `@nestjs/common` and all of rxjs), `@ApplyContract(...)`'s
 * argument, and `defineContract(...)` calls.
 */
function schemaPositions(sf: SourceFile): Node[] {
  const roots: Node[] = [];
  sf.forEachDescendant((node) => {
    if (Node.isDecorator(node)) {
      const name = node.getName();
      if (name === 'ApplyContract') {
        roots.push(...node.getArguments());
      } else if (PARAM_DECORATORS.has(name)) {
        for (const arg of node.getArguments()) {
          if (Node.isNewExpression(arg) || Node.isCallExpression(arg)) {
            roots.push(...arg.getArguments());
          }
        }
      }
    } else if (Node.isCallExpression(node)) {
      const callee = node.getExpression();
      const name = Node.isIdentifier(callee)
        ? callee.getText()
        : Node.isPropertyAccessExpression(callee)
          ? callee.getName()
          : undefined;
      if (name === 'defineContract') roots.push(...node.getArguments());
    }
  });
  return roots;
}

/** The file's top-level declarations by name (a name may be declared more than once — overloads, merging). */
function topLevelDeclarations(sf: SourceFile): Map<string, Node[]> {
  const byName = new Map<string, Node[]>();
  const add = (name: string | undefined, node: Node) => {
    if (!name) return;
    const list = byName.get(name);
    if (list) list.push(node);
    else byName.set(name, [node]);
  };
  for (const decl of sf.getVariableDeclarations()) add(decl.getName(), decl);
  for (const decl of sf.getFunctions()) add(decl.getName(), decl);
  for (const decl of sf.getClasses()) add(decl.getName(), decl);
  for (const decl of sf.getEnums()) add(decl.getName(), decl);
  for (const decl of sf.getInterfaces()) add(decl.getName(), decl);
  for (const decl of sf.getTypeAliases()) add(decl.getName(), decl);
  for (const decl of sf.getModules()) add(decl.getName(), decl);
  return byName;
}

/** The node(s) behind `export default`. */
function defaultExport(sf: SourceFile): Node[] {
  const nodes: Node[] = [];
  for (const assignment of sf.getExportAssignments()) nodes.push(assignment);
  for (const fn of sf.getFunctions()) if (fn.isDefaultExport()) nodes.push(fn);
  for (const cls of sf.getClasses()) if (cls.isDefaultExport()) nodes.push(cls);
  return nodes;
}
