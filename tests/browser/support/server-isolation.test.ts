import { rm } from 'node:fs/promises';
import { createServer as createNetServer, type Server } from 'node:net';
import { resolve, sep } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import startAppShellServer, {
  startAppShellViteServer,
  type AppShellServerCleanup,
} from '../app-shell-server';
import {
  startAuthWorkflowsViteServer,
  type AuthWorkflowsServerCleanup,
} from '../auth-workflows-server';
import startCartWorkflowServer, { cartWorkflowOrigin } from '../cart-workflow-server';
import * as fixturePreviewServer from './fixture-preview-server';

const temporaryRoots: string[] = [];
interface ServerScope {
  closed: boolean;
  readonly closers: Set<() => Promise<void>>;
}

type ServerCleanup = AppShellServerCleanup | AuthWorkflowsServerCleanup;
interface ServerStartupObserver {
  readonly onCleanupReady: (cleanup: ServerCleanup) => void;
}

type StartRealServer = (observer: ServerStartupObserver) => Promise<ServerCleanup>;

let serverScope: ServerScope;

function registerCloser(close: ServerCleanup): Promise<void> | undefined {
  if (serverScope.closed) return close();
  serverScope.closers.add(close);
  return undefined;
}

function startTracked(start: StartRealServer): Promise<Error | null> {
  return start({
    onCleanupReady: (close) => {
      void registerCloser(close);
    },
  }).then(
    async (close) => {
      if (serverScope.closed) {
        await close();
      } else {
        serverScope.closers.add(close);
      }
      return null;
    },
    (error: unknown) => (error instanceof Error ? error : new Error(String(error))),
  );
}

function listenOnStrictPort(server: Server, port: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

async function expectHttp200(url: string): Promise<void> {
  await vi.waitFor(
    async () => {
      let status: number | undefined;
      try {
        status = (await fetch(url)).status;
      } catch {
        status = undefined;
      }
      expect(status).toBe(200);
    },
    { interval: 50, timeout: 10_000 },
  );
}

afterEach(async () => {
  serverScope.closed = true;
  await Promise.all([...serverScope.closers].map((close) => close()));
  serverScope.closers.clear();
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('browser server isolation probes', () => {
  beforeEach(() => {
    serverScope = { closed: false, closers: new Set() };
  });

  it('attributes an occupied AppShell port', async () => {
    const blocker = createNetServer();
    await listenOnStrictPort(blocker, 4174);
    try {
      await expect(startAppShellServer()).rejects.toThrow(/4174|address already in use/i);
    } finally {
      await closeServer(blocker);
    }
  }, 15_000);

  it('releases real AppShell and Auth Vite global-setup servers', async () => {
    const startups = [
      startTracked((observer) =>
        startAppShellViteServer({ onCleanupReady: observer.onCleanupReady }),
      ),
      startTracked((observer) =>
        startAuthWorkflowsViteServer({ onCleanupReady: observer.onCleanupReady }),
      ),
    ];
    await Promise.all([
      expectHttp200('http://127.0.0.1:4174/'),
      expectHttp200('http://127.0.0.1:4175/'),
    ]);
    serverScope.closed = true;
    const closers = [...serverScope.closers];
    await Promise.all(closers.flatMap((close) => [close(), close()]));
    serverScope.closers.clear();
    const startupResults = await Promise.all(startups);
    for (const result of startupResults) {
      if (result) expect(result.message).toMatch(/Vite server startup was cancelled/);
    }
    const shellProbe = createNetServer();
    const authProbe = createNetServer();
    try {
      await Promise.all([
        listenOnStrictPort(shellProbe, 4174),
        listenOnStrictPort(authProbe, 4175),
      ]);
    } finally {
      await Promise.all([closeServer(shellProbe), closeServer(authProbe)]);
    }
  }, 120_000);

  it('cancels both real helpers before startup can outlive caller ownership', async () => {
    let appShellCancellation: Promise<void> | undefined;
    let authCancellation: Promise<void> | undefined;
    const appShellStartup = startAppShellViteServer({
      onCleanupReady: (close) => {
        const firstCleanup = close();
        expect(close()).toBe(firstCleanup);
        appShellCancellation = firstCleanup;
      },
    });
    const appShellRejected = expect(appShellStartup).rejects.toThrow(
      'AppShell Vite server startup was cancelled',
    );
    const authStartup = startAuthWorkflowsViteServer({
      onCleanupReady: (close) => {
        const firstCleanup = close();
        expect(close()).toBe(firstCleanup);
        authCancellation = firstCleanup;
      },
    });
    const authRejected = expect(authStartup).rejects.toThrow(
      'Auth Vite server startup was cancelled',
    );

    await Promise.all([appShellRejected, authRejected]);
    await Promise.all([appShellCancellation, authCancellation]);

    const shellProbe = createNetServer();
    const authProbe = createNetServer();
    try {
      await Promise.all([
        listenOnStrictPort(shellProbe, 4174),
        listenOnStrictPort(authProbe, 4175),
      ]);
    } finally {
      await Promise.all([closeServer(shellProbe), closeServer(authProbe)]);
    }
  }, 15_000);

  it('delegates Cart preview containment to the built-fixture helper', async () => {
    const cleanup = vi.fn<[], Promise<void>>().mockResolvedValue(undefined);
    const startFixturePreviewServer = vi
      .spyOn(fixturePreviewServer, 'startFixturePreviewServer')
      .mockResolvedValue(cleanup);
    try {
      const returnedCleanup = await startCartWorkflowServer();

      expect(startFixturePreviewServer).toHaveBeenCalledOnce();
      const [options] = startFixturePreviewServer.mock.calls[0];
      expect(resolve(options.fixtureRoot).startsWith(`${resolve(process.cwd())}${sep}`)).toBe(true);
      expect(options).toMatchObject({
        apiBaseUrl: cartWorkflowOrigin,
        port: Number(new URL(cartWorkflowOrigin).port),
      });
      expect(returnedCleanup).toBe(cleanup);
    } finally {
      startFixturePreviewServer.mockRestore();
    }
  });
});
