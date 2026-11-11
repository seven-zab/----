import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { operatorJson, verifiedOperatorTarget } from './lib/cloudbase-operator.mjs';
import { apiTimeoutPlan, timeoutPayload } from './lib/function-timeouts.mjs';

const envHash = (c) =>
  createHash('sha256')
    .update(
      JSON.stringify(
        [...(c.Environment?.Variables ?? [])].sort((a, b) =>
          String(a.Key).localeCompare(String(b.Key)),
        ),
      ),
    )
    .digest('hex');
let stage = 'target';
let currentFunction = null;
const completed = [];
try {
  const flags = process.argv.slice(2);
  if (flags.length > 1 || flags.some((f) => f !== '--apply'))
    throw new Error('Invalid timeout command');
  const env = await verifiedOperatorTarget();
  const release = JSON.parse(await readFile('contracts/generated/release.json', 'utf8'));
  const read = (name) =>
    operatorJson(['fn', 'detail', name, '--env-id', env, '--region', 'ap-shanghai']);
  const configs = [];
  stage = 'configuration-preflight';
  for (const name of Object.values(release.targets)) {
    currentFunction = name;
    const deadline = Date.now() + 180000;
    let config;
    do {
      config = await read(name);
      if (config.Status !== 'Updating') break;
      await new Promise((done) => setTimeout(done, 2000));
    } while (Date.now() < deadline);
    configs.push(config);
  }
  const plan = apiTimeoutPlan(env, release.targets, configs);
  await mkdir('.cache/function-timeout-plans', { recursive: true });
  const file = resolve('.cache/function-timeout-plans', randomUUID() + '.json');
  await writeFile(
    file,
    JSON.stringify({ ...plan, source_hash: release.source_hash }, null, 2) + '\n',
    { flag: 'wx' },
  );
  if (!flags.includes('--apply'))
    console.log(JSON.stringify({ mode: 'dry-run', plan_file: file, changes: plan.changes.length }));
  else {
    for (const change of plan.changes) {
      currentFunction = change.FunctionName;
      const before = configs.find((c) => c.FunctionName === change.FunctionName);
      stage = 'timeout-update';
      await operatorJson([
        'api',
        'scf',
        'UpdateFunctionConfiguration',
        '--api-version',
        '2018-04-16',
        '--region',
        'ap-shanghai',
        '--body',
        JSON.stringify(timeoutPayload(change)),
      ]);
      let after;
      stage = 'configuration-readback';
      const deadline = Date.now() + 180000;
      do {
        after = await read(change.FunctionName);
        if (after.Status === 'Active' && after.Timeout === 30) break;
        await new Promise((done) => setTimeout(done, 2000));
      } while (Date.now() < deadline);
      if (
        after.Namespace !== env ||
        after.FunctionName !== change.FunctionName ||
        after.Timeout !== 30 ||
        after.Status !== 'Active' ||
        after.MemorySize !== before.MemorySize ||
        after.Runtime !== before.Runtime ||
        envHash(after) !== envHash(before)
      )
        throw new Error('Timeout readback or unchanged fields not verified');
      completed.push(change.FunctionName);
      await writeFile(
        file + '.result.json',
        JSON.stringify(
          {
            completed,
            database_writes: false,
            worker_configuration_changed: false,
            secret_values_included: false,
          },
          null,
          2,
        ) + '\n',
      );
      console.log(
        JSON.stringify({ timeout_verified: change.FunctionName, timeout: after.Timeout }),
      );
    }
    console.log(
      JSON.stringify({
        plan_file: file,
        updated: completed.length,
        database_writes: false,
        workers_changed: false,
        environment_variables_unchanged: true,
      }),
    );
  }
} catch {
  console.error(JSON.stringify({ stage, function_name: currentFunction, completed }));
  console.error(
    'API timeout setup stopped; raw configuration omitted; inspect local plan results for partial completion.',
  );
  process.exitCode = 1;
}
