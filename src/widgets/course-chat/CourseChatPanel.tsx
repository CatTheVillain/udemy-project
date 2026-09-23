import { useCallback, useEffect, useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { SendHorizontal, Sparkles } from 'lucide-react';

import { Button, Notice, Textarea, VisuallyHidden } from '@shared/ui/primitives';
import {
  useCourseChat,
  type ChatMessage,
  type CourseChatContext,
  type CourseChatErrorState,
  type CourseChatWorkflow,
} from '@features/course-chat';

import styles from './CourseChatPanel.module.css';
import { AssistantMarkdown } from './AssistantMarkdown';

interface CourseChatPanelProps {
  readonly context: CourseChatContext;
  readonly compact?: boolean;
  readonly focusOnOpen?: boolean;
}

function errorCopy(t: TFunction, error: CourseChatErrorState | null) {
  if (error === 'sign_in_required')
    return [
      t('cart:signInRequired', { defaultValue: 'Sign in required' }),
      t('ai:signInAgainBeforeUsingThe', {
        defaultValue: 'Sign in again before using the assistant.',
      }),
    ] as const;
  if (error === 'invalid_request')
    return [
      t('ai:messageNeedsChecking', { defaultValue: 'Message needs checking' }),
      t('ai:checkTheMessageAndTryAgain', { defaultValue: 'Check the message and try again.' }),
    ] as const;
  if (error === 'temporarily_unavailable')
    return [
      t('ai:assistantTemporarilyUnavailable', {
        defaultValue: 'Assistant temporarily unavailable',
      }),
      t('ai:theAssistantIsTemporarilyUnavailable', {
        defaultValue: 'The assistant is temporarily unavailable.',
      }),
    ] as const;
  return [
    t('ai:assistantUnavailable0331', { defaultValue: 'Assistant unavailable' }),
    t('ai:theAssistantIsUnavailable', { defaultValue: 'The assistant is unavailable.' }),
  ] as const;
}

interface CourseChatContentProps {
  readonly chat: CourseChatWorkflow;
  readonly context: CourseChatContext;
  readonly compact: boolean;
  readonly focusOnOpen: boolean;
  readonly focusRequest?: number;
}

interface ChatMessageBubbleProps {
  readonly message: ChatMessage;
}

interface AssistantStatusProps {
  readonly t: TFunction;
}

const AUTO_SCROLL_BOTTOM_THRESHOLD_PX = 24;
const COMPACT_VIEWPORT_QUERY = '(max-width: 999px)';

function ChatMessageBubble({ message }: ChatMessageBubbleProps) {
  const isLearner = message.author === 'learner';
  return (
    <div className={`${styles.messageRow} ${isLearner ? styles.learnerRow : styles.assistantRow}`}>
      {!isLearner ? (
        <span className={`${styles.avatar} ${styles.assistantAvatar}`} aria-hidden="true">
          <Sparkles />
        </span>
      ) : null}
      {isLearner ? (
        <p className={`${styles.messageBubble} ${styles.learner}`}>{message.text}</p>
      ) : (
        <div className={`${styles.messageBubble} ${styles.assistant}`}>
          <AssistantMarkdown text={message.text} />
        </div>
      )}
    </div>
  );
}

function AssistantTypingIndicator({ t }: AssistantStatusProps) {
  return (
    <div
      className={`${styles.messageRow} ${styles.assistantRow} ${styles.typingRow}`}
      role="status"
    >
      <span className={`${styles.avatar} ${styles.assistantAvatar}`} aria-hidden="true">
        <Sparkles />
      </span>
      <span className={styles.typingContent}>
        <span className={styles.typingDots} aria-hidden="true">
          <span className={styles.typingDot} />
          <span className={styles.typingDot} />
          <span className={styles.typingDot} />
        </span>
        <span className={styles.typingLabel}>
          {t('ai:thinking', { defaultValue: 'Thinking…' })}
        </span>
      </span>
    </div>
  );
}

function AssistantResponseError({ t }: AssistantStatusProps) {
  return (
    <div
      className={`${styles.messageRow} ${styles.assistantRow} ${styles.responseErrorRow}`}
      role="alert"
    >
      <span className={`${styles.avatar} ${styles.assistantAvatar}`} aria-hidden="true">
        <Sparkles />
      </span>
      <p className={styles.responseErrorCopy}>
        {t('ai:couldntGenerateResponse', { defaultValue: 'Couldn’t generate a response.' })}
      </p>
    </div>
  );
}

export function CourseChatContent({
  chat,
  context,
  compact,
  focusOnOpen,
  focusRequest = 0,
}: CourseChatContentProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottomRef = useRef(true);
  const focusComposerAtEnd = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus({ preventScroll: true });
    const cursorPosition = input.value.length;
    input.setSelectionRange(cursorPosition, cursorPosition);
  }, []);
  useEffect(() => {
    if (!focusOnOpen) return undefined;

    focusComposerAtEnd();
    if (typeof globalThis.requestAnimationFrame !== 'function') return undefined;

    let nestedFrame = 0;
    const frame = globalThis.requestAnimationFrame(() => {
      nestedFrame = globalThis.requestAnimationFrame(focusComposerAtEnd);
    });
    return () => {
      globalThis.cancelAnimationFrame(frame);
      if (nestedFrame !== 0) globalThis.cancelAnimationFrame(nestedFrame);
    };
  }, [focusComposerAtEnd, focusOnOpen]);
  useLayoutEffect(() => {
    if (focusRequest > 0) focusComposerAtEnd();
  }, [focusComposerAtEnd, focusRequest]);
  useEffect(() => {
    if (
      focusRequest === 0 ||
      compact ||
      !globalThis.matchMedia?.(COMPACT_VIEWPORT_QUERY).matches ||
      typeof globalThis.requestAnimationFrame !== 'function'
    )
      return undefined;

    const frame = globalThis.requestAnimationFrame(() => {
      const input = inputRef.current;
      if (input !== null) {
        input.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
      }
    });
    return () => globalThis.cancelAnimationFrame(frame);
  }, [compact, focusRequest]);
  const inlineResponseFailure = chat.error === 'response_failed';
  const feedback = chat.error === null || inlineResponseFailure ? null : errorCopy(t, chat.error);
  const hasComposerAction = chat.draft.trim() !== '';
  useLayoutEffect(() => {
    const messages = messagesRef.current;
    if (messages !== null && shouldStickToBottomRef.current) {
      messages.scrollTop = messages.scrollHeight;
    }
  }, [chat.messages, chat.pending, inlineResponseFailure]);
  const handleSubmitKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    chat.submit();
  };
  return (
    <section
      className={`${styles.panel} ${compact ? styles.compact : styles.full}`}
      aria-label={t('ai:courseAssistant0319', { defaultValue: 'Course assistant' })}
    >
      <div
        ref={messagesRef}
        className={styles.messages}
        aria-live="polite"
        onScroll={(event) => {
          const messages = event.currentTarget;
          shouldStickToBottomRef.current =
            messages.scrollHeight - messages.clientHeight - messages.scrollTop <=
            AUTO_SCROLL_BOTTOM_THRESHOLD_PX;
        }}
      >
        {chat.messages.length === 0 ? (
          <p className={styles.empty}>
            {context.kind === 'general'
              ? t('ai:askAQuestionAboutYourLearning', {
                  defaultValue: 'Ask a question about your learning.',
                })
              : t('ai:askAQuestionAboutThisCourse', {
                  defaultValue: 'Ask a question about this course.',
                })}
          </p>
        ) : null}
        {chat.messages.map((message) => (
          <ChatMessageBubble key={message.id} message={message} />
        ))}
        {chat.pending ? <AssistantTypingIndicator t={t} /> : null}
        {inlineResponseFailure ? <AssistantResponseError t={t} /> : null}
      </div>
      {feedback ? (
        <div className={compact ? styles.compactError : undefined}>
          <Notice tone="error" title={feedback[0]}>
            {feedback[1]}
          </Notice>
        </div>
      ) : null}
      <div className={compact ? styles.compactComposerArea : styles.fullComposerArea}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            chat.submit();
          }}
          className={[styles.form, hasComposerAction ? styles.formWithSend : null]
            .filter(Boolean)
            .join(' ')}
        >
          <Textarea
            ref={inputRef}
            label={
              <VisuallyHidden>
                {t('ai:messageTheCourseAssistant', {
                  defaultValue: 'Message the course assistant',
                })}
              </VisuallyHidden>
            }
            value={chat.draft}
            onChange={(event) => chat.setDraft(event.target.value)}
            disabled={!compact && chat.pending}
            placeholder={t('ai:askAboutCoursesLessonsOrLearning', {
              defaultValue: 'Ask about courses, lessons, or learning…',
            })}
            className={compact ? styles.compactInput : styles.fullInput}
            fieldClassName={compact ? styles.compactInputField : styles.fullInputField}
            rows={1}
            wrap="off"
            onKeyDown={handleSubmitKeyDown}
          />
          {hasComposerAction ? (
            <Button
              type="submit"
              aria-label={t('ai:sendMessage', { defaultValue: 'Send message' })}
              disabled={chat.pending}
              state={chat.pending ? 'loading' : 'idle'}
              loadingLabel={
                <VisuallyHidden>
                  {t('ai:sendingMessage', { defaultValue: 'Sending message' })}
                </VisuallyHidden>
              }
            >
              <SendHorizontal aria-hidden="true" />
            </Button>
          ) : null}
        </form>
      </div>
    </section>
  );
}

export function CourseChatPanel({
  context,
  compact = false,
  focusOnOpen = true,
}: CourseChatPanelProps) {
  const chat = useCourseChat(context);
  return (
    <CourseChatContent chat={chat} context={context} compact={compact} focusOnOpen={focusOnOpen} />
  );
}
