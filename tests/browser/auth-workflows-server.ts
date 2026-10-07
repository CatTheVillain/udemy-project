import { createServer } from 'vite';
import { createViteServerLifecycle } from './support/vite-server-lifecycle';

export type AuthWorkflowsServerCleanup = () => Promise<void>;

export interface AuthWorkflowsServerStartupObserver {
  readonly onCleanupReady: (cleanup: AuthWorkflowsServerCleanup) => void;
}

export async function startAuthWorkflowsViteServer(
  observer?: AuthWorkflowsServerStartupObserver,
): Promise<AuthWorkflowsServerCleanup> {
  const server = await createServer({
    clearScreen: false,
    logLevel: 'warn',
    envFile: false,
    appType: 'spa',
    optimizeDeps: {
      noDiscovery: true,
      include: ['react', 'react-dom/client', 'use-sync-external-store/shim'],
    },
    server: { host: '127.0.0.1', port: 4175, strictPort: true, watch: null },
  });
  const { cleanup, waitWhileActive } = createViteServerLifecycle({
    close: () => server.close(),
    cancellationMessage: 'Auth Vite server startup was cancelled',
  });
  try {
    observer?.onCleanupReady(cleanup);
    await waitWhileActive(() => server.listen());
    await waitWhileActive(() => server.warmupRequest('/src/main.tsx'));
    await waitWhileActive(() => server.environments.client.waitForRequestsIdle('/src/main.tsx'));
  } catch (error) {
    await cleanup();
    throw error;
  }
  return cleanup;
}

export default async function startAuthWorkflowsServer() {
  return startAuthWorkflowsViteServer();
}
