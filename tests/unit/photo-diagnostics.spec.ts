// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { diagnosePhotoAccess } from '../../src/utils/photo-diagnostics';

afterEach(() => vi.unstubAllGlobals());
it('classifies local privacy failures without exposing native error text', async () => {
  vi.stubGlobal('wx', {
    getPrivacySetting: ({ success }: any) => success({ needAuthorization: true }),
  });
  vi.stubGlobal('uni', {
    chooseImage: ({ fail }: any) => fail({ errMsg: 'chooseImage:fail privacy /secret/path' }),
  });
  const result = await diagnosePhotoAccess();
  expect(result).toContain('需要用户同意');
  expect(result).toContain('微信返回隐私相关错误');
  expect(result).not.toContain('/secret/path');
});
it('reports selection and does not claim false privacy status proves configuration', async () => {
  vi.stubGlobal('wx', {
    getPrivacySetting: ({ success }: any) => success({ needAuthorization: false }),
  });
  vi.stubGlobal('uni', {
    chooseImage: ({ success }: any) => success({ tempFilePaths: ['/secret/path'] }),
  });
  const result = await diagnosePhotoAccess();
  expect(result).toContain('无需再次同意或没有待授权指引');
  expect(result).toContain('已打开并选择图片');
  expect(result).not.toContain('/secret/path');
});
