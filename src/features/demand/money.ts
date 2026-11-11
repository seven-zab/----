export function yuanToFen(input: string): number {
  const value = input.trim();
  if (!/^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$/.test(value))
    throw new Error('请填写已选择的预算金额，最多两位小数');
  const [yuan, fraction = ''] = value.split('.');
  const fen = Number(yuan) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(fen)) throw new Error('预算金额超出支持范围');
  return fen;
}
