// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { operatorWxDatabase } from '../../scripts/lib/operator-wx-database.cjs';

it('converts wx document writes to the operator SDK format, including transactions', async () => {
  const set = vi.fn(async () => ({}));
  const document = { get: vi.fn(), set, remove: vi.fn() };
  const db = {
    command: {},
    collection: () => ({ doc: () => document, where: vi.fn() }),
    runTransaction: async (work: (db: unknown) => unknown) => work(db),
  };
  const adapted = operatorWxDatabase(db);
  await adapted
    .collection('x')
    .doc('a')
    .set({ data: { status: 'verified' } });
  await adapted.runTransaction((tx: typeof adapted) =>
    tx
      .collection('x')
      .doc('a')
      .set({ data: { status: 'running' } }),
  );
  expect(set.mock.calls).toEqual([[{ status: 'verified' }], [{ status: 'running' }]]);
});
