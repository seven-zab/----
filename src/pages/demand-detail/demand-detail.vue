<template>
  <PageShell>
    <text class="error" v-if="error">{{ error }}</text>
    <template v-if="detail"
      ><text class="status">{{ labels[detail.demand.status] }}</text
      ><text class="heading">{{ detail.demand.title }}</text
      ><text>{{ detail.demand.content }}</text
      ><AttachmentList
        :file-ids="(detail.attachments ?? []).map((a) => a.file_id)"
        resource-type="demand"
        :resource-id="id"
        :grant-id="readOptions().grant_id"
      />
      <DemandTimeline :status="detail.demand.status" />
      <view v-for="event in events" :key="event.event_id" class="event">
        <text>{{ eventLabel(event.type) }} · {{ formatTime(event.occurred_at) }}</text>
        <text v-if="event.text">{{ event.text }}</text>
        <AttachmentList
          :file-ids="event.attachment_ids ?? []"
          resource-type="demand"
          :resource-id="id"
          :grant-id="readOptions().grant_id"
        />
      </view>
      <button v-if="eventCursor" :disabled="busy" @click="loadMoreEvents">查看更多记录</button>
      <button v-if="allowed('createDemandConversation')" :disabled="busy" @click="openChat">
        需求咨询 / 对接私聊
      </button>
      <button v-if="allowed('getContact')" :disabled="busy" @click="readPrivate('getContact')">
        查看对接人电话
      </button>
      <button
        v-if="allowed('getServiceLocation')"
        :disabled="busy"
        @click="readPrivate('getServiceLocation')"
      >
        查看服务地址
      </button>
      <text v-if="privateText">{{ privateText }}</text>
      <view v-if="detail.completion" class="card">
        <text>成果总结：{{ detail.completion.summary }}</text>
        <AttachmentList
          :file-ids="detail.completion.attachment_ids"
          resource-type="demand"
          :resource-id="id"
          :grant-id="readOptions().grant_id"
        />
        <text v-if="detail.completion.reason">验收意见：{{ detail.completion.reason }}</text>
      </view>
      <view v-if="detail.termination_request" class="card">
        <text>终止协商：{{ terminationLabels[detail.termination_request.status] }}</text>
        <text>申请原因：{{ detail.termination_request.reason }}</text>
        <text v-if="detail.termination_request.response_reason"
          >答复意见：{{ detail.termination_request.response_reason }}</text
        >
        <text v-if="detail.termination_request.dispute_reason"
          >争议说明：{{ detail.termination_request.dispute_reason }}</text
        >
        <text v-if="detail.termination_request.resolution_reason"
          >处理依据：{{ detail.termination_request.resolution_reason }}</text
        >
      </view>
      <view v-if="detail.roster_request" class="card">
        <text>名单交接申请：{{ detail.roster_request.reason }}</text>
        <text>新名单人数：{{ detail.roster_request.participant_user_ids.length }}</text>
        <text v-for="member in detail.roster_request.participant_labels" :key="member.user_id">
          {{ member.display_name
          }}{{
            member.user_id === detail.roster_request.responsible_user_id ? '（拟任本单负责人）' : ''
          }}
        </text>
        <button
          v-if="allowed('reviewRosterChange')"
          :disabled="busy"
          @click="act('reviewRosterChange', 'approve')"
        >
          同意名单及负责人交接
        </button>
        <button
          v-if="allowed('reviewRosterChange')"
          :disabled="busy"
          @click="act('reviewRosterChange', 'reject')"
        >
          拒绝交接
        </button>
      </view>
      <template v-if="allowed('claim') || allowed('requestRosterChange')">
        <button :disabled="busy" @click="loadTeams">
          {{ allowed('claim') ? '选择团队接取' : '申请本单名单或负责人交接' }}
        </button>
        <view v-if="teamChoices.length" class="card">
          <button
            v-for="team in teamChoices"
            :key="team.team_id"
            :disabled="busy"
            @click="chooseTeam(team.team_id)"
          >
            {{ team.name }}
          </button>
          <button v-if="teamChoicesCursor" :disabled="busy" @click="moreTeamChoices">
            更多团队
          </button>
          <template v-if="selectedTeamId">
            <text>选择本单实际参与者（最多20人）；接取时必须包含团队负责人。</text>
            <button
              v-for="member in rosterMembers"
              :key="member.user_id"
              :disabled="busy"
              @click="toggleParticipant(member.user_id)"
            >
              {{ selectedParticipants.includes(member.user_id) ? '☑' : '☐' }}
              {{ member.display_name }}
            </button>
            <template v-if="allowed('requestRosterChange')">
              <text>选择新的本单负责人：</text>
              <button
                v-for="member in rosterMembers.filter((m) =>
                  selectedParticipants.includes(m.user_id),
                )"
                :key="member.user_id"
                :disabled="busy"
                @click="responsibleId = member.user_id"
              >
                {{ responsibleId === member.user_id ? '●' : '○' }} {{ member.display_name }}
              </button>
              <button :disabled="busy" @click="act('requestRosterChange')">
                提交交接申请，等待发布者确认
              </button>
            </template>
            <button v-else :disabled="busy" @click="act('claimTeam')">以所选团队和名单接取</button>
          </template>
        </view>
      </template>
      <textarea
        v-if="needsText"
        v-model="text"
        placeholder="进度、成果总结或拒绝 / 退回原因"
        maxlength="5000"
      />
      <view v-if="allowed('addProgress') || allowed('submitCompletion')" class="card">
        <text>进度 / 成果图片（选填，最多5张）：{{ evidenceImages.length }} / 5</text>
        <button :disabled="busy || evidenceImages.length >= 5" @click="addEvidence">
          添加凭证图片
        </button>
        <button
          v-for="(fileId, index) in evidenceImages"
          :key="fileId"
          :disabled="busy"
          @click="evidenceImages = evidenceImages.filter((id) => id !== fileId)"
        >
          移除图片 {{ index + 1 }}
        </button>
      </view>
      <view class="row">
        <button v-if="allowed('claim')" class="primary" :disabled="busy" @click="act('claim')">
          个人接取
        </button>
        <button v-if="allowed('cancel')" :disabled="busy" @click="act('cancel')">
          取消尚未开始的需求
        </button>
        <button v-if="allowed('withdrawClaim')" :disabled="busy" @click="act('withdrawClaim')">
          撤回接取
        </button>
        <button
          v-if="allowed('confirmClaim')"
          class="primary"
          :disabled="busy"
          @click="act('confirmClaim', 'accept')"
        >
          同意开始服务</button
        ><button
          v-if="allowed('confirmClaim')"
          :disabled="busy"
          @click="act('confirmClaim', 'reject')"
        >
          拒绝接取
        </button>
        <button
          v-if="allowed('review')"
          class="primary"
          :disabled="busy"
          @click="act('review', 'approve')"
        >
          审核通过</button
        ><button v-if="allowed('review')" :disabled="busy" @click="act('review', 'reject')">
          驳回审核
        </button>
        <button v-if="allowed('addProgress')" :disabled="busy" @click="act('addProgress')">
          记录阶段进度</button
        ><button
          v-if="allowed('submitCompletion')"
          class="primary"
          :disabled="busy"
          @click="act('submitCompletion')"
        >
          提交成果待验收
        </button>
        <button
          v-if="allowed('reviewCompletion')"
          class="primary"
          :disabled="busy"
          @click="act('reviewCompletion', 'accept')"
        >
          验收通过</button
        ><button
          v-if="allowed('reviewCompletion')"
          :disabled="busy"
          @click="act('reviewCompletion', 'return')"
        >
          退回补充
        </button>
        <button
          v-if="allowed('requestTermination')"
          :disabled="busy"
          @click="act('requestTermination')"
        >
          申请协商终止
        </button>
        <button
          v-if="allowed('respondTermination')"
          :disabled="busy"
          @click="act('respondTermination', 'agree')"
        >
          同意终止任务
        </button>
        <button
          v-if="allowed('respondTermination')"
          :disabled="busy"
          @click="act('respondTermination', 'reject')"
        >
          拒绝终止，继续履约
        </button>
        <button
          v-if="allowed('withdrawTermination')"
          :disabled="busy"
          @click="act('withdrawTermination')"
        >
          撤回终止申请
        </button>
        <button
          v-if="allowed('disputeTermination')"
          :disabled="busy"
          @click="act('disputeTermination')"
        >
          提交终止争议
        </button>
        <button
          v-if="allowed('resolveTermination')"
          :disabled="busy"
          @click="act('resolveTermination', 'terminate')"
        >
          管理处理：终止任务
        </button>
        <button
          v-if="allowed('resolveTermination')"
          :disabled="busy"
          @click="act('resolveTermination', 'continue')"
        >
          管理处理：继续履约
        </button>
      </view> </template
    ><button :disabled="busy" @click="load">刷新状态</button>
  </PageShell>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import PageShell from '../../components/PageShell.vue';
import DemandTimeline from '../../components/DemandTimeline.vue';
import AttachmentList from '../../components/AttachmentList.vue';
import { uploadImage } from '../../services/fileV1';
import { demandCommand as sendDemandCommand, demandDetail } from '../../services/demandV1';
import { cloudCall } from '../../services/cloudClient';
import { useSessionStore } from '../../stores/session';
import { createDemandConversation } from '../../services/chatV1';
import type { ContractMap } from '../../../contracts/generated/dto';
import { demandStatusLabels as labels, errorMessage } from '../../utils/display';
const detail = ref<ContractMap['demandService.getDetail']['response'] | null>(null);
const id = ref('');
const text = ref('');
const evidenceImages = ref<string[]>([]);
const busy = ref(false);
const error = ref('');
const events = ref<ContractMap['demandService.listEvents']['response']['items']>([]);
const eventCursor = ref<string | null>(null);
const privateText = ref('');
const teamChoices = ref<ContractMap['teamService.listMyTeams']['response']['items']>([]);
const teamChoicesCursor = ref<string | null>(null);
const rosterMembers = ref<ContractMap['teamService.listMembers']['response']['items']>([]);
const selectedTeamId = ref('');
const selectedParticipants = ref<string[]>([]);
const responsibleId = ref('');
const session = useSessionStore();
const readOptions = () =>
  detail.value?.task_grant_id ? { grant_id: detail.value.task_grant_id } : session.options();
const eventLabels: Record<string, string> = {
  submitted: '已提交审核',
  review: '审核结果更新',
  claim: '已接取，待发布者确认',
  claim_confirmed: '发布者确认开始服务',
  claim_released: '接取已释放',
  addProgress: '阶段进度',
  submitCompletion: '已交成果，待验收',
  reviewCompletion: '验收结果更新',
  cancel: '需求已取消',
  requestTermination: '已申请协商终止',
  respondTermination: '终止协商已答复',
  withdrawTermination: '终止申请已撤回',
  disputeTermination: '已提交终止争议',
  resolveTermination: '终止争议已处理',
};
const terminationLabels = {
  pending: '等待另一方答复',
  agreed: '双方同意终止',
  rejected: '另一方拒绝',
  withdrawn: '已撤回',
  disputed: '等待管理处理',
  resolved: '管理处理完毕',
  superseded: '已失效',
};
const eventLabel = (type: string) => eventLabels[type] ?? '任务记录更新';
const formatTime = (time: number) => {
  const d = new Date(time + 8 * 3600000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate(),
  ).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}:${String(
    d.getUTCMinutes(),
  ).padStart(2, '0')}`;
};
function demandCommand<K extends Extract<keyof ContractMap, `demandService.${string}`>>(
  route: K,
  data: ContractMap[K]['request'],
) {
  return sendDemandCommand(route, data, detail.value?.task_grant_id);
}
async function loadMoreEvents() {
  if (!eventCursor.value || busy.value) return;
  busy.value = true;
  try {
    const result = await cloudCall(
      'demandService.listEvents',
      {
        demand_id: id.value,
        cursor: eventCursor.value,
      },
      readOptions(),
    );
    events.value.push(...result.items);
    eventCursor.value = result.next_cursor;
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
async function readPrivate(action: 'getContact' | 'getServiceLocation') {
  if (busy.value) return;
  busy.value = true;
  privateText.value = '';
  try {
    if (action === 'getContact') {
      const result = await cloudCall(
        'demandService.getContact',
        {
          demand_id: id.value,
          purpose: '任务履约对接',
        },
        readOptions(),
      );
      privateText.value = `${result.name}：${result.phone}`;
    } else {
      const result = await cloudCall(
        'demandService.getServiceLocation',
        { demand_id: id.value },
        readOptions(),
      );
      privateText.value = [result.location_text, result.exact_address].filter(Boolean).join(' · ');
    }
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
const allowed = (a: string) => detail.value?.allowed_actions.includes(a) ?? false;
async function openChat() {
  if (busy.value) return;
  busy.value = true;
  try {
    const result = await createDemandConversation(
      id.value,
      detail.value?.claim?.claim_id,
      detail.value?.task_grant_id,
    );
    uni.navigateTo({
      url: `/pages/chat/chat-detail?id=${encodeURIComponent(result.conversation_id)}`,
    });
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
const needsText = computed(() =>
  [
    'review',
    'confirmClaim',
    'addProgress',
    'submitCompletion',
    'reviewCompletion',
    'requestRosterChange',
    'reviewRosterChange',
    'cancel',
    'requestTermination',
    'respondTermination',
    'disputeTermination',
    'resolveTermination',
  ].some(allowed),
);
async function chooseTeam(team_id: string) {
  try {
    const members = await cloudCall(
      'teamService.listMembers',
      { team_id, page_size: 50 },
      session.options(),
    );
    rosterMembers.value = members.items.filter((m) => m.membership_status === 'active');
    selectedTeamId.value = team_id;
    selectedParticipants.value =
      detail.value?.claim?.assignee_id === team_id
        ? [...detail.value.claim.participant_user_ids]
        : session.me
        ? [session.me.user_id]
        : [];
    responsibleId.value = detail.value?.claim?.responsible_user_id ?? session.me?.user_id ?? '';
  } catch (e) {
    error.value = errorMessage(e);
  }
}
async function loadTeams() {
  try {
    if (allowed('requestRosterChange') && detail.value?.claim) {
      const team = await cloudCall(
        'teamService.getTeam',
        { team_id: detail.value.claim.assignee_id },
        session.options(),
      );
      teamChoices.value = [team];
      teamChoicesCursor.value = null;
      await chooseTeam(team.team_id);
    } else {
      const result = await cloudCall('teamService.listMyTeams', {}, session.options());
      teamChoices.value = result.items.filter(
        (t) => t.status === 'active' && t.leader_user_id === session.me?.user_id,
      );
      teamChoicesCursor.value = result.next_cursor;
    }
  } catch (e) {
    error.value = errorMessage(e);
  }
}
async function moreTeamChoices() {
  if (!teamChoicesCursor.value) return;
  try {
    const result = await cloudCall(
      'teamService.listMyTeams',
      { cursor: teamChoicesCursor.value },
      session.options(),
    );
    teamChoices.value.push(
      ...result.items.filter(
        (t) => t.status === 'active' && t.leader_user_id === session.me?.user_id,
      ),
    );
    teamChoicesCursor.value = result.next_cursor;
  } catch (e) {
    error.value = errorMessage(e);
  }
}
function toggleParticipant(user_id: string) {
  selectedParticipants.value = selectedParticipants.value.includes(user_id)
    ? selectedParticipants.value.filter((id) => id !== user_id)
    : [...selectedParticipants.value, user_id];
}
async function load() {
  if (!id.value) return;
  detail.value = null;
  privateText.value = '';
  events.value = [];
  eventCursor.value = null;
  try {
    detail.value = await demandDetail(id.value);
    const result = await cloudCall(
      'demandService.listEvents',
      { demand_id: id.value },
      readOptions(),
    );
    events.value = result.items;
    eventCursor.value = result.next_cursor;
    error.value = '';
  } catch (e) {
    error.value = errorMessage(e);
  }
}
async function act(action: string, decision?: string) {
  const d = detail.value?.demand;
  if (!d || busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    const target = { demand_id: id.value, expected_version: d.version };
    const termination = detail.value?.termination_request;
    const terminationTarget = termination
      ? {
          ...target,
          termination_request_id: termination.request_id,
          request_version: termination.version,
        }
      : null;
    if (action === 'cancel')
      await demandCommand('demandService.cancel', { ...target, reason: text.value });
    else if (action === 'withdrawClaim' && detail.value?.claim)
      await demandCommand('demandService.withdrawClaim', {
        ...target,
        claim_id: detail.value.claim.claim_id,
      });
    else if (action === 'requestTermination')
      await demandCommand('demandService.requestTermination', { ...target, reason: text.value });
    else if (action === 'respondTermination' && terminationTarget)
      await demandCommand('demandService.respondTermination', {
        ...terminationTarget,
        decision: decision === 'agree' ? 'agree' : 'reject',
        ...(text.value.trim() ? { reason: text.value } : {}),
      });
    else if (action === 'withdrawTermination' && terminationTarget)
      await demandCommand('demandService.withdrawTermination', terminationTarget);
    else if (action === 'disputeTermination' && terminationTarget)
      await demandCommand('demandService.disputeTermination', {
        ...terminationTarget,
        reason: text.value,
      });
    else if (action === 'resolveTermination' && terminationTarget)
      await sendDemandCommand('demandService.resolveTermination', {
        ...terminationTarget,
        decision: decision === 'terminate' ? 'terminate' : 'continue',
        reason: text.value,
      });
    else if (action === 'claim')
      await demandCommand('demandService.claim', { ...target, assignee_type: 'user' });
    else if (action === 'claimTeam')
      await demandCommand('demandService.claim', {
        ...target,
        assignee_type: 'team',
        team_id: selectedTeamId.value,
        participant_user_ids: selectedParticipants.value,
      });
    else if (action === 'requestRosterChange' && detail.value?.claim)
      await demandCommand('demandService.requestRosterChange', {
        ...target,
        claim_id: detail.value.claim.claim_id,
        base_roster_version: detail.value.claim.roster_version,
        participant_user_ids: selectedParticipants.value,
        responsible_user_id: responsibleId.value,
        reason: text.value,
      });
    else if (action === 'reviewRosterChange' && detail.value?.roster_request)
      await demandCommand('demandService.reviewRosterChange', {
        ...target,
        roster_change_request_id: detail.value.roster_request.request_id,
        request_version: detail.value.roster_request.version,
        decision: decision === 'approve' ? 'approve' : 'reject',
        ...(decision === 'reject' ? { reason: text.value } : {}),
      });
    else if (action === 'confirmClaim' && 'claim_id' in d && d.claim_id)
      await demandCommand('demandService.confirmClaim', {
        ...target,
        claim_id: d.claim_id,
        decision: decision === 'accept' ? 'accept' : 'reject',
        ...(decision === 'reject' ? { reason: text.value } : {}),
      });
    else if (action === 'review' && 'submission_id' in d && d.submission_id)
      await demandCommand('demandService.review', {
        ...target,
        submission_id: d.submission_id,
        revision: d.revision,
        decision: decision === 'approve' ? 'approve' : 'reject',
        ...(decision === 'reject' ? { reason: text.value } : {}),
      });
    else if (action === 'addProgress')
      await demandCommand('demandService.addProgress', {
        ...target,
        kind: 'note',
        text: text.value,
        attachment_ids: [...evidenceImages.value],
      });
    else if (action === 'submitCompletion')
      await demandCommand('demandService.submitCompletion', {
        ...target,
        summary: text.value,
        attachment_ids: [...evidenceImages.value],
      });
    else if (action === 'reviewCompletion' && 'completion_id' in d && d.completion_id)
      await demandCommand('demandService.reviewCompletion', {
        ...target,
        completion_id: d.completion_id,
        decision: decision === 'accept' ? 'accept' : 'return',
        ...(decision === 'return' ? { reason: text.value } : {}),
      });
    else throw new Error('当前资源信息不完整，请刷新后重试');
    text.value = '';
    if (action === 'addProgress' || action === 'submitCompletion') evidenceImages.value = [];
    await load();
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
async function addEvidence() {
  if (busy.value || evidenceImages.value.length >= 5) return;
  busy.value = true;
  error.value = '';
  try {
    evidenceImages.value.push(await uploadImage('progress'));
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
onLoad((options) => {
  id.value = options?.id ?? '';
  void load();
});
</script>
