import { fingerprint } from './v2-engine.mjs';
import { epoch } from '../../database/migrations/002-review-legacy.mjs';

export function restoreStoredValue(value) {
  if (Array.isArray(value)) return value.map(restoreStoredValue);
  if (value && typeof value === 'object') {
    if (Object.keys(value).length === 1 && '$date' in value) {
      const time = epoch(value);
      if (time === null) throw new Error('Invalid restore date');
      return new Date(time);
    }
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, restoreStoredValue(v)]));
  }
  return value;
}
export function isolatedRestorePlan(snapshot, evidence, envId, prefix) {
  if (
    !evidence.complete ||
    evidence.env_id !== envId ||
    evidence.missing_collections?.length !== 0 ||
    !/^[a-f0-9]{64}$/u.test(evidence.snapshot_sha256 ?? '') ||
    !/^restore_[a-z0-9_]{4,40}_$/u.test(prefix)
  )
    throw new Error('Incomplete backup or invalid isolated restore scope');
  const originals = Object.keys(snapshot).sort();
  if (
    !originals.length ||
    originals.some(
      (name) =>
        !/^[a-z][a-z0-9_-]{0,79}$/u.test(name) ||
        !Array.isArray(snapshot[name]) ||
        prefix.length + name.length > 96,
    )
  )
    throw new Error('Invalid restore collections');
  if (
    evidence.collections?.length !== originals.length ||
    originals.some(
      (name) =>
        evidence.collections.filter(
          (c) => c.collection === name && c.count === snapshot[name].length,
        ).length !== 1,
    )
  )
    throw new Error('Backup collection evidence is inconsistent');
  for (const name of originals) {
    const rows = snapshot[name];
    if (
      rows.some((row) => !row || typeof row._id !== 'string' || !row._id) ||
      new Set(rows.map((row) => row._id)).size !== rows.length
    )
      throw new Error('Invalid restore document identities');
  }
  const body = {
    version: 1,
    env_id: envId,
    source_sha256: evidence.snapshot_sha256,
    restore_prefix: prefix,
    collections: originals.map((source) => ({
      source,
      target: prefix + source,
      count: snapshot[source].length,
      content_hash: fingerprint(snapshot[source]),
      acl: 'ADMINONLY',
    })),
  };
  return { ...body, plan_id: fingerprint(body) };
}
export async function restoreIsolated(adapter, plan, snapshot, progress = async () => {}) {
  const { plan_id, ...body } = plan;
  if (
    fingerprint(body) !== plan_id ||
    !/^restore_[a-z0-9_]{4,40}_$/u.test(plan.restore_prefix) ||
    plan.collections.some(
      (c) =>
        c.target !== plan.restore_prefix + c.source ||
        c.acl !== 'ADMINONLY' ||
        c.content_hash !== fingerprint(snapshot[c.source]),
    )
  )
    throw new Error('Restore plan changed');
  const existing = new Set((await adapter.inventory()).map((t) => t.name));
  if (plan.collections.some((c) => existing.has(c.target)))
    throw new Error('Restore target already exists; nothing overwritten');
  // Verify original content before introducing any new collection.
  for (const c of plan.collections)
    if (fingerprint(await adapter.scan(c.source)) !== c.content_hash)
      throw new Error('Original source changed before restore');
  let records = 0;
  for (const c of plan.collections) {
    await adapter.createAdminOnly(c.target);
    if ((await adapter.acl(c.target)) !== 'ADMINONLY')
      throw new Error('Restore permission not verified; no records inserted');
    await progress({ collection: c.target, phase: 'private_empty', records });
    for (const row of snapshot[c.source]) {
      await adapter.insertOnly(c.target, restoreStoredValue(row));
      records++;
    }
    if (fingerprint(await adapter.scan(c.target)) !== c.content_hash)
      throw new Error('Restored content differs from backup');
    await progress({ collection: c.target, phase: 'content_verified', records });
  }
  for (const c of plan.collections) {
    if (
      (await adapter.acl(c.target)) !== 'ADMINONLY' ||
      fingerprint(await adapter.scan(c.target)) !== c.content_hash ||
      fingerprint(await adapter.scan(c.source)) !== c.content_hash
    )
      throw new Error('Final restore or source verification failed');
  }
  return {
    version: 1,
    env_id: plan.env_id,
    source_sha256: plan.source_sha256,
    plan_id,
    restore_prefix: plan.restore_prefix,
    collections: plan.collections.length,
    records,
    database_restore_verified: true,
    private_acl_readback_verified: true,
    original_collections_unchanged: true,
    storage_recovery_verified: false,
    secrets_recovery_verified: false,
    migration_performed: false,
    recorded_at: new Date().toISOString(),
  };
}
