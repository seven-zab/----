import { randomUUID } from 'node:crypto';
import type { Repository } from './core/repository';
import { BusinessError, ensure } from './core/errors';
import { parseRequest, validateResponse, type Response } from './core/request';
import { createUserService } from './modules/user/service';
import { createDemandService } from './modules/demand/service';
import type { PrivateDataCodec } from './core/private-data';
import type { ContentSafety } from './adapters/content-safety';
import { createTeamService } from './modules/team/service';
import { createFileService, type FileProvider } from './modules/file/service';
import { createPolicyService } from './modules/policy/service';
import { createNotificationService } from './modules/notification/service';
import release from '../contracts/generated/release.json';
import { createChatService } from './modules/chat/service';
import { reserveWrite } from './core/rate-limit';
import { createStatsService } from './modules/stats/service';
import { migrationReadiness } from './core/readiness';
import { createKnowledgeService } from './modules/knowledge/service';
import { createAIService } from './modules/ai/service';
import { createMaintenanceService } from './modules/maintenance/service';

export function createHandler(
  repo: Repository,
  codec: PrivateDataCodec,
  safety?: ContentSafety,
  files?: FileProvider,
  options: {
    aiAvailable?: boolean;
    generateExport?: (id: string, now: number) => Promise<unknown>;
  } = {},
) {
  const services = {
    userService: createUserService(repo, codec),
    demandService: createDemandService(repo, codec, safety),
    teamService: createTeamService(repo),
    fileService: createFileService(repo, files),
    policyService: createPolicyService(repo, safety, files),
    notificationService: createNotificationService(repo),
    statsService: createStatsService(repo, options.generateExport),
    knowledgeService: createKnowledgeService(repo, safety),
    aiService: createAIService(repo, codec, options.aiAvailable),
    maintenanceService: createMaintenanceService(repo),
    chatService: createChatService(repo, safety),
    contactService: {
      read: (
        openid: string,
        request: Parameters<ReturnType<typeof createChatService>['read']>[1],
        now: number,
      ) => createChatService(repo, safety).read(openid, { ...request, action: 'listMine' }, now),
      write: async () => {
        throw new BusinessError(400, 'UNKNOWN_ACTION', '未知业务动作');
      },
    },
  };
  return async (
    fn: keyof typeof services,
    input: unknown,
    openid: string,
    now = Date.now(),
  ): Promise<Response<unknown>> => {
    let requestId: string = randomUUID();
    try {
      const parsed = parseRequest(fn, input);
      requestId = parsed.request.request_id;
      ensure(parsed.public || openid, 'UNAUTHENTICATED', '请先登录', 401);
      if (parsed.request.action === 'getRelease') {
        const data = { api_version: 'v1', service: fn, source_hash: release.source_hash };
        validateResponse(parsed.route, data);
        return { code: 0, error_code: null, msg: '成功', request_id: requestId, data };
      }
      if (fn === 'userService' && parsed.request.action === 'getReadiness') {
        const data = await migrationReadiness(repo);
        validateResponse(parsed.route, data);
        return { code: 0, error_code: null, msg: '成功', request_id: requestId, data };
      }
      const service = services[fn];
      if (parsed.write) {
        const migration = await migrationReadiness(repo);
        ensure(
          migration.state !== 'unavailable',
          'DEPENDENCY_UNAVAILABLE',
          '无法核验数据库迁移状态，暂不允许写入',
          503,
        );
        ensure(
          migration.migration_verified,
          'MIGRATION_REQUIRED',
          '测试环境尚未完成迁移核验，暂不允许写入',
          503,
        );
        await reserveWrite(repo, openid, fn, parsed.request, now);
      }
      const data = await (parsed.write ? service.write : service.read)(openid, parsed.request, now);
      validateResponse(parsed.route, data);
      return { code: 0, error_code: null, msg: '成功', request_id: requestId, data };
    } catch (error) {
      if (error instanceof BusinessError)
        return {
          code: error.code,
          error_code: error.error_code,
          msg: error.message,
          request_id: requestId,
          data: null,
        };
      // Do not serialize SDK errors or raw events containing personal data.
      return {
        code: 500,
        error_code: 'INTERNAL_ERROR',
        msg: '服务暂时不可用，请凭请求编号重试',
        request_id: requestId,
        data: null,
      };
    }
  };
}
