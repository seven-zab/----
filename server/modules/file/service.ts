import { createHash } from 'node:crypto';
import type { Application, Grant } from '../../core/entities';
import type { Entity, Repository, Transaction } from '../../core/repository';
import { resolveUser, runCommand, touchMigrationFence } from '../../core/command';
import { assertAccount, assertCanStartNewAction } from '../../core/policy';
import { requestData, type CallRequest } from '../../core/request';
import { ensure } from '../../core/errors';
import { hash } from '../../core/hash';
import { demandFileDeadline } from './demand-access';
import type { ChatMessage, Conversation } from '../chat/service';
import { authorizeStats, type ExportJob } from '../stats/service';
import type { UploadDescriptor, UploadTicket } from '../../adapters/cos-upload-ticket';
export interface StoredFile extends Entity {
  owner_id: string;
  purpose: string;
  mime: string;
  size: number;
  cloud_file_id: string;
  content_hash: string;
  check_status: 'pending' | 'pass' | 'reject' | 'error';
  state: 'active' | 'deleting' | 'deleted';
  storage_mode: 'immutable_private' | 'trusted_generated' | 'temporary_unverified';
  ref_count: number;
  created_at: number;
}
interface Upload extends Entity {
  owner_id: string;
  openid: string;
  purpose: string;
  mime: string;
  size: number;
  cloud_path: string;
  expires_at: number;
  file_id: string | null;
  source_cloud_file_id?: string;
  created_at: number;
}
export interface FileProvider {
  uploadTicket?(upload: UploadDescriptor, now: number): Promise<UploadTicket>;
  verify(
    fileId: string,
    path: string,
    mime: string,
    maxBytes: number,
    expectedHash: string,
    onCopyPlanned?: (cloudFileId: string) => Promise<void>,
    onUnexpectedCopy?: (cloudFileId: string) => Promise<void>,
  ): Promise<{
    hash: string;
    size: number;
    check_status: StoredFile['check_status'];
    cloud_file_id: string;
    storage_mode: StoredFile['storage_mode'];
  }>;
  access(
    fileId: string,
    seconds: number,
    deadline?: number,
  ): Promise<{ url: string; max_age: number; expires_at?: number }>;
  publishPublic?(
    fileId: string,
    expectedHash: string,
    path: string,
    onCopyPlanned?: (cloudFileId: string) => Promise<void>,
    onUnexpectedCopy?: (cloudFileId: string) => Promise<void>,
  ): Promise<string>;
}
export async function bindFile(
  tx: Transaction,
  fileId: string,
  resourceType: string,
  resourceId: string,
  now: number,
) {
  const file = await tx.get<StoredFile>('files', fileId);
  ensure(
    file?.state === 'active' &&
      ['immutable_private', 'trusted_generated'].includes(file.storage_mode),
    'FORBIDDEN',
    '文件未固化或不可绑定',
  );
  const bindingId = hash([fileId, resourceType, resourceId]);
  const existing = await tx.get<Entity & { active: boolean }>('file_bindings', bindingId);
  if (!existing?.active) {
    file.ref_count = (file.ref_count ?? 0) + 1;
    await tx.put('files', file);
    await tx.put('file_bindings', {
      _id: bindingId,
      file_id: fileId,
      resource_type: resourceType,
      resource_id: resourceId,
      active: true,
      created_at: now,
    });
  }
}
export async function unbindFile(
  tx: Transaction,
  fileId: string,
  resourceType: string,
  resourceId: string,
) {
  const bindingId = hash([fileId, resourceType, resourceId]);
  const binding = await tx.get<Entity & { active: boolean }>('file_bindings', bindingId);
  if (!binding?.active) return;
  const file = await tx.get<StoredFile>('files', fileId);
  ensure(file && file.ref_count > 0, 'STATE_CONFLICT', '文件引用计数异常', 409);
  binding.active = false;
  file.ref_count--;
  await tx.put('file_bindings', binding);
  await tx.put('files', file);
}
function imageMime(mime: string) {
  return mime.startsWith('image/');
}
export function createFileService(repo: Repository, provider?: FileProvider) {
  async function write(openid: string, request: CallRequest, now: number) {
    let verified: Awaited<ReturnType<FileProvider['verify']>> | undefined;
    let plannedCopy: string | undefined;
    if (request.action === 'finalizeUpload') {
      const data = requestData('fileService.finalizeUpload', request);
      const upload = await repo.transaction(async (tx) => {
        const user = await resolveUser(tx, openid);
        ensure(user, 'USER_NOT_INITIALIZED', '请先登录', 401);
        assertAccount(user);
        const ticket = await tx.get<Upload>('file_uploads', data.upload_id);
        ensure(
          ticket?.openid === openid && ticket.owner_id === user._id,
          'NOT_FOUND',
          '上传凭据不存在',
          404,
        );
        return ticket;
      });
      if (upload.file_id) {
        const existing = await repo.get<StoredFile>('files', upload.file_id);
        ensure(
          upload.source_cloud_file_id === data.cloud_file_id &&
            existing?.content_hash === data.hash,
          'IDEMPOTENCY_CONFLICT',
          '上传已绑定其他文件',
          409,
        );
        return { file_id: existing._id, check_status: existing.check_status };
      }
      ensure(upload.expires_at > now, 'STATE_CONFLICT', '上传凭据已过期', 409);
      ensure(provider, 'DEPENDENCY_UNAVAILABLE', '文件检查适配器尚未配置', 503);
      verified = await provider.verify(
        data.cloud_file_id,
        upload.cloud_path,
        upload.mime,
        upload.size,
        data.hash,
        async (cloudFileId) => {
          const root = data.cloud_file_id.slice(0, -upload.cloud_path.length);
          const expectedPath = `${root}private/files/${upload._id}/${data.hash}/`;
          ensure(
            !plannedCopy &&
              cloudFileId.startsWith(expectedPath) &&
              /^[a-f0-9-]{36}$/u.test(cloudFileId.slice(expectedPath.length)),
            'DEPENDENCY_UNAVAILABLE',
            '私有副本路径无法核验',
            503,
          );
          await repo.transaction(async (tx) => {
            await touchMigrationFence(tx);
            const user = await resolveUser(tx, openid);
            ensure(user, 'USER_NOT_INITIALIZED', '请先登录', 401);
            assertAccount(user);
            const current = await tx.get<Upload>('file_uploads', data.upload_id);
            ensure(
              current?.owner_id === user._id &&
                current.openid === openid &&
                current.cloud_path === upload.cloud_path &&
                current.expires_at > now,
              'STATE_CONFLICT',
              '上传凭据已失效',
              409,
            );
            const taskId = hash(['private-copy', cloudFileId]);
            ensure(
              !(await tx.get('storage_cleanup_tasks', taskId)),
              'STATE_CONFLICT',
              '副本登记冲突',
              409,
            );
            await tx.put('storage_cleanup_tasks', {
              _id: taskId,
              cloud_file_id: cloudFileId,
              status: 'dead',
              manual_review_required: true,
              reason: 'UPLOAD_OUTCOME_UNKNOWN',
              upload_id: data.upload_id,
              attempts: 0,
              next_retry_at: now,
              created_at: now,
            });
          });
          plannedCopy = cloudFileId;
        },
        async (cloudFileId) => {
          ensure(
            plannedCopy && /^cloud:\/\/[^/]+\/.+/u.test(cloudFileId) && cloudFileId.length <= 1024,
            'DEPENDENCY_UNAVAILABLE',
            '私有副本返回的编号异常',
            503,
          );
          await repo.transaction(async (tx) => {
            await touchMigrationFence(tx);
            const taskId = hash(['unexpected-private-copy', cloudFileId, plannedCopy]);
            if (!(await tx.get('storage_cleanup_tasks', taskId)))
              await tx.put('storage_cleanup_tasks', {
                _id: taskId,
                cloud_file_id: cloudFileId,
                status: 'dead',
                manual_review_required: true,
                reason: 'UNEXPECTED_STORAGE_ID',
                upload_id: data.upload_id,
                attempts: 0,
                next_retry_at: now,
                created_at: now,
              });
          });
        },
      );
      ensure(
        verified.hash === data.hash && verified.size === upload.size,
        'VALIDATION_FAILED',
        '文件大小或哈希不匹配',
        400,
      );
      ensure(
        verified.storage_mode !== 'immutable_private' || plannedCopy === verified.cloud_file_id,
        'DEPENDENCY_UNAVAILABLE',
        '私有副本尚未登记',
        503,
      );
    }
    return runCommand(
      repo,
      openid,
      'fileService',
      request,
      async (ctx) => {
        if (request.action === 'prepareUpload') {
          const data = requestData('fileService.prepareUpload', request);
          if (data.purpose === 'policy_banner') {
            const grant = ctx.grant;
            assertCanStartNewAction(ctx.user, grant, now);
            ensure(
              grant.role === 'super_admin' && imageMime(data.mime),
              'FORBIDDEN',
              '政策配图仅超级管理员上传图片',
            );
          }
          const max = imageMime(data.mime) ? 5 * 1024 * 1024 : 10 * 1024 * 1024;
          ensure(data.size <= max, 'VALIDATION_FAILED', '文件超过大小限制', 400);
          ensure(
            data.purpose !== 'identity' || imageMime(data.mime) || data.mime === 'application/pdf',
            'VALIDATION_FAILED',
            '认证材料仅支持图片或PDF',
            400,
          );
          ensure(
            data.purpose !== 'avatar' || imageMime(data.mime),
            'VALIDATION_FAILED',
            '头像仅支持图片',
            400,
          );
          const upload: Upload = {
            _id: ctx.command_id,
            owner_id: ctx.user._id,
            openid,
            purpose: data.purpose,
            mime: data.mime,
            size: data.size,
            cloud_path: `temporary/${openid}/${ctx.command_id}`,
            expires_at: now + 30 * 60000,
            file_id: null,
            created_at: now,
          };
          await ctx.tx.put('file_uploads', upload);
          return {
            upload_id: upload._id,
            cloud_path: upload.cloud_path,
            expires_at: upload.expires_at,
            limits: { max_bytes: max },
          };
        }
        if (request.action === 'finalizeUpload') {
          const data = requestData('fileService.finalizeUpload', request);
          const upload = await ctx.tx.get<Upload>('file_uploads', data.upload_id);
          ensure(upload?.owner_id === ctx.user._id, 'NOT_FOUND', '上传凭据已失效', 404);
          if (upload.file_id) {
            const existing = await ctx.tx.get<StoredFile>('files', upload.file_id);
            ensure(
              upload.source_cloud_file_id === data.cloud_file_id &&
                existing?.content_hash === data.hash,
              'IDEMPOTENCY_CONFLICT',
              '上传已绑定其他文件',
              409,
            );
            return { file_id: existing._id, check_status: existing.check_status };
          }
          ensure(upload.expires_at > now, 'STATE_CONFLICT', '上传凭据已过期', 409);
          ensure(verified, 'DEPENDENCY_UNAVAILABLE', '缺少文件检查结果', 503);
          ensure(
            verified.check_status !== 'pass' || verified.storage_mode === 'immutable_private',
            'DEPENDENCY_UNAVAILABLE',
            '通过检查的文件必须先固化到私有区',
            503,
          );
          if (verified.storage_mode === 'immutable_private') {
            const task = await ctx.tx.get<
              Entity & {
                cloud_file_id: string;
                status: string;
                manual_review_required: boolean;
              }
            >('storage_cleanup_tasks', hash(['private-copy', verified.cloud_file_id]));
            ensure(
              task?.cloud_file_id === verified.cloud_file_id &&
                task.status === 'dead' &&
                task.manual_review_required,
              'STATE_CONFLICT',
              '私有副本登记状态异常',
              409,
            );
            task.status = 'processed';
            task.manual_review_required = false;
            await ctx.tx.put('storage_cleanup_tasks', task);
          }
          const file: StoredFile = {
            _id: ctx.command_id,
            owner_id: ctx.user._id,
            purpose: upload.purpose,
            mime: upload.mime,
            size: verified.size,
            cloud_file_id: verified.cloud_file_id,
            storage_mode: verified.storage_mode,
            content_hash: verified.hash,
            check_status: verified.check_status,
            state: 'active',
            ref_count: 0,
            created_at: now,
          };
          upload.file_id = file._id;
          upload.source_cloud_file_id = data.cloud_file_id;
          await ctx.tx.put('files', file);
          await ctx.tx.put('file_uploads', upload);
          return { file_id: file._id, check_status: file.check_status };
        }
        const data = requestData('fileService.deleteUnbound', request);
        const file = await ctx.tx.get<StoredFile>('files', data.file_id);
        ensure(file?.owner_id === ctx.user._id, 'NOT_FOUND', '文件不存在', 404);
        ensure(file.ref_count === 0, 'STATE_CONFLICT', '文件仍在业务使用中', 409);
        if (file.state !== 'active') return { deleted: true };
        file.state = 'deleting';
        await ctx.tx.put('files', file);
        await ctx.tx.put('outbox_events', {
          _id: ctx.command_id,
          type: 'file.delete',
          file_id: file._id,
          status: 'pending',
          attempts: 0,
          next_retry_at: now,
          created_at: now,
        });
        return { deleted: true };
      },
      now,
    );
  }
  async function read(openid: string, request: CallRequest, now: number) {
    const readStarted = Date.now();
    if (request.action === 'getUploadTicket') {
      const { upload_id } = requestData('fileService.getUploadTicket', request);
      const started = Date.now();
      const authorize = async (time: number) =>
        repo.transaction(async (tx) => {
          const gate = await tx.get<Entity & { status: string; schema_version: number }>(
            'system_guards',
            'v2_migration',
          );
          ensure(
            gate?.status === 'verified' && gate.schema_version === 2,
            'MIGRATION_REQUIRED',
            '迁移尚未完成核验',
            503,
          );
          const user = await resolveUser(tx, openid);
          ensure(user, 'USER_NOT_INITIALIZED', '请先登录', 401);
          assertAccount(user);
          const upload = await tx.get<Upload>('file_uploads', upload_id);
          ensure(
            upload?.owner_id === user._id && upload.openid === openid,
            'NOT_FOUND',
            '上传凭据不存在',
            404,
          );
          ensure(
            !upload.file_id && upload.expires_at > time,
            'STATE_CONFLICT',
            '上传已完成或凭据已过期',
            409,
          );
          if (upload.purpose === 'policy_banner') {
            const grant = request.grant_id
              ? await tx.get<Grant>('role_grants', request.grant_id)
              : null;
            assertCanStartNewAction(user, grant, time);
            ensure(grant.role === 'super_admin', 'FORBIDDEN', '配图上传需要超级管理员身份');
          }
          return upload;
        });
      const upload = await authorize(now);
      ensure(provider?.uploadTicket, 'DEPENDENCY_UNAVAILABLE', '受控上传服务尚未就绪', 503);
      const ticket = await provider.uploadTicket(
        {
          path: upload.cloud_path,
          mime: upload.mime,
          size: upload.size,
          expires_at: Math.min(upload.expires_at, now + 120000),
        },
        now,
      );
      const after = now + Math.max(0, Date.now() - started);
      const current = await authorize(after);
      ensure(
        hash(current) === hash(upload) &&
          ticket.expires_at > after &&
          ticket.expires_at <= Math.min(upload.expires_at, now + 120000),
        'STATE_CONFLICT',
        '上传凭据已变化或过期',
        409,
      );
      return ticket;
    }
    const data = requestData('fileService.getAccessUrl', request);
    const files = await repo.transaction(async (tx) => {
      const user = await resolveUser(tx, openid);
      if (user) assertAccount(user);
      ensure(user || data.resource_type === 'demand', 'USER_NOT_INITIALIZED', '请先登录', 401);
      const grant = request.grant_id ? await tx.get<Grant>('role_grants', request.grant_id) : null;
      const result: Array<{ file: StoredFile; deadline: number }> = [];
      for (const id of data.file_ids) {
        const file = await tx.get<StoredFile>('files', id);
        ensure(file?.state === 'active', 'NOT_FOUND', '文件不存在', 404);
        if (data.resource_type === 'demand') {
          ensure(
            file.check_status === 'pass' &&
              ['immutable_private', 'trusted_generated'].includes(file.storage_mode),
            'NOT_FOUND',
            '文件尚未完成核验',
            404,
          );
          const binding = await tx.get<Entity & { active: boolean }>(
            'file_bindings',
            hash([id, 'demand', data.resource_id]),
          );
          ensure(binding?.active, 'NOT_FOUND', '文件不属于此资源', 404);
          const deadline = await demandFileDeadline(tx, user, grant, data.resource_id, file, now);
          ensure(deadline > now, 'NOT_FOUND', '访问期限已过', 404);
          result.push({ file, deadline });
          continue;
        }
        ensure(user, 'USER_NOT_INITIALIZED', '请先登录', 401);
        let deadline = now + 5 * 60000;
        if (data.resource_type === 'upload')
          ensure(
            file.owner_id === user._id && file.ref_count === 0 && data.resource_id === id,
            'FORBIDDEN',
            '只能读取本人未绑定文件',
          );
        else {
          ensure(
            ['immutable_private', 'trusted_generated'].includes(file.storage_mode),
            'NOT_FOUND',
            '文件尚未完成迁移核验',
            404,
          );
          const binding = await tx.get<Entity & { active: boolean }>(
            'file_bindings',
            hash([id, data.resource_type, data.resource_id]),
          );
          ensure(binding?.active, 'NOT_FOUND', '文件不属于此资源', 404);
          if (data.resource_type === 'avatar') {
            ensure(
              data.resource_id === user._id && user.avatar_file_id === file._id,
              'NOT_FOUND',
              '头像不存在',
              404,
            );
          } else if (data.resource_type === 'export') {
            const job = await tx.get<ExportJob>('export_jobs', data.resource_id);
            ensure(
              job?.status === 'ready' &&
                job.file_id === file._id &&
                job.owner_id === user._id &&
                job.expires_at !== null,
              'NOT_FOUND',
              '导出文件不存在',
              404,
            );
            const auth = await authorizeStats(tx, openid, request.grant_id, job.scope, now);
            ensure(
              hash(auth.scope) === hash(job.scope),
              'SCOPE_FORBIDDEN',
              '当前身份不覆盖导出范围',
            );
            deadline = Math.min(deadline, job.expires_at);
          } else if (data.resource_type === 'message') {
            const message = await tx.get<ChatMessage>('messages', data.resource_id);
            ensure(message && message.file_id === file._id, 'NOT_FOUND', '消息附件不存在', 404);
            const conversation = await tx.get<Conversation>(
              'conversations',
              message.conversation_id,
            );
            ensure(
              conversation?.participant_user_ids.includes(user._id),
              'NOT_FOUND',
              '消息附件不存在',
              404,
            );
            deadline = Math.min(deadline, message.created_at + 180 * 86400000);
          } else if (data.resource_type === 'application') {
            const app = await tx.get<Application>('role_applications', data.resource_id);
            ensure(app, 'NOT_FOUND', '申请不存在', 404);
            if (app.reviewed_at !== null)
              deadline = Math.min(deadline, app.reviewed_at + 180 * 86400000);
            if (app.applicant_id !== user._id) {
              assertCanStartNewAction(user, grant, now);
              ensure(
                grant.role === 'local_admin' || grant.role === 'super_admin',
                'FORBIDDEN',
                '审核资料需要管理身份',
              );
              const actualReviewer = app.reviewed_by === user._id;
              const canPending =
                app.status === 'pending' &&
                (grant.role === 'super_admin' ||
                  (grant.role === 'local_admin' &&
                    ((app.requested_role === 'teacher_student' && app.organization_id === 'sztu') ||
                      (app.requested_role === 'farmer' &&
                        app.scope_region_id === grant.scope_region_id))));
              ensure(
                grant.role === 'super_admin' || actualReviewer || canPending,
                'FORBIDDEN',
                '无权读取认证材料',
              );
            }
          }
        }
        ensure(deadline > now, 'NOT_FOUND', '访问期限已过', 404);
        result.push({ file, deadline });
      }
      return result;
    });
    ensure(provider, 'DEPENDENCY_UNAVAILABLE', '私有下载服务尚未配置', 503);
    const output = [];
    for (const { file, deadline } of files) {
      const seconds = Math.max(1, Math.floor((deadline - now) / 1000));
      const access = await provider.access(file.cloud_file_id, seconds, deadline);
      const expiresAt = access.expires_at ?? now + access.max_age * 1000;
      ensure(
        Number.isFinite(access.max_age) &&
          access.max_age > 0 &&
          access.max_age <= seconds &&
          Number.isSafeInteger(expiresAt) &&
          expiresAt <= deadline &&
          expiresAt > now + Math.max(0, Date.now() - readStarted),
        'DEPENDENCY_UNAVAILABLE',
        '供应商下载链接期限超出业务边界',
        503,
      );
      output.push({
        file_id: file._id,
        url: access.url,
        expires_at: expiresAt,
        mime: file.mime,
      });
    }
    return output;
  }
  return { write, read };
}
export function sniffMime(bytes: Buffer): string | null {
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return 'image/jpeg';
  if (
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  )
    return 'image/webp';
  if (bytes.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf';
  return null;
}
export const fileHash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
