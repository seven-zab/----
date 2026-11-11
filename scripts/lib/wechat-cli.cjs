const { exec, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs');
const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
function quoteCmd(value) {
  if (/["\r\n%&|<>^!]/u.test(value)) throw new Error('Unsupported shell character in CLI argument');
  return `"${value}"`;
}
async function runWechatCli(cliPath, args, timeout = 45000) {
  if (!fs.existsSync(cliPath)) throw new Error('WECHAT_CLI_PATH does not exist');
  const options = { timeout, windowsHide: true, maxBuffer: 2 * 1024 * 1024 };
  const result =
    process.platform === 'win32' && /\.(bat|cmd)$/iu.test(cliPath)
      ? await execAsync([cliPath, ...args].map(quoteCmd).join(' '), options)
      : await execFileAsync(cliPath, args, options);
  if (/\[error\]/iu.test(result.stdout + result.stderr)) {
    const output = result.stdout + result.stderr;
    fs.mkdirSync('.cache', { recursive: true });
    fs.writeFileSync('.cache/qa-last-cli-error.log', output);
    const reason = output.split(/\r?\n/u).find((line) => /\[error\]/iu.test(line));
    const error = new Error(
      `WeChat CLI: ${
        reason?.slice(0, 300) ?? 'operation failed'
      } (details: .cache/qa-last-cli-error.log)`,
    );
    error.cliOutput = output;
    throw error;
  }
  return result;
}
module.exports = { runWechatCli };
