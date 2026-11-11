import { cloudCall } from './cloudClient';
import { businessCommand } from './businessCommand';
import { useSessionStore } from '../stores/session';
import type { ContractMap } from '../../contracts/generated/dto';
export const searchKnowledge = (query: ContractMap['knowledgeService.search']['request']) =>
  cloudCall('knowledgeService.search', query, useSessionStore().options());
export const getDocument = (document_id: string, version?: number) =>
  cloudCall(
    'knowledgeService.getDocument',
    { document_id, ...(version ? { version } : {}) },
    useSessionStore().options(),
  );
export const saveKnowledge = (data: ContractMap['knowledgeService.saveDraft']['request']) =>
  businessCommand('knowledgeService.saveDraft', data);
export const importKnowledge = (data: ContractMap['knowledgeService.importDraft']['request']) =>
  businessCommand('knowledgeService.importDraft', data);
export const publishKnowledge = (document_id: string, expected_version: number, reason: string) =>
  businessCommand('knowledgeService.publish', { document_id, expected_version, reason });
export const unpublishKnowledge = (document_id: string, expected_version: number, reason: string) =>
  businessCommand('knowledgeService.unpublish', { document_id, expected_version, reason });
