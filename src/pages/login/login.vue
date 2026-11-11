<template>
  <PageShell>
    <view class="login-brand"
      ><view class="login-leaf" /><text class="login-brand-name">云治乡智</text
      ><text class="login-brand-description">乡村所需，校园所长</text></view
    >
    <view class="login-panel"
      ><text class="heading">从一次协作开始</text
      ><text class="page-description"
        >登录后可申请认证身份、管理需求，<text class="login-line"
          >与乡村和校园的伙伴一起行动。</text
        ></text
      ><button class="primary" :disabled="busy" @click="login">
        {{ busy ? '正在登录…' : '微信登录' }}</button
      ><text v-if="error" class="error">{{ error }}</text
      ><text class="login-note">身份申请需经平台人工审核</text></view
    >
  </PageShell>
</template>
<script setup lang="ts">
import { ref } from 'vue';
import PageShell from '../../components/PageShell.vue';
import { useSessionStore } from '../../stores/session';
import { errorMessage } from '../../utils/display';
const session = useSessionStore();
const busy = ref(false);
const error = ref('');
async function login() {
  busy.value = true;
  error.value = '';
  try {
    await session.login();
    uni.switchTab({ url: '/pages/user/user' });
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
</script>
<style scoped>
.login-brand {
  padding: 70rpx 0;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.login-leaf {
  width: 72rpx;
  height: 88rpx;
  background: #216653;
  border-radius: 4rpx 52rpx 4rpx 52rpx;
  transform: rotate(-18deg);
  margin-bottom: 30rpx;
}
.login-brand-name {
  font-size: 1.7em;
  font-weight: 600;
  letter-spacing: 5rpx;
}
.login-brand-description {
  color: #697c75;
  margin-top: 12rpx;
  font-size: 0.9em;
}
.login-panel {
  padding: 40rpx 30rpx;
  background: #fff;
  border-radius: 28rpx;
}
.login-panel .heading {
  font-size: 1.3em;
}
.login-panel .primary {
  margin-top: 44rpx;
}
.login-line {
  display: block;
}
.login-note {
  display: block;
  text-align: center;
  font-size: 0.76em;
  color: #697c75;
  margin-top: 24rpx;
}
</style>
