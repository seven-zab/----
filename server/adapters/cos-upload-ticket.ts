import { createHash, createHmac } from 'node:crypto';
import { ensure } from '../core/errors';

export interface UploadCredentials {
  secretId: string;
  secretKey: string;
  sessionToken: string;
}
export interface UploadTicket {
  url: string;
  cloud_file_id: string;
  expires_at: number;
  form_data: {
    key: string;
    acl: 'private';
    'Content-Type': string;
    success_action_status: '204';
    'x-cos-meta-fileid': string;
    'x-cos-forbid-overwrite': 'true';
    'x-cos-acl': 'private';
    'x-cos-grant-read': '';
    'x-cos-grant-write': '';
    'x-cos-grant-read-acp': '';
    'x-cos-grant-write-acp': '';
    'x-cos-grant-full-control': '';
    'x-cos-security-token': string;
    'q-sign-algorithm': 'sha1';
    'q-ak': string;
    'q-key-time': string;
    'q-signature': string;
    policy: string;
  };
}
export interface UploadDescriptor {
  path: string;
  mime: string;
  size: number;
  expires_at: number;
}
export function storageTarget(prefix: string | undefined) {
  const match = /^cloud:\/\/([a-z0-9-]+)\.([a-z0-9-]+)\/$/u.exec(prefix ?? '');
  ensure(match, 'DEPENDENCY_UNAVAILABLE', '当前环境私有存储前缀未配置', 503);
  return { env: match[1], bucket: match[2] };
}
/** COS POST policy uses its own HMAC-SHA1 protocol, not the PUT signature.
 * https://cloud.tencent.com/document/api/436/14690
 * The secret key never leaves this function. Returned capability fields must
 * never be logged, persisted as an idempotency response, or placed in a URL. */
export function signUploadTicket(
  prefix: string | undefined,
  upload: UploadDescriptor,
  metadata: { fileId: string; cosFileId: string },
  credentials: UploadCredentials,
  now: number,
): UploadTicket {
  const { bucket } = storageTarget(prefix);
  ensure(
    /^temporary\/[a-zA-Z0-9_-]{1,128}\/[a-f0-9-]{36}$/u.test(upload.path) &&
      metadata.fileId === `${prefix}${upload.path}` &&
      typeof metadata.cosFileId === 'string' &&
      metadata.cosFileId.length > 0 &&
      metadata.cosFileId.length <= 2048 &&
      Number.isSafeInteger(upload.size) &&
      upload.size > 0 &&
      upload.size <= 10 * 1024 * 1024 &&
      /^[a-zA-Z0-9/.-]{1,200}$/u.test(upload.mime) &&
      Number.isSafeInteger(now) &&
      upload.expires_at > now &&
      upload.expires_at <= now + 120000 &&
      [credentials.secretId, credentials.secretKey, credentials.sessionToken].every(
        (v) => typeof v === 'string' && v.length > 0,
      ),
    'DEPENDENCY_UNAVAILABLE',
    '受控上传参数或临时身份不可用',
    503,
  );
  const end = Math.floor(upload.expires_at / 1000);
  const keyTime = `${Math.floor(now / 1000) - 30};${end}`;
  const fields = {
    key: upload.path,
    acl: 'private' as const,
    'Content-Type': upload.mime,
    success_action_status: '204' as const,
    'x-cos-meta-fileid': metadata.cosFileId,
    'x-cos-forbid-overwrite': 'true' as const,
    'x-cos-acl': 'private' as const,
    'x-cos-grant-read': '' as const,
    'x-cos-grant-write': '' as const,
    'x-cos-grant-read-acp': '' as const,
    'x-cos-grant-write-acp': '' as const,
    'x-cos-grant-full-control': '' as const,
    'x-cos-security-token': credentials.sessionToken,
    'q-sign-algorithm': 'sha1' as const,
    'q-ak': credentials.secretId,
    'q-key-time': keyTime,
  };
  const policy = JSON.stringify({
    expiration: new Date(end * 1000).toISOString(),
    conditions: [
      { bucket },
      ...Object.entries(fields)
        .filter(([k]) => k !== 'q-key-time')
        .map(([k, v]) => ({ [k]: v })),
      { 'q-sign-time': keyTime },
      ['content-length-range', upload.size, upload.size],
    ],
  });
  const key = createHmac('sha1', credentials.secretKey).update(keyTime).digest('hex');
  const hash = createHash('sha1').update(policy).digest('hex');
  const signature = createHmac('sha1', key).update(hash).digest('hex');
  return {
    url: `https://${bucket}.cos.ap-shanghai.myqcloud.com/`,
    cloud_file_id: metadata.fileId,
    expires_at: end * 1000,
    form_data: {
      ...fields,
      policy: Buffer.from(policy).toString('base64'),
      'q-signature': signature,
    },
  };
}
