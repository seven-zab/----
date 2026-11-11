import { randomUUID } from 'node:crypto';
import { epoch } from '../../database/migrations/002-review-legacy.mjs';
import { MigrationSafetyError } from './v2-engine.mjs';
const id = 'v2_migration_fence';
const check = (condition, message) => {
  if (!condition) throw new MigrationSafetyError(message);
};

// All application writers must first be retired, denied at the client rules,
// or use the shared v2 migration-gate transaction protocol. Management owners
// remain trusted operators; this is not an attempt to revoke an account owner.
export function withMigrationWriteFence(
  base,
  { planId, verifyControl, now = Date.now, leaseMs = 300000 },
) {
  check(
    typeof verifyControl === 'function' &&
      typeof planId === 'string' &&
      Number.isSafeInteger(leaseMs) &&
      leaseMs >= 30000 &&
      leaseMs <= 900000,
    'Invalid live migration fence',
  );
  let token = null,
    controlHash = null;
  const store = {
    ...base,
    async transaction(work) {
      check(token, 'Migration transaction requires an acquired write fence');
      return base.transaction(async (tx) => {
        const guard = await tx.get('system_guards', id);
        check(
          guard?.status === 'held' &&
            guard.owner_token === token &&
            guard.plan_id === planId &&
            epoch(guard.expires_at) > now(),
          'Migration write fence expired or ownership changed',
        );
        check(
          Number.isSafeInteger(guard.operation_seq) &&
            guard.operation_seq >= 0 &&
            guard.operation_seq < Number.MAX_SAFE_INTEGER,
          'Invalid migration fence sequence',
        );
        const result = await work(tx);
        check(epoch(guard.expires_at) > now(), 'Migration write fence expired before commit');
        await tx.put('system_guards', {
          ...guard,
          operation_seq: guard.operation_seq + 1,
          expires_at: now() + leaseMs,
        });
        return result;
      });
    },
    async assertFinalizationFence() {
      await store.transaction(async () => {}); // renew before the control-plane probes
      check(
        (await verifyControl()) === controlHash,
        'Application writer controls changed during reconciliation',
      );
    },
    async withFinalizationFence(work) {
      check(!token, 'Nested or concurrent migration fence use is forbidden');
      const observed = await verifyControl();
      check(
        typeof observed === 'string' && /^[a-f0-9]{64}$/u.test(observed),
        'Missing live application-writer evidence',
      );
      const owned = randomUUID();
      await base.transaction(async (tx) => {
        const gate = await tx.get('system_guards', 'v2_migration');
        check(
          !gate ||
            (gate.schema_version === 2 && gate.status === 'applying' && gate.plan_id === planId),
          'Migration gate is not closed for this plan',
        );
        const previous = await tx.get('system_guards', id);
        check(
          !previous || (previous.schema_version === 2 && previous.plan_id === planId),
          'Another plan owns the write fence',
        );
        check(
          !previous || previous.status === 'released' || epoch(previous.expires_at) <= now(),
          'Another migration process holds the write fence',
        );
        await tx.put('system_guards', {
          _id: id,
          schema_version: 2,
          plan_id: planId,
          status: 'held',
          owner_token: owned,
          control_hash: observed,
          operation_seq: 0,
          expires_at: now() + leaseMs,
        });
      });
      token = owned;
      controlHash = observed;
      try {
        return await work();
      } finally {
        await base.transaction(async (tx) => {
          const guard = await tx.get('system_guards', id);
          if (guard?.owner_token === owned)
            await tx.put('system_guards', { ...guard, status: 'released', released_at: now() });
        });
        token = null;
        controlHash = null;
      }
    },
  };
  return store;
}
