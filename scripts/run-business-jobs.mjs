import { build } from 'esbuild';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import process from 'node:process';
import { assertIndependentTestTarget } from './lib/test-environment-policy.mjs';

const flag = process.argv[2];
if (flag && flag !== '--apply')
  throw new Error('Usage: node scripts/run-business-jobs.mjs [--apply]');
const environment = JSON.parse(
  await readFile('.cache/local-config/cloud-environment.json', 'utf8'),
);
const target = process.env.TEST_CLOUD_ENV_ID ?? environment.env_id;
assertIndependentTestTarget(
  target,
  environment.test_environment_confirmed ? environment.env_id : undefined,
  environment,
);
const require = createRequire(import.meta.url);
const runtimeDir = resolve('.cache/maintenance');
await mkdir(runtimeDir, { recursive: true });
const stageModule = await build({
  entryPoints: ['server/maintenance/business-stages.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
});
await writeFile(resolve(runtimeDir, 'business-stages.cjs'), stageModule.outputFiles[0].contents);
const { selectedBusinessStages, runSelectedBusinessStages } = require(resolve(
  runtimeDir,
  'business-stages.cjs',
));
const stages = selectedBusinessStages(process.env.BUSINESS_JOB_STAGES);
if (flag !== '--apply') {
  console.log(
    JSON.stringify({ mode: 'dry_run', stages, cloud_connection: false, cloud_writes: false }),
  );
  process.exit(0);
}
if (stages.length === 0)
  throw new Error(
    'Set explicit BUSINESS_JOB_STAGES before applying; no cloud connection or writes.',
  );
// Uses the operator's standard SDK credential environment. Never reads IDE
// credential stores or places credentials in command arguments/logs.
const cloud = require('wx-server-sdk');
cloud.init({ env: target });
const modules = [
  ['business-jobs', 'server/maintenance/business-jobs.ts'],
  ['repository', 'server/adapters/cloudbase-repository.ts'],
  ['fenced-repository', 'server/maintenance/fenced-repository.ts'],
  ['export-jobs', 'server/maintenance/export-jobs.ts'],
  ['storage-jobs', 'server/maintenance/storage-jobs.ts'],
  ['retention-jobs', 'server/maintenance/retention-jobs.ts'],
  ['storage-cleanup', 'server/maintenance/storage-cleanup.ts'],
  ['subscription-jobs', 'server/maintenance/subscription-jobs.ts'],
  ['subscription', 'server/adapters/subscription.ts'],
  ['knowledge', 'server/modules/knowledge/service.ts'],
];
for (const [name, entry] of modules) {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
  });
  await writeFile(resolve(runtimeDir, `${name}.cjs`), result.outputFiles[0].contents);
}
const repo = require(resolve(runtimeDir, 'fenced-repository.cjs')).fencedMaintenanceRepository(
  require(resolve(runtimeDir, 'repository.cjs')).cloudbaseRepository(
    cloud.database({ throwOnNotFound: false }),
  ),
);
const migration = await repo.get('system_guards', 'v2_migration');
if (migration?.schema_version !== 2 || migration.status !== 'verified')
  throw new Error(
    'Test database migration/reconciliation is not verified; no job writes performed.',
  );
const runBusinessJobs = require(resolve(runtimeDir, 'business-jobs.cjs')).runBusinessJobs;
const storage = {
  async upload(path, bytes) {
    if (process.env.PRIVATE_STORAGE_READY !== 'true')
      throw new Error('Private storage rules have not been verified');
    const result = await cloud.uploadFile({ cloudPath: path, fileContent: bytes });
    if (!result.fileID) throw new Error('Export upload returned no file ID');
    return result.fileID;
  },
  async remove(fileId) {
    const result = await cloud.deleteFile({ fileList: [fileId] });
    if (!result?.fileList?.every((file) => file.status === 0))
      throw new Error('Export cleanup failed');
  },
};
const storageJobs = require(resolve(runtimeDir, 'storage-jobs.cjs'));
const subscription = require(resolve(runtimeDir, 'subscription.cjs'));
const messageState = stages.includes('subscriptions')
  ? subscription.subscriptionState(process.env.NOTIFICATION_MINIPROGRAM_STATE)
  : undefined;
const apiKnowledge = JSON.parse(await readFile('contracts/generated/knowledge-api.json', 'utf8'));
const now = Date.now();
const result = await runSelectedBusinessStages(stages, {
  knowledge: () =>
    require(resolve(runtimeDir, 'knowledge.cjs')).publishGeneratedKnowledge(
      repo,
      apiKnowledge.body_text,
      apiKnowledge.source_hash,
      now,
    ),
  claims: () => runBusinessJobs(repo, now, 50, ['claims']),
  demands: () => runBusinessJobs(repo, now, 50, ['demands']),
  completions: () => runBusinessJobs(repo, now, 50, ['completions']),
  inbox: () => runBusinessJobs(repo, now, 50, ['outbox']),
  exports: () => require(resolve(runtimeDir, 'export-jobs.cjs')).runExportJobs(repo, storage, now),
  expire_exports: () => storageJobs.expireExportFiles(repo, now),
  retention: () => require(resolve(runtimeDir, 'retention-jobs.cjs')).runRetentionJobs(repo, now),
  file_deletions: () => storageJobs.runFileDeletions(repo, storage, now),
  orphan_copies: () =>
    require(resolve(runtimeDir, 'storage-cleanup.cjs')).runStorageCleanupTasks(repo, storage, now),
  subscriptions: () =>
    require(resolve(runtimeDir, 'subscription-jobs.cjs')).runSubscriptionJobs(
      repo,
      subscription.wechatSubscriptionSender(cloud.openapi?.subscribeMessage, messageState),
      subscription.subscriptionTemplates(process.env.NOTIFICATION_TEMPLATES),
      now,
    ),
});
console.log(JSON.stringify({ stages, result }));
if (result.state === 'failed') process.exitCode = 1;
