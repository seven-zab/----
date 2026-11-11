<template>
  <button class="nav-row" @click="$emit('activate')">
    <view v-if="symbol" :class="['nav-symbol', { 'nav-symbol-blue': tone === 'blue' }]">{{
      symbol
    }}</view>
    <view class="nav-copy"
      ><text class="nav-title">{{ title }}</text
      ><text v-if="description" class="nav-description">{{ description }}</text></view
    >
    <view class="nav-chevron" />
  </button>
</template>
<script setup lang="ts">
defineProps<{ title: string; description?: string; symbol?: string; tone?: 'green' | 'blue' }>();
defineEmits<{ (event: 'activate'): void }>();
</script>
<style scoped>
.nav-row {
  display: flex;
  align-items: center;
  gap: 24rpx;
  width: 100%;
  text-align: left;
  border-radius: 0;
  background: transparent;
  margin: 0;
  padding: 28rpx 0;
  border-bottom: 1rpx solid #e6ede8;
}
.nav-row::after {
  border: 0;
}
.nav-row:last-child {
  border-bottom: 0;
}
.nav-symbol {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 68rpx;
  height: 68rpx;
  border-radius: 20rpx;
  color: #216653;
  background: #eaf2ed;
  font-size: 1.07em;
  font-weight: 600;
}
.nav-symbol-blue {
  color: #416c91;
  background: #edf3f8;
}
.nav-copy {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}
.nav-title {
  font-weight: 500;
  color: #233e36;
}
.nav-description {
  font-size: 0.79em;
  color: #697c75;
  line-height: 1.5;
}
.nav-chevron {
  flex: none;
  width: 12rpx;
  height: 12rpx;
  margin-right: 8rpx;
  border-top: 3rpx solid #8b9b94;
  border-right: 3rpx solid #8b9b94;
  transform: rotate(45deg);
}
</style>
