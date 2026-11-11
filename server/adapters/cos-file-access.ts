import { createHash, createHmac } from 'node:crypto';
import { ensure } from '../core/errors';
import { storageTarget, type UploadCredentials } from './cos-upload-ticket';
const encode = (s: string) =>
  encodeURIComponent(s).replace(
    /[!'()*]/gu,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
/** Exact-key GET signature under the COS XML protocol. Does not rely on a
 * CDN's undocumented or absent maxAge return value.
 * https://cloud.tencent.com/document/product/436/7778 */
export function signFileAccess(
  prefix: string | undefined,
  fileId: string,
  seconds: number,
  credentials: UploadCredentials,
  now: number,
  deadline = now + seconds * 1000,
) {
  const { bucket } = storageTarget(prefix);
  ensure(prefix && fileId.startsWith(prefix), 'FORBIDDEN', '文件不在当前存储环境');
  const key = fileId.slice(prefix.length);
  ensure(
    /^(?:private\/(?:files|exports)|public\/policy-banners|temporary)\/[A-Za-z0-9_./-]+$/u.test(
      key,
    ) &&
      key.split('/').every((p) => p && p !== '.' && p !== '..') &&
      Number.isSafeInteger(now) &&
      Number.isSafeInteger(seconds) &&
      seconds >= 1 &&
      seconds <= 300 &&
      Number.isSafeInteger(deadline) &&
      Object.values(credentials).every((v) => typeof v === 'string' && v.length > 0),
    'DEPENDENCY_UNAVAILABLE',
    '私有文件短链参数不可用',
    503,
  );
  const expiresAt = Math.floor(Math.min(now + seconds * 1000, deadline) / 1000) * 1000;
  // COS's end second is inclusive; our business expiry is exclusive. Clip
  // that final second so the actual capability never crosses the deadline.
  const end = expiresAt / 1000 - 1;
  ensure(expiresAt > now, 'NOT_FOUND', '文件访问期限已过', 404);
  const time = `${Math.floor(now / 1000) - 30};${end}`;
  const host = `${bucket}.cos.ap-shanghai.myqcloud.com`;
  const token = encode(credentials.sessionToken);
  const query = `x-cos-security-token=${token}`;
  const canonical = `get\n/${key}\n${query}\nhost=${encode(host)}\n`;
  const keyHash = createHmac('sha1', credentials.secretKey).update(time).digest('hex');
  const stringToSign = `sha1\n${time}\n${createHash('sha1').update(canonical).digest('hex')}\n`;
  const signature = createHmac('sha1', keyHash).update(stringToSign).digest('hex');
  const params = new URLSearchParams({
    'q-sign-algorithm': 'sha1',
    'q-ak': credentials.secretId,
    'q-sign-time': time,
    'q-key-time': time,
    'q-header-list': 'host',
    'q-url-param-list': 'x-cos-security-token',
    'q-signature': signature,
    'x-cos-security-token': credentials.sessionToken,
  });
  return {
    url: `https://${host}/${key}?${params}`,
    max_age: (expiresAt - now) / 1000,
    expires_at: expiresAt,
  };
}
export function cloudbaseFileAccess(prefix: string | undefined) {
  return async (fileId: string, seconds: number, deadline?: number) =>
    signFileAccess(
      prefix,
      fileId,
      seconds,
      {
        secretId: process.env.TENCENTCLOUD_SECRETID ?? '',
        secretKey: process.env.TENCENTCLOUD_SECRETKEY ?? '',
        sessionToken: process.env.TENCENTCLOUD_SESSIONTOKEN ?? '',
      },
      Date.now(),
      deadline,
    );
}
