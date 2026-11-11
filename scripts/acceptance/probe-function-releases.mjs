import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { verifiedOperatorTarget, operatorJson } from '../lib/cloudbase-operator.mjs';

if (process.argv.slice(2).join(' ') !== '--capture-readonly')
  throw new Error('Read-only flag required');
const env = await verifiedOperatorTarget();
const release = JSON.parse(await readFile('contracts/generated/release.json', 'utf8'));
const entries = Object.entries(release.targets);
if (entries.length !== 12) throw new Error('Unexpected API target count');
const checks = [];
for (let index = 0; index < entries.length; index += 4) {
  const batch = await Promise.all(
    entries.slice(index, index + 4).map(async ([service, name]) => {
      const requestId = randomUUID();
      try {
        const result = await operatorJson([
          'fn',
          'invoke',
          name,
          '--env-id',
          env,
          '--region',
          'ap-shanghai',
          '--params',
          JSON.stringify({
            api_version: 'v1',
            action: 'getRelease',
            request_id: requestId,
            data: {},
          }),
        ]);
        const body = JSON.parse(result.RetMsg);
        return {
          service,
          passed:
            result.InvokeResult === 0 &&
            body.code === 0 &&
            body.request_id === requestId &&
            body.data?.api_version === 'v1' &&
            body.data?.service === service &&
            body.data?.source_hash === release.source_hash,
        };
      } catch (error) {
        return { service, passed: false, operator_code: error?.operator_code ?? null };
      }
    }),
  );
  checks.push(...batch);
}
const proof = {
  env_id: env,
  source_hash: release.source_hash,
  recorded_at: new Date().toISOString(),
  read_only: true,
  real_wechat_session: false,
  real_device: false,
  passed: checks.length === entries.length && checks.every((check) => check.passed),
  checks,
};
await mkdir('.cache/function-release-probes', { recursive: true });
const file = `.cache/function-release-probes/${randomUUID()}.json`;
await writeFile(file, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ proof: file, passed: proof.passed, checked: checks.length }));
if (!proof.passed) process.exitCode = 1;
