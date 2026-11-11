import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { cloudCall, newRequestId } from './cloudClient';
import type { ContractMap } from '../../contracts/generated/dto';
import { useSessionStore } from '../stores/session';
import { imageUploadFailure, imageUploadStatusFailure } from '../utils/upload-errors';
type Purpose = ContractMap['fileService.prepareUpload']['request']['purpose'];
export async function openFileAccess(
  file: ContractMap['fileService.getAccessUrl']['response'][number],
) {
  if (!Number.isFinite(file.expires_at) || file.expires_at <= Date.now())
    throw new Error('附件链接已过期，请重新打开');
  if (file.mime.startsWith('image/')) {
    await new Promise<void>((resolve, reject) =>
      uni.previewImage({ urls: [file.url], success: () => resolve(), fail: reject }),
    );
    return;
  }
  const types: Record<string, 'pdf' | 'docx' | 'xlsx'> = {
    'application/pdf': 'pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  };
  const fileType = types[file.mime];
  if (!fileType) throw new Error('暂不支持打开此附件类型');
  const path = await new Promise<string>((resolve, reject) =>
    uni.downloadFile({
      url: file.url,
      success: (r) =>
        r.statusCode === 200 ? resolve(r.tempFilePath) : reject(new Error('附件下载失败')),
      fail: reject,
    }),
  );
  if (file.expires_at <= Date.now()) throw new Error('附件链接已过期，请重新打开');
  await new Promise<void>((resolve, reject) =>
    uni.openDocument({
      filePath: path,
      fileType,
      showMenu: true,
      success: () => resolve(),
      fail: reject,
    }),
  );
}
export async function uploadImage(
  purpose: Purpose,
  options: { onSelected?: (localPath: string) => void } = {},
): Promise<string> {
  const path = await new Promise<string>((resolve, reject) =>
    uni.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      success: (r) => resolve(r.tempFilePaths[0]),
      fail: (error) => {
        const message = String(error?.errMsg ?? '');
        reject(
          new Error(
            /cancel/iu.test(message)
              ? '已取消选择图片'
              : '无法选择图片，请检查微信相册权限和隐私授权后重试',
          ),
        );
      },
    }),
  );
  if (!path) throw new Error('未选择图片，请重新选择');
  options.onSelected?.(path);
  const bytes = await new Promise<Uint8Array>((resolve, reject) =>
    wx.getFileSystemManager().readFile({
      filePath: path,
      success: (r) =>
        typeof r.data === 'string'
          ? reject(new Error('文件读取格式错误'))
          : resolve(new Uint8Array(r.data)),
      fail: () => reject(new Error('读取图片失败，请重新选择图片后重试')),
    }),
  );
  const mime =
    bytes[0] === 137 && bytes[1] === 80
      ? 'image/png'
      : bytes[0] === 255 && bytes[1] === 216
      ? 'image/jpeg'
      : String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF'
      ? 'image/webp'
      : null;
  if (!mime) throw new Error('仅支持 JPEG、PNG 或 WebP 图片');
  if (bytes.length > 5 * 1024 * 1024) throw new Error('图片不能超过5MB，请压缩后重新选择');
  const ticket = await cloudCall(
    'fileService.prepareUpload',
    { purpose, mime, size: bytes.length, filename: path.split('/').pop() ?? 'image' },
    { ...useSessionStore().options(), idempotency_key: newRequestId() },
  );
  const signed = await cloudCall(
    'fileService.getUploadTicket',
    { upload_id: ticket.upload_id },
    useSessionStore().options(),
  );
  const location = /^cloud:\/\/([a-z0-9-]+)\.([a-z0-9-]+)\/(.+)$/u.exec(signed.cloud_file_id);
  if (
    !location ||
    location[1] !== import.meta.env.VITE_CLOUD_ENV_ID ||
    signed.url !== `https://${location[2]}.cos.ap-shanghai.myqcloud.com/` ||
    location[3] !== ticket.cloud_path ||
    signed.form_data.key !== ticket.cloud_path ||
    signed.expires_at <= Date.now()
  )
    throw new Error('上传凭据无效或已过期，请重新选择图片');
  await new Promise<void>((resolve, reject) =>
    uni.uploadFile({
      url: signed.url,
      name: 'file',
      filePath: path,
      formData: signed.form_data,
      success: (r) =>
        r.statusCode === 204 || r.statusCode === 409
          ? resolve()
          : reject(imageUploadStatusFailure(r.statusCode)),
      fail: (error) => reject(imageUploadFailure(error)),
    }),
  );
  const result = await cloudCall(
    'fileService.finalizeUpload',
    {
      upload_id: ticket.upload_id,
      cloud_file_id: signed.cloud_file_id,
      hash: bytesToHex(sha256(bytes)),
    },
    { idempotency_key: newRequestId() },
  );
  if (result.check_status !== 'pass') throw new Error('图片尚未通过内容检查，请稍后重试');
  return result.file_id;
}
