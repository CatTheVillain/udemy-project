import registry from '../../../localization/corpus/registry.json';
import { GENERATED_LOCALE_RESOURCES } from '../../../src/shared/locale/generated-resources';

import { describe, expect, it } from 'vitest';

import { CRF_002_UNIT_IDS } from './fixtures/crf002-unit-ids';

const generated = GENERATED_LOCALE_RESOURCES as Record<
  string,
  Record<string, Record<string, string>>
>;
const RECORDED_DRAFT37_UNIT_COUNT = 545;
const FE_068_UNIT_COUNT = 21;
const INSTRUCTOR_UI_UNIT_COUNT = 9;
const CURRENT_CORPUS_UNIT_COUNT =
  RECORDED_DRAFT37_UNIT_COUNT +
  CRF_002_UNIT_IDS.length +
  FE_068_UNIT_COUNT +
  INSTRUCTOR_UI_UNIT_COUNT;

describe('generated canonical localization resources', () => {
  it('binds the committed canonical registry to exact DRAFT-37 migration facts', () => {
    expect(registry).toMatchObject({
      corpusVersion: 'MLUX-001-DRAFT-37',
      source: { sha256: 'C9E208FC5F1AEF55E709290C67270B79E1CBCE4831E7FBCB20555AB5CF8A73AE' },
      summary: {
        translationUnits: CURRENT_CORPUS_UNIT_COUNT,
        sourceOccurrences:
          768 + CRF_002_UNIT_IDS.length + FE_068_UNIT_COUNT + INSTRUCTOR_UI_UNIT_COUNT,
        mergedDuplicateRows: 223,
      },
    });
    expect(registry.exclusions).toHaveLength(12);
    expect(registry.units).toHaveLength(CURRENT_CORPUS_UNIT_COUNT);
    expect(
      registry.units
        .filter((unit) => unit.migrationProvenance.ownerTasks.includes('CRF-002'))
        .map((unit) => unit.id),
    ).toEqual(CRF_002_UNIT_IDS);
    for (const { locales } of registry.units) {
      for (const locale of [locales.ru, locales.uz]) {
        if (locale.status !== 'draft') continue;
        expect(locale.reviewerId).toBeNull();
        expect(locale.verdict).toBeNull();
        expect(locale.requestedAt).toBeNull();
        expect(locale.reviewedAt).toBeNull();
        expect(locale.approvalRecordedAt).toBeNull();
      }
    }
  });

  it('contains active draft candidates without approval metadata and preserves generated keys', () => {
    expect(generated.en.common.language).toBe('Language');
    expect(generated.ru.common.language).toBe('Язык');
    expect(generated.uz.common.language).toBe('Til');
    expect(generated.en.course.noReviewsDescription).toContain('Be the first');
    expect(generated.ru.course.reviewCommentPrompt).toBe('Что вам понравилось?');
    expect(generated.uz.course.reviewCommentPlaceholder).toBe('Batafsilroq aytib bering');
    expect(generated.en.course.yourReview).toBe('Your review');
    expect(generated.ru.course.courseReviewsHeading).toBe('Отзывы о курсе');
    expect(generated.en.course.editReviewShort).toBe('Edit review');
    expect(generated.ru.course.editReviewShort).toBe('Изменить отзыв');
    expect(generated.uz.course.editReviewShort).toBe('Sharhni tahrirlash');
    expect(generated.uz.course.saveReviewChanges).toBe('Saqlash');
    expect(generated.en.learning.completeLessonShort).toBe('Complete');
    expect(generated.ru.learning.completeLessonShort).toBe('Завершить');
    expect(generated.uz.learning.completeLessonShort).toBe('Yakunlash');
    expect(generated.en.learning.videoLessonType).toBe('Video lesson');
    expect(generated.ru.learning.textLessonType).toBe('Текстовый урок');
    expect(generated.uz.learning.pdfLessonType).toBe('PDF dars');
    expect(generated.en.learning.pdfLessonComingSoon).toBe('PDF lesson · Coming soon');
    expect(generated.ru.learning.videoLessonComingSoon).toBe('Видеоурок · Скоро будет доступно');
    expect(generated.uz.learning.textLessonComingSoon).toBe('Matnli dars · Tez orada mavjud');
    expect(JSON.stringify(GENERATED_LOCALE_RESOURCES)).not.toContain('approvalRecordedAt');
    expect(JSON.stringify(GENERATED_LOCALE_RESOURCES)).not.toContain('review_requested');
    expect(JSON.stringify(GENERATED_LOCALE_RESOURCES)).not.toContain('unitLifecycle');
    expect(generated.en.instructor.courseEnrollmentsCount_one).toContain('{{count}}');
  });

  it('emits every canonical plural form for all four plural units without lifecycle metadata', () => {
    const pluralUnits = registry.units.filter(({ pluralForms }) => pluralForms !== null);
    expect(pluralUnits).toHaveLength(4);
    for (const unit of pluralUnits) {
      for (const locale of ['en', 'ru', 'uz'] as const) {
        const forms = unit.pluralForms?.[locale];
        expect(Object.keys(forms ?? {})).not.toHaveLength(0);
        for (const [suffix, value] of Object.entries(forms ?? {})) {
          expect(generated[locale]?.[unit.namespace]?.[`${unit.key}_${suffix}`]).toBe(value);
        }
      }
    }
  });
});
