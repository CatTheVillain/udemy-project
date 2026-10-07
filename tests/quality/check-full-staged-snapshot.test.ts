import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  copyFile,
  cp,
  link,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = resolve('.');
const temporary: string[] = [];
let source = '';
function fixtureEnvironment() {
  const env = { ...process.env };
  delete env.GIT_INDEX_FILE;
  return env;
}
const run = (cwd: string, args: string[], options: Record<string, unknown> = {}) =>
  spawnSync('git', args, {
    cwd,
    encoding: null,
    shell: false,
    maxBuffer: 64 * 1024 * 1024,
    env: fixtureEnvironment(),
    ...options,
  });
const output = (result: ReturnType<typeof spawnSync>) =>
  `${result.stdout.toString()}\n${result.stderr.toString()}`;
function honouredIndex(repository: string) {
  if (process.env.GIT_INDEX_FILE) return resolve(repository, process.env.GIT_INDEX_FILE);
  const result = run(repository, ['rev-parse', '--git-path', 'index'], { env: process.env });
  expect(result.status, output(result)).toBe(0);
  return resolve(repository, result.stdout.toString().trim());
}
function git(cwd: string, args: string[], options: Record<string, unknown> = {}) {
  const result = run(cwd, args, { env: fixtureEnvironment(), ...options });
  expect(result.status, output(result)).toBe(0);
  return result;
}
async function bytes(repository: string) {
  const hash = createHash('sha256');
  for (const path of git(repository, ['ls-files', '-z'])
    .stdout.toString()
    .split('\0')
    .filter(Boolean))
    hash
      .update(path)
      .update('\0')
      .update(await readFile(resolve(repository, path)));
  return hash.digest('hex');
}
function stage(repository: string) {
  const records = git(repository, ['ls-files', '-s', '-z'])
    .stdout.toString()
    .split('\0')
    .filter(Boolean)
    .map((line) => {
      const [meta, path] = line.split('\t');
      const [mode, oid, number] = meta.split(' ');
      expect(number).toBe('0');
      return { path, oid, record: Buffer.from(`${number}:${mode}:${oid}:${path}\0`) };
    })
    .sort((a, b) => Buffer.compare(a.record, b.record));
  const base = git(repository, ['rev-parse', 'HEAD']).stdout.toString().trim();
  const tree = git(repository, ['write-tree']).stdout.toString().trim();
  return {
    base,
    tree,
    records,
    digest: createHash('sha256')
      .update(`quality-stage0-v1\n${base}\n${tree}\n`)
      .update(Buffer.concat(records.map((entry) => entry.record)))
      .digest('hex'),
  };
}
async function projection(repository: string, current: ReturnType<typeof stage>, snapshot: string) {
  const archive = resolve(dirname(snapshot), 'stage.tar');
  await writeFile(archive, git(repository, ['archive', '--format=tar', current.tree]).stdout);
  try {
    const extracted = spawnSync('tar', ['-xf', archive, '-C', snapshot], {
      encoding: 'utf8',
      shell: false,
    });
    expect(extracted.status, `${extracted.stdout}\n${extracted.stderr}`).toBe(0);
  } finally {
    await rm(archive, { force: true });
  }
}
function indexedControl(value: Awaited<ReturnType<typeof fixture>>) {
  const entry =
    value.current.records.find(({ path }) => path === 'package.json') ?? value.current.records[0];
  expect(entry).toBeDefined();
  return entry.path;
}
async function fixture() {
  const directory = await mkdtemp(resolve(tmpdir(), 'quality-checker-'));
  temporary.push(directory);
  const repository = resolve(directory, 'repository');
  git(root, ['clone', '--no-hardlinks', '--quiet', source, repository]);
  await symlink(
    resolve(root, 'node_modules'),
    resolve(repository, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  const current = stage(repository);
  const snapshot = resolve(directory, 'snapshot');
  await mkdir(snapshot);
  await projection(repository, current, snapshot);
  return {
    directory,
    repository,
    snapshot,
    current,
    index: honouredIndex(repository),
    indexBytes: await readFile(honouredIndex(repository)),
    checkoutBytes: await bytes(repository),
    tree: git(repository, ['write-tree']).stdout.toString().trim(),
  };
}
async function refresh(value: Awaited<ReturnType<typeof fixture>>) {
  await rm(value.snapshot, { recursive: true, force: true });
  await mkdir(value.snapshot);
  value.current = stage(value.repository);
  await projection(value.repository, value.current, value.snapshot);
  value.indexBytes = await readFile(value.index);
  value.checkoutBytes = await bytes(value.repository);
  value.tree = git(value.repository, ['write-tree']).stdout.toString().trim();
}
function checker(
  value: Awaited<ReturnType<typeof fixture>>,
  changed: Record<string, string> = {},
  env: NodeJS.ProcessEnv = fixtureEnvironment(),
) {
  const args = [
    'scripts/quality/check-full-staged-snapshot.mjs',
    '--base',
    value.current.base,
    '--tree',
    value.current.tree,
    '--digest',
    value.current.digest,
    '--snapshot-root',
    value.snapshot,
  ];
  for (const [flag, argument] of Object.entries(changed)) args[args.indexOf(flag) + 1] = argument;
  return spawnSync(process.execPath, args, {
    cwd: value.repository,
    encoding: 'utf8',
    shell: false,
    maxBuffer: 64 * 1024 * 1024,
    env,
  });
}
async function protectedState(value: Awaited<ReturnType<typeof fixture>>) {
  expect(await readFile(value.index)).toEqual(value.indexBytes);
  expect(await bytes(value.repository)).toBe(value.checkoutBytes);
  expect(git(value.repository, ['write-tree']).stdout.toString().trim()).toBe(value.tree);
  expect(git(value.repository, ['stash', 'list']).stdout.toString()).toBe('');
}
async function protectedInvalidIndex(value: Awaited<ReturnType<typeof fixture>>) {
  expect(await readFile(value.index)).toEqual(value.indexBytes);
  expect(await bytes(value.repository)).toBe(value.checkoutBytes);
  expect(git(value.repository, ['stash', 'list']).stdout.toString()).toBe('');
}
beforeAll(async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'quality-stage-fixture-'));
  temporary.push(directory);
  source = resolve(directory, 'source');
  await mkdir(source);
  const privateIndex = resolve(directory, 'index');
  await copyFile(honouredIndex(root), privateIndex);
  const archive = resolve(directory, 'stage.tar');
  const stagedTree = git(root, ['write-tree'], {
    env: { ...process.env, GIT_INDEX_FILE: privateIndex },
  })
    .stdout.toString()
    .trim();
  await writeFile(
    archive,
    git(root, ['archive', '--format=tar', stagedTree], {
      env: { ...process.env, GIT_INDEX_FILE: privateIndex },
    }).stdout,
  );
  const unpacked = spawnSync('tar', ['-xf', archive, '-C', source], {
    encoding: 'utf8',
    shell: false,
  });
  expect(unpacked.status, `${unpacked.stdout}\n${unpacked.stderr}`).toBe(0);
  await rm(archive);
  git(source, ['init']);
  git(source, ['add', '-A']);
  git(source, [
    '-c',
    'user.email=quality@example.test',
    '-c',
    'user.name=Quality',
    'commit',
    '-m',
    'stage fixture',
  ]);
}, 60_000);
afterAll(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
}, 60_000);

describe.sequential('authenticated full staged snapshot', () => {
  it('accepts exact stage-0 blobs including a whitespace path and preserves the raw index and every tracked byte', async () => {
    const value = await fixture();
    await writeFile(resolve(value.repository, 'valid whitespace name.txt'), 'stage zero\n');
    git(value.repository, ['add', '--', 'valid whitespace name.txt']);
    await refresh(value);
    const result = checker(value);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain('QUALITY_STAGE0_AUTHENTICATED');
    expect(result.stdout).toContain('QUALITY_SNAPSHOT_AUTHENTICATED');
    expect(result.stdout).toContain('QUALITY_FULL_CHECK_PASS');
    await protectedState(value);
  }, 90_000);
  it('uses a relative honoured private index and ignores divergent unstaged working bytes', async () => {
    const value = await fixture();
    await writeFile(resolve(value.repository, 'valid whitespace name.txt'), 'staged value\n');
    git(value.repository, ['add', '--', 'valid whitespace name.txt']);
    await refresh(value);
    await writeFile(
      resolve(value.repository, 'valid whitespace name.txt'),
      'unstaged divergence\n',
    );
    const privateIndex = resolve(value.repository, 'relative.index');
    await copyFile(value.index, privateIndex);
    value.index = privateIndex;
    value.indexBytes = await readFile(privateIndex);
    value.checkoutBytes = await bytes(value.repository);
    value.tree = git(value.repository, ['write-tree']).stdout.toString().trim();
    const result = checker(value, {}, { ...process.env, GIT_INDEX_FILE: 'relative.index' });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain('QUALITY_FULL_CHECK_PASS');
    await protectedState(value);
  }, 90_000);
  it('keeps interrupted stage artifacts out of ordinary public staging while retaining the authenticated snapshot path', async () => {
    const value = await fixture();
    await mkdir(resolve(value.repository, '.quality-stage0-snapshot'));
    await Promise.all([
      writeFile(resolve(value.repository, '.quality-stage0-snapshot', 'stage.tar'), 'abandoned'),
      writeFile(resolve(value.repository, '.quality-stage0-private-index'), 'abandoned'),
      writeFile(resolve(value.repository, '.quality-stage0-prettier-cache'), 'abandoned'),
    ]);

    git(value.repository, ['add', '-A']);
    expect(
      git(value.repository, ['diff', '--cached', '--name-only']).stdout.toString(),
    ).not.toMatch(/(^|\n)\.quality-stage0-/);
    const afterOrdinaryStage = stage(value.repository);
    expect(afterOrdinaryStage.base).toBe(value.current.base);
    expect(afterOrdinaryStage.tree).toBe(value.current.tree);
    expect(afterOrdinaryStage.digest).toBe(value.current.digest);
    await refresh(value);

    const result = checker(value);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain('QUALITY_FULL_CHECK_PASS');
    await protectedState(value);
  }, 90_000);
  it.each([
    [
      'altered bytes',
      async (path: string, control: string) => writeFile(resolve(path, control), 'altered\n'),
    ],
    ['missing file', async (path: string, control: string) => rm(resolve(path, control))],
    ['extra file', async (path: string) => writeFile(resolve(path, 'extra.txt'), 'x')],
    ['extra empty directory', async (path: string) => mkdir(resolve(path, 'empty'))],
    [
      'symbolic link',
      async (path: string, control: string) => {
        if (process.platform === 'win32') {
          const sourceDirectory = resolve(path, 'src');
          const externalDirectory = resolve(dirname(path), 'linked-src');
          await cp(sourceDirectory, externalDirectory, { recursive: true });
          await rm(sourceDirectory, { recursive: true });
          await symlink(externalDirectory, sourceDirectory, 'junction');
          return;
        }
        const external = resolve(dirname(path), 'link-target');
        await writeFile(external, await readFile(resolve(path, control)));
        await rm(resolve(path, control));
        await symlink(external, resolve(path, control));
      },
    ],
    [
      'hardlink',
      async (path: string, control: string) => {
        const external = resolve(dirname(path), 'hardlink-target');
        await writeFile(external, await readFile(resolve(path, control)));
        await rm(resolve(path, control));
        await link(external, resolve(path, control));
      },
    ],
    [
      'nonregular entry',
      async (path: string, control: string) => {
        await rm(resolve(path, control));
        await mkdir(resolve(path, control));
      },
    ],
  ])(
    'rejects %s before snapshot authentication',
    async (_name, mutate) => {
      const value = await fixture();
      await mutate(value.snapshot, indexedControl(value));
      const result = checker(value);
      expect(result.status).not.toBe(0);
      expect(result.stdout).toContain('QUALITY_STAGE0_AUTHENTICATED');
      expect(result.stdout).not.toContain('QUALITY_SNAPSHOT_AUTHENTICATED');
      await protectedState(value);
    },
    45_000,
  );
  it.each([
    ['missing digest', { '--digest': '' }],
    ['malformed digest', { '--digest': 'bad' }],
    ['stale digest', { '--digest': '0'.repeat(64) }],
    ['stale tree', { '--tree': '0'.repeat(40) }],
    ['invalid base', { '--base': '0'.repeat(40) }],
  ])(
    'rejects %s',
    async (_name, changed) => {
      const value = await fixture();
      const result = checker(value, changed);
      expect(result.status).not.toBe(0);
      expect(result.stdout).not.toContain('QUALITY_SNAPSHOT_AUTHENTICATED');
      await protectedState(value);
    },
    45_000,
  );
  it('rejects actual unmerged and traversal Git boundaries', async () => {
    const value = await fixture();
    const first = value.current.records[0];
    git(value.repository, ['update-index', '--index-info'], {
      input: Buffer.from(`100644 ${first.oid} 1\t${first.path}\n`),
    });
    value.indexBytes = await readFile(value.index);
    value.checkoutBytes = await bytes(value.repository);
    expect(checker(value).status).not.toBe(0);
    expect(
      run(value.repository, [
        'update-index',
        '--add',
        '--cacheinfo',
        `100644,${first.oid},../escape`,
      ]).status,
    ).not.toBe(0);
    await protectedInvalidIndex(value);
  }, 45_000);
  it.each([
    ['corpus', 'localization/corpus/registry.json', '{'],
    [
      'static',
      'src/quality-negative-fixture.ts',
      "interface Course { id: string }\nfunction select(id: Course['id']) {}\n",
    ],
  ])(
    'authenticates before projected %s failure',
    async (_name, path, content) => {
      const value = await fixture();
      await writeFile(resolve(value.repository, path), content);
      git(value.repository, ['add', '--', path]);
      await refresh(value);
      const result = checker(value);
      expect(result.status).not.toBe(0);
      expect(result.stdout).toContain('QUALITY_STAGE0_AUTHENTICATED');
      expect(result.stdout).toContain('QUALITY_SNAPSHOT_AUTHENTICATED');
      await protectedState(value);
    },
    90_000,
  );
});
