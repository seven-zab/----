import { build } from 'esbuild';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import process from 'node:process';
import { assertIndependentTestTarget } from './lib/test-environment-policy.mjs';
import { verifiedOperatorTarget, operatorSession } from './lib/cloudbase-operator.mjs';
const require = createRequire(import.meta.url);
async function main() {
  const [mappingPath, flag] = process.argv.slice(2);
  if (!mappingPath || (flag && flag !== '--apply'))
    throw new Error('Usage: node scripts/bootstrap-admin.mjs <verified-mapping.json> [--apply]');
  const mapping = JSON.parse(await readFile(resolve(mappingPath), 'utf8'));
  const keys = ['env_id', 'user_id', 'verified_by', 'verification_reference'];
  if (
    !mapping ||
    Object.keys(mapping).some((k) => !keys.includes(k)) ||
    keys.some((k) => typeof mapping[k] !== 'string' || !mapping[k].trim())
  )
    throw new Error('Invalid verified mapping');
  let knownEnvironment = null;
  try {
    knownEnvironment = JSON.parse(
      await readFile('.cache/local-config/cloud-environment.json', 'utf8'),
    );
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const designatedTestEnvId =
    process.env.TEST_CLOUD_ENV_ID ??
    (knownEnvironment?.test_environment_confirmed === true ? knownEnvironment.env_id : undefined);
  assertIndependentTestTarget(mapping.env_id, designatedTestEnvId, knownEnvironment);
  if (flag !== '--apply') {
    console.log('Dry run: verified mapping shape accepted; no cloud connection or writes.');
    process.exit(0);
  }
  await mkdir('.cache/maintenance', { recursive: true });
  const result = await build({
    entryPoints: ['server/maintenance/bootstrap-admin.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
  });
  const modulePath = resolve('.cache/maintenance/bootstrap-admin.cjs');
  await writeFile(modulePath, result.outputFiles[0].contents);
  const adapter = await build({
    entryPoints: ['server/adapters/cloudbase-repository.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
  });
  const adapterPath = resolve('.cache/maintenance/repository.cjs');
  await writeFile(adapterPath, adapter.outputFiles[0].contents);
  const cloud = require('wx-server-sdk');
  const operatorEnv = await verifiedOperatorTarget();
  if (operatorEnv !== mapping.env_id)
    throw new Error('Official operator target differs from mapping');
  const session = await operatorSession(operatorEnv);
  cloud.init({ env: mapping.env_id, ...session, timeout: 10000 });
  const repo = require(adapterPath).cloudbaseRepository(cloud.database({ throwOnNotFound: false }));
  const outcome = await require(modulePath).bootstrapAdmin(repo, mapping, Date.now());
  console.log(JSON.stringify({ created: outcome.created, grant_id: outcome.grant_id }));
}
try {
  await main();
} catch {
  console.error(
    'Admin bootstrap stopped by a local mapping, authorization, migration gate or cloud error; raw payloads omitted.',
  );
  process.exitCode = 1;
}
