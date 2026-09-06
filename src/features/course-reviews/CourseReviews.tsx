import { useEffect, useId, useRef, useState } from 'react';
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
import styles from './CourseReviews.module.css';

export interface CourseReviewsProps {
  readonly courseId: number;
  readonly canWriteReview: boolean;
}

type ReviewRatingValue = 1 | 2 | 3 | 4 | 5;
type ReviewRatingSelection = ReviewRatingValue | 0;

interface ReviewRatingSelectorProps {
  readonly label: string;
  readonly value: ReviewRatingSelection;
  onChange(value: ReviewRatingValue): void;
}

type ReviewRatingPreviewSource = 'pointer' | 'focus';
type ReviewRatingVisualState = 'neutral' | 'committed' | 'preview';

interface ReviewRatingPreviewIntent {
  readonly rating: ReviewRatingValue;
  readonly source: ReviewRatingPreviewSource;
  readonly order: number;
}

interface ReviewRatingActivationLatch {
  readonly rating: ReviewRatingValue;
  readonly source: ReviewRatingPreviewSource;
}

interface ReviewRatingDisplayState {
  readonly pointerCandidate: ReviewRatingPreviewIntent | null;
  readonly focusCandidate: ReviewRatingPreviewIntent | null;
  readonly latestIntent: ReviewRatingPreviewIntent | null;
  readonly activationLatch: ReviewRatingActivationLatch | null;
}

interface ReviewRatingDisplayResult {
  readonly rating: ReviewRatingSelection;
  readonly state: ReviewRatingVisualState;
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

const reviewRatings: readonly ReviewRatingValue[] = [1, 2, 3, 4, 5];

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

function ratingDisplayResult(
  displayState: ReviewRatingDisplayState,
  committedRating: ReviewRatingSelection,
): ReviewRatingDisplayResult {
  const pointerCandidate = displayState.pointerCandidate;
  const focusCandidate = displayState.focusCandidate;
  const winner =
    pointerCandidate && focusCandidate
      ? pointerCandidate.order > focusCandidate.order
        ? pointerCandidate
        : focusCandidate
      : (pointerCandidate ?? focusCandidate);
  if (winner) return { rating: winner.rating, state: 'preview' };
  return committedRating > 0
    ? { rating: committedRating, state: 'committed' }
    : { rating: 0, state: 'neutral' };
}

function emptyRatingDisplayState(): ReviewRatingDisplayState {
  return {
    pointerCandidate: null,
    focusCandidate: null,
    latestIntent: null,
    activationLatch: null,
  };
}

function ReviewRatingSelector({ label, value, onChange }: ReviewRatingSelectorProps) {
  const name = `review-rating-${useId()}`;
  const [displayState, setDisplayState] =
    useState<ReviewRatingDisplayState>(emptyRatingDisplayState);
  const previewOrderRef = useRef(0);
  const pointerActivationRef = useRef<number | null>(null);
  const pointerActivationSequenceRef = useRef(0);
  const ratingOptionsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const deferPointerActivationReset = (event: PointerEvent) => {
      if (pointerActivationRef.current !== event.pointerId) return;
      const target = event.target;
      if (!(target instanceof Node) || !ratingOptionsRef.current?.contains(target)) {
        pointerActivationRef.current = null;
        return;
      }
      const sequence = pointerActivationSequenceRef.current;
      window.setTimeout(() => {
        if (pointerActivationSequenceRef.current === sequence) pointerActivationRef.current = null;
      }, 0);
    };
    const resetCanceledPointerActivation = (event: PointerEvent) => {
      if (pointerActivationRef.current === event.pointerId) pointerActivationRef.current = null;
    };
    document.addEventListener('pointerup', deferPointerActivationReset);
    document.addEventListener('pointercancel', resetCanceledPointerActivation);
    return () => {
      document.removeEventListener('pointerup', deferPointerActivationReset);
      document.removeEventListener('pointercancel', resetCanceledPointerActivation);
    };
  }, []);
  const recordPreviewIntent = (source: ReviewRatingPreviewSource, rating: ReviewRatingValue) => {
    setDisplayState((current) => {
      const latch = current.activationLatch;
      if (latch?.source === source && latch.rating === rating) return current;
      const existingCandidate =
        source === 'pointer' ? current.pointerCandidate : current.focusCandidate;
      const otherCandidate =
        source === 'pointer' ? current.focusCandidate : current.pointerCandidate;
      if (
        existingCandidate?.rating === rating &&
        (!otherCandidate || existingCandidate.order > otherCandidate.order)
      )
        return current;
      const intent: ReviewRatingPreviewIntent = {
        rating,
        source,
        order: ++previewOrderRef.current,
      };
      return source === 'pointer'
        ? { ...current, pointerCandidate: intent, latestIntent: intent, activationLatch: null }
        : { ...current, focusCandidate: intent, latestIntent: intent, activationLatch: null };
    });
  };
  const clearPreviewSource = (source: ReviewRatingPreviewSource) => {
    setDisplayState((current) => {
      const retainedCandidate =
        source === 'pointer' ? current.focusCandidate : current.pointerCandidate;
      return source === 'pointer'
        ? {
            ...current,
            pointerCandidate: null,
            latestIntent: retainedCandidate,
            activationLatch:
              current.activationLatch?.source === source ? null : current.activationLatch,
          }
        : {
            ...current,
            focusCandidate: null,
            latestIntent: retainedCandidate,
            activationLatch:
              current.activationLatch?.source === source ? null : current.activationLatch,
          };
    });
  };
  const commitRating = (rating: ReviewRatingValue) => {
    const source: ReviewRatingPreviewSource =
      pointerActivationRef.current === null ? 'focus' : 'pointer';
    onChange(rating);
    setDisplayState({
      pointerCandidate: null,
      focusCandidate: null,
      latestIntent: null,
      activationLatch: { rating, source },
    });
    pointerActivationRef.current = null;
  };
  const display = ratingDisplayResult(displayState, value);
  return (
    <fieldset className={styles.ratingField}>
      <legend>{label}</legend>
      <div
        ref={ratingOptionsRef}
        className={styles.ratingOptions}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) clearPreviewSource('focus');
        }}
        onPointerDownCapture={(event) => {
          pointerActivationRef.current = event.pointerId;
          pointerActivationSequenceRef.current += 1;
        }}
        onPointerLeave={() => clearPreviewSource('pointer')}
      >
        {reviewRatings.map((rating) => (
          <label
            className={styles.ratingOption}
            key={rating}
            onPointerEnter={() => recordPreviewIntent('pointer', rating)}
            onPointerMove={() => recordPreviewIntent('pointer', rating)}
          >
            <input
              className={styles.ratingInput}
              type="radio"
              name={name}
              value={rating}
              checked={rating === value}
              aria-label={`${label}: ${rating}/5`}
              onFocus={() => {
                if (pointerActivationRef.current === null) recordPreviewIntent('focus', rating);
              }}
              onChange={() => commitRating(rating)}
            />
            <span
              className={styles.ratingVisual}
              data-rating-state={rating <= display.rating ? display.state : 'neutral'}
              aria-hidden="true"
            >
              <Star size={24} fill="none" />
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function ReviewStars({ label, rating }: ReviewStarsProps) {
  const normalizedRating = validRating(rating) ? rating : 0;
  return (
    <div className={styles.reviewRating}>
      <span className={styles.reviewStars} role="img" aria-label={`${label}: ${rating}/5`}>
        {reviewRatings.map((value) => (
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
  const currentReview = reviews.current.data;
  const hasCurrentReview = reviews.current.isSuccess;
  const isEditing = reviews.hasOwnedReview;
  const mutation = isEditing ? reviews.update : reviews.create;
  useEffect(() => {
    if (hasCurrentReview) {
      setRating(currentReview && validRating(currentReview.rating) ? currentReview.rating : 0);
      setComment((currentReview?.comment ?? '').slice(0, REVIEW_COMMENT_MAX_LENGTH));
    } else if (reviews.noOwnedReview) {
      setRating(0);
      setComment('');
      setEditingOwnedReview(false);
    }
  }, [currentReview, hasCurrentReview, reviews.noOwnedReview]);
  useEffect(() => {
    if (confirmDelete || !focusReviewsAfterDelete) return;

    headingRef.current?.focus();
    setFocusReviewsAfterDelete(false);
  }, [confirmDelete, focusReviewsAfterDelete]);
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!validRating(rating)) return;
    const body = { rating, comment: comment.trim() || null };
    if (isEditing)
      reviews.update.mutate(body, {
        onSuccess: () => setEditingOwnedReview(false),
      });
    else reviews.create.mutate(body);
  };
  const cancelEditing = () => {
    setRating(currentReview && validRating(currentReview.rating) ? currentReview.rating : 0);
    setComment((currentReview?.comment ?? '').slice(0, REVIEW_COMMENT_MAX_LENGTH));
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
        <ReviewRatingSelector label={t('course:ratingLabel')} value={rating} onChange={setRating} />
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
          onChange={(event) => setComment(event.target.value.slice(0, REVIEW_COMMENT_MAX_LENGTH))}
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
