// @vitest-environment node
import { expect, it } from 'vitest';
import { apiTimeoutPlan, timeoutPayload } from '../../scripts/lib/function-timeouts.mjs';
const config = (name, timeout) => ({
  FunctionName: name,
  Namespace: 'test-env',
  Status: 'Active',
  Timeout: timeout,
  Environment: { Variables: [{ Key: 'PRIVATE_DATA_KEY', Value: 'private-test-value' }] },
  MemorySize: 256,
});
it('only raises short API timeouts and never puts environment values or memory in an update', () => {
  const plan = apiTimeoutPlan(
    'test-env',
    { demandService: 'yzxz_v2_demandService', statsService: 'yzxz_v2_statsService' },
    [config('yzxz_v2_demandService', 3), config('yzxz_v2_statsService', 60)],
  );
  expect(plan.changes).toHaveLength(1);
  expect(timeoutPayload(plan.changes[0])).toEqual({
    FunctionName: 'yzxz_v2_demandService',
    Namespace: 'test-env',
    Timeout: 30,
  });
  expect(JSON.stringify(plan)).not.toContain('private-test-value');
});
it('rejects legacy functions, workers, wrong namespaces and functions still updating', () => {
  expect(() =>
    apiTimeoutPlan('test-env', { demandService: 'demandService' }, [config('demandService', 3)]),
  ).toThrow('versioned');
  expect(() =>
    apiTimeoutPlan('test-env', { businessJobs: 'yzxz_v2_businessJobs' }, [
      config('yzxz_v2_businessJobs', 3),
    ]),
  ).toThrow('API');
  expect(() =>
    apiTimeoutPlan('wrong-env', { demandService: 'yzxz_v2_demandService' }, [
      config('yzxz_v2_demandService', 3),
    ]),
  ).toThrow('target');
  expect(() =>
    apiTimeoutPlan('test-env', { demandService: 'yzxz_v2_demandService' }, [
      { ...config('yzxz_v2_demandService', 3), Status: 'Updating' },
    ]),
  ).toThrow('state');
});
