import { userIdentityId } from '../../server/core/command';
import type { Grant, User } from '../../server/core/entities';
import { MemoryRepository } from './memory-repository';
export function seedIdentity(
  repo: MemoryRepository,
  id: string,
  role: Grant['role'],
  now: number,
  region = 'a',
) {
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
    scope_type:
      role === 'super_admin' ? 'platform' : role === 'teacher_student' ? 'self' : 'region',
    scope_region_id: role === 'super_admin' || role === 'teacher_student' ? null : region,
    profile_kind: null,
    organization_id: role === 'teacher_student' ? 'sztu' : null,
    status: 'active',
    expires_at: null,
    renewed_from: null,
    revoked_at: null,
  });
}
