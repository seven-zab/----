// @vitest-environment node
import { expect, it } from 'vitest';
import { indexSpec, indexMatches } from '../../scripts/lib/database-indexes.mjs';
it('preserves compound key order, unique constraints and sparse legacy compatibility', () => {
  const spec = indexSpec({
    collection: 'messages',
    keys: { conversation_id: 1, created_at: -1 },
    unique: true,
    sparse: true,
  });
  expect(spec.MgoKeySchema).toEqual({
    MgoIndexKeys: [
      { Name: 'conversation_id', Direction: '1' },
      { Name: 'created_at', Direction: '-1' },
    ],
    MgoIsUnique: true,
    MgoIsSparse: true,
  });
  expect(
    indexMatches({ Keys: spec.MgoKeySchema.MgoIndexKeys, Unique: false, Sparse: true }, spec),
  ).toBe(false);
  expect(
    indexMatches(
      {
        Keys: spec.MgoKeySchema.MgoIndexKeys,
        Unique: true,
        Sparse: true,
        PartialFilterExpression: '',
      },
      spec,
    ),
  ).toBe(true);
});
it('rejects arbitrary collection names, expressions and unsupported sort directions', () => {
  expect(() => indexSpec({ collection: '../users', keys: { x: 1 }, unique: false })).toThrow();
  expect(() => indexSpec({ collection: 'users', keys: { $where: 1 }, unique: false })).toThrow();
  expect(() => indexSpec({ collection: 'users', keys: { x: 2 }, unique: false })).toThrow();
});
