import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, isAbsolute, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const decode = (value) => new TextDecoder('utf-8', { fatal: true }).decode(value).trim();
const decodeNulList = (value) =>
  new TextDecoder('utf-8', { fatal: true }).decode(value).split('\0').filter(Boolean);
const capturedGitMaxBuffer = 16 * 1024 * 1024;
const invocationRoot = process.cwd();
function invokeGit(args, options = {}) {
  const result = spawnSync('git', args, {
    cwd: invocationRoot,
    encoding: null,
    maxBuffer: capturedGitMaxBuffer,
    shell: false,
    ...options,
  });
  if (result.status !== 0) {
    const failure = [result.error?.code, result.signal].filter(Boolean).join(', ');
    throw new Error(
      `git ${args[0]} failed${failure ? ` (${failure})` : ''}: ${result.stderr?.toString('utf8') ?? ''}`,
    );
  }
  return result.stdout;
}
const repositoryRoot = resolve(decode(invokeGit(['rev-parse', '--show-toplevel'])));
function git(args, options = {}) {
  return invokeGit(args, { cwd: repositoryRoot, ...options });
}
function indexPath() {
  if (process.env.GIT_INDEX_FILE)
    return isAbsolute(process.env.GIT_INDEX_FILE)
      ? process.env.GIT_INDEX_FILE
      : resolve(invocationRoot, process.env.GIT_INDEX_FILE);
  return resolve(repositoryRoot, decode(git(['rev-parse', '--git-path', 'index'])));
}
function validPath(path) {
  return (
    path &&
    !path.includes('\\') &&
    !path.startsWith('/') &&
    !path.split('/').some((part) => !part || part === '.' || part === '..')
  );
}
function stageIdentity(indexFile) {
  const records = decodeNulList(
    git(['ls-files', '-s', '-z'], { env: { ...process.env, GIT_INDEX_FILE: indexFile } }),
  )
    .map((item) => {
      const separator = item.indexOf('\t');
      const metadata = item.slice(0, separator);
      const path = item.slice(separator + 1);
      const [mode, oid, stage] = metadata.split(' ');
      if (separator < 1 || stage !== '0')
        throw new Error('Unmerged index entries are not supported.');
      if (!/^100(?:644|755)$/.test(mode) || !/^[0-9a-f]{40}$/i.test(oid) || !validPath(path))
        throw new Error('Invalid stage-0 record.');
      return { path, oid, record: Buffer.from(`${stage}:${mode}:${oid}:${path}\0`, 'utf8') };
    })
    .sort((left, right) => Buffer.compare(left.record, right.record));
  const base = decode(git(['rev-parse', 'HEAD']));
  const tree = decode(git(['write-tree'], { env: { ...process.env, GIT_INDEX_FILE: indexFile } }));
  const digest = createHash('sha256')
    .update(`quality-stage0-v1\n${base}\n${tree}\n`)
    .update(Buffer.concat(records.map(({ record }) => record)))
    .digest('hex');
  return { base, tree, digest, records };
}
async function checkoutHash(records) {
  const hash = createHash('sha256');
  for (const { path } of records) {
    hash.update(`${path}\0`);
    try {
      hash.update(await readFile(resolve(repositoryRoot, path)));
    } catch {
      hash.update('MISSING');
    }
  }
  return hash.digest('hex');
}
async function project(records) {
  const snapshot = await mkdtemp(resolve(repositoryRoot, `.quality-stage0-${randomUUID()}-`));
  let complete = false;
  try {
    for (const { path, oid } of records) {
      const target = resolve(snapshot, path);
      if (!target.startsWith(`${snapshot}${sep}`))
        throw new Error('Projection path escaped its root.');
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, git(['cat-file', 'blob', oid]), { flag: 'wx' });
    }
    complete = true;
    return snapshot;
  } finally {
    if (!complete) await rm(snapshot, { recursive: true, force: true });
  }
}
function changedPaths(indexFile, records, filter, requireStageMember = true) {
  const paths = decodeNulList(
    git(['diff', '--cached', '--name-only', '-z', `--diff-filter=${filter}`, 'HEAD'], {
      env: { ...process.env, GIT_INDEX_FILE: indexFile },
    }),
  );
  const members = new Set(records.map(({ path }) => path));
  if (paths.some((path) => !validPath(path) || (requireStageMember && !members.has(path))))
    throw new Error('Changed path is not a stage-0 member.');
  return paths;
}
function run(args, cwd, env = process.env) {
  return (
    spawnSync(process.execPath, args, { cwd, env, stdio: 'inherit', shell: false }).status === 0
  );
}
async function main() {
  const originalIndex = indexPath();
  const originalBytes = await readFile(originalIndex);
  const privateIndex = resolve(repositoryRoot, `.quality-stage0-index-${randomUUID()}`);
  const prettierCache = resolve(repositoryRoot, `.quality-stage0-prettier-${randomUUID()}`);
  let snapshot;
  let records = [];
  let beforeHash;
  let failure;
  try {
    await copyFile(originalIndex, privateIndex);
    const identity = stageIdentity(privateIndex);
    records = identity.records;
    beforeHash = await checkoutHash(records);
    snapshot = await project(records);
    const { isBackendQualityPath, isBackendSourcePath, stagedPredicatePlan } = await import(
      pathToFileURL(resolve(snapshot, 'scripts/quality/quality-decisions.mjs')).href
    );
    const changed = changedPaths(privateIndex, records, 'ACMR');
    const plan = stagedPredicatePlan(changed.filter((path) => !isBackendSourcePath(path)));
    const backendChanged = changedPaths(privateIndex, records, 'ACMRD', false).some(
      isBackendQualityPath,
    );
    const projected = (paths) => paths.map((path) => resolve(snapshot, path));
    const exe = (path) => resolve(root, path);
    if (
      plan.selected.prettier.length &&
      !run(
        [
          exe('node_modules/prettier/bin/prettier.cjs'),
          '--check',
          '--cache-location',
          prettierCache,
          ...projected(plan.selected.prettier),
        ],
        snapshot,
      )
    )
      throw new Error('Prettier check failed.');
    if (
      plan.selected.eslint.length &&
      !run(
        [
          exe('node_modules/eslint/bin/eslint.js'),
          '--max-warnings',
          '0',
          ...projected(plan.selected.eslint),
        ],
        snapshot,
      )
    )
      throw new Error('ESLint check failed.');
    if (
      plan.selected.stylelint.length &&
      !run(
        [
          exe('node_modules/stylelint/bin/stylelint.mjs'),
          '--max-warnings',
          '0',
          ...projected(plan.selected.stylelint),
        ],
        snapshot,
      )
    )
      throw new Error('Stylelint check failed.');
    if (
      changed.some(
        (path) =>
          path === 'localization/corpus/registry.json' ||
          path === 'src/shared/locale/generated-resources.ts',
      )
    ) {
      const { checkCorpus } = await import(
        pathToFileURL(resolve(snapshot, 'scripts/localization/corpus-engine.mjs')).href
      );
      const violations = await checkCorpus({
        registryPath: resolve(snapshot, 'localization/corpus/registry.json'),
        outputPath: resolve(snapshot, 'src/shared/locale/generated-resources.ts'),
        sourceRoot: resolve(snapshot, 'src'),
      });
      if (violations.length) throw new Error(violations.join('\n'));
    }
    if (
      !run(
        [
          resolve(snapshot, 'scripts/quality/check-full-staged-snapshot.mjs'),
          '--base',
          identity.base,
          '--tree',
          identity.tree,
          '--digest',
          identity.digest,
          '--snapshot-root',
          snapshot,
        ],
        snapshot,
        { ...process.env, GIT_INDEX_FILE: originalIndex },
      )
    )
      throw new Error('Authenticated full checker failed.');
    if (backendChanged) {
      const { runStagedBackendCheck } = await import(
        pathToFileURL(resolve(snapshot, 'scripts/quality/check-staged-backend.mjs')).href
      );
      await runStagedBackendCheck({ snapshotRoot: snapshot, repositoryRoot });
    }
  } catch (error) {
    failure = error;
  } finally {
    const cleanup = await Promise.allSettled([
      rm(privateIndex, { force: true }),
      rm(prettierCache, { force: true, recursive: true }),
      snapshot && rm(snapshot, { recursive: true, force: true }),
    ]);
    if (cleanup.some(({ status }) => status === 'rejected'))
      failure ??= new Error('Quality stage cleanup failed.');
    if (
      Buffer.compare(originalBytes, await readFile(originalIndex)) !== 0 ||
      (records.length && beforeHash !== (await checkoutHash(records)))
    )
      failure ??= new Error('Quality stage gate modified protected checkout state.');
  }
  if (failure) throw failure;
}
try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
