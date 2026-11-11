import { audit, resolveUser, runCommand, touchMigrationFence } from '../../core/command';
import type { Entity, QueryValue, Repository, Transaction } from '../../core/repository';
import type { Grant } from '../../core/entities';
import { assertCanStartNewAction } from '../../core/policy';
import { ensure } from '../../core/errors';
import { requestData, type CallRequest } from '../../core/request';
import { decodeCursor, encodeCursor } from '../../core/pagination';
import { bindFile, unbindFile, type FileProvider, type StoredFile } from '../file/service';
import type { ContentSafety } from '../../adapters/content-safety';
import { hash } from '../../core/hash';
import type { ContractMap } from '../../../contracts/generated/dto';
import { randomUUID } from 'node:crypto';
import type { PublicFileGuard } from '../../maintenance/storage-cleanup';

type PolicyInput = ContractMap['policyService.saveDraft']['request'];
export interface Policy extends Entity {
  body: Omit<PolicyInput, 'policy_id' | 'expected_version'>;
  status: 'draft' | 'published' | 'unpublished';
  version: number;
  created_at: number;
  published_by?: string | null;
}
interface Banner extends Entity {
  policy_id: string;
  cover_file_id: string;
  public_cloud_file_id?: string;
  sort_order: number;
  starts_at: number;
  ends_at: number;
  enabled: boolean;
  version: number;
  created_at: number;
}
const toDTO = (p: Policy) => ({
  policy_id: p._id,
  ...p.body,
  status: p.status,
  version: p.version,
});
const bannerDTO = (
  b: Banner,
  cover_url: string | null = null,
  policy_title: string | null = null,
) => ({
  banner_id: b._id,
  policy_id: b.policy_id,
  cover_file_id: b.cover_file_id,
  sort_order: b.sort_order,
  starts_at: b.starts_at,
  ends_at: b.ends_at,
  enabled: b.enabled,
  version: b.version,
  cover_url,
  policy_title,
});
const valid = (p: Policy, now: number) =>
  p.status === 'published' &&
  Boolean(p.published_by) &&
  p.body &&
  p.body.publish_at <= now &&
  (p.body.effective_at === undefined || p.body.effective_at <= now) &&
  (p.body.expire_at === undefined || p.body.expire_at > now);
export function officialSource(source: string) {
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    ensure(false, 'VALIDATION_FAILED', '政策来源链接无效', 400);
  }
  ensure(
    url.protocol === 'https:' &&
      (['gov.cn', 'edu.cn'].includes(url.hostname) ||
        url.hostname.endsWith('.gov.cn') ||
        url.hostname.endsWith('.edu.cn')) &&
      !url.username &&
      !url.password,
    'VALIDATION_FAILED',
    '请使用经人工核验的官方 HTTPS 来源',
    400,
  );
  url.hash = '';
  url.searchParams.sort();
  return url.toString();
}
async function admin(tx: Transaction, openid: string, grantId: string | undefined, now: number) {
  const user = await resolveUser(tx, openid);
  ensure(user, 'USER_NOT_INITIALIZED', '请先登录', 401);
  const grant = grantId ? await tx.get<Grant>('role_grants', grantId) : null;
  assertCanStartNewAction(user, grant, now);
  ensure(grant.role === 'super_admin', 'FORBIDDEN', '政策与轮播仅超级管理员维护');
  return user;
}
export function createPolicyService(
  repo: Repository,
  safety?: ContentSafety,
  files?: FileProvider,
) {
  async function write(openid: string, request: CallRequest, now: number) {
    let checkedHash: string | undefined;
    let publishedCover: string | undefined;
    let plannedCover: string | undefined;
    if (request.action === 'publish') {
      const data = requestData('policyService.publish', request);
      const p = await repo.transaction(async (tx) => {
        await admin(tx, openid, request.grant_id, now);
        const policy = await tx.get<Policy>('policies', data.policy_id);
        ensure(
          policy && policy.version === data.expected_version,
          'VERSION_CONFLICT',
          '政策已更新',
          409,
        );
        return policy;
      });
      officialSource(p.body.source_url);
      ensure(safety, 'DEPENDENCY_UNAVAILABLE', '政策内容检查尚未配置', 503);
      ensure(
        (await safety.checkText(openid, `${p.body.title}\n${p.body.content}`)) === 'pass',
        'CONTENT_REJECTED',
        '政策内容检查未通过',
        400,
      );
      checkedHash = hash(p.body);
    }
    if (request.action === 'saveBanner') {
      const data = requestData('policyService.saveBanner', request);
      const file = await repo.transaction(async (tx) => {
        const user = await admin(tx, openid, request.grant_id, now);
        const previous = data.banner_id ? await tx.get<Banner>('banners', data.banner_id) : null;
        if (data.banner_id)
          ensure(
            previous?.version === data.expected_version,
            'VERSION_CONFLICT',
            '轮播已更新',
            409,
          );
        const p = await tx.get<Policy>('policies', data.policy_id);
        ensure(
          p?.status === 'published' && p.published_by,
          'STATE_CONFLICT',
          '轮播只能引用人工发布的政策',
          409,
        );
        const f = await tx.get<StoredFile>('files', data.cover_file_id);
        const existingBinding =
          previous?.cover_file_id === data.cover_file_id
            ? await tx.get<Entity & { active: boolean }>(
                'file_bindings',
                hash([data.cover_file_id, 'banner', previous._id]),
              )
            : null;
        ensure(
          f &&
            (f.owner_id === user._id || existingBinding?.active) &&
            f.purpose === 'policy_banner' &&
            f.mime.startsWith('image/') &&
            f.check_status === 'pass' &&
            f.state === 'active' &&
            f.storage_mode === 'immutable_private',
          'FORBIDDEN',
          '只能使用专门上传并固化的政策配图',
        );
        return f;
      });
      ensure(files?.publishPublic, 'DEPENDENCY_UNAVAILABLE', '公开配图发布适配器未配置', 503);
      const copyPath = `public/policy-banners/${hash([file._id, file.content_hash, randomUUID()])}`;
      const bucket = /^cloud:\/\/[^/]+\//u.exec(file.cloud_file_id)?.[0];
      ensure(bucket, 'DEPENDENCY_UNAVAILABLE', '公开配图来源路径异常', 503);
      publishedCover = await files.publishPublic(
        file.cloud_file_id,
        file.content_hash,
        copyPath,
        async (copy) => {
          ensure(
            !plannedCover && copy === bucket + copyPath,
            'DEPENDENCY_UNAVAILABLE',
            '公开配图副本路径异常',
            503,
          );
          await repo.transaction(async (tx) => {
            await touchMigrationFence(tx);
            const user = await admin(tx, openid, request.grant_id, now);
            const previous = data.banner_id
              ? await tx.get<Banner>('banners', data.banner_id)
              : null;
            if (data.banner_id)
              ensure(
                previous?.version === data.expected_version,
                'VERSION_CONFLICT',
                '轮播已更新',
                409,
              );
            const policy = await tx.get<Policy>('policies', data.policy_id);
            ensure(
              policy?.status === 'published' && policy.published_by,
              'STATE_CONFLICT',
              '轮播只能引用人工发布的政策',
              409,
            );
            const current = await tx.get<StoredFile>('files', data.cover_file_id);
            const binding =
              previous?.cover_file_id === data.cover_file_id
                ? await tx.get<Entity & { active: boolean }>(
                    'file_bindings',
                    hash([data.cover_file_id, 'banner', previous._id]),
                  )
                : null;
            ensure(
              current &&
                (current.owner_id === user._id || binding?.active) &&
                current.cloud_file_id === file.cloud_file_id &&
                current.content_hash === file.content_hash &&
                current.purpose === 'policy_banner' &&
                current.mime.startsWith('image/') &&
                current.check_status === 'pass' &&
                current.state === 'active' &&
                current.storage_mode === 'immutable_private',
              'FORBIDDEN',
              '配图文件已失效',
            );
            const guardId = hash(['public-file', copy]);
            const taskId = hash(['public-copy', copy]);
            ensure(
              !(await tx.get('public_file_guards', guardId)) &&
                !(await tx.get('storage_cleanup_tasks', taskId)),
              'STATE_CONFLICT',
              '公开副本登记冲突',
              409,
            );
            await tx.put<PublicFileGuard>('public_file_guards', {
              _id: guardId,
              ref_count: 0,
              state: 'active',
            });
            await tx.put('storage_cleanup_tasks', {
              _id: taskId,
              cloud_file_id: copy,
              status: 'dead',
              manual_review_required: true,
              reason: 'UPLOAD_OUTCOME_UNKNOWN',
              attempts: 0,
              next_retry_at: now + 120000,
              created_at: now,
            });
          });
          plannedCover = copy;
        },
        async (copy) => {
          ensure(
            plannedCover && /^cloud:\/\/[^/]+\/.+/u.test(copy) && copy.length <= 1024,
            'DEPENDENCY_UNAVAILABLE',
            '公开副本返回的编号异常',
            503,
          );
          await repo.transaction(async (tx) => {
            await touchMigrationFence(tx);
            const taskId = hash(['unexpected-public-copy', copy, plannedCover]);
            if (!(await tx.get('storage_cleanup_tasks', taskId)))
              await tx.put('storage_cleanup_tasks', {
                _id: taskId,
                cloud_file_id: copy,
                status: 'dead',
                manual_review_required: true,
                reason: 'UNEXPECTED_STORAGE_ID',
                attempts: 0,
                next_retry_at: now,
                created_at: now,
              });
          });
        },
      );
      ensure(
        publishedCover === plannedCover,
        'DEPENDENCY_UNAVAILABLE',
        '公开配图副本尚未登记',
        503,
      );
    }
    return runCommand(
      repo,
      openid,
      'policyService',
      request,
      async (ctx) => {
        await admin(ctx.tx, openid, request.grant_id, now);
        if (request.action === 'saveDraft') {
          const data = requestData('policyService.saveDraft', request);
          const source_url = officialSource(data.source_url);
          ensure(
            data.expire_at === undefined || data.expire_at > (data.effective_at ?? data.publish_at),
            'VALIDATION_FAILED',
            '政策有效期顺序错误',
            400,
          );
          const previous = data.policy_id
            ? await ctx.tx.get<Policy>('policies', data.policy_id)
            : null;
          if (data.policy_id)
            ensure(
              previous?.version === data.expected_version,
              'VERSION_CONFLICT',
              '政策已更新',
              409,
            );
          const { policy_id, expected_version, ...rest } = data;
          void expected_version;
          const targetId = policy_id ?? ctx.command_id;
          const lockId = hash(source_url);
          const source = await ctx.tx.get<Entity & { policy_id: string }>(
            'policy_source_keys',
            lockId,
          );
          ensure(
            !source || source.policy_id === targetId,
            'STATE_CONFLICT',
            '该官方来源已有政策，请编辑原条目',
            409,
          );
          const body = {
            ...rest,
            title: rest.title.trim(),
            content: rest.content.trim(),
            source_authority: rest.source_authority.trim(),
            source_url,
          };
          ensure(
            Array.from(body.title).length >= 4 &&
              body.content.length > 0 &&
              body.source_authority.length > 0,
            'VALIDATION_FAILED',
            '政策标题、正文与发布单位不能为空',
            400,
          );
          if (previous)
            await ctx.tx.put('policy_revisions', {
              _id: hash([previous._id, previous.version]),
              policy_id: previous._id,
              version: previous.version,
              body: previous.body,
              status: previous.status,
              published_by: previous.published_by ?? null,
              created_at: now,
            });
          const policy: Policy = {
            _id: targetId,
            body,
            status: 'draft',
            version: (previous?.version ?? 0) + 1,
            created_at: previous?.created_at ?? now,
            published_by: null,
          };
          await ctx.tx.put('policy_source_keys', {
            _id: lockId,
            policy_id: targetId,
            created_at: now,
          });
          await ctx.tx.put('policies', policy);
          await audit(ctx, policy._id, '保存人工政策草稿');
          return toDTO(policy);
        }
        if (request.action === 'setBannerEnabled') {
          const data = requestData('policyService.setBannerEnabled', request);
          const b = await ctx.tx.get<Banner>('banners', data.banner_id);
          ensure(b && b.version === data.expected_version, 'VERSION_CONFLICT', '轮播已更新', 409);
          if (data.enabled) {
            const p = await ctx.tx.get<Policy>('policies', b.policy_id);
            ensure(
              p?.status === 'published' && p.published_by && b.public_cloud_file_id,
              'STATE_CONFLICT',
              '请先完成政策与配图发布',
              409,
            );
          }
          b.enabled = data.enabled;
          b.version++;
          await ctx.tx.put('banners', b);
          await audit(ctx, b._id, '更新轮播启用状态');
          return bannerDTO(b);
        }
        if (request.action === 'saveBanner') {
          const data = requestData('policyService.saveBanner', request);
          ensure(data.ends_at > data.starts_at, 'VALIDATION_FAILED', '轮播排期无效', 400);
          const p = await ctx.tx.get<Policy>('policies', data.policy_id);
          ensure(
            p?.status === 'published' && p.published_by,
            'STATE_CONFLICT',
            '轮播只能引用人工发布的政策',
            409,
          );
          const file = await ctx.tx.get<StoredFile>('files', data.cover_file_id);
          const old = data.banner_id ? await ctx.tx.get<Banner>('banners', data.banner_id) : null;
          if (data.banner_id)
            ensure(old?.version === data.expected_version, 'VERSION_CONFLICT', '轮播已更新', 409);
          const binding =
            old?.cover_file_id === data.cover_file_id
              ? await ctx.tx.get<Entity & { active: boolean }>(
                  'file_bindings',
                  hash([data.cover_file_id, 'banner', old._id]),
                )
              : null;
          ensure(
            file &&
              (file.owner_id === ctx.user._id || binding?.active) &&
              file.state === 'active' &&
              file.check_status === 'pass' &&
              file.purpose === 'policy_banner' &&
              file.mime.startsWith('image/') &&
              file.storage_mode === 'immutable_private',
            'FORBIDDEN',
            '配图文件已失效',
          );
          ensure(publishedCover, 'DEPENDENCY_UNAVAILABLE', '缺少已发布配图', 503);
          const guardId = hash(['public-file', publishedCover]);
          const guard = await ctx.tx.get<PublicFileGuard>('public_file_guards', guardId);
          ensure(
            guard?.state === 'active',
            'STATE_CONFLICT',
            '配图副本已进入清理流程，请重新保存',
            409,
          );
          const cleanup = await ctx.tx.get<
            Entity & {
              cloud_file_id: string;
              status: string;
              manual_review_required: boolean;
              next_retry_at: number;
            }
          >('storage_cleanup_tasks', hash(['public-copy', publishedCover]));
          ensure(
            cleanup?.cloud_file_id === publishedCover &&
              cleanup.status === 'dead' &&
              cleanup.manual_review_required,
            'STATE_CONFLICT',
            '公开配图登记状态异常',
            409,
          );
          guard.ref_count++;
          await ctx.tx.put('public_file_guards', guard);
          cleanup.status = 'pending';
          cleanup.manual_review_required = false;
          await ctx.tx.put('storage_cleanup_tasks', cleanup);
          if (old?.public_cloud_file_id) {
            const oldId = hash(['public-file', old.public_cloud_file_id]);
            const oldGuard = await ctx.tx.get<PublicFileGuard>('public_file_guards', oldId);
            if (oldGuard) {
              ensure(oldGuard.ref_count > 0, 'STATE_CONFLICT', '公开配图引用异常', 409);
              oldGuard.ref_count--;
              await ctx.tx.put('public_file_guards', oldGuard);
            }
          }
          const b: Banner = {
            _id: data.banner_id ?? ctx.command_id,
            policy_id: data.policy_id,
            cover_file_id: data.cover_file_id,
            public_cloud_file_id: publishedCover,
            sort_order: data.sort_order,
            starts_at: data.starts_at,
            ends_at: data.ends_at,
            enabled: data.enabled,
            version: (old?.version ?? 0) + 1,
            created_at: old?.created_at ?? now,
          };
          await bindFile(ctx.tx, file._id, 'banner', b._id, now);
          if (old && old.cover_file_id !== file._id)
            await unbindFile(ctx.tx, old.cover_file_id, 'banner', b._id);
          await ctx.tx.put('banners', b);
          await audit(ctx, b._id, '保存轮播');
          return bannerDTO(b);
        }
        const data =
          request.action === 'publish'
            ? requestData('policyService.publish', request)
            : requestData('policyService.unpublish', request);
        const p = await ctx.tx.get<Policy>('policies', data.policy_id);
        ensure(p, 'NOT_FOUND', '政策不存在', 404);
        ensure(p.version === data.expected_version, 'VERSION_CONFLICT', '政策已更新', 409);
        if (request.action === 'publish') {
          officialSource(p.body.source_url);
          ensure(checkedHash === hash(p.body), 'STATE_CONFLICT', '政策内容已变化，请重新检查', 409);
          ensure(p.status !== 'published', 'STATE_CONFLICT', '政策已发布', 409);
        } else ensure(p.status === 'published', 'STATE_CONFLICT', '政策未发布', 409);
        await ctx.tx.put('policy_revisions', {
          _id: hash([p._id, p.version]),
          policy_id: p._id,
          version: p.version,
          body: p.body,
          status: p.status,
          published_by: p.published_by ?? null,
          created_at: now,
        });
        p.status = request.action === 'publish' ? 'published' : 'unpublished';
        if (request.action === 'publish') p.published_by = ctx.user._id;
        p.version++;
        await ctx.tx.put('policies', p);
        await audit(ctx, p._id, `人工政策:${p.status}`);
        return toDTO(p);
      },
      now,
    );
  }
  async function read(openid: string, request: CallRequest, now: number) {
    const management = [
      'getManageDetail',
      'listManage',
      'listDrafts',
      'listManageBanners',
    ].includes(request.action);
    if (management) await repo.transaction((tx) => admin(tx, openid, request.grant_id, now));
    if (request.action === 'getDetail' || request.action === 'getManageDetail') {
      const data = requestData('policyService.getDetail', request);
      const p = await repo.get<Policy>('policies', data.policy_id);
      ensure(p && (management || valid(p, now)), 'NOT_FOUND', '政策尚未公开或已失效', 404);
      return toDTO(p);
    }
    if (request.action === 'listManageBanners') {
      const data = requestData('policyService.listManageBanners', request);
      const size = data.page_size ?? 20;
      const scope = { action: request.action };
      const rows = await repo.find<Banner>('banners', {}, size + 1, {
        newest: true,
        after: decodeCursor(data.cursor, scope),
      });
      const items = rows.slice(0, size);
      const has_more = rows.length > size;
      return {
        items: items.map((b) => bannerDTO(b)),
        has_more,
        next_cursor: has_more ? encodeCursor(items[items.length - 1], scope) : null,
      };
    }
    if (request.action === 'listBanners') {
      const data = requestData('policyService.listBanners', request);
      const rows = await repo.find<Banner>('banners', { enabled: true }, 51);
      ensure(rows.length <= 50, 'RATE_LIMITED', '轮播数量超过查询上限', 429);
      const output = [];
      for (const b of rows)
        if (b.starts_at <= now && b.ends_at > now) {
          const p = await repo.get<Policy>('policies', b.policy_id);
          if (
            p &&
            valid(p, now) &&
            (!data.region_id ||
              (p.body.scope.business_scene === 'village' &&
                (!p.body.scope.region_id || p.body.scope.region_id === data.region_id)))
          ) {
            ensure(
              files && b.public_cloud_file_id,
              'DEPENDENCY_UNAVAILABLE',
              '轮播配图尚未完成发布',
              503,
            );
            const cover = await files.access(b.public_cloud_file_id, 300);
            ensure(cover.max_age <= 300, 'DEPENDENCY_UNAVAILABLE', '配图链接期限异常', 503);
            output.push(bannerDTO(b, cover.url, p.body.title));
          }
        }
      return output.sort((a, b) => a.sort_order - b.sort_order);
    }
    const data: {
      cursor?: string;
      page_size?: number;
      status?: Policy['status'];
      keyword?: string;
      region_id?: string;
    } =
      request.action === 'listManage'
        ? requestData('policyService.listManage', request)
        : request.action === 'listDrafts'
        ? requestData('policyService.listDrafts', request)
        : requestData('policyService.listPublished', request);
    const filter: Record<string, QueryValue> = {};
    if (request.action === 'listManage') {
      if (data.status) filter.status = data.status;
    } else filter.status = request.action === 'listDrafts' ? 'draft' : 'published';
    const keyword = data.keyword;
    const region = data.region_id;
    const scope = { action: request.action, filter, keyword, region };
    const size = data.page_size ?? 20;
    let after = decodeCursor(data.cursor, scope);
    const matching: Policy[] = [];
    let more = true;
    let last: Policy | undefined;
    for (let count = 0; count < 1000 && matching.length <= size && more; count += 100) {
      const rows = await repo.find<Policy>('policies', filter, 100, { newest: true, after });
      more = rows.length === 100;
      for (const p of rows) {
        last = p;
        if (
          (management || valid(p, now)) &&
          (!keyword || p.body.title.includes(keyword)) &&
          (!region ||
            (p.body.scope.business_scene === 'village' &&
              (!p.body.scope.region_id || p.body.scope.region_id === region)))
        )
          matching.push(p);
      }
      if (last) after = { created_at: last.created_at, id: last._id };
    }
    const items = matching.slice(0, size);
    const has_more = matching.length > size || more;
    const cursorRow = matching.length > size ? items[items.length - 1] : last;
    return {
      items: items.map(toDTO),
      has_more,
      next_cursor: has_more && cursorRow ? encodeCursor(cursorRow, scope) : null,
    };
  }
  return { write, read };
}
