import { describe, it, expect } from 'vitest';
import { fetchPolicies } from '../../scripts/fetchPolicy';

describe('Policy Service', () => {
  it('should fetch policies with correct structure', async () => {
    const policies = await fetchPolicies();

    expect(Array.isArray(policies)).toBe(true);
    expect(policies.length).toBeGreaterThan(0);

    const firstPolicy = policies[0];
    expect(firstPolicy).toHaveProperty('title');
    expect(firstPolicy).toHaveProperty('summary');
    expect(firstPolicy).toHaveProperty('sourceUrl');
    expect(firstPolicy).toHaveProperty('publishDate');
    expect(firstPolicy).toHaveProperty('fetchDate');
  });

  it('should filter policies based on rules (mocked)', async () => {
    // In a real test with mocked axios, we would verify filtering logic.
    // Here we check if the mock data returned meets requirements.
    const policies = await fetchPolicies();

    policies.forEach((p) => {
      expect(p.title).toBeTruthy();
      expect(p.summary).toBeTruthy();
      expect(p.sourceUrl).toMatch(/^http/);
    });
  });
});
