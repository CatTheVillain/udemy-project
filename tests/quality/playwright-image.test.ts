import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';

interface PackageManifestFixture {
  private?: boolean;
  devDependencies: Record<string, string>;
}
interface LockPackageFixture {
  version?: string;
  devDependencies?: Record<string, string>;
}
interface LockfileFixture {
  lockfileVersion: number;
  packages: Record<string, LockPackageFixture>;
}
interface DockerInfoFixture {
  driverVersion: string;
  dockerImageName: string;
}
interface PlaywrightVersionFixture {
  version: string;
  image: string;
}
interface ImageGuardFixture {
  root: string;
  markerPath: string;
  values: PlaywrightVersionFixture;
}
interface ImageGuardRun {
  status: number | null;
  stdout: string;
  stderr: string;
}
interface GuardRunOptions {
  argumentsList?: string[];
  image?: string;
}
interface ImageGuardFailureCase {
  name: string;
  category: string;
  arrange: (fixture: ImageGuardFixture) => Promise<GuardRunOptions | void>;
}

const temporaryPaths: string[] = [];
const guardPath = resolve('scripts/quality/verify-playwright-image.mjs');
const browserConfigPaths = [
  'tests/browser/playwright.config.ts',
  'tests/browser/mlux006-multilingual-closure.playwright.config.ts',
  'tests/browser/app-shell.playwright.config.ts',
  'tests/browser/auth-workflows.playwright.config.ts',
  'tests/browser/cart-workflow.playwright.config.ts',
  'tests/browser/catalog-discovery.playwright.config.ts',
  'tests/browser/checkout-cart.playwright.config.ts',
  'tests/browser/course-chat.playwright.config.ts',
  'tests/browser/course-detail.playwright.config.ts',
  'tests/browser/instructor-courses-fe029.playwright.config.ts',
  'tests/browser/instructor-course-editor-fe014.preview.playwright.config.ts',
  'tests/browser/instructor-course-editor-fe014.vite-controls.playwright.config.ts',
  'tests/browser/learning-progress.playwright.config.ts',
];

function assertSinglePilotImageLane(browser: string, expectedImage: string): void {
  const matrixStart = browser.indexOf('      matrix:\n');
  const includeStart = browser.indexOf('        include:\n');
  const environmentStart = browser.indexOf('    env:\n');
  const expectedConfigBlock = [
    '      matrix:',
    '        config:',
    ...browserConfigPaths.map((config) => `          - ${config}`),
    '',
  ].join('\n');
  const expectedIncludeBlock = [
    '        include:',
    '          - config: tests/browser/course-detail.playwright.config.ts',
    `            image: ${expectedImage}`,
    '',
  ].join('\n');

  expect(matrixStart).toBeGreaterThanOrEqual(0);
  expect(includeStart).toBeGreaterThan(matrixStart);
  expect(environmentStart).toBeGreaterThan(includeStart);
  expect(browser.slice(matrixStart, includeStart)).toBe(expectedConfigBlock);
  expect(browser.slice(includeStart, environmentStart)).toBe(expectedIncludeBlock);
}

function extractManifestMatchedPilotImage(browser: string, version: string): string {
  const versionPattern = version.replace(/\./g, '\\.');
  const imageMatch = browser.match(
    new RegExp(
      `^ {12}image: (mcr\\.microsoft\\.com/playwright:v${versionPattern}-noble@sha256:[0-9a-f]{64})$`,
      'm',
    ),
  );

  if (!imageMatch) {
    throw new Error(
      'Browser workflow does not contain a manifest-matched digest-pinned pilot image.',
    );
  }

  return imageMatch[1];
}

function imageFor(version: string): string {
  return `mcr.microsoft.com/playwright:v${version}-noble@sha256:${'a'.repeat(64)}`;
}

function packagePath(fixture: ImageGuardFixture): string {
  return resolve(fixture.root, 'package.json');
}
function lockPath(fixture: ImageGuardFixture): string {
  return resolve(fixture.root, 'package-lock.json');
}

async function readLockFixture(fixture: ImageGuardFixture): Promise<LockfileFixture> {
  return JSON.parse(await readFile(lockPath(fixture), 'utf8')) as LockfileFixture;
}

async function writeLockFixture(fixture: ImageGuardFixture, lock: LockfileFixture): Promise<void> {
  await writeFile(lockPath(fixture), `${JSON.stringify(lock)}\n`, 'utf8');
}

async function createFixture(version = '1.61.1'): Promise<ImageGuardFixture> {
  const root = await mkdtemp(resolve(tmpdir(), 'playwright-image-'));
  temporaryPaths.push(root);
  const fixture: ImageGuardFixture = {
    root,
    markerPath: resolve(root, 'docker-info.json'),
    values: { version, image: imageFor(version) },
  };
  const manifest: PackageManifestFixture = {
    private: true,
    devDependencies: { '@playwright/test': version },
  };
  const lock: LockfileFixture = {
    lockfileVersion: 3,
    packages: {
      '': { devDependencies: { '@playwright/test': version } },
      'node_modules/@playwright/test': { version },
      'node_modules/playwright': { version },
      'node_modules/playwright-core': { version },
    },
  };
  const marker: DockerInfoFixture = {
    driverVersion: version,
    dockerImageName: fixture.values.image.split('@')[0],
  };
  await writeFile(packagePath(fixture), `${JSON.stringify(manifest)}\n`, 'utf8');
  await writeLockFixture(fixture, lock);
  await writeFile(fixture.markerPath, `${JSON.stringify(marker)}\n`, 'utf8');
  return fixture;
}

function runGuard(fixture: ImageGuardFixture, options: GuardRunOptions = {}): ImageGuardRun {
  const environment = { ...process.env };
  if (options.image === '') delete environment.PLAYWRIGHT_IMAGE;
  else environment.PLAYWRIGHT_IMAGE = options.image ?? fixture.values.image;
  const result = spawnSync(
    process.execPath,
    [guardPath, ...(options.argumentsList ?? ['--docker-info', fixture.markerPath])],
    {
      cwd: fixture.root,
      encoding: 'utf8',
      shell: false,
      env: environment,
    },
  );
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function expectFailure(result: ImageGuardRun, category: string): void {
  const output = `${result.stdout}\n${result.stderr}`;
  expect(result.status, output).not.toBeNull();
  expect(result.status, output).not.toBe(0);
  expect(output).toContain(category);
  expect(output).not.toContain('PLAYWRIGHT_IMAGE_ACCEPTED');
}

afterAll(async () => {
  await Promise.all(temporaryPaths.map((path) => rm(path, { recursive: true, force: true })));
});

describe('Playwright image version guard', () => {
  it('accepts coherent current and future exact version sets through the process CLI', async () => {
    for (const version of ['1.61.1', '1.62.3']) {
      const fixture = await createFixture(version);
      const result = runGuard(fixture);
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(result.stdout).toContain('PLAYWRIGHT_IMAGE_ACCEPTED');
    }
  });

  it.each<ImageGuardFailureCase>([
    {
      name: 'missing package manifest',
      category: 'package.json is missing',
      arrange: async (fixture) => rm(packagePath(fixture)),
    },
    {
      name: 'malformed package manifest',
      category: 'package.json is malformed',
      arrange: async (fixture) => writeFile(packagePath(fixture), '{', 'utf8'),
    },
    {
      name: 'non-exact manifest version',
      category: 'package.json devDependencies.@playwright/test',
      arrange: async (fixture) =>
        writeFile(
          packagePath(fixture),
          '{"devDependencies":{"@playwright/test":"^1.61.1"}}\n',
          'utf8',
        ),
    },
    {
      name: 'missing lockfile',
      category: 'package-lock.json is missing',
      arrange: async (fixture) => rm(lockPath(fixture)),
    },
    {
      name: 'malformed lockfile',
      category: 'package-lock.json is malformed',
      arrange: async (fixture) => writeFile(lockPath(fixture), '{', 'utf8'),
    },
    {
      name: 'root lock mismatch',
      category: 'versions must match exactly',
      arrange: async (fixture) => {
        const lock = await readLockFixture(fixture);
        lock.packages[''].devDependencies = { '@playwright/test': '1.61.2' };
        await writeLockFixture(fixture, lock);
      },
    },
    ...[
      'node_modules/@playwright/test',
      'node_modules/playwright',
      'node_modules/playwright-core',
    ].map(
      (entryPath): ImageGuardFailureCase => ({
        name: `mismatched required lock entry ${entryPath}`,
        category: 'versions must match exactly',
        arrange: async (fixture) => {
          const lock = await readLockFixture(fixture);
          lock.packages[entryPath] = { version: '1.61.2' };
          await writeLockFixture(fixture, lock);
        },
      }),
    ),
    ...[
      'node_modules/@playwright/test',
      'node_modules/playwright',
      'node_modules/playwright-core',
    ].map(
      (entryPath): ImageGuardFailureCase => ({
        name: `missing required lock entry ${entryPath}`,
        category: `package-lock.json ${entryPath}`,
        arrange: async (fixture) => {
          const lock = await readLockFixture(fixture);
          delete lock.packages[entryPath];
          await writeLockFixture(fixture, lock);
        },
      }),
    ),
    {
      name: 'nested shadowing lock mismatch',
      category: 'versions must match exactly',
      arrange: async (fixture) => {
        const lock = await readLockFixture(fixture);
        lock.packages['node_modules/@playwright/test/node_modules/playwright'] = {
          version: '1.61.2',
        };
        await writeLockFixture(fixture, lock);
      },
    },
    {
      name: 'missing marker',
      category: 'docker-info is missing',
      arrange: async (fixture) => rm(fixture.markerPath),
    },
    {
      name: 'malformed marker',
      category: 'docker-info is malformed',
      arrange: async (fixture) => writeFile(fixture.markerPath, '{', 'utf8'),
    },
    {
      name: 'marker driver mismatch',
      category: 'driverVersion',
      arrange: async (fixture) =>
        writeFile(
          fixture.markerPath,
          JSON.stringify({
            driverVersion: '1.61.2',
            dockerImageName: fixture.values.image.split('@')[0],
          }),
          'utf8',
        ),
    },
    {
      name: 'marker image-name mismatch',
      category: 'dockerImageName',
      arrange: async (fixture) =>
        writeFile(
          fixture.markerPath,
          JSON.stringify({
            driverVersion: fixture.values.version,
            dockerImageName: 'mcr.microsoft.com/playwright:v1.61.2-noble',
          }),
          'utf8',
        ),
    },
    {
      name: 'package image mismatch',
      category: 'versions must match exactly',
      arrange: async () => ({ image: imageFor('1.61.2') }),
    },
    {
      name: 'unpinned image',
      category: 'PLAYWRIGHT_IMAGE',
      arrange: async () => ({ image: 'mcr.microsoft.com/playwright:v1.61.1-noble' }),
    },
    {
      name: 'missing image environment',
      category: 'PLAYWRIGHT_IMAGE',
      arrange: async () => ({ image: '' }),
    },
    {
      name: 'value-less docker-info argument',
      category: 'unknown argument',
      arrange: async () => ({ argumentsList: ['--docker-info'] }),
    },
    {
      name: 'unknown argument',
      category: 'unknown argument',
      arrange: async () => ({ argumentsList: ['--unknown'] }),
    },
  ])('rejects $name with a fail-closed process result', async ({ category, arrange }) => {
    const fixture = await createFixture();
    const options = await arrange(fixture);
    expectFailure(runGuard(fixture, options ?? {}), category);
  });

  it('keeps the scalar matrix and wires the pilot before installation using the manifest version', async () => {
    const [workflow, manifestContent] = await Promise.all([
      readFile(resolve('.github/workflows/frontend-quality.yml'), 'utf8'),
      readFile(resolve('package.json'), 'utf8'),
    ]);
    const manifest = JSON.parse(manifestContent) as PackageManifestFixture;
    const version = manifest.devDependencies['@playwright/test'];
    const workflowText = workflow.replace(/\r\n/g, '\n');
    const browser = workflowText.slice(
      workflowText.indexOf('  browser:\n'),
      workflowText.indexOf('  quality-report:\n'),
    );
    const expectedImage = extractManifestMatchedPilotImage(browser, version);

    expect(browser).toContain('name: browser (${{ matrix.config }})');
    expect(browser).toContain("image: ${{ matrix.image || '' }}");
    expect(browser).toContain('options: --init --ipc=host');
    expect(browser).toContain('defaults:\n      run:\n        shell: bash');
    expect(browser).toContain('node-version: 20\n          cache: npm');
    assertSinglePilotImageLane(browser, expectedImage);
    expect(browser).toContain(
      "if: matrix.image != ''\n        name: Guard Playwright image and locked version",
    );
    expect(browser).toContain('PLAYWRIGHT_IMAGE: ${{ matrix.image }}');
    expect(browser).toContain(
      "if: matrix.image == ''\n        run: npx playwright install --with-deps chromium",
    );
    expect(browser).toContain(
      'npx playwright test --config "${{ matrix.config }}" --project=chromium --workers=1 --retries=0 --reporter=line',
    );

    const checkoutIndex = browser.indexOf('actions/checkout@');
    const setupNodeIndex = browser.indexOf('actions/setup-node@');
    const guardIndex = browser.indexOf('Guard Playwright image and locked version');
    const installIndex = browser.indexOf('- run: npm ci');
    const testIndex = browser.indexOf('npx playwright test --config');
    expect(checkoutIndex).toBeGreaterThanOrEqual(0);
    expect(setupNodeIndex).toBeGreaterThan(checkoutIndex);
    expect(guardIndex).toBeGreaterThan(setupNodeIndex);
    expect(installIndex).toBeGreaterThan(guardIndex);
    expect(testIndex).toBeGreaterThan(installIndex);
  });

  it('rejects static and dynamic attempts to add a second image lane', async () => {
    const [workflow, manifestContent] = await Promise.all([
      readFile(resolve('.github/workflows/frontend-quality.yml'), 'utf8'),
      readFile(resolve('package.json'), 'utf8'),
    ]);
    const manifest = JSON.parse(manifestContent) as PackageManifestFixture;
    const workflowText = workflow.replace(/\r\n/g, '\n');
    const browser = workflowText.slice(
      workflowText.indexOf('  browser:\n'),
      workflowText.indexOf('  quality-report:\n'),
    );
    const expectedImage = extractManifestMatchedPilotImage(
      browser,
      manifest.devDependencies['@playwright/test'],
    );
    const extraStaticImageLane = [
      '          - config: tests/browser/course-chat.playwright.config.ts',
      `            image: mcr.microsoft.com/playwright:v9.99.9-noble@sha256:${'b'.repeat(64)}`,
      '',
    ].join('\n');
    const extraDynamicImageLane = [
      '          - config: tests/browser/course-chat.playwright.config.ts',
      '            image: ${{ inputs.playwright_image }}',
      '',
    ].join('\n');
    const includeEnd = browser.indexOf('    env:\n');

    expect(includeEnd).toBeGreaterThanOrEqual(0);
    expect(() =>
      assertSinglePilotImageLane(
        `${browser.slice(0, includeEnd)}${extraStaticImageLane}${browser.slice(includeEnd)}`,
        expectedImage,
      ),
    ).toThrow();
    expect(() =>
      assertSinglePilotImageLane(
        `${browser.slice(0, includeEnd)}${extraDynamicImageLane}${browser.slice(includeEnd)}`,
        expectedImage,
      ),
    ).toThrow();
  });
});
