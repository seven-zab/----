import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { operatorJson, operatorSession } from './cloudbase-operator.mjs';

export async function cosOperator(env) {
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
  const record = described.EnvList?.find((e) => e.EnvId === env);
  if (record?.Storages?.length !== 1) throw new Error('Exactly one verified storage is required');
  const storage = record.Storages[0];
  const external = storage.ExternalStorage?.Enabled;
  const Bucket = external ? storage.ExternalStorage.BucketName : storage.Bucket;
  const Region = external ? storage.ExternalStorage.Region : storage.Region;
  const Prefix = external ? storage.ExternalStorage.BasePath : '';
  if (
    typeof Bucket !== 'string' ||
    !/^[a-zA-Z0-9-]+$/u.test(Bucket) ||
    Region !== 'ap-shanghai' ||
    typeof Prefix !== 'string' ||
    (Prefix && (!Prefix.endsWith('/') || Prefix.startsWith('/') || Prefix.includes('..')))
  )
    throw new Error('Storage scope cannot be verified');
  const require = createRequire(resolve('.cache/storage-tools/package.json'));
  const COS = require('cos-nodejs-sdk-v5');
  if (require('cos-nodejs-sdk-v5/package.json').version !== '3.0.0')
    throw new Error('Unexpected COS SDK');
  const session = await operatorSession(env);
  const cos = new COS({
    SecretId: session.secretId,
    SecretKey: session.secretKey,
    SecurityToken: session.sessionToken,
    Timeout: 15000,
    Protocol: 'https:',
    ObjectKeySimplifyCheck: false,
  });
  const request = (action, params = {}) =>
    new Promise((resolve, reject) =>
      cos[action]({ Bucket, Region, ...params }, (error, response) =>
        error ? reject(error) : resolve(response),
      ),
    );
  return { request, scope: { env_id: env, bucket: Bucket, region: Region, prefix: Prefix } };
}

export async function listAllObjects(request, prefix = '', limit = 10000) {
  const rows = [],
    seen = new Set();
  let marker = '';
  for (;;) {
    const result = await request('getBucket', { Prefix: prefix, Marker: marker, MaxKeys: 1000 });
    if (!Array.isArray(result.Contents)) throw new Error('Incomplete object listing');
    for (const row of result.Contents) {
      const size = Number(row.Size);
      if (
        typeof row.Key !== 'string' ||
        !row.Key.startsWith(prefix) ||
        seen.has(row.Key) ||
        row.Key <= marker ||
        !Number.isSafeInteger(size) ||
        size < 0 ||
        typeof row.ETag !== 'string'
      )
        throw new Error('Object identity, size or pagination is inconsistent');
      seen.add(row.Key);
      rows.push({ key: row.Key, size, etag: row.ETag, last_modified: row.LastModified });
      if (rows.length > limit) throw new Error('Object backup limit exceeded');
    }
    if (![true, false, 'true', 'false'].includes(result.IsTruncated))
      throw new Error('Missing truncation status');
    if (result.IsTruncated === false || result.IsTruncated === 'false')
      return rows.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    if (
      !result.Contents.length ||
      typeof result.NextMarker !== 'string' ||
      result.NextMarker <= marker
    )
      throw new Error('Truncated listing has no advancing marker');
    marker = result.NextMarker;
  }
}
