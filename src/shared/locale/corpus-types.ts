import type { Locale } from './types';

export type UnitLifecycle = 'active' | 'retired';
export type LocalizationCorpusVersion = 'MLUX-001-DRAFT-37';
export type LocalizationNamespace =
  | 'a11y'
  | 'ai'
  | 'auth'
  | 'cart'
  | 'catalog'
  | 'common'
  | 'course'
  | 'instructor'
  | 'learning'
  | 'navigation'
  | 'routes';
export type LocaleReviewStatus =
  'draft' | 'review_requested' | 'changes_requested' | 'approved' | 'stale';

export interface SourceRevision {
  readonly value: string;
}

export interface LocalizationSourceHash {
  readonly sha256: string;
}

export interface RetirementProvenance {
  readonly reason: string;
  readonly sourceRevision: string;
}

export interface LocalizationCorpusSummary {
  readonly translationUnits: number;
  readonly sourceOccurrences: number;
  readonly mergedDuplicateRows: number;
}

export interface LocalizationTranslatorBoundary {
  readonly sourcePath: string;
  readonly functionName: string;
  readonly bindingName: string;
  readonly sourceFingerprint: string;
}

export interface LocalizationTranslatorDependency extends LocalizationTranslatorBoundary {
  readonly hookName: 'useCallback' | 'useEffect' | 'useLayoutEffect' | 'useMemo';
}

export interface LocalizationDynamicConsumer {
  readonly sourcePath: string;
  readonly functionName: string;
  readonly argument: string;
  readonly occurrence: number;
  readonly sourceFingerprint: string;
}

export interface LocalizationDynamicKeyFamily {
  readonly id: string;
  readonly unitIds: readonly string[];
  readonly consumers: readonly LocalizationDynamicConsumer[];
}

export interface LocalizationConsumerGrammar {
  readonly version: 1;
  readonly translatorWrappers: readonly LocalizationTranslatorBoundary[];
  readonly translatorForwarders: readonly LocalizationTranslatorBoundary[];
  readonly translatorDependencies: readonly LocalizationTranslatorDependency[];
  readonly dynamicKeyFamilies: readonly LocalizationDynamicKeyFamily[];
}

export interface LocalizationCorpusExclusion {
  readonly id: string;
  readonly sourceCategory: string;
  readonly origin: string;
  readonly status:
    'Excluded' | 'Excluded or reconstructed' | 'Excluded when nonconforming' | 'Consolidated';
  readonly boundaryReason: string;
}

export interface EnglishPluralForms {
  readonly zero?: string;
  readonly one: string;
  readonly other: string;
}

export interface RussianPluralForms {
  readonly zero?: string;
  readonly one: string;
  readonly few: string;
  readonly many: string;
  readonly other: string;
}

export interface UzbekPluralForms {
  readonly zero?: string;
  readonly one: string;
  readonly other: string;
}

export interface LocalizationPluralForms {
  readonly en: EnglishPluralForms;
  readonly ru: RussianPluralForms;
  readonly uz: UzbekPluralForms;
}

export type BaselineLocaleResources = Readonly<
  Record<Locale, Readonly<Partial<Record<LocalizationNamespace, Readonly<Record<string, string>>>>>>
>;

export interface LocalizationOccurrence {
  readonly id: string;
  readonly context: string;
}

export interface LocaleCandidateBase {
  readonly candidate: string;
  readonly sourceRevision: string;
  readonly status: LocaleReviewStatus;
  readonly history: readonly LocaleCandidateHistoryEvent[];
  readonly requestedAt?: string | null;
}

export interface HumanNativeApprovedLocaleCandidate extends LocaleCandidateBase {
  readonly status: 'approved';
  readonly reviewerId: string;
  readonly verdict: 'approved';
  readonly reviewedAt: string;
  readonly approvalRecordedAt: string;
  readonly approvalAuthority: HumanNativeReviewApprovalAuthority;
}

export interface SuppliedReviewArtifactApprovedLocaleCandidate extends LocaleCandidateBase {
  readonly status: 'approved';
  readonly reviewerId: null;
  readonly verdict: 'approved';
  readonly reviewedAt: null;
  readonly approvalRecordedAt: string;
  readonly approvalAuthority: SuppliedReviewArtifactApprovalAuthority;
}

export interface NonApprovedLocaleCandidate extends LocaleCandidateBase {
  readonly status: Exclude<LocaleReviewStatus, 'approved'>;
  readonly reviewerId?: null;
  readonly verdict?: null;
  readonly reviewedAt?: null;
  readonly approvalRecordedAt?: null;
  readonly approvalAuthority?: null;
}

export type ApprovedLocaleCandidate =
  HumanNativeApprovedLocaleCandidate | SuppliedReviewArtifactApprovedLocaleCandidate;

export type LocaleCandidate = ApprovedLocaleCandidate | NonApprovedLocaleCandidate;

export interface HumanNativeReviewApprovalAuthority {
  readonly kind: 'human_native_review';
  readonly reviewerId: string;
  readonly reviewerName: string;
}

export interface SuppliedReviewArtifactApprovalAuthority {
  readonly kind: 'user-authorized supplied review artifact';
  readonly artifactName: 'learnhub-multilingual-review-readable.md';
  readonly artifactSha256: 'ED5D3D613F21DE188DB0512B3701EA9C0C0A6D254FD1C77829FB3E61ECD3310C';
}

export type LocaleApprovalAuthority =
  HumanNativeReviewApprovalAuthority | SuppliedReviewArtifactApprovalAuthority;

export interface HumanNativeReviewApprovalRecord {
  readonly reviewerId: string;
  readonly reviewerName: string;
  readonly reviewedAt: string;
  readonly approvalRecordedAt: string;
  readonly approvalAuthority: HumanNativeReviewApprovalAuthority;
}

export interface SuppliedReviewArtifactApprovalRecord {
  readonly reviewerId: null;
  readonly reviewedAt: null;
  readonly approvalRecordedAt: string;
  readonly approvalAuthority: SuppliedReviewArtifactApprovalAuthority;
}

export type LocaleApprovalRecord =
  HumanNativeReviewApprovalRecord | SuppliedReviewArtifactApprovalRecord;

export interface LocaleChangeRequestRecord {
  readonly replacement: string;
  readonly reviewerId: string;
  readonly reviewerName: string;
  readonly reviewerAttestation: 'native-review';
  readonly requestedAt: string;
  readonly reviewedAt: string;
  readonly changeRequestedAt: string;
}

export interface LocaleSourceRevisionHistoryEvent {
  readonly type: 'source_revision';
  readonly previousSourceRevision: string;
  readonly sourceRevision: string;
}

export interface LocaleTransitionHistoryEventBase {
  readonly type: 'transition';
  readonly previousCandidate: string;
  readonly nextCandidate: string;
}

export interface LocaleDraftToReviewRequestedTransitionHistoryEvent extends LocaleTransitionHistoryEventBase {
  readonly from: 'draft';
  readonly to: 'review_requested';
  readonly sourceRevision: string;
  readonly humanApproval?: never;
  readonly suppliedArtifactApproval?: never;
}

export interface LocaleReviewRequestedToHumanApprovedTransitionHistoryEvent extends LocaleTransitionHistoryEventBase {
  readonly from: 'review_requested';
  readonly to: 'approved';
  readonly sourceRevision: string;
  readonly humanApproval: HumanNativeReviewApprovalRecord;
  readonly suppliedArtifactApproval?: never;
}

export interface LocaleReviewRequestedToSuppliedArtifactApprovedTransitionHistoryEvent extends LocaleTransitionHistoryEventBase {
  readonly from: 'review_requested';
  readonly to: 'approved';
  readonly sourceRevision: string;
  readonly humanApproval?: never;
  readonly suppliedArtifactApproval: SuppliedReviewArtifactApprovalRecord;
}

export type LocaleReviewRequestedToApprovedTransitionHistoryEvent =
  | LocaleReviewRequestedToHumanApprovedTransitionHistoryEvent
  | LocaleReviewRequestedToSuppliedArtifactApprovedTransitionHistoryEvent;

export interface LocaleReviewRequestedToChangesRequestedTransitionHistoryEvent extends LocaleTransitionHistoryEventBase {
  readonly from: 'review_requested';
  readonly to: 'changes_requested';
  readonly sourceRevision: string;
  readonly changeRequest: LocaleChangeRequestRecord;
  readonly humanApproval?: never;
  readonly suppliedArtifactApproval?: never;
}

export interface LocaleReviewRequestedToDraftWithdrawalTransitionHistoryEvent extends LocaleTransitionHistoryEventBase {
  readonly from: 'review_requested';
  readonly to: 'draft';
  readonly sourceRevision: string;
  readonly withdrawal: true;
  readonly changeRequest?: never;
  readonly humanApproval?: never;
  readonly suppliedArtifactApproval?: never;
}

export interface LocaleReviewRequestedToStaleTransitionHistoryEvent extends LocaleTransitionHistoryEventBase {
  readonly from: 'review_requested';
  readonly to: 'stale';
  readonly sourceRevision: string;
  readonly humanApproval?: never;
  readonly suppliedArtifactApproval?: never;
}

export interface LocaleChangesRequestedToDraftTransitionHistoryEvent extends LocaleTransitionHistoryEventBase {
  readonly from: 'changes_requested';
  readonly to: 'draft';
  readonly sourceRevision: string;
  readonly humanApproval?: never;
  readonly suppliedArtifactApproval?: never;
}

export interface LocaleChangesRequestedToStaleTransitionHistoryEvent extends LocaleTransitionHistoryEventBase {
  readonly from: 'changes_requested';
  readonly to: 'stale';
  readonly sourceRevision: string;
  readonly humanApproval?: never;
  readonly suppliedArtifactApproval?: never;
}

export interface LocaleApprovedToStaleTransitionHistoryEvent extends LocaleTransitionHistoryEventBase {
  readonly from: 'approved';
  readonly to: 'stale';
  readonly sourceRevision: string;
  readonly humanApproval?: never;
  readonly suppliedArtifactApproval?: never;
}

export interface LocaleStaleToDraftTransitionHistoryEvent extends LocaleTransitionHistoryEventBase {
  readonly from: 'stale';
  readonly to: 'draft';
  readonly sourceRevision?: string;
  readonly humanApproval?: never;
  readonly suppliedArtifactApproval?: never;
}

export type LocaleApprovedTransitionHistoryEvent =
  LocaleReviewRequestedToApprovedTransitionHistoryEvent;

export type LocaleReviewedTransitionHistoryEvent =
  | LocaleDraftToReviewRequestedTransitionHistoryEvent
  | LocaleReviewRequestedToChangesRequestedTransitionHistoryEvent;

export type LocaleNonReviewTransitionHistoryEvent =
  | LocaleReviewRequestedToDraftWithdrawalTransitionHistoryEvent
  | LocaleReviewRequestedToStaleTransitionHistoryEvent
  | LocaleChangesRequestedToDraftTransitionHistoryEvent
  | LocaleChangesRequestedToStaleTransitionHistoryEvent
  | LocaleApprovedToStaleTransitionHistoryEvent
  | LocaleStaleToDraftTransitionHistoryEvent;

export type LocaleTransitionHistoryEvent =
  | LocaleApprovedTransitionHistoryEvent
  | LocaleReviewedTransitionHistoryEvent
  | LocaleNonReviewTransitionHistoryEvent;

export type LocaleCandidateHistoryEvent =
  LocaleSourceRevisionHistoryEvent | LocaleTransitionHistoryEvent;

export interface I18nextRenderingContract {
  readonly mode: 'i18next';
}

export interface ManualTemplateRenderingContract {
  readonly mode: 'manual_template';
}

export type LocalizationRenderingContract =
  I18nextRenderingContract | ManualTemplateRenderingContract;

export interface LocalizationUnit {
  readonly id: string;
  readonly namespace: LocalizationNamespace;
  readonly key: string;
  readonly english: string;
  readonly sourceRevision: string;
  readonly unitLifecycle: UnitLifecycle;
  readonly occurrences: readonly LocalizationOccurrence[];
  readonly placeholdersByLocale: Readonly<Record<Locale, readonly string[]>>;
  readonly renderingContract: LocalizationRenderingContract | null;
  readonly locales: Readonly<Record<'ru' | 'uz', LocaleCandidate>>;
  readonly retirement?: RetirementProvenance;
  readonly retirementHistory?: readonly RetirementProvenance[];
  readonly pluralForms: LocalizationPluralForms | null;
  readonly migrationProvenance: UnitMigrationProvenance;
}

export interface UnitMigrationProvenance {
  readonly legacyResourceStatus: 'Draft';
  readonly legacyReviewStatus: 'Pending';
  readonly ownerTasks: readonly MigrationOwnerTask[];
}

export type MigrationOwnerTask =
  'MLUX-002' | 'MLUX-003' | 'MLUX-004' | 'MLUX-005' | 'MLUX-006-FOLLOWUP';

export interface CorpusMigrationProvenance {
  readonly sourceVersion: LocalizationCorpusVersion;
  readonly sourceSha256: 'C9E208FC5F1AEF55E709290C67270B79E1CBCE4831E7FBCB20555AB5CF8A73AE';
  readonly semanticIdentityVersion: 'unit-semantic-identity-v1';
  readonly semanticIdentitySha256: '54DC5F2341910E8BE47B6D4561598316C1402F86B9C1408840FCD194FC562B0F';
  readonly sourceOccurrences: number;
  readonly importedAt: null;
}

export interface LocalizationCorpus {
  readonly formatVersion: 1;
  readonly corpusVersion: LocalizationCorpusVersion;
  readonly source: LocalizationSourceHash;
  readonly consumerGrammar: LocalizationConsumerGrammar;
  readonly baselineResources: BaselineLocaleResources;
  readonly summary: LocalizationCorpusSummary;
  readonly exclusions: readonly LocalizationCorpusExclusion[];
  readonly units: readonly LocalizationUnit[];
  readonly migration: CorpusMigrationProvenance;
}
