// @vitest-environment node
import { expect, it } from 'vitest';
import { MemoryRepository } from '../helpers/memory-repository';
import { scopedExportRepository } from '../../scripts/lib/scoped-export-repository';

const id = '12345678-1234-4234-8234-123456789abc';
const other = '12345678-1234-4234-8234-123456789abd';

it('exposes and writes only the selected owner job, without queue scanning or deletion', async () => {
  const raw = new MemoryRepository();
  raw.seed('export_jobs', { _id: id, owner_id: 'owner', status: 'pending' });
  raw.seed('export_jobs', { _id: other, owner_id: 'owner', status: 'pending' });
  const repo = scopedExportRepository(raw, id, 'owner');
  expect(await repo.find('export_jobs', { status: 'pending' }, 5)).toEqual([
    { _id: id, owner_id: 'owner', status: 'pending' },
  ]);
  expect(await repo.find('export_jobs', { status: 'running' }, 5)).toEqual([]);
  await expect(repo.find('export_jobs', {}, 5)).rejects.toThrow();
  await expect(
    repo.transaction((tx) => tx.put('export_jobs', { _id: other, owner_id: 'owner' })),
  ).rejects.toThrow();
  await expect(repo.transaction((tx) => tx.remove('export_jobs', id))).rejects.toThrow();
  await expect(
    repo.transaction((tx) => tx.put('storage_cleanup_tasks', { _id: 'x', job_id: other })),
  ).rejects.toThrow();
  const wrongOwner = scopedExportRepository(raw, id, 'different');
  await expect(wrongOwner.find('export_jobs', { status: 'pending' }, 5)).rejects.toThrow();
  await expect(wrongOwner.transaction((tx) => tx.get('export_jobs', id))).rejects.toThrow();
  await expect(repo.transaction((tx) => tx.get('export_jobs', other))).rejects.toThrow();
  expect(await raw.get('export_jobs', other)).toEqual({
    _id: other,
    owner_id: 'owner',
    status: 'pending',
  });
});
