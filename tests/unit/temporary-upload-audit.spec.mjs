// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { classifyTemporaryUploads } from '../../scripts/lib/temporary-upload-audit.mjs';

describe('temporary upload inventory classification', () => {
  it('retains unknown, ambiguous and incomplete objects while distinguishing verified copies', () => {
    const objects = ['ok', 'missing', 'ambiguous', 'unfinished', 'unknown', 'fresh'].map((id) => ({
      key: `temporary/user/${id}`,
    }));
    const entry = (id, extra = {}) => ({
      cloud_path: `temporary/user/${id}`,
      owner_id: 'u',
      expires_at: { $date: 100 },
      ...extra,
    });
    const uploads = [
      entry('ok', {
        file_id: 'file',
        source_cloud_file_id: 'cloud://env.bucket/temporary/user/ok',
      }),
      entry('ambiguous'),
      entry('ambiguous'),
      entry('unfinished'),
      entry('unknown', { expires_at: 'bad' }),
      entry('fresh', { expires_at: 1000 }),
    ];
    const files = [
      {
        _id: 'file',
        owner_id: 'u',
        check_status: 'pass',
        storage_mode: 'immutable_private',
        cloud_file_id: 'cloud://env.bucket/private/file',
      },
    ];
    expect(classifyTemporaryUploads(objects, uploads, files, 500)).toEqual({
      temporary_objects: 6,
      unregistered: 1,
      ambiguous_registration: 1,
      registered_expiry_unknown: 1,
      registered_not_expired: 1,
      registered_expired_unfinished: 1,
      registered_expired_without_verified_copy: 0,
      registered_expired_with_immutable_copy: 1,
    });
    files[0].owner_id = 'different';
    expect(
      classifyTemporaryUploads(objects, uploads, files, 500)
        .registered_expired_without_verified_copy,
    ).toBe(1);
    expect(() => classifyTemporaryUploads([objects[0], objects[0]], uploads, files, 500)).toThrow();
  });
});
