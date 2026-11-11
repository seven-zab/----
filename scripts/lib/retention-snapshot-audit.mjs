import { createHash } from 'node:crypto';

const id = (v) => typeof v === 'string' && v.trim().length > 0;
const safeCounter = (v) => Number.isSafeInteger(v) && v >= 0 && v < Number.MAX_SAFE_INTEGER;
const guardId = (kind, resource) =>
  createHash('sha256')
    .update(JSON.stringify([kind, resource]))
    .digest('hex');

/** Offline cross-check only: results do not authorize cleanup or prove a live state. */
export function auditRetentionSnapshot(snapshot) {
  for (const name of ['files', 'file_bindings', 'data_holds', 'data_hold_guards'])
    if (!Array.isArray(snapshot?.[name])) throw new Error(`Missing collection: ${name}`);
  const result = {
    files: snapshot.files.length,
    bindings: snapshot.file_bindings.length,
    active_holds: 0,
    invalid_files: 0,
    invalid_bindings: 0,
    orphan_active_bindings: 0,
    reference_count_mismatches: 0,
    invalid_holds: 0,
    invalid_guards: 0,
    missing_or_mismatched_guards: 0,
    unaccounted_guard_counts: 0,
  };
  const files = new Map();
  for (const file of snapshot.files) {
    if (!id(file?._id) || files.has(file._id) || !safeCounter(file.ref_count))
      result.invalid_files++;
    if (id(file?._id)) files.set(file._id, file);
  }
  const counts = new Map();
  const bindingIds = new Set();
  for (const binding of snapshot.file_bindings) {
    if (
      !id(binding?._id) ||
      bindingIds.has(binding._id) ||
      !id(binding.file_id) ||
      typeof binding.active !== 'boolean'
    ) {
      result.invalid_bindings++;
      continue;
    }
    bindingIds.add(binding._id);
    if (!binding.active) continue;
    if (!files.has(binding.file_id)) result.orphan_active_bindings++;
    counts.set(binding.file_id, (counts.get(binding.file_id) ?? 0) + 1);
  }
  for (const file of files.values())
    if (safeCounter(file.ref_count) && file.ref_count !== (counts.get(file._id) ?? 0))
      result.reference_count_mismatches++;
  const expected = new Map();
  const holdIds = new Set();
  for (const hold of snapshot.data_holds) {
    if (
      !id(hold?._id) ||
      holdIds.has(hold._id) ||
      !id(hold.resource_type) ||
      !id(hold.resource_id) ||
      !(
        hold.released_at === null ||
        (Number.isSafeInteger(hold.released_at) && hold.released_at > 0)
      )
    ) {
      result.invalid_holds++;
      continue;
    }
    holdIds.add(hold._id);
    if (hold.released_at !== null) continue;
    result.active_holds++;
    const key = guardId(hold.resource_type, hold.resource_id);
    expected.set(key, (expected.get(key) ?? 0) + 1);
  }
  const guards = new Map();
  for (const guard of snapshot.data_hold_guards) {
    if (
      !id(guard?._id) ||
      guards.has(guard._id) ||
      !safeCounter(guard.active_count) ||
      !safeCounter(guard.operation_seq)
    ) {
      result.invalid_guards++;
      continue;
    }
    guards.set(guard._id, guard);
  }
  for (const [key, count] of expected)
    if (guards.get(key)?.active_count !== count) result.missing_or_mismatched_guards++;
  for (const [key, guard] of guards)
    if (!expected.has(key) && guard.active_count !== 0) result.unaccounted_guard_counts++;
  return result;
}
