import type { QueryFunctionContext } from '@tanstack/react-query';

import {
  API_OPERATION_BY_ID,
  API_OPERATION_METADATA_BY_ID,
  type ApiOperationRequestOptions,
  type SelectedApiOperationId,
} from '@entities/api';
import type { ApiRequestOptions } from '@shared/api';
import type { SessionContextValue } from './SessionProvider';

interface SessionOperationRequester {
  <TResponse, TBody = unknown>(
    options: ApiRequestOptions<TBody, NoInfer<TResponse>>,
  ): Promise<TResponse>;
}

type OperationRequestArguments<TResponse, TBody> = {
  [TId in SelectedApiOperationId]: [
    operationId: TId,
    options: ApiOperationRequestOptions<TId, TResponse> & ApiRequestOptions<TBody, TResponse>,
  ];
}[SelectedApiOperationId];

function operationPathMatches(template: string, actual: string): boolean {
  const templateSegments = template.split('/');
  const actualSegments = actual.split('/');
  return (
    templateSegments.length === actualSegments.length &&
    templateSegments.every((segment, index) =>
      segment.startsWith(':') ? Boolean(actualSegments[index]) : segment === actualSegments[index],
    )
  );
}

function isFormData(body: unknown): body is FormData {
  return typeof FormData !== 'undefined' && body instanceof FormData;
}

function assertOperationRequest(
  operationId: SelectedApiOperationId,
  options: ApiRequestOptions,
): void {
  const operation = API_OPERATION_BY_ID[operationId];
  const metadata = API_OPERATION_METADATA_BY_ID[operationId];
  if (options.method !== undefined && options.method !== operation.method) {
    throw new Error(`Method does not match ${operationId}`);
  }
  if (!operationPathMatches(operation.path, options.path)) {
    throw new Error(`Path does not match ${operationId}`);
  }
  if (options.authPolicy !== undefined && options.authPolicy !== metadata.authPolicy) {
    throw new Error(`Auth policy does not match ${operationId}`);
  }
  if (operation.requestMode === 'query') {
    if (options.body !== undefined) throw new Error(`Body does not match ${operationId}`);
    if (options.query == null) throw new Error(`Query is required for ${operationId}`);
  } else if (options.query !== undefined) {
    throw new Error(`Query does not match ${operationId}`);
  }
  if (operation.requestMode === 'none' && options.body !== undefined) {
    throw new Error(`Body does not match ${operationId}`);
  }
  if (operation.requestMode === 'json' && (options.body == null || isFormData(options.body))) {
    throw new Error(`JSON body does not match ${operationId}`);
  }
  if (operation.requestMode === 'multipart' && !isFormData(options.body)) {
    throw new Error(`Multipart body does not match ${operationId}`);
  }
  if (
    (operation.responseMode === 'binary' && options.responseType !== 'blob') ||
    (operation.responseMode !== 'binary' && options.responseType === 'blob')
  ) {
    throw new Error(`Response mode does not match ${operationId}`);
  }
  if (
    operation.mutationDedupe === 'supported' &&
    (typeof options.dedupeKey !== 'string' || !options.dedupeKey.trim())
  ) {
    throw new Error(`Dedupe key is required for ${operationId}`);
  }
}

export function selectOperationRequester(
  session: SessionContextValue,
  operationId: SelectedApiOperationId,
): SessionOperationRequester {
  const policy = API_OPERATION_METADATA_BY_ID[operationId].authPolicy;
  if (policy === 'public') return session.requestPublic;
  if (policy === 'required') return session.requestRequired;
  return session.requestOptional;
}

function executeOperation<TResponse, TBody = unknown>(
  session: SessionContextValue,
  operationId: SelectedApiOperationId,
  options: ApiRequestOptions<TBody, TResponse>,
): Promise<TResponse> {
  const metadata = API_OPERATION_METADATA_BY_ID[operationId];
  const operation = API_OPERATION_BY_ID[operationId];
  assertOperationRequest(operationId, options);
  return selectOperationRequester(
    session,
    operationId,
  )<TResponse, TBody>({
    ...options,
    method: operation.method,
    authPolicy: metadata.authPolicy,
  });
}

export function requestOperation<TResponse = unknown, TBody = unknown>(
  session: SessionContextValue,
  ...[operationId, options]: OperationRequestArguments<TResponse, TBody>
): Promise<TResponse> {
  return executeOperation<TResponse, TBody>(session, operationId, options);
}

export function createOperationQueryFn<TResponse = unknown, TBody = unknown>(
  session: SessionContextValue,
  ...[operationId, options]: OperationRequestArguments<TResponse, TBody>
) {
  return ({ signal }: QueryFunctionContext): Promise<TResponse> =>
    executeOperation<TResponse, TBody>(session, operationId, { ...options, signal });
}
