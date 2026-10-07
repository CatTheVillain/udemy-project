import { createHash } from 'node:crypto';
import {
  CI_GROUP_IDS,
  QUALITY_COMMAND_GROUPS,
  REQUIRED_QUALITY_COMMAND_IDS,
  commitShasEqual,
  REPORT_SCHEMA_VERSION,
  isStrictRfc3339DateTime,
  reportDigest,
  stableJson,
  validateQualityCommand,
  validateReport,
  validateReportSection,
} from './report-utils.mjs';

const maxEnvelopeBytes = 1024 * 1024;
const nonZeroDecimal = /^[1-9][0-9]*$/;
const commitSha = /^[0-9a-f]{7,64}$/i;

function envelopeDigest(envelope) {
  const unsigned = { ...envelope };
  delete unsigned.integrity;
  return createHash('sha256').update(stableJson(unsigned)).digest('hex');
}

function knownProperties(value, keys, label, errors) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${label} must be an object`);
    return;
  }
  for (const key of Object.keys(value))
    if (!keys.includes(key)) errors.push(`${label} has unexpected property ${key}`);
}

function validateAnalysis(analysis, errors) {
  knownProperties(
    analysis,
    ['findings', 'suppressions', 'advisory', 'configVersions'],
    'analysis',
    errors,
  );
  for (const [section, definition] of [
    ['findings', 'finding'],
    ['suppressions', 'suppression'],
  ]) {
    if (!Array.isArray(analysis?.[section])) errors.push(`analysis ${section} must be an array`);
    else
      analysis[section].forEach((entry, index) =>
        errors.push(
          ...validateReportSection(definition, entry).map(
            (error) => `analysis ${section}[${index}] ${error}`,
          ),
        ),
      );
  }
  for (const section of ['advisory', 'configVersions'])
    errors.push(
      ...validateReportSection(section, analysis?.[section]).map((error) => `analysis ${error}`),
    );
}

export function createCiGroupResultEnvelope({
  group,
  sha,
  ciRun,
  generatedAt = new Date().toISOString(),
  commands,
  toolVersions,
  analysis,
}) {
  const envelope = {
    schemaVersion: 1,
    group,
    sha,
    ciRun,
    generatedAt,
    commands,
    toolVersions,
    ...(analysis ? { analysis } : {}),
    integrity: { algorithm: 'sha256', digest: '' },
  };
  envelope.integrity.digest = envelopeDigest(envelope);
  return envelope;
}

export function validateCiGroupResultEnvelope(
  envelope,
  { expectedSha, expectedCiRun, now = new Date(), maxAgeMinutes = 30 } = {},
) {
  const errors = [];
  knownProperties(
    envelope,
    [
      'schemaVersion',
      'group',
      'sha',
      'ciRun',
      'generatedAt',
      'commands',
      'toolVersions',
      'analysis',
      'integrity',
    ],
    'envelope',
    errors,
  );
  if (envelope?.schemaVersion !== 1) errors.push('envelope schemaVersion must equal 1');
  if (!CI_GROUP_IDS.includes(envelope?.group)) errors.push('envelope group is unknown');
  if (typeof envelope?.sha !== 'string' || !commitSha.test(envelope.sha))
    errors.push('envelope SHA is invalid');
  if (expectedSha && !commitShasEqual(envelope?.sha, expectedSha))
    errors.push('envelope SHA does not match the target');
  knownProperties(envelope?.ciRun, ['runId', 'runAttempt'], 'ciRun', errors);
  if (typeof envelope?.ciRun?.runId !== 'string' || !nonZeroDecimal.test(envelope.ciRun.runId))
    errors.push('CI run id is invalid');
  if (
    typeof envelope?.ciRun?.runAttempt !== 'string' ||
    !nonZeroDecimal.test(envelope.ciRun.runAttempt)
  )
    errors.push('CI run attempt is invalid');
  if (
    expectedCiRun &&
    (envelope?.ciRun?.runId !== expectedCiRun.runId ||
      envelope?.ciRun?.runAttempt !== expectedCiRun.runAttempt)
  )
    errors.push('envelope CI run identity does not match');
  if (!isStrictRfc3339DateTime(envelope?.generatedAt))
    errors.push('envelope generatedAt is invalid');
  else if (expectedSha) {
    const timestamp = Date.parse(envelope.generatedAt);
    if (now.getTime() - timestamp > maxAgeMinutes * 60_000) errors.push('envelope is stale');
    if (timestamp - now.getTime() > 5 * 60_000)
      errors.push('envelope exceeds allowed future clock skew');
  }
  errors.push(
    ...validateReportSection('toolVersions', envelope?.toolVersions).map(
      (error) => `toolVersions ${error}`,
    ),
  );
  const expectedCommands = QUALITY_COMMAND_GROUPS[envelope?.group] ?? [];
  if (!Array.isArray(envelope?.commands) || envelope.commands.length !== expectedCommands.length)
    errors.push('envelope command count is invalid');
  else
    envelope.commands.forEach((command, index) => {
      errors.push(...validateQualityCommand(command).map((error) => `commands[${index}] ${error}`));
      if (command?.id !== expectedCommands[index])
        errors.push(`commands[${index}] does not match group ownership/order`);
    });
  if (envelope?.group === 'lint-static') {
    if (!('analysis' in (envelope ?? {}))) errors.push('lint-static analysis is required');
    else validateAnalysis(envelope.analysis, errors);
  } else if ('analysis' in (envelope ?? {}))
    errors.push('analysis is allowed only for lint-static');
  knownProperties(envelope?.integrity, ['algorithm', 'digest'], 'integrity', errors);
  if (
    envelope?.integrity?.algorithm !== 'sha256' ||
    !/^[0-9a-f]{64}$/.test(envelope?.integrity?.digest ?? '')
  )
    errors.push('envelope integrity is invalid');
  else if (envelope.integrity.digest !== envelopeDigest(envelope))
    errors.push('envelope integrity digest mismatch');
  return errors;
}

export function parseCiGroupResultEnvelope(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > maxEnvelopeBytes)
    throw new Error('CI group envelope size is invalid');
  let envelope;
  try {
    envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new Error('CI group envelope is malformed JSON');
  }
  const errors = validateCiGroupResultEnvelope(envelope);
  if (errors.length) throw new Error(`CI group envelope rejected: ${errors.join('; ')}`);
  return envelope;
}

export function isNonFutureCiRunAttempt(publishedAttempt, currentAttempt) {
  if (
    typeof publishedAttempt !== 'string' ||
    typeof currentAttempt !== 'string' ||
    !nonZeroDecimal.test(publishedAttempt) ||
    !nonZeroDecimal.test(currentAttempt)
  )
    return false;
  if (publishedAttempt.length !== currentAttempt.length)
    return publishedAttempt.length < currentAttempt.length;
  return publishedAttempt <= currentAttempt;
}

export function validateCiProducerResults(producerResults, currentRunAttempt) {
  const errors = [];
  knownProperties(producerResults, CI_GROUP_IDS, 'producer results', errors);
  const currentAttemptIsValid =
    typeof currentRunAttempt === 'string' && nonZeroDecimal.test(currentRunAttempt);
  if (!currentAttemptIsValid) errors.push('current CI run attempt is invalid');
  for (const group of CI_GROUP_IDS) {
    const record = producerResults?.[group];
    knownProperties(record, ['result', 'runAttempt'], `producer ${group}`, errors);
    if (record?.result !== 'success') errors.push(`producer ${group} did not succeed`);
    if (typeof record?.runAttempt !== 'string' || !nonZeroDecimal.test(record.runAttempt))
      errors.push(`producer ${group} run attempt is invalid`);
    else if (
      currentAttemptIsValid &&
      !isNonFutureCiRunAttempt(record.runAttempt, currentRunAttempt)
    )
      errors.push(`producer ${group} run attempt is in the future`);
  }
  return errors;
}

export function assembleCiCommandResults({
  envelopes,
  expectedSha,
  expectedCiRun,
  producerResults,
  now = new Date(),
}) {
  const errors = validateCiProducerResults(producerResults, expectedCiRun?.runAttempt);
  if (!Array.isArray(envelopes) || envelopes.length !== CI_GROUP_IDS.length)
    errors.push('exactly four producer envelopes are required');
  const byGroup = new Map();
  for (const envelope of envelopes ?? []) {
    if (byGroup.has(envelope?.group))
      errors.push(`duplicate producer envelope ${envelope?.group ?? 'unknown'}`);
    byGroup.set(envelope?.group, envelope);
  }
  for (const group of CI_GROUP_IDS) {
    const envelope = byGroup.get(group);
    if (!envelope) errors.push(`missing producer envelope ${group}`);
    else
      errors.push(
        ...validateCiGroupResultEnvelope(envelope, {
          expectedSha,
          expectedCiRun: {
            runId: expectedCiRun?.runId,
            runAttempt: producerResults?.[group]?.runAttempt,
          },
          now,
        }).map((error) => `${group}: ${error}`),
      );
  }
  const values = [...byGroup.values()];
  if (values.length) {
    const versions = stableJson(values[0]?.toolVersions);
    if (values.some((envelope) => stableJson(envelope?.toolVersions) !== versions))
      errors.push('producer tool versions differ');
  }
  if (errors.length) throw new Error(`CI quality assembly rejected: ${errors.join('; ')}`);
  const lintStatic = byGroup.get('lint-static');
  const commandsById = new Map(
    values.flatMap((envelope) => envelope.commands).map((command) => [command.id, command]),
  );
  const report = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    scope: 'ci',
    sha: expectedSha,
    target: { kind: 'commit', sha: expectedSha },
    generatedAt: now.toISOString(),
    outcome: 'pass',
    toolVersions: lintStatic.toolVersions,
    configVersions: lintStatic.analysis.configVersions,
    context: {
      execution: 'ci',
      scope: 'ci',
      targetKind: 'commit',
      baseSha: expectedSha,
      ciRun: {
        source: 'parallel-groups',
        runId: expectedCiRun.runId,
        runAttempt: expectedCiRun.runAttempt,
      },
    },
    commands: REQUIRED_QUALITY_COMMAND_IDS.map((id) => commandsById.get(id)),
    findings: lintStatic.analysis.findings,
    suppressions: lintStatic.analysis.suppressions,
    limitations: [
      'Report pass is deterministic evidence only; it is not a semantic or architectural Review or QA verdict.',
      'Complexity signals are advisory and require responsibility-based review; they do not affect the outcome.',
    ],
    advisory: lintStatic.analysis.advisory,
    integrity: { algorithm: 'sha256', digest: '', attestation: null },
  };
  report.integrity.digest = reportDigest(report);
  const reportErrors = validateReport(report);
  if (reportErrors.length)
    throw new Error(`CI quality assembly report rejected: ${reportErrors.join('; ')}`);
  return report;
}
