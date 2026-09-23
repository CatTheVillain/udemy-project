export type ContractAssumptionCode =
  'GAP-003_FORBIDDEN_NOT_FOUND_AMBIGUITY' | 'GAP-007_PAGINATION_BOUNDS_UNRESOLVED';

export interface ContractAssumption {
  code: ContractAssumptionCode;
  gapId: 'GAP-003' | 'GAP-007';
  state: 'unresolved';
  fallback: string;
  validationMilestone: string;
}

interface PageQueryInput {
  page?: number;
  page_size?: number;
}

interface NormalizedPageQuery {
  page: number;
  page_size: number;
}

interface LessonPageQueryInput {
  page?: number;
  size?: number;
}

interface NormalizedLessonPageQuery {
  page: number;
  size: number;
}

export const CONTRACT_ASSUMPTIONS = {
  GAP_003: {
    code: 'GAP-003_FORBIDDEN_NOT_FOUND_AMBIGUITY',
    gapId: 'GAP-003',
    state: 'unresolved',
    fallback: 'Treat ambiguous 403 responses as permission_or_availability failures.',
    validationMilestone: 'Replace after backend publishes stable 403/404 branch semantics.',
  },
  GAP_007: {
    code: 'GAP-007_PAGINATION_BOUNDS_UNRESOLVED',
    gapId: 'GAP-007',
    state: 'unresolved',
    fallback: 'Require positive page values and cap page size at 100 before transport.',
    validationMilestone: 'Replace after backend publishes pagination bounds and overflow behavior.',
  },
} as const satisfies Readonly<Record<string, ContractAssumption>>;

function positiveInteger(value: number | undefined, fallback: number, maximum: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(maximum, Math.max(1, Math.trunc(value)));
}

export function normalizePageQuery<T extends PageQueryInput>(
  query: T,
): Omit<T, keyof PageQueryInput> & NormalizedPageQuery {
  return {
    ...query,
    page: positiveInteger(query.page, 1, Number.MAX_SAFE_INTEGER),
    page_size: positiveInteger(query.page_size, 100, 100),
  };
}

export function normalizeLessonPageQuery<T extends LessonPageQueryInput>(
  query: T,
): Omit<T, keyof LessonPageQueryInput> & NormalizedLessonPageQuery {
  return {
    ...query,
    page: positiveInteger(query.page, 1, Number.MAX_SAFE_INTEGER),
    size: positiveInteger(query.size, 100, 100),
  };
}
