import { createHash } from 'node:crypto';

export const digest = (value) => createHash('sha256').update(value).digest('hex');
const collectionName = /^[a-z][a-z0-9_-]{0,79}$/u;
function fail(message) {
  throw new Error(message);
}

// Developer Tools JSON exports are JSON Lines. Arrays are also accepted for
// externally verified snapshots; invalid lines never become an empty backup.
export function parseExport(bytes) {
  const text = bytes
    .toString('utf8')
    .replace(/^\uFEFF/u, '')
    .trim();
  if (!text) fail('Empty export file is not proof of an empty collection');
  let rows;
  if (text.startsWith('[')) {
    try {
      rows = JSON.parse(text);
    } catch {
      fail('Invalid JSON export array');
    }
  } else {
    try {
      rows = text
        .split(/\r?\n/u)
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));
    } catch {
      fail('Invalid JSON Lines export');
    }
  }
  if (!Array.isArray(rows)) fail('Export must contain records');
  const ids = new Set();
  for (const row of rows) {
    if (
      !row ||
      typeof row !== 'object' ||
      Array.isArray(row) ||
      typeof row._id !== 'string' ||
      !row._id.trim() ||
      ids.has(row._id)
    )
      fail('Missing or duplicate record ID in export');
    ids.add(row._id);
  }
  return rows;
}

export async function assembleBackup(manifest, load) {
  if (
    !manifest ||
    manifest.version !== 1 ||
    !/^[a-z][a-z0-9-]{2,99}$/u.test(manifest.env_id ?? '') ||
    !Array.isArray(manifest.inventory) ||
    !manifest.inventory.length ||
    !Array.isArray(manifest.exports) ||
    manifest.inventory.some((name) => !collectionName.test(name)) ||
    new Set(manifest.inventory).size !== manifest.inventory.length
  )
    fail('Invalid backup inventory');
  const snapshot = Object.create(null),
    entries = [];
  for (const entry of manifest.exports) {
    if (
      !entry ||
      !manifest.inventory.includes(entry.collection) ||
      Object.hasOwn(snapshot, entry.collection) ||
      typeof entry.file !== 'string' ||
      !entry.file ||
      !/^[a-f0-9]{64}$/u.test(entry.sha256 ?? '') ||
      !Number.isSafeInteger(entry.expected_count) ||
      entry.expected_count < 0
    )
      fail('Invalid or duplicate export entry');
    const bytes = await load(entry.file);
    if (digest(bytes) !== entry.sha256) fail('Export checksum mismatch');
    const rows = parseExport(bytes);
    if (rows.length !== entry.expected_count) fail('Export record count mismatch');
    snapshot[entry.collection] = rows;
    entries.push({
      collection: entry.collection,
      count: rows.length,
      sha256: entry.sha256,
      fields: [...new Set(rows.flatMap((row) => Object.keys(row)))].sort(),
    });
  }
  const missing = manifest.inventory.filter((name) => !Object.hasOwn(snapshot, name));
  return {
    snapshot,
    evidence: {
      version: 1,
      env_id: manifest.env_id,
      complete: missing.length === 0,
      missing_collections: missing,
      restored_and_verified: false,
      collections: entries,
    },
  };
}
