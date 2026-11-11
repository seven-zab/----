import { readFile, writeFile, mkdir, readdir, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import process from 'node:process';
const sha = (b) => createHash('sha256').update(b).digest('hex');
const read = async (f) => JSON.parse(await readFile(f, 'utf8'));
const release = await read('contracts/generated/release.json');
const target = await read('.cache/local-config/cloud-environment.json');
const build = await read('dist/build/mp-weixin/build-info.json');
const config = await read('dist/build/mp-weixin/project.config.json');
if (
  build.mode !== 'test' ||
  build.source_hash !== release.source_hash ||
  build.cloud_env_id !== target.env_id ||
  !target.test_environment_confirmed ||
  config.appid !== 'wxbb2c6c85fd8c180d' ||
  config.appid !== target.app_id
)
  throw new Error('Current confirmed test client required');
const original = await read(
  '.cache/preview-candidates/579d8b48cc6b/notification-v1/local-package-review.json',
);
const source = resolve('dist/build/mp-weixin');
const [variant, flag, additionsFile, ...extra] = process.argv.slice(2);
if (
  extra.length ||
  (variant && !/^[a-z][a-z0-9-]{0,59}$/u.test(variant)) ||
  (flag && (flag !== '--reviewed-additions' || !additionsFile))
)
  throw new Error('Use [lowercase-candidate-name [--reviewed-additions file.json]]');
const additions = new Map();
for (const { path, sha256 } of additionsFile ? await read(additionsFile) : []) {
  if (
    !/^[A-Za-z0-9_./-]+$/u.test(path) ||
    path.startsWith('/') ||
    path.split('/').includes('..') ||
    path.startsWith('cloudfunctions/') ||
    !/^[a-f0-9]{64}$/u.test(sha256) ||
    additions.has(path) ||
    original.files.some((file) => file.path === path)
  )
    throw new Error('Invalid reviewed addition');
  additions.set(path, sha256);
}
const releaseRoot = resolve('.cache/preview-candidates', release.source_hash.slice(0, 12));
const root = variant ? join(releaseRoot, variant) : releaseRoot;
const destination = join(root, 'project');
const walk = async (dir, prefix = '') => {
  const list = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix + e.name;
    if (rel === 'cloudfunctions') continue;
    if (e.isSymbolicLink()) throw new Error('Symlink not permitted');
    if (e.isDirectory()) list.push(...(await walk(join(dir, e.name), rel + '/')));
    else if (e.isFile()) list.push(rel);
    else throw new Error('Unknown file type');
  }
  return list.sort();
};
const paths = await walk(source);
const reviewedPaths = [...original.files.map((f) => f.path), ...additions.keys()].sort();
if (JSON.stringify(paths) !== JSON.stringify(reviewedPaths))
  throw new Error('Client file scope changed; review additional files first');
for (const [p, digest] of additions)
  if (sha(await readFile(join(source, p))) !== digest) throw new Error('Reviewed addition changed');
if (variant) {
  await mkdir(releaseRoot, { recursive: true });
  await mkdir(root);
  await mkdir(destination);
} else await mkdir(destination, { recursive: true });
const files = [];
for (const p of paths) {
  const bytes = await readFile(join(source, p));
  const digest = sha(bytes);
  if (additions.has(p) && additions.get(p) !== digest) throw new Error('Reviewed addition changed');
  if (
    /\.(js|json|wxml|wxss)$/u.test(p) &&
    /(?:-----BEGIN (?:RSA |EC )?PRIVATE KEY-----|AKID[0-9A-Za-z]{30,}|"secretKey"\s*:\s*"[^"\s]{8,}")/u.test(
      bytes.toString('utf8'),
    )
  )
    throw new Error('Bounded credential scan requires review');
  await mkdir(resolve(destination, p, '..'), { recursive: true });
  await copyFile(join(source, p), join(destination, p));
  files.push({ path: p, bytes: bytes.length, sha256: digest });
}
const review = {
  source_hash: release.source_hash,
  app_id: config.appid,
  build,
  manifest_sha256: sha(JSON.stringify(files)),
  client_files: files.length,
  client_bytes: files.reduce((n, f) => n + f.bytes, 0),
  cloud_functions_included: false,
  bounded_static_scan_findings: [],
  scan_limit: 'heuristic, not a complete privacy audit',
  changed_client_files: files
    .filter((f) => original.files.find((o) => o.path === f.path)?.sha256 !== f.sha256)
    .map((f) => f.path),
  files,
};
await writeFile(join(root, 'local-package-review.json'), JSON.stringify(review, null, 2) + '\n', {
  flag: 'wx',
});
console.log(
  JSON.stringify({
    review: join(root, 'local-package-review.json'),
    project: destination,
    manifest_sha256: review.manifest_sha256,
    client_files: review.client_files,
    client_bytes: review.client_bytes,
    changed_client_files: review.changed_client_files,
    cloud_functions_included: false,
  }),
);
