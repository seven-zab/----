export class BusinessError extends Error {
  constructor(public readonly code: number, public readonly error_code: string, message: string) {
    super(message);
  }
}

export function ensure(
  condition: unknown,
  error_code = 'FORBIDDEN',
  message = '权限不足',
  code = 403,
): asserts condition {
  if (!condition) throw new BusinessError(code, error_code, message);
}
