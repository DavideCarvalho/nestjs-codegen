import { pathToFileURL } from 'node:url';
import { cac } from 'cac';
import type { CodegenConfig } from '../config/types.js';
import { VERSION } from '../index.js';
import { runCodegen } from './run.js';

interface FileConfig extends Partial<CodegenConfig> {
  controllers?: string[];
  tsConfigPath?: string;
}

/** Load a config module (`*.config.{js,mjs,cjs}`) via dynamic import. */
async function loadConfigFile(path: string): Promise<FileConfig> {
  const mod = await import(pathToFileURL(path).href);
  return (mod.default ?? mod) as FileConfig;
}

interface CliFlags {
  config?: string;
  controllers?: string;
  out?: string;
  query?: boolean;
  transformer?: string;
  mutationClient?: string;
  validation?: string;
  tsconfig?: string;
}

export async function run(argv: string[]): Promise<void> {
  const cli = cac('nestjs-codegen');

  cli
    .command('generate', 'Discover NestJS controllers and emit routes/api/forms')
    .option('--config <path>', 'Config file (.js/.mjs/.cjs) exporting CodegenConfig + controllers')
    .option('--controllers <glob>', 'Controller file glob (repeatable)')
    .option('--out <dir>', 'Output directory')
    .option('--query', 'Emit TanStack queryOptions/mutationOptions')
    .option('--transformer <name>', 'Payload transformer (superjson)')
    .option('--mutation-client <mode>', "Mutation client: 'fetcher' or 'inertia'")
    .option('--validation <lib>', 'Validation lib (zod)', { default: 'zod' })
    .option('--tsconfig <path>', 'tsconfig path for discovery')
    .action(async (flags: CliFlags) => {
      const fileConfig = flags.config ? await loadConfigFile(flags.config) : {};

      const controllers =
        (flags.controllers ? [flags.controllers].flat() : undefined) ?? fileConfig.controllers;
      const outDir = flags.out ?? fileConfig.outDir;
      if (!controllers || controllers.length === 0) {
        throw new Error('No controllers specified. Use --controllers <glob> or a --config file.');
      }
      if (!outDir) {
        throw new Error('No output directory. Use --out <dir> or set outDir in the config file.');
      }

      const result = await runCodegen({
        controllers,
        ...((flags.tsconfig ?? fileConfig.tsConfigPath)
          ? { tsConfigPath: flags.tsconfig ?? fileConfig.tsConfigPath }
          : {}),
        outDir,
        validation:
          fileConfig.validation ?? (flags.validation as CodegenConfig['validation']) ?? 'zod',
        query: flags.query ?? fileConfig.query ?? false,
        transformer:
          (flags.transformer as CodegenConfig['transformer']) ?? fileConfig.transformer ?? false,
        mutationClient:
          (flags.mutationClient as CodegenConfig['mutationClient']) ??
          fileConfig.mutationClient ??
          'fetcher',
      });

      const formsNote = result.forms ? ' (+ forms.ts)' : '';
      console.log(`[nestjs-codegen] Generated ${result.routes} route(s) → ${outDir}${formsNote}`);
    });

  cli.help();
  cli.version(VERSION);
  cli.parse(argv, { run: false });
  await cli.runMatchedCommand();
}
