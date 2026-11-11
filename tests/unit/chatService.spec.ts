import { beforeEach, expect, it, vi } from 'vitest';
import {
  checkChatPermission,
  getConversations,
  createConversation,
  getMessages,
  sendMessage,
  sendImageMessage,
  getContacts,
} from '../../src/services/chatService';
const mocks = vi.hoisted(() => ({
  me: { user_id: 'me' } as { user_id: string } | null,
  list: vi.fn(),
  contacts: vi.fn(),
  messages: vi.fn(),
  send: vi.fn(),
}));
vi.mock('../../src/stores/session', () => ({ useSessionStore: () => ({ me: mocks.me }) }));
vi.mock('../../src/services/chatV1', () => ({
  listConversations: mocks.list,
  listContacts: mocks.contacts,
  getMessages: mocks.messages,
  sendDraftMessage: mocks.send,
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.me = { user_id: 'me' };
});
it('allows a logged in member to request history without trusting a local role flag', () => {
  expect(checkChatPermission()).toEqual({ allowed: true });
});
it('denies logged out history without making a service call', async () => {
  mocks.me = null;
  expect(checkChatPermission().error).toBe('请先登录');
  expect((await getConversations()).success).toBe(false);
  expect(mocks.list).not.toHaveBeenCalled();
});
it('maps only the current user conversation summaries', async () => {
  mocks.list.mockResolvedValue({
    items: [{ conversation_id: 'c', display_name: '对方', updated_at: 1 }],
    next_cursor: null,
  });
  expect((await getConversations()).data?.list[0]).toMatchObject({ _id: 'c', name: '对方' });
});
it('accepts an actual empty paged conversation result', async () => {
  mocks.list.mockResolvedValue({ items: [], next_cursor: null });
  expect((await getConversations()).data?.list).toEqual([]);
});
it('returns list transport errors instead of pretending an empty list succeeded', async () => {
  mocks.list.mockRejectedValue(new Error('list failed'));
  expect((await getConversations()).error).toBe('list failed');
});
it('rejects creating conversations from arbitrary user IDs', async () => {
  expect((await createConversation('stranger', '任意用户')).success).toBe(false);
  expect(mocks.send).not.toHaveBeenCalled();
});
it('rejects an empty arbitrary recipient as well', async () => {
  expect((await createConversation('')).error).toContain('需求详情');
});
it('maps internal sender IDs and preserves paging of messages', async () => {
  mocks.messages.mockResolvedValue({
    items: [
      {
        message_id: 'a',
        conversation_id: 'c',
        sender_user_id: 'me',
        content_type: 'text',
        content: '你好',
        created_at: 1,
      },
      {
        message_id: 'b',
        conversation_id: 'c',
        sender_user_id: 'other',
        content_type: 'text',
        content: '您好',
        created_at: 2,
      },
    ],
    next_cursor: 'next',
  });
  const result = await getMessages('c');
  expect(result.data?.list.map((m) => m.isSelf)).toEqual([true, false]);
  expect(result.data?.next_cursor).toBe('next');
});
it('requires a conversation ID for message reads', async () => {
  expect((await getMessages('')).success).toBe(false);
  expect(mocks.messages).not.toHaveBeenCalled();
});
it('blocks logged out send and message reads', async () => {
  mocks.me = null;
  expect((await sendMessage('c', '你好')).error).toBe('请先登录');
  expect((await getMessages('c')).error).toBe('请先登录');
  expect(mocks.send).not.toHaveBeenCalled();
});
it('uses the shared sender and trims text', async () => {
  mocks.send.mockResolvedValue({ message_id: 'm' });
  expect((await sendMessage('c', '  你好  ')).success).toBe(true);
  expect(mocks.send).toHaveBeenCalledWith('c', '你好');
});
it('rejects raw legacy image URLs', async () => {
  expect((await sendImageMessage('c', 'cloud://unverified-image')).success).toBe(false);
  expect(mocks.send).not.toHaveBeenCalled();
});
it('rejects empty send targets', async () => {
  expect((await sendMessage('', '你好')).success).toBe(false);
  expect(mocks.send).not.toHaveBeenCalled();
});
it('rejects whitespace-only message bodies', async () => {
  expect((await sendMessage('c', '  ')).success).toBe(false);
  expect(mocks.send).not.toHaveBeenCalled();
});
it('propagates send failure without claiming success', async () => {
  mocks.send.mockRejectedValue(new Error('Failed to send'));
  expect((await sendMessage('c', '你好')).error).toBe('Failed to send');
});
it('lists only business contacts from the v1 contact service', async () => {
  mocks.contacts.mockResolvedValue({
    items: [{ conversation_id: 'c', other_user_id: 'other' }],
    next_cursor: null,
  });
  expect((await getContacts()).data).toEqual([{ conversation_id: 'c', other_user_id: 'other' }]);
});
it('does not query contacts while logged out', async () => {
  mocks.me = null;
  expect((await getContacts()).success).toBe(false);
  expect(mocks.contacts).not.toHaveBeenCalled();
});
it('reports contact errors without a fake successful result', async () => {
  mocks.contacts.mockRejectedValue(new Error('contacts failed'));
  expect((await getContacts()).error).toBe('contacts failed');
});
