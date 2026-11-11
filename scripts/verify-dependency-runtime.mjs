import assert from 'node:assert/strict';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

// Loopback-only transport tests; never call CloudBase, a model or a real account.
const rootArg = process.argv.indexOf('--sdk-root');
const root = rootArg === -1 ? process.cwd() : resolve(process.argv[rootArg + 1]);
const require = createRequire(resolve(root, 'package.json'));
const sdkRequire = createRequire(require.resolve('wx-server-sdk'));
const cloudRequire = createRequire(sdkRequire.resolve('@cloudbase/node-sdk'));
const axios = cloudRequire('axios');
assert.equal(cloudRequire('axios/package.json').version, '0.34.0');
const sdk = require('wx-server-sdk');
sdk.init({ env: 'dependency-smoke-no-cloud' });
assert.equal(typeof sdk.ai().createModel('cloudbase').generateText, 'function');

let jpeg;
const server = createServer(async (request, response) => {
  if (request.url === '/image') {
    response.setHeader('Content-Type', 'image/jpeg');
    response.end(jpeg);
    return;
  }
  if (request.url === '/timeout') return;
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  response.statusCode = request.url === '/error' ? 409 : 200;
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify({ method: request.method, body: Buffer.concat(chunks).toString() }));
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
try {
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await axios.get(base, { proxy: false })).data.method, 'GET');
  const posted = await axios.post(base, { text: '中文安全补丁' }, { proxy: false });
  assert.deepEqual(JSON.parse(posted.data.body), { text: '中文安全补丁' });
  await assert.rejects(
    axios.get(`${base}/error`, { proxy: false }),
    (error) => error.response.status === 409,
  );
  await assert.rejects(
    axios.get(`${base}/timeout`, { proxy: false, timeout: 50 }),
    (error) => error.code === 'ECONNABORTED',
  );
  const original = Object.getOwnPropertyDescriptor(Object.prototype, 'method');
  try {
    Object.defineProperty(Object.prototype, 'method', {
      value: 'DELETE',
      configurable: true,
      writable: true,
    });
    assert.equal((await axios({ url: base, proxy: false })).data.method, 'GET');
  } finally {
    if (original) Object.defineProperty(Object.prototype, 'method', original);
    else delete Object.prototype.method;
  }
  if (rootArg === -1) {
    const automatorRequire = createRequire(require.resolve('miniprogram-automator'));
    for (const Jimp of [require('jimp'), automatorRequire('jimp')]) {
      jpeg = await new Jimp(2, 2, 0xff0000ff).getBufferAsync(Jimp.MIME_JPEG);
      const decoded = await Jimp.read(jpeg);
      assert.equal(decoded.bitmap.width, 2);
      assert.equal(decoded.bitmap.height, 2);
      // The old callback-based Jimp loaders must still work with their own phin.
      const downloaded = await Promise.race([
        Jimp.read(`${base}/image`),
        new Promise((_, reject) => {
          const timer = setTimeout(
            () => reject(new Error('Jimp HTTP callback did not complete')),
            3000,
          );
          timer.unref();
        }),
      ]);
      assert.equal(downloaded.bitmap.width, 2);
    }
  }
  console.log(
    `Dependency smoke passed on Node ${
      process.versions.node
    }: SDK4 factory, axios GET/POST/errors/timeout/prototype protection${
      rootArg === -1 ? ', both Jimp JPEG codecs and HTTP callbacks' : ''
    }; loopback only.`,
  );
} finally {
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
