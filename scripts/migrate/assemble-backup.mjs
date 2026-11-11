import { readFile, mkdir, writeFile, realpath } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { assembleBackup, digest } from './backup.mjs';

const [manifestPath, outputPath, ...rest] = process.argv.slice(2);
if (!manifestPath || !outputPath || rest.length)
  throw new Error(
    'Usage: node scripts/migrate/assemble-backup.mjs <manifest.json> <new-output-directory>',
  );
const manifestFile = await realpath(resolve(manifestPath));
const backupRoot = dirname(manifestFile);
const target = resolve(outputPath);
// These snapshots may contain personal data. Keep them out of source control.
const cache = await realpath(resolve('.cache'));
const inside = (root, path) => {
  const rel = relative(root, path);
  return (
    rel !== '' &&
    rel !== '..' &&
    !rel.startsWith('..\\') &&
    !rel.startsWith('../') &&
    !isAbsolute(rel)
  );
};
if (!inside(cache, await realpath(dirname(target))))
  throw new Error('Create output inside the ignored .cache directory');
const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
const result = await assembleBackup(manifest, async (file) => {
  const path = await realpath(resolve(backupRoot, file));
  if (!inside(backupRoot, path)) throw new Error('Export file escapes backup directory');
  return readFile(path);
});
const data = JSON.stringify(result.snapshot, null, 2) + '\n';
const evidence = {
  ...result.evidence,
  recorded_at: new Date().toISOString(),
  snapshot_sha256: digest(data),
};
// A new directory prevents an incomplete retry from replacing an earlier backup.
await mkdir(target);
await writeFile(resolve(target, 'snapshot.json'), data, { flag: 'wx' });
await writeFile(resolve(target, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n', {
  flag: 'wx',
});
console.log(
  JSON.stringify({
    complete: evidence.complete,
    exported_collections: evidence.collections.length,
    missing_collections: evidence.missing_collections,
    snapshot_sha256: evidence.snapshot_sha256,
    restored_and_verified: false,
  }),
);
