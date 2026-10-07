import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { validateReport } from './report-utils.mjs';

export function summaryFor(report) {
  const failed = report.commands
    .filter((command) => command.status !== 'pass')
    .map((command) => command.id);
  const diagnostics = report.commands.reduce(
    (total, command) => total + (command.diagnostics?.allowedRouterFutureWarnings ?? 0),
    0,
  );
  const unexpectedDiagnostics = report.commands.reduce(
    (total, command) =>
      total +
      (command.diagnostics?.unexpectedReactActWarnings ?? 0) +
      (command.diagnostics?.unexpectedUnhandledRejections ?? 0) +
      (command.diagnostics?.unexpectedConsoleWarnings ?? 0) +
      (command.diagnostics?.unexpectedGenericWarnings ?? 0),
    0,
  );
  const diagnosticCounts = report.commands
    .map((command) => {
      const diagnostics = command.diagnostics ?? {};
      return `${command.id}(allowed-router:${diagnostics.allowedRouterFutureWarnings ?? 0},act:${diagnostics.unexpectedReactActWarnings ?? 0},unhandled:${diagnostics.unexpectedUnhandledRejections ?? 0},console:${diagnostics.unexpectedConsoleWarnings ?? 0},generic:${diagnostics.unexpectedGenericWarnings ?? 0})`;
    })
    .join(' ');
  return [
    `quality-report schema=${report.schemaVersion} scope=${report.scope} target=${report.target.kind}`,
    `outcome=${report.outcome} commands=${report.commands.length} failed=${failed.join(',') || 'none'}`,
    `diagnostics=allowed-router:${diagnostics} unexpected:${unexpectedDiagnostics}`,
    `diagnostic-counts=${diagnosticCounts}`,
    `findings=${report.findings.length} suppressions=${report.suppressions.length} advisory-complexity-signals=${report.advisory.complexitySignals.length} advisory-complexity-review=${report.advisory.complexityReview.basis}`,
  ].join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const reportPath = process.argv[2];
  if (!reportPath) throw new Error('Usage: node report-summary.mjs <report-path>');
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  const errors = validateReport(report);
  if (errors.length) throw new Error(`Invalid report: ${errors.join('; ')}`);
  console.log(summaryFor(report));
}
