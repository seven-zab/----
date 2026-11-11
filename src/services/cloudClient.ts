import runtime from '../../contracts/generated/client-manifest.json';
import validators from '../../contracts/generated/validators.mjs';
import type { ContractMap } from '../../contracts/generated/dto';
import release from '../../contracts/generated/release.json';

type ServiceName = keyof typeof release.targets;
const isServiceName = (value: string): value is ServiceName =>
  Object.prototype.hasOwnProperty.call(release.targets, value);
const verifiedUntil = new Map<ServiceName, number>();
function cloudTarget() {
  const env = import.meta.env.VITE_CLOUD_ENV_ID?.trim();
  if (!env) throw new CloudError('BACKEND_UNAVAILABLE', '未配置云环境，请联系管理员', '');
  return { env };
}
async function verifyRelease(service: ServiceName, requestId: string) {
  if ((verifiedUntil.get(service) ?? 0) > Date.now()) return;
  let body: unknown;
  try {
    body = (
      await wx.cloud.callFunction({
        name: release.targets[service],
        config: cloudTarget(),
        data: { api_version: 'v1', action: 'getRelease', request_id: requestId, data: {} },
      })
    ).result;
  } catch {
    throw new CloudError(
      'BACKEND_UNAVAILABLE',
      '测试服务暂不可用，请联系开发人员核对部署',
      requestId,
    );
  }
  const value =
    body && typeof body === 'object' ? (body as { code?: unknown; data?: unknown }) : null;
  const data = value?.data;
  if (
    value?.code !== 0 ||
    !validators[`${service}_getRelease_response`](data) ||
    (data as { source_hash: string }).source_hash !== release.source_hash
  )
    throw new CloudError(
      'BACKEND_VERSION_MISMATCH',
      '测试服务与当前版本不一致，请联系开发人员部署配套服务',
      requestId,
    );
  verifiedUntil.set(service, Date.now() + 300000);
}

export class CloudError extends Error {
  constructor(public readonly code: string, message: string, public readonly requestId: string) {
    super(message);
  }
}
export const newRequestId = (): string =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === 'x' ? r : (r & 3) | 8).toString(16);
  });
export async function cloudCall<K extends keyof ContractMap>(
  route: K,
  data: ContractMap[K]['request'],
  options: { grant_id?: string; idempotency_key?: string } = {},
): Promise<ContractMap[K]['response']> {
  const contract = runtime[route];
  const schemaKey = route.replace('.', '_');
  if (!validators[`${schemaKey}_request`](data))
    throw new CloudError('VALIDATION_FAILED', '请检查表单字段', '');
  if (contract.write && !options.idempotency_key)
    throw new CloudError('VALIDATION_FAILED', '写操作缺少稳定幂等键', '');
  const requestId = newRequestId();
  const service = contract.function;
  if (!isServiceName(service))
    throw new CloudError('INVALID_CONTRACT', '服务契约配置无效', requestId);
  if (contract.action !== 'getRelease') await verifyRelease(service, requestId);
  const response = await wx.cloud.callFunction({
    name: release.targets[service],
    config: cloudTarget(),
    data: { api_version: 'v1', action: contract.action, request_id: requestId, data, ...options },
  });
  const body = response.result;
  if (!body || typeof body !== 'object' || !('code' in body) || typeof body.code !== 'number')
    throw new CloudError('INVALID_RESPONSE', '服务返回数据无效', requestId);
  const value = body as {
    code: number;
    error_code?: unknown;
    msg?: unknown;
    data?: unknown;
    request_id?: unknown;
  };
  if (value.code !== 0)
    throw new CloudError(
      typeof value.error_code === 'string' ? value.error_code : 'INTERNAL_ERROR',
      typeof value.msg === 'string' ? value.msg : '请求失败',
      typeof value.request_id === 'string' ? value.request_id : requestId,
    );
  if (!validators[`${schemaKey}_response`](value.data))
    throw new CloudError('INVALID_RESPONSE', '服务返回不符合契约', requestId);
  return value.data as unknown as ContractMap[K]['response'];
}
