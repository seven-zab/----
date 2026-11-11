import { BusinessError, ensure } from '../core/errors';

// Operator configuration only. Never read a stage selection from a client event.
export const businessJobStages = [
  'knowledge',
  'claims',
  'demands',
  'completions',
  'inbox',
  'exports',
  'expire_exports',
  'retention',
  'file_deletions',
  'orphan_copies',
  'subscriptions',
] as const;
export type BusinessJobStage = (typeof businessJobStages)[number];

export function selectedBusinessStages(value: string | undefined): BusinessJobStage[] {
  if (!value?.trim()) return [];
  const selected = value.split(',').map((stage) => stage.trim());
  ensure(
    selected.every((stage) => businessJobStages.some((known) => known === stage)) &&
      new Set(selected).size === selected.length,
    'DEPENDENCY_UNAVAILABLE',
    '后台作业分项配置无效，须使用互不重复的已定义分项',
    503,
  );
  // Fixed dependency order regardless of configuration order.
  return businessJobStages.filter((stage) => selected.includes(stage));
}

export async function runSelectedBusinessStages(
  stages: readonly BusinessJobStage[],
  operations: Record<BusinessJobStage, () => Promise<unknown>>,
) {
  // Validate before the first side effect, including trusted callers using TS casts.
  const selected = selectedBusinessStages(stages.join(','));
  ensure(selected.length === stages.length, 'VALIDATION_FAILED', '后台作业分项无效', 400);
  const results: Partial<
    Record<
      BusinessJobStage,
      { state: 'completed'; result: unknown } | { state: 'failed'; error_code: string }
    >
  > = {};
  for (const [index, stage] of selected.entries()) {
    try {
      results[stage] = { state: 'completed', result: await operations[stage]() };
    } catch (error) {
      results[stage] = {
        state: 'failed',
        error_code: error instanceof BusinessError ? error.error_code : 'INTERNAL_ERROR',
      };
      return { state: 'failed', results, skipped: selected.slice(index + 1) };
    }
  }
  return { state: 'completed', results, skipped: [] };
}
