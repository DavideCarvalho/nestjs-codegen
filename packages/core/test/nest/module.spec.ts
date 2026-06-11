import { zodAdapter } from '@dudousxd/nestjs-codegen-zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the watcher so the module never spawns real chokidar watchers in tests.
const watchMock = vi.fn();
const closeMock = vi.fn(async () => {});
vi.mock('../../src/watch/watcher.js', () => ({
  watch: (...args: unknown[]) => watchMock(...args),
}));

import {
  CODEGEN_MODULE_OPTIONS,
  NestjsCodegenModule,
  NestjsCodegenService,
  shouldRun,
} from '../../src/nest/module.js';

describe('shouldRun', () => {
  it('explicit enabled:false always wins (even in dev)', () => {
    expect(shouldRun({ enabled: false }, 'development')).toBe(false);
  });

  it('explicit enabled:true always wins (even in production)', () => {
    expect(shouldRun({ enabled: true }, 'production')).toBe(true);
  });

  it('defaults on outside production', () => {
    expect(shouldRun({}, 'development')).toBe(true);
    expect(shouldRun({}, 'test')).toBe(true);
    expect(shouldRun({}, undefined)).toBe(true);
  });

  it('defaults off in production', () => {
    expect(shouldRun({}, 'production')).toBe(false);
  });
});

describe('NestjsCodegenModule.forRoot', () => {
  it('returns a DynamicModule bound to itself', () => {
    const dm = NestjsCodegenModule.forRoot({ contracts: { glob: 'src/**/*.controller.ts' } });
    expect(dm.module).toBe(NestjsCodegenModule);
  });

  it('provides the options under CODEGEN_MODULE_OPTIONS + the service', () => {
    const options = { codegen: { outDir: 'src/generated' } };
    const dm = NestjsCodegenModule.forRoot(options);
    const optsProvider = dm.providers?.find(
      (p): p is { provide: symbol; useValue: unknown } =>
        typeof p === 'object' && 'provide' in p && p.provide === CODEGEN_MODULE_OPTIONS,
    );
    expect(optsProvider?.useValue).toBe(options);
    expect(dm.providers).toContain(NestjsCodegenService);
  });

  it('forRoot() with no args defaults to empty options', () => {
    const dm = NestjsCodegenModule.forRoot();
    const optsProvider = dm.providers?.find(
      (p): p is { provide: symbol; useValue: unknown } =>
        typeof p === 'object' && 'provide' in p && p.provide === CODEGEN_MODULE_OPTIONS,
    );
    expect(optsProvider?.useValue).toEqual({});
  });
});

describe('NestjsCodegenService lifecycle', () => {
  beforeEach(() => {
    watchMock.mockReset();
    watchMock.mockResolvedValue({ close: closeMock });
    closeMock.mockClear();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('does not start the watcher when enabled:false', async () => {
    const svc = new NestjsCodegenService({ enabled: false });
    await svc.onApplicationBootstrap();
    expect(watchMock).not.toHaveBeenCalled();
  });

  it('does not start the watcher in production by default', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const svc = new NestjsCodegenService({});
    await svc.onApplicationBootstrap();
    expect(watchMock).not.toHaveBeenCalled();
  });

  it('starts the watcher with a resolved config in dev', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const svc = new NestjsCodegenService({
      validation: zodAdapter,
      contracts: { glob: 'src/**/*.controller.ts' },
      cwd: '/tmp',
    });
    await svc.onApplicationBootstrap();
    expect(watchMock).toHaveBeenCalledTimes(1);
    const config = watchMock.mock.calls[0][0] as { contracts: { glob: string } };
    expect(config.contracts.glob).toBe('src/**/*.controller.ts');
  });

  it('closes the watcher on module destroy', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const svc = new NestjsCodegenService({ validation: zodAdapter, cwd: '/tmp' });
    await svc.onApplicationBootstrap();
    await svc.onModuleDestroy();
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it('swallows watcher start errors (never crashes boot)', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    watchMock.mockRejectedValueOnce(new Error('boom'));
    const svc = new NestjsCodegenService({ cwd: '/tmp' });
    await expect(svc.onApplicationBootstrap()).resolves.toBeUndefined();
  });
});
