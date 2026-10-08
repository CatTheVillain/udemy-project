import { cp, lstat, mkdtemp, readFile, readdir, rm, stat, symlink, unlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';

const backendScripts = ['format:check', 'lint', 'typecheck', 'test:unit', 'test:e2e', 'build'];

function containedPath(root, path) {
  const relativePath = relative(root, path);
  return (
    Boolean(relativePath) &&
    !isAbsolute(relativePath) &&
    !relativePath.startsWith(`..${sep}`) &&
    relativePath !== '..'
  );
}

async function regularTree(root, current = root, files = new Map(), directories = new Set()) {
  const info = await lstat(current);
  if (info.isSymbolicLink() || !info.isDirectory())
    throw new Error('Backend runtime tree contains a link or non-directory.');
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = resolve(current, entry.name);
    const relativePath = relative(root, path).replace(/\\/g, '/');
    const entryInfo = await lstat(path);
    if (!relativePath || relativePath.startsWith('../') || entryInfo.isSymbolicLink())
      throw new Error('Backend runtime tree contains an invalid path or link.');
    if (entryInfo.isDirectory()) {
      directories.add(relativePath);
      await regularTree(root, path, files, directories);
    } else if (entryInfo.isFile()) {
      files.set(relativePath, path);
    } else {
      throw new Error('Backend runtime tree contains a nonregular entry.');
    }
  }
  return { files, directories };
}

async function assertMatchingTrees(source, copy) {
  const [sourceTree, copyTree] = await Promise.all([regularTree(source), regularTree(copy)]);
  const { files: sourceFiles, directories: sourceDirectories } = sourceTree;
  const { files: copyFiles, directories: copyDirectories } = copyTree;
  if (
    sourceFiles.size !== copyFiles.size ||
    sourceDirectories.size !== copyDirectories.size ||
    [...sourceFiles.keys()].some((path) => !copyFiles.has(path)) ||
    [...sourceDirectories].some((path) => !copyDirectories.has(path))
  )
    throw new Error('Backend runtime copy path set differs from the authenticated snapshot.');
  for (const [path, sourceFile] of sourceFiles) {
    const [sourceBytes, copyBytes] = await Promise.all([
      readFile(sourceFile),
      readFile(copyFiles.get(path)),
    ]);
    if (Buffer.compare(sourceBytes, copyBytes) !== 0)
      throw new Error(`Backend runtime copy bytes differ for ${path}.`);
  }
}

async function npmInvocation() {
  if (process.platform !== 'win32') return { command: 'npm', prefix: [] };
  const npmCli = resolve(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  const info = await lstat(npmCli).catch(() => undefined);
  if (!info?.isFile() || info.isSymbolicLink())
    throw new Error('Bundled npm CLI is unavailable for the current Node runtime.');
  return { command: process.execPath, prefix: [npmCli] };
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, shell: false, stdio: 'inherit' });
  if (result.error || result.status !== 0)
    throw new Error(`Backend npm command failed: ${args.at(-1) ?? command}.`);
}

async function removeRuntime(runtime, junction) {
  if (!runtime) return;
  if (!containedPath(resolve(tmpdir()), runtime))
    throw new Error('Backend runtime cleanup target escaped temp.');
  if (junction) {
    const info = await lstat(junction).catch(() => undefined);
    if (info) {
      if (!info.isSymbolicLink()) throw new Error('Backend dependency junction was replaced.');
      await unlink(junction);
    }
  }
  await rm(runtime, { recursive: true, force: true });
}

export async function runStagedBackendCheck({ snapshotRoot, repositoryRoot }) {
  const source = resolve(snapshotRoot, 'backend');
  const dependencies = resolve(repositoryRoot, 'backend', 'node_modules');
  if (!containedPath(resolve(snapshotRoot), source))
    throw new Error('Backend snapshot source escaped its root.');
  const dependencyInfo = await stat(dependencies).catch(() => undefined);
  if (!dependencyInfo?.isDirectory()) throw new Error('Backend dependencies are unavailable.');
  let runtime;
  let junction;
  let failure;
  try {
    runtime = await mkdtemp(resolve(tmpdir(), 'quality-staged-backend-'));
    const runtimeBackend = resolve(runtime, 'backend');
    await cp(source, runtimeBackend, { recursive: true, errorOnExist: true, force: false });
    await assertMatchingTrees(source, runtimeBackend);
    junction = resolve(runtimeBackend, 'node_modules');
    await symlink(dependencies, junction, process.platform === 'win32' ? 'junction' : 'dir');
    const { command, prefix } = await npmInvocation();
    for (const script of backendScripts) run(command, [...prefix, 'run', script], runtimeBackend);
    console.log('QUALITY_STAGED_BACKEND_PASS');
  } catch (error) {
    failure = error;
  } finally {
    try {
      await removeRuntime(runtime, junction);
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure) throw failure;
}
