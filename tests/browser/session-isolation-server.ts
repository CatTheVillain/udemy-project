import { createServer } from 'vite';

import { createViteServerLifecycle } from './support/vite-server-lifecycle';

export type SessionIsolationServerCleanup = () => Promise<void>;

export interface SessionIsolationServerStartupObserver {
  readonly onCleanupReady: (cleanup: SessionIsolationServerCleanup) => void;
}

function resolvePort(): number {
  const configuredPort = Number(process.env.SESSION_ISOLATION_TEST_PORT ?? '4180');
  return Number.isInteger(configuredPort) && configuredPort > 0 ? configuredPort : 4180;
}

export async function startSessionIsolationViteServer(
  observer?: SessionIsolationServerStartupObserver,
): Promise<SessionIsolationServerCleanup> {
  const server = await createServer({
    clearScreen: false,
    logLevel: 'warn',
    envFile: false,
    appType: 'spa',
    optimizeDeps: {
      noDiscovery: true,
      include: [
        'react',
        'react-dom/client',
        'react-i18next',
        'i18next',
        'react-router-dom',
        '@tanstack/react-query',
        'lucide-react',
      ],
    },
    server: { host: '127.0.0.1', port: resolvePort(), strictPort: true },
  });
  const { cleanup, waitWhileActive } = createViteServerLifecycle({
    close: () => server.close(),
    cancellationMessage: 'Session-isolation Vite server startup was cancelled',
  });

  try {
    observer?.onCleanupReady(cleanup);
    await waitWhileActive(() => server.listen());
    await waitWhileActive(() => server.environments.client.warmupRequest('/src/main.tsx'));
    await waitWhileActive(() => server.environments.client.waitForRequestsIdle());
  } catch (error) {
    await cleanup();
    throw error;
  }

  return cleanup;
}

export default async function startSessionIsolationServer() {
  return startSessionIsolationViteServer();
}
