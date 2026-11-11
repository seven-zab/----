import { cloudCall } from './cloudClient';
import { businessCommand } from './businessCommand';
import { useSessionStore } from '../stores/session';
import type { ContractMap } from '../../contracts/generated/dto';
export type StatsQuery = ContractMap['statsService.getOverview']['request'];
export const getOverview = (query: StatsQuery) =>
  cloudCall('statsService.getOverview', query, useSessionStore().options());
export const getTrend = (query: StatsQuery) =>
  cloudCall('statsService.getTrend', { ...query, interval: 'day' }, useSessionStore().options());
export const getCategory = (query: StatsQuery) =>
  cloudCall('statsService.getCategoryBreakdown', query, useSessionStore().options());
export const createExport = (
  query: StatsQuery,
  format: 'csv' | 'xlsx',
  report: 'overview' | 'trend' | 'category',
) => businessCommand('statsService.createExport', { ...query, format, report });
export const getExport = (export_job_id: string) =>
  cloudCall('statsService.getExport', { export_job_id }, useSessionStore().options());
export const exportUrl = (export_job_id: string, file_id: string) =>
  cloudCall(
    'fileService.getAccessUrl',
    {
      file_ids: [file_id],
      resource_type: 'export',
      resource_id: export_job_id,
      purpose: '下载统计报表',
    },
    useSessionStore().options(),
  );
