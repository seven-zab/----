import type { Entity, Repository } from '../../core/repository';
import { assertAccount } from '../../core/policy';
import { resolveUser, runCommand } from '../../core/command';
import { requestData, type CallRequest } from '../../core/request';
import { ensure } from '../../core/errors';
import { decodeCursor, encodeCursor } from '../../core/pagination';
import { hash } from '../../core/hash';
import { subscriptionTemplates } from '../../adapters/subscription';
interface Notification extends Entity {
  user_id: string;
  event_type: string;
  resource_id: string;
  unread: boolean;
  created_at: number;
}
interface Counter extends Entity {
  count: number;
}
export function createNotificationService(repo: Repository) {
  async function write(openid: string, request: CallRequest, now: number) {
    return runCommand(
      repo,
      openid,
      'notificationService',
      request,
      async (ctx) => {
        if (request.action === 'recordSubscription') {
          const data = requestData('notificationService.recordSubscription', request);
          ensure(
            subscriptionTemplates(process.env.NOTIFICATION_TEMPLATES).some(
              (t) => t.key === data.template_key,
            ),
            'VALIDATION_FAILED',
            '订阅模板未配置',
            400,
          );
          const record_id = hash([ctx.user._id, data.client_request_id, data.template_key]);
          const previous = await ctx.tx.get<Entity & { result: string }>(
            'subscription_records',
            record_id,
          );
          ensure(
            !previous || previous.result === data.result,
            'IDEMPOTENCY_CONFLICT',
            '授权记录与原结果不一致',
            409,
          );
          if (!previous)
            await ctx.tx.put('subscription_records', {
              _id: record_id,
              user_id: ctx.user._id,
              template_key: data.template_key,
              result: data.result,
              created_at: now,
              // Client report is not a trusted send permission or delivery receipt.
              source: 'client_report_only',
            });
          return { record_id };
        }
        ensure(request.action === 'markRead', 'UNKNOWN_ACTION', '未知通知动作', 400);
        const data = requestData('notificationService.markRead', request);
        const rows: Notification[] = [];
        for (const id of data.notification_ids) {
          const row = await ctx.tx.get<Notification>('notifications', id);
          ensure(row?.user_id === ctx.user._id, 'NOT_FOUND', '通知不存在', 404);
          rows.push(row);
        }
        const unread = rows.filter((row) => row.unread);
        for (const row of unread)
          await ctx.tx.put('notifications', { ...row, unread: false, read_at: now });
        const counter = await ctx.tx.get<Counter>('notification_counters', ctx.user._id);
        ensure((counter?.count ?? 0) >= unread.length, 'STATE_CONFLICT', '通知计数需对账', 409);
        await ctx.tx.put('notification_counters', {
          _id: ctx.user._id,
          count: (counter?.count ?? 0) - unread.length,
        });
        return { updated_count: unread.length };
      },
      now,
    );
  }
  async function read(openid: string, request: CallRequest) {
    const user = await repo.transaction(async (tx) => {
      const u = await resolveUser(tx, openid);
      ensure(u, 'USER_NOT_INITIALIZED', '请先登录', 401);
      assertAccount(u);
      return u;
    });
    if (request.action === 'unreadCount')
      return { count: (await repo.get<Counter>('notification_counters', user._id))?.count ?? 0 };
    if (request.action === 'getSubscriptionOptions')
      return subscriptionTemplates(process.env.NOTIFICATION_TEMPLATES).map((t) => ({
        template_key: t.key,
        template_id: t.template_id,
      }));
    ensure(request.action === 'listMine', 'UNKNOWN_ACTION', '未知通知动作', 400);
    const data = requestData('notificationService.listMine', request);
    const scope = { user: user._id, unread: data.unread_only === true };
    const size = data.page_size ?? 20;
    const rows = await repo.find<Notification>(
      'notifications',
      { user_id: user._id, ...(data.unread_only ? { unread: true } : {}) },
      size + 1,
      { after: decodeCursor(data.cursor, scope), newest: true },
    );
    await repo.transaction(async (tx) => {
      const current = await tx.get<import('../../core/entities').User>('users', user._id);
      ensure(current, 'USER_NOT_INITIALIZED', '请先登录', 401);
      assertAccount(current);
    });
    const items = rows.slice(0, size);
    const has_more = rows.length > size;
    return {
      items: items.map((n) => ({
        notification_id: n._id,
        event_type: n.event_type,
        resource_id: n.resource_id,
        unread: n.unread,
        created_at: n.created_at,
      })),
      has_more,
      next_cursor: has_more ? encodeCursor(items[items.length - 1], scope) : null,
    };
  }
  return { read, write };
}
