export interface QualityFinding {
  category: string;
  file: string;
  line: number;
  ruleId: string;
  message: string;
}

export function analyseSourceText(
  file: string,
  content: string,
  sourceRoot?: string,
): QualityFinding[];
export function collectImportCycleFindings(
  entries: Array<{ file: string; content: string }>,
  sourceRoot?: string,
): QualityFinding[];
export function collectStaticFindings(
  directory?: string,
  sourceRoot?: string,
): Promise<QualityFinding[]>;
export function staticSuppressions(): Array<{
  ruleId: string;
  path: string;
  symbol: string;
  reason: string;
}>;
export function complexitySignals(content: string): Array<Record<string, number | string>>;
export const complexityReview: Readonly<{
  basis: 'independent-responsibilities';
  guidance: string;
}>;
