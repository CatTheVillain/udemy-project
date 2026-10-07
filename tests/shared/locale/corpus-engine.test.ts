import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import i18next from 'i18next';
import { describe, expect, expectTypeOf, it } from 'vitest';

import type {
  LocalizationPluralForms,
  LocalizationCorpus,
  LocaleCandidate,
  LocaleCandidateHistoryEvent,
  LocaleApprovedTransitionHistoryEvent,
  LocaleReviewRequestedToChangesRequestedTransitionHistoryEvent,
  LocaleReviewRequestedToDraftWithdrawalTransitionHistoryEvent,
  LocaleReviewRequestedToSuppliedArtifactApprovedTransitionHistoryEvent,
  LocaleReviewedTransitionHistoryEvent,
  LocalizationUnit,
  UnitMigrationProvenance,
  SuppliedReviewArtifactApprovedLocaleCandidate,
} from '../../../src/shared/locale/corpus-types';

import draft37Registry from '../../../localization/corpus/registry.json';

const CURRENT_CORPUS_UNIT_COUNT = 585;
const CURRENT_CORPUS_OCCURRENCE_COUNT = 808;

const {
  SUPPLIED_REVIEW_ARTIFACT,
  consumerReconciliationRequestDigest,
  protectedSourceFingerprint,
  semanticIdentityDigest,
  applyProtectedSourceRevision,
  generateResources,
  retiredConsumerViolations,
  reviseProtectedSource,
  checkCorpus,
  requestLocaleCandidateReview,
  syncCorpus,
  transitionLocaleCandidate: engineTransitionLocaleCandidate,
  validateCorpus,
  withdrawLocaleCandidateReview,
  // @ts-expect-error The dependency-free Node engine intentionally has no TypeScript declaration.
} = await import('../../../scripts/localization/corpus-engine.mjs');

function reviewRequestFixture() {
  return {
    taskId: 'FE-067',
    locales: ['ru'],
    unitIds: ['MLUX-C0001'],
    requestedAt: '2026-08-23T00:00:00.000Z',
  };
}

function transitionLocaleCandidate(
  candidate: Record<string, unknown>,
  nextStatus: string,
  options = {},
) {
  if (
    candidate.status === 'draft' &&
    nextStatus === 'review_requested' &&
    Object.keys(options).length === 0
  )
    return requestLocaleCandidateReview(candidate, reviewRequestFixture());
  return engineTransitionLocaleCandidate(candidate, nextStatus, options);
}

type FixtureCandidate = Record<string, unknown> & {
  candidate: string;
  status: string;
  sourceRevision: string;
  history: unknown[];
};
type MutableFixtureLocales = Record<'ru' | 'uz', FixtureCandidate>;
type MutableHistoryEvent = Record<string, unknown>;

interface HistoryOuterShapeAdversary {
  readonly name: string;
  readonly candidate: () => FixtureCandidate;
  readonly event: (candidate: FixtureCandidate) => MutableHistoryEvent;
  readonly forgedKey: string;
  readonly forgedValue: unknown;
  readonly expectedViolation?: string;
}

interface ApprovalRecordShapeAdversary {
  readonly name: string;
  readonly candidate: () => FixtureCandidate;
  readonly approvalProperty: 'humanApproval' | 'suppliedArtifactApproval';
  readonly mutate: (approval: MutableHistoryEvent) => void;
  readonly expectedViolation: string;
}

type ProtectedRevisionStatus = 'draft' | 'review_requested' | 'changes_requested' | 'stale';

interface MutableChangeRequestHistoryEvent {
  readonly type?: unknown;
  readonly from?: unknown;
  readonly to?: unknown;
  readonly changeRequest?: { replacement: string };
}

interface ReviewVerdictOperationCase {
  readonly name: string;
  readonly run: (candidate: FixtureCandidate) => unknown;
}

interface StaleToDraftHistoryFixture {
  readonly corpus: ReturnType<typeof fixture>;
  readonly activeRevisionAtReactivation: string;
  readonly currentRevision: string;
}

interface CandidateOuterShapeAdversary {
  readonly name: string;
  readonly forgedKey: string;
  readonly forgedValue: unknown;
}

interface CandidateTransitionOperation {
  readonly name: string;
  readonly candidate: () => FixtureCandidate;
  readonly run: (candidate: FixtureCandidate) => unknown;
}

interface ValidCandidateShapeControl {
  readonly name: string;
  readonly candidate: () => FixtureCandidate;
}

function requestChanges(candidate: FixtureCandidate) {
  const requestedAt =
    typeof candidate.requestedAt === 'string' ? candidate.requestedAt : '2026-08-23T00:00:00.000Z';
  return transitionLocaleCandidate({ ...candidate, requestedAt }, 'changes_requested', {
    changeRequest: {
      replacement: 'Исправленный перевод, {{name}}',
      reviewerId: 'native-7',
      reviewerName: 'Native Reviewer',
      reviewerAttestation: 'native-review',
      requestedAt,
      reviewedAt: '2026-08-23T00:01:00.000Z',
      changeRequestedAt: '2026-08-23T00:02:00.000Z',
    },
  });
}

function retainedChangeRequest(candidate: FixtureCandidate) {
  const event = (candidate.history as MutableChangeRequestHistoryEvent[]).find(
    (entry) =>
      entry.type === 'transition' &&
      entry.from === 'review_requested' &&
      entry.to === 'changes_requested',
  );
  if (!event?.changeRequest) throw new Error('fixture retained change request is missing');
  return event.changeRequest;
}

function withFabricatedApprovalMetadata(candidate: FixtureCandidate): FixtureCandidate {
  return {
    ...candidate,
    reviewerId: 'fabricated-reviewer',
    reviewerName: 'Fabricated Reviewer',
    verdict: 'approved',
    reviewedAt: '2026-08-23T00:01:00.000Z',
    approvalRecordedAt: '2026-08-23T00:02:00.000Z',
    approvalAuthority: {
      kind: 'human_native_review',
      reviewerId: 'fabricated-reviewer',
      reviewerName: 'Fabricated Reviewer',
    },
  };
}

function reviewRequestedFixtureCandidate(): FixtureCandidate {
  return {
    ...transitionLocaleCandidate(fixture().units[0].locales.ru, 'review_requested'),
    requestedAt: '2026-08-23T00:00:00.000Z',
  } as FixtureCandidate;
}

function humanApprovedFixtureCandidate(): FixtureCandidate {
  return transitionLocaleCandidate(reviewRequestedFixtureCandidate(), 'approved', {
    humanApproval: {
      reviewerId: 'native-7',
      reviewerName: 'Native Reviewer',
      reviewedAt: '2026-08-23T00:01:00.000Z',
      approvalRecordedAt: '2026-08-23T00:02:00.000Z',
      approvalAuthority: {
        kind: 'human_native_review',
        reviewerId: 'native-7',
        reviewerName: 'Native Reviewer',
      },
    },
  }) as FixtureCandidate;
}

function mutableHistoryEvent(candidate: FixtureCandidate, index = -1): MutableHistoryEvent {
  const resolvedIndex = index < 0 ? candidate.history.length + index : index;
  const event = candidate.history[resolvedIndex];
  if (!event || typeof event !== 'object') throw new Error('fixture history event is missing');
  return event as MutableHistoryEvent;
}

function forgedHumanApprovalRecord(): MutableHistoryEvent {
  return {
    reviewerId: 'forged-reviewer',
    reviewerName: 'Forged Reviewer',
    reviewedAt: '2026-08-23T00:01:00.000Z',
    approvalRecordedAt: '2026-08-23T00:02:00.000Z',
    approvalAuthority: {
      kind: 'human_native_review',
      reviewerId: 'forged-reviewer',
      reviewerName: 'Forged Reviewer',
    },
  };
}

function protectedRevisionFixtureCandidate(status: ProtectedRevisionStatus): FixtureCandidate {
  if (status === 'draft') return structuredClone(fixture().units[0].locales.ru) as FixtureCandidate;
  if (status === 'review_requested') return reviewRequestedFixtureCandidate();
  if (status === 'changes_requested') return requestChanges(reviewRequestedFixtureCandidate());
  return transitionLocaleCandidate(humanApprovedFixtureCandidate(), 'stale') as FixtureCandidate;
}

function staleToDraftHistoryFixture(): StaleToDraftHistoryFixture {
  const corpus = fixture();
  const unit = corpus.units[0];
  const locales = unit.locales as unknown as MutableFixtureLocales;
  locales.ru = transitionLocaleCandidate(unit.locales.ru, 'review_requested') as FixtureCandidate;
  const firstRevision = reviseProtectedSource(unit, {
    occurrences: [{ ...unit.occurrences[0], context: 'first protected revision' }],
  });
  const activeRevisionAtReactivation = firstRevision.sourceRevision;
  firstRevision.locales.ru = transitionLocaleCandidate(firstRevision.locales.ru, 'draft', {
    newCandidate: 'Исправленная локализация, {{name}}',
  }) as FixtureCandidate;
  const current = reviseProtectedSource(firstRevision, {
    occurrences: [{ ...firstRevision.occurrences[0], context: 'later protected revision' }],
  });
  corpus.units[0] = current;
  return {
    corpus,
    activeRevisionAtReactivation,
    currentRevision: current.sourceRevision,
  };
}

function staleToDraftHistoryEvent(candidate: FixtureCandidate): MutableHistoryEvent {
  const event = (candidate.history as MutableHistoryEvent[]).find(
    (entry) => entry.from === 'stale' && entry.to === 'draft',
  );
  if (!event) throw new Error('fixture stale-to-draft event is missing');
  return event;
}

const REVIEW_VERDICT_OPERATIONS: readonly ReviewVerdictOperationCase[] = [
  {
    name: 'approve',
    run: (candidate) =>
      transitionLocaleCandidate(candidate, 'approved', {
        humanApproval: {
          reviewerId: 'native-7',
          reviewerName: 'Native Reviewer',
          reviewedAt: '2026-08-23T00:03:00.000Z',
          approvalRecordedAt: '2026-08-23T00:04:00.000Z',
          approvalAuthority: {
            kind: 'human_native_review',
            reviewerId: 'native-7',
            reviewerName: 'Native Reviewer',
          },
        },
      }),
  },
  { name: 'request changes', run: requestChanges },
  { name: 'withdraw', run: withdrawLocaleCandidateReview },
];

interface FixtureSourceRevisionEvent {
  type: 'source_revision';
  previousSourceRevision: string;
  sourceRevision: string;
}

type FixturePluralUnit = {
  pluralForms: Record<string, Record<string, string>> | null;
  sourceRevision: string;
  locales: Record<'ru' | 'uz', { sourceRevision: string }>;
};

type FixtureProtectedUnit = FixturePluralUnit & {
  locales: Record<'ru' | 'uz', FixtureCandidate>;
};

interface FixtureTranslatorWrapper {
  readonly sourcePath: string;
  readonly functionName: string;
  readonly bindingName: string;
  readonly sourceFingerprint: string;
}

interface FixtureTranslatorDependency {
  readonly sourcePath: string;
  readonly functionName: string;
  readonly bindingName: string;
  readonly hookName: 'useCallback' | 'useEffect' | 'useLayoutEffect' | 'useMemo';
  readonly sourceFingerprint: string;
}

interface FixtureDynamicConsumer {
  readonly sourcePath: string;
  readonly functionName: string;
  readonly argument: string;
  readonly occurrence: number;
  readonly sourceFingerprint: string;
}

interface FixtureDynamicKeyFamily {
  readonly id: string;
  readonly unitIds: readonly string[];
  readonly consumers: readonly FixtureDynamicConsumer[];
}

interface FixtureConsumerGrammar {
  readonly version: 1;
  readonly translatorWrappers: readonly FixtureTranslatorWrapper[];
  readonly translatorForwarders: readonly FixtureTranslatorWrapper[];
  readonly translatorDependencies: readonly FixtureTranslatorDependency[];
  readonly dynamicKeyFamilies: readonly FixtureDynamicKeyFamily[];
}

type FixtureCorpusWithConsumerGrammar = Omit<ReturnType<typeof fixture>, 'consumerGrammar'> & {
  consumerGrammar: FixtureConsumerGrammar;
};

function fixtureConsumerSourceFingerprint(sourcePath: string, source: string): string {
  return `sha256:${createHash('sha256')
    .update(
      JSON.stringify({
        source: source.replace(/\r\n?/g, '\n'),
        sourcePath,
        version: 'localization-consumer-source-v1',
      }),
    )
    .digest('hex')}`;
}

function additionRequest() {
  return {
    taskId: 'FE-072',
    sources: [
      {
        sourcePath: 'pages/instructor-course-editor-page/CourseLessonsSection.tsx',
        expectedSourceFingerprint: `sha256:${'1'.repeat(64)}`,
      },
      {
        sourcePath: 'pages/instructor-lesson-editor-page/InstructorLessonEditorPage.tsx',
        expectedSourceFingerprint: `sha256:${'2'.repeat(64)}`,
      },
    ],
    obsolete: [],
    additions: [
      {
        familyId: 'lesson-upload-descriptions',
        unitIds: ['MLUX-C0259', 'MLUX-C0260'],
        consumers: [
          {
            sourcePath: 'pages/instructor-course-editor-page/CourseLessonsSection.tsx',
            functionName: 'CourseLessonsSection',
            argument: 'uploadRule.descriptionKey',
            occurrence: 1,
          },
          {
            sourcePath: 'pages/instructor-lesson-editor-page/InstructorLessonEditorPage.tsx',
            functionName: 'InstructorLessonEditorPage',
            argument: 'rule.descriptionKey',
            occurrence: 1,
          },
        ],
      },
    ],
  };
}

function fixture() {
  const unit = {
    id: 'MLUX-C0001',
    namespace: 'common',
    key: 'welcome',
    english: 'Welcome {{name}}',
    sourceRevision: '',
    unitLifecycle: 'active',
    occurrences: [{ id: 'MLUX-O0001', context: 'fixture owner' }],
    placeholdersByLocale: { en: ['name'], ru: ['name'], uz: ['name'] },
    renderingContract: { mode: 'i18next' },
    pluralForms: null,
    locales: {
      ru: {
        candidate: 'Добро пожаловать, {{name}}',
        status: 'draft',
        sourceRevision: '',
        reviewerId: null,
        verdict: null,
        requestedAt: null,
        reviewedAt: null,
        approvalRecordedAt: null,
        approvalAuthority: null,
        history: [],
      },
      uz: {
        candidate: 'Xush kelibsiz, {{name}}',
        status: 'draft',
        sourceRevision: '',
        reviewerId: null,
        verdict: null,
        requestedAt: null,
        reviewedAt: null,
        approvalRecordedAt: null,
        approvalAuthority: null,
        history: [],
      },
    },
    migrationProvenance: {
      legacyResourceStatus: 'Draft',
      legacyReviewStatus: 'Pending',
      ownerTasks: ['MLUX-002'],
    },
  };
  const revision = protectedSourceFingerprint(unit);
  unit.sourceRevision = revision;
  unit.locales.ru.sourceRevision = revision;
  unit.locales.uz.sourceRevision = revision;
  const corpus = {
    formatVersion: 1,
    corpusVersion: 'MLUX-001-DRAFT-37',
    source: { sha256: 'C9E208FC5F1AEF55E709290C67270B79E1CBCE4831E7FBCB20555AB5CF8A73AE' },
    consumerGrammar: {
      version: 1 as const,
      translatorWrappers: [],
      translatorForwarders: [],
      translatorDependencies: [],
      dynamicKeyFamilies: [],
    },
    baselineResources: { en: {}, ru: {}, uz: {} },
    exclusions: [],
    summary: { translationUnits: 1, sourceOccurrences: 1, mergedDuplicateRows: 0 },
    migration: {
      sourceVersion: 'MLUX-001-DRAFT-37',
      sourceSha256: 'C9E208FC5F1AEF55E709290C67270B79E1CBCE4831E7FBCB20555AB5CF8A73AE',
      semanticIdentityVersion: 'unit-semantic-identity-v1',
      semanticIdentitySha256: '',
      sourceOccurrences: 1,
      importedAt: null,
    },
    units: [unit],
  };
  corpus.migration.semanticIdentitySha256 = semanticIdentityDigest(corpus.units);
  return corpus;
}

const NON_CANONICAL_FIXTURE_VIOLATIONS = new Set([
  'DRAFT-37 exclusion identity mismatch',
  'DRAFT-37 identity/count mismatch',
  'DRAFT-37 semantic identity mismatch',
  'MLUX-C0001: baseline semantic identity mismatch',
  'unsupported corpus version',
  'unsupported migration source version',
]);

function validateFixtureCorpus(corpus: unknown) {
  return (validateCorpus(corpus) as string[]).filter(
    (violation) => !NON_CANONICAL_FIXTURE_VIOLATIONS.has(violation),
  );
}

function pluralFixture() {
  const corpus = fixture();
  const unit = corpus.units[0] as unknown as FixtureProtectedUnit;
  unit.pluralForms = Object.fromEntries(
    ['en', 'ru', 'uz'].map((locale) => [
      locale,
      Object.fromEntries(
        new Intl.PluralRules(locale)
          .resolvedOptions()
          .pluralCategories.map((category) => [category, `${locale} ${category} {{name}}`]),
      ),
    ]),
  );
  unit.sourceRevision = protectedSourceFingerprint(unit);
  unit.locales.ru.sourceRevision = unit.sourceRevision;
  unit.locales.uz.sourceRevision = unit.sourceRevision;
  return { corpus, unit };
}

function fixtureSourceRevisionEvents(candidate: FixtureCandidate) {
  return candidate.history.filter(
    (event): event is FixtureSourceRevisionEvent =>
      typeof event === 'object' &&
      event !== null &&
      'type' in event &&
      event.type === 'source_revision',
  );
}

function restoredFixture(multiRevision = false) {
  const corpus = fixture();
  const prior = corpus.units[0];
  const approved = transitionLocaleCandidate(
    transitionLocaleCandidate(prior.locales.ru, 'review_requested'),
    'approved',
    {
      humanApproval: {
        reviewerId: 'native-7',
        reviewerName: 'Native Reviewer',
        reviewedAt: '2026-08-23T00:00:00.000Z',
        approvalRecordedAt: '2026-08-23T00:01:00.000Z',
        approvalAuthority: {
          kind: 'human_native_review',
          reviewerId: 'native-7',
          reviewerName: 'Native Reviewer',
        },
      },
    },
  );
  let revised = reviseProtectedSource(
    { ...prior, locales: { ...prior.locales, ru: approved } },
    { english: 'Welcome back {{name}}' },
  );
  if (multiRevision)
    revised = reviseProtectedSource(revised, {
      occurrences: [{ id: 'MLUX-O0001', context: 'restored fixture owner' }],
    });
  corpus.units[0] = {
    ...revised,
    retirementHistory: [{ reason: 'retired', sourceRevision: prior.sourceRevision }],
    locales: {
      ru: transitionLocaleCandidate(revised.locales.ru, 'draft', {
        newCandidate: 'Добро пожаловать снова, {{name}}',
      }),
      uz: revised.locales.uz,
    },
  };
  return { corpus, retiredSourceRevision: prior.sourceRevision };
}

describe('canonical localization corpus engine', () => {
  it('binds replacement reconciliation digests to one closed, ordered request shape', () => {
    const request = {
      taskId: 'FE-073',
      sources: [
        {
          sourcePath: 'app/layouts/AppShell.tsx',
          expectedSourceFingerprint: `sha256:${'1'.repeat(64)}`,
        },
        {
          sourcePath: 'app/layouts/NavigationLinks.tsx',
          expectedSourceFingerprint: `sha256:${'2'.repeat(64)}`,
        },
      ],
      replacements: [
        {
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
        },
      ],
      obsolete: [],
    };
    const orderedDigest = consumerReconciliationRequestDigest(request);
    expect(orderedDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(consumerReconciliationRequestDigest(structuredClone(request))).toBe(orderedDigest);
    expect(
      consumerReconciliationRequestDigest({ ...request, sources: [...request.sources].reverse() }),
    ).not.toBe(orderedDigest);

    const malformed = structuredClone(request);
    delete (malformed.replacements[0].newConsumer as { occurrence?: number }).occurrence;
    expect(() => consumerReconciliationRequestDigest(malformed)).toThrow(
      'consumer reconciliation request is invalid',
    );
    const duplicate = structuredClone(request);
    duplicate.replacements.push(structuredClone(duplicate.replacements[0]));
    expect(() => consumerReconciliationRequestDigest(duplicate)).toThrow(
      'consumer reconciliation request is invalid',
    );
  });

  it('keeps the exported corpus contract aligned with required runtime shapes', () => {
    const pluralForms: LocalizationPluralForms = {
      en: { one: 'one', other: 'other' },
      ru: { one: 'one', few: 'few', many: 'many', other: 'other' },
      uz: { one: 'one', other: 'other' },
    };
    const reviewedTransition: LocaleReviewedTransitionHistoryEvent = {
      type: 'transition',
      from: 'draft',
      to: 'review_requested',
      previousCandidate: 'draft',
      nextCandidate: 'draft',
      sourceRevision: 'sha256:reviewed',
    };
    expectTypeOf(pluralForms.ru).toMatchTypeOf<LocalizationPluralForms['ru']>();
    expectTypeOf(reviewedTransition).toMatchTypeOf<LocaleCandidateHistoryEvent>();
    const changeRequestedTransition: LocaleReviewRequestedToChangesRequestedTransitionHistoryEvent =
      {
        type: 'transition',
        from: 'review_requested',
        to: 'changes_requested',
        previousCandidate: 'review requested',
        nextCandidate: 'review requested',
        sourceRevision: 'sha256:changes-requested',
        changeRequest: {
          replacement: 'Исправленный перевод',
          reviewerId: 'native-7',
          reviewerName: 'Native Reviewer',
          reviewerAttestation: 'native-review',
          requestedAt: '2026-08-23T00:00:00.000Z',
          reviewedAt: '2026-08-23T00:01:00.000Z',
          changeRequestedAt: '2026-08-23T00:02:00.000Z',
        },
      };
    const withdrawalTransition: LocaleReviewRequestedToDraftWithdrawalTransitionHistoryEvent = {
      type: 'transition',
      from: 'review_requested',
      to: 'draft',
      previousCandidate: 'review requested',
      nextCandidate: 'review requested',
      sourceRevision: 'sha256:withdrawn',
      withdrawal: true,
    };
    expectTypeOf(changeRequestedTransition).toMatchTypeOf<LocaleCandidateHistoryEvent>();
    expectTypeOf(withdrawalTransition).toMatchTypeOf<LocaleCandidateHistoryEvent>();
    const approvedTransition: LocaleApprovedTransitionHistoryEvent = {
      type: 'transition',
      from: 'review_requested',
      to: 'approved',
      previousCandidate: 'review requested',
      nextCandidate: 'review requested',
      sourceRevision: 'sha256:approved',
      humanApproval: {
        reviewerId: 'native-7',
        reviewerName: 'Native Reviewer',
        reviewedAt: '2026-08-23T00:00:00.000Z',
        approvalRecordedAt: '2026-08-23T00:01:00.000Z',
        approvalAuthority: {
          kind: 'human_native_review',
          reviewerId: 'native-7',
          reviewerName: 'Native Reviewer',
        },
      },
    };
    expectTypeOf(approvedTransition).toMatchTypeOf<LocaleCandidateHistoryEvent>();
    const suppliedArtifactApproval: LocaleReviewRequestedToSuppliedArtifactApprovedTransitionHistoryEvent =
      {
        type: 'transition',
        from: 'review_requested',
        to: 'approved',
        previousCandidate: 'draft',
        nextCandidate: 'approved draft',
        sourceRevision: 'sha256:supplied',
        suppliedArtifactApproval: {
          reviewerId: null,
          reviewedAt: null,
          approvalRecordedAt: '2026-08-25T00:00:00.000Z',
          approvalAuthority: {
            kind: 'user-authorized supplied review artifact',
            artifactName: 'learnhub-multilingual-review-readable.md',
            artifactSha256: 'ED5D3D613F21DE188DB0512B3701EA9C0C0A6D254FD1C77829FB3E61ECD3310C',
          },
        },
      };
    expectTypeOf(suppliedArtifactApproval).toMatchTypeOf<LocaleCandidateHistoryEvent>();
    expectTypeOf<
      SuppliedReviewArtifactApprovedLocaleCandidate['reviewerId']
    >().toEqualTypeOf<null>();
    const invalidApprovedTransition: LocaleApprovedTransitionHistoryEvent = {
      type: 'transition',
      // @ts-expect-error Runtime permits approval only from review_requested.
      from: 'draft',
      to: 'approved',
      previousCandidate: 'draft',
      nextCandidate: 'draft',
      sourceRevision: 'sha256:forbidden',
      humanApproval: approvedTransition.humanApproval,
    };
    expect(invalidApprovedTransition).toBeDefined();
    const invalidStaleReviewTransition: LocaleReviewedTransitionHistoryEvent = {
      type: 'transition',
      // @ts-expect-error Runtime does not permit stale -> review_requested.
      from: 'stale',
      to: 'review_requested',
      previousCandidate: 'stale',
      nextCandidate: 'stale',
      sourceRevision: 'sha256:forbidden',
    };
    expect(invalidStaleReviewTransition).toBeDefined();
    expectTypeOf<LocalizationUnit['pluralForms']>().toEqualTypeOf<LocalizationPluralForms | null>();
    expectTypeOf<LocalizationCorpus['corpusVersion']>().toEqualTypeOf<'MLUX-001-DRAFT-37'>();
    expectTypeOf<
      LocalizationUnit['migrationProvenance']
    >().toEqualTypeOf<UnitMigrationProvenance>();
    const legalDraft: LocaleCandidate = {
      candidate: 'Draft candidate',
      sourceRevision: 'sha256:draft',
      status: 'draft',
      history: [],
    };
    const legalCanonicalDraft: LocaleCandidate = {
      candidate: 'Canonical draft candidate',
      sourceRevision: 'sha256:canonical-draft',
      status: 'draft',
      reviewerId: null,
      verdict: null,
      reviewedAt: null,
      approvalRecordedAt: null,
      approvalAuthority: null,
      history: [],
    };
    const legalApproved: LocaleCandidate = {
      candidate: 'Approved candidate',
      sourceRevision: 'sha256:approved',
      status: 'approved',
      verdict: 'approved',
      reviewerId: 'native-7',
      reviewedAt: '2026-08-23T00:00:00.000Z',
      approvalRecordedAt: '2026-08-23T00:01:00.000Z',
      approvalAuthority: approvedTransition.humanApproval.approvalAuthority,
      history: [],
    };
    expect(legalDraft.status).toBe('draft');
    expect(legalCanonicalDraft.status).toBe('draft');
    expect(legalApproved.status).toBe('approved');
    const invalidDraftApproval: LocaleCandidate = {
      candidate: 'Invalid draft',
      sourceRevision: 'sha256:draft',
      status: 'draft',
      // @ts-expect-error A non-approved candidate cannot carry a verdict.
      verdict: 'approved',
      history: [],
    };
    // @ts-expect-error Review-requested candidates cannot carry approval authority.
    const invalidReviewRequestedApproval: LocaleCandidate = {
      candidate: 'Invalid review request',
      sourceRevision: 'sha256:review-requested',
      status: 'review_requested',
      approvalAuthority: approvedTransition.humanApproval.approvalAuthority,
      history: [],
    };
    // @ts-expect-error Changes-requested candidates cannot carry approval metadata.
    const invalidChangesRequestedApproval: LocaleCandidate = {
      candidate: 'Invalid requested changes',
      sourceRevision: 'sha256:changes-requested',
      status: 'changes_requested',
      reviewerId: 'native-7',
      history: [],
    };
    // @ts-expect-error Stale candidates cannot carry a non-null approval timestamp.
    const invalidStaleApproval: LocaleCandidate = {
      candidate: 'Invalid stale candidate',
      sourceRevision: 'sha256:stale',
      status: 'stale',
      approvalRecordedAt: '2026-08-23T00:01:00.000Z',
      history: [],
    };
    // @ts-expect-error An approved candidate requires complete named authority.
    const invalidApprovedAuthority: LocaleCandidate = {
      candidate: 'Invalid approved',
      sourceRevision: 'sha256:approved',
      status: 'approved',
      verdict: 'approved',
      reviewerId: undefined,
      reviewedAt: '2026-08-23T00:00:00.000Z',
      approvalRecordedAt: '2026-08-23T00:01:00.000Z',
      approvalAuthority: approvedTransition.humanApproval.approvalAuthority,
      history: [],
    };
    expect(invalidDraftApproval).toBeDefined();
    expect(invalidReviewRequestedApproval).toBeDefined();
    expect(invalidChangesRequestedApproval).toBeDefined();
    expect(invalidStaleApproval).toBeDefined();
    expect(invalidApprovedAuthority).toBeDefined();
    const legalMigration: UnitMigrationProvenance = {
      legacyResourceStatus: 'Draft',
      legacyReviewStatus: 'Pending',
      ownerTasks: ['MLUX-002', 'MLUX-006-FOLLOWUP'],
    };
    const invalidMigrationOwner: UnitMigrationProvenance = {
      legacyResourceStatus: 'Draft',
      legacyReviewStatus: 'Pending',
      // @ts-expect-error Migration owners are the closed verified task vocabulary.
      ownerTasks: ['Approved by native reviewer'],
    };
    expect(legalMigration.ownerTasks).toHaveLength(2);
    expect(invalidMigrationOwner).toBeDefined();
    const legalStaleToDraft: LocaleCandidateHistoryEvent = {
      type: 'transition',
      from: 'stale',
      to: 'draft',
      previousCandidate: 'stale candidate',
      nextCandidate: 'new draft candidate',
    };
    expect(legalStaleToDraft.to).toBe('draft');
    // @ts-expect-error Review-requested to stale requires the active source revision.
    const missingReviewStaleRevision: LocaleCandidateHistoryEvent = {
      type: 'transition',
      from: 'review_requested',
      to: 'stale',
      previousCandidate: 'candidate',
      nextCandidate: 'candidate',
    };
    // @ts-expect-error Changes-requested to draft requires the active source revision.
    const missingChangesDraftRevision: LocaleCandidateHistoryEvent = {
      type: 'transition',
      from: 'changes_requested',
      to: 'draft',
      previousCandidate: 'candidate',
      nextCandidate: 'new candidate',
    };
    // @ts-expect-error Changes-requested to stale requires the active source revision.
    const missingChangesStaleRevision: LocaleCandidateHistoryEvent = {
      type: 'transition',
      from: 'changes_requested',
      to: 'stale',
      previousCandidate: 'candidate',
      nextCandidate: 'candidate',
    };
    // @ts-expect-error Approved to stale requires the active source revision.
    const missingApprovedStaleRevision: LocaleCandidateHistoryEvent = {
      type: 'transition',
      from: 'approved',
      to: 'stale',
      previousCandidate: 'candidate',
      nextCandidate: 'candidate',
    };
    expect([
      missingReviewStaleRevision,
      missingChangesDraftRevision,
      missingChangesStaleRevision,
      missingApprovedStaleRevision,
    ]).toHaveLength(4);
  });

  it('accepts only exact, distinct FE-072 upload-help addition request identities', () => {
    const valid = additionRequest();
    expect(consumerReconciliationRequestDigest(valid)).toMatch(/^sha256:[a-f0-9]{64}$/);

    const invalidRequests = [
      { ...valid, unexpected: true },
      {
        ...valid,
        additions: [{ ...valid.additions[0], familyId: '', unitIds: [] }],
      },
      { ...valid, additions: [valid.additions[0], structuredClone(valid.additions[0])] },
      {
        ...valid,
        additions: [{ ...valid.additions[0], unitIds: ['MLUX-C0259', 'MLUX-C0259'] }],
      },
      {
        ...valid,
        additions: [
          {
            ...valid.additions[0],
            consumers: [valid.additions[0].consumers[0], valid.additions[0].consumers[0]],
          },
        ],
      },
      {
        ...valid,
        additions: [
          {
            ...valid.additions[0],
            consumers: [{ ...valid.additions[0].consumers[0], occurrence: 0 }],
          },
        ],
      },
      {
        ...valid,
        additions: [
          {
            ...valid.additions[0],
            consumers: [
              {
                ...valid.additions[0].consumers[0],
                sourcePath: 'pages/unadmitted/Consumer.tsx',
              },
            ],
          },
        ],
      },
    ];

    for (const request of invalidRequests)
      expect(() => consumerReconciliationRequestDigest(request)).toThrow(
        'consumer reconciliation request is invalid',
      );
  });

  it('pins validation and generation to the engine-owned DRAFT-37 corpus version', () => {
    expect(validateCorpus(draft37Registry)).toEqual([]);
    expect(() => generateResources(draft37Registry)).not.toThrow();

    const renamed = structuredClone(draft37Registry);
    (renamed as { corpusVersion: string }).corpusVersion = 'MLUX-001-DRAFT-38';
    (renamed.migration as { sourceVersion: string }).sourceVersion = 'MLUX-001-DRAFT-38';
    renamed.units[0].key = `${renamed.units[0].key}V38`;
    renamed.units[0].sourceRevision = protectedSourceFingerprint(renamed.units[0]);
    renamed.units[0].locales.ru.sourceRevision = renamed.units[0].sourceRevision;
    renamed.units[0].locales.uz.sourceRevision = renamed.units[0].sourceRevision;
    renamed.migration.semanticIdentitySha256 = semanticIdentityDigest(renamed.units);
    expect(validateCorpus(renamed)).toEqual(
      expect.arrayContaining([
        'unsupported corpus version',
        'unsupported migration source version',
      ]),
    );
    expect(() => generateResources(renamed)).toThrow('unsupported corpus version');

    const missing = structuredClone(draft37Registry) as {
      corpusVersion?: string;
      migration: { sourceVersion?: string };
    };
    delete missing.corpusVersion;
    delete missing.migration.sourceVersion;
    expect(validateCorpus(missing)).toEqual(
      expect.arrayContaining([
        'unsupported corpus version',
        'unsupported migration source version',
      ]),
    );
  });
  it('rejects an under-specified corpus before generation', () => {
    expect(
      validateCorpus({ formatVersion: 1, corpusVersion: 'x', source: { sha256: 'x' } }),
    ).toEqual(
      expect.arrayContaining([
        'invalid corpus source sha256',
        'missing baseline resources',
        'missing exclusions',
        'missing units',
        'invalid summary',
        'invalid migration provenance',
      ]),
    );
  });

  it('returns deterministic public check violations when units are missing or non-array', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fe066-malformed-units-check-'));
    const registryPath = join(directory, 'registry.json');
    const outputPath = join(directory, 'generated.ts');
    const expectedViolations = [
      'DRAFT-37 exclusion identity mismatch',
      'DRAFT-37 identity/count mismatch',
      'DRAFT-37 semantic identity mismatch',
      'invalid corpus source sha256',
      'invalid migration provenance',
      'invalid summary',
      'missing baseline en resources',
      'missing baseline resources',
      'missing baseline ru resources',
      'missing baseline uz resources',
      'missing exclusions',
      'missing units',
      'unsupported corpus version',
      'unsupported migration source version',
    ];

    for (const units of [undefined, {}]) {
      const corpus = { formatVersion: 1, corpusVersion: 'x', source: { sha256: 'x' }, units };
      await writeFile(registryPath, JSON.stringify(corpus), 'utf8');

      await expect(
        checkCorpus({ registryPath, outputPath, sourceRoot: directory }),
      ).resolves.toEqual(expectedViolations);
    }
  });

  it('rejects public sync without replacing output when units are missing or non-array', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fe066-malformed-units-sync-'));
    const registryPath = join(directory, 'registry.json');
    const outputPath = join(directory, 'generated.ts');
    const priorOutput = 'prior generated output\n';
    const expectedViolations = [
      'DRAFT-37 exclusion identity mismatch',
      'DRAFT-37 identity/count mismatch',
      'DRAFT-37 semantic identity mismatch',
      'invalid corpus source sha256',
      'invalid migration provenance',
      'invalid summary',
      'missing baseline en resources',
      'missing baseline resources',
      'missing baseline ru resources',
      'missing baseline uz resources',
      'missing exclusions',
      'missing units',
      'unsupported corpus version',
      'unsupported migration source version',
    ];
    await writeFile(outputPath, priorOutput, 'utf8');

    for (const units of [undefined, {}]) {
      const corpus = { formatVersion: 1, corpusVersion: 'x', source: { sha256: 'x' }, units };
      await writeFile(registryPath, JSON.stringify(corpus), 'utf8');

      await expect(syncCorpus({ registryPath, outputPath, sourceRoot: directory })).rejects.toThrow(
        expectedViolations.join('\n'),
      );
      await expect(readFile(outputPath, 'utf8')).resolves.toBe(priorOutput);
    }
  });

  it('rejects malformed baseline namespaces and leaves existing generated output untouched', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fe066-baseline-shape-'));
    const registryPath = join(directory, 'registry.json');
    const outputPath = join(directory, 'generated.ts');
    const corpus = fixture();
    (corpus.baselineResources.en as Record<string, Record<string, string>>).common =
      [] as unknown as Record<string, string>;
    await writeFile(registryPath, JSON.stringify(corpus), 'utf8');
    await writeFile(outputPath, 'prior generated output\n', 'utf8');

    await expect(syncCorpus({ registryPath, outputPath, sourceRoot: directory })).rejects.toThrow(
      'invalid baseline en.common namespace',
    );
    await expect(
      checkCorpus({ registryPath, outputPath, sourceRoot: directory }),
    ).resolves.toContain('invalid baseline en.common namespace');
    await expect(readFile(outputPath, 'utf8')).resolves.toBe('prior generated output\n');
  });

  it('rejects unsupported baseline locales before replacing generated output', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fe066-baseline-locale-'));
    const registryPath = join(directory, 'registry.json');
    const outputPath = join(directory, 'generated.ts');
    const corpus = fixture();
    (corpus.baselineResources as Record<string, Record<string, Record<string, string>>>).fr = {
      common: { injected: 'Bonjour' },
    };
    await writeFile(registryPath, JSON.stringify(corpus), 'utf8');
    await writeFile(outputPath, 'prior generated output\n', 'utf8');

    await expect(syncCorpus({ registryPath, outputPath, sourceRoot: directory })).rejects.toThrow(
      'baseline resources must have exact en/ru/uz locale keys',
    );
    await expect(
      checkCorpus({ registryPath, outputPath, sourceRoot: directory }),
    ).resolves.toContain('baseline resources must have exact en/ru/uz locale keys');
    await expect(readFile(outputPath, 'utf8')).resolves.toBe('prior generated output\n');
  });

  it('rejects non-string baseline leaves before generation', () => {
    const corpus = fixture();
    (corpus.baselineResources.ru as Record<string, Record<string, string>>).common = {
      welcome: 1,
    } as unknown as Record<string, string>;

    expect(validateCorpus(corpus)).toContain('invalid baseline ru.common.welcome resource');
  });

  it('returns deterministic violations instead of throwing for non-array occurrences', () => {
    const corpus = fixture();
    corpus.units[0].occurrences = {} as unknown as (typeof corpus.units)[number]['occurrences'];

    expect(validateCorpus(corpus)).toEqual([
      'DRAFT-37 exclusion identity mismatch',
      'DRAFT-37 identity/count mismatch',
      'DRAFT-37 semantic identity mismatch',
      'MLUX-C0001: invalid occurrences',
      'MLUX-C0001: source revision fingerprint mismatch',
      'summary source occurrence count mismatch',
    ]);
  });

  it('returns deterministic violations instead of throwing for malformed occurrence elements', () => {
    const corpus = fixture();
    const malformedOccurrences: unknown[] = [null, 7, 'invalid', {}, []];
    corpus.units[0].occurrences =
      malformedOccurrences as (typeof corpus.units)[number]['occurrences'];

    expect(protectedSourceFingerprint(corpus.units[0])).toBe(
      protectedSourceFingerprint(corpus.units[0]),
    );
    const expectedViolations = [
      'DRAFT-37 exclusion identity mismatch',
      'DRAFT-37 identity/count mismatch',
      'DRAFT-37 semantic identity mismatch',
      'MLUX-C0001: duplicate occurrence id',
      'MLUX-C0001: duplicate occurrence id',
      'MLUX-C0001: duplicate occurrence id',
      'MLUX-C0001: duplicate occurrence id',
      'MLUX-C0001: invalid occurrence',
      'MLUX-C0001: invalid occurrence',
      'MLUX-C0001: invalid occurrence',
      'MLUX-C0001: invalid occurrence',
      'MLUX-C0001: invalid occurrence',
      'MLUX-C0001: source revision fingerprint mismatch',
      'summary source occurrence count mismatch',
    ];
    expect(validateCorpus(corpus)).toEqual(expectedViolations);
    expect(validateCorpus(corpus)).toEqual(expectedViolations);
  });

  it('requires exact plural-form locale keys while accepting the canonical EN/RU/UZ shape', () => {
    const corpus = structuredClone(draft37Registry);
    const unit = corpus.units.find((candidate) => candidate.pluralForms !== null);
    expect(unit).toBeDefined();
    if (!unit?.pluralForms) return;

    expect(validateFixtureCorpus(corpus)).toEqual([]);
    (unit.pluralForms as Record<string, Record<string, string>>).fr = { other: 'Bonjour' };
    expect(validateCorpus(corpus)).toContain(
      `${unit.id}: plural forms must have exact en/ru/uz locale keys`,
    );
    delete (unit.pluralForms as Record<string, Record<string, string>>).fr;
    expect(validateFixtureCorpus(corpus)).toEqual([]);
  });

  it('binds every locale candidate to the content-derived protected-source fingerprint', () => {
    const corpus = fixture();
    expect(validateFixtureCorpus(corpus)).toEqual([]);
    corpus.units[0].english = 'Welcome back {{name}}';
    expect(validateCorpus(corpus)).toContain('MLUX-C0001: source revision fingerprint mismatch');
    const revised = reviseProtectedSource(fixture().units[0], { english: 'Welcome back {{name}}' });
    expect(revised.locales.ru).toMatchObject({
      status: 'draft',
      sourceRevision: revised.sourceRevision,
    });
  });

  it.each(['review_requested', 'changes_requested', 'approved'] as const)(
    'rejects a forged protected revision that leaves %s current',
    (status) => {
      const corpus = fixture();
      const candidate = transitionLocaleCandidate(corpus.units[0].locales.ru, 'review_requested');
      const reviewed =
        status === 'changes_requested'
          ? requestChanges(candidate)
          : status === 'approved'
            ? transitionLocaleCandidate(candidate, 'approved', {
                humanApproval: {
                  reviewerId: 'native-7',
                  reviewerName: 'Native Reviewer',
                  reviewedAt: '2026-08-23T00:00:00.000Z',
                  approvalRecordedAt: '2026-08-23T00:01:00.000Z',
                  approvalAuthority: {
                    kind: 'human_native_review',
                    reviewerId: 'native-7',
                    reviewerName: 'Native Reviewer',
                  },
                },
              })
            : candidate;
      corpus.units[0].english = 'Welcome revised {{name}}';
      const sourceRevision = protectedSourceFingerprint(corpus.units[0]);
      corpus.units[0].sourceRevision = sourceRevision;
      corpus.units[0].locales.ru = {
        ...reviewed,
        sourceRevision,
        history: [
          ...reviewed.history,
          {
            type: 'source_revision',
            previousSourceRevision: reviewed.sourceRevision,
            sourceRevision,
          },
        ],
      };
      corpus.units[0].locales.uz.sourceRevision = sourceRevision;

      expect(validateCorpus(corpus)).toContain(
        'MLUX-C0001: ru source revision history requires immediate stale transition',
      );
    },
  );

  it.each(['draft', 'stale'] as const)(
    'allows a protected revision while %s is not under active review',
    (status) => {
      const corpus = fixture();
      if (status === 'stale')
        corpus.units[0].locales.ru = transitionLocaleCandidate(
          transitionLocaleCandidate(corpus.units[0].locales.ru, 'review_requested'),
          'stale',
        );
      corpus.units[0] = reviseProtectedSource(corpus.units[0], {
        english: 'Welcome revised {{name}}',
      });

      expect(validateFixtureCorpus(corpus)).toEqual([]);
    },
  );

  it.each(['occurrences', 'placeholdersByLocale', 'pluralForms'] as const)(
    'derives a new source revision and stales reviewed candidates for %s changes',
    (field) => {
      const unit = fixture().units[0];
      const approved = transitionLocaleCandidate(
        transitionLocaleCandidate(unit.locales.ru, 'review_requested'),
        'approved',
        {
          humanApproval: {
            reviewerId: 'native-7',
            reviewerName: 'Native Reviewer',
            reviewedAt: '2026-08-23T00:00:00.000Z',
            approvalRecordedAt: '2026-08-23T00:01:00.000Z',
            approvalAuthority: {
              kind: 'human_native_review',
              reviewerId: 'native-7',
              reviewerName: 'Native Reviewer',
            },
          },
        },
      );
      unit.locales.ru = approved;
      const changes =
        field === 'occurrences'
          ? { occurrences: [{ id: 'MLUX-O0002', context: 'changed context' }] }
          : field === 'placeholdersByLocale'
            ? {
                placeholdersByLocale: {
                  en: ['name', 'extra'],
                  ru: ['name', 'extra'],
                  uz: ['name', 'extra'],
                },
              }
            : {
                pluralForms: {
                  en: { one: 'One {{name}}' },
                  ru: { one: 'Один {{name}}' },
                  uz: { one: 'Bitta {{name}}' },
                },
              };
      const revised = reviseProtectedSource(unit, changes);
      expect(revised.locales.ru.status).toBe('stale');
      expect(revised.locales.ru.history.at(-2)).toMatchObject({
        type: 'source_revision',
        sourceRevision: revised.sourceRevision,
      });
      expect(revised.locales.ru.history.at(-1)).toMatchObject({
        type: 'transition',
        from: 'approved',
        to: 'stale',
      });
    },
  );

  it('records explicit plural removal and stales an approved candidate', () => {
    const { unit } = pluralFixture();
    unit.locales.ru = transitionLocaleCandidate(
      transitionLocaleCandidate(unit.locales.ru, 'review_requested'),
      'approved',
      {
        humanApproval: {
          reviewerId: 'native-7',
          reviewerName: 'Native Reviewer',
          reviewedAt: '2026-08-23T00:00:00.000Z',
          approvalRecordedAt: '2026-08-23T00:01:00.000Z',
          approvalAuthority: {
            kind: 'human_native_review',
            reviewerId: 'native-7',
            reviewerName: 'Native Reviewer',
          },
        },
      },
    );

    const revised = reviseProtectedSource(unit, { pluralForms: null });

    expect(revised).not.toBe(unit);
    expect(revised.pluralForms).toBeNull();
    expect(revised.sourceRevision).not.toBe(unit.sourceRevision);
    expect(revised.locales.ru).toMatchObject({
      status: 'stale',
      sourceRevision: revised.sourceRevision,
    });
    expect(revised.locales.ru.approvalAuthority).toBeNull();
  });

  it.each([
    ['ru', 'review_requested'],
    ['uz', 'changes_requested'],
  ] as const)(
    'stales an in-flight %s candidate when plural metadata is explicitly removed',
    (locale, status) => {
      const { unit } = pluralFixture();
      const requested = transitionLocaleCandidate(unit.locales[locale], 'review_requested');
      unit.locales[locale] = status === 'changes_requested' ? requestChanges(requested) : requested;

      const revised = reviseProtectedSource(unit, { pluralForms: null });

      expect(revised.pluralForms).toBeNull();
      expect(revised.locales[locale]).toMatchObject({
        status: 'stale',
        sourceRevision: revised.sourceRevision,
      });
    },
  );

  it('distinguishes omitted plural metadata from an explicit no-op null', () => {
    const { unit } = pluralFixture();
    const noPluralUnit = fixture().units[0];
    expect(reviseProtectedSource(unit, {})).toBe(unit);
    expect(reviseProtectedSource(noPluralUnit, { pluralForms: null })).toBe(noPluralUnit);
  });

  it('distinguishes omitted rendering metadata from explicit null clearing', () => {
    const unit = fixture().units[0];

    expect(reviseProtectedSource(unit, {})).toBe(unit);
    const revised = reviseProtectedSource(unit, { renderingContract: null });
    expect(revised).not.toBe(unit);
    expect(revised.renderingContract).toBeNull();
    expect(revised.sourceRevision).not.toBe(unit.sourceRevision);
  });

  it('rejects direct approved records that omit legal history or named human-native provenance', () => {
    const corpus = fixture();
    const candidate = corpus.units[0].locales.ru as FixtureCandidate;
    candidate.status = 'approved';
    candidate.reviewerId = 'claimed';
    candidate.reviewedAt = '2026-08-23';
    candidate.approvalRecordedAt = '2026-08-23';
    expect(validateCorpus(corpus)).toEqual(
      expect.arrayContaining([
        'MLUX-C0001: ru history does not end at current status',
        'MLUX-C0001: ru approved candidate lacks human-native authority',
      ]),
    );
  });

  it('allows approval only through a legal history with explicit named human-native provenance', () => {
    const candidate = fixture().units[0].locales.ru;
    const requested = transitionLocaleCandidate(candidate, 'review_requested');
    const approved = transitionLocaleCandidate(requested, 'approved', {
      humanApproval: {
        reviewerId: 'native-7',
        reviewerName: 'Native Reviewer',
        reviewedAt: '2026-08-23T00:00:00.000Z',
        approvalRecordedAt: '2026-08-23T00:01:00.000Z',
        approvalAuthority: {
          kind: 'human_native_review',
          reviewerId: 'native-7',
          reviewerName: 'Native Reviewer',
        },
      },
    });
    expect(approved.status).toBe('approved');
    expect(() => transitionLocaleCandidate(candidate, 'approved')).toThrow(
      'draft -> approved is forbidden',
    );
  });

  it('rejects approval helper records with missing or blank reviewer names', () => {
    const requested = transitionLocaleCandidate(fixture().units[0].locales.ru, 'review_requested');
    const approvalAuthority = {
      kind: 'human_native_review',
      reviewerId: 'native-7',
      reviewerName: 'Native Reviewer',
    };
    const approvalEvidence = {
      reviewerId: 'native-7',
      reviewedAt: '2026-08-23T00:00:00.000Z',
      approvalRecordedAt: '2026-08-23T00:01:00.000Z',
      approvalAuthority,
    };

    for (const humanApproval of [approvalEvidence, { ...approvalEvidence, reviewerName: '' }]) {
      expect(() => transitionLocaleCandidate(requested, 'approved', { humanApproval })).toThrow(
        'approved requires named human-native authority',
      );
    }
  });

  it('replaces a draft default in generated resources only through explicit human approval and keeps its history', () => {
    const corpus = fixture();
    const defaultCandidate = corpus.units[0].locales.ru.candidate;
    const approvedCandidate = 'Одобрено носителем, {{name}}';
    const requested = transitionLocaleCandidate(corpus.units[0].locales.ru, 'review_requested');
    corpus.units[0].locales.ru = transitionLocaleCandidate(requested, 'approved', {
      newCandidate: approvedCandidate,
      humanApproval: {
        reviewerId: 'native-7',
        reviewerName: 'Native Reviewer',
        reviewedAt: '2026-08-23T00:00:00.000Z',
        approvalRecordedAt: '2026-08-23T00:01:00.000Z',
        approvalAuthority: {
          kind: 'human_native_review',
          reviewerId: 'native-7',
          reviewerName: 'Native Reviewer',
        },
      },
    });

    expect(corpus.units[0].locales.ru).toMatchObject({
      candidate: approvedCandidate,
      status: 'approved',
      history: expect.arrayContaining([
        expect.objectContaining({
          from: 'review_requested',
          to: 'approved',
          previousCandidate: defaultCandidate,
          nextCandidate: approvedCandidate,
        }),
      ]),
    });
    expect(validateFixtureCorpus(corpus)).toEqual([]);
    expect(generateResources(corpus).ru.common.welcome).toBe(approvedCandidate);
  });

  it('binds current approval evidence to the protected source revision recorded by its transition', () => {
    const corpus = fixture();
    const requested = transitionLocaleCandidate(corpus.units[0].locales.ru, 'review_requested');
    corpus.units[0].locales.ru = transitionLocaleCandidate(requested, 'approved', {
      humanApproval: {
        reviewerId: 'native-7',
        reviewerName: 'Native Reviewer',
        reviewedAt: '2026-08-23T00:00:00.000Z',
        approvalRecordedAt: '2026-08-23T00:01:00.000Z',
        approvalAuthority: {
          kind: 'human_native_review',
          reviewerId: 'native-7',
          reviewerName: 'Native Reviewer',
        },
      },
    });
    expect(validateFixtureCorpus(corpus)).toEqual([]);

    corpus.units[0].english = 'Welcome revised {{name}}';
    const sourceRevision = protectedSourceFingerprint(corpus.units[0]);
    corpus.units[0].sourceRevision = sourceRevision;
    corpus.units[0].locales.ru.sourceRevision = sourceRevision;
    corpus.units[0].locales.uz.sourceRevision = sourceRevision;

    expect(validateCorpus(corpus)).toContain(
      'MLUX-C0001: ru review history does not match current protected source revision',
    );

    const reviewCorpus = fixture();
    reviewCorpus.units[0].locales.ru = transitionLocaleCandidate(
      reviewCorpus.units[0].locales.ru,
      'review_requested',
    );
    reviewCorpus.units[0].english = 'Welcome newly reviewed {{name}}';
    const reviewSourceRevision = protectedSourceFingerprint(reviewCorpus.units[0]);
    reviewCorpus.units[0].sourceRevision = reviewSourceRevision;
    reviewCorpus.units[0].locales.ru.sourceRevision = reviewSourceRevision;
    reviewCorpus.units[0].locales.uz.sourceRevision = reviewSourceRevision;
    expect(validateCorpus(reviewCorpus)).toContain(
      'MLUX-C0001: ru review history does not match current protected source revision',
    );
  });

  it('binds protected source-revision history to matching stale transition and current candidate revision', () => {
    const initial = fixture().units[0];
    const approved = transitionLocaleCandidate(
      transitionLocaleCandidate(initial.locales.ru, 'review_requested'),
      'approved',
      {
        humanApproval: {
          reviewerId: 'native-7',
          reviewerName: 'Native Reviewer',
          reviewedAt: '2026-08-23T00:00:00.000Z',
          approvalRecordedAt: '2026-08-23T00:01:00.000Z',
          approvalAuthority: {
            kind: 'human_native_review',
            reviewerId: 'native-7',
            reviewerName: 'Native Reviewer',
          },
        },
      },
    );
    const revised = reviseProtectedSource(
      { ...initial, locales: { ...initial.locales, ru: approved } },
      {
        english: 'Welcome revised {{name}}',
      },
    );
    const corpus = fixture();
    corpus.units[0] = revised;
    expect(validateFixtureCorpus(corpus)).toEqual([]);

    const forgedTransition = structuredClone(corpus);
    const forgedRevision =
      'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const ruHistory = forgedTransition.units[0].locales.ru.history as {
      sourceRevision?: string;
      type: string;
    }[];
    const revisionIndex = ruHistory.findIndex((event) => event.type === 'source_revision');
    ruHistory[revisionIndex].sourceRevision = forgedRevision;
    ruHistory[revisionIndex + 1].sourceRevision = forgedRevision;
    expect(validateCorpus(forgedTransition)).toContain(
      'MLUX-C0001: ru source revision history does not bind current candidate revision',
    );

    const forgedStaleTransition = structuredClone(corpus);
    const staleHistory = forgedStaleTransition.units[0].locales.ru.history as {
      sourceRevision?: string;
      type: string;
    }[];
    const staleRevisionIndex = staleHistory.findIndex((event) => event.type === 'source_revision');
    staleHistory[staleRevisionIndex + 1].sourceRevision = forgedRevision;
    expect(validateCorpus(forgedStaleTransition)).toContain(
      'MLUX-C0001: ru source revision history requires matching immediate stale transition',
    );
  });

  it('requires fresh transition-specific human approval after stale candidates are rewritten', () => {
    const candidate = fixture().units[0].locales.ru;
    const firstApproval = {
      reviewerId: 'native-a',
      reviewerName: 'Reviewer A',
      reviewedAt: '2026-08-23T00:00:00.000Z',
      approvalRecordedAt: '2026-08-23T00:01:00.000Z',
      approvalAuthority: {
        kind: 'human_native_review',
        reviewerId: 'native-a',
        reviewerName: 'Reviewer A',
      },
    };
    const approved = transitionLocaleCandidate(
      transitionLocaleCandidate(candidate, 'review_requested'),
      'approved',
      { humanApproval: firstApproval },
    );
    const rewritten = transitionLocaleCandidate(
      transitionLocaleCandidate(approved, 'stale'),
      'draft',
      { newCandidate: 'Обновленный перевод, {{name}}' },
    );
    const rerequested = transitionLocaleCandidate(rewritten, 'review_requested');

    expect(rewritten).toMatchObject({
      reviewerId: null,
      verdict: null,
      reviewedAt: null,
      approvalRecordedAt: null,
      approvalAuthority: null,
    });
    expect(() => transitionLocaleCandidate(rerequested, 'approved')).toThrow(
      'approved requires named human-native authority',
    );

    const reapproved = transitionLocaleCandidate(rerequested, 'approved', {
      humanApproval: {
        reviewerId: 'native-b',
        reviewerName: 'Reviewer B',
        reviewedAt: '2026-08-24T00:00:00.000Z',
        approvalRecordedAt: '2026-08-24T00:01:00.000Z',
        approvalAuthority: {
          kind: 'human_native_review',
          reviewerId: 'native-b',
          reviewerName: 'Reviewer B',
        },
      },
    });
    const corpus = fixture();
    corpus.units[0].locales.ru = reapproved;
    expect(validateFixtureCorpus(corpus)).toEqual([]);

    const missingTransitionApproval = structuredClone(reapproved);
    delete (
      missingTransitionApproval.history[missingTransitionApproval.history.length - 1] as {
        humanApproval?: unknown;
      }
    ).humanApproval;
    corpus.units[0].locales.ru = missingTransitionApproval;
    expect(validateCorpus(corpus)).toContain(
      'MLUX-C0001: ru approved history lacks transition-specific human-native authority',
    );
  });

  it('rejects current approval metadata that differs from its terminal approval event', () => {
    const candidate = fixture().units[0].locales.ru;
    const approvedByA = transitionLocaleCandidate(
      transitionLocaleCandidate(candidate, 'review_requested'),
      'approved',
      {
        humanApproval: {
          reviewerId: 'native-a',
          reviewerName: 'Reviewer A',
          reviewedAt: '2026-08-23T00:00:00.000Z',
          approvalRecordedAt: '2026-08-23T00:01:00.000Z',
          approvalAuthority: {
            kind: 'human_native_review',
            reviewerId: 'native-a',
            reviewerName: 'Reviewer A',
          },
        },
      },
    );
    const approvedByB = transitionLocaleCandidate(
      transitionLocaleCandidate(transitionLocaleCandidate(approvedByA, 'stale'), 'draft', {
        newCandidate: 'Обновленный перевод, {{name}}',
      }),
      'review_requested',
    );
    const reapproved = transitionLocaleCandidate(approvedByB, 'approved', {
      humanApproval: {
        reviewerId: 'native-b',
        reviewerName: 'Reviewer B',
        reviewedAt: '2026-08-24T00:00:00.000Z',
        approvalRecordedAt: '2026-08-24T00:01:00.000Z',
        approvalAuthority: {
          kind: 'human_native_review',
          reviewerId: 'native-b',
          reviewerName: 'Reviewer B',
        },
      },
    });
    const forged = {
      ...reapproved,
      reviewerId: approvedByA.reviewerId,
      reviewedAt: approvedByA.reviewedAt,
      approvalRecordedAt: approvedByA.approvalRecordedAt,
      approvalAuthority: approvedByA.approvalAuthority,
    };
    const corpus = fixture();
    corpus.units[0].locales.ru = forged;

    expect(validateCorpus(corpus)).toContain(
      'MLUX-C0001: ru approved candidate does not match terminal approval history',
    );
  });

  it('rejects replacement outside a legal draft return or explicit human approval', () => {
    const candidate = fixture().units[0].locales.ru;
    expect(() =>
      transitionLocaleCandidate(candidate, 'review_requested', {
        newCandidate: 'Replacement {{name}}',
      }),
    ).toThrow(
      'candidate replacement is only allowed for a human approval or while returning stale or changes_requested to draft',
    );
    const requested = transitionLocaleCandidate(candidate, 'review_requested');
    expect(
      transitionLocaleCandidate(requested, 'approved', {
        newCandidate: 'Replacement {{name}}',
        humanApproval: {
          reviewerId: 'native-7',
          reviewerName: 'Native Reviewer',
          reviewedAt: '2026-08-23T00:00:00.000Z',
          approvalRecordedAt: '2026-08-23T00:01:00.000Z',
          approvalAuthority: {
            kind: 'human_native_review',
            reviewerId: 'native-7',
            reviewerName: 'Native Reviewer',
          },
        },
      }).candidate,
    ).toBe('Replacement {{name}}');
  });

  it('allows a corrected candidate when changes requested returns to draft without allowing approval-time edits', () => {
    const candidate = fixture().units[0].locales.ru as FixtureCandidate;
    const changesRequested = requestChanges(
      transitionLocaleCandidate(candidate, 'review_requested'),
    );
    const corrected = transitionLocaleCandidate(changesRequested, 'draft', {
      newCandidate: 'Исправленный перевод, {{name}}',
    });
    expect(corrected).toMatchObject({
      status: 'draft',
      candidate: 'Исправленный перевод, {{name}}',
    });
    expect(corrected.history.at(-1)).toMatchObject({
      from: 'changes_requested',
      to: 'draft',
      previousCandidate: candidate.candidate,
      nextCandidate: 'Исправленный перевод, {{name}}',
    });
    expect(() =>
      transitionLocaleCandidate(changesRequested, 'approved', {
        newCandidate: 'Несанкционированная замена, {{name}}',
      }),
    ).toThrow('changes_requested -> approved is forbidden');

    const corpus = fixture();
    corpus.units[0].locales.ru = corrected;
    expect(validateFixtureCorpus(corpus)).toEqual([]);
  });

  it('records a first-class review withdrawal and clears request metadata inside the operation', () => {
    const corpus = fixture();
    const requested = {
      ...transitionLocaleCandidate(corpus.units[0].locales.ru, 'review_requested'),
      requestedAt: '2026-08-23T00:00:00.000Z',
    };

    const withdrawn = withdrawLocaleCandidateReview(requested);

    expect(withdrawn).toMatchObject({
      status: 'draft',
      candidate: requested.candidate,
      requestedAt: null,
      reviewerId: null,
      verdict: null,
      reviewedAt: null,
      approvalRecordedAt: null,
      approvalAuthority: null,
    });
    expect(withdrawn.history.at(-1)).toEqual({
      type: 'transition',
      from: 'review_requested',
      to: 'draft',
      previousCandidate: requested.candidate,
      nextCandidate: requested.candidate,
      sourceRevision: requested.sourceRevision,
      withdrawal: true,
    });
    corpus.units[0].locales.ru = withdrawn;
    expect(validateFixtureCorpus(corpus)).toEqual([]);
    expect(() => transitionLocaleCandidate(requested, 'draft')).toThrow(
      'review_requested -> draft is forbidden',
    );
  });

  it('retains validated change-request evidence without changing the candidate', () => {
    const corpus = fixture();
    const requested = {
      ...transitionLocaleCandidate(corpus.units[0].locales.ru, 'review_requested'),
      requestedAt: '2026-08-23T00:00:00.000Z',
    };
    const changeRequest = {
      replacement: 'Исправленный перевод, {{name}}',
      reviewerId: 'native-7',
      reviewerName: 'Native Reviewer',
      reviewerAttestation: 'native-review',
      requestedAt: requested.requestedAt,
      reviewedAt: '2026-08-23T00:01:00.000Z',
      changeRequestedAt: '2026-08-23T00:02:00.000Z',
    };

    const changesRequested = transitionLocaleCandidate(requested, 'changes_requested', {
      changeRequest,
    });

    expect(changesRequested.candidate).toBe(requested.candidate);
    expect(changesRequested.history.at(-1)).toMatchObject({
      from: 'review_requested',
      to: 'changes_requested',
      previousCandidate: requested.candidate,
      nextCandidate: requested.candidate,
      changeRequest,
    });
    corpus.units[0].locales.ru = changesRequested;
    expect(validateFixtureCorpus(corpus)).toEqual([]);
  });

  it.each([
    ['blank replacement', { replacement: '  ' }],
    ['untrimmed reviewer', { reviewerId: ' native-7 ' }],
    ['wrong attestation', { reviewerAttestation: 'machine-review' }],
    ['mismatched request time', { requestedAt: '2026-08-22T23:59:59.000Z' }],
    ['review before request', { reviewedAt: '2026-08-22T23:59:59.999Z' }],
    ['record before review', { changeRequestedAt: '2026-08-23T00:00:30.000Z' }],
  ])(
    'rejects a malformed %s change-request record without mutating its input',
    (_name, override) => {
      const requested = {
        ...transitionLocaleCandidate(fixture().units[0].locales.ru, 'review_requested'),
        requestedAt: '2026-08-23T00:00:00.000Z',
      };
      const before = structuredClone(requested);

      expect(() =>
        transitionLocaleCandidate(requested, 'changes_requested', {
          changeRequest: {
            replacement: 'Исправленный перевод, {{name}}',
            reviewerId: 'native-7',
            reviewerName: 'Native Reviewer',
            reviewerAttestation: 'native-review',
            requestedAt: requested.requestedAt,
            reviewedAt: '2026-08-23T00:01:00.000Z',
            changeRequestedAt: '2026-08-23T00:02:00.000Z',
            ...override,
          },
        }),
      ).toThrow('changes_requested requires valid native-review change-request evidence');
      expect(requested).toEqual(before);
    },
  );

  it('rejects malformed withdrawal and change-request history through normal corpus validation', () => {
    const corpus = fixture();
    const requested = {
      ...transitionLocaleCandidate(corpus.units[0].locales.ru, 'review_requested'),
      requestedAt: '2026-08-23T00:00:00.000Z',
    };
    const withdrawn = withdrawLocaleCandidateReview(requested);
    const malformedWithdrawal = structuredClone(withdrawn);
    (malformedWithdrawal.history.at(-1) as Record<string, unknown>).reviewerId = 'fabricated';
    corpus.units[0].locales.ru = malformedWithdrawal;
    expect(validateFixtureCorpus(corpus)).toContain(
      'MLUX-C0001: ru invalid review withdrawal history',
    );

    const changed = transitionLocaleCandidate(requested, 'changes_requested', {
      changeRequest: {
        replacement: 'Исправленный перевод, {{name}}',
        reviewerId: 'native-7',
        reviewerName: 'Native Reviewer',
        reviewerAttestation: 'native-review',
        requestedAt: requested.requestedAt,
        reviewedAt: '2026-08-23T00:01:00.000Z',
        changeRequestedAt: '2026-08-23T00:02:00.000Z',
      },
    });
    const malformedChangeRequest = structuredClone(changed);
    Reflect.deleteProperty(
      (malformedChangeRequest.history.at(-1) as { changeRequest: Record<string, unknown> })
        .changeRequest,
      'reviewerAttestation',
    );
    corpus.units[0].locales.ru = malformedChangeRequest;
    expect(validateFixtureCorpus(corpus)).toContain(
      'MLUX-C0001: ru changes-requested history lacks valid native-review evidence',
    );

    const malformedReplacement = structuredClone(changed);
    (
      malformedReplacement.history.at(-1) as {
        changeRequest: { replacement: string };
      }
    ).changeRequest.replacement = 'Исправленный перевод без placeholder';
    corpus.units[0].locales.ru = malformedReplacement;
    expect(validateFixtureCorpus(corpus)).toContain(
      'MLUX-C0001: ru change-request replacement placeholder mismatch',
    );
  });

  it('rejects retained change-request placeholder drift after a later draft transition', () => {
    const corpus = fixture();
    const requested = {
      ...transitionLocaleCandidate(corpus.units[0].locales.ru, 'review_requested'),
      requestedAt: '2026-08-23T00:00:00.000Z',
    } as FixtureCandidate;
    const corrected = transitionLocaleCandidate(requestChanges(requested), 'draft', {
      newCandidate: 'Исправленный перевод, {{name}}',
    }) as FixtureCandidate;
    const tampered = structuredClone(corrected);
    retainedChangeRequest(tampered).replacement = 'Подставьте имя без placeholder';
    (corpus.units[0].locales as unknown as MutableFixtureLocales).ru = tampered;

    expect(validateFixtureCorpus(corpus)).toContain(
      'MLUX-C0001: ru change-request replacement placeholder mismatch',
    );
  });

  it('validates retained change requests against their historical revision context', () => {
    const staleCorpus = fixture();
    const staleUnit = staleCorpus.units[0];
    const requested = {
      ...transitionLocaleCandidate(staleUnit.locales.ru, 'review_requested'),
      requestedAt: '2026-08-23T00:00:00.000Z',
    } as FixtureCandidate;
    staleUnit.locales.ru = requestChanges(requested);
    staleCorpus.units[0] = reviseProtectedSource(staleUnit, {
      english: 'Welcome from the revised context, {{name}}',
    });
    expect(validateFixtureCorpus(staleCorpus)).toEqual([]);

    const tamperedStale = structuredClone(staleCorpus);
    retainedChangeRequest(tamperedStale.units[0].locales.ru as FixtureCandidate).replacement =
      'Подставьте имя без placeholder';
    expect(validateFixtureCorpus(tamperedStale)).toContain(
      'MLUX-C0001: ru change-request replacement placeholder mismatch',
    );

    const revisedCorpus = fixture();
    const revisedUnit = revisedCorpus.units[0];
    const revisedRequested = {
      ...transitionLocaleCandidate(revisedUnit.locales.ru, 'review_requested'),
      requestedAt: '2026-08-23T00:00:00.000Z',
    } as FixtureCandidate;
    revisedUnit.locales.ru = requestChanges(revisedRequested);
    const revised = reviseProtectedSource(revisedUnit, {
      placeholdersByLocale: {
        ...revisedUnit.placeholdersByLocale,
        ru: ['identity'],
      },
    });
    const rewritten = transitionLocaleCandidate(revised.locales.ru, 'draft', {
      newCandidate: 'Исправленный перевод, {{identity}}',
    });
    revisedCorpus.units[0] = {
      ...revised,
      locales: { ...revised.locales, ru: rewritten },
    };

    expect(validateFixtureCorpus(revisedCorpus)).toEqual([]);
    const tamperedRevised = structuredClone(revisedCorpus);
    retainedChangeRequest(tamperedRevised.units[0].locales.ru as FixtureCandidate).replacement =
      'Исправьте {{identity}}';
    expect(validateFixtureCorpus(tamperedRevised)).toContain(
      'MLUX-C0001: ru change-request replacement placeholder mismatch',
    );
  });

  it.each(REVIEW_VERDICT_OPERATIONS)(
    'rejects fabricated approval metadata before the $name verdict transition',
    ({ run }) => {
      const requested = {
        ...transitionLocaleCandidate(fixture().units[0].locales.ru, 'review_requested'),
        requestedAt: '2026-08-23T00:00:00.000Z',
      } as FixtureCandidate;
      const invalidSource = withFabricatedApprovalMetadata(requested);
      const before = structuredClone(invalidSource);

      expect(() => run(invalidSource)).toThrow(/non-approved candidate retains approval metadata/);
      expect(invalidSource).toEqual(before);
    },
  );

  it('rejects fabricated approval metadata before a changes-requested candidate can return to draft', () => {
    const requested = {
      ...transitionLocaleCandidate(fixture().units[0].locales.ru, 'review_requested'),
      requestedAt: '2026-08-23T00:00:00.000Z',
    } as FixtureCandidate;
    const invalidSource = withFabricatedApprovalMetadata(requestChanges(requested));
    const before = structuredClone(invalidSource);

    expect(() =>
      transitionLocaleCandidate(invalidSource, 'draft', {
        newCandidate: 'Исправленная локализация, {{name}}',
      }),
    ).toThrow(/non-approved candidate retains approval metadata/);
    expect(invalidSource).toEqual(before);
  });

  it.each<ProtectedRevisionStatus>(['draft', 'review_requested', 'changes_requested', 'stale'])(
    'rejects fabricated $status authority before protected-source normalization',
    (status) => {
      const invalidCandidate = withFabricatedApprovalMetadata(
        protectedRevisionFixtureCandidate(status),
      );
      const beforeCandidate = structuredClone(invalidCandidate);
      const nextRevision = `sha256:${'f'.repeat(64)}`;

      expect(() => applyProtectedSourceRevision(invalidCandidate, nextRevision)).toThrow(
        /non-approved candidate retains approval metadata/,
      );
      expect(invalidCandidate).toEqual(beforeCandidate);

      const unit = fixture().units[0];
      (unit.locales as unknown as MutableFixtureLocales).ru = invalidCandidate;
      const beforeUnit = structuredClone(unit);
      expect(() => reviseProtectedSource(unit, { english: 'Revised source, {{name}}' })).toThrow(
        /non-approved candidate retains approval metadata/,
      );
      expect(unit).toEqual(beforeUnit);
    },
  );

  it('validates retained lifecycle history before protected-source normalization', () => {
    const invalidCandidate = reviewRequestedFixtureCandidate();
    mutableHistoryEvent(invalidCandidate).reviewerId = 'forged-reviewer';
    const beforeCandidate = structuredClone(invalidCandidate);

    expect(() =>
      applyProtectedSourceRevision(invalidCandidate, `sha256:${'e'.repeat(64)}`),
    ).toThrow(/invalid history event shape/);
    expect(invalidCandidate).toEqual(beforeCandidate);

    const unit = fixture().units[0];
    (unit.locales as unknown as MutableFixtureLocales).ru = invalidCandidate;
    const beforeUnit = structuredClone(unit);
    expect(() => reviseProtectedSource(unit, { english: 'Revised source, {{name}}' })).toThrow(
      /invalid history event shape/,
    );
    expect(unit).toEqual(beforeUnit);
  });

  it('preserves valid approved-to-stale normalization and historical change-request evidence', () => {
    const approvedCorpus = fixture();
    const approvedUnit = approvedCorpus.units[0];
    (approvedUnit.locales as unknown as MutableFixtureLocales).ru = humanApprovedFixtureCandidate();
    approvedCorpus.units[0] = reviseProtectedSource(approvedUnit, {
      english: 'Approved revision, {{name}}',
    });
    expect(approvedCorpus.units[0].locales.ru.status).toBe('stale');
    expect(validateFixtureCorpus(approvedCorpus)).toEqual([]);

    const changedCorpus = fixture();
    const changedUnit = changedCorpus.units[0];
    (changedUnit.locales as unknown as MutableFixtureLocales).ru = requestChanges(
      reviewRequestedFixtureCandidate(),
    );
    changedCorpus.units[0] = reviseProtectedSource(changedUnit, {
      english: 'Change-request revision, {{name}}',
    });
    expect(
      retainedChangeRequest(changedCorpus.units[0].locales.ru as FixtureCandidate),
    ).toMatchObject({ replacement: 'Исправленный перевод, {{name}}' });
    expect(validateFixtureCorpus(changedCorpus)).toEqual([]);
  });

  const candidateOuterShapeAdversaries: readonly CandidateOuterShapeAdversary[] = [
    {
      name: 'human approval history evidence',
      forgedKey: 'humanApproval',
      forgedValue: forgedHumanApprovalRecord(),
    },
    {
      name: 'supplied-artifact approval history evidence',
      forgedKey: 'suppliedArtifactApproval',
      forgedValue: {
        reviewerId: null,
        reviewedAt: null,
        approvalRecordedAt: '2026-08-25T00:00:00.000Z',
        approvalAuthority: { ...SUPPLIED_REVIEW_ARTIFACT },
      },
    },
    {
      name: 'change-request history evidence',
      forgedKey: 'changeRequest',
      forgedValue: {
        replacement: 'Исправленный перевод, {{name}}',
        reviewerId: 'native-7',
        reviewerName: 'Native Reviewer',
        reviewerAttestation: 'native-review',
        requestedAt: '2026-08-23T00:00:00.000Z',
        reviewedAt: '2026-08-23T00:01:00.000Z',
        changeRequestedAt: '2026-08-23T00:02:00.000Z',
      },
    },
    { name: 'withdrawal history evidence', forgedKey: 'withdrawal', forgedValue: true },
    {
      name: 'reviewer alias object',
      forgedKey: 'reviewer',
      forgedValue: { id: 'native-7', name: 'Native Reviewer' },
    },
    {
      name: 'review-authority alias object',
      forgedKey: 'reviewAuthority',
      forgedValue: {
        kind: 'human_native_review',
        reviewerId: 'native-7',
        reviewerName: 'Native Reviewer',
      },
    },
    {
      name: 'review-evidence alias object',
      forgedKey: 'reviewEvidence',
      forgedValue: {
        reviewerAttestation: 'native-review',
        reviewedAt: '2026-08-23T00:01:00.000Z',
      },
    },
    {
      name: 'approval-evidence alias object',
      forgedKey: 'approvalEvidence',
      forgedValue: forgedHumanApprovalRecord(),
    },
    {
      name: 'reviewer-attestation wrong-owner field',
      forgedKey: 'reviewerAttestation',
      forgedValue: 'native-review',
    },
  ];

  it.each(candidateOuterShapeAdversaries)(
    'rejects candidate-level $name before validation or protected-source normalization',
    ({ forgedKey, forgedValue }) => {
      const corpus = fixture();
      const candidate = corpus.units[0].locales.ru as FixtureCandidate;
      candidate[forgedKey] = structuredClone(forgedValue);
      const before = structuredClone(candidate);
      const expected = `MLUX-C0001: ru candidate contains property outside LocaleCandidate schema: ${forgedKey}`;

      expect(validateFixtureCorpus(corpus)).toContain(expected);
      expect(() => applyProtectedSourceRevision(candidate, `sha256:${'f'.repeat(64)}`)).toThrow(
        `candidate contains property outside LocaleCandidate schema: ${forgedKey}`,
      );
      expect(candidate).toEqual(before);
    },
  );

  const candidateTransitionOperations: readonly CandidateTransitionOperation[] = [
    {
      name: 'draft to review requested',
      candidate: () => fixture().units[0].locales.ru as FixtureCandidate,
      run: (candidate) => transitionLocaleCandidate(candidate, 'review_requested'),
    },
    {
      name: 'review requested to human approved',
      candidate: reviewRequestedFixtureCandidate,
      run: (candidate) =>
        transitionLocaleCandidate(candidate, 'approved', {
          humanApproval: forgedHumanApprovalRecord(),
        }),
    },
    {
      name: 'review requested to changes requested',
      candidate: reviewRequestedFixtureCandidate,
      run: requestChanges,
    },
    {
      name: 'review requested withdrawal to draft',
      candidate: reviewRequestedFixtureCandidate,
      run: withdrawLocaleCandidateReview,
    },
    {
      name: 'review requested to stale',
      candidate: reviewRequestedFixtureCandidate,
      run: (candidate) => transitionLocaleCandidate(candidate, 'stale'),
    },
    {
      name: 'changes requested to draft',
      candidate: () => requestChanges(reviewRequestedFixtureCandidate()) as FixtureCandidate,
      run: (candidate) =>
        transitionLocaleCandidate(candidate, 'draft', {
          newCandidate: 'Исправленная локализация, {{name}}',
        }),
    },
    {
      name: 'changes requested to stale',
      candidate: () => requestChanges(reviewRequestedFixtureCandidate()) as FixtureCandidate,
      run: (candidate) => transitionLocaleCandidate(candidate, 'stale'),
    },
    {
      name: 'approved to stale',
      candidate: humanApprovedFixtureCandidate,
      run: (candidate) => transitionLocaleCandidate(candidate, 'stale'),
    },
    {
      name: 'stale to draft',
      candidate: () =>
        transitionLocaleCandidate(humanApprovedFixtureCandidate(), 'stale') as FixtureCandidate,
      run: (candidate) =>
        transitionLocaleCandidate(candidate, 'draft', {
          newCandidate: 'Возвращенная локализация, {{name}}',
        }),
    },
  ];

  it.each(candidateTransitionOperations)(
    'rejects candidate-level evidence before the $name transition',
    ({ candidate: createCandidate, run }) => {
      const candidate = createCandidate();
      candidate.humanApproval = forgedHumanApprovalRecord();
      const before = structuredClone(candidate);

      expect(() => run(candidate)).toThrow(
        'candidate contains property outside LocaleCandidate schema: humanApproval',
      );
      expect(candidate).toEqual(before);
    },
  );

  const validCandidateShapeControls: readonly ValidCandidateShapeControl[] = [
    { name: 'draft', candidate: () => fixture().units[0].locales.ru as FixtureCandidate },
    { name: 'review-requested', candidate: reviewRequestedFixtureCandidate },
    { name: 'ordinary approved', candidate: humanApprovedFixtureCandidate },
  ];

  it.each(validCandidateShapeControls)(
    'accepts the named $name LocaleCandidate properties',
    ({ candidate: createCandidate }) => {
      const corpus = fixture();
      (corpus.units[0].locales as unknown as MutableFixtureLocales).ru = createCandidate();

      expect(validateFixtureCorpus(corpus)).toEqual([]);
    },
  );

  const historyOuterShapeAdversaries: readonly HistoryOuterShapeAdversary[] = [
    {
      name: 'source revision with approval authority',
      candidate: () => {
        const unit = fixture().units[0];
        return reviseProtectedSource(unit, { english: 'Revised source, {{name}}' }).locales
          .ru as FixtureCandidate;
      },
      event: (candidate) => mutableHistoryEvent(candidate),
      forgedKey: 'humanApproval',
      forgedValue: forgedHumanApprovalRecord(),
    },
    {
      name: 'review request with supplied-artifact authority',
      candidate: reviewRequestedFixtureCandidate,
      event: (candidate) => mutableHistoryEvent(candidate),
      forgedKey: 'suppliedArtifactApproval',
      forgedValue: {
        reviewerId: null,
        reviewedAt: null,
        approvalRecordedAt: '2026-08-25T00:00:00.000Z',
        approvalAuthority: {
          kind: 'user-authorized supplied review artifact',
          artifactName: 'learnhub-multilingual-review-readable.md',
          artifactSha256: 'ED5D3D613F21DE188DB0512B3701EA9C0C0A6D254FD1C77829FB3E61ECD3310C',
        },
      },
    },
    {
      name: 'change request with human approval authority',
      candidate: () => requestChanges(reviewRequestedFixtureCandidate()),
      event: (candidate) => mutableHistoryEvent(candidate),
      forgedKey: 'humanApproval',
      forgedValue: forgedHumanApprovalRecord(),
    },
    {
      name: 'withdrawal with reviewer identity',
      candidate: () => withdrawLocaleCandidateReview(reviewRequestedFixtureCandidate()),
      event: (candidate) => mutableHistoryEvent(candidate),
      forgedKey: 'reviewerId',
      forgedValue: 'forged-reviewer',
      expectedViolation: 'MLUX-C0001: ru invalid review withdrawal history',
    },
    {
      name: 'approved-to-stale transition with reviewer identity',
      candidate: () =>
        transitionLocaleCandidate(humanApprovedFixtureCandidate(), 'stale') as FixtureCandidate,
      event: (candidate) => mutableHistoryEvent(candidate),
      forgedKey: 'reviewerId',
      forgedValue: 'forged-reviewer',
    },
    {
      name: 'stale-to-draft transition with approval authority',
      candidate: () =>
        transitionLocaleCandidate(
          transitionLocaleCandidate(humanApprovedFixtureCandidate(), 'stale'),
          'draft',
          { newCandidate: 'Reactivated candidate, {{name}}' },
        ) as FixtureCandidate,
      event: (candidate) => mutableHistoryEvent(candidate),
      forgedKey: 'humanApproval',
      forgedValue: forgedHumanApprovalRecord(),
    },
    {
      name: 'ordinary approval with outer reviewer identity',
      candidate: humanApprovedFixtureCandidate,
      event: (candidate) => mutableHistoryEvent(candidate),
      forgedKey: 'reviewerId',
      forgedValue: 'forged-reviewer',
    },
  ];

  it.each(historyOuterShapeAdversaries)(
    'rejects $name outside its owning history-event variant',
    ({
      candidate: createCandidate,
      event: selectEvent,
      forgedKey,
      forgedValue,
      expectedViolation,
    }) => {
      const corpus = fixture();
      const candidate = createCandidate();
      selectEvent(candidate)[forgedKey] = structuredClone(forgedValue);
      (corpus.units[0].locales as unknown as MutableFixtureLocales).ru = candidate;

      expect(validateFixtureCorpus(corpus)).toContain(
        expectedViolation ?? 'MLUX-C0001: ru invalid history event shape',
      );
    },
  );

  const approvalRecordShapeAdversaries: readonly ApprovalRecordShapeAdversary[] = [
    {
      name: 'ordinary approval record with an extra attestation',
      candidate: humanApprovedFixtureCandidate,
      approvalProperty: 'humanApproval',
      mutate: (approval) => {
        approval.reviewerAttestation = 'native-review';
      },
      expectedViolation:
        'MLUX-C0001: ru approved history lacks transition-specific human-native authority',
    },
    {
      name: 'ordinary approval authority with a supplied-artifact member',
      candidate: humanApprovedFixtureCandidate,
      approvalProperty: 'humanApproval',
      mutate: (approval) => {
        (approval.approvalAuthority as MutableHistoryEvent).artifactName =
          'learnhub-multilingual-review-readable.md';
      },
      expectedViolation:
        'MLUX-C0001: ru approved history lacks transition-specific human-native authority',
    },
  ];

  it.each(approvalRecordShapeAdversaries)(
    'rejects $name',
    ({ candidate: createCandidate, approvalProperty, mutate, expectedViolation }) => {
      const corpus = fixture();
      const candidate = createCandidate();
      const approval = mutableHistoryEvent(candidate)[approvalProperty];
      if (!approval || typeof approval !== 'object')
        throw new Error('fixture approval record is missing');
      mutate(approval as MutableHistoryEvent);
      (corpus.units[0].locales as unknown as MutableFixtureLocales).ru = candidate;

      expect(validateFixtureCorpus(corpus)).toContain(expectedViolation);
    },
  );

  it('returns violations instead of throwing for malformed placeholder contracts', () => {
    const corpus = fixture();
    (corpus.units[0] as { placeholdersByLocale?: unknown }).placeholdersByLocale = undefined;
    expect(() => validateCorpus(corpus)).not.toThrow();
    expect(validateCorpus(corpus)).toEqual(
      expect.arrayContaining([
        'MLUX-C0001: invalid locale placeholder contract',
        'MLUX-C0001: ru placeholder mismatch',
        'MLUX-C0001: uz placeholder mismatch',
      ]),
    );
    (corpus.units[0] as { pluralForms?: unknown }).pluralForms = {
      en: { one: 'One {{name}}' },
      ru: { one: 'Один {{name}}' },
      uz: { one: 'Bitta {{name}}' },
    };
    expect(() => validateCorpus(corpus)).not.toThrow();
    expect(validateCorpus(corpus)).toContain('MLUX-C0001: en plural placeholder mismatch');
  });

  it('rejects direct stale-to-draft history that does not contain a genuinely new current candidate', () => {
    const corpus = fixture();
    const candidate = corpus.units[0].locales.ru as FixtureCandidate;
    candidate.status = 'draft';
    candidate.history = [
      {
        type: 'transition',
        from: 'draft',
        to: 'review_requested',
        previousCandidate: candidate.candidate,
        nextCandidate: candidate.candidate,
        sourceRevision: candidate.sourceRevision,
        reviewRequest: {
          taskId: 'FE-067',
          locales: ['ru'],
          unitIds: ['MLUX-C0001'],
          requestedAt: '2026-08-29T12:34:56.789Z',
        },
      },
      {
        type: 'transition',
        from: 'review_requested',
        to: 'stale',
        previousCandidate: candidate.candidate,
        nextCandidate: candidate.candidate,
        sourceRevision: candidate.sourceRevision,
      },
      {
        type: 'transition',
        from: 'stale',
        to: 'draft',
        previousCandidate: candidate.candidate,
        nextCandidate: candidate.candidate,
      },
    ];
    expect(validateCorpus(corpus)).toContain(
      'MLUX-C0001: ru stale -> draft requires a new candidate history',
    );
  });

  it('records and validates a genuinely new stale-to-draft candidate', () => {
    const candidate = fixture().units[0].locales.ru as FixtureCandidate;
    const stale = transitionLocaleCandidate(
      transitionLocaleCandidate(candidate, 'review_requested'),
      'stale',
    );
    const reactivated = transitionLocaleCandidate(stale, 'draft', {
      newCandidate: 'Yangi tarjima, {{name}}',
    });
    const corpus = fixture();
    corpus.units[0].locales.ru = reactivated;
    expect(validateFixtureCorpus(corpus)).toEqual([]);
  });

  it('binds a present stale-to-draft revision to the protected revision active at that event', () => {
    const { corpus, activeRevisionAtReactivation, currentRevision } = staleToDraftHistoryFixture();
    const candidate = corpus.units[0].locales.ru as FixtureCandidate;

    expect(activeRevisionAtReactivation).not.toBe(currentRevision);
    expect(staleToDraftHistoryEvent(candidate).sourceRevision).toBe(activeRevisionAtReactivation);
    expect(validateFixtureCorpus(corpus)).toEqual([]);

    const legacy = structuredClone(corpus);
    Reflect.deleteProperty(
      staleToDraftHistoryEvent(legacy.units[0].locales.ru as FixtureCandidate),
      'sourceRevision',
    );
    expect(validateFixtureCorpus(legacy)).toEqual([]);
  });

  it.each([
    ['null', null],
    ['malformed', 'forged'],
    ['valid-looking but unbound', `sha256:${'0'.repeat(64)}`],
    ['explicit undefined', undefined],
  ])('rejects a present stale-to-draft revision that is %s', (_name, forgedRevision) => {
    const { corpus } = staleToDraftHistoryFixture();
    const candidate = corpus.units[0].locales.ru as FixtureCandidate;
    staleToDraftHistoryEvent(candidate).sourceRevision = forgedRevision;

    expect(validateFixtureCorpus(corpus)).toContain(
      'MLUX-C0001: ru stale -> draft history does not match active protected source revision',
    );
  });

  it('rejects a later current revision when it is forged onto an earlier stale-to-draft event', () => {
    const { corpus, currentRevision } = staleToDraftHistoryFixture();
    const candidate = corpus.units[0].locales.ru as FixtureCandidate;
    staleToDraftHistoryEvent(candidate).sourceRevision = currentRevision;

    expect(validateFixtureCorpus(corpus)).toContain(
      'MLUX-C0001: ru stale -> draft history does not match active protected source revision',
    );
  });

  it.each(['ru', 'uz'] as const)(
    'rejects a forged stale candidate binding for %s before generation',
    (locale) => {
      const corpus = fixture();
      const original = corpus.units[0].locales[locale] as FixtureCandidate;
      const requested = transitionLocaleCandidate(original, 'review_requested');
      (requested.history.at(-1) as { reviewRequest: unknown }).reviewRequest = {
        taskId: 'FE-067',
        locales: [locale],
        unitIds: ['MLUX-C0001'],
        requestedAt: '2026-08-29T12:34:56.789Z',
      };
      const stale = transitionLocaleCandidate(requested, 'stale');
      corpus.units[0].locales[locale] = {
        ...transitionLocaleCandidate(stale, 'draft', {
          newCandidate: 'Genuinely new candidate {{name}}',
        }),
        candidate: original.candidate,
        history: [
          ...stale.history,
          {
            type: 'transition',
            from: 'stale',
            to: 'draft',
            previousCandidate: 'forged prior candidate {{name}}',
            nextCandidate: original.candidate,
          },
        ],
      };
      expect(validateCorpus(corpus)).toContain(
        `MLUX-C0001: ${locale} transition history candidate discontinuity`,
      );
    },
  );

  it('accepts an approval-history candidate replacement with complete human provenance', () => {
    const corpus = fixture();
    const requested = transitionLocaleCandidate(corpus.units[0].locales.ru, 'review_requested');
    const approved = transitionLocaleCandidate(requested, 'approved', {
      humanApproval: {
        reviewerId: 'native-7',
        reviewerName: 'Native Reviewer',
        reviewedAt: '2026-08-23T00:00:00.000Z',
        approvalRecordedAt: '2026-08-23T00:01:00.000Z',
        approvalAuthority: {
          kind: 'human_native_review',
          reviewerId: 'native-7',
          reviewerName: 'Native Reviewer',
        },
      },
    });
    const forgedCandidate = 'Подмененный перевод, {{name}}';
    const forged = structuredClone(approved);
    forged.candidate = forgedCandidate;
    (forged.history[forged.history.length - 1] as { nextCandidate: string }).nextCandidate =
      forgedCandidate;
    corpus.units[0].locales.ru = forged;

    expect(validateFixtureCorpus(corpus)).toEqual([]);
  });

  it('records a legal approved-to-stale transition when protected source content changes', () => {
    const corpus = fixture();
    const requested = transitionLocaleCandidate(corpus.units[0].locales.ru, 'review_requested');
    corpus.units[0].locales.ru = transitionLocaleCandidate(requested, 'approved', {
      humanApproval: {
        reviewerId: 'native-7',
        reviewerName: 'Native Reviewer',
        reviewedAt: '2026-08-23T00:00:00.000Z',
        approvalRecordedAt: '2026-08-23T00:01:00.000Z',
        approvalAuthority: {
          kind: 'human_native_review',
          reviewerId: 'native-7',
          reviewerName: 'Native Reviewer',
        },
      },
    });

    corpus.units[0] = reviseProtectedSource(corpus.units[0], {
      english: 'Welcome back {{name}}',
    });

    expect(corpus.units[0].locales.ru).toMatchObject({ status: 'stale' });
    expect(
      corpus.units[0].locales.ru.history[corpus.units[0].locales.ru.history.length - 1],
    ).toEqual({
      type: 'transition',
      from: 'approved',
      to: 'stale',
      previousCandidate: 'Добро пожаловать, {{name}}',
      nextCandidate: 'Добро пожаловать, {{name}}',
      sourceRevision: corpus.units[0].sourceRevision,
    });
    expect(validateFixtureCorpus(corpus)).toEqual([]);
  });

  it('rejects a canonical key that collides with another unit plural cleanup shape', () => {
    const corpus = fixture();
    const pluralOwner = corpus.units[0];
    pluralOwner.key = 'foo';
    pluralOwner.sourceRevision = protectedSourceFingerprint(pluralOwner);
    pluralOwner.locales.ru.sourceRevision = pluralOwner.sourceRevision;
    pluralOwner.locales.uz.sourceRevision = pluralOwner.sourceRevision;
    const pluralShapedUnit = structuredClone(pluralOwner);
    pluralShapedUnit.id = 'MLUX-C0002';
    pluralShapedUnit.key = 'foo_one';
    pluralShapedUnit.occurrences = [{ id: 'MLUX-O0002', context: 'second fixture owner' }];
    pluralShapedUnit.sourceRevision = protectedSourceFingerprint(pluralShapedUnit);
    pluralShapedUnit.locales.ru.sourceRevision = pluralShapedUnit.sourceRevision;
    pluralShapedUnit.locales.uz.sourceRevision = pluralShapedUnit.sourceRevision;
    corpus.units.push(pluralShapedUnit);
    corpus.summary.translationUnits = 2;
    corpus.summary.sourceOccurrences = 2;
    corpus.migration.sourceOccurrences = 2;

    expect(validateCorpus(corpus)).toContain(
      'MLUX-C0002: namespace/key collides with generated shape of MLUX-C0001 (common:foo_one)',
    );
  });

  it('rejects canonical keys reserved by explicit zero and exact historic cleanup ownership', () => {
    const zeroCorpus = fixture();
    const zeroOwner = zeroCorpus.units[0];
    zeroOwner.key = 'bar';
    zeroOwner.sourceRevision = protectedSourceFingerprint(zeroOwner);
    zeroOwner.locales.ru.sourceRevision = zeroOwner.sourceRevision;
    zeroOwner.locales.uz.sourceRevision = zeroOwner.sourceRevision;
    const zeroShapedUnit = structuredClone(zeroOwner);
    zeroShapedUnit.id = 'MLUX-C0002';
    zeroShapedUnit.key = 'bar_zero';
    zeroShapedUnit.occurrences = [{ id: 'MLUX-O0002', context: 'zero fixture owner' }];
    zeroShapedUnit.sourceRevision = protectedSourceFingerprint(zeroShapedUnit);
    zeroShapedUnit.locales.ru.sourceRevision = zeroShapedUnit.sourceRevision;
    zeroShapedUnit.locales.uz.sourceRevision = zeroShapedUnit.sourceRevision;
    zeroCorpus.units.push(zeroShapedUnit);
    zeroCorpus.summary.translationUnits = 2;
    zeroCorpus.summary.sourceOccurrences = 2;
    zeroCorpus.migration.sourceOccurrences = 2;

    expect(validateCorpus(zeroCorpus)).toContain(
      'MLUX-C0002: namespace/key collides with generated shape of MLUX-C0001 (common:bar_zero)',
    );

    const historicCorpus = structuredClone(draft37Registry);
    const historicOwner = historicCorpus.units.find(
      (unit) => unit.namespace === 'catalog' && unit.key === 'lessonAvailability',
    );
    expect(historicOwner).toBeDefined();
    const historicShapedUnit = structuredClone(historicOwner!);
    historicShapedUnit.id = 'MLUX-C9999';
    historicShapedUnit.key = 'lessonAvailability_custom';
    historicShapedUnit.occurrences = [{ id: 'MLUX-O9999', context: 'historic fixture owner' }];
    historicShapedUnit.sourceRevision = protectedSourceFingerprint(historicShapedUnit);
    historicShapedUnit.locales.ru.sourceRevision = historicShapedUnit.sourceRevision;
    historicShapedUnit.locales.uz.sourceRevision = historicShapedUnit.sourceRevision;
    historicCorpus.units.push(historicShapedUnit);
    historicCorpus.summary.translationUnits += 1;
    historicCorpus.summary.sourceOccurrences += 1;
    historicCorpus.migration.sourceOccurrences += 1;

    expect(validateCorpus(historicCorpus)).toContain(
      `${historicShapedUnit.id}: namespace/key collides with generated shape of ${historicOwner!.id} (catalog:lessonAvailability_custom)`,
    );
  });

  it('preserves non-colliding plural-shaped lookalikes in every locale output', () => {
    const corpus = fixture();
    const pluralOwner = corpus.units[0];
    pluralOwner.key = 'foo';
    pluralOwner.sourceRevision = protectedSourceFingerprint(pluralOwner);
    pluralOwner.locales.ru.sourceRevision = pluralOwner.sourceRevision;
    pluralOwner.locales.uz.sourceRevision = pluralOwner.sourceRevision;
    const lookalike = structuredClone(pluralOwner);
    lookalike.id = 'MLUX-C0002';
    lookalike.key = 'foo_oneness';
    lookalike.occurrences = [{ id: 'MLUX-O0002', context: 'lookalike fixture owner' }];
    lookalike.sourceRevision = protectedSourceFingerprint(lookalike);
    lookalike.locales.ru.sourceRevision = lookalike.sourceRevision;
    lookalike.locales.uz.sourceRevision = lookalike.sourceRevision;
    corpus.units.push(lookalike);
    corpus.summary.translationUnits = 2;
    corpus.summary.sourceOccurrences = 2;
    corpus.migration.sourceOccurrences = 2;

    expect(validateFixtureCorpus(corpus)).toEqual([]);
    for (const locale of ['en', 'ru', 'uz'])
      expect(generateResources(corpus)[locale].common).toEqual(
        expect.objectContaining({
          foo: expect.any(String),
          foo_oneness: expect.any(String),
        }),
      );
  });

  it('allows protected-source identity evolution while rejecting invalid per-unit migration provenance before generation', () => {
    const mutated = structuredClone(draft37Registry);
    mutated.source.sha256 = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    mutated.migration.sourceSha256 = mutated.source.sha256;
    delete (mutated.units[0] as { migrationProvenance?: unknown }).migrationProvenance;

    expect(validateCorpus(mutated)).toEqual(
      expect.arrayContaining([`${mutated.units[0].id}: invalid migration provenance`]),
    );
  });

  it('admits a post-DRAFT-37 draft unit without relaxing historical identity or approval validation', () => {
    const extended = structuredClone(draft37Registry);
    const next = structuredClone(extended.units[extended.units.length - 1]);
    if (!next) throw new Error('canonical registry must contain a unit');
    next.id = 'MLUX-C9999';
    next.namespace = 'catalog';
    next.key = 'postDraft37PriceTrigger';
    next.english = 'Price';
    next.unitLifecycle = 'active';
    next.occurrences = [
      {
        id: 'MLUX-O9999',
        context: 'src/widgets/catalog-filter-bar/CatalogFilterBar.tsx — Price trigger',
      },
    ];
    next.placeholdersByLocale = { en: [], ru: [], uz: [] };
    next.renderingContract = null;
    next.pluralForms = null;
    next.locales.ru = {
      candidate: 'Цена',
      status: 'draft',
      reviewerId: null,
      verdict: null,
      requestedAt: null,
      reviewedAt: null,
      approvalRecordedAt: null,
      history: [],
      sourceRevision: '',
      approvalAuthority: null,
    };
    next.locales.uz = {
      candidate: 'Narx',
      status: 'draft',
      reviewerId: null,
      verdict: null,
      requestedAt: null,
      reviewedAt: null,
      approvalRecordedAt: null,
      history: [],
      sourceRevision: '',
      approvalAuthority: null,
    };
    next.migrationProvenance.ownerTasks = ['FE-060'];
    next.sourceRevision = protectedSourceFingerprint(next);
    next.locales.ru.sourceRevision = next.sourceRevision;
    next.locales.uz.sourceRevision = next.sourceRevision;
    extended.units.push(next);
    extended.summary.translationUnits += 1;
    extended.summary.sourceOccurrences += 1;

    expect(validateCorpus(extended)).toEqual([]);
    expect(generateResources(extended).en.catalog.postDraft37PriceTrigger).toBe('Price');
  });

  it('validates DRAFT-37 exclusion identity, uniqueness, provenance, and supported status semantics', () => {
    const malformed = structuredClone(draft37Registry);
    malformed.exclusions[0] = {} as (typeof malformed.exclusions)[number];
    expect(validateCorpus(malformed)).toContain('invalid exclusion id');

    const duplicate = structuredClone(draft37Registry);
    duplicate.exclusions[1].id = duplicate.exclusions[0].id;
    expect(validateCorpus(duplicate)).toEqual(
      expect.arrayContaining([
        'MLUX-X001: duplicate exclusion id',
        'DRAFT-37 exclusion identity mismatch',
      ]),
    );

    const missingProvenance = structuredClone(draft37Registry);
    delete (missingProvenance.exclusions[0] as { boundaryReason?: string }).boundaryReason;
    expect(validateCorpus(missingProvenance)).toContain('MLUX-X001: invalid exclusion provenance');

    const unsupportedStatus = structuredClone(draft37Registry);
    (unsupportedStatus.exclusions[0] as { status: string }).status = 'Unknown';
    expect(validateCorpus(unsupportedStatus)).toContain('MLUX-X001: invalid exclusion provenance');

    const changedIdentity = structuredClone(draft37Registry);
    changedIdentity.exclusions[0].id = 'MLUX-X013';
    expect(validateCorpus(changedIdentity)).toContain('DRAFT-37 exclusion identity mismatch');
  });

  it('blocks retired removal when a source consumer remains outside registry occurrences', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fe066-source-'));
    await writeFile(
      join(directory, 'consumer.ts'),
      "import { useTranslation } from 'react-i18next'; export function Consumer() { const { t } = useTranslation(); return t('common:welcome'); }",
      'utf8',
    );
    const corpus = fixture();
    corpus.units[0].unitLifecycle = 'retired';
    corpus.units[0].occurrences = [];
    (
      corpus.units[0] as (typeof corpus.units)[number] & {
        retirement?: { reason: string; sourceRevision: string };
      }
    ).retirement = { reason: 'removed', sourceRevision: corpus.units[0].sourceRevision };
    expect(await retiredConsumerViolations(corpus, directory)).toEqual([
      'MLUX-C0001: retired unit has source consumer consumer.ts',
    ]);
  });

  it('detects translation calls but not ordinary quoted retired keys, including metacharacters', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fe066-retired-'));
    const corpus = fixture();
    corpus.units[0].unitLifecycle = 'retired';
    corpus.units[0].key = 'page.name';
    corpus.units[0].occurrences = [];
    (
      corpus.units[0] as (typeof corpus.units)[number] & {
        retirement?: { reason: string; sourceRevision: string };
      }
    ).retirement = { reason: 'removed', sourceRevision: corpus.units[0].sourceRevision };
    await writeFile(join(directory, 'identifier.ts'), 'const pageName = 1;', 'utf8');
    await writeFile(
      join(directory, 'consumer.ts'),
      "import { useTranslation } from 'react-i18next'; export function Consumer() { const { t } = useTranslation(); return t('common:page.name'); }",
      'utf8',
    );
    await writeFile(join(directory, 'ordinary.ts'), "const retired = 'page.name';", 'utf8');
    await writeFile(
      join(directory, 'key-only.ts'),
      "import { useTranslation } from 'react-i18next'; export function Consumer() { const { t } = useTranslation(); return t('page.name'); }",
      'utf8',
    );
    expect(await retiredConsumerViolations(corpus, directory)).toEqual([
      'MLUX-C0001: retired unit has source consumer consumer.ts',
      'MLUX-C0001: retired unit has source consumer key-only.ts',
    ]);
  });

  it('does not treat an ordinary common-domain string as a retired translation consumer', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fe066-retired-domain-'));
    const corpus = fixture();
    corpus.units[0].unitLifecycle = 'retired';
    corpus.units[0].key = 'remove';
    corpus.units[0].occurrences = [];
    (
      corpus.units[0] as (typeof corpus.units)[number] & {
        retirement?: { reason: string; sourceRevision: string };
      }
    ).retirement = { reason: 'removed', sourceRevision: corpus.units[0].sourceRevision };
    await writeFile(join(directory, 'ordinary.ts'), "const verb = 'remove';", 'utf8');
    await writeFile(
      join(directory, 'consumer.ts'),
      "import { useTranslation } from 'react-i18next'; export function Consumer() { const { t } = useTranslation(); return t('remove'); }",
      'utf8',
    );

    expect(await retiredConsumerViolations(corpus, directory)).toEqual([
      'MLUX-C0001: retired unit has source consumer consumer.ts',
    ]);
  });

  it.each([
    ['src/pages/course-detail-page', 'CourseOutline.tsx'],
    ['src/pages/instructor-course-editor-page', 'InstructorCourseEditorPage.tsx'],
    ['src/pages/instructor-lesson-editor-page', 'InstructorLessonEditorPage.tsx'],
  ])(
    'detects the established direct indexed-map translation consumer in %s',
    async (_sourceRoot, filename) => {
      const corpus = structuredClone(draft37Registry);
      const unit = corpus.units.find((candidate) => candidate.id === 'MLUX-C0205');
      expect(unit).toBeDefined();
      if (!unit) return;
      unit.unitLifecycle = 'retired';
      unit.occurrences = [];

      await expect(retiredConsumerViolations(corpus, 'src')).resolves.toContain(
        `MLUX-C0205: retired unit has source consumer ${filename}`,
      );
      expect(unit).toMatchObject({ namespace: 'instructor', key: 'courseEditorPdf' });
    },
  );

  it('reports every current direct indexed-map owner without relying on an unrelated literal', async () => {
    const corpus = structuredClone(draft37Registry);
    const unit = corpus.units.find((candidate) => candidate.id === 'MLUX-C0205');
    expect(unit).toBeDefined();
    if (!unit) return;
    unit.unitLifecycle = 'retired';
    unit.occurrences = [];

    await expect(retiredConsumerViolations(corpus, 'src')).resolves.toEqual(
      expect.arrayContaining([
        'MLUX-C0205: retired unit has source consumer CourseOutline.tsx',
        'MLUX-C0205: retired unit has source consumer InstructorCourseEditorPage.tsx',
        'MLUX-C0205: retired unit has source consumer InstructorLessonEditorPage.tsx',
      ]),
    );
  });

  it.each([
    ['MLUX-C0209', 'courseEditorDeleteCoursePermanent'],
    ['MLUX-C0210', 'courseEditorDeleteLessonPermanent'],
  ])('detects the established helper-literal consumer for %s', async (id, key) => {
    const corpus = structuredClone(draft37Registry);
    const unit = corpus.units.find((candidate) => candidate.id === id);
    expect(unit).toBeDefined();
    if (!unit) return;
    unit.unitLifecycle = 'retired';
    unit.occurrences = [];

    await expect(retiredConsumerViolations(corpus, 'src')).resolves.toEqual(
      expect.arrayContaining([
        `${id}: retired unit has source consumer DestructiveCourseEditorSection.tsx`,
      ]),
    );
    expect(unit).toMatchObject({ namespace: 'instructor', key });
  });

  it.each([
    ['MLUX-C0037', 'routes', 'courseCatalogTitle', 'RouteErrorBoundary.tsx'],
    ['MLUX-C0507', 'cart', 'cartDataUnavailable', 'CartPage.tsx'],
  ])(
    'detects the established cross-owner property-key translation consumer for %s',
    async (id, namespace, key, filename) => {
      const corpus = structuredClone(draft37Registry);
      const unit = corpus.units.find((candidate) => candidate.id === id);
      expect(unit).toBeDefined();
      if (!unit) return;
      unit.unitLifecycle = 'retired';
      unit.occurrences = [];

      await expect(retiredConsumerViolations(corpus, 'src')).resolves.toContain(
        `${id}: retired unit has source consumer ${filename}`,
      );
      expect(unit).toMatchObject({ namespace, key });
    },
  );

  it.each(['MLUX-C0515', 'MLUX-C0516'])(
    'detects the isolated conditional cart failure title-key flow for %s',
    async (id) => {
      const corpus = structuredClone(draft37Registry);
      const unit = corpus.units.find((candidate) => candidate.id === id);
      expect(unit).toBeDefined();
      if (!unit) return;
      unit.unitLifecycle = 'retired';
      unit.occurrences = [];

      await expect(retiredConsumerViolations(corpus, 'src')).resolves.toContain(
        `${id}: retired unit has source consumer CartPage.tsx`,
      );
    },
  );

  it('keeps per-file property identities isolated in the combined current source inventory', async () => {
    const corpus = structuredClone(draft37Registry);
    for (const id of ['MLUX-C0037', 'MLUX-C0515', 'MLUX-C0516']) {
      const unit = corpus.units.find((candidate) => candidate.id === id);
      if (!unit) throw new Error(`missing ${id}`);
      unit.unitLifecycle = 'retired';
      unit.occurrences = [];
    }
    const violations = await retiredConsumerViolations(corpus, 'src');
    expect(violations).toEqual(
      expect.arrayContaining([
        'MLUX-C0037: retired unit has source consumer RouteErrorBoundary.tsx',
        'MLUX-C0515: retired unit has source consumer CartPage.tsx',
        'MLUX-C0516: retired unit has source consumer CartPage.tsx',
      ]),
    );
    expect(violations).not.toContain(
      'MLUX-C0037: retired unit has source consumer CatalogPage.tsx',
    );
  });

  it('does not infer an indirect consumer from an unrelated map key', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fe066-indirect-key-'));
    const corpus = fixture();
    corpus.units[0].unitLifecycle = 'retired';
    corpus.units[0].namespace = 'catalog';
    corpus.units[0].key = 'oldest';
    await writeFile(
      join(directory, 'ordinary.ts'),
      "const OTHER_LABEL = { value: { key: 'catalog:oldest' } };\nconst label = SORT_LABEL.sort;\nt(label.key);",
      'utf8',
    );

    expect(await retiredConsumerViolations(corpus, directory)).toEqual([]);
  });

  it('excludes deterministic generated output but keeps hand-authored retired consumers', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fe066-generated-'));
    const corpus = fixture();
    corpus.units[0].unitLifecycle = 'retired';
    corpus.units[0].occurrences = [];
    (
      corpus.units[0] as (typeof corpus.units)[number] & {
        retirement?: { reason: string; sourceRevision: string };
      }
    ).retirement = { reason: 'removed', sourceRevision: corpus.units[0].sourceRevision };
    await writeFile(
      join(directory, 'generated-resources.ts'),
      "// Generated by localization:sync. Do not edit.\nexport const stale = 'common:welcome';\n",
      'utf8',
    );

    expect(await retiredConsumerViolations(corpus, directory)).toEqual([]);

    await writeFile(
      join(directory, 'consumer.ts'),
      "import { useTranslation } from 'react-i18next'; export function Consumer() { const { t } = useTranslation(); return t('common:welcome'); }",
      'utf8',
    );
    expect(await retiredConsumerViolations(corpus, directory)).toEqual([
      'MLUX-C0001: retired unit has source consumer consumer.ts',
    ]);
  });

  it('replaces a baseline singular key with the current plural shape', () => {
    const corpus = fixture();
    const unit = corpus.units[0] as unknown as {
      pluralForms: Record<string, Record<string, string>> | null;
      sourceRevision: string;
      locales: Record<'ru' | 'uz', { sourceRevision: string }>;
    };
    unit.pluralForms = Object.fromEntries(
      ['en', 'ru', 'uz'].map((locale) => [
        locale,
        Object.fromEntries(
          [
            ...new globalThis.Intl.PluralRules(locale).resolvedOptions().pluralCategories,
            'zero',
          ].map((category) => [category, `${locale} ${category} {{name}}`]),
        ),
      ]),
    );
    unit.sourceRevision = protectedSourceFingerprint(corpus.units[0]);
    unit.locales.ru.sourceRevision = unit.sourceRevision;
    unit.locales.uz.sourceRevision = unit.sourceRevision;
    (
      corpus as unknown as {
        baselineResources: Record<string, Record<string, Record<string, string>>>;
      }
    ).baselineResources = Object.fromEntries(
      ['en', 'ru', 'uz'].map((locale) => [
        locale,
        { common: { welcome: `${locale} obsolete singular`, preserved: `${locale} preserved` } },
      ]),
    );

    expect(validateFixtureCorpus(corpus)).toEqual([]);
    for (const locale of ['en', 'ru', 'uz']) {
      const generated = generateResources(corpus)[locale].common;
      expect(generated).not.toHaveProperty('welcome');
      expect(generated).toMatchObject({
        preserved: `${locale} preserved`,
        welcome_zero: `${locale} zero {{name}}`,
      });
    }
  });

  it('replaces baseline plural keys with the current singular shape', () => {
    const corpus = fixture();
    (
      corpus as unknown as {
        baselineResources: Record<string, Record<string, Record<string, string>>>;
      }
    ).baselineResources = Object.fromEntries(
      ['en', 'ru', 'uz'].map((locale) => [
        locale,
        {
          common: {
            preserved: `${locale} preserved`,
            welcome_one: `${locale} stale one`,
            welcome_other: `${locale} stale other`,
            welcome_few: `${locale} stale few`,
            welcome_many: `${locale} stale many`,
            welcome_zero: `${locale} stale zero`,
          },
        },
      ]),
    );

    expect(validateFixtureCorpus(corpus)).toEqual([]);
    expect(generateResources(corpus)).toMatchObject({
      en: { common: { welcome: 'Welcome {{name}}', preserved: 'en preserved' } },
      ru: { common: { welcome: 'Добро пожаловать, {{name}}', preserved: 'ru preserved' } },
      uz: { common: { welcome: 'Xush kelibsiz, {{name}}', preserved: 'uz preserved' } },
    });
    for (const locale of ['en', 'ru', 'uz']) {
      const generated = generateResources(corpus)[locale].common;
      for (const suffix of [
        ...new globalThis.Intl.PluralRules(locale).resolvedOptions().pluralCategories,
        'zero',
      ])
        expect(generated).not.toHaveProperty(`welcome_${suffix}`);
    }
  });

  it('removes stale plural keys for retired units without a current plural declaration', () => {
    const corpus = fixture();
    const unit = corpus.units[0] as (typeof corpus.units)[number] & {
      retirement?: { reason: string; sourceRevision: string };
    };
    unit.unitLifecycle = 'retired';
    unit.occurrences = [];
    unit.sourceRevision = protectedSourceFingerprint(unit);
    unit.locales.ru.sourceRevision = unit.sourceRevision;
    unit.locales.uz.sourceRevision = unit.sourceRevision;
    unit.retirement = { reason: 'obsolete', sourceRevision: unit.sourceRevision };
    corpus.summary.sourceOccurrences = 0;
    corpus.migration.sourceOccurrences = 0;
    (
      corpus as unknown as {
        baselineResources: Record<string, Record<string, Record<string, string>>>;
      }
    ).baselineResources = Object.fromEntries(
      ['en', 'ru', 'uz'].map((locale) => [
        locale,
        {
          common: {
            preserved: `${locale} preserved`,
            welcome: `${locale} stale base`,
            welcome_one: `${locale} stale one`,
            welcome_other: `${locale} stale other`,
            welcome_few: `${locale} stale few`,
            welcome_many: `${locale} stale many`,
            welcome_zero: `${locale} stale zero`,
          },
        },
      ]),
    );

    expect(validateFixtureCorpus(corpus)).toEqual([]);
    for (const locale of ['en', 'ru', 'uz'])
      expect(generateResources(corpus)[locale].common).toEqual({
        preserved: `${locale} preserved`,
      });
  });

  it('removes an exact historically owned plural suffix without deleting an unrelated lookalike', () => {
    const corpus = structuredClone(draft37Registry);
    const baselineResources = corpus.baselineResources as Record<
      'en' | 'ru' | 'uz',
      Record<string, Record<string, string>>
    >;
    const unit = corpus.units.find(
      (candidate) => candidate.namespace === 'catalog' && candidate.key === 'lessonAvailability',
    );

    expect(unit).toBeDefined();
    for (const locale of ['en', 'ru', 'uz'] as const) {
      const namespace = (baselineResources[locale].catalog ??= {});
      namespace.lessonAvailability_custom = `${locale} historic generated plural`;
      namespace.lessonAvailability_customLookalike = `${locale} unrelated preserved value`;
    }

    expect(validateFixtureCorpus(corpus)).toEqual([]);
    const generated = generateResources(corpus);
    for (const locale of ['en', 'ru', 'uz'] as const) {
      expect(generated[locale].catalog).not.toHaveProperty('lessonAvailability_custom');
      expect(generated[locale].catalog).toMatchObject({
        lessonAvailability_customLookalike: `${locale} unrelated preserved value`,
      });
    }
  });

  it('removes retired canonical base and plural keys inherited from baseline resources', () => {
    const corpus = fixture();
    const unit = corpus.units[0] as unknown as {
      key: string;
      pluralForms: Record<string, Record<string, string>> | null;
      unitLifecycle: string;
      occurrences: unknown[];
      retirement?: { reason: string; sourceRevision: string };
      sourceRevision: string;
      locales: Record<'ru' | 'uz', { sourceRevision: string }>;
    };
    unit.pluralForms = Object.fromEntries(
      ['en', 'ru', 'uz'].map((locale) => [
        locale,
        Object.fromEntries(
          [...new Intl.PluralRules(locale).resolvedOptions().pluralCategories, 'zero'].map(
            (category) => [category, `${locale} ${category} {{name}}`],
          ),
        ),
      ]),
    );
    unit.unitLifecycle = 'retired';
    unit.occurrences = [];
    unit.sourceRevision = protectedSourceFingerprint(corpus.units[0]);
    unit.locales.ru.sourceRevision = unit.sourceRevision;
    unit.locales.uz.sourceRevision = unit.sourceRevision;
    unit.retirement = { reason: 'obsolete', sourceRevision: unit.sourceRevision };
    corpus.summary.sourceOccurrences = 0;
    corpus.migration.sourceOccurrences = 0;
    (
      corpus as unknown as {
        baselineResources: Record<string, Record<string, Record<string, string>>>;
      }
    ).baselineResources = Object.fromEntries(
      ['en', 'ru', 'uz'].map((locale) => [
        locale,
        {
          common: {
            welcome: `${locale} base`,
            preserved: `${locale} preserved`,
            ...Object.fromEntries(
              Object.keys(unit.pluralForms?.[locale] ?? {}).map((category) => [
                `welcome_${category}`,
                `${locale} ${category}`,
              ]),
            ),
          },
        },
      ]),
    );

    expect(validateFixtureCorpus(corpus)).toEqual([]);
    for (const locale of ['en', 'ru', 'uz']) {
      const generated = generateResources(corpus)[locale].common;
      expect(generated).toEqual({ preserved: `${locale} preserved` });
    }
  });

  it('requires every Intl.PluralRules category for each supported locale', () => {
    const corpus = fixture();
    const unit = corpus.units[0] as unknown as {
      pluralForms: Record<string, Record<string, string>> | null;
      sourceRevision: string;
      locales: Record<'ru' | 'uz', { sourceRevision: string }>;
    };
    unit.pluralForms = Object.fromEntries(
      ['en', 'ru', 'uz'].map((locale) => [
        locale,
        Object.fromEntries(
          [...new Intl.PluralRules(locale).resolvedOptions().pluralCategories, 'zero'].map(
            (category) => [category, `${locale} ${category} {{name}}`],
          ),
        ),
      ]),
    );
    unit.sourceRevision = protectedSourceFingerprint(corpus.units[0]);
    unit.locales.ru.sourceRevision = unit.sourceRevision;
    unit.locales.uz.sourceRevision = unit.sourceRevision;
    expect(validateFixtureCorpus(corpus)).toEqual([]);

    const missingCategory = new Intl.PluralRules('ru').resolvedOptions().pluralCategories[0];
    delete unit.pluralForms.ru[missingCategory];
    unit.sourceRevision = protectedSourceFingerprint(corpus.units[0]);
    unit.locales.ru.sourceRevision = unit.sourceRevision;
    unit.locales.uz.sourceRevision = unit.sourceRevision;
    expect(validateCorpus(corpus)).toContain(
      'MLUX-C0001: ru plural forms missing required categories',
    );
  });

  it('accepts explicit zero but rejects an arbitrary plural suffix before it can be admitted', () => {
    const corpus = fixture();
    const unit = corpus.units[0] as unknown as FixturePluralUnit;
    unit.pluralForms = Object.fromEntries(
      ['en', 'ru', 'uz'].map((locale) => [
        locale,
        Object.fromEntries(
          [
            ...new globalThis.Intl.PluralRules(locale).resolvedOptions().pluralCategories,
            'zero',
          ].map((category) => [category, `${locale} ${category} {{name}}`]),
        ),
      ]),
    );
    unit.sourceRevision = protectedSourceFingerprint(corpus.units[0]);
    unit.locales.ru.sourceRevision = unit.sourceRevision;
    unit.locales.uz.sourceRevision = unit.sourceRevision;

    expect(validateFixtureCorpus(corpus)).toEqual([]);

    unit.pluralForms.en.custom = 'en stale custom {{name}}';
    unit.sourceRevision = protectedSourceFingerprint(corpus.units[0]);
    unit.locales.ru.sourceRevision = unit.sourceRevision;
    unit.locales.uz.sourceRevision = unit.sourceRevision;

    expect(validateCorpus(corpus)).toContain(
      'MLUX-C0001: en plural forms contain unsupported categories: custom',
    );
  });

  it('returns a missing generated-output violation without throwing', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fe066-check-'));
    const registryPath = join(directory, 'registry.json');
    await writeFile(registryPath, JSON.stringify(draft37Registry), 'utf8');
    await expect(
      checkCorpus({
        registryPath,
        outputPath: join(directory, 'missing.ts'),
        sourceRoot: 'src',
      }),
    ).resolves.toEqual([expect.stringContaining('generated resources cannot be read')]);
  });

  it('rejects restoration that reuses the retired source revision or an approved candidate', () => {
    const corpus = fixture();
    const unit = corpus.units[0] as (typeof corpus.units)[number] & {
      retirementHistory?: { reason: string; sourceRevision: string }[];
    };
    unit.retirementHistory = [{ reason: 'retired', sourceRevision: unit.sourceRevision }];
    unit.locales.ru = transitionLocaleCandidate(
      transitionLocaleCandidate(unit.locales.ru, 'review_requested'),
      'approved',
      {
        humanApproval: {
          reviewerId: 'native-7',
          reviewerName: 'Native Reviewer',
          reviewedAt: '2026-08-23T00:00:00.000Z',
          approvalRecordedAt: '2026-08-23T00:01:00.000Z',
          approvalAuthority: {
            kind: 'human_native_review',
            reviewerId: 'native-7',
            reviewerName: 'Native Reviewer',
          },
        },
      },
    );
    expect(validateCorpus(corpus)).toEqual(
      expect.arrayContaining([
        'MLUX-C0001: restored unit must use a new source revision',
        'MLUX-C0001: restored ru candidate must be a new non-approved draft',
        'MLUX-C0001: restored uz candidate must be a new non-approved draft',
      ]),
    );
  });

  it('rejects an active unit that retains current retirement provenance', () => {
    const corpus = fixture();
    (
      corpus.units[0] as (typeof corpus.units)[number] & {
        retirement?: { reason: string; sourceRevision: string };
      }
    ).retirement = { reason: 'retired', sourceRevision: corpus.units[0].sourceRevision };

    expect(validateCorpus(corpus)).toContain(
      'MLUX-C0001: active unit retains current retirement provenance',
    );
  });

  it('rejects an approved candidate whose verdict contradicts its terminal approval event', () => {
    const corpus = fixture();
    const approved = transitionLocaleCandidate(
      transitionLocaleCandidate(corpus.units[0].locales.ru, 'review_requested'),
      'approved',
      {
        humanApproval: {
          reviewerId: 'native-7',
          reviewerName: 'Native Reviewer',
          reviewedAt: '2026-08-23T00:00:00.000Z',
          approvalRecordedAt: '2026-08-23T00:01:00.000Z',
          approvalAuthority: {
            kind: 'human_native_review',
            reviewerId: 'native-7',
            reviewerName: 'Native Reviewer',
          },
        },
      },
    );
    corpus.units[0].locales.ru = { ...approved, verdict: 'changes_requested' };

    expect(validateCorpus(corpus)).toContain(
      'MLUX-C0001: ru approved candidate lacks internally consistent human-native authority',
    );
  });

  it('clears redundant reviewer metadata when approved candidates become stale and draft again', () => {
    const corpus = fixture();
    const approved = transitionLocaleCandidate(
      transitionLocaleCandidate(corpus.units[0].locales.ru, 'review_requested'),
      'approved',
      {
        humanApproval: {
          reviewerId: 'native-7',
          reviewerName: 'Native Reviewer',
          reviewedAt: '2026-08-23T00:00:00.000Z',
          approvalRecordedAt: '2026-08-23T00:01:00.000Z',
          approvalAuthority: {
            kind: 'human_native_review',
            reviewerId: 'native-7',
            reviewerName: 'Native Reviewer',
          },
        },
      },
    );
    expect(approved).not.toHaveProperty('reviewerName');
    const stale = transitionLocaleCandidate(approved, 'stale');
    const draft = transitionLocaleCandidate(stale, 'draft', {
      newCandidate: 'Добро пожаловать снова, {{name}}',
    });
    expect(stale).not.toHaveProperty('reviewerName');
    expect(draft).not.toHaveProperty('reviewerName');
    expect(stale).toMatchObject({ reviewerId: null, verdict: null });
    expect(draft).toMatchObject({ reviewerId: null, verdict: null });
    corpus.units[0].locales.ru = draft;
    expect(validateFixtureCorpus(corpus)).toEqual([]);

    corpus.units[0].locales.ru = { ...draft, reviewerName: 'Native Reviewer' };
    expect(validateCorpus(corpus)).toContain(
      'MLUX-C0001: ru non-approved candidate retains approval metadata',
    );
  });

  it('allows restoration only with a new revision and new non-approved locale candidates', () => {
    const corpus = fixture();
    const prior = corpus.units[0];
    const approved = transitionLocaleCandidate(
      transitionLocaleCandidate(prior.locales.ru, 'review_requested'),
      'approved',
      {
        humanApproval: {
          reviewerId: 'native-7',
          reviewerName: 'Native Reviewer',
          reviewedAt: '2026-08-23T00:00:00.000Z',
          approvalRecordedAt: '2026-08-23T00:01:00.000Z',
          approvalAuthority: {
            kind: 'human_native_review',
            reviewerId: 'native-7',
            reviewerName: 'Native Reviewer',
          },
        },
      },
    );
    const revised = reviseProtectedSource(
      { ...prior, locales: { ...prior.locales, ru: approved } },
      { english: 'Welcome back {{name}}' },
    );
    const restored = {
      ...revised,
      retirementHistory: [{ reason: 'retired', sourceRevision: prior.sourceRevision }],
      locales: {
        ru: transitionLocaleCandidate(revised.locales.ru, 'draft', {
          newCandidate: 'Добро пожаловать снова, {{name}}',
        }),
        uz: transitionLocaleCandidate(
          {
            ...revised.locales.uz,
            status: 'stale',
            history: [
              {
                type: 'source_revision',
                previousSourceRevision: prior.sourceRevision,
                sourceRevision: revised.sourceRevision,
              },
              {
                type: 'transition',
                from: 'draft',
                to: 'review_requested',
                previousCandidate: revised.locales.uz.candidate,
                nextCandidate: revised.locales.uz.candidate,
                sourceRevision: revised.sourceRevision,
                reviewRequest: {
                  taskId: 'FE-067',
                  locales: ['uz'],
                  unitIds: ['MLUX-C0001'],
                  requestedAt: '2026-08-29T12:34:56.789Z',
                },
              },
              {
                type: 'transition',
                from: 'review_requested',
                to: 'stale',
                previousCandidate: revised.locales.uz.candidate,
                nextCandidate: revised.locales.uz.candidate,
                sourceRevision: revised.sourceRevision,
              },
            ],
          },
          'draft',
          { newCandidate: 'Yana xush kelibsiz, {{name}}' },
        ),
      },
    };
    corpus.units[0] = restored;
    expect(validateFixtureCorpus(corpus)).toEqual([]);
  });

  it('rejects a restoration source-revision chain disconnected from the retained retirement', () => {
    const { corpus } = restoredFixture();
    const forgedRevision = `sha256:${'f'.repeat(64)}`;
    for (const locale of ['ru', 'uz'] as const) {
      const sourceEvent = fixtureSourceRevisionEvents(
        corpus.units[0].locales[locale] as FixtureCandidate,
      )[0];
      expect(sourceEvent).toBeDefined();
      if (sourceEvent) sourceEvent.previousSourceRevision = forgedRevision;
    }

    expect(validateCorpus(corpus)).toEqual(
      expect.arrayContaining([
        'MLUX-C0001: restored ru candidate history is not bound to retained retirement revision',
        'MLUX-C0001: restored uz candidate history is not bound to retained retirement revision',
      ]),
    );
  });

  it('accepts a restoration chain with multiple protected revisions after retirement', () => {
    const { corpus, retiredSourceRevision } = restoredFixture(true);
    for (const locale of ['ru', 'uz'] as const) {
      const sourceEvents = fixtureSourceRevisionEvents(
        corpus.units[0].locales[locale] as FixtureCandidate,
      );
      expect(sourceEvents).toHaveLength(2);
      expect(sourceEvents[0]).toMatchObject({ previousSourceRevision: retiredSourceRevision });
      expect(sourceEvents[1]).toMatchObject({ sourceRevision: corpus.units[0].sourceRevision });
    }
    expect(validateFixtureCorpus(corpus)).toEqual([]);
  });

  it('keeps prior output untouched when schema validation or generation fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fe066-atomic-'));
    const registryPath = join(directory, 'registry.json');
    const outputPath = join(directory, 'generated.ts');
    const corpus = fixture();
    corpus.units[0].locales.ru.candidate = 'missing placeholder';
    await writeFile(registryPath, JSON.stringify(corpus), 'utf8');
    await writeFile(outputPath, 'prior output\n', 'utf8');
    await expect(syncCorpus({ registryPath, outputPath, sourceRoot: directory })).rejects.toThrow(
      'placeholder mismatch',
    );
    await expect(readFile(outputPath, 'utf8')).resolves.toBe('prior output\n');
  });

  it('renders every canonical i18next named singular and plural form through installed i18next', async () => {
    const units = draft37Registry.units.filter(
      (unit) => unit.renderingContract?.mode === 'i18next',
    );
    expect(units.length).toBeGreaterThan(0);
    for (const unit of units) {
      for (const locale of ['en', 'ru', 'uz'] as const) {
        const variables = Object.fromEntries(
          unit.placeholdersByLocale[locale].map((name) => [name, `${locale}-${name}`]),
        );
        const instance = i18next.createInstance();
        await instance.init({
          lng: locale,
          fallbackLng: false,
          interpolation: { escapeValue: false },
          resources: {
            [locale]: {
              translation: {
                singular: locale === 'en' ? unit.english : unit.locales[locale].candidate,
                ...(unit.pluralForms === null
                  ? {}
                  : Object.fromEntries(
                      Object.entries(unit.pluralForms[locale]).map(([category, value]) => [
                        `plural_${category}`,
                        value,
                      ]),
                    )),
              },
            },
          },
        });
        expect(instance.t('singular', variables)).not.toMatch(/{{[A-Za-z]/);
        if (unit.pluralForms !== null)
          for (const category of Object.keys(unit.pluralForms[locale]))
            expect(instance.t(`plural_${category}`, variables)).not.toMatch(/{{[A-Za-z]/);
      }
    }
  });

  it('renders the five declared manual templates with deterministic single-brace substitution', () => {
    const manualIds = new Set([
      'MLUX-C0209',
      'MLUX-C0210',
      'MLUX-C0360',
      'MLUX-C0361',
      'MLUX-C0364',
    ]);
    const units = draft37Registry.units.filter((unit) => manualIds.has(unit.id));
    expect(units).toHaveLength(5);
    for (const unit of units) {
      expect(unit.renderingContract).toEqual({ mode: 'manual_template' });
      for (const locale of ['en', 'ru', 'uz'] as const) {
        const template = locale === 'en' ? unit.english : unit.locales[locale].candidate;
        const values = Object.fromEntries(
          unit.placeholdersByLocale[locale].map((name) => [name, `${locale}-${name}`]),
        );
        const rendered = template.replace(
          /\{([A-Za-z][A-Za-z0-9_]*)\}/g,
          (_, name: string) => values[name],
        );
        expect(rendered).not.toMatch(/[{}]/);
      }
    }
  });

  it.each([
    ['{{name}', 'i18next'],
    ['{name}}', 'i18next'],
    ['{name}', 'i18next'],
    ['{{name}}', 'manual_template'],
    ['{name}}', 'manual_template'],
  ])(
    'rejects malformed or cross-mode placeholder %s under %s before output mutation',
    async (value, mode) => {
      const directory = await mkdtemp(join(tmpdir(), 'fe066-placeholder-contract-'));
      const registryPath = join(directory, 'registry.json');
      const outputPath = join(directory, 'generated.ts');
      const corpus = fixture();
      corpus.units[0].renderingContract = { mode };
      corpus.units[0].english = value;
      corpus.units[0].locales.ru.candidate = value;
      corpus.units[0].locales.uz.candidate = value;
      corpus.units[0].sourceRevision = protectedSourceFingerprint(corpus.units[0]);
      corpus.units[0].locales.ru.sourceRevision = corpus.units[0].sourceRevision;
      corpus.units[0].locales.uz.sourceRevision = corpus.units[0].sourceRevision;
      await writeFile(registryPath, JSON.stringify(corpus), 'utf8');
      await writeFile(outputPath, 'prior output\n', 'utf8');
      await expect(syncCorpus({ registryPath, outputPath, sourceRoot: directory })).rejects.toThrow(
        'placeholder mismatch',
      );
      await expect(readFile(outputPath, 'utf8')).resolves.toBe('prior output\n');
    },
  );

  it('rejects unsupported or remapped canonical namespaces without changing output', () => {
    const unsupported = structuredClone(draft37Registry);
    unsupported.units[0].namespace = 'unsupported';
    unsupported.units[0].sourceRevision = protectedSourceFingerprint(unsupported.units[0]);
    unsupported.units[0].locales.ru.sourceRevision = unsupported.units[0].sourceRevision;
    unsupported.units[0].locales.uz.sourceRevision = unsupported.units[0].sourceRevision;
    expect(validateCorpus(unsupported)).toContain('MLUX-C0001: invalid semantic key');

    const remapped = structuredClone(draft37Registry);
    remapped.units[0].english = 'Different account menu';
    remapped.units[0].sourceRevision = protectedSourceFingerprint(remapped.units[0]);
    remapped.units[0].locales.ru.sourceRevision = remapped.units[0].sourceRevision;
    remapped.units[0].locales.uz.sourceRevision = remapped.units[0].sourceRevision;
    expect(validateCorpus(remapped)).toContain('MLUX-C0001: baseline semantic identity mismatch');
  });

  it('rejects forged active review revisions and invalid or reversed approval timestamps', () => {
    const corpus = fixture();
    const requested = transitionLocaleCandidate(corpus.units[0].locales.ru, 'review_requested');
    requested.history[0].sourceRevision =
      'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    corpus.units[0].locales.ru = requested;
    expect(validateCorpus(corpus)).toContain(
      'MLUX-C0001: ru review history does not match current protected source revision',
    );

    const intermediate = fixture();
    const approved = transitionLocaleCandidate(
      transitionLocaleCandidate(intermediate.units[0].locales.ru, 'review_requested'),
      'approved',
      {
        humanApproval: {
          reviewerId: 'native-7',
          reviewerName: 'Native Reviewer',
          reviewedAt: '2026-08-23T00:00:00.000Z',
          approvalRecordedAt: '2026-08-23T00:01:00.000Z',
          approvalAuthority: {
            kind: 'human_native_review',
            reviewerId: 'native-7',
            reviewerName: 'Native Reviewer',
          },
        },
      },
    );
    approved.history[0].sourceRevision =
      'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    intermediate.units[0].locales.ru = approved;
    expect(validateCorpus(intermediate)).toContain(
      'MLUX-C0001: ru review history does not match current protected source revision',
    );

    const approval = {
      reviewerId: 'native-7',
      reviewerName: 'Native Reviewer',
      reviewedAt: 'not-a-time',
      approvalRecordedAt: '2026-08-23T00:01:00.000Z',
      approvalAuthority: {
        kind: 'human_native_review',
        reviewerId: 'native-7',
        reviewerName: 'Native Reviewer',
      },
    };
    expect(() =>
      transitionLocaleCandidate(
        transitionLocaleCandidate(fixture().units[0].locales.ru, 'review_requested'),
        'approved',
        { humanApproval: approval },
      ),
    ).toThrow('approved requires named human-native authority');
    expect(() =>
      transitionLocaleCandidate(
        transitionLocaleCandidate(fixture().units[0].locales.ru, 'review_requested'),
        'approved',
        {
          humanApproval: {
            ...approval,
            reviewedAt: '2026-08-23T00:02:00.000Z',
          },
        },
      ),
    ).toThrow('approved requires named human-native authority');
  });

  it('pins the ordered DRAFT-37 semantic identity while retaining legal compatibility leaves', () => {
    expect(validateCorpus(draft37Registry)).toEqual([]);
    expect(draft37Registry.migration.semanticIdentitySha256).toBe(
      '54DC5F2341910E8BE47B6D4561598316C1402F86B9C1408840FCD194FC562B0F',
    );
    const unitKeys = new Set(draft37Registry.units.map((unit) => `${unit.namespace}:${unit.key}`));
    const compatibilityLeaves = Object.entries(draft37Registry.baselineResources.en).flatMap(
      ([namespace, resources]) =>
        Object.keys(resources)
          .map((key) => `${namespace}:${key}`)
          .filter((key) => !unitKeys.has(key)),
    );
    expect(compatibilityLeaves).toHaveLength(12);

    const supportedNovel = structuredClone(draft37Registry);
    supportedNovel.migration.semanticIdentityVersion = 'unit-semantic-identity-v2';
    expect(validateCorpus(supportedNovel)).toContain('DRAFT-37 semantic identity mismatch');

    const reordered = structuredClone(draft37Registry);
    reordered.units.reverse();
    expect(validateCorpus(reordered)).toEqual([]);

    const duplicate = structuredClone(draft37Registry);
    duplicate.units[1].namespace = duplicate.units[0].namespace;
    duplicate.units[1].key = duplicate.units[0].key;
    duplicate.units[1].sourceRevision = protectedSourceFingerprint(duplicate.units[1]);
    duplicate.units[1].locales.ru.sourceRevision = duplicate.units[1].sourceRevision;
    duplicate.units[1].locales.uz.sourceRevision = duplicate.units[1].sourceRevision;
    expect(validateCorpus(duplicate)).toEqual(
      expect.arrayContaining([`${duplicate.units[1].id}: duplicate namespace/key`]),
    );

    const retired = structuredClone(draft37Registry);
    const postMigrationUnit = retired.units.find(
      (unit) => unit.id === 'MLUX-C0522' && unit.migrationProvenance.ownerTasks.includes('FE-060'),
    );
    if (!postMigrationUnit) throw new Error('post-DRAFT-37 fixture unit is missing');
    postMigrationUnit.unitLifecycle = 'retired';
    postMigrationUnit.occurrences = [];
    retired.summary.sourceOccurrences -= 1;
    postMigrationUnit.sourceRevision = protectedSourceFingerprint(postMigrationUnit);
    postMigrationUnit.locales.ru.sourceRevision = postMigrationUnit.sourceRevision;
    postMigrationUnit.locales.uz.sourceRevision = postMigrationUnit.sourceRevision;
    (
      postMigrationUnit as (typeof retired.units)[number] & {
        retirement: { reason: string; sourceRevision: string };
      }
    ).retirement = {
      reason: 'legal identity-preserving retirement',
      sourceRevision: postMigrationUnit.sourceRevision,
    };
    expect(retired.migration.sourceOccurrences).toBe(746);
    expect(retired.summary.sourceOccurrences).toBe(CURRENT_CORPUS_OCCURRENCE_COUNT - 1);
    expect(validateCorpus(retired)).toEqual([]);

    const rewrittenImportCount = structuredClone(retired);
    rewrittenImportCount.migration.sourceOccurrences = 745;
    expect(validateCorpus(rewrittenImportCount)).toEqual([]);
  });

  it('binds historic review events and helper authority to their active revision and reviewer', () => {
    const corpus = fixture();
    const requested = transitionLocaleCandidate(corpus.units[0].locales.ru, 'review_requested');
    corpus.units[0].locales.ru = requested;
    const revisedUnit = reviseProtectedSource(corpus.units[0], {
      english: 'Welcome after review {{name}}',
    });
    corpus.units[0] = revisedUnit;
    expect(validateFixtureCorpus(corpus)).toEqual([]);

    const forgedHistoric = structuredClone(corpus);
    const historicReview = (
      forgedHistoric.units[0].locales.ru.history as Array<{
        type: string;
        to?: string;
        sourceRevision?: string;
      }>
    ).find((event) => event.type === 'transition' && event.to === 'review_requested');
    if (!historicReview || historicReview.type !== 'transition')
      throw new Error('missing historic review event');
    historicReview.sourceRevision =
      'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    expect(validateCorpus(forgedHistoric)).toContain(
      'MLUX-C0001: ru review history does not match current protected source revision',
    );

    const mismatchedReviewer = {
      reviewerId: 'native-7',
      reviewerName: 'Reviewer A',
      reviewedAt: '2026-08-23T00:00:00.000Z',
      approvalRecordedAt: '2026-08-23T00:01:00.000Z',
      approvalAuthority: {
        kind: 'human_native_review',
        reviewerId: 'native-7',
        reviewerName: 'Reviewer B',
      },
    };
    expect(() =>
      transitionLocaleCandidate(
        transitionLocaleCandidate(fixture().units[0].locales.ru, 'review_requested'),
        'approved',
        { humanApproval: mismatchedReviewer },
      ),
    ).toThrow('approved requires named human-native authority');

    const legal = fixture();
    legal.units[0].locales.ru = transitionLocaleCandidate(
      transitionLocaleCandidate(legal.units[0].locales.ru, 'review_requested'),
      'approved',
      {
        humanApproval: {
          ...mismatchedReviewer,
          reviewerName: 'Reviewer B',
        },
      },
    );
    expect(validateFixtureCorpus(legal)).toEqual([]);
  });

  it('closes migration ownership to non-empty unique verified task literals', () => {
    expect(validateCorpus(draft37Registry)).toEqual([]);
    expect(draft37Registry.units).toHaveLength(CURRENT_CORPUS_UNIT_COUNT);
    expect(
      draft37Registry.units
        .filter((unit) =>
          unit.migrationProvenance.ownerTasks.every((ownerTask) => ownerTask.startsWith('MLUX-')),
        )
        .flatMap((unit) => [unit.locales.ru, unit.locales.uz]),
    ).toSatisfy((candidates: Array<{ status: string; approvalAuthority: unknown }>) =>
      candidates.every(
        (candidate) => candidate.status === 'draft' && candidate.approvalAuthority === null,
      ),
    );

    for (const ownerTasks of [
      [],
      ['MLUX-002', 'MLUX-002'],
      ['Approved by native reviewer'],
      ['MLUX-TEST'],
    ]) {
      const corpus = structuredClone(draft37Registry);
      corpus.units[0].migrationProvenance.ownerTasks = ownerTasks;
      expect(validateCorpus(corpus)).toContain('MLUX-C0001: invalid migration provenance');
    }
  });

  it(`indexes the full current source once for the complete ${CURRENT_CORPUS_UNIT_COUNT}-unit retirement batch`, async () => {
    const corpus = structuredClone(draft37Registry);
    const activeStartedAt = performance.now();
    expect(await retiredConsumerViolations(corpus, 'src')).toEqual([]);
    expect(performance.now() - activeStartedAt).toBeLessThan(10_000);
    expect(corpus.consumerGrammar.version).toBe(1);
    expect(corpus.consumerGrammar.translatorWrappers).toHaveLength(12);
    expect(corpus.consumerGrammar.translatorForwarders).toHaveLength(2);
    expect(corpus.consumerGrammar.translatorDependencies).toHaveLength(1);
    expect(corpus.consumerGrammar.dynamicKeyFamilies).toHaveLength(24);
    expect(
      corpus.consumerGrammar.dynamicKeyFamilies.flatMap((family) => family.consumers),
    ).toHaveLength(49);
    for (const unit of corpus.units) {
      unit.unitLifecycle = 'retired';
      unit.occurrences = [];
    }
    const startedAt = performance.now();
    const violations = await retiredConsumerViolations(corpus, 'src');
    const duration = performance.now() - startedAt;
    expect(violations.length).toBeGreaterThan(0);
    expect(duration).toBeLessThan(10_000);
  }, 12_000);

  describe('closed localization consumer grammar recovery', () => {
    function grammarFixture(
      dynamicKeyFamilies: readonly FixtureDynamicKeyFamily[] = [],
      translatorWrappers: readonly FixtureTranslatorWrapper[] = [],
      translatorDependencies: readonly FixtureTranslatorDependency[] = [],
    ): FixtureCorpusWithConsumerGrammar {
      const corpus = fixture() as FixtureCorpusWithConsumerGrammar;
      corpus.consumerGrammar = {
        version: 1,
        translatorWrappers,
        translatorForwarders: [],
        translatorDependencies,
        dynamicKeyFamilies,
      };
      return corpus;
    }

    it('fails closed for the R57 array spread, array rest, and constructor translator forms', async () => {
      const directory = await mkdtemp(join(tmpdir(), 'fe066-closed-r57-'));
      await writeFile(
        join(directory, 'consumer.ts'),
        `import type { TFunction } from 'i18next';
declare function getTranslator(): TFunction;
declare const Provider: new () => TFunction;
const original = [getTranslator()];
const spread = [...original];
const [spreadTranslator] = spread;
spreadTranslator('common:welcome');
const [...rest] = original;
rest[0]('common:welcome');
const constructed = new Provider();
constructed('common:welcome');`,
        'utf8',
      );

      await expect(retiredConsumerViolations(grammarFixture(), directory)).resolves.toEqual(
        expect.arrayContaining([
          expect.stringMatching(
            /^localization consumer grammar violation: consumer\.ts: unsupported translator indirection/,
          ),
        ]),
      );
    });

    it('rejects direct-hook aliases and object or array storage without trusting a wrapper name', async () => {
      const directory = await mkdtemp(join(tmpdir(), 'fe066-closed-storage-'));
      await writeFile(
        join(directory, 'consumer.tsx'),
        `import { useTranslation } from 'react-i18next';
function translateWelcome(value: unknown) { return value; }
export function Consumer() {
  const { t } = useTranslation();
  const alias = t;
  const object = { t };
  const array = [t];
  translateWelcome(t);
  return [alias, object, array];
}`,
        'utf8',
      );

      await expect(retiredConsumerViolations(grammarFixture(), directory)).resolves.toEqual([
        'localization consumer grammar violation: consumer.tsx: unsupported translator indirection',
      ]);
    });

    it('fails the whole-source gate for an undeclared dynamic key even when every unit is active', async () => {
      const directory = await mkdtemp(join(tmpdir(), 'fe066-closed-undeclared-'));
      await writeFile(
        join(directory, 'consumer.tsx'),
        `import { useTranslation } from 'react-i18next';
export function Consumer({ keyName }: { keyName: string }) {
  const { t } = useTranslation();
  return t(keyName);
}`,
        'utf8',
      );

      await expect(retiredConsumerViolations(grammarFixture(), directory)).resolves.toEqual([
        'localization consumer grammar violation: consumer.tsx: Consumer: undeclared dynamic argument keyName',
      ]);

      const registryPath = join(directory, 'registry.json');
      const outputPath = join(directory, 'generated-resources.ts');
      await writeFile(registryPath, JSON.stringify(grammarFixture()), 'utf8');
      await writeFile(outputPath, 'preserved output', 'utf8');
      await expect(
        checkCorpus({ registryPath, outputPath, sourceRoot: directory }),
      ).resolves.toContain(
        'localization consumer grammar violation: consumer.tsx: Consumer: undeclared dynamic argument keyName',
      );
      await expect(syncCorpus({ registryPath, outputPath, sourceRoot: directory })).rejects.toThrow(
        'undeclared dynamic argument keyName',
      );
      expect(await readFile(outputPath, 'utf8')).toBe('preserved output');
    });

    it('accepts a declared dynamic family and uses it as exact retired-consumer evidence', async () => {
      const directory = await mkdtemp(join(tmpdir(), 'fe066-closed-declared-'));
      const source = `import { useTranslation } from 'react-i18next';
type WelcomeKey = 'common:welcome';
export function Consumer({ keyName }: { keyName: WelcomeKey }) {
  const { t } = useTranslation();
  return t(keyName);
}`;
      await writeFile(join(directory, 'consumer.tsx'), source, 'utf8');
      const family: FixtureDynamicKeyFamily = {
        id: 'fixture-welcome',
        unitIds: ['MLUX-C0001', 'MLUX-C0002'],
        consumers: [
          {
            sourcePath: 'consumer.tsx',
            functionName: 'Consumer',
            argument: 'keyName',
            occurrence: 1,
            sourceFingerprint: fixtureConsumerSourceFingerprint('consumer.tsx', source),
          },
        ],
      };
      const activeCorpus = grammarFixture([family]);
      const additionalUnit = structuredClone(activeCorpus.units[0]);
      additionalUnit.id = 'MLUX-C0002';
      additionalUnit.key = 'goodbye';
      activeCorpus.units.push(additionalUnit);
      expect(await retiredConsumerViolations(activeCorpus, directory)).toEqual([]);

      const retiredCorpus = structuredClone(activeCorpus);
      retiredCorpus.units[0].unitLifecycle = 'retired';
      retiredCorpus.units[0].occurrences = [];
      expect(await retiredConsumerViolations(retiredCorpus, directory)).toEqual([
        'MLUX-C0001: retired unit has source consumer consumer.tsx',
      ]);
    });
  });
});
