import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

interface ResidualConsumerExpectation {
  readonly path: string;
  readonly requiredCalls: readonly string[];
  readonly requiredSemanticCalls?: readonly RegExp[];
  readonly residualRawJsx: readonly RegExp[];
}

const DRAFT20_RESIDUAL_CONSUMERS: readonly ResidualConsumerExpectation[] = [
  {
    path: 'src/features/media-access/LessonMediaAccess.tsx',
    requiredCalls: [
      "t('course:mediaUnavailableInWorkspace')",
      "t('cart:signInRequired')",
      "t('course:preparingPdfPreview')",
    ],
    residualRawJsx: [
      />\s*Media unavailable in this workspace\s*</,
      />\s*Sign in required\s*</,
      />\s*Preparing PDF preview…\s*</,
    ],
  },
  {
    path: 'src/features/media-access/LessonPdfPreview.tsx',
    requiredCalls: ["t('course:previousPage')", "t('course:nextPage')"],
    residualRawJsx: [/>\s*Previous page\s*</, />\s*Next page\s*</],
  },
  {
    path: 'src/pages/ai-chat-page/AiChatPage.tsx',
    requiredCalls: [
      "t('ai:returnToMyLearning')",
      "t('ai:returnToLearningWorkspace')",
      "t('ai:beta')",
      "t('ai:learningAssistant')",
      "t('ai:assistantDescription')",
      "t('ai:assistantChat')",
      "t('ai:conversationPersistence')",
    ],
    residualRawJsx: [
      />\s*Return to my learning\s*</,
      />\s*Return to learning workspace\s*</,
      /<span className=\{styles\.betaBadge\}>BETA<\/span> AI Learning Assistant/,
      />\s*Ask questions, summarize lessons, take interactive practice quizzes, and get course\s*\n\s*recommendations tailored directly to your path\.\s*</,
      /aria-label="AI assistant chat"/,
      />\s*This conversation stays available while you continue using the assistant\.\s*</,
    ],
  },
  {
    path: 'src/widgets/course-chat/CourseChatLauncher.tsx',
    requiredCalls: [
      "t('ai:courseAssistant0319')",
      "t('a11y:openAiAssistant')",
      "t('ai:openAiAssistant')",
    ],
    residualRawJsx: [
      /aria-label="Course assistant"/,
      /aria-label="Open AI assistant"/,
      />\s*Open AI assistant\s*</,
    ],
  },
  {
    path: 'src/widgets/course-chat/CourseChatLauncherInteraction.tsx',
    requiredCalls: ["t('ai:expandChat')", "t('ai:closeChat')"],
    residualRawJsx: [/>\s*Expand chat\s*</, />\s*Close chat\s*</],
  },
  {
    path: 'src/shared/ui/primitives/Pagination.tsx',
    requiredCalls: ["t('common:page')", "t('common:of')"],
    residualRawJsx: [/>\s*Page \{safeCurrent\} of \{safeTotal\}\s*</],
  },
  {
    path: 'src/widgets/enrollment-progress-panel/EnrollmentProgressPanel.tsx',
    requiredCalls: [
      "t('learning:updatingLessonProgress')",
      "t('a11y:loadingLearningProgress')",
      "t('learning:lessonAvailability'",
      "t('learning:videoLessonType')",
      "t('learning:textLessonType')",
      "t('learning:pdfLessonType')",
      "t('learning:lessonCount'",
    ],
    residualRawJsx: [
      />\s*Updating lesson progress\.\s*</,
      /label="Loading learning progress"/,
      /\{availableLessonCount\} available now · \{comingSoonLessonCount\}/,
      /\{lesson\.lessonType\} lesson ·/,
      /function lessonCountLabel\(/,
    ],
  },
  {
    path: 'src/pages/forgot-password-page/ForgotPasswordPage.tsx',
    requiredCalls: [
      "t('auth:openRecoveryLink')",
      "t('auth:recoveryChannel')",
      "t('common:continue')",
    ],
    residualRawJsx: [
      />\s*Open the password-reset link from your recovery message to choose a new password\.\s*</,
      />\s*If the account can use password recovery, the next steps will be available through the\s*configured recovery channel\.\s*</,
      />\s*Continue\s*</,
    ],
  },
  {
    path: 'src/pages/login-page/LoginPage.tsx',
    requiredCalls: ["t('auth:createAnAccount')", "t('auth:forgotYourPassword')"],
    residualRawJsx: [/>\s*Create an account\s*</, />\s*Forgot your password\?\s*</],
  },
  {
    path: 'src/pages/reset-password-page/ResetPasswordPage.tsx',
    requiredCalls: [
      "t('auth:resetTokenHelp')",
      "t('routes:resetPasswordTitle')",
      "t('auth:passwordUpdated')",
    ],
    residualRawJsx: [
      />\s*Your reset link supplies a private token\. It stays hidden while you complete this form\.\s*</,
      />\s*Reset password\s*</,
      />\s*Your password has been updated\.\s*\{' '\}/,
    ],
  },
  {
    path: 'src/pages/signup-page/SignupPage.tsx',
    requiredCalls: ["t('navigation:logIn')", "t('routes:createAccountTitle')"],
    residualRawJsx: [/>\s*Log in\s*</, />\s*Create account\s*</],
  },
  {
    path: 'src/pages/cart-page/CartPage.tsx',
    requiredCalls: [
      "t('navigation:logIn')",
      "t('cart:refreshCart')",
      "t('common:cart')",
      "t('a11y:loadingCart')",
      "t('a11y:breadcrumb')",
      "t('catalog:resultCount', { count: currentCart.itemCount })",
      "t('a11y:cartCourses')",
      "t('cart:courseLabel')",
      "t('instructor:courseEditorPrice')",
      "t('cart:goToOrderSummary')",
      "t('a11y:cartTotal')",
      "t('cart:orderSummary')",
      "t('cart:total')",
      "t('cart:totalUnavailable')",
      "t('cart:completeMockPayment')",
      "t('cart:yourCartIsEmpty'",
      "t('cart:cartCleared'",
      "t('cart:courseRemovedFromCart'",
      't(returnTarget.labelKey',
    ],
    requiredSemanticCalls: [],
    residualRawJsx: [
      />\s*Refresh cart\s*</,
      />\s*Cart\s*</,
      /label="Loading cart"/,
      /aria-label="Breadcrumb"/,
      /t\('cart:courseLowercase'\)/,
      /aria-label="Cart courses"/,
      />\s*Course\s*</,
      />\s*Price\s*</,
      />\s*Go to order summary\s*</,
      /aria-label="Cart total"/,
      />\s*Order summary\s*</,
      />\s*Total\s*</,
      />\s*Total unavailable\s*</,
      />\s*Mock checkout\s*</,
      /return kind === 'clear' \? 'Cart cleared\.' : 'Course removed from cart\.'/,
    ],
  },
  {
    path: 'src/pages/cart-page/CompositeCheckoutNotice.tsx',
    requiredCalls: [
      "t('cart:paymentResultNeedsChecking')",
      "t('cart:doNotStartAnotherPayment')",
      "t('cart:courseReturnedToCart')",
    ],
    residualRawJsx: [],
  },
  {
    path: 'src/pages/cart-page/cart-return-target.ts',
    requiredCalls: [
      "labelKey: 'navigation:catalog'",
      "labelKey: 'routes:courseDetailsTitle'",
      "labelKey: 'routes:createAccountTitle'",
      "labelKey: 'navigation:logIn'",
      "labelKey: 'routes:forgotPasswordTitle'",
      "labelKey: 'routes:resetPasswordTitle'",
      "labelKey: 'navigation:myLearning'",
      "labelKey: 'routes:learningDetailsTitle'",
      "labelKey: 'routes:courseAssistantTitle'",
      "labelKey: 'routes:aiAssistantTitle'",
      "labelKey: 'navigation:instructorCourses'",
      "labelKey: 'routes:editCourseTitle'",
      "labelKey: 'routes:courseEnrollmentsTitle'",
      "labelKey: 'routes:editLessonTitle'",
    ],
    residualRawJsx: [],
  },
  {
    path: 'src/pages/course-detail-page/CourseDetailPage.tsx',
    requiredCalls: [
      "t('course:thisCourseDoesNotExistOr')",
      "t('a11y:loadingCourseDetails')",
      "t('course:draftCourse')",
    ],
    residualRawJsx: [
      /t\('course:thisCourseDoesNotExistOrIs'/,
      /label="Loading course details"/,
      /t\('course:draftCourse',\s*\{\s*defaultValue:/,
    ],
  },
  {
    path: 'src/pages/course-detail-page/CourseOutline.tsx',
    requiredCalls: [
      "t('course:courseOutline')",
      "t('a11y:loadingCourseOutline')",
      "t('course:noLessonsAdded')",
      "t('course:lessonMarker')",
    ],
    residualRawJsx: [
      />\s*Course outline\s*</,
      /label="Loading course outline"/,
      />\s*No lessons have been added yet\.\s*</,
      /\{lesson\.lessonType\} lesson ·/,
    ],
  },
  {
    path: 'src/pages/learning-detail-page/LearningDetailPage.tsx',
    requiredCalls: [
      "t('a11y:breadcrumb')",
      "t('routes:tryAgain'",
      "t('learning:learningWorkspaceUnavailable'",
      "t('learning:thisLearningWorkspaceIsUnavailable'",
      "t('learning:loadingLearningWorkspace'",
      "t('learning:active'",
      "t('learning:cancelled'",
      "t('learning:paymentPending'",
      "t('learning:learningProgressUnavailable'",
      "t('learning:learningProgressIsNotAvailableFor'",
      "t('catalog:noCourseDescriptionIsAvailable'",
    ],
    requiredSemanticCalls: [
      /t\('learning:mockPaymentAwaitingCompletion',\s*\{\s*defaultValue:\s*'Payment is pending\. Learning remains locked until your enrollment is active\.',\s*\}\)/,
    ],
    residualRawJsx: [
      />\s*The mock payment completed\. Enrollment status was refreshed; learning unlocks only after\s*active status is observed\.\s*</,
      />\s*The mock payment was declined\. This enrollment remains locked\.\s*</,
      />\s*The enrollment is still pending, so you can choose a new mock payment outcome\.\s*</,
      />\s*We could not confirm the mock payment status\. Check enrollment status before taking another\s*action\.\s*</,
      />\s*Sign in again before checking payment status\.\s*</,
      />\s*This payment action is not available for the current account\.\s*</,
      />\s*Mock payment is currently unavailable\. Check enrollment status later\.\s*</,
      /aria-label="Breadcrumb"/,
      />\s*Try again\s*</,
      />\s*Mock payment is awaiting completion\. Learning remains locked until your enrollment\s*is active\.\s*</,
      />\s*Check payment status\s*</,
      />\s*Complete mock payment\s*</,
      />\s*Simulate mock payment failure\s*</,
      /enrollment\.course\.description \?\? 'No course description is available\.'/,
    ],
  },
  {
    path: 'src/pages/learning-list-page/LearningListPage.tsx',
    requiredCalls: ["t('a11y:breadcrumb')"],
    residualRawJsx: [/aria-label="Breadcrumb"/],
  },
];

describe('MLUX-004 DRAFT-20 residual consumer source admission', () => {
  it('replaces every admitted media, AI, chat, pagination, progress, auth, Cart, course-detail, and learning literal with its semantic resource call', () => {
    for (const expectation of DRAFT20_RESIDUAL_CONSUMERS) {
      const source = readFileSync(new URL(`../../../${expectation.path}`, import.meta.url), 'utf8');
      for (const call of expectation.requiredCalls) expect(source).toContain(call);
      for (const call of expectation.requiredSemanticCalls ?? []) expect(source).toMatch(call);
      for (const residual of expectation.residualRawJsx) expect(source).not.toMatch(residual);
    }
  });
});
