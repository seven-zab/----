import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import process from 'node:process';
import { resolve, join } from 'node:path';
import { auditRetentionSnapshot } from '../lib/retention-snapshot-audit.mjs';

const input = process.argv[2];
if (!input)
  throw new Error('Usage: node scripts/acceptance/audit-retention-snapshot.mjs <snapshot.json>');
const data = readFileSync(resolve(input));
const result = auditRetentionSnapshot(JSON.parse(data.toString('utf8')));
const evidence = {
  snapshot_sha256: createHash('sha256').update(data).digest('hex'),
  audited_at: new Date().toISOString(),
  mode: 'offline_read_only_non_atomic_snapshot',
  cleanup_authorized: false,
  result,
};
const dir = resolve('.cache/retention-snapshot-audits');
mkdirSync(dir, { recursive: true });
const output = join(dir, `${randomUUID()}.json`);
writeFileSync(output, JSON.stringify(evidence, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ evidence: output, ...evidence }));
