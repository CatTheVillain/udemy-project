import type { FormEvent } from 'react';
import { FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button, Input, Notice, Textarea } from '@shared/ui/primitives';

import styles from './InstructorCourseEditorPage.module.css';
import type { CourseFormRefs, CourseFormState, ResolvedFieldErrors } from './course-editor-types';

interface CourseDetailsSectionProps {
  readonly form: CourseFormState;
  readonly fieldErrors: ResolvedFieldErrors;
  readonly failure: string | null;
  readonly hasFieldErrors: boolean;
  readonly isSaving: boolean;
  readonly refs: CourseFormRefs;
  readonly onChange: (form: CourseFormState) => void;
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

export function CourseDetailsSection({
  form,
  fieldErrors,
  failure,
  hasFieldErrors,
  isSaving,
  refs,
  onChange,
  onSubmit,
}: CourseDetailsSectionProps) {
  const { t } = useTranslation();
  return (
    <section
      className={`${styles.panel} ${styles.courseDetailsPanel}`}
      aria-labelledby="course-details-heading"
    >
      <div className={styles.sectionHeading}>
        <span className={styles.sectionIcon} aria-hidden="true">
          <FileText />
        </span>
        <h2 id="course-details-heading">{t('routes:courseDetailsTitle')}</h2>
      </div>
      <form className={styles.form} onSubmit={onSubmit}>
        <Input
          ref={refs.title}
          label={t('instructor:courseEditorCourseTitle')}
          name="title"
          maxLength={255}
          required
          value={form.title}
          error={fieldErrors.title}
          disabled={isSaving}
          onChange={(event) => onChange({ ...form, title: event.target.value })}
        />
        <Textarea
          ref={refs.description}
          label={t('instructor:courseEditorDescription')}
          name="description"
          value={form.description}
          error={fieldErrors.description}
          disabled={isSaving}
          onChange={(event) => onChange({ ...form, description: event.target.value })}
        />
        <div className={styles.fieldRow}>
          <Input
            ref={refs.price}
            label={t('instructor:courseEditorPrice')}
            name="price"
            type="number"
            min="0"
            step="0.01"
            required
            value={form.price}
            error={fieldErrors.price}
            disabled={isSaving}
            onChange={(event) => onChange({ ...form, price: event.target.value })}
          />
          <Input
            ref={refs.currency}
            label={t('instructor:courseEditorCurrency')}
            name="currency"
            minLength={3}
            maxLength={3}
            required
            value={form.currency}
            error={fieldErrors.currency}
            disabled={isSaving}
            onChange={(event) => onChange({ ...form, currency: event.target.value })}
          />
        </div>
        {failure && !hasFieldErrors ? (
          <div ref={refs.error} tabIndex={-1} role="alert">
            <Notice tone="error">{failure}</Notice>
          </div>
        ) : null}
        <div className={styles.formActions}>
          <Button
            className={styles.pendingPrimaryAction}
            type="submit"
            disabled={isSaving}
            aria-busy={isSaving}
          >
            {t('instructor:courseEditorSaveChanges')}
          </Button>
        </div>
      </form>
    </section>
  );
}
