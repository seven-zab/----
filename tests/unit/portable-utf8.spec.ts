// @vitest-environment node
import { createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { utf8ToBytes } from '../../src/services/utf8';

afterEach(() => vi.unstubAllGlobals());
it('preserves UTF-8 and existing idempotency hashes without a global TextEncoder', () => {
  const examples = [
    '',
    'hello',
    '云治乡智',
    '昵称 🛸',
    '\ud800',
    '\udc00',
    'a\ud800b',
    JSON.stringify({ route: 'userService.updateProfile', data: { display_name: '村民🛸' } }),
  ];
  vi.stubGlobal('TextEncoder', undefined);
  for (const value of examples) {
    const expected = Buffer.from(value, 'utf8');
    expect(Buffer.from(utf8ToBytes(value))).toEqual(expected);
    expect(bytesToHex(sha256(utf8ToBytes(value)))).toBe(
      createHash('sha256').update(expected).digest('hex'),
    );
  }
});
