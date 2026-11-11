// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { planMigration, epoch } from '../../database/migrations/002-review-legacy.mjs';
describe('offline migration safety', () => {
  it('never grants historic school or management roles and hides unaudited published demands', () => {
    const source = {
      users: [
        { _id: 'student', role: 'school_admin', phone: '13800138000' },
        { _id: 'manager', role: 'local_admin' },
      ],
      demands: [
        { _id: 'legacy-public', status: 'published', created_at: '2026-10-01T00:00:00+08:00' },
      ],
      policy: [
        { _id: 'mock-policy', title: '模拟政策', sourceUrl: 'http://example.invalid/policy' },
      ],
    };
    const original = JSON.stringify(source);
    const report = planMigration(source);
    expect(report.grants_created).toBe(0);
    expect(report.apply_supported).toBe(false);
    expect(report.changes.find((c) => c.record_id === 'student').normalized_role).toBe(
      'teacher_student',
    );
    expect(report.changes.find((c) => c.record_id === 'legacy-public').proposed_status).toBe(
      'pending_audit',
    );
    expect(report.changes.find((c) => c.record_id === 'legacy-public').proposed_visibility).toBe(
      'hidden',
    );
    expect(
      report.anomalies.some(
        (a) => a.reason === 'MANAGEMENT_AUTHORIZATION_REQUIRES_VERIFIED_MAPPING',
      ),
    ).toBe(true);
    expect(JSON.stringify(source)).toBe(original);
    expect(JSON.stringify(report)).not.toContain('13800138000');
  });
  it('is repeatable and does not guess ambiguous claim/completion facts', () => {
    const source = {
      demands: [
        { _id: 'ambiguous', status: 'claimed' },
        { _id: 'unproven', status: 'completed' },
      ],
    };
    expect(planMigration(source)).toEqual(planMigration(source));
    expect(planMigration(source).changes.every((c) => c.proposed_status === 'quarantined')).toBe(
      true,
    );
    expect(epoch('not-a-date')).toBeNull();
  });
  it('recognizes the real camelCase legacy shape without inferring grants or exposing private fields', () => {
    const report = planMigration({
      users: [
        {
          _id: 'legacy-account',
          nickName: 'legacy-name',
          permission: 999,
          _openid: 'private-identity',
          createdAt: { $date: '2025-10-09T08:00:23.000Z' },
        },
      ],
      demands: [
        {
          _id: 'legacy-demand',
          content: 'private-description',
          detailAddress: 'private-address',
          phone: 'private-phone',
          createdAt: 1700000000000,
        },
      ],
    });
    expect(report.changes.find((row) => row.record_id === 'legacy-account')).toMatchObject({
      normalized_role: null,
      grant_creation_allowed: false,
    });
    expect(report.changes.find((row) => row.record_id === 'legacy-demand')).toMatchObject({
      proposed_status: 'quarantined',
      proposed_visibility: 'hidden',
      timestamps: { created_at: 1700000000000 },
    });
    expect(report.grants_created).toBe(0);
    for (const value of [
      'legacy-name',
      'private-identity',
      'private-address',
      'private-phone',
      'private-description',
    ])
      expect(JSON.stringify(report)).not.toContain(value);
  });
  it('does not accept an arbitrary HTTPS source or missing publication facts as formal policy', () => {
    const report = planMigration({
      policies: [
        {
          _id: 'fake',
          status: 'published',
          source_url: 'https://example.org/policy',
          source_authority: 'claimed',
        },
        {
          _id: 'missing-publisher',
          status: 'published',
          source_url: 'https://www.gov.cn/policy',
          source_authority: 'official',
          published_at: 1700000000000,
        },
      ],
    });
    expect(report.changes).toHaveLength(2);
    expect(report.changes.every((row) => row.proposed_status === 'draft')).toBe(true);
  });
});
