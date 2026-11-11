import type { Entity, Repository } from './repository';
import { ensure } from './errors';
import { hash } from './hash';

interface MigrationGate extends Entity {
  schema_version: number;
  status: string;
  plan_id?: string;
  source_sha256?: string;
}
interface QuarantinedRecord extends Entity {
  plan_id: string;
  source_collection: string;
  source_id: string;
  source_hash: string;
  disposition: string;
  created_at: number;
}
/** Original documents remain private in place. Only the verified migration's
 * matching archive/checkpoint pair establishes their exclusion from v2 data.
 * Malformed, unjournaled records must still fail the caller's shape checks. */
export async function verifiedQuarantinedDemands(repo: Repository): Promise<Set<string>> {
  const gate = await repo.get<MigrationGate>('system_guards', 'v2_migration');
  const ids = new Set<string>();
  if (gate?.schema_version !== 2 || gate.status !== 'verified' || !gate.plan_id) return ids;
  const run = await repo.get<
    Entity & {
      status: string;
      source_sha256: string;
      applied: number;
      total: number;
    }
  >('migration_runs', gate.plan_id);
  const valid = (condition: unknown) =>
    ensure(condition, 'MIGRATION_REQUIRED', '历史数据隔离凭证不完整，请核验迁移对账', 503);
  valid(
    /^[a-f0-9]{64}$/u.test(gate.plan_id) &&
      /^[a-f0-9]{64}$/u.test(gate.source_sha256 ?? '') &&
      run?.status === 'verified' &&
      run.source_sha256 === gate.source_sha256 &&
      Number.isSafeInteger(run.total) &&
      run.total >= 0 &&
      run.applied === run.total,
  );
  let after: { created_at: number; id: string } | undefined;
  for (;;) {
    const rows = await repo.find<QuarantinedRecord>(
      'migration_quarantine',
      {
        plan_id: gate.plan_id,
        source_collection: 'demands',
      },
      100,
      { newest: true, after },
    );
    for (const row of rows) {
      const receipt = await repo.get<
        Entity & { plan_id: string; before_hash: string; after_hash: string }
      >('migration_checkpoints', row._id);
      valid(
        row.plan_id === gate.plan_id &&
          row.source_collection === 'demands' &&
          row._id === hash([gate.plan_id, 'demands', row.source_id]) &&
          typeof row.source_id === 'string' &&
          !ids.has(row.source_id) &&
          row.disposition === 'quarantined' &&
          /^[a-f0-9]{64}$/u.test(row.source_hash) &&
          receipt?.plan_id === gate.plan_id &&
          receipt.before_hash === row.source_hash &&
          receipt.after_hash === row.source_hash &&
          Number.isSafeInteger(row.created_at),
      );
      ids.add(row.source_id);
      valid(ids.size <= 25000 && ids.size <= (run?.total ?? 0));
    }
    if (rows.length < 100) return ids;
    const last = rows[rows.length - 1];
    valid(
      !after ||
        last.created_at < after.created_at ||
        (last.created_at === after.created_at && last._id < after.id),
    );
    after = { created_at: last.created_at, id: last._id };
  }
}
