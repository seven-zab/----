import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID, createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { build } from 'esbuild';
import { verifiedOperatorTarget, operatorSession } from '../lib/cloudbase-operator.mjs';
const require = createRequire(import.meta.url),
  checks = [];
try {
  if (process.argv.slice(2).join(' ') !== '--capture-readonly')
    throw Error('Explicit read-only mode required');
  const env = await verifiedOperatorTarget(),
    session = await operatorSession(env),
    proof = JSON.parse(
      await readFile('.cache/upload-flow-probes/9f96cea5-9c2a-4001-a742-72d237379d59.json', 'utf8'),
    );
  if (
    proof.env_id !== env ||
    !proof.file_id ||
    !proof.checks.some((c) => c.check === 'finalize_and_real_image_check' && c.passed)
  )
    throw Error('Actual test file required');
  const paired = createRequire(require.resolve('wx-server-sdk/package.json'));
  const db = paired('@cloudbase/node-sdk')
    .init({ env, ...session, timeout: 10000 })
    .database();
  const raw = (await db.collection('files').doc(proof.file_id).get()).data;
  const file = Array.isArray(raw) ? raw[0] : raw;
  if (file?.storage_mode !== 'immutable_private' || file.content_hash !== proof.fixture_sha256)
    throw Error('Private fixture mismatch');
  const location = /^cloud:\/\/([a-z0-9-]+)\.([a-z0-9-]+)\/(.+)$/u.exec(file.cloud_file_id);
  if (!location || location[1] !== env) throw Error('Unexpected storage location');
  const prefix = `cloud://${env}.${location[2]}/`,
    key = location[3];
  const built = await build({
    entryPoints: ['server/adapters/cos-file-access.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
  });
  await mkdir('.cache/maintenance', { recursive: true });
  const modulePath = resolve('.cache/maintenance/file-access-policy.cjs');
  await writeFile(modulePath, built.outputFiles[0].contents);
  const { signFileAccess } = require(modulePath),
    now = Date.now(),
    signed = signFileAccess(prefix, file.cloud_file_id, 30, session, now);
  const check = (name, ok, detail = {}) => {
    checks.push({ check: name, passed: Boolean(ok), ...detail });
    if (!ok) throw Error('Access-policy mismatch');
  };
  const sdk = createRequire(resolve('.cache/storage-tools/package.json'));
  const expected = sdk('cos-nodejs-sdk-v5/sdk/util.js').getAuth({
    SecretId: session.secretId,
    SecretKey: session.secretKey,
    Method: 'get',
    Key: key,
    KeyTime: new URL(signed.url).searchParams.get('q-key-time'),
    Headers: { host: `${location[2]}.cos.ap-shanghai.myqcloud.com` },
    Query: { 'x-cos-security-token': session.sessionToken },
  });
  check(
    'signature_matches_official_sdk',
    new URL(signed.url).searchParams.get('q-signature') ===
      new URLSearchParams(expected).get('q-signature'),
  );
  const request = async (url, options = {}) =>
    fetch(url, { ...options, signal: AbortSignal.timeout(10000), redirect: 'manual' });
  const actual = await request(signed.url);
  check(
    'signed_get_reads_exact_bytes',
    actual.status === 200 &&
      createHash('sha256')
        .update(Buffer.from(await actual.arrayBuffer()))
        .digest('hex') === proof.fixture_sha256,
    { status: actual.status },
  );
  const changed = new URL(signed.url);
  changed.pathname += '-modified';
  const wrongPath = await request(changed);
  check('path_change_denied', wrongPath.status === 403, { status: wrongPath.status });
  const time = new URL(signed.url);
  const start = time.searchParams.get('q-sign-time').split(';')[0];
  time.searchParams.set('q-sign-time', `${start};${Math.floor(Date.now() / 1000) + 3600}`);
  const extended = await request(time);
  check('expiry_extension_denied', extended.status === 403, { status: extended.status });
  const changedToken = new URL(signed.url);
  changedToken.searchParams.set('x-cos-security-token', 'invalid');
  const invalid = await request(changedToken);
  check('token_change_denied', invalid.status === 403, { status: invalid.status });
  const bare = new URL(signed.url);
  bare.search = '';
  const anonymous = await request(bare, { method: 'HEAD' });
  check('unsigned_read_denied', anonymous.status === 403, { status: anonymous.status });
  const clockResponse = await request(bare, { method: 'HEAD' });
  const providerClock = Date.parse(clockResponse.headers.get('date'));
  const clockSampleOffset = providerClock - Date.now();
  check(
    'provider_clock_available',
    Number.isSafeInteger(providerClock) && Math.abs(providerClock - Date.now()) < 30000,
  );
  const short = signFileAccess(prefix, file.cloud_file_id, 5, session, providerClock);
  const fresh = await request(short.url);
  check('short_signature_works_before_expiry', fresh.status === 200, { status: fresh.status });
  let expired, providerTime;
  const until = Date.now() + 30000;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 1000));
    expired = await request(short.url);
    providerTime = Date.parse(expired.headers.get('date'));
    if (providerTime >= short.expires_at) break;
  }
  check('actual_short_expiry_denied', expired?.status === 403 && providerTime >= short.expires_at, {
    status: expired?.status,
    server_date: expired?.headers.get('date'),
    signed_expires_at: short.expires_at,
    checked_at: Date.now(),
    operator_vs_provider_sample_ms: clockSampleOffset,
  });
  const output = resolve('.cache/file-access-policy-probes', randomUUID() + '.json');
  await mkdir(resolve(output, '..'), { recursive: true });
  await writeFile(
    output,
    JSON.stringify(
      {
        env_id: env,
        source_hash: JSON.parse(await readFile('contracts/generated/release.json', 'utf8'))
          .source_hash,
        recorded_at: new Date().toISOString(),
        passed: true,
        checks,
        cloud_writes: false,
        signed_urls_persisted: false,
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx' },
  );
  console.log(
    JSON.stringify({
      proof_file: output,
      passed: true,
      checks: checks.length,
      cloud_writes: false,
    }),
  );
} catch {
  console.error(
    JSON.stringify({
      passed: false,
      checks,
      error: 'Read-only access policy probe stopped; raw signatures and credentials omitted.',
    }),
  );
  process.exitCode = 1;
}
