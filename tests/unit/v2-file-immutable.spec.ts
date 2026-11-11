// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { cloudbaseFiles } from '../../server/adapters/cloudbase-files';
import { fileHash, bindFile, type StoredFile } from '../../server/modules/file/service';
import { createHandler } from '../../server/handler';
import { privateDataCodec } from '../../server/core/private-data';
import { userIdentityId } from '../../server/core/command';
import type { User } from '../../server/core/entities';
import { MemoryRepository } from '../helpers/memory-repository';
import { runStorageCleanupTasks } from '../../server/maintenance/storage-cleanup';
const prefix = 'cloud://test-bucket/';
const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
const now = 1792886400000;
let objects: Map<string, Buffer>;
let repo: MemoryRepository;
let handle: ReturnType<typeof createHandler>;
const scan = vi.fn(async () => ({ errCode: 0 }));
const upload = vi.fn(
  async ({ cloudPath, fileContent }: { cloudPath: string; fileContent: Buffer }) => {
    objects.set(prefix + cloudPath, Buffer.from(fileContent));
    return { fileID: prefix + cloudPath };
  },
);
const cloud = {
  downloadFile: async ({ fileID }: { fileID: string }) => ({
    fileContent: Buffer.from(objects.get(fileID) ?? []),
    statusCode: 200,
  }),
  uploadFile: upload,
  getTempFileURL: async () => ({ fileList: [] }),
  openapi: { security: { imgSecCheck: scan } },
};
async function call(action: string, data: unknown, time = now) {
  return handle(
    'fileService',
    { api_version: 'v1', request_id: randomUUID(), idempotency_key: randomUUID(), action, data },
    'owner',
    time,
  );
}
async function ticket() {
  const r = await call('prepareUpload', {
    purpose: 'avatar',
    mime: 'image/png',
    size: bytes.length,
    filename: 'image.png',
  });
  expect(r.code).toBe(0);
  const result = r.data as { upload_id: string; cloud_path: string };
  objects.set(prefix + result.cloud_path, Buffer.from(bytes));
  return result;
}
beforeEach(() => {
  objects = new Map();
  repo = new MemoryRepository();
  repo.seed('system_guards', { _id: 'v2_migration', schema_version: 2, status: 'verified' });
  scan.mockClear().mockResolvedValue({ errCode: 0 });
  upload.mockClear();
  repo.seed<User>('users', {
    _id: 'owner',
    _openid: 'owner',
    user_code: 'code',
    display_name: '测试',
    avatar_file_id: null,
    account_status: 'active',
    auth_version: 1,
    operation_seq: 0,
    grant_ids: [],
    application_ids: [],
    created_at: now,
  });
  repo.seed('wechat_identities', { _id: userIdentityId('owner'), user_id: 'owner' });
  handle = createHandler(
    repo,
    privateDataCodec(Buffer.alloc(32, 1).toString('base64')),
    undefined,
    cloudbaseFiles(cloud, prefix, true),
  );
});
it('stores a server-owned immutable copy and retry does not re-scan or overwrite it after the temporary object changes', async () => {
  const t = await ticket();
  const source = prefix + t.cloud_path;
  const input = { upload_id: t.upload_id, cloud_file_id: source, hash: fileHash(bytes) };
  const r = await call('finalizeUpload', input);
  expect(r.code).toBe(0);
  const id = (r.data as { file_id: string }).file_id;
  const file = (await repo.get<StoredFile>('files', id))!;
  expect(file.storage_mode).toBe('immutable_private');
  expect(file.cloud_file_id).not.toBe(source);
  objects.set(source, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 9]));
  expect((await call('finalizeUpload', input, now + 31 * 60000)).data).toEqual(r.data);
  expect(objects.get(file.cloud_file_id)).toEqual(bytes);
  expect(scan).toHaveBeenCalledTimes(1);
  expect(upload).toHaveBeenCalledTimes(1);
  expect(repo.rows('storage_cleanup_tasks')).toMatchObject([
    { status: 'processed', manual_review_required: false },
  ]);
  expect(
    (await call('finalizeUpload', { ...input, hash: fileHash(objects.get(source)!) })).error_code,
  ).toBe('IDEMPOTENCY_CONFLICT');
});
it('rejects a wrong claimed hash before copying bytes', async () => {
  const t = await ticket();
  expect(
    (
      await call('finalizeUpload', {
        upload_id: t.upload_id,
        cloud_file_id: prefix + t.cloud_path,
        hash: '0'.repeat(64),
      })
    ).code,
  ).toBe(400);
  expect(upload).not.toHaveBeenCalled();
  expect(repo.rows('files')).toHaveLength(0);
  expect(repo.rows('storage_cleanup_tasks')).toHaveLength(0);
});
it('records the planned private copy before upload and preserves it for manual review when upload outcome is unknown', async () => {
  const t = await ticket();
  upload.mockImplementationOnce(async ({ cloudPath, fileContent }) => {
    const copy = prefix + cloudPath;
    expect(repo.rows('storage_cleanup_tasks')).toMatchObject([
      { cloud_file_id: copy, status: 'dead', manual_review_required: true },
    ]);
    objects.set(copy, Buffer.from(fileContent));
    throw new Error('simulated lost upload response');
  });
  const result = await call('finalizeUpload', {
    upload_id: t.upload_id,
    cloud_file_id: prefix + t.cloud_path,
    hash: fileHash(bytes),
  });
  expect(result.code).toBe(500);
  const task = repo.rows<{
    _id: string;
    cloud_file_id: string;
    status: string;
    manual_review_required: boolean;
  }>('storage_cleanup_tasks')[0];
  expect(task).toMatchObject({ status: 'dead', manual_review_required: true });
  expect(objects.has(task.cloud_file_id)).toBe(true);
  const storage = { remove: vi.fn(async () => {}) };
  await runStorageCleanupTasks(repo, storage, now + 3600000);
  expect(storage.remove).not.toHaveBeenCalled();
  expect(repo.rows('files')).toHaveLength(0);
});
it('leaves a planned copy for review if migration freezes after upload', async () => {
  const t = await ticket();
  upload.mockImplementationOnce(async ({ cloudPath, fileContent }) => {
    const copy = prefix + cloudPath;
    objects.set(copy, Buffer.from(fileContent));
    repo.seed('system_guards', { _id: 'v2_migration', schema_version: 2, status: 'applying' });
    return { fileID: copy };
  });
  const result = await call('finalizeUpload', {
    upload_id: t.upload_id,
    cloud_file_id: prefix + t.cloud_path,
    hash: fileHash(bytes),
  });
  expect(result.error_code).toBe('MIGRATION_REQUIRED');
  expect(repo.rows('storage_cleanup_tasks')).toMatchObject([
    { status: 'dead', manual_review_required: true },
  ]);
  expect(repo.rows('files')).toHaveLength(0);
});
it('records each concurrent copy and only clears the winning copy after the file transaction commits', async () => {
  const t = await ticket();
  let release = () => {};
  const bothStarted = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started = 0;
  const pendingUpload = async ({
    cloudPath,
    fileContent,
  }: {
    cloudPath: string;
    fileContent: Buffer;
  }) => {
    const copy = prefix + cloudPath;
    objects.set(copy, Buffer.from(fileContent));
    if (++started === 2) release();
    await bothStarted;
    return { fileID: copy };
  };
  upload.mockImplementationOnce(pendingUpload).mockImplementationOnce(pendingUpload);
  const input = {
    upload_id: t.upload_id,
    cloud_file_id: prefix + t.cloud_path,
    hash: fileHash(bytes),
  };
  const [first, second] = await Promise.all([
    call('finalizeUpload', input),
    call('finalizeUpload', input),
  ]);
  expect(first.code).toBe(0);
  expect(second.data).toEqual(first.data);
  expect(repo.rows('files')).toHaveLength(1);
  const tasks = repo.rows<{ _id: string; status: string; manual_review_required: boolean }>(
    'storage_cleanup_tasks',
  );
  expect(tasks.filter((task) => task.status === 'processed')).toHaveLength(1);
  expect(
    tasks.filter((task) => task.status === 'dead' && task.manual_review_required),
  ).toHaveLength(1);
});
it('fails closed when private storage protection has not been verified', async () => {
  const t = await ticket();
  const provider = cloudbaseFiles(cloud, prefix, false);
  await expect(
    provider.verify(
      prefix + t.cloud_path,
      t.cloud_path,
      'image/png',
      bytes.length,
      fileHash(bytes),
    ),
  ).rejects.toMatchObject({ error_code: 'DEPENDENCY_UNAVAILABLE' });
  expect(upload).not.toHaveBeenCalled();
});
it('registers an anticipated public object before upload and rejects a different returned file ID', async () => {
  const source = prefix + 'private/files/verified-image';
  const path = 'public/policy-banners/' + 'a'.repeat(64);
  objects.set(source, Buffer.from(bytes));
  const registered: string[] = [];
  const unexpected: string[] = [];
  upload.mockImplementationOnce(async ({ cloudPath, fileContent }) => {
    expect(registered).toEqual([prefix + path]);
    objects.set(prefix + cloudPath, Buffer.from(fileContent));
    return { fileID: 'cloud://unexpected-bucket/' + cloudPath };
  });
  const provider = cloudbaseFiles(cloud, prefix, true);
  await expect(
    provider.publishPublic!(
      source,
      fileHash(bytes),
      path,
      async (id) => {
        registered.push(id);
      },
      async (id) => {
        unexpected.push(id);
      },
    ),
  ).rejects.toMatchObject({ error_code: 'DEPENDENCY_UNAVAILABLE' });
  expect(registered).toEqual([prefix + path]);
  expect(unexpected).toEqual(['cloud://unexpected-bucket/' + path]);
});
it('records both the planned and unexpected private object IDs for manual review', async () => {
  const t = await ticket();
  let unexpected = '';
  upload.mockImplementationOnce(async ({ cloudPath, fileContent }) => {
    unexpected = 'cloud://unexpected-bucket/' + cloudPath;
    objects.set(unexpected, Buffer.from(fileContent));
    return { fileID: unexpected };
  });
  const result = await call('finalizeUpload', {
    upload_id: t.upload_id,
    cloud_file_id: prefix + t.cloud_path,
    hash: fileHash(bytes),
  });
  expect(result.error_code).toBe('DEPENDENCY_UNAVAILABLE');
  const tasks = repo.rows<{
    _id: string;
    cloud_file_id: string;
    status: string;
    manual_review_required: boolean;
  }>('storage_cleanup_tasks');
  expect(tasks).toHaveLength(2);
  expect(tasks.every((task) => task.status === 'dead' && task.manual_review_required)).toBe(true);
  expect(tasks.some((task) => task.cloud_file_id === unexpected)).toBe(true);
  expect(repo.rows('files')).toHaveLength(0);
});
it('refuses to bind a mutable legacy object even when an old record says content check passed', async () => {
  repo.seed<StoredFile>('files', {
    _id: 'legacy',
    owner_id: 'owner',
    purpose: 'demand',
    mime: 'image/png',
    size: bytes.length,
    cloud_file_id: 'cloud://old',
    content_hash: fileHash(bytes),
    check_status: 'pass',
    state: 'active',
    storage_mode: 'temporary_unverified',
    ref_count: 0,
    created_at: now,
  });
  await expect(
    repo.transaction((tx) => bindFile(tx, 'legacy', 'demand', 'task', now)),
  ).rejects.toMatchObject({ error_code: 'FORBIDDEN' });
  expect(repo.rows('file_bindings')).toHaveLength(0);
});
it('keeps a saved avatar bound so deleteUnbound cannot remove an in-use profile file', async () => {
  const t = await ticket();
  const r = await call('finalizeUpload', {
    upload_id: t.upload_id,
    cloud_file_id: prefix + t.cloud_path,
    hash: fileHash(bytes),
  });
  const id = (r.data as { file_id: string }).file_id;
  const saved = await handle(
    'userService',
    {
      api_version: 'v1',
      request_id: randomUUID(),
      idempotency_key: randomUUID(),
      action: 'updateProfile',
      data: { avatar_file_id: id },
    },
    'owner',
    now,
  );
  expect(saved.code).toBe(0);
  expect((await repo.get<StoredFile>('files', id))?.ref_count).toBe(1);
  expect((await call('deleteUnbound', { file_id: id })).code).toBe(409);
});
