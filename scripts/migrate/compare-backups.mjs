import { readFile, realpath, writeFile } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { digest, parseExport } from './backup.mjs';

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(',')}}`;
}

export function compareRestoredExports(source, restored, prefix) {
  if (!/^restore_[a-z0-9_]{4,40}_$/u.test(prefix ?? ''))
    throw new Error('A distinct restore_..._ collection prefix is required');
  for (const snapshot of [source, restored]) {
    if (
      !snapshot ||
      typeof snapshot !== 'object' ||
      Array.isArray(snapshot) ||
      !Object.keys(snapshot).length
    )
      throw new Error('Invalid snapshot');
    for (const rows of Object.values(snapshot)) parseExport(Buffer.from(JSON.stringify(rows)));
  }
  const comparisons = [],
    expected = new Set();
  for (const collection of Object.keys(source).sort()) {
    const target = prefix + collection;
    expected.add(target);
    const original = new Map(source[collection].map((row) => [row._id, digest(canonical(row))]));
    const actual = new Map(
      (restored[target] ?? []).map((row) => [row._id, digest(canonical(row))]),
    );
    comparisons.push({
      collection,
      source_count: original.size,
      restored_count: actual.size,
      missing_collection: !Object.hasOwn(restored, target),
      missing_records: [...original.keys()].filter((id) => !actual.has(id)).length,
      extra_records: [...actual.keys()].filter((id) => !original.has(id)).length,
      changed_records: [...original].filter(
        ([id, hash]) => actual.has(id) && actual.get(id) !== hash,
      ).length,
    });
  }
  const extraCollections = Object.keys(restored).filter((name) => !expected.has(name));
  return {
    comparison_passed:
      !extraCollections.length &&
      comparisons.every(
        (row) =>
          !row.missing_collection &&
          !row.missing_records &&
          !row.extra_records &&
          !row.changed_records,
      ),
    comparisons,
    extra_collections: extraCollections,
    cloud_restore_verified: false,
    deletion_replay_verified: false,
  };
}

async function main() {
  const [sourcePath, restorePath, prefix, reportPath, ...rest] = process.argv.slice(2);
  if (!sourcePath || !restorePath || !prefix || !reportPath || rest.length)
    throw new Error(
      'Usage: node scripts/migrate/compare-backups.mjs <assembled-source-dir> <assembled-restore-dir> <restore_prefix_> <new-report.json>',
    );
  const [sourceDirectory, restoreDirectory] = await Promise.all([
    realpath(resolve(sourcePath)),
    realpath(resolve(restorePath)),
  ]);
  if (sourceDirectory.toLowerCase() === restoreDirectory.toLowerCase())
    throw new Error('Source and restore exports must be distinct directories');
  const load = async (directory) => {
    const bytes = await readFile(resolve(directory, 'snapshot.json'));
    const evidence = JSON.parse(await readFile(resolve(directory, 'evidence.json'), 'utf8'));
    if (evidence.complete !== true || evidence.snapshot_sha256 !== digest(bytes))
      throw new Error('A complete, unmodified assembled backup is required');
    return { snapshot: JSON.parse(bytes), evidence };
  };
  const [source, restored] = await Promise.all([load(sourceDirectory), load(restoreDirectory)]);
  if (source.evidence.env_id !== restored.evidence.env_id)
    throw new Error('Restore evidence must refer to the same confirmed test environment');
  const report = {
    ...compareRestoredExports(source.snapshot, restored.snapshot, prefix),
    recorded_at: new Date().toISOString(),
    env_id: source.evidence.env_id,
    source_sha256: source.evidence.snapshot_sha256,
    restored_sha256: restored.evidence.snapshot_sha256,
    note: 'Offline export comparison only; live restore origin, permissions and deletion replay still require verification.',
  };
  const target = resolve(reportPath),
    cache = await realpath(resolve('.cache'));
  const parent = await realpath(dirname(target)),
    rel = relative(cache, parent);
  if (rel === '..' || rel.startsWith('..\\') || rel.startsWith('../') || isAbsolute(rel))
    throw new Error('Write evidence inside the ignored .cache directory');
  await writeFile(target, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(report));
  if (!report.comparison_passed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await main();
