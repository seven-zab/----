import type { Entity, Repository, Transaction } from '../../core/repository';
import type { Grant } from '../../core/entities';
import { assertCanStartNewAction, assertScene } from '../../core/policy';
import { resolveUser, runCommand, audit } from '../../core/command';
import { ensure } from '../../core/errors';
import { requestData, type CallRequest } from '../../core/request';
import { decodeCursor, encodeCursor } from '../../core/pagination';
import { retentionGuardId } from '../../maintenance/storage-jobs';
import { validHoldCounters } from '../../maintenance/retention-safety';
import type { Demand } from '../demand/service';
import type { StoredFile } from '../file/service';
import type { ContractMap } from '../../../contracts/generated/dto';
type Hold = Entity & Omit<ContractMap['maintenanceService.createHold']['response'], 'hold_id'>;
const dto = (h: Hold) => {
  const { _id, ...rest } = h;
  return { hold_id: _id, ...rest };
};
async function manager(tx: Transaction, openid: string, grantId: string | undefined, now: number) {
  const u = await resolveUser(tx, openid);
  ensure(u, 'USER_NOT_INITIALIZED', '请先登录', 401);
  const g = grantId ? await tx.get<Grant>('role_grants', grantId) : null;
  assertCanStartNewAction(u, g, now);
  ensure(['local_admin', 'super_admin'].includes(g.role), 'FORBIDDEN', '需要有效管理身份');
  return { user: u, grant: g };
}
async function resource(
  tx: Transaction,
  grant: Grant,
  kind: Hold['resource_type'],
  id: string,
  creating = false,
) {
  if (kind === 'demand' || kind === 'conversation') {
    const conversation =
      kind === 'conversation'
        ? await tx.get<Entity & { demand_id: string }>('conversations', id)
        : null;
    const d = await tx.get<Demand>(
      'demands',
      kind === 'demand' ? id : conversation?.demand_id ?? '',
    );
    ensure(d, 'NOT_FOUND', '资源不存在', 404);
    assertScene(grant, d, 'manage');
    return;
  }
  ensure(grant.role === 'super_admin', 'FORBIDDEN', '此类保留仅超级管理员管理');
  const table = {
    file: 'files',
    application: 'role_applications',
    export: 'export_jobs',
    ai_session: 'ai_sessions',
  }[kind];
  ensure(await tx.get(table, id), 'NOT_FOUND', '资源不存在', 404);
  if (kind === 'file' && creating) {
    const f = await tx.get<StoredFile>('files', id);
    ensure(f?.state === 'active', 'STATE_CONFLICT', '文件已进入删除流程，不能承诺继续保留', 409);
  }
}
export function createMaintenanceService(repo: Repository) {
  async function write(openid: string, request: CallRequest, now: number) {
    return runCommand(
      repo,
      openid,
      'maintenanceService',
      request,
      async (ctx) => {
        const { grant } = await manager(ctx.tx, openid, request.grant_id, now);
        if (request.action === 'retryDeadLetter') {
          ensure(grant.role === 'super_admin', 'FORBIDDEN', '死信仅超级管理员可重试');
          const data = requestData('maintenanceService.retryDeadLetter', request),
            table = data.kind === 'outbox' ? 'outbox_events' : 'storage_cleanup_tasks';
          const event = await ctx.tx.get<
            Entity & {
              status: string;
              attempts: number;
              next_retry_at: number;
              manual_review_required?: boolean;
            }
          >(table, data.event_id);
          ensure(event?.status === 'dead', 'STATE_CONFLICT', '仅死信可人工重试', 409);
          ensure(
            !event.manual_review_required,
            'STATE_CONFLICT',
            '文件提交结果不确定，请先由运维核验引用',
            409,
          );
          event.status = 'pending';
          event.attempts = 0;
          event.next_retry_at = now;
          await ctx.tx.put(table, event);
          await audit(ctx, event._id, '人工重试死信：' + data.reason);
          return { queued: true };
        }
        if (request.action === 'createHold') {
          const data = requestData('maintenanceService.createHold', request);
          ensure(
            data.review_at > now && data.review_at <= now + 90 * 86400000,
            'VALIDATION_FAILED',
            '保留必须在90天内复查',
            400,
          );
          await resource(ctx.tx, grant, data.resource_type, data.resource_id, true);
          const id = retentionGuardId(data.resource_type, data.resource_id),
            guard = (await ctx.tx.get<Entity & { active_count: number; operation_seq: number }>(
              'data_hold_guards',
              id,
            )) ?? { _id: id, active_count: 0, operation_seq: 0 };
          ensure(validHoldCounters(guard), 'STATE_CONFLICT', '保留计数需对账，停止新增保留', 409);
          guard.active_count++;
          guard.operation_seq++;
          await ctx.tx.put('data_hold_guards', guard);
          const h: Hold = {
            _id: ctx.command_id,
            ...data,
            created_by: ctx.user._id,
            created_at: now,
            released_at: null,
            version: 1,
          };
          await ctx.tx.put('data_holds', h);
          await audit(ctx, h._id, '设置必要证据保留：' + data.reason);
          return dto(h);
        }
        const data = requestData('maintenanceService.releaseHold', request),
          h = await ctx.tx.get<Hold>('data_holds', data.hold_id);
        ensure(h, 'NOT_FOUND', '保留记录不存在', 404);
        await resource(ctx.tx, grant, h.resource_type, h.resource_id);
        ensure(
          h.version === data.expected_version && h.released_at === null,
          'VERSION_CONFLICT',
          '保留已更新或解除',
          409,
        );
        const id = retentionGuardId(h.resource_type, h.resource_id),
          guard = await ctx.tx.get<Entity & { active_count: number; operation_seq: number }>(
            'data_hold_guards',
            id,
          );
        ensure(
          guard && validHoldCounters(guard) && guard.active_count > 0,
          'STATE_CONFLICT',
          '保留计数需对账',
          409,
        );
        guard.active_count--;
        guard.operation_seq++;
        await ctx.tx.put('data_hold_guards', guard);
        h.released_at = now;
        h.version++;
        await ctx.tx.put('data_holds', h);
        await audit(ctx, h._id, '解除保留：' + data.reason);
        return dto(h);
      },
      now,
    );
  }
  async function read(openid: string, request: CallRequest, now: number) {
    const actor = await repo.transaction((tx) => manager(tx, openid, request.grant_id, now));
    if (request.action === 'listDeadLetters') {
      ensure(actor.grant.role === 'super_admin', 'FORBIDDEN', '死信仅超级管理员可查');
      const data = requestData('maintenanceService.listDeadLetters', request),
        size = data.page_size ?? 20,
        scope = { kind: data.kind };
      const rows = await repo.find<
        Entity & { type?: string; attempts: number; created_at: number }
      >(
        data.kind === 'outbox' ? 'outbox_events' : 'storage_cleanup_tasks',
        { status: 'dead' },
        size + 1,
        { newest: true, after: decodeCursor(data.cursor, scope) },
      );
      const items = rows.slice(0, size);
      return {
        items: items.map((r) => ({
          event_id: r._id,
          event_type: r.type ?? 'storage_cleanup',
          attempts: r.attempts,
          created_at: r.created_at,
        })),
        has_more: rows.length > size,
        next_cursor: rows.length > size ? encodeCursor(items[items.length - 1], scope) : null,
      };
    }
    const data = requestData('maintenanceService.listHolds', request),
      size = data.page_size ?? 20,
      scope = { user: actor.user._id, role: actor.grant.role };
    const rows = await repo.find<Hold>(
        'data_holds',
        actor.grant.role === 'super_admin' ? {} : { created_by: actor.user._id },
        size + 1,
        { newest: true, after: decodeCursor(data.cursor, scope) },
      ),
      items = rows.slice(0, size);
    const visible = [];
    for (const h of items) {
      try {
        await repo.transaction((tx) => resource(tx, actor.grant, h.resource_type, h.resource_id));
        visible.push(dto(h));
      } catch {
        /* Scope changes hide historical administrative resources. */
      }
    }
    return {
      items: visible,
      has_more: rows.length > size,
      next_cursor: rows.length > size ? encodeCursor(items[items.length - 1], scope) : null,
    };
  }
  return { write, read };
}
