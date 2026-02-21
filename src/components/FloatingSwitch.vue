<template>
  <view class="floating-switch" :style="{ top: top + 'px' }" @click.stop="toggle">
    <view class="switch-container" :class="{ active: settings.largeTextMode }">
      <view class="switch-handle"></view>
    </view>
    <text class="switch-label">大字版</text>
  </view>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useSettingsStore } from '@/stores/settings';

const settings = useSettingsStore();
const top = ref(100); // Default fallback

onMounted(() => {
  // Get capsule button info to position correctly
  try {
    const menuButtonInfo = uni.getMenuButtonBoundingClientRect();
    // Place it below the capsule button (bottom + 10px)
    if (menuButtonInfo && menuButtonInfo.bottom) {
      top.value = menuButtonInfo.bottom + 10;
    }
  } catch (e) {
    console.warn('Failed to get menu button rect', e);
  }
});

const toggle = () => {
  settings.toggleLargeTextMode();
};
</script>

<style lang="scss" scoped>
.floating-switch {
  position: fixed;
  right: 20rpx;
  z-index: 9999;
  display: flex;
  align-items: center;
  background-color: rgba(255, 255, 255, 0.95);
  padding: 12rpx 24rpx;
  border-radius: 40rpx;
  box-shadow: 0 4rpx 16rpx rgba(0, 0, 0, 0.15);
  transition: all 0.3s ease;
  border: 1rpx solid #eee;

  .switch-container {
    width: 70rpx;
    height: 40rpx;
    background-color: #e0e0e0;
    border-radius: 20rpx;
    position: relative;
    margin-right: 12rpx;
    transition: background-color 0.3s;

    &.active {
      background-color: #007aff;

      .switch-handle {
        transform: translateX(30rpx);
      }
    }

    .switch-handle {
      width: 36rpx;
      height: 36rpx;
      background-color: #fff;
      border-radius: 50%;
      position: absolute;
      top: 2rpx;
      left: 2rpx;
      transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: 0 2rpx 4rpx rgba(0, 0, 0, 0.2);
    }
  }

  .switch-label {
    font-size: 28rpx;
    color: #333;
    font-weight: 500;
  }
}
</style>
