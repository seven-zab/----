import type { Grant, Scene, User } from '../../core/entities';
import type { Entity, Repository, Transaction } from '../../core/repository';
import { assertAccount, assertCanStartNewAction, assertScene } from '../../core/policy';
import { ensure } from '../../core/errors';
import { audit, resolveUser, runCommand, type Context } from '../../core/command';
import { requestData, type CallRequest } from '../../core/request';
import { hash } from '../../core/hash';
import { paginate } from '../../core/pagination';
export interface Team extends Entity {
  name: string;
  description: string;
  leader_user_id: string;
  status: 'active' | 'dissolved';
  version: number;
  active_assignment_count: number;
  member_user_ids: string[];
  pending_handover_id: string | null;
  pending_handover_target_id?: string | null;
  created_at: number;
}
export interface Member extends Entity {
  team_id: string;
  user_id: string;
  membership_status: 'active' | 'left';
  active_assignment_count: number;
  joined_at: number;
  created_at: number;
}
interface Invitation extends Entity {
  team_id: string;
  inviter_id: string;
  invitee_id: string;
  status: 'pending' | 'accepted' | 'rejected' | 'cancelled';
  version: number;
  created_at: number;
}
interface Handover extends Entity {
  team_id: string;
  source_user_id: string;
  target_user_id: string;
  status: 'pending' | 'accepted' | 'rejected';
  version: number;
  created_at: number;
}
export const memberId = (teamId: string, userId: string) => hash([teamId, userId]);
const toDTO = (t: Team) => ({
  team_id: t._id,
  name: t.name,
  description: t.description,
  leader_user_id: t.leader_user_id,
  status: t.status,
  version: t.version,
  active_assignment_count: t.active_assignment_count,
  pending_handover:
    t.pending_handover_id && t.pending_handover_target_id
      ? {
          handover_id: t.pending_handover_id,
          target_user_id: t.pending_handover_target_id,
          version: 1,
        }
      : null,
});
export async function eligibleGrant(
  tx: Transaction,
  user: User,
  scene?: Scene,
  now = Date.now(),
): Promise<Grant> {
  assertAccount(user);
  for (const id of [...user.grant_ids].sort()) {
    const grant = await tx.get<Grant>('role_grants', id);
    if (!grant) continue;
    try {
      assertCanStartNewAction(user, grant, now);
      if (scene) assertScene(grant, scene, 'claim');
      else ensure(['teacher_student', 'local_admin', 'super_admin'].includes(grant.role));
      return grant;
    } catch {
      /* Try only the user's other grants. */
    }
  }
  ensure(false, 'ROLE_NOT_APPROVED', '需要此任务场景的接取资格');
}
function activeTeam(team: Team | null): asserts team is Team {
  ensure(team?.status === 'active', 'NOT_FOUND', '团队不存在或已解散', 404);
}
function expected(team: Team, v: number) {
  ensure(team.version === v, 'VERSION_CONFLICT', '团队信息已更新', 409);
}
async function member(tx: Transaction, teamId: string, userId: string) {
  return tx.get<Member>('team_members', memberId(teamId, userId));
}
async function actorMember(ctx: Context, t: Team) {
  const m = await member(ctx.tx, t._id, ctx.user._id);
  ensure(m?.membership_status === 'active', 'NOT_FOUND', '团队不存在', 404);
  return m;
}
export async function adjustAssignments(
  tx: Transaction,
  teamId: string,
  participants: string[],
  delta: 1 | -1,
) {
  const team = await tx.get<Team>('teams', teamId);
  activeTeam(team);
  ensure(team.active_assignment_count + delta >= 0, 'STATE_CONFLICT', '团队任务计数不一致', 409);
  team.active_assignment_count += delta;
  team.version++;
  await tx.put('teams', team);
  for (const id of participants) {
    const m = await member(tx, teamId, id);
    ensure(m?.membership_status === 'active', 'STATE_CONFLICT', '本单成员已变化', 409);
    ensure(m.active_assignment_count + delta >= 0, 'STATE_CONFLICT', '成员任务计数不一致', 409);
    m.active_assignment_count += delta;
    await tx.put('team_members', m);
  }
}
export async function teamRoster(ctx: Context, scene: Scene, teamId: string, ids: string[]) {
  const team = await ctx.tx.get<Team>('teams', teamId);
  activeTeam(team);
  ensure(team.leader_user_id === ctx.user._id, 'FORBIDDEN', '仅负责人可以代表团队接取');
  ensure(
    ids.length <= 20 && new Set(ids).size === ids.length && ids.includes(ctx.user._id),
    'VALIDATION_FAILED',
    '本单名单必须包含负责人，最多20人',
    400,
  );
  const participants: Array<{ user_id: string; grant_id: string }> = [];
  for (const id of ids) {
    const m = await member(ctx.tx, teamId, id);
    ensure(m?.membership_status === 'active', 'FORBIDDEN', '只能选择已确认加入的有效成员');
    const u = await ctx.tx.get<User>('users', id);
    ensure(u, 'FORBIDDEN', '成员不可用');
    const grant = id === ctx.user._id ? ctx.grant : await eligibleGrant(ctx.tx, u, scene, ctx.now);
    assertCanStartNewAction(u, grant, ctx.now);
    assertScene(grant, scene, 'claim');
    participants.push({ user_id: id, grant_id: grant._id });
  }
  return participants;
}
export function createTeamService(repo: Repository) {
  async function write(openid: string, request: CallRequest, now: number) {
    let invitee: User | undefined;
    if (request.action === 'inviteMember') {
      const data = requestData('teamService.inviteMember', request);
      const rows = await repo.find<User>('users', { user_code: data.invitee_code }, 2);
      ensure(rows.length === 1, 'NOT_FOUND', '组队识别码不存在', 404);
      invitee = rows[0];
    }
    return runCommand(
      repo,
      openid,
      'teamService',
      request,
      async (ctx) => {
        if (request.action === 'createTeam') {
          const data = requestData('teamService.createTeam', request);
          assertCanStartNewAction(ctx.user, ctx.grant, now);
          ensure(
            ['teacher_student', 'local_admin', 'super_admin'].includes(ctx.grant.role),
            'FORBIDDEN',
            '需要接取资格',
          );
          const team: Team = {
            _id: ctx.command_id,
            name: data.name.trim(),
            description: data.description ?? '',
            leader_user_id: ctx.user._id,
            status: 'active',
            version: 1,
            active_assignment_count: 0,
            member_user_ids: [ctx.user._id],
            pending_handover_id: null,
            created_at: now,
          };
          ensure(team.name, 'VALIDATION_FAILED', '团队名称不能为空', 400);
          await ctx.tx.put('teams', team);
          await ctx.tx.put<Member>('team_members', {
            _id: memberId(team._id, ctx.user._id),
            team_id: team._id,
            user_id: ctx.user._id,
            membership_status: 'active',
            active_assignment_count: 0,
            joined_at: now,
            created_at: now,
          });
          await audit(ctx, team._id, '创建团队');
          return toDTO(team);
        }
        if (request.action === 'respondInvitation') {
          const data = requestData('teamService.respondInvitation', request);
          const inv = await ctx.tx.get<Invitation>('team_invitations', data.invitation_id);
          ensure(inv?.invitee_id === ctx.user._id, 'NOT_FOUND', '邀请不存在', 404);
          ensure(inv.version === data.expected_version, 'VERSION_CONFLICT', '邀请已更新', 409);
          ensure(inv.status === 'pending', 'STATE_CONFLICT', '邀请已处理', 409);
          const team = await ctx.tx.get<Team>('teams', inv.team_id);
          activeTeam(team);
          if (data.decision === 'accept') {
            await eligibleGrant(ctx.tx, ctx.user, undefined, now);
            const leader = await ctx.tx.get<User>('users', team.leader_user_id);
            ensure(leader, 'FORBIDDEN', '负责人不可用');
            await eligibleGrant(ctx.tx, leader, undefined, now);
            ensure(team.member_user_ids.length < 20, 'STATE_CONFLICT', '团队最多20人', 409);
            const existing = await member(ctx.tx, team._id, ctx.user._id);
            ensure(existing?.membership_status !== 'active', 'STATE_CONFLICT', '已是团队成员', 409);
            await ctx.tx.put<Member>('team_members', {
              _id: memberId(team._id, ctx.user._id),
              team_id: team._id,
              user_id: ctx.user._id,
              membership_status: 'active',
              active_assignment_count: 0,
              joined_at: now,
              created_at: existing?.created_at ?? now,
            });
            team.member_user_ids.push(ctx.user._id);
            team.version++;
            await ctx.tx.put('teams', team);
          }
          inv.status = data.decision === 'accept' ? 'accepted' : 'rejected';
          inv.version++;
          await ctx.tx.put('team_invitations', inv);
          await audit(ctx, team._id, `团队邀请:${inv.status}`);
          return { invitation_id: inv._id, status: inv.status };
        }
        if (request.action === 'acceptLeadership') {
          const data = requestData('teamService.acceptLeadership', request);
          const handover = await ctx.tx.get<Handover>('team_handovers', data.handover_id);
          ensure(handover?.target_user_id === ctx.user._id, 'NOT_FOUND', '交接不存在', 404);
          ensure(
            handover.version === data.expected_version && handover.status === 'pending',
            'STATE_CONFLICT',
            '交接已处理',
            409,
          );
          const team = await ctx.tx.get<Team>('teams', handover.team_id);
          activeTeam(team);
          await actorMember(ctx, team);
          ensure(
            team.pending_handover_id === handover._id &&
              team.leader_user_id === handover.source_user_id,
            'STATE_CONFLICT',
            '团队负责人已变化',
            409,
          );
          const old = await member(ctx.tx, team._id, team.leader_user_id);
          ensure(
            old?.active_assignment_count === 0,
            'STATE_CONFLICT',
            '原负责人须先完成任务或交接',
            409,
          );
          if (data.decision === 'accept') {
            await eligibleGrant(ctx.tx, ctx.user, undefined, now);
            team.leader_user_id = ctx.user._id;
          }
          team.pending_handover_id = null;
          team.pending_handover_target_id = null;
          team.version++;
          handover.status = data.decision === 'accept' ? 'accepted' : 'rejected';
          handover.version++;
          await ctx.tx.put('teams', team);
          await ctx.tx.put('team_handovers', handover);
          await audit(ctx, team._id, `负责人交接:${handover.status}`);
          return { handover_id: handover._id, status: handover.status };
        }
        const data = request.data as { team_id: string; expected_version: number };
        const team = await ctx.tx.get<Team>('teams', data.team_id);
        activeTeam(team);
        expected(team, data.expected_version);
        const membership = await actorMember(ctx, team);
        switch (request.action) {
          case 'inviteMember': {
            const input = requestData('teamService.inviteMember', request);
            assertCanStartNewAction(ctx.user, ctx.grant, now);
            ensure(team.leader_user_id === ctx.user._id, 'FORBIDDEN', '仅负责人可邀请');
            ensure(invitee, 'NOT_FOUND', '邀请对象不存在', 404);
            const current = await ctx.tx.get<User>('users', invitee._id);
            ensure(current, 'NOT_FOUND', '邀请对象不存在', 404);
            await eligibleGrant(ctx.tx, current, undefined, now);
            ensure(
              !team.member_user_ids.includes(current._id),
              'STATE_CONFLICT',
              '对方已在团队中',
              409,
            );
            const lockId = hash([team._id, current._id]);
            const lock = await ctx.tx.get<Entity & { invitation_id: string }>(
              'invitation_locks',
              lockId,
            );
            if (lock) {
              const old = await ctx.tx.get<Invitation>('team_invitations', lock.invitation_id);
              if (old?.status === 'pending') return { invitation_id: old._id, status: 'pending' };
            }
            const inv: Invitation = {
              _id: ctx.command_id,
              team_id: team._id,
              inviter_id: ctx.user._id,
              invitee_id: current._id,
              status: 'pending',
              version: 1,
              created_at: now,
            };
            await ctx.tx.put('team_invitations', inv);
            await ctx.tx.put('invitation_locks', { _id: lockId, invitation_id: inv._id });
            team.version++;
            await ctx.tx.put('teams', team);
            await audit(ctx, team._id, `团队邀请:${input.invitee_code.slice(0, 3)}…`);
            return { invitation_id: inv._id, status: inv.status };
          }
          case 'leaveTeam': {
            ensure(
              team.leader_user_id !== ctx.user._id,
              'STATE_CONFLICT',
              '负责人须先完成交接',
              409,
            );
            ensure(
              membership.active_assignment_count === 0,
              'STATE_CONFLICT',
              '请先完成任务或获得名单交接',
              409,
            );
            membership.membership_status = 'left';
            team.member_user_ids = team.member_user_ids.filter((id) => id !== ctx.user._id);
            team.version++;
            await ctx.tx.put('team_members', membership);
            await ctx.tx.put('teams', team);
            await audit(ctx, team._id, '退出团队');
            return { team_id: team._id, membership_status: 'left' };
          }
          case 'transferLeadership': {
            const input = requestData('teamService.transferLeadership', request);
            assertCanStartNewAction(ctx.user, ctx.grant, now);
            ensure(team.leader_user_id === ctx.user._id, 'FORBIDDEN', '仅负责人可提出交接');
            ensure(
              !team.pending_handover_id && membership.active_assignment_count === 0,
              'STATE_CONFLICT',
              '请先处理任务或已有交接',
              409,
            );
            ensure(
              input.new_leader_user_id !== ctx.user._id,
              'VALIDATION_FAILED',
              '请选择其他成员',
              400,
            );
            const target = await member(ctx.tx, team._id, input.new_leader_user_id);
            ensure(target?.membership_status === 'active', 'FORBIDDEN', '对方不是有效队员');
            const u = await ctx.tx.get<User>('users', target.user_id);
            ensure(u, 'NOT_FOUND', '用户不存在', 404);
            await eligibleGrant(ctx.tx, u, undefined, now);
            const handover: Handover = {
              _id: ctx.command_id,
              team_id: team._id,
              source_user_id: ctx.user._id,
              target_user_id: target.user_id,
              status: 'pending',
              version: 1,
              created_at: now,
            };
            team.pending_handover_id = handover._id;
            team.pending_handover_target_id = target.user_id;
            team.version++;
            await ctx.tx.put('team_handovers', handover);
            await ctx.tx.put('teams', team);
            await audit(ctx, team._id, '发起负责人交接');
            return { handover_id: handover._id, status: 'pending' };
          }
          case 'dissolveTeam': {
            assertCanStartNewAction(ctx.user, ctx.grant, now);
            ensure(team.leader_user_id === ctx.user._id, 'FORBIDDEN', '仅负责人可解散');
            ensure(team.active_assignment_count === 0, 'STATE_CONFLICT', '团队仍有未结束任务', 409);
            team.status = 'dissolved';
            team.version++;
            await ctx.tx.put('teams', team);
            await audit(ctx, team._id, '逻辑解散团队，保留历史');
            return toDTO(team);
          }
          default:
            ensure(false, 'UNKNOWN_ACTION', '未知团队动作', 400);
        }
      },
      now,
    );
  }
  async function read(openid: string, request: CallRequest, now = Date.now()) {
    const context = await repo.transaction(async (tx) => {
      const user = await resolveUser(tx, openid);
      ensure(user, 'USER_NOT_INITIALIZED', '请先登录', 401);
      assertAccount(user);
      return { user };
    });
    if (request.action === 'listMyInvitations') {
      const data = requestData('teamService.listMyInvitations', request);
      const rows = await repo.find<Invitation>(
        'team_invitations',
        { invitee_id: context.user._id },
        1000,
      );
      ensure(rows.length < 1000, 'RATE_LIMITED', '请缩小邀请查询范围', 429);
      const names = new Map(
        await Promise.all(
          rows.map(
            async (i) =>
              [i.team_id, (await repo.get<Team>('teams', i.team_id))?.name ?? '历史团队'] as const,
          ),
        ),
      );
      return paginate(
        rows,
        { user: context.user._id, action: request.action },
        data.cursor,
        data.page_size ?? 20,
        (i) => ({
          invitation_id: i._id,
          team_id: i.team_id,
          team_name: names.get(i.team_id) ?? '历史团队',
          inviter_id: i.inviter_id,
          status: i.status,
          version: i.version,
          created_at: i.created_at,
        }),
      );
    }
    if (request.action === 'listMyTeams') {
      const data = requestData('teamService.listMyTeams', request);
      const memberships = await repo.find<Member>(
        'team_members',
        { user_id: context.user._id },
        1000,
      );
      ensure(memberships.length < 1000, 'RATE_LIMITED', '团队记录过多，请联系管理员', 429);
      const teams = (
        await Promise.all(memberships.map((m) => repo.get<Team>('teams', m.team_id)))
      ).filter((t): t is Team => t !== null);
      return paginate(
        teams,
        { user: context.user._id, action: request.action },
        data.cursor,
        data.page_size ?? 20,
        toDTO,
      );
    }
    const data = request.data as { team_id: string };
    return repo.transaction(async (tx) => {
      const current = await resolveUser(tx, openid);
      ensure(current, 'USER_NOT_INITIALIZED', '请先登录', 401);
      assertAccount(current);
      const team = await tx.get<Team>('teams', data.team_id);
      ensure(team, 'NOT_FOUND', '团队不存在', 404);
      const m = await member(tx, team._id, context.user._id);
      if (!m) {
        const grant = request.grant_id
          ? await tx.get<Grant>('role_grants', request.grant_id)
          : null;
        assertCanStartNewAction(current, grant, now);
        ensure(grant.role === 'super_admin', 'NOT_FOUND', '团队不存在', 404);
      }
      if (request.action === 'getTeam') return toDTO(team);
      if (request.action === 'listMembers') {
        const input = requestData('teamService.listMembers', request);
        const rows = (
          await Promise.all(team.member_user_ids.map((id) => member(tx, team._id, id)))
        ).filter((m): m is Member => m !== null);
        const names = new Map(
          await Promise.all(
            rows.map(
              async (m) =>
                [
                  m.user_id,
                  (await tx.get<User>('users', m.user_id))?.display_name ?? '历史成员',
                ] as const,
            ),
          ),
        );
        return paginate(
          rows,
          { team: team._id, user: context.user._id },
          input.cursor,
          input.page_size ?? 20,
          (m) => ({
            user_id: m.user_id,
            display_name: names.get(m.user_id) ?? '历史成员',
            membership_status: m.membership_status,
            active_assignment_count: m.active_assignment_count,
            joined_at: m.joined_at,
          }),
        );
      }
      ensure(false, 'UNKNOWN_ACTION', '未知团队动作', 400);
    });
  }
  return { write, read };
}
