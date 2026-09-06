import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type PointerEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import type { CatalogCourse } from '@entities/course';
import { useCourseRatingSummary } from '@features/course-reviews';
import { Button } from '@shared/ui/primitives';

import styles from './CourseCard.module.css';
import {
  DISCLOSURE_CLOSE_DELAY,
  DISCLOSURE_OPEN_DELAY,
  TOOLTIP_CONNECTOR_WIDTH,
  TOOLTIP_MINIMUM_WIDTH,
  TOOLTIP_PREFERRED_WIDTH,
  TOOLTIP_VIEWPORT_GUTTER,
  clampConnectorOffset,
  sameTooltipPlacement,
  supportsFinePointer,
  useCourseCardDisclosureAvailability,
  type CourseCardTooltipPlacement,
} from './course-card-disclosure';
import { courseActionVisual, formatCatalogPrice } from './course-card-presentation';
import type { CatalogCourseActionState } from './useCatalogCourseActions';

type CourseDisclosureCallback = (courseId: number) => void;

interface CourseCardProps {
  course: CatalogCourse;
  catalogReturnTo: string;
  isDisclosureVisible: boolean;
  isDisclosurePinned: boolean;
  hasPinnedDisclosure: boolean;
  onTransientDisclosurePreviewStart: CourseDisclosureCallback;
  onTransientDisclosurePreviewEnd: CourseDisclosureCallback;
  onTransientDisclosurePreviewExit: CourseDisclosureCallback;
  onDisclosurePinToggle: CourseDisclosureCallback;
  action: CatalogCourseActionState;
  onAction(): void;
}

export function CourseCard({
  course,
  catalogReturnTo,
  isDisclosureVisible,
  isDisclosurePinned,
  hasPinnedDisclosure,
  onTransientDisclosurePreviewStart,
  onTransientDisclosurePreviewEnd,
  onTransientDisclosurePreviewExit,
  onDisclosurePinToggle,
  action,
  onAction,
}: CourseCardProps) {
  const { t, i18n } = useTranslation();
  const cardRef = useRef<HTMLElement>(null);
  const ratingSummary = useCourseRatingSummary(course.id, cardRef);
  const isDisclosureAvailable = useCourseCardDisclosureAvailability();
  const tooltipNotice = course.isPublished
    ? null
    : t('catalog:thisCourseIsNotAvailableFor', {
        defaultValue: 'This course is not available for enrollment yet.',
      });
  const statusExplanationId = `catalog-course-${course.id}-status`;
  const tooltipLabelId = `catalog-course-${course.id}-description-label`;
  const tooltipDescriptionId = `catalog-course-${course.id}-description`;
  const ratingDescriptionId = `catalog-course-${course.id}-rating`;
  const description =
    course.description ??
    t('catalog:noCourseDescriptionIsAvailable', {
      defaultValue: 'No course description is available.',
    });
  const ratingLocale = i18n.resolvedLanguage ?? i18n.language;
  const rating = ratingSummary.data;
  const ratingText =
    rating && rating.averageRating !== null
      ? new Intl.NumberFormat(ratingLocale, {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        }).format(rating.averageRating)
      : null;
  const reviewCountText = rating
    ? new Intl.NumberFormat(ratingLocale).format(rating.reviewCount)
    : null;
  const hasTerminalRatingState =
    (ratingText !== null && reviewCountText !== null) ||
    rating?.reviewCount === 0 ||
    ratingSummary.isError;
  const linkDescriptionIds = [
    hasTerminalRatingState ? ratingDescriptionId : null,
    isDisclosureAvailable && isDisclosureVisible ? tooltipDescriptionId : null,
  ].filter((id): id is string => id !== null);
  const linkRef = useRef<HTMLAnchorElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const openTimerRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const [tooltipPlacement, setTooltipPlacement] = useState<CourseCardTooltipPlacement | null>(null);
  const tooltipPlacementMode = tooltipPlacement?.mode;
  const tooltipPlacementWidth = tooltipPlacement?.width;

  const updateTooltipPlacement = useCallback(() => {
    const link = linkRef.current;
    const tooltip = tooltipRef.current;
    if (!link || !tooltip) return;
    const documentZoom = Number.parseFloat(getComputedStyle(document.documentElement).zoom);
    const coordinateScale = Number.isFinite(documentZoom) && documentZoom > 0 ? documentZoom : 1;
    const clientWidth = document.documentElement.clientWidth / coordinateScale;
    const clientHeight = document.documentElement.clientHeight / coordinateScale;
    const linkRect = link.getBoundingClientRect();
    const linkLeft = linkRect.left / coordinateScale;
    const linkRight = linkRect.right / coordinateScale;
    const linkTop = linkRect.top / coordinateScale;
    const linkHeight = linkRect.height / coordinateScale;
    const headerBottom =
      (document.querySelector<HTMLElement>('[data-app-shell-header]')?.getBoundingClientRect()
        .bottom ?? 0) / coordinateScale;
    const availableRight = clientWidth - linkRight;
    const availableLeft = linkLeft;
    const maximumTooltipHeight = Math.max(
      0,
      clientHeight - headerBottom - 2 * TOOLTIP_VIEWPORT_GUTTER,
    );
    const side =
      availableRight >=
        TOOLTIP_PREFERRED_WIDTH + TOOLTIP_CONNECTOR_WIDTH + TOOLTIP_VIEWPORT_GUTTER ||
      availableRight >= availableLeft
        ? 'right'
        : 'left';
    const availableSide = side === 'right' ? availableRight : availableLeft;
    const width = Math.min(
      TOOLTIP_PREFERRED_WIDTH,
      availableSide - TOOLTIP_CONNECTOR_WIDTH - TOOLTIP_VIEWPORT_GUTTER,
    );
    const linkCenterX = linkLeft + linkRect.width / coordinateScale / 2;
    const makeBottomPlacement = (): CourseCardTooltipPlacement => {
      const bottomWidth = Math.min(
        TOOLTIP_PREFERRED_WIDTH,
        clientWidth - 2 * TOOLTIP_VIEWPORT_GUTTER,
      );
      const bottomLeft = Math.max(TOOLTIP_VIEWPORT_GUTTER, (clientWidth - bottomWidth) / 2);
      return {
        mode: 'bottom',
        width: bottomWidth,
        left: bottomLeft,
        maxHeight: maximumTooltipHeight,
        connectorOffset: clampConnectorOffset(linkCenterX - bottomLeft, bottomWidth),
      };
    };
    const nextPlacement: CourseCardTooltipPlacement =
      clientWidth < 768 || width < TOOLTIP_MINIMUM_WIDTH
        ? makeBottomPlacement()
        : (() => {
            const tooltipHeight = tooltip.getBoundingClientRect().height / coordinateScale;
            const minimumTop = Math.max(
              TOOLTIP_VIEWPORT_GUTTER,
              headerBottom + TOOLTIP_VIEWPORT_GUTTER,
            );
            const maximumTop = clientHeight - tooltipHeight - TOOLTIP_VIEWPORT_GUTTER;
            if (maximumTop < minimumTop) return makeBottomPlacement();
            const top = Math.min(
              Math.max(linkTop + linkHeight / 2 - tooltipHeight / 2, minimumTop),
              maximumTop,
            );
            return {
              mode: 'side',
              side,
              width,
              left:
                side === 'right'
                  ? linkRight + TOOLTIP_CONNECTOR_WIDTH
                  : linkLeft - TOOLTIP_CONNECTOR_WIDTH - width,
              top,
              maxHeight: maximumTooltipHeight,
              connectorOffset: clampConnectorOffset(linkTop + linkHeight / 2 - top, tooltipHeight),
            };
          })();
    setTooltipPlacement((current) =>
      sameTooltipPlacement(current, nextPlacement) ? current : nextPlacement,
    );
  }, []);

  useLayoutEffect(() => {
    if (!isDisclosureVisible) return undefined;
    updateTooltipPlacement();
    let frame = 0;
    const schedulePlacementUpdate = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updateTooltipPlacement);
    };
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedulePlacementUpdate);
    if (linkRef.current) observer?.observe(linkRef.current);
    if (tooltipRef.current) observer?.observe(tooltipRef.current);
    const visualViewport = window.visualViewport;
    window.addEventListener('resize', schedulePlacementUpdate);
    visualViewport?.addEventListener('resize', schedulePlacementUpdate);
    visualViewport?.addEventListener('scroll', schedulePlacementUpdate);
    document.addEventListener('scroll', schedulePlacementUpdate, true);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', schedulePlacementUpdate);
      visualViewport?.removeEventListener('resize', schedulePlacementUpdate);
      visualViewport?.removeEventListener('scroll', schedulePlacementUpdate);
      document.removeEventListener('scroll', schedulePlacementUpdate, true);
    };
  }, [isDisclosureVisible, updateTooltipPlacement]);
  useLayoutEffect(() => {
    if (isDisclosureVisible) updateTooltipPlacement();
  }, [isDisclosureVisible, tooltipPlacementMode, tooltipPlacementWidth, updateTooltipPlacement]);

  const tooltipStyle =
    tooltipPlacement?.mode === 'side'
      ? ({
          '--catalog-tooltip-left': `${tooltipPlacement.left}px`,
          '--catalog-tooltip-top': `${tooltipPlacement.top}px`,
          '--catalog-tooltip-width': `${tooltipPlacement.width}px`,
          '--catalog-tooltip-max-height': `${tooltipPlacement.maxHeight}px`,
          '--catalog-tooltip-connector-offset': `${tooltipPlacement.connectorOffset}px`,
        } as CSSProperties)
      : tooltipPlacement
        ? ({
            '--catalog-tooltip-left': `${tooltipPlacement.left}px`,
            '--catalog-tooltip-width': `${tooltipPlacement.width}px`,
            '--catalog-tooltip-max-height': `${tooltipPlacement.maxHeight}px`,
            '--catalog-tooltip-connector-offset': `${tooltipPlacement.connectorOffset}px`,
          } as CSSProperties)
        : undefined;
  const feedbackId = `catalog-course-${course.id}-action-feedback`;
  const actionVisual = courseActionVisual(action.presentation);
  const actionLabel = t(action.labelKey);
  const paymentProcessing = action.presentation === 'payment-processing';
  const ActionIcon =
    action.kind === 'link' ||
    (action.kind === 'button' &&
      (action.presentation === 'add-to-cart' || action.presentation === 'remove'))
      ? null
      : actionVisual.Icon;
  const tooltipPlacementClass =
    tooltipPlacement?.mode === 'side'
      ? tooltipPlacement.side === 'left'
        ? styles.tooltipLeft
        : styles.tooltipRight
      : styles.tooltipBottom;
  const tooltipPlacementName = tooltipPlacement?.mode === 'side' ? tooltipPlacement.side : 'bottom';
  const clearOpenTimer = useCallback(() => {
    if (openTimerRef.current !== null) globalThis.clearTimeout(openTimerRef.current);
    openTimerRef.current = null;
  }, []);
  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current !== null) globalThis.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }, []);
  const requestTransientPreview = useCallback(() => {
    if (!isDisclosureAvailable || !supportsFinePointer() || hasPinnedDisclosure) return;
    clearCloseTimer();
    if (isDisclosureVisible || openTimerRef.current !== null) return;
    openTimerRef.current = globalThis.setTimeout(() => {
      openTimerRef.current = null;
      onTransientDisclosurePreviewStart(course.id);
    }, DISCLOSURE_OPEN_DELAY);
  }, [
    clearCloseTimer,
    course.id,
    hasPinnedDisclosure,
    isDisclosureAvailable,
    isDisclosureVisible,
    onTransientDisclosurePreviewStart,
  ]);
  const requestTransientClose = useCallback(() => {
    clearOpenTimer();
    if (
      !supportsFinePointer() ||
      isDisclosurePinned ||
      !isDisclosureVisible ||
      closeTimerRef.current !== null
    )
      return;
    closeTimerRef.current = globalThis.setTimeout(() => {
      closeTimerRef.current = null;
      onTransientDisclosurePreviewEnd(course.id);
    }, DISCLOSURE_CLOSE_DELAY);
  }, [
    clearOpenTimer,
    course.id,
    isDisclosurePinned,
    isDisclosureVisible,
    onTransientDisclosurePreviewEnd,
  ]);
  const handleCardPointerEnter = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (
        event.target instanceof Element &&
        event.target.closest('[data-part="course-card-actions"]')
      )
        return;
      requestTransientPreview();
    },
    [requestTransientPreview],
  );
  const handleCardPointerLeave = useCallback(() => {
    onTransientDisclosurePreviewExit(course.id);
    requestTransientClose();
  }, [course.id, onTransientDisclosurePreviewExit, requestTransientClose]);
  const handleLinkFocus = useCallback(() => {
    if (isDisclosureAvailable && !hasPinnedDisclosure) onTransientDisclosurePreviewStart(course.id);
  }, [course.id, hasPinnedDisclosure, isDisclosureAvailable, onTransientDisclosurePreviewStart]);
  const handleLinkBlur = useCallback(
    (event: FocusEvent<HTMLAnchorElement>) => {
      if (!event.currentTarget.closest('[data-course-card-id]')?.contains(event.relatedTarget))
        onTransientDisclosurePreviewEnd(course.id);
    },
    [course.id, onTransientDisclosurePreviewEnd],
  );
  const handleDisclosurePinToggle = useCallback(() => {
    clearOpenTimer();
    clearCloseTimer();
    onDisclosurePinToggle(course.id);
  }, [clearCloseTimer, clearOpenTimer, course.id, onDisclosurePinToggle]);
  useEffect(() => {
    if (hasPinnedDisclosure) clearOpenTimer();
  }, [clearOpenTimer, hasPinnedDisclosure]);
  useEffect(
    () => () => {
      clearOpenTimer();
      clearCloseTimer();
    },
    [clearCloseTimer, clearOpenTimer],
  );
  useEffect(() => {
    if (isDisclosureAvailable || !isDisclosureVisible) return;
    onTransientDisclosurePreviewEnd(course.id);
    if (isDisclosurePinned) onDisclosurePinToggle(course.id);
  }, [
    course.id,
    isDisclosureAvailable,
    isDisclosurePinned,
    isDisclosureVisible,
    onDisclosurePinToggle,
    onTransientDisclosurePreviewEnd,
  ]);

  return (
    <li className={styles.item}>
      <article
        ref={cardRef}
        className={styles.card}
        data-part="course-card"
        data-course-card-id={course.id}
        onPointerEnter={handleCardPointerEnter}
        onPointerLeave={handleCardPointerLeave}
      >
        <Link
          ref={linkRef}
          className={styles.link}
          to={`/courses/${course.id}`}
          state={{ returnTo: catalogReturnTo }}
          aria-label={course.title}
          aria-describedby={
            linkDescriptionIds.length > 0 ? linkDescriptionIds.join(' ') : undefined
          }
          onFocus={handleLinkFocus}
          onBlur={handleLinkBlur}
        >
          <div className={styles.preview} data-part="course-card-preview" />
          <div className={styles.body} data-part="course-card-body">
            <h3 className={styles.title}>{course.title}</h3>
            <div
              id={hasTerminalRatingState ? ratingDescriptionId : undefined}
              className={styles.rating}
              data-part="course-card-rating"
            >
              {ratingText && reviewCountText ? (
                <>
                  <span className={styles.ratingLabel}>{`${t('course:ratingLabel')}: `}</span>
                  <span className={styles.ratingStar} aria-hidden="true">
                    ★
                  </span>
                  <span>{ratingText}</span>
                  <span className={styles.ratingSeparator} aria-hidden="true">
                    {' · '}
                  </span>
                  <span>{`${t('course:reviewsHeading')}: ${reviewCountText}`}</span>
                </>
              ) : rating?.reviewCount === 0 ? (
                t('course:noReviews')
              ) : ratingSummary.isError ? (
                t('course:reviewsLoadFailed')
              ) : (
                <span className={styles.ratingPlaceholder} aria-hidden="true" />
              )}
            </div>
            <div className={styles.metadata} data-part="course-card-metadata">
              <span className={styles.byline}>{course.instructorName}</span>
              <span
                className={styles.metadataSeparator}
                data-part="course-card-metadata-separator"
                aria-hidden="true"
              >
                {' · '}
              </span>
              <span className={styles.lessonCount}>
                {t('catalog:lessonAvailability', { count: course.totalLessonCount })}
              </span>
            </div>
          </div>
        </Link>
        {isDisclosureAvailable && isDisclosureVisible ? (
          <div
            ref={tooltipRef}
            className={[styles.tooltip, tooltipPlacementClass, styles.tooltipOpen].join(' ')}
            data-placement={tooltipPlacementName}
            id={statusExplanationId}
            role="tooltip"
            aria-labelledby={tooltipLabelId}
            style={tooltipStyle}
            onPointerEnter={clearCloseTimer}
            onPointerLeave={handleCardPointerLeave}
          >
            <div className={styles.tooltipContent} data-part="course-card-tooltip-content">
              {tooltipNotice ? <span className={styles.tooltipNotice}>{tooltipNotice}</span> : null}
              <span id={tooltipLabelId} className={styles.tooltipCourse}>
                {t('catalog:courseDescription')} {course.title}
              </span>
              <span id={tooltipDescriptionId} className={styles.tooltipDescription}>
                {description}
              </span>
            </div>
          </div>
        ) : null}
        {isDisclosureAvailable ? (
          <div className={styles.disclosureControl}>
            <Button
              id={`catalog-course-${course.id}-disclosure-trigger`}
              type="button"
              variant="secondary"
              className={styles.disclosureButton}
              aria-label={t('catalog:viewCourseDetails', { defaultValue: 'View course details' })}
              aria-controls={statusExplanationId}
              aria-describedby={isDisclosureVisible ? tooltipDescriptionId : undefined}
              aria-expanded={isDisclosureVisible}
              aria-pressed={isDisclosurePinned}
              onClick={handleDisclosurePinToggle}
            >
              <span className={styles.disclosurePill} data-part="course-card-disclosure-pill">
                {t('catalog:details')}
              </span>
            </Button>
          </div>
        ) : null}
        <footer className={styles.footer} data-part="course-card-footer">
          <div className={styles.price} data-part="course-card-price">
            <data value={course.price}>
              {formatCatalogPrice(
                course.price,
                course.currency,
                i18n.resolvedLanguage ?? i18n.language ?? 'en-US',
                t('catalog:free'),
              )}
            </data>
          </div>
          <div className={styles.actions} data-part="course-card-actions">
            {action.kind === 'link' && action.to ? (
              <Link className={styles.actionLink} to={action.to}>
                <span className={styles.actionContent} data-part="course-card-action-content">
                  {ActionIcon ? <ActionIcon size={16} aria-hidden="true" /> : null}
                  <span>{actionLabel}</span>
                </span>
              </Link>
            ) : action.kind === 'status' ? (
              <span className={styles.actionStatus} data-part="course-card-action-status">
                <span className={styles.actionContent} data-part="course-card-action-content">
                  {ActionIcon ? <ActionIcon size={16} aria-hidden="true" /> : null}
                  <span>{actionLabel}</span>
                </span>
              </span>
            ) : (
              <Button
                type="button"
                variant={actionVisual.buttonVariant}
                disabled={action.disabled}
                aria-busy={action.pending || undefined}
                aria-label={paymentProcessing ? t('catalog:paymentProcessing') : undefined}
                aria-describedby={action.feedback ? feedbackId : undefined}
                className={[
                  styles.actionButton,
                  action.presentation === 'neutral' && styles.actionButtonNeutral,
                  action.presentation === 'remove' && styles.actionButtonRemove,
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={onAction}
              >
                <span className={styles.actionContent} data-part="course-card-action-content">
                  {ActionIcon ? <ActionIcon size={16} aria-hidden="true" /> : null}
                  <span aria-hidden={paymentProcessing || undefined}>{actionLabel}</span>
                  {paymentProcessing ? (
                    <span
                      className={styles.paymentProcessingDots}
                      data-part="payment-processing-dots"
                      aria-hidden="true"
                    >
                      <span
                        className={styles.paymentProcessingDot}
                        data-part="payment-processing-dot"
                      >
                        .
                      </span>
                      <span
                        className={styles.paymentProcessingDot}
                        data-part="payment-processing-dot"
                      >
                        .
                      </span>
                      <span
                        className={styles.paymentProcessingDot}
                        data-part="payment-processing-dot"
                      >
                        .
                      </span>
                    </span>
                  ) : null}
                </span>
              </Button>
            )}
            {action.feedback ? (
              <p id={feedbackId} className={styles.actionFeedback} aria-live="polite">
                {t(`course:${action.feedback.messageKey}`)}
              </p>
            ) : null}
          </div>
        </footer>
      </article>
    </li>
  );
}
