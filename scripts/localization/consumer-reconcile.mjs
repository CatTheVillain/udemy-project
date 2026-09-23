import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';

import {
  consumerSourceFingerprint,
  consumerReconciliationRequestDigest,
  rebindConsumerSource,
  retiredConsumerViolations,
  serializeGeneratedResources,
  validateCorpus,
} from './corpus-engine.mjs';
import { serializeConsumerGrammarRegistry } from './registry-source-transaction.mjs';
import { assertDistinctFileTargets, commitReviewTransaction } from './review-exchange.mjs';

const TASK_ID = /^(FE|CRF)-\d{3}$/;
const KINDS = new Set([
  'translatorWrapper',
  'translatorForwarder',
  'translatorDependency',
  'dynamicConsumer',
]);
const FAMILY_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const sourcePathIsValid = (value) =>
  typeof value === 'string' && /^(?!src\/)(?!.*\.\.)(?:[^/]+\/)*[^/]+\.(?:ts|tsx)$/.test(value);
const fingerprintIsValid = (value) =>
  typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const signature = (item) =>
  item.kind === 'dynamicConsumer'
    ? `${item.kind}|${item.sourcePath}|${item.functionName}|${item.familyId}|${item.argument}|${item.occurrence}`
    : `${item.kind}|${item.sourcePath}|${item.functionName}|${item.bindingName}`;
const consumerIdentity = (consumer) =>
  `${consumer.sourcePath}|${consumer.functionName}|${consumer.argument}|${consumer.occurrence}`;
function exact(value, keys) {
  return (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}
function validateRequest(request) {
  if (
    ![
      ['taskId', 'sources', 'additions', 'obsolete'],
      ['taskId', 'sources', 'replacements', 'obsolete'],
      ['taskId', 'sources', 'obsolete'],
    ].some((keys) => exact(request, keys)) ||
    !TASK_ID.test(request.taskId) ||
    !Array.isArray(request.sources) ||
    request.sources.length === 0 ||
    (Object.hasOwn(request, 'additions') && !Array.isArray(request.additions)) ||
    (Object.hasOwn(request, 'replacements') && !Array.isArray(request.replacements)) ||
    !Array.isArray(request.obsolete)
  )
    throw new Error(
      'request must exactly contain taskId, sources, obsolete, and optional additions or replacements',
    );
  const paths = new Set();
  for (const source of request.sources) {
    if (
      !exact(source, ['sourcePath', 'expectedSourceFingerprint']) ||
      !sourcePathIsValid(source.sourcePath) ||
      !fingerprintIsValid(source.expectedSourceFingerprint) ||
      paths.has(source.sourcePath)
    )
      throw new Error(
        'sources must be duplicate-free canonical source-root paths with fingerprints',
      );
    paths.add(source.sourcePath);
  }
  const families = new Set();
  const units = new Set();
  const consumers = new Set();
  for (const addition of request.additions ?? []) {
    if (
      !exact(addition, ['familyId', 'unitIds', 'consumers']) ||
      !FAMILY_ID.test(addition.familyId ?? '') ||
      families.has(addition.familyId) ||
      !Array.isArray(addition.unitIds) ||
      addition.unitIds.length === 0 ||
      !Array.isArray(addition.consumers) ||
      addition.consumers.length === 0
    )
      throw new Error('additions must have unique families, units, and consumers');
    families.add(addition.familyId);
    for (const unitId of addition.unitIds) {
      if (typeof unitId !== 'string' || !unitId || units.has(unitId))
        throw new Error('addition unit ids must be unique non-empty text');
      units.add(unitId);
    }
    for (const consumer of addition.consumers) {
      if (
        !exact(consumer, ['sourcePath', 'functionName', 'argument', 'occurrence']) ||
        !sourcePathIsValid(consumer.sourcePath) ||
        !paths.has(consumer.sourcePath) ||
        typeof consumer.functionName !== 'string' ||
        !consumer.functionName ||
        typeof consumer.argument !== 'string' ||
        !consumer.argument ||
        !Number.isInteger(consumer.occurrence) ||
        consumer.occurrence < 1 ||
        consumers.has(consumerIdentity(consumer))
      )
        throw new Error('addition consumers must be unique exact admitted source calls');
      consumers.add(consumerIdentity(consumer));
    }
  }
  const replacements = new Set();
  for (const replacement of request.replacements ?? []) {
    if (
      !exact(replacement, ['familyId', 'oldConsumer', 'newConsumer']) ||
      !FAMILY_ID.test(replacement.familyId ?? '') ||
      families.has(replacement.familyId) ||
      replacements.has(replacement.familyId)
    )
      throw new Error('replacements must name distinct existing families');
    replacements.add(replacement.familyId);
    for (const consumer of [replacement.oldConsumer, replacement.newConsumer]) {
      if (
        !exact(consumer, ['sourcePath', 'functionName', 'argument', 'occurrence']) ||
        !sourcePathIsValid(consumer.sourcePath) ||
        !paths.has(consumer.sourcePath) ||
        typeof consumer.functionName !== 'string' ||
        !consumer.functionName ||
        typeof consumer.argument !== 'string' ||
        !consumer.argument ||
        !Number.isInteger(consumer.occurrence) ||
        consumer.occurrence < 1 ||
        consumers.has(consumerIdentity(consumer))
      )
        throw new Error('replacement consumers must be unique exact admitted source calls');
      consumers.add(consumerIdentity(consumer));
    }
    if (consumerIdentity(replacement.oldConsumer) === consumerIdentity(replacement.newConsumer))
      throw new Error('replacement consumer identity must change');
  }
  const obsolete = new Set();
  for (const item of request.obsolete) {
    const keys =
      item?.kind === 'dynamicConsumer'
        ? ['kind', 'sourcePath', 'functionName', 'familyId', 'argument', 'occurrence']
        : ['kind', 'sourcePath', 'functionName', 'bindingName'];
    if (
      !exact(item, keys) ||
      !KINDS.has(item.kind) ||
      !sourcePathIsValid(item.sourcePath) ||
      typeof item.functionName !== 'string' ||
      !item.functionName ||
      (item.kind === 'dynamicConsumer'
        ? !FAMILY_ID.test(item.familyId) ||
          typeof item.argument !== 'string' ||
          !item.argument ||
          !Number.isInteger(item.occurrence) ||
          item.occurrence < 1
        : typeof item.bindingName !== 'string' || !item.bindingName) ||
      obsolete.has(signature(item))
    )
      throw new Error('obsolete entries must be duplicate-free exact consumer identities');
    obsolete.add(signature(item));
  }
}
function allEntries(corpus) {
  const grammar = corpus.consumerGrammar;
  return [
    ...grammar.translatorWrappers.map((entry) => ({ ...entry, kind: 'translatorWrapper' })),
    ...grammar.translatorForwarders.map((entry) => ({ ...entry, kind: 'translatorForwarder' })),
    ...grammar.translatorDependencies.map((entry) => ({ ...entry, kind: 'translatorDependency' })),
    ...grammar.dynamicKeyFamilies.flatMap((family) =>
      family.consumers.map((entry) => ({ ...entry, kind: 'dynamicConsumer', familyId: family.id })),
    ),
  ];
}
function removeExact(corpus, obsolete) {
  const wanted = new Set(obsolete.map(signature));
  const next = structuredClone(corpus);
  const filter = (kind, entries, familyId) =>
    entries.filter((entry) => !wanted.has(signature({ ...entry, kind, familyId })));
  next.consumerGrammar.translatorWrappers = filter(
    'translatorWrapper',
    next.consumerGrammar.translatorWrappers,
  );
  next.consumerGrammar.translatorForwarders = filter(
    'translatorForwarder',
    next.consumerGrammar.translatorForwarders,
  );
  next.consumerGrammar.translatorDependencies = filter(
    'translatorDependency',
    next.consumerGrammar.translatorDependencies,
  );
  next.consumerGrammar.dynamicKeyFamilies = next.consumerGrammar.dynamicKeyFamilies.map(
    (family) => ({ ...family, consumers: filter('dynamicConsumer', family.consumers, family.id) }),
  );
  return next;
}
function addFamilies(corpus, additions, sourceTexts) {
  if (additions.length === 0) return corpus;
  const existingFamilies = new Set(
    corpus.consumerGrammar.dynamicKeyFamilies.map((family) => family.id),
  );
  const existingConsumers = new Set(
    corpus.consumerGrammar.dynamicKeyFamilies.flatMap((family) =>
      family.consumers.map(consumerIdentity),
    ),
  );
  const units = new Map(corpus.units.map((unit) => [unit.id, unit]));
  for (const addition of additions) {
    if (existingFamilies.has(addition.familyId))
      throw new Error(`addition family already exists: ${addition.familyId}`);
    for (const unitId of addition.unitIds) {
      const unit = units.get(unitId);
      if (!unit || unit.unitLifecycle !== 'active')
        throw new Error(`addition unit is absent or inactive: ${unitId}`);
    }
    for (const consumer of addition.consumers) {
      if (existingConsumers.has(consumerIdentity(consumer)))
        throw new Error(`addition consumer already exists: ${consumerIdentity(consumer)}`);
    }
  }
  return {
    ...corpus,
    consumerGrammar: {
      ...corpus.consumerGrammar,
      dynamicKeyFamilies: [
        ...corpus.consumerGrammar.dynamicKeyFamilies,
        ...additions.map((addition) => ({
          id: addition.familyId,
          unitIds: addition.unitIds,
          consumers: addition.consumers.map((consumer) => ({
            ...consumer,
            sourceFingerprint: consumerSourceFingerprint(
              consumer.sourcePath,
              sourceTexts.get(consumer.sourcePath),
            ),
          })),
        })),
      ],
    },
  };
}
function assertExactReplacementFamilies(corpus, replacements) {
  const existingConsumers = new Set(
    corpus.consumerGrammar.dynamicKeyFamilies.flatMap((family) =>
      family.consumers.map(consumerIdentity),
    ),
  );
  for (const replacement of replacements) {
    const family = corpus.consumerGrammar.dynamicKeyFamilies.find(
      (candidate) => candidate.id === replacement.familyId,
    );
    if (!family) throw new Error(`replacement family is absent: ${replacement.familyId}`);
    if (
      family.consumers.filter(
        (consumer) => consumerIdentity(consumer) === consumerIdentity(replacement.oldConsumer),
      ).length !== 1
    )
      throw new Error(`replacement old consumer is not exact: ${replacement.familyId}`);
    if (existingConsumers.has(consumerIdentity(replacement.newConsumer)))
      throw new Error(
        `replacement new consumer already exists: ${consumerIdentity(replacement.newConsumer)}`,
      );
    existingConsumers.delete(consumerIdentity(replacement.oldConsumer));
    existingConsumers.add(consumerIdentity(replacement.newConsumer));
  }
}
function replaceExistingFamilies(corpus, replacements, sourceTexts) {
  if (replacements.length === 0) return corpus;
  assertExactReplacementFamilies(corpus, replacements);
  const next = structuredClone(corpus);
  for (const replacement of replacements) {
    const family = next.consumerGrammar.dynamicKeyFamilies.find(
      (candidate) => candidate.id === replacement.familyId,
    );
    if (!family) throw new Error(`replacement family was lost: ${replacement.familyId}`);
    const index = family.consumers.findIndex(
      (consumer) => consumerIdentity(consumer) === consumerIdentity(replacement.oldConsumer),
    );
    if (index === -1) throw new Error(`replacement old consumer was lost: ${replacement.familyId}`);
    family.consumers[index] = {
      ...replacement.newConsumer,
      sourceFingerprint: consumerSourceFingerprint(
        replacement.newConsumer.sourcePath,
        sourceTexts.get(replacement.newConsumer.sourcePath),
      ),
    };
  }
  return next;
}
function sourceFile(sourceRoot, sourcePath) {
  const path = resolve(sourceRoot, sourcePath);
  if (relative(sourceRoot, path).replaceAll('\\', '/') !== sourcePath)
    throw new Error('sourcePath must stay under sourceRoot');
  return path;
}
function appliedSourceRecord(sourcePath, sourceFingerprint, entryCount) {
  return { sourcePath, sourceFingerprint, entryCount };
}

function reconciliationRecord(request, rebinds, corpus) {
  return {
    request: structuredClone(request),
    requestDigest: consumerReconciliationRequestDigest(request),
    sources: request.sources.map((requestSource) => {
      const rebind = rebinds.get(requestSource.sourcePath);
      if (!rebind)
        throw new Error(`consumer reconciliation lost source: ${requestSource.sourcePath}`);
      const entryCount = allEntries(corpus).filter(
        (entry) => entry.sourcePath === requestSource.sourcePath,
      ).length;
      return appliedSourceRecord(requestSource.sourcePath, rebind.sourceFingerprint, entryCount);
    }),
  };
}

function hasExactAppliedReplay(corpus, request) {
  const requestDigest = consumerReconciliationRequestDigest(request);
  const records = corpus.consumerGrammar.reconciliations ?? [];
  const record = records.find((entry) => entry.requestDigest === requestDigest);
  if (!record) return false;
  const entries = allEntries(corpus);
  return record.sources.every((source) => {
    const matchingEntries = entries.filter((entry) => entry.sourcePath === source.sourcePath);
    return (
      matchingEntries.length === source.entryCount &&
      matchingEntries.every((entry) => entry.sourceFingerprint === source.sourceFingerprint)
    );
  });
}
function replacementsAreApplied(corpus, replacements) {
  return replacements.every((replacement) => {
    const family = corpus.consumerGrammar.dynamicKeyFamilies.find(
      (candidate) => candidate.id === replacement.familyId,
    );
    return (
      family &&
      family.consumers.filter(
        (consumer) => consumerIdentity(consumer) === consumerIdentity(replacement.oldConsumer),
      ).length === 0 &&
      family.consumers.filter(
        (consumer) => consumerIdentity(consumer) === consumerIdentity(replacement.newConsumer),
      ).length === 1
    );
  });
}
export async function reconcileConsumerGrammar({
  registryPath,
  outputPath,
  request,
  sourceRoot = resolve('src'),
  fileSystem,
}) {
  validateRequest(request);
  await assertDistinctFileTargets({ registryPath, outputPath, fileSystem });
  const source = await readFile(registryPath, 'utf8');
  const corpus = JSON.parse(source);
  const violations = validateCorpus(corpus);
  if (violations.length)
    throw new Error(`current corpus validation failed:\n${violations.join('\n')}`);
  const currentOutput = await readFile(outputPath, 'utf8');
  const existing = new Set(allEntries(corpus).map(signature));
  const replacements = request.replacements ?? [];
  if (
    request.obsolete.every((item) => !existing.has(signature(item))) &&
    replacementsAreApplied(corpus, replacements) &&
    hasExactAppliedReplay(corpus, request)
  ) {
    const replayGraph = await retiredConsumerViolations(corpus, sourceRoot);
    if (replayGraph.length)
      throw new Error(`next source graph validation failed:\n${replayGraph.join('\n')}`);
    if (currentOutput !== serializeGeneratedResources(corpus))
      throw new Error('consumer reconciliation generated output is out of date');
    return { reconciled: false, removedCount: 0, updatedEntries: 0 };
  }
  assertExactReplacementFamilies(corpus, replacements);
  const additions = request.additions ?? [];
  const sourceTexts = new Map(
    await Promise.all(
      request.sources.map(async (requestSource) => [
        requestSource.sourcePath,
        await readFile(sourceFile(sourceRoot, requestSource.sourcePath), 'utf8'),
      ]),
    ),
  );
  const before = allEntries(corpus);
  const additionSourcePaths = new Set(
    additions.flatMap((addition) => addition.consumers.map((consumer) => consumer.sourcePath)),
  );
  const replacementSourcePaths = new Set(
    replacements.flatMap((replacement) => [
      replacement.oldConsumer.sourcePath,
      replacement.newConsumer.sourcePath,
    ]),
  );
  for (const requestSource of request.sources) {
    const entries = before.filter((entry) => entry.sourcePath === requestSource.sourcePath);
    if (
      !entries.length &&
      !additionSourcePaths.has(requestSource.sourcePath) &&
      !replacementSourcePaths.has(requestSource.sourcePath)
    )
      throw new Error(`stale expected source fingerprint: ${requestSource.sourcePath}`);
    if (additions.length > 0 || replacements.length > 0) {
      if (
        consumerSourceFingerprint(
          requestSource.sourcePath,
          sourceTexts.get(requestSource.sourcePath),
        ) !== requestSource.expectedSourceFingerprint
      )
        throw new Error(`stale current source fingerprint: ${requestSource.sourcePath}`);
    } else if (
      entries.some((entry) => entry.sourceFingerprint !== requestSource.expectedSourceFingerprint)
    ) {
      throw new Error(`stale expected source fingerprint: ${requestSource.sourcePath}`);
    }
  }
  for (const obsolete of request.obsolete)
    if (before.filter((entry) => signature(entry) === signature(obsolete)).length !== 1)
      throw new Error(`obsolete identity is not exact: ${signature(obsolete)}`);
  let next = addFamilies(corpus, additions, sourceTexts);
  let updatedEntries = 0;
  const rebinds = new Map();
  for (const requestSource of request.sources) {
    const entries = allEntries(next).filter(
      (entry) => entry.sourcePath === requestSource.sourcePath,
    );
    if (!entries.length) {
      rebinds.set(requestSource.sourcePath, {
        sourceFingerprint: consumerSourceFingerprint(
          requestSource.sourcePath,
          sourceTexts.get(requestSource.sourcePath),
        ),
      });
      continue;
    }
    const rebind = rebindConsumerSource(next, {
      sourcePath: requestSource.sourcePath,
      source: sourceTexts.get(requestSource.sourcePath),
    });
    next = rebind.corpus;
    rebinds.set(requestSource.sourcePath, rebind);
    if (rebind.rebound) updatedEntries += rebind.updatedEntries;
  }
  next = replaceExistingFamilies(next, replacements, sourceTexts);
  next = removeExact(next, request.obsolete);
  next = {
    ...next,
    consumerGrammar: {
      ...next.consumerGrammar,
      reconciliations: [
        ...(next.consumerGrammar.reconciliations ?? []),
        reconciliationRecord(request, rebinds, next),
      ],
    },
  };
  const nextViolations = validateCorpus(next);
  if (nextViolations.length)
    throw new Error(`next corpus validation failed:\n${nextViolations.join('\n')}`);
  const nextGraph = await retiredConsumerViolations(next, sourceRoot);
  if (nextGraph.length)
    throw new Error(`next source graph validation failed:\n${nextGraph.join('\n')}`);
  if (JSON.stringify(allEntries(corpus)) === JSON.stringify(allEntries(next))) {
    if ((await readFile(outputPath, 'utf8')) !== serializeGeneratedResources(corpus))
      throw new Error('consumer reconciliation generated output is out of date');
    return { reconciled: false, removedCount: 0, updatedEntries: 0 };
  }
  // Validate the complete successor before replacing either coupled output.
  // commitReviewTransaction keeps the registry and generated resources in the same revision.
  await commitReviewTransaction({
    registryPath,
    outputPath,
    registryContent: serializeConsumerGrammarRegistry({ source, corpus, next }),
    generatedContent: serializeGeneratedResources(next),
    fileSystem,
  });
  return { reconciled: true, removedCount: request.obsolete.length, updatedEntries };
}
