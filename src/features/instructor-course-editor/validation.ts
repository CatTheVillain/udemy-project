import { ApiError } from '@shared/api';
import type { LessonType } from '@entities/course';
import type { TFunction } from 'i18next';

export interface InstructorLessonUploadRule {
  readonly accept: string;
  readonly descriptionKey:
    | 'instructor:lessonEditorMp4WebmOrMovUpTo150Mb'
    | 'instructor:lessonEditorPdfUpTo50Mb';
  readonly maxBytes: number;
}

const INSTRUCTOR_LESSON_UPLOAD_RULES: Readonly<
  Partial<Record<LessonType, InstructorLessonUploadRule>>
> = {
  video: {
    accept: '.mp4,.webm,.mov',
    maxBytes: 150 * 1024 * 1024,
    descriptionKey: 'instructor:lessonEditorMp4WebmOrMovUpTo150Mb',
  },
  pdf: {
    accept: '.pdf',
    maxBytes: 50 * 1024 * 1024,
    descriptionKey: 'instructor:lessonEditorPdfUpTo50Mb',
  },
};

export function getInstructorLessonUploadRule(type: LessonType): InstructorLessonUploadRule | null {
  return INSTRUCTOR_LESSON_UPLOAD_RULES[type] ?? null;
}

export function isInstructorLessonUploadFileAccepted(file: File, type: LessonType): boolean {
  const rule = getInstructorLessonUploadRule(type);
  if (rule === null) return false;
  const extension = `.${file.name.split('.').pop()?.toLowerCase() ?? ''}`;
  return rule.accept.split(',').includes(extension) && file.size <= rule.maxBytes;
}

export function parseInstructorEditorId(value: string | undefined): number | null {
  if (!value || !/^\d+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export interface InstructorEditorFieldDefinition {
  readonly field: string;
  readonly labelKey: string;
}

export type InstructorEditorFieldDefinitions = Readonly<
  Record<string, InstructorEditorFieldDefinition>
>;

export interface InstructorEditorErrorCopy {
  readonly actionKey: string;
  readonly forbiddenKey: string;
  readonly notFoundKey: string;
  readonly unauthorizedKey: string;
  readonly badRequestKey: string | null;
}

interface ResourceFailureMessage {
  readonly kind: 'resource';
  readonly key: string;
}
interface RequiredFailureMessage {
  readonly kind: 'required';
  readonly labelKey: string;
}
interface CheckFieldFailureMessage {
  readonly kind: 'checkField';
  readonly labelKey: string;
}
interface ReviewHighlightedFieldsFailureMessage {
  readonly kind: 'reviewHighlightedFields';
}
interface CouldNotProcessFormFailureMessage {
  readonly kind: 'couldNotProcessForm';
}
interface GenericActionFailureMessage {
  readonly kind: 'genericAction';
  readonly actionKey: string;
}

export type InstructorEditorFailureMessage =
  | ResourceFailureMessage
  | RequiredFailureMessage
  | CheckFieldFailureMessage
  | ReviewHighlightedFieldsFailureMessage
  | CouldNotProcessFormFailureMessage
  | GenericActionFailureMessage;

export interface InstructorEditorFormFailure {
  readonly fields: InstructorEditorFieldErrors;
  readonly summary: InstructorEditorFailureMessage;
}

export type InstructorEditorFieldErrors = Readonly<Record<string, InstructorEditorFailureMessage>>;

export interface ResolvedInstructorEditorFormFailure {
  readonly fields: Readonly<Record<string, string>>;
  readonly summary: string;
}

function safeFieldMessage(labelKey: string, type: string): InstructorEditorFailureMessage {
  const normalizedType = type.toLowerCase();
  if (normalizedType.includes('missing') || normalizedType.includes('required')) {
    return { kind: 'required', labelKey };
  }

  return { kind: 'checkField', labelKey };
}

export function resolveInstructorEditorFailureMessage(
  message: InstructorEditorFailureMessage,
  t: TFunction,
): string {
  switch (message.kind) {
    case 'resource':
      return t(`instructor:${message.key}`);
    case 'required':
      return t('instructor:courseEditorValidationFieldRequired').replace('{fieldLabel}', () =>
        t(`instructor:${message.labelKey}`),
      );
    case 'checkField':
      return t('instructor:courseEditorValidationCheckField').replace('{fieldLabel}', () =>
        t(`instructor:${message.labelKey}`).toLowerCase(),
      );
    case 'reviewHighlightedFields':
      return t('instructor:courseEditorValidationReviewHighlightedFields');
    case 'couldNotProcessForm':
      return t('instructor:courseEditorValidationCouldNotProcessForm');
    case 'genericAction':
      return t('instructor:courseEditorValidationGenericAction').replace('{action}', () =>
        t(`instructor:${message.actionKey}`),
      );
  }
}

export function resolveInstructorEditorFormFailure(
  failure: InstructorEditorFormFailure,
  t: TFunction,
): ResolvedInstructorEditorFormFailure {
  return {
    fields: Object.fromEntries(
      Object.entries(failure.fields).map(([field, message]) => [
        field,
        resolveInstructorEditorFailureMessage(message, t),
      ]),
    ),
    summary: resolveInstructorEditorFailureMessage(failure.summary, t),
  };
}

export function mapInstructorEditorFormFailure(
  error: unknown,
  copy: InstructorEditorErrorCopy,
  fields: InstructorEditorFieldDefinitions,
): InstructorEditorFormFailure {
  if (error instanceof ApiError && error.status === 401) {
    return {
      fields: {},
      summary: { kind: 'resource', key: copy.unauthorizedKey },
    };
  }
  if (error instanceof ApiError && error.status === 403) {
    return {
      fields: {},
      summary: { kind: 'resource', key: copy.forbiddenKey },
    };
  }
  if (error instanceof ApiError && error.status === 404) {
    return {
      fields: {},
      summary: { kind: 'resource', key: copy.notFoundKey },
    };
  }
  if (error instanceof ApiError && error.status === 400 && copy.badRequestKey !== null) {
    return {
      fields: {},
      summary: { kind: 'resource', key: copy.badRequestKey },
    };
  }
  if (error instanceof ApiError && error.status === 422) {
    const mappedFields: Record<string, InstructorEditorFailureMessage> = {};
    error.issues.forEach((issue) => {
      const fieldName = String(issue.location[issue.location.length - 1]);
      const definition = Object.prototype.hasOwnProperty.call(fields, fieldName)
        ? fields[fieldName]
        : undefined;
      if (definition && !mappedFields[definition.field]) {
        mappedFields[definition.field] = safeFieldMessage(definition.labelKey, issue.type);
      }
    });

    return {
      fields: mappedFields,
      summary:
        Object.keys(mappedFields).length > 0
          ? { kind: 'reviewHighlightedFields' }
          : { kind: 'couldNotProcessForm' },
    };
  }

  return {
    fields: {},
    summary: { kind: 'genericAction', actionKey: copy.actionKey },
  };
}
