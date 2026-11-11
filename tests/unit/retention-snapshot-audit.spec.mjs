import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { auditRetentionSnapshot } from '../../scripts/lib/retention-snapshot-audit.mjs';

const guard = (kind, id) =>
  createHash('sha256')
    .update(JSON.stringify([kind, id]))
    .digest('hex');
describe('offline retention integrity audit', () => {
  it('reports consistent active and released holds without private contents', () => {
    const result = auditRetentionSnapshot({
      files: [{ _id: 'f', ref_count: 1 }],
      file_bindings: [{ _id: 'b', file_id: 'f', active: true }],
      data_holds: [
        { _id: 'h', resource_type: 'file', resource_id: 'f', released_at: null },
        { _id: 'old', resource_type: 'file', resource_id: 'f', released_at: 123 },
      ],
      data_hold_guards: [{ _id: guard('file', 'f'), active_count: 1, operation_seq: 4 }],
    });
    expect(result.active_holds).toBe(1);
    expect(result.reference_count_mismatches).toBe(0);
    expect(result.missing_or_mismatched_guards).toBe(0);
    expect(JSON.stringify(result)).not.toContain('resource_id');
  });
  it('flags missing guards, dangling bindings, counter errors and missing collections', () => {
    const result = auditRetentionSnapshot({
      files: [{ _id: 'f', ref_count: 1 }],
      file_bindings: [{ _id: 'b', file_id: 'missing', active: true }],
      data_holds: [{ _id: 'h', resource_type: 'file', resource_id: 'f', released_at: null }],
      data_hold_guards: [{ _id: 'invalid', active_count: -1, operation_seq: 0 }],
    });
    expect(result.orphan_active_bindings).toBe(1);
    expect(result.reference_count_mismatches).toBe(1);
    expect(result.missing_or_mismatched_guards).toBe(1);
    expect(result.invalid_guards).toBe(1);
    expect(() => auditRetentionSnapshot({})).toThrow('Missing collection');
  });
});
