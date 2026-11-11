<template>
  <PageShell
    ><text class="heading">我的需求</text><text class="error">{{ error }}</text
    ><view v-for="d in rows" :key="d.demand_id" class="card" @click="open(d.demand_id)"
      ><text class="status">{{ labels[d.status] }}</text
      ><text class="heading">{{ d.title || '未命名草稿' }}</text></view
    ><text v-if="!rows.length && !error">暂无记录</text
    ><button v-if="cursor" @click="load(false)">加载更多</button></PageShell
  >
</template>
<script setup lang="ts">
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import PageShell from '../../components/PageShell.vue';
import { cloudCall } from '../../services/cloudClient';
import { useSessionStore } from '../../stores/session';
import type { ContractMap } from '../../../contracts/generated/dto';
import { demandStatusLabels as labels, errorMessage } from '../../utils/display';
const rows = ref<ContractMap['demandService.listMine']['response']['items']>([]);
const cursor = ref<string | null>(null);
const error = ref('');
const session = useSessionStore();
async function load(reset = true) {
  try {
    const result = await cloudCall(
      'demandService.listMine',
      { ...(!reset && cursor.value ? { cursor: cursor.value } : {}) },
      session.options(),
    );
    rows.value = reset ? result.items : [...rows.value, ...result.items];
    cursor.value = result.next_cursor;
    error.value = '';
  } catch (e) {
    error.value = errorMessage(e);
  }
}
const open = (id: string) => uni.navigateTo({ url: '/pages/demand-detail/demand-detail?id=' + id });
onShow(() => {
  void load();
});
</script>
