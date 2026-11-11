// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createHandler } from '../../server/handler';
import { privateDataCodec } from '../../server/core/private-data';
import { MemoryRepository } from '../helpers/memory-repository';
import { seedIdentity } from '../helpers/identity';
import { runAIJobs } from '../../server/maintenance/ai-jobs';
import { getQuota, reserveQuota, settleQuota, releaseQuota } from '../../server/modules/ai/quota';
import { explicitAction } from '../../server/modules/ai/service';
import type { AIJob, AIIntent } from '../../server/modules/ai/types';
import {
  cloudBaseModelProvider,
  type CloudAI,
  type ModelInput,
  type ModelResult,
} from '../../server/adapters/model';
import { BusinessError } from '../../server/core/errors';
let repo: MemoryRepository, handler: ReturnType<typeof createHandler>;
const now = Date.parse('2026-10-28T12:00:00+08:00'),
  codec = privateDataCodec(Buffer.alloc(32, 1).toString('base64'));
const safety = { checkText: vi.fn(async () => 'pass' as const) };
const output = (text: string, tool?: { name: string; args: unknown }): ModelResult => ({
  text,
  tool_calls: tool
    ? [
        {
          id: randomUUID(),
          type: 'function',
          function: { name: tool.name, arguments: JSON.stringify(tool.args) },
        },
      ]
    : [],
  usage: { prompt_tokens: 20, completion_tokens: 20, total_tokens: 40 },
});
const call = (action: string, data: unknown, actor = 'owner', key = randomUUID()) =>
  handler(
    'aiService',
    {
      api_version: 'v1',
      request_id: randomUUID(),
      action,
      data,
      grant_id: 'g-' + actor,
      idempotency_key: key,
    },
    actor,
    now,
  );
async function session() {
  const r = await call('createSession', { mode: 'assistant' });
  expect(r.code).toBe(0);
  return (r.data as { session_id: string }).session_id;
}
async function send(id: string, content: string, clientId = randomUUID()) {
  const r = await call('sendMessage', { session_id: id, client_message_id: clientId, content });
  expect(r.code).toBe(0);
  return r.data as { job_id: string; message_id: string };
}
function fake(generate: (input: ModelInput) => Promise<ModelResult>) {
  return { generate: vi.fn(generate) };
}
const generalModel = () =>
  fake(async (input) =>
    input.tools[0]?.function.name === 'route_turn'
      ? output('', {
          name: 'route_turn',
          args: {
            business_text: null,
            general_text: input.messages[input.messages.length - 1].content,
          },
        })
      : output('这是一条测试用一般问答。'),
  );
const publishText =
  '帮我发布无人机播种服务。标题：无人机播种服务；内容：需要无人机在本村开展水稻播种作业；位置：测试田地；联系人：张三；电话：13800138000。';
const draft = {
  type: 'agriculture',
  sub_type: 'drone_service',
  title: '无人机播种服务',
  content: '需要无人机在本村开展水稻播种作业',
  location_text: '测试田地',
  contact: { name: '张三', phone: '13800138000' },
  extra: {},
};
const deepSeekConfig = {
  AI_PROVIDER: 'cloudbase',
  AI_MODEL_PROVIDER: 'yzxz-deepseek',
  AI_MODEL_ID: 'deepseek-flash',
};
function publishModel(before?: () => Promise<void>) {
  return fake(async (input) => {
    if (input.tools[0]?.function.name === 'route_turn')
      return output('', {
        name: 'route_turn',
        args: { business_text: publishText, general_text: null },
      });
    if (before) await before();
    return output('', { name: 'save_demand_proposal', args: { draft } });
  });
}
beforeEach(() => {
  repo = new MemoryRepository();
  repo.seed('system_guards', { _id: 'v2_migration', schema_version: 2, status: 'verified' });
  seedIdentity(repo, 'owner', 'farmer', now);
  seedIdentity(repo, 'other', 'farmer', now);
  repo.seed('regions', {
    _id: 'a',
    name: '测试村',
    level: 'village',
    ancestor_ids: ['441623'],
    active: true,
  });
  safety.checkText.mockClear();
  handler = createHandler(repo, codec, safety, undefined, { aiAvailable: true });
});
it('requires login and ownership; logical message retries retain one job and reject changed bodies', async () => {
  expect((await call('getQuota', {}, '')).msg).toBe('请先登录');
  const id = await session();
  const cid = randomUUID();
  const first = await send(id, '介绍一下李白', cid);
  const repeat = await send(id, '介绍一下李白', cid);
  expect(repeat.job_id).toBe(first.job_id);
  expect(repo.rows('ai_jobs')).toHaveLength(1);
  expect(
    (await call('sendMessage', { session_id: id, client_message_id: cid, content: '改变正文' }))
      .error_code,
  ).toBe('IDEMPOTENCY_CONFLICT');
  expect((await call('getJob', { job_id: first.job_id }, 'other')).code).toBe(404);
  expect((await call('listMessages', { session_id: id }, 'other')).code).toBe(404);
  expect(
    (
      await call('sendMessage', {
        session_id: id,
        client_message_id: randomUUID(),
        content: '另一条消息',
      })
    ).error_code,
  ).toBe('SESSION_BUSY');
});
it('reports model unavailability before accepting a message when no executor is configured', async () => {
  const id = await session();
  const disabled = createHandler(repo, codec, safety, undefined, { aiAvailable: false });
  const r = await disabled(
    'aiService',
    {
      api_version: 'v1',
      request_id: randomUUID(),
      action: 'sendMessage',
      data: { session_id: id, client_message_id: randomUUID(), content: '如何发布需求' },
      idempotency_key: randomUUID(),
    },
    'owner',
    now,
  );
  expect(r.error_code).toBe('MODEL_UNAVAILABLE');
  expect(repo.rows('ai_jobs')).toEqual([]);
  expect((await getQuota(repo, 'owner', now)).used).toBe(0);
});
it('settles a single parent quota receipt on the original Shanghai day, even after midnight, and releases failures once', async () => {
  const at = Date.parse('2026-10-28T23:59:30+08:00');
  await repo.transaction((tx) => reserveQuota(tx, 'owner', 'parent', 'lease', at));
  await repo.transaction((tx) => reserveQuota(tx, 'owner', 'parent', 'lease', at));
  expect((await getQuota(repo, 'owner', at)).reserved).toBe(1);
  await repo.transaction((tx) => settleQuota(tx, 'owner', 'parent', 'lease', at + 60000));
  expect((await getQuota(repo, 'owner', at)).used).toBe(1);
  expect((await getQuota(repo, 'owner', at + 60000)).used).toBe(0);
  await repo.transaction((tx) => reserveQuota(tx, 'owner', 'failed', 'lease', at));
  await repo.transaction((tx) => releaseQuota(tx, 'owner', 'failed'));
  await repo.transaction((tx) => releaseQuota(tx, 'owner', 'failed'));
  expect((await getQuota(repo, 'owner', at)).reserved).toBe(0);
});
it('answers ten general messages and skips the general answering call for the eleventh', async () => {
  // Use distinct minutes to test the daily quota independently of the 10/minute input limiter.
  const model = generalModel();
  const id = await session();
  for (let index = 0; index < 11; index++) {
    const time = now + index * 60000;
    const r = await handler(
      'aiService',
      {
        api_version: 'v1',
        request_id: randomUUID(),
        action: 'sendMessage',
        data: { session_id: id, client_message_id: randomUUID(), content: '介绍一下李白' },
        idempotency_key: randomUUID(),
      },
      'owner',
      time,
    );
    expect(r.code).toBe(0);
    await runAIJobs(repo, codec, model, safety, { clock: () => time });
  }
  expect((await getQuota(repo, 'owner', now)).used).toBe(10);
  expect(model.generate.mock.calls.filter(([input]) => input.tools.length === 0)).toHaveLength(10);
  expect(repo.rows<AIJob>('ai_jobs').at(-1)?.general_status).toBe('quota_exceeded');
});
it('creates one pending-audit demand and consumes the intent atomically through the shared service', async () => {
  const id = await session();
  await send(id, publishText);
  const model = publishModel();
  expect(await runAIJobs(repo, codec, model, safety, { clock: () => now })).toMatchObject({
    succeeded: 1,
  });
  const demands = repo.rows('demands');
  expect(demands).toHaveLength(1);
  expect(demands[0]).toMatchObject({
    status: 'pending_audit',
    owner_id: 'owner',
    visibility: 'hidden',
  });
  expect(repo.rows<AIIntent>('ai_action_intents')[0].status).toBe('executed');
  expect(repo.rows('demand_events')).toHaveLength(1);
  expect((await getQuota(repo, 'owner', now)).used).toBe(0);
  await runAIJobs(repo, codec, model, safety, { clock: () => now });
  expect(repo.rows('demands')).toHaveLength(1);
});
it('adds the current conversation image to the previously submitted demand and replaces the audit snapshot', async () => {
  const id = await session();
  await send(id, publishText);
  const model = publishModel();
  await runAIJobs(repo, codec, model, safety, { clock: () => now });
  const original = repo.rows<{ _id: string; active_submission_id: string }>('demands')[0];
  repo.seed('files', {
    _id: 'photo-1',
    owner_id: 'owner',
    purpose: 'demand',
    mime: 'image/png',
    size: 10,
    cloud_file_id: 'cloud://private/photo',
    content_hash: 'a'.repeat(64),
    check_status: 'pass',
    state: 'active',
    storage_mode: 'immutable_private',
    ref_count: 0,
    created_at: now,
  });
  const result = await call('sendMessage', {
    session_id: id,
    client_message_id: randomUUID(),
    content: '帮我把照片补充到刚才的需求附件里面',
    attachment_ids: ['photo-1'],
  });
  expect(result.code).toBe(0);
  await runAIJobs(repo, codec, model, safety, { clock: () => now });
  const updated = await repo.get<any>('demands', original._id);
  expect(updated.status).toBe('pending_audit');
  expect(updated.form.attachments).toEqual([{ file_id: 'photo-1', usage: 'image' }]);
  expect(updated.active_submission_id).not.toBe(original.active_submission_id);
  expect(await repo.get('demand_submissions', original.active_submission_id)).toMatchObject({
    status: 'withdrawn',
  });
  expect(await repo.get('demand_submissions', updated.active_submission_id)).toMatchObject({
    status: 'pending',
  });
  expect(repo.rows<any>('file_bindings')).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        file_id: 'photo-1',
        resource_type: 'demand',
        resource_id: original._id,
      }),
    ]),
  );
});
it('rejects another user’s image before it can be used in an AI demand', async () => {
  const id = await session();
  repo.seed('files', {
    _id: 'other-photo',
    owner_id: 'other',
    purpose: 'demand',
    mime: 'image/png',
    size: 10,
    cloud_file_id: 'cloud://private/photo',
    content_hash: 'a'.repeat(64),
    check_status: 'pass',
    state: 'active',
    storage_mode: 'immutable_private',
    ref_count: 0,
    created_at: now,
  });
  const result = await call('sendMessage', {
    session_id: id,
    client_message_id: randomUUID(),
    content: '帮我把照片补充到需求附件',
    attachment_ids: ['other-photo'],
  });
  expect(result.error_code).toBe('FORBIDDEN');
  expect(repo.rows('demands')).toHaveLength(0);
});
it('does not change a submitted demand if the owner’s grant is revoked before image processing', async () => {
  const id = await session();
  await send(id, publishText);
  const model = publishModel();
  await runAIJobs(repo, codec, model, safety, { clock: () => now });
  const original = repo.rows<any>('demands')[0];
  repo.seed('files', {
    _id: 'photo-2',
    owner_id: 'owner',
    purpose: 'demand',
    mime: 'image/png',
    size: 10,
    cloud_file_id: 'cloud://private/photo',
    content_hash: 'a'.repeat(64),
    check_status: 'pass',
    state: 'active',
    storage_mode: 'immutable_private',
    ref_count: 0,
    created_at: now,
  });
  expect(
    (
      await call('sendMessage', {
        session_id: id,
        client_message_id: randomUUID(),
        content: '帮我把照片补充到刚才的需求附件里面',
        attachment_ids: ['photo-2'],
      })
    ).code,
  ).toBe(0);
  const grant = await repo.get<any>('role_grants', 'g-owner');
  repo.seed('role_grants', { ...grant, status: 'revoked', revoked_at: now });
  await runAIJobs(repo, codec, model, safety, { clock: () => now });
  const after = await repo.get<any>('demands', original._id);
  expect(after.active_submission_id).toBe(original.active_submission_id);
  expect(after.form.attachments ?? []).toEqual([]);
  expect(await repo.get('demand_submissions', original.active_submission_id)).toMatchObject({
    status: 'pending',
  });
});
it('does not guess a target when a conversation has multiple previously submitted demands', async () => {
  const id = await session();
  const model = publishModel();
  await send(id, publishText);
  await runAIJobs(repo, codec, model, safety, { clock: () => now });
  await send(id, publishText);
  await runAIJobs(repo, codec, model, safety, { clock: () => now });
  expect(repo.rows('demands')).toHaveLength(2);
  repo.seed('files', {
    _id: 'photo-3',
    owner_id: 'owner',
    purpose: 'demand',
    mime: 'image/png',
    size: 10,
    cloud_file_id: 'cloud://private/photo',
    content_hash: 'a'.repeat(64),
    check_status: 'pass',
    state: 'active',
    storage_mode: 'immutable_private',
    ref_count: 0,
    created_at: now,
  });
  expect(
    (
      await call('sendMessage', {
        session_id: id,
        client_message_id: randomUUID(),
        content: '帮我把照片补充到需求附件里面',
        attachment_ids: ['photo-3'],
      })
    ).code,
  ).toBe(0);
  await runAIJobs(repo, codec, model, safety, { clock: () => now });
  for (const d of repo.rows<any>('demands')) expect(d.form.attachments ?? []).toEqual([]);
  const answers = repo
    .rows<any>('ai_messages')
    .filter((m) => m.role === 'assistant')
    .map((m) => codec.open(m.sealed_content));
  expect(answers.some((answer) => typeof answer === 'string' && answer.includes('具体需求'))).toBe(
    true,
  );
});
it('does not bind a non-image file as a demand image even when it has demand purpose', async () => {
  const id = await session();
  const model = publishModel();
  await send(id, publishText);
  await runAIJobs(repo, codec, model, safety, { clock: () => now });
  const original = repo.rows<any>('demands')[0];
  repo.seed('files', {
    _id: 'document',
    owner_id: 'owner',
    purpose: 'demand',
    mime: 'application/pdf',
    size: 10,
    cloud_file_id: 'cloud://private/document',
    content_hash: 'a'.repeat(64),
    check_status: 'pass',
    state: 'active',
    storage_mode: 'immutable_private',
    ref_count: 0,
    created_at: now,
  });
  expect(
    (
      await call('sendMessage', {
        session_id: id,
        client_message_id: randomUUID(),
        content: '帮我把图片补充到需求附件',
        attachment_ids: ['document'],
      })
    ).code,
  ).toBe(0);
  await runAIJobs(repo, codec, model, safety, { clock: () => now });
  const after = await repo.get<any>('demands', original._id);
  expect(after.active_submission_id).toBe(original.active_submission_id);
  expect(after.form.attachments ?? []).toEqual([]);
  expect(await repo.get('demand_submissions', original.active_submission_id)).toMatchObject({
    status: 'pending',
  });
});
it('scopes a worker to one requested job and refuses tools outside its offered list', async () => {
  const first = await send(await session(), publishText);
  const selected = await send(await session(), publishText);
  const model = publishModel();
  await runAIJobs(repo, codec, model, safety, {
    clock: () => now,
    jobId: selected.job_id,
    allowedToolNames: ['submit_my_demand'],
  });
  expect(await repo.get('ai_jobs', first.job_id)).toMatchObject({ status: 'queued' });
  expect(await repo.get('ai_jobs', selected.job_id)).toMatchObject({ status: 'failed' });
  expect(repo.rows('demands')).toEqual([]);
  expect(repo.rows('ai_draft_proposals')).toEqual([]);
  const tool = repo.rows<{ _id: string; result_ciphertext: string }>('ai_tool_receipts')[0];
  expect(codec.open(tool.result_ciphertext)).toMatchObject({ ok: false, error_code: 'FORBIDDEN' });
});
it.each([
  { scene: 'village', mode: 'user' },
  { scene: 'village', mode: 'team' },
  { scene: 'campus', mode: 'user' },
  { scene: 'campus', mode: 'team' },
] as const)(
  'completes $scene $mode fulfillment with a DeepSeek response mock',
  async ({ scene, mode }) => {
    const campus = scene === 'campus';
    if (campus) seedIdentity(repo, 'owner', 'teacher_student', now);
    seedIdentity(repo, 'admin', campus ? 'super_admin' : 'local_admin', now);
    seedIdentity(repo, 'provider', 'teacher_student', now);
    let nextTool: { name: string; args: unknown };
    const generateText = vi.fn(
      async (input: Parameters<ReturnType<CloudAI['createModel']>['generateText']>[0]) => {
        const routing = input.tools[0]?.function.name === 'route_turn';
        expect(input).toMatchObject({
          model: 'deepseek-flash',
          thinking: { type: 'disabled' },
          maxSteps: 1,
          max_tokens: 2048,
        });
        if (routing)
          expect(input.tool_choice).toEqual({ type: 'function', function: { name: 'route_turn' } });
        else expect(input.tool_choice).toBeUndefined();
        const reply = output(
          '',
          routing
            ? {
                name: 'route_turn',
                args: { business_text: input.messages.at(-1)?.content, general_text: null },
              }
            : nextTool,
        );
        return {
          text: reply.text,
          usage: reply.usage,
          messages: [
            ...input.messages,
            { role: 'assistant', content: null, tool_calls: reply.tool_calls },
          ],
        };
      },
    );
    const createModel = vi.fn(() => ({ generateText }));
    const model = cloudBaseModelProvider({ createModel }, deepSeekConfig);
    const ownerSession = await session();
    const serviceSession = async (actor: string) => {
      const created = await call('createSession', { mode: 'assistant' }, actor);
      expect(created.code).toBe(0);
      return (created.data as { session_id: string }).session_id;
    };
    const providerSessionId = await serviceSession('provider');
    const invoke = (
      service: 'demandService' | 'teamService',
      action: string,
      data: unknown,
      actor: string,
    ) =>
      handler(
        service,
        {
          api_version: 'v1',
          request_id: randomUUID(),
          action,
          data,
          grant_id: 'g-' + actor,
          idempotency_key: randomUUID(),
        },
        actor,
        now,
      );
    const demandCall = (action: string, data: unknown, actor = 'owner') =>
      invoke('demandService', action, data, actor);
    let teamId: string | undefined;
    if (mode === 'team') {
      seedIdentity(repo, 'teammate', 'teacher_student', now);
      const team = await invoke('teamService', 'createTeam', { name: '履约测试团队' }, 'provider');
      expect(team.code).toBe(0);
      teamId = (team.data as { team_id: string }).team_id;
      const invite = await invoke(
        'teamService',
        'inviteMember',
        {
          team_id: teamId,
          expected_version: 1,
          invitee_code: 'teammate',
        },
        'provider',
      );
      expect(invite.code).toBe(0);
      expect(
        await invoke(
          'teamService',
          'respondInvitation',
          {
            invitation_id: (invite.data as { invitation_id: string }).invitation_id,
            expected_version: 1,
            decision: 'accept',
          },
          'teammate',
        ),
      ).toMatchObject({ code: 0 });
    }
    const runTurn = async (
      actor: string,
      sessionId: string,
      content: string,
      tool: typeof nextTool,
    ) => {
      nextTool = tool;
      const queued = await call(
        'sendMessage',
        {
          session_id: sessionId,
          client_message_id: randomUUID(),
          content,
        },
        actor,
      );
      expect(queued.code).toBe(0);
      expect(await runAIJobs(repo, codec, model, safety, { clock: () => now })).toMatchObject({
        succeeded: 1,
      });
    };
    const scenarioDraft = campus
      ? {
          ...draft,
          type: 'campus',
          sub_type: 'technical_support',
          title: '活动设备协助',
          content: '需要同学协助完成校园活动设备调试和现场检查',
          location_text: '测试教学楼',
        }
      : draft;
    const scenarioText = campus
      ? `帮我发布校园任务。标题：${scenarioDraft.title}；内容：${scenarioDraft.content}；位置：${scenarioDraft.location_text}；联系人：张三；电话：13800138000。`
      : publishText;
    await runTurn('owner', ownerSession, scenarioText, {
      name: 'save_demand_proposal',
      args: { draft: scenarioDraft },
    });
    const demand = repo.rows('demands')[0];
    const demand_id = demand._id;
    const submission = repo.rows('demand_submissions')[0];
    expect(demand).toMatchObject({
      status: 'pending_audit',
      owner_id: 'owner',
      business_scene: scene,
    });
    expect(
      await demandCall(
        'review',
        {
          demand_id,
          expected_version: 1,
          submission_id: submission._id,
          revision: 1,
          decision: 'approve',
        },
        'admin',
      ),
    ).toMatchObject({ code: 0 });
    const claimText =
      `帮我接取任务 ${demand_id}` + (teamId ? `，团队 ${teamId}，成员 provider 和 teammate` : '');
    await runTurn('provider', providerSessionId, claimText, {
      name: 'claim_my_demand',
      args: {
        demand_id,
        assignee_type: mode,
        ...(teamId && { team_id: teamId, participant_user_ids: ['provider', 'teammate'] }),
      },
    });
    expect(await repo.get('demands', demand_id)).toMatchObject({ status: 'claiming' });
    const claim_id = repo.rows('demand_claims')[0]._id;
    expect(
      (
        await demandCall('confirmClaim', {
          demand_id,
          expected_version: 3,
          claim_id,
          decision: 'accept',
        })
      ).code,
    ).toBe(0);
    const text = '已完成设备检查';
    const progressActor = teamId ? 'teammate' : 'provider';
    const progressSession = teamId ? await serviceSession(progressActor) : providerSessionId;
    await runTurn(progressActor, progressSession, `帮我记录进度 ${demand_id} ${text}`, {
      name: 'add_my_progress',
      args: { demand_id, kind: 'note', text },
    });
    expect(await repo.get('demands', demand_id)).toMatchObject({
      status: 'processing',
      version: 5,
    });
    const summary = campus ? '已完成校园活动设备调试' : '已完成测试田地的播种';
    await runTurn('provider', providerSessionId, `帮我提交成果 ${demand_id} ${summary}`, {
      name: 'submit_my_completion',
      args: { demand_id, summary },
    });
    expect(await repo.get('demands', demand_id)).toMatchObject({ status: 'pending_review' });
    const completion_id = repo.rows('demand_completions')[0]._id;
    const review = { demand_id, expected_version: 6, completion_id, decision: 'accept' };
    expect((await demandCall('reviewCompletion', review, 'provider')).code).toBe(404);
    expect((await demandCall('reviewCompletion', review)).code).toBe(0);
    expect(await repo.get('demands', demand_id)).toMatchObject({ status: 'completed' });
    expect(createModel).toHaveBeenCalledWith('yzxz-deepseek');
    expect(generateText).toHaveBeenCalledTimes(8);
    expect(repo.rows<AIIntent>('ai_action_intents').map(({ status }) => status)).toEqual(
      Array(4).fill('executed'),
    );
  },
);
it.each([401, 402, 422])('fails closed without retrying a DeepSeek %s response', async (status) => {
  const id = await session();
  const { job_id } = await send(id, '查询任务状态');
  const generateText = vi.fn(async () => {
    throw { status };
  });
  const model = cloudBaseModelProvider({ createModel: () => ({ generateText }) }, deepSeekConfig);
  expect(await runAIJobs(repo, codec, model, safety, { clock: () => now })).toMatchObject({
    failed: 1,
  });
  expect(await repo.get('ai_jobs', job_id)).toMatchObject({ error_code: 'MODEL_AUTH_FAILED' });
  expect(generateText).toHaveBeenCalledTimes(1);
});
it('cancellation before tool execution prevents a draft or a demand even if the model returns a write call', async () => {
  const id = await session();
  await send(id, publishText);
  const intent = repo.rows<AIIntent>('ai_action_intents')[0];
  let cancelled = false;
  const model = publishModel(async () => {
    if (!cancelled) {
      cancelled = true;
      expect(
        (
          await call('cancelPendingIntent', {
            intent_id: intent._id,
            expected_version: intent.version,
          })
        ).code,
      ).toBe(0);
    }
  });
  await runAIJobs(repo, codec, model, safety, { clock: () => now });
  expect(repo.rows('demands')).toEqual([]);
  expect(repo.rows('ai_draft_proposals')).toEqual([]);
  expect(repo.rows<AIIntent>('ai_action_intents')[0].status).toBe('cancelled');
});
it('deleting a session stops reading and execution while retaining a completed business receipt', async () => {
  const id = await session();
  await send(id, publishText);
  await runAIJobs(repo, codec, publishModel(), safety, { clock: () => now });
  expect((await call('deleteSession', { session_id: id })).code).toBe(0);
  expect((await call('listMessages', { session_id: id })).code).toBe(404);
  expect(repo.rows('demands')).toHaveLength(1);
  expect(repo.rows<AIIntent>('ai_action_intents')[0].status).toBe('executed');
});
it('does not treat tutorials, drafting requests or quoted examples as write authorization', () => {
  for (const text of [
    '如何发布需求',
    '帮我写成果草稿',
    '例如帮我发布一条需求',
    '如果发布需求要怎么做',
    '不要提交成果',
    '帮我发布一个需求，但先别提交',
    '帮我发布需求，等我确认后再提交',
    '帮我接取任务，但不要接取',
    '帮我提交成果，仅预览',
    '帮我发布一个任务，只写草稿',
  ])
    expect(explicitAction(text)).toBeNull();
  expect(explicitAction('帮我发布无人机需求')).toBe('submit_my_demand');
  expect(explicitAction('请帮我发布无人机需求')).toBe('submit_my_demand');
  expect(explicitAction('请帮我接取这个任务')).toBe('claim_my_demand');
});
it('cancels a pending publishing intent when supplementary details withdraw permission', async () => {
  const id = await session();
  await send(id, '帮我发布无人机需求');
  const queued = repo.rows<AIJob>('ai_jobs')[0];
  repo.seed('ai_jobs', { ...queued, status: 'failed' });
  const current = repo.rows<{ _id: string; active_job_id: string | null }>('ai_sessions')[0];
  repo.seed('ai_sessions', { ...current, active_job_id: null });
  const followup = await send(id, '联系人是测试用户，但先不要发布');
  expect(repo.rows<AIIntent>('ai_action_intents')).toHaveLength(1);
  expect(repo.rows<AIIntent>('ai_action_intents')[0].status).toBe('cancelled');
  expect(await repo.get('ai_jobs', followup.job_id)).toMatchObject({ intent_id: null });
});
it('rechecks role revocation immediately before a proposed demand is submitted', async () => {
  const id = await session();
  await send(id, publishText);
  const model = publishModel(async () => {
    const grant = await repo.get<{ _id: string }>('role_grants', 'g-owner');
    repo.seed('role_grants', { ...grant!, status: 'revoked', revoked_at: now });
  });
  await runAIJobs(repo, codec, model, safety, { clock: () => now });
  expect(repo.rows('demands')).toEqual([]);
  expect(repo.rows<AIIntent>('ai_action_intents')[0].status).not.toBe('executed');
});
it('limits a failed logical model request to three attempts across repeated worker runs', async () => {
  const id = await session();
  await send(id, '介绍一下李白');
  const model = fake(async () => {
    throw new BusinessError(503, 'MODEL_TIMEOUT', '超时');
  });
  await runAIJobs(repo, codec, model, safety, { clock: () => now });
  await runAIJobs(repo, codec, model, safety, { clock: () => now + 120001 });
  expect(model.generate).toHaveBeenCalledTimes(3);
  expect((await getQuota(repo, 'owner', now)).used).toBe(0);
});
