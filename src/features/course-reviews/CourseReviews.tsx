import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageSquareMore, Star, Trash2 } from 'lucide-react';

import { REVIEW_COMMENT_MAX_LENGTH } from '@entities/review';
import {
  Button,
  DestructiveConfirmation,
  Notice,
  Pagination,
  Skeleton,
  SkeletonGroup,
  Textarea,
} from '@shared/ui/primitives';
import { LOCALE_RESOURCES, resolveLocale, type Locale } from '@shared/locale';

import { useCourseReviews } from './useCourseReviews';
import {
  REVIEW_RATINGS,
  ReviewRatingSelector,
  type ReviewRatingSelection,
  type ReviewRatingValue,
} from './ReviewRatingSelector';
import styles from './CourseReviews.module.css';

export interface CourseReviewsProps {
  readonly courseId: number;
  readonly canWriteReview: boolean;
}

interface ReviewDraft {
  readonly rating: ReviewRatingSelection;
  readonly comment: string;
}

type ReviewMutationKind = 'create' | 'update';

interface SubmittedReviewAttempt {
  readonly identity: string;
  readonly generation: number;
  readonly draft: ReviewDraft;
  readonly kind: ReviewMutationKind;
}

interface ReviewStarsProps {
  readonly label: string;
  readonly rating: number;
}

interface ReviewFormCopy {
  readonly courseReviewsHeading: string;
  readonly editReviewShort: string;
  readonly noReviewsDescription: string;
  readonly reviewCommentPlaceholder: string;
  readonly reviewCommentPrompt: string;
  readonly saveReviewChanges: string;
  readonly yourReview: string;
}

type ReviewFormCopyKey = keyof ReviewFormCopy;

function reviewFormCopy(locale: Locale): ReviewFormCopy {
  const courseCopy = LOCALE_RESOURCES[locale].course as Record<string, string>;
  return {
    courseReviewsHeading: courseCopy.courseReviewsHeading,
    editReviewShort: courseCopy.editReviewShort,
    noReviewsDescription: courseCopy.noReviewsDescription,
    reviewCommentPlaceholder: courseCopy.reviewCommentPlaceholder,
    reviewCommentPrompt: courseCopy.reviewCommentPrompt,
    saveReviewChanges: courseCopy.saveReviewChanges,
    yourReview: courseCopy.yourReview,
  };
}

const reviewFormCopyByLocale = {
  en: reviewFormCopy('en'),
  ru: reviewFormCopy('ru'),
  uz: reviewFormCopy('uz'),
} satisfies Readonly<Record<Locale, ReviewFormCopy>>;

function resolveReviewFormCopy(
  translatedValue: string,
  key: ReviewFormCopyKey,
  fallback: string,
): string {
  return translatedValue === 'Translation unavailable' ||
    translatedValue === key ||
    translatedValue === `course:${key}`
    ? fallback
    : translatedValue;
}

function validRating(value: number): value is ReviewRatingValue {
  return Number.isInteger(value) && value >= 1 && value <= 5;
}

function reviewDraft(review: {
  readonly rating: number;
  readonly comment: string | null;
}): ReviewDraft {
  return {
    rating: validRating(review.rating) ? review.rating : 0,
    comment: (review.comment ?? '').slice(0, REVIEW_COMMENT_MAX_LENGTH),
  };
}

function sameReviewDraft(left: ReviewDraft | null, right: ReviewDraft | null): boolean {
  return (
    left !== null &&
    right !== null &&
    left.rating === right.rating &&
    left.comment === right.comment
  );
}

function ReviewStars({ label, rating }: ReviewStarsProps) {
  const normalizedRating = validRating(rating) ? rating : 0;
  return (
    <div className={styles.reviewRating}>
      <span className={styles.reviewStars} role="img" aria-label={`${label}: ${rating}/5`}>
        {REVIEW_RATINGS.map((value) => (
          <Star
            className={value <= normalizedRating ? styles.reviewStarSelected : undefined}
            key={value}
            size={20}
            fill={value <= normalizedRating ? 'currentColor' : 'none'}
            aria-hidden="true"
          />
        ))}
      </span>
    </div>
  );
}

export function CourseReviews({ courseId, canWriteReview }: CourseReviewsProps) {
  const { i18n, t } = useTranslation();
  const canonicalCourseCopy =
    reviewFormCopyByLocale[
      resolveLocale({ browserLocales: [i18n.resolvedLanguage ?? i18n.language] })
    ];
  const localizedCourseCopy: ReviewFormCopy = {
    courseReviewsHeading: resolveReviewFormCopy(
      t('course:courseReviewsHeading'),
      'courseReviewsHeading',
      canonicalCourseCopy.courseReviewsHeading,
    ),
    editReviewShort: resolveReviewFormCopy(
      t('course:editReviewShort'),
      'editReviewShort',
      canonicalCourseCopy.editReviewShort,
    ),
    noReviewsDescription: resolveReviewFormCopy(
      t('course:noReviewsDescription'),
      'noReviewsDescription',
      canonicalCourseCopy.noReviewsDescription,
    ),
    reviewCommentPlaceholder: resolveReviewFormCopy(
      t('course:reviewCommentPlaceholder'),
      'reviewCommentPlaceholder',
      canonicalCourseCopy.reviewCommentPlaceholder,
    ),
    reviewCommentPrompt: resolveReviewFormCopy(
      t('course:reviewCommentPrompt'),
      'reviewCommentPrompt',
      canonicalCourseCopy.reviewCommentPrompt,
    ),
    saveReviewChanges: resolveReviewFormCopy(
      t('course:saveReviewChanges'),
      'saveReviewChanges',
      canonicalCourseCopy.saveReviewChanges,
    ),
    yourReview: resolveReviewFormCopy(
      t('course:yourReview'),
      'yourReview',
      canonicalCourseCopy.yourReview,
    ),
  };
  const reviews = useCourseReviews(courseId);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [rating, setRating] = useState<ReviewRatingSelection>(0);
  const [comment, setComment] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editingOwnedReview, setEditingOwnedReview] = useState(false);
  const [focusReviewsAfterDelete, setFocusReviewsAfterDelete] = useState(false);
  const draftRef = useRef<ReviewDraft>({ rating: 0, comment: '' });
  const baselineRef = useRef<ReviewDraft | null>(null);
  const hydratedIdentityRef = useRef<string | null>(null);
  const activeIdentityRef = useRef(reviews.identity);
  const activeGenerationRef = useRef(reviews.generation);
  const submittedAttemptRef = useRef<SubmittedReviewAttempt | null>(null);
  const previouslyOwnedReviewRef = useRef(false);
  activeIdentityRef.current = reviews.identity;
  activeGenerationRef.current = reviews.generation;
  const currentReview = reviews.current.data;
  const hasCurrentReview = reviews.current.isSuccess;
  const isEditing = reviews.hasOwnedReview;
  const mutation = isEditing ? reviews.update : reviews.create;
  useEffect(() => {
    if (hydratedIdentityRef.current !== reviews.identity) {
      hydratedIdentityRef.current = reviews.identity;
      baselineRef.current = null;
      draftRef.current = { rating: 0, comment: '' };
      setRating(0);
      setComment('');
      setEditingOwnedReview(false);
      setConfirmDelete(false);
      previouslyOwnedReviewRef.current = false;
    }
    if (hasCurrentReview) {
      const nextBaseline = reviewDraft(currentReview as NonNullable<typeof currentReview>);
      const previousBaseline = baselineRef.current;
      const wasClean = sameReviewDraft(draftRef.current, previousBaseline);
      baselineRef.current = nextBaseline;
      if (wasClean || previousBaseline === null) {
        draftRef.current = nextBaseline;
        setRating(nextBaseline.rating);
        setComment(nextBaseline.comment);
      }
      previouslyOwnedReviewRef.current = true;
    } else if (
      reviews.noOwnedReview &&
      (baselineRef.current === null || previouslyOwnedReviewRef.current)
    ) {
      const emptyDraft = { rating: 0, comment: '' } as const;
      baselineRef.current = emptyDraft;
      draftRef.current = emptyDraft;
      setRating(emptyDraft.rating);
      setComment(emptyDraft.comment);
      setEditingOwnedReview(false);
      previouslyOwnedReviewRef.current = false;
    }
  }, [currentReview, hasCurrentReview, reviews.identity, reviews.noOwnedReview]);
  const acceptSavedReview = useCallback(
    (savedReview: NonNullable<typeof currentReview>, submittedAttempt: SubmittedReviewAttempt) => {
      if (
        activeIdentityRef.current !== submittedAttempt.identity ||
        activeGenerationRef.current !== submittedAttempt.generation ||
        !sameReviewDraft(draftRef.current, submittedAttempt.draft)
      )
        return;
      const nextBaseline = reviewDraft(savedReview);
      baselineRef.current = nextBaseline;
      draftRef.current = nextBaseline;
      setRating(nextBaseline.rating);
      setComment(nextBaseline.comment);
      setEditingOwnedReview(false);
      submittedAttemptRef.current = null;
    },
    [],
  );
  useEffect(() => {
    const submittedAttempt = submittedAttemptRef.current;
    if (submittedAttempt?.kind !== 'create' || !reviews.create.isSuccess || !reviews.create.data)
      return;
    acceptSavedReview(reviews.create.data, submittedAttempt);
  }, [acceptSavedReview, reviews.create.data, reviews.create.isSuccess]);
  useEffect(() => {
    if (confirmDelete || !focusReviewsAfterDelete) return;

    headingRef.current?.focus();
    setFocusReviewsAfterDelete(false);
  }, [confirmDelete, focusReviewsAfterDelete]);
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!validRating(rating)) return;
    const body = { rating, comment: comment.trim() || null };
    const submittedDraft: ReviewDraft = { rating, comment };
    const submittedGeneration = reviews.generation;
    const kind: ReviewMutationKind = isEditing ? 'update' : 'create';
    submittedAttemptRef.current = {
      identity: reviews.identity,
      generation: submittedGeneration,
      draft: submittedDraft,
      kind,
    };
    if (kind === 'update')
      reviews.update.mutate(body, {
        onSuccess: (savedReview) => {
          if (!savedReview) {
            setEditingOwnedReview(false);
            return;
          }
          const submittedAttempt = submittedAttemptRef.current;
          if (submittedAttempt?.kind === 'update') acceptSavedReview(savedReview, submittedAttempt);
        },
      });
    else reviews.create.mutate(body);
  };
  const cancelEditing = () => {
    const baseline = baselineRef.current ?? { rating: 0, comment: '' };
    draftRef.current = baseline;
    setRating(baseline.rating);
    setComment(baseline.comment);
    setEditingOwnedReview(false);
  };
  const mutationError = mutation.error ? t('common:pleaseTryAgain') : null;
  const canShowForm =
    (canWriteReview || reviews.hasOwnedReview) &&
    (reviews.current.isSuccess || reviews.noOwnedReview);
  const reviewForm =
    canShowForm && (!isEditing || editingOwnedReview) ? (
      <form className={styles.form} data-part="review-form" onSubmit={submit}>
        <h3>{isEditing ? t('course:editReview') : t('course:writeReview')}</h3>
        <ReviewRatingSelector
          label={t('course:ratingLabel')}
          value={rating}
          onChange={(nextRating) => {
            draftRef.current = { ...draftRef.current, rating: nextRating };
            setRating(nextRating);
          }}
        />
        <Textarea
          fieldClassName={styles.commentField}
          label={localizedCourseCopy.reviewCommentPrompt}
          placeholder={localizedCourseCopy.reviewCommentPlaceholder}
          maxLength={REVIEW_COMMENT_MAX_LENGTH}
          helpText={
            <span aria-live="polite">
              {comment.length}/{REVIEW_COMMENT_MAX_LENGTH}
            </span>
          }
          value={comment}
          onChange={(event) => {
            const nextComment = event.target.value.slice(0, REVIEW_COMMENT_MAX_LENGTH);
            draftRef.current = { ...draftRef.current, comment: nextComment };
            setComment(nextComment);
          }}
        />
        {mutationError ? (
          <Notice tone="error" title={t('common:unableToCompleteAction')}>
            {mutationError}
          </Notice>
        ) : null}
        <div className={styles.actions}>
          {isEditing ? (
            <Button
              variant="ghost"
              className={styles.reviewSecondaryAction}
              onClick={cancelEditing}
            >
              {t('common:cancel')}
            </Button>
          ) : null}
          <Button
            fullWidth={!isEditing}
            type="submit"
            disabled={!validRating(rating)}
            state={mutation.isPending ? 'loading' : 'idle'}
          >
            {isEditing ? localizedCourseCopy.saveReviewChanges : t('course:saveReview')}
          </Button>
        </div>
      </form>
    ) : null;
  const publicReviews = (reviews.list.data?.items ?? []).filter(
    (review) => review.id !== currentReview?.id,
  );
  const isPublicListEmpty =
    reviews.list.data !== undefined && publicReviews.length === 0 && !reviews.hasOwnedReview;
  return (
    <section className={styles.section} aria-labelledby="course-reviews-heading">
      <h2 ref={headingRef} id="course-reviews-heading" tabIndex={-1}>
        {t('course:reviewsHeading')}
      </h2>
      {reviews.list.isPending ? (
        <SkeletonGroup label={t('common:loading')}>
          <Skeleton height="80px" shape="rect" />
        </SkeletonGroup>
      ) : null}
      {reviews.list.isError ? (
        <Notice tone="error" title={t('course:reviewsLoadFailed')}>
          <Button
            variant="secondary"
            aria-label={t('course:reviewsHeading')}
            onClick={() => void reviews.list.refetch()}
          >
            {t('routes:tryAgain')}
          </Button>
        </Notice>
      ) : null}
      {reviews.hasOwnedReview && currentReview && !editingOwnedReview ? (
        <article className={styles.ownedReview} data-part="owned-review">
          <div className={styles.ownedReviewHeader}>
            <h3>{localizedCourseCopy.yourReview}</h3>
            <div className={styles.ownedReviewActions}>
              <Button
                variant="ghost"
                size="sm"
                className={styles.reviewSecondaryAction}
                aria-label={t('course:editReview')}
                onClick={() => setEditingOwnedReview(true)}
              >
                {localizedCourseCopy.editReviewShort}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className={styles.deleteReviewAction}
                aria-label={t('course:deleteReview')}
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 size={20} aria-hidden="true" />
              </Button>
            </div>
          </div>
          <ReviewStars label={t('course:ratingLabel')} rating={currentReview.rating ?? 0} />
          {currentReview.comment ? <p>{currentReview.comment}</p> : null}
        </article>
      ) : null}
      {reviews.hasOwnedReview && editingOwnedReview ? reviewForm : null}
      {isPublicListEmpty ? (
        <div
          className={[styles.emptyLayout, reviewForm ? styles.emptyLayoutWithForm : '']
            .filter(Boolean)
            .join(' ')}
        >
          <div className={styles.emptyState} data-part="reviews-empty-state">
            <span className={styles.emptyIcon} aria-hidden="true">
              <MessageSquareMore size={24} strokeWidth={1.75} />
            </span>
            <p className={styles.emptyTitle}>{t('course:noReviews')}</p>
            <p className={styles.emptyDescription}>{localizedCourseCopy.noReviewsDescription}</p>
          </div>
          {reviewForm}
        </div>
      ) : null}
      {publicReviews.length > 0 ? (
        <section className={styles.publicReviews} aria-labelledby="course-public-reviews-heading">
          <h3 id="course-public-reviews-heading">{localizedCourseCopy.courseReviewsHeading}</h3>
          <div className={styles.reviewList}>
            {publicReviews.map((review) => (
              <article className={styles.review} key={review.id}>
                <ReviewStars label={t('course:ratingLabel')} rating={review.rating ?? 0} />
                {review.comment ? <p>{review.comment}</p> : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}
      {reviews.list.data && reviews.list.data.pages > 1 ? (
        <Pagination
          currentPage={reviews.list.data.page}
          totalPages={reviews.list.data.pages}
          hasNext={reviews.list.data.has_next}
          hasPrevious={reviews.list.data.has_previous}
          onPageChange={reviews.setPage}
        />
      ) : null}
      {!isPublicListEmpty && !reviews.hasOwnedReview ? reviewForm : null}
      <DestructiveConfirmation
        open={confirmDelete}
        title={t('course:deleteReviewTitle')}
        description={t('course:deleteReviewDescription')}
        confirmLabel={t('course:deleteReview')}
        confirming={reviews.remove.isPending}
        error={reviews.remove.error ? t('common:pleaseTryAgain') : undefined}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() =>
          reviews.remove.mutate(undefined, {
            onSuccess: () => {
              setConfirmDelete(false);
              setEditingOwnedReview(false);
              setFocusReviewsAfterDelete(true);
            },
          })
        }
      />
    </section>
  );
}
