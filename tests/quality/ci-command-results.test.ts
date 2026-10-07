import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CI_GROUP_IDS,
  QUALITY_COMMAND_GROUPS,
  REQUIRED_QUALITY_COMMAND_IDS,
  stableJson,
  validateQualityCommandGroupPartition,
} from '../../scripts/quality/report-utils.mjs';
import type {
  CiGroupId,
  QualityCommand,
  ToolVersions,
} from '../../scripts/quality/report-utils.mjs';
import {
  assembleCiCommandResults,
  createCiGroupResultEnvelope,
  isNonFutureCiRunAttempt,
  parseCiGroupResultEnvelope,
  validateCiProducerResults,
} from '../../scripts/quality/ci-command-results.mjs';
import type {
  CiGroupAnalysis,
  CiGroupResultEnvelope,
  CiProducerResults,
  CiRunIdentity,
} from '../../scripts/quality/ci-command-results.mjs';
import { qualityCommandPlan } from '../../scripts/quality/quality-commands.mjs';

const targetSha = '3c697ce01d58531bd000491d6edbbecc02a7192e';
const ciRun: CiRunIdentity = { runId: '4312', runAttempt: '2' };
const generatedAt = '2026-09-05T12:00:00.000Z';
const now = new Date('2026-09-05T12:01:00.000Z');
const deterministicReportLimitation =
  'Report pass is deterministic evidence only; it is not a semantic or architectural Review or QA verdict.';
const toolVersions: ToolVersions = {
  node: 'v20.19.1',
  npm: '10.8.2',
  typescript: '5.8.3',
  prettier: '3.6.2',
  stylelint: '16.24.0',
  eslint: '9.35.0',
};

function diagnostics() {
  return {
    allowedRouterFutureWarnings: 0,
    unexpectedReactActWarnings: 0,
    unexpectedUnhandledRejections: 0,
    unexpectedConsoleWarnings: 0,
    unexpectedGenericWarnings: 0,
  };
}

function command(id: (typeof REQUIRED_QUALITY_COMMAND_IDS)[number]): QualityCommand {
  return {
    id,
    status: 'pass',
    durationMs: 1,
    exitCode: 0,
    errorCode: null,
    diagnostics: diagnostics(),
  };
}

function analysis(): CiGroupAnalysis {
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

function envelope(group: CiGroupId, runAttempt = ciRun.runAttempt): CiGroupResultEnvelope {
  return createCiGroupResultEnvelope({
    group,
    sha: targetSha,
    ciRun: { ...ciRun, runAttempt },
    generatedAt,
    commands: qualityCommandPlan({ mode: 'ci-group', group }).map(({ id }) => command(id)),
    toolVersions,
    ...(group === 'lint-static' ? { analysis: analysis() } : {}),
  });
}

function producerResults(attempts: Partial<Record<CiGroupId, string>> = {}): CiProducerResults {
  return Object.fromEntries(
    CI_GROUP_IDS.map((group) => [
      group,
      { result: 'success', runAttempt: attempts[group] ?? ciRun.runAttempt },
    ]),
  ) as CiProducerResults;
}

function assemble(envelopes: readonly CiGroupResultEnvelope[]) {
  return assembleCiCommandResults({
    envelopes,
    expectedSha: targetSha,
    expectedCiRun: ciRun,
    producerResults: producerResults(),
    now,
  });
}

function redigest(value: CiGroupResultEnvelope): CiGroupResultEnvelope {
  const unsigned: Partial<CiGroupResultEnvelope> = { ...value };
  delete unsigned.integrity;
  return {
    ...value,
    integrity: {
      algorithm: 'sha256',
      digest: createHash('sha256').update(stableJson(unsigned)).digest('hex'),
    },
  };
}

describe('parallel CI quality command plan', () => {
  it('assigns each canonical command to exactly one exact producer group', () => {
    expect(CI_GROUP_IDS).toEqual(['lint-static', 'typecheck', 'tests', 'build']);
    expect(QUALITY_COMMAND_GROUPS).toEqual({
      'lint-static': ['format', 'stylelint', 'lint', 'quality-lint', 'static-rules'],
      typecheck: ['typecheck'],
      tests: ['tests'],
      build: ['build'],
    });
    const owned = CI_GROUP_IDS.flatMap((group) =>
      qualityCommandPlan({ mode: 'ci-group', group }).map((item) => item.id),
    );

    expect([...owned].sort()).toEqual([...REQUIRED_QUALITY_COMMAND_IDS].sort());
    expect(new Set(owned).size).toBe(REQUIRED_QUALITY_COMMAND_IDS.length);
    expect(qualityCommandPlan({ mode: 'ci-group', group: 'tests' })[0]?.args).toEqual([
      'test',
      '--',
      '--pool=forks',
      '--poolOptions.forks.maxForks=1',
      '--poolOptions.forks.minForks=1',
      '--poolOptions.forks.isolate=true',
      '--testTimeout=60000',
      '--hookTimeout=60000',
    ]);
    expect(qualityCommandPlan({ mode: 'ci-group', group: 'build' })[0]).toMatchObject({
      id: 'build',
      runner: 'vite',
      args: ['build'],
    });
    expect(
      qualityCommandPlan({ mode: 'full' })[REQUIRED_QUALITY_COMMAND_IDS.length - 1],
    ).toMatchObject({
      id: 'build',
      runner: 'npm',
      args: ['run', 'build'],
    });
    expect(qualityCommandPlan({ mode: 'full' }).map((item) => item.id)).toEqual(
      REQUIRED_QUALITY_COMMAND_IDS,
    );
  });

  it('rejects missing, duplicate, and unknown command-group membership', () => {
    expect(validateQualityCommandGroupPartition(QUALITY_COMMAND_GROUPS)).toEqual([]);
    expect(
      validateQualityCommandGroupPartition({
        ...QUALITY_COMMAND_GROUPS,
        tests: ['tests', 'build'],
      }),
    ).not.toEqual([]);
    expect(
      validateQualityCommandGroupPartition({
        ...QUALITY_COMMAND_GROUPS,
        build: [],
      }),
    ).not.toEqual([]);
    expect(
      validateQualityCommandGroupPartition({
        ...QUALITY_COMMAND_GROUPS,
        build: ['unknown'],
      }),
    ).not.toEqual([]);
  });
});

describe('parallel CI quality result assembly', () => {
  it('assembles one valid result from each producer without command execution', () => {
    const assembled = assemble(CI_GROUP_IDS.map((group) => envelope(group)));

    expect(assembled.commands.map((item) => item.id)).toEqual(REQUIRED_QUALITY_COMMAND_IDS);
    expect(assembled.context.ciRun).toEqual({
      source: 'parallel-groups',
      runId: ciRun.runId,
      runAttempt: ciRun.runAttempt,
    });
    expect(assembled.commands).toHaveLength(8);
    expect(assembled.limitations).toContain(deterministicReportLimitation);
  });

  it('assembles mixed producer attempts only when each exact published attempt matches', () => {
    const attempts: Record<CiGroupId, string> = {
      'lint-static': '1',
      typecheck: '1',
      tests: '2',
      build: '1',
    };
    const assembled = assembleCiCommandResults({
      envelopes: CI_GROUP_IDS.map((group) => envelope(group, attempts[group])),
      expectedSha: targetSha,
      expectedCiRun: ciRun,
      producerResults: producerResults(attempts),
      now,
    });

    expect(assembled.context.ciRun).toEqual({
      source: 'parallel-groups',
      runId: ciRun.runId,
      runAttempt: ciRun.runAttempt,
    });
    expect(assembled.commands.map((item) => item.id)).toEqual(REQUIRED_QUALITY_COMMAND_IDS);
  });

  it('rejects an older envelope that was not the exact attempt published by its producer', () => {
    const attempts = { 'lint-static': '1', typecheck: '1', tests: '2', build: '1' } as const;
    const values = CI_GROUP_IDS.map((group) => envelope(group, attempts[group]));
    values[values.findIndex(({ group }) => group === 'tests')] = envelope('tests', '1');

    expect(() =>
      assembleCiCommandResults({
        envelopes: values,
        expectedSha: targetSha,
        expectedCiRun: ciRun,
        producerResults: producerResults(attempts),
        now,
      }),
    ).toThrow(/run identity/);
  });

  it('validates exact successful producer records and lossless nonfuture attempts', () => {
    expect(validateCiProducerResults(producerResults(), ciRun.runAttempt)).toEqual([]);
    expect(isNonFutureCiRunAttempt('1', '1')).toBe(true);
    expect(isNonFutureCiRunAttempt('9', '10')).toBe(true);
    expect(
      isNonFutureCiRunAttempt('999999999999999999999999999998', '999999999999999999999999999999'),
    ).toBe(true);
    expect(
      isNonFutureCiRunAttempt('1000000000000000000000000000000', '999999999999999999999999999999'),
    ).toBe(false);

    const malformedRecords: unknown[] = [
      { ...producerResults(), tests: { result: 'failure', runAttempt: '2' } },
      { ...producerResults(), tests: { result: 'skipped', runAttempt: '2' } },
      { ...producerResults(), tests: { result: 'cancelled', runAttempt: '2' } },
      { ...producerResults(), tests: { result: 'success', runAttempt: '0' } },
      { ...producerResults(), tests: { result: 'success', runAttempt: 2 } },
      { ...producerResults(), tests: { result: 'success', runAttempt: '3' } },
      { ...producerResults(), tests: { result: 'success' } },
      { ...producerResults(), tests: { result: 'success', runAttempt: '2', extra: true } },
      { ...producerResults(), extra: { result: 'success', runAttempt: '2' } },
      Object.fromEntries(Object.entries(producerResults()).filter(([group]) => group !== 'tests')),
    ];
    for (const records of malformedRecords)
      expect(validateCiProducerResults(records, ciRun.runAttempt)).not.toEqual([]);
  });

  it.each([
    ['missing producer', () => CI_GROUP_IDS.slice(1).map((group) => envelope(group))],
    [
      'duplicate producer',
      () => [...CI_GROUP_IDS.map((group) => envelope(group)), envelope('tests')],
    ],
    [
      'unknown producer',
      () => [
        { ...envelope('tests'), group: 'other' as CiGroupId },
        ...CI_GROUP_IDS.filter((id) => id !== 'tests').map((group) => envelope(group)),
      ],
    ],
  ])('rejects %s before report construction', (_name, createEnvelopes) => {
    expect(() => assemble(createEnvelopes())).toThrow();
  });

  it.each([
    ['wrong SHA', (value: CiGroupResultEnvelope) => ({ ...value, sha: 'f'.repeat(40) })],
    [
      'numeric SHA',
      (value: CiGroupResultEnvelope) => ({ ...value, sha: 1234567 as unknown as string }),
    ],
    [
      'array SHA',
      (value: CiGroupResultEnvelope) => ({
        ...value,
        sha: ['abcdef0'] as unknown as string,
      }),
    ],
    [
      'wrong run',
      (value: CiGroupResultEnvelope) => ({ ...value, ciRun: { ...ciRun, runId: '99' } }),
    ],
    [
      'wrong attempt',
      (value: CiGroupResultEnvelope) => ({ ...value, ciRun: { ...ciRun, runAttempt: '4' } }),
    ],
    [
      'numeric run id',
      (value: CiGroupResultEnvelope) => ({
        ...value,
        ciRun: { ...ciRun, runId: 4312 as unknown as string },
      }),
    ],
    [
      'stale time',
      (value: CiGroupResultEnvelope) => ({ ...value, generatedAt: '2026-09-05T11:00:00.000Z' }),
    ],
    [
      'future time',
      (value: CiGroupResultEnvelope) => ({ ...value, generatedAt: '2026-09-05T12:10:00.000Z' }),
    ],
    [
      'calendar-normalized date',
      (value: CiGroupResultEnvelope) => ({ ...value, generatedAt: '2026-02-30T12:00:00.000Z' }),
    ],
  ])('rejects %s envelope provenance', (_name, alter) => {
    const values = CI_GROUP_IDS.map((group) => envelope(group));
    values[0] = redigest(alter(values[0]));
    expect(() => assemble(values)).toThrow();
  });

  it('accepts equivalent SHA casing without rewriting the integrity-protected receipt', () => {
    const values = CI_GROUP_IDS.map((group) => envelope(group));
    values[0] = redigest({ ...values[0], sha: targetSha.toUpperCase() });

    expect(assemble(values).commands.map((item) => item.id)).toEqual(REQUIRED_QUALITY_COMMAND_IDS);
  });

  it.each(['failure', 'skipped', 'cancelled'] as const)(
    'rejects a %s producer even with a valid current-run artifact',
    (state) => {
      expect(() =>
        assembleCiCommandResults({
          envelopes: CI_GROUP_IDS.map((group) => envelope(group)),
          expectedSha: targetSha,
          expectedCiRun: ciRun,
          producerResults: {
            ...producerResults(),
            tests: { result: state, runAttempt: ciRun.runAttempt },
          },
          now,
        }),
      ).toThrow();
    },
  );

  it('rejects tampering even when the modified bytes are redigested', () => {
    const values = CI_GROUP_IDS.map((group) => envelope(group));
    const tests = values.find((item) => item.group === 'tests');
    if (!tests) throw new Error('test fixture must include the tests producer');
    values[values.indexOf(tests)] = redigest({
      ...tests,
      commands: [{ ...tests.commands[0], status: 'pass', exitCode: 1 }],
    });

    expect(() => assemble(values)).toThrow();
  });

  it.each([
    [
      'missing command',
      (value: CiGroupResultEnvelope) => ({ ...value, commands: value.commands.slice(1) }),
    ],
    [
      'duplicate command',
      (value: CiGroupResultEnvelope) => ({
        ...value,
        commands: [...value.commands, value.commands[0]],
      }),
    ],
    [
      'unknown command',
      (value: CiGroupResultEnvelope) => ({
        ...value,
        commands: [{ ...value.commands[0], id: 'unknown' as unknown as QualityCommand['id'] }],
      }),
    ],
    [
      'wrong group ownership',
      (value: CiGroupResultEnvelope) => ({
        ...value,
        commands: [{ ...value.commands[0], id: 'typecheck' }],
      }),
    ],
    [
      'wrong command order',
      (value: CiGroupResultEnvelope) => ({
        ...value,
        commands: [...value.commands].reverse(),
      }),
    ],
  ])('rejects a redigested %s producer command set', (_name, alter) => {
    const values = CI_GROUP_IDS.map((group) => envelope(group));
    values[0] = redigest(alter(values[0]) as CiGroupResultEnvelope);
    expect(() => assemble(values)).toThrow();
  });

  it.each([
    [
      'missing lint-static analysis',
      (value: CiGroupResultEnvelope) => {
        const withoutAnalysis = { ...value };
        delete withoutAnalysis.analysis;
        return withoutAnalysis;
      },
    ],
    [
      'analysis on a non-lint producer',
      (value: CiGroupResultEnvelope) => ({ ...value, analysis: analysis() }),
    ],
    [
      'unexpected diagnostics on a pass command',
      (value: CiGroupResultEnvelope) => ({
        ...value,
        commands: [
          {
            ...value.commands[0],
            diagnostics: { ...diagnostics(), unexpectedConsoleWarnings: 1 },
          },
        ],
      }),
    ],
  ])('rejects redigested invalid producer metadata: %s', (_name, alter) => {
    const values = CI_GROUP_IDS.map((group) => envelope(group));
    const index = _name === 'analysis on a non-lint producer' ? 1 : 0;
    values[index] = redigest(alter(values[index]));
    expect(() => assemble(values)).toThrow();
  });

  it('keeps a complete failed producer receipt parseable while refusing to assemble it', () => {
    const failed = envelope('tests');
    const receipt = redigest({
      ...failed,
      commands: [{ ...failed.commands[0], status: 'fail', exitCode: 1 }],
    });

    expect(parseCiGroupResultEnvelope(Buffer.from(JSON.stringify(receipt)))).toEqual(receipt);
    expect(() =>
      assemble([
        ...CI_GROUP_IDS.filter((group) => group !== 'tests').map((group) => envelope(group)),
        receipt,
      ]),
    ).toThrow();
  });

  it('keeps parsing clock-independent while target-aware admission rejects stale and future receipts', () => {
    for (const generatedAtValue of ['2026-09-05T11:00:00.000Z', '2026-09-05T12:10:00.000Z']) {
      const staleOrFuture = redigest({ ...envelope('tests'), generatedAt: generatedAtValue });
      expect(parseCiGroupResultEnvelope(Buffer.from(JSON.stringify(staleOrFuture)))).toEqual(
        staleOrFuture,
      );
      expect(() =>
        assemble([
          ...CI_GROUP_IDS.filter((group) => group !== 'tests').map((group) => envelope(group)),
          staleOrFuture,
        ]),
      ).toThrow();
    }
  });

  it('rejects invalid or oversized on-disk envelopes before JSON data is admitted', () => {
    expect(() => parseCiGroupResultEnvelope(Buffer.from('{'))).toThrow();
    expect(() => parseCiGroupResultEnvelope(Buffer.from([0xff, 0xfe, 0xfd]))).toThrow();
    expect(() => parseCiGroupResultEnvelope(Buffer.alloc(1024 * 1024 + 1, 0x20))).toThrow();
  });
});
