<script setup lang="ts">
import { onLaunch, onShow } from '@dcloudio/uni-app';
import { initCloud } from './utils/cloud-init';
import { useSessionStore } from './stores/session';
import { useSettingsStore } from './stores/settings';
import { registerPrivacyAuthorization } from './stores/privacy';
onLaunch(() => {
  useSettingsStore().initSettings();
  registerPrivacyAuthorization();
  try {
    initCloud();
  } catch (error) {
    uni.showToast({
      title: error instanceof Error ? error.message : '云环境初始化失败',
      icon: 'none',
    });
  }
});
onShow(() => {
  void useSessionStore()
    .refresh()
    .catch(() => {
      /* The session store clears invalid accounts. */
    });
});
</script>

<style lang="scss">
@import './styles/app.scss';
</style>
