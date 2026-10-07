import { afterEach, describe, expect, it, vi } from 'vitest';
import type { createServer as createViteServer, ViteDevServer } from 'vite';

const viteBoundary = vi.hoisted(() => ({ createServer: vi.fn() }));

vi.mock('vite', async (importOriginal) => {
  const actual = await importOriginal<{ createServer: typeof createViteServer }>();
  return { ...actual, createServer: viteBoundary.createServer };
});

type Preparation = 'listen' | 'warmup' | 'idle';

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function prepareServer(
  options: {
    readonly rejectAt?: Preparation;
    readonly preparationError?: Error;
    readonly closeError?: Error;
  } = {},
) {
  const events: string[] = [];
  const listen = vi.fn(async () => {
    events.push('listen');
    if (options.rejectAt === 'listen') throw options.preparationError ?? new Error('listen failed');
  });
  const warmup = vi.fn(async (entry: string) => {
    events.push(`warmup:${entry}`);
    if (options.rejectAt === 'warmup') throw options.preparationError ?? new Error('warmup failed');
  });
  const idle = vi.fn(async () => {
    events.push('idle');
    if (options.rejectAt === 'idle') throw options.preparationError ?? new Error('idle failed');
  });
  const close = vi.fn(async () => {
    events.push('close');
    if (options.closeError) throw options.closeError;
  });

  return {
    close,
    events,
    idle,
    listen,
    warmup,
    server: {
      close,
      environments: { client: { warmupRequest: warmup, waitForRequestsIdle: idle } },
      listen,
    } as unknown as ViteDevServer,
  };
}

async function loadCatalogServer() {
  vi.resetModules();
  return (await import('./catalog-discovery-server')).default;
}

afterEach(() => {
  viteBoundary.createServer.mockReset();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('Catalog discovery browser server startup', () => {
  it('does not return cleanup before the exact listener, client warmup, and idle sequence completes', async () => {
    const prepared = prepareServer();
    const idleGate = deferred<void>();
    prepared.idle.mockImplementation(async () => {
      prepared.events.push('idle');
      await idleGate.promise;
    });
    viteBoundary.createServer.mockResolvedValue(prepared.server);
    const startCatalogServer = await loadCatalogServer();

    let settled = false;
    const startup = startCatalogServer().then((cleanup) => {
      settled = true;
      return cleanup;
    });

    await vi.waitFor(() => expect(prepared.idle).toHaveBeenCalledTimes(1));
    expect(prepared.events).toEqual(['listen', 'warmup:/src/main.tsx', 'idle']);
    expect(settled).toBe(false);

    idleGate.resolve(undefined);
    const cleanup = await startup;
    await cleanup();

    expect(prepared.close).toHaveBeenCalledTimes(1);
  });

  it.each(['listen', 'warmup', 'idle'] as const)(
    'closes once and preserves the %s preparation error when cleanup succeeds',
    async (rejectAt) => {
      const expectedError = new Error(`${rejectAt} failed`);
      const prepared = prepareServer({ rejectAt, preparationError: expectedError });
      viteBoundary.createServer.mockResolvedValue(prepared.server);
      const startCatalogServer = await loadCatalogServer();

      await expect(startCatalogServer()).rejects.toBe(expectedError);

      expect(prepared.close).toHaveBeenCalledTimes(1);
      if (rejectAt === 'listen') {
        expect(prepared.warmup).not.toHaveBeenCalled();
        expect(prepared.idle).not.toHaveBeenCalled();
      }
      if (rejectAt === 'warmup') expect(prepared.idle).not.toHaveBeenCalled();
    },
  );

  it('exposes a cleanup error instead of masking it with the preparation error', async () => {
    const cleanupError = new Error('close failed');
    const prepared = prepareServer({ rejectAt: 'warmup', closeError: cleanupError });
    viteBoundary.createServer.mockResolvedValue(prepared.server);
    const startCatalogServer = await loadCatalogServer();

    await expect(startCatalogServer()).rejects.toBe(cleanupError);
    expect(prepared.close).toHaveBeenCalledTimes(1);
  });
});
