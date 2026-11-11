export interface Entity {
  _id: string;
}
export interface Transaction {
  get<T extends Entity>(collection: string, id: string): Promise<T | null>;
  put<T extends Entity>(collection: string, entity: T): Promise<void>;
  remove(collection: string, id: string): Promise<void>;
}
export type QueryValue = string | number | boolean | null;
export interface Repository {
  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T>;
  get<T extends Entity>(collection: string, id: string): Promise<T | null>;
  find<T extends Entity>(
    collection: string,
    filter: Record<string, QueryValue>,
    limit: number,
    options?: { after?: { created_at: number; id: string }; newest?: boolean },
  ): Promise<T[]>;
}
