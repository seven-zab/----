// @vitest-environment node
import { expect, it } from 'vitest';
import { listAllObjects } from '../../scripts/lib/cos-operator.mjs';

it('starts at an empty marker so hidden objects and zero-byte directory markers are backed up', async () => {
  const calls = [];
  const pages = [
    {
      Contents: [{ Key: '.hidden', Size: '1', ETag: 'a' }],
      IsTruncated: true,
      NextMarker: '.hidden',
    },
    { Contents: [{ Key: 'folder/', Size: '0', ETag: 'b' }], IsTruncated: 'false' },
  ];
  const rows = await listAllObjects(async (_, params) => {
    calls.push(params);
    return pages.shift();
  });
  expect(calls.map((p) => p.Marker)).toEqual(['', '.hidden']);
  expect(rows.map((r) => r.key)).toEqual(['.hidden', 'folder/']);
});
it('refuses truncation, repeated markers and unexpected cross-prefix objects', async () => {
  await expect(
    listAllObjects(async () => ({ Contents: [], IsTruncated: true, NextMarker: '' })),
  ).rejects.toThrow('marker');
  await expect(
    listAllObjects(
      async () => ({ Contents: [{ Key: 'other', Size: 1, ETag: 'a' }], IsTruncated: false }),
      'env/',
    ),
  ).rejects.toThrow('identity');
  await expect(listAllObjects(async () => ({ Contents: [] }))).rejects.toThrow('truncation');
});
it('never silently caps object counts or accepts invalid sizes', async () => {
  await expect(
    listAllObjects(
      async () => ({ Contents: [{ Key: 'a', Size: 1, ETag: 'a' }], IsTruncated: false }),
      '',
      0,
    ),
  ).rejects.toThrow('limit');
  await expect(
    listAllObjects(async () => ({
      Contents: [{ Key: 'a', Size: -1, ETag: 'a' }],
      IsTruncated: false,
    })),
  ).rejects.toThrow('size');
});
