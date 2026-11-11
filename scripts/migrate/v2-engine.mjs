import { createHash } from 'node:crypto';
import { epoch } from '../../database/migrations/002-review-legacy.mjs';

export class MigrationSafetyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MigrationSafetyError';
  }
}
function requireThat(condition, message) {
  if (!condition) throw new MigrationSafetyError(message);
}
export function normalized(value) {
  requireThat(
    typeof value !== 'number' || Number.isFinite(value),
    'Non-finite stored number is unsupported',
  );
  if (value instanceof Date) {
    const timestamp = epoch(value);
    requireThat(Number.isSafeInteger(timestamp) && timestamp >= 0, 'Invalid stored date');
    return { $date: timestamp };
  }
  if (Array.isArray(value)) return value.map(normalized);
  if (value && typeof value === 'object') {
    requireThat(
      Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null,
      'Unsupported stored object type; preserve the original export for review',
    );
    if (Object.keys(value).length === 1 && '$date' in value) {
      const timestamp = epoch(value.$date);
      requireThat(timestamp !== null, 'Invalid exported date');
      return { $date: timestamp };
    }
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, normalized(value[key])]),
    );
  }
  return value;
}
export const fingerprint = (value) =>
  createHash('sha256')
    .update(JSON.stringify(normalized(value)))
    .digest('hex');

// The CloudBase adapter stores top-level *_at/ *_until numbers as Dates.
// Preserve this type in the expected value, without conflating legacy numbers
// with timestamp objects during backup/restore comparison.
export function storedAdditions(additions) {
  return Object.fromEntries(
    Object.entries(additions).map(([key, value]) => [
      key,
      typeof value === 'number' && /_at$|_until$/u.test(key) ? { $date: value } : value,
    ]),
  );
}

// This migration preserves legacy documents. It adds only verified base-account
// fields; historic role strings, claims, approvals and form values grant nothing.
export function planV2Migration(snapshot, mapping, sourceSha256) {
  requireThat(
    snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot),
    'Invalid source snapshot',
  );
  requireThat(/^[a-f0-9]{64}$/u.test(sourceSha256 ?? ''), 'Invalid backup digest');
  requireThat(
    mapping?.version === 2 &&
      Object.keys(mapping).every((key) =>
        ['version', 'env_id', 'verified_by', 'verification_reference', 'users'].includes(key),
      ) &&
      /^[a-z][a-z0-9-]{2,99}$/u.test(mapping.env_id ?? '') &&
      typeof mapping.verified_by === 'string' &&
      mapping.verified_by.trim() &&
      typeof mapping.verification_reference === 'string' &&
      mapping.verification_reference.trim() &&
      Array.isArray(mapping.users) &&
      mapping.users.length > 0,
    'Verified user mapping is required',
  );
  const userMapping = new Map();
  for (const row of mapping.users) {
    requireThat(
      row &&
        Object.keys(row).every((key) =>
          ['user_id', 'openid_sha256', 'account_status'].includes(key),
        ) &&
        typeof row.user_id === 'string' &&
        row.user_id &&
        /^[a-f0-9]{64}$/u.test(row.openid_sha256 ?? '') &&
        ['active', 'banned', 'deactivated'].includes(row.account_status) &&
        !userMapping.has(row.user_id),
      'Invalid or duplicate verified user mapping',
    );
    userMapping.set(row.user_id, row);
  }
  const identities = new Map(),
    entries = [],
    blockers = [];
  for (const row of snapshot.users ?? []) {
    if (typeof row._openid === 'string') {
      const owners = identities.get(row._openid) ?? [];
      owners.push(row._id);
      identities.set(row._openid, owners);
    }
  }
  for (const collection of Object.keys(snapshot).sort()) {
    requireThat(
      /^[a-z][a-z0-9_-]{0,79}$/u.test(collection) && Array.isArray(snapshot[collection]),
      'Invalid source collection',
    );
    const ids = new Set();
    for (const row of [...snapshot[collection]].sort((a, b) =>
      a._id < b._id ? -1 : a._id > b._id ? 1 : 0,
    )) {
      requireThat(
        row && typeof row._id === 'string' && row._id && !ids.has(row._id),
        'Invalid or duplicate source record',
      );
      ids.add(row._id);
      const entry = {
        collection,
        record_id: row._id,
        before_hash: fingerprint(row),
        additions: {},
        identity: null,
        disposition: 'quarantined',
        reason: 'LEGACY_RECORD_REQUIRES_REVIEW',
      };
      if (collection === 'users' && userMapping.has(row._id)) {
        const verified = userMapping.get(row._id);
        const created = epoch(row.created_at ?? row.createdAt);
        const validIdentity =
          typeof row._openid === 'string' &&
          row._openid.length > 0 &&
          fingerprint(row._openid) === verified.openid_sha256 &&
          identities.get(row._openid)?.length === 1 &&
          (!row.openid || row.openid === row._openid);
        if (!validIdentity || created === null) {
          blockers.push({
            collection,
            record_id: row._id,
            reason: 'VERIFIED_USER_IDENTITY_OR_DATE_MISMATCH',
          });
        } else {
          const display =
            typeof row.nickName === 'string' ? [...row.nickName.trim()].slice(0, 80).join('') : '';
          const fields = {
            user_code: fingerprint([mapping.env_id, row._id]).slice(0, 24),
            display_name: display || '微信用户',
            avatar_file_id: null,
            account_status: verified.account_status,
            auth_version: 1,
            operation_seq: 0,
            grant_ids: [],
            application_ids: [],
            created_at: created,
            migration_version: 2,
          };
          if (Object.keys(fields).some((key) => Object.hasOwn(row, key)))
            blockers.push({
              collection,
              record_id: row._id,
              reason: 'V2_FIELD_COLLISION_REQUIRES_REVIEW',
            });
          else {
            entry.additions = fields;
            entry.identity = {
              _id: `wx_${fingerprint(row._openid).slice(0, 40)}`,
              user_id: row._id,
            };
            entry.disposition = 'normalized_base_account';
            entry.reason = 'VERIFIED_MAPPING_NO_GRANTS';
          }
        }
      }
      // Existing v2 business data needs a dedicated reviewed upgrade, rather than
      // being swept into a legacy quarantine or overwritten by this first migration.
      if (
        row.migration_version === 2 ||
        (collection === 'demands' &&
          (row.public_listing === true || row.visibility === 'public' || row.owner_id)) ||
        (['policy', 'policies'].includes(collection) && row.status === 'published') ||
        (collection === 'users' && (row.grant_ids || row.account_status))
      )
        blockers.push({
          collection,
          record_id: row._id,
          reason: 'EXISTING_V2_OR_PUBLIC_RECORD_REQUIRES_REVIEW',
        });
      if (
        [
          'system_guards',
          'role_grants',
          'wechat_identities',
          'migration_runs',
          'migration_checkpoints',
          'migration_quarantine',
        ].includes(collection)
      )
        blockers.push({
          collection,
          record_id: row._id,
          reason: 'EXISTING_SECURITY_STATE_REQUIRES_REVIEW',
        });
      entries.push(entry);
    }
  }
  for (const id of userMapping.keys())
    if (!(snapshot.users ?? []).some((row) => row._id === id))
      blockers.push({ collection: 'users', record_id: id, reason: 'VERIFIED_USER_NOT_IN_BACKUP' });
  const body = {
    version: 2,
    env_id: mapping.env_id,
    source_sha256: sourceSha256,
    mapping,
    mapping_hash: fingerprint(mapping),
    verified_by: mapping.verified_by,
    verification_reference: mapping.verification_reference,
    entries,
    blockers,
  };
  return { ...body, plan_id: fingerprint(body) };
}

function validatePlan(plan, snapshot) {
  const { plan_id: planId, ...body } = plan;
  requireThat(
    plan.version === 2 && planId === fingerprint(body) && !plan.blockers.length,
    'Migration plan is blocked or modified',
  );
  requireThat(
    fingerprint(planV2Migration(snapshot, plan.mapping, plan.source_sha256)) === fingerprint(plan),
    'Migration plan differs from the verified mapping',
  );
  for (const entry of plan.entries) {
    const row = snapshot[entry.collection]?.find((row) => row._id === entry.record_id);
    requireThat(
      row && fingerprint(row) === entry.before_hash,
      'Plan does not match backup records',
    );
  }
  requireThat(
    plan.entries.length === Object.values(snapshot).reduce((sum, rows) => sum + rows.length, 0),
    'Plan omits backup records',
  );
}
export const journalId = (plan, entry) =>
  fingerprint([plan.plan_id, entry.collection, entry.record_id]);

export async function applyMigrationBatch(
  store,
  plan,
  snapshot,
  codec,
  proof,
  limit = 20,
  now = Date.now(),
) {
  validatePlan(plan, snapshot);
  requireThat(Number.isInteger(limit) && limit >= 1 && limit <= 50, 'Batch size must be 1 to 50');
  requireThat(
    proof?.source_sha256 === plan.source_sha256 &&
      proof.env_id === plan.env_id &&
      proof.backup_complete === true &&
      proof.live_restore_verified === true &&
      proof.permissions_verified === true &&
      proof.storage_recovery_verified === true,
    'Verified complete backup, live isolated recovery and permission evidence are required',
  );
  requireThat(
    typeof store.withFinalizationFence === 'function',
    'Database-enforced write fence is not configured; migration cannot start safely',
  );
  return store.withFinalizationFence(async () => {
    const rows = new Map(
      plan.entries.map((entry) => [
        journalId(plan, entry),
        snapshot[entry.collection].find((row) => row._id === entry.record_id),
      ]),
    );
    await store.transaction(async (tx) => {
      const gate = await tx.get('system_guards', 'v2_migration');
      requireThat(
        !gate || (gate.status === 'applying' && gate.plan_id === plan.plan_id),
        'Another or completed migration owns the gate',
      );
      const run = await tx.get('migration_runs', plan.plan_id);
      requireThat(Boolean(run) === Boolean(gate), 'Migration gate and journal are inconsistent');
      if (run)
        requireThat(
          run.plan_id === plan.plan_id &&
            run.source_sha256 === plan.source_sha256 &&
            run.total === plan.entries.length &&
            Number.isSafeInteger(run.applied) &&
            run.applied >= 0 &&
            run.applied <= run.total,
          'Migration run is inconsistent',
        );
      if (!run)
        await tx.put('migration_runs', {
          _id: plan.plan_id,
          plan_id: plan.plan_id,
          source_sha256: plan.source_sha256,
          total: plan.entries.length,
          applied: 0,
          created_at: now,
        });
      if (!gate)
        await tx.put('system_guards', {
          _id: 'v2_migration',
          schema_version: 2,
          status: 'applying',
          plan_id: plan.plan_id,
          source_sha256: plan.source_sha256,
          created_at: now,
        });
    });
    let applied = 0,
      skipped = 0;
    for (const entry of plan.entries) {
      if (applied >= limit) break;
      const id = journalId(plan, entry);
      const payload = codec.seal(rows.get(id)); // a retry may reuse an already committed journal
      const changed = await store.transaction(async (tx) => {
        const gate = await tx.get('system_guards', 'v2_migration');
        requireThat(
          gate?.status === 'applying' && gate.plan_id === plan.plan_id,
          'Migration gate changed',
        );
        const old = await tx.get('migration_checkpoints', id);
        if (old) {
          requireThat(
            old.before_hash === entry.before_hash && old.plan_id === plan.plan_id,
            'Migration checkpoint conflict',
          );
          return false;
        }
        const current = await tx.get(entry.collection, entry.record_id);
        requireThat(
          current && fingerprint(current) === entry.before_hash,
          'Source record changed since backup',
        );
        if (entry.identity) {
          const identity = await tx.get('wechat_identities', entry.identity._id);
          requireThat(!identity, 'Identity mapping already exists; review before migration');
          requireThat(
            Object.keys(entry.additions).every((key) => !Object.hasOwn(current, key)),
            'Refusing to overwrite historic fields',
          );
          await tx.addFields(entry.collection, entry.record_id, entry.additions);
          await tx.put('wechat_identities', entry.identity);
        }
        requireThat(
          !(await tx.get('migration_quarantine', id)),
          'Quarantine journal already exists without checkpoint',
        );
        await tx.put('migration_quarantine', {
          _id: id,
          plan_id: plan.plan_id,
          source_collection: entry.collection,
          source_id: entry.record_id,
          source_hash: entry.before_hash,
          source_ciphertext: payload,
          disposition: entry.disposition,
          reason: entry.reason,
          created_at: now,
        });
        await tx.put('migration_checkpoints', {
          _id: id,
          plan_id: plan.plan_id,
          before_hash: entry.before_hash,
          after_hash: fingerprint({ ...current, ...storedAdditions(entry.additions) }),
          created_at: now,
        });
        const run = await tx.get('migration_runs', plan.plan_id);
        requireThat(run?.total === plan.entries.length, 'Migration run is inconsistent');
        run.applied += 1;
        await tx.put('migration_runs', run);
        return true;
      });
      if (changed) applied++;
      else skipped++;
    }
    return { applied, skipped, total: plan.entries.length, status: 'applying' };
  });
}

// The caller must re-run live recovery and permission probes before finalization.
// No batch can write verified, and a hand-written count is insufficient.
export async function reconcileMigration(store, plan, snapshot, codec, proof, now = Date.now()) {
  validatePlan(plan, snapshot);
  requireThat(
    proof?.source_sha256 === plan.source_sha256 &&
      proof.env_id === plan.env_id &&
      proof.backup_complete === true &&
      proof.live_restore_verified === true &&
      proof.permissions_verified === true &&
      proof.storage_recovery_verified === true,
    'Migration prerequisites must be reverified',
  );
  requireThat(
    typeof store.withFinalizationFence === 'function',
    'Database-enforced write fence is not configured; final verification is blocked',
  );
  return store.withFinalizationFence(async () => {
    for (const collection of Object.keys(snapshot)) {
      let actual = await store.scan(collection);
      const expected = plan.entries
        .filter((entry) => entry.collection === collection)
        .map((entry) => ({
          ...snapshot[collection].find((row) => row._id === entry.record_id),
          ...storedAdditions(entry.additions),
        }));
      if (collection === 'system_guards')
        actual = actual.filter(
          (row) =>
            !(
              ['v2_migration', 'v2_migration_fence'].includes(row._id) &&
              row.plan_id === plan.plan_id
            ),
        );
      if (['migration_runs', 'migration_checkpoints', 'migration_quarantine'].includes(collection))
        actual = actual.filter((row) => row.plan_id !== plan.plan_id);
      if (collection === 'wechat_identities')
        expected.push(
          ...plan.entries.filter((entry) => entry.identity).map((entry) => entry.identity),
        );
      const sort = (rows) => [...rows].sort((a, b) => (a._id < b._id ? -1 : a._id > b._id ? 1 : 0));
      requireThat(
        fingerprint(sort(actual)) === fingerprint(sort(expected)),
        'Collection reconciliation failed',
      );
    }
    for (const entry of plan.entries) {
      const id = journalId(plan, entry),
        receipt = await store.get('migration_checkpoints', id);
      const archive = await store.get('migration_quarantine', id);
      requireThat(
        receipt?.plan_id === plan.plan_id &&
          receipt.before_hash === entry.before_hash &&
          archive?.plan_id === plan.plan_id &&
          archive.source_hash === entry.before_hash &&
          fingerprint(codec.open(archive.source_ciphertext)) === entry.before_hash,
        'Checkpoint or encrypted recovery record failed verification',
      );
      const current = await store.get(entry.collection, entry.record_id);
      requireThat(
        fingerprint(current) === receipt.after_hash,
        'Migrated record changed before verification',
      );
      if (entry.identity)
        requireThat(
          fingerprint(await store.get('wechat_identities', entry.identity._id)) ===
            fingerprint(entry.identity),
          'Migrated identity reconciliation failed',
        );
    }
    await store.assertFinalizationFence?.();
    return store.transaction(async (tx) => {
      const gate = await tx.get('system_guards', 'v2_migration'),
        run = await tx.get('migration_runs', plan.plan_id);
      if (
        gate?.status === 'verified' &&
        gate.plan_id === plan.plan_id &&
        run?.status === 'verified'
      )
        return { status: 'verified', records: plan.entries.length };
      requireThat(
        gate?.status === 'applying' &&
          gate.plan_id === plan.plan_id &&
          run?.applied === plan.entries.length &&
          run.total === plan.entries.length,
        'Migration is not complete',
      );
      await tx.put('system_guards', {
        ...gate,
        status: 'verified',
        verified_at: now,
        verified_by: plan.verified_by,
        verification_reference: plan.verification_reference,
      });
      await tx.put('migration_runs', { ...run, status: 'verified', verified_at: now });
      return { status: 'verified', records: plan.entries.length };
    });
  });
}
