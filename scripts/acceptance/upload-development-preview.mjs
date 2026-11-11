import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import process from 'node:process';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.test', quiet: true });
const sha = (b) => createHash('sha256').update(b).digest('hex');
const [reviewFile, expectedHash, ...flags] = process.argv.slice(2);
if (!reviewFile || !expectedHash || flags.some((f) => f !== '--apply') || flags.length > 1)
  throw new Error('Use <review.json> <reviewed-manifest-sha256> [--apply]');
const review = JSON.parse(await readFile(reviewFile, 'utf8'));
const release = JSON.parse(await readFile('contracts/generated/release.json', 'utf8'));
if (
  review.source_hash !== release.source_hash ||
  review.cloud_functions_included !== false ||
  review.app_id !== 'wxbb2c6c85fd8c180d' ||
  review.manifest_sha256 !== expectedHash ||
  sha(JSON.stringify(review.files)) !== expectedHash ||
  review.files.length !== review.client_files ||
  review.files.length > 200 ||
  review.client_bytes > 2 * 1024 * 1024 ||
  review.bounded_static_scan_findings?.length
)
  throw new Error('Unreviewed client scope');
const root = dirname(resolve(reviewFile));
for (const f of review.files) {
  if (
    !/^[A-Za-z0-9_./-]+$/u.test(f.path) ||
    f.path.split('/').includes('..') ||
    f.path.startsWith('/') ||
    f.path.startsWith('cloudfunctions/')
  )
    throw new Error('Invalid client path');
  const bytes = await readFile(join(root, 'project', f.path));
  if (bytes.length !== f.bytes || sha(bytes) !== f.sha256) throw new Error('Client changed');
}
const build = JSON.parse(await readFile(join(root, 'project/build-info.json'), 'utf8'));
const config = JSON.parse(await readFile(join(root, 'project/project.config.json'), 'utf8'));
if (
  build.mode !== 'test' ||
  build.source_hash !== release.source_hash ||
  build.cloud_env_id !== 'cloud1-2gfqlz9d8ee804d7' ||
  config.appid !== review.app_id
)
  throw new Error('Unexpected upload target');
if (!flags.includes('--apply'))
  console.log(
    JSON.stringify({
      verified: true,
      client_files: review.client_files,
      manifest_sha256: expectedHash,
      uploaded: false,
    }),
  );
else {
  const dir = join(root, 'preview-' + randomUUID());
  const project = join(dir, 'project');
  await mkdir(project, { recursive: true });
  for (const f of review.files) {
    await mkdir(resolve(project, f.path, '..'), { recursive: true });
    await copyFile(join(root, 'project', f.path), join(project, f.path));
  }
  const require = createRequire(import.meta.url);
  const { runWechatCli } = require('../lib/wechat-cli.cjs');
  const result = await runWechatCli(
    process.env.WECHAT_CLI_PATH,
    [
      'preview',
      '--project',
      project,
      '--qr-format',
      'image',
      '--qr-output',
      join(dir, 'preview.jpg'),
      '--info-output',
      join(dir, 'preview-info.json'),
    ],
    120000,
  );
  await writeFile(join(dir, 'cli.log'), result.stdout + result.stderr);
  await readFile(join(dir, 'preview.jpg'));
  for (const f of review.files)
    if (sha(await readFile(join(project, f.path))) !== f.sha256)
      throw new Error('Uploaded file changed');
  const info = JSON.parse(await readFile(join(dir, 'preview-info.json'), 'utf8'));
  const proof = {
    source_hash: release.source_hash,
    manifest_sha256: expectedHash,
    client_files: review.client_files,
    client_bytes: review.client_bytes,
    packed_bytes: info.size,
    app_id: review.app_id,
    development_preview: true,
    cloud_functions_included: false,
    qr: join(dir, 'preview.jpg'),
    recorded_at: new Date().toISOString(),
  };
  await writeFile(join(dir, 'proof.json'), JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify(proof));
}
