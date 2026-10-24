import { useUserStore } from '@/stores/user';

export interface Conversation {
  _id: string;
  name: string;
  avatar?: string;
  lastMessage?: string;
  unreadCount: number;
  updatedAt: number;
}

export interface Message {
  _id: string;
  conversationId: string;
  senderId: string;
  receiverId: string;
  type: 'text' | 'image' | 'system';
  content: string;
  createTime: number;
  isSelf?: boolean;
}

export interface ConversationListResult {
  list: Conversation[];
  total: number;
}

export interface MessageListResult {
  list: Message[];
  total: number;
}

const checkChatPermission = (): { allowed: boolean; error?: string } => {
  const userStore = useUserStore();
  if (!userStore.isLoggedIn) {
    return { allowed: false, error: '请先登录' };
  }
  if (!userStore.canChat) {
    return { allowed: false, error: '您没有聊天权限' };
  }
  return { allowed: true };
};

export const getConversations = async (): Promise<{ success: boolean; data?: ConversationListResult; error?: string }> => {
  const permission = checkChatPermission();
  if (!permission.allowed) {
    return { success: false, error: permission.error };
  }

  try {
    const { result } = await wx.cloud.callFunction({
      name: 'chatService',
      data: {
        action: 'getConversations',
      },
    });

    if (result.code === 0) {
      return { success: true, data: { list: result.data || [], total: result.data?.length || 0 } };
    } else {
      return { success: false, error: result.msg };
    }
  } catch (e: any) {
    return { success: false, error: e.message || '网络错误' };
  }
};

export const createConversation = async (receiverId: string, receiverName?: string): Promise<{ success: boolean; conversationId?: string; error?: string }> => {
  const permission = checkChatPermission();
  if (!permission.allowed) {
    return { success: false, error: permission.error };
  }

  if (!receiverId) {
    return { success: false, error: '对方用户ID不能为空' };
  }

  try {
    const { result } = await wx.cloud.callFunction({
      name: 'chatService',
      data: {
        action: 'createConversation',
        payload: { receiverId, receiverName },
      },
    });

    if (result.code === 0) {
      return { success: true, conversationId: result.data?._id };
    } else {
      return { success: false, error: result.msg };
    }
  } catch (e: any) {
    return { success: false, error: e.message || '网络错误' };
  }
};

export const getMessages = async (conversationId: string): Promise<{ success: boolean; data?: MessageListResult; error?: string }> => {
  const permission = checkChatPermission();
  if (!permission.allowed) {
    return { success: false, error: permission.error };
  }

  if (!conversationId) {
    return { success: false, error: '会话ID不能为空' };
  }

  try {
    const { result } = await wx.cloud.callFunction({
      name: 'chatService',
      data: {
        action: 'getMessages',
        payload: { conversationId },
      },
    });

    if (result.code === 0) {
      const userStore = useUserStore();
      const userId = userStore.userInfo?._id || userStore.userInfo?.openid;
      const list = (result.data || []).map((msg: any) => ({
        ...msg,
        isSelf: msg.senderId === userId,
      }));
      return { success: true, data: { list, total: list.length } };
    } else {
      return { success: false, error: result.msg };
    }
  } catch (e: any) {
    return { success: false, error: e.message || '网络错误' };
  }
};

export const sendMessage = async (conversationId: string, content: string, type: 'text' | 'image' = 'text'): Promise<{ success: boolean; error?: string }> => {
  const permission = checkChatPermission();
  if (!permission.allowed) {
    return { success: false, error: permission.error };
  }

  if (!conversationId) {
    return { success: false, error: '会话ID不能为空' };
  }

  if (!content || content.trim() === '') {
    return { success: false, error: '消息内容不能为空' };
  }

  try {
    const { result } = await wx.cloud.callFunction({
      name: 'chatService',
      data: {
        action: 'sendMessage',
        payload: {
          conversationId,
          type,
          content: content.trim(),
        },
      },
    });

    if (result.code === 0) {
      return { success: true };
    } else {
      return { success: false, error: result.msg };
    }
  } catch (e: any) {
    return { success: false, error: e.message || '网络错误' };
  }
};

export const sendImageMessage = async (conversationId: string, imageUrl: string): Promise<{ success: boolean; error?: string }> => {
  return sendMessage(conversationId, imageUrl, 'image');
};

export const getContacts = async (): Promise<{ success: boolean; data?: any[]; error?: string }> => {
  const permission = checkChatPermission();
  if (!permission.allowed) {
    return { success: false, error: permission.error };
  }

  try {
    const { result } = await wx.cloud.callFunction({
      name: 'chatService',
      data: {
        action: 'getContacts',
      },
    });

    if (result.code === 0) {
      return { success: true, data: result.data || [] };
    } else {
      return { success: false, error: result.msg };
    }
  } catch (e: any) {
    return { success: false, error: e.message || '网络错误' };
  }
};

export { checkChatPermission };
