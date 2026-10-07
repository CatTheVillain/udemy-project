import { Trash2, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button, DestructiveConfirmation } from '@shared/ui/primitives';

import styles from './InstructorCourseEditorPage.module.css';
import type {
  CourseDeleteTarget,
  InstructorEditorCourse,
  InstructorEditorLesson,
} from './course-editor-types';

interface DestructiveCourseEditorSectionProps {
  readonly course: InstructorEditorCourse;
  readonly target: CourseDeleteTarget;
  readonly isPending: boolean;
  readonly isBlocked: boolean;
  readonly error: string | undefined;
  readonly onCourseDelete: () => void;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

export function DestructiveCourseEditorSection({
  course,
  target,
  isPending,
  isBlocked,
  error,
  onCourseDelete,
  onCancel,
  onConfirm,
}: DestructiveCourseEditorSectionProps) {
  const { t } = useTranslation();
  const deletingCourse = target === 'course';
  const targetLesson = target as InstructorEditorLesson | null;
  const description = deletingCourse
    ? t('instructor:courseEditorDeleteCoursePermanent').replace('{courseTitle}', () => course.title)
    : t('instructor:courseEditorDeleteLessonPermanent').replace(
        '{lessonTitle}',
        () => targetLesson?.title ?? 'this lesson',
      );
  return (
    <>
      <section
        className={`${styles.panel} ${styles.dangerZone}`}
        aria-labelledby="danger-zone-heading"
      >
        <div className={styles.dangerZoneCopy}>
          <span className={styles.dangerZoneIcon} aria-hidden="true">
            <TriangleAlert />
          </span>
          <div>
            <h2 id="danger-zone-heading">{t('instructor:courseEditorDangerZone')}</h2>
            <p>{t('instructor:courseEditorDangerZoneDescription')}</p>
          </div>
        </div>
        <Button
          type="button"
          variant="destructive"
          className={styles.dangerZoneButton}
          disabled={isBlocked}
          onClick={onCourseDelete}
        >
          <Trash2 aria-hidden="true" size={19} />
          {t('instructor:courseEditorDeleteCourse')}
        </Button>
      </section>
      <DestructiveConfirmation
        open={target !== null}
        title={
          deletingCourse
            ? t('instructor:courseEditorDeleteThisCourse')
            : t('instructor:courseEditorDeleteThisLesson')
        }
        description={description}
        confirmLabel={
          deletingCourse
            ? t('instructor:courseEditorDeleteCourse')
            : t('instructor:courseEditorDeleteLesson')
        }
        confirming={isPending}
        pendingLabel={
          deletingCourse
            ? t('instructor:courseEditorDeletingCourse')
            : t('instructor:courseEditorDeletingLesson')
        }
        error={error}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    </>
  );
}
