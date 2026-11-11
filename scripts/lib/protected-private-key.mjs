import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';

// Key bytes travel over private child-process pipes, never command arguments,
// stdout logs, a .env file or a plaintext backup. DPAPI binds the local copy to
// this Windows account and the confirmed CloudBase environment.
async function dpapi(bytes, env, unprotect) {
  if (!/^cloud[a-z0-9-]+$/u.test(env)) throw new Error('Invalid protected-key environment');
  const action = unprotect ? 'Unprotect' : 'Protect';
  const code = `Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $e=[Text.Encoding]::UTF8.GetBytes('yzxz-private-data:${env}'); $v=[Security.Cryptography.ProtectedData]::${action}($b,$e,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($v));`;
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', code], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const chunks = [];
    child.stdout.on('data', (c) => chunks.push(c));
    child.stderr.resume();
    child.on('error', () => reject(new Error('Windows key protection unavailable')));
    child.on('close', (status) =>
      status === 0
        ? resolve(Buffer.from(Buffer.concat(chunks).toString().trim(), 'base64'))
        : reject(new Error('Windows key protection failed')),
    );
    child.stdin.end(bytes.toString('base64'));
  });
}
export const protectPrivateKey = (key, env) => dpapi(key, env, false);
export const unprotectPrivateKey = (bytes, env) => dpapi(bytes, env, true);
export async function loadProtectedPrivateKey(env) {
  const key = await unprotectPrivateKey(
    await readFile('.cache/local-config/private-data-key.dpapi'),
    env,
  );
  if (key.length !== 32) throw new Error('Protected private-data key is invalid');
  return key.toString('base64');
}
