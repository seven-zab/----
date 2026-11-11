// WeChat adds userInfo and tcbContext to callFunction events. These are transport metadata,
// never an identity or role source. Preserve every other key so that the
// domain envelope still rejects unknown client fields.
export function wechatBusinessRequest(event: unknown): unknown {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return event;
  return Object.fromEntries(
    Object.entries(event).filter(([key]) => key !== 'userInfo' && key !== 'tcbContext'),
  );
}
