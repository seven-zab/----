import { fingerprint, normalized } from './v2-engine.mjs';

export async function captureStableDatabase(inventory, scan, maxRecords = 50000) {
  const before = await inventory();
  if (
    !Array.isArray(before) ||
    !before.length ||
    before.some(
      (t) =>
        !/^[a-z][a-z0-9_-]{0,79}$/u.test(t.name ?? '') ||
        !Number.isSafeInteger(t.count) ||
        t.count < 0,
    ) ||
    new Set(before.map((t) => t.name)).size !== before.length
  )
    throw new Error('Invalid live backup inventory');
  const snapshot = Object.create(null);
  let total = 0;
  for (const table of before) {
    const rows = await scan(table.name);
    if (
      !Array.isArray(rows) ||
      rows.length !== table.count ||
      rows.some((r) => !r || typeof r._id !== 'string' || !r._id) ||
      new Set(rows.map((r) => r._id)).size !== rows.length
    )
      throw new Error('Live collection count or identity differs from inventory');
    total += rows.length;
    if (total > maxRecords) throw new Error('Live backup record limit exceeded');
    snapshot[table.name] = normalized(rows);
  }
  const after = await inventory();
  if (fingerprint(before) !== fingerprint(after))
    throw new Error('Live collection inventory changed during backup');
  for (const table of before)
    if (fingerprint(snapshot[table.name]) !== fingerprint(await scan(table.name)))
      throw new Error('Live collection content changed during backup');
  if (fingerprint(before) !== fingerprint(await inventory()))
    throw new Error('Live collection inventory changed during verification');
  return {
    snapshot,
    inventory: before,
    total,
    observed_unchanged_between_passes: true,
    atomic_snapshot_verified: false,
    restored_and_verified: false,
  };
}
