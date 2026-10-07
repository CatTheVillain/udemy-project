import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { BookOpen, ChevronLeft, FileText, FileVideo, Pencil, Plus, Trash2 } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import {
  createInstructorLesson,
  deleteInstructorCourse,
  deleteInstructorLesson,
  instructorEditorCourseQueryKey,
  isInstructorLessonUploadFileAccepted,
  parseInstructorEditorId,
  requestInstructorEditorCourse,
  updateInstructorCourse,
  uploadInstructorLessonFile,
  mapInstructorEditorFormFailure,
  resolveInstructorEditorFormFailure,
  resolveInstructorEditorFailureMessage,
  type InstructorEditorFieldErrors,
  type InstructorEditorCourse,
  type InstructorEditorFormFailure,
  type InstructorEditorLesson,
} from '@features/instructor-course-editor';
import { useSession, type SessionContextValue, type SessionIdentity } from '@features/auth-session';
import type { SessionCacheEpoch } from '@shared/api';
import {
  instructorCourseCollectionQueryPrefix,
  instructorCourseQueryKey,
} from '@shared/api/query-keys';
import {
  Button,
  ContextualNavigationLink,
  Notice,
  Skeleton,
  SkeletonGroup,
} from '@shared/ui/primitives';

import styles from './InstructorCourseEditorPage.module.css';
import { CourseDetailsSection } from './CourseDetailsSection';
import { CourseLessonsSection } from './CourseLessonsSection';
import { DestructiveCourseEditorSection } from './DestructiveCourseEditorSection';
import type {
  CourseFormState,
  CreatedLessonUploadFailure,
  LessonFormState,
} from './course-editor-types';

const LESSON_TYPE_LABEL_KEY = {
  video: 'instructor:courseEditorVideo',
  text: 'instructor:courseEditorText',
  pdf: 'instructor:courseEditorPdf',
} as const;

function LessonTypeIcon({
  lessonType,
}: {
  readonly lessonType: keyof typeof LESSON_TYPE_LABEL_KEY;
}) {
  return lessonType === 'video' ? (
    <FileVideo aria-hidden="true" />
  ) : (
    <FileText aria-hidden="true" />
  );
}

interface CreateLessonMutationResult {
  readonly lesson: InstructorEditorLesson;
  readonly uploadFailed: boolean;
}

type EditorMutationKind = 'update' | 'create' | 'remove';

interface EditorMutationAttempt {
  readonly kind: EditorMutationKind;
  readonly identity: string;
  readonly generation: number;
  readonly sequence: number;
  readonly courseId: number;
  readonly cacheEpoch: SessionCacheEpoch;
  readonly session: SessionContextValue;
  readonly sessionIdentity: SessionIdentity | null;
}

interface CourseUpdateAttempt extends EditorMutationAttempt {
  readonly kind: 'update';
  readonly form: CourseFormState;
}

interface CreateLessonAttempt extends EditorMutationAttempt {
  readonly kind: 'create';
  readonly form: LessonFormState;
  readonly file: File | null;
}

interface RemoveAttempt extends EditorMutationAttempt {
  readonly kind: 'remove';
  readonly target: InstructorEditorLesson | 'course';
}

/* The validation owner supplies the shared field-error contract.
 */
const COURSE_ERROR_FIELDS = {
  title: { field: 'title', labelKey: 'courseEditorCourseTitle' },
  description: { field: 'description', labelKey: 'courseEditorDescription' },
  price: { field: 'price', labelKey: 'courseEditorPrice' },
  currency: { field: 'currency', labelKey: 'courseEditorCurrency' },
};

const LESSON_ERROR_FIELDS = {
  title: { field: 'title', labelKey: 'courseEditorLessonTitle' },
  lesson_type: { field: 'lessonType', labelKey: 'courseEditorLessonType' },
  description: { field: 'description', labelKey: 'courseEditorDescription' },
  is_published: { field: 'isPublished', labelKey: 'courseEditorPublishThisLesson' },
};

function initialCourseForm(course: {
  readonly title: string;
  readonly description: string | null;
  readonly price: string;
  readonly currency: string;
}): CourseFormState {
  return {
    title: course.title,
    description: course.description ?? '',
    price: course.price,
    currency: course.currency,
  };
}

function sameCourseForm(left: CourseFormState | null, right: CourseFormState | null) {
  return (
    left !== null &&
    right !== null &&
    left.title === right.title &&
    left.description === right.description &&
    left.price === right.price &&
    left.currency === right.currency
  );
}

const INITIAL_LESSON_FORM: LessonFormState = {
  title: '',
  lessonType: 'video',
  description: '',
  isPublished: false,
};

interface InstructorCourseEditorHeaderProps {
  readonly courseTitle?: string;
}

function InstructorCourseEditorHeader({ courseTitle }: InstructorCourseEditorHeaderProps) {
  const { t } = useTranslation();
  const breadcrumbCurrent = courseTitle ?? t('routes:editCourseTitle');
  return (
    <>
      <nav className={styles.breadcrumb} aria-label={t('a11y:breadcrumb')}>
        <ContextualNavigationLink className={styles.breadcrumbLink} to="/instructor/courses">
          <ChevronLeft size={20} aria-hidden="true" />
          <span>{t('navigation:instructorCourses')}</span>
        </ContextualNavigationLink>
        <span className={styles.breadcrumbCurrent} aria-hidden="true">
          /
        </span>
        <span className={styles.breadcrumbCurrent} aria-current="page">
          {breadcrumbCurrent}
        </span>
      </nav>
      <header className={styles.header}>
        <h1>{t('routes:editCourseTitle')}</h1>
        <p>{t('routes:courseDetailsDescription')}</p>
      </header>
    </>
  );
}

export function InstructorCourseEditorPage() {
  const { t } = useTranslation();
  const courseId = parseInstructorEditorId(useParams().courseId);
  const session = useSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [courseForm, setCourseForm] = useState<CourseFormState | null>(null);
  const [lessonForm, setLessonForm] = useState<LessonFormState>(INITIAL_LESSON_FORM);
  const [courseError, setCourseError] = useState<InstructorEditorFormFailure | null>(null);
  const [lessonError, setLessonError] = useState<InstructorEditorFormFailure | null>(null);
  const [courseFieldErrors, setCourseFieldErrors] = useState<InstructorEditorFieldErrors>({});
  const [lessonFieldErrors, setLessonFieldErrors] = useState<InstructorEditorFieldErrors>({});
  const [lessonFile, setLessonFile] = useState<File | null>(null);
  const [lessonFileError, setLessonFileError] = useState(false);
  const [createdLessonUploadFailure, setCreatedLessonUploadFailure] =
    useState<CreatedLessonUploadFailure | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<InstructorEditorLesson | 'course' | null>(null);
  const [sessionEndedDeleteError, setSessionEndedDeleteError] = useState<{
    courseId: number;
    cacheEpoch: SessionCacheEpoch;
    error: unknown;
  } | null>(null);
  const [isLessonFormOpen, setIsLessonFormOpen] = useState(false);
  const courseFormRef = useRef<CourseFormState | null>(null);
  const courseBaselineRef = useRef<CourseFormState | null>(null);
  const activeIdentityRef = useRef('');
  const activeGenerationRef = useRef(0);
  const latestAttemptSequenceRef = useRef<Record<EditorMutationKind, number>>({
    update: 0,
    create: 0,
    remove: 0,
  });
  const courseTitleRef = useRef<HTMLInputElement>(null);
  const courseDescriptionRef = useRef<HTMLTextAreaElement>(null);
  const coursePriceRef = useRef<HTMLInputElement>(null);
  const courseCurrencyRef = useRef<HTMLInputElement>(null);
  const lessonTitleRef = useRef<HTMLInputElement>(null);
  const lessonTypeRef = useRef<HTMLButtonElement>(null);
  const lessonDescriptionRef = useRef<HTMLTextAreaElement>(null);
  const lessonPublishedRef = useRef<HTMLInputElement>(null);
  const lessonFileRef = useRef<HTMLInputElement>(null);
  const courseErrorRef = useRef<HTMLDivElement>(null);
  const lessonErrorRef = useRef<HTMLDivElement>(null);
  const cacheEpoch = session.cacheEpoch ?? null;
  const sessionIdentity = session.captureSessionIdentity?.() ?? null;
  const editorIdentity = `${cacheEpoch ?? 'anonymous'}:${courseId ?? 'invalid'}:${sessionIdentity ?? 'session-unavailable'}`;
  if (activeIdentityRef.current !== editorIdentity) {
    activeIdentityRef.current = editorIdentity;
    activeGenerationRef.current += 1;
  }
  const activeGeneration = activeGenerationRef.current;
  const isCurrentAttempt = (attempt: EditorMutationAttempt) =>
    activeIdentityRef.current === attempt.identity &&
    activeGenerationRef.current === attempt.generation &&
    latestAttemptSequenceRef.current[attempt.kind] === attempt.sequence &&
    (attempt.sessionIdentity === null ||
      attempt.session.isSessionIdentityCurrent?.(attempt.sessionIdentity) === true);
  const createAttempt = <TKind extends EditorMutationKind>(
    kind: TKind,
  ): Omit<EditorMutationAttempt, 'kind'> | null => {
    if (courseId === null || cacheEpoch === null) return null;
    const sequence = latestAttemptSequenceRef.current[kind] + 1;
    latestAttemptSequenceRef.current[kind] = sequence;
    return {
      identity: editorIdentity,
      generation: activeGeneration,
      sequence,
      courseId,
      cacheEpoch,
      session,
      sessionIdentity,
    };
  };
  const previousCacheEpochRef = useRef<SessionCacheEpoch | null>(null);
  if (cacheEpoch !== null) previousCacheEpochRef.current = cacheEpoch;
  const queryEpoch = cacheEpoch ?? previousCacheEpochRef.current;

  useEffect(() => {
    courseFormRef.current = null;
    courseBaselineRef.current = null;
    setCourseForm(null);
  }, [editorIdentity]);

  const course = useQuery({
    queryKey:
      queryEpoch !== null && courseId !== null
        ? instructorEditorCourseQueryKey(queryEpoch, courseId)
        : ['disabled', 'instructor-course-editor'],
    queryFn: ({ signal }) => requestInstructorEditorCourse(session, courseId as number, signal),
    enabled: cacheEpoch !== null && courseId !== null,
  });
  const disabledCourseError =
    cacheEpoch === null && queryEpoch !== null && courseId !== null
      ? queryClient.getQueryState(instructorEditorCourseQueryKey(queryEpoch, courseId))?.error
      : null;
  const courseLoadError = course.isError ? course.error : disabledCourseError;
  const hasCourseLoadError = courseLoadError !== null && courseLoadError !== undefined;
  useEffect(() => {
    if (!course.data) return;
    const nextBaseline = initialCourseForm(course.data);
    const currentForm = courseFormRef.current;
    const wasClean = sameCourseForm(currentForm, courseBaselineRef.current);
    courseBaselineRef.current = nextBaseline;
    if (currentForm === null || wasClean) {
      courseFormRef.current = nextBaseline;
      setCourseForm(nextBaseline);
    }
  }, [course.data]);

  const refresh = async (attempt: EditorMutationAttempt) => {
    if (!isCurrentAttempt(attempt)) return;
    await queryClient.invalidateQueries({
      queryKey: instructorCourseQueryKey(attempt.cacheEpoch, attempt.courseId),
    });
    if (!isCurrentAttempt(attempt)) return;
    await queryClient.invalidateQueries({
      queryKey: instructorCourseCollectionQueryPrefix(attempt.cacheEpoch),
    });
  };

  const updateCourse = useMutation<InstructorEditorCourse, unknown, CourseUpdateAttempt>({
    mutationFn: (attempt) => {
      if (!isCurrentAttempt(attempt)) throw new Error('Course editor owner is no longer current');
      return updateInstructorCourse(attempt.session, attempt.courseId, attempt.form);
    },
    onSuccess: async (updatedCourse, attempt) => {
      if (!isCurrentAttempt(attempt)) return;
      setCourseError(null);
      setCourseFieldErrors({});
      const normalizedForm = initialCourseForm(updatedCourse);
      courseBaselineRef.current = normalizedForm;
      courseFormRef.current = normalizedForm;
      setCourseForm(normalizedForm);
      await refresh(attempt);
    },
    onError: (error, attempt) => {
      if (!isCurrentAttempt(attempt)) return;
      const failure = mapInstructorEditorFormFailure(
        error,
        {
          actionKey: 'courseEditorSaveThisCourse',
          unauthorizedKey: 'courseEditorSignInAgainBeforeContinuing',
          forbiddenKey: 'courseEditorYouDoNotHavePermissionToChangeThisCourse',
          notFoundKey: 'courseEditorThisCourseIsNoLongerAvailable',
          badRequestKey: null,
        },
        COURSE_ERROR_FIELDS,
      );
      setCourseError(failure);
      setCourseFieldErrors(failure.fields);
    },
  });
  const createLesson = useMutation<CreateLessonMutationResult, unknown, CreateLessonAttempt>({
    mutationFn: async (attempt): Promise<CreateLessonMutationResult> => {
      if (!isCurrentAttempt(attempt)) throw new Error('Course editor owner is no longer current');
      const lesson = await createInstructorLesson(attempt.session, attempt.courseId, attempt.form);
      if (!isCurrentAttempt(attempt) || attempt.file === null)
        return { lesson, uploadFailed: false };
      try {
        await uploadInstructorLessonFile(attempt.session, lesson.id, attempt.file);
        return { lesson, uploadFailed: false };
      } catch {
        return { lesson, uploadFailed: true };
      }
    },
    onSuccess: async ({ lesson, uploadFailed }, attempt) => {
      if (!isCurrentAttempt(attempt)) return;
      setLessonError(null);
      setLessonFieldErrors({});
      setLessonForm(INITIAL_LESSON_FORM);
      setLessonFile(null);
      setLessonFileError(false);
      if (lessonFileRef.current) lessonFileRef.current.value = '';
      setCreatedLessonUploadFailure(uploadFailed ? { lessonId: lesson.id } : null);
      setIsLessonFormOpen(false);
      await refresh(attempt);
      if (!isCurrentAttempt(attempt)) return;
      document
        .getElementById(uploadFailed ? 'created-lesson-upload-retry' : 'add-lesson-trigger')
        ?.focus({ preventScroll: true });
    },
    onError: (error, attempt) => {
      if (!isCurrentAttempt(attempt)) return;
      const failure = mapInstructorEditorFormFailure(
        error,
        {
          actionKey: 'courseEditorCreateThisLesson',
          unauthorizedKey: 'courseEditorSignInAgainBeforeContinuing',
          forbiddenKey: 'courseEditorYouDoNotHavePermissionToChangeThisCourse',
          notFoundKey: 'courseEditorThisCourseIsNoLongerAvailable',
          badRequestKey: null,
        },
        LESSON_ERROR_FIELDS,
      );
      setLessonError(failure);
      setLessonFieldErrors(failure.fields);
    },
  });
  const remove = useMutation<void, unknown, RemoveAttempt>({
    mutationFn: async (attempt) => {
      if (!isCurrentAttempt(attempt)) throw new Error('Course editor owner is no longer current');
      if (attempt.target === 'course')
        return deleteInstructorCourse(attempt.session, attempt.courseId);
      return deleteInstructorLesson(attempt.session, attempt.courseId, attempt.target.id);
    },
    onSuccess: async (_result, attempt) => {
      if (!isCurrentAttempt(attempt)) return;
      const removedCourse = attempt.target === 'course';
      setDeleteTarget(null);
      await refresh(attempt);
      if (!isCurrentAttempt(attempt)) return;
      if (removedCourse) {
        navigate('/instructor/courses');
        return;
      }
    },
    onError: (error, attempt) => {
      if (!isCurrentAttempt(attempt)) {
        setSessionEndedDeleteError({
          courseId: attempt.courseId,
          cacheEpoch: attempt.cacheEpoch,
          error,
        });
      }
    },
  });
  const { reset: resetUpdateCourse } = updateCourse;
  const { reset: resetCreateLesson } = createLesson;
  const { reset: resetRemove } = remove;

  useEffect(() => {
    resetUpdateCourse();
    resetCreateLesson();
    resetRemove();
    setCourseError(null);
    setCourseFieldErrors({});
    setLessonForm(INITIAL_LESSON_FORM);
    setLessonError(null);
    setLessonFieldErrors({});
    setLessonFile(null);
    setLessonFileError(false);
    if (lessonFileRef.current) lessonFileRef.current.value = '';
    setCreatedLessonUploadFailure(null);
    setDeleteTarget(null);
    setIsLessonFormOpen(false);
  }, [editorIdentity, resetCreateLesson, resetRemove, resetUpdateCourse]);

  useEffect(() => {
    if (courseFieldErrors.title) courseTitleRef.current?.focus({ preventScroll: true });
    else if (courseFieldErrors.description)
      courseDescriptionRef.current?.focus({ preventScroll: true });
    else if (courseFieldErrors.price) coursePriceRef.current?.focus({ preventScroll: true });
    else if (courseFieldErrors.currency) courseCurrencyRef.current?.focus({ preventScroll: true });
    else if (courseError) courseErrorRef.current?.focus({ preventScroll: true });
  }, [courseError, courseFieldErrors]);
  useEffect(() => {
    if (isLessonFormOpen) lessonTitleRef.current?.focus({ preventScroll: true });
  }, [isLessonFormOpen]);
  useEffect(() => {
    if (lessonFieldErrors.title) lessonTitleRef.current?.focus({ preventScroll: true });
    else if (lessonFieldErrors.lessonType) lessonTypeRef.current?.focus({ preventScroll: true });
    else if (lessonFieldErrors.description)
      lessonDescriptionRef.current?.focus({ preventScroll: true });
    else if (lessonFieldErrors.isPublished)
      lessonPublishedRef.current?.focus({ preventScroll: true });
    else if (lessonError) lessonErrorRef.current?.focus({ preventScroll: true });
  }, [lessonError, lessonFieldErrors]);

  const sessionEndedDeleteFailure =
    cacheEpoch === null &&
    sessionEndedDeleteError?.courseId === courseId &&
    sessionEndedDeleteError.cacheEpoch === previousCacheEpochRef.current
      ? resolveInstructorEditorFailureMessage(
          mapInstructorEditorFormFailure(
            sessionEndedDeleteError.error,
            {
              actionKey: 'courseEditorDeleteThisItem',
              unauthorizedKey: 'courseEditorSignInAgainBeforeContinuing',
              forbiddenKey: 'courseEditorYouDoNotHavePermissionToChangeThisCourse',
              notFoundKey: 'courseEditorThisCourseOrLessonIsNoLongerAvailable',
              badRequestKey: null,
            },
            COURSE_ERROR_FIELDS,
          ).summary,
          t,
        )
      : null;

  if (courseId === null) {
    return (
      <article className={styles.page}>
        <InstructorCourseEditorHeader />
        <Notice tone="error" title={t('course:courseNotFound')}>
          {t('instructor:courseEditorCourseAddressInvalid')}
        </Notice>
      </article>
    );
  }
  if (sessionEndedDeleteFailure) {
    return (
      <article className={styles.page}>
        <InstructorCourseEditorHeader />
        <Notice tone="error" title={t('instructor:courseEditorCourseEditorUnavailable')}>
          <p>{sessionEndedDeleteFailure}</p>
        </Notice>
      </article>
    );
  }
  if (cacheEpoch !== null && course.isPending) {
    return (
      <article className={styles.page}>
        <InstructorCourseEditorHeader />
        <SkeletonGroup label={t('instructor:courseEditorLoadingCourseEditor')}>
          <Skeleton width="100%" height="320px" shape="rect" />
        </SkeletonGroup>
      </article>
    );
  }
  if (hasCourseLoadError) {
    return (
      <article className={styles.page}>
        <InstructorCourseEditorHeader />
        <Notice tone="error" title={t('instructor:courseEditorCourseEditorUnavailable')}>
          <p>
            {resolveInstructorEditorFailureMessage(
              mapInstructorEditorFormFailure(
                courseLoadError,
                {
                  actionKey: 'courseEditorLoadThisCourse',
                  unauthorizedKey: 'courseEditorSignInAgainBeforeContinuing',
                  forbiddenKey: 'courseEditorYouDoNotHavePermissionToChangeThisCourse',
                  notFoundKey: 'courseEditorThisCourseIsNoLongerAvailable',
                  badRequestKey: null,
                },
                COURSE_ERROR_FIELDS,
              ).summary,
              t,
            )}
          </p>
          {cacheEpoch !== null ? (
            <Button variant="secondary" onClick={() => void course.refetch()}>
              {t('routes:tryAgain')}
            </Button>
          ) : null}
        </Notice>
      </article>
    );
  }
  if (cacheEpoch === null || !course.data || !courseForm) return null;
  const submitCourse = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (updateCourse.isPending) return;
    if (courseForm.title.trim() === '') {
      setCourseError({
        fields: { title: { kind: 'resource', key: 'courseEditorEnterACourseTitle' } },
        summary: { kind: 'resource', key: 'courseEditorEnterACourseTitle' },
      });
      setCourseFieldErrors({ title: { kind: 'resource', key: 'courseEditorEnterACourseTitle' } });
      courseTitleRef.current?.focus();
      return;
    }
    setCourseError(null);
    setCourseFieldErrors({});
    const attempt = createAttempt('update');
    const submittedForm = courseFormRef.current;
    if (attempt === null || submittedForm === null) return;
    updateCourse.mutate({ ...attempt, kind: 'update', form: submittedForm });
  };
  const submitLesson = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (createLesson.isPending) return;
    if (lessonForm.title.trim() === '') {
      setLessonError({
        fields: { title: { kind: 'resource', key: 'courseEditorEnterALessonTitle' } },
        summary: { kind: 'resource', key: 'courseEditorEnterALessonTitle' },
      });
      setLessonFieldErrors({ title: { kind: 'resource', key: 'courseEditorEnterALessonTitle' } });
      lessonTitleRef.current?.focus();
      return;
    }
    if (
      lessonFile !== null &&
      !isInstructorLessonUploadFileAccepted(lessonFile, lessonForm.lessonType)
    ) {
      setLessonFileError(true);
      lessonFileRef.current?.focus();
      return;
    }
    setLessonError(null);
    setLessonFieldErrors({});
    setLessonFileError(false);
    setCreatedLessonUploadFailure(null);
    const attempt = createAttempt('create');
    if (attempt === null) return;
    createLesson.mutate({
      ...attempt,
      kind: 'create',
      form: lessonForm,
      file: lessonFile,
    });
  };
  const courseFailure = courseError ? resolveInstructorEditorFormFailure(courseError, t) : null;
  const lessonFailure = lessonError ? resolveInstructorEditorFormFailure(lessonError, t) : null;
  const resolvedCourseFieldErrors = courseFailure
    ? courseFailure.fields
    : Object.fromEntries(
        Object.entries(courseFieldErrors).map(([field, message]) => [
          field,
          resolveInstructorEditorFormFailure({ fields: { [field]: message }, summary: message }, t)
            .summary,
        ]),
      );
  const resolvedLessonFieldErrors = lessonFailure
    ? lessonFailure.fields
    : Object.fromEntries(
        Object.entries(lessonFieldErrors).map(([field, message]) => [
          field,
          resolveInstructorEditorFormFailure({ fields: { [field]: message }, summary: message }, t)
            .summary,
        ]),
      );
  const changeLessonFile = (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0] ?? null;
    setLessonFile(selectedFile);
    setLessonFileError(
      selectedFile !== null &&
        !isInstructorLessonUploadFileAccepted(selectedFile, lessonForm.lessonType),
    );
  };
  const toggleCreateLesson = () => {
    setIsLessonFormOpen((isOpen) => !isOpen);
    setCreatedLessonUploadFailure(null);
  };
  const setCurrentCourseForm = (nextForm: CourseFormState) => {
    courseFormRef.current = nextForm;
    setCourseForm(nextForm);
  };

  return (
    <article
      className={styles.page}
      aria-busy={updateCourse.isPending || createLesson.isPending || remove.isPending}
    >
      <InstructorCourseEditorHeader courseTitle={course.data.title} />
      <CourseDetailsSection
        form={courseForm}
        fieldErrors={resolvedCourseFieldErrors}
        failure={courseFailure?.summary ?? null}
        hasFieldErrors={Object.keys(courseFieldErrors).length > 0}
        isSaving={updateCourse.isPending}
        refs={{
          title: courseTitleRef,
          description: courseDescriptionRef,
          price: coursePriceRef,
          currency: courseCurrencyRef,
          error: courseErrorRef,
        }}
        onChange={setCurrentCourseForm}
        onSubmit={submitCourse}
      />
      <section className={styles.panel} aria-labelledby="lessons-heading">
        <div className={styles.sectionHeadingRow}>
          <div className={styles.sectionHeading}>
            <span className={styles.sectionIcon} aria-hidden="true">
              <BookOpen />
            </span>
            <h2 id="lessons-heading">{t('instructor:courseEditorLessons')}</h2>
          </div>
          <Button
            id="add-lesson-trigger"
            type="button"
            variant="secondary"
            className={styles.lessonDisclosureButton}
            aria-expanded={isLessonFormOpen}
            aria-controls="create-lesson-panel"
            onClick={toggleCreateLesson}
          >
            <Plus aria-hidden="true" />
            {t('instructor:courseEditorAddLesson')}
          </Button>
        </div>
        {course.data.lessons.length === 0 ? (
          <div className={styles.emptyLessons}>
            <h3>{t('instructor:courseEditorNoLessonsYet')}</h3>
            <p>{t('instructor:courseEditorThisCourseHasNoLessonsYet')}</p>
          </div>
        ) : (
          <ul className={styles.lessonList}>
            {course.data.lessons.map((lesson) => (
              <li key={lesson.id} className={styles.lessonRow}>
                <div className={styles.lessonSummary}>
                  <span className={styles.lessonIcon} aria-hidden="true">
                    <LessonTypeIcon lessonType={lesson.lessonType} />
                  </span>
                  <div>
                    <h3>{lesson.title}</h3>
                    <p>
                      {t(LESSON_TYPE_LABEL_KEY[lesson.lessonType])}
                      <span
                        className={`${styles.statusDot} ${lesson.isPublished ? styles.statusDotPublished : ''}`}
                        aria-hidden="true"
                      />
                      {lesson.isPublished
                        ? t('course:published')
                        : t('instructor:courseEditorNotPublished')}
                    </p>
                  </div>
                </div>
                <div className={styles.actions}>
                  <Link className={styles.backLink} to={`/instructor/lessons/${lesson.id}/edit`}>
                    <Pencil aria-hidden="true" size={18} />
                    {t('routes:editLessonTitle')}
                  </Link>
                  <Button
                    type="button"
                    variant="ghost"
                    className={styles.lessonDeleteAction}
                    aria-label={t('instructor:courseEditorDeleteLesson')}
                    disabled={remove.isPending}
                    onClick={() => {
                      remove.reset();
                      setDeleteTarget(lesson);
                    }}
                  >
                    <Trash2 aria-hidden="true" size={19} />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <CourseLessonsSection
        form={lessonForm}
        fieldErrors={resolvedLessonFieldErrors}
        failure={lessonFailure?.summary ?? null}
        hasFieldErrors={Object.keys(lessonFieldErrors).length > 0}
        file={lessonFile}
        hasFileError={lessonFileError}
        isOpen={isLessonFormOpen}
        isCreating={createLesson.isPending}
        createdUploadFailure={createdLessonUploadFailure}
        refs={{
          title: lessonTitleRef,
          lessonType: lessonTypeRef,
          description: lessonDescriptionRef,
          published: lessonPublishedRef,
          file: lessonFileRef,
          error: lessonErrorRef,
        }}
        onFormChange={setLessonForm}
        onLessonTypeChange={(lessonType) => {
          setLessonForm({ ...lessonForm, lessonType });
          setLessonFile(null);
          setLessonFileError(false);
          if (lessonFileRef.current) lessonFileRef.current.value = '';
        }}
        onFileChange={changeLessonFile}
        onSubmit={submitLesson}
      />
      <DestructiveCourseEditorSection
        course={course.data}
        target={deleteTarget}
        isPending={remove.isPending}
        isBlocked={updateCourse.isPending || createLesson.isPending}
        error={
          remove.isError
            ? resolveInstructorEditorFailureMessage(
                mapInstructorEditorFormFailure(
                  remove.error,
                  {
                    actionKey: 'courseEditorDeleteThisItem',
                    unauthorizedKey: 'courseEditorSignInAgainBeforeContinuing',
                    forbiddenKey: 'courseEditorYouDoNotHavePermissionToChangeThisCourse',
                    notFoundKey: 'courseEditorThisCourseOrLessonIsNoLongerAvailable',
                    badRequestKey: null,
                  },
                  COURSE_ERROR_FIELDS,
                ).summary,
                t,
              )
            : undefined
        }
        onCourseDelete={() => {
          remove.reset();
          setDeleteTarget('course');
        }}
        onCancel={() => {
          if (!remove.isPending) {
            remove.reset();
            setDeleteTarget(null);
          }
        }}
        onConfirm={() => {
          if (deleteTarget === null) return;
          const attempt = createAttempt('remove');
          if (attempt !== null) remove.mutate({ ...attempt, kind: 'remove', target: deleteTarget });
        }}
      />
    </article>
  );
}
