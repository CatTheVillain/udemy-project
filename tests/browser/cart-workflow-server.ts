import { resolve } from 'node:path';

import { startFixturePreviewServer } from './support/fixture-preview-server';

const defaultCartWorkflowPort = 4177;

function cartWorkflowPort(): number {
  const override = process.env.CART_WORKFLOW_TEST_PORT;
  if (override === undefined) return defaultCartWorkflowPort;
  const port = Number(override);
  if (!Number.isInteger(port) || port < 1024 || port > 65_535)
    throw new Error('CART_WORKFLOW_TEST_PORT must be an integer from 1024 to 65535.');
  return port;
}

const port = cartWorkflowPort();
export const cartWorkflowOrigin = `http://127.0.0.1:${port}`;
export default function startCartWorkflowServer() {
  return startFixturePreviewServer({
    fixtureRoot: resolve(process.cwd(), 'test-results', 'cart-workflow-preview'),
    port,
    apiBaseUrl: cartWorkflowOrigin,
  });
}
