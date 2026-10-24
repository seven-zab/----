// src/utils/cloud-init.ts
export const initCloud = () => {
  const envId = import.meta.env.VITE_CLOUD_ENV_ID || 'test-yzxz-xxx';

  if (typeof wx !== 'undefined' && wx.cloud) {
    wx.cloud.init({
      env: envId,
      traceUser: true,
    });
    console.log(
      `Cloud initialized in [${
        import.meta.env.VITE_APP_ENV || 'default'
      }] mode with envId: ${envId}`,
    );
  } else {
    console.warn('wx.cloud is not available. Skipping cloud initialization.');
  }
};
