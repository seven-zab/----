import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID, createHash } from 'node:crypto';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { build } from 'esbuild';
import {
  verifiedOperatorTarget,
  operatorSession,
  operatorJson,
} from '../lib/cloudbase-operator.mjs';
import { cosOperator } from '../lib/cos-operator.mjs';
const require = createRequire(import.meta.url);
let stage = 'target';
let secureProbeObjects;
const checks = [];
const probeId = randomUUID();
try {
  if (process.argv.slice(2).join(' ') !== '--apply')
    throw new Error('Explicit storage probe flag required');
  const env = await verifiedOperatorTarget();
  const { request, scope } = await cosOperator(env);
  const acl = await operatorJson([
    'storage',
    'rules',
    'get',
    '--env-id',
    env,
    '--region',
    'ap-shanghai',
  ]);
  if (acl.acl !== 'ADMINONLY') throw new Error('Private storage rule required');
  const version = await request('getBucketVersioning');
  if (version.Status) throw new Error('Unversioned storage required for overwrite rejection');
  const built = await build({
    entryPoints: ['server/adapters/cos-upload-ticket.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
  });
  await mkdir('.cache/maintenance', { recursive: true });
  const modulePath = resolve('.cache/maintenance/upload-policy.cjs');
  await writeFile(modulePath, built.outputFiles[0].contents);
  const { signUploadTicket } = require(modulePath);
  const id = probeId,
    path = `temporary/policy_probe/${id}`,
    prefix = `cloud://${env}.${scope.bucket}/`;
  const session = await operatorSession(env);
  const paired = createRequire(require.resolve('wx-server-sdk/package.json'));
  stage = 'metadata';
  const raw = await paired('@cloudbase/node-sdk')
    .init({ env, ...session, timeout: 10000 })
    .getUploadMetadata({ cloudPath: path });
  if (!raw.data || raw.code) throw new Error('Cloud storage metadata unavailable');
  // Harmless fixture, deliberately not a business file or identity material.
  const bytes = Buffer.from('yunzhixiangzhi scoped upload policy verification');
  const now = Date.now(),
    descriptor = { path, mime: 'image/png', size: bytes.length, expires_at: now + 120000 };
  const ticket = signUploadTicket(prefix, descriptor, raw.data, session, now);
  const post = async (changes = {}, body = bytes, capability, headers = {}) => {
    if (!capability) {
      const freshNow = Date.now();
      capability = signUploadTicket(
        prefix,
        { ...descriptor, expires_at: freshNow + 120000 },
        raw.data,
        session,
        freshNow,
      );
    }
    const form = new FormData();
    for (const [k, v] of Object.entries({ ...capability.form_data, ...changes })) form.set(k, v);
    form.set('file', new Blob([body]), 'policy-probe.png');
    const result = await fetch(capability.url, {
      method: 'POST',
      body: form,
      redirect: 'manual',
      headers,
      signal: AbortSignal.timeout(15000),
    });
    const response = await result.text();
    const code = /<Code>([A-Za-z0-9_]{1,80})<\/Code>/u.exec(response)?.[1] ?? null;
    return { status: result.status, code };
  };
  const assert = (name, ok, detail) => {
    checks.push({ check: name, passed: Boolean(ok), ...detail });
    if (!ok) throw new Error('Upload policy check failed');
  };
  const sibling = `temporary/policy_probe/${randomUUID()}`;
  secureProbeObjects = async () => {
    for (const key of [path, sibling, `private/policy_probe/${id}`]) {
      try {
        await request('putObjectAcl', { Key: key, ACL: 'private' });
      } catch (error) {
        if (error.statusCode !== 404 && error.code !== 'NoSuchKey')
          throw new Error('Probe ACL compensation failed');
      }
    }
  };
  stage = 'boundaries';
  const ownerOnly = (permissions) =>
    permissions.Owner?.ID &&
    Array.isArray(permissions.Grants) &&
    permissions.Grants.length > 0 &&
    permissions.Grants.every(
      (g) =>
        g.Permission === 'FULL_CONTROL' &&
        g.Grantee?.ID === permissions.Owner.ID &&
        !g.Grantee?.URI,
    );
  for (const [name, changes, body] of [
    ['different_key_denied', { key: sibling }, bytes],
    ['private_path_denied', { key: `private/policy_probe/${id}` }, bytes],
    ['wrong_mime_denied', { 'Content-Type': 'application/pdf' }, bytes],
    ['public_acl_denied', { acl: 'public-read' }, bytes],
    ['oversize_denied', {}, Buffer.concat([bytes, Buffer.from('x')])],
    ['undersize_denied', {}, bytes.subarray(1)],
    ['overwrite_flag_required', { 'x-cos-forbid-overwrite': 'false' }, bytes],
  ]) {
    stage = `boundary:${name}`;
    const response = await post(changes, body);
    assert(name, response.status === 400 || response.status === 403, response);
  }
  // COS may ignore unsupported form fields. Successful HTTP status alone
  // does not establish an ACL change: verify the resulting permissions and
  // unsigned access, including header variants. A failure is compensated.
  for (const [name, fields, headers] of [
    [
      'form_extra_grant',
      { 'x-cos-grant-read': 'uri="http://cam.qcloud.com/groups/global/AllUsers"' },
      {},
    ],
    ['form_extra_acl_alias', { 'x-cos-acl': 'public-read' }, {}],
    [
      'form_mixed_case_grant',
      { 'X-Cos-Grant-Read': 'uri="http://cam.qcloud.com/groups/global/AllUsers"' },
      {},
    ],
    ['form_mixed_case_acl', { 'X-Cos-Acl': 'public-read' }, {}],
    [
      'form_full_control_grant',
      { 'x-cos-grant-full-control': 'uri="http://cam.qcloud.com/groups/global/AllUsers"' },
      {},
    ],
    [
      'header_extra_grant',
      {},
      { 'x-cos-grant-read': 'uri="http://cam.qcloud.com/groups/global/AllUsers"' },
    ],
    ['header_extra_acl', {}, { 'x-cos-acl': 'public-read' }],
    [
      'header_full_control_grant',
      {},
      { 'x-cos-grant-full-control': 'uri="http://cam.qcloud.com/groups/global/AllUsers"' },
    ],
  ]) {
    stage = `acl_effect:${name}`;
    const response = await post(fields, bytes, undefined, headers);
    if (response.status === 204) {
      const permissions = await request('getObjectAcl', { Key: path });
      const anonymous = await fetch(`${ticket.url}${path}`, {
        method: 'HEAD',
        signal: AbortSignal.timeout(10000),
      });
      assert(`${name}_cannot_expand_acl`, ownerOnly(permissions) && anonymous.status === 403, {
        ...response,
        anonymous_status: anonymous.status,
      });
      // Delete only this request's known UUID fixture before an independent
      // case; an existing object would otherwise mask a policy failure with409.
      await request('deleteObject', { Key: path });
    } else assert(`${name}_rejected`, response.status === 400 || response.status === 403, response);
  }
  const expired = signUploadTicket(
    prefix,
    { ...descriptor, expires_at: now - 60000 },
    raw.data,
    session,
    now - 120000,
  );
  stage = 'expired_policy';
  const rejected = await post({}, bytes, expired);
  assert('expired_policy_denied', rejected.status === 403, rejected);
  stage = 'exact_upload';
  const uploaded = await post();
  assert('exact_upload_succeeds', uploaded.status === 204, uploaded);
  stage = 'overwrite';
  const duplicate = await post();
  assert('same_key_overwrite_denied', duplicate.status === 409, duplicate);
  stage = 'readback';
  const actual = await request('getObject', { Key: path });
  assert('uploaded_bytes_match', Buffer.from(actual.Body).equals(bytes));
  const permissions = await request('getObjectAcl', { Key: path });
  assert('owner_only_acl', ownerOnly(permissions));
  const anonymous = await fetch(`${ticket.url}${path}`, {
    method: 'HEAD',
    signal: AbortSignal.timeout(10000),
  });
  assert('anonymous_read_denied', anonymous.status === 403, { status: anonymous.status });
  const originalMetadata = actual.headers?.['x-cos-meta-fileid'];
  assert('cloud_file_metadata_preserved', originalMetadata === raw.data.cosFileId);
  // Retain only this known, private probe object as evidence; original objects
  // and isolated restore copies are never modified or deleted.
  const output = resolve('.cache/upload-policy-probes', `${id}.json`);
  await mkdir(resolve(output, '..'), { recursive: true });
  await writeFile(
    output,
    JSON.stringify(
      {
        env_id: env,
        recorded_at: new Date().toISOString(),
        object_key: path,
        source_hash: JSON.parse(await readFile('contracts/generated/release.json', 'utf8'))
          .source_hash,
        fixture_sha256: createHash('sha256').update(bytes).digest('hex'),
        checks,
        signed_capabilities_persisted: false,
        passed: true,
        real_cos: true,
        real_image_moderation: false,
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx' },
  );
  console.log(
    JSON.stringify({
      evidence_file: output,
      checks: checks.length,
      passed: true,
      original_objects_modified: false,
    }),
  );
} catch {
  let probeObjectsPrivate = true;
  try {
    await secureProbeObjects?.();
  } catch {
    probeObjectsPrivate = false;
  }
  const failureFile = resolve('.cache/upload-policy-probes', `${probeId}.json`);
  await mkdir(resolve(failureFile, '..'), { recursive: true });
  await writeFile(
    failureFile,
    JSON.stringify(
      {
        stage,
        checks,
        passed: false,
        probe_objects_private: probeObjectsPrivate,
        signed_capabilities_persisted: false,
        recorded_at: new Date().toISOString(),
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx' },
  );
  console.error(
    JSON.stringify({
      stage,
      passed: false,
      probe_objects_private: probeObjectsPrivate,
      checks,
      error:
        'Upload policy probe stopped; raw credentials, signatures and provider payloads omitted.',
    }),
  );
  process.exitCode = 1;
}
