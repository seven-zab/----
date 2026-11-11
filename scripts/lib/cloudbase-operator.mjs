import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { assertIndependentTestTarget } from './test-environment-policy.mjs';

function responseErrorCode(value) {
  const code =
    value?.error?.code ??
    value?.Error?.Code ??
    value?.data?.Error?.Code ??
    value?.Response?.Error?.Code;
  return typeof code === 'string' && /^[A-Za-z][A-Za-z0-9_.-]{0,99}$/u.test(code)
    ? code
    : undefined;
}
export class OperatorAccessError extends Error {
  constructor(code) {
    super('Official operator access failed; raw output omitted');
    this.name = 'OperatorAccessError';
    this.operator_code = code;
  }
}

export function parseOperatorJson(stdout) {
  const start = stdout.indexOf('{');
  try {
    const value = JSON.parse(stdout.slice(start));
    const code = responseErrorCode(value);
    if (code) throw new OperatorAccessError(code);
    if (
      start < 0 ||
      !value ||
      typeof value !== 'object' ||
      value.error ||
      value.Error ||
      value.data?.Error ||
      value.Response?.Error
    )
      throw new Error();
    return value.data ?? value.Response ?? value;
  } catch (error) {
    if (error instanceof OperatorAccessError) throw error;
    throw new Error('Official operator response is invalid; raw output omitted');
  }
}
export async function operatorJson(args) {
  const entry = resolve('.cache/operator-tools/node_modules/@cloudbase/cli/bin/tcb');
  try {
    const pkg = JSON.parse(await readFile(resolve(entry, '../../package.json'), 'utf8'));
    if (pkg.version !== '3.8.10' || pkg.name !== '@cloudbase/cli') throw new Error();
    const result = await promisify(execFile)(process.execPath, [entry, ...args, '--json'], {
      windowsHide: true,
      timeout: 30000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return parseOperatorJson(result.stdout);
  } catch (error) {
    if (error instanceof OperatorAccessError) throw error;
    // An official CLI can exit nonzero with a JSON error response. Preserve only
    // the bounded machine code, never its message, command, tokens or raw output.
    if (typeof error.stdout === 'string') {
      try {
        parseOperatorJson(error.stdout);
      } catch (parsed) {
        if (parsed instanceof OperatorAccessError) throw parsed;
      }
    }
    throw new OperatorAccessError();
  }
}
export async function verifiedOperatorTarget() {
  const config = JSON.parse(await readFile('.cache/local-config/cloud-environment.json', 'utf8'));
  const project = JSON.parse(await readFile('project.config.json', 'utf8'));
  assertIndependentTestTarget(
    config.env_id,
    config.test_environment_confirmed ? config.env_id : undefined,
    config,
  );
  if (config.app_id !== project.appid) throw new Error('Operator target AppID mismatch');
  const result = await operatorJson([
    'api',
    'tcb',
    'DescribeEnvs',
    '--api-version',
    '2018-06-08',
    '--region',
    'ap-shanghai',
    '--body',
    JSON.stringify({ EnvId: config.env_id }),
  ]);
  if (
    !Array.isArray(result.EnvList) ||
    result.EnvList.length !== 1 ||
    result.EnvList[0].EnvId !== config.env_id ||
    result.EnvList[0].Region !== 'ap-shanghai'
  )
    throw new Error('Operator account cannot verify the confirmed target');
  return config.env_id;
}
export function temporarySession(value, envId) {
  if (
    value?.isTemporary !== true ||
    value.envId !== envId ||
    ![value.secretId, value.secretKey, value.token].every(
      (v) => typeof v === 'string' && v.length > 0,
    )
  )
    throw new Error(
      'An environment-bound temporary operator session is required; credential values omitted',
    );
  return { secretId: value.secretId, secretKey: value.secretKey, sessionToken: value.token };
}
export async function operatorSession(envId) {
  return temporarySession(
    await operatorJson(['secrets', 'get', '--env-id', envId, '--region', 'ap-shanghai']),
    envId,
  );
}
export async function collectionInventory(envId) {
  const tables = [],
    names = new Set();
  let total;
  for (let offset = 0; offset < 10000; offset += 100) {
    const result = await operatorJson([
      'api',
      'tcb',
      'DescribeTables',
      '--api-version',
      '2018-06-08',
      '--region',
      'ap-shanghai',
      '--body',
      JSON.stringify({ EnvId: envId, MgoLimit: 100, MgoOffset: offset }),
    ]);
    if (
      !Array.isArray(result.Tables) ||
      !Number.isSafeInteger(result.Pager?.Total) ||
      result.Pager.Total < 0 ||
      result.Pager.Offset !== offset ||
      (total !== undefined && total !== result.Pager.Total)
    )
      throw new Error('Collection inventory changed or is incomplete');
    total = result.Pager.Total;
    for (const row of result.Tables) {
      if (
        !/^[a-z][a-z0-9_-]{0,79}$/u.test(row.TableName ?? '') ||
        names.has(row.TableName) ||
        !Number.isSafeInteger(row.Count) ||
        row.Count < 0
      )
        throw new Error('Invalid collection inventory');
      names.add(row.TableName);
      tables.push({ name: row.TableName, count: row.Count });
    }
    if (tables.length === total)
      return tables.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    if (!result.Tables.length || tables.length > total)
      throw new Error('Truncated collection inventory');
  }
  throw new Error('Collection inventory exceeds the reviewed limit');
}
