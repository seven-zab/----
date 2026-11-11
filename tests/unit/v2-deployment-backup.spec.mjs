// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { Buffer } from 'node:buffer';
import { downloadFunctionBackup } from '../../scripts/lib/download-function-backup.mjs';

it('retries a false-success download to a fresh path and returns only a real entry', async () => {
  const missing = Object.assign(new Error('missing'), { code: 'ENOENT' });
  const read = vi
    .fn()
    .mockRejectedValueOnce(missing)
    .mockResolvedValueOnce(Buffer.from('valid entry'));
  const download = vi.fn(async () => {});
  const result = await downloadFunctionBackup('backup', 'service', download, read);
  expect(download).toHaveBeenCalledTimes(2);
  expect(download.mock.calls[0][0]).not.toBe(download.mock.calls[1][0]);
  expect(result.entry.toString()).toBe('valid entry');
  expect(result.directory).toBe(download.mock.calls[1][0]);
});

it('never permits deployment backup success after repeated missing or empty entries', async () => {
  const download = vi.fn(async () => {});
  await expect(
    downloadFunctionBackup('backup', 'service', download, async () => {
      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    }),
  ).rejects.toThrow('after 3 attempts');
  expect(download).toHaveBeenCalledTimes(3);
  await expect(
    downloadFunctionBackup('backup', 'service', download, async () => Buffer.alloc(0)),
  ).rejects.toThrow('Empty backup');
});
