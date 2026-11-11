import { cloudbaseRepository, type CloudDatabase } from './adapters/cloudbase-repository';
import { privateDataCodec } from './core/private-data';
import { createHandler } from './handler';
import { wechatContentSafety, type WechatSecurityAPI } from './adapters/content-safety';
import { cloudbaseFiles, type CloudFilesSDK } from './adapters/cloudbase-files';
import { wechatBusinessRequest } from './adapters/wechat-request';
import { cloudbaseUploadIssuer } from './adapters/cloudbase-upload';
import { cloudbaseFileAccess } from './adapters/cos-file-access';
import { ensure } from './core/errors';
import { runImmediateExport } from './maintenance/export-jobs';

interface CloudSDK extends CloudFilesSDK {
  DYNAMIC_CURRENT_ENV: string | symbol;
  init(options: { env: string | symbol }): void;
  getWXContext(): { OPENID?: string };
  database(options: { throwOnNotFound: boolean }): CloudDatabase;
  openapi?: CloudFilesSDK['openapi'] & { security?: WechatSecurityAPI };
}
// Supplied by the deployable function's pinned package.json.
const cloud = require('wx-server-sdk') as CloudSDK;
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const exportPrefix = process.env.STORAGE_FILE_PREFIX;
const repo = cloudbaseRepository(cloud.database({ throwOnNotFound: false }));
const handle = createHandler(
  repo,
  privateDataCodec(process.env.PRIVATE_DATA_KEY),
  wechatContentSafety(cloud.openapi?.security),
  cloudbaseFiles(
    cloud,
    process.env.STORAGE_FILE_PREFIX,
    process.env.PRIVATE_STORAGE_READY === 'true',
    cloudbaseUploadIssuer(process.env.STORAGE_FILE_PREFIX),
    cloudbaseFileAccess(process.env.STORAGE_FILE_PREFIX),
  ),
  {
    ...(SERVICE_NAME === 'statsService' &&
    process.env.PRIVATE_STORAGE_READY === 'true' &&
    exportPrefix
      ? {
          generateExport: (id: string, now: number) =>
            runImmediateExport(
              repo,
              {
                prefix: exportPrefix,
                async upload(path: string, bytes: Buffer) {
                  ensure(cloud.uploadFile, 'DEPENDENCY_UNAVAILABLE', '私有导出存储尚未核验', 503);
                  return (await cloud.uploadFile({ cloudPath: path, fileContent: bytes })).fileID;
                },
              },
              id,
              now,
            ),
        }
      : {}),
  },
);
declare const SERVICE_NAME:
  | 'userService'
  | 'demandService'
  | 'teamService'
  | 'fileService'
  | 'policyService'
  | 'chatService'
  | 'contactService'
  | 'statsService'
  | 'knowledgeService'
  | 'aiService'
  | 'maintenanceService'
  | 'notificationService';
export const main = (event: unknown) =>
  handle(SERVICE_NAME, wechatBusinessRequest(event), cloud.getWXContext().OPENID ?? '');
