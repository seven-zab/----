import type { Entity, QueryValue, Repository, Transaction } from '../../server/core/repository';

// Serialized, rollback-capable test adapter. This is not evidence of CloudBase isolation.
export class MemoryRepository implements Repository {
  private tables = new Map<string, Map<string, Entity>>();
  private queue: Promise<void> = Promise.resolve();
  seed<T extends Entity>(collection: string, ...entities: T[]) {
    const table = this.tables.get(collection) ?? new Map<string, Entity>();
    for (const entity of entities) table.set(entity._id, structuredClone(entity));
    this.tables.set(collection, table);
  }
  rows<T extends Entity>(collection: string): T[] {
    return [...(this.tables.get(collection)?.values() ?? [])].map(
      (row) => structuredClone(row) as T,
    );
  }
  async get<T extends Entity>(collection: string, id: string): Promise<T | null> {
    return structuredClone((this.tables.get(collection)?.get(id) as T) ?? null);
  }
  async find<T extends Entity>(
    collection: string,
    filter: Record<string, QueryValue>,
    limit: number,
    options?: { after?: { created_at: number; id: string }; newest?: boolean },
  ): Promise<T[]> {
    let rows = this.rows<T>(collection).filter((row) =>
      Object.entries(filter).every(([key, value]) => {
        const actual = (row as unknown as Record<string, unknown>)[key];
        return Array.isArray(actual) ? actual.includes(value) : actual === value;
      }),
    );
    if (options?.newest)
      rows.sort(
        (a, b) =>
          Number((b as unknown as { created_at: number }).created_at) -
            Number((a as unknown as { created_at: number }).created_at) ||
          b._id.localeCompare(a._id),
      );
    if (options?.after) {
      const after = options.after;
      rows = rows.filter((r) => {
        const n = Number((r as unknown as { created_at: number }).created_at);
        return n < after.created_at || (n === after.created_at && r._id < after.id);
      });
    }
    return rows.slice(0, limit);
  }
  async transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    const previous = this.queue;
    let release = () => {};
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    const copy = structuredClone(this.tables);
    const tx: Transaction = {
      get: async <R extends Entity>(c: string, id: string) =>
        structuredClone((copy.get(c)?.get(id) as R) ?? null),
      put: async (c, e) => {
        const table = copy.get(c) ?? new Map<string, Entity>();
        table.set(e._id, structuredClone(e));
        copy.set(c, table);
      },
      remove: async (c, id) => {
        copy.get(c)?.delete(id);
      },
    };
    try {
      const result = await work(tx);
      this.tables = copy;
      return result;
    } finally {
      release();
    }
  }
}
