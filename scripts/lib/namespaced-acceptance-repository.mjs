import { createHash } from 'node:crypto';

const collections = new Set([
  'system_guards',
  'users',
  'wechat_identities',
  'role_grants',
  'regions',
  'demands',
  'demand_submissions',
  'demand_events',
  'demand_claims',
  'demand_progress',
  'demand_completions',
  'demand_private',
  'claim_participants',
  'idempotency_keys',
  'audit_logs',
  'outbox_events',
  'rate_limit_buckets',
  'content_checks',
  'teams',
  'team_invitations',
  'team_assignment_counters',
  'team_members',
  'invitation_locks',
  'job_runs',
  'event_receipts',
  'notifications',
  'notification_counters',
  'retention_guards',
]);

/**
 * Real transactions over opaque, per-run payloads stored only in job_runs.
 * No synthetic documents enter business collections or their broad scans.
 * Business collection indexes are not exercised by this isolated harness.
 * Inventory is local to one probe process; this is not a production repository.
 */
export function namespacedAcceptanceRepository(base, scope, expiresAt, maxRows = 2500) {
  if (
    !/^acceptance:[a-f0-9-]{36}$/u.test(scope) ||
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= Date.now() ||
    expiresAt - Date.now() > 30 * 60000 ||
    !Number.isInteger(maxRows) ||
    maxRows < 1 ||
    maxRows > 2500
  )
    throw new Error('Invalid bounded synthetic namespace');
  const inventory = new Map();
  const physical = (collection, id) => {
    if (!collections.has(collection) || typeof id !== 'string' || !id || Date.now() >= expiresAt)
      throw new Error('Synthetic probe outside scope');
    return createHash('sha256')
      .update(JSON.stringify([scope, collection, id]))
      .digest('hex');
  };
  const unwrap = (row, collection, id) => {
    if (!row) return null;
    if (
      row.acceptance_namespace !== scope ||
      row.logical_collection !== collection ||
      row.payload?._id !== id
    )
      throw new Error('Namespace collision');
    return structuredClone(row.payload);
  };
  const adapter = (tx) => ({
    async get(collection, id) {
      return unwrap(await tx.get('job_runs', physical(collection, id)), collection, id);
    },
    async put(collection, entity) {
      const key = physical(collection, entity._id);
      const previous = await tx.get('job_runs', key);
      if (previous && previous.acceptance_namespace !== scope)
        throw new Error('Refusing overwrite outside namespace');
      const item = JSON.stringify([collection, entity._id]);
      if (!inventory.has(item) && inventory.size >= maxRows)
        throw new Error('Synthetic row budget exceeded');
      inventory.set(item, { collection, id: entity._id });
      await tx.put('job_runs', {
        _id: key,
        acceptance_namespace: scope,
        logical_collection: collection,
        payload: structuredClone(entity),
      });
    },
    async remove() {
      throw new Error('Synthetic probe never deletes');
    },
  });
  const repo = {
    ...adapter(base),
    put: (collection, entity) => base.transaction((tx) => adapter(tx).put(collection, entity)),
    transaction: (work) => base.transaction((tx) => work(adapter(tx))),
    async find(collection, filter, limit, options = {}) {
      physical(collection, 'query');
      if (!Number.isInteger(limit) || limit < 1 || limit > 1001)
        throw new Error('Unbounded synthetic query');
      const rows = [];
      // Enumerate only this process's own known IDs; never query live collections.
      for (const entry of inventory.values()) {
        if (entry.collection !== collection) continue;
        const row = await repo.get(collection, entry.id);
        if (row && Object.entries(filter).every(([key, value]) => row[key] === value))
          rows.push(row);
      }
      rows.sort((a, b) =>
        options.newest
          ? (b.created_at ?? 0) - (a.created_at ?? 0) || b._id.localeCompare(a._id)
          : a._id.localeCompare(b._id),
      );
      const after = options.after;
      return rows
        .filter(
          (r) =>
            !after ||
            r.created_at < after.created_at ||
            (r.created_at === after.created_at && r._id < after.id),
        )
        .slice(0, limit);
    },
  };
  return { repo, inventory };
}
