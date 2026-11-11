<template>
  <PageShell>
    <text class="heading">我的团队</text>
    <text v-if="!session.me">请先登录</text>
    <template v-else>
      <input v-model="name" placeholder="新团队名称" maxlength="80" />
      <button :disabled="busy" @click="create">创建团队</button>
      <text class="heading">收到的邀请</text>
      <view v-for="inv in invitations" :key="inv.invitation_id" class="card">
        <text>{{ inv.team_name }} · {{ inv.status }}</text>
        <template v-if="inv.status === 'pending'">
          <button :disabled="busy" @click="respond(inv, 'accept')">接受邀请</button>
          <button :disabled="busy" @click="respond(inv, 'reject')">拒绝邀请</button>
        </template>
      </view>
      <button v-if="invitationCursor" :disabled="busy" @click="moreInvitations">更多邀请</button>
      <view v-for="team in teams" :key="team.team_id" class="card">
        <button :disabled="busy" @click="guarded(() => select(team))">
          {{ team.name }} · {{ team.status === 'active' ? '有效' : '已解散' }}
        </button>
      </view>
      <button v-if="teamCursor" :disabled="busy" @click="moreTeams">更多团队</button>
      <view v-if="selected" class="card">
        <text class="heading">{{ selected.name }}</text>
        <text>进行中的任务：{{ selected.active_assignment_count }}</text>
        <text
          >团队负责人：{{
            members.find((m) => m.user_id === selected?.leader_user_id)?.display_name || '历史成员'
          }}</text
        >
        <view v-for="m in members" :key="m.user_id">
          <text>{{ m.display_name }} · 活动任务 {{ m.active_assignment_count }}</text>
          <button
            v-if="isLeader && m.user_id !== session.me.user_id && selected.status === 'active'"
            :disabled="busy"
            @click="transfer(m.user_id)"
          >
            向此成员发起团队负责人交接
          </button>
        </view>
        <template v-if="selected.status === 'active'">
          <template v-if="isLeader">
            <input v-model="inviteCode" placeholder="对方分享的组队识别码" />
            <button :disabled="busy" @click="invite">邀请加入</button>
            <button :disabled="busy" @click="dissolve">解散团队</button>
          </template>
          <button v-else :disabled="busy" @click="leave">退出团队</button>
        </template>
        <template v-if="selected.pending_handover?.target_user_id === session.me.user_id">
          <text>团队负责人请你接任，请确认是否接受。</text>
          <button :disabled="busy" @click="acceptLeadership('accept')">接受团队交接</button>
          <button :disabled="busy" @click="acceptLeadership('reject')">拒绝团队交接</button>
        </template>
      </view>
      <text>团队负责人交接需对方接受；本单任务交接须在任务详情申请并由发布者确认。</text>
      <text v-if="resultText">{{ resultText }}</text>
      <button :disabled="busy" @click="guarded(refresh)">刷新</button>
    </template>
    <text class="error">{{ error }}</text>
  </PageShell>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import PageShell from '../../components/PageShell.vue';
import { useSessionStore } from '../../stores/session';
import { cloudCall } from '../../services/cloudClient';
import { teamCommand } from '../../services/teamV1';
import { errorMessage } from '../../utils/display';
import type { ContractMap } from '../../../contracts/generated/dto';
type Team = ContractMap['teamService.getTeam']['response'];
type Invitation = ContractMap['teamService.listMyInvitations']['response']['items'][number];
const session = useSessionStore();
const teams = ref<Team[]>([]);
const invitations = ref<Invitation[]>([]);
const members = ref<ContractMap['teamService.listMembers']['response']['items']>([]);
const selected = ref<Team | null>(null);
const teamCursor = ref<string | null>(null);
const invitationCursor = ref<string | null>(null);
const name = ref('');
const inviteCode = ref('');
const resultText = ref('');
const busy = ref(false);
const error = ref('');
const isLeader = computed(() => selected.value?.leader_user_id === session.me?.user_id);
async function refresh() {
  if (!session.me) return;
  const [t, i] = await Promise.all([
    cloudCall('teamService.listMyTeams', {}, session.options()),
    cloudCall('teamService.listMyInvitations', {}, session.options()),
  ]);
  teams.value = t.items;
  teamCursor.value = t.next_cursor;
  invitations.value = i.items;
  invitationCursor.value = i.next_cursor;
  if (selected.value) await select(selected.value);
}
async function guarded(work: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await work();
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
async function select(team: Team) {
  selected.value = await cloudCall(
    'teamService.getTeam',
    { team_id: team.team_id },
    session.options(),
  );
  members.value = (
    await cloudCall(
      'teamService.listMembers',
      { team_id: team.team_id, page_size: 50 },
      session.options(),
    )
  ).items;
}
const create = () =>
  guarded(async () => {
    await teamCommand('teamService.createTeam', { name: name.value });
    name.value = '';
    await refresh();
  });
const respond = (i: Invitation, decision: 'accept' | 'reject') =>
  guarded(async () => {
    await teamCommand('teamService.respondInvitation', {
      invitation_id: i.invitation_id,
      expected_version: i.version,
      decision,
    });
    await refresh();
  });
const invite = () =>
  guarded(async () => {
    if (!selected.value) return;
    await teamCommand('teamService.inviteMember', {
      team_id: selected.value.team_id,
      expected_version: selected.value.version,
      invitee_code: inviteCode.value.trim(),
    });
    inviteCode.value = '';
    resultText.value = '邀请已发出，等待本人接受';
    await refresh();
  });
const leave = () =>
  guarded(async () => {
    if (!selected.value) return;
    await teamCommand('teamService.leaveTeam', {
      team_id: selected.value.team_id,
      expected_version: selected.value.version,
    });
    selected.value = null;
    await refresh();
  });
const dissolve = () =>
  guarded(async () => {
    if (!selected.value) return;
    const confirmation = await uni.showModal({
      title: '解散团队',
      content: '解散后保留历史记录；有活动任务时不能解散。',
    });
    if (!confirmation.confirm) return;
    await teamCommand('teamService.dissolveTeam', {
      team_id: selected.value.team_id,
      expected_version: selected.value.version,
    });
    await refresh();
  });
const transfer = (user_id: string) =>
  guarded(async () => {
    if (!selected.value) return;
    const result = await teamCommand('teamService.transferLeadership', {
      team_id: selected.value.team_id,
      expected_version: selected.value.version,
      new_leader_user_id: user_id,
    });
    resultText.value = result.status === 'pending' ? '交接已发出，请对方在本团队中接受。' : '';
    await refresh();
  });
const acceptLeadership = (decision: 'accept' | 'reject') =>
  guarded(async () => {
    const handover = selected.value?.pending_handover;
    if (!handover) return;
    await teamCommand('teamService.acceptLeadership', {
      handover_id: handover.handover_id,
      expected_version: handover.version,
      decision,
    });
    await refresh();
  });
const moreTeams = () =>
  guarded(async () => {
    if (!teamCursor.value) return;
    const result = await cloudCall(
      'teamService.listMyTeams',
      { cursor: teamCursor.value },
      session.options(),
    );
    teams.value.push(...result.items);
    teamCursor.value = result.next_cursor;
  });
const moreInvitations = () =>
  guarded(async () => {
    if (!invitationCursor.value) return;
    const result = await cloudCall(
      'teamService.listMyInvitations',
      { cursor: invitationCursor.value },
      session.options(),
    );
    invitations.value.push(...result.items);
    invitationCursor.value = result.next_cursor;
  });
onShow(() => {
  void guarded(refresh);
});
</script>
