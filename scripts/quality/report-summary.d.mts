export function summaryFor(report: {
  schemaVersion: number;
  scope: string;
  target: { kind: string };
  outcome: string;
  commands: Array<{ id: string; status: string }>;
  findings: unknown[];
  suppressions: unknown[];
  advisory: {
    complexitySignals: unknown[];
    complexityReview: { basis: 'independent-responsibilities'; guidance: string };
  };
}): string;
