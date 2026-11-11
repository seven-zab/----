import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import process from 'node:process';
import dotenv from 'dotenv';
import { verifiedOperatorTarget } from '../lib/cloudbase-operator.mjs';
import { downloadFunctionBackup } from '../lib/download-function-backup.mjs';
import { assertDependencyLock, assertSdkSerializationParity } from '../lib/dependency-lock.mjs';

dotenv.config({ path: '.env.test', quiet: true });
if (process.argv.slice(2).join(' ') !== '--capture-readonly')
  throw new Error('Read-only flag required');
const require = createRequire(import.meta.url);
const { runWechatCli } = require('../lib/wechat-cli.cjs');
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const env = await verifiedOperatorTarget();
const release = await readJson('contracts/generated/release.json');
const deployment = await readJson('dist/cloudfunctions/deployment.json');
const reference = await readJson('package-lock.json');
const config = await readJson('.cache/local-config/cloud-environment.json');
if (deployment.source_hash !== release.source_hash || config.env_id !== env)
  throw new Error('Current deployment and verified environment required');
const targets = Object.entries({ ...release.targets, ...release.workers });
if (targets.length !== 14 || deployment.functions.length !== targets.length)
  throw new Error('Unexpected function count');
const dir = resolve('.cache/function-dependency-audits', randomUUID());
await mkdir(dir, { recursive: true });
const checks = [];
// Independent read-only downloads; each receives its own nonexistent leaf path.
for (let offset = 0; offset < targets.length; offset += 3) {
  const batch = await Promise.allSettled(
    targets.slice(offset, offset + 3).map(async ([service, name]) => {
      const result = { service, passed: false };
      try {
        const artifact = deployment.functions.find((f) => f.service === service && f.name === name);
        if (!artifact || !/^yzxz_v2_[A-Za-z]+$/u.test(name)) throw new Error('Invalid target');
        const { directory, entry } = await downloadFunctionBackup(dir, name, (destination) =>
          runWechatCli(process.env.WECHAT_CLI_PATH, [
            'cloud',
            'functions',
            'download',
            '--name',
            name,
            '--path',
            destination,
            '--env',
            env,
            '--appid',
            config.app_id,
          ]),
        );
        result.code_sha256 = sha(entry);
        if (result.code_sha256 !== artifact.sha256) throw new Error('Runtime code mismatch');
        const manifest = await readJson(join(directory, 'package.json'));
        const lock = await readJson(join(directory, 'package-lock.json'));
        assertDependencyLock(manifest, lock, name);
        assertSdkSerializationParity(reference, lock, name);
        result.versions = {};
        for (const dependency of [
          'wx-server-sdk',
          '@cloudbase/node-sdk',
          'protobufjs',
          '@protobufjs/utf8',
        ]) {
          const installed = await readJson(
            join(directory, 'node_modules', dependency, 'package.json'),
          );
          const expected = reference.packages[`node_modules/${dependency}`]?.version;
          if (!expected || installed.version !== expected)
            throw new Error('Installed package mismatch');
          result.versions[dependency] = installed.version;
        }
        // A patched hoisted decoder must not hide an older nested installed copy.
        for (const name of ['protobufjs', '@protobufjs/utf8'])
          for (const location of Object.keys(lock.packages).filter((p) =>
            p.endsWith('/node_modules/' + name),
          )) {
            if (!location.startsWith('node_modules/') || location.split('/').includes('..'))
              throw new Error('Invalid runtime dependency path');
            const nested = await readJson(join(directory, location, 'package.json'));
            if (nested.version !== result.versions[name])
              throw new Error('Nested serializer mismatch');
          }
        result.lock_sha256 = sha(await readFile(join(directory, 'package-lock.json')));
        result.passed = true;
      } catch (error) {
        result.error_category = /^[A-Za-z]{1,40}$/u.test(error?.name ?? '') ? error.name : 'Error';
      }
      return result;
    }),
  );
  for (const [index, item] of batch.entries())
    checks.push(
      item.status === 'fulfilled'
        ? item.value
        : {
            service: targets[offset + index][0],
            passed: false,
            error_category: 'Rejected',
          },
    );
  console.log(JSON.stringify({ checked: checks.length, total: targets.length }));
}
const proof = {
  env_id: env,
  source_hash: release.source_hash,
  recorded_at: new Date().toISOString(),
  read_only: true,
  installed_packages_verified: checks.length === targets.length && checks.every((c) => c.passed),
  passed: checks.length === targets.length && checks.every((c) => c.passed),
  checks,
};
await writeFile(join(dir, 'proof.json'), JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(
  JSON.stringify({ proof: join(dir, 'proof.json'), passed: proof.passed, checked: checks.length }),
);
if (!proof.passed) process.exitCode = 1;
