// Parse only the narrowly filtered DescribeDocProcessBucket response. A
// successful document-preview lookup says nothing about moderation or malware.
export function documentPreviewStatus(parsed, expectedBucket) {
  const root = parsed?.Response;
  if (!root || typeof root !== 'object' || typeof expectedBucket !== 'string' || !expectedBucket)
    throw new Error('Invalid document-preview response');
  if (!/^(0|[1-9]\d*)$/u.test(String(root.TotalCount ?? ''))) throw new Error('Invalid count');
  const count = Number(root.TotalCount);
  if (!Number.isSafeInteger(count) || count > 10) throw new Error('Unexpected result size');
  const rows = root.DocBucketList
    ? Array.isArray(root.DocBucketList)
      ? root.DocBucketList
      : [root.DocBucketList]
    : [];
  if (rows.length !== count) throw new Error('Incomplete bucket results');
  if (rows.some((row) => row?.Name !== expectedBucket && row?.BucketId !== expectedBucket))
    throw new Error('Unexpected bucket in exact-name query');
  if (count > 1) throw new Error('Duplicate bucket result');
  return { match_count: count, target_bucket_listed: count === 1 };
}
