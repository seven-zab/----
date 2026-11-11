// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../../src/services/cloudClient', () => ({ cloudCall: vi.fn(), newRequestId: vi.fn() }));
vi.mock('../../src/stores/session', () => ({ useSessionStore: () => ({ options: () => ({}) }) }));
import { uploadImage } from '../../src/services/fileV1';

afterEach(() => vi.unstubAllGlobals());
it('reports photo selection, cancellation and file read failures without exposing native errors', async () => {
  vi.stubGlobal('uni', {
    chooseImage: ({ fail }: { fail: (e: unknown) => void }) =>
      fail({ errMsg: 'chooseImage:fail auth deny /private/path' }),
  });
  await expect(uploadImage('avatar')).rejects.toThrow('无法选择图片');
  vi.stubGlobal('uni', {
    chooseImage: ({ fail }: { fail: (e: unknown) => void }) =>
      fail({ errMsg: 'chooseImage:fail cancel' }),
  });
  await expect(uploadImage('avatar')).rejects.toThrow('已取消选择图片');
  vi.stubGlobal('uni', {
    chooseImage: ({ success }: { success: (v: unknown) => void }) =>
      success({ tempFilePaths: ['local-photo'] }),
  });
  vi.stubGlobal('wx', {
    getFileSystemManager: () => ({ readFile: ({ fail }: { fail: () => void }) => fail() }),
  });
  await expect(uploadImage('avatar')).rejects.toThrow('读取图片失败');
});
