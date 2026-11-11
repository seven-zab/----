// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { assertIndependentTestTarget } from '../../scripts/lib/test-environment-policy.mjs';

describe('independent test environment guard', () => {
  it('blocks a preserved environment even if TEST_CLOUD_ENV_ID is mistakenly set to it', () => {
    expect(() =>
      assertIndependentTestTarget('existing-cloud', 'existing-cloud', {
        env_id: 'existing-cloud',
        environment_usage: 'existing_data',
        preserve_data: true,
        allow_test_writes: false,
      }),
    ).toThrow('must be preserved');
  });

  it('requires explicit designation and permits a different isolated target', () => {
    expect(() => assertIndependentTestTarget('test-cloud', undefined, null)).toThrow();
    expect(() => assertIndependentTestTarget('existing-cloud', 'test-cloud', null)).toThrow();
    expect(() =>
      assertIndependentTestTarget('test-cloud', 'test-cloud', {
        env_id: 'existing-cloud',
        preserve_data: true,
      }),
    ).not.toThrow();
  });

  it('fails closed on a malformed local protection record', () => {
    expect(() => assertIndependentTestTarget('test-cloud', 'test-cloud', [])).toThrow();
    expect(() => assertIndependentTestTarget('test-cloud', 'test-cloud', {})).toThrow();
  });

  it('allows an explicitly confirmed test environment while retaining its existing data', () => {
    expect(() =>
      assertIndependentTestTarget('existing-cloud', 'existing-cloud', {
        env_id: 'existing-cloud',
        environment_usage: 'test_with_existing_data',
        test_environment_confirmed: true,
        preserve_data: true,
        allow_test_writes: true,
      }),
    ).not.toThrow();
  });

  it('still honors an explicit write prohibition on a confirmed test environment', () => {
    expect(() =>
      assertIndependentTestTarget('existing-cloud', 'existing-cloud', {
        env_id: 'existing-cloud',
        test_environment_confirmed: true,
        preserve_data: true,
        allow_test_writes: false,
      }),
    ).toThrow();
  });
});
