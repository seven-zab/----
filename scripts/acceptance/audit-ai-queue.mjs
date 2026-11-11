import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { operatorSession, verifiedOperatorTarget } from '../lib/cloudbase-operator.mjs';

if (process.argv.slice(2).join(' ') !== '--capture-readonly')
  throw new Error('Use --capture-readonly');
const env = await verifiedOperatorTarget();
const mapping = JSON.parse(
  await readFile('.cache/local-config/bootstrap-admin.mapping.json', 'utf8'),
);
if (mapping.env_id !== env) throw new Error('Verified own account required');
const require = createRequire(import.meta.url);
const paired = createRequire(require.resolve('wx-server-sdk/package.json'));
const app = paired('@cloudbase/node-sdk').init({
  env,
  ...(await operatorSession(env)),
  timeout: 15000,
});
const db = app.database({ throwOnNotFound: false });
const { data } = await db
  .collection('ai_jobs')
  .where({ owner_id: mapping.user_id })
  .orderBy('created_at', 'desc')
  .limit(5)
  .get();
const code = (value) => (typeof value === 'string' && /^[A-Z_]{1,60}$/u.test(value) ? value : null);
const jobs = [];
for (const row of data) {
  const calls = await db.collection('ai_model_calls').where({ job_id: row._id }).limit(10).get();
  jobs.push({
    job_id: row._id,
    status: ['queued', 'running', 'succeeded', 'partial_success', 'failed'].includes(row.status)
      ? row.status
      : 'unknown',
    error_code: code(row.error_code),
    has_write_intent: Boolean(row.intent_id),
    model_attempts: calls.data.reduce(
      (n, c) => n + (Number.isSafeInteger(c.attempts) ? c.attempts : 0),
      0,
    ),
    completed_model_stages: calls.data.filter((c) => c.result_ciphertext).length,
  });
}
console.log(JSON.stringify({ env_id: env, read_only: true, messages_read: false, jobs }));
