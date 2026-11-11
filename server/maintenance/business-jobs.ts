import { randomUUID } from 'node:crypto';
import type { Entity, Repository, Transaction } from '../core/repository';
import type { Demand, Claim } from '../modules/demand/service';
import { adjustAssignments } from '../modules/team/service';
import { hash } from '../core/hash';
import { ensure } from '../core/errors';
import type { Grant, User } from '../core/entities';
import { inScope } from '../core/policy';

interface Lease extends Entity {
  token: string;
  lease_until: number;
  cursor: { created_at: number; id: string } | null;
}
interface Outbox extends Entity {
  type: string;
  aggregate_id: string;
  recipient_ids?: string[];
  status: 'pending' | 'processed' | 'dead';
  attempts: number;
  next_retry_at: number;
  created_at: number;
}
async function notify(tx: Transaction, event: Outbox, now: number) {
  ensure(
    !event.recipient_ids || event.recipient_ids.length <= 50,
    'VALIDATION_FAILED',
    '通知收件人超出限制',
    400,
  );
  for (const recipient of new Set(event.recipient_ids ?? [])) {
    const id = hash(['notification', event._id, recipient]);
    if (await tx.get('event_receipts', id)) continue;
    // No contact details, raw forms or caller-supplied notification text.
    await tx.put('notifications', {
      _id: id,
      user_id: recipient,
      event_type: event.type,
      resource_id: event.aggregate_id,
      unread: true,
      created_at: now,
    });
    const counter = await tx.get<Entity & { count: number }>('notification_counters', recipient);
    await tx.put('notification_counters', { _id: recipient, count: (counter?.count ?? 0) + 1 });
    await tx.put('event_receipts', {
      _id: id,
      consumer: 'in_app_notification',
      event_id: event._id,
      created_at: now,
    });
  }
}

// Maintenance API only. Never selected by a client action, event.internal flag,
// or a public cloud function. The operator runs it with scoped test credentials.
export const businessJobKinds = ['claims', 'demands', 'completions', 'outbox'] as const;
export type BusinessJobKind = (typeof businessJobKinds)[number];
export async function runBusinessJobs(
  repo: Repository,
  now: number,
  pageSize = 50,
  kinds: readonly BusinessJobKind[] = businessJobKinds,
) {
  const startedAt = Date.now();
  ensure(
    Number.isInteger(pageSize) && pageSize >= 1 && pageSize <= 100,
    'VALIDATION_FAILED',
    '作业批量范围为1至100',
    400,
  );
  ensure(
    kinds.every((kind) => businessJobKinds.includes(kind)) && new Set(kinds).size === kinds.length,
    'VALIDATION_FAILED',
    '业务作业分项无效或重复',
    400,
  );
  const counts = {
    expired_claims: 0,
    expired_demands: 0,
    completion_reminders: 0,
    delivered_events: 0,
    dead_events: 0,
    busy_jobs: 0,
  };
  for (const kind of kinds) {
    const token = randomUUID();
    const lease = await repo.transaction(async (tx) => {
      const old = await tx.get<Lease>('job_runs', kind);
      if (old && old.lease_until > now) return null;
      const current: Lease = {
        _id: kind,
        token,
        lease_until: now + 120000,
        cursor: old?.cursor ?? null,
      };
      await tx.put('job_runs', current);
      return current;
    });
    if (!lease) {
      counts.busy_jobs++;
      continue;
    }
    const collection =
      kind === 'claims'
        ? 'demand_claims'
        : kind === 'demands'
        ? 'demands'
        : kind === 'completions'
        ? 'demand_completions'
        : 'outbox_events';
    const rows = await repo.find<Entity & { created_at: number }>(
      collection,
      { status: kind === 'demands' ? 'pending_claim' : 'pending' },
      pageSize,
      { after: lease.cursor ?? undefined, newest: true },
    );
    for (const row of rows) {
      const managerCandidates: Grant[] = [];
      if (kind === 'completions') {
        const completion = await repo.get<Entity & { demand_id: string }>(
          'demand_completions',
          row._id,
        );
        const demand = completion ? await repo.get<Demand>('demands', completion.demand_id) : null;
        if (demand) {
          const filters = [
            { role: 'super_admin', status: 'active' },
            ...(demand.business_scene === 'village'
              ? [
                  ...new Set(
                    [demand.region_id, ...(demand.region_path_ids ?? [])].filter(
                      (id): id is string => typeof id === 'string',
                    ),
                  ),
                ].map((id) => ({ role: 'local_admin', status: 'active', scope_region_id: id }))
              : []),
          ];
          for (const filter of filters) {
            const grants = await repo.find<Grant>('role_grants', filter, 51);
            ensure(grants.length <= 50, 'RATE_LIMITED', '提醒管理者数量超过事务上限', 429);
            managerCandidates.push(...grants);
          }
        }
      }
      const result = await repo.transaction(async (tx) => {
        const guard = await tx.get<Lease>('job_runs', kind);
        ensure(
          guard?.token === token && guard.lease_until > now + Date.now() - startedAt,
          'STATE_CONFLICT',
          '作业租约已失效',
          409,
        );
        let outcome = '';
        if (kind === 'claims') {
          const claim = await tx.get<Claim>('demand_claims', row._id);
          const d = claim ? await tx.get<Demand>('demands', claim.demand_id) : null;
          if (
            claim?.status === 'pending' &&
            claim.expires_at <= now &&
            d?.status === 'claiming' &&
            d.active_claim_id === claim._id
          ) {
            claim.status = 'expired';
            if (claim.assignee_type === 'team')
              await adjustAssignments(
                tx,
                claim.assignee_id,
                claim.participant_grants.map((p) => p.user_id),
                -1,
              );
            d.status = (d.expires_at ?? 0) > now ? 'pending_claim' : 'expired';
            d.active_claim_id = null;
            d.responsible_user_id = null;
            d.participant_user_ids = [];
            d.version++;
            d.updated_at = now;
            if (d.status === 'expired') d.ended_at = now;
            d.public_listing =
              d.visibility === 'public' && d.approved_at !== null && d.status === 'pending_claim';
            await tx.put('demand_claims', claim);
            await tx.put('demands', d);
            const id = hash(['claim_expired', claim._id]);
            await tx.put('demand_events', {
              _id: id,
              demand_id: d._id,
              sequence: `${String(d.version).padStart(10, '0')}:0001`,
              type: 'claim_expired',
              from_status: 'claiming',
              to_status: d.status,
              visibility: 'participants',
              actor_user_id: null,
              actor_grant_id: null,
              occurred_at: now,
              created_at: now,
              payload: {},
            });
            await tx.put<Outbox>('outbox_events', {
              _id: id,
              type: 'claim_expired',
              aggregate_id: d._id,
              recipient_ids: [d.owner_id, claim.responsible_user_id],
              status: 'pending',
              attempts: 0,
              next_retry_at: now,
              created_at: now,
            });
            outcome = 'expired_claims';
          }
        } else if (kind === 'demands') {
          const d = await tx.get<Demand>('demands', row._id);
          if (
            d?.status === 'pending_claim' &&
            d.expires_at !== null &&
            d.expires_at <= now &&
            !d.active_claim_id
          ) {
            d.status = 'expired';
            d.public_listing = false;
            d.ended_at = now;
            d.updated_at = now;
            d.version++;
            await tx.put('demands', d);
            const id = hash(['demand_expired', d._id]);
            await tx.put('demand_events', {
              _id: id,
              demand_id: d._id,
              sequence: `${String(d.version).padStart(10, '0')}:0001`,
              type: 'demand_expired',
              from_status: 'pending_claim',
              to_status: 'expired',
              visibility: 'participants',
              actor_user_id: null,
              actor_grant_id: null,
              occurred_at: now,
              created_at: now,
              payload: {},
            });
            await tx.put<Outbox>('outbox_events', {
              _id: id,
              type: 'demand_expired',
              aggregate_id: d._id,
              recipient_ids: [d.owner_id],
              status: 'pending',
              attempts: 0,
              next_retry_at: now,
              created_at: now,
            });
            outcome = 'expired_demands';
          }
        } else if (kind === 'completions') {
          const completion = await tx.get<
            Entity & { demand_id: string; status: string; created_at: number }
          >('demand_completions', row._id);
          const d = completion ? await tx.get<Demand>('demands', completion.demand_id) : null;
          const receiptId = hash(['completion_7d', row._id]);
          if (
            completion?.status === 'pending' &&
            completion.created_at + 7 * 86400000 <= now &&
            d?.status === 'pending_review' &&
            d.active_completion_id === completion._id &&
            !(await tx.get('event_receipts', receiptId))
          ) {
            const recipients = new Set([d.owner_id]);
            for (const candidate of managerCandidates) {
              const g = await tx.get<Grant>('role_grants', candidate._id);
              const user = g ? await tx.get<User>('users', g.user_id) : null;
              if (
                g &&
                user?.account_status === 'active' &&
                g.status === 'active' &&
                g.revoked_at === null &&
                (g.expires_at === null || g.expires_at > now) &&
                ['super_admin', 'local_admin'].includes(g.role) &&
                inScope(g, d) &&
                (d.business_scene !== 'campus' || g.role === 'super_admin')
              )
                recipients.add(user._id);
            }
            ensure(recipients.size <= 50, 'RATE_LIMITED', '提醒收件人超过事务上限', 429);
            await tx.put<Outbox>('outbox_events', {
              _id: receiptId,
              type: 'completion_reminder',
              aggregate_id: d._id,
              recipient_ids: [...recipients],
              status: 'pending',
              attempts: 0,
              next_retry_at: now,
              created_at: now,
            });
            await tx.put('event_receipts', {
              _id: receiptId,
              consumer: 'completion_7d',
              created_at: now,
            });
            outcome = 'completion_reminders';
          }
        } else {
          const event = await tx.get<Outbox>('outbox_events', row._id);
          // Storage deletion has its own external side effect and receipt. The in-app
          // notification consumer must never acknowledge it as a delivered notification.
          if (
            event?.status === 'pending' &&
            event.next_retry_at <= now &&
            event.type !== 'file.delete'
          ) {
            // Validate before any writes so a malformed event cannot partly deliver.
            if (
              event.recipient_ids &&
              (!Array.isArray(event.recipient_ids) ||
                event.recipient_ids.length > 50 ||
                event.recipient_ids.some((id) => typeof id !== 'string' || !id))
            ) {
              event.attempts++;
              event.status = event.attempts >= 10 ? 'dead' : 'pending';
              event.next_retry_at = now + Math.min(3600000, 1000 * 2 ** event.attempts);
              if (event.status === 'dead') outcome = 'dead_events';
            } else {
              await notify(tx, event, now);
              event.status = 'processed';
              outcome = 'delivered_events';
            }
            await tx.put('outbox_events', event);
          }
        }
        guard.cursor = { created_at: row.created_at, id: row._id };
        await tx.put('job_runs', guard);
        return outcome;
      });
      if (result)
        counts[
          result as
            | 'expired_claims'
            | 'expired_demands'
            | 'completion_reminders'
            | 'delivered_events'
            | 'dead_events'
        ]++;
    }
    await repo.transaction(async (tx) => {
      const guard = await tx.get<Lease>('job_runs', kind);
      if (guard?.token !== token) return;
      if (rows.length < pageSize) guard.cursor = null;
      guard.lease_until = now;
      await tx.put('job_runs', guard);
    });
  }
  return counts;
}
