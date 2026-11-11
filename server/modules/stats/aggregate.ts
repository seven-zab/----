import type { DemandStatus, DemandType } from '../../../contracts/enums';
import type { Demand } from '../demand/service';
export const STATS_ALGORITHM = 'cohort-first-submission-v2';
export interface StatsQuery {
  start_at: number;
  end_at: number;
  business_scene?: 'village' | 'campus';
  campus_organization_id?: string;
  scope_region_id?: string;
  type?: DemandType;
}
export interface StatsScope extends StatsQuery {
  business_scene?: 'village' | 'campus';
}
export interface ConfirmedParticipant {
  demand_id: string;
  user_id: string;
}
export interface StatsOverview {
  cohort: {
    demand_count: number;
    publisher_count: number;
    delegated_operator_count: number;
    published_count: number;
    completed_count: number;
    resolution_rate: number | null;
    participant_count: number;
    average_resolution_ms: number | null;
    by_status: Record<DemandStatus, number>;
  };
  flow: { completed_in_period: number };
  stock: {
    pending_audit: number;
    pending_claim: number;
    processing: number;
    pending_review: number;
  };
  generated_at: number;
  data_as_of: number;
  algorithm_version: string;
}
export const inPeriod = (time: number | null, q: StatsQuery) =>
  time !== null && time >= q.start_at && time < q.end_at;
export function overview(
  demands: Demand[],
  participants: ConfirmedParticipant[],
  q: StatsQuery,
  now: number,
): StatsOverview {
  const cohort = demands.filter((d) => inPeriod(d.first_submitted_at, q));
  const cohortIds = new Set(cohort.map((d) => d._id));
  const completed = cohort.filter((d) => d.status === 'completed' && d.completed_at !== null);
  const by_status: Record<DemandStatus, number> = {
    draft: 0,
    pending_audit: 0,
    rejected: 0,
    pending_claim: 0,
    claiming: 0,
    processing: 0,
    pending_review: 0,
    completed: 0,
    cancelled: 0,
    expired: 0,
    terminated: 0,
  };
  for (const d of cohort) by_status[d.status]++;
  return {
    cohort: {
      demand_count: cohort.length,
      publisher_count: new Set(cohort.map((d) => d.owner_id)).size,
      delegated_operator_count: new Set(
        cohort.filter((d) => d.created_by !== d.owner_id).map((d) => d.created_by),
      ).size,
      published_count: cohort.filter((d) => d.first_approved_at !== null).length,
      completed_count: completed.length,
      resolution_rate: cohort.length ? completed.length / cohort.length : null,
      participant_count: new Set(
        participants.filter((p) => cohortIds.has(p.demand_id)).map((p) => p.user_id),
      ).size,
      average_resolution_ms: completed.length
        ? completed.reduce(
            (sum, d) => sum + Math.max(0, d.completed_at! - d.first_submitted_at!),
            0,
          ) / completed.length
        : null,
      by_status,
    },
    flow: {
      completed_in_period: demands.filter(
        (d) => d.status === 'completed' && inPeriod(d.completed_at, q),
      ).length,
    },
    stock: {
      pending_audit: demands.filter((d) => d.status === 'pending_audit').length,
      pending_claim: demands.filter((d) => d.status === 'pending_claim').length,
      processing: demands.filter((d) => d.status === 'processing').length,
      pending_review: demands.filter((d) => d.status === 'pending_review').length,
    },
    generated_at: now,
    data_as_of: now,
    algorithm_version: STATS_ALGORITHM,
  };
}
function bucketStart(time: number, interval: 'day' | 'week' | 'month') {
  const d = new Date(time + 8 * 3600000);
  d.setUTCHours(0, 0, 0, 0);
  if (interval === 'week') d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  if (interval === 'month') d.setUTCDate(1);
  return d.getTime() - 8 * 3600000;
}
function nextBucket(time: number, interval: 'day' | 'week' | 'month') {
  if (interval !== 'month') return time + (interval === 'week' ? 7 : 1) * 86400000;
  const d = new Date(time + 8 * 3600000);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.getTime() - 8 * 3600000;
}
export function trend(demands: Demand[], q: StatsQuery, interval: 'day' | 'week' | 'month') {
  const points: Array<{ start_at: number; submitted_count: number; completed_in_period: number }> =
    [];
  for (
    let start = bucketStart(q.start_at, interval);
    start < q.end_at;
    start = nextBucket(start, interval)
  ) {
    const range = {
      ...q,
      start_at: Math.max(start, q.start_at),
      end_at: Math.min(nextBucket(start, interval), q.end_at),
    };
    points.push({
      start_at: range.start_at,
      submitted_count: demands.filter((d) => inPeriod(d.first_submitted_at, range)).length,
      completed_in_period: demands.filter(
        (d) => d.status === 'completed' && inPeriod(d.completed_at, range),
      ).length,
    });
  }
  return { points };
}
export function categories(demands: Demand[], q: StatsQuery) {
  const types: DemandType[] = ['enterprise', 'agriculture', 'research', 'campus'];
  const cohort = demands.filter((d) => inPeriod(d.first_submitted_at, q));
  return {
    items: types.map((type) => ({
      type,
      demand_count: cohort.filter((d) => d.form.type === type).length,
      completed_count: cohort.filter((d) => d.form.type === type && d.status === 'completed')
        .length,
    })),
  };
}
