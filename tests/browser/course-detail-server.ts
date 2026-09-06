import { createServer } from 'vite';

const courseDetailPort = Number.parseInt(process.env.COURSE_DETAIL_TEST_PORT ?? '4176', 10);
export const courseDetailOrigin = `http://127.0.0.1:${courseDetailPort}`;
const readinessDeadlineMs = 60_000;
const readinessPollIntervalMs = 100;

type HtmlFetcher = (input: string, init: RequestInit) => Promise<Response>;
type ReadinessWait = (milliseconds: number) => Promise<void>;

export interface HtmlReadinessOptions {
  readonly deadlineMs?: number;
  readonly pollIntervalMs?: number;
  readonly fetchHtml?: HtmlFetcher;
  readonly wait?: ReadinessWait;
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function describeReadinessFailure(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function waitForHtmlServerReady(origin: string, options: HtmlReadinessOptions = {}) {
  const deadlineMs = options.deadlineMs ?? readinessDeadlineMs;
  const pollIntervalMs = options.pollIntervalMs ?? readinessPollIntervalMs;
  const fetchHtml: HtmlFetcher = options.fetchHtml ?? ((input, init) => fetch(input, init));
  const pause = options.wait ?? wait;
  const deadline = Date.now() + deadlineMs;
  let lastFailure = 'no HTTP response received';

  while (Date.now() < deadline) {
    const remainingMs = deadline - Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.min(remainingMs, 5_000));

    try {
      const response = await fetchHtml(`${origin}/`, {
        signal: controller.signal,
        headers: { connection: 'close' },
      });
      const html = await response.text();
      if (response.ok && /<html[\s>]/i.test(html) && /<div\s+id=["']root["']/i.test(html)) {
        return;
      }
      lastFailure = `HTTP ${response.status} returned ${html.length} bytes without the app shell`;
    } catch (error) {
      lastFailure = describeReadinessFailure(error);
    } finally {
      clearTimeout(timeout);
    }

    const nextWaitMs = Math.min(pollIntervalMs, Math.max(0, deadline - Date.now()));
    if (nextWaitMs > 0) await pause(nextWaitMs);
  }

  throw new Error(
    `Course Detail Vite server at ${origin} did not return HTML before ${deadlineMs}ms: ${lastFailure}`,
  );
}

export default async function startCourseDetailServer() {
  if (process.env.COURSE_DETAIL_SERVER_ALREADY_RUNNING === '1') return async () => undefined;
  const server = await createServer({
    clearScreen: false,
    logLevel: 'warn',
    envFile: false,
    appType: 'spa',
    server: {
      host: '127.0.0.1',
      port: courseDetailPort,
      strictPort: true,
      watch: { ignored: ['**/plans/**', '**/test-results/**'] },
    },
  });
  try {
    await server.listen();
    await waitForHtmlServerReady(courseDetailOrigin);
  } catch (error) {
    await server.close();
    throw error;
  }
  return async () => server.close();
}
