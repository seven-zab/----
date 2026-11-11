import type { DemandStatus } from '../../../contracts/enums';
import type { Demand } from './service';

export const visibleStatuses: DemandStatus[] = [
  'pending_claim',
  'claiming',
  'processing',
  'pending_review',
  'completed',
];
export const isDemandPublic = (d: Demand) =>
  d.visibility === 'public' && visibleStatuses.includes(d.status) && d.approved_at !== null;
