// @vitest-environment node
import { expect, it } from 'vitest';
import { imageUploadFailure, imageUploadStatusFailure } from '../../src/utils/upload-errors';

it('distinguishes domain, timeout and certificate failures without disclosing native paths or signatures', () => {
  const privateDetail = '/private/photos/name.jpg?signature=private-secret';
  expect(
    imageUploadFailure({ errMsg: 'uploadFile:fail url not in domain list ' + privateDetail })
      .message,
  ).toContain('上传域名');
  expect(
    imageUploadFailure({ errMsg: 'uploadFile:fail timeout ' + privateDetail }).message,
  ).toContain('超时');
  expect(
    imageUploadFailure({ errMsg: 'uploadFile:fail ssl certificate ' + privateDetail }).message,
  ).toContain('安全连接');
  expect(imageUploadFailure({ errMsg: privateDetail }).message).toContain('检查网络');
  for (const errMsg of ['not in domain list', 'timeout', 'ssl certificate', 'unknown'])
    expect(imageUploadFailure({ errMsg: errMsg + privateDetail }).message).not.toMatch(
      /private|signature/,
    );
  expect(imageUploadStatusFailure(403).message).toContain('凭据');
  expect(imageUploadStatusFailure(413).message).toContain('大小限制');
});
