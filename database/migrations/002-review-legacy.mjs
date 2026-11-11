const legacyRoles = new Set([
  'general_user',
  'farmer',
  'teacher_student',
  'school_admin',
  'local_admin',
  'super_admin',
]);
const currentStatuses = new Set([
  'draft',
  'pending_audit',
  'rejected',
  'pending_claim',
  'claiming',
  'processing',
  'pending_review',
  'completed',
  'cancelled',
  'expired',
  'terminated',
]);
export function epoch(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isSafeInteger(time) && time >= 0 ? time : null;
  }
  if (
    value &&
    typeof value === 'object' &&
    Object.keys(value).length === 1 &&
    (typeof value.$date === 'string' || typeof value.$date === 'number')
  )
    return epoch(value.$date);
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}
export function planMigration(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot))
    throw new Error('Snapshot must map collection names to arrays');
  const changes = [];
  const anomalies = [];
  const counts = {};
  for (const [collection, rows] of Object.entries(snapshot)) {
    if (!Array.isArray(rows)) throw new Error(`Invalid collection array: ${collection}`);
    counts[collection] = rows.length;
    for (const row of rows) {
      if (!row || typeof row !== 'object' || typeof row._id !== 'string') {
        anomalies.push({ collection, record_id: null, reason: 'INVALID_RECORD_ID' });
        continue;
      }
      const target = { collection, record_id: row._id };
      if (row.migration_version === 2) continue;
      if (collection === 'users') {
        if (!legacyRoles.has(row.role)) {
          const legacyAccount =
            row.role === undefined &&
            ['nickName', 'permission', 'createdAt'].some((key) => key in row);
          anomalies.push({
            ...target,
            reason: legacyAccount ? 'LEGACY_PERMISSION_REQUIRES_VERIFIED_MAPPING' : 'UNKNOWN_ROLE',
          });
          if (legacyAccount)
            changes.push({
              ...target,
              action: 'review_identity_mapping',
              normalized_role: null,
              grant_creation_allowed: false,
              source_fields: Object.keys(row).sort(),
              timestamps: { created_at: epoch(row.createdAt), updated_at: epoch(row.updatedAt) },
              private_fields: Object.keys(row).filter((key) =>
                ['phone', 'openid', '_openid', 'avatarUrl', 'avatarFileID'].includes(key),
              ),
            });
          continue;
        }
        changes.push({
          ...target,
          action: 'review_identity_mapping',
          normalized_role: row.role === 'school_admin' ? 'teacher_student' : row.role,
          grant_creation_allowed: false,
          private_fields: Object.keys(row).filter((k) =>
            [
              'phone',
              'audit_materials',
              'verify_material',
              'id_card',
              'openid',
              '_openid',
            ].includes(k),
          ),
        });
        if (['local_admin', 'super_admin'].includes(row.role))
          anomalies.push({
            ...target,
            reason: 'MANAGEMENT_AUTHORIZATION_REQUIRES_VERIFIED_MAPPING',
          });
      }
      if (collection === 'demands') {
        const knownAudit = Boolean(row.active_submission_id && row.first_approved_at);
        const knownAcceptance = Boolean(
          row.active_completion_id && row.completed_at && row.owner_id,
        );
        let status = row.status;
        if (['published', 'approved'].includes(status) && !knownAudit) {
          status = 'pending_audit';
          anomalies.push({ ...target, reason: 'MISSING_VERIFIABLE_AUDIT' });
        } else if (status === 'completed' && !knownAcceptance) {
          anomalies.push({ ...target, reason: 'MISSING_ACCEPTANCE_EVIDENCE' });
          status = 'quarantined';
        } else if (!currentStatuses.has(status)) {
          anomalies.push({ ...target, reason: 'UNKNOWN_OR_AMBIGUOUS_STATE' });
          status = 'quarantined';
        }
        const timestamps = {};
        for (const key of ['created_at', 'updated_at', 'expires_at', 'completed_at'])
          if (key in row) {
            timestamps[key] = epoch(row[key]);
            if (timestamps[key] === null)
              anomalies.push({ ...target, reason: `INVALID_DATE:${key}` });
          }
        for (const [source, destination] of [
          ['createdAt', 'created_at'],
          ['updatedAt', 'updated_at'],
        ]) {
          if (!(source in row)) continue;
          const value = epoch(row[source]);
          if (destination in timestamps && timestamps[destination] !== value)
            anomalies.push({ ...target, reason: `CONFLICTING_DATE:${destination}` });
          else timestamps[destination] = value;
          if (value === null) anomalies.push({ ...target, reason: `INVALID_DATE:${source}` });
        }
        if (!row.form && ('content' in row || 'categoryL1' in row))
          anomalies.push({ ...target, reason: 'LEGACY_FORM_REQUIRES_REVIEW' });
        if (!row.region_id && row.business_scene !== 'campus')
          anomalies.push({ ...target, reason: 'MISSING_VERIFIED_REGION' });
        changes.push({
          ...target,
          action: 'review_demand_mapping',
          proposed_status: status,
          proposed_visibility: 'hidden',
          timestamps,
          private_fields: Object.keys(row).filter((k) =>
            ['phone', 'contact', 'exact_address', 'detailAddress', '_openid', 'openid'].includes(k),
          ),
        });
      }
      if (['policy', 'policies'].includes(collection)) {
        const url = row.source_url ?? row.sourceUrl ?? row.url;
        let official = false;
        try {
          const parsed = new URL(url);
          official =
            parsed.protocol === 'https:' &&
            !parsed.username &&
            !parsed.password &&
            /(?:^|\.)(?:gov|edu)\.cn$/u.test(parsed.hostname);
        } catch {
          /* Invalid legacy sources remain quarantined. */
        }
        const isFormal =
          row.status === 'published' &&
          official &&
          typeof row.source_authority === 'string' &&
          row.source_authority.trim() &&
          typeof row.published_by === 'string' &&
          row.published_by.trim() &&
          epoch(row.published_at) !== null;
        if (!isFormal) {
          changes.push({
            ...target,
            action: 'isolate_unverified_policy',
            proposed_status: 'draft',
          });
          anomalies.push({ ...target, reason: 'UNVERIFIED_OR_SIMULATED_POLICY' });
        }
      }
    }
  }
  return {
    migration_version: 2,
    mode: 'dry-run',
    apply_supported: false,
    counts,
    changes,
    anomalies,
    grants_created: 0,
    source_modified: false,
  };
}
