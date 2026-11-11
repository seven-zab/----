import { randomBytes } from 'node:crypto';
import type { Application, Grant, Region, User, Scene } from '../../core/entities';
import type { Entity, Repository, Transaction } from '../../core/repository';
import type { CallRequest } from '../../core/request';
import { requestData, validateResponse } from '../../core/request';
import { assertAccount, assertCanStartNewAction, assertScene, SZTU } from '../../core/policy';
import { ensure } from '../../core/errors';
import {
  audit,
  resolveUser,
  runCommand,
  touchMigrationFence,
  touchGuards,
  userIdentityId,
  type Context,
} from '../../core/command';
import { hash } from '../../core/hash';
import type { PrivateDataCodec } from '../../core/private-data';
import { decodeCursor, encodeCursor, paginate } from '../../core/pagination';
import { bindFile, unbindFile } from '../file/service';
import { normalizeForm, checkForm, resourceScene } from '../demand/service';
import { delegationDTO, type Delegation } from './delegation';
import type { DraftInput } from '../../../contracts/generated/dto';

async function publisherGrant(tx: Transaction, user: User, scene: Scene, now: number) {
  for (const id of user.grant_ids) {
    const grant = await tx.get<Grant>('role_grants', id);
    try {
      assertCanStartNewAction(user, grant, now);
      assertScene(grant, scene, 'publish');
      return grant;
    } catch {
      /* Other roles do not imply this scene's publishing permission. */
    }
  }
  ensure(false, 'ROLE_NOT_APPROVED', '受益人需要此场景的有效发布资格');
}

interface GrantSlot extends Entity {
  grant_id: string | null;
  pending_application_id: string | null;
}
interface AdminGuard extends Entity {
  active_super_admin_ids: string[];
  version: number;
}
interface File extends Entity {
  owner_id: string;
  purpose: string;
  check_status: string;
  state: string;
}
export const toGrantDTO = (g: Grant) => ({
  grant_id: g._id,
  role: g.role,
  profile_kind: g.profile_kind,
  organization_id: g.organization_id,
  scope_type: g.scope_type,
  scope_region_id: g.scope_region_id,
  status: g.status,
  expires_at: g.expires_at,
  renewed_from: g.renewed_from,
});
const toApplicationDTO = (a: Application) => ({
  application_id: a._id,
  requested_role: a.requested_role,
  profile_kind: a.profile_kind,
  scope_region_id: a.scope_region_id,
  organization_id: a.organization_id,
  review_scope: a.review_scope,
  status: a.status,
  version: a.version,
  created_at: a.created_at,
  reason: a.reason,
});
export async function userMe(tx: Transaction, user: User, now: number) {
  const grants = await Promise.all(user.grant_ids.map((id) => tx.get<Grant>('role_grants', id)));
  const applications = await Promise.all(
    user.application_ids.map((id) => tx.get<Application>('role_applications', id)),
  );
  return {
    user_id: user._id,
    user_code: user.user_code,
    display_name: user.display_name,
    avatar_file_id: user.avatar_file_id,
    account_status: user.account_status,
    auth_version: user.auth_version,
    grants: grants
      .filter((g): g is Grant => g !== null)
      .map((g) =>
        toGrantDTO({
          ...g,
          status:
            g.status === 'active' && g.expires_at !== null && g.expires_at <= now
              ? 'expired'
              : g.status,
        }),
      ),
    application_summaries: applications
      .filter((a): a is Application => a !== null)
      .map((a) => ({ application_id: a._id, requested_role: a.requested_role, status: a.status })),
  };
}
async function village(tx: Transaction, regionId: string) {
  const region = await tx.get<Region>('regions', regionId);
  ensure(
    region?.active && region.level === 'village' && region.ancestor_ids.includes('441623'),
    'VALIDATION_FAILED',
    '请选择连平县已启用试点村',
    400,
  );
  return region;
}
async function validateMaterials(ctx: Context, ids: string[]) {
  for (const id of ids) {
    const file = await ctx.tx.get<File>('files', id);
    ensure(
      file &&
        file.owner_id === ctx.user._id &&
        file.purpose === 'identity' &&
        file.state === 'active',
      'FORBIDDEN',
      '证明文件不可用',
    );
    ensure(file.check_status === 'pass', 'CONTENT_CHECK_PENDING', '证明材料尚未通过检查', 422);
  }
}
function assertReviewer(ctx: Context, app: Application) {
  assertCanStartNewAction(ctx.user, ctx.grant, ctx.now);
  ensure(
    ctx.grant.role === 'super_admin' || ctx.grant.role === 'local_admin',
    'FORBIDDEN',
    '需要管理身份',
  );
  if (ctx.grant.role === 'super_admin') return;
  ensure(
    (app.requested_role === 'teacher_student' && app.organization_id === SZTU) ||
      (app.requested_role === 'farmer' && app.scope_region_id === ctx.grant.scope_region_id),
    'SCOPE_FORBIDDEN',
    '申请不在当前审核范围',
  );
}
async function saveApplication(
  ctx: Context,
  input: {
    requested_role: Grant['role'];
    profile_kind: Grant['profile_kind'];
    scope_region_id: string | null;
    organization_id: string | null;
    material_ids: string[];
    source_grant_id: string | null;
  },
  sensitive: unknown,
) {
  if (input.requested_role !== 'teacher_student')
    await village(ctx.tx, input.scope_region_id ?? '');
  await validateMaterials(ctx, input.material_ids);
  const lockId = hash([
    ctx.user._id,
    input.requested_role,
    input.scope_region_id,
    input.organization_id,
  ]);
  const lock = await ctx.tx.get<GrantSlot>('grant_slots', lockId);
  if (lock?.pending_application_id) {
    if (input.source_grant_id)
      return { application_id: lock.pending_application_id, status: 'pending' as const };
    ensure(false, 'APPLICATION_ALREADY_PENDING', '已有待审核申请', 409);
  }
  if (lock?.grant_id) {
    const old = await ctx.tx.get<Grant>('role_grants', lock.grant_id);
    ensure(
      !old || old.status !== 'active' || (old.expires_at !== null && old.expires_at <= ctx.now),
      'GRANT_ALREADY_EXISTS',
      '已有相同有效身份',
      409,
    );
  }
  ensure(ctx.user.application_ids.length < 1000, 'RATE_LIMITED', '申请记录过多，请联系管理员', 429);
  const app: Application = {
    _id: ctx.command_id,
    applicant_id: ctx.user._id,
    ...input,
    review_scope:
      input.requested_role === 'teacher_student'
        ? 'sztu_shared'
        : input.requested_role === 'local_admin'
        ? 'platform_admin'
        : `village:${input.scope_region_id}`,
    status: 'pending',
    version: 1,
    created_at: ctx.now,
    reviewed_at: null,
    reviewed_by: null,
    reason: null,
    lock_id: lockId,
  };
  await ctx.tx.put('role_applications', app);
  await ctx.tx.put('grant_slots', {
    _id: lockId,
    grant_id: lock?.grant_id ?? null,
    pending_application_id: app._id,
  });
  ctx.user.application_ids.push(app._id);
  await ctx.tx.put('users', ctx.user);
  await ctx.tx.put('role_application_private', { _id: app._id, ciphertext: sensitive });
  for (const fileId of input.material_ids)
    await bindFile(ctx.tx, fileId, 'application', app._id, ctx.now);
  await audit(ctx, app._id, '身份申请已提交');
  return { application_id: app._id, status: 'pending' as const };
}
export function createUserService(repo: Repository, codec: PrivateDataCodec) {
  async function bootstrap(openid: string, request: CallRequest, now: number) {
    ensure(openid, 'UNAUTHENTICATED', '请先登录', 401);
    // Historical accounts need an identity mapping; never infer grants from role strings.
    const legacy = await repo.find<User>('users', { _openid: openid }, 2);
    ensure(legacy.length <= 1, 'DEPENDENCY_UNAVAILABLE', '历史身份重复，需迁移核验', 503);
    const identityId = userIdentityId(openid);
    const code = randomBytes(12).toString('hex');
    const receiptId = hash([openid, 'userService', 'bootstrap', request.idempotency_key]);
    const requestHash = hash({
      action: request.action,
      data: request.data,
      grant_id: request.grant_id,
    });
    return repo.transaction(async (tx) => {
      await touchMigrationFence(tx);
      let user = await resolveUser(tx, openid);
      if (!user) {
        const old = legacy[0];
        if (old)
          ensure(
            old.account_status && Array.isArray(old.grant_ids),
            'DEPENDENCY_UNAVAILABLE',
            '历史账号须先完成安全迁移',
            503,
          );
        user = old ?? {
          _id: identityId,
          _openid: openid,
          user_code: code,
          display_name: '微信用户',
          avatar_file_id: null,
          account_status: 'active',
          auth_version: 1,
          operation_seq: 0,
          grant_ids: [],
          application_ids: [],
          created_at: now,
        };
        await tx.put('users', user);
        await tx.put('wechat_identities', { _id: identityId, user_id: user._id });
      }
      assertAccount(user);
      const previous = await tx.get<
        Entity & { request_hash: string; response: unknown; expires_at: number }
      >('idempotency_keys', receiptId);
      if (previous && previous.expires_at > now) {
        ensure(
          previous.request_hash === requestHash,
          'IDEMPOTENCY_CONFLICT',
          '同一幂等键对应不同请求',
          409,
        );
        return previous.response;
      }
      await touchGuards(tx, [user]);
      const response = await userMe(tx, user, now);
      validateResponse('userService.bootstrap', response);
      await tx.put('idempotency_keys', {
        _id: receiptId,
        request_hash: requestHash,
        response,
        expires_at: now + 7 * 86400000,
      });
      return response;
    });
  }
  async function write(openid: string, request: CallRequest, now: number) {
    if (request.action === 'bootstrap') return bootstrap(openid, request, now);
    return runCommand(
      repo,
      openid,
      'userService',
      request,
      async (ctx) => {
        switch (request.action) {
          case 'requestDelegation': {
            const data = requestData('userService.requestDelegation', request);
            assertCanStartNewAction(ctx.user, ctx.grant, now);
            const form = normalizeForm(data.draft);
            checkForm(form, false, now);
            const scene = await resourceScene(ctx.tx, form);
            assertScene(ctx.grant, scene, 'manage');
            const beneficiary = await ctx.tx.get<User>('users', data.beneficiary_user_id);
            ensure(beneficiary, 'NOT_FOUND', '受益人尚未注册', 404);
            const grant = await publisherGrant(ctx.tx, beneficiary, scene, now);
            await touchGuards(ctx.tx, [beneficiary]);
            const authorization: Delegation = {
              _id: ctx.command_id,
              ...scene,
              beneficiary_id: beneficiary._id,
              delegate_id: ctx.user._id,
              participant_user_ids: [...new Set([beneficiary._id, ctx.user._id])],
              status: 'pending',
              version: 1,
              created_at: now,
              ciphertext: codec.seal(form),
              draft_hash: null,
              beneficiary_grant_id: grant._id,
              consumed_demand_id: null,
              consumed_result: null,
            };
            await ctx.tx.put('delegation_authorizations', authorization);
            await audit(ctx, authorization._id, '申请本次单条需求代发授权');
            return delegationDTO(authorization);
          }
          case 'respondDelegation':
          case 'revokeDelegation': {
            const data = requestData(`userService.${request.action}`, request);
            const authorization = await ctx.tx.get<Delegation>(
              'delegation_authorizations',
              data.authorization_id,
            );
            ensure(authorization?.beneficiary_id === ctx.user._id, 'NOT_FOUND', '授权不存在', 404);
            if (request.action === 'revokeDelegation' && authorization.status === 'consumed')
              return delegationDTO(authorization);
            ensure(
              authorization.version === data.expected_version,
              'VERSION_CONFLICT',
              '授权已更新',
              409,
            );
            if (request.action === 'respondDelegation') {
              const input = requestData('userService.respondDelegation', request);
              ensure(authorization.status === 'pending', 'STATE_CONFLICT', '授权已处理', 409);
              if (input.decision === 'approve') {
                const form = normalizeForm(
                  input.confirmed_demand ?? (codec.open(authorization.ciphertext) as DraftInput),
                );
                checkForm(form, true, now);
                const scene = await resourceScene(ctx.tx, form);
                ensure(
                  scene.business_scene === authorization.business_scene &&
                    scene.region_id === authorization.region_id &&
                    scene.campus_organization_id === authorization.campus_organization_id,
                  'VALIDATION_FAILED',
                  '变更场景或归属需要重新申请授权',
                  400,
                );
                const grant = await publisherGrant(ctx.tx, ctx.user, scene, now);
                authorization.beneficiary_grant_id = grant._id;
                authorization.ciphertext = codec.seal(form);
                authorization.draft_hash = hash(form);
              }
              authorization.status = input.decision === 'approve' ? 'approved' : 'rejected';
            } else {
              ensure(
                ['pending', 'approved'].includes(authorization.status),
                'STATE_CONFLICT',
                '当前授权不能撤销',
                409,
              );
              authorization.status = 'revoked';
            }
            authorization.version++;
            await ctx.tx.put('delegation_authorizations', { ...authorization, responded_at: now });
            await audit(ctx, authorization._id, `代发授权:${authorization.status}`);
            return delegationDTO(authorization);
          }
          case 'updateProfile': {
            const data = requestData('userService.updateProfile', request);
            if (data.avatar_file_id) {
              const file = await ctx.tx.get<File>('files', data.avatar_file_id);
              ensure(
                file?.owner_id === ctx.user._id &&
                  file.check_status === 'pass' &&
                  file.purpose === 'avatar',
                'FORBIDDEN',
                '头像文件不可用',
              );
              await bindFile(ctx.tx, data.avatar_file_id, 'avatar', ctx.user._id, now);
              if (ctx.user.avatar_file_id && ctx.user.avatar_file_id !== data.avatar_file_id)
                await unbindFile(ctx.tx, ctx.user.avatar_file_id, 'avatar', ctx.user._id);
              ctx.user.avatar_file_id = data.avatar_file_id;
            }
            if (data.display_name !== undefined) ctx.user.display_name = data.display_name.trim();
            ensure(ctx.user.display_name.length > 0, 'VALIDATION_FAILED', '姓名不能为空', 400);
            await ctx.tx.put('users', ctx.user);
            await audit(ctx, ctx.user._id, '更新本人公开资料');
            return userMe(ctx.tx, ctx.user, now);
          }
          case 'applyRole': {
            const data = requestData('userService.applyRole', request);
            return saveApplication(
              ctx,
              {
                requested_role: data.requested_role,
                profile_kind: 'profile_kind' in data ? data.profile_kind : null,
                scope_region_id: 'scope_region_id' in data ? data.scope_region_id : null,
                organization_id: 'organization_id' in data ? data.organization_id : null,
                material_ids: data.material_ids,
                source_grant_id: null,
              },
              codec.seal(data),
            );
          }
          case 'applyRenewal': {
            const data = requestData('userService.applyRenewal', request);
            const source = await ctx.tx.get<Grant>('role_grants', data.source_grant_id);
            ensure(
              source?.user_id === ctx.user._id &&
                source.role === 'teacher_student' &&
                source.organization_id === SZTU &&
                source.status !== 'revoked' &&
                source.revoked_at === null,
              'FORBIDDEN',
              '仅可复核本人本校师生身份',
            );
            return saveApplication(
              ctx,
              {
                requested_role: 'teacher_student',
                profile_kind: data.profile_kind,
                scope_region_id: null,
                organization_id: SZTU,
                material_ids: data.material_ids,
                source_grant_id: source._id,
              },
              codec.seal(data),
            );
          }
          case 'withdrawApplication': {
            const data = requestData('userService.withdrawApplication', request);
            const app = await ctx.tx.get<Application>('role_applications', data.application_id);
            ensure(app?.applicant_id === ctx.user._id, 'NOT_FOUND', '申请不存在', 404);
            ensure(app.status === 'pending', 'STATE_CONFLICT', '申请已处理', 409);
            ensure(app.version === data.expected_version, 'VERSION_CONFLICT', '申请已更新', 409);
            app.status = 'withdrawn';
            app.version++;
            app.reviewed_at = now;
            await ctx.tx.put('role_applications', app);
            const slot = await ctx.tx.get<GrantSlot>('grant_slots', app.lock_id);
            if (slot?.pending_application_id === app._id)
              await ctx.tx.put('grant_slots', { ...slot, pending_application_id: null });
            await audit(ctx, app._id, '本人撤回身份申请');
            return { application_id: app._id, status: app.status, version: app.version };
          }
          case 'reviewRoleApplication': {
            const data = requestData('userService.reviewRoleApplication', request);
            const app = await ctx.tx.get<Application>('role_applications', data.application_id);
            ensure(app, 'NOT_FOUND', '申请不存在', 404);
            assertReviewer(ctx, app);
            ensure(app.applicant_id !== ctx.user._id, 'FORBIDDEN', '不能审核本人身份申请');
            ensure(app.version === data.expected_version, 'VERSION_CONFLICT', '申请已更新', 409);
            ensure(app.status === 'pending', 'STATE_CONFLICT', '申请已处理', 409);
            ensure(
              data.decision === 'approve' || data.reason,
              'VALIDATION_FAILED',
              '驳回需要原因',
              400,
            );
            const applicant = await ctx.tx.get<User>('users', app.applicant_id);
            ensure(applicant, 'NOT_FOUND', '申请人不存在', 404);
            await touchGuards(ctx.tx, [applicant]);
            const slot = await ctx.tx.get<GrantSlot>('grant_slots', app.lock_id);
            ensure(slot?.pending_application_id === app._id, 'STATE_CONFLICT', '申请锁不匹配', 409);
            app.status = data.decision === 'approve' ? 'approved' : 'rejected';
            app.reviewed_at = now;
            app.reviewed_by = ctx.user._id;
            app.reason = data.reason ?? null;
            app.version++;
            let grantId: string | undefined;
            if (data.decision === 'approve') {
              grantId = `grant_${app._id}`;
              const grant: Grant = {
                _id: grantId,
                user_id: applicant._id,
                role: app.requested_role,
                profile_kind: app.profile_kind,
                organization_id: app.organization_id,
                scope_type: app.requested_role === 'teacher_student' ? 'self' : 'region',
                scope_region_id: app.scope_region_id,
                status: 'active',
                expires_at: app.requested_role === 'teacher_student' ? now + 365 * 86400000 : null,
                renewed_from: app.source_grant_id,
                revoked_at: null,
              };
              await ctx.tx.put('role_grants', grant);
              applicant.grant_ids.push(grantId);
              applicant.auth_version++;
              await ctx.tx.put('users', applicant);
              const privateRecord = await ctx.tx.get<Entity & { ciphertext: string }>(
                'role_application_private',
                app._id,
              );
              ensure(privateRecord, 'STATE_CONFLICT', '认证资料记录缺失', 409);
              const details = codec.open(privateRecord.ciphertext) as {
                contact_name: string;
                contact_phone: string;
              };
              await ctx.tx.put('user_private', {
                _id: applicant._id,
                ciphertext: codec.seal({
                  contact_name: details.contact_name,
                  contact_phone: details.contact_phone,
                }),
                source_application_id: app._id,
              });
            }
            await ctx.tx.put('role_applications', app);
            await ctx.tx.put('grant_slots', {
              ...slot,
              grant_id: grantId ?? slot.grant_id,
              pending_application_id: null,
            });
            await audit(ctx, app._id, `身份审核:${app.status}`);
            return {
              application_id: app._id,
              status: app.status,
              ...(grantId ? { grant_id: grantId } : {}),
            };
          }
          case 'grantManagementRole': {
            const data = requestData('userService.grantManagementRole', request);
            assertCanStartNewAction(ctx.user, ctx.grant, now);
            ensure(
              ctx.grant.role === 'super_admin' && data.target_user_id !== ctx.user._id,
              'FORBIDDEN',
              '仅超级管理员可向他人授权',
            );
            if (data.role === 'local_admin') await village(ctx.tx, data.scope_region_id ?? '');
            ensure(
              data.role !== 'super_admin' || !data.scope_region_id,
              'VALIDATION_FAILED',
              '平台授权不能带村域',
              400,
            );
            const target = await ctx.tx.get<User>('users', data.target_user_id);
            ensure(target, 'NOT_FOUND', '用户不存在', 404);
            await touchGuards(ctx.tx, [target]);
            const lockId = hash([
              target._id,
              data.role,
              data.scope_region_id ?? null,
              data.organization_id ?? null,
            ]);
            const slot = await ctx.tx.get<GrantSlot>('grant_slots', lockId);
            const existing = slot?.grant_id
              ? await ctx.tx.get<Grant>('role_grants', slot.grant_id)
              : null;
            ensure(
              !existing || existing.status === 'revoked',
              'GRANT_ALREADY_EXISTS',
              '身份已存在',
              409,
            );
            const grant: Grant = {
              _id: ctx.command_id,
              user_id: target._id,
              role: data.role,
              profile_kind: null,
              organization_id: data.organization_id ?? null,
              scope_type: data.role === 'super_admin' ? 'platform' : 'region',
              scope_region_id: data.scope_region_id ?? null,
              status: 'active',
              expires_at: null,
              renewed_from: null,
              revoked_at: null,
            };
            if (grant.role === 'super_admin') {
              const guard = await ctx.tx.get<AdminGuard>('system_guards', 'super_admin');
              ensure(guard, 'DEPENDENCY_UNAVAILABLE', '管理员保护记录尚未初始化', 503);
              guard.active_super_admin_ids.push(grant._id);
              guard.version++;
              await ctx.tx.put('system_guards', guard);
            }
            target.grant_ids.push(grant._id);
            target.auth_version++;
            await ctx.tx.put('users', target);
            await ctx.tx.put('role_grants', grant);
            await ctx.tx.put('grant_slots', {
              _id: lockId,
              grant_id: grant._id,
              pending_application_id: null,
            });
            await audit(ctx, grant._id, data.reason);
            return toGrantDTO(grant);
          }
          case 'revokeGrant': {
            const data = requestData('userService.revokeGrant', request);
            assertCanStartNewAction(ctx.user, ctx.grant, now);
            ensure(ctx.grant.role === 'super_admin', 'FORBIDDEN', '需要超级管理员身份');
            const grant = await ctx.tx.get<Grant>('role_grants', data.grant_id);
            ensure(grant, 'NOT_FOUND', '授权不存在', 404);
            const target = await ctx.tx.get<User>('users', grant.user_id);
            ensure(target, 'NOT_FOUND', '用户不存在', 404);
            if (grant.status !== 'revoked') {
              if (grant.role === 'super_admin') {
                const guard = await ctx.tx.get<AdminGuard>('system_guards', 'super_admin');
                ensure(
                  guard && guard.active_super_admin_ids.includes(grant._id),
                  'DEPENDENCY_UNAVAILABLE',
                  '管理员保护记录不一致',
                  503,
                );
                ensure(
                  guard.active_super_admin_ids.length > 1,
                  'FORBIDDEN',
                  '不能撤销最后一个超级管理员',
                );
                guard.active_super_admin_ids = guard.active_super_admin_ids.filter(
                  (id) => id !== grant._id,
                );
                guard.version++;
                await ctx.tx.put('system_guards', guard);
              }
              await touchGuards(ctx.tx, [target]);
              target.auth_version++;
              grant.status = 'revoked';
              grant.revoked_at = now;
              await ctx.tx.put('role_grants', grant);
              await ctx.tx.put('users', target);
            }
            await audit(ctx, grant._id, data.reason);
            return { grant_id: grant._id, status: 'revoked' };
          }
          default:
            ensure(false, 'UNKNOWN_ACTION', '未知业务动作', 400);
        }
      },
      now,
    );
  }
  async function read(openid: string, request: CallRequest, now: number) {
    if (request.action === 'listRegions') {
      const data = requestData('userService.listRegions', request);
      const regions = await repo.find<Region>(
        'regions',
        {
          active: true,
          ...(data.parent_id ? { parent_id: data.parent_id } : { level: 'village' }),
        },
        50,
      );
      return { items: regions.map((r) => ({ region_id: r._id, name: r.name, level: r.level })) };
    }
    ensure(openid, 'UNAUTHENTICATED', '请先登录', 401);
    if (request.action === 'listMyDelegations') {
      const data = requestData('userService.listMyDelegations', request);
      const user = await repo.transaction(async (tx) => {
        const actor = await resolveUser(tx, openid);
        ensure(actor, 'USER_NOT_INITIALIZED', '请先登录', 401);
        assertAccount(actor);
        return actor;
      });
      const filter = {
        participant_user_ids: user._id,
        ...(data.status ? { status: data.status } : {}),
      };
      const scope = { actor: user._id, filter };
      const size = data.page_size ?? 20;
      const rows = await repo.find<Delegation>('delegation_authorizations', filter, size + 1, {
        after: decodeCursor(data.cursor, scope),
        newest: true,
      });
      await repo.transaction(async (tx) => {
        const current = await tx.get<User>('users', user._id);
        ensure(current, 'USER_NOT_INITIALIZED', '请先登录', 401);
        assertAccount(current);
      });
      const items = rows.slice(0, size);
      const has_more = rows.length > size;
      return {
        items: items.map(delegationDTO),
        has_more,
        next_cursor: has_more ? encodeCursor(items[items.length - 1], scope) : null,
      };
    }
    if (request.action === 'listPendingApplications') {
      const data = requestData('userService.listPendingApplications', request);
      const context = await repo.transaction(async (tx) => {
        const user = await resolveUser(tx, openid);
        ensure(user, 'USER_NOT_INITIALIZED', '请先登录', 401);
        const grant = request.grant_id
          ? await tx.get<Grant>('role_grants', request.grant_id)
          : null;
        assertCanStartNewAction(user, grant, now);
        ensure(
          grant.role === 'local_admin' || grant.role === 'super_admin',
          'FORBIDDEN',
          '需要管理身份',
        );
        ensure(
          data.queue !== 'local_admin' || grant.role === 'super_admin',
          'FORBIDDEN',
          '管理申请仅超管审核',
        );
        ensure(
          !data.region_id ||
            grant.role === 'super_admin' ||
            data.region_id === grant.scope_region_id,
          'SCOPE_FORBIDDEN',
          '超出授权村域',
        );
        return { grant };
      });
      const filter: Record<string, string> = { status: 'pending', requested_role: data.queue };
      if (data.queue === 'farmer' && context.grant.role === 'local_admin')
        filter.scope_region_id = context.grant.scope_region_id ?? '';
      else if (data.region_id) filter.scope_region_id = data.region_id;
      const scope = { actor: openid, grant: context.grant._id, filter };
      const size = data.page_size ?? 20;
      const rows = await repo.find<Application>('role_applications', filter, size + 1, {
        after: decodeCursor(data.cursor, scope),
        newest: true,
      });
      const items = rows.slice(0, size);
      const has_more = rows.length > size;
      return {
        items: items.map(toApplicationDTO),
        next_cursor: has_more ? encodeCursor(items[items.length - 1], scope) : null,
        has_more,
      };
    }
    return repo.transaction(async (tx) => {
      const user = await resolveUser(tx, openid);
      ensure(user, 'USER_NOT_INITIALIZED', '请先登录', 401);
      assertAccount(user);
      if (request.action === 'getMe') return userMe(tx, user, now);
      if (request.action === 'getDelegation') {
        const data = requestData('userService.getDelegation', request);
        const authorization = await tx.get<Delegation>(
          'delegation_authorizations',
          data.authorization_id,
        );
        ensure(
          authorization && authorization.participant_user_ids.includes(user._id),
          'NOT_FOUND',
          '授权不存在',
          404,
        );
        if (user._id !== authorization.beneficiary_id) {
          const grant = request.grant_id
            ? await tx.get<Grant>('role_grants', request.grant_id)
            : null;
          assertCanStartNewAction(user, grant, now);
          assertScene(grant, authorization, 'manage');
        }
        await tx.put('audit_logs', {
          _id: request.request_id,
          actor_user_id: user._id,
          action: 'getDelegation',
          target: authorization._id,
          created_at: now,
        });
        return {
          authorization: delegationDTO(authorization),
          draft: codec.open(authorization.ciphertext),
        };
      }
      if (request.action === 'getMyContact') {
        const p = await tx.get<Entity & { ciphertext: string; source_application_id: string }>(
          'user_private',
          user._id,
        );
        const details = p
          ? (codec.open(p.ciphertext) as { contact_name: string; contact_phone: string })
          : { contact_name: '', contact_phone: '' };
        return { ...details, source_application_id: p?.source_application_id ?? null };
      }
      if (request.action === 'getApplication') {
        const data = requestData('userService.getApplication', request);
        const app = await tx.get<Application>('role_applications', data.application_id);
        ensure(app, 'NOT_FOUND', '申请不存在', 404);
        if (app.applicant_id !== user._id) {
          const grant = request.grant_id
            ? await tx.get<Grant>('role_grants', request.grant_id)
            : null;
          assertCanStartNewAction(user, grant, now);
          ensure(
            grant.role === 'local_admin' || grant.role === 'super_admin',
            'FORBIDDEN',
            '历史审核资料需要管理身份',
          );
          if (app.status === 'pending')
            assertReviewer({ tx, user, grant, request, now, command_id: request.request_id }, app);
          else
            ensure(
              grant.role === 'super_admin' || app.reviewed_by === user._id,
              'FORBIDDEN',
              '仅本人、实际审核者或超管可读历史',
            );
        }
        ensure(
          app.reviewed_at === null || app.reviewed_at + 180 * 86400000 > now,
          'NOT_FOUND',
          '原始认证材料已到保留期限',
          404,
        );
        const p = await tx.get<Entity & { ciphertext: string }>(
          'role_application_private',
          app._id,
        );
        ensure(p, 'NOT_FOUND', '材料已清理', 404);
        const raw = codec.open(p.ciphertext) as {
          contact_name: string;
          contact_phone: string;
          school_identity_number?: string;
          business_description?: string;
          proof_kind?: string;
        };
        const details = {
          contact_name: raw.contact_name,
          contact_phone: raw.contact_phone,
          ...(raw.school_identity_number
            ? { school_identity_number: raw.school_identity_number }
            : {}),
          ...(raw.business_description ? { business_description: raw.business_description } : {}),
          ...(raw.proof_kind ? { proof_kind: raw.proof_kind } : {}),
        };
        await tx.put('audit_logs', {
          _id: request.request_id,
          actor_user_id: user._id,
          action: 'getApplication',
          target: app._id,
          created_at: now,
        });
        return { application: toApplicationDTO(app), material_ids: app.material_ids, details };
      }
      if (request.action === 'listMyApplications') {
        const data = requestData('userService.listMyApplications', request);
        const rows = (
          await Promise.all(
            [...user.application_ids]
              .reverse()
              .map((id) => tx.get<Application>('role_applications', id)),
          )
        ).filter((a): a is Application => a !== null);
        return paginate(
          rows,
          { actor: user._id, action: request.action },
          data.cursor,
          data.page_size ?? 20,
          toApplicationDTO,
        );
      }
      if (request.action === 'listGrants') {
        const data = requestData('userService.listGrants', request);
        let target = user;
        let manager: Grant | null = null;
        if (data.user_id && data.user_id !== user._id) {
          manager = request.grant_id ? await tx.get<Grant>('role_grants', request.grant_id) : null;
          assertCanStartNewAction(user, manager, now);
          ensure(
            manager.role === 'super_admin' || manager.role === 'local_admin',
            'FORBIDDEN',
            '查询他人授权需要管理身份',
          );
          const found = await tx.get<User>('users', data.user_id);
          ensure(found, 'NOT_FOUND', '用户不存在或不在授权范围', 404);
          target = found;
        }
        const rows = (
          await Promise.all(target.grant_ids.map((id) => tx.get<Grant>('role_grants', id)))
        ).filter(
          (g): g is Grant =>
            g !== null &&
            g.user_id === target._id &&
            (!manager ||
              manager.role === 'super_admin' ||
              (g.scope_type === 'region' && g.scope_region_id === manager.scope_region_id)),
        );
        if (manager) {
          ensure(rows.length > 0, 'NOT_FOUND', '用户不存在或不在授权范围', 404);
          await tx.put('audit_logs', {
            _id: request.request_id,
            actor_user_id: user._id,
            grant_id: manager._id,
            action: 'listGrants',
            target: target._id,
            created_at: now,
          });
        }
        return paginate(
          rows.map((g) => ({
            ...g,
            created_at: 0,
            status:
              g.status === 'active' && g.expires_at !== null && g.expires_at <= now
                ? ('expired' as const)
                : g.status,
          })),
          { actor: user._id, target: target._id, grant: manager?._id, action: request.action },
          data.cursor,
          data.page_size ?? 20,
          toGrantDTO,
        );
      }
      ensure(false, 'UNKNOWN_ACTION', '未知业务动作', 400);
    });
  }
  return { write, read };
}
