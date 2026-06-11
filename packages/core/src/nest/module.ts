import type { DynamicModule, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Inject, Injectable, Logger, Module } from '@nestjs/common';
import { resolveConfig } from '../config/load-config.js';
import type { UserConfig } from '../config/types.js';
import type { Watcher } from '../watch/watcher.js';
import { watch } from '../watch/watcher.js';

/**
 * Options for {@link NestjsCodegenModule.forRoot}. These ARE the codegen config —
 * no `nestjs-codegen.config.ts` file is required. Import the module in your root
 * `AppModule` and the typed client regenerates as you edit your controllers:
 *
 * @example
 * ```ts
 * import { NestjsCodegenModule } from '@dudousxd/nestjs-codegen/nest';
 *
 * @Module({
 *   imports: [
 *     NestjsCodegenModule.forRoot({
 *       contracts: { glob: 'src/**\/*.controller.ts' },
 *       codegen: { outDir: 'src/generated' },
 *       extensions: [tanstackQuery()],
 *     }),
 *   ],
 * })
 * export class AppModule {}
 * ```
 */
export interface CodegenModuleOptions extends Omit<UserConfig, 'validation'> {
  /**
   * Validation adapter for emitted `forms.ts` schemas. Required at runtime to emit
   * forms — pass `zodAdapter` from `@dudousxd/nestjs-codegen-zod` (or the valibot/
   * arktype adapter). Typed optional only so `forRoot()` stays terse; if omitted,
   * the watcher logs and skips rather than crashing app boot.
   */
  validation?: UserConfig['validation'];
  /**
   * Master switch for the boot-time watcher. When omitted, the watcher runs in every
   * environment EXCEPT production (`process.env.NODE_ENV === 'production'`) — codegen is a
   * dev/CI build step, not a production-runtime concern. Set `false` to disable entirely,
   * or `true` to force it on even in production.
   */
  enabled?: boolean;
  /** Project root used to resolve globs / `outDir`. Defaults to `process.cwd()`. */
  cwd?: string;
}

/** DI token holding the raw {@link CodegenModuleOptions} passed to `forRoot`. */
export const CODEGEN_MODULE_OPTIONS = Symbol('NESTJS_CODEGEN_MODULE_OPTIONS');

/**
 * Decide whether the boot-time watcher should start, given the module options and the
 * current `NODE_ENV`. Explicit `enabled` always wins; otherwise default on unless prod.
 */
export function shouldRun(options: CodegenModuleOptions, env: string | undefined): boolean {
  if (options.enabled !== undefined) return options.enabled;
  return env !== 'production';
}

/**
 * Boots the codegen watcher on application start and tears it down on shutdown.
 * The watcher does an initial full generate, then regenerates `routes.ts`/`api.ts`/
 * `forms.ts` as controllers and DTOs change — mirroring `nestjs-codegen codegen --watch`,
 * but driven by the Nest lifecycle so no separate process is needed in dev.
 */
@Injectable()
export class NestjsCodegenService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('NestjsCodegen');
  private watcher: Watcher | null = null;

  constructor(@Inject(CODEGEN_MODULE_OPTIONS) private readonly options: CodegenModuleOptions) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!shouldRun(this.options, process.env.NODE_ENV)) return;

    const { enabled: _enabled, cwd, ...userConfig } = this.options;
    try {
      const config = resolveConfig(userConfig, cwd ?? process.cwd());
      this.watcher = await watch(config);
      this.logger.log(`Watching ${config.contracts.glob} → ${config.codegen.outDir}`);
    } catch (err) {
      // Never crash app boot because codegen failed to start — log and move on.
      this.logger.warn(
        `Codegen watcher failed to start: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.watcher?.close();
    this.watcher = null;
  }
}

/**
 * NestJS module that auto-starts the codegen watcher on app boot — the recommended way
 * to wire `@dudousxd/nestjs-codegen` into a Nest app. For CI/pre-deploy, run the
 * one-shot CLI (`nestjs-codegen codegen`) instead.
 */
@Module({})
export class NestjsCodegenModule {
  static forRoot(options: CodegenModuleOptions = {}): DynamicModule {
    return {
      module: NestjsCodegenModule,
      providers: [{ provide: CODEGEN_MODULE_OPTIONS, useValue: options }, NestjsCodegenService],
    };
  }
}
