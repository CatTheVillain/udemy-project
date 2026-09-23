import { API_OPERATION_BY_ID } from '@entities/api';
import { decodeCourseListDto, mapCourseListDto, type CatalogCourseList } from '@entities/course';
import { ApiError, type ApiRequestOptions } from '@shared/api';

import { serializeCatalogQuery, toCourseListQuery, type CatalogQuery } from './query';

export interface CatalogRequester {
  <TResponse, TBody = unknown>(
    options: ApiRequestOptions<TBody, NoInfer<TResponse>>,
  ): Promise<TResponse>;
}
export type CatalogFailureKind = 'offline' | 'invalid_response' | 'request';
export type CatalogFailureTitleKey =
  'common:youAppearOffline' | 'catalog:catalogDataUnavailable' | 'catalog:catalogLoadFailed';
export type CatalogFailureMessageKey =
  'common:checkConnectionAndTryAgain' | 'catalog:tryAgainShortly' | 'common:pleaseTryAgain';

export interface CatalogFailure {
  kind: CatalogFailureKind;
  titleKey: CatalogFailureTitleKey;
  messageKey: CatalogFailureMessageKey;
}

const CATALOG_NUMERIC_PRICE_PATTERN = /^\d+(?:\.\d+)?$/;

function decodeCatalogCourseList(response: unknown): CatalogCourseList {
  try {
    return mapCourseListDto(decodeCourseListDto(response));
  } catch (error) {
    throw new ApiError({
      kind: 'invalid_response',
      status: null,
      message: 'Server returned an invalid catalog response',
      cause: error,
    });
  }
}

function normalizeCatalogMaximumPrice(price: string): string | undefined {
  if (!CATALOG_NUMERIC_PRICE_PATTERN.test(price)) return undefined;
  const numericPrice = Number(price);
  return Number.isFinite(numericPrice) && numericPrice >= 0 ? price : undefined;
}

export async function requestCatalog(
  request: CatalogRequester,
  query: CatalogQuery,
  signal: AbortSignal,
): Promise<CatalogCourseList> {
  const operation = API_OPERATION_BY_ID['API-008'];
  const response = await request<unknown>({
    method: operation.method,
    path: operation.path,
    query: { ...toCourseListQuery(query) },
    signal,
  });
  return decodeCatalogCourseList(response);
}

export async function requestCatalogMaximumPrice(
  request: CatalogRequester,
  signal: AbortSignal,
): Promise<string | undefined> {
  const operation = API_OPERATION_BY_ID['API-008'];
  const response = await request<unknown>({
    method: operation.method,
    path: operation.path,
    query: { page: 1, page_size: 1, sort: '-price' },
    signal,
  });
  const maximumCourse = decodeCatalogCourseList(response).items[0];
  return maximumCourse ? normalizeCatalogMaximumPrice(maximumCourse.price) : undefined;
}

export function catalogFailure(error: unknown): CatalogFailure {
  if (error instanceof ApiError && error.kind === 'offline') {
    return {
      kind: 'offline',
      titleKey: 'common:youAppearOffline',
      messageKey: 'common:checkConnectionAndTryAgain',
    };
  }
  if (error instanceof ApiError && error.kind === 'invalid_response') {
    return {
      kind: 'invalid_response',
      titleKey: 'catalog:catalogDataUnavailable',
      messageKey: 'catalog:tryAgainShortly',
    };
  }
  return {
    kind: 'request',
    titleKey: 'catalog:catalogLoadFailed',
    messageKey: 'common:pleaseTryAgain',
  };
}

export function catalogQueryKey(query: CatalogQuery): string {
  return serializeCatalogQuery(query);
}
