// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { MemoryRepository } from '../helpers/memory-repository';
import { fencedMaintenanceRepository } from '../../server/maintenance/fenced-repository';
import type { Entity } from '../../server/core/repository';

describe('maintenance transaction migration fence', () => {
  it('touches the shared gate once for several writes, but not for a read-only transaction', async () => {
    const source = new MemoryRepository();
    source.seed('system_guards', {
      _id: 'v2_migration',
      schema_version: 2,
      status: 'verified',
      operation_seq: 3,
    });
    source.seed('old_data', { _id: 'removed' });
    const repo = fencedMaintenanceRepository(source);
    await repo.transaction(async (tx) => {
      await tx.get('old_data', 'removed');
    });
    expect(
      (await source.get<Entity & { operation_seq: number }>('system_guards', 'v2_migration'))
        ?.operation_seq,
    ).toBe(3);
    await repo.transaction(async (tx) => {
      await tx.put('job_runs', { _id: 'run' });
      await tx.remove('old_data', 'removed');
    });
    expect(
      (await source.get<Entity & { operation_seq: number }>('system_guards', 'v2_migration'))
        ?.operation_seq,
    ).toBe(4);
    expect(source.rows('job_runs')).toHaveLength(1);
    expect(source.rows('old_data')).toHaveLength(0);
  });
  it('blocks and rolls back maintenance writes when migration becomes unverified', async () => {
    const source = new MemoryRepository();
    source.seed('system_guards', { _id: 'v2_migration', schema_version: 2, status: 'applying' });
    source.seed('old_data', { _id: 'existing' });
    const repo = fencedMaintenanceRepository(source);
    await expect(
      repo.transaction(async (tx) => {
        await tx.get('old_data', 'existing');
        await tx.remove('old_data', 'existing');
      }),
    ).rejects.toMatchObject({ error_code: 'MIGRATION_REQUIRED' });
    expect(source.rows('old_data')).toHaveLength(1);
    expect(
      source.rows<Entity & { operation_seq?: number }>('system_guards')[0].operation_seq,
    ).toBeUndefined();
  });
  it('rolls back both the gate and maintenance changes if later work fails', async () => {
    const source = new MemoryRepository();
    source.seed('system_guards', {
      _id: 'v2_migration',
      schema_version: 2,
      status: 'verified',
      operation_seq: 2,
    });
    const repo = fencedMaintenanceRepository(source);
    await expect(
      repo.transaction(async (tx) => {
        await tx.put('job_runs', { _id: 'pending' });
        throw new Error('simulated transaction failure');
      }),
    ).rejects.toThrow('simulated');
    expect(source.rows('job_runs')).toHaveLength(0);
    expect(
      (await source.get<Entity & { operation_seq: number }>('system_guards', 'v2_migration'))
        ?.operation_seq,
    ).toBe(2);
  });
});
