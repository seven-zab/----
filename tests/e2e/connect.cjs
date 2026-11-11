const path = require('node:path');
const fs = require('node:fs');
const automator = require('miniprogram-automator');
const { runWechatCli } = require('../../scripts/lib/wechat-cli.cjs');
async function connectTestProject(options = {}) {
  const release = require('../../contracts/generated/release.json');
  const defaultProject = path.resolve(__dirname, '../../dist/build/mp-weixin');
  const isolatedProject = path.resolve(
    __dirname,
    '../../.cache/preview-candidates',
    release.source_hash.slice(0, 12),
    'project',
  );
  const projectPath = options.isolated === true ? isolatedProject : defaultProject;
  const cliPath = process.env.WECHAT_CLI_PATH;
  if (!cliPath || !fs.existsSync(path.join(projectPath, 'app.json')))
    throw new Error('Build the test project and configure WECHAT_CLI_PATH before E2E');
  const build = JSON.parse(fs.readFileSync(path.join(projectPath, 'build-info.json'), 'utf8'));
  const target = JSON.parse(
    fs.readFileSync(
      path.resolve(__dirname, '../../.cache/local-config/cloud-environment.json'),
      'utf8',
    ),
  );
  if (
    build.mode !== 'test' ||
    build.source_hash !== release.source_hash ||
    !target.test_environment_confirmed ||
    build.cloud_env_id !== target.env_id ||
    process.env.VITE_CLOUD_ENV_ID !== target.env_id
  )
    throw new Error(
      'E2E requires the current test build and explicitly confirmed test environment',
    );
  const port = Number(process.env.WECHAT_AUTO_PORT ?? 9420);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error('Invalid WECHAT_AUTO_PORT');
  // Always select this build, including when another project is already open.
  const args = ['auto', '--project', projectPath, '--auto-port', String(port)];
  const startup = await runWechatCli(cliPath, args);
  fs.writeFileSync(
    path.resolve(__dirname, '../../.cache/qa-fix-auto-start.log'),
    startup.stdout + startup.stderr,
  );
  let lastError;
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    let miniProgram;
    try {
      miniProgram = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${port}` });
      const ready = await miniProgram.evaluate(() => typeof wx !== 'undefined');
      if (!ready) throw new Error('Mini program runtime is still initializing');
      return miniProgram;
    } catch (error) {
      if (miniProgram) miniProgram.disconnect();
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(
    `Cannot connect to automation port ${port}: ${lastError?.message ?? 'unknown error'}`,
  );
}
module.exports = { connectTestProject };
