// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { createHandler } from '../../server/handler';
import { MemoryRepository } from '../helpers/memory-repository';
import { privateDataCodec } from '../../server/core/private-data';
import { userIdentityId } from '../../server/core/command';
import { hash } from '../../server/core/hash';
import type { Grant, User } from '../../server/core/entities';
import type { Demand } from '../../server/modules/demand/service';
import type { ContractMap } from '../../contracts/generated/dto';
import { overview, trend } from '../../server/modules/stats/aggregate';
import { buildReport, renderCsv, renderXlsx } from '../../server/modules/stats/report';
import {
  runExportJobs,
  runImmediateExport,
  type ExportStorage,
} from '../../server/maintenance/export-jobs';
import type { ExportJob } from '../../server/modules/stats/service';
import { scopedExportRepository } from '../../scripts/lib/scoped-export-repository';
import {
  expireExportFiles,
  runFileDeletions,
  retentionGuardId,
} from '../../server/maintenance/storage-jobs';
const now = Date.UTC(2026, 9, 27);
const q = { start_at: now - 86400000, end_at: now + 86400000 };
const exportUrl = (path: string) => `cloud://test-bucket/${path}`;
let repo: MemoryRepository;
let handle: ReturnType<typeof createHandler>;
const access = vi.fn(async () => ({ url: 'https://example.test/private', max_age: 300 }));
function seed(id: string, role: Grant['role'] = 'local_admin', region = 'a') {
  repo.seed<User>('users', {
    _id: id,
    _openid: id,
    user_code: id,
    display_name: id,
    avatar_file_id: null,
    account_status: 'active',
    auth_version: 1,
    operation_seq: 0,
    grant_ids: ['g-' + id],
    application_ids: [],
    created_at: now,
  });
  repo.seed('wechat_identities', { _id: userIdentityId(id), user_id: id });
  repo.seed<Grant>('role_grants', {
    _id: 'g-' + id,
    user_id: id,
    role,
    scope_type: role === 'super_admin' ? 'platform' : 'region',
    scope_region_id: role === 'super_admin' ? null : region,
    profile_kind: null,
    organization_id: null,
    status: 'active',
    expires_at: null,
    renewed_from: null,
    revoked_at: null,
  });
}
function demand(
  id: string,
  owner: string,
  status: Demand['status'],
  region = 'a',
  submitted: number | null = now,
): Demand {
  return {
    _id: id,
    owner_id: owner,
    created_by: owner,
    owner_grant_id: 'g-' + owner,
    business_scene: 'village',
    region_id: region,
    region_path_ids: [region],
    campus_organization_id: null,
    form: { type: 'agriculture', schema_version: 1, title: '统计测试需求' },
    type: 'agriculture',
    status,
    visibility: 'hidden',
    version: 1,
    submission_revision: 1,
    active_submission_id: null,
    active_claim_id: null,
    active_completion_id: null,
    first_submitted_at: submitted,
    first_approved_at: status === 'pending_audit' ? null : now - 1,
    approved_at: null,
    confirmed_at: null,
    completed_at: status === 'completed' ? now + 1000 : null,
    ended_at: null,
    created_at: now - 1000,
    updated_at: now,
    expires_at: null,
    parent_demand_id: null,
  };
}
async function call(action: string, data: unknown, actor = 'admin', time = now) {
  return handle(
    'statsService',
    {
      api_version: 'v1',
      request_id: randomUUID(),
      action,
      data,
      grant_id: 'g-' + actor,
      idempotency_key: randomUUID(),
    },
    actor,
    time,
  );
}
beforeEach(() => {
  repo = new MemoryRepository();
  repo.seed('system_guards', { _id: 'v2_migration', schema_version: 2, status: 'verified' });
  access.mockClear();
  handle = createHandler(
    repo,
    privateDataCodec(Buffer.alloc(32, 1).toString('base64')),
    undefined,
    {
      verify: async () => {
        throw new Error('not used');
      },
      access,
    },
  );
  seed('admin');
  seed('admin-b', 'local_admin', 'b');
  seed('root', 'super_admin');
  seed('ordinary', 'farmer');
  repo.seed<Demand>(
    'demands',
    demand('one', 'owner-a', 'completed'),
    demand('two', 'owner-a', 'pending_audit'),
    demand('three', 'owner-b', 'terminated'),
    demand('cross', 'owner-c', 'completed', 'b'),
    demand('draft', 'owner-a', 'draft', 'a', null),
  );
  for (const [index, user] of ['a', 'b', 'c', 'a', 'b', 'd'].entries())
    repo.seed('claim_participants', {
      _id: 'p' + index,
      demand_id: 'one',
      user_id: user,
      roster_version: index < 3 ? 1 : 2,
      confirmed_at: now,
      created_at: now,
    });
});
it('uses the first-submission cohort, real owner deduplication and all historically confirmed participants', async () => {
  const response = await call('getOverview', q);
  expect(response.code).toBe(0);
  const stats = response.data as ContractMap['statsService.getOverview']['response'];
  expect(stats.cohort).toMatchObject({
    demand_count: 3,
    publisher_count: 2,
    completed_count: 1,
    resolution_rate: 1 / 3,
    participant_count: 4,
  });
  expect(stats.cohort.by_status).toMatchObject({
    terminated: 1,
    pending_audit: 1,
    completed: 1,
    draft: 0,
  });
});
function verifiedQuarantine(ids: string[]) {
  const plan = '1'.repeat(64),
    source = 'a'.repeat(64);
  repo.seed('system_guards', {
    _id: 'v2_migration',
    schema_version: 2,
    status: 'verified',
    plan_id: plan,
    source_sha256: source,
  });
  repo.seed('migration_runs', {
    _id: plan,
    status: 'verified',
    source_sha256: source,
    total: ids.length,
    applied: ids.length,
  });
  for (const id of ids) {
    const journal = hash([plan, 'demands', id]),
      digest = hash(['original', id]);
    repo.seed('migration_quarantine', {
      _id: journal,
      plan_id: plan,
      source_collection: 'demands',
      source_id: id,
      source_hash: digest,
      disposition: 'quarantined',
      created_at: now - 2000,
    });
    repo.seed('migration_checkpoints', {
      _id: journal,
      plan_id: plan,
      before_hash: digest,
      after_hash: digest,
    });
  }
  return plan;
}
it('excludes only verified quarantines across pages from statistics, managed drilldown and the shared export collector', async () => {
  const ids = Array.from({ length: 110 }, (_, i) => `legacy-${i}`);
  verifiedQuarantine(ids);
  for (const id of ids) repo.seed('demands', demand(id, 'legacy-owner', 'completed'));
  const response = await call('getOverview', q, 'root');
  expect(response.code).toBe(0);
  expect(
    (response.data as ContractMap['statsService.getOverview']['response']).cohort.demand_count,
  ).toBe(4);
  const managed = await handle(
    'demandService',
    {
      api_version: 'v1',
      action: 'listManaged',
      request_id: randomUUID(),
      grant_id: 'g-root',
      data: { page_size: 50 },
    },
    'root',
    now,
  );
  expect(managed.code).toBe(0);
  expect((managed.data as { items: unknown[] }).items).toHaveLength(4);
  await call(
    'createExport',
    { ...q, report: 'overview', format: 'csv', fields: ['demand_count'] },
    'root',
  );
  let csv = '';
  expect(
    await runExportJobs(
      repo,
      {
        upload: async (path, bytes) => {
          csv = bytes.toString('utf8');
          return exportUrl(path);
        },
        remove: vi.fn(),
      },
      now,
    ),
  ).toMatchObject({ ready: 1 });
  expect(csv.trim().split('\r\n')).toContain('"同批需求数",4');
  expect(repo.rows('demands')).toHaveLength(115);
});
it('keeps unjournaled legacy records blocked instead of treating any malformed row as quarantined', async () => {
  repo.seed('demands', { _id: 'unreviewed', status: 'completed', created_at: now });
  expect(await call('getOverview', q, 'root')).toMatchObject({
    error_code: 'MIGRATION_REQUIRED',
    data: null,
  });
  expect(repo.rows('stats_snapshots')).toHaveLength(0);
});
it('does not write a statistics cache if the migration gate closes during collection', async () => {
  const find = repo.find.bind(repo);
  repo.find = async (...args) => {
    const rows = await find(...args);
    if (args[0] === 'demands')
      repo.seed('system_guards', { _id: 'v2_migration', schema_version: 2, status: 'applying' });
    return rows;
  };
  expect(await call('getOverview', q, 'root')).toMatchObject({
    error_code: 'MIGRATION_REQUIRED',
    data: null,
  });
  expect(repo.rows('stats_snapshots')).toHaveLength(0);
});
it.each(['checkpoint', 'run'] as const)(
  'rejects an incomplete verified quarantine %s without uploading an export',
  async (broken) => {
    const plan = verifiedQuarantine(['legacy']);
    repo.seed('demands', { _id: 'legacy', created_at: now });
    if (broken === 'checkpoint')
      repo.seed('migration_checkpoints', {
        _id: hash([plan, 'demands', 'legacy']),
        plan_id: plan,
        before_hash: 'different',
        after_hash: 'different',
      });
    else
      repo.seed('migration_runs', {
        _id: plan,
        status: 'applying',
        source_sha256: 'a'.repeat(64),
        total: 1,
        applied: 1,
      });
    expect(await call('getOverview', q, 'root')).toMatchObject({
      error_code: 'MIGRATION_REQUIRED',
      data: null,
    });
    await call('createExport', { ...q, report: 'overview', format: 'csv' }, 'root');
    const upload = vi.fn(async (path: string) => exportUrl(path));
    expect(await runExportJobs(repo, { upload, remove: vi.fn() }, now)).toMatchObject({
      failed: 1,
    });
    expect(upload).not.toHaveBeenCalled();
  },
);
it('continues through multiple source pages without truncating the cohort at the SDK page size', async () => {
  for (let i = 0; i < 125; i++)
    repo.seed<Demand>('demands', demand('bulk-' + i, 'bulk-owner', 'pending_audit'));
  const response = await call('getOverview', q);
  expect(response.code).toBe(0);
  expect(
    (response.data as ContractMap['statsService.getOverview']['response']).cohort.demand_count,
  ).toBe(128);
});
it('uses the cumulative participant projection and retains the legacy snapshot fallback', async () => {
  const original = await repo.get<Demand>('demands', 'one');
  repo.seed('demands', {
    ...original,
    _id: 'one',
    confirmed_participant_user_ids: ['a', 'b', 'c', 'd'],
  });
  const response = await call('getOverview', q);
  expect(
    (response.data as ContractMap['statsService.getOverview']['response']).cohort.participant_count,
  ).toBe(4);
});
it('limits managed task drilldown to the same authorized village and first-submission cohort', async () => {
  const request = (actor: string, data: unknown) =>
    handle(
      'demandService',
      {
        api_version: 'v1',
        action: 'listManaged',
        request_id: randomUUID(),
        grant_id: 'g-' + actor,
        data,
      },
      actor,
      now,
    );
  const r = await request('admin', { start_at: q.start_at, end_at: q.end_at });
  expect(r.code).toBe(0);
  expect(
    (r.data as ContractMap['demandService.listManaged']['response']).items
      .map((d) => d.demand_id)
      .sort(),
  ).toEqual(['one', 'three', 'two']);
  expect((await request('admin', { region_id: 'b' })).code).toBe(403);
  expect((await request('ordinary', {})).code).toBe(403);
  expect((await request('admin', { business_scene: 'campus' })).code).toBe(403);
});
it('keeps prior-cohort completions in flow while empty cohorts have null rates', () => {
  const rows = [demand('old', 'x', 'completed', 'a', q.start_at - 1)];
  const stats = overview(rows, [], q, now);
  expect(stats.cohort.demand_count).toBe(0);
  expect(stats.cohort.resolution_rate).toBeNull();
  expect(stats.cohort.average_resolution_ms).toBeNull();
  expect(stats.flow.completed_in_period).toBe(1);
});
it('rejects cross-village, campus and ordinary-role statistics and export requests', async () => {
  expect((await call('getOverview', { ...q, scope_region_id: 'b' })).code).toBe(403);
  expect((await call('getOverview', { ...q, business_scene: 'campus' })).code).toBe(403);
  expect((await call('getOverview', q, 'ordinary')).code).toBe(403);
  expect(
    (await call('createExport', { ...q, scope_region_id: 'b', format: 'csv', report: 'overview' }))
      .code,
  ).toBe(403);
  expect(repo.rows('export_jobs')).toHaveLength(0);
});
it('uses Shanghai calendar buckets across midnight/month-end and excludes the end boundary', () => {
  const start = Date.UTC(2026, 8, 30, 15, 59);
  const end = Date.UTC(2026, 8, 30, 16, 1);
  const rows = [
    demand('before', 'x', 'pending_audit', 'a', start),
    demand('after', 'x', 'pending_audit', 'a', start + 60000),
    demand('end', 'x', 'pending_audit', 'a', end),
  ];
  const result = trend(rows, { start_at: start, end_at: end }, 'month');
  expect(result.points.map((p) => p.submitted_count)).toEqual([1, 1]);
  expect(result.points.map((p) => p.start_at)).toEqual([start, start + 60000]);
});
it('generates CSV and a reopenable XLSX from the same numbers; preserves null and prevents formulas', async () => {
  const rows = [demand('one', 'a', 'completed'), demand('two', 'b', 'terminated')];
  const report = buildReport(rows, [], q, 'overview', now, ['demand_count', 'resolution_rate']);
  const csv = renderCsv(report);
  expect(csv.subarray(0, 3)).toEqual(Buffer.from([239, 187, 191]));
  expect(csv.toString('utf8')).toContain('"指标","数值"\r\n"同批需求数",2\r\n"同批解决率","50.0%"');
  expect(csv.toString('utf8').match(/统计范围/gu)).toHaveLength(1);
  expect(csv.toString('utf8')).not.toContain('algorithm_version');
  const bytes = await renderXlsx(report);
  expect(bytes.subarray(0, 2).toString()).toBe('PK');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Uint8Array.from(bytes).buffer);
  expect(workbook.getWorksheet('统计总览')?.getCell('B6').value).toBe(2);
  expect(workbook.getWorksheet('统计总览')?.getCell('B7').value).toBe(0.5);
  expect(workbook.getWorksheet('统计总览')?.getCell('B7').numFmt).toBe('0.0%');
  const empty = buildReport([], [], q, 'overview', now, ['resolution_rate']);
  const emptyBook = new ExcelJS.Workbook();
  await emptyBook.xlsx.load(Uint8Array.from(await renderXlsx(empty)).buffer);
  expect(emptyBook.getWorksheet('统计总览')?.getCell('B6').value).toBeNull();
  const unsafe = {
    report: 'category' as const,
    columns: ['report_scope', 'demand_count'],
    rows: [[' =1+2,"b\nc', 1]],
  };
  expect(renderCsv(unsafe).toString('utf8')).toContain("' =1+2");
  expect(renderCsv(unsafe).toString('utf8')).toContain('""b\nc"');
  const safeBook = new ExcelJS.Workbook();
  await safeBook.xlsx.load(Uint8Array.from(await renderXlsx(unsafe)).buffer);
  expect(safeBook.getWorksheet('板块分布')?.getCell('B2').value).toBe('\' =1+2,"b\nc');
});
it('uses inclusive calendar dates and writes shared context only once for Chinese trend reports', () => {
  const scope = {
    start_at: Date.parse('2026-11-01T00:00:00+08:00'),
    end_at: Date.parse('2026-11-03T00:00:00+08:00'),
    business_scene: 'village' as const,
    scope_region_id: 'a',
  };
  const report = buildReport([], [], scope, 'trend', now, undefined, '验收村');
  const csv = renderCsv(report).toString('utf8');
  expect(csv.match(/统计范围/gu)).toHaveLength(1);
  expect(csv).toContain('"乡村 · 验收村"');
  expect(csv).toContain('"统计日期","2026-11-01 至 2026-11-02"');
  expect(csv).toContain('"日期","提交数","期间验收数"\r\n"2026-11-01",0,0\r\n"2026-11-02",0,0');
});
it('processes only the selected export without changing a second pending job', async () => {
  const first = await call('createExport', { ...q, format: 'csv', report: 'overview' });
  const second = await call('createExport', { ...q, format: 'xlsx', report: 'overview' });
  const selected = (first.data as { export_job_id: string }).export_job_id;
  const untouched = (second.data as { export_job_id: string }).export_job_id;
  const before = await repo.get('export_jobs', untouched);
  const storage = { upload: vi.fn(async (path: string) => exportUrl(path)), remove: vi.fn() };
  expect(
    await runExportJobs(scopedExportRepository(repo, selected, 'admin'), storage, now),
  ).toEqual({
    ready: 1,
    failed: 0,
    busy: 0,
  });
  expect(await repo.get('export_jobs', untouched)).toEqual(before);
  expect(storage.upload).toHaveBeenCalledTimes(1);
  expect(storage.remove).not.toHaveBeenCalled();
});
it('returns the new private report immediately and reuses it if the command response was lost', async () => {
  const unrelated = await call('createExport', { ...q, format: 'csv', report: 'overview' });
  const other = (unrelated.data as { export_job_id: string }).export_job_id;
  const before = await repo.get('export_jobs', other);
  const upload = vi.fn(async (path: string) => exportUrl(path));
  const fast = createHandler(repo, privateDataCodec(undefined), undefined, undefined, {
    generateExport: (id, at) => runImmediateExport(repo, { upload }, id, at),
  });
  const request = {
    api_version: 'v1',
    request_id: randomUUID(),
    action: 'createExport',
    data: { ...q, format: 'csv', report: 'overview' },
    grant_id: 'g-admin',
    idempotency_key: randomUUID(),
  };
  const first = await fast('statsService', request, 'admin', now);
  expect(first.data).toMatchObject({
    status: 'ready',
    report_layout: 'zh_summary',
    file_id: expect.any(String),
  });
  const again = await fast('statsService', { ...request, request_id: randomUUID() }, 'admin', now);
  expect(again.data).toEqual(first.data);
  expect(upload).toHaveBeenCalledTimes(1);
  expect(await repo.get('export_jobs', other)).toEqual(before);
});
it('rejects publication if the original report scope is no longer covered', async () => {
  seed('root', 'super_admin');
  const made = await call('createExport', { ...q, format: 'csv', report: 'overview' }, 'root');
  const id = (made.data as { export_job_id: string }).export_job_id;
  seed('root', 'local_admin', 'a');
  const upload = vi.fn(async (path: string) => exportUrl(path));
  await runExportJobs(repo, { upload, remove: vi.fn() }, now);
  expect(upload).not.toHaveBeenCalled();
  expect(await repo.get('export_jobs', id)).toMatchObject({
    status: 'failed',
    error_code: 'SCOPE_FORBIDDEN',
    file_id: null,
  });
});
it('processes an asynchronous export with a private binding and enforces ownership and 24h expiry on download', async () => {
  const made = await call('createExport', { ...q, format: 'xlsx', report: 'overview' });
  expect(made.code).toBe(0);
  const job = (made.data as { export_job_id: string }).export_job_id;
  const upload = vi.fn(async (path: string) => {
    expect(repo.rows('storage_cleanup_tasks')).toMatchObject([
      { cloud_path: path, cloud_file_id: null, status: 'dead', manual_review_required: true },
    ]);
    return exportUrl(path);
  });
  expect(await runExportJobs(repo, { upload, remove: vi.fn() }, now)).toMatchObject({
    ready: 1,
    failed: 0,
  });
  const status = await call('getExport', { export_job_id: job });
  expect(status.code).toBe(0);
  expect(status.data).toMatchObject({ report_layout: 'zh_summary' });
  const fileId = (status.data as { file_id: string }).file_id;
  const fileRequest = {
    api_version: 'v1',
    request_id: randomUUID(),
    action: 'getAccessUrl',
    grant_id: 'g-admin',
    data: {
      file_ids: [fileId],
      resource_type: 'export',
      resource_id: job,
      purpose: '下载统计报表',
    },
  };
  expect((await handle('fileService', fileRequest, 'admin', now)).code).toBe(0);
  expect((await call('getExport', { export_job_id: job }, 'admin-b')).code).toBe(404);
  expect((await handle('fileService', fileRequest, 'admin', now + 24 * 3600000 + 1000)).code).toBe(
    404,
  );
  expect(access).toHaveBeenCalledTimes(1);
  expect(
    (await call('getExport', { export_job_id: job }, 'admin', now + 24 * 3600000 + 1000)).data,
  ).toMatchObject({ status: 'failed', error_code: 'EXPORT_EXPIRED' });
  const row = (await repo.get<ExportJob>('export_jobs', job))!;
  delete row.report_layout;
  repo.seed('export_jobs', row);
  expect((await call('getExport', { export_job_id: job })).data).toMatchObject({
    regenerate: { report: 'overview', query: row.scope },
  });
  expect((await call('getExport', { export_job_id: job }, 'admin-b')).code).toBe(404);
});
it('expires download access under a hold, then unbinds and retries external deletion after release', async () => {
  const made = await call('createExport', { ...q, format: 'csv', report: 'overview' });
  const id = (made.data as { export_job_id: string }).export_job_id;
  const remove = vi
    .fn<() => Promise<void>>()
    .mockRejectedValueOnce(new Error('storage timeout'))
    .mockResolvedValue(undefined);
  const storage = { upload: async (path: string) => exportUrl(path), remove };
  await runExportJobs(repo, storage, now);
  const job = (await repo.get<ExportJob>('export_jobs', id))!;
  const deadline = job.expires_at! + 1;
  const guardId = retentionGuardId('export', id);
  repo.seed('data_hold_guards', { _id: guardId, active_count: 1, operation_seq: 0 });
  expect((await expireExportFiles(repo, deadline)).expired).toBe(0);
  expect((await call('getExport', { export_job_id: id }, 'admin', deadline)).data).toMatchObject({
    error_code: 'EXPORT_EXPIRED',
  });
  expect(remove).not.toHaveBeenCalled();
  repo.seed('data_hold_guards', { _id: guardId, active_count: 0, operation_seq: 1 });
  expect((await expireExportFiles(repo, deadline)).expired).toBe(1);
  expect(await runFileDeletions(repo, storage, deadline)).toMatchObject({ failed: 1, deleted: 0 });
  expect(await runFileDeletions(repo, storage, deadline + 2001)).toMatchObject({
    failed: 0,
    deleted: 1,
  });
  expect(await runFileDeletions(repo, storage, deadline + 3000)).toMatchObject({ deleted: 0 });
  expect(remove).toHaveBeenCalledTimes(2);
  expect(await repo.get('files', job.file_id!)).toMatchObject({ state: 'deleted', ref_count: 0 });
});
it('never deletes the physical file while another live binding still references it', async () => {
  const made = await call('createExport', { ...q, format: 'csv', report: 'overview' });
  const id = (made.data as { export_job_id: string }).export_job_id;
  const storage = {
    upload: async (path: string) => exportUrl(path),
    remove: vi.fn(async () => {}),
  };
  await runExportJobs(repo, storage, now);
  const job = (await repo.get<ExportJob>('export_jobs', id))!;
  const file = (await repo.get<import('../../server/modules/file/service').StoredFile>(
    'files',
    job.file_id!,
  ))!;
  repo.seed('files', { ...file, ref_count: 2 });
  repo.seed('file_bindings', {
    _id: 'other-binding',
    file_id: file._id,
    resource_type: 'demand',
    resource_id: 'another',
    active: true,
    created_at: now,
  });
  await expireExportFiles(repo, job.expires_at! + 1);
  await runFileDeletions(repo, storage, job.expires_at! + 1);
  expect(storage.remove).not.toHaveBeenCalled();
  expect(await repo.get('files', file._id)).toMatchObject({ state: 'active', ref_count: 1 });
});
it('rejects invalid report fields and excessive periods before queuing work', async () => {
  expect(
    (await call('createExport', { ...q, format: 'xlsx', report: 'trend', fields: ['phone'] })).code,
  ).toBe(400);
  expect((await call('getOverview', { start_at: 0, end_at: 367 * 86400000 })).code).toBe(400);
  expect(repo.rows('export_jobs')).toHaveLength(0);
});
it('rechecks revocation after upload and queues the lease-owned file for cleanup without exposing it', async () => {
  const made = await call('createExport', { ...q, format: 'csv', report: 'overview' });
  const job = (made.data as { export_job_id: string }).export_job_id;
  const remove = vi.fn(async () => {});
  let returnedFile = '';
  const storage: ExportStorage = {
    remove,
    upload: async (path) => {
      const grant = (await repo.get<Grant>('role_grants', 'g-admin'))!;
      repo.seed<Grant>('role_grants', { ...grant, status: 'revoked', revoked_at: now });
      returnedFile = exportUrl(path);
      return returnedFile;
    },
  };
  expect(await runExportJobs(repo, storage, now)).toMatchObject({ ready: 0, failed: 1 });
  expect(remove).not.toHaveBeenCalled();
  expect(repo.rows('storage_cleanup_tasks')).toMatchObject([
    { cloud_file_id: returnedFile, status: 'dead', manual_review_required: true },
  ]);
  expect((await repo.get<ExportJob>('export_jobs', job))?.status).toBe('failed');
  expect(repo.rows('file_bindings')).toHaveLength(0);
});
it('retains a committed export when the transaction response is lost', async () => {
  const made = await call('createExport', { ...q, format: 'csv', report: 'overview' });
  const job = (made.data as { export_job_id: string }).export_job_id;
  const transaction = repo.transaction.bind(repo);
  let waitingForCommit = false;
  let returnedFile = '';
  repo.transaction = async (work) => {
    const result = await transaction(work);
    if (waitingForCommit && (await repo.get<ExportJob>('export_jobs', job))?.status === 'ready') {
      waitingForCommit = false;
      throw new Error('simulated lost transaction response');
    }
    return result;
  };
  const remove = vi.fn(async () => {});
  const storage: ExportStorage = {
    remove,
    upload: async (path) => {
      waitingForCommit = true;
      returnedFile = exportUrl(path);
      return returnedFile;
    },
  };
  expect(await runExportJobs(repo, storage, now)).toMatchObject({ ready: 1, failed: 0 });
  const saved = (await repo.get<ExportJob>('export_jobs', job))!;
  expect(saved.status).toBe('ready');
  expect(await repo.get('files', saved.file_id!)).toMatchObject({
    cloud_file_id: returnedFile,
  });
  expect(remove).not.toHaveBeenCalled();
  expect(repo.rows('storage_cleanup_tasks')).toMatchObject([
    { cloud_file_id: returnedFile, status: 'processed', manual_review_required: false },
  ]);
});
it('quarantines a copy with an uncertain commit outcome for manual review', async () => {
  const made = await call('createExport', { ...q, format: 'csv', report: 'overview' });
  const job = (made.data as { export_job_id: string }).export_job_id;
  const transaction = repo.transaction.bind(repo);
  let failNext = false;
  let returnedFile = '';
  repo.transaction = async (work) => {
    if (failNext) {
      failNext = false;
      throw new Error('simulated unknown transaction outcome');
    }
    return transaction(work);
  };
  const remove = vi.fn(async () => {});
  const storage: ExportStorage = {
    remove,
    upload: async (path) => {
      failNext = true;
      returnedFile = exportUrl(path);
      return returnedFile;
    },
  };
  expect(await runExportJobs(repo, storage, now)).toMatchObject({ ready: 0, failed: 1 });
  expect((await repo.get<ExportJob>('export_jobs', job))?.status).toBe('pending');
  expect(remove).not.toHaveBeenCalled();
  expect(repo.rows('storage_cleanup_tasks')).toMatchObject([
    { cloud_file_id: returnedFile, status: 'dead', manual_review_required: true },
  ]);
});
it('does not delete or report a false result when checking a lost commit response also fails', async () => {
  const made = await call('createExport', { ...q, format: 'csv', report: 'overview' });
  const job = (made.data as { export_job_id: string }).export_job_id;
  const transaction = repo.transaction.bind(repo);
  let awaitingCommit = false;
  let failReadback = false;
  repo.transaction = async (work) => {
    if (failReadback) {
      failReadback = false;
      throw new Error('simulated readback failure');
    }
    const result = await transaction(work);
    if (awaitingCommit && (await repo.get<ExportJob>('export_jobs', job))?.status === 'ready') {
      awaitingCommit = false;
      failReadback = true;
      throw new Error('simulated lost transaction response');
    }
    return result;
  };
  const remove = vi.fn(async () => {});
  const storage: ExportStorage = {
    remove,
    upload: async (path) => {
      awaitingCommit = true;
      return exportUrl(path);
    },
  };
  await expect(runExportJobs(repo, storage, now)).rejects.toThrow('simulated readback failure');
  expect((await repo.get<ExportJob>('export_jobs', job))?.status).toBe('ready');
  expect(remove).not.toHaveBeenCalled();
});
it('retains the registered path for manual review if upload times out before returning its file ID', async () => {
  const made = await call('createExport', { ...q, format: 'csv', report: 'overview' });
  const job = (made.data as { export_job_id: string }).export_job_id;
  let attemptedPath = '';
  const remove = vi.fn(async () => {});
  const storage: ExportStorage = {
    remove,
    upload: async (path) => {
      attemptedPath = path;
      throw new Error('storage response lost after possible upload');
    },
  };
  expect(await runExportJobs(repo, storage, now)).toMatchObject({ failed: 1, ready: 0 });
  expect(repo.rows('storage_cleanup_tasks')).toMatchObject([
    {
      job_id: job,
      cloud_path: attemptedPath,
      cloud_file_id: null,
      status: 'dead',
      manual_review_required: true,
    },
  ]);
  expect(attemptedPath).toMatch(/^private\/exports\//u);
  expect(remove).not.toHaveBeenCalled();
  expect(repo.rows('file_bindings')).toHaveLength(0);
});
it('does not upload when pre-registration commits but its response is lost', async () => {
  await call('createExport', { ...q, format: 'csv', report: 'overview' });
  const transaction = repo.transaction.bind(repo);
  let lost = false;
  repo.transaction = async (work) => {
    const result = await transaction(work);
    if (!lost && repo.rows('storage_cleanup_tasks').length) {
      lost = true;
      throw new Error('registration response lost');
    }
    return result;
  };
  const upload = vi.fn(async (path: string) => exportUrl(path));
  expect(await runExportJobs(repo, { upload, remove: vi.fn() }, now)).toMatchObject({ failed: 1 });
  expect(upload).not.toHaveBeenCalled();
  expect(repo.rows('storage_cleanup_tasks')).toMatchObject([
    { cloud_file_id: null, status: 'dead', manual_review_required: true },
  ]);
});
it('quarantines a mismatched upload response rather than binding or deleting that object', async () => {
  await call('createExport', { ...q, format: 'csv', report: 'overview' });
  const remove = vi.fn(async () => {});
  const storage = { remove, upload: async () => 'cloud://other-bucket/wrong-object' };
  expect(await runExportJobs(repo, storage, now)).toMatchObject({ failed: 1, ready: 0 });
  expect(repo.rows('storage_cleanup_tasks')).toMatchObject([
    {
      cloud_file_id: null,
      observed_file_id: 'cloud://other-bucket/wrong-object',
      status: 'dead',
      manual_review_required: true,
    },
  ]);
  expect(repo.rows('files')).toHaveLength(0);
  expect(remove).not.toHaveBeenCalled();
});
it('keeps the expired worker copy separate from its successor and never deletes either automatically', async () => {
  const made = await call('createExport', { ...q, format: 'csv', report: 'overview' });
  const id = (made.data as { export_job_id: string }).export_job_id;
  let resume = () => {};
  let started = () => {};
  const waiting = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const first: ExportStorage = {
    remove: vi.fn(),
    upload: async (path) => {
      started();
      await waiting;
      return exportUrl(path);
    },
  };
  const second: ExportStorage = { remove: vi.fn(), upload: async (path) => exportUrl(path) };
  const oldWorker = runExportJobs(repo, first, now);
  await entered;
  expect(await runExportJobs(repo, second, now + 120001)).toMatchObject({ ready: 1 });
  resume();
  expect(await oldWorker).toMatchObject({ failed: 1, ready: 0 });
  const saved = (await repo.get<ExportJob>('export_jobs', id))!;
  expect(saved.status).toBe('ready');
  const tasks = repo.rows<{
    _id: string;
    status: string;
    cloud_path: string;
    manual_review_required: boolean;
  }>('storage_cleanup_tasks');
  expect(tasks).toHaveLength(2);
  expect(new Set(tasks.map((task) => task.cloud_path)).size).toBe(2);
  expect(tasks.filter((task) => task.status === 'processed')).toHaveLength(1);
  expect(
    tasks.filter((task) => task.status === 'dead' && task.manual_review_required),
  ).toHaveLength(1);
  expect(first.remove).not.toHaveBeenCalled();
  expect(second.remove).not.toHaveBeenCalled();
});
