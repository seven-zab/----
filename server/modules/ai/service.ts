import type { Repository, Transaction, Entity } from '../../core/repository';
import type { PrivateDataCodec } from '../../core/private-data';
import { resolveUser, runCommand } from '../../core/command';
import { assertAccount } from '../../core/policy';
import { hash } from '../../core/hash';
import { ensure } from '../../core/errors';
import { requestData, type CallRequest } from '../../core/request';
import { decodeCursor, encodeCursor } from '../../core/pagination';
import { getQuota, releaseQuota } from './quota';
import { bindFile, type StoredFile } from '../file/service';
import { modelRouteConfigured } from '../../adapters/model';
import {
  RETENTION_MS,
  type AISession,
  type AIJob,
  type AIMessage,
  type AIIntent,
  type AIProposal,
} from './types';
const examples = [
  '帮我发布一个农产品直播带货需求',
  '我想发布无人机播种需求，还需要补充哪些信息？',
  '查询我发布的需求状态',
  '如何接取任务和提交成果？',
];
function defersAction(text: string): boolean {
  return (
    /(?:不要|不用|别|不想|不必|禁止|暂缓|暂不|先不|停止|取消|撤销)(?:再|帮我|替我|为我|直接|立即|马上|自动|正式|实际|真正|执行|操作|去|进行|这个|这条|该|此|本次|需求|任务)*(?:发布|提交|接取|接单|认领|记录|添加|更新|交付|操作|执行)/u.test(
      text,
    ) ||
    /(?:先|仅|只)(?:帮我)?(?:写|起草|润色|预览|保存草稿|列出|演示|模拟)|(?:确认|同意|批准)(?:之后|以后|后|了)?(?:再|才)(?:发布|提交|接取|执行)/u.test(
      text,
    )
  );
}
export function explicitAction(content: string): AIIntent['action'] | null {
  const s = content.trim();
  if (defersAction(s)) return null;
  if (
    /^(?:如何|怎么|怎样|能否|是否|如果|假如|假设|例如|示例|引用|帮我(?:写|润色|起草)|请勿|不要|不想|别)/u.test(
      s,
    )
  )
    return null;
  if (
    /^(?:请(?:你)?(?:帮我)?|帮我|我要|我想|我现在要|现在)?(?:发布|提交(?:一个|这条|这份)?需求|创建并发布)/u.test(
      s,
    )
  )
    return 'submit_my_demand';
  if (/^(?:请(?:你)?(?:帮我)?|帮我|我要|我想|我现在要|现在)?(?:接取|接单|认领)/u.test(s))
    return 'claim_my_demand';
  if (
    /^(?:请(?:你)?(?:帮我)?|帮我|我要|我想|我现在要|现在)?(?:记录|提交|添加|更新)(?:本次|这次|任务)?进度/u.test(
      s,
    )
  )
    return 'add_my_progress';
  if (
    /^(?:请(?:你)?(?:帮我)?|帮我|我要|我想|我现在要|现在)?(?:提交|交付)(?:本次|这次|任务)?成果/u.test(
      s,
    )
  )
    return 'submit_my_completion';
  return null;
}
export async function ownSession(tx: Pick<Transaction, 'get'>, id: string, owner: string) {
  const s = await tx.get<AISession>('ai_sessions', id);
  ensure(s && s.owner_id === owner && s.deleted_at === null, 'NOT_FOUND', '会话不存在', 404);
  return s;
}
export async function operationDTO(repo: Pick<Transaction, 'get'>, intent: AIIntent, now: number) {
  const result = intent.result ?? {
    intent_id: intent._id,
    version: intent.version,
    proposal_id: intent.proposal_id,
    action: intent.action,
    status: intent.status,
    demand_id: null,
    demand_status: null,
    detail_path: null,
    error_code: intent.error_code,
  };
  if (intent.status !== 'executed' && intent.expires_at <= now)
    return { ...result, status: 'expired' as const };
  if (result.demand_id) {
    const d = await repo.get<Entity & { status: typeof result.demand_status }>(
      'demands',
      result.demand_id,
    );
    return { ...result, demand_status: d?.status ?? result.demand_status };
  }
  return { ...result, version: intent.version, proposal_id: intent.proposal_id };
}
export function createAIService(
  repo: Repository,
  codec: PrivateDataCodec,
  available = process.env.JOBS_ENABLED === 'true' &&
    process.env.AI_JOBS_ENABLED === 'true' &&
    modelRouteConfigured(process.env),
) {
  async function write(openid: string, request: CallRequest, now: number) {
    return runCommand(
      repo,
      openid,
      'aiService',
      request,
      async (ctx) => {
        if (request.action === 'createSession') {
          const s: AISession = {
            _id: ctx.command_id,
            owner_id: ctx.user._id,
            created_at: now,
            updated_at: now,
            deleted_at: null,
            active_job_id: null,
            pending_intent_id: null,
          };
          await ctx.tx.put('ai_sessions', s);
          return { session_id: s._id };
        }
        if (request.action === 'cancelPendingIntent') {
          const data = requestData('aiService.cancelPendingIntent', request),
            i = await ctx.tx.get<AIIntent>('ai_action_intents', data.intent_id);
          ensure(i && i.owner_id === ctx.user._id, 'NOT_FOUND', '操作不存在', 404);
          if (i.status === 'executed')
            return {
              intent_id: i._id,
              status: i.status,
              result_resource_id: i.result?.demand_id ?? null,
            };
          ensure(i.version === data.expected_version, 'VERSION_CONFLICT', '操作已更新', 409);
          i.status = i.expires_at <= now ? 'expired' : 'cancelled';
          i.version++;
          await ctx.tx.put('ai_action_intents', i);
          return { intent_id: i._id, status: i.status, result_resource_id: null };
        }
        if (request.action === 'deleteSession') {
          const data = requestData('aiService.deleteSession', request),
            s = await ownSession(ctx.tx, data.session_id, ctx.user._id);
          s.deleted_at = now;
          if (s.pending_intent_id) {
            const i = await ctx.tx.get<AIIntent>('ai_action_intents', s.pending_intent_id);
            if (i && ['collecting', 'ready'].includes(i.status)) {
              i.status = 'cancelled';
              i.version++;
              await ctx.tx.put('ai_action_intents', i);
            }
          }
          if (s.active_job_id) {
            const j = await ctx.tx.get<AIJob>('ai_jobs', s.active_job_id);
            if (j && ['queued', 'running'].includes(j.status)) {
              j.status = 'failed';
              j.error_code = 'SESSION_DELETED';
              j.lease_token = null;
              await releaseQuota(ctx.tx, ctx.user._id, j.source_message_id);
              await ctx.tx.put('ai_jobs', j);
            }
          }
          s.active_job_id = null;
          s.pending_intent_id = null;
          await ctx.tx.put('ai_sessions', s);
          return { deleted: true };
        }
        const data = requestData('aiService.sendMessage', request);
        const s = await ownSession(ctx.tx, data.session_id, ctx.user._id);
        const messageId = hash([ctx.user._id, s._id, data.client_message_id]);
        const content = data.content.trim();
        ensure(content, 'VALIDATION_FAILED', '请输入消息', 400);
        const fingerprint = hash({
          content,
          attachments: data.attachment_ids ?? [],
          grant: request.grant_id ?? null,
        });
        const receipt = await ctx.tx.get<Entity & { fingerprint: string; job_id: string }>(
          'ai_message_receipts',
          messageId,
        );
        if (receipt) {
          ensure(
            receipt.fingerprint === fingerprint,
            'IDEMPOTENCY_CONFLICT',
            '同一消息编号对应不同内容',
            409,
          );
          const job = await ctx.tx.get<AIJob>('ai_jobs', receipt.job_id);
          ensure(job, 'STATE_CONFLICT', '消息任务记录缺失', 409);
          return {
            job_id: job._id,
            message_id: messageId,
            status: job.status,
            quota: await getQuota(ctx.tx, ctx.user._id, now),
          };
        }
        ensure(
          available,
          'MODEL_UNAVAILABLE',
          '真实模型与后台执行器尚未配置，普通页面仍可办理业务',
          503,
        );
        if (s.active_job_id) {
          const active = await ctx.tx.get<AIJob>('ai_jobs', s.active_job_id);
          ensure(
            !active || !['queued', 'running'].includes(active.status),
            'SESSION_BUSY',
            '当前会话仍在处理上一条消息',
            409,
          );
        }
        const limiterId = hash(['ai_messages', ctx.user._id, Math.floor(now / 60000)]);
        const limiter = await ctx.tx.get<Entity & { count: number }>(
          'rate_limit_buckets',
          limiterId,
        );
        ensure((limiter?.count ?? 0) < 10, 'RATE_LIMITED', '每分钟最多发送10条AI消息', 429);
        await ctx.tx.put('rate_limit_buckets', {
          _id: limiterId,
          count: (limiter?.count ?? 0) + 1,
          expires_at: now + 120000,
        });
        for (const fileId of data.attachment_ids ?? []) {
          const f = await ctx.tx.get<StoredFile>('files', fileId);
          ensure(
            f &&
              f.owner_id === ctx.user._id &&
              f.state === 'active' &&
              f.check_status === 'pass' &&
              f.purpose === 'demand',
            'FORBIDDEN',
            '附件不可用于当前业务',
          );
          await bindFile(ctx.tx, fileId, 'ai_message', messageId, now);
        }
        let intentId: string | null = null;
        const action = explicitAction(content);
        if (action) {
          const i: AIIntent = {
            _id: hash(['ai-intent', messageId]),
            owner_id: ctx.user._id,
            session_id: s._id,
            source_message_id: messageId,
            source_message_hash: hash(content),
            action,
            status: 'collecting',
            version: 1,
            grant_id: request.grant_id ?? null,
            target_demand_id: null,
            proposal_id: null,
            expires_at: now + 30 * 60000,
            created_at: now,
            result: null,
            error_code: null,
          };
          await ctx.tx.put('ai_action_intents', i);
          intentId = i._id;
          s.pending_intent_id = i._id;
        } else if (s.pending_intent_id) {
          const i = await ctx.tx.get<AIIntent>('ai_action_intents', s.pending_intent_id);
          if (
            i &&
            ['collecting', 'ready'].includes(i.status) &&
            i.expires_at > now &&
            i.grant_id === (request.grant_id ?? null)
          ) {
            if (
              defersAction(content) ||
              /^(?:(?:请|帮我|先|暂时|现在|还是)\s*)*(?:取消|停止|撤销|算了|不要|别|暂不|先不)/u.test(
                content,
              )
            ) {
              i.status = 'cancelled';
              i.version++;
              await ctx.tx.put('ai_action_intents', i);
              s.pending_intent_id = null;
            } else if (!/^(?:如何|怎么|如果|假设|帮我写|帮我润色)/u.test(content)) intentId = i._id;
          }
        }
        const m: AIMessage = {
          _id: messageId,
          owner_id: ctx.user._id,
          session_id: s._id,
          role: 'user',
          sealed_content: codec.seal(content),
          attachment_ids: data.attachment_ids ?? [],
          created_at: now,
          intent_id: intentId,
          quota_charged: false,
        };
        const j: AIJob = {
          _id: ctx.command_id,
          owner_id: ctx.user._id,
          openid,
          session_id: s._id,
          source_message_id: messageId,
          answer_message_id: null,
          grant_id: request.grant_id ?? null,
          intent_id: intentId,
          status: 'queued',
          lease_token: null,
          lease_until: 0,
          created_at: now,
          error_code: null,
          business_done: false,
          general_done: false,
          business_answer: null,
          general_answer: null,
          general_status: 'not_requested',
          route: null,
        };
        s.active_job_id = j._id;
        s.updated_at = now;
        await ctx.tx.put('ai_sessions', s);
        await ctx.tx.put('ai_messages', m);
        await ctx.tx.put('ai_jobs', j);
        await ctx.tx.put('ai_message_receipts', {
          _id: messageId,
          fingerprint,
          job_id: j._id,
          created_at: now,
        });
        return {
          job_id: j._id,
          message_id: messageId,
          status: 'queued',
          quota: await getQuota(ctx.tx, ctx.user._id, now),
        };
      },
      now,
    );
  }
  async function read(openid: string, request: CallRequest, now: number) {
    if (request.action === 'getExamples') return examples;
    return repo.transaction(async (tx) => {
      const user = await resolveUser(tx, openid);
      ensure(user, 'USER_NOT_INITIALIZED', '请先登录', 401);
      assertAccount(user);
      if (request.action === 'getQuota') return getQuota(tx, user._id, now);
      if (request.action === 'getOperation') {
        const data = requestData('aiService.getOperation', request),
          i = await tx.get<AIIntent>('ai_action_intents', data.intent_id);
        ensure(i && i.owner_id === user._id, 'NOT_FOUND', '操作不存在', 404);
        return operationDTO(tx, i, now);
      }
      if (request.action === 'getProposal') {
        const data = requestData('aiService.getProposal', request),
          p = await tx.get<AIProposal>('ai_draft_proposals', data.proposal_id);
        ensure(p && p.owner_id === user._id, 'NOT_FOUND', '草稿不存在', 404);
        await ownSession(tx, p.session_id, user._id);
        const i = await tx.get<AIIntent>('ai_action_intents', p.intent_id);
        ensure(i, 'NOT_FOUND', '操作不存在', 404);
        return {
          proposal_id: p._id,
          draft: p.draft,
          missing_fields: p.missing_fields,
          validation_errors: p.validation_errors,
          version: p.version,
          status: i.expires_at <= now && i.status !== 'executed' ? 'expired' : p.status,
          intent_status: i.expires_at <= now && i.status !== 'executed' ? 'expired' : i.status,
          draft_hash: p.draft_hash,
        };
      }
      if (request.action === 'getJob') {
        const data = requestData('aiService.getJob', request),
          j = await tx.get<AIJob>('ai_jobs', data.job_id);
        ensure(j && j.owner_id === user._id, 'NOT_FOUND', '任务不存在', 404);
        await ownSession(tx, j.session_id, user._id);
        const i = j.intent_id ? await tx.get<AIIntent>('ai_action_intents', j.intent_id) : null;
        return {
          status: j.status,
          message_id: j.answer_message_id,
          operation_result: i ? await operationDTO(tx, i, now) : null,
          quota: await getQuota(tx, user._id, now),
          retry_after_ms: j.status === 'queued' ? 2000 : 5000,
          error_code: j.error_code,
        };
      }
      if (request.action === 'listSessions') {
        const data = requestData('aiService.listSessions', request),
          size = data.page_size ?? 20,
          scope = { owner: user._id };
        const rows = await repo.find<AISession>(
          'ai_sessions',
          { owner_id: user._id, deleted_at: null },
          size + 1,
          { newest: true, after: decodeCursor(data.cursor, scope) },
        );
        const items = rows.slice(0, size);
        return {
          items: items.map((s) => ({
            session_id: s._id,
            created_at: s.created_at,
            updated_at: s.updated_at,
            active_job_id: s.active_job_id,
          })),
          has_more: rows.length > size,
          next_cursor: rows.length > size ? encodeCursor(items[items.length - 1], scope) : null,
        };
      }
      const data = requestData('aiService.listMessages', request);
      await ownSession(tx, data.session_id, user._id);
      const size = data.page_size ?? 20,
        scope = { owner: user._id, session: data.session_id };
      const rows = await repo.find<AIMessage>(
        'ai_messages',
        { session_id: data.session_id, owner_id: user._id },
        size + 1,
        { newest: true, after: decodeCursor(data.cursor, scope) },
      );
      const visible = rows.slice(0, size);
      const items = [];
      for (const m of visible) {
        if (m.created_at + RETENTION_MS <= now) continue;
        const text = codec.open(m.sealed_content);
        ensure(typeof text === 'string', 'DEPENDENCY_UNAVAILABLE', '会话内容暂不可读', 503);
        const i = m.intent_id ? await tx.get<AIIntent>('ai_action_intents', m.intent_id) : null;
        items.push({
          message_id: m._id,
          role: m.role,
          content: text,
          created_at: m.created_at,
          operation_result: i ? await operationDTO(tx, i, now) : null,
          quota_charged: m.quota_charged,
          attachment_ids: m.attachment_ids,
        });
      }
      return {
        items,
        has_more: rows.length > size,
        next_cursor: rows.length > size ? encodeCursor(visible[visible.length - 1], scope) : null,
      };
    });
  }
  return { write, read };
}
