import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { ensure } from './errors';

export interface PrivateDataCodec {
  seal(value: unknown): string;
  open(value: string): unknown;
}
export function privateDataCodec(encodedKey: string | undefined): PrivateDataCodec {
  const key = Buffer.from(encodedKey ?? '', 'base64');
  const assertKey = () =>
    ensure(key.length === 32, 'DEPENDENCY_UNAVAILABLE', '私有数据加密配置不可用', 503);
  return {
    seal(value) {
      assertKey();
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const bytes = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
      return [iv, cipher.getAuthTag(), bytes].map((b) => b.toString('base64')).join('.');
    },
    open(value) {
      assertKey();
      const [iv, tag, bytes] = value.split('.').map((s) => Buffer.from(s, 'base64'));
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      return JSON.parse(
        Buffer.concat([decipher.update(bytes), decipher.final()]).toString('utf8'),
      ) as unknown;
    },
  };
}
