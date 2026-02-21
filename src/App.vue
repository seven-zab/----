<script setup lang="ts">
import { onLaunch, onShow, onHide } from '@dcloudio/uni-app';

onLaunch(() => {
  console.log('App Launch');
  // @ts-ignore
  if (wx.cloud) {
    // 即使这里不传 env，云函数调用时的 config 也会生效
    // 但为了保险，我们保持一致，并添加 try-catch 确保 init 不会阻断流程
    try {
      // @ts-ignore
      wx.cloud.init({
        env: 'test-yzxz-0g1jgylp46818d68',
        traceUser: true,
      });
      console.log('wx.cloud.init success with test-yzxz-0g1jgylp46818d68');
    } catch (err) {
      console.error('wx.cloud.init failed', err);
    }
  } else {
    console.error('请使用 2.2.3 或以上的基础库以使用云能力');
  }
});
onShow(() => {
  console.log('App Show');
});
onHide(() => {
  console.log('App Hide');
});
</script>

<style lang="scss">
/*每个页面公共css */

/* Large Text Mode Global Styles */
/* Note: Since we cannot easily toggle classes on the 'page' element dynamically,
   we rely on a root container class in each page. 
   However, we provide global overrides here that can be used if we find a way to toggle root class.
   Or we can use these styles to ensure consistency.
*/

.large-text-mode {
  view,
  text,
  button,
  input,
  textarea,
  label,
  navigator {
    /* Using !important to override component specific styles */
    /* Base size increase */
    /* We can't simply say 20px for everything, as headers should be larger.
       But the requirement says "Base font size increased to 20px".
       We will set a minimum.
    */
  }
}
</style>
