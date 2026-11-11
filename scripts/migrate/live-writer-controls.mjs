import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { operatorJson, collectionInventory } from '../lib/cloudbase-operator.mjs';
import {
  listFunctions,
  assertFunctionScope,
  latestOnly,
  downloadFunctionZip,
  writerHash,
  retiredSource,
  legacyFunctionNames,
} from '../lib/migration-writers.mjs';
const require = createRequire(import.meta.url),
  unzipper = require('unzipper');
async function mapRead(items, work, width = 4) {
  const values = [];
  for (let start = 0; start < items.length; start += width) {
    const settled = await Promise.allSettled(items.slice(start, start + width).map(work));
    for (const r of settled) {
      if (r.status === 'rejected') throw r.reason;
      values.push(r.value);
    }
  }
  return values;
}
export async function verifyLiveWriterControls(env, retirement, release) {
  if (
    retirement.env_id !== env ||
    !retirement.old_writers_retired ||
    retirement.drain_wait_ms < 5000
  )
    throw new Error('Retired-and-drained writer proof is required');
  const deployment = JSON.parse(await readFile('dist/cloudfunctions/deployment.json', 'utf8'));
  if (deployment.source_hash !== release.source_hash)
    throw new Error('Current application deployment evidence is missing');
  const functions = await listFunctions(env);
  assertFunctionScope(functions, release);
  const codes = await mapRead(
    functions,
    async (f) => {
      await latestOnly(env, f.FunctionName);
      const code = await downloadFunctionZip(env, f.FunctionName);
      const zip = await unzipper.Open.buffer(code.bytes),
        entry = zip.files.find((e) => e.path === 'index.js');
      if (!entry || entry.uncompressedSize > 16 * 1024 * 1024)
        throw new Error('Function code readback is incomplete');
      const digest = writerHash(await entry.buffer());
      const expected = legacyFunctionNames.includes(f.FunctionName)
        ? writerHash(retiredSource(retirement.plan_id))
        : deployment.functions.find((a) => a.name === f.FunctionName)?.sha256;
      if (!expected || digest !== expected)
        throw new Error('Uncovered function code can bypass migration controls');
      const config = await operatorJson([
        'fn',
        'detail',
        f.FunctionName,
        '--env-id',
        env,
        '--region',
        'ap-shanghai',
      ]);
      if (
        config.Status !== 'Active' ||
        config.Environment?.Variables?.some(
          (v) => ['JOBS_ENABLED', 'AI_JOBS_ENABLED'].includes(v.Key) && v.Value === 'true',
        )
      )
        throw new Error('A function is updating or a background writer is enabled');
      return { name: f.FunctionName, entry_sha256: digest };
    },
    2,
  );
  const tables = await collectionInventory(env);
  const required = JSON.parse(await readFile('database/collections.json', 'utf8'));
  if (required.collections.some((n) => !tables.some((t) => t.name === n)))
    throw new Error('Required private collection is missing');
  const acls = await mapRead(tables, async (t) => {
    const r = await operatorJson([
      'api',
      'tcb',
      'DescribeDatabaseACL',
      '--env-id',
      env,
      '--api-version',
      '2018-06-08',
      '--region',
      'ap-shanghai',
      '--body',
      JSON.stringify({ EnvId: env, CollectionName: t.name }),
    ]);
    if (r.AclTag !== 'ADMINONLY') throw new Error('A direct client writer is not blocked');
    return { collection: t.name, acl: 'ADMINONLY' };
  });
  const hosted = await operatorJson([
    'api',
    'tcb',
    'DescribeCloudBaseRunServers',
    '--env-id',
    env,
    '--api-version',
    '2018-06-08',
    '--region',
    'ap-shanghai',
    '--body',
    JSON.stringify({ EnvId: env, Offset: 0, Limit: 100 }),
  ]);
  if (hosted.TotalCount !== 0 || hosted.CloudBaseRunServerSet?.length !== 0)
    throw new Error('Cloud-hosted writers require separate fencing');
  const keys = await operatorJson([
    'api',
    'tcb',
    'DescribeApiKeyList',
    '--env-id',
    env,
    '--api-version',
    '2018-06-08',
    '--region',
    'ap-shanghai',
    '--body',
    JSON.stringify({ EnvId: env }),
  ]);
  if (keys.Total !== 0 || keys.Data?.length !== 0)
    throw new Error('API-key writers require separate fencing');
  const storage = await operatorJson(['storage', 'rules', 'get', '--env-id', env]);
  if (storage.acl !== 'ADMINONLY') throw new Error('A direct client storage writer is not blocked');
  return writerHash({
    env_id: env,
    source_hash: release.source_hash,
    retirement_plan_id: retirement.plan_id,
    codes,
    acls,
    hosted_writers: 0,
    api_key_writers: 0,
    client_storage_acl: 'ADMINONLY',
  });
}
