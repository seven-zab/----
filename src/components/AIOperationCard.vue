<template>
  <view class="card">
    <text class="heading">{{ label }}</text>
    <text v-if="operation.demand_id">需求编号：{{ operation.demand_id }}</text>
    <text v-if="operation.error_code" class="error">{{ operation.error_code }}</text>
    <button v-if="operation.detail_path" @click="open">查看任务当前状态</button>
    <button v-if="operation.proposal_id && operation.status === 'collecting'" @click="missing">
      查看待补充信息
    </button>
    <button
      v-if="['collecting', 'ready'].includes(operation.status)"
      :disabled="busy"
      @click="cancel"
    >
      取消尚未执行的操作
    </button>
    <text class="error">{{ error }}</text
    ><text>{{ fields }}</text>
  </view>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue';
import type { ContractMap } from '../../contracts/generated/dto';
import { cancelIntent, getProposal } from '../services/aiV1';
import { errorMessage, demandStatusLabels } from '../utils/display';
const props = defineProps<{ operation: ContractMap['aiService.getOperation']['response'] }>();
const emit = defineEmits<{ refresh: [] }>();
const busy = ref(false),
  error = ref(''),
  fields = ref('');
const label = computed(() =>
  props.operation.status === 'executed'
    ? props.operation.demand_status
      ? demandStatusLabels[props.operation.demand_status]
      : '已执行'
    : {
        collecting: '请补充信息',
        ready: '等待提交',
        cancelled: '已取消',
        expired: '指令已过期',
        failed: '操作失败',
      }[props.operation.status],
);
function open() {
  if (props.operation.detail_path) uni.navigateTo({ url: props.operation.detail_path });
}
async function cancel() {
  busy.value = true;
  try {
    await cancelIntent(props.operation.intent_id, props.operation.version);
    emit('refresh');
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
async function missing() {
  if (!props.operation.proposal_id) return;
  try {
    const p = await getProposal(props.operation.proposal_id);
    fields.value = p.missing_fields.join('；');
  } catch (e) {
    error.value = errorMessage(e);
  }
}
</script>
