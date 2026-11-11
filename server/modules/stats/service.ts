import type { Entity, QueryValue, Repository, Transaction } from '../../core/repository';
import type { Grant, Region, User } from '../../core/entities';
import { audit, resolveUser, runCommand, touchMigrationFence } from '../../core/command';
import { assertAccount, assertCanStartNewAction } from '../../core/policy';
import { ensure } from '../../core/errors';
import { hash } from '../../core/hash';
import { requestData, type CallRequest } from '../../core/request';
import type { Demand } from '../demand/service';
import {
  categories,
  inPeriod,
  overview,
  STATS_ALGORITHM,
  trend,
  type StatsQuery,
  type StatsScope,
  type ConfirmedParticipant,
} from './aggregate';
import { validateFields } from './report';
import { verifiedQuarantinedDemands } from '../../core/quarantine';

export interface ExportJob extends Entity {
  owner_id: string;
  grant_id: string;
  scope: StatsScope;
  format: 'csv' | 'xlsx';
  report: 'overview' | 'trend' | 'category';
  fields?: string[];
  status: 'pending' | 'running' | 'ready' | 'failed';
  file_id: string | null;
  expires_at: number | null;
  attempts: number;
  lease_until: number;
  lease_token: string | null;
  error_code: string | null;
  created_at: number;
  report_layout?: 'zh_summary';
}
export async function authorizeStats(
  tx: Transaction,
  openid: string,
  grantId: string | undefined,
  q: StatsQuery,
  now: number,
): Promise<{ user: User; grant: Grant; scope: StatsScope }> {
  ensure(
    q.start_at < q.end_at &&
      q.end_at - q.start_at <= 366 * 86400000 &&
      Number.isFinite(new Date(q.end_at + 8 * 3600000).getTime()),
    'VALIDATION_FAILED',
    '统计时间范围须大于0且不超过366天',
    400,
  );
  const user = await resolveUser(tx, openid);
  ensure(user, 'USER_NOT_INITIALIZED', '请先登录', 401);
  const grant = grantId ? await tx.get<Grant>('role_grants', grantId) : null;
  assertCanStartNewAction(user, grant, now);
  ensure(
    ['local_admin', 'super_admin'].includes(grant.role),
    'FORBIDDEN',
    '统计仅供有权管理身份使用',
  );
  ensure(
    !(q.campus_organization_id && q.scope_region_id),
    'VALIDATION_FAILED',
    '校园与村域筛选不能混用',
    400,
  );
  const scope: StatsScope = { ...q };
  if (q.campus_organization_id) {
    ensure(
      q.campus_organization_id === 'sztu' && q.business_scene !== 'village',
      'SCOPE_FORBIDDEN',
      '校园归属不匹配',
    );
    scope.business_scene = 'campus';
  }
  if (q.scope_region_id)
    ensure(q.business_scene !== 'campus', 'SCOPE_FORBIDDEN', '校园统计不使用村域归属');
  if (grant.role === 'local_admin') {
    ensure(
      scope.business_scene !== 'campus' && !q.campus_organization_id && grant.scope_region_id,
      'SCOPE_FORBIDDEN',
      '村委不能查询校园统计',
    );
    if (q.scope_region_id && q.scope_region_id !== grant.scope_region_id) {
      const region = await tx.get<Region>('regions', q.scope_region_id);
      ensure(
        region?.active && region.ancestor_ids.includes(grant.scope_region_id),
        'SCOPE_FORBIDDEN',
        '无权查询其他辖区',
      );
    }
    scope.scope_region_id = q.scope_region_id ?? grant.scope_region_id;
    scope.business_scene = 'village';
  }
  if (scope.scope_region_id) scope.business_scene = 'village';
  if (scope.business_scene === 'campus') scope.campus_organization_id = 'sztu';
  return { user, grant, scope };
}
async function scan<T extends Entity & { created_at: number }>(
  repo: Repository,
  collection: string,
  filter: Record<string, QueryValue>,
  max: number,
) {
  const rows: T[] = [];
  let after: { created_at: number; id: string } | undefined;
  for (;;) {
    const page = await repo.find<T>(collection, filter, 100, { newest: true, after });
    rows.push(...page);
    ensure(rows.length <= max, 'RATE_LIMITED', '统计候选过多，请缩小辖区或板块范围', 429);
    if (page.length < 100) return rows;
    const last = page[page.length - 1];
    after = { created_at: last.created_at, id: last._id };
  }
}
export async function collectStats(
  repo: Repository,
  scope: StatsScope,
  includeParticipants = true,
) {
  const filter: Record<string, QueryValue> = {};
  if (scope.business_scene) filter.business_scene = scope.business_scene;
  if (scope.scope_region_id) filter.region_path_ids = scope.scope_region_id;
  if (scope.campus_organization_id) filter.campus_organization_id = scope.campus_organization_id;
  if (scope.type) filter.type = scope.type;
  const [quarantined, candidates] = await Promise.all([
    verifiedQuarantinedDemands(repo),
    scan<Demand>(repo, 'demands', filter, 25000),
  ]);
  const demands = candidates.filter((d) => {
    if (quarantined.has(d._id)) return false;
    ensure(
      typeof d.owner_id === 'string' &&
        typeof d.created_by === 'string' &&
        d.form &&
        ['enterprise', 'agriculture', 'research', 'campus'].includes(d.form.type ?? '') &&
        (d.first_submitted_at === null || Number.isSafeInteger(d.first_submitted_at)) &&
        (d.first_approved_at === null || Number.isSafeInteger(d.first_approved_at)) &&
        (d.completed_at === null || Number.isSafeInteger(d.completed_at)),
      'MIGRATION_REQUIRED',
      '统计范围含未完成核验的历史数据，请先完成迁移对账',
      503,
    );
    return d.first_submitted_at !== null;
  });
  const participants: ConfirmedParticipant[] = [];
  if (!includeParticipants) return { demands, participants };
  for (const d of demands.filter((d) => inPeriod(d.first_submitted_at, scope))) {
    if (Array.isArray(d.confirmed_participant_user_ids)) {
      participants.push(
        ...d.confirmed_participant_user_ids.map((user_id) => ({ demand_id: d._id, user_id })),
      );
      continue;
    }
    const rows = await scan<
      Entity & ConfirmedParticipant & { created_at: number; confirmed_at: number }
    >(repo, 'claim_participants', { demand_id: d._id }, 5000);
    participants.push(...rows.filter((p) => typeof p.confirmed_at === 'number'));
  }
  return { demands, participants };
}
export function createStatsService(
  repo: Repository,
  generate?: (id: string, now: number) => Promise<unknown>,
) {
  async function write(openid: string, request: CallRequest, now: number) {
    const started = Date.now();
    const queued = (await runCommand(
      repo,
      openid,
      'statsService',
      request,
      async (ctx) => {
        const data = requestData('statsService.createExport', request);
        const { format, report, fields, ...q } = data;
        validateFields(report, fields);
        const { scope } = await authorizeStats(ctx.tx, openid, request.grant_id, q, now);
        const job: ExportJob = {
          _id: ctx.command_id,
          owner_id: ctx.user._id,
          grant_id: ctx.grant!._id,
          scope,
          format,
          report,
          ...(fields ? { fields } : {}),
          status: 'pending',
          file_id: null,
          expires_at: null,
          attempts: 0,
          lease_until: 0,
          lease_token: null,
          error_code: null,
          created_at: now,
        };
        await ctx.tx.put('export_jobs', job);
        await audit(ctx, job._id, '创建受辖区约束的统计导出任务');
        return { export_job_id: job._id, status: 'pending' };
      },
      now,
    )) as { export_job_id: string; status: 'pending' };
    if (!generate) return queued;
    // The command and its receipt are already committed. The timer can recover a
    // stalled or interrupted attempt without creating another logical export.
    const clock = () => now + Date.now() - started;
    try {
      await generate(queued.export_job_id, clock());
      return {
        export_job_id: queued.export_job_id,
        ...(await readExport(openid, request.grant_id, queued.export_job_id, clock())),
      };
    } catch {
      return queued;
    }
  }
  function readExport(
    openid: string,
    grantId: string | undefined,
    export_job_id: string,
    now: number,
  ) {
    return repo.transaction(async (tx) => {
      const requester = await resolveUser(tx, openid);
      ensure(requester, 'USER_NOT_INITIALIZED', '请先登录', 401);
      assertAccount(requester);
      const job = await tx.get<ExportJob>('export_jobs', export_job_id);
      ensure(job?.owner_id === requester._id, 'NOT_FOUND', '导出任务不存在', 404);
      const { user, scope } = await authorizeStats(tx, openid, grantId, job.scope, now);
      ensure(job.owner_id === user._id, 'NOT_FOUND', '导出任务不存在', 404);
      ensure(hash(scope) === hash(job.scope), 'SCOPE_FORBIDDEN', '当前管理身份不覆盖原导出范围');
      const layout = job.report_layout
        ? { report_layout: job.report_layout }
        : { regenerate: { report: job.report, query: scope } };
      if (job.expires_at !== null && job.expires_at <= now)
        return { status: 'failed', error_code: 'EXPORT_EXPIRED', ...layout };
      return {
        status: job.status,
        ...(job.status === 'ready' ? layout : {}),
        ...(job.file_id ? { file_id: job.file_id } : {}),
        ...(job.expires_at ? { expires_at: job.expires_at } : {}),
        ...(job.error_code ? { error_code: job.error_code } : {}),
      };
    });
  }
  async function read(openid: string, request: CallRequest, now: number) {
    if (request.action === 'getExport') {
      const { export_job_id } = requestData('statsService.getExport', request);
      return readExport(openid, request.grant_id, export_job_id, now);
    }
    const data: StatsQuery & { interval?: 'day' | 'week' | 'month' } =
      request.action === 'getTrend'
        ? requestData('statsService.getTrend', request)
        : request.action === 'getCategoryBreakdown'
        ? requestData('statsService.getCategoryBreakdown', request)
        : requestData('statsService.getOverview', request);
    const { interval, ...q } = data;
    const { scope } = await repo.transaction((tx) =>
      authorizeStats(tx, openid, request.grant_id, q, now),
    );
    const key = hash([scope, STATS_ALGORITHM]);
    type Snapshot = Entity & {
      generated_at: number;
      overview: ReturnType<typeof overview>;
      category: ReturnType<typeof categories>;
      trends: Record<'day' | 'week' | 'month', ReturnType<typeof trend>>;
    };
    let snapshot = await repo.get<Snapshot>('stats_snapshots', key);
    if (!snapshot || snapshot.generated_at + 5 * 60000 <= now) {
      const { demands, participants } = await collectStats(repo, scope);
      snapshot = {
        _id: key,
        generated_at: now,
        overview: overview(demands, participants, scope, now),
        category: categories(demands, scope),
        trends: {
          day: trend(demands, scope, 'day'),
          week: trend(demands, scope, 'week'),
          month: trend(demands, scope, 'month'),
        },
      };
      const result = snapshot;
      await repo.transaction(async (tx) => {
        await touchMigrationFence(tx);
        await authorizeStats(tx, openid, request.grant_id, q, now);
        await tx.put('stats_snapshots', result);
      });
    }
    await repo.transaction((tx) => authorizeStats(tx, openid, request.grant_id, q, now));
    return request.action === 'getTrend'
      ? snapshot.trends[interval ?? 'day']
      : request.action === 'getCategoryBreakdown'
      ? snapshot.category
      : snapshot.overview;
  }
  return { write, read };
}
