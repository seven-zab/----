// @vitest-environment node
import { expect, it } from 'vitest';
import vm from 'node:vm';
import {
  retiredSource,
  assertFunctionScope,
  legacyFunctionNames,
  assertRetirementInvocation,
} from '../../scripts/lib/migration-writers.mjs';

it('retired legacy entry cannot call any database, SDK or caller-supplied privileged action', async () => {
  const sandbox = {
    exports: {},
    require() {
      throw new Error('SDK must never load');
    },
  };
  vm.runInNewContext(retiredSource('a'.repeat(64)), sandbox);
  for (const action of ['initAdmin', 'initDatabase', 'create', 'sendMessage', 'setRole']) {
    const result = await sandbox.exports.main({
      action,
      role: 'super_admin',
      data: { status: 'verified' },
    });
    expect(result.error_code).toBe('ACTION_RETIRED');
    expect(result.retirement_id).toBe('a'.repeat(64));
    expect(result.data).toBeNull();
  }
});
it('refuses missing or unknown writers instead of assuming the known functions are the whole environment', () => {
  const release = { targets: { userService: 'yzxz_v2_userService' }, workers: {} };
  const rows = [...legacyFunctionNames, 'yzxz_v2_userService'].map((FunctionName) => ({
    FunctionName,
  }));
  expect(() => assertFunctionScope(rows, release)).not.toThrow();
  expect(() => assertFunctionScope([...rows, { FunctionName: 'unknownWriter' }], release)).toThrow(
    'Unreviewed',
  );
  expect(() => assertFunctionScope(rows.slice(1), release)).toThrow('missing');
});
it('accepts both official invocation response shapes and rejects errors or the wrong retirement marker', () => {
  const RetMsg = JSON.stringify({ retirement_id: 'plan', error_code: 'ACTION_RETIRED' });
  expect(() =>
    assertRetirementInvocation({ Result: { RetMsg, RetCode: 0 } }, 'plan'),
  ).not.toThrow();
  expect(() =>
    assertRetirementInvocation({ Result: { RetMsg, InvokeResult: 0, ErrMsg: '' } }, 'plan'),
  ).not.toThrow();
  expect(() =>
    assertRetirementInvocation({ Result: { RetMsg, ErrMsg: 'failure' } }, 'plan'),
  ).toThrow('failed');
  expect(() => assertRetirementInvocation({ Result: { RetMsg } }, 'other')).toThrow('match');
});
