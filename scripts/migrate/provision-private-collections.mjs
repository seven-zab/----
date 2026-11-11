import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import {
  verifiedOperatorTarget,
  operatorJson,
  collectionInventory,
} from '../lib/cloudbase-operator.mjs';
import { writerHash } from '../lib/migration-writers.mjs';
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));
let journal;
try {
  const args = process.argv.slice(2);
  if (args.length && !(args.length === 2 && args[0] === '--apply'))
    throw new Error('Use [--apply <plan.json>]');
  const env = await verifiedOperatorTarget();
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
  const required = await json('database/collections.json');
  const restore = await json(
    '.cache/restore-runs/16a11b50a9cc2d3cabd500281c0ba1b1c28b74a4e2eba4204e337ce8dd62e0e8/proof.json',
  );
  const retired = await json(
    '.cache/legacy-retirement/1aa7e239-d1ab-4ac0-a7b5-7aa276b9413a/proof.json',
  );
  if (
    restore.env_id !== env ||
    !restore.database_restore_verified ||
    !restore.original_collections_unchanged ||
    retired.env_id !== env ||
    !retired.old_writers_retired
  )
    throw new Error('Live recovery and retired old writers required');
  const inventory = await collectionInventory(env);
  if (!args.length) {
    const output = resolve('.cache/private-collection-plans', randomUUID());
    await mkdir(output, { recursive: true });
    const acls = [];
    for (const c of inventory) {
      const acl = await api('DescribeDatabaseACL', { CollectionName: c.name });
      if (!['ADMINONLY', 'READONLY', 'PRIVATE', 'ADMINWRITE', 'CUSTOM'].includes(acl.AclTag))
        throw new Error('Unknown ACL');
      acls.push({ collection: c.name, acl });
    }
    const body = {
      version: 1,
      env_id: env,
      inventory,
      required_collections: required.collections,
      create: required.collections.filter((n) => !inventory.some((c) => c.name === n)),
      restrict: acls.filter((c) => c.acl.AclTag !== 'ADMINONLY').map((c) => c.collection),
      original_acl_backup: acls,
      restore_plan_id: restore.plan_id,
      retirement_plan_id: retired.plan_id,
      target_acl: 'ADMINONLY',
      document_changes: false,
      created_at: new Date().toISOString(),
    };
    const plan = { ...body, plan_id: writerHash(body) };
    const file = resolve(output, 'plan.json');
    await writeFile(file, JSON.stringify(plan, null, 2) + '\n', { flag: 'wx' });
    console.log(
      JSON.stringify({
        plan_file: file,
        create_private_collections: plan.create.length,
        restrict_existing_collections: plan.restrict.length,
        documents_modified: false,
        cloud_changes: false,
      }),
    );
  } else {
    const plan = await json(args[1]),
      { plan_id, ...body } = plan;
    if (
      writerHash(body) !== plan_id ||
      plan.env_id !== env ||
      plan.target_acl !== 'ADMINONLY' ||
      JSON.stringify(required.collections) !== JSON.stringify(plan.required_collections) ||
      writerHash(inventory) !== writerHash(plan.inventory)
    )
      throw new Error('Collection plan, inventory or schema changed');
    const aclHash = (a) => writerHash({ AclTag: a.AclTag, Rule: a.Rule ?? null });
    for (const c of plan.original_acl_backup)
      if (
        aclHash(await api('DescribeDatabaseACL', { CollectionName: c.collection })) !==
        aclHash(c.acl)
      )
        throw new Error('ACL changed since backup');
    const described = await api('DescribeEnvs', {});
    const instance = described.EnvList?.find((e) => e.EnvId === env)?.Databases?.[0]?.InstanceId;
    if (!instance) throw new Error('No database instance');
    const output = resolve(args[1], '..');
    journal = resolve(output, 'status.json');
    const completed = [];
    await writeFile(journal, JSON.stringify({ status: 'started', plan_id }));
    for (const name of plan.restrict) {
      await api('ModifyDatabaseACL', { CollectionName: name, AclTag: 'ADMINONLY' });
      if ((await api('DescribeDatabaseACL', { CollectionName: name })).AclTag !== 'ADMINONLY')
        throw new Error('Restricted ACL did not read back');
      completed.push({ collection: name, action: 'restricted' });
      await writeFile(journal, JSON.stringify({ status: 'running', plan_id, completed }));
      console.log(
        JSON.stringify({
          restricted: completed.length,
          required_restrictions: plan.restrict.length,
        }),
      );
    }
    for (const name of plan.create) {
      if (!/^[a-z][a-z0-9_]{0,79}$/u.test(name)) throw new Error('Invalid new collection');
      await api('CreateTable', {
        Tag: instance,
        TableName: name,
        PermissionInfo: { EnvId: env, AclTag: 'ADMINONLY' },
      });
      if ((await api('DescribeDatabaseACL', { CollectionName: name })).AclTag !== 'ADMINONLY')
        throw new Error('New private ACL did not read back');
      completed.push({ collection: name, action: 'created' });
      await writeFile(journal, JSON.stringify({ status: 'running', plan_id, completed }));
      console.log(
        JSON.stringify({
          created: completed.filter((c) => c.action === 'created').length,
          required_creations: plan.create.length,
        }),
      );
    }
    const final = await collectionInventory(env);
    if (
      final.length !== inventory.length + plan.create.length ||
      plan.required_collections.some((n) => !final.some((c) => c.name === n))
    )
      throw new Error('Collection reconciliation failed');
    for (const c of final)
      if ((await api('DescribeDatabaseACL', { CollectionName: c.name })).AclTag !== 'ADMINONLY')
        throw new Error('Private ACL final verification failed');
    const proof = {
      version: 1,
      env_id: env,
      plan_id,
      total_collections: final.length,
      required_collections: plan.required_collections.length,
      created: plan.create.length,
      restricted: plan.restrict.length,
      all_collections_adminonly: true,
      documents_modified: false,
      indexes_verified: false,
      recorded_at: new Date().toISOString(),
    };
    await writeFile(resolve(output, 'proof.json'), JSON.stringify(proof, null, 2) + '\n', {
      flag: 'wx',
    });
    await writeFile(
      journal,
      JSON.stringify({ status: 'private_collections_verified', plan_id, completed }),
    );
    console.log(JSON.stringify({ ...proof, proof_file: resolve(output, 'proof.json') }));
  }
} catch (error) {
  if (journal)
    await writeFile(
      journal,
      JSON.stringify({ status: 'stopped_requires_review', raw_errors_omitted: true }),
    );
  console.error(
    JSON.stringify({
      error: 'Private collection provisioning stopped; no documents were deleted or replaced',
      code: error.operator_code ?? 'PROVISIONING_FAILED',
    }),
  );
  process.exitCode = 1;
}
