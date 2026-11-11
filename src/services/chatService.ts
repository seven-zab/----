// Compatibility facade for callers migrating to demand-associated v1 conversations.
import { useSessionStore } from '../stores/session';
import {
  listConversations,
  listContacts,
  getMessages as readMessages,
  sendDraftMessage,
} from './chatV1';
import { errorMessage } from '../utils/display';
export interface Conversation {
  _id: string;
  name: string;
  updatedAt: number;
}
export interface Message {
  _id: string;
  conversationId: string;
  senderId: string;
  type: 'text' | 'image' | 'file';
  content: string;
  createTime: number;
  isSelf: boolean;
}
export interface ConversationListResult {
  list: Conversation[];
  total: number;
}
export interface MessageListResult {
  list: Message[];
  total: number;
}
export const checkChatPermission = (): { allowed: boolean; error?: string } =>
  useSessionStore().me ? { allowed: true } : { allowed: false, error: '请先登录' };
export async function getConversations() {
  const permission = checkChatPermission();
  if (!permission.allowed) return { success: false, error: permission.error };
  try {
    const result = await listConversations();
    const list = result.items.map((c) => ({
      _id: c.conversation_id,
      name: c.display_name,
      updatedAt: c.updated_at,
    }));
    return { success: true, data: { list, total: list.length, next_cursor: result.next_cursor } };
  } catch (e) {
    return { success: false, error: errorMessage(e) };
  }
}
export async function createConversation(receiverId: string, receiverName?: string) {
  void receiverId;
  void receiverName;
  return {
    success: false,
    conversationId: undefined,
    error: '请从需求详情发起咨询，不支持按陌生用户创建会话',
  };
}
export async function getMessages(conversationId: string) {
  if (!checkChatPermission().allowed) return { success: false, error: '请先登录' };
  if (!conversationId) return { success: false, error: '会话ID不能为空' };
  try {
    const result = await readMessages(conversationId);
    const list = result.items.map((m) => ({
      _id: m.message_id,
      conversationId: m.conversation_id,
      senderId: m.sender_user_id,
      type: m.content_type,
      content: m.content,
      createTime: m.created_at,
      isSelf: m.sender_user_id === useSessionStore().me?.user_id,
    }));
    return { success: true, data: { list, total: list.length, next_cursor: result.next_cursor } };
  } catch (e) {
    return { success: false, error: errorMessage(e) };
  }
}
export async function sendMessage(
  conversationId: string,
  content: string,
  type: 'text' | 'image' = 'text',
) {
  if (!checkChatPermission().allowed) return { success: false, error: '请先登录' };
  if (!conversationId || !content.trim())
    return { success: false, error: '会话与消息内容不能为空' };
  if (type !== 'text')
    return { success: false, error: '请使用经检查并绑定的附件，不支持旧图片链接' };
  try {
    await sendDraftMessage(conversationId, content.trim());
    return { success: true };
  } catch (e) {
    return { success: false, error: errorMessage(e) };
  }
}
export const sendImageMessage = (conversationId: string, imageUrl: string) =>
  sendMessage(conversationId, imageUrl, 'image');
export async function getContacts() {
  if (!checkChatPermission().allowed) return { success: false, error: '请先登录' };
  try {
    const result = await listContacts();
    return { success: true, data: result.items, next_cursor: result.next_cursor };
  } catch (e) {
    return { success: false, error: errorMessage(e) };
  }
}
