import { randomUUID } from 'node:crypto';
import { deepSeekModelProvider, type ModelInput } from '../adapters/model';
import { WechatTextCheckError, type ContentSafety } from '../adapters/content-safety';
import { resolveUser } from '../core/command';
import type { Grant, User } from '../core/entities';
import { BusinessError, ensure } from '../core/errors';
import { privateDataCodec } from '../core/private-data';
import type { Entity, Repository } from '../core/repository';
import { migrationReadiness } from '../core/readiness';
import { createAIService } from '../modules/ai/service';
import type { Demand } from '../modules/demand/service';
import type { ContractMap } from '../../contracts/generated/dto';
import { runAIJobs } from './ai-jobs';

type ProbeResult =
  | { passed: true; total_tokens: number }
  | { passed: true; model_calls: number; pending_audit: true }
  | { passed: false; error_code: string; model_calls?: number; wechat_code?: number };
interface ProbeReceipt extends Entity {
  status: 'reserved' | 'passed' | 'failed';
  created_at: number;
  results?: ProbeResult[];
}

export async function runDeepSeekAcceptance(
  repo: Repository,
  environment: string,
  config: NodeJS.ProcessEnv,
  now = Date.now(),
  safety?: ContentSafety,
) {
  let scope;
  try {
    scope = JSON.parse(config.AI_MODEL_ACCEPTANCE_SCOPE ?? '');
  } catch {
    throw new BusinessError(503, 'DEPENDENCY_UNAVAILABLE', '模型验收范围格式无效');
  }
  ensure(
    scope?.env_id === environment &&
      environment.length > 0 &&
      typeof scope.id === 'string' &&
      /^ai-probe:[a-f0-9-]{36}$/u.test(scope.id) &&
      Number.isSafeInteger(scope.expires_at) &&
      scope.expires_at > now &&
      scope.expires_at - now <= 10 * 60000 &&
      config.JOBS_ENABLED !== 'true' &&
      config.AI_JOBS_ENABLED !== 'true',
    'FORBIDDEN',
    '模型验收范围无效或常规作业未关闭',
  );
  const model = deepSeekModelProvider(config);
  ensure(
    model.isConfigured && (await migrationReadiness(repo)).migration_verified,
    'DEPENDENCY_UNAVAILABLE',
    '模型验收前置条件未满足',
    503,
  );
  const id = scope.id as string;
  const ownerId: unknown = scope.workflow_owner_id;
  ensure(
    ownerId === undefined ||
      (typeof ownerId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/u.test(ownerId)),
    'FORBIDDEN',
    '模型业务验收账号无效',
  );
  const reserved = await repo.transaction(async (tx) => {
    if (await tx.get('job_runs', id)) return false;
    await tx.put<ProbeReceipt>('job_runs', { _id: id, status: 'reserved', created_at: now });
    return true;
  });
  if (!reserved) return { state: 'already_reserved' };
  if (ownerId) {
    let result: ProbeResult;
    let calls = 0;
    let wechatCode: number | null = null;
    const observedSafety: ContentSafety | undefined = safety && {
      async checkText(openid, text) {
        try {
          return await safety.checkText(openid, text);
        } catch (error) {
          if (error instanceof WechatTextCheckError) wechatCode = error.providerCode;
          throw error;
        }
      },
    };
    try {
      const owner = await repo.get<User>('users', ownerId);
      ensure(
        owner?._openid &&
          (await repo.transaction((tx) => resolveUser(tx, owner._openid)))?._id === ownerId,
        'FORBIDDEN',
        '验收账号与真实微信映射不一致',
      );
      const grants = await repo.find<Grant>(
        'role_grants',
        { user_id: ownerId, role: 'super_admin', status: 'active' },
        2,
      );
      ensure(
        grants.length === 1 && (grants[0].expires_at === null || grants[0].expires_at > now),
        'FORBIDDEN',
        '验收账号的管理身份不可用',
      );
      const codec = privateDataCodec(config.PRIVATE_DATA_KEY);
      const service = createAIService(repo, codec, true);
      const request = (action: string, data: unknown) =>
        ({
          api_version: 'v1',
          request_id: randomUUID(),
          idempotency_key: randomUUID(),
          grant_id: grants[0]._id,
          action,
          data,
        } as const);
      const session = (await service.write(
        owner._openid,
        request('createSession', { mode: 'assistant' }),
        now,
      )) as ContractMap['aiService.createSession']['response'];
      const title = 'AI合成联调校园设备' + id.slice(9, 17);
      const content = `帮我发布校园技术支持需求。标题：${title}；内容：需要同学协助完成模拟设备调试和现场检查；位置：测试教学楼；联系人：测试联系人；电话：13800138000。`;
      const queued = (await service.write(
        owner._openid,
        request('sendMessage', {
          session_id: session.session_id,
          client_message_id: randomUUID(),
          content,
        }),
        now,
      )) as ContractMap['aiService.sendMessage']['response'];
      await runAIJobs(
        repo,
        codec,
        {
          isConfigured: true,
          generate: (input) => {
            ensure(
              calls < 8 && Date.now() < scope.expires_at,
              'RATE_LIMITED',
              '模型验收调用额度已用完',
              429,
            );
            calls++;
            return model.generate(input);
          },
        },
        observedSafety,
        {
          jobId: queued.job_id,
          batchSize: 1,
          dailyModelRequestLimit: 8,
          allowedToolNames: ['save_demand_proposal', 'submit_my_demand'],
        },
      );
      const view = (await service.read(
        owner._openid,
        request('getJob', { job_id: queued.job_id }),
        Date.now(),
      )) as ContractMap['aiService.getJob']['response'];
      const operation = view.operation_result;
      ensure(
        view.status === 'succeeded' && operation?.status === 'executed' && operation.demand_id,
        view.error_code ?? 'MODEL_UNAVAILABLE',
        '模型业务流程未完成',
        503,
      );
      const demand = await repo.get<Demand>('demands', operation.demand_id);
      ensure(
        demand?.owner_id === ownerId &&
          demand.form.title === title &&
          demand.business_scene === 'campus' &&
          demand.status === 'pending_audit' &&
          demand.visibility === 'hidden' &&
          demand.public_listing === false,
        'STATE_CONFLICT',
        '合成需求的业务状态或权限不一致',
        503,
      );
      result = { passed: true, model_calls: calls, pending_audit: true };
    } catch (error) {
      result = {
        passed: false,
        error_code: error instanceof BusinessError ? error.error_code : 'INTERNAL_ERROR',
        model_calls: calls,
        ...(wechatCode !== null && { wechat_code: wechatCode }),
      };
    }
    const status = result.passed ? 'passed' : 'failed';
    await repo.transaction((tx) =>
      tx.put<ProbeReceipt>('job_runs', { _id: id, status, results: [result], created_at: now }),
    );
    return { state: status };
  }

  const text: ModelInput = {
    messages: [{ role: 'user', content: '合成联调。请只回答：收到。' }],
    tools: [],
  };
  const route: ModelInput = {
    messages: [
      { role: 'user', content: '合成联调。请调用 route_probe，参数 marker 填 synthetic。' },
    ],
    tools: [
      {
        type: 'function',
        function: {
          name: 'route_probe',
          description: '仅回传合成标记',
          parameters: {
            type: 'object',
            properties: { marker: { type: 'string', enum: ['synthetic'] } },
            required: ['marker'],
            additionalProperties: false,
          },
        },
      },
    ],
    required_tool: 'route_probe',
  };
  const results: ProbeResult[] = [];
  try {
    const first = await model.generate(text);
    ensure(first.text.trim() && !first.tool_calls.length, 'MODEL_UNAVAILABLE', '文本验证失败', 503);
    results.push({ passed: true, total_tokens: first.usage.total_tokens });
    const second = await model.generate(route);
    const call = second.tool_calls[0];
    ensure(
      second.tool_calls.length === 1 &&
        call.function.name === 'route_probe' &&
        JSON.parse(call.function.arguments)?.marker === 'synthetic',
      'MODEL_UNAVAILABLE',
      '工具验证失败',
      503,
    );
    results.push({ passed: true, total_tokens: second.usage.total_tokens });
  } catch (error) {
    results.push({
      passed: false,
      error_code: error instanceof BusinessError ? error.error_code : 'MODEL_UNAVAILABLE',
    });
  }
  const status = results.length === 2 && results.every((r) => r.passed) ? 'passed' : 'failed';
  await repo.transaction(async (tx) => {
    await tx.put<ProbeReceipt>('job_runs', { _id: id, status, results, created_at: now });
  });
  return { state: status };
}
