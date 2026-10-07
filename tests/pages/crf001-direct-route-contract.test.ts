import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

async function readSource(relativePath: string): Promise<string> {
  return readFile(new URL(`../../src/${relativePath}`, import.meta.url), 'utf8');
}

describe('CRF-001 direct-route and Cart contract', () => {
  it('keeps learner payment completion out of Learning Detail', async () => {
    const source = await readSource('pages/learning-detail-page/LearningDetailPage.tsx');

    expect(source).not.toContain('completeMockPayment');
    expect(source).not.toContain('checkPaymentStatus');
    expect(source).not.toContain('useCheckoutCart');
    expect(source).not.toContain('CheckoutFeedback');
    expect(source).not.toContain('PaymentFeedbackNotice');
    expect(source).not.toContain('/payments/complete');
    expect(source).toContain("t('learning:mockPaymentAwaitingCompletion'");
    expect(source).toContain(
      'Payment is pending. Learning remains locked until your enrollment is active.',
    );
    expect(source).not.toContain("t('learning:enrollmentPending'");
    expect(source).toContain(
      "import { hasActiveLearningEntitlement } from '@entities/enrollment';",
    );
    expect(source).toContain('hasActiveLearningEntitlement(enrollment.status)');
  });

  it('uses the shared complete enrollment-action projection at Catalog and Course Detail', async () => {
    const [catalog, detail, learningApi] = await Promise.all([
      readSource('pages/catalog-page/useCatalogCourseActions.ts'),
      readSource('features/course-detail/useCourseDetail.ts'),
      readSource('features/learning-progress/api.ts'),
    ]);

    expect(catalog).toContain('enrollmentCourseActionPreflight');
    expect(detail).toContain('enrollmentCourseActionPreflight');
    expect(catalog).toContain("'pending-protected'");
    expect(detail).toContain("'pending-protected'");
    expect(catalog).toContain("'cancelled-recovery'");
    expect(detail).toContain("'cancelled-recovery'");
    expect(catalog).toContain(
      "if (enrollmentPreflight === 'pending-protected') return 'payment-pending';",
    );
    expect(detail).toContain(
      "if (enrollmentPreflight === 'pending-protected') return 'unavailable';",
    );
    expect(catalog).toContain(
      "enrollmentPreflight === 'cancelled-recovery' && /^0(?:\\.0+)?$/.test(coursePrice)",
    );
    expect(detail).toContain("enrollmentPreflight === 'cancelled-recovery' &&");
    expect(learningApi).toContain(
      'collection.items.filter((item) => hasActiveLearningEntitlement(item.status))',
    );
  });

  it('does not keep a My Learning continuation in uncorrelated Cart notices', async () => {
    const source = await readSource('pages/cart-page/CompositeCheckoutNotice.tsx');

    expect(source).toContain("t('cart:paymentResultNeedsChecking')");
    expect(source).toContain("t('cart:doNotStartAnotherPayment')");
    expect(source).toContain("t('cart:courseReturnedToCart')");
    expect(source).not.toContain("t('cart:checkMyLearning'");
  });
});
