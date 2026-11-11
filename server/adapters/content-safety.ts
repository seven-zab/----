import { BusinessError, ensure } from '../core/errors';
export interface ContentSafety {
  checkText(openid: string, text: string): Promise<'pass' | 'reject'>;
}
export interface WechatSecurityAPI {
  msgSecCheck(input: {
    openid: string;
    scene: number;
    version: number;
    content: string;
  }): Promise<unknown>;
}
export class WechatTextCheckError extends BusinessError {
  readonly providerCode: number | null;

  constructor(error: unknown) {
    super(503, 'DEPENDENCY_UNAVAILABLE', '微信内容安全检查暂不可用');
    const e = error as { errCode?: unknown; errcode?: unknown; code?: unknown } | null;
    const code = e?.errCode ?? e?.errcode ?? e?.code;
    this.providerCode =
      typeof code === 'number' && Number.isSafeInteger(code) && Math.abs(code) <= 10000000
        ? code
        : null;
  }
}
export function wechatContentSafety(api: WechatSecurityAPI | undefined): ContentSafety {
  return {
    async checkText(openid, text) {
      ensure(api, 'DEPENDENCY_UNAVAILABLE', '内容安全接口尚未配置', 503);
      const characters = Array.from(text);
      ensure(
        characters.length > 0 && characters.length <= 25000,
        'VALIDATION_FAILED',
        '待检查文本长度无效',
        400,
      );
      for (let offset = 0; offset < characters.length; offset += 2000) {
        let result: unknown;
        try {
          result = await api.msgSecCheck({
            openid,
            scene: 3,
            version: 2,
            content: characters.slice(offset, offset + 2000).join(''),
          });
        } catch (error) {
          throw new WechatTextCheckError(error);
        }
        ensure(
          result !== null && typeof result === 'object',
          'DEPENDENCY_UNAVAILABLE',
          '内容安全接口返回异常',
          503,
        );
        const value = result as {
          errCode?: number;
          errcode?: number;
          result?: { suggest?: string };
        };
        if ((value.errCode ?? value.errcode ?? 0) !== 0) throw new WechatTextCheckError(value);
        ensure(
          value.result?.suggest === 'pass' ||
            value.result?.suggest === 'risky' ||
            value.result?.suggest === 'review',
          'DEPENDENCY_UNAVAILABLE',
          '内容安全结果无法识别',
          503,
        );
        if (value.result.suggest !== 'pass') return 'reject';
      }
      return 'pass';
    },
  };
}
