import { createRequire } from 'node:module';
import { ensure } from '../core/errors';
import {
  signUploadTicket,
  storageTarget,
  type UploadCredentials,
  type UploadDescriptor,
} from './cos-upload-ticket';

export function cloudbaseUploadIssuer(prefix: string | undefined) {
  return async (upload: UploadDescriptor, now: number) => {
    const { env } = storageTarget(prefix);
    // SCF supplies temporary execution-role credentials. Never accept client
    // credentials or create permanent keys to enable uploads.
    const credentials: UploadCredentials = {
      secretId: process.env.TENCENTCLOUD_SECRETID ?? '',
      secretKey: process.env.TENCENTCLOUD_SECRETKEY ?? '',
      sessionToken: process.env.TENCENTCLOUD_SESSIONTOKEN ?? '',
    };
    ensure(
      Object.values(credentials).every(Boolean),
      'DEPENDENCY_UNAVAILABLE',
      '运行身份的临时存储凭据不可用',
      503,
    );
    const paired = createRequire(require.resolve('wx-server-sdk/package.json'));
    const sdk = paired('@cloudbase/node-sdk') as {
      init(options: object): {
        getUploadMetadata(options: {
          cloudPath: string;
        }): Promise<{ code?: number; data?: { fileId: string; cosFileId: string } }>;
      };
    };
    let metadata;
    try {
      metadata = await sdk
        .init({ env, ...credentials, timeout: 8000 })
        .getUploadMetadata({ cloudPath: upload.path });
    } catch {
      ensure(false, 'DEPENDENCY_UNAVAILABLE', '存储上传凭据签发失败', 503);
    }
    ensure(
      (metadata?.code === undefined || metadata.code === 0) && metadata?.data,
      'DEPENDENCY_UNAVAILABLE',
      '存储上传元数据不可用',
      503,
    );
    return signUploadTicket(prefix, upload, metadata.data, credentials, now);
  };
}
