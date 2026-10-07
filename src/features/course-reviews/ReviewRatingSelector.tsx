import { useEffect, useId, useRef, useState } from 'react';
import { Star } from 'lucide-react';

import styles from './CourseReviews.module.css';

export type ReviewRatingValue = 1 | 2 | 3 | 4 | 5;
export type ReviewRatingSelection = ReviewRatingValue | 0;

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

export const REVIEW_RATINGS: readonly ReviewRatingValue[] = [1, 2, 3, 4, 5];

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

export function ReviewRatingSelector({ label, value, onChange }: ReviewRatingSelectorProps) {
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
        {REVIEW_RATINGS.map((rating) => (
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
