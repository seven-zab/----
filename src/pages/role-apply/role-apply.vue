<template>
  <view class="container">
    <view class="header">
      <text class="title">身份认证申请</text>
      <text class="desc">选择您要申请的身份类型</text>
    </view>

    <!-- 角色选择 -->
    <view class="role-list">
      <view
        class="role-card"
        :class="{ active: selectedRole === 'farmer' }"
        @click="selectRole('farmer')"
      >
        <view class="role-icon">🌾</view>
        <view class="role-info">
          <text class="role-name">农户/商户</text>
          <text class="role-desc">发布劳务、技术、设计、电商等帮扶需求</text>
        </view>
        <view class="check-icon" v-if="selectedRole === 'farmer'">✓</view>
      </view>

      <view
        class="role-card"
        :class="{ active: selectedRole === 'school_admin' }"
        @click="selectRole('school_admin')"
      >
        <view class="role-icon">🎓</view>
        <view class="role-info">
          <text class="role-name">高校师生</text>
          <text class="role-desc">认领需求，提供智力与实践服务</text>
        </view>
        <view class="check-icon" v-if="selectedRole === 'school_admin'">✓</view>
      </view>
    </view>

    <!-- 认证材料 -->
    <view class="form-section" v-if="selectedRole">
      <view class="section-title">认证材料</view>

      <view class="form-item">
        <view class="label">姓名</view>
        <wd-input v-model="formData.name" placeholder="请输入真实姓名" />
      </view>

      <view class="form-item">
        <view class="label">联系电话</view>
        <wd-input v-model="formData.phone" type="number" placeholder="请输入联系电话" />
      </view>

      <view class="form-item">
        <view class="label">身份证号</view>
        <wd-input v-model="formData.idCard" placeholder="请输入身份证号" />
      </view>

      <view class="form-item" v-if="selectedRole === 'farmer'">
        <view class="label">土地/营业证明</view>
        <view class="upload-area" @click="uploadMaterial">
          <text v-if="!formData.material">+</text>
          <image v-else :src="formData.material" mode="aspectFill" class="preview-img" />
        </view>
        <text class="upload-tip">上传土地证、营业执照等证明材料</text>
      </view>

      <view class="form-item" v-if="selectedRole === 'school_admin'">
        <view class="label">学生证/教师证</view>
        <view class="upload-area" @click="uploadMaterial">
          <text v-if="!formData.material">+</text>
          <image v-else :src="formData.material" mode="aspectFill" class="preview-img" />
        </view>
        <text class="upload-tip">上传学生证或教师证照片</text>
      </view>
    </view>

    <!-- 提交按钮 -->
    <view class="submit-area" v-if="selectedRole">
      <wd-button type="primary" block @click="submitApply" :loading="loading">提交申请</wd-button>
      <text class="submit-tip">提交后预计1-3个工作日内完成审核</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue';

const selectedRole = ref('');
const loading = ref(false);

const formData = reactive({
  name: '',
  phone: '',
  idCard: '',
  material: '',
});

const selectRole = (role: string) => {
  selectedRole.value = role;
};

const uploadMaterial = () => {
  uni.chooseImage({
    count: 1,
    success: (res) => {
      uni.showLoading({ title: '上传中...' });
      const filePath = res.tempFilePaths[0];

      const cloudPath = `verify/${Date.now()}-${Math.random()}.${filePath.split('.').pop()}`;

      wx.cloud.uploadFile({
        cloudPath,
        filePath,
        success: (uploadRes) => {
          formData.material = uploadRes.fileID;
          uni.hideLoading();
          uni.showToast({ title: '上传成功', icon: 'success' });
        },
        fail: () => {
          uni.hideLoading();
          uni.showToast({ title: '上传失败', icon: 'none' });
        },
      });
    },
  });
};

const submitApply = async () => {
  if (!formData.name || !formData.phone || !formData.idCard) {
    uni.showToast({ title: '请填写完整信息', icon: 'none' });
    return;
  }

  if (!formData.material) {
    uni.showToast({ title: '请上传认证材料', icon: 'none' });
    return;
  }

  loading.value = true;
  try {
    const { result } = await wx.cloud.callFunction({
      name: 'register',
      data: {
        name: formData.name,
        phone: formData.phone,
        role: selectedRole.value,
        verify_material: formData.material,
        id_card: formData.idCard,
      },
    });

    loading.value = false;
    if (result.code === 0) {
      uni.showToast({ title: '提交成功', icon: 'success' });
      setTimeout(() => {
        uni.navigateBack();
      }, 1500);
    } else {
      uni.showToast({ title: result.msg || '提交失败', icon: 'none' });
    }
  } catch (e) {
    loading.value = false;
    uni.showToast({ title: '提交失败', icon: 'none' });
  }
};
</script>

<style lang="scss" scoped>
.container {
  min-height: 100vh;
  background-color: #f5f5f5;
  padding: 30rpx;
}

.header {
  margin-bottom: 40rpx;

  .title {
    font-size: 40rpx;
    font-weight: bold;
    color: #333;
    display: block;
    margin-bottom: 16rpx;
  }

  .desc {
    font-size: 28rpx;
    color: #999;
  }
}

.role-list {
  margin-bottom: 40rpx;

  .role-card {
    background-color: #fff;
    border-radius: 16rpx;
    padding: 30rpx;
    display: flex;
    align-items: center;
    margin-bottom: 20rpx;
    border: 2rpx solid transparent;
    transition: all 0.2s;

    &.active {
      border-color: #1890ff;
      background-color: #e6f7ff;
    }

    .role-icon {
      font-size: 60rpx;
      margin-right: 30rpx;
    }

    .role-info {
      flex: 1;

      .role-name {
        font-size: 32rpx;
        font-weight: bold;
        color: #333;
        display: block;
        margin-bottom: 10rpx;
      }

      .role-desc {
        font-size: 24rpx;
        color: #999;
      }
    }

    .check-icon {
      width: 40rpx;
      height: 40rpx;
      border-radius: 50%;
      background-color: #1890ff;
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 24rpx;
    }
  }
}

.form-section {
  .section-title {
    font-size: 32rpx;
    font-weight: bold;
    margin-bottom: 30rpx;
    color: #333;
  }

  .form-item {
    margin-bottom: 30rpx;

    .label {
      font-size: 28rpx;
      font-weight: bold;
      margin-bottom: 16rpx;
      color: #333;
    }

    .upload-tip {
      font-size: 24rpx;
      color: #999;
      margin-top: 10rpx;
      display: block;
    }
  }

  .upload-area {
    width: 200rpx;
    height: 200rpx;
    border: 2rpx dashed #ddd;
    border-radius: 12rpx;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 60rpx;
    color: #ddd;
    background-color: #fafafa;

    .preview-img {
      width: 100%;
      height: 100%;
      border-radius: 12rpx;
    }
  }
}

.submit-area {
  margin-top: 60rpx;

  .submit-tip {
    display: block;
    text-align: center;
    font-size: 24rpx;
    color: #999;
    margin-top: 20rpx;
  }
}
</style>
