import { copyFile, lstat, readFile, readdir, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

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
function parseOptions(argv) {
  const names = new Set(['--base', '--tree', '--digest', '--snapshot-root']);
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    if (!names.has(argv[index]) || values.has(argv[index]) || !argv[index + 1])
      throw new Error('Required checker options are malformed.');
    values.set(argv[index], argv[index + 1]);
  }
  const base = values.get('--base');
  const tree = values.get('--tree');
  const digest = values.get('--digest');
  const snapshotRoot = values.get('--snapshot-root');
  if (
    argv.length !== 8 ||
    values.size !== 4 ||
    !/^[0-9a-f]{40}$/i.test(base) ||
    !/^[0-9a-f]{40}$/i.test(tree) ||
    !/^[0-9a-f]{64}$/i.test(digest) ||
    !isAbsolute(snapshotRoot)
  )
    throw new Error('All checker options are required exactly once with valid values.');
  return {
    base: base.toLowerCase(),
    tree: tree.toLowerCase(),
    digest: digest.toLowerCase(),
    snapshotRoot: resolve(snapshotRoot),
  };
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
function identity(indexFile) {
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
async function snapshotFiles(
  rootPath,
  current = rootPath,
  files = new Map(),
  directories = new Set(),
) {
  const currentInfo = await lstat(current);
  if (currentInfo.isSymbolicLink() || !currentInfo.isDirectory())
    throw new Error('Snapshot root contains a link or non-directory.');
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const file = resolve(current, entry.name);
    const path = relative(rootPath, file).replace(/\\/g, '/');
    const info = await lstat(file);
    if (!validPath(path)) throw new Error('Snapshot contains an invalid path.');
    if (info.isSymbolicLink()) throw new Error('Snapshot contains a link.');
    if (info.isDirectory()) {
      directories.add(path);
      await snapshotFiles(rootPath, file, files, directories);
    } else if (info.isFile()) {
      if (info.nlink > 1) throw new Error('Snapshot contains a hardlink.');
      files.set(path, file);
    } else throw new Error('Snapshot contains a nonregular entry.');
  }
  return { files, directories };
}
async function authenticate(snapshotRoot, records) {
  const actual = await snapshotFiles(snapshotRoot);
  const expected = new Map(records.map(({ path, oid }) => [path, oid]));
  const expectedDirectories = new Set(
    records.flatMap(({ path }) => {
      const parts = path.split('/');
      return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'));
    }),
  );
  if (
    actual.files.size !== expected.size ||
    [...actual.files.keys()].some((path) => !expected.has(path)) ||
    actual.directories.size !== expectedDirectories.size ||
    [...actual.directories].some((path) => !expectedDirectories.has(path))
  )
    throw new Error('Snapshot path set does not match the stage-0 index.');
  for (const [path, oid] of expected) {
    const file = actual.files.get(path);
    if (!file || !resolve(file).startsWith(`${snapshotRoot}${sep}`))
      throw new Error('Snapshot path escaped its root.');
    const [bytes, blob] = await Promise.all([
      readFile(file),
      Promise.resolve(git(['cat-file', 'blob', oid])),
    ]);
    if (Buffer.compare(bytes, blob) !== 0) throw new Error(`Snapshot bytes differ for ${path}.`);
  }
}
async function main() {
  const expected = parseOptions(process.argv.slice(2));
  const originalIndex = indexPath();
  const originalBytes = await readFile(originalIndex);
  const privateIndex = resolve(repositoryRoot, `.quality-stage0-index-${randomUUID()}`);
  let records = [];
  let beforeHash;
  let failure;
  try {
    await copyFile(originalIndex, privateIndex);
    const actual = identity(privateIndex);
    records = actual.records;
    beforeHash = await checkoutHash(records);
    if (
      actual.base !== expected.base ||
      actual.tree !== expected.tree ||
      actual.digest !== expected.digest
    )
      throw new Error('Stage-0 identity does not match supplied metadata.');
    console.log('QUALITY_STAGE0_AUTHENTICATED');
    await authenticate(expected.snapshotRoot, actual.records);
    console.log('QUALITY_SNAPSHOT_AUTHENTICATED');
    const { checkCorpus } = await import('../localization/corpus-engine.mjs');
    const { collectStaticFindings } = await import('./check-static.mjs');
    const violations = await checkCorpus({
      registryPath: resolve(expected.snapshotRoot, 'localization/corpus/registry.json'),
      outputPath: resolve(expected.snapshotRoot, 'src/shared/locale/generated-resources.ts'),
      sourceRoot: resolve(expected.snapshotRoot, 'src'),
    });
    if (violations.length) throw new Error(violations.join('\n'));
    const findings = await collectStaticFindings(resolve(expected.snapshotRoot, 'src'));
    if (findings.length) throw new Error(JSON.stringify({ findings }));
    console.log('QUALITY_FULL_CHECK_PASS');
  } catch (error) {
    failure = error;
  } finally {
    try {
      await rm(privateIndex, { force: true });
    } catch (error) {
      failure ??= error;
    }
    if (
      Buffer.compare(originalBytes, await readFile(originalIndex)) !== 0 ||
      (records.length && beforeHash !== (await checkoutHash(records)))
    )
      failure ??= new Error('Authenticated checker modified protected checkout state.');
  }
  if (failure) throw failure;
}
try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
