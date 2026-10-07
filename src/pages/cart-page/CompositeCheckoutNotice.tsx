import { useTranslation } from 'react-i18next';

import type { CartCompositeCheckoutWorkflow } from '@features/checkout-cart';
import { Button, Notice } from '@shared/ui/primitives';

import styles from './CartPage.module.css';

export interface CompositeCheckoutNoticeProps {
  readonly checkout: CartCompositeCheckoutWorkflow;
  readonly courseTitles: ReadonlyMap<number, string>;
  readonly cardResultCourseIds?: ReadonlySet<number>;
  onRetryPayment(courseId: number): void;
}

export function CompositeCheckoutNotice({
  checkout,
  courseTitles,
  cardResultCourseIds,
  onRetryPayment,
}: CompositeCheckoutNoticeProps) {
  const { t } = useTranslation();
  if (checkout.phase === 'checkout_admitted' || checkout.phase === 'completing_checkout')
    return (
      <Notice tone="info" title={t('learning:paymentPending')}>
        <p>{t('cart:checkingOut')}</p>
      </Notice>
    );
  if (checkout.phase === 'recovery_candidates')
    return (
      <Notice tone="info" title={t('learning:paymentPending')}>
        <p>{t('cart:weCouldNotConfirmCheckoutCheck')}</p>
        <ul aria-label={t('learning:paymentPending')}>
          {checkout.recoveryCandidates.map((candidate) => (
            <li key={candidate.enrollmentId}>
              <strong>{candidate.course.title}</strong>
            </li>
          ))}
        </ul>
        <Button variant="secondary" onClick={() => checkout.resumeRecovery()}>
          {t('cart:resumePaymentCheck')}
        </Button>
      </Notice>
    );
  const integrityUnknown = checkout.phase === 'checkout_integrity_unknown';
  const visibleResults = integrityUnknown
    ? checkout.results.filter((result) => result.kind !== 'integrity_unknown')
    : checkout.results;
  const pageResults = visibleResults.filter(
    (result) => result.kind !== 'restored' || !cardResultCourseIds?.has(result.courseId),
  );
  if (!integrityUnknown && pageResults.length === 0) return null;
  return (
    <div className={styles.checkoutResults} aria-live="polite">
      {integrityUnknown ? (
        <Notice tone="error" title={t('cart:paymentResultNeedsChecking')}>
          <p>{t('cart:doNotStartAnotherPayment')}</p>
        </Notice>
      ) : null}
      {pageResults.map((result) => {
        const courseTitle = courseTitles.get(result.courseId) ?? String(result.courseId);
        if (result.kind === 'active')
          return (
            <Notice key={result.enrollmentId} tone="success" title={t('cart:paymentCompleted')}>
              <p>
                <strong>{courseTitle}</strong> — {t('cart:learningIsNowAvailable')}
              </p>
            </Notice>
          );
        if (result.kind === 'restored')
          return (
            <Notice key={result.enrollmentId} tone="error" title={t('cart:paymentFailed')}>
              <p>
                <strong>{courseTitle}</strong> — {t('cart:courseReturnedToCart')}
              </p>
              {!integrityUnknown ? (
                <Button
                  variant="secondary"
                  aria-label={`${t('cart:retryMockPayment')}: ${courseTitle}`}
                  onClick={() => onRetryPayment(result.courseId)}
                >
                  {t('cart:retryMockPayment')}
                </Button>
              ) : null}
            </Notice>
          );
        return (
          <Notice
            key={result.enrollmentId}
            tone="error"
            title={t('cart:paymentResultNeedsChecking')}
          >
            <p>
              {courseTitle} — {t('cart:doNotStartAnotherPayment')}
            </p>
          </Notice>
        );
      })}
    </div>
  );
}
