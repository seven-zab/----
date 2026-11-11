import { ensure } from './errors';
import type { Grant, Scene, User } from './entities';

export const SZTU = 'sztu';
export function assertAccount(user: User): void {
  ensure(user.account_status === 'active', 'ACCOUNT_DISABLED', '账号不可用');
}
export function assertGrantOwner(user: User, grant: Grant | null): asserts grant is Grant {
  assertAccount(user);
  ensure(
    grant && grant.user_id === user._id && grant.status !== 'revoked' && grant.revoked_at === null,
    'ROLE_NOT_APPROVED',
    '请使用本人已审核身份',
  );
  ensure(
    grant.role !== 'teacher_student' || grant.organization_id === SZTU,
    'ROLE_NOT_APPROVED',
    '本期仅支持深圳技术大学师生身份',
  );
}
export function assertCanStartNewAction(
  user: User,
  grant: Grant | null,
  now: number,
): asserts grant is Grant {
  assertGrantOwner(user, grant);
  ensure(
    grant.status === 'active' && (grant.expires_at === null || grant.expires_at > now),
    'ROLE_NOT_APPROVED',
    '身份已到期，请申请复核',
  );
}
export function assertCanContinueBoundTask(
  user: User,
  grant: Grant | null,
  boundGrantId: string | undefined,
  confirmed: boolean,
  now: number,
): asserts grant is Grant {
  assertGrantOwner(user, grant);
  ensure(grant._id === boundGrantId, 'FORBIDDEN', '授权与原任务不匹配');
  if (grant.status === 'active' && (grant.expires_at === null || grant.expires_at > now)) return;
  ensure(
    confirmed &&
      grant.role === 'teacher_student' &&
      grant.expires_at !== null &&
      grant.expires_at <= now,
    'ROLE_NOT_APPROVED',
    '此操作需要有效身份',
  );
}
export function inScope(grant: Grant, scene: Scene): boolean {
  if (grant.role === 'super_admin') return true;
  if (scene.business_scene === 'campus')
    return (
      grant.role === 'teacher_student' &&
      grant.organization_id === SZTU &&
      scene.campus_organization_id === SZTU
    );
  if (grant.role === 'teacher_student') return grant.organization_id === SZTU;
  return (
    grant.scope_region_id !== null &&
    (scene.region_id === grant.scope_region_id ||
      (scene.region_path_ids ?? []).includes(grant.scope_region_id))
  );
}
export function assertScene(
  grant: Grant,
  scene: Scene,
  capability: 'publish' | 'claim' | 'manage',
): void {
  const roles =
    capability === 'manage'
      ? ['local_admin', 'super_admin']
      : capability === 'publish' && scene.business_scene === 'village'
      ? ['farmer', 'local_admin', 'super_admin']
      : ['teacher_student', 'local_admin', 'super_admin'];
  ensure(
    roles.includes(grant.role) &&
      inScope(grant, scene) &&
      !(
        scene.business_scene === 'campus' &&
        capability === 'manage' &&
        grant.role !== 'super_admin'
      ),
    'SCOPE_FORBIDDEN',
    '当前身份无此场景或辖区权限',
  );
}
