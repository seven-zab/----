// @vitest-environment node
import { EventEmitter } from 'node:events';
import { request, type RequestOptions } from 'node:https';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { deepSeekModelProvider, type ModelInput } from '../../server/adapters/model';
import { runDeepSeekAcceptance } from '../../server/maintenance/ai-model-acceptance';
import { MemoryRepository } from '../helpers/memory-repository';

vi.mock('node:https', () => ({ request: vi.fn() }));
const config = {
  AI_PROVIDER: 'deepseek',
  AI_MODEL_ID: 'deepseek-flash',
  DEEPSEEK_API_KEY: 'synthetic-test-token',
};
const messages = [{ role: 'user' as const, content: '合成样本' }];
const usage = { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 };
const modelRequest = vi.mocked(request);
const route: ModelInput = {
  messages,
  tools: [
    {
      type: 'function',
      function: { name: 'route_turn', description: '分流', parameters: { type: 'object' } },
    },
  ],
  required_tool: 'route_turn',
};
beforeEach(() => {
  modelRequest.mockReset();
});
afterEach(() => vi.useRealTimers());

function respond(statusCode: number, response: unknown) {
  const end = vi.fn();
  modelRequest.mockImplementation((_url, _options, done) => {
    const req = new EventEmitter() as ReturnType<typeof request>;
    req.end = end.mockImplementation(() => {
      done?.(Object.assign(Readable.from([Buffer.from(JSON.stringify(response))]), { statusCode }));
      return req;
    });
    return req;
  });
  return end;
}
it('sends the key only to the official endpoint and parses a named tool call', async () => {
  const toolCall = {
    id: 'test-call',
    type: 'function',
    function: { name: 'route_turn', arguments: '{}' },
  };
  const end = respond(200, {
    choices: [
      {
        finish_reason: 'tool_calls',
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [toolCall],
        },
      },
    ],
    usage,
  });
  expect(await deepSeekModelProvider(config).generate(route)).toEqual({
    text: '',
    tool_calls: [toolCall],
    usage,
  });
  expect(modelRequest).toHaveBeenCalledOnce();
  expect(modelRequest).toHaveBeenCalledWith(
    'https://api.deepseek.com/chat/completions',
    expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer synthetic-test-token' }),
    }),
    expect.any(Function),
  );
  const body = JSON.parse(end.mock.calls[0][0].toString());
  expect(body).toMatchObject({
    model: 'deepseek-flash',
    thinking: { type: 'disabled' },
    max_tokens: 2048,
    stream: false,
    messages,
    tool_choice: { type: 'function', function: { name: 'route_turn' } },
  });
  expect(body).not.toHaveProperty('required_tool');
  expect(JSON.stringify(body)).not.toContain(config.DEEPSEEK_API_KEY);
});
it('parses ordinary answers without sending tools', async () => {
  const end = respond(200, {
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '合成回答' } }],
    usage,
  });
  expect(await deepSeekModelProvider(config).generate({ messages, tools: [] })).toEqual({
    text: '合成回答',
    tool_calls: [],
    usage,
  });
  const body = JSON.parse(end.mock.calls[0][0].toString());
  expect(body).not.toHaveProperty('tools');
  expect(body).not.toHaveProperty('tool_choice');
});
it('fails closed when a key is missing', async () => {
  const model = deepSeekModelProvider({ ...config, DEEPSEEK_API_KEY: '' });
  expect(model.isConfigured).toBe(false);
  await expect(model.generate(route)).rejects.toMatchObject({ error_code: 'MODEL_UNAVAILABLE' });
  expect(modelRequest).not.toHaveBeenCalled();
});
it.each([
  [302, 'MODEL_UNAVAILABLE'],
  [401, 'MODEL_AUTH_FAILED'],
  [402, 'MODEL_AUTH_FAILED'],
])(
  'handles HTTP %i without replaying or returning the upstream body',
  async (status, error_code) => {
    respond(status, { detail: 'upstream confidential content' });
    await expect(deepSeekModelProvider(config).generate(route)).rejects.toMatchObject({
      error_code,
    });
    expect(modelRequest).toHaveBeenCalledOnce();
  },
);
it('fails closed on incomplete or oversized responses', async () => {
  respond(200, {
    choices: [{ finish_reason: 'length', message: { role: 'assistant', content: 'partial' } }],
    usage,
  });
  await expect(deepSeekModelProvider(config).generate(route)).rejects.toMatchObject({
    error_code: 'MODEL_UNAVAILABLE',
  });
  respond(200, 'x'.repeat(1024 * 1024));
  await expect(deepSeekModelProvider(config).generate(route)).rejects.toMatchObject({
    error_code: 'MODEL_UNAVAILABLE',
  });
});
it('aborts an in-flight request after 30 seconds', async () => {
  vi.useFakeTimers();
  let signal: RequestOptions['signal'];
  modelRequest.mockImplementation((_url, options) => {
    signal = (options as RequestOptions).signal;
    return Object.assign(new EventEmitter(), { end: vi.fn() }) as ReturnType<typeof request>;
  });
  const settled = expect(deepSeekModelProvider(config).generate(route)).rejects.toMatchObject({
    error_code: 'MODEL_TIMEOUT',
  });
  await vi.advanceTimersByTimeAsync(30000);
  await settled;
  expect(signal?.aborted).toBe(true);
});
it('reserves a synthetic probe once and stops after an authentication failure', async () => {
  const repo = new MemoryRepository();
  repo.seed('system_guards', { _id: 'v2_migration', schema_version: 2, status: 'verified' });
  const now = Date.now();
  const id = 'ai-probe:2f21c1db-4af7-4116-9a00-7375bef37e01';
  const scoped = {
    ...config,
    AI_MODEL_ACCEPTANCE_SCOPE: JSON.stringify({
      id,
      env_id: 'test-cloud',
      expires_at: now + 60000,
    }),
  };
  respond(401, {});
  expect(await runDeepSeekAcceptance(repo, 'test-cloud', scoped, now)).toEqual({ state: 'failed' });
  expect(await runDeepSeekAcceptance(repo, 'test-cloud', scoped, now)).toEqual({
    state: 'already_reserved',
  });
  await expect(runDeepSeekAcceptance(repo, 'other-cloud', scoped, now)).rejects.toMatchObject({
    error_code: 'FORBIDDEN',
  });
  await expect(
    runDeepSeekAcceptance(repo, 'test-cloud', scoped, now + 60001),
  ).rejects.toMatchObject({
    error_code: 'FORBIDDEN',
  });
  expect(modelRequest).toHaveBeenCalledOnce();
  expect(await repo.get('job_runs', id)).toMatchObject({
    status: 'failed',
    results: [{ passed: false, error_code: 'MODEL_AUTH_FAILED' }],
  });
});
