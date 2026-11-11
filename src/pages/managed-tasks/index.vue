<template>
  <PageShell>
    <text class="heading">辖区任务</text
    ><template v-if="session.isManager">
      <picker
        :range="statusNames"
        :value="statusIndex"
        @change="
          statusIndex = Number($event.detail.value);
          load(true);
        "
        ><button>状态：{{ statusNames[statusIndex] }}</button></picker
      >
      <RegionPicker v-if="session.validGrant?.role === 'super_admin'" v-model="region" />
      <button :disabled="busy" @click="load(true)">查询 / 刷新</button>
      <text v-if="startAt && endAt"
        >按首次提交批次筛选：{{ day(startAt) }} 至 {{ day(endAt - 1) }}</text
      >
      <view v-for="item in items" :key="item.demand_id" class="card"
        ><text class="heading">{{ item.title }}</text
        ><text>{{ labels[item.status] }}</text
        ><button @click="open(item.demand_id)">查看详情与可执行操作</button></view
      >
      <text v-if="!items.length && !busy && !error">当前范围暂无任务</text
      ><button v-if="cursor" :disabled="busy" @click="load(false)">加载更多</button> </template
    ><text v-else>当前身份无管理权限。</text><text class="error">{{ error }}</text>
  </PageShell>
</template>
<script setup lang="ts">
import { ref } from 'vue';
import { onLoad, onShow } from '@dcloudio/uni-app';
import PageShell from '../../components/PageShell.vue';
import RegionPicker from '../../components/RegionPicker.vue';
import { useSessionStore } from '../../stores/session';
import { cloudCall } from '../../services/cloudClient';
import { demandStatusLabels as labels, errorMessage } from '../../utils/display';
import type { ContractMap } from '../../../contracts/generated/dto';
const session = useSessionStore(),
  items = ref<ContractMap['demandService.listManaged']['response']['items']>([]),
  cursor = ref<string | null>(null),
  busy = ref(false),
  error = ref(''),
  region = ref(''),
  statusIndex = ref(0),
  startAt = ref<number>(),
  endAt = ref<number>();
const statuses = [
  'pending_audit',
  'rejected',
  'pending_claim',
  'claiming',
  'processing',
  'pending_review',
  'completed',
  'cancelled',
  'expired',
  'terminated',
] as const;
const statusNames = ['全部状态', ...statuses.map((s) => labels[s])];
const scene = ref<'village' | 'campus'>(),
  type = ref<ContractMap['demandService.listManaged']['request']['type']>();
const day = (n: number) => new Date(n + 8 * 3600000).toISOString().slice(0, 10),
  open = (id: string) =>
    uni.navigateTo({ url: '/pages/demand-detail/demand-detail?id=' + encodeURIComponent(id) });
async function load(reset = true) {
  if (!session.isManager || busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    const r = await cloudCall(
      'demandService.listManaged',
      {
        ...(statusIndex.value ? { status: statuses[statusIndex.value - 1] } : {}),
        ...(region.value ? { region_id: region.value } : {}),
        ...(startAt.value === undefined ? {} : { start_at: startAt.value }),
        ...(endAt.value === undefined ? {} : { end_at: endAt.value }),
        ...(scene.value ? { business_scene: scene.value } : {}),
        ...(type.value ? { type: type.value } : {}),
        ...(reset || !cursor.value ? {} : { cursor: cursor.value }),
      },
      session.options(),
    );
    items.value = reset ? r.items : [...items.value, ...r.items];
    cursor.value = r.next_cursor;
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
onLoad((q) => {
  if (q?.region) region.value = q.region;
  if (q?.scene === 'village' || q?.scene === 'campus') scene.value = q.scene;
  if (q?.start && Number.isSafeInteger(Number(q.start))) startAt.value = Number(q.start);
  if (q?.end && Number.isSafeInteger(Number(q.end))) endAt.value = Number(q.end);
  if (q?.type && ['enterprise', 'agriculture', 'research', 'campus'].includes(q.type))
    type.value = q.type as typeof type.value;
});
onShow(() => {
  void load();
});
</script>
