import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { cosOperator, listAllObjects } from '../lib/cos-operator.mjs';
import { verifiedOperatorTarget, operatorJson } from '../lib/cloudbase-operator.mjs';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
try {
  if (process.argv.slice(2).join(' ') !== '--capture-readonly')
    throw new Error('Read-only flag required');
  const env = await verifiedOperatorTarget();
  const { request, scope } = await cosOperator(env);
  const rows = await listAllObjects(request, scope.prefix);
  if (
    rows.reduce((sum, r) => sum + r.size, 0) > 500 * 1024 * 1024 ||
    rows.some((r) => r.size > 25 * 1024 * 1024)
  )
    throw new Error('Storage backup byte budget exceeded');
  const rules = await operatorJson(['storage', 'rules', 'get', '--env-id', env]);
  const output = resolve('.cache/storage-backups', randomUUID());
  await mkdir(resolve(output, 'objects'), { recursive: true });
  await writeFile(resolve(output, 'rules.json'), JSON.stringify(rules, null, 2) + '\n', {
    flag: 'wx',
  });
  await writeFile(
    resolve(output, 'status.json'),
    JSON.stringify({ status: 'capturing', scope, count: rows.length }),
  );
  const entries = [];
  for (const row of rows) {
    const result = await request('getObject', { Key: row.key, Headers: { 'If-Match': row.etag } });
    if (
      result.statusCode !== 200 ||
      !Buffer.isBuffer(result.Body) ||
      result.Body.length !== row.size ||
      result.headers?.etag !== row.etag
    )
      throw new Error('Object contents or metadata changed');
    const digest = sha(result.Body);
    const file = `objects/${sha(row.key)}.bin`;
    await writeFile(resolve(output, file), result.Body, { flag: 'wx' });
    if (sha(await readFile(resolve(output, file))) !== digest)
      throw new Error('Local object verification failed');
    const headers = Object.fromEntries(
      Object.entries(result.headers).filter(
        ([name, value]) =>
          /^(?:content-type|content-encoding|content-disposition|cache-control|x-cos-meta-.+)$/u.test(
            name,
          ) && typeof value === 'string',
      ),
    );
    const acl = await request('getObjectAcl', { Key: row.key });
    if (!acl.Owner || !Array.isArray(acl.Grants))
      throw new Error('Original object ACL is incomplete');
    entries.push({
      ...row,
      file,
      sha256: digest,
      content_type: result.headers['content-type'] ?? 'application/octet-stream',
      headers,
      object_acl: { Owner: acl.Owner, Grants: acl.Grants },
    });
    console.log(JSON.stringify({ objects_downloaded: entries.length, total: rows.length }));
  }
  if (
    sha(JSON.stringify(await listAllObjects(request, scope.prefix))) !== sha(JSON.stringify(rows))
  )
    throw new Error('Storage inventory changed during backup');
  const manifest = {
    version: 1,
    scope,
    entries,
    complete: true,
    all_keys_including_dot_prefixes: true,
    observed_unchanged_between_passes: true,
    atomic_snapshot_verified: false,
    restored_and_verified: false,
    source_objects_modified: false,
    recorded_at: new Date().toISOString(),
  };
  await writeFile(resolve(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', {
    flag: 'wx',
  });
  await writeFile(
    resolve(output, 'status.json'),
    JSON.stringify({ status: 'backup_complete', objects: entries.length }),
  );
  console.log(
    JSON.stringify({
      output_directory: output,
      objects: entries.length,
      bytes: rows.reduce((s, r) => s + r.size, 0),
      complete: true,
      restored_and_verified: false,
      source_objects_modified: false,
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      error: 'Storage backup stopped; no source modification requested; raw data omitted',
      code:
        typeof error.code === 'string' && /^[A-Za-z0-9_.-]{1,100}$/u.test(error.code)
          ? error.code
          : 'BACKUP_FAILED',
    }),
  );
  process.exitCode = 1;
}
