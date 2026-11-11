import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { verifiedOperatorTarget, operatorSession } from '../lib/cloudbase-operator.mjs';
import { cosOperator } from '../lib/cos-operator.mjs';
import { documentPreviewStatus } from '../lib/document-ci-response.mjs';

const mode = process.argv.slice(2).join(' ');
const binding = mode === '--capture-binding-readonly';
if (mode !== '--capture-readonly' && !binding) throw new Error('Read-only audit flag required');
const env = await verifiedOperatorTarget();
const { scope } = await cosOperator(env);
const session = await operatorSession(env);
const require = createRequire(import.meta.url);
const util = createRequire(new URL('../../.cache/storage-tools/package.json', import.meta.url))(
  'cos-nodejs-sdk-v5/sdk/util.js',
);
const xml = require('xml2js');
const host = binding
  ? `${scope.bucket}.ci.ap-shanghai.myqcloud.com`
  : 'ci.ap-shanghai.myqcloud.com';
const key = binding ? '' : 'docbucket';
const query = binding
  ? {}
  : {
      regions: 'ap-shanghai',
      bucketNames: scope.bucket,
      pageNumber: '1',
      pageSize: '10',
    };
const auth = util.getAuth({
  SecretId: session.secretId,
  SecretKey: session.secretKey,
  Method: 'get',
  Key: key,
  Query: query,
  Headers: { host },
});
const proof = {
  env_id: env,
  read_only: true,
  action: binding ? 'DescribeCIBuckets' : 'DescribeDocProcessBucket',
  recorded_at: new Date().toISOString(),
  credentials_included: false,
  service_activation_requested: false,
  query_succeeded: false,
};
try {
  const queryString = new URLSearchParams(query).toString();
  const response = await fetch(`https://${host}/${key}${queryString ? `?${queryString}` : ''}`, {
    headers: { Authorization: auth, 'x-cos-security-token': session.sessionToken },
    signal: AbortSignal.timeout(15000),
  });
  proof.http_status = response.status;
  const body = await response.text();
  if (binding && response.ok) {
    const status = JSON.parse(body).CIStatus;
    if (!['on', 'off', 'unbinding'].includes(status)) throw new Error('Unknown CI binding state');
    proof.binding_state = status;
    proof.query_succeeded = true;
  } else {
    const parsed = await xml.parseStringPromise(body, { explicitArray: false });
    if (!response.ok) {
      const code = parsed?.Error?.Code;
      proof.error_code =
        typeof code === 'string' && /^[A-Za-z0-9_.-]{1,80}$/u.test(code) ? code : null;
    } else {
      Object.assign(proof, documentPreviewStatus(parsed, scope.bucket));
      proof.query_succeeded = true;
    }
  }
} catch (error) {
  proof.error_category = /^[A-Za-z]{1,40}$/u.test(error?.name ?? '') ? error.name : 'Error';
}
const dir = '.cache/document-scan-audits';
await mkdir(dir, { recursive: true });
const file = `${dir}/${randomUUID()}.json`;
await writeFile(file, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ ...proof, proof: file }));
if (!proof.query_succeeded) process.exitCode = 1;
