<template>
  <view class="container">
    <view class="form-section">
      <view class="section-title">基本信息</view>

      <view class="form-item">
        <view class="label">姓名</view>
        <wd-input v-model="formData.name" placeholder="请输入真实姓名" />
      </view>

      <view class="form-item">
        <view class="label">联系电话</view>
        <wd-input v-model="formData.phone" type="number" placeholder="请输入联系电话" />
      </view>

      <view class="form-item" v-if="userStore.role === 'farmer'">
        <view class="label">地址</view>
        <wd-input v-model="formData.address" placeholder="请输入详细地址" />
      </view>

      <view class="form-item" v-if="userStore.role === 'school_admin'">
        <view class="label">学校</view>
        <wd-input v-model="formData.school" placeholder="请输入学校名称" />
      </view>

      <view class="form-item" v-if="userStore.role === 'school_admin'">
        <view class="label">院系</view>
        <wd-input v-model="formData.department" placeholder="请输入院系名称" />
      </view>
    </view>

    <view class="submit-area">
      <wd-button type="primary" block @click="handleSave" :loading="loading">保存修改</wd-button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { useUserStore } from '@/stores/user';

const userStore = useUserStore();
const loading = ref(false);

const formData = reactive({
  name: '',
  phone: '',
  address: '',
  school: '',
  department: '',
});

onMounted(() => {
  if (userStore.userInfo) {
    formData.name = userStore.userInfo.name || '';
    formData.phone = userStore.userInfo.phone || '';
    formData.address = userStore.userInfo.audit_materials?.address || '';
    formData.school = userStore.userInfo.audit_materials?.school || '';
    formData.department = userStore.userInfo.audit_materials?.department || '';
  }
});

/**
 * Save profile changes
 */
const handleSave = async (): Promise<void> => {
  if (!formData.name || !formData.phone) {
    uni.showToast({ title: '请填写完整信息', icon: 'none' });
    return;
  }

  loading.value = true;
  try {
    const updateData: any = {
      name: formData.name,
      phone: formData.phone,
    };

    if (userStore.role === 'farmer') {
      updateData.audit_materials = {
        ...userStore.userInfo?.audit_materials,
        address: formData.address,
      };
    }

    if (userStore.role === 'school_admin') {
      updateData.audit_materials = {
        ...userStore.userInfo?.audit_materials,
        school: formData.school,
        department: formData.department,
      };
    }

    const success = await userStore.updateProfile(updateData);
    loading.value = false;

    if (success) {
      uni.showToast({ title: '保存成功', icon: 'success' });
      setTimeout(() => {
        uni.navigateBack();
      }, 1500);
    }
  } catch (error) {
    loading.value = false;
    uni.showToast({ title: '保存失败', icon: 'none' });
  }
};
</script>

<style lang="scss" scoped>
.container {
  min-height: 100vh;
  background-color: #f5f5f5;
  padding: 30rpx;
}

.form-section {
  background-color: #fff;
  border-radius: 16rpx;
  padding: 30rpx;
  margin-bottom: 30rpx;

  .section-title {
    font-size: 32rpx;
    font-weight: bold;
    margin-bottom: 30rpx;
    color: #333;
  }

  .form-item {
    margin-bottom: 30rpx;

    &:last-child {
      margin-bottom: 0;
    }

    .label {
      font-size: 28rpx;
      font-weight: bold;
      margin-bottom: 16rpx;
      color: #333;
    }
  }
}

.submit-area {
  margin-top: 40rpx;
}
</style>
