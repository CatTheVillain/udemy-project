import { execFileSync } from 'node:child_process';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  materializeHistoricalSourceTree,
  parseHistoricalBlobBatch,
  parseHistoricalSourceTree,
} from './fixtures/historical-source-tree-fixture.mjs';
import type {
  HistoricalSourceTreeEntry,
  HistoricalSourceTreeRequest,
} from './fixtures/historical-source-tree-fixture.mjs';
const {
  CRF_001_FULL_TARGET_COMMIT,
  // @ts-expect-error The recorded-base fixture is a dependency-free Node module with no TypeScript declaration.
} = await import('./fixtures/crf001-recorded-base-fixture.mjs');

const temporaryDirectories: string[] = [];
const SHA_A = '1111111111111111111111111111111111111111';
const SHA_B = '2222222222222222222222222222222222222222';

interface BatchBlobFixture {
  readonly blobId: string;
  readonly bytes: Buffer;
}

const expectedEntries: readonly HistoricalSourceTreeEntry[] = [
  { blobId: SHA_A, mode: '100644', relativePath: 'pages/alpha.ts' },
  { blobId: SHA_B, mode: '100755', relativePath: 'pages/beta.bin' },
];

function treeOutput(entries: readonly string[]): Buffer {
  return Buffer.from(entries.join('\0') + '\0');
}

function batchOutput(blobs: readonly BatchBlobFixture[]): Buffer {
  return Buffer.concat(
    blobs.flatMap(({ blobId, bytes }) => [
      Buffer.from(`${blobId} blob ${bytes.length}\n`),
      bytes,
      Buffer.from('\n'),
    ]),
  );
}

function readHistoricalBlob(sourcePath: string): Buffer {
  const output = execFileSync('git', ['show', `${CRF_001_FULL_TARGET_COMMIT}:src/${sourcePath}`], {
    encoding: 'buffer',
    maxBuffer: 32 * 1024 * 1024,
  });
  return Buffer.isBuffer(output) ? output : Buffer.from(output);
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('historical source tree fixture', () => {
  it('parses NUL tree entries and preserves ordered binary batch payloads', () => {
    const entries = parseHistoricalSourceTree(
      treeOutput([
        `100644 blob ${SHA_A}\tsrc/pages/alpha.ts`,
        `100755 blob ${SHA_B}\tsrc/pages/beta.bin`,
      ]),
    );
    const binaryBytes = Buffer.from([0, 10, 13, 255, 195, 169]);

    expect(entries).toEqual(expectedEntries);
    expect(
      parseHistoricalBlobBatch(
        batchOutput([
          { blobId: SHA_A, bytes: Buffer.from('alpha\n', 'utf8') },
          { blobId: SHA_B, bytes: binaryBytes },
        ]),
        entries,
      ),
    ).toEqual([Buffer.from('alpha\n', 'utf8'), binaryBytes]);
  });

  it.each([
    [[`100644 blob ${SHA_A}\tsrc/../escape.ts`]],
    [[`100644 blob ${SHA_A}\tsrc/pages\\escape.ts`]],
    [[`100644 blob ${SHA_A}\t/src/pages/escape.ts`]],
    [[`100644 blob ${SHA_A}\tsrc/pages/stream.txt:alternate`]],
    [[`100644 blob ${SHA_A}\tsrc/pages/CON.ts`]],
    [[`100644 blob ${SHA_A}\tsrc/pages/trailing-space.ts `]],
    [[`100644 blob ${SHA_A}\tsrc/pages/trailing-dot.ts.`]],
    [[`120000 blob ${SHA_A}\tsrc/pages/link.ts`]],
    [[`100644 tree ${SHA_A}\tsrc/pages/tree.ts`]],
    [
      [
        `100644 blob ${SHA_A}\tsrc/pages/duplicate.ts`,
        `100644 blob ${SHA_B}\tsrc/pages/duplicate.ts`,
      ],
    ],
    [
      [
        `100644 blob ${SHA_A}\tsrc/pages/CaseCollision.ts`,
        `100644 blob ${SHA_B}\tsrc/pages/casecollision.ts`,
      ],
    ],
  ])('rejects an unsafe or unsupported tree inventory %#', (records) => {
    expect(() => parseHistoricalSourceTree(treeOutput(records))).toThrow();
  });

  it.each([
    [batchOutput([{ blobId: SHA_A, bytes: Buffer.from('alpha\n') }]), expectedEntries],
    [
      batchOutput([
        { blobId: SHA_B, bytes: Buffer.from('alpha\n') },
        { blobId: SHA_A, bytes: Buffer.from('beta\n') },
      ]),
      expectedEntries,
    ],
    [Buffer.from(`${SHA_A} tree 6\nalpha\n\n`), [expectedEntries[0]]],
    [Buffer.from(`${SHA_A} blob 7\nalpha\n\n`), [expectedEntries[0]]],
    [
      Buffer.concat([
        batchOutput([{ blobId: SHA_A, bytes: Buffer.from('alpha\n') }]),
        Buffer.from('tail'),
      ]),
      [expectedEntries[0]],
    ],
  ])('rejects malformed, incomplete, or non-canonical batch input %#', (output, entries) => {
    expect(() => parseHistoricalBlobBatch(output, entries)).toThrow();
  });

  it.each([0, 41, 46])(
    'rejects a high-bit byte in the SHA, type, or size header field at offset %d',
    (offset) => {
      const output = batchOutput([{ blobId: SHA_A, bytes: Buffer.from('alpha') }]);
      output[offset] |= 0x80;

      expect(() => parseHistoricalBlobBatch(output, [expectedEntries[0]])).toThrow();
    },
  );

  // Three independent 263-file source trees can contend with the transaction fixture worker.
  it('materializes exact historical text and binary Git bytes into independent caller-owned trees after mutation', async () => {
    const request: HistoricalSourceTreeRequest = {
      repositoryRoot: resolve(process.cwd()),
      commit: CRF_001_FULL_TARGET_COMMIT,
    };
    const sourcePath = 'pages/cart-page/CartPage.tsx';
    const binarySourcePath = 'pages/catalog-page/assets/catalog-hero-ui025.png';
    const expectedSource = readHistoricalBlob(sourcePath);
    const expectedBinarySource = readHistoricalBlob(binarySourcePath);
    const first = await materializeHistoricalSourceTree(request);
    temporaryDirectories.push(first.directory);
    const second = await materializeHistoricalSourceTree(request);
    temporaryDirectories.push(second.directory);
    const firstPath = join(first.sourceRoot, sourcePath);
    const secondPath = join(second.sourceRoot, sourcePath);

    expect(await readFile(firstPath)).toEqual(expectedSource);
    expect(await readFile(secondPath)).toEqual(expectedSource);
    expect(await readFile(join(second.sourceRoot, binarySourcePath))).toEqual(expectedBinarySource);
    await writeFile(firstPath, Buffer.from('caller mutation\0', 'utf8'));
    expect(await readFile(secondPath)).toEqual(expectedSource);

    const third = await materializeHistoricalSourceTree(request);
    temporaryDirectories.push(third.directory);
    expect(await readFile(join(third.sourceRoot, sourcePath))).toEqual(expectedSource);
  }, 15_000);
});
