// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { signUploadTicket, type UploadDescriptor } from '../../server/adapters/cos-upload-ticket';
import { MemoryRepository } from '../helpers/memory-repository';
import { createHandler } from '../../server/handler';
import { privateDataCodec } from '../../server/core/private-data';
import { userIdentityId } from '../../server/core/command';
import type { User, Grant } from '../../server/core/entities';

const now = Date.UTC(2026, 9, 30, 10),
  prefix = 'cloud://test-env.test-bucket/';
const credentials = {
  secretId: 'test-session-id',
  secretKey: 'unit-test-signing-key',
  sessionToken: 'unit-session-token',
};
const sign = (upload: UploadDescriptor, time: number) =>
  signUploadTicket(
    prefix,
    upload,
    { fileId: prefix + upload.path, cosFileId: 'unit-cloud-metadata' },
    credentials,
    time,
  );
const descriptor = () => ({
  path: `temporary/owner/${randomUUID()}`,
  mime: 'image/png',
  size: 100,
  expires_at: now + 120000,
});
it('signs an exact private key, MIME, byte count, expiry and overwrite guard without exposing a secret key', () => {
  const input = descriptor(),
    ticket = sign(input, now);
  const policy = JSON.parse(Buffer.from(ticket.form_data.policy, 'base64').toString());
  expect(policy.conditions).toContainEqual({ key: input.path });
  expect(policy.conditions).toContainEqual(['content-length-range', 100, 100]);
  expect(policy.conditions).toContainEqual({ acl: 'private' });
  expect(policy.conditions).toContainEqual({ 'Content-Type': 'image/png' });
  expect(policy.conditions).toContainEqual({ 'x-cos-forbid-overwrite': 'true' });
  for (const key of [
    'x-cos-grant-read',
    'x-cos-grant-write',
    'x-cos-grant-read-acp',
    'x-cos-grant-write-acp',
    'x-cos-grant-full-control',
  ]) {
    expect(policy.conditions).toContainEqual({ [key]: '' });
    expect(ticket.form_data[key as keyof typeof ticket.form_data]).toBe('');
  }
  expect(policy.conditions).toContainEqual({ 'x-cos-acl': 'private' });
  expect(new Date(policy.expiration).getTime()).toBe(ticket.expires_at);
  expect(ticket.expires_at - now).toBeLessThanOrEqual(120000);
  expect(JSON.stringify(ticket)).not.toContain(credentials.secretKey);
});
it.each([
  { path: `private/files/${randomUUID()}` },
  { path: `temporary/owner/../${randomUUID()}` },
  { expires_at: now + 120001 },
  { size: 10 * 1024 * 1024 + 1 },
])('refuses an unsafe signing descriptor %j', (bad) => {
  expect(() => sign({ ...descriptor(), ...bad }, now)).toThrow();
});
it('refuses cross-environment metadata and incomplete temporary credentials', () => {
  const input = descriptor(),
    metadata = { fileId: 'cloud://other.other-bucket/' + input.path, cosFileId: 'meta' };
  expect(() => signUploadTicket(prefix, input, metadata, credentials, now)).toThrow();
  expect(() =>
    signUploadTicket(
      prefix,
      input,
      { ...metadata, fileId: prefix + input.path },
      { ...credentials, sessionToken: '' },
      now,
    ),
  ).toThrow();
});
let repo: MemoryRepository, handle: ReturnType<typeof createHandler>;
const issue = vi.fn(async (d: UploadDescriptor, t: number) => sign(d, t));
async function call(action: string, data: unknown, actor = 'owner', time = now, extra = {}) {
  return handle(
    'fileService',
    {
      api_version: 'v1',
      request_id: randomUUID(),
      idempotency_key: randomUUID(),
      action,
      data,
      ...extra,
    },
    actor,
    time,
  );
}
async function prepare(purpose = 'avatar', extra = {}) {
  const r = await call(
    'prepareUpload',
    { purpose, mime: 'image/png', size: 100, filename: 'fixture.png' },
    'owner',
    now,
    extra,
  );
  expect(r.code).toBe(0);
  return r.data as { upload_id: string; cloud_path: string };
}
beforeEach(() => {
  repo = new MemoryRepository();
  issue.mockReset().mockImplementation(async (d, t) => sign(d, t));
  repo.seed('system_guards', { _id: 'v2_migration', schema_version: 2, status: 'verified' });
  for (const id of ['owner', 'other']) {
    repo.seed<User>('users', {
      _id: id,
      _openid: id,
      user_code: id,
      display_name: id,
      avatar_file_id: null,
      account_status: 'active',
      auth_version: 1,
      operation_seq: 0,
      grant_ids: [],
      application_ids: [],
      created_at: now,
    });
    repo.seed('wechat_identities', { _id: userIdentityId(id), user_id: id });
  }
  handle = createHandler(
    repo,
    privateDataCodec(Buffer.alloc(32, 1).toString('base64')),
    undefined,
    {
      uploadTicket: issue,
      verify: async () => {
        throw new Error('not used');
      },
      access: async () => {
        throw new Error('not used');
      },
    },
  );
});
it('issues fresh capabilities from the stored upload without persisting tokens or cached responses', async () => {
  const upload = await prepare();
  const before = repo.rows('idempotency_keys').length;
  expect((await call('getUploadTicket', { upload_id: upload.upload_id })).code).toBe(0);
  expect(issue).toHaveBeenCalledWith(
    expect.objectContaining({ path: upload.cloud_path, size: 100, mime: 'image/png' }),
    now,
  );
  expect(repo.rows('idempotency_keys')).toHaveLength(before);
  expect(
    JSON.stringify(repo.rows('file_uploads')) + JSON.stringify(repo.rows('idempotency_keys')),
  ).not.toContain(credentials.sessionToken);
});
it('rejects another owner and client-supplied paths before contacting storage', async () => {
  const upload = await prepare();
  expect((await call('getUploadTicket', { upload_id: upload.upload_id }, 'other')).code).toBe(404);
  expect(
    (await call('getUploadTicket', { upload_id: upload.upload_id, path: 'private/override' }))
      .error_code,
  ).toBe('VALIDATION_FAILED');
  expect(issue).not.toHaveBeenCalled();
});
it('rechecks account revocation after external credential issuance', async () => {
  const upload = await prepare();
  issue.mockImplementationOnce(async (d, t) => {
    repo.seed('users', { ...(await repo.get<User>('users', 'owner'))!, account_status: 'banned' });
    return sign(d, t);
  });
  expect(await call('getUploadTicket', { upload_id: upload.upload_id })).toMatchObject({
    error_code: 'ACCOUNT_DISABLED',
    data: null,
  });
});
it('rechecks a revoked policy-banner grant after external credential issuance', async () => {
  const grant: Grant = {
    _id: 'admin',
    user_id: 'owner',
    role: 'super_admin',
    scope_type: 'platform',
    scope_region_id: null,
    profile_kind: null,
    organization_id: null,
    status: 'active',
    expires_at: null,
    renewed_from: null,
    revoked_at: null,
  };
  repo.seed('role_grants', grant);
  const upload = await prepare('policy_banner', { grant_id: grant._id });
  issue.mockImplementationOnce(async (d, t) => {
    repo.seed('role_grants', { ...grant, status: 'revoked', revoked_at: now });
    return sign(d, t);
  });
  expect(
    await call('getUploadTicket', { upload_id: upload.upload_id }, 'owner', now, {
      grant_id: grant._id,
    }),
  ).toMatchObject({ error_code: 'ROLE_NOT_APPROVED', data: null });
});
it('rejects expired/completed uploads and a closed migration gate before storage calls', async () => {
  const upload = await prepare();
  expect(
    (await call('getUploadTicket', { upload_id: upload.upload_id }, 'owner', now + 31 * 60000))
      .error_code,
  ).toBe('STATE_CONFLICT');
  const original = (await repo.get<{ _id: string; file_id: string | null }>(
    'file_uploads',
    upload.upload_id,
  ))!;
  repo.seed('file_uploads', { ...original, file_id: 'done' });
  expect((await call('getUploadTicket', { upload_id: upload.upload_id })).error_code).toBe(
    'STATE_CONFLICT',
  );
  repo.seed('system_guards', { _id: 'v2_migration', schema_version: 2, status: 'applying' });
  expect((await call('getUploadTicket', { upload_id: upload.upload_id })).error_code).toBe(
    'MIGRATION_REQUIRED',
  );
  expect(issue).not.toHaveBeenCalled();
});
