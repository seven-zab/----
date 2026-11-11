import type { ContentSafety } from '../../adapters/content-safety';
import type { Grant, User } from '../../core/entities';
import type { Entity, Repository, Transaction } from '../../core/repository';
import {
  assertAccount,
  assertCanContinueBoundTask,
  assertCanStartNewAction,
  assertScene,
} from '../../core/policy';
import { audit, resolveUser, runCommand, touchGuards } from '../../core/command';
import { ensure } from '../../core/errors';
import { hash } from '../../core/hash';
import { decodeCursor, encodeCursor } from '../../core/pagination';
import { requestData, type CallRequest } from '../../core/request';
import type { Claim, Demand } from '../demand/service';
import { bindFile, type StoredFile } from '../file/service';

export const CHAT_RETENTION_MS = 180 * 86400000;
export interface Conversation extends Entity {
  demand_id: string;
  participant_user_ids: string[];
  participant_grants: Record<string, string>;
  context_claim_ids: string[];
  created_at: number;
  updated_at: number;
}
export interface ChatMessage extends Entity {
  conversation_id: string;
  sender_user_id: string;
  client_message_id: string;
  content_type: 'text' | 'image' | 'file';
  content: string;
  file_id: string | null;
  created_at: number;
  content_hash: string;
}
const dto = (m: ChatMessage) => ({
  message_id: m._id,
  conversation_id: m.conversation_id,
  sender_user_id: m.sender_user_id,
  content_type: m.content_type,
  content: m.content,
  file_id: m.file_id,
  created_at: m.created_at,
});
export async function requireConversation(tx: Transaction, user: User, id: string) {
  assertAccount(user);
  const c = await tx.get<Conversation>('conversations', id);
  ensure(
    c && c.participant_user_ids.length === 2 && c.participant_user_ids.includes(user._id),
    'NOT_FOUND',
    '会话不存在',
    404,
  );
  return c;
}
async function sendPermission(tx: Transaction, c: Conversation, user: User, now: number) {
  const d = await tx.get<Demand>('demands', c.demand_id);
  ensure(d, 'NOT_FOUND', '关联需求不存在', 404);
  const bound = c.participant_grants[user._id];
  const g = bound ? await tx.get<Grant>('role_grants', bound) : null;
  const claim = d.active_claim_id ? await tx.get<Claim>('demand_claims', d.active_claim_id) : null;
  if (
    claim?.confirmed_at !== null &&
    claim &&
    ['confirmed', 'completed', 'terminated'].includes(claim.status)
  ) {
    ensure(
      c.participant_user_ids.includes(d.owner_id) &&
        c.participant_user_ids.includes(claim.responsible_user_id),
      'FORBIDDEN',
      '负责人交接后请使用新的会话',
    );
    const taskGrant =
      user._id === d.owner_id
        ? d.owner_grant_id
        : claim.participant_grants.find((p) => p.user_id === user._id)?.grant_id;
    const current = taskGrant ? await tx.get<Grant>('role_grants', taskGrant) : null;
    assertCanContinueBoundTask(user, current, taskGrant, true, now);
  } else {
    ensure(
      d.visibility === 'public' &&
        d.approved_at !== null &&
        ['pending_claim', 'claiming'].includes(d.status),
      'FORBIDDEN',
      '当前需求不能继续咨询',
    );
    assertCanStartNewAction(user, g, now);
    assertScene(g, d, user._id === d.owner_id ? 'publish' : 'claim');
  }
}
export function createChatService(repo: Repository, safety?: ContentSafety) {
  async function write(openid: string, request: CallRequest, now: number) {
    let checkedHash: string | undefined;
    if (request.action === 'sendMessage') {
      const input = requestData('chatService.sendMessage', request);
      // Check membership before calling an external checker; recheck it inside the write transaction.
      const previous = await repo.transaction(async (tx) => {
        const u = await resolveUser(tx, openid);
        ensure(u, 'USER_NOT_INITIALIZED', '请先登录', 401);
        const c = await requireConversation(tx, u, input.conversation_id);
        await sendPermission(tx, c, u, now);
        return tx.get<ChatMessage>('messages', hash([c._id, u._id, input.client_message_id]));
      });
      ensure(input.content.trim(), 'VALIDATION_FAILED', '消息不能为空', 400);
      if (previous)
        ensure(
          previous.content_hash === hash(input),
          'IDEMPOTENCY_CONFLICT',
          '消息编号对应的内容已变化',
          409,
        );
      else {
        ensure(safety, 'DEPENDENCY_UNAVAILABLE', '内容安全服务未配置', 503);
        ensure(
          (await safety.checkText(openid, input.content)) === 'pass',
          'CONTENT_REJECTED',
          '消息内容检查未通过',
          400,
        );
      }
      checkedHash = hash(input);
    }
    return runCommand(
      repo,
      openid,
      'chatService',
      request,
      async (ctx) => {
        if (request.action === 'createDemandConversation') {
          const input = requestData('chatService.createDemandConversation', request);
          const d = await ctx.tx.get<Demand>('demands', input.demand_id);
          ensure(d, 'NOT_FOUND', '需求不存在', 404);
          const claim = d.active_claim_id
            ? await ctx.tx.get<Claim>('demand_claims', d.active_claim_id)
            : null;
          if (input.claim_id)
            ensure(claim?._id === input.claim_id, 'STATE_CONFLICT', '对接关系已更新', 409);
          const owner = ctx.user._id === d.owner_id;
          let other: string;
          const ownerGrant = d.owner_grant_id;
          let serviceGrant: string;
          if (
            claim?.confirmed_at !== null &&
            claim &&
            ['confirmed', 'completed', 'terminated'].includes(claim.status)
          ) {
            ensure(
              owner || ctx.user._id === claim.responsible_user_id,
              'FORBIDDEN',
              '仅双方负责人可建立履约私聊',
            );
            other = owner ? claim.responsible_user_id : d.owner_id;
            serviceGrant =
              claim.participant_grants.find((p) => p.user_id === claim.responsible_user_id)
                ?.grant_id ?? '';
            const bound = owner ? ownerGrant : serviceGrant;
            assertCanContinueBoundTask(ctx.user, ctx.grant, bound, true, now);
          } else {
            ensure(!owner, 'FORBIDDEN', '请选择已有对接的任务联系服务方');
            ensure(
              d.visibility === 'public' &&
                d.approved_at !== null &&
                ['pending_claim', 'claiming'].includes(d.status),
              'NOT_FOUND',
              '需求未公开或不再接受咨询',
              404,
            );
            assertCanStartNewAction(ctx.user, ctx.grant, now);
            assertScene(ctx.grant, d, 'claim');
            other = d.owner_id;
            serviceGrant = ctx.grant._id;
          }
          ensure(other !== ctx.user._id, 'FORBIDDEN', '不能与自己建立会话');
          const otherUser = await ctx.tx.get<User>('users', other);
          ensure(otherUser, 'NOT_FOUND', '对接用户不存在', 404);
          await touchGuards(ctx.tx, [otherUser]);
          const participants = [ctx.user._id, other].sort();
          const pairKey = hash([d._id, participants]);
          let c = await ctx.tx.get<Conversation>('conversations', pairKey);
          if (!c)
            c = {
              _id: pairKey,
              demand_id: d._id,
              participant_user_ids: participants,
              participant_grants: {},
              context_claim_ids: [],
              created_at: now,
              updated_at: now,
            };
          c.participant_grants[d.owner_id] = ownerGrant;
          c.participant_grants[owner ? other : ctx.user._id] = serviceGrant;
          if (claim && !c.context_claim_ids.includes(claim._id))
            c.context_claim_ids.push(claim._id);
          await ctx.tx.put('conversations', c);
          await audit(ctx, c._id, '建立需求关联双人会话');
          return { conversation_id: c._id, demand_id: d._id };
        }
        if (request.action === 'sendMessage') {
          const input = requestData('chatService.sendMessage', request);
          const c = await requireConversation(ctx.tx, ctx.user, input.conversation_id);
          await sendPermission(ctx.tx, c, ctx.user, now);
          ensure(checkedHash === hash(input), 'STATE_CONFLICT', '消息检查结果不匹配', 409);
          const messageId = hash([c._id, ctx.user._id, input.client_message_id]);
          const previous = await ctx.tx.get<ChatMessage>('messages', messageId);
          if (previous) {
            ensure(
              previous.content_hash === checkedHash,
              'IDEMPOTENCY_CONFLICT',
              '消息编号对应的内容已变化',
              409,
            );
            return { message_id: previous._id, created_at: previous.created_at };
          }
          if (input.content_type !== 'text') {
            const f = input.file_id ? await ctx.tx.get<StoredFile>('files', input.file_id) : null;
            ensure(
              f &&
                f.owner_id === ctx.user._id &&
                f.purpose === 'chat' &&
                f.state === 'active' &&
                f.check_status === 'pass' &&
                (input.content_type !== 'image' || f.mime.startsWith('image/')),
              'FORBIDDEN',
              '消息附件不可用',
            );
            await bindFile(ctx.tx, f._id, 'message', messageId, now);
          }
          const message: ChatMessage = {
            _id: messageId,
            conversation_id: c._id,
            sender_user_id: ctx.user._id,
            client_message_id: input.client_message_id,
            content_type: input.content_type,
            content: input.content,
            file_id: 'file_id' in input ? input.file_id : null,
            created_at: now,
            content_hash: checkedHash,
          };
          await ctx.tx.put('messages', message);
          c.updated_at = now;
          await ctx.tx.put('conversations', c);
          await ctx.tx.put('outbox_events', {
            _id: ctx.command_id,
            type: 'chat.message',
            aggregate_id: c._id,
            recipient_ids: c.participant_user_ids.filter((id) => id !== ctx.user._id),
            status: 'pending',
            attempts: 0,
            next_retry_at: now,
            created_at: now,
          });
          return { message_id: messageId, created_at: now };
        }
        const input = requestData('chatService.markRead', request);
        const c = await requireConversation(ctx.tx, ctx.user, input.conversation_id);
        const message = await ctx.tx.get<ChatMessage>('messages', input.last_read_message_id);
        ensure(message?.conversation_id === c._id, 'NOT_FOUND', '消息不存在', 404);
        ensure(message.created_at + CHAT_RETENTION_MS > now, 'NOT_FOUND', '消息已过期', 404);
        const id = hash([c._id, ctx.user._id]);
        const old = await ctx.tx.get<
          Entity & { last_read_at: number; last_read_message_id: string }
        >('conversation_reads', id);
        if (
          !old ||
          message.created_at > old.last_read_at ||
          (message.created_at === old.last_read_at && message._id > old.last_read_message_id)
        )
          await ctx.tx.put('conversation_reads', {
            _id: id,
            user_id: ctx.user._id,
            conversation_id: c._id,
            last_read_at: message.created_at,
            last_read_message_id: message._id,
          });
        return { updated: true };
      },
      now,
    );
  }
  async function read(openid: string, request: CallRequest, now: number) {
    const user = await repo.transaction(async (tx) => {
      const u = await resolveUser(tx, openid);
      ensure(u, 'USER_NOT_INITIALIZED', '请先登录', 401);
      assertAccount(u);
      if (request.action === 'getMessages') {
        const input = requestData('chatService.getMessages', request);
        await requireConversation(tx, u, input.conversation_id);
      }
      return u;
    });
    if (request.action === 'getMessages') {
      const input = requestData('chatService.getMessages', request);
      const scope = { conversation_id: input.conversation_id, user_id: user._id };
      const size = input.page_size ?? 20;
      const rows = await repo.find<ChatMessage>(
        'messages',
        { conversation_id: input.conversation_id },
        size + 1,
        { newest: true, after: decodeCursor(input.cursor, scope) },
      );
      const visible = rows.filter((m) => m.created_at + CHAT_RETENTION_MS > now);
      const items = visible.slice(0, size);
      const has_more = visible.length > size;
      return {
        items: items.map(dto),
        has_more,
        next_cursor: has_more ? encodeCursor(items[items.length - 1], scope) : null,
      };
    }
    const input = requestData('chatService.listMine', request);
    const scope = { user_id: user._id };
    const size = input.page_size ?? 20;
    const rows = await repo.find<Conversation>(
      'conversations',
      { participant_user_ids: user._id },
      size + 1,
      { newest: true, after: decodeCursor(input.cursor, scope) },
    );
    const items = [];
    for (const c of rows.slice(0, size)) {
      const otherId = c.participant_user_ids.find((id) => id !== user._id)!;
      const other = await repo.get<User>('users', otherId);
      let can_send = false;
      try {
        await repo.transaction((tx) => sendPermission(tx, c, user, now));
        can_send = true;
      } catch {
        /* History may be read even when the prior relationship can no longer send. */
      }
      const d = await repo.get<Demand>('demands', c.demand_id);
      items.push({
        conversation_id: c._id,
        demand_id: c.demand_id,
        demand_title: d?.form.title ?? '历史需求',
        other_user_id: otherId,
        display_name: other?.display_name ?? '历史用户',
        updated_at: c.updated_at,
        can_send,
      });
    }
    const has_more = rows.length > size;
    return { items, has_more, next_cursor: has_more ? encodeCursor(rows[size - 1], scope) : null };
  }
  return { write, read };
}
