<template>
  <PageShell>
    <view class="profile-heading">
      <UserAvatar
        :user-id="session.me?.user_id"
        :file-id="session.me?.avatar_file_id"
        :refresh-key="avatarRefresh"
        @load-error="avatarError = $event"
      />
      <view class="profile-intro">
        <text class="profile-name">{{ session.me?.display_name || '欢迎来到云治乡智' }}</text>
        <text class="muted profile-subtitle">{{
          session.me
            ? session.validGrant
              ? roleLabels[session.validGrant.role]
              : '普通用户'
            : '连接乡村需求与校园力量'
        }}</text>
        <text v-if="avatarError" class="avatar-note">头像暂未加载</text>
      </view>
      <button
        v-if="session.me"
        class="text-button edit-profile"
        @click="go('/pages/profile-edit/profile-edit')"
      >
        编辑资料
      </button>
    </view>
    <view v-if="!session.me" class="login-welcome"
      ><text>登录后管理需求、参与任务，与伙伴一起协作。</text
      ><button class="primary" @click="go('/pages/login/login')">微信登录</button></view
    >
    <template v-else>
      <view class="identity-panel">
        <view class="section-heading"
          ><text class="section-title">当前身份</text
          ><button class="text-button" @click="refresh">刷新</button></view
        >
        <text class="identity-name">{{
          session.validGrant ? roleLabels[session.validGrant.role] : '普通用户'
        }}</text>
        <view v-if="session.me.grants.length" class="identity-options">
          <button
            v-for="g in session.me.grants"
            :key="g.grant_id"
            :class="['identity-option', { selected: session.grantId === g.grant_id }]"
            :disabled="!grantUsable(g)"
            @click="select(g.grant_id)"
          >
            {{ roleLabels[g.role] }}{{ grantUsable(g) ? '' : '（待复核）' }}
          </button>
        </view>
        <button class="text-button identity-apply" @click="go('/pages/role-apply/role-apply')">
          {{ session.me.grants.length ? '申请其他身份 / 师生复核' : '申请认证身份，开启业务协作' }}
        </button>
      </view>
      <text class="group-label">我的协作</text>
      <view class="menu-panel">
        <NavRow
          title="我的需求"
          description="查看发布、审核和对接进度"
          symbol="需"
          @activate="go('/pages/my-demands/my-demands')"
        />
        <NavRow
          title="我参与的任务"
          description="记录进度、提交成果"
          symbol="行"
          @activate="go('/pages/claimed-tasks/claimed-tasks')"
        />
        <NavRow
          title="我的团队"
          description="管理团队与加入邀请"
          symbol="队"
          tone="blue"
          @activate="go('/pages/teams/teams')"
        />
        <NavRow
          title="系统通知"
          description="身份审核与业务状态更新"
          symbol="信"
          tone="blue"
          @activate="go('/pages/notifications/notifications')"
        />
      </view>
      <text class="group-label">身份与授权</text>
      <view class="menu-panel">
        <NavRow
          title="本次代发授权"
          description="查看发起或收到的代发申请"
          symbol="授"
          @activate="go('/pages/delegations/delegations')"
        />
        <NavRow title="复制我的代发识别码" @activate="copyDelegationCode" />
        <NavRow title="复制组队识别码" :description="session.me.user_code" @activate="copy" />
      </view>
      <view v-if="session.isManager" class="manager-entry" @click="go('/pages/workbench/workbench')"
        ><view
          ><text class="manager-title">管理工作台</text
          ><text class="manager-subtitle">审批、辖区任务与统计报表</text></view
        ><text class="manager-action">进入</text></view
      >
      <button class="text-button logout-button" @click="session.logout()">退出登录</button>
    </template>
    <text class="error">{{ error }}</text>
  </PageShell>
</template>
<script setup lang="ts">
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import PageShell from '../../components/PageShell.vue';
import UserAvatar from '../../components/UserAvatar.vue';
import NavRow from '../../components/NavRow.vue';
import type { RoleGrantDTO } from '../../../contracts/generated/dto';
import { useSessionStore } from '../../stores/session';
import { roleLabels, errorMessage } from '../../utils/display';
const session = useSessionStore();
const error = ref('');
const avatarError = ref('');
const avatarRefresh = ref(0);
const grantUsable = (g: RoleGrantDTO) =>
  g.status === 'active' && (g.expires_at === null || g.expires_at > Date.now());
const go = (url: string) => uni.navigateTo({ url });
function select(id: string) {
  try {
    session.select(id);
  } catch (e) {
    error.value = errorMessage(e);
  }
}
function copy() {
  if (session.me) uni.setClipboardData({ data: session.me.user_code });
}
function copyDelegationCode() {
  if (session.me) uni.setClipboardData({ data: session.me.user_id });
}
async function refresh() {
  try {
    await session.refresh();
    avatarRefresh.value++;
    error.value = '';
  } catch (e) {
    error.value = errorMessage(e);
  }
}
onShow(() => {
  void refresh();
});
</script>
<style scoped>
.profile-heading {
  display: flex;
  gap: 22rpx;
  align-items: center;
  padding: 22rpx 0 34rpx;
}
.profile-intro {
  flex: 1;
  min-width: 0;
}
.profile-name {
  display: block;
  font-size: 1.35em;
  font-weight: 600;
  line-height: 1.4;
  overflow-wrap: anywhere;
}
.profile-subtitle {
  display: block;
  font-size: 0.86em;
  margin-top: 10rpx;
}
.avatar-note {
  display: block;
  color: #697c75;
  font-size: 0.76em;
}
.edit-profile {
  font-size: 0.82em;
  flex: none;
}
.identity-panel {
  background: #e7f0ea;
  padding: 28rpx;
  border-radius: 26rpx;
}
.identity-name {
  display: block;
  font-weight: 600;
  font-size: 1.15em;
}
.identity-options {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
  margin-top: 20rpx;
}
.identity-option {
  padding: 8rpx 18rpx;
  font-size: 0.82em;
  margin: 0;
  border: 1rpx solid #cbded0;
  background: transparent;
  border-radius: 12rpx;
}
.identity-option.selected {
  background: #216653;
  border-color: #216653;
  color: #fff;
}
.identity-apply {
  font-size: 0.84em;
  text-align: left;
  margin: 18rpx 0 0;
}
.group-label {
  display: block;
  margin: 38rpx 4rpx 14rpx;
  font-size: 0.85em;
  color: #697c75;
}
.menu-panel {
  padding: 0 26rpx;
  background: #fff;
  border-radius: 24rpx;
}
.manager-entry {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24rpx;
  background: #216653;
  color: #fff;
  border-radius: 24rpx;
  padding: 28rpx;
  margin-top: 30rpx;
}
.manager-title {
  display: block;
  font-weight: 600;
}
.manager-subtitle {
  display: block;
  margin-top: 8rpx;
  color: #dfede5;
  font-size: 0.82em;
}
.manager-action {
  flex: none;
  font-size: 0.9em;
}
.logout-button {
  width: 100%;
  margin-top: 40rpx;
  color: #697c75;
}
.login-welcome {
  padding: 36rpx 28rpx;
  background: white;
  border-radius: 24rpx;
}
</style>
