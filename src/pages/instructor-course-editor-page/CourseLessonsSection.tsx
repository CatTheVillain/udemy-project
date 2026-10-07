import type { ChangeEvent, FormEvent } from 'react';
import { FileText, Pencil, UploadCloud } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import type { LessonType } from '@entities/course';
import { getInstructorLessonUploadRule } from '@features/instructor-course-editor';
import { Button, Input, Notice, Select, Textarea } from '@shared/ui/primitives';

import styles from './InstructorCourseEditorPage.module.css';
import type {
  CreatedLessonUploadFailure,
  LessonFormRefs,
  LessonFormState,
  ResolvedFieldErrors,
} from './course-editor-types';

interface CourseLessonsSectionProps {
  readonly form: LessonFormState;
  readonly fieldErrors: ResolvedFieldErrors;
  readonly failure: string | null;
  readonly hasFieldErrors: boolean;
  readonly file: File | null;
  readonly hasFileError: boolean;
  readonly isOpen: boolean;
  readonly isCreating: boolean;
  readonly createdUploadFailure: CreatedLessonUploadFailure | null;
  readonly refs: LessonFormRefs;
  readonly onFormChange: (form: LessonFormState) => void;
  readonly onLessonTypeChange: (lessonType: LessonType) => void;
  readonly onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

export function CourseLessonsSection({
  form,
  fieldErrors,
  failure,
  hasFieldErrors,
  file,
  hasFileError,
  isOpen,
  isCreating,
  createdUploadFailure,
  refs,
  onFormChange,
  onLessonTypeChange,
  onFileChange,
  onSubmit,
}: CourseLessonsSectionProps) {
  const { t } = useTranslation();
  const uploadRule = getInstructorLessonUploadRule(form.lessonType);
  return (
    <>
      {createdUploadFailure ? (
        <Notice tone="error" title={t('instructor:lessonEditorSourceFileUploadFailed')}>
          <p>{t('instructor:courseEditorLessonCreatedFileUploadFailed')}</p>
          <Link
            id="created-lesson-upload-retry"
            className={styles.createdLessonUploadRecoveryLink}
            to={`/instructor/lessons/${createdUploadFailure.lessonId}/edit`}
          >
            <Pencil aria-hidden="true" size={18} />
            {t('routes:editLessonTitle')}
          </Link>
        </Notice>
      ) : null}
      {isOpen ? (
        <section
          id="create-lesson-panel"
          className={styles.panel}
          aria-labelledby="create-lesson-heading"
        >
          <h2 id="create-lesson-heading">{t('instructor:courseEditorCreateLesson')}</h2>
          <form className={styles.form} onSubmit={onSubmit}>
            <Input
              ref={refs.title}
              label={t('instructor:courseEditorLessonTitle')}
              name="lesson-title"
              maxLength={255}
              required
              value={form.title}
              error={fieldErrors.title}
              onChange={(event) => onFormChange({ ...form, title: event.target.value })}
            />
            <Select
              ref={refs.lessonType}
              label={t('instructor:courseEditorLessonType')}
              name="lesson-type"
              value={form.lessonType}
              error={fieldErrors.lessonType}
              onValueChange={(value) => onLessonTypeChange(value as LessonType)}
            >
              <option value="video">{t('instructor:courseEditorVideo')}</option>
              <option value="text">{t('instructor:courseEditorText')}</option>
              <option value="pdf">{t('instructor:courseEditorPdf')}</option>
            </Select>
            <Textarea
              ref={refs.description}
              label={t('instructor:courseEditorDescription')}
              name="lesson-description"
              value={form.description}
              error={fieldErrors.description}
              onChange={(event) => onFormChange({ ...form, description: event.target.value })}
            />
            {uploadRule ? (
              <div className={styles.uploadField}>
                <label className={styles.fileLabel} htmlFor="create-lesson-file">
                  {t('instructor:courseEditorOptionalLessonFile')}
                </label>
                <div className={styles.uploadPicker}>
                  <input
                    ref={refs.file}
                    id="create-lesson-file"
                    className={styles.uploadInput}
                    type="file"
                    accept={uploadRule.accept}
                    aria-invalid={hasFileError || undefined}
                    aria-describedby={
                      hasFileError
                        ? 'create-lesson-file-help create-lesson-file-error'
                        : 'create-lesson-file-help'
                    }
                    onChange={onFileChange}
                  />
                  <UploadCloud aria-hidden="true" />
                  <span className={styles.uploadPrompt}>
                    {t('instructor:lessonEditorUploadLessonFile')}
                  </span>
                  <span id="create-lesson-file-help" className={styles.uploadHelp}>
                    {t(uploadRule.descriptionKey)}
                  </span>
                  {file ? <span className={styles.fileName}>{file.name}</span> : null}
                </div>
                {hasFileError ? (
                  <span id="create-lesson-file-error" className={styles.fieldError} role="alert">
                    {t('instructor:lessonEditorChooseAFileThatMatchesTheStatedTypeAndSizeLimit')}
                  </span>
                ) : null}
              </div>
            ) : (
              <div className={styles.uploadUnavailable}>
                <FileText aria-hidden="true" />
                <p>{t('instructor:lessonEditorFileUploadIsUnavailableForTextLessons')}</p>
              </div>
            )}
            <label className={styles.checkbox}>
              <input
                ref={refs.published}
                type="checkbox"
                name="is_published"
                checked={form.isPublished}
                aria-invalid={fieldErrors.isPublished ? true : undefined}
                aria-describedby={
                  fieldErrors.isPublished ? 'create-lesson-is-published-error' : undefined
                }
                onChange={(event) => onFormChange({ ...form, isPublished: event.target.checked })}
              />{' '}
              {t('instructor:courseEditorPublishThisLesson')}
            </label>
            {fieldErrors.isPublished ? (
              <span
                id="create-lesson-is-published-error"
                className={styles.fieldError}
                role="alert"
              >
                {fieldErrors.isPublished}
              </span>
            ) : null}
            {failure && !hasFieldErrors ? (
              <div ref={refs.error} tabIndex={-1} role="alert">
                <Notice tone="error">{failure}</Notice>
              </div>
            ) : null}
            <div className={styles.formActions}>
              <Button
                type="submit"
                state={isCreating ? 'loading' : 'idle'}
                loadingLabel={t('instructor:courseEditorCreatingLesson')}
              >
                {t('instructor:courseEditorCreateLesson')}
              </Button>
            </div>
          </form>
        </section>
      ) : null}
    </>
  );
}
