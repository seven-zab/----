<script setup lang="ts">
import { onLaunch, onShow, onHide } from '@dcloudio/uni-app';
import { useUserStore } from '@/stores/user';
import { initCloud } from '@/utils/cloud-init';
import { userStatusWatcher } from '@/services/userStatusWatcher';

const roleNameMap: Record<string, string> = {
  farmer: '认证农户',
  local_admin: '地方团委',
  school_admin: '高校志愿者',
  general_user: '普通用户',
};

onLaunch(() => {
  console.log('App Launch');

  initCloud();

  try {
    const userStore = useUserStore();
    userStore.initFromStorage();
  } catch (err) {
    console.error('User store init failed', err);
  }
});

onShow(() => {
  console.log('App Show');

  const userStore = useUserStore();

  if (userStore.isLoggedIn) {
    const daysSinceActive = userStore.getDaysSinceLastActive();

    if (daysSinceActive >= 7) {
      uni.showModal({
        title: '登录已过期',
        content: `您已有 ${daysSinceActive} 天未使用小程序，请重新登录`,
        showCancel: false,
        success: () => {
          userStore.logout();
          uni.reLaunch({ url: '/pages/login/login' });
        }
      });
      return;
    }

    userStore.refreshUserInfo();
    userStore.updateLastActiveTime();

    userStatusWatcher.start(30000);

    userStatusWatcher.onUserStatusChange((event) => {
      if (event.type === 'role') {
        const newRole = event.newValue as string;
        const oldRole = event.oldValue as string;

        uni.showModal({
          title: '身份已变更',
          content: `您的身份已从"${roleNameMap[oldRole] || oldRole}"变更为"${roleNameMap[newRole] || newRole}"`,
          showCancel: false,
          success: () => {
            const pages = getCurrentPages();
            if (pages.length > 0) {
              const currentPage = pages[pages.length - 1];
              currentPage.onShow?.();
            }
          }
        });
      } else if (event.type === 'status') {
        const newStatus = event.newValue as string;

        if (newStatus === 'active') {
          uni.showToast({
            title: '认证已通过，欢迎加入！',
            icon: 'success',
            duration: 3000
          });
        } else if (newStatus === 'rejected') {
          uni.showModal({
            title: '认证被驳回',
            content: '您的身份认证申请已被驳回，请重新提交资料',
            showCancel: false
          });
        }
      }
    });
  }
});

onHide(() => {
  console.log('App Hide');
  userStatusWatcher.stop();
});
</script>

<style lang="scss">
.large-text-mode {
  view,
  text,
  button,
  input,
  textarea,
  label,
  navigator {
  }
}
</style>
