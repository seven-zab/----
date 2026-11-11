// src/utils/cloud-init.ts
export const initCloud = () => {
  const envId = getCloudEnvId();

  if (typeof wx !== 'undefined' && wx.cloud) {
    if (!envId) throw new Error('未配置 VITE_CLOUD_ENV_ID');
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
export const getCloudEnvId = (): string => import.meta.env.VITE_CLOUD_ENV_ID?.trim() ?? '';
