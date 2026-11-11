import { cloudCall, newRequestId } from './cloudClient';
import { businessCommand } from './businessCommand';
import { useSessionStore } from '../stores/session';
export const getExamples = () => cloudCall('aiService.getExamples', {});
export const createSession = () =>
  businessCommand('aiService.createSession', { mode: 'assistant' });
export const listSessions = (cursor?: string) =>
  cloudCall('aiService.listSessions', { ...(cursor ? { cursor } : {}) });
export const listMessages = (session_id: string, cursor?: string) =>
  cloudCall('aiService.listMessages', { session_id, ...(cursor ? { cursor } : {}) });
export const sendMessage = (
  session_id: string,
  client_message_id: string,
  content: string,
  attachment_ids: string[],
) =>
  cloudCall(
    'aiService.sendMessage',
    { session_id, client_message_id, content, attachment_ids },
    { ...useSessionStore().options(), idempotency_key: client_message_id },
  );
export const getJob = (job_id: string) => cloudCall('aiService.getJob', { job_id });
export const getQuota = () => cloudCall('aiService.getQuota', {});
export const getProposal = (proposal_id: string) =>
  cloudCall('aiService.getProposal', { proposal_id });
export const cancelIntent = (intent_id: string, expected_version: number) =>
  cloudCall(
    'aiService.cancelPendingIntent',
    { intent_id, expected_version },
    { idempotency_key: newRequestId() },
  );
export const deleteSession = (session_id: string) =>
  businessCommand('aiService.deleteSession', { session_id });
