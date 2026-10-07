import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, CircleHelp, Compass, Medal, MoreVertical, Trash2, X } from 'lucide-react';

import { sanitizeInternalReturnTo } from '@features/auth-session';
import {
  useCourseChat,
  type CourseChatContext,
  type CourseChatWorkflow,
} from '@features/course-chat';
import { useLearningWorkspace } from '@features/learning-progress';
import {
  Button,
  ContextualNavigationLink,
  DestructiveConfirmation,
  Notice,
  Skeleton,
  SkeletonGroup,
} from '@shared/ui/primitives';
import { CourseChatContent } from '@widgets/course-chat';
import heroImage from './assets/ai-chat-hero-ui020-1.png';

import styles from './AiChatPage.module.css';

interface GeneralAssistantRoute {
  readonly kind: 'general';
}
interface CourseAssistantRoute {
  readonly kind: 'course';
  readonly enrollmentId: number;
}
interface InvalidAssistantRoute {
  readonly kind: 'invalid';
}

type AssistantRoute = GeneralAssistantRoute | CourseAssistantRoute | InvalidAssistantRoute;

function assistantRouteFromEnrollmentId(value: string | undefined): AssistantRoute {
  if (value === undefined) return { kind: 'general' };
  if (!/^[1-9]\d*$/.test(value)) return { kind: 'invalid' };

  const enrollmentId = Number(value);
  return Number.isSafeInteger(enrollmentId)
    ? { kind: 'course', enrollmentId }
    : { kind: 'invalid' };
}

export function AiChatPage() {
  const route = assistantRouteFromEnrollmentId(useParams().enrollmentId);
  if (route.kind === 'general') return <GeneralAiChatPage />;
  if (route.kind === 'invalid') return <InvalidCourseAiChatPage />;

  return <CourseAiChatPage enrollmentId={route.enrollmentId} />;
}

interface CourseAiChatPageProps {
  readonly enrollmentId: number;
}

function CourseAiChatPage({ enrollmentId }: CourseAiChatPageProps) {
  const { t } = useTranslation();
  const workspace = useLearningWorkspace(enrollmentId, { reducedMotion: false });
  if (workspace.enrollment.isPending)
    return (
      <SkeletonGroup
        label={t('ai:loadingCourseAssistant', { defaultValue: 'Loading course assistant' })}
      >
        <Skeleton width="40%" height="40px" />
        <Skeleton width="100%" height="360px" shape="rect" />
      </SkeletonGroup>
    );
  if (workspace.enrollment.isError || workspace.enrollment.data === undefined)
    return (
      <section className={styles.state}>
        <h1>
          {t('ai:courseAssistantUnavailable', { defaultValue: 'Course assistant unavailable' })}
        </h1>
        <p>
          {t('ai:thisAssistantIsUnavailableForThis', {
            defaultValue: 'This assistant is unavailable for this course.',
          })}
        </p>
        <ContextualNavigationLink className={styles.unavailableReturnLink} to="/learning">
          {t('ai:returnToMyLearning')}
        </ContextualNavigationLink>
      </section>
    );
  const enrollment = workspace.enrollment.data;
  if (enrollment.status !== 'active')
    return (
      <section className={styles.state}>
        <h1>
          {t('ai:courseAssistantUnavailable', { defaultValue: 'Course assistant unavailable' })}
        </h1>
        <p>
          {t('ai:thisAssistantIsUnavailableForThis', {
            defaultValue: 'This assistant is unavailable for this course.',
          })}
        </p>
        <ContextualNavigationLink
          className={styles.unavailableReturnLink}
          to={`/learning/enrollments/${enrollment.id}`}
        >
          {t('ai:returnToLearningWorkspace')}
        </ContextualNavigationLink>
      </section>
    );
  return (
    <AssistantPageLayout
      context={{ kind: 'course', courseId: enrollment.courseId }}
      backTo={`/learning/enrollments/${enrollment.id}`}
    />
  );
}

function GeneralAiChatPage() {
  return <AssistantPageLayout context={{ kind: 'general' }} backTo="/learning" />;
}

function InvalidCourseAiChatPage() {
  const { t } = useTranslation();
  return (
    <section className={styles.state} aria-labelledby="invalid-course-assistant-route-title">
      <h1 id="invalid-course-assistant-route-title">
        {t('ai:invalidCourseAssistantAddress', {
          defaultValue: 'Invalid course assistant address',
        })}
      </h1>
      <p>
        {t('ai:returnToMyLearningAndChoose', {
          defaultValue: 'Return to my learning and choose a course to open its assistant.',
        })}
      </p>
      <ContextualNavigationLink className={styles.unavailableReturnLink} to="/learning">
        {t('ai:returnToMyLearning')}
      </ContextualNavigationLink>
    </section>
  );
}

interface AssistantPageLayoutProps {
  readonly context: CourseChatContext;
  readonly backTo: string;
}

interface AiChatNavigationState {
  readonly returnTo?: unknown;
}

interface SuggestedAction {
  readonly icon: typeof Compass;
  readonly label: string;
  readonly prompt: string;
}

interface SuggestedActionsProps {
  readonly chat: CourseChatWorkflow;
  readonly backTo: string;
  readonly isCompactOpen: boolean;
  readonly onActionSelect: () => void;
  readonly onCompactToggle: () => void;
}

interface SuggestedActionListProps {
  readonly chat: CourseChatWorkflow;
  readonly onActionSelect: () => void;
}

function SuggestedActionList({ chat, onActionSelect }: SuggestedActionListProps) {
  const { t } = useTranslation();
  const suggestedActions: readonly SuggestedAction[] = [
    {
      icon: Compass,
      label: t('ai:recommendACourse', { defaultValue: 'Recommend a course' }),
      prompt: t('ai:recommendACourseBasedOnMy', {
        defaultValue: 'Recommend a course based on my learning goals.',
      }),
    },
    {
      icon: CircleHelp,
      label: t('ai:explainAConcept', { defaultValue: 'Explain a concept' }),
      prompt: t('ai:explainAConceptIAmLearning', {
        defaultValue: 'Explain a concept I am learning in simple terms.',
      }),
    },
    {
      icon: Medal,
      label: t('ai:quizMe', { defaultValue: 'Quiz me' }),
      prompt: t('ai:quizMeOnTheCourseMaterial', {
        defaultValue: 'Quiz me on the course material I am learning.',
      }),
    },
  ];
  return (
    <div className={styles.suggestedActions}>
      {suggestedActions.map(({ icon: Icon, label, prompt }) => {
        const selected = chat.draft === prompt;
        return (
          <button
            key={label}
            className={[styles.suggestedAction, selected ? styles.suggestedActionSelected : null]
              .filter(Boolean)
              .join(' ')}
            data-selected={selected ? 'true' : 'false'}
            type="button"
            onClick={() => {
              chat.setDraft(prompt);
              onActionSelect();
            }}
          >
            <Icon aria-hidden="true" focusable="false" />
            {label}
          </button>
        );
      })}
    </div>
  );
}

function SuggestedActions({
  chat,
  backTo,
  isCompactOpen,
  onActionSelect,
  onCompactToggle,
}: SuggestedActionsProps) {
  const { t } = useTranslation();
  const compactPanelId = useId();
  return (
    <>
      <div className={styles.compactSuggestedActions}>
        <ContextualNavigationLink className={styles.returnLink} to={backTo}>
          <ChevronLeft aria-hidden="true" />
          {t('ai:returnToMyLearning')}
        </ContextualNavigationLink>
        <button
          className={styles.suggestedActionsTrigger}
          type="button"
          aria-expanded={isCompactOpen}
          aria-controls={compactPanelId}
          onClick={onCompactToggle}
        >
          {t('ai:suggestedActions', { defaultValue: 'Suggested Actions' })}
        </button>
        {isCompactOpen ? (
          <section
            id={compactPanelId}
            className={styles.compactSuggestedActionsPanel}
            aria-label={t('ai:suggestedActions', { defaultValue: 'Suggested Actions' })}
          >
            <p>
              {t('ai:quickPromptsToJumpstartYourSession', {
                defaultValue: 'Quick prompts to jumpstart your session',
              })}
            </p>
            <SuggestedActionList chat={chat} onActionSelect={onActionSelect} />
          </section>
        ) : null}
      </div>
      <div className={styles.sidebarColumn}>
        <ContextualNavigationLink className={styles.returnLink} to={backTo}>
          <ChevronLeft aria-hidden="true" />
          {t('ai:returnToMyLearning')}
        </ContextualNavigationLink>
        <aside className={styles.sidebar} aria-labelledby="suggested-actions-title">
          <h2 id="suggested-actions-title">
            {t('ai:suggestedActions0092', { defaultValue: 'Suggested Actions' })}
          </h2>
          <p>
            {t('ai:quickPromptsToJumpstartYourSession', {
              defaultValue: 'Quick prompts to jumpstart your session',
            })}
          </p>
          <SuggestedActionList chat={chat} onActionSelect={onActionSelect} />
        </aside>
      </div>
    </>
  );
}

function AssistantPageLayout({ context, backTo }: AssistantPageLayoutProps) {
  const { t } = useTranslation();
  const chat = useCourseChat(context);
  const location = useLocation();
  const navigate = useNavigate();
  const [isActionMenuOpen, setIsActionMenuOpen] = useState(false);
  const [isClearConfirmationOpen, setIsClearConfirmationOpen] = useState(false);
  const [isCompactSuggestedActionsOpen, setIsCompactSuggestedActionsOpen] = useState(false);
  const [composerFocusRequest, setComposerFocusRequest] = useState(0);
  const actionTriggerId = useId();
  const actionMenuRef = useRef<HTMLSpanElement>(null);
  const isUnavailable = chat.error === 'temporarily_unavailable' || chat.error === 'unavailable';
  const isAvailable =
    !isUnavailable && chat.messages.some((message) => message.author === 'assistant');
  const chatTitle =
    context.kind === 'general'
      ? t('ai:generalAssistanceChat', { defaultValue: 'General Assistance Chat' })
      : t('ai:courseAssistant', { defaultValue: 'Course Assistant' });
  const state = location.state as AiChatNavigationState | null;
  const returnTo =
    typeof state?.returnTo === 'string'
      ? sanitizeInternalReturnTo(state.returnTo, globalThis.location?.origin)
      : null;
  const closeDestination = returnTo && returnTo !== location.pathname ? returnTo : backTo;
  const availabilityLabel = isAvailable
    ? t('ai:assistantAvailable', { defaultValue: 'Assistant available' })
    : isUnavailable
      ? t('ai:assistantUnavailable', { defaultValue: 'Assistant unavailable' })
      : t('ai:assistantAvailabilityUnknown', { defaultValue: 'Assistant availability unknown' });

  useEffect(() => {
    if (!isActionMenuOpen) return undefined;

    const dismissOutsideActionMenu = (event: MouseEvent) => {
      if (event.target instanceof Node && actionMenuRef.current?.contains(event.target)) return;
      setIsActionMenuOpen(false);
    };

    document.addEventListener('mousedown', dismissOutsideActionMenu);
    return () => document.removeEventListener('mousedown', dismissOutsideActionMenu);
  }, [isActionMenuOpen]);

  return (
    <article className={styles.page}>
      <section className={styles.hero} aria-labelledby="ai-chat-hero-title">
        <img
          className={styles.heroImage}
          data-part="ai-chat-hero-image"
          src={heroImage}
          alt=""
          aria-hidden="true"
        />
        <div className={styles.heroContent}>
          <h1 id="ai-chat-hero-title">
            <span className={styles.betaBadge}>{t('ai:beta')}</span> {t('ai:learningAssistant')}
          </h1>
          <p>{t('ai:assistantDescription')}</p>
        </div>
      </section>
      <SuggestedActions
        chat={chat}
        backTo={backTo}
        isCompactOpen={isCompactSuggestedActionsOpen}
        onCompactToggle={() => setIsCompactSuggestedActionsOpen((isOpen) => !isOpen)}
        onActionSelect={() => {
          setIsCompactSuggestedActionsOpen(false);
          setComposerFocusRequest((request) => request + 1);
        }}
      />
      <section className={styles.chatArea}>
        <section className={styles.chatFrame} aria-label={t('ai:assistantChat')}>
          <header className={styles.chatFrameHeader}>
            <div className={styles.chatFrameIdentity}>
              <span
                className={`${styles.statusDot} ${isAvailable ? styles.statusAvailable : isUnavailable ? styles.statusUnavailable : styles.statusUnknown}`}
                aria-label={availabilityLabel}
                role="img"
              />
              <span>
                <strong>{chatTitle}</strong>
                <small>
                  {t('ai:poweredByLearnhubIntelligence', {
                    defaultValue: 'Powered by LearnHub Intelligence',
                  })}
                </small>
              </span>
            </div>
            <div className={styles.chatFrameActions}>
              <span ref={actionMenuRef} className={styles.actionMenu}>
                <Button
                  variant="ghost"
                  id={actionTriggerId}
                  aria-label={t('ai:conversationActions', { defaultValue: 'Conversation actions' })}
                  aria-expanded={isActionMenuOpen}
                  onClick={() => setIsActionMenuOpen((isOpen) => !isOpen)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') setIsActionMenuOpen(false);
                  }}
                >
                  <MoreVertical aria-hidden="true" />
                </Button>
                {isActionMenuOpen ? (
                  <span
                    className={styles.actionMenuList}
                    aria-label={t('ai:conversationActions', {
                      defaultValue: 'Conversation actions',
                    })}
                    onKeyDown={(event) => {
                      if (event.key !== 'Escape') return;
                      event.preventDefault();
                      setIsActionMenuOpen(false);
                      document.getElementById(actionTriggerId)?.focus();
                    }}
                  >
                    <button
                      className={styles.actionMenuItem}
                      type="button"
                      onClick={() => {
                        setIsActionMenuOpen(false);
                        setIsClearConfirmationOpen(true);
                      }}
                    >
                      <span>{t('ai:clearChat', { defaultValue: 'Clear chat' })}</span>
                      <Trash2 aria-hidden="true" />
                    </button>
                  </span>
                ) : null}
              </span>
              <Button
                variant="ghost"
                aria-label={t('ai:closeAssistantChat', { defaultValue: 'Close assistant chat' })}
                onClick={() => navigate(closeDestination)}
              >
                <X aria-hidden="true" />
              </Button>
            </div>
          </header>
          <CourseChatContent
            chat={chat}
            context={context}
            compact={false}
            focusOnOpen
            focusRequest={composerFocusRequest}
          />
        </section>
        <Notice tone="info">{t('ai:conversationPersistence')}</Notice>
      </section>
      <DestructiveConfirmation
        open={isClearConfirmationOpen}
        title={t('ai:clearThisConversation', { defaultValue: 'Clear this conversation?' })}
        description={t('ai:thisActionCannotBeUndone', {
          defaultValue: 'This action cannot be undone.',
        })}
        confirmLabel={t('ai:clearConversation', { defaultValue: 'Clear conversation' })}
        onConfirm={() => {
          chat.reset();
          setIsClearConfirmationOpen(false);
        }}
        onCancel={() => {
          setIsClearConfirmationOpen(false);
          queueMicrotask(() => document.getElementById(actionTriggerId)?.focus());
        }}
      />
    </article>
  );
}
