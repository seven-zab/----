import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { verifiedOperatorTarget, operatorJson } from '../lib/cloudbase-operator.mjs';
import {
  legacyFunctionNames,
  writerHash,
  retiredSource,
  scfCall,
  listFunctions,
  assertFunctionScope,
  latestOnly,
  downloadFunctionZip,
  assertRetirementInvocation,
} from '../lib/migration-writers.mjs';
const require = createRequire(import.meta.url);
const unzipper = require('unzipper'),
  archiver = require('archiver');
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));
const zipEntry = async (bytes) => {
  const zip = await unzipper.Open.buffer(bytes);
  const entry = zip.files.find((f) => f.path === 'index.js');
  if (!entry || entry.uncompressedSize > 10 * 1024 * 1024)
    throw new Error('Function index backup is missing');
  return entry.buffer();
};
let journal, currentFunction;
const completed = [];
try {
  const args = process.argv.slice(2);
  if (args.length && !(args.length === 2 && args[0] === '--apply'))
    throw new Error('Use [--apply <saved-plan.json>]');
  const env = await verifiedOperatorTarget();
  const release = await json('contracts/generated/release.json');
  const functions = await listFunctions(env);
  assertFunctionScope(functions, release);
  if (!args.length) {
    const output = resolve('.cache/legacy-retirement', randomUUID());
    await mkdir(output, { recursive: true });
    const entries = [];
    for (const name of legacyFunctionNames) {
      const routing = await latestOnly(env, name);
      const detail = await operatorJson([
        'fn',
        'detail',
        name,
        '--env-id',
        env,
        '--region',
        'ap-shanghai',
      ]);
      if (
        detail.FunctionName !== name ||
        detail.Namespace !== env ||
        !Number.isSafeInteger(detail.Timeout) ||
        detail.Timeout < 1 ||
        detail.Timeout > 900
      )
        throw new Error('Function drain budget cannot be verified');
      const backup = await downloadFunctionZip(env, name);
      const entry = await zipEntry(backup.bytes);
      if (!entry.length) throw new Error('Empty function backup');
      const file = `${name}.zip`;
      await writeFile(resolve(output, file), backup.bytes, { flag: 'wx' });
      entries.push({
        name,
        file,
        archive_sha256: writerHash(backup.bytes),
        entry_sha256: writerHash(entry),
        cloud_code_sha256: backup.cloud_code_sha256,
        timeout_seconds: detail.Timeout,
        runtime: detail.Runtime,
        handler: detail.Handler,
        ...routing,
      });
      console.log(
        JSON.stringify({ backups_verified: entries.length, total: legacyFunctionNames.length }),
      );
    }
    const body = {
      version: 1,
      env_id: env,
      source_hash: release.source_hash,
      functions: entries,
      all_function_names: functions.map((f) => f.FunctionName).sort(),
      records_modified: false,
      workers_enabled: false,
      created_at: new Date().toISOString(),
    };
    const plan = { ...body, plan_id: writerHash(body) };
    const file = resolve(output, 'plan.json');
    await writeFile(file, JSON.stringify(plan, null, 2) + '\n', { flag: 'wx' });
    console.log(
      JSON.stringify({
        mode: 'dry-run',
        plan_file: file,
        legacy_functions: entries.length,
        backup_complete: true,
        cloud_code_changed: false,
      }),
    );
  } else {
    const path = await realpath(args[1]),
      cache = await realpath('.cache/legacy-retirement');
    const rel = relative(cache, path);
    if (isAbsolute(rel) || rel.startsWith('..') || !rel)
      throw new Error('Plan must be in the ignored retirement directory');
    const plan = await json(path),
      { plan_id, ...body } = plan;
    if (
      writerHash(body) !== plan_id ||
      plan.env_id !== env ||
      plan.source_hash !== release.source_hash ||
      JSON.stringify(plan.functions.map((f) => f.name)) !== JSON.stringify(legacyFunctionNames) ||
      JSON.stringify(plan.all_function_names) !==
        JSON.stringify(functions.map((f) => f.FunctionName).sort())
    )
      throw new Error('Retirement plan or target changed');
    const output = resolve(path, '..');
    journal = resolve(output, 'status.json');
    for (const item of plan.functions)
      if (writerHash(await readFile(resolve(output, item.file))) !== item.archive_sha256)
        throw new Error('Backup archive checksum mismatch');
    const source = retiredSource(plan_id);
    const zip = await new Promise((resolve, reject) => {
      const chunks = [],
        archive = archiver('zip', { zlib: { level: 9 } });
      archive.on('data', (c) => chunks.push(c));
      archive.on('error', reject);
      archive.on('end', () => resolve(Buffer.concat(chunks)));
      archive.append(source, { name: 'index.js', date: new Date('2026-01-01T00:00:00Z') });
      archive.finalize();
    });
    await writeFile(journal, JSON.stringify({ status: 'retiring', plan_id, completed }));
    for (const item of plan.functions) {
      currentFunction = item.name;
      await latestOnly(env, item.name);
      const current = await downloadFunctionZip(env, item.name);
      const currentSource = await zipEntry(current.bytes);
      if (currentSource.toString('utf8') !== source) {
        if (writerHash(current.bytes) !== item.archive_sha256)
          throw new Error('Original function changed after backup');
        await scfCall(env, 'UpdateFunctionCode', {
          FunctionName: item.name,
          Handler: 'index.main',
          ZipFile: zip.toString('base64'),
        });
        const deadline = Date.now() + 180000;
        let active = false;
        while (Date.now() < deadline) {
          const d = await operatorJson([
            'fn',
            'detail',
            item.name,
            '--env-id',
            env,
            '--region',
            'ap-shanghai',
          ]);
          if (d.Status === 'Active') {
            active = true;
            break;
          }
          await new Promise((r) => setTimeout(r, 2000));
        }
        if (!active) throw new Error('Retired function did not become Active');
      }
      const after = await downloadFunctionZip(env, item.name);
      if ((await zipEntry(after.bytes)).toString('utf8') !== source)
        throw new Error('Retired code readback differs');
      const invoked = await scfCall(env, 'Invoke', {
        FunctionName: item.name,
        InvocationType: 'RequestResponse',
        ClientContext: '{}',
      });
      assertRetirementInvocation(invoked, plan_id);
      completed.push({
        name: item.name,
        entry_sha256: writerHash(source),
        cloud_code_sha256: after.cloud_code_sha256,
      });
      await writeFile(journal, JSON.stringify({ status: 'retiring', plan_id, completed }));
      console.log(
        JSON.stringify({ functions_retired: completed.length, total: plan.functions.length }),
      );
    }
    // Active means the new entry is published. Allow the maximum pre-existing
    // request execution budget to expire before claiming old writers drained.
    const drain = Math.max(...plan.functions.map((f) => f.timeout_seconds)) * 1000 + 5000;
    const until = Date.now() + drain;
    while (Date.now() < until) {
      console.log(
        JSON.stringify({
          phase: 'draining_old_requests',
          remaining_seconds: Math.ceil((until - Date.now()) / 1000),
        }),
      );
      await new Promise((r) => setTimeout(r, Math.min(10000, until - Date.now())));
    }
    assertFunctionScope(await listFunctions(env), release);
    const proof = {
      version: 1,
      env_id: env,
      plan_id,
      functions: completed,
      drain_wait_ms: drain,
      old_writers_retired: true,
      client_write_rules_verified: false,
      full_migration_fence_verified: false,
      records_modified: false,
      recorded_at: new Date().toISOString(),
    };
    await writeFile(resolve(output, 'proof.json'), JSON.stringify(proof, null, 2) + '\n', {
      flag: 'wx',
    });
    await writeFile(journal, JSON.stringify({ status: 'retired_and_drained', plan_id, completed }));
    console.log(
      JSON.stringify({
        proof_file: resolve(output, 'proof.json'),
        old_writers_retired: true,
        full_migration_fence_verified: false,
        records_modified: false,
      }),
    );
  }
} catch (error) {
  if (journal)
    await writeFile(
      journal,
      JSON.stringify({
        status: 'stopped_requires_review',
        function: currentFunction,
        completed,
        raw_errors_omitted: true,
      }),
    );
  console.error(
    JSON.stringify({
      error: 'Legacy retirement stopped; no database data changed; review saved backups and status',
      code: error.operator_code ?? 'RETIREMENT_FAILED',
    }),
  );
  process.exitCode = 1;
}
