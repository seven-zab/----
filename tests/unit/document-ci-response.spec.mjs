// @vitest-environment node
import { expect, it } from 'vitest';
import { documentPreviewStatus } from '../../scripts/lib/document-ci-response.mjs';

it('accepts only complete, exact bucket lookup results', () => {
  expect(documentPreviewStatus({ Response: { TotalCount: '0' } }, 'target')).toEqual({
    match_count: 0,
    target_bucket_listed: false,
  });
  expect(
    documentPreviewStatus(
      { Response: { TotalCount: '1', DocBucketList: { Name: 'target' } } },
      'target',
    ),
  ).toEqual({
    match_count: 1,
    target_bucket_listed: true,
  });
  expect(() => documentPreviewStatus({ Response: { TotalCount: '1' } }, 'target')).toThrow();
  expect(() =>
    documentPreviewStatus(
      { Response: { TotalCount: '1', DocBucketList: { Name: 'other' } } },
      'target',
    ),
  ).toThrow();
  expect(() => documentPreviewStatus({ Response: { TotalCount: 'many' } }, 'target')).toThrow();
});
