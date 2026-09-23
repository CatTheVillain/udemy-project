import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkCorpus } from './corpus-engine.mjs';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const SNAPSHOT_PREFIX = 'udemy-frontend-localization-index-';

function runGit(repositoryRoot, args) {
  const result = spawnSync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    shell: false,
  });
  if (result.status === 0 && !result.error) return result.stdout;
  const detail = [result.error?.message, result.stderr, result.stdout]
    .filter(Boolean)
    .join('\n')
    .trim();
  throw new Error(`git ${args[0]} failed${detail ? `: ${detail}` : ''}`);
}

function assertMergedIndex(repositoryRoot) {
  const unmerged = runGit(repositoryRoot, ['ls-files', '--unmerged']);
  if (unmerged.trim())
    throw new Error(
      'Git index is unmerged; staged localization validation requires stage-0 entries.',
    );
}

async function snapshotIndex(repositoryRoot) {
  assertMergedIndex(repositoryRoot);
  const directory = await mkdtemp(join(tmpdir(), SNAPSHOT_PREFIX));
  try {
    runGit(repositoryRoot, [
      'checkout-index',
      '--all',
      `--prefix=${directory.replace(/\\/g, '/')}/`,
    ]);
    return directory;
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export async function checkStagedCorpus({ repositoryRoot = ROOT } = {}) {
  const directory = await snapshotIndex(repositoryRoot);
  let primaryError;
  let violations;
  try {
    violations = await checkCorpus({
      registryPath: join(directory, 'localization/corpus/registry.json'),
      outputPath: join(directory, 'src/shared/locale/generated-resources.ts'),
      sourceRoot: join(directory, 'src'),
    });
  } catch (error) {
    primaryError = error;
  }
  let cleanupError;
  try {
    await rm(directory, { recursive: true, force: true });
  } catch (error) {
    cleanupError = error;
  }
  if (primaryError) throw primaryError;
  if (cleanupError) throw cleanupError;
  return violations;
}

async function main() {
  const violations = await checkStagedCorpus();
  if (violations.length) {
    process.stderr.write(`${violations.join('\n')}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write('LOCALIZATION_STAGED_CHECK_PASS\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
