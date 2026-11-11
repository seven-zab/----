<template>
  <view class="timeline" aria-label="任务阶段">
    <view
      v-for="(stage, index) in stages"
      :key="stage.label"
      :class="['stage', { active: index <= current }]"
    >
      <text>{{ index + 1 }} · {{ stage.label }}</text>
    </view>
    <text v-if="ended" class="ended">{{ labels[status] || status }}</text>
  </view>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import type { DemandStatus } from '../../contracts/enums';
const props = defineProps<{ status: DemandStatus }>();
const stages = [
  { label: '待发布者确认', status: 'claiming' },
  { label: '服务中', status: 'processing' },
  { label: '待验收', status: 'pending_review' },
  { label: '已完成', status: 'completed' },
];
const current = computed(() => stages.findIndex((s) => s.status === props.status));
const ended = computed(() =>
  ['cancelled', 'expired', 'terminated', 'rejected'].includes(props.status),
);
const labels: Partial<Record<DemandStatus, string>> = {
  cancelled: '已取消',
  expired: '已到期',
  terminated: '已终止',
  rejected: '审核未通过',
};
</script>
<style scoped>
.timeline {
  display: flex;
  flex-wrap: wrap;
  gap: 20rpx;
  margin: 24rpx 0;
}
.stage {
  color: #707770;
  border-left: 4rpx solid #cdd5cd;
  padding-left: 12rpx;
}
.active {
  color: #245844;
  border-color: #245844;
}
.ended {
  color: #8a4038;
}
</style>
