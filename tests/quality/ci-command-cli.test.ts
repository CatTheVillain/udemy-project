import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createCiGroupResultEnvelope,
  parseCiGroupResultEnvelope,
} from '../../scripts/quality/ci-command-results.mjs';
import type { CiGroupAnalysis, CiRunIdentity } from '../../scripts/quality/ci-command-results.mjs';
import { qualityCommandPlan } from '../../scripts/quality/quality-commands.mjs';
import { CI_GROUP_IDS } from '../../scripts/quality/report-utils.mjs';
import type {
  QualityCommand,
  QualityCommandId,
  ToolVersions,
} from '../../scripts/quality/report-utils.mjs';

interface CliFixture {
  root: string;
  sha: string;
  runner: string;
  verifier: string;
  aggregateVerifier: string;
  preload: string;
}

interface SpawnTraceRecord {
  command: string;
  args: string[];
}

interface ResultFixture {
  directory: string;
  producerResults: string;
  output: string;
}

const temporaryPaths: string[] = [];
const ciRun: CiRunIdentity = { runId: '4312', runAttempt: '2' };
const deterministicReportLimitation =
  'Report pass is deterministic evidence only; it is not a semantic or architectural Review or QA verdict.';
const toolVersions: ToolVersions = {
  node: 'v20.19.1',
  npm: '10.8.2',
  typescript: '5.8.3',
  prettier: '3.6.2',
  stylelint: '16.24.0',
  eslint: '8.57.0',
};
const realCliModules = [
  'ci-command-results.mjs',
  'quality-commands.mjs',
  'quality-decisions.mjs',
  'report-summary.mjs',
  'report-utils.mjs',
  'report.schema.json',
  'run-quality.mjs',
  'verify-ci-aggregate.mjs',
  'verify-report.mjs',
];

function diagnostics(): QualityCommand['diagnostics'] {
  return {
    allowedRouterFutureWarnings: 0,
    unexpectedReactActWarnings: 0,
    unexpectedUnhandledRejections: 0,
    unexpectedConsoleWarnings: 0,
    unexpectedGenericWarnings: 0,
  };
}

function passingCommand(id: QualityCommandId): QualityCommand {
  return {
    id,
    status: 'pass',
    durationMs: 1,
    exitCode: 0,
    errorCode: null,
    diagnostics: diagnostics(),
  };
}

function lintStaticAnalysis(): CiGroupAnalysis {
  return {
    findings: [],
    suppressions: [],
    advisory: {
      complexitySignals: [],
      complexityReview: {
        basis: 'independent-responsibilities',
        guidance: 'Fixture preserves the required responsibility review contract.',
      },
    },
    configVersions: { reportSchema: 3, staticRules: 2 },
  };
}

function runGit(root: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', shell: false });
  if (result.status !== 0) {
    throw new Error(`Fixture Git failed: git ${args.join(' ')}\n${result.stderr}`);
  }
  return result.stdout.trim();
}

function environmentWithoutNpmUserAgent(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key !== 'npm_config_user_agent'),
  );
}

async function writeTracePreload(path: string): Promise<void> {
  await writeFile(
    path,
    [
      "import { appendFileSync } from 'node:fs';",
      "import { createRequire, syncBuiltinESMExports } from 'node:module';",
      'const require = createRequire(import.meta.url);',
      "const childProcess = require('node:child_process');",
      'const originalSpawnSync = childProcess.spawnSync;',
      'childProcess.spawnSync = (command, args, options) => {',
      "  appendFileSync(process.env.CI_SPAWN_TRACE_PATH, `${JSON.stringify({ command, args })}\\n`, 'utf8');",
      '  return originalSpawnSync(command, args, options);',
      '};',
      'syncBuiltinESMExports();',
    ].join('\n'),
    'utf8',
  );
}

async function createCliFixture(controlledProducer = false): Promise<CliFixture> {
  const root = await mkdtemp(resolve(tmpdir(), 'ci-quality-cli-'));
  temporaryPaths.push(root);
  const qualityDirectory = resolve(root, 'scripts/quality');
  await mkdir(qualityDirectory, { recursive: true });
  await mkdir(resolve(root, 'tests'), { recursive: true });
  for (const moduleName of realCliModules) {
    if (controlledProducer && moduleName === 'quality-commands.mjs') continue;
    await copyFile(resolve('scripts/quality', moduleName), resolve(qualityDirectory, moduleName));
  }
  if (controlledProducer) {
    await writeFile(
      resolve(qualityDirectory, 'quality-commands.mjs'),
      [
        "import { appendFileSync } from 'node:fs';",
        "import { QUALITY_COMMAND_GROUPS } from './report-utils.mjs';",
        'const diagnostics = { allowedRouterFutureWarnings: 0, unexpectedReactActWarnings: 0, unexpectedUnhandledRejections: 0, unexpectedConsoleWarnings: 0, unexpectedGenericWarnings: 0 };',
        'export function executeQualityGroup(group) {',
        "  appendFileSync(process.env.CONTROLLED_EXECUTOR_TRACE, `${group}\\n`, 'utf8');",
        "  const commandFailure = process.env.CONTROLLED_COMMAND_FAILURE === 'true';",
        '  return QUALITY_COMMAND_GROUPS[group].map((id, index) => ({',
        "    command: { id, status: commandFailure && index === 0 ? 'fail' : 'pass', durationMs: 1, exitCode: commandFailure && index === 0 ? 1 : 0, errorCode: commandFailure && index === 0 ? 'CONTROLLED_FAILURE' : null, diagnostics },",
        "    stdout: commandFailure && index === 0 ? 'private raw failure output' : '',",
        "    stderr: '',",
        '    hasUnexpectedDiagnostics: false,',
        '  }));',
        '}',
        "export function qualityCommandPlan({ mode, group }) { if (mode === 'full') return ['format', 'stylelint', 'lint', 'quality-lint', 'typecheck', 'static-rules', 'tests', 'build'].map((id) => ({ id })); if (mode === 'ci-group' && QUALITY_COMMAND_GROUPS[group]) return QUALITY_COMMAND_GROUPS[group].map((id) => ({ id })); throw new Error('unsupported controlled plan'); }",
        "export function executeQualityCommand(entry) { return { command: { id: entry.id, status: 'pass', durationMs: 1, exitCode: 0, errorCode: null, diagnostics }, stdout: '', stderr: '', hasUnexpectedDiagnostics: false }; }",
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      resolve(qualityDirectory, 'check-static.mjs'),
      [
        "export async function collectStaticFindings() { return [{ category: 'controlled', file: 'scripts/quality/run-quality.mjs', line: 1, ruleId: 'CONTROLLED_FINDING', message: 'controlled finding' }]; }",
        'export function staticSuppressions() { return []; }',
        'export async function collectComplexitySignals() { return []; }',
        "export const complexityReview = { basis: 'independent-responsibilities', guidance: 'Controlled fixture preserves the required responsibility review contract.' };",
      ].join('\n'),
      'utf8',
    );
  }
  await writeFile(
    resolve(root, 'package.json'),
    `${JSON.stringify({
      private: true,
      scripts: { quality: 'node scripts/quality/run-quality.mjs' },
      devDependencies: {
        typescript: toolVersions.typescript,
        prettier: toolVersions.prettier,
        stylelint: toolVersions.stylelint,
        eslint: toolVersions.eslint,
      },
    })}\n`,
    'utf8',
  );
  await writeFile(resolve(root, 'tests/.keep'), '', 'utf8');
  await mkdir(resolve(root, '.git-hooks-empty'));
  const preload = resolve(root, 'trace-preload.mjs');
  await writeTracePreload(preload);
  runGit(root, ['init']);
  runGit(root, ['config', 'user.email', 'ci-fixture@example.invalid']);
  runGit(root, ['config', 'user.name', 'CI Fixture']);
  runGit(root, ['config', 'commit.gpgsign', 'false']);
  runGit(root, ['config', 'core.hooksPath', '.git-hooks-empty']);
  runGit(root, ['add', '.']);
  runGit(root, ['commit', '-m', 'private CI fixture']);
  return {
    root,
    sha: runGit(root, ['rev-parse', 'HEAD']),
    runner: resolve(qualityDirectory, 'run-quality.mjs'),
    verifier: resolve(qualityDirectory, 'verify-report.mjs'),
    aggregateVerifier: resolve(qualityDirectory, 'verify-ci-aggregate.mjs'),
    preload,
  };
}

async function writeValidResults(
  fixture: CliFixture,
  name: string,
  identity: CiRunIdentity = ciRun,
  attempts: Partial<Record<(typeof CI_GROUP_IDS)[number], string>> = {},
): Promise<ResultFixture> {
  const caseRoot = resolve(fixture.root, 'cases', name);
  const directory = resolve(caseRoot, 'quality-results');
  await mkdir(directory, { recursive: true });
  for (const group of CI_GROUP_IDS) {
    const runAttempt = attempts[group] ?? identity.runAttempt;
    const envelope = createCiGroupResultEnvelope({
      group,
      sha: fixture.sha,
      ciRun: { ...identity, runAttempt },
      generatedAt: new Date().toISOString(),
      commands: qualityCommandPlan({ mode: 'ci-group', group }).map(({ id }) => passingCommand(id)),
      toolVersions,
      ...(group === 'lint-static' ? { analysis: lintStaticAnalysis() } : {}),
    });
    await writeFile(resolve(directory, `${group}.json`), `${JSON.stringify(envelope)}\n`, 'utf8');
  }
  const producerResults = resolve(caseRoot, 'producer-results.json');
  await writeFile(
    producerResults,
    `${JSON.stringify(
      Object.fromEntries(
        CI_GROUP_IDS.map((group) => [
          group,
          { result: 'success', runAttempt: attempts[group] ?? identity.runAttempt },
        ]),
      ),
    )}\n`,
    'utf8',
  );
  return { directory, producerResults, output: resolve(caseRoot, 'current.json') };
}

function assemblyArguments(
  fixture: CliFixture,
  result: ResultFixture,
  sha = fixture.sha,
  identity: CiRunIdentity = ciRun,
): string[] {
  return [
    '--scope',
    'ci',
    '--ci-results',
    result.directory,
    '--producer-results',
    result.producerResults,
    '--sha',
    sha,
    '--run-id',
    identity.runId,
    '--run-attempt',
    identity.runAttempt,
    '--output',
    result.output,
  ];
}

function runCli(
  fixture: CliFixture,
  args: string[],
  tracePath: string,
  identity: CiRunIdentity = ciRun,
) {
  return spawnSync(
    process.execPath,
    ['--import', pathToFileURL(fixture.preload).href, fixture.runner, ...args],
    {
      cwd: fixture.root,
      encoding: 'utf8',
      shell: false,
      env: {
        ...process.env,
        CI: 'true',
        GITHUB_RUN_ID: identity.runId,
        GITHUB_RUN_ATTEMPT: identity.runAttempt,
        CI_SPAWN_TRACE_PATH: tracePath,
        npm_config_user_agent: 'npm/10.8.2 node/v20.19.1 win32 x64',
      },
    },
  );
}

async function readTrace(path: string): Promise<SpawnTraceRecord[]> {
  if (!existsSync(path)) return [];
  return (await readFile(path, 'utf8'))
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as SpawnTraceRecord);
}

let fixture: CliFixture;
let producerFixture: CliFixture;

beforeAll(async () => {
  fixture = await createCliFixture();
  producerFixture = await createCliFixture(true);
});

afterAll(async () => {
  await Promise.all(temporaryPaths.map((path) => rm(path, { recursive: true, force: true })));
});

describe('dependency-free CI quality CLI', () => {
  it('emits the mandatory limitation in a constructed local full report', async () => {
    const caseRoot = resolve(producerFixture.root, 'cases/local-limitation');
    const output = resolve(caseRoot, 'quality-report.json');
    const patch = resolve(caseRoot, 'review.patch');
    await mkdir(resolve(producerFixture.root, 'src'), { recursive: true });
    await mkdir(caseRoot, { recursive: true });
    await writeFile(resolve(producerFixture.root, 'src/fixture.ts'), 'export const version = 2;\n');
    await writeFile(
      patch,
      '--- a/src/fixture.ts\n+++ b/src/fixture.ts\n@@ -1 +1 @@\n-export const version = 1;\n+export const version = 2;\n',
    );

    const result = spawnSync(
      process.execPath,
      [
        producerFixture.runner,
        '--scope',
        'full',
        '--target-patch',
        patch,
        '--target-root',
        producerFixture.root,
        '--base-root',
        producerFixture.root,
        '--output',
        output,
      ],
      {
        cwd: producerFixture.root,
        encoding: 'utf8',
        shell: false,
        env: {
          ...environmentWithoutNpmUserAgent(),
          QUALITY_REPORT_ATTESTATION_KEY: 'controlled-local-attestation-key',
        },
      },
    );

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(1);
    expect(existsSync(output), `${result.stdout}\n${result.stderr}`).toBe(true);
    const report = JSON.parse(await readFile(output, 'utf8')) as { limitations: string[] };
    expect(report.limitations).toContain(deterministicReportLimitation);
  });

  it('assembles exact current-run receipts with only the HEAD lookup and passes both real gates', async () => {
    const result = await writeValidResults(fixture, 'positive');
    const tracePath = resolve(fixture.root, 'cases/positive/spawn-trace.jsonl');
    const assembly = runCli(fixture, assemblyArguments(fixture, result), tracePath);

    expect(assembly.status, `${assembly.stdout}\n${assembly.stderr}`).toBe(0);
    expect(await readTrace(tracePath)).toEqual([{ command: 'git', args: ['rev-parse', 'HEAD'] }]);
    expect(existsSync(resolve(fixture.root, 'node_modules'))).toBe(false);
    expect(existsSync(resolve(fixture.root, 'scripts/quality/check-static.mjs'))).toBe(false);

    const verification = spawnSync(
      process.execPath,
      [
        fixture.verifier,
        '--report',
        result.output,
        '--scope',
        'ci',
        '--sha',
        fixture.sha,
        '--run-id',
        ciRun.runId,
        '--run-attempt',
        ciRun.runAttempt,
      ],
      { cwd: fixture.root, encoding: 'utf8', shell: false },
    );
    expect(verification.status, `${verification.stdout}\n${verification.stderr}`).toBe(0);
    expect(verification.stdout).toContain('QUALITY_REPORT_ACCEPTED');

    const missingRunIdentity = spawnSync(
      process.execPath,
      [
        fixture.verifier,
        '--report',
        result.output,
        '--scope',
        'ci',
        '--sha',
        fixture.sha,
        '--run-id',
        ciRun.runId,
      ],
      { cwd: fixture.root, encoding: 'utf8', shell: false },
    );
    expect(missingRunIdentity.status).not.toBe(0);

    const mismatchedRunIdentity = spawnSync(
      process.execPath,
      [
        fixture.verifier,
        '--report',
        result.output,
        '--scope',
        'ci',
        '--sha',
        fixture.sha,
        '--run-id',
        '999',
        '--run-attempt',
        ciRun.runAttempt,
      ],
      { cwd: fixture.root, encoding: 'utf8', shell: false },
    );
    expect(mismatchedRunIdentity.status).not.toBe(0);

    const needs = Object.fromEntries(
      ['lint-static', 'typecheck', 'tests', 'build', 'browser', 'quality-report'].map((job) => [
        job,
        { result: 'success' },
      ]),
    );
    const aggregate = spawnSync(process.execPath, [fixture.aggregateVerifier], {
      cwd: fixture.root,
      encoding: 'utf8',
      shell: false,
      env: {
        ...process.env,
        QUALITY_REPORT_PATH: result.output,
        QUALITY_TARGET_SHA: fixture.sha,
        GITHUB_RUN_ID: ciRun.runId,
        GITHUB_RUN_ATTEMPT: ciRun.runAttempt,
        QUALITY_REPORT_RUN_ATTEMPT: ciRun.runAttempt,
        NEEDS: JSON.stringify(needs),
      },
    });
    expect(aggregate.status, `${aggregate.stdout}\n${aggregate.stderr}`).toBe(0);
    expect(aggregate.stdout).toContain('QUALITY_CI_AGGREGATE_ACCEPTED');

    const missingAggregateRunIdentity = spawnSync(process.execPath, [fixture.aggregateVerifier], {
      cwd: fixture.root,
      encoding: 'utf8',
      shell: false,
      env: {
        ...process.env,
        QUALITY_REPORT_PATH: result.output,
        QUALITY_TARGET_SHA: fixture.sha,
        GITHUB_RUN_ID: ciRun.runId,
        GITHUB_RUN_ATTEMPT: '',
        QUALITY_REPORT_RUN_ATTEMPT: ciRun.runAttempt,
        NEEDS: JSON.stringify(needs),
      },
    });
    expect(missingAggregateRunIdentity.status).not.toBe(0);

    const mismatchedAggregateRunIdentity = spawnSync(
      process.execPath,
      [fixture.aggregateVerifier],
      {
        cwd: fixture.root,
        encoding: 'utf8',
        shell: false,
        env: {
          ...process.env,
          QUALITY_REPORT_PATH: result.output,
          QUALITY_TARGET_SHA: fixture.sha,
          GITHUB_RUN_ID: '999',
          GITHUB_RUN_ATTEMPT: ciRun.runAttempt,
          QUALITY_REPORT_RUN_ATTEMPT: ciRun.runAttempt,
          NEEDS: JSON.stringify(needs),
        },
      },
    );
    expect(mismatchedAggregateRunIdentity.status).not.toBe(0);
  });

  it('assembles exact mixed producer attempts from their published outputs', async () => {
    const attempts = { 'lint-static': '1', typecheck: '1', tests: '2', build: '1' } as const;
    const mixed = await writeValidResults(fixture, 'mixed-attempts', ciRun, attempts);
    const mixedTrace = resolve(fixture.root, 'cases/mixed-attempts/spawn-trace.jsonl');
    const mixedAssembly = runCli(fixture, assemblyArguments(fixture, mixed), mixedTrace);
    expect(mixedAssembly.status, `${mixedAssembly.stdout}\n${mixedAssembly.stderr}`).toBe(0);
    expect(await readTrace(mixedTrace)).toEqual([{ command: 'git', args: ['rev-parse', 'HEAD'] }]);
  });

  it('admits an unchanged report on a browser-only rerun', async () => {
    const firstRun: CiRunIdentity = { runId: ciRun.runId, runAttempt: '1' };
    const first = await writeValidResults(fixture, 'browser-only-report', firstRun);
    const firstTrace = resolve(fixture.root, 'cases/browser-only-report/spawn-trace.jsonl');
    const firstAssembly = runCli(
      fixture,
      assemblyArguments(fixture, first, fixture.sha, firstRun),
      firstTrace,
      firstRun,
    );
    expect(firstAssembly.status, `${firstAssembly.stdout}\n${firstAssembly.stderr}`).toBe(0);

    const needs = Object.fromEntries(
      ['lint-static', 'typecheck', 'tests', 'build', 'browser', 'quality-report'].map((job) => [
        job,
        { result: 'success' },
      ]),
    );
    const aggregateEnvironment = {
      ...process.env,
      QUALITY_REPORT_PATH: first.output,
      QUALITY_TARGET_SHA: fixture.sha,
      GITHUB_RUN_ID: ciRun.runId,
      GITHUB_RUN_ATTEMPT: ciRun.runAttempt,
      QUALITY_REPORT_RUN_ATTEMPT: firstRun.runAttempt,
      NEEDS: JSON.stringify(needs),
    };
    const aggregate = spawnSync(process.execPath, [fixture.aggregateVerifier], {
      cwd: fixture.root,
      encoding: 'utf8',
      shell: false,
      env: aggregateEnvironment,
    });
    expect(aggregate.status, `${aggregate.stdout}\n${aggregate.stderr}`).toBe(0);

    for (const publishedAttempt of ['', '0', '2', '3', '1.0', '1e0']) {
      const rejected = spawnSync(process.execPath, [fixture.aggregateVerifier], {
        cwd: fixture.root,
        encoding: 'utf8',
        shell: false,
        env: { ...aggregateEnvironment, QUALITY_REPORT_RUN_ATTEMPT: publishedAttempt },
      });
      expect(
        rejected.status,
        `${publishedAttempt}\n${rejected.stdout}\n${rejected.stderr}`,
      ).not.toBe(0);
    }
  });

  it('rejects malformed protocol options before any child process is spawned', async () => {
    const cases = [
      ['--ci-group', 'unknown', '--output', 'unknown.json'],
      ['--ci-group', 'tests', '--ci-results', 'results', '--output', 'mixed.json'],
      [
        '--ci-group',
        'tests',
        '--sha',
        'not-a-sha',
        '--run-id',
        '1',
        '--run-attempt',
        '1',
        '--output',
        'bad-sha.json',
      ],
      ['--ci-group', 'tests', '--target-patch', 'review.patch', '--output', 'patch.json'],
      ['--ci-results', 'results', '--output', 'missing-state.json'],
      ['--ci-group', 'tests'],
    ];

    for (const [index, args] of cases.entries()) {
      const tracePath = resolve(fixture.root, `cases/invalid-${index}-trace.jsonl`);
      const result = runCli(fixture, args, tracePath);
      expect(result.status, `${args.join(' ')}\n${result.stdout}\n${result.stderr}`).not.toBe(0);
      expect(await readTrace(tracePath)).toEqual([]);
    }
  });

  it('rejects extra and nonregular result records before the HEAD lookup', async () => {
    const extra = await writeValidResults(fixture, 'extra');
    await writeFile(resolve(extra.directory, 'unexpected.json'), '{}\n', 'utf8');
    const extraTrace = resolve(fixture.root, 'cases/extra/spawn-trace.jsonl');
    expect(runCli(fixture, assemblyArguments(fixture, extra), extraTrace).status).not.toBe(0);
    expect(await readTrace(extraTrace)).toEqual([]);

    const nonregular = await writeValidResults(fixture, 'nonregular');
    const expectedFile = resolve(nonregular.directory, 'tests.json');
    await rm(expectedFile);
    await mkdir(expectedFile);
    const nonregularTrace = resolve(fixture.root, 'cases/nonregular/spawn-trace.jsonl');
    expect(
      runCli(fixture, assemblyArguments(fixture, nonregular), nonregularTrace).status,
    ).not.toBe(0);
    expect(await readTrace(nonregularTrace)).toEqual([]);
  });

  it('rejects oversized, malformed, invalid-UTF8, wrong-run, wrong-head, and failed-producer inputs', async () => {
    const oversized = await writeValidResults(fixture, 'oversized');
    await writeFile(resolve(oversized.directory, 'tests.json'), Buffer.alloc(1024 * 1024 + 1));
    const oversizedTrace = resolve(fixture.root, 'cases/oversized/spawn-trace.jsonl');
    expect(runCli(fixture, assemblyArguments(fixture, oversized), oversizedTrace).status).not.toBe(
      0,
    );
    expect(await readTrace(oversizedTrace)).toHaveLength(1);

    const oversizedProducerState = await writeValidResults(fixture, 'oversized-producer-state');
    await writeFile(oversizedProducerState.producerResults, Buffer.alloc(1024 * 1024 + 1));
    const oversizedProducerStateResult = runCli(
      fixture,
      assemblyArguments(fixture, oversizedProducerState),
      resolve(fixture.root, 'cases/oversized-producer-state/spawn-trace.jsonl'),
    );
    expect(oversizedProducerStateResult.status).not.toBe(0);
    expect(oversizedProducerStateResult.stderr).toContain('producer results size is invalid');

    for (const [name, payload] of [
      ['invalid-utf8', Buffer.from([0xff, 0xfe, 0xfd])],
      ['malformed', Buffer.from('{')],
    ] as const) {
      const invalidProducerState = await writeValidResults(fixture, `producer-state-${name}`);
      await writeFile(invalidProducerState.producerResults, payload);
      const invalidProducerStateResult = runCli(
        fixture,
        assemblyArguments(fixture, invalidProducerState),
        resolve(fixture.root, `cases/producer-state-${name}/spawn-trace.jsonl`),
      );
      expect(invalidProducerStateResult.status).not.toBe(0);
      expect(invalidProducerStateResult.stderr).toContain('producer results are malformed JSON');
    }

    const wrongRun = await writeValidResults(fixture, 'wrong-run', {
      runId: '99',
      runAttempt: ciRun.runAttempt,
    });
    expect(
      runCli(
        fixture,
        assemblyArguments(fixture, wrongRun),
        resolve(fixture.root, 'cases/wrong-run/spawn-trace.jsonl'),
      ).status,
    ).not.toBe(0);

    const wrongHead = await writeValidResults(fixture, 'wrong-head');
    const wrongHeadTrace = resolve(fixture.root, 'cases/wrong-head/spawn-trace.jsonl');
    expect(
      runCli(fixture, assemblyArguments(fixture, wrongHead, 'f'.repeat(40)), wrongHeadTrace).status,
    ).not.toBe(0);
    expect(await readTrace(wrongHeadTrace)).toEqual([
      { command: 'git', args: ['rev-parse', 'HEAD'] },
    ]);

    const failedProducer = await writeValidResults(fixture, 'failed-producer');
    await writeFile(
      failedProducer.producerResults,
      `${JSON.stringify({
        ...Object.fromEntries(
          CI_GROUP_IDS.map((group) => [group, { result: 'success', runAttempt: ciRun.runAttempt }]),
        ),
        tests: { result: 'failure', runAttempt: ciRun.runAttempt },
      })}\n`,
      'utf8',
    );
    expect(
      runCli(
        fixture,
        assemblyArguments(fixture, failedProducer),
        resolve(fixture.root, 'cases/failed-producer/spawn-trace.jsonl'),
      ).status,
    ).not.toBe(0);
  });

  it('persists a complete failed command and nonempty analysis receipt before nonzero exit', async () => {
    const caseRoot = resolve(producerFixture.root, 'cases/producer-failure');
    await mkdir(caseRoot, { recursive: true });
    const output = resolve(caseRoot, 'lint-static.json');
    const executorTrace = resolve(caseRoot, 'executor-trace.txt');
    const npmCli = resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
    const npmCommand = process.platform === 'win32' ? process.execPath : 'npm';
    const npmPrefix = process.platform === 'win32' ? [npmCli] : [];
    const result = spawnSync(
      npmCommand,
      [
        ...npmPrefix,
        'run',
        'quality',
        '--',
        '--scope',
        'ci',
        '--ci-group',
        'lint-static',
        '--sha',
        producerFixture.sha,
        '--run-id',
        ciRun.runId,
        '--run-attempt',
        ciRun.runAttempt,
        '--output',
        output,
      ],
      {
        cwd: producerFixture.root,
        encoding: 'utf8',
        shell: false,
        env: {
          ...environmentWithoutNpmUserAgent(),
          CI: 'true',
          CONTROLLED_EXECUTOR_TRACE: executorTrace,
          CONTROLLED_COMMAND_FAILURE: 'true',
        },
      },
    );

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(1);
    expect(await readFile(executorTrace, 'utf8')).toBe('lint-static\n');
    const receiptBytes = await readFile(output);
    const receipt = parseCiGroupResultEnvelope(receiptBytes);
    expect(receipt.toolVersions.npm).not.toBe('unknown');
    expect(receipt.toolVersions.npm).toMatch(/^\d+\.\d+\.\d+/);
    expect(receipt.commands).toHaveLength(5);
    expect(receipt.commands[0]).toMatchObject({ status: 'fail', errorCode: 'CONTROLLED_FAILURE' });
    expect(receipt.analysis?.findings).toHaveLength(1);
    expect(receiptBytes.toString('utf8')).not.toContain('private raw failure output');
  });

  it('exits nonzero and persists analysis when every controlled command passes', async () => {
    const caseRoot = resolve(producerFixture.root, 'cases/analysis-failure');
    await mkdir(caseRoot, { recursive: true });
    const output = resolve(caseRoot, 'lint-static.json');
    const executorTrace = resolve(caseRoot, 'executor-trace.txt');
    const npmCli = resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
    const npmCommand = process.platform === 'win32' ? process.execPath : 'npm';
    const npmPrefix = process.platform === 'win32' ? [npmCli] : [];
    const result = spawnSync(
      npmCommand,
      [
        ...npmPrefix,
        'run',
        'quality',
        '--',
        '--scope',
        'ci',
        '--ci-group',
        'lint-static',
        '--sha',
        producerFixture.sha,
        '--run-id',
        ciRun.runId,
        '--run-attempt',
        ciRun.runAttempt,
        '--output',
        output,
      ],
      {
        cwd: producerFixture.root,
        encoding: 'utf8',
        shell: false,
        env: {
          ...environmentWithoutNpmUserAgent(),
          CI: 'true',
          CONTROLLED_EXECUTOR_TRACE: executorTrace,
          CONTROLLED_COMMAND_FAILURE: 'false',
        },
      },
    );

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(1);
    expect(await readFile(executorTrace, 'utf8')).toBe('lint-static\n');
    const receipt = parseCiGroupResultEnvelope(await readFile(output));
    expect(receipt.toolVersions.npm).not.toBe('unknown');
    expect(receipt.commands.every((command) => command.status === 'pass')).toBe(true);
    expect(receipt.analysis?.findings).toHaveLength(1);
  });
});
