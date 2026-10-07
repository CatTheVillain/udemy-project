import { resolve } from 'node:path';

import { startFixturePreviewServer } from './support/fixture-preview-server';

function resolvePort(): number {
  const configuredPort = Number(process.env.SESSION_ISOLATION_TEST_PORT ?? '4180');
  return Number.isInteger(configuredPort) && configuredPort > 0 ? configuredPort : 4180;
}

export default async function startSessionIsolationPreviewServer() {
  const port = resolvePort();
  return startFixturePreviewServer({
    fixtureRoot: resolve(process.cwd(), 'runtime-temp', 'session-isolation-preview'),
    port,
    apiBaseUrl: `http://127.0.0.1:${port}`,
  });
}
