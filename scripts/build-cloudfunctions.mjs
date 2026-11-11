import { build } from 'esbuild';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  assertDependencyLock,
  assertSdkSerializationParity,
  dependencyArtifactHash,
} from './lib/dependency-lock.mjs';
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const rootLock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const sdk = pkg.dependencies['wx-server-sdk'];
if (!/^\d+\.\d+\.\d+$/.test(sdk ?? ''))
  throw new Error('Pin wx-server-sdk to a tested exact version');
const root = 'dist/cloudfunctions';
const release = JSON.parse(await readFile('contracts/generated/release.json', 'utf8'));
const deployed = [];
// Preflight every lock before writing any build output. Root overrides alone do
// not update the independent SDK dependency graphs installed in the cloud.
for (const name of Object.keys({ ...release.targets, ...release.workers })) {
  const lock = JSON.parse(await readFile(`cloudfunctions/${name}/package-lock.json`, 'utf8'));
  assertSdkSerializationParity(rootLock, lock, name);
  assertDependencyLock(
    { dependencies: { 'wx-server-sdk': sdk }, overrides: pkg.overrides ?? {} },
    lock,
    name,
  );
}
for (const [name, target] of Object.entries({ ...release.targets, ...release.workers })) {
  const entry = Object.hasOwn(release.workers, name) ? 'server/jobs-entry.ts' : 'server/entry.ts';
  if (!/^yzxz_v2_[a-zA-Z]+$/.test(target)) throw new Error('Unsafe deployment target');
  await mkdir(`${root}/${target}`, { recursive: true });
  await build({
    entryPoints: [entry],
    outfile: `${root}/${target}/index.js`,
    bundle: true,
    platform: 'node',
    target: 'node16.13',
    format: 'cjs',
    external: ['wx-server-sdk'],
    define: { SERVICE_NAME: JSON.stringify(name) },
    sourcemap: false,
  });
  const manifest = {
    name,
    version: '2.0.0',
    private: true,
    main: 'index.js',
    engines: { node: '>=16.13' },
    dependencies: { 'wx-server-sdk': sdk },
    overrides: pkg.overrides ?? {},
  };
  await writeFile(
    `${root}/${target}/package.json`,
    JSON.stringify({ ...manifest, name: target }, null, 2) + '\n',
  );
  await mkdir(`cloudfunctions/${name}`, { recursive: true });
  await writeFile(`cloudfunctions/${name}/package.json`, JSON.stringify(manifest, null, 2) + '\n');
  const lockBytes = await readFile(`cloudfunctions/${name}/package-lock.json`);
  const lock = JSON.parse(lockBytes.toString('utf8'));
  if (
    JSON.stringify(lock.packages[''].dependencies) !== JSON.stringify(manifest.dependencies) ||
    Object.values(lock.packages).some((p) => p.link || String(p.resolved).startsWith('file:'))
  )
    throw new Error(`Non-independent dependency lock: ${name}`);
  lock.name = target;
  lock.packages[''].name = target;
  lock.packages[''].engines = manifest.engines;
  await writeFile(`${root}/${target}/package-lock.json`, JSON.stringify(lock, null, 2) + '\n');
  await writeFile(
    `${root}/${target}/config.json`,
    JSON.stringify(
      {
        permissions: {
          openapi: [
            'security.msgSecCheck',
            'security.imgSecCheck',
            ...(name === 'businessJobs' ? ['subscribeMessage.send'] : []),
          ],
        },
        ...(Object.hasOwn(release.workers, name)
          ? { triggers: [{ name: `yzxz-${name}`, type: 'timer', config: '0 */1 * * * * *' }] }
          : {}),
      },
      null,
      2,
    ) + '\n',
  );
  // The tracked cloudfunctions entries are thin wrappers; their runtime is reproducible.
  await build({
    entryPoints: [entry],
    outfile: `cloudfunctions/${name}/runtime.cjs`,
    bundle: true,
    platform: 'node',
    target: 'node16.13',
    format: 'cjs',
    external: ['wx-server-sdk'],
    define: { SERVICE_NAME: JSON.stringify(name) },
    sourcemap: false,
  });
  const bytes = await readFile(`${root}/${target}/index.js`);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const dependency_sha256 = dependencyArtifactHash(
    await readFile(`${root}/${target}/package.json`),
    await readFile(`${root}/${target}/package-lock.json`),
  );
  deployed.push({ service: name, name: target, sha256, dependency_sha256 });
  console.log(`${target}: ${bytes.length} bytes sha256=${sha256}`);
}
await writeFile(
  `${root}/deployment.json`,
  JSON.stringify({ source_hash: release.source_hash, functions: deployed }, null, 2) + '\n',
);
