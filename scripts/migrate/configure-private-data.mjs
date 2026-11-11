import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes, randomUUID, createHash, createCipheriv, createDecipheriv } from 'node:crypto';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import {
  verifiedOperatorTarget,
  operatorSession,
  operatorJson,
} from '../lib/cloudbase-operator.mjs';
import { protectPrivateKey, unprotectPrivateKey } from '../lib/protected-private-key.mjs';
const sha = (b) => createHash('sha256').update(b).digest('hex');
let journal;
try {
  const apply = process.argv.slice(2).join(' ') === '--apply';
  if (process.argv.length > (apply ? 3 : 2)) throw new Error('Use [--apply]');
  const env = await verifiedOperatorTarget();
  const release = JSON.parse(await readFile('contracts/generated/release.json', 'utf8'));
  const session = await operatorSession(env);
  const req = createRequire(resolve('.cache/operator-api-tools/package.json'));
  if (req('tencentcloud-sdk-nodejs-scf/package.json').version !== '4.1.168')
    throw new Error('Unexpected management SDK');
  const Client = req('tencentcloud-sdk-nodejs-scf').scf.v20180416.Client;
  const client = new Client({
    credential: {
      secretId: session.secretId,
      secretKey: session.secretKey,
      token: session.sessionToken,
    },
    region: 'ap-shanghai',
    profile: { httpProfile: { endpoint: 'scf.tencentcloudapi.com', reqTimeout: 30 } },
  });
  const described = await operatorJson([
    'api',
    'tcb',
    'DescribeEnvs',
    '--env-id',
    env,
    '--api-version',
    '2018-06-08',
    '--region',
    'ap-shanghai',
    '--body',
    JSON.stringify({ EnvId: env }),
  ]);
  const storage = described.EnvList?.find((e) => e.EnvId === env)?.Storages?.[0];
  if (!storage?.Bucket || storage.ExternalStorage?.Enabled)
    throw new Error('Private-file prefix needs separate shared-bucket handling');
  const prefix = `cloud://${env}.${storage.Bucket}/`;
  const configs = [];
  for (const name of Object.values({ ...release.targets, ...release.workers })) {
    const c = await client.GetFunction({ Namespace: env, FunctionName: name });
    if (c.FunctionName !== name || c.Namespace !== env || c.Status !== 'Active')
      throw new Error('Function target or state is invalid');
    if (
      c.Environment?.Variables?.some(
        (v) => ['JOBS_ENABLED', 'AI_JOBS_ENABLED'].includes(v.Key) && v.Value === 'true',
      )
    )
      throw new Error('Background workers must remain disabled');
    configs.push(c);
  }
  const existing = [
    ...new Set(
      configs
        .map((c) => c.Environment?.Variables?.find((v) => v.Key === 'PRIVATE_DATA_KEY')?.Value)
        .filter(Boolean),
    ),
  ];
  if (existing.length > 1 || existing.some((k) => Buffer.from(k, 'base64').length !== 32))
    throw new Error('Existing encryption keys differ or are malformed; never rotate automatically');
  const backup = JSON.parse(
    await readFile(
      '.cache/cloud-data-backups/live-ee1d26c2-361c-4cee-8a6a-4632f479ef4b/assembled/snapshot.json',
      'utf8',
    ),
  );
  let encryptedFields = 0;
  const scan = (v) => {
    if (Array.isArray(v)) v.forEach(scan);
    else if (v && typeof v === 'object')
      for (const [k, x] of Object.entries(v)) {
        if (/ciphertext$/iu.test(k) && x) encryptedFields++;
        scan(x);
      }
  };
  scan(backup);
  if (!existing.length && encryptedFields)
    throw new Error('Encrypted historical data requires the original key');
  if (!apply) {
    console.log(
      JSON.stringify({
        mode: 'dry-run',
        env_id: env,
        functions: configs.length,
        existing_key_versions: existing.length,
        historical_ciphertext_fields: encryptedFields,
        key_generated: false,
        private_storage_ready_will_remain: false,
      }),
    );
  } else {
    let local;
    try {
      local = await unprotectPrivateKey(
        await readFile('.cache/local-config/private-data-key.dpapi'),
        env,
      );
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    const key = existing.length ? Buffer.from(existing[0], 'base64') : local ?? randomBytes(32);
    if (local && !local.equals(key))
      throw new Error('Local protected key differs from the cloud key');
    const output = resolve('.cache/key-backups', randomUUID());
    await mkdir(output, { recursive: true });
    const who = await promisify(execFile)('whoami.exe', ['/user', '/fo', 'csv', '/nh'], {
      windowsHide: true,
    });
    const sid = who.stdout.match(/S-1-5-(?:\d+-)+\d+/u)?.[0];
    if (!sid) throw new Error('Cannot identify local key owner');
    await promisify(execFile)(
      'icacls.exe',
      [output, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F'],
      { windowsHide: true },
    );
    const protectedBytes = await protectPrivateKey(key, env);
    await writeFile(resolve(output, 'private-data-key.dpapi'), protectedBytes, { flag: 'wx' });
    if (
      !(
        await unprotectPrivateKey(await readFile(resolve(output, 'private-data-key.dpapi')), env)
      ).equals(key)
    )
      throw new Error('Protected key restore failed');
    if (!local)
      await writeFile('.cache/local-config/private-data-key.dpapi', protectedBytes, { flag: 'wx' });
    const keyHash = sha(key),
      completed = [];
    journal = resolve(output, 'status.json');
    await writeFile(
      journal,
      JSON.stringify({ status: 'configuring', key_sha256: keyHash, completed }),
    );
    const iv = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([
      cipher.update('yzxz-key-recovery-check', 'utf8'),
      cipher.final(),
    ]);
    const challenge = {
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
    await writeFile(resolve(output, 'challenge.json'), JSON.stringify(challenge));
    for (const c of configs) {
      const beforeVars = c.Environment?.Variables ?? [];
      const variables = beforeVars.filter(
        (v) =>
          !['PRIVATE_DATA_KEY', 'STORAGE_FILE_PREFIX', 'PRIVATE_STORAGE_READY'].includes(v.Key),
      );
      variables.push(
        { Key: 'PRIVATE_DATA_KEY', Value: key.toString('base64') },
        { Key: 'STORAGE_FILE_PREFIX', Value: prefix },
        { Key: 'PRIVATE_STORAGE_READY', Value: 'false' },
      );
      await client.UpdateFunctionConfiguration({
        Namespace: env,
        FunctionName: c.FunctionName,
        Environment: { Variables: variables },
      });
      let after;
      const until = Date.now() + 180000;
      while (Date.now() < until) {
        after = await client.GetFunction({ Namespace: env, FunctionName: c.FunctionName });
        if (after.Status === 'Active') break;
        await new Promise((r) => setTimeout(r, 2000));
      }
      const actual = new Map((after?.Environment?.Variables ?? []).map((v) => [v.Key, v.Value]));
      if (
        after?.Status !== 'Active' ||
        after.Timeout !== c.Timeout ||
        after.MemorySize !== c.MemorySize ||
        after.Runtime !== c.Runtime ||
        actual.get('STORAGE_FILE_PREFIX') !== prefix ||
        actual.get('PRIVATE_STORAGE_READY') !== 'false' ||
        variables.some((v) => actual.get(v.Key) !== v.Value) ||
        actual.size !== variables.length
      )
        throw new Error('Configuration readback differs');
      const restoredKey = Buffer.from(actual.get('PRIVATE_DATA_KEY'), 'base64');
      if (sha(restoredKey) !== keyHash) throw new Error('Cloud key recovery hash failed');
      const decipher = createDecipheriv(
        'aes-256-gcm',
        restoredKey,
        Buffer.from(challenge.iv, 'base64'),
      );
      decipher.setAuthTag(Buffer.from(challenge.tag, 'base64'));
      if (
        Buffer.concat([
          decipher.update(Buffer.from(challenge.ciphertext, 'base64')),
          decipher.final(),
        ]).toString() !== 'yzxz-key-recovery-check'
      )
        throw new Error('Cloud key recovery challenge failed');
      completed.push(c.FunctionName);
      await writeFile(
        journal,
        JSON.stringify({ status: 'configuring', key_sha256: keyHash, completed }),
      );
      console.log(JSON.stringify({ configured: completed.length, total: configs.length }));
    }
    const proof = {
      version: 1,
      env_id: env,
      key_sha256: keyHash,
      functions: completed,
      dpapi_restore_verified: true,
      cloud_configuration_recovery_verified: true,
      private_storage_ready: false,
      workers_enabled: false,
      key_values_included: false,
      recorded_at: new Date().toISOString(),
    };
    await writeFile(resolve(output, 'proof.json'), JSON.stringify(proof, null, 2) + '\n', {
      flag: 'wx',
    });
    await writeFile(journal, JSON.stringify({ status: 'key_recovery_verified', completed }));
    console.log(JSON.stringify({ ...proof, proof_file: resolve(output, 'proof.json') }));
  }
} catch (error) {
  if (journal)
    await writeFile(
      journal,
      JSON.stringify({ status: 'stopped_requires_review', secret_values_omitted: true }),
    );
  console.error(
    JSON.stringify({
      error: 'Private-key preparation stopped; key values and raw configuration omitted',
      code:
        typeof error.code === 'string' && /^[A-Za-z0-9_.-]{1,100}$/u.test(error.code)
          ? error.code
          : 'KEY_PREPARATION_FAILED',
    }),
  );
  process.exitCode = 1;
}
