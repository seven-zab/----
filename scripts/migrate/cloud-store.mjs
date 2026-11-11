import { MigrationSafetyError, normalized } from './v2-engine.mjs';
import { epoch } from '../../database/migrations/002-review-legacy.mjs';

const checked = (value) => {
  if (!value || typeof value !== 'object' || value.code)
    throw new MigrationSafetyError('Cloud database operation failed; raw response omitted');
  return value;
};
function forStorage(value, field = '') {
  if (value instanceof Date) return value;
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    '$date' in value
  ) {
    const timestamp = epoch(value);
    if (timestamp === null) throw new MigrationSafetyError('Invalid stored date wrapper');
    return new Date(timestamp);
  }
  if (typeof value === 'number' && /_at$|_until$/u.test(field)) return new Date(value);
  if (Array.isArray(value)) return value.map((item) => forStorage(item));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, forStorage(item, key)]),
    );
  return value;
}
// Uses the pinned CloudBase Node SDK paired with wx-server-sdk, not the wx
// wrapper's {data: ...} document API. No credentials are read from IDE stores.
export function migrationCloudStore(database, maxRecords = 50000) {
  const adapter = (db) => ({
    async get(collection, id) {
      const result = checked(await db.collection(collection).doc(id).get());
      const row = Array.isArray(result.data) ? result.data[0] : result.data;
      if (row === undefined || row === null) return null;
      if (!row || typeof row._id !== 'string')
        throw new MigrationSafetyError('Invalid database record');
      return normalized(row);
    },
    async put(collection, entity) {
      const { _id, ...fields } = entity;
      checked(await db.collection(collection).doc(_id).set(forStorage(fields)));
    },
    async addFields(collection, id, fields) {
      const result = checked(await db.collection(collection).doc(id).update(forStorage(fields)));
      if (result.updated !== 1)
        throw new MigrationSafetyError('Additive record update did not affect exactly one row');
    },
  });
  return {
    ...adapter(database),
    transaction: (work) => database.runTransaction((tx) => work(adapter(tx))),
    async scan(collection) {
      const rows = [],
        seen = new Set();
      let last = null;
      for (;;) {
        let query = database.collection(collection);
        if (last !== null) query = query.where({ _id: database.command.gt(last) });
        const result = checked(await query.orderBy('_id', 'asc').limit(100).get());
        if (!Array.isArray(result.data))
          throw new MigrationSafetyError('Invalid database scan response');
        for (const raw of result.data) {
          const row = normalized(raw);
          if (
            !row ||
            typeof row._id !== 'string' ||
            seen.has(row._id) ||
            (rows.length > 0 && row._id <= rows[rows.length - 1]._id)
          )
            throw new MigrationSafetyError(
              'Database scan order or document identity is inconsistent',
            );
          seen.add(row._id);
          rows.push(row);
          if (rows.length > maxRecords)
            throw new MigrationSafetyError('Migration scan limit exceeded; no silent truncation');
        }
        if (result.data.length < 100) return rows;
        last = rows[rows.length - 1]._id;
      }
    },
  };
}
