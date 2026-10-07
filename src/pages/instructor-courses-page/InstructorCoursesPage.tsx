import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { BookOpen, CircleCheck, Ellipsis, Pencil, Trash2, Users } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { useTranslation } from 'react-i18next';

import {
  INSTRUCTOR_COURSE_CREATE_REQUEST_EVENT,
  requestCreateCourse,
  requestInstructorCourses,
} from '@features/instructor-courses';
import { deleteInstructorCourse } from '@features/instructor-course-editor';
import { useSession } from '@features/auth-session';
import { ApiError, type SessionCacheEpoch } from '@shared/api';
import {
  instructorCourseCollectionQueryKey,
  instructorCourseCollectionQueryPrefix,
} from '@shared/api/query-keys';
import {
  Button,
  DestructiveConfirmation,
  Input,
  Notice,
  Pagination,
  Skeleton,
  SkeletonGroup,
} from '@shared/ui/primitives';
import styles from './InstructorCoursesPage.module.css';

const COURSE_TITLE_MAX_LENGTH = 255;

type CourseTitleValidationKey =
  | 'courseEditorEnterACourseTitle'
  | 'coursesCourseTitleMustBe255CharactersOrFewer';

interface CourseDeleteTarget {
  readonly id: number;
  readonly title: string;
}

type CourseMenuFocusTarget = 'first' | 'last';
type CourseMenuItemElement = HTMLAnchorElement | HTMLButtonElement;

function courseMenuItems(menu: HTMLDivElement | null): CourseMenuItemElement[] {
  if (!menu) return [];
  return Array.from(menu.querySelectorAll<CourseMenuItemElement>('[role="menuitem"]'));
}

function titleValidationMessage(value: string): CourseTitleValidationKey | null {
  if (value.trim() === '') return 'courseEditorEnterACourseTitle';
  if (value.length > COURSE_TITLE_MAX_LENGTH) return 'coursesCourseTitleMustBe255CharactersOrFewer';
  return null;
}

function pageFrom(value: string | null): number {
  if (!value || !/^[1-9]\d*$/.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) ? page : 1;
}

function collectionFailure(error: unknown, t: (key: string) => string): string {
  if (error instanceof ApiError && error.status === 401)
    return t('instructor:coursesSignInAgainToViewYourCourses');
  if (error instanceof ApiError && error.status === 403)
    return t('instructor:coursesYouDoNotHavePermissionToViewInstructorCourses');
  if (error instanceof ApiError && error.status === 422)
    return t('instructor:coursesTheRequestedCoursePageIsNotValidTryAnotherPage');
  return t('instructor:coursesWeCouldNotLoadYourCoursesTryAgain');
}

export function InstructorCoursesPage() {
  const { t } = useTranslation();
  const session = useSession();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [title, setTitle] = useState('');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [openCourseMenuId, setOpenCourseMenuId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CourseDeleteTarget | null>(null);
  const [titleError, setTitleError] = useState<CourseTitleValidationKey | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const failureSummaryRef = useRef<HTMLDivElement>(null);
  const collectionHeadingRef = useRef<HTMLHeadingElement>(null);
  const pendingCollectionFocusPageRef = useRef<number | null>(null);
  const courseMenuRef = useRef<HTMLDivElement>(null);
  const courseMenuTriggerRefs = useRef(new Map<number, HTMLButtonElement>());
  const pendingCourseMenuFocusRef = useRef<CourseMenuFocusTarget | null>(null);
  const isCreateSubmissionPendingRef = useRef(false);
  const page = pageFrom(params.get('page'));
  const cacheEpoch = session.cacheEpoch ?? null;
  const previousCacheEpochRef = useRef<SessionCacheEpoch | null>(null);
  const cacheEpochRef = useRef<SessionCacheEpoch | null>(null);
  if (cacheEpoch !== null) previousCacheEpochRef.current = cacheEpoch;
  cacheEpochRef.current = cacheEpoch;
  const queryEpoch = cacheEpoch ?? previousCacheEpochRef.current;
  const collection = useQuery({
    queryKey:
      queryEpoch !== null
        ? instructorCourseCollectionQueryKey(queryEpoch, page)
        : ['disabled', 'instructor-courses'],
    queryFn: ({ signal }) => requestInstructorCourses(session, page, signal),
    enabled: cacheEpoch !== null,
  });
  const disabledCollectionError =
    cacheEpoch === null && queryEpoch !== null
      ? queryClient.getQueryState(instructorCourseCollectionQueryKey(queryEpoch, page))?.error
      : null;
  const collectionError = collection.isError ? collection.error : disabledCollectionError;
  const hasCollectionError = collectionError !== null && collectionError !== undefined;
  const create = useMutation({
    mutationFn: () => requestCreateCourse(session, { title: title.trim() }),
    onSuccess: () => {
      setTitle('');
      setTitleError(null);
      setIsCreateOpen(false);
      const currentEpoch = cacheEpochRef.current;
      return currentEpoch === null
        ? Promise.resolve()
        : queryClient.invalidateQueries({
            queryKey: instructorCourseCollectionQueryPrefix(currentEpoch),
          });
    },
    onSettled: () => {
      isCreateSubmissionPendingRef.current = false;
    },
  });
  const createdCourse = create.data;
  const resetCreate = create.reset;
  const deleteCourse = useMutation({
    mutationFn: (target: CourseDeleteTarget) => deleteInstructorCourse(session, target.id),
    onSuccess: async () => {
      setDeleteTarget(null);
      const currentEpoch = cacheEpochRef.current;
      if (currentEpoch !== null)
        await queryClient.invalidateQueries({
          queryKey: instructorCourseCollectionQueryPrefix(currentEpoch),
        });
      window.requestAnimationFrame(() =>
        collectionHeadingRef.current?.focus({ preventScroll: true }),
      );
    },
  });
  const openCreateForm = useCallback(() => setIsCreateOpen(true), []);
  useEffect(() => {
    document.addEventListener(INSTRUCTOR_COURSE_CREATE_REQUEST_EVENT, openCreateForm);
    return () =>
      document.removeEventListener(INSTRUCTOR_COURSE_CREATE_REQUEST_EVENT, openCreateForm);
  }, [openCreateForm]);
  useEffect(() => {
    if (!isCreateOpen) return undefined;
    const frame = window.requestAnimationFrame(() => {
      if (typeof titleRef.current?.scrollIntoView === 'function') {
        titleRef.current.scrollIntoView({
          behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
            ? 'auto'
            : 'smooth',
          block: 'center',
        });
      }
      titleRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isCreateOpen]);
  useEffect(() => {
    if (!createdCourse) return undefined;
    const timeout = window.setTimeout(() => resetCreate(), 5000);
    return () => window.clearTimeout(timeout);
  }, [createdCourse, resetCreate]);
  useEffect(() => {
    if (!createdCourse) return undefined;
    const frame = window.requestAnimationFrame(() => {
      collectionHeadingRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [createdCourse]);
  useEffect(() => {
    if (create.isError) failureSummaryRef.current?.focus({ preventScroll: true });
  }, [create.isError]);
  const closeCourseMenu = useCallback(() => {
    pendingCourseMenuFocusRef.current = null;
    setOpenCourseMenuId(null);
  }, []);
  const openCourseMenu = useCallback((courseId: number, focusTarget: CourseMenuFocusTarget) => {
    pendingCourseMenuFocusRef.current = focusTarget;
    setOpenCourseMenuId(courseId);
  }, []);
  useEffect(() => {
    if (openCourseMenuId === null) return;
    const focusTarget = pendingCourseMenuFocusRef.current;
    if (focusTarget === null) return;
    pendingCourseMenuFocusRef.current = null;
    const items = courseMenuItems(courseMenuRef.current);
    const item = focusTarget === 'first' ? items[0] : items[items.length - 1];
    item?.focus({ preventScroll: true });
  }, [openCourseMenuId]);
  useEffect(() => {
    if (openCourseMenuId === null || !collection.data) return;
    if (collection.data.items.some((course) => course.id === openCourseMenuId)) return;
    closeCourseMenu();
  }, [closeCourseMenu, collection.data, openCourseMenuId]);
  useEffect(() => {
    if (openCourseMenuId === null) return undefined;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!courseMenuRef.current?.contains(event.target as Node)) closeCourseMenu();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      const trigger = courseMenuTriggerRefs.current.get(openCourseMenuId);
      trigger?.focus({ preventScroll: true });
      closeCourseMenu();
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer, true);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer, true);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [closeCourseMenu, openCourseMenuId]);
  const handleCourseMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = courseMenuItems(event.currentTarget);
    if (items.length === 0) return;
    const currentIndex = items.findIndex(
      (item) => item === event.target || item.contains(event.target as Node),
    );
    let nextIndex: number | null = null;
    if (event.key === 'ArrowDown') {
      nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
    } else if (event.key === 'ArrowUp') {
      nextIndex =
        currentIndex < 0 ? items.length - 1 : (currentIndex - 1 + items.length) % items.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = items.length - 1;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    items[nextIndex]?.focus({ preventScroll: true });
  };
  useEffect(() => {
    const pendingFocusPage = pendingCollectionFocusPageRef.current;
    if (pendingFocusPage === null) return;
    if (page !== pendingFocusPage || (collection.isError && !collection.isFetching)) {
      pendingCollectionFocusPageRef.current = null;
      return;
    }
    if (!collection.isSuccess || collection.data.page !== pendingFocusPage) return;
    const frame = window.requestAnimationFrame(() => {
      if (pendingCollectionFocusPageRef.current !== pendingFocusPage) return;
      pendingCollectionFocusPageRef.current = null;
      collectionHeadingRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    collection.data?.page,
    collection.isError,
    collection.isFetching,
    collection.isSuccess,
    page,
  ]);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (create.isPending || isCreateSubmissionPendingRef.current) return;
    const validationMessage = titleValidationMessage(title);
    if (validationMessage !== null) {
      setTitleError(validationMessage);
      titleRef.current?.focus();
      return;
    }
    setTitleError(null);
    isCreateSubmissionPendingRef.current = true;
    create.mutate();
  };
  return (
    <article
      className={[styles.page, createdCourse ? styles.pageWithCreationNotice : '']
        .filter(Boolean)
        .join(' ')}
    >
      <header className={styles.pageIntro}>
        <h1>{t('navigation:instructorCourses')}</h1>
        <p>{t('instructor:coursesWorkspaceDescription')}</p>
      </header>
      <section className={styles.collection} aria-labelledby="your-courses-heading">
        <h2 id="your-courses-heading" ref={collectionHeadingRef} tabIndex={-1}>
          {t('instructor:coursesYourCourses')}
        </h2>
        {cacheEpoch !== null && collection.isPending ? (
          <SkeletonGroup label={t('instructor:coursesLoadingYourCourses')}>
            <Skeleton width="100%" height="120px" shape="rect" />
          </SkeletonGroup>
        ) : null}
        {hasCollectionError ? (
          <Notice tone="error" title={t('instructor:coursesCourseListUnavailable')}>
            <p>{collectionFailure(collectionError, t)}</p>
            {cacheEpoch !== null ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  if (collectionError instanceof ApiError && collectionError.status === 422) {
                    pendingCollectionFocusPageRef.current = 1;
                    setParams({});
                    return;
                  }
                  pendingCollectionFocusPageRef.current = page;
                  void collection.refetch();
                }}
              >
                {t('routes:tryAgain')}
              </Button>
            ) : null}
          </Notice>
        ) : null}
        {cacheEpoch !== null && collection.data ? (
          <>
            <p className={styles.collectionCount}>
              {t('catalog:resultCount', { count: collection.data.total })}
            </p>
            {collection.data.items.length === 0 ? (
              <Notice tone="info">{t('instructor:coursesYouHaveNotCreatedAnyCoursesYet')}</Notice>
            ) : (
              <ul className={styles.courseList} aria-label={t('instructor:coursesYourCourses')}>
                {collection.data.items.map((course) => (
                  <li key={course.id} className={styles.courseRow}>
                    <div className={styles.courseThumbnail} aria-hidden="true">
                      <BookOpen size={40} strokeWidth={1.5} />
                    </div>
                    <div className={styles.courseSummary}>
                      <h3>{course.title}</h3>
                      <span>
                        {course.lessonCount}{' '}
                        {t('learning:lessonCount', { count: course.lessonCount })}
                      </span>
                    </div>
                    <nav
                      className={styles.courseActions}
                      aria-label={t('instructor:coursesCourseActions', {
                        courseTitle: course.title,
                      })}
                    >
                      <Link
                        className={styles.courseActionPrimary}
                        to={`/instructor/courses/${course.id}/edit`}
                      >
                        <Pencil aria-hidden="true" focusable="false" size={18} />
                        {t('routes:editCourseTitle')}
                      </Link>
                      <div
                        className={styles.courseMenu}
                        ref={openCourseMenuId === course.id ? courseMenuRef : undefined}
                      >
                        <button
                          ref={(node) => {
                            if (node) courseMenuTriggerRefs.current.set(course.id, node);
                            else courseMenuTriggerRefs.current.delete(course.id);
                          }}
                          className={styles.courseMenuTrigger}
                          id={`course-actions-trigger-${course.id}`}
                          type="button"
                          aria-haspopup="menu"
                          aria-expanded={openCourseMenuId === course.id}
                          aria-controls={
                            openCourseMenuId === course.id
                              ? `course-actions-menu-${course.id}`
                              : undefined
                          }
                          aria-label={t('instructor:coursesCourseActions', {
                            courseTitle: course.title,
                          })}
                          onClick={() => {
                            if (openCourseMenuId === course.id) closeCourseMenu();
                            else openCourseMenu(course.id, 'first');
                          }}
                          onKeyDown={(event) => {
                            if (
                              event.key !== 'Enter' &&
                              event.key !== ' ' &&
                              event.key !== 'ArrowDown' &&
                              event.key !== 'ArrowUp'
                            )
                              return;
                            event.preventDefault();
                            if (event.key === 'Enter' || event.key === ' ') {
                              if (openCourseMenuId === course.id) closeCourseMenu();
                              else openCourseMenu(course.id, 'first');
                              return;
                            }
                            openCourseMenu(course.id, event.key === 'ArrowDown' ? 'first' : 'last');
                          }}
                        >
                          <Ellipsis aria-hidden="true" focusable="false" size={20} />
                        </button>
                        {openCourseMenuId === course.id ? (
                          <div
                            className={styles.courseMenuPopover}
                            id={`course-actions-menu-${course.id}`}
                            role="menu"
                            aria-labelledby={`course-actions-trigger-${course.id}`}
                            onKeyDown={handleCourseMenuKeyDown}
                            onBlur={(event) => {
                              if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                                closeCourseMenu();
                            }}
                          >
                            <Link
                              className={styles.courseMenuItem}
                              role="menuitem"
                              tabIndex={-1}
                              to={`/instructor/courses/${course.id}/enrollments`}
                              onClick={closeCourseMenu}
                            >
                              <Users aria-hidden="true" focusable="false" size={18} />
                              {t('routes:courseEnrollmentsTitle')}
                            </Link>
                            <button
                              className={styles.courseMenuDelete}
                              type="button"
                              role="menuitem"
                              tabIndex={-1}
                              onClick={() => {
                                closeCourseMenu();
                                deleteCourse.reset();
                                setDeleteTarget({ id: course.id, title: course.title });
                              }}
                            >
                              <Trash2 aria-hidden="true" focusable="false" size={18} />
                              {t('instructor:courseEditorDeleteCourse')}
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </nav>
                  </li>
                ))}
              </ul>
            )}
            {collection.data.pages > 1 ? (
              <Pagination
                currentPage={collection.data.page}
                totalPages={collection.data.pages}
                hasNext={collection.data.hasNext}
                hasPrevious={collection.data.hasPrevious}
                label={t('instructor:coursesYourCoursesPagination')}
                directionDisplay="arrows"
                onPageChange={(nextPage) => {
                  pendingCollectionFocusPageRef.current = nextPage;
                  setParams(nextPage === 1 ? {} : { page: String(nextPage) });
                }}
              />
            ) : null}
          </>
        ) : null}
      </section>
      {isCreateOpen ? (
        <section
          id="create-course-panel"
          className={styles.panel}
          aria-labelledby="create-course-heading"
        >
          <h2 id="create-course-heading">{t('instructor:coursesCreateCourse')}</h2>
          <form onSubmit={submit} className={styles.form}>
            <Input
              ref={titleRef}
              id="instructor-course-title"
              name="title"
              label={t('instructor:courseEditorCourseTitle')}
              value={title}
              maxLength={COURSE_TITLE_MAX_LENGTH}
              helpText={t('instructor:coursesMaximum255Characters')}
              error={titleError ? t(`instructor:${titleError}`) : null}
              onChange={(event) => {
                setTitle(event.target.value);
                if (titleError !== null) setTitleError(null);
              }}
              onInvalid={(event) => {
                event.preventDefault();
                const validationMessage = titleValidationMessage(title);
                if (validationMessage !== null) setTitleError(validationMessage);
                titleRef.current?.focus();
              }}
              required
            />
            {create.isError ? (
              <div ref={failureSummaryRef} tabIndex={-1} role="alert">
                <Notice tone="error" politeness="off">
                  {t('instructor:coursesCouldNotCreateCourseTryAgain')}
                </Notice>
              </div>
            ) : null}
            <div className={styles.formActions}>
              <Button
                type="button"
                variant="secondary"
                disabled={create.isPending}
                onClick={() => {
                  setIsCreateOpen(false);
                  setTitle('');
                  setTitleError(null);
                  resetCreate();
                  window.requestAnimationFrame(() =>
                    collectionHeadingRef.current?.focus({ preventScroll: true }),
                  );
                }}
              >
                {t('common:cancel')}
              </Button>
              <Button
                type="submit"
                state={create.isPending ? 'loading' : 'idle'}
                loadingLabel={t('instructor:coursesCreatingCourse')}
              >
                {t('instructor:coursesCreateCourse')}
              </Button>
            </div>
          </form>
        </section>
      ) : null}
      {createdCourse ? (
        <Notice className={styles.creationNotice} tone="success" onDismiss={resetCreate}>
          <div className={styles.creationNoticeContent}>
            <span className={styles.creationNoticeTitle}>
              <span className={styles.creationNoticeIcon}>
                <CircleCheck aria-hidden="true" focusable="false" size={18} />
              </span>
              {t('instructor:coursesCourseCreated')}
            </span>
            <span className={styles.creationNoticeCourse}>{createdCourse.title}</span>
            <nav
              className={styles.successActions}
              aria-label={t('instructor:coursesNewCourseActions')}
            >
              <Link
                className={styles.courseActionPrimary}
                to={`/instructor/courses/${createdCourse.id}/edit`}
              >
                {t('routes:editCourseTitle')}
              </Link>
            </nav>
          </div>
        </Notice>
      ) : null}
      <DestructiveConfirmation
        open={deleteTarget !== null}
        title={t('instructor:courseEditorDeleteThisCourse')}
        description={
          deleteTarget
            ? t('instructor:courseEditorDeleteCoursePermanent').replace(
                '{courseTitle}',
                deleteTarget.title,
              )
            : ''
        }
        confirmLabel={t('instructor:courseEditorDeleteCourse')}
        pendingLabel={t('instructor:courseEditorDeletingCourse')}
        confirming={deleteCourse.isPending}
        error={deleteCourse.isError ? t('common:unableToCompleteAction') : undefined}
        onConfirm={() => {
          if (deleteTarget) deleteCourse.mutate(deleteTarget);
        }}
        onCancel={() => {
          if (deleteCourse.isPending) return;
          const trigger = deleteTarget
            ? courseMenuTriggerRefs.current.get(deleteTarget.id)
            : undefined;
          deleteCourse.reset();
          setDeleteTarget(null);
          window.requestAnimationFrame(() => trigger?.focus());
        }}
      />
    </article>
  );
}
