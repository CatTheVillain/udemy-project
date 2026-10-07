import { describe, expect, it } from 'vitest';

import { analyseSourceText, staticSuppressions } from '../../scripts/quality/check-static.mjs';
import { validateReportSection } from '../../scripts/quality/report-utils.mjs';

function ruleIds(source: string): string[] {
  return analyseSourceText('src/fixture.ts', source).map(({ ruleId }) => ruleId);
}

describe('indexed type projections in static quality analysis', () => {
  it.each([
    [
      'parameter annotations',
      "interface Course { id: string }\nfunction select(id: Course['id']) {}",
    ],
    [
      'referenced generic arguments',
      "interface Course { id: string }\ntype Selection = ReadonlyArray<Course['id']>;",
    ],
    [
      'nested ReturnType annotations',
      "interface Client { request(): string }\ntype Request = ReturnType<() => Client['request']>;",
    ],
    [
      'anonymous return annotations',
      "interface Course { id: string }\nconst select = (): Course['id'] => 'course';",
    ],
    [
      'inline props annotations',
      "interface Course { id: string }\nfunction Card(props: { id: Course['id'] }) { return props.id; }",
    ],
    [
      'state generic annotations',
      "declare function useState<T>(initial: T): readonly [T];\ninterface Course { id: string }\nconst [courseId] = useState<Course['id']>('course');",
    ],
  ])('reports a literal indexed access in %s', (_caseName, source) => {
    expect(ruleIds(source)).toEqual(['TS-TYPE-002']);
  });

  it('permits named contracts and value-side object or array access', () => {
    expect(
      ruleIds(
        "interface CourseId { value: string }\nfunction select(id: CourseId) {}\nconst course = { id: 'course' };\nconst ids = [course.id];\nconst selected = course['id'];\nconst first = ids[0];",
      ),
    ).toEqual([]);
  });

  it('permits only an immediately preceding, exact-symbol, nonempty-reason exception', () => {
    expect(
      ruleIds(
        "interface ApiEnvelope<T> { data: T }\n// quality-exception: TS-TYPE-002 VisiblePayload complex generic mapping preserves the API envelope.\ntype VisiblePayload<T> = ApiEnvelope<T>['data'];",
      ),
    ).toEqual([]);

    expect(
      ruleIds(
        "interface ApiEnvelope<T> { data: T }\n// quality-exception: TS-TYPE-002 OtherAlias wrong symbol.\ntype VisiblePayload<T> = ApiEnvelope<T>['data'];",
      ),
    ).toEqual(['TS-TYPE-002']);
    expect(
      ruleIds(
        "interface ApiEnvelope<T> { data: T }\n// quality-exception: TS-TYPE-002 VisiblePayload\ntype VisiblePayload<T> = ApiEnvelope<T>['data'];",
      ),
    ).toEqual(['TS-TYPE-002']);
    expect(
      ruleIds(
        "interface ApiEnvelope<T> { data: T }\n// quality-exception: TS-TYPE-002 VisiblePayload stale comment.\n\ntype VisiblePayload<T> = ApiEnvelope<T>['data'];",
      ),
    ).toEqual(['TS-TYPE-002']);
  });

  it('emits schema-valid suppression records with an exact symbol and reason', () => {
    const suppressions = staticSuppressions();

    expect(suppressions).not.toHaveLength(0);
    suppressions.forEach((suppression) =>
      expect(validateReportSection('suppression', suppression)).toEqual([]),
    );
    expect(
      validateReportSection('suppression', {
        ...suppressions[0],
        symbol: '',
      }),
    ).not.toEqual([]);
    expect(
      validateReportSection('suppression', {
        ...suppressions[0],
        reason: '',
      }),
    ).not.toEqual([]);
  });
});
