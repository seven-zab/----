import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import dotenv from 'dotenv';
import process from 'node:process';
import { assertIndependentTestTarget } from './lib/test-environment-policy.mjs';
import { downloadFunctionBackup } from './lib/download-function-backup.mjs';
import {
  assertDependencyLock,
  assertSdkSerializationParity,
  dependencyArtifactHash,
} from './lib/dependency-lock.mjs';
dotenv.config({ path: '.env.test', quiet: true });
const require = createRequire(import.meta.url);
const { runWechatCli } = require('./lib/wechat-cli.cjs');
let selectedService;
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index++) {
  if (args[index] === '--apply') continue;
  if (args[index] === '--service' && args[index + 1] && !selectedService)
    selectedService = args[++index];
  else
    throw new Error('Usage: node scripts/deploy-test.mjs [--service <logical-service>] [--apply]');
}
const config = JSON.parse(await readFile('.cache/local-config/cloud-environment.json', 'utf8'));
assertIndependentTestTarget(
  process.env.VITE_CLOUD_ENV_ID,
  config.test_environment_confirmed ? config.env_id : undefined,
  config,
);
const project = JSON.parse(await readFile('project.config.json', 'utf8'));
if (config.app_id !== project.appid) throw new Error('Test AppID mismatch');
const release = JSON.parse(await readFile('contracts/generated/release.json', 'utf8'));
const allTargets = { ...release.targets, ...release.workers };
const deployment = JSON.parse(await readFile('dist/cloudfunctions/deployment.json', 'utf8'));
if (selectedService && !Object.hasOwn(allTargets, selectedService))
  throw new Error('Unknown service selection');
if (
  deployment.source_hash !== release.source_hash ||
  deployment.functions.length !== Object.keys(allTargets).length
)
  throw new Error('Build the current cloud artifacts before deployment');
const paths = [];
const rootPackage = JSON.parse(await readFile('package.json', 'utf8'));
const rootLock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const services = new Set();
for (const artifact of deployment.functions) {
  if (
    !/^yzxz_v2_[A-Za-z]+$/.test(artifact.name) ||
    allTargets[artifact.service] !== artifact.name ||
    services.has(artifact.service)
  )
    throw new Error('Unexpected or duplicate deployment artifact');
  services.add(artifact.service);
  const directory = resolve('dist/cloudfunctions', artifact.name);
  if (
    createHash('sha256')
      .update(await readFile(join(directory, 'index.js')))
      .digest('hex') !== artifact.sha256
  )
    throw new Error(`Modified artifact: ${artifact.name}`);
  const manifestBytes = await readFile(join(directory, 'package.json'));
  const lockBytes = await readFile(join(directory, 'package-lock.json'));
  if (dependencyArtifactHash(manifestBytes, lockBytes) !== artifact.dependency_sha256)
    throw new Error(`Modified dependency artifact: ${artifact.name}`);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (
    JSON.stringify(manifest.dependencies) !==
      JSON.stringify({ 'wx-server-sdk': rootPackage.dependencies['wx-server-sdk'] }) ||
    JSON.stringify(manifest.overrides ?? {}) !== JSON.stringify(rootPackage.overrides ?? {})
  )
    throw new Error(`Unexpected dependency policy: ${artifact.name}`);
  assertDependencyLock(manifest, JSON.parse(lockBytes.toString('utf8')), artifact.name);
  assertSdkSerializationParity(rootLock, JSON.parse(lockBytes.toString('utf8')), artifact.name);
  if (!selectedService || selectedService === artifact.service) paths.push(directory);
}
if (!process.argv.includes('--apply')) {
  console.log(`Dry run: ${paths.length} versioned test functions verified; no cloud changes.`);
  process.exit(0);
}
const cli = process.env.WECHAT_CLI_PATH;
if (!cli) throw new Error('WECHAT_CLI_PATH is required');
const options = ['--env', config.env_id, '--appid', project.appid];
const listing = await runWechatCli(cli, ['cloud', 'functions', 'list', ...options]);
const existing = new Set(
  [...listing.stdout.matchAll(/^\s*\*\s+(\S+)\s*$/gm)].map((match) => match[1]),
);
const backup = resolve('.cache/deploy-backups', randomUUID());
await mkdir(backup, { recursive: true });
const backups = [];
for (const artifact of deployment.functions) {
  if (selectedService && selectedService !== artifact.service) continue;
  if (!existing.has(artifact.name)) continue;
  // The CLI may report success without downloading when the destination already exists.
  // Pass a new leaf directory and verify the downloaded entry before changing any code.
  const { directory, entry } = await downloadFunctionBackup(backup, artifact.name, (path) =>
    runWechatCli(cli, [
      'cloud',
      'functions',
      'download',
      '--name',
      artifact.name,
      '--path',
      path,
      ...options,
    ]),
  );
  backups.push({
    name: artifact.name,
    directory,
    sha256: createHash('sha256').update(entry).digest('hex'),
  });
  console.log(`Verified cloud backup: ${artifact.name}`);
}
await writeFile(
  join(backup, 'backup-manifest.json'),
  JSON.stringify({ recorded_at: new Date().toISOString(), functions: backups }, null, 2),
);
for (let attempt = 0; ; attempt++) {
  try {
    await runWechatCli(
      cli,
      ['cloud', 'functions', 'deploy', '--paths', ...paths, ...options, '--remote-npm-install'],
      300000,
    );
    break;
  } catch (error) {
    await writeFile(
      join(backup, 'deployment-attempt.json'),
      JSON.stringify(
        {
          source_hash: release.source_hash,
          status: 'failed_or_partial',
          attempt: attempt + 1,
          recorded_at: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
    if (attempt >= 2 || !/当前函数处于(?:Creating|Updating)状态/u.test(error.cliOutput ?? ''))
      throw error;
    console.log(
      'Cloud function lifecycle is still transitioning; retrying the same verified artifacts.',
    );
    await new Promise((resolve) => setTimeout(resolve, 10000));
  }
}
await writeFile(join(backup, 'deployment.json'), JSON.stringify(deployment, null, 2));
await writeFile(
  '.cache/local-config/cloud-environment.json',
  JSON.stringify(
    {
      ...config,
      cloud_changes_applied: true,
      cloud_code_deployed: true,
      cloud_business_data_modified: config.cloud_business_data_modified ?? false,
      deployed_service_versions: {
        ...(config.deployed_service_versions ?? {}),
        ...Object.fromEntries(
          deployment.functions
            .filter((f) => !selectedService || f.service === selectedService)
            .map((f) => [
              f.service,
              {
                source_hash: release.source_hash,
                sha256: f.sha256,
                dependency_sha256: f.dependency_sha256,
              },
            ]),
        ),
      },
      last_code_deployment: {
        recorded_at: new Date().toISOString(),
        source_hash: release.source_hash,
        services: [...services].filter((s) => !selectedService || s === selectedService),
        backup_directory: backup,
      },
    },
    null,
    2,
  ) + '\n',
);
console.log(
  `Deployed ${paths.length} versioned functions to the confirmed test target; no migration or data writes were invoked.`,
);
