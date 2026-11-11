import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import process from 'node:process';
import { build } from 'esbuild';
import { operatorSession, verifiedOperatorTarget } from '../lib/cloudbase-operator.mjs';
import { operatorWxDatabase } from '../lib/operator-wx-database.cjs';

if (process.argv.slice(2).join(' ') !== '--apply-own-synthetic-stubs')
  throw new Error('Use --apply-own-synthetic-stubs');
const env = await verifiedOperatorTarget();
const scopeIds = [
  'cb6f115e-0fef-4fef-b564-f14c31b27fe3',
  'e6d34f38-10e6-4ba6-84ef-e8e2e685a187',
  '249b1d65-286a-443a-bf29-cbd06d26451a',
  '072a0df0-a4cf-40c8-8c22-2250ec89f6d8',
];
for (const id of scopeIds) {
  const proof = JSON.parse(await readFile(`.cache/mock-cloud-claims/${id}/proof.json`, 'utf8'));
  if (
    proof.env_id !== env ||
    proof.namespace !== 'acceptance:' + id ||
    proof.passed ||
    !proof.real_database_transactions ||
    proof.real_wechat_accounts
  )
    throw new Error('Unexpected synthetic scope');
}
const dir = resolve('.cache/synthetic-stub-repairs', randomUUID());
await mkdir(dir, { recursive: true });
const bundle = await build({
  stdin: {
    contents: 'export { cloudbaseRepository } from "./server/adapters/cloudbase-repository";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
});
const entry = join(dir, 'runtime.cjs');
await writeFile(entry, bundle.outputFiles[0].contents);
const require = createRequire(import.meta.url);
const paired = createRequire(require.resolve('wx-server-sdk/package.json'));
const db = paired('@cloudbase/node-sdk')
  .init({ env, ...(await operatorSession(env)), timeout: 15000 })
  .database({ throwOnNotFound: false });
const base = require(entry).cloudbaseRepository(operatorWxDatabase(db));
const originals = [];
for (const scopeId of scopeIds) {
  const scope = 'acceptance:' + scopeId;
  const rows = await base.find('demands', { acceptance_namespace: scope }, 5);
  if (rows.length > 1) throw new Error('Unexpected synthetic demand count');
  for (const row of rows) {
    const payload = row.payload;
    if (
      !payload?._id ||
      !payload.form ||
      !payload.form.title.includes('隔离模拟') ||
      !['owner'].includes(payload.owner_id)
    )
      throw new Error('Not an own synthetic payload');
    const physical = createHash('sha256')
      .update(JSON.stringify([scope, 'demands', payload._id]))
      .digest('hex');
    if (physical !== row._id) throw new Error('Synthetic ID mismatch');
    originals.push(row);
  }
}
await writeFile(
  join(dir, 'synthetic-only-before.json'),
  JSON.stringify(originals, null, 2) + '\n',
  { flag: 'wx' },
);
let repaired = 0;
for (const row of originals) {
  await base.transaction(async (tx) => {
    const current = await tx.get('demands', row._id);
    if (JSON.stringify(current) !== JSON.stringify(row)) throw new Error('Synthetic stub changed');
    await tx.put('demands', {
      ...row,
      owner_id: row.acceptance_namespace + ':owner',
      created_by: row.acceptance_namespace + ':owner',
      owner_grant_id: row.acceptance_namespace + ':grant',
      form: row.payload.form,
      business_scene: 'campus',
      campus_organization_id: 'sztu',
      type: 'campus',
      sub_type: 'technical_support',
      status: 'draft',
      visibility: 'hidden',
      public_listing: false,
      version: 1,
      submission_revision: 0,
      active_submission_id: null,
      active_claim_id: null,
      active_completion_id: null,
      first_submitted_at: null,
      first_approved_at: null,
      approved_at: null,
      confirmed_at: null,
      completed_at: null,
      ended_at: null,
      created_at: Date.now(),
      updated_at: Date.now(),
      expires_at: null,
      parent_demand_id: null,
    });
  });
  const after = await base.get('demands', row._id);
  if (
    after?.status !== 'draft' ||
    after.public_listing !== false ||
    after.first_submitted_at !== null ||
    after.acceptance_namespace !== row.acceptance_namespace ||
    JSON.stringify(after.payload) !== JSON.stringify(row.payload)
  )
    throw new Error('Synthetic repair readback failed');
  repaired++;
}
const proof = {
  env_id: env,
  repaired_synthetic_stubs: repaired,
  originals_backed_up: true,
  original_payloads_preserved: true,
  existing_business_rows_changed: 0,
  physical_deletions: 0,
  recorded_at: new Date().toISOString(),
};
await writeFile(join(dir, 'proof.json'), JSON.stringify(proof, null, 2) + '\n');
console.log(JSON.stringify({ proof: join(dir, 'proof.json'), ...proof }));
