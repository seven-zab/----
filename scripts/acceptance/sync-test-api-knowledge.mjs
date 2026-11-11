import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { build } from 'esbuild';
import { operatorSession, verifiedOperatorTarget } from '../lib/cloudbase-operator.mjs';
import { operatorWxDatabase } from '../lib/operator-wx-database.cjs';

const [mode, sourceHash, ...extra] = process.argv.slice(2);
if (!['--check', '--apply'].includes(mode) || !/^[a-f0-9]{64}$/u.test(sourceHash) || extra.length)
  throw new Error('Use --check or --apply followed by the reviewed release SHA-256');
const read = async (file) => JSON.parse(await readFile(file, 'utf8'));

async function main() {
  const env = await verifiedOperatorTarget();
  const config = await read('.cache/local-config/cloud-environment.json');
  const generated = await read('contracts/generated/knowledge-api.json');
  const release = await read('contracts/generated/release.json');
  if (
    config.last_code_deployment?.source_hash !== sourceHash ||
    generated.source_hash !== sourceHash ||
    release.source_hash !== sourceHash
  )
    throw new Error('The reviewed release must match the deployed and generated versions');
  const dir = resolve('.cache/knowledge-sync-probes', randomUUID());
  await mkdir(dir, { recursive: true });
  const bundle = await build({
    stdin: {
      contents: [
        'export { publishGeneratedKnowledge, chunkKnowledge } from "./server/modules/knowledge/service";',
        'export { cloudbaseRepository } from "./server/adapters/cloudbase-repository";',
        'export { fencedMaintenanceRepository } from "./server/maintenance/fenced-repository";',
        'export { hash } from "./server/core/hash";',
      ].join('\n'),
      resolveDir: process.cwd(),
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
  });
  const entry = resolve(dir, 'operator.cjs');
  await writeFile(entry, bundle.outputFiles[0].contents, { flag: 'wx' });
  const require = createRequire(import.meta.url);
  const {
    publishGeneratedKnowledge,
    chunkKnowledge,
    cloudbaseRepository,
    fencedMaintenanceRepository,
    hash,
  } = require(entry);
  const paired = createRequire(require.resolve('wx-server-sdk/package.json'));
  const sdk = paired('@cloudbase/node-sdk').init({
    env,
    ...(await operatorSession(env)),
    timeout: 15000,
  });
  const repo = fencedMaintenanceRepository(
    cloudbaseRepository(operatorWxDatabase(sdk.database({ throwOnNotFound: false }))),
  );
  const gate = await repo.get('system_guards', 'v2_migration');
  if (gate?.schema_version !== 2 || gate.status !== 'verified')
    throw new Error('Migration gate closed');

  const id = 'api-' + sourceHash;
  const expected = new Map(
    chunkKnowledge(generated.body_text).map((text, i) => [hash([id, 1, i]), text]),
  );
  if (expected.size < 1 || expected.size > 20)
    throw new Error('Generated document outside write budget');
  const existing = await repo.get('knowledge_documents', id);
  let writes = 0;
  const scoped = {
    ...repo,
    transaction: (work) =>
      repo.transaction((tx) =>
        work({
          ...tx,
          put: async (collection, row) => {
            const validDocument =
              collection === 'knowledge_documents' &&
              row._id === id &&
              row.source_type === 'generated_api' &&
              row.source_hash === sourceHash &&
              row.version === 1 &&
              row.status === 'published' &&
              row.fields?.body_text === generated.body_text;
            const validChunk =
              collection === 'knowledge_chunks' &&
              row.document_id === id &&
              row.version === 1 &&
              expected.get(row._id) === row.text;
            if (!validDocument && !validChunk)
              throw new Error('Generated knowledge write outside scope');
            await tx.put(collection, row);
            writes++;
          },
          remove: () => {
            throw new Error('Deletion is outside scope');
          },
        }),
      ),
  };
  if (mode === '--apply') {
    await publishGeneratedKnowledge(scoped, generated.body_text, sourceHash, Date.now());
    const firstWrites = writes;
    await publishGeneratedKnowledge(scoped, generated.body_text, sourceHash, Date.now());
    if (writes !== firstWrites) throw new Error('Repeat run rewrote knowledge');
  }
  const document = await repo.get('knowledge_documents', id);
  if (mode === '--apply' && !document) throw new Error('Published document is missing on readback');
  let chunks = 0;
  if (document) {
    if (
      document.source_hash !== sourceHash ||
      document.release_id !== 'v1-' + sourceHash ||
      document.source_type !== 'generated_api' ||
      document.status !== 'published' ||
      document.version !== 1 ||
      document.fields?.assistant_usage !== 'tool_reference' ||
      document.fields.body_text !== generated.body_text
    )
      throw new Error('Unexpected generated document on readback');
    const rows = await repo.find('knowledge_chunks', { document_id: id }, 21);
    if (
      rows.length !== expected.size ||
      rows.some((row) => row.version !== 1 || expected.get(row._id) !== row.text)
    )
      throw new Error('Generated chunks do not match readback');
    chunks = rows.length;
  }
  const proof = {
    source_hash: sourceHash,
    mode,
    env_id: env,
    existed: Boolean(existing),
    document_verified: Boolean(document),
    chunks,
    writes,
    recorded_at: new Date().toISOString(),
  };
  const file = resolve(dir, 'proof.json');
  await writeFile(file, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ ...proof, proof: file }));
}

try {
  await main();
} catch (error) {
  console.error('API knowledge sync stopped', error.name);
  process.exitCode = 1;
}
