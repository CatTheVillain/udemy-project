import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft } from 'lucide-react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { requestCourseEnrollments } from '@features/instructor-courses';
import type { EnrollmentStatusDto } from '@entities/enrollment';
import { useSession } from '@features/auth-session';
import {
  Button,
  ContextualNavigationLink,
  Notice,
  Pagination,
  Skeleton,
  SkeletonGroup,
} from '@shared/ui/primitives';
import { ApiError, type SessionCacheEpoch } from '@shared/api';
import { instructorCourseRosterQueryKey } from '@shared/api/query-keys';
import styles from './InstructorCourseEnrollmentsPage.module.css';

function positiveSafeInteger(value: string | null | undefined): number | null {
  if (!value || !/^[1-9]\d*$/.test(value)) return null;
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) ? numeric : null;
}
function pageFrom(value: string | null): number {
  return positiveSafeInteger(value) ?? 1;
}
function failure(error: unknown, t: TFunction): string {
  if (error instanceof ApiError && error.status === 403)
    return t('instructor:courseEnrollmentsYouDoNotHavePermissionToViewTheseEnrollments');
  if (error instanceof ApiError && error.status === 404)
    return t('instructor:courseEnrollmentsThisCourseWasNotFound');
  return t('instructor:courseEnrollmentsWeCouldNotLoadCourseEnrollmentsTryAgain');
}

function InstructorCoursesReturnLink() {
  const { t } = useTranslation();
  return (
    <nav className={styles.breadcrumb} aria-label={t('a11y:breadcrumb')}>
      <ContextualNavigationLink className={styles.breadcrumbLink} to="/instructor/courses">
        <ChevronLeft size={20} aria-hidden="true" />
        <span>{t('navigation:instructorCourses')}</span>
      </ContextualNavigationLink>
      <span className={styles.breadcrumbCurrent} aria-hidden="true">
        /
      </span>
      <span className={styles.breadcrumbCurrent} aria-current="page">
        {t('routes:courseEnrollmentsTitle')}
      </span>
    </nav>
  );
}
function enrollmentStatusLabel(status: EnrollmentStatusDto, t: TFunction): string {
  switch (status) {
    case 'active':
      return t('learning:active');
    case 'cancelled':
      return t('learning:cancelled');
    case 'pending_payment':
      return t('learning:paymentPending');
  }
}
export function InstructorCourseEnrollmentsPage() {
  const { t } = useTranslation();
  const { courseId } = useParams();
  const [params, setParams] = useSearchParams();
  const session = useSession();
  const queryClient = useQueryClient();
  const heading = useRef<HTMLHeadingElement>(null);
  const id = positiveSafeInteger(courseId);
  const page = pageFrom(params.get('page'));
  const cacheEpoch = session.cacheEpoch ?? null;
  const previousCacheEpochRef = useRef<SessionCacheEpoch | null>(null);
  if (cacheEpoch !== null) previousCacheEpochRef.current = cacheEpoch;
  const queryEpoch = cacheEpoch ?? previousCacheEpochRef.current;
  const roster = useQuery({
    queryKey:
      queryEpoch !== null && id !== null
        ? instructorCourseRosterQueryKey(queryEpoch, id, page)
        : ['disabled', 'instructor-course-enrollments'],
    queryFn: ({ signal }) => requestCourseEnrollments(session, id as number, page, signal),
    enabled: cacheEpoch !== null && id !== null,
  });
  const disabledRosterError =
    cacheEpoch === null && queryEpoch !== null && id !== null
      ? queryClient.getQueryState(instructorCourseRosterQueryKey(queryEpoch, id, page))?.error
      : null;
  const rosterError = roster.isError ? roster.error : disabledRosterError;
  const hasRosterError = rosterError !== null && rosterError !== undefined;
  useEffect(() => {
    if (roster.isSuccess) heading.current?.focus();
  }, [roster.isSuccess, page]);
  if (id === null)
    return (
      <article className={styles.page}>
        <InstructorCoursesReturnLink />
        <h1>{t('routes:courseEnrollmentsTitle')}</h1>
        <Notice tone="error">{t('instructor:courseEnrollmentsThisCourseWasNotFound')}</Notice>
      </article>
    );
  if (cacheEpoch !== null && roster.isPending)
    return (
      <article className={styles.page}>
        <InstructorCoursesReturnLink />
        <h1 ref={heading} tabIndex={-1}>
          {t('routes:courseEnrollmentsTitle')}
        </h1>
        <SkeletonGroup label={t('instructor:courseEnrollmentsLoadingCourseEnrollments')}>
          <Skeleton width="100%" height="120px" shape="rect" />
        </SkeletonGroup>
      </article>
    );
  if (hasRosterError)
    return (
      <article className={styles.page}>
        <InstructorCoursesReturnLink />
        <h1 ref={heading} tabIndex={-1}>
          {t('routes:courseEnrollmentsTitle')}
        </h1>
        <Notice tone="error">
          <p>{failure(rosterError, t)}</p>
          {cacheEpoch !== null ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                void roster.refetch();
              }}
            >
              {t('routes:tryAgain')}
            </Button>
          ) : null}
        </Notice>
      </article>
    );
  const result = cacheEpoch !== null ? roster.data : undefined;
  if (!result) return null;
  return (
    <article className={styles.page}>
      <InstructorCoursesReturnLink />
      <header>
        <h1 ref={heading} tabIndex={-1}>
          {t('routes:courseEnrollmentsTitle')}
        </h1>
        <p>{t('instructor:courseEnrollmentsCount', { count: result.total })}</p>
      </header>
      {result.items.length === 0 ? (
        <Notice tone="info">{t('instructor:courseEnrollmentsNoEnrollmentsYet')}</Notice>
      ) : (
        <ul className={styles.list}>
          {result.items.map((entry) => (
            <li key={entry.id}>
              <strong>{`${entry.student.name} ${entry.student.surname}`}</strong>
              <span>{entry.student.email}</span>
              <span>{enrollmentStatusLabel(entry.status, t)}</span>
            </li>
          ))}
        </ul>
      )}
      {result.pages > 1 ? (
        <Pagination
          currentPage={result.page}
          totalPages={result.pages}
          hasNext={result.hasNext}
          hasPrevious={result.hasPrevious}
          onPageChange={(next) => setParams(next === 1 ? {} : { page: String(next) })}
          label={t('instructor:courseEnrollmentsCourseEnrollmentsPagination')}
        />
      ) : null}
    </article>
  );
}
