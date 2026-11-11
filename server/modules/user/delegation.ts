import type { Entity } from '../../core/repository';
import type { Scene } from '../../core/entities';
import type { DemandMutationResult } from '../../../contracts/generated/dto';
export interface Delegation extends Entity, Scene {
  beneficiary_id: string;
  delegate_id: string;
  participant_user_ids: string[];
  status: 'pending' | 'approved' | 'rejected' | 'revoked' | 'consumed';
  version: number;
  created_at: number;
  ciphertext: string;
  draft_hash: string | null;
  beneficiary_grant_id: string;
  consumed_demand_id: string | null;
  consumed_result: DemandMutationResult | null;
}
export const delegationDTO = (d: Delegation) => ({
  authorization_id: d._id,
  beneficiary_id: d.beneficiary_id,
  delegate_id: d.delegate_id,
  status: d.status,
  version: d.version,
  created_at: d.created_at,
  consumed_demand_id: d.consumed_demand_id,
});
