import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { verifiedOperatorTarget, operatorJson } from '../lib/cloudbase-operator.mjs';
import { writerHash } from '../lib/migration-writers.mjs';
import { indexSpec, indexMatches } from '../lib/database-indexes.mjs';
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));
try {
  const args = process.argv.slice(2);
  if (args.length && !(args.length === 2 && args[0] === '--apply'))
    throw new Error('Use [--apply <plan.json>]');
  const env = await verifiedOperatorTarget(),
    declared = await json('database/indexes.json');
  const api = (action, body) =>
    operatorJson([
      'api',
      'tcb',
      action,
      '--env-id',
      env,
      '--api-version',
      '2018-06-08',
      '--region',
      'ap-shanghai',
      '--body',
      JSON.stringify({ EnvId: env, ...body }),
    ]);
  if (!args.length) {
    const entries = [];
    for (const def of declared.indexes) {
      const spec = indexSpec(def),
        current = await api('DescribeTable', { TableName: def.collection });
      if (!Array.isArray(current.Indexes) || current.IndexNum !== current.Indexes.length)
        throw new Error('Index backup incomplete');
      entries.push({
        collection: def.collection,
        spec,
        existing_indexes: current.Indexes,
        create: !current.Indexes.some((i) => indexMatches(i, spec)),
      });
    }
    const body = {
      version: 1,
      env_id: env,
      definition_sha256: writerHash(declared),
      entries,
      drop_indexes: [],
      documents_modified: false,
    };
    const plan = { ...body, plan_id: writerHash(body) };
    const output = resolve('.cache/index-plans', randomUUID());
    await mkdir(output, { recursive: true });
    const file = resolve(output, 'plan.json');
    await writeFile(file, JSON.stringify(plan, null, 2) + '\n', { flag: 'wx' });
    console.log(
      JSON.stringify({
        plan_file: file,
        declared: entries.length,
        create: entries.filter((e) => e.create).length,
        indexes_to_drop: 0,
        cloud_changes: false,
      }),
    );
  } else {
    const plan = await json(args[1]),
      { plan_id, ...body } = plan;
    if (
      writerHash(body) !== plan_id ||
      plan.env_id !== env ||
      plan.definition_sha256 !== writerHash(declared) ||
      plan.drop_indexes.length
    )
      throw new Error('Index plan changed');
    const completed = [],
      failed = [];
    for (const e of plan.entries) {
      try {
        if (
          (await api('DescribeDatabaseACL', { CollectionName: e.collection })).AclTag !==
          'ADMINONLY'
        )
          throw new Error('Collection is not private');
        const before = await api('DescribeTable', { TableName: e.collection });
        if (!before.Indexes.some((i) => indexMatches(i, e.spec)))
          await api('UpdateTable', { TableName: e.collection, CreateIndexes: [e.spec] });
        let after,
          matched = false;
        const until = Date.now() + 120000;
        while (Date.now() < until) {
          after = await api('DescribeTable', { TableName: e.collection });
          if (after.Indexes?.some((i) => indexMatches(i, e.spec))) {
            matched = true;
            break;
          }
          await new Promise((r) => setTimeout(r, 2000));
        }
        if (
          !matched ||
          e.existing_indexes.some(
            (i) =>
              !after.Indexes.some(
                (j) =>
                  j.Name === i.Name &&
                  JSON.stringify(j.Keys) === JSON.stringify(i.Keys) &&
                  j.Unique === i.Unique,
              ),
          )
        )
          throw new Error('Index readback or preserved indexes differ');
        completed.push({ collection: e.collection, name: e.spec.IndexName });
      } catch (error) {
        failed.push({
          collection: e.collection,
          name: e.spec.IndexName,
          code: error.operator_code ?? 'INDEX_CHECK_FAILED',
        });
      }
      console.log(
        JSON.stringify({
          checked: completed.length + failed.length,
          total: plan.entries.length,
          failed: failed.length,
        }),
      );
    }
    const proof = {
      env_id: env,
      plan_id,
      verified_indexes: completed,
      failed_indexes: failed,
      all_declared_indexes_verified: !failed.length,
      existing_indexes_preserved: true,
      documents_modified: false,
      recorded_at: new Date().toISOString(),
    };
    const file = resolve(args[1], '..', 'proof.json');
    await writeFile(file, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
    console.log(
      JSON.stringify({
        proof_file: file,
        verified: completed.length,
        failed: failed.length,
        indexes_dropped: 0,
        documents_modified: false,
      }),
    );
    if (failed.length) process.exitCode = 1;
  }
} catch (error) {
  console.error(
    JSON.stringify({
      error: 'Index provisioning stopped; no indexes dropped or documents changed',
      code: error.operator_code ?? 'INDEX_PLAN_FAILED',
    }),
  );
  process.exitCode = 1;
}
