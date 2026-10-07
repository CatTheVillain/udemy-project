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
    [
      'object binding annotations',
      "interface Course { id: string }\nconst { id }: { id: Course['id'] } = { id: 'course' };",
    ],
    ['expression statements', "interface Course { id: string }\n(<Course['id']>'course');"],
    [
      'export default expressions',
      "interface Course { id: string }\nexport default (<Course['id']>'course');",
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

  it('rejects a file-leading exception for a later exact symbol', () => {
    expect(
      ruleIds(
        "// quality-exception: TS-TYPE-002 VisiblePayload file-leading marker must not suppress a later alias.\ninterface ApiEnvelope<T> { data: T }\ntype VisiblePayload<T> = ApiEnvelope<T>['data'];",
      ),
    ).toEqual(['TS-TYPE-002']);
  });

  it('rejects a namespace-leading exception for a descendant exact symbol', () => {
    expect(
      ruleIds(
        "// quality-exception: TS-TYPE-002 VisiblePayload namespace-leading marker must not suppress a descendant alias.\ndeclare namespace Contracts {\n  interface ApiEnvelope<T> { data: T }\n  type VisiblePayload<T> = ApiEnvelope<T>['data'];\n}",
      ),
    ).toEqual(['TS-TYPE-002']);
  });

  it('does not let an ownerless projection inherit a nearby exception', () => {
    expect(
      ruleIds(
        "interface Course { id: string }\n// quality-exception: TS-TYPE-002 Course stale ownerless exception.\nexport default (<Course['id']>'course');",
      ),
    ).toEqual(['TS-TYPE-002']);
  });

  it.each([
    [
      'const',
      "interface ApiEnvelope<T> { data: T }\n// quality-exception: TS-TYPE-002 VisiblePayload exact compatibility value adapter.\nconst VisiblePayload: ApiEnvelope<string>['data'] = 'payload';",
    ],
    [
      'export const',
      "interface ApiEnvelope<T> { data: T }\n// quality-exception: TS-TYPE-002 VisiblePayload exported compatibility value adapter.\nexport const VisiblePayload: ApiEnvelope<string>['data'] = 'payload';",
    ],
    [
      'a later declarator in the same const statement',
      "interface ApiEnvelope<T> { data: T }\n// quality-exception: TS-TYPE-002 VisiblePayload exact compatibility value adapter.\nconst prefix = 'prefix', VisiblePayload: ApiEnvelope<string>['data'] = 'payload';",
    ],
  ])('permits an exact immediate exception for %s', (_caseName, source) => {
    expect(ruleIds(source)).toEqual([]);
  });

  it.each([
    [
      'a different variable symbol',
      "interface ApiEnvelope<T> { data: T }\n// quality-exception: TS-TYPE-002 OtherPayload wrong variable symbol.\nconst VisiblePayload: ApiEnvelope<string>['data'] = 'payload';",
    ],
    [
      'an empty reason',
      "interface ApiEnvelope<T> { data: T }\n// quality-exception: TS-TYPE-002 VisiblePayload\nconst VisiblePayload: ApiEnvelope<string>['data'] = 'payload';",
    ],
    [
      'a blank line',
      "interface ApiEnvelope<T> { data: T }\n// quality-exception: TS-TYPE-002 VisiblePayload stale comment.\n\nconst VisiblePayload: ApiEnvelope<string>['data'] = 'payload';",
    ],
    [
      'an intervening declaration',
      "interface ApiEnvelope<T> { data: T }\n// quality-exception: TS-TYPE-002 VisiblePayload stale comment.\nconst separator = 'separator';\nconst VisiblePayload: ApiEnvelope<string>['data'] = 'payload';",
    ],
    [
      'another declarator in the same const statement',
      "interface ApiEnvelope<T> { data: T }\n// quality-exception: TS-TYPE-002 VisiblePayload exact compatibility value adapter.\nconst VisiblePayload: ApiEnvelope<string>['data'] = 'visible', OtherPayload: ApiEnvelope<string>['data'] = 'other';",
    ],
  ])('rejects a variable exception with %s', (_caseName, source) => {
    expect(ruleIds(source)).toEqual(['TS-TYPE-002']);
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
