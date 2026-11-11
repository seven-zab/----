<template>
  <PageShell>
    <text class="heading">本次代发授权</text>
    <text>一份授权只用于一条需求；确认授权不等于需求审核通过。</text>
    <button v-if="session.isManager" @click="start">申请代发授权</button>
    <text class="error">{{ error }}</text>
    <view v-for="item in items" :key="item.authorization_id" class="card">
      <text
        >{{
          item.beneficiary_id === session.me?.user_id ? '我收到的授权申请' : '我发起的授权申请'
        }}
        · {{ labels[item.status] }}</text
      >
      <button :disabled="busy" @click="inspect(item.authorization_id)">查看本次内容</button>
      <template v-if="item.beneficiary_id === session.me?.user_id">
        <template v-if="item.status === 'pending'">
          <button :disabled="busy" @click="edit(item.authorization_id)">
            核对 / 补齐并确认授权
          </button>
          <button :disabled="busy" @click="reject(item)">拒绝授权</button>
        </template>
        <button
          v-if="item.status === 'pending' || item.status === 'approved'"
          :disabled="busy"
          @click="revoke(item)"
        >
          撤销尚未消费的授权
        </button>
      </template>
      <button
        v-if="
          item.delegate_id === session.me?.user_id &&
          item.status === 'approved' &&
          session.isManager
        "
        :disabled="busy"
        @click="publish(item)"
      >
        按已确认快照提交待审需求
      </button>
      <button v-if="item.consumed_demand_id" @click="openDemand(item.consumed_demand_id)">
        查看已关联需求
      </button>
    </view>
    <view v-if="detail" class="card">
      <text class="heading">{{ detail.draft.title || '标题待补齐' }}</text>
      <text>{{ detail.draft.content || '说明待补齐' }}</text>
      <text>{{ detail.draft.location_text || '地点待补齐' }}</text>
      <text>{{ detail.draft.contact?.name }} {{ detail.draft.contact?.phone }}</text>
      <text v-if="detail.draft.contact?.exact_address">{{
        detail.draft.contact.exact_address
      }}</text>
      <text>完整字段请进入“核对 / 补齐并确认授权”查看。</text>
    </view>
    <button v-if="cursor" :disabled="busy" @click="load(true)">更多记录</button>
    <button :disabled="busy" @click="load()">刷新</button>
  </PageShell>
</template>
<script setup lang="ts">
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import PageShell from '../../components/PageShell.vue';
import { cloudCall } from '../../services/cloudClient';
import { useSessionStore } from '../../stores/session';
import { userCommand } from '../../services/userV1';
import { demandCommand } from '../../services/demandV1';
import { errorMessage } from '../../utils/display';
import type { ContractMap, DemandCreateInput } from '../../../contracts/generated/dto';
type Authorization = ContractMap['userService.listMyDelegations']['response']['items'][number];
const session = useSessionStore();
const items = ref<Authorization[]>([]);
const detail = ref<ContractMap['userService.getDelegation']['response'] | null>(null);
const cursor = ref<string | null>(null);
const busy = ref(false);
const error = ref('');
const labels = {
  pending: '待受益人确认',
  approved: '已确认，尚未提交',
  rejected: '已拒绝',
  revoked: '已撤销',
  consumed: '已关联需求',
};
const start = () => uni.navigateTo({ url: '/pages/demand-create/demand-create?delegate=1' });
const edit = (id: string) =>
  uni.navigateTo({
    url: `/pages/demand-create/demand-create?authorization=${encodeURIComponent(id)}`,
  });
const openDemand = (id: string) =>
  uni.navigateTo({ url: `/pages/demand-detail/demand-detail?id=${encodeURIComponent(id)}` });
async function refresh(next = false) {
  detail.value = null;
  if (!session.me) {
    items.value = [];
    throw new Error('请先登录');
  }
  const result = await cloudCall(
    'userService.listMyDelegations',
    next && cursor.value ? { cursor: cursor.value } : {},
    session.options(),
  );
  items.value = next ? [...items.value, ...result.items] : result.items;
  cursor.value = result.next_cursor;
}
async function run(work: () => Promise<void>) {
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
const load = (next = false) => run(() => refresh(next));
const inspect = (id: string) =>
  run(async () => {
    detail.value = null;
    detail.value = await cloudCall(
      'userService.getDelegation',
      { authorization_id: id },
      session.options(),
    );
  });
const reject = (item: Authorization) =>
  run(async () => {
    await userCommand('userService.respondDelegation', {
      authorization_id: item.authorization_id,
      expected_version: item.version,
      decision: 'reject',
    });
    await refresh();
  });
const revoke = (item: Authorization) =>
  run(async () => {
    const result = await userCommand('userService.revokeDelegation', {
      authorization_id: item.authorization_id,
      expected_version: item.version,
    });
    if (result.consumed_demand_id) openDemand(result.consumed_demand_id);
    else await refresh();
  });
const publish = (item: Authorization) =>
  run(async () => {
    const current = await cloudCall(
      'userService.getDelegation',
      { authorization_id: item.authorization_id },
      session.options(),
    );
    const check = await demandCommand(
      'demandService.checkSubmission',
      current.draft as DemandCreateInput,
    );
    if (check.status !== 'pass') throw new Error('内容检查未通过，不能提交');
    const result = await demandCommand('demandService.createDelegatedDemand', {
      authorization_id: item.authorization_id,
    });
    openDemand(result.demand_id);
  });
onShow(() => {
  void load();
});
</script>
