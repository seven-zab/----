import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import process from 'node:process';
import { operatorSession, verifiedOperatorTarget } from '../lib/cloudbase-operator.mjs';

const [file, ...extra] = process.argv.slice(2);
if (!file || extra.length) throw new Error('Use <inbox-enablement-proof.json>');
const read = async (path) => JSON.parse(await readFile(path, 'utf8'));
const env = await verifiedOperatorTarget();
const old = await read(file);
const events = await read(join(dirname(resolve(file)), 'pending-own-events-before.json'));
const release = await read('contracts/generated/release.json');
if (
  old.env_id !== env ||
  old.source_hash !== release.source_hash ||
  old.notifications_for_verified_own_account !== 0 ||
  old.pending_events !== events.length ||
  events.length > 50 ||
  events.some((row) => row.recipient_ids?.length || row.type === 'file.delete')
)
  throw new Error('Expected reviewed no-recipient event scope');
const require = createRequire(import.meta.url);
const api = createRequire(resolve('.cache/operator-api-tools/package.json'));
const paired = createRequire(require.resolve('wx-server-sdk/package.json'));
const session = await operatorSession(env);
const { Client } = api('tencentcloud-sdk-nodejs-scf').scf.v20180416;
const client = new Client({
  credential: {
    secretId: session.secretId,
    secretKey: session.secretKey,
    token: session.sessionToken,
  },
  region: 'ap-shanghai',
  profile: { httpProfile: { endpoint: 'scf.tencentcloudapi.com', reqTimeout: 30 } },
});
const db = paired('@cloudbase/node-sdk')
  .init({ env, ...session, timeout: 15000 })
  .database({ throwOnNotFound: false });
const proof = {
  env_id: env,
  source_hash: release.source_hash,
  passed: false,
  read_only: true,
  recovered_from: resolve(file),
  external_messages_sent: 0,
  nonempty_delivery_in_this_run: false,
};
const end = Date.now() + 240000;
while (Date.now() < end) {
  const fn = await client.GetFunction({
    Namespace: env,
    FunctionName: release.workers.businessJobs,
  });
  const vars = new Map((fn.Environment?.Variables ?? []).map(({ Key, Value }) => [Key, Value]));
  if (fn.Status === 'Active') {
    if (
      vars.get('BUSINESS_JOB_STAGES') !== 'exports,inbox' ||
      vars.get('JOBS_ENABLED') !== 'true' ||
      vars.has('BUSINESS_JOB_ACCEPTANCE_SCOPE') ||
      fn.Triggers?.length !== 1 ||
      fn.Triggers[0].TriggerName !== 'yzxz-test-exports'
    )
      throw new Error('Unexpected active worker configuration');
    const rows = await Promise.all(
      events.map(async ({ _id }) => {
        const { data } = await db.collection('outbox_events').doc(_id).get();
        return Array.isArray(data) ? data[0] : data;
      }),
    );
    proof.worker_active = true;
    proof.processed_events = rows.filter((row) => row?.status === 'processed').length;
    if (proof.processed_events === events.length) {
      proof.passed = true;
      break;
    }
  }
  await pause(5000);
}
proof.recorded_at = new Date().toISOString();
const output = join(dirname(resolve(file)), 'recheck-proof.json');
await writeFile(output, JSON.stringify(proof, null, 2) + '\n');
console.log(JSON.stringify({ proof: output, ...proof }));
if (!proof.passed) process.exitCode = 1;
