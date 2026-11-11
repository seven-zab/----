import { epoch } from '../../database/migrations/002-review-legacy.mjs';

// Classification only. Cross-service inventories are not atomic, so none of
// these counts is authorization to delete or proof that an object is orphaned.
export function classifyTemporaryUploads(objects, uploads, files, now) {
  if (
    !Array.isArray(objects) ||
    !Array.isArray(uploads) ||
    !Array.isArray(files) ||
    !Number.isSafeInteger(now)
  )
    throw new Error('Invalid temporary-upload audit input');
  const paths = new Map();
  for (const upload of uploads) {
    if (typeof upload.cloud_path !== 'string') continue;
    const matches = paths.get(upload.cloud_path) ?? [];
    matches.push(upload);
    paths.set(upload.cloud_path, matches);
  }
  const byId = new Map(files.map((file) => [file._id, file]));
  const counts = {
    temporary_objects: 0,
    unregistered: 0,
    ambiguous_registration: 0,
    registered_expiry_unknown: 0,
    registered_not_expired: 0,
    registered_expired_unfinished: 0,
    registered_expired_without_verified_copy: 0,
    registered_expired_with_immutable_copy: 0,
  };
  const keys = new Set();
  for (const object of objects) {
    if (typeof object.key !== 'string' || !object.key.startsWith('temporary/')) continue;
    if (keys.has(object.key)) throw new Error('Duplicate temporary-object key');
    keys.add(object.key);
    counts.temporary_objects++;
    const matches = paths.get(object.key) ?? [];
    if (!matches.length) {
      counts.unregistered++;
      continue;
    }
    if (matches.length !== 1) {
      counts.ambiguous_registration++;
      continue;
    }
    const upload = matches[0],
      expiry = epoch(upload.expires_at);
    if (expiry === null) {
      counts.registered_expiry_unknown++;
      continue;
    }
    if (expiry > now) {
      counts.registered_not_expired++;
      continue;
    }
    if (!upload.file_id) {
      counts.registered_expired_unfinished++;
      continue;
    }
    const file = byId.get(upload.file_id);
    if (
      file?.storage_mode !== 'immutable_private' ||
      file.check_status !== 'pass' ||
      file.owner_id !== upload.owner_id ||
      typeof upload.source_cloud_file_id !== 'string' ||
      !upload.source_cloud_file_id.endsWith('/' + object.key) ||
      typeof file.cloud_file_id !== 'string' ||
      file.cloud_file_id === upload.source_cloud_file_id
    )
      counts.registered_expired_without_verified_copy++;
    else counts.registered_expired_with_immutable_copy++;
  }
  return counts;
}
