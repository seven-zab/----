// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { describe, it, expect } from 'vitest';
import validators from '../../contracts/generated/validators.mjs';
import Ajv from 'ajv';
import runtime from '../../contracts/generated/runtime.json';

function fixture(schema) {
  if ('const' in schema) return schema.const;
  if (schema.enum) return schema.enum[0];
  if (schema.oneOf || schema.anyOf) return fixture((schema.oneOf || schema.anyOf)[0]);
  if (schema.type === 'object')
    return Object.fromEntries(
      (schema.required || []).map((name) => [name, fixture(schema.properties[name])]),
    );
  if (schema.type === 'array')
    return Array.from({ length: schema.minItems || 0 }, () => fixture(schema.items));
  if (schema.type === 'boolean') return true;
  if (schema.type === 'null') return null;
  if (schema.type === 'integer' || schema.type === 'number')
    return (
      schema.minimum ?? (schema.exclusiveMinimum === undefined ? 0 : schema.exclusiveMinimum + 1)
    );
  if (schema.type === 'string') {
    if (schema.pattern?.includes('1[3-9]')) return '13800138000';
    if (schema.pattern?.includes('[a-f0-9]{64}')) return 'a'.repeat(64);
    return 'a'.repeat(Math.max(schema.minLength || 0, 1));
  }
  throw new Error('Add a valid fixture for this schema kind');
}
describe('mini program precompiled contracts', () => {
  it('preserves AJV validation for every registered request and response after sharing schemas', () => {
    const ajv = new Ajv({ strict: true, allErrors: true });
    for (const [route, contract] of Object.entries(runtime)) {
      for (const kind of ['request', 'response']) {
        const original = ajv.compile(contract[kind]);
        const compiled = validators[`${route.replace('.', '_')}_${kind}`];
        const sample = fixture(contract[kind]);
        expect(original(sample), `${route}.${kind}: fixture`).toBe(true);
        const variants = [
          sample,
          null,
          [],
          0,
          'unknown',
          typeof sample === 'object' && sample !== null && !Array.isArray(sample)
            ? { ...sample, unknown_field: 'must reject' }
            : { unknown_field: true },
        ];
        for (const value of variants)
          expect(compiled(value), `${route}.${kind}`).toBe(original(value));
      }
    }
  });
  it('validates strict payloads without runtime code compilation', async () => {
    const source = await readFile('contracts/generated/validators.mjs', 'utf8');
    expect(source).not.toMatch(/new\s+Function\s*\(|\beval\s*\(/);
    expect(validators.userService_updateProfile_request({ display_name: '测试用户' })).toBe(true);
    expect(
      validators.userService_updateProfile_request({ _id: 'other', role: 'super_admin' }),
    ).toBe(false);
    expect(
      validators.demandService_claim_request({
        demand_id: 'task',
        expected_version: 1,
        assignee_type: 'team',
        team_id: 'team',
        participant_user_ids: ['member'],
      }),
    ).toBe(true);
    expect(
      validators.demandService_claim_request({
        demand_id: 'task',
        expected_version: 1,
        assignee_type: 'user',
        assignee_id: 'other',
      }),
    ).toBe(false);
  });
});
