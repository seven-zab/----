import { describe, it, expect } from 'vitest';
import { yuanToFen } from '../../src/features/demand/money';
describe('budget intent amounts', () => {
  it('does not turn an unknown amount into zero', () => {
    expect(() => yuanToFen('')).toThrow();
    expect(() => yuanToFen('  ')).toThrow();
    expect(yuanToFen('0')).toBe(0);
  });
  it('preserves cents and rejects unsafe or imprecise input', () => {
    expect(yuanToFen('1.01')).toBe(101);
    expect(yuanToFen('0.29')).toBe(29);
    expect(() => yuanToFen('1.001')).toThrow();
    expect(() => yuanToFen('9007199254740991')).toThrow();
  });
});
