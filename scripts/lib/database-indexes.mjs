import { createHash } from 'node:crypto';
export function indexSpec(def) {
  if (
    !/^[a-z][a-z0-9_]{0,79}$/u.test(def.collection) ||
    !def.keys ||
    !Object.keys(def.keys).length ||
    Object.entries(def.keys).some(
      ([n, d]) => !/^[a-z_][a-z0-9_.]*$/u.test(n) || ![1, -1].includes(d),
    ) ||
    typeof def.unique !== 'boolean' ||
    (def.sparse !== undefined && typeof def.sparse !== 'boolean')
  )
    throw new Error('Invalid declared index');
  const schema = {
    MgoIndexKeys: Object.entries(def.keys).map(([Name, d]) => ({ Name, Direction: String(d) })),
    MgoIsUnique: def.unique,
    MgoIsSparse: def.sparse ?? false,
  };
  return {
    IndexName:
      'v2_' +
      createHash('sha256')
        .update(JSON.stringify([def.collection, schema]))
        .digest('hex')
        .slice(0, 20),
    MgoKeySchema: schema,
  };
}
export function indexMatches(actual, spec) {
  return (
    JSON.stringify(actual.Keys) === JSON.stringify(spec.MgoKeySchema.MgoIndexKeys) &&
    actual.Unique === spec.MgoKeySchema.MgoIsUnique &&
    (actual.Sparse ?? false) === spec.MgoKeySchema.MgoIsSparse &&
    !actual.PartialFilterExpression
  );
}
