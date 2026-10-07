import { createServer } from 'vite';
import { createViteServerLifecycle } from './support/vite-server-lifecycle';

export const catalogDiscoveryOrigin = 'http://127.0.0.1:4178';

export default async function startCatalogServer() {
  const server = await createServer({
    clearScreen: false,
    logLevel: 'warn',
    envFile: false,
    appType: 'spa',
    server: {
      host: '127.0.0.1',
      port: 4178,
      strictPort: true,
      watch: { ignored: ['**/plans/**', '**/test-results/**'] },
    },
  });

  const { cleanup, waitWhileActive } = createViteServerLifecycle({
    close: () => server.close(),
    cancellationMessage: 'Catalog Vite server startup was cancelled',
  });

  try {
    await waitWhileActive(() => server.listen());
    await waitWhileActive(() => server.environments.client.warmupRequest('/src/main.tsx'));
    await waitWhileActive(() => server.environments.client.waitForRequestsIdle());
  } catch (error) {
    await cleanup();
    throw error;
  }
  return cleanup;
}
