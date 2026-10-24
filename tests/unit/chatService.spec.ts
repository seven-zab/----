import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useUserStore } from '../../src/stores/user';
import {
  checkChatPermission,
  getConversations,
  createConversation,
  getMessages,
  sendMessage,
  sendImageMessage,
  getContacts,
} from '../../src/services/chatService';

const mockCallFunction = vi.fn();
vi.stubGlobal('wx', {
  cloud: {
    callFunction: mockCallFunction,
  },
});

vi.stubGlobal('uni', {
  showToast: vi.fn(),
  showLoading: vi.fn(),
  hideLoading: vi.fn(),
});

describe('ChatService - 聊天功能', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  describe('checkChatPermission - 聊天权限检查', () => {
    it('should allow user with canChat permission', () => {
      const store = useUserStore();
      store.userInfo = { _id: 'test', name: 'Test', role: 'farmer', status: 'active' } as any;
      store.role = 'farmer';
      store.status = 'active';
      store.isLoggedIn = true;

      const result = checkChatPermission();
      expect(result.allowed).toBe(true);
    });

    it('should deny when not logged in', () => {
      const store = useUserStore();
      store.isLoggedIn = false;

      const result = checkChatPermission();
      expect(result.allowed).toBe(false);
      expect(result.error).toBe('请先登录');
    });

    it('should deny general_user without chat permission', () => {
      const store = useUserStore();
      store.userInfo = { _id: 'test', name: 'Test', role: 'general_user', status: 'active' } as any;
      store.role = 'general_user';
      store.status = 'active';
      store.isLoggedIn = true;

      const result = checkChatPermission();
      expect(result.allowed).toBe(false);
      expect(result.error).toBe('您没有聊天权限');
    });
  });

  describe('getConversations - 获取会话列表', () => {
    it('should get conversations successfully', async () => {
      const store = useUserStore();
      store.userInfo = { _id: 'test', name: 'Test', role: 'farmer', status: 'active' } as any;
      store.role = 'farmer';
      store.status = 'active';
      store.isLoggedIn = true;

      mockCallFunction.mockResolvedValue({
        result: {
          code: 0,
          data: [
            { _id: 'conv1', name: 'User1', lastMessage: 'Hello', unreadCount: 1 },
            { _id: 'conv2', name: 'User2', lastMessage: 'Hi', unreadCount: 0 },
          ],
        },
      });

      const result = await getConversations();
      expect(result.success).toBe(true);
      expect(result.data?.list.length).toBe(2);
    });

    it('should return empty list when no conversations', async () => {
      const store = useUserStore();
      store.userInfo = { _id: 'test', name: 'Test', role: 'farmer', status: 'active' } as any;
      store.role = 'farmer';
      store.status = 'active';
      store.isLoggedIn = true;

      mockCallFunction.mockResolvedValue({
        result: { code: 0, data: [] },
      });

      const result = await getConversations();
      expect(result.success).toBe(true);
      expect(result.data?.list.length).toBe(0);
    });

    it('should fail permission check', async () => {
      const store = useUserStore();
      store.isLoggedIn = false;

      const result = await getConversations();
      expect(result.success).toBe(false);
      expect(mockCallFunction).not.toHaveBeenCalled();
    });
  });

  describe('createConversation - 创建会话', () => {
    it('should create conversation successfully', async () => {
      const store = useUserStore();
      store.userInfo = { _id: 'test', name: 'Test', role: 'farmer', status: 'active' } as any;
      store.role = 'farmer';
      store.status = 'active';
      store.isLoggedIn = true;

      mockCallFunction.mockResolvedValue({
        result: { code: 0, data: { _id: 'conv_new_123' } },
      });

      const result = await createConversation('user_456', 'Receiver');
      expect(result.success).toBe(true);
      expect(result.conversationId).toBe('conv_new_123');
    });

    it('should fail with empty receiverId', async () => {
      const store = useUserStore();
      store.isLoggedIn = true;
      store.role = 'farmer';
      store.status = 'active';

      const result = await createConversation('');
      expect(result.success).toBe(false);
      expect(result.error).toBe('对方用户ID不能为空');
    });
  });

  describe('getMessages - 获取消息列表', () => {
    it('should get messages successfully and mark self messages', async () => {
      const store = useUserStore();
      store.userInfo = { _id: 'my_user_123', name: 'Me', role: 'farmer', status: 'active' } as any;
      store.role = 'farmer';
      store.status = 'active';
      store.isLoggedIn = true;

      mockCallFunction.mockResolvedValue({
        result: {
          code: 0,
          data: [
            { _id: 'msg1', senderId: 'my_user_123', content: 'Hello' },
            { _id: 'msg2', senderId: 'other_user', content: 'Hi there' },
          ],
        },
      });

      const result = await getMessages('conv_123');
      expect(result.success).toBe(true);
      expect(result.data?.list[0].isSelf).toBe(true);
      expect(result.data?.list[1].isSelf).toBe(false);
    });

    it('should fail with empty conversationId', async () => {
      const store = useUserStore();
      store.isLoggedIn = true;
      store.role = 'farmer';
      store.status = 'active';

      const result = await getMessages('');
      expect(result.success).toBe(false);
      expect(result.error).toBe('会话ID不能为空');
    });
  });

  describe('sendMessage - 发送消息', () => {
    it('should send text message successfully', async () => {
      const store = useUserStore();
      store.userInfo = { _id: 'test', name: 'Test', role: 'farmer', status: 'active' } as any;
      store.role = 'farmer';
      store.status = 'active';
      store.isLoggedIn = true;

      mockCallFunction.mockResolvedValue({
        result: { code: 0, msg: 'Success' },
      });

      const result = await sendMessage('conv_123', 'Hello world');
      expect(result.success).toBe(true);
    });

    it('should send image message successfully', async () => {
      const store = useUserStore();
      store.userInfo = { _id: 'test', name: 'Test', role: 'farmer', status: 'active' } as any;
      store.role = 'farmer';
      store.status = 'active';
      store.isLoggedIn = true;

      mockCallFunction.mockResolvedValue({
        result: { code: 0, msg: 'Success' },
      });

      const result = await sendImageMessage('conv_123', 'cloud://image.jpg');
      expect(result.success).toBe(true);
    });

    it('should fail with empty conversationId', async () => {
      const store = useUserStore();
      store.isLoggedIn = true;
      store.role = 'farmer';
      store.status = 'active';

      const result = await sendMessage('', 'Hello');
      expect(result.success).toBe(false);
      expect(result.error).toBe('会话ID不能为空');
    });

    it('should fail with empty content', async () => {
      const store = useUserStore();
      store.isLoggedIn = true;
      store.role = 'farmer';
      store.status = 'active';

      const result = await sendMessage('conv_123', '   ');
      expect(result.success).toBe(false);
      expect(result.error).toBe('消息内容不能为空');
    });

    it('should trim whitespace from content', async () => {
      const store = useUserStore();
      store.userInfo = { _id: 'test', name: 'Test', role: 'farmer', status: 'active' } as any;
      store.role = 'farmer';
      store.status = 'active';
      store.isLoggedIn = true;

      mockCallFunction.mockResolvedValue({
        result: { code: 0, msg: 'Success' },
      });

      await sendMessage('conv_123', '  Hello World  ');

      expect(mockCallFunction).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            payload: expect.objectContaining({
              content: 'Hello World',
            }),
          }),
        })
      );
    });

    it('should handle API error', async () => {
      const store = useUserStore();
      store.userInfo = { _id: 'test', name: 'Test', role: 'farmer', status: 'active' } as any;
      store.role = 'farmer';
      store.status = 'active';
      store.isLoggedIn = true;

      mockCallFunction.mockResolvedValue({
        result: { code: 500, msg: 'Failed to send' },
      });

      const result = await sendMessage('conv_123', 'Hello');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to send');
    });
  });

  describe('getContacts - 获取联系人列表', () => {
    it('should get contacts successfully', async () => {
      const store = useUserStore();
      store.userInfo = { _id: 'test', name: 'Test', role: 'farmer', status: 'active' } as any;
      store.role = 'farmer';
      store.status = 'active';
      store.isLoggedIn = true;

      mockCallFunction.mockResolvedValue({
        result: {
          code: 0,
          data: [
            { _id: 'user1', name: 'User 1' },
            { _id: 'user2', name: 'User 2' },
          ],
        },
      });

      const result = await getContacts();
      expect(result.success).toBe(true);
      expect(result.data?.length).toBe(2);
    });

    it('should fail permission check', async () => {
      const store = useUserStore();
      store.isLoggedIn = false;

      const result = await getContacts();
      expect(result.success).toBe(false);
      expect(mockCallFunction).not.toHaveBeenCalled();
    });
  });
});
