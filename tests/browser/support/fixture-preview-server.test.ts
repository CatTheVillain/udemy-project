import { afterEach, describe, expect, it, vi } from 'vitest';
import type { build as viteBuild, preview as vitePreview, PreviewServer } from 'vite';
import { resolve } from 'node:path';

const viteBoundary = vi.hoisted(() => ({ build: vi.fn(), preview: vi.fn() }));

vi.mock('vite', async (importOriginal) => {
  const actual = await importOriginal<{
    build: typeof viteBuild;
    preview: typeof vitePreview;
  }>();
  return { ...actual, build: viteBoundary.build, preview: viteBoundary.preview };
});

const fixtureRoot = 'C:/fixture-root';
const port = 4189;
const apiBaseUrl = 'http://127.0.0.1:9999';
const origin = `http://127.0.0.1:${port}`;
const isolatedRoot = resolve(fixtureRoot);
const cacheDir = resolve(isolatedRoot, 'vite-cache');
const outDir = resolve(isolatedRoot, 'preview-dist');

function previewServer() {
  const close = vi.fn<[], Promise<void>>().mockResolvedValue(undefined);
  return { close, server: { close } as unknown as PreviewServer };
}

function readyFetch() {
  return vi
    .fn()
    .mockResolvedValueOnce(
      new Response('<script type="module" src="/assets/main.js"></script>', { status: 200 }),
    )
    .mockResolvedValueOnce(
      new Response('export {}', {
        status: 200,
        headers: { 'content-type': 'application/javascript' },
      }),
    );
}

async function loadStartFixturePreviewServer() {
  vi.resetModules();
  return (await import('./fixture-preview-server')).startFixturePreviewServer;
}

afterEach(() => {
  viteBoundary.build.mockReset();
  viteBoundary.preview.mockReset();
  vi.unstubAllGlobals();
});

describe('startFixturePreviewServer', () => {
  it('builds isolated output, previews the supplied strict loopback port, and verifies the built module', async () => {
    const prepared = previewServer();
    const fetchReady = readyFetch();
    viteBoundary.build.mockResolvedValue({});
    viteBoundary.preview.mockResolvedValue(prepared.server);
    vi.stubGlobal('fetch', fetchReady);
    const startFixturePreviewServer = await loadStartFixturePreviewServer();

    const cleanup = await startFixturePreviewServer({ fixtureRoot, port, apiBaseUrl });

    expect(viteBoundary.build).toHaveBeenCalledWith({
      clearScreen: false,
      logLevel: 'warn',
      envFile: false,
      cacheDir,
      define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify(apiBaseUrl) },
      build: { outDir, emptyOutDir: true },
    });
    expect(viteBoundary.preview).toHaveBeenCalledWith({
      clearScreen: false,
      logLevel: 'warn',
      envFile: false,
      cacheDir,
      define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify(apiBaseUrl) },
      build: { outDir },
      preview: { host: '127.0.0.1', port, strictPort: true },
    });
    expect(fetchReady.mock.calls).toEqual([
      [`${origin}/`, { cache: 'no-store' }],
      [`${origin}/assets/main.js`, { cache: 'no-store' }],
    ]);

    const firstCleanup = cleanup();
    expect(cleanup()).toBe(firstCleanup);
    await firstCleanup;
    expect(prepared.close).toHaveBeenCalledTimes(1);
  });

  it.each([
    '<script type="module" src="/src/main.tsx"></script>',
    '<script type="module" src="/@vite/client"></script>',
  ])('rejects development markup instead of treating its listener as ready', async (html) => {
    const prepared = previewServer();
    const fetchReady = vi.fn().mockResolvedValue(new Response(html, { status: 200 }));
    viteBoundary.build.mockResolvedValue({});
    viteBoundary.preview.mockResolvedValue(prepared.server);
    vi.stubGlobal('fetch', fetchReady);
    const startFixturePreviewServer = await loadStartFixturePreviewServer();

    await expect(startFixturePreviewServer({ fixtureRoot, port, apiBaseUrl })).rejects.toThrow(
      /development-source markup/,
    );

    expect(fetchReady).toHaveBeenCalledTimes(1);
    expect(prepared.close).toHaveBeenCalledTimes(1);
  });

  it('closes the started preview server when the built asset is unavailable', async () => {
    const prepared = previewServer();
    const fetchReady = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('<script type="module" src="/assets/main.js"></script>', { status: 200 }),
      )
      .mockResolvedValueOnce(new Response('', { status: 503 }));
    viteBoundary.build.mockResolvedValue({});
    viteBoundary.preview.mockResolvedValue(prepared.server);
    vi.stubGlobal('fetch', fetchReady);
    const startFixturePreviewServer = await loadStartFixturePreviewServer();

    await expect(startFixturePreviewServer({ fixtureRoot, port, apiBaseUrl })).rejects.toThrow(
      /built asset is unavailable or not JavaScript/,
    );

    expect(prepared.close).toHaveBeenCalledTimes(1);
  });

  it('does not close an unstarted preview server when the build fails', async () => {
    const buildError = new Error('build failed');
    viteBoundary.build.mockRejectedValue(buildError);
    const startFixturePreviewServer = await loadStartFixturePreviewServer();

    await expect(startFixturePreviewServer({ fixtureRoot, port, apiBaseUrl })).rejects.toBe(
      buildError,
    );

    expect(viteBoundary.preview).not.toHaveBeenCalled();
  });
});
