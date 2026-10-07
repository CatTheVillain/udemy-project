import type { RefObject } from 'react';

import type { LessonType } from '@entities/course';
import type {
  InstructorEditorCourse,
  InstructorEditorLesson,
} from '@features/instructor-course-editor';

export interface CourseFormState {
  readonly title: string;
  readonly description: string;
  readonly price: string;
  readonly currency: string;
}

export interface LessonFormState {
  readonly title: string;
  readonly lessonType: LessonType;
  readonly description: string;
  readonly isPublished: boolean;
}

export interface CourseFormRefs {
  readonly title: RefObject<HTMLInputElement>;
  readonly description: RefObject<HTMLTextAreaElement>;
  readonly price: RefObject<HTMLInputElement>;
  readonly currency: RefObject<HTMLInputElement>;
  readonly error: RefObject<HTMLDivElement>;
}

export interface LessonFormRefs {
  readonly title: RefObject<HTMLInputElement>;
  readonly lessonType: RefObject<HTMLButtonElement>;
  readonly description: RefObject<HTMLTextAreaElement>;
  readonly published: RefObject<HTMLInputElement>;
  readonly file: RefObject<HTMLInputElement>;
  readonly error: RefObject<HTMLDivElement>;
}

export type ResolvedFieldErrors = Readonly<Record<string, string>>;

export interface CreatedLessonUploadFailure {
  readonly lessonId: number;
}

export type CourseDeleteTarget = InstructorEditorLesson | 'course' | null;
export type { InstructorEditorCourse, InstructorEditorLesson };
