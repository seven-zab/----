// Transitional envelope validation for old screens. v1 screens use cloudClient.
export interface LegacyResponse<T> {
  code: number;
  msg: string;
  data: T;
}
export async function legacyCall<T>(
  options: WechatCloudCallOptions,
): Promise<{ result: LegacyResponse<T> }> {
  const response = await wx.cloud.callFunction(options);
  let value: unknown = response.result;
  if (typeof value === 'string') value = JSON.parse(value) as unknown;
  if (!value || typeof value !== 'object' || !('code' in value) || typeof value.code !== 'number')
    throw new Error('云函数返回格式无效');
  const result = value as { code: number; msg?: unknown; data?: unknown };
  return {
    result: {
      code: result.code,
      msg: typeof result.msg === 'string' ? result.msg : '请求失败',
      data: result.data as T,
    },
  };
}
