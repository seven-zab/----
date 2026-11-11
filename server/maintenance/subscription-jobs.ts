import { randomUUID } from 'node:crypto';
import type { Entity, Repository } from '../core/repository';
import type { Grant, User } from '../core/entities';
import { hash } from '../core/hash';
import { inScope } from '../core/policy';
import type { Demand } from '../modules/demand/service';
import type { SubscriptionSender, SubscriptionTemplate } from '../adapters/subscription';
import { scanBatch } from './scan';
interface Notice extends Entity {
  user_id: string;
  resource_id: string;
  event_type: string;
  created_at: number;
}
interface Delivery extends Entity {
  status: 'sending' | 'sent' | 'rejected' | 'unknown' | 'skipped' | 'retry_wait';
  attempts?: number;
  next_retry_at?: number;
  lease_until: number;
  token: string;
  code: string | null;
  created_at: number;
}
export async function runSubscriptionJobs(
  repo: Repository,
  sender: SubscriptionSender,
  templates: SubscriptionTemplate[],
  now: number,
  pageSize = 20,
) {
  const counts = { sent: 0, unknown: 0, skipped: 0, rejected: 0, retry_scheduled: 0 };
  if (!templates.length) return { ...counts, configured: false };
  await scanBatch<Notice>(
    repo,
    'subscription-notifications',
    'notifications',
    {},
    now,
    pageSize,
    async (n) => {
      const template = templates.find((t) => t.event_types.includes(n.event_type));
      if (!template) return;
      const started = Date.now();
      const clock = () => now + Date.now() - started;
      const id = hash(['subscription', n._id, template.key]),
        token = randomUUID();
      const selected = await repo.transaction(async (tx) => {
        const old = await tx.get<Delivery>('subscription_deliveries', id);
        if (old && old.status !== 'retry_wait') {
          if (old.status === 'sending' && old.lease_until <= now) {
            old.status = 'unknown';
            old.code = 'WORKER_LEASE_EXPIRED';
            old.lease_until = 0;
            await tx.put('subscription_deliveries', old);
            counts.unknown++;
          }
          return null;
        }
        if (old && ((old.next_retry_at ?? 0) > now || (old.attempts ?? 1) >= 3)) return null;
        const u = await tx.get<User>('users', n.user_id),
          d = await tx.get<Demand>('demands', n.resource_id);
        let allowed = Boolean(
          u?.account_status === 'active' &&
            d &&
            (d.owner_id === u?._id ||
              d.responsible_user_id === u?._id ||
              d.participant_user_ids?.includes(u?._id ?? '')),
        );
        if (u?.account_status === 'active' && d && !allowed)
          for (const grantId of u.grant_ids) {
            const g = await tx.get<Grant>('role_grants', grantId);
            if (
              g &&
              g.user_id === u._id &&
              g.status === 'active' &&
              g.revoked_at === null &&
              (g.expires_at === null || g.expires_at > now) &&
              ['local_admin', 'super_admin'].includes(g.role) &&
              inScope(g, d) &&
              (d.business_scene !== 'campus' || g.role === 'super_admin')
            ) {
              allowed = true;
              break;
            }
          }
        const reports = await repo.find<Entity & { result: string }>(
          'subscription_records',
          { user_id: n.user_id, template_key: template.key, result: 'accept' },
          1,
        );
        // A client report only permits an attempt; the WeChat API remains authoritative.
        if (!reports.length) {
          // Do not permanently consume an event before the user chooses to subscribe.
          counts.skipped++;
          return null;
        }
        const delivery: Delivery = {
          _id: id,
          status: allowed ? 'sending' : 'skipped',
          attempts: (old?.attempts ?? 0) + 1,
          next_retry_at: 0,
          lease_until: now + 120000,
          token,
          code: null,
          created_at: old?.created_at ?? now,
        };
        await tx.put('subscription_deliveries', delivery);
        if (!allowed) {
          counts.skipped++;
          return null;
        }
        return u;
      });
      if (!selected) return;
      const result = await sender
        .send({
          touser: selected._openid,
          template_id: template.template_id,
          page: 'pages/demand-detail/demand-detail?id=' + encodeURIComponent(n.resource_id),
          data: {
            [template.status_field]: {
              value:
                n.event_type === 'acceptance_probe'
                  ? '联调测试通知，请忽略'
                  : n.event_type === 'completion_reminder'
                  ? '成果待验收，请及时处理'
                  : '任务状态已更新',
            },
            [template.time_field]: {
              value: new Date(n.created_at + 8 * 3600000)
                .toISOString()
                .slice(0, 16)
                .replace('T', ' '),
            },
          },
        })
        .catch(() => ({ outcome: 'unknown' as const, code: 'ADAPTER_OUTCOME_UNKNOWN' }));
      const recorded = await repo.transaction(async (tx) => {
        const current = await tx.get<Delivery>('subscription_deliveries', id);
        if (current?.token !== token || current.status !== 'sending') return 'unknown' as const;
        // Only a definite WeChat busy response permits bounded retry. A timeout,
        // exception or expired lease never creates another external send attempt.
        const expired = current.lease_until <= clock();
        const retry =
          !expired &&
          result.outcome === 'rejected' &&
          result.code === '-1' &&
          (current.attempts ?? 1) < 3;
        current.next_retry_at = retry ? clock() + 10000 * 3 ** ((current.attempts ?? 1) - 1) : 0;
        current.status = result.outcome;
        if (retry) current.status = 'retry_wait';
        if (expired) current.status = 'unknown';
        current.code = expired ? 'RESPONSE_AFTER_LEASE_EXPIRED' : result.code;
        current.lease_until = 0;
        await tx.put('subscription_deliveries', current);
        return expired
          ? ('unknown' as const)
          : retry
          ? ('retry_scheduled' as const)
          : result.outcome;
      });
      counts[recorded]++;
    },
  );
  return { ...counts, configured: true };
}
