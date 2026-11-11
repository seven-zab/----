import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { operatorJson } from './cloudbase-operator.mjs';
export const legacyFunctionNames = [
  'aiChat',
  'demandService',
  'initAdmin',
  'initDatabase',
  'login',
  'permission',
  'register',
  'sendMessage',
  'sms',
  'task',
];
export const writerHash = (value) =>
  createHash('sha256')
    .update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value))
    .digest('hex');
export const retiredSource = (planId) =>
  `// Legacy entry retired by the controlled v2 migration preparation.\nexports.main = async () => (${JSON.stringify(
    {
      code: 400,
      error_code: 'ACTION_RETIRED',
      msg: '旧版接口已停用，请更新小程序',
      data: null,
      retirement_id: planId,
    },
  )});\n`;
export function assertRetirementInvocation(response, planId) {
  const r = response?.Result;
  if (!r || r.ErrMsg || r.FunctionError || (r.RetCode !== undefined && r.RetCode !== 0))
    throw new Error('Retired function invocation failed');
  const result = JSON.parse(r.RetMsg ?? 'null');
  if (result?.retirement_id !== planId || result.error_code !== 'ACTION_RETIRED')
    throw new Error('Retired function invocation did not match');
}
export const scfCall = (env, action, body = {}) =>
  operatorJson([
    'api',
    'scf',
    action,
    '--env-id',
    env,
    '--api-version',
    '2018-04-16',
    '--region',
    'ap-shanghai',
    '--body',
    JSON.stringify({ Namespace: env, ...body }),
  ]);
export async function listFunctions(env) {
  const rows = [],
    seen = new Set();
  let total;
  for (let offset = 0; offset < 10000; offset += 100) {
    const r = await scfCall(env, 'ListFunctions', { Offset: offset, Limit: 100 });
    if (
      !Array.isArray(r.Functions) ||
      !Number.isSafeInteger(r.TotalCount) ||
      r.TotalCount < 0 ||
      (total !== undefined && r.TotalCount !== total)
    )
      throw new Error('Function inventory is incomplete or changed');
    total = r.TotalCount;
    for (const f of r.Functions) {
      if (
        f.Namespace !== env ||
        !/^[A-Za-z][A-Za-z0-9_-]{0,79}$/u.test(f.FunctionName) ||
        seen.has(f.FunctionName)
      )
        throw new Error('Unexpected function identity');
      seen.add(f.FunctionName);
      rows.push(f);
    }
    if (rows.length === total)
      return rows.sort((a, b) => a.FunctionName.localeCompare(b.FunctionName));
    if (!r.Functions.length || rows.length > total) throw new Error('Truncated function inventory');
  }
  throw new Error('Function inventory budget exceeded');
}
export function assertFunctionScope(functions, release) {
  const expected = [
    ...legacyFunctionNames,
    ...Object.values({ ...release.targets, ...release.workers }),
  ].sort();
  if (JSON.stringify(functions.map((f) => f.FunctionName).sort()) !== JSON.stringify(expected))
    throw new Error('Unreviewed function writer exists or expected writer is missing');
}
export async function latestOnly(env, name) {
  const versions = await scfCall(env, 'ListVersionByFunction', {
    FunctionName: name,
    Offset: 0,
    Limit: 100,
  });
  const aliases = await scfCall(env, 'ListAliases', { FunctionName: name });
  if (
    versions.TotalCount !== 1 ||
    versions.Versions?.length !== 1 ||
    versions.Versions[0].Version !== '$LATEST'
  )
    throw new Error('Published old function versions require separate retirement');
  if (
    !Array.isArray(aliases.Aliases) ||
    aliases.TotalCount !== aliases.Aliases.length ||
    aliases.Aliases.some(
      (a) =>
        a.FunctionVersion !== '$LATEST' ||
        (a.RoutingConfig?.AdditionalVersionWeights &&
          Object.keys(a.RoutingConfig.AdditionalVersionWeights).length),
    )
  )
    throw new Error('Function alias has an uncovered old version');
  return {
    versions: ['$LATEST'],
    aliases: aliases.Aliases.map((a) => ({ name: a.Name, version: a.FunctionVersion })),
  };
}
export async function downloadFunctionZip(env, name) {
  const r = await scfCall(env, 'GetFunctionAddress', { FunctionName: name });
  const url = new URL(r.Url);
  if (url.protocol !== 'https:' || !/(?:\.myqcloud\.com|\.tencentcos\.cn)$/u.test(url.hostname))
    throw new Error('Unexpected code download origin');
  const response = await fetch(url, { signal: AbortSignal.timeout(30000), redirect: 'error' });
  if (!response.ok) throw new Error('Code archive download failed');
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 64 * 1024 * 1024) throw new Error('Code archive budget exceeded');
    chunks.push(chunk);
  }
  return { bytes: Buffer.concat(chunks), cloud_code_sha256: r.CodeSha256 };
}
