<template>
  <view :class="['page-shell', { 'large-text-mode': settings.largeTextMode }]">
    <slot />
    <view v-if="privacyState.visible" class="privacy-overlay">
      <view class="privacy-dialog" role="dialog" aria-label="隐私授权">
        <text class="heading">隐私授权</text>
        <text>使用相册等功能前，请阅读并选择是否同意微信隐私保护指引。</text>
        <button @click="openPrivacyContract">查看{{ privacyState.contractName }}</button>
        <text v-if="privacyState.error" class="error">{{ privacyState.error }}</text>
        <view class="privacy-actions">
          <button @click="rejectPrivacyAuthorization">不同意</button>
          <button
            id="privacy-accept"
            class="primary"
            open-type="agreePrivacyAuthorization"
            @agreeprivacyauthorization="agreePrivacyAuthorization"
          >
            同意并继续
          </button>
        </view>
      </view>
    </view>
  </view>
</template>
<script setup lang="ts">
import { useSettingsStore } from '../stores/settings';
import {
  privacyState,
  openPrivacyContract,
  rejectPrivacyAuthorization,
  agreePrivacyAuthorization,
} from '../stores/privacy';
const settings = useSettingsStore();
</script>
<style>
.privacy-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32rpx;
  background: rgba(0, 0, 0, 0.55);
}
.privacy-dialog {
  width: 100%;
  max-width: 620rpx;
  padding: 32rpx;
  box-sizing: border-box;
  border-radius: 16rpx;
  background: #fff;
  color: #263b30;
}
.privacy-actions {
  display: flex;
  gap: 16rpx;
}
.privacy-actions button {
  flex: 1;
}
</style>
