const automator = require('miniprogram-automator');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env.test') });

describe('Miniprogram E2E', () => {
  let miniProgram;

  beforeAll(async () => {
    const projectPath = path.resolve(__dirname, '../../dist/build/mp-weixin');
    const cliPath = process.env.WECHAT_CLI_PATH;

    console.log('--------------------------------------------------');
    console.log('🚀 Starting E2E Test Setup');
    console.log('📂 Project Path:', projectPath);
    console.log('🛠️  CLI Path:', cliPath);

    // 1. Validate Paths
    if (!fs.existsSync(projectPath)) {
      console.error(`❌ Project path does not exist: ${projectPath}`);
      throw new Error(`Project path not found. Did you run the build script?`);
    }
    if (!cliPath) {
      throw new Error('❌ WECHAT_CLI_PATH is not defined in .env.test');
    }
    if (!fs.existsSync(cliPath)) {
      console.error(`❌ WeChat CLI not found at: ${cliPath}`);
      throw new Error(`WeChat CLI not found. Please check WECHAT_CLI_PATH in .env.test`);
    }

    try {
      // Check if automation port is already open
      const isPortOpen = await new Promise((resolve) => {
        const net = require('net');
        const socket = new net.Socket();
        socket.setTimeout(1000);
        socket.on('connect', () => {
          socket.destroy();
          resolve(true);
        });
        socket.on('timeout', () => {
          socket.destroy();
          resolve(false);
        });
        socket.on('error', () => {
          resolve(false);
        });
        socket.connect(9420, '127.0.0.1');
      });

      if (isPortOpen) {
        console.log('🔌 Automation port 9420 is open. Attempting to connect directly...');
        miniProgram = await automator.connect({
          wsEndpoint: 'ws://localhost:9420',
        });
        console.log('✅ Connected to existing WeChat DevTools instance!');
      } else {
        console.log('⏳ Launching WeChat DevTools...');
        miniProgram = await automator.launch({
          projectPath,
          cliPath,
          timeout: 60000,
          force: true,
        });
        console.log('✅ WeChat DevTools Launched Successfully!');
      }
    } catch (error) {
      console.error('--------------------------------------------------');
      console.error('❌ FAILED TO LAUNCH WECHAT DEVTOOLS');
      console.error('Error Details:', error.message);
      console.error('--------------------------------------------------');
      console.error('Possible Causes & Solutions:');
      console.error('1. 🔐 Not Logged In: Open DevTools manually and scan the QR code to log in.');
      console.error('2. 🛡️  Service Port Closed: Go to Settings -> Security Settings -> Service Port: ON.');
      console.error('3. 🛑 Port Conflict: Close DevTools completely and try again.');
      console.error('4. 📁 Path Issues: Ensure path uses "/" not "\\" in .env.test.');
      console.error('--------------------------------------------------');
      throw error;
    }
  }, 60000);

  afterAll(async () => {
    if (miniProgram) await miniProgram.close();
  });

  it('should launch successfully', async () => {
    const page = await miniProgram.reLaunch('/pages/index/index');
    await page.waitFor(2000);
    const element = await page.$('.banner-title');
    expect(element).not.toBeNull();
    expect(await element.text()).toContain('云治乡智');
  });
});
