<template>
  <view class="large-text-switch">
    <wd-switch
      v-model="isEnabled"
      :active-value="true"
      :inactive-value="false"
      size="small"
      @change="handleChange"
    />
    <text class="switch-label">{{ isEnabled ? '大字版' : '标准版' }}</text>
  </view>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';

const STORAGE_KEY = 'large_text_mode';
const MAX_RETRY_COUNT = 3;
const RETRY_DELAY = 500;

interface SwitchEmits {
  (e: 'change', value: boolean): void;
}

const emit = defineEmits<SwitchEmits>();

const isEnabled = ref(false);

let retryCount = 0;

/**
 * Load large text mode state from local storage with retry mechanism
 * @description Read cached state on app launch to restore user's preference
 */
const loadState = (): void => {
  try {
    const savedState = uni.getStorageSync(STORAGE_KEY);
    if (savedState !== '') {
      isEnabled.value = savedState === true || savedState === 'true';
      console.info('[LargeTextSwitch] State loaded:', isEnabled.value);
    }
  } catch (error) {
    console.error('[LargeTextSwitch] Failed to load state:', error);
    if (retryCount < MAX_RETRY_COUNT) {
      retryCount++;
      console.warn('[LargeTextSwitch] Retrying load, attempt:', retryCount);
      setTimeout(loadState, RETRY_DELAY);
    }
  }
};

/**
 * Save large text mode state to local storage with retry mechanism
 * @param value - Boolean state to persist
 */
const saveState = (value: boolean): void => {
  try {
    uni.setStorageSync(STORAGE_KEY, value);
    console.info('[LargeTextSwitch] State saved:', value);
    retryCount = 0;
  } catch (error) {
    console.error('[LargeTextSwitch] Failed to save state:', error);
    if (retryCount < MAX_RETRY_COUNT) {
      retryCount++;
      console.warn('[LargeTextSwitch] Retrying save, attempt:', retryCount);
      setTimeout(() => saveState(value), RETRY_DELAY);
    } else {
      uni.showToast({
        title: '设置保存失败，请重试',
        icon: 'none',
        duration: 2000,
      });
    }
  }
};

/**
 * Handle switch change event
 * @param {boolean} value - New switch state
 */
const handleChange = (value: boolean): void => {
  console.info('[LargeTextSwitch] Switch changed:', value);
  saveState(value);
  emit('change', value);
};

watch(isEnabled, (newValue) => {
  emit('change', newValue);
});

onMounted(() => {
  loadState();
});

defineExpose({
  isEnabled,
  setEnabled: (value: boolean) => {
    isEnabled.value = value;
    saveState(value);
  },
});
</script>

<style lang="scss" scoped>
.large-text-switch {
  display: flex;
  align-items: center;
  gap: 8rpx;

  .switch-label {
    font-size: 24rpx;
    color: #666;
    line-height: 1;
  }
}
</style>
