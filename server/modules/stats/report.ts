import { ensure } from '../../core/errors';
import {
  categories,
  overview,
  trend,
  type StatsScope,
  type ConfirmedParticipant,
} from './aggregate';
import type { Demand } from '../demand/service';
export type ReportKind = 'overview' | 'trend' | 'category';
type Cell = string | number | null;
export interface ReportTable {
  report: ReportKind;
  columns: string[];
  rows: Cell[][];
}
export const reportFields = {
  overview: [
    'demand_count',
    'publisher_count',
    'delegated_operator_count',
    'published_count',
    'completed_count',
    'resolution_rate',
    'participant_count',
    'average_resolution_ms',
    'completed_in_period',
    'pending_audit',
    'pending_claim',
    'processing',
    'pending_review',
    'rejected',
    'cancelled',
    'terminated',
  ],
  trend: ['start_at', 'submitted_count', 'completed_in_period'],
  category: ['type', 'demand_count', 'completed_count'],
} as const;
const defaultOverview = [
  'demand_count',
  'completed_count',
  'resolution_rate',
  'completed_in_period',
];
export const reportNames: Record<ReportKind, string> = {
  overview: '统计总览',
  trend: '每日趋势',
  category: '板块分布',
};
export const reportColumnLabels: Record<string, string> = {
  demand_count: '同批需求数',
  publisher_count: '发布人数',
  delegated_operator_count: '代发人数',
  published_count: '通过审核数',
  completed_count: '同批已验收数',
  resolution_rate: '同批解决率',
  participant_count: '参与人数',
  average_resolution_ms: '平均解决用时（毫秒）',
  completed_in_period: '期间验收数',
  pending_audit: '当前待审数',
  pending_claim: '当前待接数',
  processing: '当前服务中',
  pending_review: '当前待验收',
  rejected: '同批驳回数',
  cancelled: '同批取消数',
  terminated: '同批终止数',
  start_at: '日期',
  submitted_count: '提交数',
  type: '板块',
  report_scope: '统计范围',
  period_start_inclusive: '统计开始（含）',
  period_end_exclusive: '统计结束（不含）',
  data_as_of: '数据截至（北京时间）',
};
const typeLabels: Record<string, string> = {
  enterprise: '企需通',
  agriculture: '农践帮',
  research: '科研实践厅',
  campus: '校园任务',
};
export function validateFields(report: ReportKind, fields?: string[]) {
  const allowed: readonly string[] = reportFields[report];
  ensure(
    !fields ||
      (fields.length > 0 &&
        new Set(fields).size === fields.length &&
        fields.every((f) => allowed.includes(f))),
    'VALIDATION_FAILED',
    '导出字段不属于所选统计表',
    400,
  );
  return fields ?? [...allowed];
}
export function shanghaiTime(time: number) {
  return new Date(time + 8 * 3600000).toISOString().replace('T', ' ').replace('Z', ' +08:00');
}
export function buildReport(
  demands: Demand[],
  participants: ConfirmedParticipant[],
  q: StatsScope,
  report: ReportKind,
  now: number,
  fields?: string[],
  regionName?: string,
): ReportTable {
  const selected = validateFields(
    report,
    fields ?? (report === 'overview' ? defaultOverview : undefined),
  );
  const stats = overview(demands, participants, q, now);
  let records: Array<Record<string, Cell>>;
  if (report === 'overview') {
    const { by_status, ...cohort } = stats.cohort;
    records = [
      {
        ...cohort,
        ...stats.flow,
        ...stats.stock,
        rejected: by_status.rejected,
        cancelled: by_status.cancelled,
        terminated: by_status.terminated,
      },
    ];
  } else if (report === 'trend')
    records = trend(demands, q, 'day').points.map((p) => ({
      ...p,
      start_at: shanghaiTime(p.start_at),
    }));
  else records = categories(demands, q).items;
  ensure(records.length <= 5000, 'VALIDATION_FAILED', '导出超过5000行，请缩小范围', 400);
  const scene =
    q.business_scene === 'campus'
      ? '深圳技术大学校园'
      : q.business_scene === 'village'
      ? regionName
        ? `乡村 · ${regionName}`
        : q.scope_region_id
        ? '所选村域'
        : '乡村'
      : '全平台';
  const context: Cell[] = [
    q.type ? `${scene} · ${typeLabels[q.type]}` : scene,
    shanghaiTime(q.start_at),
    shanghaiTime(q.end_at),
    shanghaiTime(now),
  ];
  return {
    report,
    columns: [
      ...selected,
      'report_scope',
      'period_start_inclusive',
      'period_end_exclusive',
      'data_as_of',
    ],
    rows: records.map((r) => [...selected.map((f) => r[f] ?? null), ...context]),
  };
}
export function safeText(text: string) {
  let index = 0;
  while (index < text.length && (text.charCodeAt(index) <= 32 || /\s/u.test(text[index]))) index++;
  return index < text.length && '=+@-'.includes(text[index]) ? `'${text}` : text;
}
function displayReport(table: ReportTable) {
  const first = table.rows[0] ?? [];
  const metadata = (key: string) => {
    const value = first[table.columns.indexOf(key)];
    return typeof value === 'string' ? value : '';
  };
  const start = metadata('period_start_inclusive');
  const end = metadata('period_end_exclusive');
  const asOf = metadata('data_as_of');
  const context: Cell[][] = [[reportNames[table.report]]];
  const scope = metadata('report_scope');
  if (scope) context.push(['统计范围', scope]);
  if (start && end) {
    const endDay = new Date(Date.parse(end.slice(0, 10)) - 1);
    const wholeDays =
      start.slice(11, 23) === '00:00:00.000' &&
      end.slice(11, 23) === '00:00:00.000' &&
      Number.isFinite(endDay.getTime());
    context.push([
      '统计日期',
      wholeDays
        ? `${start.slice(0, 10)} 至 ${endDay.toISOString().slice(0, 10)}`
        : `${start.slice(0, 16)} 至 ${end.slice(0, 16)}（截止不含）`,
    ]);
  }
  if (asOf) context.push(['数据截至', `${asOf.slice(0, 16)}（北京时间）`]);

  // Frozen snapshots may include old internal columns. Only report fields belong in the body.
  const allowed: readonly string[] = reportFields[table.report];
  const metrics = table.columns
    .map((key, index) => ({ key, index }))
    .filter(({ key }) => allowed.includes(key));
  const labels = metrics.map(({ key }) => reportColumnLabels[key]);
  const percentages: Array<{ row: number; column: number }> = [];
  const rows = [...context];
  if (table.report === 'overview') {
    rows.push(['指标', '数值']);
    metrics.forEach(({ key, index }, i) => {
      if (key === 'resolution_rate') percentages.push({ row: rows.length, column: 1 });
      rows.push([labels[i], first[index] ?? null]);
    });
  } else {
    rows.push(labels);
    for (const row of table.rows)
      rows.push(
        metrics.map(({ key, index }) => {
          const value = row[index];
          if (key === 'type' && typeof value === 'string') return typeLabels[value] ?? '其他';
          if (key === 'start_at' && typeof value === 'string') return value.slice(0, 10);
          return value;
        }),
      );
  }
  return { rows, heading: context.length + 1, percentages };
}
export function renderCsv(table: ReportTable): Buffer {
  const { rows, percentages } = displayReport(table);
  for (const { row, column } of percentages) {
    const value = rows[row][column];
    if (typeof value === 'number') rows[row][column] = `${(value * 100).toFixed(1)}%`;
  }
  const width = Math.max(2, ...rows.map((row) => row.length));
  const cell = (v: Cell) =>
    v === null ? '' : typeof v === 'number' ? String(v) : `"${safeText(v).replace(/"/g, '""')}"`;
  return Buffer.from(
    '\uFEFF' +
      rows
        .map((row) =>
          Array.from({ length: width }, (_, index) => cell(row[index] ?? null)).join(','),
        )
        .join('\r\n') +
      '\r\n',
    'utf8',
  );
}
export async function renderXlsx(table: ReportTable): Promise<Buffer> {
  const ExcelJS = await import('exceljs');
  const { rows, heading, percentages } = displayReport(table);
  const book = new ExcelJS.Workbook();
  book.creator = '云治乡智';
  const sheet = book.addWorksheet(reportNames[table.report]);
  for (const row of rows) sheet.addRow(row.map((v) => (typeof v === 'string' ? safeText(v) : v)));
  sheet.getRow(1).font = { bold: true, size: 15 };
  sheet.getRow(heading).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: heading }];
  sheet.getColumn(1).width = 20;
  sheet.getColumn(2).width = 27;
  if (table.report !== 'overview') sheet.getColumn(3).width = 15;
  for (let row = 2; row < heading; row++) {
    const line = sheet.getRow(row);
    line.height = 30;
    line.getCell(2).alignment = { wrapText: true, vertical: 'middle' };
  }
  for (const { row, column } of percentages) sheet.getCell(row + 1, column + 1).numFmt = '0.0%';
  const bytes = await book.xlsx.writeBuffer();
  return Buffer.from(new Uint8Array(bytes));
}
