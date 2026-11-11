/** Local-only checks: no image contents, paths or native error text leave the device. */
export async function diagnosePhotoAccess(): Promise<string> {
  let privacy = '微信隐私状态：不可查询';
  if (typeof wx !== 'undefined' && wx.getPrivacySetting) {
    privacy = await new Promise<string>((resolve) => {
      wx.getPrivacySetting!({
        success: (result) =>
          resolve(
            result.needAuthorization
              ? '微信隐私状态：需要用户同意'
              : '微信隐私状态：无需再次同意或没有待授权指引',
          ),
        fail: () => resolve('微信隐私状态：查询失败'),
      });
    });
  }
  return new Promise((resolve) => {
    uni.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      success: () => resolve(`${privacy}；相册检查：已打开并选择图片`),
      fail: (error) => {
        const raw = String(error?.errMsg ?? '').toLowerCase();
        const reason = /cancel/u.test(raw)
          ? '已取消'
          : /privacy|隐私/u.test(raw)
          ? '微信返回隐私相关错误'
          : /scope|auth|permission|deny|denied|权限/u.test(raw)
          ? '微信返回权限相关错误'
          : /not support|unsupported|not available/u.test(raw)
          ? '微信返回接口不可用'
          : '其他选图错误';
        resolve(`${privacy}；相册检查：${reason}`);
      },
    });
  });
}
