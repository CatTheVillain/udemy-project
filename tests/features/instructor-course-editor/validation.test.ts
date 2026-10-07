import { describe, expect, expectTypeOf, it } from 'vitest';

import { ApiError } from '../../../src/shared/api';
import {
  getInstructorLessonUploadRule,
  isInstructorLessonUploadFileAccepted,
  mapInstructorEditorFormFailure,
  parseInstructorEditorId,
  type InstructorEditorErrorCopy,
  type InstructorEditorFailureMessage,
  type InstructorEditorFieldDefinition,
  type InstructorEditorFieldDefinitions,
  type InstructorEditorFormFailure,
} from '../../../src/features/instructor-course-editor';

interface ExpectedInstructorEditorErrorCopy {
  readonly actionKey: string;
  readonly forbiddenKey: string;
  readonly notFoundKey: string;
  readonly unauthorizedKey: string;
  readonly badRequestKey: string | null;
}

interface ExpectedInstructorEditorFieldDefinition {
  readonly field: string;
  readonly labelKey: string;
}

interface ExpectedInstructorEditorFormFailure {
  readonly fields: Readonly<Record<string, InstructorEditorFailureMessage>>;
  readonly summary: InstructorEditorFailureMessage;
}

const FORM_COPY: InstructorEditorErrorCopy = {
  actionKey: 'courseEditorSaveThisCourse',
  unauthorizedKey: 'courseEditorSignInAgainBeforeContinuing',
  forbiddenKey: 'courseEditorYouDoNotHavePermissionToChangeThisCourse',
  notFoundKey: 'courseEditorThisCourseIsNoLongerAvailable',
  badRequestKey: 'courseEditorValidationCouldNotProcessForm',
};

const FORM_FIELDS: InstructorEditorFieldDefinitions = {
  title: { field: 'title', labelKey: 'courseEditorCourseTitle' },
};

const NULL_BAD_REQUEST_COPY: InstructorEditorErrorCopy = {
  actionKey: 'courseEditorSaveThisCourse',
  unauthorizedKey: 'courseEditorSignInAgainBeforeContinuing',
  forbiddenKey: 'courseEditorYouDoNotHavePermissionToChangeThisCourse',
  notFoundKey: 'courseEditorThisCourseIsNoLongerAvailable',
  badRequestKey: null,
};

function expectDescriptorOnly(failure: InstructorEditorFormFailure) {
  expect(typeof failure.summary).not.toBe('string');
  for (const message of Object.values(failure.fields)) {
    expect(typeof message).not.toBe('string');
  }
}

describe('mapInstructorEditorFormFailure', () => {
  it('exposes an exact key-only descriptor public contract', () => {
    expectTypeOf<InstructorEditorErrorCopy>().toEqualTypeOf<ExpectedInstructorEditorErrorCopy>();
    expectTypeOf<InstructorEditorFieldDefinition>().toEqualTypeOf<ExpectedInstructorEditorFieldDefinition>();
    expectTypeOf<InstructorEditorFormFailure>().toEqualTypeOf<ExpectedInstructorEditorFormFailure>();
  });

  it('returns locale-neutral descriptors for every status, allowed 422 field and generic branch', () => {
    const required = mapInstructorEditorFormFailure(
      new ApiError({
        kind: 'validation',
        status: 422,
        message: 'PRIVATE',
        issues: [{ location: ['body', 'title'], message: 'PRIVATE', type: 'missing' }],
      }),
      FORM_COPY,
      FORM_FIELDS,
    );
    const unknownValidation = mapInstructorEditorFormFailure(
      new ApiError({
        kind: 'validation',
        status: 422,
        message: 'PRIVATE_UNKNOWN_422_DETAIL',
        issues: [{ location: ['body', 'unknown'], message: 'PRIVATE', type: 'missing' }],
      }),
      FORM_COPY,
      FORM_FIELDS,
    );
    const badRequest = mapInstructorEditorFormFailure(
      new ApiError({ kind: 'validation', status: 400, message: 'PRIVATE_400_DETAIL' }),
      FORM_COPY,
      FORM_FIELDS,
    );
    const unauthorized = mapInstructorEditorFormFailure(
      new ApiError({ kind: 'unauthorized', status: 401, message: 'PRIVATE_401_DETAIL' }),
      FORM_COPY,
      FORM_FIELDS,
    );
    const forbidden = mapInstructorEditorFormFailure(
      new ApiError({ kind: 'forbidden', status: 403, message: 'PRIVATE_403_DETAIL' }),
      FORM_COPY,
      FORM_FIELDS,
    );
    const notFound = mapInstructorEditorFormFailure(
      new ApiError({ kind: 'not_found', status: 404, message: 'PRIVATE_404_DETAIL' }),
      FORM_COPY,
      FORM_FIELDS,
    );
    const generic = mapInstructorEditorFormFailure(new Error('transport'), FORM_COPY, FORM_FIELDS);

    expect(required.fields.title).toEqual({
      kind: 'required',
      labelKey: 'courseEditorCourseTitle',
    });
    expect(required.summary).toEqual({ kind: 'reviewHighlightedFields' });
    expect(unknownValidation.summary).toEqual({ kind: 'couldNotProcessForm' });
    expect(badRequest.summary).toEqual({
      kind: 'resource',
      key: 'courseEditorValidationCouldNotProcessForm',
    });
    expect(unauthorized.summary).toEqual({
      kind: 'resource',
      key: 'courseEditorSignInAgainBeforeContinuing',
    });
    expect(forbidden.summary).toEqual({
      kind: 'resource',
      key: 'courseEditorYouDoNotHavePermissionToChangeThisCourse',
    });
    expect(notFound.summary).toEqual({
      kind: 'resource',
      key: 'courseEditorThisCourseIsNoLongerAvailable',
    });
    expect(generic.summary).toEqual({
      kind: 'genericAction',
      actionKey: 'courseEditorSaveThisCourse',
    });
    expectDescriptorOnly(required);
    expectDescriptorOnly(unknownValidation);
    expectDescriptorOnly(badRequest);
    expectDescriptorOnly(unauthorized);
    expectDescriptorOnly(forbidden);
    expectDescriptorOnly(notFound);
    expectDescriptorOnly(generic);
    expect(
      JSON.stringify([
        required,
        unknownValidation,
        badRequest,
        unauthorized,
        forbidden,
        notFound,
        generic,
      ]),
    ).not.toContain('PRIVATE_');
  });

  it('uses the descriptor-only generic-action fallback for a real null-400 response', () => {
    const failure = mapInstructorEditorFormFailure(
      new ApiError({
        kind: 'validation',
        status: 400,
        message: 'PRIVATE_NULL_400_DETAIL',
      }),
      NULL_BAD_REQUEST_COPY,
      FORM_FIELDS,
    );

    expect(failure).toEqual({
      fields: {},
      summary: { kind: 'genericAction', actionKey: 'courseEditorSaveThisCourse' },
    });
    expectDescriptorOnly(failure);
    expect(JSON.stringify(failure)).not.toContain('PRIVATE_NULL_400_DETAIL');
    expect(JSON.stringify(failure)).not.toContain('We could not');
  });
});

describe('instructor lesson upload validation', () => {
  it('owns video and PDF extension, case, and inclusive-size boundaries', () => {
    const file = (name: string, size: number) => ({ name, size }) as File;
    expect(getInstructorLessonUploadRule('video')).toMatchObject({
      accept: '.mp4,.webm,.mov',
      maxBytes: 150 * 1024 * 1024,
    });
    expect(getInstructorLessonUploadRule('pdf')).toMatchObject({
      accept: '.pdf',
      maxBytes: 50 * 1024 * 1024,
    });
    expect(getInstructorLessonUploadRule('text')).toBeNull();
    const videoLimit = 150 * 1024 * 1024;
    const pdfLimit = 50 * 1024 * 1024;
    expect(isInstructorLessonUploadFileAccepted(file('VIDEO.MP4', videoLimit), 'video')).toBe(true);
    expect(isInstructorLessonUploadFileAccepted(file('movie.webm', videoLimit), 'video')).toBe(
      true,
    );
    expect(isInstructorLessonUploadFileAccepted(file('clip.mov', videoLimit), 'video')).toBe(true);
    expect(isInstructorLessonUploadFileAccepted(file('video.mp4', videoLimit + 1), 'video')).toBe(
      false,
    );
    expect(isInstructorLessonUploadFileAccepted(file('notes.PDF', pdfLimit), 'pdf')).toBe(true);
    expect(isInstructorLessonUploadFileAccepted(file('notes.pdf', pdfLimit + 1), 'pdf')).toBe(
      false,
    );
    expect(isInstructorLessonUploadFileAccepted(file('notes', 1), 'pdf')).toBe(false);
    expect(isInstructorLessonUploadFileAccepted(file('notes.exe', 1), 'pdf')).toBe(false);
    expect(isInstructorLessonUploadFileAccepted(file('notes.pdf', 1), 'video')).toBe(false);
    expect(isInstructorLessonUploadFileAccepted(file('notes.txt', 1), 'text')).toBe(false);
  });

  it('preserves instructor editor route-id parsing semantics', () => {
    expect(parseInstructorEditorId(undefined)).toBeNull();
    expect(parseInstructorEditorId('')).toBeNull();
    expect(parseInstructorEditorId('0')).toBeNull();
    expect(parseInstructorEditorId('007')).toBe(7);
    expect(parseInstructorEditorId('9007199254740992')).toBeNull();
    expect(parseInstructorEditorId('7x')).toBeNull();
  });
});
