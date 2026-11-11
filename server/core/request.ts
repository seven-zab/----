import Ajv from 'ajv';
import manifest from '../../contracts/generated/client-manifest.json';
import validators from '../../contracts/generated/validators.mjs';
import { BusinessError, ensure } from './errors';
import type { ContractMap } from '../../contracts/generated/dto';

export type Route = keyof ContractMap;
export interface CallRequest {
  api_version: 'v1';
  action: string;
  request_id: string;
  grant_id?: string;
  idempotency_key?: string;
  data: unknown;
}
export interface Response<T> {
  code: number;
  error_code: string | null;
  msg: string;
  request_id: string;
  data: T | null;
}
const ajv = new Ajv({ strict: true, allErrors: true });
const uuid = {
  type: 'string',
  pattern:
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
};
const envelope = ajv.compile({
  type: 'object',
  additionalProperties: false,
  required: ['api_version', 'action', 'request_id', 'data'],
  properties: {
    api_version: { const: 'v1' },
    action: { type: 'string', minLength: 1, maxLength: 100 },
    request_id: uuid,
    grant_id: { type: 'string', minLength: 1, maxLength: 128 },
    idempotency_key: uuid,
    data: {},
  },
});
const schemas = new Map(
  Object.keys(manifest).map((key) => {
    const prefix = key.replace('.', '_');
    const request = validators[`${prefix}_request`],
      response = validators[`${prefix}_response`];
    if (!request || !response) throw new Error('Generated request/response validator missing');
    return [key, { request, response }] as const;
  }),
);
export function parseRequest(
  fn: string,
  input: unknown,
): { request: CallRequest; route: Route; write: boolean; public: boolean } {
  const raw = input as Partial<CallRequest> | null;
  ensure(raw?.api_version === 'v1', 'UNSUPPORTED_VERSION', '请更新客户端，使用 v1 协议', 400);
  if (!envelope(input)) {
    const issues = (envelope.errors ?? [])
      .map((error) => {
        if (error.keyword === 'additionalProperties') {
          const name = String(error.params.additionalProperty);
          return `未知字段:${/^[A-Za-z_][A-Za-z0-9_]{0,59}$/.test(name) ? name : '(invalid)'}`;
        }
        return `${error.instancePath || '/'}:${error.keyword}`;
      })
      .join('，')
      .slice(0, 300);
    // Schema locations only, never rejected values or identity metadata.
    ensure(false, 'VALIDATION_FAILED', `请求格式不正确（${issues}）`, 400);
  }
  const request = input as CallRequest;
  const route = `${fn}.${request.action}` as Route;
  ensure(route in manifest, 'UNKNOWN_ACTION', '未知业务动作', 400);
  const contract = manifest[route];
  ensure(schemas.get(route)?.request(request.data), 'VALIDATION_FAILED', '字段不符合当前契约', 400);
  ensure(!contract.write || request.idempotency_key, 'VALIDATION_FAILED', '写操作需要幂等键', 400);
  ensure(!contract.grant || request.grant_id, 'ROLE_NOT_APPROVED', '请选择已审核身份');
  return { request, route, write: contract.write, public: contract.public };
}
export function validateResponse(route: Route, data: unknown): void {
  if (!schemas.get(route)?.response(data))
    throw new BusinessError(500, 'INTERNAL_ERROR', '返回数据不符合接口契约');
}
export function requestData<K extends Route>(
  route: K,
  request: CallRequest,
): ContractMap[K]['request'] {
  ensure(schemas.get(route)?.request(request.data), 'VALIDATION_FAILED', '字段错误', 400);
  return request.data as ContractMap[K]['request'];
}
