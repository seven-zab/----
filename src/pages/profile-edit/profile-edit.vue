<template>
  <PageShell>
    <text class="heading">个人资料</text>
    <text class="page-description">让一起协作的人，更容易认识你。</text>
    <template v-if="session.me">
      <view class="profile-photo-section">
        <UserAvatar
          :user-id="session.me.user_id"
          :file-id="session.me.avatar_file_id"
          :preview-src="localPhoto"
          :refresh-key="avatarRefresh"
          large
          @load-error="avatarError = $event"
        />
        <text class="photo-state">{{ photoState }}</text>
        <text v-if="avatarError && !localPhoto" class="muted photo-hint">{{ avatarError }}</text>
        <view class="photo-actions">
          <button class="secondary photo-select" :disabled="busy" @click="chooseAvatar">
            {{ operation === 'upload' ? '正在上传并检查…' : '更换头像' }}
          </button>
          <button v-if="localPhoto" class="text-button" :disabled="busy" @click="resetPhoto">
            恢复原头像
          </button>
        </view>
        <text class="muted photo-hint">支持 JPEG、PNG、WebP，图片不超过5MB</text>
      </view>
      <view class="form-panel">
        <label class="input-label" for="profile-nickname">昵称</label>
        <input
          id="profile-nickname"
          v-model="name"
          :disabled="busy"
          maxlength="40"
          placeholder="填写昵称"
        />
        <text class="muted input-hint">1—40字，用于需求、团队与协作沟通</text>
      </view>
      <view v-if="error" class="feedback feedback-error">
        <text>{{ error }}</text>
        <button class="text-button" :disabled="busy" @click="diagnose">检查相册访问</button>
      </view>
      <text v-if="diagnosis" class="muted diagnostic-result">{{ diagnosis }}</text>
      <text v-if="message" class="feedback feedback-success">{{ message }}</text>
      <button class="primary save-profile" :disabled="saveDisabled" @click="save">
        {{ operation === 'save' ? '正在保存…' : '保存资料' }}
      </button>
      <text v-if="localPhoto && !avatar && !busy" class="muted save-hint"
        >新头像尚未上传成功，请重新选择或恢复原头像。</text
      >
    </template>
    <view v-else class="empty-state"
      ><text class="empty-title">登录后编辑个人资料</text
      ><button class="primary" @click="goLogin">微信登录</button></view
    >
  </PageShell>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import PageShell from '../../components/PageShell.vue';
import UserAvatar from '../../components/UserAvatar.vue';
import { useSessionStore } from '../../stores/session';
import { businessCommand } from '../../services/businessCommand';
import { uploadImage } from '../../services/fileV1';
import { errorMessage } from '../../utils/display';
import { diagnosePhotoAccess } from '../../utils/photo-diagnostics';
const session = useSessionStore();
const name = ref('');
const avatar = ref('');
const busy = ref(false);
const error = ref('');
const message = ref('');
const diagnosis = ref('');
const localPhoto = ref('');
const avatarError = ref('');
const avatarRefresh = ref(0);
const operation = ref<'upload' | 'save' | null>(null);
const photoState = computed(() =>
  operation.value === 'upload'
    ? '正在上传并进行内容检查'
    : avatar.value
    ? '新头像已就绪，保存后生效'
    : localPhoto.value
    ? '已选择图片，尚未上传成功'
    : '当前头像',
);
const saveDisabled = computed(
  () => busy.value || !name.value.trim() || Boolean(localPhoto.value && !avatar.value),
);
const goLogin = () => uni.navigateTo({ url: '/pages/login/login' });
function resetPhoto() {
  localPhoto.value = '';
  avatar.value = '';
  error.value = '';
  message.value = '';
  avatarRefresh.value++;
}
async function diagnose() {
  if (busy.value) return;
  busy.value = true;
  try {
    diagnosis.value = await diagnosePhotoAccess();
  } finally {
    busy.value = false;
  }
}
async function chooseAvatar() {
  if (busy.value) return;
  busy.value = true;
  operation.value = 'upload';
  error.value = '';
  message.value = '';
  try {
    avatar.value = await uploadImage('avatar', {
      onSelected: (path) => {
        localPhoto.value = path;
        avatar.value = '';
      },
    });
    error.value = '';
    message.value = '';
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
    operation.value = null;
  }
}
async function save() {
  if (saveDisabled.value || !session.me) return;
  busy.value = true;
  operation.value = 'save';
  try {
    await businessCommand('userService.updateProfile', {
      display_name: name.value.trim(),
      ...(avatar.value ? { avatar_file_id: avatar.value } : {}),
    });
    await session.refresh();
    avatar.value = '';
    localPhoto.value = '';
    avatarRefresh.value++;
    message.value = '资料已保存';
    error.value = '';
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
    operation.value = null;
  }
}
onShow(() => {
  if (busy.value) return;
  name.value = session.me?.display_name ?? '';
  avatar.value = '';
  message.value = '';
  localPhoto.value = '';
  avatarRefresh.value++;
});
</script>
<style scoped>
.profile-photo-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 44rpx 20rpx 36rpx;
  margin-top: 28rpx;
  background: #eaf2ed;
  border-radius: 32rpx;
}
.photo-state {
  font-size: 0.94em;
  font-weight: 600;
  margin-top: 22rpx;
}
.photo-actions {
  display: flex;
  align-items: center;
  gap: 24rpx;
}
.photo-select {
  min-width: 220rpx;
}
.photo-hint {
  font-size: 0.83em;
  text-align: center;
}
.form-panel {
  margin-top: 40rpx;
}
.input-label {
  display: block;
  font-weight: 600;
  margin-bottom: 12rpx;
}
.input-hint {
  font-size: 0.86em;
}
.save-profile {
  margin-top: 48rpx;
}
.save-hint {
  display: block;
  font-size: 0.86em;
  text-align: center;
}
.diagnostic-result {
  display: block;
  font-size: 0.86em;
  overflow-wrap: anywhere;
}
</style>
