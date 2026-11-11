import type { Entity } from '../../core/repository';
import type { ContractMap } from '../../../contracts/generated/dto';
export type Operation = ContractMap['aiService.getOperation']['response'];
export interface AISession extends Entity {
  owner_id: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  active_job_id: string | null;
  pending_intent_id: string | null;
}
export interface AIMessage extends Entity {
  owner_id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  sealed_content: string;
  attachment_ids: string[];
  created_at: number;
  intent_id: string | null;
  quota_charged: boolean;
}
export interface AIJob extends Entity {
  owner_id: string;
  openid: string;
  session_id: string;
  source_message_id: string;
  answer_message_id: string | null;
  grant_id: string | null;
  intent_id: string | null;
  status: 'queued' | 'running' | 'succeeded' | 'partial_success' | 'failed';
  lease_token: string | null;
  lease_until: number;
  created_at: number;
  error_code: string | null;
  business_done: boolean;
  general_done: boolean;
  business_answer: string | null;
  general_answer: string | null;
  general_status: 'not_requested' | 'answered' | 'quota_exceeded' | 'failed';
  route: { business_text: string | null; general_text: string | null } | null;
}
export interface AIIntent extends Entity {
  owner_id: string;
  session_id: string;
  source_message_id: string;
  source_message_hash: string;
  action: Operation['action'];
  status: Operation['status'];
  version: number;
  grant_id: string | null;
  target_demand_id: string | null;
  proposal_id: string | null;
  expires_at: number;
  created_at: number;
  result: Operation | null;
  error_code: string | null;
}
export interface AIProposal extends Entity {
  last_tool_key?: string;
  owner_id: string;
  session_id: string;
  intent_id: string;
  draft: ContractMap['aiService.getProposal']['response']['draft'];
  version: number;
  draft_hash: string;
  missing_fields: string[];
  validation_errors: string[];
  status: 'editing' | 'ready' | 'submitted' | 'expired';
  created_at: number;
}
export const RETENTION_MS = 90 * 86400000;
export const LEASE_MS = 120000;
