import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { verifiedOperatorTarget, operatorJson } from '../lib/cloudbase-operator.mjs';

// Only the already disabled worker is eligible. The probe cannot enable jobs,
// modify code, alter credentials, or touch business records.
const name = 'yzxz_v2_businessJobs';
const apply = process.argv.slice(2).join(' ') === '--apply';
if (process.argv.length > (apply ? 3 : 2)) throw new Error('Use [--apply]');
const env = await verifiedOperatorTarget();
const call = (action, body = {}) =>
  operatorJson([
    'api',
    'scf',
    action,
    '--env-id',
    env,
    '--api-version',
    '2018-04-16',
    '--region',
    'ap-shanghai',
    '--body',
    JSON.stringify({ Namespace: env, FunctionName: name, ...body }),
  ]);
const detail = await operatorJson([
  'fn',
  'detail',
  name,
  '--env-id',
  env,
  '--region',
  'ap-shanghai',
]);
if (
  detail.FunctionName !== name ||
  detail.Namespace !== env ||
  detail.Status !== 'Active' ||
  detail.Environment?.Variables?.some(
    (v) => ['JOBS_ENABLED', 'AI_JOBS_ENABLED'].includes(v.Key) && v.Value === 'true',
  )
)
  throw new Error('Probe requires the active, disabled worker');
const original = (await call('GetReservedConcurrencyConfig')).ReservedMem;
if (!(original === null || (Number.isSafeInteger(original) && original >= 0)))
  throw new Error('Invalid original concurrency value');
const proof = {
  env_id: env,
  function_name: name,
  original_reserved_mem: original,
  workers_enabled: false,
  business_data_writes: false,
  probe_verified: false,
  concurrency_restored: false,
  recorded_at: new Date().toISOString(),
};
await mkdir('.cache/fence-probes', { recursive: true });
const file = resolve('.cache/fence-probes', randomUUID() + '.json');
await writeFile(file, JSON.stringify({ ...proof, mode: apply ? 'apply' : 'dry-run' }, null, 2), {
  flag: 'wx',
});
if (!apply) {
  console.log(
    JSON.stringify({ mode: 'dry-run', env_id: env, function_name: name, proof_file: file }),
  );
} else {
  let changed = false;
  try {
    changed = true; // request outcome may be uncertain; always attempt original-value restoration
    await call('PutReservedConcurrencyConfig', { ReservedConcurrencyMem: 0 });
    if ((await call('GetReservedConcurrencyConfig')).ReservedMem !== 0)
      throw new Error('Zero concurrency did not read back');
    try {
      const result = await call('Invoke', {
        InvocationType: 'RequestResponse',
        ClientContext: '{}',
      });
      // Do not persist Result.RetMsg: it can contain a business payload or log.
      proof.invoke_returned = true;
      proof.invoke_function_error = result.Result?.FunctionError ?? null;
    } catch (error) {
      proof.invoke_error_code = error.operator_code ?? 'UNCLASSIFIED';
      proof.probe_verified = /(?:ResourceLimit|RequestLimit|Concurrency|Throttl)/u.test(
        proof.invoke_error_code,
      );
    }
  } catch (error) {
    proof.operation_error_code = error.operator_code ?? 'PROBE_FAILED';
  } finally {
    if (changed) {
      try {
        if (original === null) await call('DeleteReservedConcurrencyConfig');
        else await call('PutReservedConcurrencyConfig', { ReservedConcurrencyMem: original });
        proof.concurrency_restored =
          (await call('GetReservedConcurrencyConfig')).ReservedMem === original;
      } catch (error) {
        proof.restore_error_code = error.operator_code ?? 'RESTORE_FAILED';
      }
      // A failed update may have left the original value untouched. Verify it
      // independently even when the compensating API also rejects the request.
      if (!proof.concurrency_restored) {
        try {
          proof.concurrency_restored =
            (await call('GetReservedConcurrencyConfig')).ReservedMem === original;
        } catch {
          /* retain the failure and require operator review */
        }
      }
    }
    await writeFile(file, JSON.stringify(proof, null, 2) + '\n');
  }
  console.log(JSON.stringify({ ...proof, proof_file: file }));
  if (!proof.probe_verified || !proof.concurrency_restored) process.exitCode = 1;
}
