import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
const temp = resolve('.cache/tmp');
await mkdir(temp, { recursive: true });
const child = spawn(
  process.execPath,
  ['node_modules/vitest/vitest.mjs', ...process.argv.slice(2)],
  { stdio: 'inherit', env: { ...process.env, TEMP: temp, TMP: temp } },
);
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
