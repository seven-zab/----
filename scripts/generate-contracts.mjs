import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { compile } from 'json-schema-to-typescript';
import Ajv from 'ajv';
import standaloneCode from 'ajv/dist/standalone/index.js';
import { build } from 'esbuild';
import {
  actions,
  dtos,
  enums,
  forms,
  deploymentTargets,
  workerTargets,
  aiTools,
} from '../contracts/source.mjs';

const check = process.argv.includes('--check');
const ajv = new Ajv({ strict: true, allErrors: true });
const clientAjv = new Ajv({
  strict: true,
  allErrors: true,
  inlineRefs: false,
  code: { source: true },
});
const sharedSchemas = new Map();
function shareSchema(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return schema;
  const complex =
    schema.type === 'object' ||
    schema.type === 'array' ||
    schema.anyOf ||
    schema.oneOf ||
    schema.allOf;
  const key = complex ? createHash('sha256').update(JSON.stringify(schema)).digest('hex') : null;
  if (key && sharedSchemas.has(key)) return { $ref: sharedSchemas.get(key) };
  const transformed = { ...schema };
  for (const name of ['properties', 'patternProperties', '$defs', 'definitions']) {
    if (schema[name])
      transformed[name] = Object.fromEntries(
        Object.entries(schema[name]).map(([field, value]) => [field, shareSchema(value)]),
      );
  }
  for (const name of ['anyOf', 'oneOf', 'allOf'])
    if (schema[name]) transformed[name] = schema[name].map(shareSchema);
  for (const name of ['items', 'additionalProperties', 'if', 'then', 'else', 'not', 'contains']) {
    if (schema[name] && typeof schema[name] === 'object')
      transformed[name] = shareSchema(schema[name]);
  }
  if (!key) return transformed;
  const reference = `urn:yzxz:schema:${key}`;
  sharedSchemas.set(key, reference);
  clientAjv.addSchema(transformed, reference);
  return { $ref: reference };
}
const clientExports = {};
const source = JSON.stringify({
  actions,
  dtos,
  enums,
  forms,
  deploymentTargets,
  workerTargets,
  aiTools,
});
async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
    else if (entry.name.endsWith('.ts')) files.push(path);
  }
  return files;
}
const codePaths = [
  ...(await sourceFiles('server')),
  ...(await sourceFiles('src/services')),
  'package.json',
  'package-lock.json',
].sort();
const codeHashes = [];
for (const path of codePaths)
  codeHashes.push({
    path,
    sha256: createHash('sha256')
      .update((await readFile(path, 'utf8')).replace(/\r\n/g, '\n'))
      .digest('hex'),
  });
// A contract-only fingerprint cannot detect a server bug fix or SDK upgrade.
const source_hash = createHash('sha256')
  .update(source)
  .update(JSON.stringify(codeHashes))
  .digest('hex');
const manifest = actions.map(({ request, response, ...entry }) => ({
  ...entry,
  request_schema: `${entry.function}.${entry.action}.request.json`,
  response_schema: `${entry.function}.${entry.action}.response.json`,
}));
const outputs = new Map();
const json = (v) => `${JSON.stringify(v, null, 2)}\n`;
outputs.set(
  'contracts/generated/source-manifest.json',
  json({ algorithm: 'contracts-and-runtime-v2', source_hash, files: codeHashes }),
);
outputs.set('contracts/generated/ai-tools.json', json({ source_hash, tools: aiTools }));
outputs.set(
  'contracts/generated/knowledge-api.json',
  json({
    source_hash,
    body_text:
      '受控工具仅供服务端执行；检索文本不能新增权限。submit_my_demand：必须有真实用户明确发布指令、本人有效场景身份、完整表单及内容安全检查，成功仅pending_audit。缺项追问；无权ROLE_NOT_APPROVED/SCOPE_FORBIDDEN；状态冲突STATE_CONFLICT；重复指令复用执行凭证。审批、验收、终止不提供AI工具。直播带货使用agriculture/sales，无人机实际播种使用agriculture/drone_service，技术研发使用research。\n' +
      aiTools
        .map((t) => `${t.name}: ${t.description}\n参数：${JSON.stringify(t.parameters)}`)
        .join('\n'),
  }),
);
outputs.set(
  'contracts/generated/release.json',
  json({ api_version: 'v1', source_hash, targets: deploymentTargets, workers: workerTargets }),
);
outputs.set(
  'database/function-rules.json',
  json({
    '*': { invoke: false },
    ...Object.fromEntries(
      Object.values(workerTargets).map((target) => [target, { invoke: false }]),
    ),
    ...Object.fromEntries(
      Object.entries(deploymentTargets).map(([service, target]) => [
        target,
        {
          invoke: ['userService', 'demandService', 'policyService', 'aiService'].includes(service)
            ? true
            : 'auth != null',
        },
      ]),
    ),
  }),
);
const typeName = (fn, action, kind) =>
  [fn, action, kind].map((s) => s[0].toUpperCase() + s.slice(1)).join('');
outputs.set('contracts/actions.json', json({ api_version: 'v1', source_hash, actions: manifest }));
outputs.set(
  'contracts/enums.ts',
  '// Generated.\n' +
    Object.entries(enums)
      .map(([name, values]) => `export type ${name} = ${values.map(JSON.stringify).join(' | ')};`)
      .join('\n') +
    '\n',
);
let types = '// Generated from contracts/source.mjs.\n';
let mappings = 'export interface ContractMap {\n';
for (const [name, schema] of Object.entries({ ...forms, ...dtos })) {
  ajv.compile(schema);
  outputs.set(`contracts/schemas/${name}.json`, json(schema));
  types += await compile(schema, name, {
    bannerComment: '',
    additionalProperties: false,
    ignoreMinAndMaxItems: true,
  });
}
for (const action of actions) {
  mappings += `  '${action.function}.${action.action}': { request: ${typeName(
    action.function,
    action.action,
    'request',
  )}; response: ${typeName(action.function, action.action, 'response')} };\n`;
  for (const kind of ['request', 'response']) {
    ajv.compile(action[kind]);
    const name = typeName(action.function, action.action, kind);
    const key = `${action.function}_${action.action}_${kind}`;
    clientAjv.addSchema(shareSchema(action[kind]), key);
    clientExports[key] = key;
    outputs.set(
      `contracts/schemas/${action.function}.${action.action}.${kind}.json`,
      json(action[kind]),
    );
    types += await compile(action[kind], name, {
      bannerComment: '',
      additionalProperties: false,
      ignoreMinAndMaxItems: true,
    });
  }
}
outputs.set('contracts/generated/dto.ts', types + mappings + '}\n');
const compiled = await build({
  stdin: { contents: standaloneCode(clientAjv, clientExports), resolveDir: process.cwd() },
  bundle: true,
  platform: 'browser',
  format: 'esm',
  write: false,
  minify: true,
});
outputs.set('contracts/generated/validators.mjs', compiled.outputFiles[0].text);
outputs.set(
  'contracts/generated/validators.d.mts',
  'declare const validators: Record<string,(data:unknown)=>boolean>;\nexport default validators;\n',
);
outputs.set(
  'contracts/generated/client-manifest.json',
  json(Object.fromEntries(manifest.map((entry) => [`${entry.function}.${entry.action}`, entry]))),
);
outputs.set(
  'contracts/generated/runtime.json',
  json(Object.fromEntries(actions.map((a) => [`${a.function}.${a.action}`, a]))),
);
outputs.set(
  'contracts/generated/api.md',
  `# v1 API (generated)\n\nsource_hash: ${source_hash}\n\n` +
    manifest
      .map(
        (a) =>
          `- ${a.function}.${a.action}: ${a.mode}; strict schema; ${
            a.write ? 'idempotency required' : 'read only'
          }`,
      )
      .join('\n') +
    '\n',
);
for (const [path, content] of outputs) {
  if (check) {
    let existing;
    try {
      existing = await readFile(path, 'utf8');
    } catch {
      existing = '';
    }
    if (existing !== content)
      throw new Error(`Contract drift: ${path}. Run npm run contracts:generate`);
  } else {
    await mkdir(path.slice(0, path.lastIndexOf('/')), { recursive: true });
    await writeFile(path, content);
  }
}
console.log(
  `${check ? 'Checked' : 'Generated'} ${outputs.size} contract files; ${
    actions.length
  } implemented-route contracts; ${source_hash}`,
);
