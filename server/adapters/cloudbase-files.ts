import { ensure } from '../core/errors';
import { randomUUID } from 'node:crypto';
import { fileHash, sniffMime, type FileProvider } from '../modules/file/service';
export interface CloudFilesSDK {
  uploadFile?(options: { cloudPath: string; fileContent: Buffer }): Promise<{ fileID: string }>;
  downloadFile(options: { fileID: string }): Promise<{ fileContent: Buffer; statusCode: number }>;
  getTempFileURL(options: { fileList: Array<{ fileID: string; maxAge: number }> }): Promise<{
    fileList: Array<{ fileID: string; tempFileURL: string; maxAge?: number; status: number }>;
  }>;
  openapi?: {
    security?: {
      imgSecCheck(options: { media: { contentType: string; value: Buffer } }): Promise<unknown>;
    };
  };
}
export function cloudbaseFiles(
  cloud: CloudFilesSDK,
  prefix: string | undefined,
  privateStorageReady = false,
  issueUploadTicket?: FileProvider['uploadTicket'],
  issueAccess?: FileProvider['access'],
): FileProvider {
  return {
    async uploadTicket(upload, now) {
      ensure(
        privateStorageReady && issueUploadTicket,
        'DEPENDENCY_UNAVAILABLE',
        '受控上传尚未完成私有权限核验',
        503,
      );
      return issueUploadTicket(upload, now);
    },
    async publishPublic(fileId, expectedHash, path, onCopyPlanned, onUnexpectedCopy) {
      ensure(
        privateStorageReady &&
          cloud.uploadFile &&
          prefix &&
          fileId.startsWith(prefix) &&
          /^public\/policy-banners\/[a-f0-9]{64}$/u.test(path),
        'DEPENDENCY_UNAVAILABLE',
        '公开配图存储尚未核验',
        503,
      );
      const source = await cloud.downloadFile({ fileID: fileId });
      ensure(
        source.statusCode === 200 &&
          source.fileContent.length <= 5 * 1024 * 1024 &&
          fileHash(source.fileContent) === expectedHash &&
          sniffMime(source.fileContent)?.startsWith('image/'),
        'FORBIDDEN',
        '配图副本未通过完整性检查',
      );
      const bucketEnd = fileId.indexOf('/', 'cloud://'.length);
      ensure(
        fileId.startsWith('cloud://') &&
          bucketEnd > 'cloud://'.length &&
          onCopyPlanned &&
          onUnexpectedCopy,
        'DEPENDENCY_UNAVAILABLE',
        '公开副本登记未配置',
        503,
      );
      const anticipatedId = fileId.slice(0, bucketEnd + 1) + path;
      await onCopyPlanned(anticipatedId);
      const copied = await cloud.uploadFile({ cloudPath: path, fileContent: source.fileContent });
      if (
        copied.fileID !== anticipatedId &&
        typeof copied.fileID === 'string' &&
        copied.fileID.startsWith('cloud://')
      )
        await onUnexpectedCopy(copied.fileID);
      ensure(
        copied.fileID === anticipatedId && copied.fileID.startsWith(prefix),
        'DEPENDENCY_UNAVAILABLE',
        '配图发布路径异常',
        503,
      );
      return copied.fileID;
    },
    async verify(fileId, path, mime, maxBytes, expectedHash, onCopyPlanned, onUnexpectedCopy) {
      ensure(
        prefix && fileId.startsWith(prefix) && fileId.endsWith(`/${path}`),
        'FORBIDDEN',
        '文件不在当前环境登记上传路径',
      );
      const { fileContent, statusCode } = await cloud.downloadFile({ fileID: fileId });
      ensure(
        statusCode === 200 && fileContent.length <= maxBytes,
        'VALIDATION_FAILED',
        '文件大小或下载状态异常',
        400,
      );
      const actual = sniffMime(fileContent);
      const contentHash = fileHash(fileContent);
      ensure(contentHash === expectedHash, 'VALIDATION_FAILED', '文件内容与提交哈希不一致', 400);
      ensure(actual === mime, 'VALIDATION_FAILED', '实际文件类型不符或暂未支持安全检查', 400);
      let check_status: 'pass' | 'reject' | 'error' = 'error';
      if (mime.startsWith('image/') && cloud.openapi?.security?.imgSecCheck) {
        const raw = await cloud.openapi.security.imgSecCheck({
          media: { contentType: mime, value: fileContent },
        });
        if (raw && typeof raw === 'object') {
          const result = raw as { errCode?: number; errcode?: number };
          const code = result.errCode ?? result.errcode;
          check_status = code === 0 ? 'pass' : code === 87014 ? 'reject' : 'error';
        }
      }
      // Documents require a separately configured scanner. An unavailable scan never becomes pass.
      if (check_status === 'pass') {
        ensure(
          privateStorageReady && cloud.uploadFile,
          'DEPENDENCY_UNAVAILABLE',
          '私有存储写保护尚未核验，不能完成文件登记',
          503,
        );
        const uploadId = path.split('/').pop();
        ensure(
          uploadId && /^[a-f0-9-]{36}$/u.test(uploadId),
          'VALIDATION_FAILED',
          '上传路径无效',
          400,
        );
        const immutablePath = `private/files/${uploadId}/${contentHash}/${randomUUID()}`;
        ensure(
          onCopyPlanned && onUnexpectedCopy,
          'DEPENDENCY_UNAVAILABLE',
          '私有副本登记未配置',
          503,
        );
        const anticipatedId = fileId.slice(0, -path.length) + immutablePath;
        await onCopyPlanned(anticipatedId);
        const frozen = await cloud.uploadFile({ cloudPath: immutablePath, fileContent });
        if (
          frozen.fileID !== anticipatedId &&
          typeof frozen.fileID === 'string' &&
          frozen.fileID.startsWith('cloud://')
        )
          await onUnexpectedCopy(frozen.fileID);
        ensure(
          frozen.fileID === anticipatedId && frozen.fileID.startsWith(prefix!),
          'DEPENDENCY_UNAVAILABLE',
          '私有副本路径异常',
          503,
        );
        return {
          hash: contentHash,
          size: fileContent.length,
          check_status,
          cloud_file_id: frozen.fileID,
          storage_mode: 'immutable_private',
        };
      }
      return {
        hash: contentHash,
        size: fileContent.length,
        check_status,
        cloud_file_id: fileId,
        storage_mode: 'temporary_unverified',
      };
    },
    async access(fileId, seconds, deadline) {
      if (issueAccess) return issueAccess(fileId, seconds, deadline);
      const response = await cloud.getTempFileURL({
        fileList: [{ fileID: fileId, maxAge: seconds }],
      });
      const result = response.fileList[0];
      ensure(
        result?.status === 0 && result.fileID === fileId,
        'DEPENDENCY_UNAVAILABLE',
        '文件下载链接生成失败',
        503,
      );
      ensure(
        typeof result.maxAge === 'number' &&
          Number.isFinite(result.maxAge) &&
          result.maxAge > 0 &&
          result.maxAge <= seconds,
        'DEPENDENCY_UNAVAILABLE',
        '供应商未返回可核验的短链有效期',
        503,
      );
      return { url: result.tempFileURL, max_age: result.maxAge };
    },
  };
}
