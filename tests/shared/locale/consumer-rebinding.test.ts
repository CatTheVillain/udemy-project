import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import registry from '../../../localization/corpus/registry.json';

const {
  rebindConsumerGrammar,
  rebindConsumerSource,
  // @ts-expect-error The dependency-free Node localization module has no TypeScript declaration.
} = await import('../../../scripts/localization/consumer-rebinding.mjs');
const {
  consumerSourceFingerprint,
  serializeGeneratedResources,
  // @ts-expect-error The dependency-free Node engine intentionally has no TypeScript declaration.
} = await import('../../../scripts/localization/corpus-engine.mjs');

const temporaryDirectories: string[] = [];
const SOURCE_PATH = 'pages/instructor-course-enrollments-page/InstructorCourseEnrollmentsPage.tsx';
const FUNCTION_NAME = 'enrollmentStatusLabel';
const BINDING_NAME = 't';
const TASK_ID = 'FE-015';
const COURSE_DETAIL_SOURCE_PATH = 'pages/course-detail-page/CourseDetailPage.tsx';

function staleCorpus() {
  const corpus = structuredClone(registry);
  const matches = corpus.consumerGrammar.translatorWrappers.filter(
    (wrapper) =>
      wrapper.sourcePath === SOURCE_PATH &&
      wrapper.functionName === FUNCTION_NAME &&
      wrapper.bindingName === BINDING_NAME,
  );
  if (matches.length !== 1) throw new Error('fixture requires one retained translator wrapper');
  matches[0].sourceFingerprint = `sha256:${'0'.repeat(64)}`;
  return corpus;
}

async function temporaryTargets() {
  const directory = await mkdtemp(join(tmpdir(), 'learnhub-consumer-rebind-'));
  temporaryDirectories.push(directory);
  const registryPath = join(directory, 'registry.json');
  const outputPath = join(directory, 'generated-resources.ts');
  await writeFile(registryPath, `${JSON.stringify(staleCorpus(), null, 2)}\n`, 'utf8');
  await writeFile(outputPath, '// prior generated output\n', 'utf8');
  return { directory, outputPath, registryPath };
}

function expectedCorpus(sourceFingerprint: string) {
  const next = staleCorpus();
  const matches = next.consumerGrammar.translatorWrappers.filter(
    (wrapper) =>
      wrapper.sourcePath === SOURCE_PATH &&
      wrapper.functionName === FUNCTION_NAME &&
      wrapper.bindingName === BINDING_NAME,
  );
  if (matches.length !== 1) throw new Error('fixture requires one retained translator wrapper');
  matches[0].sourceFingerprint = sourceFingerprint;
  return next;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('consumer grammar rebinding', () => {
  it('rebinds every existing CourseDetailPage dynamic-family fingerprint transactionally', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'learnhub-consumer-source-rebind-'));
    temporaryDirectories.push(directory);
    const registryPath = join(directory, 'registry.json');
    const outputPath = join(directory, 'generated-resources.ts');
    const corpus = structuredClone(registry);
    const dynamicConsumers = corpus.consumerGrammar.dynamicKeyFamilies.flatMap(
      (family) => family.consumers,
    );
    const selectedConsumers = dynamicConsumers.filter(
      (consumer) => consumer.sourcePath === COURSE_DETAIL_SOURCE_PATH,
    );
    expect(selectedConsumers).toHaveLength(4);
    for (const consumer of selectedConsumers)
      consumer.sourceFingerprint = `sha256:${'0'.repeat(64)}`;
    await writeFile(registryPath, `${JSON.stringify(corpus, null, 2)}\n`, 'utf8');
    await writeFile(outputPath, '// prior generated output\n', 'utf8');
    const source = await readFile(resolve('src', COURSE_DETAIL_SOURCE_PATH), 'utf8');
    const sourceFingerprint = consumerSourceFingerprint(COURSE_DETAIL_SOURCE_PATH, source);
    const before = JSON.parse(await readFile(registryPath, 'utf8'));

    await expect(
      rebindConsumerSource({
        registryPath,
        outputPath,
        taskId: 'FE-026',
        sourceRoot: resolve('src'),
        sourcePath: COURSE_DETAIL_SOURCE_PATH,
      }),
    ).resolves.toEqual({ rebound: true, sourceFingerprint, updatedEntries: 4 });
    const rebound = JSON.parse(await readFile(registryPath, 'utf8'));
    const consumers = rebound.consumerGrammar.dynamicKeyFamilies
      .flatMap((family: { consumers: unknown[] }) => family.consumers)
      .filter(
        (consumer: { sourcePath: string }) => consumer.sourcePath === COURSE_DETAIL_SOURCE_PATH,
      );
    expect(consumers).toHaveLength(4);
    expect(
      consumers.every(
        (consumer: { sourceFingerprint: string }) =>
          consumer.sourceFingerprint === sourceFingerprint,
      ),
    ).toBe(true);
    expect(rebound.units).toEqual(before.units);
    expect(rebound.baselineResources).toEqual(before.baselineResources);
    expect(await readFile(outputPath, 'utf8')).toBe(serializeGeneratedResources(rebound));
    const replayRegistry = await readFile(registryPath, 'utf8');
    const replayOutput = await readFile(outputPath, 'utf8');
    await expect(
      rebindConsumerSource({
        registryPath,
        outputPath,
        taskId: 'FE-026',
        sourceRoot: resolve('src'),
        sourcePath: COURSE_DETAIL_SOURCE_PATH,
      }),
    ).resolves.toEqual({ rebound: false, sourceFingerprint, updatedEntries: 4 });
    expect(await readFile(registryPath, 'utf8')).toBe(replayRegistry);
    expect(await readFile(outputPath, 'utf8')).toBe(replayOutput);
  }, 20_000);

  it('rebinds one existing translator wrapper transactionally and exactly replays without writes', async () => {
    const { outputPath, registryPath } = await temporaryTargets();
    const source = await readFile(resolve('src', SOURCE_PATH), 'utf8');
    const sourceFingerprint = consumerSourceFingerprint(SOURCE_PATH, source);
    const expected = expectedCorpus(sourceFingerprint);

    await expect(
      rebindConsumerGrammar({
        registryPath,
        outputPath,
        taskId: TASK_ID,
        sourceRoot: resolve('src'),
        sourcePath: SOURCE_PATH,
        functionName: FUNCTION_NAME,
        bindingName: BINDING_NAME,
      }),
    ).resolves.toEqual({ rebound: true, sourceFingerprint });
    expect(JSON.parse(await readFile(registryPath, 'utf8'))).toEqual(expected);
    expect(await readFile(outputPath, 'utf8')).toBe(serializeGeneratedResources(expected));
    const replayRegistry = await readFile(registryPath, 'utf8');
    const replayOutput = await readFile(outputPath, 'utf8');

    await expect(
      rebindConsumerGrammar({
        registryPath,
        outputPath,
        taskId: TASK_ID,
        sourceRoot: resolve('src'),
        sourcePath: SOURCE_PATH,
        functionName: FUNCTION_NAME,
        bindingName: BINDING_NAME,
      }),
    ).resolves.toEqual({ rebound: false, sourceFingerprint });
    expect(await readFile(registryPath, 'utf8')).toBe(replayRegistry);
    expect(await readFile(outputPath, 'utf8')).toBe(replayOutput);
  }, 20_000);

  it('rejects unknown bindings and target aliases before changing either target', async () => {
    const { outputPath, registryPath } = await temporaryTargets();
    const beforeRegistry = await readFile(registryPath, 'utf8');
    const beforeOutput = await readFile(outputPath, 'utf8');
    const common = {
      registryPath,
      outputPath,
      taskId: TASK_ID,
      sourceRoot: resolve('src'),
      sourcePath: SOURCE_PATH,
      functionName: FUNCTION_NAME,
    };

    await expect(rebindConsumerGrammar({ ...common, bindingName: 'missing' })).rejects.toThrow(
      'exactly one existing translator wrapper',
    );
    await expect(
      rebindConsumerGrammar({ ...common, outputPath: registryPath, bindingName: BINDING_NAME }),
    ).rejects.toThrow('distinct file targets');
    expect(await readFile(registryPath, 'utf8')).toBe(beforeRegistry);
    expect(await readFile(outputPath, 'utf8')).toBe(beforeOutput);
  });

  it('rolls the registry back when the generated-output commit fails', async () => {
    const { outputPath, registryPath } = await temporaryTargets();
    const beforeRegistry = await readFile(registryPath, 'utf8');
    const beforeOutput = await readFile(outputPath, 'utf8');
    let renameCount = 0;

    await expect(
      rebindConsumerGrammar({
        registryPath,
        outputPath,
        taskId: TASK_ID,
        sourceRoot: resolve('src'),
        sourcePath: SOURCE_PATH,
        functionName: FUNCTION_NAME,
        bindingName: BINDING_NAME,
        fileSystem: {
          rename: async (from: string, to: string) => {
            renameCount += 1;
            if (renameCount === 2) throw new Error('injected generated-output rename failure');
            await rename(from, to);
          },
        },
      }),
    ).rejects.toThrow('injected generated-output rename failure');
    expect(renameCount).toBe(3);
    expect(await readFile(registryPath, 'utf8')).toBe(beforeRegistry);
    expect(await readFile(outputPath, 'utf8')).toBe(beforeOutput);
  }, 20_000);

  it('rejects stale output and duplicate direct consumer anchors before exact replay writes', async () => {
    const { outputPath, registryPath } = await temporaryTargets();
    const command = {
      registryPath,
      outputPath,
      taskId: TASK_ID,
      sourceRoot: resolve('src'),
      sourcePath: SOURCE_PATH,
      functionName: FUNCTION_NAME,
      bindingName: BINDING_NAME,
    };

    await rebindConsumerGrammar(command);
    const validRegistry = await readFile(registryPath, 'utf8');
    const validOutput = await readFile(outputPath, 'utf8');
    await writeFile(outputPath, '// corrupt generated output\n', 'utf8');
    const corruptOutput = await readFile(outputPath, 'utf8');
    await expect(rebindConsumerGrammar(command)).rejects.toThrow('generated output is out of date');
    expect(await readFile(registryPath, 'utf8')).toBe(validRegistry);
    expect(await readFile(outputPath, 'utf8')).toBe(corruptOutput);
    await writeFile(outputPath, validOutput, 'utf8');

    const selectedWrapper = validRegistry.indexOf(`"sourcePath": "${SOURCE_PATH}"`);
    const selectedFingerprint = validRegistry.indexOf('"sourceFingerprint"', selectedWrapper);
    const selectedLineEnd = validRegistry.indexOf('\n', selectedFingerprint);
    expect(selectedWrapper).toBeGreaterThan(-1);
    expect(selectedFingerprint).toBeGreaterThan(-1);
    expect(selectedLineEnd).toBeGreaterThan(selectedFingerprint);
    const duplicateSelectedWrapperProperty = `${validRegistry.slice(0, selectedFingerprint)}${validRegistry.slice(selectedFingerprint, selectedLineEnd)},\n        ${validRegistry.slice(selectedFingerprint)}`;
    const duplicateConsumerGrammar = validRegistry.replace(
      '"consumerGrammar": {',
      '"consumerGrammar": {},\n  "consumerGrammar": {',
    );
    const duplicateTranslatorWrappers = validRegistry.replace(
      '"translatorWrappers": [',
      '"translatorWrappers": [],\n    "translatorWrappers": [',
    );

    for (const ambiguousRegistry of [
      duplicateConsumerGrammar,
      duplicateTranslatorWrappers,
      duplicateSelectedWrapperProperty,
    ]) {
      await writeFile(registryPath, ambiguousRegistry, 'utf8');
      const beforeRegistry = await readFile(registryPath, 'utf8');
      const beforeOutput = await readFile(outputPath, 'utf8');
      await expect(rebindConsumerGrammar(command)).rejects.toThrow(
        'consumer rebinding registry source',
      );
      expect(await readFile(registryPath, 'utf8')).toBe(beforeRegistry);
      expect(await readFile(outputPath, 'utf8')).toBe(beforeOutput);
    }
  }, 20_000);
});
