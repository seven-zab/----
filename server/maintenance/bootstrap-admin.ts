import type { Repository, Entity } from '../core/repository';
import type { Grant, User } from '../core/entities';
import { ensure } from '../core/errors';
import { hash } from '../core/hash';
import { touchGuards, touchMigrationFence } from '../core/command';
export async function bootstrapAdmin(
  repo: Repository,
  mapping: { env_id: string; user_id: string; verified_by: string; verification_reference: string },
  now: number,
) {
  const existing = await repo.find<Grant>(
    'role_grants',
    { role: 'super_admin', status: 'active' },
    2,
  );
  const grantId = `bootstrap_${hash([mapping.env_id, mapping.user_id]).slice(0, 40)}`;
  ensure(
    existing.every((g) => g._id === grantId),
    'STATE_CONFLICT',
    '存在其他超级管理员，禁止初始化',
    409,
  );
  return repo.transaction(async (tx) => {
    await touchMigrationFence(tx);
    const guard = await tx.get<Entity & { active_super_admin_ids: string[]; version: number }>(
      'system_guards',
      'super_admin',
    );
    const prior = await tx.get<Grant>('role_grants', grantId);
    if (guard && prior) {
      ensure(
        guard.active_super_admin_ids.includes(grantId) && prior.user_id === mapping.user_id,
        'STATE_CONFLICT',
        '初始化保护记录不一致',
        409,
      );
      return { grant_id: grantId, created: false };
    }
    ensure(
      !guard && !prior && existing.length === 0,
      'STATE_CONFLICT',
      '已有授权或初始化未完整，需人工核验',
      409,
    );
    const user = await tx.get<User>('users', mapping.user_id);
    ensure(user && Array.isArray(user.grant_ids), 'NOT_FOUND', '请先建立并迁移目标业务账号', 404);
    await touchGuards(tx, [user]);
    const grant: Grant = {
      _id: grantId,
      user_id: user._id,
      role: 'super_admin',
      profile_kind: null,
      organization_id: null,
      scope_type: 'platform',
      scope_region_id: null,
      status: 'active',
      expires_at: null,
      renewed_from: null,
      revoked_at: null,
    };
    user.grant_ids.push(grantId);
    user.auth_version++;
    await tx.put('role_grants', grant);
    await tx.put('users', user);
    await tx.put('system_guards', {
      _id: 'super_admin',
      active_super_admin_ids: [grantId],
      version: 1,
    });
    await tx.put('audit_logs', {
      _id: grantId,
      action: 'bootstrap_super_admin',
      operator: mapping.verified_by,
      verification_reference: mapping.verification_reference,
      target: user._id,
      created_at: now,
    });
    return { grant_id: grantId, created: true };
  });
}
