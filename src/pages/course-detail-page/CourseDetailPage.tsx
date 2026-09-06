import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useParams } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';

import { courseDetailFailure, useCourseDetail } from '@features/course-detail';
import { CourseReviews } from '@features/course-reviews';
import { sanitizeInternalReturnTo, useSession } from '@features/auth-session';
import { parseCatalogQuery, serializeCatalogQuery } from '@features/catalog-discovery';
import {
  Button,
  ContextualNavigationLink,
  Notice,
  Skeleton,
  SkeletonGroup,
  VisuallyHidden,
} from '@shared/ui/primitives';

import { CourseActionPanel } from './CourseActionPanel';
import styles from './CourseDetailPage.module.css';
import { CourseOutline } from './CourseOutline';

function parseCourseId(value: string | undefined): number | null {
  if (!value || !/^[1-9]\d*$/.test(value)) return null;
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) ? numeric : null;
}

type CourseRecoveryTarget = 'detail' | 'outline';
type CourseRecoveryMessageKey = 'courseDetailsRecovered' | 'courseOutlineRecovered';

interface CourseRetryFocusIntent {
  readonly identity: string;
  readonly target: CourseRecoveryTarget;
}

interface CourseCatalogReturnNavigationState {
  readonly returnTo: string;
}

const COURSE_CATALOG_RETURN_FALLBACK_ORIGIN = 'http://localhost';

function isExactCanonicalCatalogReturnInput(
  returnTo: string,
  origin: string,
  canonicalTarget: string,
): boolean {
  return returnTo === canonicalTarget || returnTo === `${origin}${canonicalTarget}`;
}

function getExactCourseCatalogReturnTo(
  state: unknown,
): CourseCatalogReturnNavigationState['returnTo'] | null {
  if (!state || typeof state !== 'object') return null;

  try {
    if (Array.isArray(state)) return null;

    const ownKeys = Reflect.ownKeys(state);
    if (ownKeys.length !== 1 || ownKeys[0] !== 'returnTo') return null;

    const returnToDescriptor = Object.getOwnPropertyDescriptor(state, 'returnTo');
    if (!returnToDescriptor || !('value' in returnToDescriptor)) return null;

    return typeof returnToDescriptor.value === 'string' ? returnToDescriptor.value : null;
  } catch {
    return null;
  }
}

export function resolveCourseCatalogReturnTarget(state: unknown): string {
  const returnTo = getExactCourseCatalogReturnTo(state);
  if (returnTo === null) return '/';

  const origin = globalThis.location?.origin ?? COURSE_CATALOG_RETURN_FALLBACK_ORIGIN;

  try {
    const url = new URL(returnTo, origin);
    const canonicalSearch = serializeCatalogQuery(parseCatalogQuery(url.searchParams));
    const expectedSearch = canonicalSearch ? `?${canonicalSearch}` : '';
    const canonicalTarget = `/${url.search}${url.hash}`;
    if (
      url.origin !== origin ||
      url.pathname !== '/' ||
      url.search !== expectedSearch ||
      !isExactCanonicalCatalogReturnInput(returnTo, origin, canonicalTarget)
    )
      return '/';

    return sanitizeInternalReturnTo(canonicalTarget, origin) === canonicalTarget
      ? canonicalTarget
      : '/';
  } catch {
    return '/';
  }
}

function CourseNotFound() {
  const { t } = useTranslation();
  return (
    <section className={styles.state} aria-labelledby="course-not-found-heading">
      <h1 id="course-not-found-heading">
        {t('course:courseNotFound', { defaultValue: 'Course not found' })}
      </h1>
      <p>{t('course:thisCourseDoesNotExistOr')}</p>
      <ContextualNavigationLink className={styles.courseNotFoundReturnLink} to="/">
        {t('course:returnToTheCourseCatalog', { defaultValue: 'Return to the course catalog' })}
      </ContextualNavigationLink>
    </section>
  );
}

export function CourseDetailPage() {
  const { t } = useTranslation();
  const { courseId: courseIdParam } = useParams();
  const location = useLocation();
  const courseId = parseCourseId(courseIdParam);
  const session = useSession();
  const { action, detail, mutationState, outline, preflight, retryPreflight, submitAction } =
    useCourseDetail(courseId);
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);
  const outlineHeadingRef = useRef<HTMLHeadingElement>(null);
  const retryIntentRef = useRef<CourseRetryFocusIntent | null>(null);
  const [recoveryMessage, setRecoveryMessage] = useState<CourseRecoveryMessageKey | null>(null);
  const retryIdentity = `${session.cacheEpoch ?? 'anonymous'}:${courseId ?? 'invalid'}`;

  useEffect(() => {
    retryIntentRef.current = null;
    setRecoveryMessage(null);
  }, [retryIdentity]);

  useEffect(() => {
    const intent = retryIntentRef.current;
    if (intent?.identity !== retryIdentity) return;
    if (intent.target === 'detail' && detail.isSuccess) {
      retryIntentRef.current = null;
      setRecoveryMessage('courseDetailsRecovered');
      detailHeadingRef.current?.focus();
    } else if (intent.target === 'outline' && outline.isSuccess) {
      retryIntentRef.current = null;
      setRecoveryMessage('courseOutlineRecovered');
      outlineHeadingRef.current?.focus();
    }
  }, [detail.isSuccess, outline.isSuccess, retryIdentity]);

  const finishRetry = (intent: CourseRetryFocusIntent, succeeded: boolean) => {
    if (!succeeded && retryIntentRef.current === intent) retryIntentRef.current = null;
  };

  const retryDetail = () => {
    const intent: CourseRetryFocusIntent = { identity: retryIdentity, target: 'detail' };
    retryIntentRef.current = intent;
    setRecoveryMessage(null);
    void detail.refetch().then(
      (result) => finishRetry(intent, result.isSuccess),
      () => finishRetry(intent, false),
    );
  };
  const retryOutline = () => {
    const intent: CourseRetryFocusIntent = { identity: retryIdentity, target: 'outline' };
    retryIntentRef.current = intent;
    setRecoveryMessage(null);
    void outline.refetch().then(
      (result) => finishRetry(intent, result.isSuccess),
      () => finishRetry(intent, false),
    );
  };

  if (courseId === null) return <CourseNotFound />;
  if (detail.isPending) {
    return (
      <SkeletonGroup className={styles.loading} label={t('a11y:loadingCourseDetails')}>
        <Skeleton height="40px" width="70%" />
        <Skeleton height="24px" width="45%" />
        <Skeleton height="160px" width="100%" shape="rect" />
      </SkeletonGroup>
    );
  }
  if (detail.isError) {
    const failure = courseDetailFailure(detail.error);
    if (failure.notFound) return <CourseNotFound />;
    return (
      <section className={styles.state} aria-labelledby="course-error-heading">
        <h1 id="course-error-heading">{t(failure.titleKey)}</h1>
        <Notice tone="error" title={t(failure.titleKey)}>
          {t(failure.messageKey)}
        </Notice>
        <Button onClick={retryDetail}>{t('routes:tryAgain', { defaultValue: 'Try again' })}</Button>
      </section>
    );
  }

  const course = detail.data;
  const catalogReturnTarget = resolveCourseCatalogReturnTarget(location.state);
  const isDraft = course.publishedAt === null;
  const description =
    course.description ??
    t('catalog:noCourseDescriptionIsAvailable', {
      defaultValue: 'No course description is available.',
    });

  return (
    <article className={styles.page}>
      {recoveryMessage ? (
        <VisuallyHidden as="p" role="status" aria-live="polite">
          {t(`course:${recoveryMessage}`, {
            defaultValue:
              recoveryMessage === 'courseDetailsRecovered'
                ? 'Course details recovered.'
                : 'Course outline recovered.',
          })}
        </VisuallyHidden>
      ) : null}
      <div className={styles.contextualSummary}>
        <ContextualNavigationLink to={catalogReturnTarget}>
          <ChevronLeft size={20} aria-hidden="true" />
          {t('routes:backToCatalog', { defaultValue: 'Back to catalog' })}
        </ContextualNavigationLink>
        <header className={styles.summary}>
          <div className={styles.intro}>
            <p className={styles.eyebrow}>
              {isDraft
                ? t('course:draftCourse')
                : t('routes:courseDetailsTitle', { defaultValue: 'Course details' })}
            </p>
            <h1 ref={detailHeadingRef} className={styles.recoveryTarget} tabIndex={-1}>
              {course.title}
            </h1>
            <p className={styles.description}>{description}</p>
            <dl className={styles.metadata}>
              <div>
                <dt>{t('course:instructor', { defaultValue: 'Instructor' })}</dt>
                <dd>{course.instructorName}</dd>
              </div>
              <div>
                <dt>{t('course:totalLessons', { defaultValue: 'Total lessons' })}</dt>
                <dd>{outline.data?.total ?? course.lessons.length}</dd>
              </div>
              <div>
                <dt>{t('course:status', { defaultValue: 'Status' })}</dt>
                <dd>
                  {isDraft
                    ? t('course:draft', { defaultValue: 'Draft' })
                    : t('course:published', { defaultValue: 'Published' })}
                </dd>
              </div>
            </dl>
          </div>
          <CourseActionPanel
            action={action}
            course={course}
            isDraft={isDraft}
            mutationState={mutationState}
            preflight={preflight}
            onRetryPreflight={() => void retryPreflight()}
            onSubmitAction={submitAction}
          />
        </header>
      </div>

      <CourseOutline
        error={outline.error}
        headingRef={outlineHeadingRef}
        isError={outline.isError}
        isPending={outline.isPending}
        items={outline.data?.items}
        onRetry={retryOutline}
      />
      <CourseReviews
        key={courseId}
        courseId={courseId}
        canWriteReview={preflight === 'already-enrolled'}
      />
    </article>
  );
}
