import { expect, it } from 'vitest';
import { temporaryCleanupPlan } from '../../scripts/lib/temporary-cleanup-plan.mjs';
function setup() {
  const cloud = 'cloud://test.bucket/';
  const snapshot = {
    file_uploads: [
      {
        _id: 'u',
        owner_id: 'owner',
        cloud_path: 'temporary/u',
        expires_at: 1,
        file_id: 'f',
        source_cloud_file_id: cloud + 'temporary/u',
      },
    ],
    files: [
      {
        _id: 'f',
        owner_id: 'owner',
        cloud_file_id: cloud + 'private/files/u/hash/copy',
        storage_mode: 'immutable_private',
        check_status: 'pass',
        state: 'active',
        content_hash: 'hash',
        size: 4,
        ref_count: 1,
      },
    ],
    file_bindings: [{ _id: 'b', file_id: 'f', active: true }],
    data_holds: [],
    data_hold_guards: [],
  };
  const storage = {
    complete: true,
    scope: { env_id: 'test', bucket: 'bucket', prefix: '' },
    entries: [
      { key: 'temporary/u', sha256: 'hash', size: 4, file: 'objects/source.bin' },
      { key: 'private/files/u/hash/copy', sha256: 'hash', size: 4 },
    ],
  };
  return { snapshot, storage };
}
it('proposes only a fully backed-up own immutable-copy source, without authorizing deletion', () => {
  const { snapshot, storage } = setup();
  const p = temporaryCleanupPlan(snapshot, storage, 90000000, 'owner');
  expect(p.proposed).toHaveLength(1);
  expect(p.deletion_authorized).toBe(false);
  expect(p.requires_live_recheck).toBe(true);
  expect(p.proposed[0].restore_probe_required).toBe(true);
});
it('retains unregistered, differently owned and recently expired sources', () => {
  const { snapshot, storage } = setup();
  storage.entries.push({ key: 'temporary/unknown', size: 4, sha256: 'hash' });
  let p = temporaryCleanupPlan(snapshot, storage, 90000000, 'someone');
  expect(p.proposed).toHaveLength(0);
  expect(p.retained.map((r) => r.reason)).toContain('UNREGISTERED_MANUAL_REVIEW');
  p = temporaryCleanupPlan(snapshot, storage, 1000, 'owner');
  expect(p.retained[0].reason).toBe('EXPIRY_OR_24H_OBSERVATION_PENDING');
});
it('refuses to propose cleanup based on metadata alone when actual copy bytes differ or are missing', () => {
  const { snapshot, storage } = setup();
  storage.entries[1].sha256 = 'different';
  expect(temporaryCleanupPlan(snapshot, storage, 90000000, 'owner').proposed).toHaveLength(0);
  storage.entries.pop();
  expect(temporaryCleanupPlan(snapshot, storage, 90000000, 'owner').proposed).toHaveLength(0);
});
it('blocks on holds or reference-count inconsistency and refuses ambiguous registrations', () => {
  const { snapshot, storage } = setup();
  snapshot.files[0].ref_count = 2;
  expect(temporaryCleanupPlan(snapshot, storage, 90000000, 'owner').hold_or_binding_blocked).toBe(
    true,
  );
  snapshot.files[0].ref_count = 1;
  snapshot.file_uploads.push({ ...snapshot.file_uploads[0], _id: 'duplicate' });
  expect(temporaryCleanupPlan(snapshot, storage, 90000000, 'owner').retained[0].reason).toBe(
    'AMBIGUOUS_REGISTRATION',
  );
});
it('rejects duplicate storage keys and incomplete backup input', () => {
  const { snapshot, storage } = setup();
  storage.entries.push(storage.entries[0]);
  expect(() => temporaryCleanupPlan(snapshot, storage, 90000000, 'owner')).toThrow();
  expect(() =>
    temporaryCleanupPlan(snapshot, { ...storage, complete: false }, 90000000, 'owner'),
  ).toThrow();
});
