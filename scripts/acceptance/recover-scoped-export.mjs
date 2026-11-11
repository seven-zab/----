import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import process from 'node:process';
import { verifiedOperatorTarget, operatorSession } from '../lib/cloudbase-operator.mjs';
if (process.argv.slice(2).join(' ') !== '--apply')
  throw new Error('Explicit --apply required for the scoped recovery');
const proof = JSON.parse(
  await readFile('.cache/scoped-export-probes/a347a052-2a0a-43af-93b9-2ea2e1719592/proof.json'),
);
const mapping = JSON.parse(await readFile('.cache/local-config/bootstrap-admin.mapping.json'));
const migration = JSON.parse(
  await readFile('.cache/migration-recovery/authorized-plan-20261030.json'),
);
const env = await verifiedOperatorTarget();
if (
  env !== proof.env_id ||
  mapping.env_id !== env ||
  proof.jobs.length !== 1 ||
  proof.jobs[0].format !== 'csv'
)
  throw Error('Scope mismatch');
const req = createRequire(import.meta.url),
  paired = createRequire(req.resolve('wx-server-sdk/package.json'));
const db = paired('@cloudbase/node-sdk')
  .init({ env, ...(await operatorSession(env)), timeout: 15000 })
  .database();
const refs = [
  ['system_guards', 'v2_migration'],
  ['export_jobs', proof.jobs[0].job_id],
];
const rows = [];
for (const [c, id] of refs) {
  const r = await db.collection(c).doc(id).get();
  rows.push(r.data[0]);
}
const [guard, job] = rows;
if (
  Object.keys(guard).sort().join() !== '_id,data' ||
  Object.keys(job).sort().join() !== '_id,data' ||
  guard.data.status !== 'verified' ||
  guard.data.schema_version !== 2 ||
  guard.data.plan_id !== migration.plan_id ||
  job.data.owner_id !== mapping.user_id ||
  job.data.status !== 'running' ||
  job.data.format !== 'csv'
)
  throw Error('Observed records differ from reviewed scope');
const digest = (x) => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const ids = rows.map(digest);
const out = '.cache/scoped-export-recovery/' + randomUUID();
await mkdir(out, { recursive: true });
await writeFile(out + '/before.json', JSON.stringify({ env, records: rows }, null, 2), {
  flag: 'wx',
});
await db.runTransaction(async (tx) => {
  for (let i = 0; i < refs.length; i++) {
    const [c, id] = refs[i];
    const response = await tx.collection(c).doc(id).get();
    const current = Array.isArray(response.data) ? response.data[0] : response.data;
    if (digest(current) !== ids[i]) throw Error('Record changed; no recovery');
    await tx.collection(c).doc(id).set(current.data);
  }
});
const checks = [];
for (let i = 0; i < refs.length; i++) {
  const [c, id] = refs[i];
  const after = (await db.collection(c).doc(id).get()).data[0];
  const expected = { _id: id, ...rows[i].data };
  checks.push({
    collection: c,
    unwrapped: digest(after) === digest(expected),
    status: after.status,
  });
}
const result = {
  env,
  checks,
  passed: checks.every((x) => x.unwrapped),
  recorded_at: new Date().toISOString(),
  backup: out + '/before.json',
};
await writeFile(out + '/proof.json', JSON.stringify(result, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ passed: result.passed, checks, proof: out + '/proof.json' }));
if (!result.passed) process.exitCode = 1;
