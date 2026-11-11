import { randomUUID, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import process from 'node:process';
import { build } from 'esbuild';
import { operatorSession, verifiedOperatorTarget } from '../lib/cloudbase-operator.mjs';
import { operatorWxDatabase } from '../lib/operator-wx-database.cjs';
import { namespacedAcceptanceRepository } from '../lib/namespaced-acceptance-repository.mjs';

const mode = process.argv.slice(2).join(' ');
const localSmoke = mode === '--local-smoke';
const competitorCount = mode === '--apply-10-synthetic-claims' ? 10 : 200;
if (!localSmoke && !['--apply-200-synthetic-claims', '--apply-10-synthetic-claims'].includes(mode))
  throw new Error('Use --local-smoke, --apply-10-synthetic-claims or --apply-200-synthetic-claims');
const read = async (file) => JSON.parse(await readFile(file, 'utf8'));
const release = await read('contracts/generated/release.json');
const local = await read('.cache/local-config/cloud-environment.json');
const env = localSmoke ? local.env_id : await verifiedOperatorTarget();
if (!local.test_environment_confirmed || local.env_id !== env)
  throw new Error('Confirmed test environment required');
const run = randomUUID(),
  dir = resolve('.cache/mock-cloud-claims', run);
await mkdir(dir, { recursive: true });
const proof = {
  env_id: env,
  source_hash: release.source_hash,
  namespace: 'acceptance:' + run,
  passed: false,
  real_database_transactions: !localSmoke,
  execution_host: 'local_operator',
  physical_collection: 'job_runs',
  business_unique_indexes_exercised: false,
  source_deployed: local.last_code_deployment?.source_hash === release.source_hash,
  real_wechat_accounts: false,
  content_safety: 'mock',
  model_calls: 0,
  public_business_rows_written: 0,
  physical_deletions: 0,
  checks: [],
};
const save = () => writeFile(join(dir, 'proof.json'), JSON.stringify(proof, null, 2) + '\n');
const check = (name, ok) => {
  proof.checks.push({ check: name, passed: Boolean(ok) });
  if (!ok) throw new Error(name);
};
let stage = 'preflight';
try {
  const bundle = await build({
    stdin: {
      contents:
        'export { MemoryRepository } from "./tests/helpers/memory-repository"; export { createHandler } from "./server/handler"; export { cloudbaseRepository } from "./server/adapters/cloudbase-repository"; export { privateDataCodec } from "./server/core/private-data"; export { userIdentityId } from "./server/core/command"; export { runBusinessJobs } from "./server/maintenance/business-jobs";',
      resolveDir: process.cwd(),
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
  });
  const entry = join(dir, 'probe-runtime.cjs');
  await writeFile(entry, bundle.outputFiles[0].contents, { flag: 'wx' });
  const require = createRequire(import.meta.url);
  const runtime = require(entry);
  const paired = createRequire(require.resolve('wx-server-sdk/package.json'));
  let base;
  if (localSmoke) {
    base = new runtime.MemoryRepository();
    base.seed('system_guards', { _id: 'v2_migration', schema_version: 2, status: 'verified' });
  } else {
    const db = paired('@cloudbase/node-sdk')
      .init({ env, ...(await operatorSession(env)), timeout: 30000 })
      .database({ throwOnNotFound: false });
    base = runtime.cloudbaseRepository(operatorWxDatabase(db));
  }
  const gate = await base.get('system_guards', 'v2_migration');
  const transaction = base.transaction.bind(base);
  proof.transaction_error_codes = {};
  base.transaction = async (work) => {
    try {
      return await transaction(work);
    } catch (error) {
      const raw = error?.code ?? error?.errCode;
      const code =
        typeof raw === 'string' && /^[A-Za-z0-9_.-]{1,80}$/u.test(raw)
          ? raw
          : typeof raw === 'number'
          ? String(raw)
          : 'UNKNOWN';
      proof.transaction_error_codes[code] = (proof.transaction_error_codes[code] ?? 0) + 1;
      throw error;
    }
  };
  check('actual_migration_verified', gate?.status === 'verified');
  const { repo, inventory } = namespacedAcceptanceRepository(
    base,
    proof.namespace,
    Date.now() + 25 * 60000,
  );
  const now = Date.now();
  await repo.put('system_guards', { _id: 'v2_migration', schema_version: 2, status: 'verified' });
  const actors = [
    'owner',
    'admin',
    ...Array.from({ length: competitorCount }, (_, i) => 'candidate-' + i),
  ];
  const seed = async (id) =>
    repo.transaction(async (tx) => {
      await tx.put('users', {
        _id: id,
        _openid: id,
        user_code: id,
        display_name: '模拟账号' + id,
        avatar_file_id: null,
        account_status: 'active',
        auth_version: 1,
        operation_seq: 0,
        grant_ids: ['g-' + id],
        application_ids: [],
        created_at: now,
      });
      await tx.put('wechat_identities', { _id: runtime.userIdentityId(id), user_id: id });
      await tx.put('role_grants', {
        _id: 'g-' + id,
        user_id: id,
        role: id === 'admin' ? 'super_admin' : 'teacher_student',
        scope_type: id === 'admin' ? 'platform' : 'self',
        scope_region_id: null,
        profile_kind: 'student',
        organization_id: 'sztu',
        status: 'active',
        expires_at: null,
        renewed_from: null,
        revoked_at: null,
      });
    });
  stage = 'seed_synthetic_accounts';
  for (let i = 0; i < actors.length; i += 5) {
    const seeded = await Promise.allSettled(actors.slice(i, i + 5).map(seed));
    const failed = seeded.find((r) => r.status === 'rejected');
    if (failed) throw failed.reason;
  }
  const handle = runtime.createHandler(
    repo,
    runtime.privateDataCodec(randomBytes(32).toString('base64')),
    { checkText: async () => 'pass' },
  );
  const call = (service, action, data, actor = 'owner', key = randomUUID()) =>
    handle(
      service,
      {
        api_version: 'v1',
        request_id: randomUUID(),
        action,
        data,
        grant_id: 'g-' + actor,
        idempotency_key: key,
      },
      actor,
      Date.now(),
    );
  stage = 'create_synthetic_task';
  const form = {
    type: 'campus',
    sub_type: 'technical_support',
    schema_version: 1,
    business_scene: 'campus',
    campus_organization_id: 'sztu',
    title: '隔离模拟并发接取',
    content: '验证同一需求只能由一个模拟服务方接取，不公开任何真实业务。',
    location_text: '合成测试教学楼',
    contact: { name: '模拟联系人', phone: '13800138000' },
    service_time: { kind: 'negotiable' },
    budget: { kind: 'negotiable' },
    expires_at: now + 86400000,
  };
  check('content_check', (await call('demandService', 'checkSubmission', form)).code === 0);
  const made = await call('demandService', 'createAndSubmit', form);
  check('synthetic_task_submitted', made.code === 0);
  const id = made.data.demand_id,
    submitted = await repo.get('demands', id);
  check(
    'synthetic_task_reviewed',
    (
      await call(
        'demandService',
        'review',
        {
          demand_id: id,
          expected_version: 1,
          submission_id: submitted.active_submission_id,
          revision: 1,
          decision: 'approve',
        },
        'admin',
      )
    ).code === 0,
  );
  stage = '200_competitors';
  const started = Date.now();
  const results = await Promise.all(
    actors.slice(2).map(async (actor) => ({
      actor,
      result: await call(
        'demandService',
        'claim',
        { demand_id: id, expected_version: 2, assignee_type: 'user' },
        actor,
      ),
    })),
  );
  proof.concurrent_requests = competitorCount;
  proof.elapsed_ms = Date.now() - started;
  proof.responses = Object.fromEntries(
    [...new Set(results.map(({ result }) => result.code))].map((code) => [
      code,
      results.filter(({ result }) => result.code === code).length,
    ]),
  );
  const winners = results.filter(({ result }) => result.code === 0);
  const claims = await repo.find('demand_claims', { demand_id: id }, 201);
  check('exactly_one_claim_committed', winners.length === 1 && claims.length === 1);
  check(
    'all_other_requests_have_business_rejections',
    results.every(({ result }) => [0, 403, 404, 409, 429].includes(result.code)),
  );
  await save();
  stage = 'revocation_race';
  const winner = winners[0],
    claim = claims[0];
  check('owner_confirms_without_auto_start', (await repo.get('demands', id)).status === 'claiming');
  check(
    'owner_confirms_claim',
    (
      await call('demandService', 'confirmClaim', {
        demand_id: id,
        expected_version: 3,
        claim_id: claim._id,
        decision: 'accept',
      })
    ).code === 0,
  );
  const race = await Promise.all([
    call(
      'demandService',
      'addProgress',
      { demand_id: id, expected_version: 4, kind: 'note', text: '模拟撤权竞争中的进度' },
      winner.actor,
    ),
    call(
      'userService',
      'revokeGrant',
      { grant_id: 'g-' + winner.actor, reason: '隔离模拟撤权竞争测试' },
      'admin',
    ),
  ]);
  proof.revocation_race_codes = race.map((r) => r.code);
  if (race[1].code === 409) {
    race[1] = await call(
      'userService',
      'revokeGrant',
      { grant_id: 'g-' + winner.actor, reason: '隔离模拟撤权竞争测试' },
      'admin',
    );
    proof.revocation_retry_code = race[1].code;
  }
  check('revocation_committed', race[1].code === 0);
  const current = await repo.get('demands', id);
  const after = await call(
    'demandService',
    'addProgress',
    { demand_id: id, expected_version: current.version, kind: 'note', text: '撤权后应拒绝的进度' },
    winner.actor,
  );
  check('revoked_actor_cannot_write', after.code === 403 || after.code === 404);
  check(
    'rejected_write_has_no_version_change',
    (await repo.get('demands', id)).version === current.version,
  );
  stage = 'expiry_stage';
  const expired = {
    ...submitted,
    _id: randomUUID(),
    status: 'pending_claim',
    active_claim_id: null,
    visibility: 'public',
    public_listing: true,
    approved_at: now,
    expires_at: now - 1,
    version: 2,
  };
  await repo.put('demands', expired);
  const maintenance = await runtime.runBusinessJobs(repo, Date.now(), 50, ['demands']);
  check(
    'isolated_due_demand_expires',
    maintenance.expired_demands === 1 &&
      (await repo.get('demands', expired._id)).status === 'expired',
  );
  proof.expiry_test_uses_synthetic_due_date = true;
  proof.rows_in_namespace = inventory.size;
  const control = (row) =>
    Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'operation_seq'));
  check(
    'original_migration_control_unchanged',
    JSON.stringify(control(await base.get('system_guards', 'v2_migration'))) ===
      JSON.stringify(control(gate)),
  );
  proof.passed = true;
} catch (error) {
  proof.failed_stage = stage;
  proof.error_category = error.name;
  if (typeof error.code === 'string' && /^[A-Za-z0-9_.-]{1,80}$/u.test(error.code))
    proof.provider_code = error.code;
  if (proof.checks.at(-1)?.passed === false) proof.failed_check = proof.checks.at(-1).check;
} finally {
  proof.recorded_at = new Date().toISOString();
  await save();
  console.log(JSON.stringify({ proof: join(dir, 'proof.json'), ...proof }));
  if (!proof.passed) process.exitCode = 1;
}
