export interface LessonProgress {
  lessonId: number;
  completed: boolean;
  completedAt: string | null;
}

export interface CourseProgress {
  courseId: number;
  completedLessons: number;
  totalLessons: number;
  progressPercentage: number;
}

export type LessonProgressFeedbackTone = 'info' | 'success' | 'error';

export type LessonProgressFeedbackVisibility = 'visible' | 'exiting';

export type LessonProgressFeedbackMessageKey =
  'learning:lessonUpdateUnconfirmed' | 'learning:lessonProgressUpdateFailed';

interface LessonProgressFeedbackBase {
  readonly tone: LessonProgressFeedbackTone;
  readonly visibility: LessonProgressFeedbackVisibility;
}

export interface TransientLessonProgressFeedback extends LessonProgressFeedbackBase {
  readonly tone: Extract<LessonProgressFeedbackTone, 'info' | 'success'>;
  readonly message: string;
  readonly messageKey?: never;
}

export interface PersistentLessonProgressFeedback extends LessonProgressFeedbackBase {
  readonly tone: 'error';
  readonly message?: never;
  readonly messageKey: LessonProgressFeedbackMessageKey;
}

export type LessonProgressFeedback =
  PersistentLessonProgressFeedback | TransientLessonProgressFeedback;

export interface LearningFeedbackMotionPreferences {
  readonly reducedMotion: boolean;
}

export const DEFAULT_LEARNING_FEEDBACK_MOTION_PREFERENCES: LearningFeedbackMotionPreferences = {
  reducedMotion: false,
};

interface UnknownLessonCompletionState {
  readonly status: 'unknown';
}
interface KnownLessonCompletionState {
  readonly status: 'known';
  readonly completed: boolean;
}

export type LessonCompletionState = UnknownLessonCompletionState | KnownLessonCompletionState;

export interface LessonProgressAttempt {
  subject: SessionCacheEpoch;
  workspaceIdentity: string;
  enrollmentId: number;
  courseId: number;
  lessonId: number;
  targetCompleted: boolean;
  identity: string;
}
import type { SessionCacheEpoch } from '@shared/api';
