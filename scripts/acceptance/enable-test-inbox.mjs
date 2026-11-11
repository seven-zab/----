import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import process from 'node:process';
import { operatorSession, verifiedOperatorTarget } from '../lib/cloudbase-operator.mjs';

const mode = process.argv.slice(2).join(' ');
if (!['--inspect', '--apply'].includes(mode)) throw new Error('Use --inspect or --apply');
const read = async (file) => JSON.parse(await readFile(file, 'utf8'));
const env = await verifiedOperatorTarget();
const release = await read('contracts/generated/release.json');
const local = await read('.cache/local-config/cloud-environment.json');
const mapping = await read('.cache/local-config/bootstrap-admin.mapping.json');
if (local.last_code_deployment?.source_hash !== release.source_hash || mapping.env_id !== env)
  throw new Error('Current test deployment and own account required');
const require = createRequire(import.meta.url);
const paired = createRequire(require.resolve('wx-server-sdk/package.json'));
const api = createRequire(resolve('.cache/operator-api-tools/package.json'));
const session = await operatorSession(env);
const db = paired('@cloudbase/node-sdk')
  .init({ env, ...session, timeout: 15000 })
  .database({ throwOnNotFound: false });
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
const target = { Namespace: env, FunctionName: release.workers.businessJobs };
const variables = (fn) =>
  new Map((fn.Environment?.Variables ?? []).map(({ Key, Value }) => [Key, Value]));
const same = (a, b) => a.size === b.size && [...a].every(([key, value]) => b.get(key) === value);
const get = async (collection, id) => {
  const { data } = await db.collection(collection).doc(id).get();
  return Array.isArray(data) ? data[0] : data;
};
const [before, pending, owner, guard] = await Promise.all([
  client.GetFunction(target),
  db.collection('outbox_events').where({ status: 'pending' }).limit(51).get(),
  get('users', mapping.user_id),
  get('system_guards', 'v2_migration'),
]);
const prior = variables(before);
if (
  before.Status !== 'Active' ||
  before.Namespace !== env ||
  before.FunctionName !== target.FunctionName ||
  before.Timeout < 60 ||
  prior.get('JOBS_ENABLED') !== 'true' ||
  prior.get('BUSINESS_JOB_STAGES') !== 'exports' ||
  prior.has('BUSINESS_JOB_ACCEPTANCE_SCOPE') ||
  before.Triggers?.length !== 1 ||
  before.Triggers[0].TriggerName !== 'yzxz-test-exports' ||
  owner?.account_status !== 'active' ||
  guard?.status !== 'verified' ||
  pending.data.length > 50
)
  throw new Error('Expected reviewed test export worker and bounded queue');
const relevant = pending.data.filter((row) => row.type !== 'file.delete');
if (
  relevant.some(
    (row) =>
      row.recipient_ids !== undefined &&
      (!Array.isArray(row.recipient_ids) || row.recipient_ids.some((id) => id !== mapping.user_id)),
  ) ||
  relevant.some(
    (row) => !Number.isFinite(Number(row.next_retry_at)) || Number(row.next_retry_at) > Date.now(),
  )
)
  throw new Error(
    'Pending notifications are not exclusively the verified own account or are not due',
  );
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const expected = relevant
  .filter((row) => row.recipient_ids?.includes(mapping.user_id))
  .map((row) => ({
    event_id: row._id,
    notification_id: hash(['notification', row._id, mapping.user_id]),
  }));
const proof = {
  env_id: env,
  source_hash: release.source_hash,
  passed: false,
  pending_events: relevant.length,
  notifications_for_verified_own_account: expected.length,
  external_messages_sent: 0,
  physical_deletions: 0,
  stages: ['exports', 'inbox'],
  recorded_at: new Date().toISOString(),
};
if (mode === '--inspect') {
  console.log(JSON.stringify({ ...proof, read_only: true }));
  process.exit(0);
}
proof.nonempty_delivery_in_this_run = expected.length > 0;
const dir = resolve('.cache/inbox-enablement', randomUUID());
await mkdir(dir, { recursive: true });
await writeFile(
  join(dir, 'pending-own-events-before.json'),
  JSON.stringify(relevant, null, 2) + '\n',
  { flag: 'wx' },
);
const save = () => writeFile(join(dir, 'proof.json'), JSON.stringify(proof, null, 2) + '\n');
const configure = async (values) => {
  await client.UpdateFunctionConfiguration({
    ...target,
    Environment: { Variables: [...values].map(([Key, Value]) => ({ Key, Value })) },
  });
  const end = Date.now() + 90000;
  while (Date.now() < end) {
    const fn = await client.GetFunction(target);
    if (fn.Status === 'Active' && same(variables(fn), values)) return;
    await pause(2000);
  }
  throw new Error('Configuration did not converge');
};
const selected = new Map(prior);
selected.set('BUSINESS_JOB_STAGES', 'exports,inbox');
let attempted = false;
try {
  attempted = true;
  await configure(selected);
  const deadline = Date.now() + 120000;
  let rows = [];
  while (Date.now() < deadline) {
    rows = await Promise.all(relevant.map((row) => get('outbox_events', row._id)));
    if (rows.every((row) => row?.status === 'processed')) break;
    await pause(5000);
  }
  if (!rows.every((row) => row?.status === 'processed'))
    throw new Error('Pending own events not processed');
  for (const item of expected) {
    const [notification, receipt] = await Promise.all([
      get('notifications', item.notification_id),
      get('event_receipts', item.notification_id),
    ]);
    if (
      notification?.user_id !== mapping.user_id ||
      receipt?.event_id !== item.event_id ||
      receipt.consumer !== 'in_app_notification'
    )
      throw new Error('Own delivery readback mismatch');
  }
  proof.processed_events = rows.length;
  proof.verified_delivery_receipts = expected.length;
  proof.passed = true;
} catch {
  proof.failed = true;
  if (attempted) {
    try {
      await configure(prior);
      proof.rollback_verified = true;
    } catch {
      proof.rollback_verified = false;
    }
  }
  process.exitCode = 1;
} finally {
  await save();
  console.log(JSON.stringify({ proof: join(dir, 'proof.json'), ...proof }));
}
