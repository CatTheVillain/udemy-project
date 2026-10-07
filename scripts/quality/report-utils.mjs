import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPORT_SCHEMA_VERSION = 3;
export const REPORT_CLOCK_SKEW_TOLERANCE_MINUTES = 5;
export const REQUIRED_QUALITY_COMMAND_IDS = Object.freeze([
  'format',
  'stylelint',
  'lint',
  'quality-lint',
  'typecheck',
  'static-rules',
  'tests',
  'build',
]);
export const CI_GROUP_IDS = Object.freeze(['lint-static', 'typecheck', 'tests', 'build']);
export const QUALITY_COMMAND_GROUPS = Object.freeze({
  'lint-static': Object.freeze(['format', 'stylelint', 'lint', 'quality-lint', 'static-rules']),
  typecheck: Object.freeze(['typecheck']),
  tests: Object.freeze(['tests']),
  build: Object.freeze(['build']),
});
const commitSha = /^[0-9a-f]{7,64}$/i;
export const DIAGNOSTIC_SUMMARY_KEYS = Object.freeze([
  'allowedRouterFutureWarnings',
  'unexpectedReactActWarnings',
  'unexpectedUnhandledRejections',
  'unexpectedConsoleWarnings',
  'unexpectedGenericWarnings',
]);
export const FAILED_COMMAND_OUTPUT_MAX_CHARS = 4_000;
export const FAILED_COMMAND_OUTPUT_MAX_LINES = 40;
const regularExpressionEscape = '\\';
const ansiEscapeSequence = new RegExp(
  `${regularExpressionEscape}u001B${regularExpressionEscape}[[0-?]*[ -/]*[@-~]`,
  'g',
);
const controlCharacters = new RegExp(
  `[${regularExpressionEscape}u0000-${regularExpressionEscape}u0008${regularExpressionEscape}u000B-${regularExpressionEscape}u001F${regularExpressionEscape}u007F-${regularExpressionEscape}u009F]`,
  'g',
);
const anyControlCharacter = new RegExp(
  `[${regularExpressionEscape}u0000-${regularExpressionEscape}u001F${regularExpressionEscape}u007F-${regularExpressionEscape}u009F]`,
);
const schemaPath = fileURLToPath(new URL('./report.schema.json', import.meta.url));
const reportSchema = JSON.parse(await readFile(schemaPath, 'utf8'));
const supportedKeywords = new Set([
  '$schema',
  '$ref',
  'title',
  'type',
  'required',
  'properties',
  'additionalProperties',
  'const',
  'enum',
  'pattern',
  'minLength',
  'minimum',
  'maxItems',
  'items',
  'minItems',
  'oneOf',
  'definitions',
  'format',
]);

export function commitShasEqual(left, right) {
  return (
    typeof left === 'string' &&
    typeof right === 'string' &&
    commitSha.test(left) &&
    commitSha.test(right) &&
    left.toLowerCase() === right.toLowerCase()
  );
}

export function validateQualityCommandGroupPartition(commandGroups) {
  const errors = [];
  if (!commandGroups || typeof commandGroups !== 'object' || Array.isArray(commandGroups))
    return ['quality command groups must be an object'];
  for (const group of Object.keys(commandGroups))
    if (!CI_GROUP_IDS.includes(group)) errors.push(`quality command group is unknown: ${group}`);
  const owned = [];
  for (const group of CI_GROUP_IDS) {
    const commands = commandGroups[group];
    if (!Array.isArray(commands)) {
      errors.push(`quality command group is missing: ${group}`);
      continue;
    }
    for (const command of commands) {
      if (!REQUIRED_QUALITY_COMMAND_IDS.includes(command))
        errors.push(`quality command is unknown: ${command}`);
      else owned.push(command);
    }
  }
  for (const command of REQUIRED_QUALITY_COMMAND_IDS) {
    const count = owned.filter((ownedCommand) => ownedCommand === command).length;
    if (count !== 1)
      errors.push(
        count === 0
          ? `quality command is unassigned: ${command}`
          : `quality command is assigned more than once: ${command}`,
      );
  }
  return errors;
}

const qualityCommandGroupPartitionErrors =
  validateQualityCommandGroupPartition(QUALITY_COMMAND_GROUPS);
if (qualityCommandGroupPartitionErrors.length)
  throw new Error(
    `Quality command groups are invalid: ${qualityCommandGroupPartitionErrors.join('; ')}`,
  );

function schemaError(path, message) {
  return `${path}: ${message}`;
}

function schemaAtReference(reference) {
  if (!reference.startsWith('#/')) throw new Error(`Unsupported schema reference: ${reference}`);
  return reference
    .slice(2)
    .split('/')
    .reduce((value, segment) => value?.[segment], reportSchema);
}

function assertSupportedSchema(schema, path = '#') {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return;
  for (const [key, value] of Object.entries(schema)) {
    if (!supportedKeywords.has(key))
      throw new Error(`Unsupported report schema keyword ${path}/${key}`);
    if (key === 'properties' || key === 'definitions') {
      for (const [childKey, childSchema] of Object.entries(value)) {
        assertSupportedSchema(childSchema, `${path}/${key}/${childKey}`);
      }
    } else if (key === 'items') {
      assertSupportedSchema(value, `${path}/items`);
    } else if (key === 'oneOf') {
      for (const [index, childSchema] of value.entries())
        assertSupportedSchema(childSchema, `${path}/oneOf/${index}`);
    }
  }
}

function typeMatches(value, type) {
  if (type === 'object')
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (type === 'array') return Array.isArray(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'null') return value === null;
  return typeof value === type;
}

function validateSchemaValue(schema, value, path, errors) {
  if (schema.$ref) {
    const referenced = schemaAtReference(schema.$ref);
    if (!referenced) {
      errors.push(schemaError(path, `unresolved schema reference ${schema.$ref}`));
      return;
    }
    validateSchemaValue(referenced, value, path, errors);
    return;
  }
  if (schema.oneOf) {
    const matches = schema.oneOf.filter((candidate) => {
      const candidateErrors = [];
      validateSchemaValue(candidate, value, path, candidateErrors);
      return candidateErrors.length === 0;
    }).length;
    if (matches !== 1) errors.push(schemaError(path, 'must match exactly one schema option'));
    return;
  }
  if (schema.type && !typeMatches(value, schema.type)) {
    errors.push(schemaError(path, `must be ${schema.type}`));
    return;
  }
  if ('const' in schema && value !== schema.const)
    errors.push(schemaError(path, `must equal ${schema.const}`));
  if (schema.enum && !schema.enum.includes(value))
    errors.push(schemaError(path, 'is not an allowed value'));
  if (schema.pattern && typeof value === 'string' && !new RegExp(schema.pattern).test(value)) {
    errors.push(schemaError(path, 'does not match the required pattern'));
  }
  if (schema.minLength && typeof value === 'string' && value.length < schema.minLength) {
    errors.push(schemaError(path, `must contain at least ${schema.minLength} characters`));
  }
  if (schema.minimum !== undefined && typeof value === 'number' && value < schema.minimum) {
    errors.push(schemaError(path, `must be at least ${schema.minimum}`));
  }
  if (schema.format === 'date-time' && !isStrictRfc3339DateTime(value))
    errors.push(schemaError(path, 'must be a strict RFC3339/ISO date-time'));
  if (Array.isArray(value)) {
    if (schema.minItems && value.length < schema.minItems)
      errors.push(schemaError(path, `must contain at least ${schema.minItems} items`));
    if (schema.maxItems !== undefined && value.length > schema.maxItems)
      errors.push(schemaError(path, `must contain at most ${schema.maxItems} items`));
    if (schema.items)
      value.forEach((item, index) =>
        validateSchemaValue(schema.items, item, `${path}[${index}]`, errors),
      );
  }
  if (typeMatches(value, 'object')) {
    for (const property of schema.required ?? []) {
      if (!(property in value)) errors.push(schemaError(path, `missing ${property}`));
    }
    for (const [property, propertySchema] of Object.entries(schema.properties ?? {})) {
      if (property in value)
        validateSchemaValue(propertySchema, value[property], `${path}.${property}`, errors);
    }
    if (schema.additionalProperties === false) {
      const known = new Set(Object.keys(schema.properties ?? {}));
      for (const property of Object.keys(value)) {
        if (!known.has(property)) errors.push(schemaError(path, `unexpected property ${property}`));
      }
    }
  }
}

assertSupportedSchema(reportSchema);

export function validateSchemaDefinition(schema) {
  try {
    assertSupportedSchema(schema);
    return [];
  } catch (error) {
    return [error.message];
  }
}

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function reportDigest(report) {
  const unsigned = { ...report };
  delete unsigned.integrity;
  return createHash('sha256').update(stableJson(unsigned)).digest('hex');
}

function unsignedReport(report) {
  const unsigned = { ...report };
  delete unsigned.integrity;
  return unsigned;
}

function attestationDigest(report, key) {
  return createHmac('sha256', key)
    .update(stableJson(unsignedReport(report)))
    .digest('hex');
}

export function createLocalPatchAttestation(report, key) {
  if (!key) throw new Error('Local report attestation requires a non-empty Manager-supplied key.');
  return { algorithm: 'hmac-sha256', digest: attestationDigest(report, key) };
}

function verifyLocalPatchAttestation(report, key) {
  if (!key) return 'local report attestation key is required';
  const attestation = report?.integrity?.attestation;
  if (!attestation || attestation.algorithm !== 'hmac-sha256')
    return 'local report attestation is missing or uses an unsupported algorithm';
  const expected = Buffer.from(attestationDigest(report, key), 'hex');
  const actual = Buffer.from(attestation.digest ?? '', 'hex');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    return 'local report attestation does not match the Manager-supplied key';
  return undefined;
}

export function isStrictRfc3339DateTime(value) {
  if (typeof value !== 'string') return false;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d{1,9})?(Z|[+-](?:0\d|1\d|2[0-3]):[0-5]\d)$/.exec(
      value,
    );
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day >= 1 && day <= daysInMonth && !Number.isNaN(Date.parse(value));
}

export function validateQualityCommand(command) {
  const errors = [];
  validateSchemaValue(reportSchema.definitions.command, command, '$command', errors);
  if (errors.length || !command || typeof command !== 'object' || Array.isArray(command))
    return errors;
  if (!REQUIRED_QUALITY_COMMAND_IDS.includes(command.id)) errors.push('command id is not required');
  if (command.status === 'pass' && (command.exitCode !== 0 || command.errorCode !== null))
    errors.push('pass outcome must have exitCode 0 and no errorCode');
  if (
    command.status === 'fail' &&
    (!Number.isInteger(command.exitCode) || command.exitCode === 0) &&
    command.errorCode === null
  )
    errors.push('fail outcome must record a non-zero exitCode or errorCode');
  if (command.status === 'pass' && unexpectedDiagnosticCount(command.diagnostics) > 0)
    errors.push('pass outcome cannot contain unexpected diagnostics');
  return errors;
}

export function validateReportSection(section, value) {
  const schema = reportSchema.definitions?.[section];
  if (!schema) return [`unknown report schema section ${section}`];
  const errors = [];
  validateSchemaValue(schema, value, `$${section}`, errors);
  return errors;
}

function validateRequiredCommands(report, errors) {
  const commands = report.commands;
  if (!Array.isArray(commands)) return;
  if (commands.length !== REQUIRED_QUALITY_COMMAND_IDS.length) {
    errors.push(
      `commands must contain exactly ${REQUIRED_QUALITY_COMMAND_IDS.length} required entries`,
    );
    return;
  }
  commands.forEach((command, index) => {
    const expectedId = REQUIRED_QUALITY_COMMAND_IDS[index];
    if (command.id !== expectedId)
      errors.push(`commands[${index}] must be the required ${expectedId} command`);
    errors.push(...validateQualityCommand(command).map((error) => `commands[${index}] ${error}`));
  });
  const expectedOutcome =
    commands.every((command) => command.status === 'pass') && report.findings.length === 0
      ? 'pass'
      : 'fail';
  if (report.outcome !== expectedOutcome)
    errors.push('report outcome does not match command and deterministic-finding outcomes');
}

function countMatches(value, expression) {
  return [...value.matchAll(expression)].length;
}

function diagnosticSummary(values) {
  return {
    allowedRouterFutureWarnings: values.allowedRouterFutureWarnings,
    unexpectedReactActWarnings: values.unexpectedReactActWarnings,
    unexpectedUnhandledRejections: values.unexpectedUnhandledRejections,
    unexpectedConsoleWarnings: values.unexpectedConsoleWarnings,
    unexpectedGenericWarnings: values.unexpectedGenericWarnings,
  };
}

export function classifyCommandDiagnostics(stdout = '', stderr = '') {
  const output = `${stdout}\n${stderr}`;
  const allowedRouterFutureWarnings = countMatches(
    output,
    /⚠️ React Router Future Flag Warning: (?:React Router will begin wrapping state updates in `React\.startTransition` in v7\.|Relative route resolution within Splat routes is changing in v7\.)/g,
  );
  const unexpectedReactActWarnings = countMatches(
    output,
    /(?:Warning:\s*)?(?:An update to .+? inside a test was not wrapped in act\(|not wrapped in act\()/g,
  );
  const unexpectedUnhandledRejections = countMatches(
    output,
    /(?:Unhandled (?:Promise )?Rejection|unhandledRejection)/gi,
  );
  const unexpectedConsoleWarnings = countMatches(
    output,
    /(?:console\.(?:warn|error)|\[(?:console\.)?(?:warn|error)\])/gi,
  );
  const outputWithoutAllowedRouterNotices = output.replace(
    /⚠️ React Router Future Flag Warning: (?:React Router will begin wrapping state updates in `React\.startTransition` in v7\.|Relative route resolution within Splat routes is changing in v7\.)/g,
    '',
  );
  const unexpectedGenericWarnings = countMatches(
    outputWithoutAllowedRouterNotices,
    /(?:^|\n)\s*(?:Warning|WARN|ERROR|Error):/gm,
  );
  return diagnosticSummary({
    allowedRouterFutureWarnings,
    unexpectedReactActWarnings,
    unexpectedUnhandledRejections,
    unexpectedConsoleWarnings,
    unexpectedGenericWarnings,
  });
}

export function unexpectedDiagnosticCount(diagnostics) {
  if (!diagnostics || typeof diagnostics !== 'object') return 0;
  return (
    diagnostics.unexpectedReactActWarnings +
    diagnostics.unexpectedUnhandledRejections +
    diagnostics.unexpectedConsoleWarnings +
    diagnostics.unexpectedGenericWarnings
  );
}

export function commandFailureCode(result, hasUnexpectedDiagnostics) {
  return (
    result.error?.code ??
    (result.signal ? `QUALITY_SIGNAL_${result.signal}` : null) ??
    (hasUnexpectedDiagnostics ? 'QUALITY_UNEXPECTED_DIAGNOSTICS' : null)
  );
}

const MAX_FAILURE_IDENTIFIERS = 8;
const MAX_FAILURE_IDENTIFIER_LENGTH = 320;
const vitestTestFileName = /\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/i;
const vitestBracketedFailureLine = /^\s*FAIL\b[^\r\n]*\[\s*([^\]\r\n]+?)\s*\]\s*$/;
const vitestLeadingFailureLine = /^\s*FAIL\s+([^\s>]+)\s+>/;
const vitestDiagnosticOwnershipLine = /^\s*stderr\s*\|\s*([^\s>|]+)\s+>/;
const vitestFailureLocationLine = /^\s*(?:❯|at)\s+(.+?):(\d{1,9}):(\d{1,9})(?:\s|$)/;
const vitestTimeoutFailureLine = /^\s*Error:\s+(Test|Hook) timed out in (\d{1,9})ms\.\s*$/;

function normalizeVitestFailureIdentifier(rawIdentifier) {
  const normalized = String(rawIdentifier ?? '')
    .replaceAll('\\', '/')
    .replace(/\/{2,}/g, '/')
    .trim();
  if (
    !normalized ||
    Array.from(normalized).length > MAX_FAILURE_IDENTIFIER_LENGTH ||
    normalized.startsWith('/') ||
    /^[a-z]:\//i.test(normalized)
  )
    return null;
  const segments = normalized.split('/');
  if (
    segments.some((segment) => !/^[A-Za-z0-9][A-Za-z0-9._@-]*$/.test(segment) || segment === '..')
  )
    return null;
  const fileName = segments.at(-1);
  return /\.(?:[cm]?[jt]sx?)$/i.test(fileName ?? '') ? segments.join('/') : null;
}

export function collectVitestTestIdentifiers(root) {
  const identifiers = new Set();
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && vitestTestFileName.test(entry.name)) {
        const identifier = normalizeVitestFailureIdentifier(relative(root, path));
        if (identifier) identifiers.add(identifier);
      }
    }
  };
  visit(resolve(root, 'tests'));
  return [...identifiers].sort();
}

function knownVitestIdentifiers(identifiers) {
  return new Set(
    (Array.isArray(identifiers) ? identifiers : [])
      .map((identifier) => normalizeVitestFailureIdentifier(identifier))
      .filter(Boolean),
  );
}

function vitestFailureIdentifiers(stdout, stderr, knownIdentifiers) {
  const identifiers = new Set();
  for (const line of `${stdout ?? ''}\n${stderr ?? ''}`
    .replace(ansiEscapeSequence, '')
    .replace(controlCharacters, '')
    .split(/\r?\n/)) {
    const match = line.match(vitestBracketedFailureLine) ?? line.match(vitestLeadingFailureLine);
    const identifier = match && normalizeVitestFailureIdentifier(match[1]);
    if (identifier && knownIdentifiers.has(identifier)) identifiers.add(identifier);
    if (identifiers.size === MAX_FAILURE_IDENTIFIERS) break;
  }
  return [...identifiers];
}

function vitestDiagnosticIdentifiers(stderr, knownIdentifiers) {
  const identifiers = new Set();
  for (const line of String(stderr ?? '')
    .replace(ansiEscapeSequence, '')
    .replace(controlCharacters, '')
    .split(/\r?\n/)) {
    const match = line.match(vitestDiagnosticOwnershipLine);
    const identifier = match && normalizeVitestFailureIdentifier(match[1]);
    if (identifier && knownIdentifiers.has(identifier)) identifiers.add(identifier);
    if (identifiers.size === MAX_FAILURE_IDENTIFIERS) break;
  }
  return [...identifiers];
}

function vitestFailureLocations(stdout, stderr, knownIdentifiers) {
  const locations = new Set();
  for (const line of `${stdout ?? ''}\n${stderr ?? ''}`
    .replace(ansiEscapeSequence, '')
    .split(/\r?\n/)) {
    if (anyControlCharacter.test(line)) continue;
    const match = line.match(vitestFailureLocationLine);
    const identifier = match && normalizeVitestFailureIdentifier(match[1]);
    if (identifier && knownIdentifiers.has(identifier)) {
      locations.add(`${identifier}:${Number(match[2])}:${Number(match[3])}`);
    }
    if (locations.size === MAX_FAILURE_IDENTIFIERS) break;
  }
  return [...locations];
}

function vitestFailureKinds(stdout, stderr) {
  const kinds = new Set();
  for (const line of `${stdout ?? ''}\n${stderr ?? ''}`
    .replace(ansiEscapeSequence, '')
    .split(/\r?\n/)) {
    if (anyControlCharacter.test(line)) continue;
    const match = line.match(vitestTimeoutFailureLine);
    if (match) kinds.add(`${match[1].toLowerCase()}-timeout:${Number(match[2])}ms`);
    if (kinds.size === MAX_FAILURE_IDENTIFIERS) break;
  }
  return [...kinds];
}

function boundedDetailLine(label, details, maxCharacters) {
  const prefix = `${label}=`;
  const unavailable = `${prefix}unavailable`;
  if (Array.from(unavailable).length > maxCharacters) return null;
  const selected = [];
  for (const detail of details) {
    const candidate = `${prefix}${[...selected, detail].join(',')}`;
    if (Array.from(candidate).length > maxCharacters) break;
    selected.push(detail);
  }
  return selected.length ? `${prefix}${selected.join(',')}` : unavailable;
}

export function formatCommandFailureExcerpt(command) {
  if (command.status === 'pass') return null;
  const id = REQUIRED_QUALITY_COMMAND_IDS.includes(command.id) ? command.id : 'unknown';
  const exitCode = Number.isInteger(command.exitCode) ? command.exitCode : 'null';
  const errorCode =
    typeof command.errorCode === 'string' && /^[A-Z0-9_]{1,64}$/.test(command.errorCode)
      ? command.errorCode
      : 'none';
  const header = `QUALITY_COMMAND_FAILURE id=${id} exitCode=${exitCode} errorCode=${errorCode}`;
  if (id !== 'tests') return header;
  const knownIdentifiers = knownVitestIdentifiers(command.knownTestIdentifiers);
  const identifiers = vitestFailureIdentifiers(command.stdout, command.stderr, knownIdentifiers);
  const output = [header];
  const appendDetailLine = (label, candidates) => {
    const usedCharacters = Array.from(output.join('\n')).length + 1;
    const line = boundedDetailLine(
      label,
      candidates,
      FAILED_COMMAND_OUTPUT_MAX_CHARS - usedCharacters,
    );
    if (line) output.push(line);
  };
  appendDetailLine('failure-identifiers', identifiers);
  const locations = vitestFailureLocations(command.stdout, command.stderr, knownIdentifiers);
  if (locations.length) appendDetailLine('failure-locations', locations);
  const failureKinds = vitestFailureKinds(command.stdout, command.stderr);
  if (failureKinds.length) appendDetailLine('failure-kinds', failureKinds);
  if (errorCode === 'QUALITY_UNEXPECTED_DIAGNOSTICS' || command.hasUnexpectedDiagnostics) {
    const diagnosticIdentifiers = vitestDiagnosticIdentifiers(command.stderr, knownIdentifiers);
    appendDetailLine('diagnostic-identifiers', diagnosticIdentifiers);
  }
  return output.join('\n');
}

export function npmVersionFromUserAgent(userAgent) {
  const numericIdentifier = '(?:0|[1-9]\\d*)';
  const prereleaseIdentifier = `(?:${numericIdentifier}|\\d*[A-Za-z-][0-9A-Za-z-]*)`;
  const prerelease = `(?:-${prereleaseIdentifier}(?:\\.${prereleaseIdentifier})*)?`;
  const build = '(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?';
  const semver = `${numericIdentifier}\\.${numericIdentifier}\\.${numericIdentifier}${prerelease}${build}`;
  const match = new RegExp(`(?:^|\\s)npm\\/(${semver})(?:\\s|$)`).exec(userAgent ?? '');
  return match?.[1] ?? 'unknown';
}

export function runCapturedCommand(command, args, options = {}) {
  const { cwd, maxBuffer } = options;
  const result = spawnSync(command, args, { cwd, maxBuffer, encoding: 'utf8', shell: false });
  return {
    ...result,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    signal: result.signal ?? null,
  };
}

function normalizedRoot(root) {
  return root
    ?.replaceAll('\\', '/')
    .replace(/\/{2,}/g, '/')
    .replace(/\/$/, '');
}

function normalizedPatchPath(rawPath, targetRoot, baseRoot) {
  const pathWithoutSide = rawPath
    .split('\t', 1)[0]
    .replace(/^"|"$/g, '')
    .replaceAll('\\', '/')
    .replace(/^[ab]\//, '');
  const normalized = pathWithoutSide.replace(/\/{2,}/g, '/');
  for (const root of [targetRoot, baseRoot]) {
    const rootPath = normalizedRoot(root);
    if (rootPath && normalized.startsWith(`${rootPath}/`)) {
      return normalized.slice(rootPath.length + 1);
    }
  }
  const marker = '/udemy-frontend/';
  const markerIndex = normalized.toLowerCase().lastIndexOf(marker);
  return markerIndex >= 0
    ? normalized.slice(markerIndex + marker.length).replace(/^\/+/, '')
    : normalized;
}

function normalizeFrontendRelativePath(path) {
  if (/^(?:[a-z]:)?\//i.test(path)) return path;
  const segments = [];
  for (const segment of path.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (segments.length === 0)
        throw new Error('Local Review patch path escapes the logical frontend root.');
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  return segments.join('/');
}

export async function targetForPatch(patchPath, targetRoot, baseRoot) {
  const patch = await readFile(patchPath);
  const patchPaths = patch
    .toString('utf8')
    .split(/\r?\n/)
    .filter((line) => line.startsWith('--- ') || line.startsWith('+++ '))
    .map((line) => normalizedPatchPath(line.slice(4), targetRoot, baseRoot))
    .filter((path) => path !== '/dev/null');
  const changedPaths = [...new Set(patchPaths.map(normalizeFrontendRelativePath))].sort();
  if (changedPaths.length === 0) throw new Error('The local Review patch has no changed paths.');
  if (changedPaths.some((path) => /^(?:[a-z]:)?\//i.test(path) || path.length === 0)) {
    throw new Error(
      'Local Review patch paths must be frontend-relative; supply --target-root and --base-root for absolute after/before snapshot paths.',
    );
  }
  return {
    kind: 'local_patch',
    patchSha256: createHash('sha256').update(patch).digest('hex'),
    changedPaths,
  };
}

export function targetForCommit(sha) {
  return { kind: 'commit', sha };
}

export function validateReport(report) {
  const errors = [];
  validateSchemaValue(reportSchema, report, '$', errors);
  if (errors.length || !report || typeof report !== 'object' || Array.isArray(report))
    return errors;
  if (report.schemaVersion !== REPORT_SCHEMA_VERSION) errors.push('unsupported schemaVersion');
  if (report.context.scope !== report.scope)
    errors.push('context scope does not match report scope');
  if (report.context.targetKind !== report.target.kind)
    errors.push('context target kind does not match report target');
  if (report.target.kind === 'commit' && !commitShasEqual(report.target.sha, report.sha))
    errors.push('commit target does not match report SHA');
  if (report.target.kind === 'commit' && !commitShasEqual(report.context.baseSha, report.sha))
    errors.push('commit context base SHA does not match report SHA');
  if (report.target.kind === 'local_patch' && report.context.execution !== 'local')
    errors.push('local patch target must use local execution context');
  if (report.target.kind === 'commit' && report.context.execution !== 'ci')
    errors.push('commit target must use CI execution context');
  if (report.scope === 'full' && 'ciRun' in report.context)
    errors.push('local full reports must not contain CI run provenance');
  if (
    report.scope === 'ci' &&
    'ciRun' in report.context &&
    report.context.ciRun?.source !== 'parallel-groups'
  )
    errors.push('CI run provenance must identify parallel groups');
  validateRequiredCommands(report, errors);
  if (
    report.integrity?.algorithm !== 'sha256' ||
    report.integrity?.digest !== reportDigest(report)
  ) {
    errors.push('integrity digest mismatch');
  }
  return errors;
}

export function verifyReportTarget(report, expectedTarget) {
  const errors = [];
  if (!expectedTarget || report.target?.kind !== expectedTarget.kind) {
    return ['report target kind does not match the current target'];
  }
  if (expectedTarget.kind === 'commit' && !commitShasEqual(report.target.sha, expectedTarget.sha)) {
    errors.push('report commit target does not match the current target');
  }
  if (expectedTarget.kind === 'local_patch') {
    if (report.target.patchSha256 !== expectedTarget.patchSha256)
      errors.push('report patch target does not match the current target');
    if (stableJson(report.target.changedPaths) !== stableJson(expectedTarget.changedPaths)) {
      errors.push('report changed paths do not match the current target');
    }
  }
  return errors;
}

export function validateReportAdmission(
  report,
  {
    target,
    scope,
    maxAgeMinutes = 30,
    clockSkewToleranceMinutes = REPORT_CLOCK_SKEW_TOLERANCE_MINUTES,
    localAttestationKey,
    expectedCiRun,
  },
) {
  const errors = [...validateReport(report)];
  if (report?.scope !== scope) errors.push('report scope does not match the required scope');
  errors.push(...verifyReportTarget(report ?? {}, target));
  const generatedAtMs = Date.parse(report?.generatedAt);
  if (!Number.isFinite(generatedAtMs)) {
    errors.push('report generatedAt is invalid');
  } else {
    const now = Date.now();
    if (now - generatedAtMs > maxAgeMinutes * 60_000) errors.push('report is stale');
    if (generatedAtMs - now > clockSkewToleranceMinutes * 60_000)
      errors.push('report generatedAt exceeds the allowed future clock skew');
  }
  if (report?.outcome !== 'pass') errors.push('report records a failed deterministic gate');
  if (target?.kind === 'local_patch') {
    const attestationError = verifyLocalPatchAttestation(report, localAttestationKey);
    if (attestationError) errors.push(attestationError);
  }
  if (expectedCiRun) {
    const ciRun = report?.context?.ciRun;
    if (
      !ciRun ||
      ciRun.source !== 'parallel-groups' ||
      ciRun.runId !== expectedCiRun.runId ||
      ciRun.runAttempt !== expectedCiRun.runAttempt
    )
      errors.push('report CI run provenance does not match the current workflow run');
  }
  return errors;
}
