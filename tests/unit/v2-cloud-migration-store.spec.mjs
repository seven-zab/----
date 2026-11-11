// @vitest-environment node
import { expect, it } from 'vitest';
import { migrationCloudStore } from '../../scripts/migrate/cloud-store.mjs';
it('writes normalized read-back date wrappers as real dates when updating migration journals or leases', async () => {
  let stored = { created_at: new Date(1000), expires_at: new Date(2000), counter: 7 };
  const db = {
    collection: () => ({
      doc: () => ({
        get: async () => ({ data: [{ _id: 'id', ...stored }] }),
        set: async (data) => {
          stored = data;
          return {};
        },
      }),
    }),
  };
  const store = migrationCloudStore(db);
  const row = await store.get('journal', 'id');
  row.counter++;
  await store.put('journal', row);
  expect(stored.created_at).toBeInstanceOf(Date);
  expect(stored.expires_at).toBeInstanceOf(Date);
  expect(stored.created_at.getTime()).toBe(1000);
  expect(stored.counter).toBe(8);
});
