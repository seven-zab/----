import { cloudbaseRepository, type CloudDatabase } from './adapters/cloudbase-repository';
import { privateDataCodec } from './core/private-data';
import { wechatContentSafety, type WechatSecurityAPI } from './adapters/content-safety';
import {
  cloudBaseModelProvider,
  deepSeekModelProvider,
  MODEL_REQUEST_TIMEOUT_MS,
  type CloudAI,
} from './adapters/model';
import { migrationReadiness } from './core/readiness';
import { runBusinessJobs } from './maintenance/business-jobs';
import { runExportJobs } from './maintenance/export-jobs';
import { expireExportFiles, runFileDeletions } from './maintenance/storage-jobs';
import { runRetentionJobs } from './maintenance/retention-jobs';
import { runAIJobs } from './maintenance/ai-jobs';
import { runDeepSeekAcceptance } from './maintenance/ai-model-acceptance';
import { publishGeneratedKnowledge } from './modules/knowledge/service';
import apiKnowledge from '../contracts/generated/knowledge-api.json';
import { ensure } from './core/errors';
import { runStorageCleanupTasks } from './maintenance/storage-cleanup';
import { runSubscriptionJobs } from './maintenance/subscription-jobs';
import { fencedMaintenanceRepository } from './maintenance/fenced-repository';
import {
  businessAcceptanceScope,
  businessRuntimeEnvironment,
  isMaintenanceTimer,
  scopedAcceptanceRepository,
  recordAcceptanceRun,
  recordAcceptanceFailure,
} from './maintenance/acceptance-scope';
import { selectedBusinessStages, runSelectedBusinessStages } from './maintenance/business-stages';
import {
  subscriptionTemplates,
  subscriptionState,
  wechatSubscriptionSender,
  type WechatSubscribeAPI,
} from './adapters/subscription';
interface SDK {
  DYNAMIC_CURRENT_ENV: string;
  init(options: { env: string; timeout?: number }): void;
  database(options: { throwOnNotFound: boolean }): CloudDatabase;
  getWXContext(): { OPENID?: string; ENV?: string; SOURCE?: string };
  ai(): CloudAI;
  uploadFile(options: { cloudPath: string; fileContent: Buffer }): Promise<{ fileID: string }>;
  deleteFile(options: { fileList: string[] }): Promise<{ fileList: Array<{ status: number }> }>;
  openapi?: { security?: WechatSecurityAPI; subscribeMessage?: WechatSubscribeAPI };
}
const cloud = require('wx-server-sdk') as SDK;
declare const SERVICE_NAME: 'businessJobs' | 'aiJobs';
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
  // The pinned SDK's default model ignores per-call timeouts and uses its transport config.
  timeout: SERVICE_NAME === 'aiJobs' ? MODEL_REQUEST_TIMEOUT_MS : undefined,
});
const maintenanceRepository = () =>
  fencedMaintenanceRepository(cloudbaseRepository(cloud.database({ throwOnNotFound: false })));
/** No request-selected operation. Only platform-provided timer provenance is accepted. */
export async function main() {
  const context = cloud.getWXContext();
  ensure(
    isMaintenanceTimer(process.env.TRIGGER_SRC, {
      OPENID: context.OPENID,
      SOURCE: context.SOURCE ?? process.env.TCB_SOURCE,
    }),
    'FORBIDDEN',
    '维护函数仅允许平台定时触发',
  );
  if (SERVICE_NAME === 'aiJobs' && process.env.AI_MODEL_ACCEPTANCE_SCOPE)
    return runDeepSeekAcceptance(
      maintenanceRepository(),
      businessRuntimeEnvironment(context.ENV, process.env),
      process.env,
      Date.now(),
      wechatContentSafety(cloud.openapi?.security),
    );
  if (process.env.JOBS_ENABLED !== 'true') return { state: 'disabled' };
  const stages =
    SERVICE_NAME === 'businessJobs' ? selectedBusinessStages(process.env.BUSINESS_JOB_STAGES) : [];
  if (SERVICE_NAME === 'businessJobs' && stages.length === 0)
    return { state: 'business_stages_disabled' };
  const messageState = stages.includes('subscriptions')
    ? subscriptionState(process.env.NOTIFICATION_MINIPROGRAM_STATE)
    : undefined;
  const scope =
    SERVICE_NAME === 'businessJobs'
      ? businessAcceptanceScope(
          process.env.BUSINESS_JOB_ACCEPTANCE_SCOPE,
          businessRuntimeEnvironment(context.ENV, process.env),
          Date.now(),
          stages,
        )
      : null;
  const messageTemplates = stages.includes('subscriptions')
    ? subscriptionTemplates(process.env.NOTIFICATION_TEMPLATES)
    : [];
  if (scope && stages.includes('subscriptions'))
    ensure(
      messageState === 'developer' &&
        messageTemplates.some(
          (t) => t.key === 'task_status' && t.event_types.includes('acceptance_probe'),
        ),
      'DEPENDENCY_UNAVAILABLE',
      '验收仅允许已配置的开发版测试通知',
      503,
    );
  const base = maintenanceRepository();
  const repo = scope ? scopedAcceptanceRepository(base, scope) : base;
  const readiness = await migrationReadiness(repo);
  if (!readiness.migration_verified) return { state: 'migration_required' };
  if (SERVICE_NAME === 'aiJobs') {
    if (process.env.AI_JOBS_ENABLED !== 'true') return { state: 'ai_disabled' };
    const model =
      process.env.AI_PROVIDER === 'deepseek'
        ? deepSeekModelProvider(process.env)
        : cloudBaseModelProvider(cloud.ai(), process.env);
    if (!model.isConfigured) return { state: 'model_unavailable' };
    return runAIJobs(
      repo,
      privateDataCodec(process.env.PRIVATE_DATA_KEY),
      model,
      wechatContentSafety(cloud.openapi?.security),
      {
        batchSize: 1,
        dailyModelRequestLimit: Number(process.env.AI_ENV_DAILY_REQUEST_LIMIT ?? 100),
      },
    );
  }
  const now = Date.now();
  const storage = {
    async upload(path: string, bytes: Buffer) {
      ensure(
        process.env.PRIVATE_STORAGE_READY === 'true',
        'DEPENDENCY_UNAVAILABLE',
        '尚未核验私有存储规则，不能生成导出',
        503,
      );
      const r = await cloud.uploadFile({ cloudPath: path, fileContent: bytes });
      ensure(r.fileID, 'DEPENDENCY_UNAVAILABLE', '导出上传未返回文件编号', 503);
      return r.fileID;
    },
    async remove(fileId: string) {
      const r = await cloud.deleteFile({ fileList: [fileId] });
      ensure(
        r.fileList.length === 1 && r.fileList[0].status === 0,
        'DEPENDENCY_UNAVAILABLE',
        '文件删除失败',
        503,
      );
    },
  };
  const result = await runSelectedBusinessStages(stages, {
    knowledge: () =>
      publishGeneratedKnowledge(repo, apiKnowledge.body_text, apiKnowledge.source_hash, now),
    claims: () => runBusinessJobs(repo, now, 50, ['claims']),
    demands: () => runBusinessJobs(repo, now, 50, ['demands']),
    completions: () => runBusinessJobs(repo, now, 50, ['completions']),
    inbox: () => runBusinessJobs(repo, now, 50, ['outbox']),
    exports: () => runExportJobs(repo, storage, now),
    expire_exports: () => expireExportFiles(repo, now),
    retention: () => runRetentionJobs(repo, now),
    file_deletions: () => runFileDeletions(repo, storage, now),
    orphan_copies: () => runStorageCleanupTasks(repo, storage, now),
    subscriptions: () =>
      runSubscriptionJobs(
        repo,
        wechatSubscriptionSender(cloud.openapi?.subscribeMessage, messageState),
        messageTemplates,
        now,
      ),
  }).catch(async (error: unknown) => {
    if (scope) await recordAcceptanceFailure(repo, Date.now(), error);
    throw error;
  });
  if (scope) await recordAcceptanceRun(repo, now, result);
  return result;
}
