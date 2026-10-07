import { resolve, sep } from 'node:path';

import { build, preview, type PreviewServer } from 'vite';

import { createViteServerLifecycle, type ViteServerCleanup } from './vite-server-lifecycle';

const host = '127.0.0.1';
const outputDirectoryName = 'preview-dist';
const cacheDirectoryName = 'vite-cache';

export interface FixturePreviewServerOptions {
  readonly fixtureRoot: string;
  readonly port: number;
  readonly apiBaseUrl: string;
}

function isContainedBy(candidate: string, root: string): boolean {
  return candidate.startsWith(`${root}${sep}`);
}

function resolveFixturePaths(fixtureRoot: string) {
  const root = resolve(fixtureRoot);
  const outDir = resolve(root, outputDirectoryName);
  const cacheDir = resolve(root, cacheDirectoryName);
  if (!isContainedBy(outDir, root) || !isContainedBy(cacheDir, root)) {
    throw new Error('Fixture preview output and cache must remain below the fixture root.');
  }
  return { root, outDir, cacheDir };
}

function builtAssetPath(html: string): string {
  if (/\/src\/|@vite\/client/u.test(html)) {
    throw new Error('Fixture preview readiness received development-source markup.');
  }
  const asset = /<script[^>]+src=["'](\/assets\/[^"']+\.js)["']/iu.exec(html)?.[1];
  if (!asset) throw new Error('Fixture preview readiness found no built JavaScript asset.');
  return asset;
}

async function assertBuiltApplicationReady(origin: string): Promise<void> {
  const htmlResponse = await fetch(`${origin}/`, { cache: 'no-store' });
  const html = await htmlResponse.text();
  if (!htmlResponse.ok) {
    throw new Error(`Fixture preview document returned HTTP ${htmlResponse.status}.`);
  }

  const assetResponse = await fetch(`${origin}${builtAssetPath(html)}`, { cache: 'no-store' });
  const asset = await assetResponse.text();
  const contentType = assetResponse.headers.get('content-type') ?? '';
  if (!assetResponse.ok || !/javascript/u.test(contentType) || asset.trim() === '') {
    throw new Error('Fixture preview built asset is unavailable or not JavaScript.');
  }
}

export async function startFixturePreviewServer({
  fixtureRoot,
  port,
  apiBaseUrl,
}: FixturePreviewServerOptions): Promise<ViteServerCleanup> {
  const { outDir, cacheDir } = resolveFixturePaths(fixtureRoot);
  const apiDefinition = JSON.stringify(apiBaseUrl);
  let server: PreviewServer | undefined;
  const { cleanup, waitWhileActive } = createViteServerLifecycle({
    close: async () => {
      await server?.close();
    },
    cancellationMessage: 'Fixture preview server startup was cancelled',
  });

  try {
    await waitWhileActive(() =>
      build({
        clearScreen: false,
        logLevel: 'warn',
        envFile: false,
        cacheDir,
        define: { 'import.meta.env.VITE_API_BASE_URL': apiDefinition },
        build: { outDir, emptyOutDir: true },
      }),
    );
    server = await waitWhileActive(() =>
      preview({
        clearScreen: false,
        logLevel: 'warn',
        envFile: false,
        cacheDir,
        define: { 'import.meta.env.VITE_API_BASE_URL': apiDefinition },
        build: { outDir },
        preview: { host, port, strictPort: true },
      }),
    );
    await waitWhileActive(() => assertBuiltApplicationReady(`http://${host}:${port}`));
  } catch (error) {
    await cleanup();
    throw error;
  }

  return cleanup;
}
