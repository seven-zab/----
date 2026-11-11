import { epoch } from '../../database/migrations/002-review-legacy.mjs';
import { auditRetentionSnapshot } from './retention-snapshot-audit.mjs';
/** Offline proposal only. A current live recheck and an explicit deletion decision remain mandatory. */
export function temporaryCleanupPlan(snapshot, storage, now, ownerId) {
  if (
    !storage?.complete ||
    !storage.scope?.env_id ||
    !Array.isArray(storage.entries) ||
    !Number.isSafeInteger(now) ||
    !ownerId ||
    !Array.isArray(snapshot?.file_uploads)
  )
    throw new Error('Complete database and object backup required');
  const audit = auditRetentionSnapshot(snapshot);
  const blocked =
    Object.entries(audit).some(
      ([k, v]) => !['files', 'bindings', 'active_holds'].includes(k) && v > 0,
    ) || audit.active_holds > 0;
  const objects = new Map();
  for (const entry of storage.entries) {
    if (objects.has(entry.key)) throw new Error('Duplicate object key');
    objects.set(entry.key, entry);
  }
  const prefix = storage.scope.prefix;
  const cloud = `cloud://${storage.scope.env_id}.${storage.scope.bucket}/`;
  const proposed = [],
    retained = [];
  for (const object of storage.entries) {
    if (!object.key.startsWith(prefix + 'temporary/')) continue;
    const relative = object.key.slice(prefix.length);
    const matched = snapshot.file_uploads.filter((u) => u.cloud_path === relative);
    let reason;
    const upload = matched[0];
    const file = upload ? snapshot.files.find((f) => f._id === upload.file_id) : null;
    const copyRelative =
      typeof file?.cloud_file_id === 'string' && file.cloud_file_id.startsWith(cloud)
        ? file.cloud_file_id.slice(cloud.length)
        : '';
    const copy = objects.get(prefix + copyRelative);
    if (blocked) reason = 'BINDING_OR_HOLD_RECONCILIATION_REQUIRED';
    else if (matched.length !== 1)
      reason = matched.length ? 'AMBIGUOUS_REGISTRATION' : 'UNREGISTERED_MANUAL_REVIEW';
    else if (upload.owner_id !== ownerId || file?.owner_id !== ownerId)
      reason = 'NOT_CURRENT_TEST_OWNER';
    else if (epoch(upload.expires_at) === null || epoch(upload.expires_at) + 86400000 > now)
      reason = 'EXPIRY_OR_24H_OBSERVATION_PENDING';
    else if (
      upload.source_cloud_file_id !== cloud + relative ||
      file.storage_mode !== 'immutable_private' ||
      file.check_status !== 'pass' ||
      file.state !== 'active' ||
      !copyRelative.startsWith('private/files/')
    )
      reason = 'IMMUTABLE_COPY_NOT_VERIFIED';
    else if (
      !copy ||
      copy.sha256 !== file.content_hash ||
      object.sha256 !== file.content_hash ||
      object.size !== file.size ||
      copy.size !== file.size ||
      copy.key === object.key
    )
      reason = 'COPY_BYTES_NOT_BACKED_UP_OR_MISMATCH';
    else if (
      snapshot.file_bindings.filter((b) => b.file_id === file._id && b.active).length !==
      file.ref_count
    )
      reason = 'REFERENCE_COUNT_MISMATCH';
    if (reason) retained.push({ source_key: object.key, reason });
    else
      proposed.push({
        source_key: object.key,
        immutable_copy_key: copy.key,
        upload_id: upload._id,
        file_id: file._id,
        sha256: object.sha256,
        bytes: object.size,
        backup_file: object.file,
        source_etag: object.etag,
        copy_etag: copy.etag,
        restore_probe_required: true,
      });
  }
  return {
    version: 1,
    env_id: storage.scope.env_id,
    owner_id: ownerId,
    observed_at: now,
    offline_non_atomic: true,
    deletion_authorized: false,
    requires_live_recheck: true,
    hold_or_binding_blocked: blocked,
    observation_grace_ms: 86400000,
    proposed,
    retained,
  };
}
