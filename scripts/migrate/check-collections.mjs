import { readFile } from 'node:fs/promises';

const [inventoryPath, ...rest] = process.argv.slice(2);
if (!inventoryPath || rest.length)
  throw new Error('Usage: node scripts/migrate/check-collections.mjs <backup-manifest.json>');
const manifest = JSON.parse(await readFile(inventoryPath, 'utf8'));
const required = JSON.parse(
  await readFile(new URL('../../database/collections.json', import.meta.url), 'utf8'),
);
if (
  !Array.isArray(manifest.inventory) ||
  manifest.inventory.some((name) => !/^[a-z][a-z0-9_-]{0,79}$/u.test(name)) ||
  new Set(manifest.inventory).size !== manifest.inventory.length
)
  throw new Error('Invalid observed collection inventory');
console.log(
  JSON.stringify(
    {
      mode: 'offline-inventory-comparison',
      cloud_changes: false,
      required_count: required.collections.length,
      missing_collections: required.collections.filter(
        (name) => !manifest.inventory.includes(name),
      ),
      historic_only_collections: manifest.inventory.filter(
        (name) => !required.collections.includes(name),
      ),
      note: 'Collection existence does not verify client rules, indexes, contents, or migration readiness.',
    },
    null,
    2,
  ),
);
