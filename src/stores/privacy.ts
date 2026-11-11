import { reactive } from 'vue';

type Decision = { event: 'agree'; buttonId: string } | { event: 'disagree' };
type ResolvePrivacy = (decision: Decision) => void;

export const privacyState = reactive({
  visible: false,
  contractName: '微信隐私保护指引',
  error: '',
});
let registered = false;
let pending: ResolvePrivacy[] = [];

/** Register once: WeChat replaces previous listeners when registered again. */
export function registerPrivacyAuthorization() {
  if (registered || typeof wx === 'undefined' || !wx.onNeedPrivacyAuthorization) return;
  wx.onNeedPrivacyAuthorization((resolve) => {
    pending.push(resolve);
    privacyState.visible = true;
    privacyState.error = '';
    wx.getPrivacySetting?.({
      success: (result) => {
        if (privacyState.visible && result.privacyContractName)
          privacyState.contractName = result.privacyContractName.slice(0, 100);
      },
    });
  });
  registered = true;
}

function finish(decision: Decision) {
  const callbacks = pending;
  pending = [];
  privacyState.visible = false;
  privacyState.error = '';
  for (const resolve of callbacks) resolve(decision);
}

// Call only from the native agreePrivacyAuthorization button event.
export function agreePrivacyAuthorization() {
  finish({ event: 'agree', buttonId: 'privacy-accept' });
}
export function rejectPrivacyAuthorization() {
  finish({ event: 'disagree' });
}
export function openPrivacyContract() {
  if (!wx.openPrivacyContract) {
    privacyState.error = '当前微信版本无法打开隐私指引，请更新微信后重试';
    return;
  }
  wx.openPrivacyContract({
    fail: () => {
      privacyState.error = '暂时无法打开微信隐私指引，请联系管理员核对配置';
    },
  });
}
