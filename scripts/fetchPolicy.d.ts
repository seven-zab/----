export interface LegacyMockPolicy {
  title: string;
  summary: string;
  sourceUrl: string;
  publishDate: string;
  fetchDate: Date;
}
export function fetchPolicies(): Promise<LegacyMockPolicy[]>;
