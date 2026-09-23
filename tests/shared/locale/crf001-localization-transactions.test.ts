import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

const {
  reviseDraftUnits,
  // @ts-expect-error The dependency-free Node localization module has no TypeScript declaration.
} = await import('../../../scripts/localization/draft-revision.mjs');
const {
  reconcileConsumerGrammar,
  // @ts-expect-error The dependency-free Node localization module has no TypeScript declaration.
} = await import('../../../scripts/localization/consumer-reconcile.mjs');
const {
  RECORDED_BASE,
  recoverRecordedBase,
  // @ts-expect-error The dependency-free Node localization module has no TypeScript declaration.
} = await import('../../../scripts/localization/recorded-base-recovery.mjs');
const {
  consumerSourceFingerprint,
  retiredConsumerViolations,
  serializeGeneratedResources,
  validateCorpus,
  // @ts-expect-error The dependency-free Node localization module has no TypeScript declaration.
} = await import('../../../scripts/localization/corpus-engine.mjs');
const {
  checkStagedCorpus,
  // @ts-expect-error The dependency-free Node localization module has no TypeScript declaration.
} = await import('../../../scripts/localization/check-staged.mjs');
const {
  RECORDED_BASE_REQUEST,
  CRF_001_FULL_TARGET_COMMIT,
  writeRecordedBaseArtifacts,
  // @ts-expect-error The dependency-free Node localization fixture has no TypeScript declaration.
} = await import('./fixtures/crf001-recorded-base-fixture.mjs');
const { materializeHistoricalSourceTree } =
  await import('./fixtures/historical-source-tree-fixture.mjs');
const {
  CRF_001_CART_PAGE_SOURCE,
  // @ts-expect-error The fixture is a dependency-free Node module with no TypeScript declaration.
} = await import('./fixtures/crf001-cart-page-source-fixture.mjs');

interface TransactionTargets {
  readonly generatedBaselinePath: string;
  readonly directory: string;
  readonly outputPath: string;
  readonly registryBaselinePath: string;
  readonly registryPath: string;
}

interface SourceFixture {
  readonly sourceRoot: string;
}

const FE072_ADDITION_SOURCES = [
  {
    sourcePath: 'pages/instructor-course-editor-page/CourseLessonsSection.tsx',
    source: `import { useTranslation } from 'react-i18next';
export function CourseLessonsSection({ uploadRule }) {
  const { t } = useTranslation();
  return t(uploadRule.descriptionKey);
}`,
    functionName: 'CourseLessonsSection',
    argument: 'uploadRule.descriptionKey',
  },
  {
    sourcePath: 'pages/instructor-lesson-editor-page/InstructorLessonEditorPage.tsx',
    source: `import { useTranslation } from 'react-i18next';
export function InstructorLessonEditorPage({ rule }) {
  const { t } = useTranslation();
  return t(rule.descriptionKey);
}`,
    functionName: 'InstructorLessonEditorPage',
    argument: 'rule.descriptionKey',
  },
] as const;

const FE072_OBSOLETE = [
  {
    kind: 'translatorWrapper',
    sourcePath: 'pages/instructor-course-editor-page/InstructorCourseEditorPage.tsx',
    functionName: 'interpolateInstructorTemplate',
    bindingName: 't',
  },
  {
    kind: 'dynamicConsumer',
    sourcePath: 'pages/instructor-course-editor-page/InstructorCourseEditorPage.tsx',
    functionName: 'interpolateInstructorTemplate',
    familyId: 'instructor-editor-messages',
    argument: 'key',
    occurrence: 1,
  },
  {
    kind: 'translatorWrapper',
    sourcePath: 'pages/instructor-lesson-editor-page/InstructorLessonEditorPage.tsx',
    functionName: 'uploadRule',
    bindingName: 't',
  },
] as const;

const FE073_REPLACEMENT = {
  familyId: 'navigation-labels',
  oldConsumer: {
    sourcePath: 'app/layouts/AppShell.tsx',
    functionName: 'NavigationLinks',
    argument: 'item.labelKey',
    occurrence: 1,
  },
  newConsumer: {
    sourcePath: 'app/layouts/NavigationLinks.tsx',
    functionName: 'NavigationLinks',
    argument: 'item.labelKey',
    occurrence: 1,
  },
} as const;

interface ConsumerGrammarEntry {
  readonly sourceFingerprint: string;
  readonly sourcePath: string;
}

interface ConsumerGrammarFamily {
  readonly consumers: readonly ConsumerGrammarEntry[];
}

interface ConsumerGrammarFixture {
  readonly dynamicKeyFamilies: readonly ConsumerGrammarFamily[];
  readonly translatorDependencies: readonly ConsumerGrammarEntry[];
  readonly translatorForwarders: readonly ConsumerGrammarEntry[];
  readonly translatorWrappers: readonly ConsumerGrammarEntry[];
}

const temporaryDirectories: string[] = [];
const TEMPORARY_DIRECTORY_CLEANUP_TIMEOUT_MS = 30_000;
const taskRequest = structuredClone(RECORDED_BASE_REQUEST);
const execFileAsync = promisify(execFile);
const CRF_001_TARGET_CONSUMER_GRAMMAR_DIGEST =
  'd9970b3b5b52c13d8571b0d826cd00eebea52f6202e120d3ebf7013ab4a6a49e';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function canonicalDigest(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

async function createTargets(): Promise<TransactionTargets> {
  const directory = await mkdtemp(join(tmpdir(), 'learnhub-crf001-transaction-'));
  temporaryDirectories.push(directory);
  const registryPath = join(directory, 'registry.json');
  const outputPath = join(directory, 'generated-resources.ts');
  const registryBaselinePath = join(directory, 'recorded-registry.json');
  const generatedBaselinePath = join(directory, 'recorded-generated-resources.ts');
  await writeRecordedBaseArtifacts({ registryBaselinePath, generatedBaselinePath });
  await Promise.all([
    cp(registryBaselinePath, registryPath),
    cp(generatedBaselinePath, outputPath),
  ]);
  return {
    directory,
    registryPath,
    outputPath,
    registryBaselinePath,
    generatedBaselinePath,
  };
}

function recoveryRequestForTargets(targets: TransactionTargets, request = taskRequest) {
  return {
    ...request,
    registryBaselinePath: targets.registryBaselinePath,
    generatedBaselinePath: targets.generatedBaselinePath,
  };
}

async function createSourceFixture(): Promise<SourceFixture> {
  const { directory, sourceRoot } = await materializeHistoricalSourceTree({
    repositoryRoot: process.cwd(),
    commit: CRF_001_FULL_TARGET_COMMIT,
  });
  temporaryDirectories.push(directory);
  const cartSourcePath = 'src/pages/cart-page/CartPage.tsx';
  const { stdout: recordedCartSource } = await execFileAsync(
    'git',
    ['show', `${CRF_001_FULL_TARGET_COMMIT}:${cartSourcePath}`],
    { maxBuffer: 32 * 1024 * 1024 },
  );
  const cartFixturePath = join(sourceRoot, 'pages/cart-page/CartPage.tsx');
  expect(await readFile(cartFixturePath, 'utf8')).toBe(recordedCartSource);
  await writeFile(cartFixturePath, `${CRF_001_CART_PAGE_SOURCE.replace(/^\n/, '')}\n`, 'utf8');
  return { sourceRoot };
}

async function createStagedCheckFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'learnhub-staged-localization-check-'));
  temporaryDirectories.push(directory);
  await Promise.all([
    cp(resolve('.gitattributes'), join(directory, '.gitattributes')),
    cp(resolve('localization/corpus'), join(directory, 'localization/corpus'), { recursive: true }),
    cp(resolve('src'), join(directory, 'src'), { recursive: true }),
  ]);
  await execFileAsync('git', ['init', '--quiet'], { cwd: directory });
  await execFileAsync('git', ['add', '.'], { cwd: directory });
  return directory;
}

async function createRecordedBaseSourceFixture(): Promise<SourceFixture> {
  const { directory, sourceRoot } = await materializeHistoricalSourceTree({
    repositoryRoot: process.cwd(),
    commit: taskRequest.base.commit,
  });
  temporaryDirectories.push(directory);
  return { sourceRoot };
}

async function fe072AdditionRequest(sourceFixture: SourceFixture) {
  const sources = await Promise.all(
    FE072_ADDITION_SOURCES.map(async ({ sourcePath, source }) => {
      const target = join(sourceFixture.sourceRoot, sourcePath);
      await mkdir(dirname(target), { recursive: true });
      const additionSource =
        sourcePath === 'pages/instructor-lesson-editor-page/InstructorLessonEditorPage.tsx'
          ? (await readFile(target, 'utf8'))
              .replace(
                "description: t('instructor:lessonEditorMp4WebmOrMovUpTo150Mb'),",
                "descriptionKey: 'instructor:lessonEditorMp4WebmOrMovUpTo150Mb',\n      description: t('instructor:lessonEditorMp4WebmOrMovUpTo150Mb'),",
              )
              .replace(
                "description: t('instructor:lessonEditorPdfUpTo50Mb'),",
                "descriptionKey: 'instructor:lessonEditorPdfUpTo50Mb',\n      description: t('instructor:lessonEditorPdfUpTo50Mb'),",
              )
              .replace('{rule.description}', '{t(rule.descriptionKey)}')
          : source;
      await writeFile(target, additionSource, 'utf8');
      return {
        sourcePath,
        expectedSourceFingerprint: consumerSourceFingerprint(sourcePath, additionSource),
      };
    }),
  );
  const retiredCourseEditorPath = FE072_OBSOLETE[0].sourcePath;
  const retiredCourseEditorSource = await readFile(
    join(sourceFixture.sourceRoot, retiredCourseEditorPath),
    'utf8',
  );
  return {
    taskId: 'FE-072',
    sources: [
      ...sources,
      {
        sourcePath: retiredCourseEditorPath,
        expectedSourceFingerprint: consumerSourceFingerprint(
          retiredCourseEditorPath,
          retiredCourseEditorSource,
        ),
      },
    ],
    obsolete: structuredClone(FE072_OBSOLETE),
    additions: [
      {
        familyId: 'lesson-upload-descriptions',
        unitIds: ['MLUX-C0259', 'MLUX-C0260'],
        consumers: FE072_ADDITION_SOURCES.map(({ sourcePath, functionName, argument }) => ({
          sourcePath,
          functionName,
          argument,
          occurrence: 1,
        })),
      },
    ],
  };
}

async function prepareAndRetireFe072SourceConsumers(
  targets: TransactionTargets,
  sourceFixture: SourceFixture,
): Promise<void> {
  const courseEditorPath = join(
    sourceFixture.sourceRoot,
    'pages/instructor-course-editor-page/InstructorCourseEditorPage.tsx',
  );
  const lessonEditorPath = join(
    sourceFixture.sourceRoot,
    'pages/instructor-lesson-editor-page/InstructorLessonEditorPage.tsx',
  );
  const preparedCorpus = JSON.parse(await readFile(targets.registryPath, 'utf8'));
  const grammar = preparedCorpus.consumerGrammar;
  grammar.translatorWrappers = grammar.translatorWrappers.filter(
    (entry: { sourcePath: string }) => entry.sourcePath !== FE072_OBSOLETE[0].sourcePath,
  );
  grammar.dynamicKeyFamilies = grammar.dynamicKeyFamilies.map(
    (family: { consumers: unknown[] }) => ({
      ...family,
      consumers: family.consumers.filter(
        (entry: unknown): entry is { sourcePath: string } =>
          typeof entry === 'object' &&
          entry !== null &&
          'sourcePath' in entry &&
          typeof entry.sourcePath === 'string' &&
          entry.sourcePath !== FE072_OBSOLETE[1].sourcePath,
      ),
    }),
  );
  const instructorFamily = grammar.dynamicKeyFamilies.find(
    (family: { id: string }) => family.id === FE072_OBSOLETE[1].familyId,
  );
  const legacyCourseEditorSource = `import { useTranslation } from 'react-i18next';
function interpolateInstructorTemplate(key) {
  const { t } = useTranslation();
  return t(key);
}
`;
  grammar.translatorWrappers.push({
    ...FE072_OBSOLETE[0],
    sourceFingerprint: consumerSourceFingerprint(
      FE072_OBSOLETE[0].sourcePath,
      legacyCourseEditorSource,
    ),
  });
  instructorFamily.consumers.push({
    ...FE072_OBSOLETE[1],
    sourceFingerprint: consumerSourceFingerprint(
      FE072_OBSOLETE[1].sourcePath,
      legacyCourseEditorSource,
    ),
  });
  await writeFile(courseEditorPath, 'export const courseEditorRetired = true;\n', 'utf8');
  grammar.translatorWrappers = grammar.translatorWrappers.filter(
    (entry: { sourcePath: string }) => entry.sourcePath !== FE072_OBSOLETE[2].sourcePath,
  );
  const legacyLessonSource = `import { useTranslation } from 'react-i18next';
function uploadRule() {
  const { t } = useTranslation();
  return t('instructor:lessonEditorMp4WebmOrMovUpTo150Mb');
}
`;
  grammar.translatorWrappers.push({
    ...FE072_OBSOLETE[2],
    sourceFingerprint: consumerSourceFingerprint(FE072_OBSOLETE[2].sourcePath, legacyLessonSource),
  });
  await writeFile(targets.registryPath, `${JSON.stringify(preparedCorpus, null, 2)}\n`, 'utf8');
  await writeFile(targets.outputPath, serializeGeneratedResources(preparedCorpus), 'utf8');
  const retiredLessonEditorSource = `import { useTranslation } from 'react-i18next';
export function InstructorLessonEditorPage({ rule }) {
  const { t } = useTranslation();
  return t(rule.descriptionKey);
}
`;
  await writeFile(lessonEditorPath, retiredLessonEditorSource, 'utf8');
}

async function readPair(targets: TransactionTargets): Promise<readonly [string, string]> {
  return Promise.all([
    readFile(targets.registryPath, 'utf8'),
    readFile(targets.outputPath, 'utf8'),
  ]);
}

async function recordedBaseDestinationsStayIsolated(): Promise<void> {
  const firstDirectory = await mkdtemp(join(tmpdir(), 'learnhub-crf001-recorded-base-isolation-'));
  const secondDirectory = await mkdtemp(join(tmpdir(), 'learnhub-crf001-recorded-base-isolation-'));
  temporaryDirectories.push(firstDirectory, secondDirectory);
  const firstRegistryPath = join(firstDirectory, 'registry.json');
  const firstOutputPath = join(firstDirectory, 'generated-resources.ts');
  const secondRegistryPath = join(secondDirectory, 'registry.json');
  const secondOutputPath = join(secondDirectory, 'generated-resources.ts');

  await writeRecordedBaseArtifacts({
    registryBaselinePath: firstRegistryPath,
    generatedBaselinePath: firstOutputPath,
  });
  const expectedPair = await Promise.all([
    readFile(firstRegistryPath, 'utf8'),
    readFile(firstOutputPath, 'utf8'),
  ]);
  await writeFile(firstRegistryPath, 'caller mutation\n', 'utf8');
  await writeFile(firstOutputPath, 'caller mutation\n', 'utf8');
  await writeRecordedBaseArtifacts({
    registryBaselinePath: secondRegistryPath,
    generatedBaselinePath: secondOutputPath,
  });

  expect(
    await Promise.all([readFile(secondRegistryPath, 'utf8'), readFile(secondOutputPath, 'utf8')]),
  ).toEqual(expectedPair);
}

async function reviseFromRecordedBase(targets: TransactionTargets): Promise<void> {
  await reviseDraftUnits({
    registryPath: targets.registryPath,
    outputPath: targets.outputPath,
    request: taskRequest.revisionRequest,
  });
}

async function reconcileFromRecordedBase(
  targets: TransactionTargets,
  sourceFixture: SourceFixture,
  request = taskRequest.reconcileRequest,
): Promise<unknown> {
  return reconcileConsumerGrammar({
    registryPath: targets.registryPath,
    outputPath: targets.outputPath,
    request,
    sourceRoot: sourceFixture.sourceRoot,
  });
}

async function createReconciledTargetsForFe072() {
  const targets = await createTargets();
  const sourceFixture = await createSourceFixture();
  await reviseFromRecordedBase(targets);
  await reconcileFromRecordedBase(targets, sourceFixture);
  return { targets, sourceFixture };
}

async function fe073ReplacementRequest(sourceFixture: SourceFixture) {
  const appShellPath = join(sourceFixture.sourceRoot, FE073_REPLACEMENT.oldConsumer.sourcePath);
  const appShell = await readFile(appShellPath, 'utf8');
  expect(appShell).toContain('t(item.labelKey)');
  await writeFile(appShellPath, appShell.replace('t(item.labelKey)', 'item.labelKey'), 'utf8');
  const navigationLinksPath = join(
    sourceFixture.sourceRoot,
    FE073_REPLACEMENT.newConsumer.sourcePath,
  );
  const navigationLinks = `import { useTranslation } from 'react-i18next';
export function NavigationLinks({ item }) {
  const { t } = useTranslation();
  return t(item.labelKey);
}
`;
  await writeFile(navigationLinksPath, navigationLinks, 'utf8');
  return {
    taskId: 'FE-073',
    sources: await Promise.all(
      [
        [
          FE073_REPLACEMENT.oldConsumer.sourcePath,
          appShell.replace('t(item.labelKey)', 'item.labelKey'),
        ],
        [FE073_REPLACEMENT.newConsumer.sourcePath, navigationLinks],
      ].map(async ([sourcePath, source]) => ({
        sourcePath,
        expectedSourceFingerprint: consumerSourceFingerprint(sourcePath, source),
      })),
    ),
    replacements: [structuredClone(FE073_REPLACEMENT)],
    obsolete: [],
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
}, TEMPORARY_DIRECTORY_CLEANUP_TIMEOUT_MS);

describe('CRF-001 localization transactions', () => {
  it('validates the complete staged index without reading divergent worktree sources', async () => {
    const repositoryRoot = await createStagedCheckFixture();
    const packageJson = JSON.parse(await readFile(resolve('package.json'), 'utf8'));
    expect(packageJson.scripts['precommit:staged']).toBe(
      'lint-staged --concurrent false && node scripts/localization/check-staged.mjs',
    );
    expect(packageJson.scripts['precommit:staged'].match(/check-staged/g)).toHaveLength(1);
    expect(packageJson['lint-staged']['src/shared/locale/generated-resources.ts']).not.toContain(
      'npm run localization:check',
    );
    expect(packageJson['lint-staged']['localization/corpus/registry.json']).not.toContain(
      'npm run localization:check',
    );
    const snapshotNames = async () =>
      (await readdir(tmpdir())).filter((name) =>
        name.startsWith('udemy-frontend-localization-index-'),
      );
    const beforeSnapshots = await snapshotNames();

    await expect(checkStagedCorpus({ repositoryRoot })).resolves.toEqual([]);
    await writeFile(
      join(repositoryRoot, 'src/app/layouts/NavigationLinks.tsx'),
      '// divergent unstaged source must not affect the staged snapshot\n',
      'utf8',
    );
    await expect(checkStagedCorpus({ repositoryRoot })).resolves.toEqual([]);
    expect(await snapshotNames()).toEqual(beforeSnapshots);

    await writeFile(
      join(repositoryRoot, 'localization/corpus/registry.json'),
      '{invalid-json',
      'utf8',
    );
    await execFileAsync('git', ['add', 'localization/corpus/registry.json'], {
      cwd: repositoryRoot,
    });
    await expect(checkStagedCorpus({ repositoryRoot })).rejects.toThrow();
    expect(await snapshotNames()).toEqual(beforeSnapshots);
  }, 120_000);

  it('moves the existing navigation family atomically and fails closed for non-exact replacements', async () => {
    const targets = await createTargets();
    const sourceFixture = await createRecordedBaseSourceFixture();
    await reviseFromRecordedBase(targets);
    const request = await fe073ReplacementRequest(sourceFixture);
    const before = await readPair(targets);
    const beforeCorpus = JSON.parse(before[0]);
    const beforeFamily = structuredClone(
      beforeCorpus.consumerGrammar.dynamicKeyFamilies.find(
        (family: { id: string }) => family.id === FE073_REPLACEMENT.familyId,
      ),
    );
    const unrelatedConsumers = structuredClone(
      beforeCorpus.consumerGrammar.dynamicKeyFamilies.find(
        (family: { id: string }) => family.id === 'account-role-labels',
      ).consumers,
    );

    const invalidRequests = [
      (() => ({
        ...structuredClone(request),
        replacements: [{ ...FE073_REPLACEMENT, familyId: 'wrong-family' }],
      }))(),
      (() => {
        const candidate = structuredClone(request);
        (candidate.replacements[0].newConsumer as { functionName: string }).functionName =
          'wrongFunction';
        return candidate;
      })(),
      (() => {
        const candidate = structuredClone(request);
        (candidate.replacements[0].newConsumer as { argument: string }).argument = 'wrong.argument';
        return candidate;
      })(),
      (() => {
        const candidate = structuredClone(request);
        (candidate.replacements[0].newConsumer as { occurrence: number }).occurrence = 2;
        return candidate;
      })(),
      (() => {
        const candidate = structuredClone(request);
        candidate.sources = candidate.sources.slice(0, 1);
        return candidate;
      })(),
      (() => {
        const candidate = structuredClone(request);
        candidate.sources[0].expectedSourceFingerprint = `sha256:${'0'.repeat(64)}`;
        return candidate;
      })(),
      (() => ({
        ...structuredClone(request),
        replacements: [structuredClone(FE073_REPLACEMENT), structuredClone(FE073_REPLACEMENT)],
      }))(),
    ];
    for (const invalid of invalidRequests) {
      await expect(reconcileFromRecordedBase(targets, sourceFixture, invalid)).rejects.toThrow();
      expect(await readPair(targets)).toEqual(before);
    }

    await expect(reconcileFromRecordedBase(targets, sourceFixture, request)).resolves.toMatchObject(
      {
        reconciled: true,
        removedCount: 0,
      },
    );
    const committed = await readPair(targets);
    const corpus = JSON.parse(committed[0]);
    const family = corpus.consumerGrammar.dynamicKeyFamilies.find(
      (candidate: { id: string }) => candidate.id === FE073_REPLACEMENT.familyId,
    );
    expect(family.unitIds).toEqual(beforeFamily.unitIds);
    expect(family.consumers).toEqual([expect.objectContaining(FE073_REPLACEMENT.newConsumer)]);
    expect(family.consumers).not.toContainEqual(
      expect.objectContaining(FE073_REPLACEMENT.oldConsumer),
    );
    expect(
      corpus.consumerGrammar.dynamicKeyFamilies.find(
        (candidate: { id: string }) => candidate.id === 'account-role-labels',
      ).consumers,
    ).toEqual(unrelatedConsumers);
    expect(validateCorpus(corpus)).toEqual([]);
    expect(await retiredConsumerViolations(corpus, sourceFixture.sourceRoot)).toEqual([]);
    expect(committed[1]).toBe(serializeGeneratedResources(corpus));
    expect(corpus.consumerGrammar.reconciliations.at(-1)).toMatchObject({
      request,
      requestDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      sources: request.sources.map((source) =>
        expect.objectContaining({ sourcePath: source.sourcePath }),
      ),
    });

    await expect(reconcileFromRecordedBase(targets, sourceFixture, request)).resolves.toEqual({
      reconciled: false,
      removedCount: 0,
      updatedEntries: 0,
    });
    expect(await readPair(targets)).toEqual(committed);

    const rollbackTargets = await createTargets();
    const rollbackSourceFixture = await createRecordedBaseSourceFixture();
    await reviseFromRecordedBase(rollbackTargets);
    const rollbackRequest = await fe073ReplacementRequest(rollbackSourceFixture);
    const rollbackBefore = await readPair(rollbackTargets);
    let renameCount = 0;
    await expect(
      reconcileConsumerGrammar({
        registryPath: rollbackTargets.registryPath,
        outputPath: rollbackTargets.outputPath,
        request: rollbackRequest,
        sourceRoot: rollbackSourceFixture.sourceRoot,
        fileSystem: {
          rename: async (from: string, to: string) => {
            renameCount += 1;
            if (renameCount === 2) throw new Error('injected FE-073 output failure');
            await rename(from, to);
          },
        },
      }),
    ).rejects.toThrow('injected FE-073 output failure');
    expect(renameCount).toBe(3);
    expect(await readPair(rollbackTargets)).toEqual(rollbackBefore);

    const forged = JSON.parse(committed[0]);
    forged.consumerGrammar.reconciliations.at(-1).sources.pop();
    await writeFile(targets.registryPath, `${JSON.stringify(forged, null, 2)}\n`, 'utf8');
    const forgedPair = await readPair(targets);
    await expect(reconcileFromRecordedBase(targets, sourceFixture, request)).rejects.toThrow(
      /invalid consumer reconciliation provenance/,
    );
    expect(await readPair(targets)).toEqual(forgedPair);
  }, 120_000);

  it('keeps recorded-base destinations isolated from caller mutations', async () => {
    await expect(recordedBaseDestinationsStayIsolated()).resolves.toBeUndefined();
  });

  it('revises protected CRF sources transactionally, preserves identity/history and exactly replays', async () => {
    const targets = await createTargets();
    const [beforeRegistry] = await readPair(targets);
    const unrelatedUnit = beforeRegistry.match(/\{\n\s+"id": "MLUX-C0001"[\s\S]*?\n\s+\}/)?.[0];
    expect(unrelatedUnit).toBeDefined();

    await expect(reviseFromRecordedBase(targets)).resolves.toEqual(undefined);
    const [revisedRegistry, revisedOutput] = await readPair(targets);
    const revised = JSON.parse(revisedRegistry);
    expect(revised.units.filter((unit: { id: string }) => unit.id === 'MLUX-C0416')).toHaveLength(
      1,
    );
    const guidance = revised.units.find((unit: { id: string }) => unit.id === 'MLUX-C0416');
    expect(guidance).toMatchObject({
      id: 'MLUX-C0416',
      namespace: 'learning',
      key: 'mockPaymentAwaitingCompletion',
      migrationProvenance: { ownerTasks: expect.arrayContaining(['CRF-001']) },
    });
    expect(guidance.locales.ru.history.at(-1).type).toBe('draft_reset');
    expect(guidance.locales.uz.history.at(-1).type).toBe('draft_reset');
    expect(revisedOutput).toBe(serializeGeneratedResources(revised));
    expect(revisedRegistry).toContain(unrelatedUnit!);

    await expect(
      reviseDraftUnits({
        registryPath: targets.registryPath,
        outputPath: targets.outputPath,
        request: taskRequest.revisionRequest,
      }),
    ).resolves.toEqual({ revisedCount: 0, replayedCount: 4, wrote: false });
    expect(await readPair(targets)).toEqual([revisedRegistry, revisedOutput]);

    const rollbackTargets = await createTargets();
    const beforeRollback = await readPair(rollbackTargets);
    let renameCount = 0;
    await expect(
      reviseDraftUnits({
        registryPath: rollbackTargets.registryPath,
        outputPath: rollbackTargets.outputPath,
        request: taskRequest.revisionRequest,
        fileSystem: {
          rename: async (from: string, to: string) => {
            renameCount += 1;
            if (renameCount === 2) throw new Error('injected protected revision output failure');
            await rename(from, to);
          },
        },
      }),
    ).rejects.toThrow('injected protected revision output failure');
    expect(await readPair(rollbackTargets)).toEqual(beforeRollback);
  });

  it('reconciles only the exact CRF consumer graph, rejects stale inputs, and preserves unrelated bytes', async () => {
    const targets = await createTargets();
    const sourceFixture = await createSourceFixture();
    await reviseFromRecordedBase(targets);
    const beforeRegistry = await readFile(targets.registryPath, 'utf8');
    const unrelatedUnit = beforeRegistry.match(/\{\n\s+"id": "MLUX-C0001"[\s\S]*?\n\s+\}/)?.[0];
    expect(unrelatedUnit).toBeDefined();

    await expect(reconcileFromRecordedBase(targets, sourceFixture)).resolves.toMatchObject({
      reconciled: true,
      removedCount: 1,
      updatedEntries: expect.any(Number),
    });
    const reconciled = await readPair(targets);
    expect(reconciled[0]).toContain(unrelatedUnit!);
    const reconciledCorpus = JSON.parse(reconciled[0]);
    expect(
      reconciledCorpus.consumerGrammar.dynamicKeyFamilies
        .flatMap((family: ConsumerGrammarFamily) => family.consumers)
        .filter(
          (consumer: ConsumerGrammarEntry) =>
            consumer.sourcePath === 'pages/learning-list-page/LearningListPage.tsx',
        ),
    ).toEqual([
      {
        sourcePath: 'pages/learning-list-page/LearningListPage.tsx',
        functionName: 'LearningListPage',
        argument: 'failure.messageKey',
        occurrence: 1,
        sourceFingerprint:
          'sha256:8cd8137043a2fbd70289e9521bf2d49feae1092db98d429d1ce7a03608f20a68',
      },
      {
        sourcePath: 'pages/learning-list-page/LearningListPage.tsx',
        functionName: 'LearningListPage',
        argument: 'failure.titleKey',
        occurrence: 1,
        sourceFingerprint:
          'sha256:8cd8137043a2fbd70289e9521bf2d49feae1092db98d429d1ce7a03608f20a68',
      },
    ]);
    expect(reconciledCorpus.consumerGrammar.reconciliations).toEqual([
      expect.objectContaining({
        request: taskRequest.reconcileRequest,
        requestDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        sources: expect.arrayContaining([
          expect.objectContaining({
            sourcePath: 'pages/cart-page/CartPage.tsx',
            sourceFingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
          }),
        ]),
      }),
    ]);
    expect(CRF_001_FULL_TARGET_COMMIT).toBe('8fc38f5c9ecd0ed4fac14a92450a94a8eb96da13');
    expect(canonicalDigest(reconciledCorpus.consumerGrammar)).toBe(
      CRF_001_TARGET_CONSUMER_GRAMMAR_DIGEST,
    );
    await expect(reconcileFromRecordedBase(targets, sourceFixture)).resolves.toEqual({
      reconciled: false,
      removedCount: 0,
      updatedEntries: 0,
    });
    expect(await readPair(targets)).toEqual(reconciled);
    const staleReplayRequest = structuredClone(taskRequest.reconcileRequest);
    staleReplayRequest.sources[0].expectedSourceFingerprint = `sha256:${'0'.repeat(64)}`;
    await expect(
      reconcileFromRecordedBase(targets, sourceFixture, staleReplayRequest),
    ).rejects.toThrow(/stale expected source fingerprint/);
    expect(await readPair(targets)).toEqual(reconciled);

    const unprovenReplayTargets = await createTargets();
    const unprovenReplaySourceFixture = await createSourceFixture();
    await reviseFromRecordedBase(unprovenReplayTargets);
    await reconcileFromRecordedBase(unprovenReplayTargets, unprovenReplaySourceFixture);
    const unprovenReplayCorpus = JSON.parse(
      await readFile(unprovenReplayTargets.registryPath, 'utf8'),
    );
    Reflect.deleteProperty(unprovenReplayCorpus.consumerGrammar, 'reconciliations');
    await writeFile(
      unprovenReplayTargets.registryPath,
      `${JSON.stringify(unprovenReplayCorpus, null, 2)}\n`,
      'utf8',
    );
    const unprovenReplayPair = await readPair(unprovenReplayTargets);
    await expect(
      reconcileFromRecordedBase(unprovenReplayTargets, unprovenReplaySourceFixture),
    ).rejects.toThrow(/stale expected source fingerprint/);
    expect(await readPair(unprovenReplayTargets)).toEqual(unprovenReplayPair);
    const forgedCurrentFingerprintReplay = structuredClone(taskRequest.reconcileRequest);
    const unprovenGrammar = unprovenReplayCorpus.consumerGrammar as ConsumerGrammarFixture;
    for (const source of forgedCurrentFingerprintReplay.sources) {
      const entry = [
        ...unprovenGrammar.translatorWrappers,
        ...unprovenGrammar.translatorForwarders,
        ...unprovenGrammar.translatorDependencies,
        ...unprovenGrammar.dynamicKeyFamilies.flatMap((family) => family.consumers),
      ].find((candidate) => candidate.sourcePath === source.sourcePath);
      if (!entry) throw new Error(`replayed source fixture entry is missing: ${source.sourcePath}`);
      source.expectedSourceFingerprint = entry.sourceFingerprint;
    }
    await expect(
      reconcileFromRecordedBase(
        unprovenReplayTargets,
        unprovenReplaySourceFixture,
        forgedCurrentFingerprintReplay,
      ),
    ).rejects.toThrow(/obsolete identity is not exact/);
    expect(await readPair(unprovenReplayTargets)).toEqual(unprovenReplayPair);

    const forgedReplayTargets = await createTargets();
    const forgedReplaySourceFixture = await createSourceFixture();
    await reviseFromRecordedBase(forgedReplayTargets);
    await reconcileFromRecordedBase(forgedReplayTargets, forgedReplaySourceFixture);
    const forgedReplayCorpus = JSON.parse(await readFile(forgedReplayTargets.registryPath, 'utf8'));
    forgedReplayCorpus.consumerGrammar.reconciliations[0].request.sources[0].expectedSourceFingerprint = `sha256:${'0'.repeat(64)}`;
    await writeFile(
      forgedReplayTargets.registryPath,
      `${JSON.stringify(forgedReplayCorpus, null, 2)}\n`,
      'utf8',
    );
    const forgedReplayPair = await readPair(forgedReplayTargets);
    await expect(
      reconcileFromRecordedBase(forgedReplayTargets, forgedReplaySourceFixture),
    ).rejects.toThrow(/invalid consumer reconciliation provenance/);
    expect(await readPair(forgedReplayTargets)).toEqual(forgedReplayPair);

    const rejectedTargets = await createTargets();
    const rejectedSourceFixture = await createSourceFixture();
    await reviseFromRecordedBase(rejectedTargets);
    const rejectedBefore = await readPair(rejectedTargets);
    const staleRequest = structuredClone(taskRequest.reconcileRequest);
    staleRequest.sources[0].expectedSourceFingerprint = `sha256:${'0'.repeat(64)}`;
    await expect(
      reconcileFromRecordedBase(rejectedTargets, rejectedSourceFixture, staleRequest),
    ).rejects.toThrow(/stale expected source fingerprint/);
    const invalidObsoleteRequest = structuredClone(taskRequest.reconcileRequest);
    invalidObsoleteRequest.obsolete[0].bindingName = 'not-the-recorded-binding';
    await expect(
      reconcileFromRecordedBase(rejectedTargets, rejectedSourceFixture, invalidObsoleteRequest),
    ).rejects.toThrow(/obsolete identity is not exact/);
    expect(await readPair(rejectedTargets)).toEqual(rejectedBefore);

    let renameCount = 0;
    await expect(
      reconcileConsumerGrammar({
        registryPath: rejectedTargets.registryPath,
        outputPath: rejectedTargets.outputPath,
        request: taskRequest.reconcileRequest,
        sourceRoot: rejectedSourceFixture.sourceRoot,
        fileSystem: {
          rename: async (from: string, to: string) => {
            renameCount += 1;
            if (renameCount === 2) throw new Error('injected reconcile output failure');
            await rename(from, to);
          },
        },
      }),
    ).rejects.toThrow('injected reconcile output failure');
    expect(await readPair(rejectedTargets)).toEqual(rejectedBefore);
  }, 120_000);

  it('retires only the exact obsolete FE-072 consumers while adding upload-help consumers atomically', async () => {
    const { targets, sourceFixture } = await createReconciledTargetsForFe072();
    await prepareAndRetireFe072SourceConsumers(targets, sourceFixture);
    const request = await fe072AdditionRequest(sourceFixture);
    const before = await readPair(targets);
    const beforeCorpus = JSON.parse(before[0]);
    const preservedUnit = structuredClone(
      beforeCorpus.units.find((unit: { id: string }) => unit.id === 'MLUX-C0001'),
    );
    const preservedFamily = structuredClone(
      beforeCorpus.consumerGrammar.dynamicKeyFamilies.find(
        (family: { id: string }) => family.id === 'instructor-editor-messages',
      ),
    );
    const exactIdentityRequests = [
      (() => {
        const candidate = structuredClone(request);
        (candidate.obsolete[1] as { familyId: string }).familyId = 'wrong-family';
        return candidate;
      })(),
      (() => {
        const candidate = structuredClone(request);
        (candidate.obsolete[1] as { argument: string }).argument = 'wrong.argument';
        return candidate;
      })(),
      (() => {
        const candidate = structuredClone(request);
        (candidate.obsolete[1] as { occurrence: number }).occurrence = 2;
        return candidate;
      })(),
      (() => {
        const candidate = structuredClone(request);
        (candidate.obsolete[1] as { sourcePath: string }).sourcePath =
          'pages/unapproved/Consumer.tsx';
        return candidate;
      })(),
      (() => {
        const candidate = structuredClone(request);
        (candidate.obsolete[1] as { functionName: string }).functionName = 'wrongFunction';
        return candidate;
      })(),
      (() => {
        const candidate = structuredClone(request);
        (candidate.obsolete[0] as { bindingName: string }).bindingName = 'wrong-binding';
        return candidate;
      })(),
    ];
    for (const rejected of exactIdentityRequests) {
      await expect(reconcileFromRecordedBase(targets, sourceFixture, rejected)).rejects.toThrow(
        /obsolete identity is not exact/,
      );
      expect(await readPair(targets)).toEqual(before);
    }

    await expect(reconcileFromRecordedBase(targets, sourceFixture, request)).resolves.toMatchObject(
      {
        reconciled: true,
        removedCount: 3,
      },
    );
    const committed = await readPair(targets);
    const corpus = JSON.parse(committed[0]);
    expect(corpus.consumerGrammar.dynamicKeyFamilies).toContainEqual({
      id: 'lesson-upload-descriptions',
      unitIds: ['MLUX-C0259', 'MLUX-C0260'],
      consumers: expect.arrayContaining([
        expect.objectContaining({
          sourcePath: FE072_ADDITION_SOURCES[0].sourcePath,
          functionName: FE072_ADDITION_SOURCES[0].functionName,
          argument: FE072_ADDITION_SOURCES[0].argument,
          occurrence: 1,
        }),
        expect.objectContaining({
          sourcePath: FE072_ADDITION_SOURCES[1].sourcePath,
          functionName: FE072_ADDITION_SOURCES[1].functionName,
          argument: FE072_ADDITION_SOURCES[1].argument,
          occurrence: 1,
        }),
      ]),
    });
    expect(corpus.units.find((unit: { id: string }) => unit.id === 'MLUX-C0001')).toEqual(
      preservedUnit,
    );
    const retainedFamily = corpus.consumerGrammar.dynamicKeyFamilies.find(
      (family: { id: string }) => family.id === 'instructor-editor-messages',
    );
    expect(retainedFamily).toMatchObject({
      id: 'instructor-editor-messages',
      unitIds: preservedFamily.unitIds,
    });
    expect(retainedFamily.consumers).toEqual(
      preservedFamily.consumers.filter(
        (consumer: {
          sourcePath: string;
          functionName: string;
          argument: string;
          occurrence: number;
        }) =>
          !(
            consumer.sourcePath === FE072_OBSOLETE[1].sourcePath &&
            consumer.functionName === FE072_OBSOLETE[1].functionName &&
            consumer.argument === FE072_OBSOLETE[1].argument &&
            consumer.occurrence === FE072_OBSOLETE[1].occurrence
          ),
      ),
    );
    await expect(reconcileFromRecordedBase(targets, sourceFixture, request)).resolves.toEqual({
      reconciled: false,
      removedCount: 0,
      updatedEntries: 0,
    });
    expect(await readPair(targets)).toEqual(committed);

    const rejectedRequests = [
      (() => {
        const candidate = structuredClone(request);
        delete (candidate.obsolete[1] as { argument?: string }).argument;
        return candidate;
      })(),
      (() => {
        const candidate = structuredClone(request);
        Object.assign(candidate.obsolete[1], { bindingName: 't' });
        return candidate;
      })(),
      (() => {
        const candidate = structuredClone(request);
        return {
          ...candidate,
          obsolete: [...candidate.obsolete, structuredClone(candidate.obsolete[1])],
        };
      })(),
    ];
    for (const rejected of rejectedRequests)
      await expect(reconcileFromRecordedBase(targets, sourceFixture, rejected)).rejects.toThrow();
    expect(await readPair(targets)).toEqual(committed);

    const stale = structuredClone(request);
    stale.sources[0].expectedSourceFingerprint = `sha256:${'0'.repeat(64)}`;
    await expect(reconcileFromRecordedBase(targets, sourceFixture, stale)).rejects.toThrow(
      /stale (?:current|expected) source fingerprint/,
    );
    expect(await readPair(targets)).toEqual(committed);

    const existingFamily = structuredClone(request);
    existingFamily.taskId = 'CRF-072';
    existingFamily.additions[0].familyId = 'lesson-upload-descriptions';
    await expect(reconcileFromRecordedBase(targets, sourceFixture, existingFamily)).rejects.toThrow(
      /stale expected source fingerprint/,
    );
    const absentUnit = structuredClone(request);
    absentUnit.additions[0].familyId = 'another-upload-family';
    absentUnit.additions[0].unitIds = ['MLUX-C9999'];
    await expect(reconcileFromRecordedBase(targets, sourceFixture, absentUnit)).rejects.toThrow(
      /stale expected source fingerprint/,
    );
    expect(await readPair(targets)).toEqual(committed);

    const { targets: graphTargets, sourceFixture: graphSourceFixture } =
      await createReconciledTargetsForFe072();
    await prepareAndRetireFe072SourceConsumers(graphTargets, graphSourceFixture);
    const graphRequest = await fe072AdditionRequest(graphSourceFixture);
    const graphSource = FE072_ADDITION_SOURCES[0].source.replace(
      'uploadRule.descriptionKey',
      'uploadRule.otherKey',
    );
    await writeFile(
      join(graphSourceFixture.sourceRoot, FE072_ADDITION_SOURCES[0].sourcePath),
      graphSource,
      'utf8',
    );
    graphRequest.sources[0].expectedSourceFingerprint = consumerSourceFingerprint(
      graphRequest.sources[0].sourcePath,
      graphSource,
    );
    const graphBefore = await readPair(graphTargets);
    await expect(
      reconcileFromRecordedBase(graphTargets, graphSourceFixture, graphRequest),
    ).rejects.toThrow(/next source graph validation failed/);
    expect(await readPair(graphTargets)).toEqual(graphBefore);

    const { targets: rollbackTargets, sourceFixture: rollbackSourceFixture } =
      await createReconciledTargetsForFe072();
    await prepareAndRetireFe072SourceConsumers(rollbackTargets, rollbackSourceFixture);
    const rollbackRequest = await fe072AdditionRequest(rollbackSourceFixture);
    const beforeRollback = await readPair(rollbackTargets);
    let renameCount = 0;
    await expect(
      reconcileConsumerGrammar({
        registryPath: rollbackTargets.registryPath,
        outputPath: rollbackTargets.outputPath,
        request: rollbackRequest,
        sourceRoot: rollbackSourceFixture.sourceRoot,
        fileSystem: {
          rename: async (from: string, to: string) => {
            renameCount += 1;
            if (renameCount === 2) throw new Error('injected FE-072 output failure');
            await rename(from, to);
          },
        },
      }),
    ).rejects.toThrow('injected FE-072 output failure');
    expect(renameCount).toBe(3);
    expect(await readPair(rollbackTargets)).toEqual(beforeRollback);
  }, 120_000);

  it('reconstructs the recorded base exactly, rejects semantic drift, and rolls back paired recovery writes', async () => {
    const rejectedRequests = [
      (() => {
        const request = structuredClone(taskRequest);
        request.revisionRequest.taskId = 'CRF-002';
        return request;
      })(),
      (() => {
        const request = structuredClone(taskRequest);
        const addedRevision = structuredClone(request.revisionRequest.revisions[0]);
        addedRevision.id = 'MLUX-C0001';
        request.revisionRequest.revisions.push(addedRevision);
        return request;
      })(),
      (() => {
        const request = structuredClone(taskRequest);
        request.revisionRequest.revisions.pop();
        return request;
      })(),
      (() => {
        const request = structuredClone(taskRequest);
        request.revisionRequest.revisions[0].english = 'Altered protected revision content';
        return request;
      })(),
      (() => {
        const request = structuredClone(taskRequest);
        request.reconcileRequest.sources[0].sourcePath = 'pages/unapproved-source.tsx';
        return request;
      })(),
      (() => {
        const request = structuredClone(taskRequest);
        request.reconcileRequest.sources[0].expectedSourceFingerprint = `sha256:${'0'.repeat(64)}`;
        return request;
      })(),
      (() => {
        const request = structuredClone(taskRequest);
        request.reconcileRequest.obsolete[0].bindingName = 'unapprovedBinding';
        return request;
      })(),
    ];
    for (const rejectedRequest of rejectedRequests) {
      const rejectedTargets = await createTargets();
      const beforeRejectedRequest = await readPair(rejectedTargets);
      await expect(
        recoverRecordedBase({
          registryPath: rejectedTargets.registryPath,
          outputPath: rejectedTargets.outputPath,
          request: recoveryRequestForTargets(rejectedTargets, rejectedRequest),
          sourceRoot: join(rejectedTargets.directory, 'unused-source-root'),
        }),
      ).rejects.toThrow(/approved CRF-001 delta/);
      expect(await readPair(rejectedTargets)).toEqual(beforeRejectedRequest);
    }

    const targets = await createTargets();
    const sourceFixture = await createSourceFixture();
    await reviseFromRecordedBase(targets);
    await reconcileFromRecordedBase(targets, sourceFixture);
    const [targetRegistry, targetOutput] = await readPair(targets);
    await writeFile(
      targets.registryPath,
      `${JSON.stringify(JSON.parse(targetRegistry), null, 2)}\n`,
      'utf8',
    );

    await expect(
      recoverRecordedBase({
        registryPath: targets.registryPath,
        outputPath: targets.outputPath,
        request: recoveryRequestForTargets(targets),
        sourceRoot: sourceFixture.sourceRoot,
      }),
    ).resolves.toEqual({ recovered: true, wrote: true });
    expect(await readPair(targets)).toEqual([targetRegistry, targetOutput]);
    await expect(
      recoverRecordedBase({
        registryPath: targets.registryPath,
        outputPath: targets.outputPath,
        request: recoveryRequestForTargets(targets),
        sourceRoot: sourceFixture.sourceRoot,
      }),
    ).resolves.toEqual({ recovered: false, wrote: false });

    const drifted = JSON.parse(targetRegistry);
    drifted.units
      .find((unit: { id: string }) => unit.id === 'MLUX-C0001')
      .migrationProvenance.ownerTasks.push('CRF-999');
    await writeFile(targets.registryPath, `${JSON.stringify(drifted, null, 2)}\n`, 'utf8');
    await writeFile(targets.outputPath, serializeGeneratedResources(drifted), 'utf8');
    const driftedPair = await readPair(targets);
    await expect(
      recoverRecordedBase({
        registryPath: targets.registryPath,
        outputPath: targets.outputPath,
        request: recoveryRequestForTargets(targets),
        sourceRoot: sourceFixture.sourceRoot,
      }),
    ).rejects.toThrow(/semantic drift/);
    expect(await readPair(targets)).toEqual(driftedPair);

    await writeFile(
      targets.registryPath,
      `${JSON.stringify(JSON.parse(targetRegistry), null, 2)}\n`,
      'utf8',
    );
    const grammarDriftSource = join(sourceFixture.sourceRoot, 'pages/cart-page/CartPage.tsx');
    await writeFile(grammarDriftSource, `${await readFile(grammarDriftSource, 'utf8')}\n`, 'utf8');
    const grammarDriftPair = await readPair(targets);
    await expect(
      recoverRecordedBase({
        registryPath: targets.registryPath,
        outputPath: targets.outputPath,
        request: recoveryRequestForTargets(targets),
        sourceRoot: sourceFixture.sourceRoot,
      }),
    ).rejects.toThrow(/consumer grammar does not match the approved CRF-001 delta/);
    expect(await readPair(targets)).toEqual(grammarDriftPair);

    await writeFile(
      targets.registryPath,
      `${JSON.stringify(JSON.parse(targetRegistry), null, 2)}\n`,
      'utf8',
    );
    const beforeRollback = await readPair(targets);
    const rollbackSourceFixture = await createSourceFixture();
    let renameCount = 0;
    await expect(
      recoverRecordedBase({
        registryPath: targets.registryPath,
        outputPath: targets.outputPath,
        request: recoveryRequestForTargets(targets),
        sourceRoot: rollbackSourceFixture.sourceRoot,
        fileSystem: {
          rename: async (from: string, to: string) => {
            renameCount += 1;
            if (renameCount === 2) throw new Error('injected recovery output failure');
            await rename(from, to);
          },
        },
      }),
    ).rejects.toThrow('injected recovery output failure');
    expect(await readPair(targets)).toEqual(beforeRollback);
    expect(RECORDED_BASE).toEqual(taskRequest.base);
  }, 45_000);
});
