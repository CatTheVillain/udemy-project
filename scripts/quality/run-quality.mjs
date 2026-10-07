import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  assembleCiCommandResults,
  createCiGroupResultEnvelope,
  parseCiGroupResultEnvelope,
} from './ci-command-results.mjs';
import {
  executeQualityGroup,
  qualityCommandPlan,
  executeQualityCommand,
} from './quality-commands.mjs';
import {
  CI_GROUP_IDS,
  createLocalPatchAttestation,
  collectVitestTestIdentifiers,
  formatCommandFailureExcerpt,
  npmVersionFromUserAgent,
  reportDigest,
  targetForCommit,
  targetForPatch,
  validateReport,
  REPORT_SCHEMA_VERSION,
} from './report-utils.mjs';
import { summaryFor } from './report-summary.mjs';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const optionNames = new Set([
  '--scope',
  '--output',
  '--sha',
  '--target-patch',
  '--target-root',
  '--base-root',
  '--ci-group',
  '--ci-results',
  '--producer-results',
  '--run-id',
  '--run-attempt',
]);
const maxProducerResultsBytes = 1024 * 1024;

function options(argv) {
  const result = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (!optionNames.has(option)) throw new Error(`Unsupported or positional argument: ${option}`);
    if (result.has(option)) throw new Error(`Duplicate option: ${option}`);
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`${option} requires a non-empty value.`);
    result.set(option, value);
  }
  return result;
}

function ciIdentity(values) {
  const runId = values.get('--run-id') ?? process.env.GITHUB_RUN_ID;
  const runAttempt = values.get('--run-attempt') ?? process.env.GITHUB_RUN_ATTEMPT;
  if (!/^[1-9][0-9]*$/.test(runId ?? '') || !/^[1-9][0-9]*$/.test(runAttempt ?? ''))
    throw new Error('CI run id and attempt must be nonzero decimal strings.');
  return { runId, runAttempt };
}

function gitHead() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
  });
  if (result.status !== 0 || !/^[0-9a-f]{7,64}$/i.test(result.stdout.trim()))
    throw new Error('Unable to determine the current commit identity.');
  return result.stdout.trim();
}

function ciTarget(values, requireExactHead) {
  const sha = values.get('--sha') ?? process.env.GITHUB_SHA;
  if (!/^[0-9a-f]{7,64}$/i.test(sha ?? ''))
    throw new Error('CI reports require a valid target SHA.');
  if (requireExactHead && gitHead().toLowerCase() !== sha.toLowerCase())
    throw new Error('Checked-out HEAD does not match the supplied CI target SHA.');
  return sha;
}

async function toolVersions() {
  const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  const devDependencies = packageJson.devDependencies;
  return {
    node: process.version,
    npm: npmVersionFromUserAgent(process.env.npm_config_user_agent),
    typescript: devDependencies.typescript,
    prettier: devDependencies.prettier,
    stylelint: devDependencies.stylelint,
    eslint: devDependencies.eslint,
  };
}

async function readProducerResults(path) {
  const size = (await stat(path)).size;
  if (size === 0 || size > maxProducerResultsBytes)
    throw new Error('producer results size is invalid');
  const bytes = await readFile(path);
  if (bytes.length === 0 || bytes.length > maxProducerResultsBytes)
    throw new Error('producer results size is invalid');
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new Error('producer results are malformed JSON');
  }
}

async function staticAnalysis() {
  const { collectComplexitySignals, collectStaticFindings, complexityReview, staticSuppressions } =
    await import('./check-static.mjs');
  return {
    findings: await collectStaticFindings(),
    suppressions: staticSuppressions(),
    advisory: { complexitySignals: await collectComplexitySignals(), complexityReview },
    configVersions: { reportSchema: REPORT_SCHEMA_VERSION, staticRules: 2 },
  };
}

async function writeReport(output, report) {
  const errors = validateReport(report);
  if (errors.length)
    throw new Error(`Report generation failed schema validation: ${errors.join('; ')}`);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(summaryFor(report));
}

function printFailures(executions, knownTestIdentifiers) {
  for (const { command, stdout, stderr, hasUnexpectedDiagnostics } of executions) {
    const excerpt = formatCommandFailureExcerpt({
      ...command,
      stdout,
      stderr,
      hasUnexpectedDiagnostics,
      knownTestIdentifiers,
    });
    if (excerpt) console.error(excerpt);
  }
}

async function groupMode(values, output) {
  if (!process.env.CI) throw new Error('CI group execution is restricted to CI.');
  const group = values.get('--ci-group');
  if (!CI_GROUP_IDS.includes(group)) throw new Error('A known --ci-group is required.');
  if (values.get('--scope') && values.get('--scope') !== 'ci')
    throw new Error('CI group execution requires --scope ci.');
  if (
    values.has('--target-patch') ||
    values.has('--target-root') ||
    values.has('--base-root') ||
    values.has('--ci-results') ||
    values.has('--producer-results')
  )
    throw new Error('CI group execution cannot accept local target or result inputs.');
  const ciRun = ciIdentity(values);
  const sha = ciTarget(values, true);
  const knownTestIdentifiers = collectVitestTestIdentifiers(root);
  const executions = executeQualityGroup(group, root);
  const analysis = group === 'lint-static' ? await staticAnalysis() : undefined;
  const envelope = createCiGroupResultEnvelope({
    group,
    sha,
    ciRun,
    commands: executions.map(({ command }) => command),
    toolVersions: await toolVersions(),
    ...(analysis ? { analysis } : {}),
  });
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(envelope, null, 2)}\n`, 'utf8');
  printFailures(executions, knownTestIdentifiers);
  if (
    executions.some(({ command }) => command.status !== 'pass') ||
    (analysis?.findings.length ?? 0) > 0
  )
    process.exitCode = 1;
}

async function resultsMode(values, output) {
  if (!process.env.CI) throw new Error('CI result assembly is restricted to CI.');
  if (values.get('--scope') && values.get('--scope') !== 'ci')
    throw new Error('CI result assembly requires --scope ci.');
  if (
    values.has('--target-patch') ||
    values.has('--target-root') ||
    values.has('--base-root') ||
    values.has('--ci-group')
  )
    throw new Error('CI result assembly cannot accept group or local target inputs.');
  const directory = values.get('--ci-results');
  const producerPath = values.get('--producer-results');
  if (!directory || !producerPath)
    throw new Error('CI result assembly requires --ci-results and --producer-results.');
  const ciRun = ciIdentity(values);
  const resultsDirectory = resolve(directory);
  const producerResultsPath = resolve(producerPath);
  if (
    producerResultsPath.startsWith(
      `${resultsDirectory}${process.platform === 'win32' ? '\\' : '/'}`,
    )
  )
    throw new Error('Producer-state bookkeeping must be outside the dedicated result directory.');
  const entries = await readdir(resultsDirectory, { withFileTypes: true });
  const expectedFiles = CI_GROUP_IDS.map((group) => `${group}.json`);
  if (
    entries.length !== expectedFiles.length ||
    entries.some((entry) => !entry.isFile() || !expectedFiles.includes(entry.name))
  )
    throw new Error('CI result directory must contain exactly the four expected envelope files.');
  const sha = ciTarget(values, true);
  const envelopes = await Promise.all(
    CI_GROUP_IDS.map(async (group) => {
      const path = resolve(resultsDirectory, `${group}.json`);
      if ((await stat(path)).size > 1024 * 1024)
        throw new Error(`CI group envelope exceeds the byte limit: ${group}`);
      return parseCiGroupResultEnvelope(await readFile(path));
    }),
  );
  const producerResults = await readProducerResults(producerResultsPath);
  await writeReport(
    output,
    assembleCiCommandResults({
      envelopes,
      expectedSha: sha,
      expectedCiRun: ciRun,
      producerResults,
    }),
  );
}

async function ordinaryMode(values, output, scope) {
  if (
    values.has('--ci-group') ||
    values.has('--ci-results') ||
    values.has('--producer-results') ||
    values.has('--run-id') ||
    values.has('--run-attempt')
  )
    throw new Error('CI protocol inputs require one explicit CI protocol mode.');
  const targetPatch = values.get('--target-patch');
  const targetRoot = values.get('--target-root');
  const baseRoot = values.get('--base-root');
  if (scope === 'ci' && (targetPatch || targetRoot || baseRoot))
    throw new Error('CI reports must use the current commit target, not a local patch.');
  const target =
    scope === 'ci'
      ? targetForCommit(ciTarget(values, true))
      : targetPatch
        ? await targetForPatch(
            resolve(targetPatch),
            targetRoot && resolve(targetRoot),
            baseRoot && resolve(baseRoot),
          )
        : (() => {
            throw new Error(
              'Local full reports require --target-patch <exact no-index Review patch>.',
            );
          })();
  const localAttestationKey =
    scope === 'full' ? process.env.QUALITY_REPORT_ATTESTATION_KEY : undefined;
  if (scope === 'full' && !localAttestationKey)
    throw new Error(
      'Local full reports require the ephemeral Manager-supplied QUALITY_REPORT_ATTESTATION_KEY after target capture.',
    );
  const sha = scope === 'ci' ? target.sha : gitHead();
  const knownTestIdentifiers = collectVitestTestIdentifiers(root);
  const executions = qualityCommandPlan({ mode: 'full' }).map((entry) =>
    executeQualityCommand(entry, root),
  );
  const analysis = await staticAnalysis();
  const report = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    scope,
    sha,
    target,
    generatedAt: new Date().toISOString(),
    outcome:
      executions.every(({ command }) => command.status === 'pass') && analysis.findings.length === 0
        ? 'pass'
        : 'fail',
    commands: executions.map(({ command }) => command),
    findings: analysis.findings,
    toolVersions: await toolVersions(),
    configVersions: analysis.configVersions,
    context: {
      execution: scope === 'ci' ? 'ci' : 'local',
      scope,
      targetKind: target.kind,
      baseSha: sha,
    },
    suppressions: analysis.suppressions,
    limitations: [
      'Report pass is deterministic evidence only; it is not a semantic or architectural Review or QA verdict.',
      'Complexity signals are advisory and require responsibility-based review; they do not affect the outcome.',
    ],
    advisory: analysis.advisory,
    integrity: { algorithm: 'sha256', digest: '', attestation: null },
  };
  report.integrity.digest = reportDigest(report);
  if (scope === 'full')
    report.integrity.attestation = createLocalPatchAttestation(report, localAttestationKey);
  await writeReport(output, report);
  printFailures(executions, knownTestIdentifiers);
  if (report.outcome !== 'pass') process.exitCode = 1;
}

const values = options(process.argv.slice(2));
const group = values.has('--ci-group');
const results = values.has('--ci-results');
if (group && results) throw new Error('--ci-group and --ci-results cannot be combined.');
const scope = values.get('--scope') ?? (process.env.CI ? 'ci' : 'full');
if (!['full', 'ci'].includes(scope))
  throw new Error('Only full and ci report scopes are authoritative.');
if ((group || results) && !values.has('--output'))
  throw new Error('CI protocol modes require an explicit --output path.');
const output = resolve(
  values.get('--output') ?? resolve(tmpdir(), 'udemy-frontend-quality-report.json'),
);
if (group) await groupMode(values, output);
else if (results) await resultsMode(values, output);
else await ordinaryMode(values, output, scope);
