import { cloudCall, newRequestId } from './cloudClient';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { utf8ToBytes } from './utf8';
import { businessCommand } from './businessCommand';
import { useSessionStore } from '../stores/session';
import type { ContractMap } from '../../contracts/generated/dto';
export type ConversationSummary = ContractMap['chatService.listMine']['response']['items'][number];
export type Message = ContractMap['chatService.getMessages']['response']['items'][number];
export const listConversations = (cursor?: string) =>
  cloudCall('chatService.listMine', { ...(cursor ? { cursor } : {}) }, useSessionStore().options());
export const listContacts = (cursor?: string) =>
  cloudCall(
    'contactService.listContacts',
    { ...(cursor ? { cursor } : {}) },
    useSessionStore().options(),
  );
export const createDemandConversation = (
  demand_id: string,
  claim_id?: string,
  boundGrant?: string | null,
) =>
  businessCommand(
    'chatService.createDemandConversation',
    { demand_id, ...(claim_id ? { claim_id } : {}) },
    boundGrant,
  );
export const getMessages = (conversation_id: string, cursor?: string) =>
  cloudCall(
    'chatService.getMessages',
    { conversation_id, ...(cursor ? { cursor } : {}) },
    useSessionStore().options(),
  );
export const sendChat = (data: ContractMap['chatService.sendMessage']['request']) =>
  businessCommand('chatService.sendMessage', data);
export const markRead = (conversation_id: string, last_read_message_id: string) =>
  businessCommand('chatService.markRead', { conversation_id, last_read_message_id });
export async function sendDraftMessage(conversation_id: string, content: string, file_id?: string) {
  const receipt =
    'chat-pending:' +
    bytesToHex(
      sha256(
        utf8ToBytes(
          JSON.stringify({
            actor: useSessionStore().me?.user_id,
            conversation_id,
            content,
            file_id,
          }),
        ),
      ),
    );
  const stored: unknown = uni.getStorageSync(receipt);
  const client_message_id = typeof stored === 'string' && stored ? stored : newRequestId();
  uni.setStorageSync(receipt, client_message_id);
  const result = await sendChat(
    file_id
      ? { conversation_id, client_message_id, content_type: 'image', content, file_id }
      : { conversation_id, client_message_id, content_type: 'text', content },
  );
  uni.removeStorageSync(receipt);
  return result;
}
