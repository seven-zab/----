import Ajv from 'ajv';
import { randomUUID } from 'node:crypto';
import type { Repository, Transaction } from '../../core/repository';
import type { PrivateDataCodec } from '../../core/private-data';
import type { ContentSafety } from '../../adapters/content-safety';
import type { Grant, User } from '../../core/entities';
import { assertAccount } from '../../core/policy';
import { ensure } from '../../core/errors';
import { hash } from '../../core/hash';
import { reserveWrite } from '../../core/rate-limit';
import { requestData, type CallRequest } from '../../core/request';
import type { CommandGuard } from '../../core/command';
import { createDemandService, type Demand } from '../demand/service';
import { createTeamService, type Team } from '../team/service';
import { createUserService } from '../user/service';
import { createStatsService } from '../stats/service';
import { retrieveForAssistant } from '../knowledge/service';
import { explicitAction, ownSession, operationDTO } from './service';
import type { AIJob, AIIntent, AIMessage, AIProposal, Operation } from './types';
import tools from '../../../contracts/generated/ai-tools.json';
import formSchema from '../../../contracts/schemas/DemandCreateInput.json';
import type { ContractMap } from '../../../contracts/generated/dto';
import type { StoredFile } from '../file/service';
const ajv = new Ajv({ strict: true, allErrors: true });
const validators = new Map(tools.tools.map((t) => [t.name, ajv.compile(t.parameters)]));
const validateForm =
  ajv.compile<ContractMap['demandService.createAndSubmit']['request']>(formSchema);
export interface ExecutionContext {
  job: AIJob;
  token: string;
  now: number;
  clock?: () => number;
  tool_key?: string;
}
async function liveJob(tx: Transaction, ctx: ExecutionContext) {
  const j = await tx.get<AIJob>('ai_jobs', ctx.job._id);
  ensure(
    j &&
      j.status === 'running' &&
      j.lease_token === ctx.token &&
      j.lease_until > (ctx.clock?.() ?? ctx.now),
    'STATE_CONFLICT',
    'AI任务租约已失效',
    409,
  );
  const session = await ownSession(tx, j.session_id, j.owner_id);
  ensure(session.active_job_id === j._id, 'STATE_CONFLICT', '会话已切换运行任务', 409);
  const user = await tx.get<User>('users', j.owner_id);
  ensure(user, 'USER_NOT_INITIALIZED', '请先登录', 401);
  assertAccount(user);
  return { job: j, user };
}
async function liveIntent(tx: Transaction, ctx: ExecutionContext, action: AIIntent['action']) {
  const { job } = await liveJob(tx, ctx);
  const i = job.intent_id ? await tx.get<AIIntent>('ai_action_intents', job.intent_id) : null;
  ensure(
    i &&
      i.owner_id === job.owner_id &&
      i.session_id === job.session_id &&
      i.action === action &&
      i.grant_id === job.grant_id,
    'FORBIDDEN',
    '当前用户没有授权此业务动作',
  );
  ensure(
    ['collecting', 'ready'].includes(i.status) && i.expires_at > (ctx.clock?.() ?? ctx.now),
    'STATE_CONFLICT',
    '操作已取消、完成或过期',
    409,
  );
  return i;
}
export function createToolExecutor(
  repo: Repository,
  codec: PrivateDataCodec,
  safety?: ContentSafety,
) {
  const demand = createDemandService(repo, codec, safety),
    team = createTeamService(repo),
    users = createUserService(repo, codec),
    stats = createStatsService(repo);
  const envelope = (
    ctx: ExecutionContext,
    action: string,
    data: unknown,
    key?: string,
  ): CallRequest => ({
    api_version: 'v1',
    request_id: randomUUID(),
    action,
    data,
    ...(ctx.job.grant_id ? { grant_id: ctx.job.grant_id } : {}),
    ...(key ? { idempotency_key: key } : {}),
  });
  async function evidence(ctx: ExecutionContext) {
    const rows = await repo.find<AIMessage>(
      'ai_messages',
      {
        session_id: ctx.job.session_id,
        owner_id: ctx.job.owner_id,
        role: 'user',
        intent_id: ctx.job.intent_id,
      },
      50,
      { newest: true },
    );
    const intent = ctx.job.intent_id
      ? await repo.get<AIIntent>('ai_action_intents', ctx.job.intent_id)
      : null;
    ensure(intent, 'FORBIDDEN', '缺少用户业务指令');
    const source = await repo.get<AIMessage>('ai_messages', intent.source_message_id);
    const sourceText = source ? codec.open(source.sealed_content) : null;
    ensure(
      source &&
        source.owner_id === ctx.job.owner_id &&
        typeof sourceText === 'string' &&
        hash(sourceText) === intent.source_message_hash &&
        explicitAction(sourceText) === intent.action,
      'FORBIDDEN',
      '业务授权来源无效',
    );
    const snippets = rows
      .filter((m) => m.created_at <= ctx.job.created_at && m.created_at >= intent.created_at)
      .map((m) => ({
        id: m._id,
        text: codec.open(m.sealed_content),
        attachments: m.attachment_ids,
      }));
    return {
      intent,
      snippets,
      text: snippets
        .map((m) => m.text)
        .filter((s): s is string => typeof s === 'string')
        .join('\n'),
    };
  }
  async function executeMutation(
    ctx: ExecutionContext,
    action: AIIntent['action'],
    route: 'createAndSubmit' | 'claim' | 'addProgress' | 'submitCompletion',
    data: unknown,
    proposal?: AIProposal,
  ) {
    const previous = ctx.job.intent_id
      ? await repo.get<AIIntent>('ai_action_intents', ctx.job.intent_id)
      : null;
    if (previous?.status === 'executed') {
      ensure(
        previous.action === action && previous.owner_id === ctx.job.owner_id,
        'FORBIDDEN',
        '操作不匹配',
      );
      return operationDTO(repo, previous, ctx.now);
    }
    const request = envelope(ctx, route, data, 'ai:' + ctx.job.intent_id);
    requestData(`demandService.${route}`, request);
    const proof = await evidence(ctx);
    ensure(proof.intent.action === action, 'FORBIDDEN', '用户指令与动作不符');
    const guard: CommandGuard = {
      async before(c) {
        const i = await liveIntent(c.tx, ctx, action);
        if (proposal) {
          const p = await c.tx.get<AIProposal>('ai_draft_proposals', proposal._id);
          ensure(
            p &&
              p.owner_id === ctx.job.owner_id &&
              p.intent_id === i._id &&
              p.version === proposal.version &&
              p.draft_hash === proposal.draft_hash &&
              p.status === 'ready',
            'VERSION_CONFLICT',
            '草稿已变化',
            409,
          );
        }
      },
      async after(c, response) {
        const i = await liveIntent(c.tx, ctx, action);
        const result = response as ContractMap['demandService.createAndSubmit']['response'];
        const operation: Operation = {
          intent_id: i._id,
          version: i.version + 1,
          proposal_id: i.proposal_id,
          action,
          status: 'executed',
          demand_id: result.demand_id,
          demand_status: result.status,
          detail_path: '/pages/demand-detail/demand-detail?id=' + result.demand_id,
          error_code: null,
        };
        i.status = 'executed';
        i.version++;
        i.result = operation;
        await c.tx.put('ai_action_intents', i);
        if (proposal) {
          const p = await c.tx.get<AIProposal>('ai_draft_proposals', proposal._id);
          ensure(p, 'NOT_FOUND', '草稿不存在', 404);
          p.status = 'submitted';
          await c.tx.put('ai_draft_proposals', p);
        }
      },
    };
    await reserveWrite(repo, ctx.job.openid, 'demandService', request, ctx.now);
    await demand.write(ctx.job.openid, request, ctx.now, guard);
    const consumed = await repo.get<AIIntent>('ai_action_intents', proof.intent._id);
    ensure(consumed, 'STATE_CONFLICT', '缺少执行凭证', 409);
    return operationDTO(repo, consumed, ctx.now);
  }
  async function submit(ctx: ExecutionContext, args: Record<string, unknown>) {
    const p = await repo.get<AIProposal>('ai_draft_proposals', String(args.proposal_id));
    ensure(
      p &&
        p.owner_id === ctx.job.owner_id &&
        p.session_id === ctx.job.session_id &&
        p.intent_id === ctx.job.intent_id,
      'NOT_FOUND',
      '草稿不存在',
      404,
    );
    ensure(
      p.version === args.expected_version && p.draft_hash === args.draft_hash,
      'VERSION_CONFLICT',
      '草稿版本已变化',
      409,
    );
    const i = await repo.get<AIIntent>('ai_action_intents', p.intent_id);
    if (i?.status === 'executed') return operationDTO(repo, i, ctx.now);
    ensure(p.status === 'ready' && validateForm(p.draft), 'VALIDATION_FAILED', '请先补齐表单', 400);
    await demand.write(
      ctx.job.openid,
      envelope(ctx, 'checkSubmission', p.draft, 'ai-check:' + i?._id),
      ctx.now,
    );
    return executeMutation(ctx, 'submit_my_demand', 'createAndSubmit', p.draft, p);
  }
  async function saveProposal(ctx: ExecutionContext, args: Record<string, unknown>) {
    const proof = await evidence(ctx);
    ensure(proof.intent.action === 'submit_my_demand', 'FORBIDDEN', '只有明确发布指令可保存草稿');
    const draft = args.draft as Record<string, unknown>;
    const grant = ctx.job.grant_id ? await repo.get<Grant>('role_grants', ctx.job.grant_id) : null;
    const prior = proof.intent.proposal_id
      ? await repo.get<AIProposal>('ai_draft_proposals', proof.intent.proposal_id)
      : null;
    if (prior?.last_tool_key && prior.last_tool_key === ctx.tool_key) {
      if (prior.status === 'ready' || prior.status === 'submitted')
        return submit(ctx, {
          proposal_id: prior._id,
          expected_version: prior.version,
          draft_hash: prior.draft_hash,
        });
      return {
        proposal_id: prior._id,
        version: prior.version,
        draft_hash: prior.draft_hash,
        missing_fields: prior.missing_fields,
        status: prior.status,
      };
    }
    const merged = { ...prior?.draft, ...draft } as Record<string, unknown>;
    const enumFields = new Set([
      'type',
      'sub_type',
      'business_scene',
      'campus_organization_id',
      'schema_version',
      'kind',
      'currency',
      'usage',
      'equipment_provider',
      'live_location_kind',
      'urgency',
      'funding_source',
    ]);
    const fieldSources: Record<string, { kind: string; message_ids: string[] }> = {};
    function verify(value: unknown, path: string) {
      if (value && typeof value === 'object') {
        for (const [key, v] of Object.entries(value)) verify(v, path ? path + '.' + key : key);
        return;
      }
      const key = path.split('.').pop() ?? '';
      if (enumFields.has(key) || ['expires_at', 'region_id', 'file_id'].includes(key)) return;
      const candidates = [
        String(value),
        ...(key.endsWith('_fen') && typeof value === 'number' ? [String(value / 100)] : []),
      ];
      const sources = proof.snippets
        .filter((m) => {
          const text = m.text;
          return typeof text === 'string' && candidates.some((c) => text.includes(c));
        })
        .map((m) => m.id);
      ensure(
        sources.length > 0,
        'VALIDATION_FAILED',
        `请补充真实字段：${path}，不能由模型编造`,
        400,
      );
      fieldSources[path] = { kind: 'user_input', message_ids: sources };
    }
    verify(merged, '');
    merged.schema_version = 1;
    merged.business_scene = merged.type === 'campus' ? 'campus' : 'village';
    if (merged.type === 'campus') {
      merged.campus_organization_id = 'sztu';
      delete merged.region_id;
    } else {
      delete merged.campus_organization_id;
      if (!merged.region_id && grant?.scope_region_id) merged.region_id = grant.scope_region_id;
      if (merged.region_id) {
        const regions = (await users.read(
          ctx.job.openid,
          envelope(ctx, 'listRegions', {}),
          ctx.now,
        )) as ContractMap['userService.listRegions']['response'];
        const r = regions.items.find((r) => r.region_id === merged.region_id);
        ensure(
          merged.region_id === grant?.scope_region_id || (r && proof.text.includes(r.name)),
          'VALIDATION_FAILED',
          '请明确选择实际村域',
          400,
        );
      }
    }
    if (!merged.service_time) merged.service_time = { kind: 'negotiable' };
    if (!merged.budget) merged.budget = { kind: 'negotiable' };
    // Deadline is a server default unless the user supplied the exact timestamp.
    if (typeof merged.expires_at !== 'number' || !proof.text.includes(String(merged.expires_at)))
      merged.expires_at = prior?.draft.expires_at ?? ctx.now + 30 * 86400000;
    const attachments = merged.attachments as Array<{ file_id: string }> | undefined;
    if (attachments)
      ensure(
        attachments.every((a) => proof.snippets.some((m) => m.attachments.includes(a.file_id))),
        'FORBIDDEN',
        '不能绑定对话未提供的附件',
      );
    const valid = validateForm(merged);
    const problems = (validateForm.errors ?? [])
      .filter((e) => e.keyword !== 'oneOf' && e.keyword !== 'const')
      .map(
        (e) =>
          `${e.instancePath || '/'}:${
            e.keyword === 'required' ? String(e.params.missingProperty) : e.keyword
          }`,
      )
      .slice(0, 40);
    const p = await repo.transaction(async (tx) => {
      const intent = await liveIntent(tx, ctx, 'submit_my_demand');
      const d: AIProposal = {
        ...(ctx.tool_key ? { last_tool_key: ctx.tool_key } : {}),
        _id: intent.proposal_id ?? hash(['ai-proposal', intent._id]),
        owner_id: ctx.job.owner_id,
        session_id: ctx.job.session_id,
        intent_id: intent._id,
        draft: merged as AIProposal['draft'],
        version: (prior?.version ?? 0) + 1,
        draft_hash: hash(merged),
        missing_fields: valid ? [] : problems,
        validation_errors: valid ? [] : problems,
        status: valid ? 'ready' : 'editing',
        created_at: prior?.created_at ?? ctx.now,
      };
      if (prior) {
        const current = await tx.get<AIProposal>('ai_draft_proposals', prior._id);
        ensure(current?.version === prior.version, 'VERSION_CONFLICT', '草稿已更新', 409);
      }
      intent.proposal_id = d._id;
      intent.status = valid ? 'ready' : 'collecting';
      intent.version++;
      await tx.put('ai_action_intents', intent);
      await tx.put('ai_draft_proposals', { ...d, field_sources: fieldSources });
      return d;
    });
    if (p.status === 'ready')
      return submit(ctx, {
        proposal_id: p._id,
        expected_version: p.version,
        draft_hash: p.draft_hash,
      });
    return {
      proposal_id: p._id,
      version: p.version,
      draft_hash: p.draft_hash,
      missing_fields: p.missing_fields,
      status: p.status,
    };
  }
  async function appendConversationImages(ctx: ExecutionContext, text: string): Promise<string> {
    const receiptId = hash(['ai-image-result', ctx.job._id]);
    const receipt = await repo.get<{ _id: string; result_ciphertext: string }>(
      'ai_tool_receipts',
      receiptId,
    );
    if (receipt) return String(codec.open(receipt.result_ciphertext));
    ensure(
      !ctx.job.intent_id,
      'STATE_CONFLICT',
      '当前还有未完成的业务操作，请先处理后再补充图片。',
      409,
    );
    const source = await repo.get<AIMessage>('ai_messages', ctx.job.source_message_id);
    ensure(source?.attachment_ids.length, 'VALIDATION_FAILED', '请先选择要添加的图片', 400);
    const history = await repo.find<AIMessage>(
      'ai_messages',
      {
        owner_id: ctx.job.owner_id,
        session_id: ctx.job.session_id,
        role: 'user',
      },
      50,
      { newest: true },
    );
    const ids = [...new Set(history.map((m) => m.intent_id).filter((id): id is string => !!id))];
    const intents = (
      await Promise.all(ids.map((id) => repo.get<AIIntent>('ai_action_intents', id)))
    ).filter(
      (i): i is AIIntent =>
        !!i &&
        i.status === 'executed' &&
        i.owner_id === ctx.job.owner_id &&
        i.session_id === ctx.job.session_id,
    );
    const candidates = [] as Demand[];
    for (const i of intents) {
      if (i.action !== 'submit_my_demand' || !i.result?.demand_id) continue;
      const d = await repo.get<Demand>('demands', i.result.demand_id);
      if (d?.owner_id === ctx.job.owner_id && !candidates.some((v) => v._id === d._id))
        candidates.push(d);
    }
    const named = candidates.filter(
      (d) => text.includes(d._id) || (d.form.title && text.includes(d.form.title)),
    );
    const target =
      history.length < 50 && named.length === 1
        ? named[0]
        : history.length < 50 && named.length === 0 && candidates.length === 1
        ? candidates[0]
        : null;
    ensure(
      target,
      'VALIDATION_FAILED',
      '请说明要补充图片的具体需求；如有多个同名需求，请从详情页确认。',
      400,
    );
    ensure(
      ['pending_audit', 'pending_claim'].includes(target.status),
      'STATE_CONFLICT',
      '当前需求状态不支持通过对话补充图片，请在需求详情查看可用操作。',
      409,
    );
    const privateData = await repo.get<{ _id: string; ciphertext: string }>(
      'demand_private',
      target._id,
    );
    ensure(privateData, 'STATE_CONFLICT', '需求资料不完整，请在需求详情处理。', 409);
    const existing = target.form.attachments ?? [];
    const additions = source.attachment_ids.filter(
      (id) => !existing.some((item) => item.file_id === id),
    );
    ensure(additions.length > 0, 'VALIDATION_FAILED', '这些图片已在需求中。', 400);
    const replacement = {
      ...target.form,
      contact: codec.open(privateData.ciphertext),
      attachments: [...existing, ...additions.map((file_id) => ({ file_id, usage: 'image' }))],
    };
    const check = envelope(ctx, 'checkSubmission', replacement, 'ai-image-check:' + ctx.job._id);
    await demand.write(ctx.job.openid, check, ctx.now);
    const request = envelope(
      ctx,
      'editAndResubmit',
      { demand_id: target._id, expected_version: target.version, replacement },
      'ai-image:' + ctx.job._id,
    );
    const answer = `已为“${target.form.title}”添加${additions.length}张图片，需求已提交审核。`;
    await reserveWrite(repo, ctx.job.openid, 'demandService', request, ctx.now);
    await demand.write(ctx.job.openid, request, ctx.now, {
      async before(c) {
        await liveJob(c.tx, ctx);
        const m = await c.tx.get<AIMessage>('ai_messages', ctx.job.source_message_id);
        ensure(
          m &&
            m.owner_id === c.user._id &&
            m.session_id === ctx.job.session_id &&
            hash(codec.open(m.sealed_content)) === hash(text) &&
            additions.every((id) => m.attachment_ids.includes(id)),
          'FORBIDDEN',
          '图片来源无效',
        );
        for (const id of additions) {
          const file = await c.tx.get<StoredFile>('files', id);
          ensure(
            file &&
              file.owner_id === c.user._id &&
              file.purpose === 'demand' &&
              file.state === 'active' &&
              file.check_status === 'pass' &&
              file.mime.startsWith('image/'),
            'FORBIDDEN',
            '只能添加本人上传并通过检查的图片',
          );
        }
        const evidence = await Promise.all(
          intents.map((i) => c.tx.get<AIIntent>('ai_action_intents', i._id)),
        );
        ensure(
          evidence.some(
            (i) =>
              i?.status === 'executed' &&
              i.owner_id === c.user._id &&
              i.session_id === ctx.job.session_id &&
              i.action === 'submit_my_demand' &&
              i.result?.demand_id === target._id,
          ),
          'FORBIDDEN',
          '需求来源无效',
        );
      },
      async after(c) {
        await c.tx.put('ai_tool_receipts', {
          _id: receiptId,
          job_id: ctx.job._id,
          result_ciphertext: codec.seal(answer),
          created_at: ctx.now,
        });
      },
    });
    return answer;
  }
  async function execute(ctx: ExecutionContext, name: string, args: unknown): Promise<unknown> {
    ensure(validators.get(name)?.(args), 'VALIDATION_FAILED', '工具不在白名单或参数不合法', 400);
    const data = args as Record<string, unknown>;
    const actor = await repo.transaction((tx) => liveJob(tx, ctx));
    if (name === 'search_knowledge') {
      const grant = ctx.job.grant_id
        ? await repo.get<Grant>('role_grants', ctx.job.grant_id)
        : null;
      return retrieveForAssistant(
        repo,
        { user: actor.user, grant, now: ctx.now },
        String(data.query),
        data.usage as 'business_answer' | 'tool_reference' | 'management_answer',
      );
    }
    if (name === 'get_form_schema') {
      const regions = await users.read(ctx.job.openid, envelope(ctx, 'listRegions', {}), ctx.now);
      return {
        schema: formSchema.oneOf.find((s) => s.properties.type.const === data.type),
        regions,
        defaults: {
          service_time: { kind: 'negotiable' },
          budget: { kind: 'negotiable' },
          expires_in_days: 30,
        },
        instructions: '联系人、位置、正文和标题使用用户原话，不编造。',
      };
    }
    if (name === 'search_public_demands')
      return demand.read(ctx.job.openid, envelope(ctx, 'listPublic', data), ctx.now);
    if (name === 'list_my_teams') {
      const result = (await team.read(
        ctx.job.openid,
        envelope(ctx, 'listMyTeams', {}),
        ctx.now,
      )) as ContractMap['teamService.listMyTeams']['response'];
      const items = [];
      for (const ownTeam of result.items) {
        const members = await team.read(
          ctx.job.openid,
          envelope(ctx, 'listMembers', { team_id: ownTeam.team_id, page_size: 50 }),
          ctx.now,
        );
        items.push({ ...ownTeam, members });
      }
      return { ...result, items };
    }
    if (name === 'get_local_statistics')
      return stats.read(ctx.job.openid, envelope(ctx, 'getOverview', data), ctx.now);
    if (name === 'list_my_tasks')
      return demand.read(
        ctx.job.openid,
        envelope(ctx, data.relation === 'published' ? 'listMine' : 'listClaimed', {
          ...(data.cursor ? { cursor: data.cursor } : {}),
          ...(data.page_size ? { page_size: data.page_size } : {}),
        }),
        ctx.now,
      );
    if (name === 'get_my_demand_status' || name === 'get_my_task_detail') {
      const d = await repo.get<Demand>('demands', String(data.demand_id));
      ensure(
        d &&
          (d.owner_id === actor.user._id ||
            (name === 'get_my_task_detail' &&
              (d.responsible_user_id === actor.user._id ||
                d.participant_user_ids?.includes(actor.user._id)))),
        'NOT_FOUND',
        '本人任务不存在',
        404,
      );
      const detail = (await demand.read(
        ctx.job.openid,
        envelope(ctx, 'getDetail', { demand_id: d._id }),
        ctx.now,
      )) as ContractMap['demandService.getDetail']['response'];
      return {
        demand_id: d._id,
        title: detail.demand.title,
        status: detail.demand.status,
        version: detail.demand.version,
        allowed_actions: detail.allowed_actions,
      };
    }
    if (name === 'save_demand_proposal') return saveProposal(ctx, data);
    if (name === 'submit_my_demand') return submit(ctx, data);
    const action = name as AIIntent['action'];
    ensure(
      ['claim_my_demand', 'add_my_progress', 'submit_my_completion'].includes(action),
      'FORBIDDEN',
      '未开放此工具',
    );
    const proof = await evidence(ctx);
    ensure(proof.intent.action === action, 'FORBIDDEN', '用户未授权此动作');
    const d = await repo.get<Demand>('demands', String(data.demand_id));
    ensure(d, 'NOT_FOUND', '需求不存在', 404);
    let namedTarget = false;
    if (d.form.title && proof.text.includes(d.form.title)) {
      const matches = (await demand.read(
        ctx.job.openid,
        envelope(
          ctx,
          action === 'claim_my_demand' ? 'listPublic' : 'listClaimed',
          action === 'claim_my_demand'
            ? { keyword: d.form.title, page_size: 50 }
            : { page_size: 50 },
        ),
        ctx.now,
      )) as ContractMap['demandService.listPublic']['response'];
      const exact = matches.items.filter((item) => item.title === d.form.title);
      namedTarget = !matches.has_more && exact.length === 1 && exact[0].demand_id === d._id;
    }
    ensure(
      proof.text.includes(d._id) || namedTarget,
      'VALIDATION_FAILED',
      '请明确唯一任务；同名或结果较多时请从任务详情提供编号',
      400,
    );
    if (data.assignee_type === 'team') {
      const t = await repo.get<Team>('teams', String(data.team_id));
      const ownTeams = (await team.read(
        ctx.job.openid,
        envelope(ctx, 'listMyTeams', { page_size: 50 }),
        ctx.now,
      )) as ContractMap['teamService.listMyTeams']['response'];
      const namedTeam =
        t &&
        proof.text.includes(t.name) &&
        !ownTeams.has_more &&
        ownTeams.items.filter((item) => item.name === t.name).length === 1;
      ensure(
        t && t.leader_user_id === actor.user._id && (proof.text.includes(t._id) || namedTeam),
        'VALIDATION_FAILED',
        '请明确选择本人负责的团队；同名时请从团队页提供编号',
        400,
      );
      const participants = data.participant_user_ids as string[];
      const memberUsers = await Promise.all(
        t.member_user_ids.map((id) => repo.get<User>('users', id)),
      );
      ensure(
        participants.every((id) => {
          const user = memberUsers.find((u) => u?._id === id);
          return (
            proof.text.includes(id) ||
            Boolean(
              user &&
                (proof.text.includes(user.user_code) ||
                  (proof.text.includes(user.display_name) &&
                    memberUsers.filter((u) => u?.display_name === user.display_name).length === 1)),
            )
          );
        }),
        'VALIDATION_FAILED',
        '请明确本单全部实际参与者；同名时提供用户编号，不能默认全队',
        400,
      );
    }
    for (const field of ['text', 'summary', 'message'])
      if (typeof data[field] === 'string')
        ensure(
          proof.text.includes(data[field] as string),
          'VALIDATION_FAILED',
          '请提供真实进度或成果原文',
          400,
        );
    for (const field of ['service_started_at', 'service_ended_at'])
      if (data[field] !== undefined)
        ensure(
          proof.text.includes(String(data[field])),
          'VALIDATION_FAILED',
          '服务时间需来自用户提供事实',
          400,
        );
    if (data.attachment_ids)
      ensure(
        (data.attachment_ids as string[]).every((id) =>
          proof.snippets.some((m) => m.attachments.includes(id)),
        ),
        'FORBIDDEN',
        '附件未由当前对话提供',
      );
    const route =
      action === 'claim_my_demand'
        ? 'claim'
        : action === 'add_my_progress'
        ? 'addProgress'
        : 'submitCompletion';
    return executeMutation(ctx, action, route, { ...data, expected_version: d.version });
  }
  return { execute, appendConversationImages };
}
