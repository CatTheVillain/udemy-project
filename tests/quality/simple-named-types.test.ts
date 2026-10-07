import { readFileSync } from 'node:fs';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const repositoryRoot = new URL('../../', import.meta.url);

// Frozen source inventory: 70 simple contracts in 34 source files.
// A row is deliberately kept as source text so the oracle is independent from
// the implementation's chosen interface/type names.
const simpleInventory = [
  ['src/app/layouts/app-shell-navigation.ts', '{ returnTo: string }'],
  ['src/app/layouts/AppShell.tsx', 'ReturnType<typeof setTimeout>'],
  ['src/app/layouts/AppShell.tsx', "AuthenticatedTabletDrawerProps['onCreateCourse']"],
  ['src/app/layouts/AppShell.tsx', 'ReturnType<typeof setTimeout>'],
  ['src/app/router/route-registry.ts', '(typeof APP_ROUTES)[number]'],
  ['src/app/router/RouteErrorBoundary.tsx', "{ kind: 'render-error' }"],
  ['src/app/router/RouteErrorBoundary.tsx', "{ kind: 'bootstrapping' }"],
  ['src/app/router/RouteErrorBoundary.tsx', "{ kind: 'session-error' }"],
  ['src/app/router/RouteErrorBoundary.tsx', "{ kind: 'registered-route'; routeTitle: string }"],
  ['src/app/router/RouteErrorBoundary.tsx', "{ kind: 'not-found' }"],
  ['src/entities/api/assumptions.ts', '{ page?: number; page_size?: number }'],
  ['src/entities/api/assumptions.ts', '{ page: number; page_size: number }'],
  ['src/entities/api/assumptions.ts', '{ page?: number; size?: number }'],
  ['src/entities/api/assumptions.ts', '{ page: number; size: number }'],
  ['src/entities/user/dto.ts', '{ id: number; email: string }'],
  ['src/features/auth-session/operation-adapter.ts', "SessionContextValue['requestPublic']"],
  ['src/features/auth-session/SessionProvider.tsx', "{ status: 'bootstrapping' }"],
  ['src/features/auth-session/SessionProvider.tsx', "{ status: 'anonymous' }"],
  [
    'src/features/auth-session/SessionProvider.tsx',
    "{ status: 'authenticated'; user: UserProfile }",
  ],
  ['src/features/auth-session/SessionProvider.tsx', "{ status: 'error' }"],
  ['src/features/auth-workflows/useSignupWorkflow.ts', 'SignupInput[K]'],
  ['src/features/auth-workflows/useSignupWorkflow.ts', 'SignupInput[K]'],
  ['src/features/catalog-discovery/api.ts', "ApiClient['request']"],
  ['src/features/checkout-cart/use-cart-composite-checkout.ts', "Enrollment['status']"],
  ['src/features/checkout-cart/useCheckoutCart.ts', "CheckoutActiveAttempt['kind']"],
  ['src/features/checkout-cart/useCheckoutCart.ts', "MockPaymentAttempt['outcome']"],
  [
    'src/features/course-detail/action-state.ts',
    "{ kind: 'enroll'; labelKey: 'catalog:enrollFree' }",
  ],
  ['src/features/course-detail/action-state.ts', "{ kind: 'cart'; labelKey: 'catalog:addToCart' }"],
  [
    'src/features/course-detail/action-state.ts',
    "{ kind: 'disabled'; labelKey: 'course:actionUnavailable' | 'course:alreadyEnrolled' | 'course:alreadyInCart' | 'catalog:paymentProcessingShort' | 'course:checkingAvailability' }",
  ],
  ['src/features/course-detail/useCourseDetail.ts', "{ status: 'idle' }"],
  ['src/features/course-detail/useCourseDetail.ts', "{ status: 'pending' }"],
  [
    'src/features/course-detail/useCourseDetail.ts',
    "{ status: 'success'; action: CourseMutationKind }",
  ],
  [
    'src/features/course-detail/useCourseDetail.ts',
    "{ status: 'error'; disposition: CourseMutationDisposition }",
  ],
  ['src/features/course-detail/useCourseDetail.ts', "{ status: 'success' | 'error' }"],
  ['src/features/course-reviews/api.ts', '{ message?: unknown }'],
  ['src/features/instructor-course-editor/api.ts', 'ReturnType<typeof setTimeout>'],
  ['src/features/instructor-course-editor/api.ts', 'ReturnType<typeof setTimeout>'],
  [
    'src/features/instructor-course-editor/validation.ts',
    "{ readonly kind: 'resource'; readonly key: string }",
  ],
  [
    'src/features/instructor-course-editor/validation.ts',
    "{ readonly kind: 'required'; readonly labelKey: string }",
  ],
  [
    'src/features/instructor-course-editor/validation.ts',
    "{ readonly kind: 'checkField'; readonly labelKey: string }",
  ],
  [
    'src/features/instructor-course-editor/validation.ts',
    "{ readonly kind: 'reviewHighlightedFields' }",
  ],
  [
    'src/features/instructor-course-editor/validation.ts',
    "{ readonly kind: 'couldNotProcessForm' }",
  ],
  [
    'src/features/instructor-course-editor/validation.ts',
    "{ readonly kind: 'genericAction'; readonly actionKey: string }",
  ],
  [
    'src/features/instructor-course-editor/validation.ts',
    '{ readonly fields: Readonly<Record<string, string>>; readonly summary: string }',
  ],
  ['src/features/learning-progress/model.ts', "{ status: 'unknown' }"],
  ['src/features/learning-progress/model.ts', "{ status: 'known'; completed: boolean }"],
  ['src/features/learning-progress/useLearningProgress.ts', 'ReturnType<typeof setTimeout>'],
  ['src/features/learning-progress/useLearningProgress.ts', 'ReturnType<typeof setTimeout>'],
  ['src/features/learning-progress/useLearningProgress.ts', "LessonProgressFeedback['tone']"],
  [
    'src/features/learning-progress/useLearningProgress.ts',
    '{ lessonId: number; completed: boolean }',
  ],
  ['src/pages/ai-chat-page/AiChatPage.tsx', "{ readonly kind: 'general' }"],
  [
    'src/pages/ai-chat-page/AiChatPage.tsx',
    "{ readonly kind: 'course'; readonly enrollmentId: number }",
  ],
  ['src/pages/ai-chat-page/AiChatPage.tsx', "{ readonly kind: 'invalid' }"],
  ['src/pages/catalog-page/CourseCard.tsx', 'ReturnType<typeof globalThis.setTimeout>'],
  ['src/pages/catalog-page/CourseCard.tsx', 'ReturnType<typeof globalThis.setTimeout>'],
  [
    'src/pages/catalog-page/SortControl.tsx',
    '{ readonly key: string; readonly defaultValue: string }',
  ],
  [
    'src/pages/course-detail-page/CourseDetailPage.tsx',
    "CourseCatalogReturnNavigationState['returnTo']",
  ],
  ['src/shared/api/client.ts', "ApiRequestOptions['query']"],
  ['src/shared/locale/corpus-types.ts', '{ readonly sha256: string }'],
  ['src/shared/locale/LanguageSelector.tsx', 'ReturnType<typeof setTimeout>'],
  ['src/shared/locale/resources.ts', 'Resource[Locale]'],
  ['src/shared/locale/types.ts', '(typeof SUPPORTED_LOCALES)[number]'],
  ['src/shared/ui/primitives/Dialog.tsx', '{ wasTopmost: boolean; nextTopmost?: DialogOwner }'],
  [
    'src/shared/ui/theme/ThemeProvider.tsx',
    '{ [DOCUMENT_DENSITY_OWNER_KEY]?: DocumentDensityOwnerRegistration; }',
  ],
  [
    'src/shared/ui/tokens/states.ts',
    '{ /** Background color CSS variable */ bg: string; /** Foreground/text color CSS variable */ fg: string; /** Border color CSS variable */ border: string; }',
  ],
  ['src/widgets/catalog-filter-bar/CatalogFilterBar.tsx', 'ReturnType<typeof setTimeout>'],
  ['src/widgets/course-chat/CourseChatPanel.tsx', "ReturnType<typeof useCourseChat>['error']"],
  ['src/widgets/course-chat/CourseChatPanel.tsx', 'ReturnType<typeof useCourseChat>'],
  [
    'src/widgets/enrollment-progress-panel/EnrollmentProgressPanel.tsx',
    "EnrollmentProgressPanelProps['onSetCompletion']",
  ],
  [
    'src/widgets/enrollment-progress-panel/EnrollmentProgressPanel.tsx',
    "EnrollmentProgressPanelProps['onSetCompletion']",
  ],
] as const;

function normalized(value: string): string {
  return value.replace(/\s+/g, '');
}

function sourceFile(path: string): ts.SourceFile {
  const content = readFileSync(new URL(path, repositoryRoot), 'utf8');
  return ts.createSourceFile(
    path,
    content,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function typeTexts(file: ts.SourceFile): readonly string[] {
  const texts: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isTypeNode(node)) texts.push(normalized(node.getText(file)));
    ts.forEachChild(node, visit);
  };
  visit(file);
  return texts;
}

function forbiddenEscapeHatches(file: ts.SourceFile): readonly string[] {
  const findings: string[] = [];
  const visit = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.AnyKeyword) findings.push('any');
    if (ts.isNonNullExpression(node)) findings.push('non-null assertion');
    if (ts.isAsExpression(node) && ts.isAsExpression(node.expression)) findings.push('double cast');
    if (ts.isModuleDeclaration(node) && (node.flags & ts.NodeFlags.Namespace) !== 0)
      findings.push('namespace declaration');
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (/@ts-(?:ignore|expect-error|nocheck)\b/u.test(file.text))
    findings.push('TypeScript suppression');
  return findings;
}

describe('simple named type contracts', () => {
  it('keeps the frozen 70-row inventory complete across 34 source files', () => {
    expect(simpleInventory).toHaveLength(70);
    expect(new Set(simpleInventory.map(([path]) => path))).toHaveLength(34);
  });

  it('replaces every frozen simple annotation, projection, and union branch with a named contract', () => {
    const byPath = new Map<string, string[]>();
    simpleInventory.forEach(([path, candidate]) => {
      byPath.set(path, [...(byPath.get(path) ?? []), normalized(candidate)]);
    });
    const remaining = [...byPath].flatMap(([path, candidates]) => {
      const present = new Set(typeTexts(sourceFile(path)));
      return candidates
        .filter((candidate) => present.has(candidate))
        .map((candidate) => `${path}: ${candidate}`);
    });

    expect(remaining).toEqual([]);
  });

  it('does not replace an inventory row with a suppression, escape hatch, or namespace-wide workaround', () => {
    const findings = [...new Set(simpleInventory.map(([path]) => path))].flatMap((path) =>
      forbiddenEscapeHatches(sourceFile(path)).map((finding) => `${path}: ${finding}`),
    );

    expect(findings).toEqual([]);
  });
});
