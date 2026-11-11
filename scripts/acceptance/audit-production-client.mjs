import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import process from 'node:process';
import dotenv from 'dotenv';

const [directory, ...extra] = process.argv.slice(2);
if (!directory || extra.length) throw new Error('Use <isolated production client directory>');
const cache = await realpath('.cache');
const root = await realpath(directory);
if (!root.startsWith(cache + sep))
  throw new Error('Production client must be isolated in the project cache');
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const production = dotenv.parse(await readFile('.env.production')).VITE_CLOUD_ENV_ID ?? '';
const test = dotenv.parse(await readFile('.env.test')).VITE_CLOUD_ENV_ID;
const release = await readJson('contracts/generated/release.json');
const project = await readJson('project.config.json');
const app = await readJson(join(root, 'app.json'));
const config = await readJson(join(root, 'project.config.json'));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const paths = [];
async function walk(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, item.name);
    if (item.isDirectory()) await walk(path);
    else if (item.isFile()) paths.push(relative(root, path).split(sep).join('/'));
    else throw new Error('Unexpected production artifact type');
  }
}
await walk(root);
const routeNames = [
  ...app.pages,
  ...(app.subPackages ?? app.subpackages ?? []).flatMap(({ root, pages }) =>
    pages.map((page) => `${root}/${page}`),
  ),
];
const findings = [];
const files = [];
const sensitive =
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:AKID|AKIA)[0-9A-Za-z]{16,}\b|\b(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}\b|\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/u;
for (const path of paths.sort()) {
  const bytes = await readFile(join(root, path));
  files.push({ path, bytes: bytes.length, sha256: sha(bytes) });
  if (
    /(?:^|\/)(?:cloudfunctions|node_modules|\.cache|\.sourcemap|debug|fixtures|acceptance)(?:\/|$)|\.map$|(?:^|\/)\.env|project\.private\.config\.json$/iu.test(
      path,
    )
  )
    findings.push({ path, check: 'excluded_path' });
  if (!/\.(?:js|json|wxml|wxss|wxs)$/u.test(path)) continue;
  const text = bytes.toString('utf8');
  if (sensitive.test(text)) findings.push({ path, check: 'possible_credential' });
  if (test && text.includes(test)) findings.push({ path, check: 'test_cloud_id' });
  if (/\/\/[#@]\s*sourceMappingURL=|\/\*[#@]\s*sourceMappingURL=/u.test(text))
    findings.push({ path, check: 'source_map_reference' });
}
const client = await readFile(join(root, 'services/cloudClient.js'), 'utf8');
const configLooksFinal =
  /^cloud\d?-[a-z0-9-]{8,}$/iu.test(production) &&
  production !== test &&
  !/(?:placeholder|example|replace|not.configured)/iu.test(production);
const checks = {
  same_app_id: config.appid === project.appid,
  current_source: client.includes(release.source_hash),
  home_entry: app.pages[0] === 'pages/index/index',
  all_routes_bundled: routeNames.every(
    (route) => paths.includes(route + '.js') && paths.includes(route + '.wxml'),
  ),
  no_probe_routes: routeNames.every(
    (route) => !/(?:^|\/)(?:debug|fixtures|acceptance|diagnostic)(?:\/|$)/iu.test(route),
  ),
  no_static_findings: findings.length === 0,
  production_target_configured: configLooksFinal && client.includes(production),
};
const staticPassed =
  checks.same_app_id &&
  checks.current_source &&
  checks.home_entry &&
  checks.all_routes_bundled &&
  checks.no_probe_routes &&
  checks.no_static_findings;
const proof = {
  source_hash: release.source_hash,
  static_passed: staticPassed,
  checks,
  findings,
  production_target_verified_live: false,
  routes: routeNames.length,
  client_files: files.length,
  client_bytes: files.reduce((sum, file) => sum + file.bytes, 0),
  manifest_sha256: sha(JSON.stringify(files)),
  recorded_at: new Date().toISOString(),
};
const dir = '.cache/production-client-audits';
await mkdir(dir, { recursive: true });
const file = join(dir, randomUUID() + '.json');
await writeFile(file, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ ...proof, proof: file }));
if (!staticPassed) process.exitCode = 1;
