import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { planMigration } from '../../database/migrations/002-review-legacy.mjs';
const [input, output] = process.argv.slice(2);
if (!input || !output || process.argv.includes('--apply'))
  throw new Error(
    'Usage: node scripts/migrate/dry-run.mjs <backup-snapshot.json> <local-report.json>; cloud writes are disabled',
  );
const source = await readFile(resolve(input));
const snapshot = JSON.parse(source.toString('utf8'));
const report = planMigration(snapshot);
report.source_sha256 = createHash('sha256').update(source).digest('hex');
const target = resolve(output);
if (target === resolve(input)) throw new Error('The report must not overwrite its source snapshot');
await mkdir(dirname(target), { recursive: true });
await writeFile(target, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(
  JSON.stringify({
    mode: report.mode,
    collections: report.counts,
    changes: report.changes.length,
    anomalies: report.anomalies.length,
    source_sha256: report.source_sha256,
  }),
);
