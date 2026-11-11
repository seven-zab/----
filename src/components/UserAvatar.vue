<template>
  <view :class="['user-avatar', { 'user-avatar-large': large, 'user-avatar-compact': compact }]">
    <image
      v-if="imageSource"
      class="avatar-image"
      :src="imageSource"
      mode="aspectFill"
      @error="imageFailure"
    />
    <view v-else class="avatar-fallback" aria-label="默认头像">
      <view class="avatar-head" /><view class="avatar-body" />
    </view>
  </view>
</template>
<script setup lang="ts">
import { computed, ref, watch, onUnmounted } from 'vue';
import { cloudCall } from '../services/cloudClient';
const props = defineProps<{
  userId?: string;
  fileId?: string | null;
  previewSrc?: string;
  refreshKey?: number;
  large?: boolean;
  compact?: boolean;
}>();
const emit = defineEmits<{ (event: 'loadError', message: string): void }>();
const url = ref('');
const failed = ref(false);
const imageSource = computed(() => (failed.value ? '' : props.previewSrc || url.value));
let generation = 0;
let expiry: ReturnType<typeof setTimeout> | undefined;
watch(
  () => [props.userId, props.fileId, props.previewSrc, props.refreshKey],
  async () => {
    const current = ++generation;
    if (expiry) clearTimeout(expiry);
    url.value = '';
    failed.value = false;
    emit('loadError', '');
    if (props.previewSrc || !props.userId || !props.fileId) return;
    try {
      const [access] = await cloudCall('fileService.getAccessUrl', {
        file_ids: [props.fileId],
        resource_type: 'avatar',
        resource_id: props.userId,
        purpose: '显示本人头像',
      });
      if (current !== generation) return;
      if (!access || !access.mime.startsWith('image/') || access.expires_at <= Date.now())
        throw new Error('头像链接不可用');
      url.value = access.url;
      expiry = setTimeout(() => {
        if (current !== generation) return;
        url.value = '';
        emit('loadError', '头像预览已过期，重新打开页面可刷新');
      }, Math.min(access.expires_at - Date.now(), 300000));
    } catch {
      if (current === generation) emit('loadError', '头像暂未加载，重新打开页面可重试');
    }
  },
  { immediate: true },
);
function imageFailure() {
  failed.value = true;
  url.value = '';
  emit('loadError', '头像暂时无法显示，请重新打开页面重试');
}
onUnmounted(() => {
  generation++;
  if (expiry) clearTimeout(expiry);
});
</script>
<style scoped>
.user-avatar {
  width: 112rpx;
  height: 112rpx;
  flex: none;
  border-radius: 50%;
  overflow: hidden;
  background: #e4eee8;
  border: 6rpx solid #fff;
  box-sizing: border-box;
}
.user-avatar-large {
  width: 188rpx;
  height: 188rpx;
  border-width: 8rpx;
}
.user-avatar-compact {
  width: 68rpx;
  height: 68rpx;
  border-width: 2rpx;
}
.avatar-image {
  width: 100%;
  height: 100%;
  display: block;
}
.avatar-fallback {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
}
.avatar-head {
  position: absolute;
  width: 30%;
  height: 30%;
  border-radius: 50%;
  left: 35%;
  top: 22%;
  background: #7f9e8d;
}
.avatar-body {
  position: absolute;
  width: 64%;
  height: 53%;
  border-radius: 50% 50% 0 0;
  left: 18%;
  top: 60%;
  background: #7f9e8d;
}
</style>
