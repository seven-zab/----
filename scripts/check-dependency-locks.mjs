import { readFile } from 'node:fs/promises';
import { assertDependencyLock, assertSdkSerializationParity } from './lib/dependency-lock.mjs';

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const root = await readJson('package.json');
const rootLock = await readJson('package-lock.json');
assertDependencyLock(root, rootLock, 'root');
const release = await readJson('contracts/generated/release.json');
const names = Object.keys({ ...release.targets, ...release.workers });
for (const name of names) {
  const manifest = await readJson(`cloudfunctions/${name}/package.json`);
  if (JSON.stringify(manifest.overrides ?? {}) !== JSON.stringify(root.overrides ?? {}))
    throw new Error(`Cloud function override policy differs from root: ${name}`);
  const lock = await readJson(`cloudfunctions/${name}/package-lock.json`);
  assertDependencyLock(manifest, lock, name);
  assertSdkSerializationParity(rootLock, lock, name);
}
console.log(
  `Dependency locks match manifests, exact override pins and SDK serialization versions: root + ${names.length} functions.`,
);
