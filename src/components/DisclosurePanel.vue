<template>
  <view class="disclosure">
    <button
      class="disclosure-summary"
      :aria-expanded="expanded"
      @click="emit('update:expanded', !expanded)"
    >
      <view class="disclosure-copy">
        <text class="disclosure-title">{{ title }}</text>
        <text v-if="caption" class="disclosure-caption">{{ caption }}</text>
      </view>
      <text class="disclosure-action">{{ expanded ? '收起' : '展开' }}</text>
    </button>
    <view v-if="expanded" class="disclosure-body">
      <slot />
    </view>
  </view>
</template>

<script setup lang="ts">
defineProps<{ title: string; caption?: string; expanded: boolean }>();
const emit = defineEmits<{ 'update:expanded': [expanded: boolean] }>();
</script>

<style scoped>
.disclosure {
  margin: 18rpx 0;
  background: #fff;
  border: 1px solid #dce7df;
  border-radius: 12rpx;
}
.disclosure .disclosure-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18rpx;
  width: 100%;
  min-height: 96rpx;
  margin: 0;
  padding: 18rpx 22rpx;
  background: #fff;
  border: 0;
  border-radius: 12rpx;
  box-shadow: none;
  color: #193d32;
  text-align: left;
}
.disclosure-summary::after {
  border: 0;
}
.disclosure-copy {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.disclosure-title,
.disclosure-caption {
  display: block;
  line-height: 1.45;
}
.disclosure-title {
  font-weight: 650;
}
.disclosure-caption {
  margin-top: 4rpx;
  color: #50685e;
  font-size: 0.86em;
}
.disclosure-action {
  flex-shrink: 0;
  color: #216653;
  font-size: 0.88em;
}
.disclosure-body {
  padding: 18rpx 22rpx 22rpx;
  border-top: 1px solid #dce7df;
}
</style>
