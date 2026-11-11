import { request, type RequestOptions } from 'node:https';
import type { IncomingMessage } from 'node:http';
import { BusinessError, ensure } from '../core/errors';
export const MODEL_REQUEST_TIMEOUT_MS = 30_000;
const DEEPSEEK_MODEL_ID = 'deepseek-flash';
const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';
const MAX_RESPONSE_BYTES = 1024 * 1024;
export interface ModelMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string;
  tool_call_id?: string;
  tool_calls?: ModelToolCall[];
}
export interface ModelToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}
export interface ModelTool {
  type: 'function';
  function: { name: string; description: string; parameters: object };
}
export interface ModelInput {
  messages: ModelMessage[];
  tools: ModelTool[];
  required_tool?: string;
}
export interface ModelResult {
  text: string;
  tool_calls: ModelToolCall[];
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}
export interface ModelProvider {
  isConfigured?: boolean;
  generate(input: ModelInput): Promise<ModelResult>;
}
interface ChatCompletionInput {
  model: string;
  messages: ModelMessage[];
  tools: ModelTool[];
  max_tokens: number;
  temperature: number;
  thinking?: { type: 'disabled' };
  tool_choice?: { type: 'function'; function: { name: string } };
}
interface Completion {
  text?: unknown;
  tool_calls?: unknown;
  usage?: unknown;
}
export interface CloudAI {
  createModel(group: string): {
    generateText(input: ChatCompletionInput & { maxSteps: number }): Promise<unknown>;
  };
}
export function modelRouteConfigured(config: NodeJS.ProcessEnv): boolean {
  return config.AI_PROVIDER === 'deepseek'
    ? config.AI_MODEL_ID === DEEPSEEK_MODEL_ID
    : config.AI_PROVIDER === 'cloudbase' && Boolean(config.AI_MODEL_PROVIDER && config.AI_MODEL_ID);
}
function modelRequestError(error: unknown): BusinessError {
  if (error instanceof BusinessError) return error;
  const failure = error as { code?: unknown; status?: unknown; errCode?: unknown } | null;
  if (
    [failure?.code, failure?.status, failure?.errCode].some((code) =>
      /^(?:400|401|402|403|422)$|Auth|AccessDenied|InvalidParameter|Insufficient[_-]?Balance/iu.test(
        String(code ?? ''),
      ),
    )
  )
    return new BusinessError(503, 'MODEL_AUTH_FAILED', '模型权限、额度或参数配置无效');
  return new BusinessError(503, 'MODEL_UNAVAILABLE', '模型请求失败，请稍后重试');
}
function modelProvider(
  config: NodeJS.ProcessEnv,
  isConfigured: boolean,
  generate: (input: ChatCompletionInput, signal: AbortSignal) => Promise<Completion>,
): ModelProvider {
  return {
    isConfigured,
    async generate(input) {
      ensure(
        JSON.stringify(input).length <= 80000,
        'MODEL_UNAVAILABLE',
        '模型上下文过长，请缩小查询范围',
        503,
      );
      ensure(
        isConfigured && config.AI_MODEL_ID,
        'MODEL_UNAVAILABLE',
        '真实模型尚未配置，普通页面仍可办理业务',
        503,
      );
      ensure(
        (config.AI_REQUEST_TIMEOUT_MS ?? String(MODEL_REQUEST_TIMEOUT_MS)) ===
          String(MODEL_REQUEST_TIMEOUT_MS) &&
          (config.AI_MAX_OUTPUT_TOKENS ?? '2048') === '2048' &&
          (config.AI_GENERAL_DAILY_LIMIT ?? '10') === '10',
        'MODEL_UNAVAILABLE',
        '模型配置与产品限制不一致',
        503,
      );
      let timer: ReturnType<typeof setTimeout> | undefined;
      const controller = new AbortController();
      try {
        const { messages: requestMessages, tools, required_tool } = input;
        const deepSeekFlash = config.AI_MODEL_ID === DEEPSEEK_MODEL_ID;
        const result = await Promise.race([
          generate(
            {
              messages: requestMessages,
              tools,
              model: config.AI_MODEL_ID,
              max_tokens: 2048,
              temperature: 0,
              ...(deepSeekFlash && { thinking: { type: 'disabled' } }),
              ...(deepSeekFlash &&
                required_tool && {
                  tool_choice: { type: 'function', function: { name: required_tool } },
                }),
            },
            controller.signal,
          ),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => {
              reject(new BusinessError(503, 'MODEL_TIMEOUT', '模型请求超时'));
              controller.abort();
            }, MODEL_REQUEST_TIMEOUT_MS);
          }),
        ]);
        const calls: ModelToolCall[] = [];
        if (Array.isArray(result.tool_calls))
          for (const rawCall of result.tool_calls) {
            ensure(
              rawCall && typeof rawCall === 'object',
              'MODEL_UNAVAILABLE',
              '模型工具格式错误',
              503,
            );
            const c = rawCall as {
              id?: unknown;
              type?: unknown;
              function?: { name?: unknown; arguments?: unknown };
            };
            ensure(
              typeof c.id === 'string' &&
                c.type === 'function' &&
                typeof c.function?.name === 'string' &&
                typeof c.function.arguments === 'string' &&
                c.function.arguments.length <= 50000,
              'MODEL_UNAVAILABLE',
              '模型工具格式错误',
              503,
            );
            calls.push({
              id: c.id,
              type: 'function',
              function: { name: c.function.name, arguments: c.function.arguments },
            });
          }
        ensure(
          typeof result.text === 'string' && result.text.length <= 20000 && calls.length <= 4,
          'MODEL_UNAVAILABLE',
          '模型返回超出限制',
          503,
        );
        const u = result.usage as Record<string, unknown> | undefined;
        ensure(
          u &&
            ['prompt_tokens', 'completion_tokens', 'total_tokens'].every(
              (k) => typeof u[k] === 'number' && Number.isSafeInteger(u[k]) && Number(u[k]) >= 0,
            ),
          'MODEL_UNAVAILABLE',
          '模型缺少有效用量数据',
          503,
        );
        return {
          text: result.text,
          tool_calls: calls,
          usage: {
            prompt_tokens: Number(u.prompt_tokens),
            completion_tokens: Number(u.completion_tokens),
            total_tokens: Number(u.total_tokens),
          },
        };
      } catch (error) {
        throw modelRequestError(error);
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
  };
}

/** wx-server-sdk 4.0.2; one SDK step, application owns tool execution and retry limits. */
export function cloudBaseModelProvider(
  ai: CloudAI | undefined,
  config: NodeJS.ProcessEnv,
): ModelProvider {
  const group = config.AI_MODEL_PROVIDER;
  return modelProvider(
    config,
    config.AI_PROVIDER === 'cloudbase' && !!ai && modelRouteConfigured(config),
    async (input) => {
      const raw = await ai!.createModel(group!).generateText({ ...input, maxSteps: 1 });
      ensure(raw && typeof raw === 'object', 'MODEL_UNAVAILABLE', '模型返回格式无效', 503);
      const result = raw as {
        text?: unknown;
        messages?: unknown;
        usage?: unknown;
        error?: unknown;
      };
      ensure(!result.error, 'MODEL_UNAVAILABLE', '模型返回错误', 503);
      const messages = Array.isArray(result.messages) ? result.messages : [];
      const last = messages[messages.length - 1] as
        | { role?: unknown; tool_calls?: unknown }
        | undefined;
      return {
        text: result.text,
        tool_calls: last?.role === 'assistant' ? last.tool_calls : undefined,
        usage: result.usage,
      };
    },
  );
}

/** The authorization header is only sent to the fixed DeepSeek endpoint. */
export function deepSeekModelProvider(config: NodeJS.ProcessEnv): ModelProvider {
  const key = config.DEEPSEEK_API_KEY?.trim();
  return modelProvider(
    config,
    config.AI_PROVIDER === 'deepseek' && !!key && modelRouteConfigured(config),
    async (input, signal) => {
      const { tools, ...completion } = input;
      const body = Buffer.from(
        JSON.stringify({ ...completion, ...(tools.length && { tools }), stream: false }),
      );
      const options: RequestOptions = {
        method: 'POST',
        signal,
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          'Content-Length': body.length,
        },
      };
      const response = await new Promise<IncomingMessage>((resolve, reject) => {
        request(DEEPSEEK_URL, options, resolve).once('error', reject).end(body);
      });
      if (response.statusCode !== 200) {
        response.destroy();
        throw modelRequestError({ status: response.statusCode });
      }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of response) {
        size += chunk.length;
        ensure(size <= MAX_RESPONSE_BYTES, 'MODEL_UNAVAILABLE', '模型返回超出限制', 503);
        chunks.push(chunk);
      }
      const result = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        choices?: Array<{
          finish_reason?: unknown;
          message?: { role?: unknown; content?: unknown; tool_calls?: unknown };
        }>;
        usage?: unknown;
      } | null;
      const choice = result?.choices?.[0];
      const message = choice?.message;
      ensure(
        message?.role === 'assistant' &&
          ((choice?.finish_reason === 'stop' &&
            typeof message.content === 'string' &&
            message.tool_calls == null) ||
            (choice?.finish_reason === 'tool_calls' &&
              Array.isArray(message.tool_calls) &&
              message.tool_calls.length > 0 &&
              (message.content === null || typeof message.content === 'string'))),
        'MODEL_UNAVAILABLE',
        '模型返回格式无效或回答未完成',
        503,
      );
      return { text: message.content ?? '', tool_calls: message.tool_calls, usage: result?.usage };
    },
  );
}
