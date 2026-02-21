<template>
  <view class="container">
    <view class="logo-area">
      <image src="/static/logo.png" mode="aspectFit" class="logo" />
      <text class="title">云治乡智</text>
    </view>

    <!-- Login Section -->
    <view v-if="!showRegister" class="login-section">
      <wd-button type="success" block size="large" @click="handleLogin">微信一键登录</wd-button>
      <view class="tips">未注册用户将自动跳转注册</view>
    </view>

    <!-- Register Section -->
    <view v-else class="register-section">
      <view class="form-title">新用户注册</view>

      <wd-input label="姓名" v-model="formData.name" placeholder="请输入真实姓名" />
      <wd-input label="电话" v-model="formData.phone" type="number" placeholder="请输入联系电话" />

      <view class="form-item">
        <view class="label">选择角色</view>
        <wd-radio-group v-model="formData.role">
          <wd-radio value="farmer">农户/商户</wd-radio>
          <wd-radio value="local_admin">地方团委</wd-radio>
          <wd-radio value="school_admin">学校团委</wd-radio>
          <wd-radio value="general_user">普通用户</wd-radio>
        </wd-radio-group>
      </view>

      <view v-if="formData.role === 'farmer'" class="verify-tip">
        注：农户注册需经过审核，请确保信息真实。
      </view>

      <wd-button type="primary" block size="large" @click="handleRegister" :loading="loading"
        >提交注册</wd-button
      >
      <wd-button type="info" block size="large" plain @click="showRegister = false" class="mt-20"
        >返回登录</wd-button
      >
    </view>
    <!-- Debug Link -->
    <view class="debug-link" @click="goToDebug">遇到问题？点击进行系统诊断</view>
  </view>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue';
import { useUserStore } from '@/stores/user';

const userStore = useUserStore();
const showRegister = ref(false);
const loading = ref(false);

const goToDebug = () => {
  uni.navigateTo({ url: '/pages/debug/test-runner' });
};

const formData = reactive({
  name: '',
  phone: '',
  role: 'farmer', // default
  verify_material: '', // placeholder
});

const handleLogin = async () => {
  uni.showLoading({ title: '登录中...' });
  try {
    const res = await userStore.login();
    uni.hideLoading();
    if (res.success) {
      uni.showToast({ title: '登录成功', icon: 'success' });
      setTimeout(() => {
        uni.reLaunch({ url: '/pages/index/index' });
      }, 1500);
    } else if (res.needRegister) {
      showRegister.value = true;
      uni.showToast({ title: '请完善注册信息', icon: 'none' });
    }
  } catch (e: any) {
    uni.hideLoading();
    uni.showToast({ title: e.message || '登录失败', icon: 'none' });
  }
};

const handleRegister = async () => {
  if (!formData.name || !formData.phone) {
    uni.showToast({ title: '请填写完整信息', icon: 'none' });
    return;
  }

  loading.value = true;
  try {
    const res = await userStore.register(formData);
    loading.value = false;
    if (res.success) {
      uni.showToast({ title: '注册成功', icon: 'success' });
      setTimeout(() => {
        uni.reLaunch({ url: '/pages/index/index' });
      }, 1500);
    }
  } catch (e: any) {
    loading.value = false;
    uni.showToast({ title: e.message || '注册失败', icon: 'none' });
  }
};
</script>

<style lang="scss" scoped>
.container {
  padding: 40px 20px;
  min-height: 100vh;
  background-color: #fff;
  display: flex;
  flex-direction: column;
}

.logo-area {
  margin-top: 40px;
  margin-bottom: 60px;
  display: flex;
  flex-direction: column;
  align-items: center;

  .logo {
    width: 80px;
    height: 80px;
    margin-bottom: 16px;
    // background-color: #eee; // Placeholder if image missing
  }

  .title {
    font-size: 24px;
    font-weight: bold;
    color: #333;
  }
}

.login-section,
.register-section {
  width: 100%;
}

.tips {
  margin-top: 16px;
  text-align: center;
  font-size: 14px;
  color: #999;
}

.form-title {
  font-size: 20px;
  font-weight: bold;
  margin-bottom: 24px;
  color: #333;
}

.form-item {
  margin-bottom: 16px;

  .label {
    font-size: 14px;
    color: #666;
    margin-bottom: 8px;
  }
}

.mt-20 {
  margin-top: 20px;
}

.verify-tip {
  font-size: 12px;
  color: #ff9800;
  margin-bottom: 16px;
  padding: 8px;
  background-color: #fff7e0;
  border-radius: 4px;
}

.debug-link {
  margin-top: auto;
  text-align: center;
  font-size: 12px;
  color: #ccc;
  padding: 20px 0;
  text-decoration: underline;
}
</style>
