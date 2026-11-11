import { ensure } from '../core/errors';
export type SubscriptionState = 'developer' | 'trial' | 'formal';
export function subscriptionState(value: string | undefined): SubscriptionState {
  ensure(
    value === 'developer' || value === 'trial' || value === 'formal',
    'DEPENDENCY_UNAVAILABLE',
    '须明确配置订阅消息跳转版本',
    503,
  );
  return value;
}
export interface SubscriptionTemplate {
  key: string;
  template_id: string;
  event_types: string[];
  status_field: string;
  time_field: string;
}
export function subscriptionTemplates(value: string | undefined): SubscriptionTemplate[] {
  if (!value) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    ensure(false, 'DEPENDENCY_UNAVAILABLE', '订阅模板配置不是有效JSON', 503);
  }
  ensure(
    Array.isArray(parsed) && parsed.length <= 3,
    'DEPENDENCY_UNAVAILABLE',
    '订阅模板最多配置3项',
    503,
  );
  const templates: SubscriptionTemplate[] = [];
  for (const item of parsed) {
    ensure(item && typeof item === 'object', 'DEPENDENCY_UNAVAILABLE', '订阅模板格式错误', 503);
    const t = item as Record<string, unknown>;
    ensure(
      typeof t.key === 'string' &&
        /^[a-z_]{1,60}$/u.test(t.key) &&
        typeof t.template_id === 'string' &&
        /^[\w-]{10,200}$/u.test(t.template_id) &&
        Array.isArray(t.event_types) &&
        t.event_types.every((e) => typeof e === 'string' && /^[A-Za-z_]{1,80}$/u.test(e)) &&
        typeof t.status_field === 'string' &&
        /^thing\d+$/u.test(t.status_field) &&
        typeof t.time_field === 'string' &&
        /^time\d+$/u.test(t.time_field),
      'DEPENDENCY_UNAVAILABLE',
      '请使用已核验模板ID及thing/time字段',
      503,
    );
    templates.push(t as unknown as SubscriptionTemplate);
  }
  ensure(
    new Set(templates.map((t) => t.key)).size === templates.length,
    'DEPENDENCY_UNAVAILABLE',
    '订阅模板标识重复',
    503,
  );
  return templates;
}
export interface SubscriptionSender {
  send(input: {
    touser: string;
    template_id: string;
    page: string;
    data: Record<string, { value: string }>;
  }): Promise<{ outcome: 'sent' | 'rejected' | 'unknown'; code: string }>;
}
export interface WechatSubscribeAPI {
  send(input: {
    touser: string;
    templateId: string;
    page: string;
    data: Record<string, { value: string }>;
    miniprogramState: SubscriptionState;
  }): Promise<unknown>;
}
export function wechatSubscriptionSender(
  api: WechatSubscribeAPI | undefined,
  state: SubscriptionState = 'trial',
): SubscriptionSender {
  const target = subscriptionState(state);
  return {
    async send(input) {
      if (!api) return { outcome: 'rejected', code: 'TEMPLATE_API_UNAVAILABLE' };
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const raw = await Promise.race([
          api.send({
            touser: input.touser,
            templateId: input.template_id,
            page: input.page,
            data: input.data,
            miniprogramState: target,
          }),
          new Promise<never>((_r, reject) => {
            timer = setTimeout(() => reject(new Error('unknown delivery')), 15000);
          }),
        ]);
        const r = raw as { errCode?: unknown; errcode?: unknown };
        const code = r?.errCode ?? r?.errcode;
        return typeof code === 'number'
          ? { outcome: code === 0 ? 'sent' : 'rejected', code: String(code) }
          : { outcome: 'unknown', code: 'INVALID_DELIVERY_RESPONSE' };
      } catch {
        return { outcome: 'unknown', code: 'DELIVERY_OUTCOME_UNKNOWN' };
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
  };
}
