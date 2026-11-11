import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID, createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import {
  verifiedOperatorTarget,
  operatorSession,
  operatorJson,
} from '../lib/cloudbase-operator.mjs';
import { downloadFunctionZip } from '../lib/migration-writers.mjs';
const read = async (p) => JSON.parse(await readFile(p, 'utf8'));
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
try {
  const [mode, proofPath, ...rest] = process.argv.slice(2);
  if (
    rest.length ||
    !['--enable-file-only', '--disable-file-only'].includes(mode) ||
    (mode === '--enable-file-only' && !proofPath) ||
    (mode === '--disable-file-only' && proofPath)
  )
    throw new Error('Explicit file-only mode required');
  const enable = mode === '--enable-file-only';
  const env = await verifiedOperatorTarget(),
    release = await read('contracts/generated/release.json');
  if (enable) {
    const proof = await read(proofPath);
    if (
      proof.env_id !== env ||
      proof.source_hash !== release.source_hash ||
      !proof.real_cos ||
      !proof.passed ||
      proof.checks.length < 18 ||
      !proof.checks.every((c) => c.passed)
    )
      throw new Error('Real current upload-policy proof required');
    const artifact = await read('dist/cloudfunctions/deployment.json');
    if (artifact.source_hash !== release.source_hash) throw new Error('Current build required');
    const entry = artifact.functions.find((f) => f.service === 'fileService');
    const code = await downloadFunctionZip(env, release.targets.fileService);
    const require = createRequire(import.meta.url);
    const zip = await require('unzipper').Open.buffer(code.bytes);
    const actual = zip.files.find((f) => f.path === 'index.js');
    if (
      !actual ||
      createHash('sha256')
        .update(await actual.buffer())
        .digest('hex') !== entry?.sha256
    )
      throw new Error('Current cloud code required before enabling');
    const rule = await operatorJson(['storage', 'rules', 'get', '--env-id', env]);
    if (rule.acl !== 'ADMINONLY')
      throw new Error('Global client storage rules must remain private');
  }
  const session = await operatorSession(env);
  const require = createRequire(resolve('.cache/operator-api-tools/package.json'));
  if (require('tencentcloud-sdk-nodejs-scf/package.json').version !== '4.1.168')
    throw new Error('Unexpected management SDK');
  const Client = require('tencentcloud-sdk-nodejs-scf').scf.v20180416.Client;
  const client = new Client({
    credential: {
      secretId: session.secretId,
      secretKey: session.secretKey,
      token: session.sessionToken,
    },
    region: 'ap-shanghai',
    profile: { httpProfile: { endpoint: 'scf.tencentcloudapi.com', reqTimeout: 30 } },
  });
  const target = { Namespace: env, FunctionName: release.targets.fileService };
  const before = await client.GetFunction(target),
    variables = before.Environment?.Variables ?? [];
  const map = new Map(variables.map((v) => [v.Key, v.Value]));
  if (
    before.Status !== 'Active' ||
    before.Namespace !== env ||
    before.FunctionName !== target.FunctionName ||
    ['JOBS_ENABLED', 'AI_JOBS_ENABLED'].some((k) => map.get(k) === 'true')
  )
    throw new Error('Unexpected file function state');
  if (
    enable &&
    (Buffer.from(map.get('PRIVATE_DATA_KEY') ?? '', 'base64').length !== 32 ||
      !map.get('STORAGE_FILE_PREFIX')?.startsWith(`cloud://${env}.`))
  )
    throw new Error('Verified private config required');
  const desired = [
    ...variables.filter((v) => v.Key !== 'PRIVATE_STORAGE_READY'),
    { Key: 'PRIVATE_STORAGE_READY', Value: enable ? 'true' : 'false' },
  ];
  const wait = async () => {
    const end = Date.now() + 180000;
    while (Date.now() < end) {
      const current = await client.GetFunction(target);
      if (current.Status === 'Active') return current;
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error('Function configuration did not become active');
  };
  await client.UpdateFunctionConfiguration({ ...target, Environment: { Variables: desired } });
  const after = await wait(),
    actual = new Map((after.Environment?.Variables ?? []).map((v) => [v.Key, v.Value]));
  if (
    after.Timeout !== before.Timeout ||
    after.MemorySize !== before.MemorySize ||
    after.Runtime !== before.Runtime ||
    actual.size !== desired.length ||
    desired.some((v) => actual.get(v.Key) !== v.Value)
  )
    throw new Error('File configuration differs after update; stop and inspect');
  await mkdir('.cache/upload-config-probes', { recursive: true });
  const file = resolve('.cache/upload-config-probes', randomUUID() + '.json');
  await writeFile(
    file,
    JSON.stringify(
      {
        env_id: env,
        source_hash: release.source_hash,
        function: target.FunctionName,
        file_only: true,
        enabled: enable,
        previously_enabled: map.get('PRIVATE_STORAGE_READY') === 'true',
        other_variables_preserved: true,
        private_key_present: actual.has('PRIVATE_DATA_KEY'),
        background_enabled: false,
        before_variables_sha256: digest(variables),
        after_variables_sha256: digest(desired),
        recorded_at: new Date().toISOString(),
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx' },
  );
  console.log(
    JSON.stringify({
      proof_file: file,
      file_only: true,
      enabled: enable,
      other_configuration_preserved: true,
    }),
  );
} catch {
  console.error(
    'File-only upload configuration stopped; cloud state requires readback; credential values omitted.',
  );
  process.exitCode = 1;
}
