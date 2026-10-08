export const requiredQualityJobs = [
  'lint-static',
  'typecheck',
  'tests',
  'build',
  'browser',
  'quality-report',
];

export function isBackendSourcePath(path) {
  const normalized = path.replace(/\\/g, '/');
  return normalized === 'backend' || normalized.startsWith('backend/');
}

export function isBackendQualityPath(path) {
  return (
    isBackendSourcePath(path) ||
    path.replace(/\\/g, '/') === '.github/workflows/backend-quality.yml'
  );
}

export function stagedPredicatePlan(paths) {
  const normalized = paths.map((path) => path.replace(/\\/g, '/'));
  const selected = {
    prettier: normalized.filter((path) => /\.(?:ts|tsx|cjs|mjs|css|json|md|yml|yaml)$/.test(path)),
    eslint: normalized.filter((path) => /\.(?:ts|tsx|cjs|mjs)$/.test(path)),
    stylelint: normalized.filter((path) => path.endsWith('.css')),
  };
  return {
    selected,
    hasTargets: Object.values(selected).some((pathsForPredicate) => pathsForPredicate.length > 0),
  };
}

export function evaluateStagedGate({ paths, predicateResults, bypassed = false }) {
  const plan = stagedPredicatePlan(paths);
  if (bypassed) return { outcome: 'bypassed', plan, failures: [] };
  if (!plan.hasTargets) return { outcome: 'pass', plan, failures: [] };
  const failures = Object.entries(predicateResults)
    .filter(([predicate, result]) => plan.selected[predicate].length > 0 && result !== 'pass')
    .map(([predicate]) => predicate);
  return { outcome: failures.length === 0 ? 'pass' : 'fail', plan, failures };
}

export function qualityTargetForEvent({ eventName, githubSha, pullRequestHeadSha }) {
  if (eventName === 'pull_request') return validQualityTargetSha(pullRequestHeadSha);
  if (eventName === 'push') return validQualityTargetSha(githubSha);
  return '';
}

function validQualityTargetSha(sha) {
  return typeof sha === 'string' && /^[0-9a-f]{7,64}$/i.test(sha) ? sha : '';
}

export function evaluateCiAggregate({ needs, qualityTargetSha, artifactPresent, reportErrors }) {
  const failedJobs = requiredQualityJobs.filter((job) => needs[job]?.result !== 'success');
  const errors = [];
  if (failedJobs.length) errors.push(`required jobs not successful: ${failedJobs.join(',')}`);
  if (!validQualityTargetSha(qualityTargetSha))
    errors.push('quality target SHA is missing or invalid');
  if (!artifactPresent) errors.push('quality report artifact is missing');
  errors.push(...reportErrors);
  return { outcome: errors.length === 0 ? 'pass' : 'fail', errors };
}
