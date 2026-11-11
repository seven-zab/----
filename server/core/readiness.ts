import type { Entity, Repository } from './repository';
export async function migrationReadiness(repo: Repository) {
  try {
    const record = await repo.get<Entity & { schema_version: number; status: string }>(
      'system_guards',
      'v2_migration',
    );
    const migration_verified = record?.schema_version === 2 && record.status === 'verified';
    return {
      migration_verified,
      state: migration_verified ? ('verified' as const) : ('migration_required' as const),
    };
  } catch {
    return { migration_verified: false, state: 'unavailable' as const };
  }
}
