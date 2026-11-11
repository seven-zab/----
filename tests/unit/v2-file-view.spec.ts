import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { openFileAccess } from '../../src/services/fileV1';
import type { ContractMap } from '../../contracts/generated/dto';
type Access = ContractMap['fileService.getAccessUrl']['response'][number];
const now = Date.parse('2026-10-29T12:00:00+08:00');
const preview = vi.fn((options) => options.success());
const download = vi.fn((options) =>
  options.success({ statusCode: 200, tempFilePath: '/temporary/file' }),
);
const document = vi.fn((options) => options.success());
const file = (mime: string): Access => ({
  file_id: 'file',
  mime,
  url: 'https://example.test/file.jpg',
  expires_at: now + 300000,
});
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  preview.mockClear();
  download.mockClear();
  document.mockClear();
  vi.stubGlobal('uni', { previewImage: preview, downloadFile: download, openDocument: document });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it('opens a server-verified PDF as a document even when the URL looks like an image', async () => {
  await openFileAccess(file('application/pdf'));
  expect(document).toHaveBeenCalledWith(
    expect.objectContaining({ fileType: 'pdf', filePath: '/temporary/file' }),
  );
  expect(preview).not.toHaveBeenCalled();
});
it('previews images without downloading a document copy', async () => {
  await openFileAccess(file('image/png'));
  expect(preview).toHaveBeenCalledWith(
    expect.objectContaining({ urls: ['https://example.test/file.jpg'] }),
  );
  expect(download).not.toHaveBeenCalled();
  expect(document).not.toHaveBeenCalled();
});
it('does not open a link that has reached its access deadline', async () => {
  await expect(openFileAccess({ ...file('image/png'), expires_at: now })).rejects.toThrow('过期');
  expect(preview).not.toHaveBeenCalled();
  expect(download).not.toHaveBeenCalled();
});
it('does not open a document if the link expires during download', async () => {
  download.mockImplementationOnce((options) => {
    vi.setSystemTime(now + 300000);
    options.success({ statusCode: 200, tempFilePath: '/temporary/file' });
  });
  await expect(openFileAccess(file('application/pdf'))).rejects.toThrow('过期');
  expect(document).not.toHaveBeenCalled();
});
