// @vitest-environment node
import { beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createHandler } from '../../server/handler';
import { privateDataCodec } from '../../server/core/private-data';
import { MemoryRepository } from '../helpers/memory-repository';
import { seedIdentity } from '../helpers/identity';
import {
  retrieveForAssistant,
  publishGeneratedKnowledge,
  type KnowledgeDocument,
} from '../../server/modules/knowledge/service';
import type { User, Grant } from '../../server/core/entities';
import release from '../../contracts/generated/release.json';
let repo: MemoryRepository;
let handler: ReturnType<typeof createHandler>;
const now = 1792886400000;
const input = {
  title: '无人机作业发布说明',
  body_text: '无人机播种属于农践帮的无人机实际作业，需求必须先审核，发布者确认接取后才能开始。',
  assistant_usage: 'business_answer',
  scope: { business_scene: 'village' },
};
const call = (action: string, data: unknown, actor = 'root') =>
  handler(
    'knowledgeService',
    {
      api_version: 'v1',
      request_id: randomUUID(),
      action,
      data,
      grant_id: 'g-' + actor,
      idempotency_key: randomUUID(),
    },
    actor,
    now,
  );
async function ctx(actor: string) {
  return {
    user: (await repo.get<User>('users', actor))!,
    grant: await repo.get<Grant>('role_grants', 'g-' + actor),
    now,
  };
}
beforeEach(() => {
  repo = new MemoryRepository();
  repo.seed('system_guards', { _id: 'v2_migration', schema_version: 2, status: 'verified' });
  for (const [id, role] of [
    ['root', 'super_admin'],
    ['local', 'local_admin'],
    ['user', 'farmer'],
  ] as const)
    seedIdentity(repo, id, role, now);
  handler = createHandler(repo, privateDataCodec(Buffer.alloc(32, 1).toString('base64')), {
    checkText: async () => 'pass',
  });
});
it('rejects every non-super-admin management read and write, including forged internal flags', async () => {
  for (const actor of ['local', 'user'])
    for (const [action, data] of [
      ['search', {}],
      ['getDocument', { document_id: 'hidden' }],
      ['saveDraft', input],
    ] as const)
      expect((await call(action, data, actor)).code).toBe(403);
  expect((await call('search', { internal: true }, 'root')).code).toBe(400);
});
it('publishes checked versions, records revisions, and stops retrieval as soon as a document is edited or unpublished', async () => {
  const created = await call('saveDraft', input);
  const d = created.data as { document_id: string; version: number };
  const published = await call('publish', {
    document_id: d.document_id,
    expected_version: d.version,
    reason: '人工核验业务说明',
  });
  expect(published.code).toBe(0);
  const p = published.data as { document_id: string; version: number };
  expect(
    await retrieveForAssistant(repo, await ctx('user'), '无人机播种', 'business_answer'),
  ).toHaveLength(1);
  expect(
    (
      await call('saveDraft', {
        ...input,
        document_id: p.document_id,
        expected_version: p.version,
        body_text: '修改后的无人机播种知识，等待重新核验发布。',
      })
    ).code,
  ).toBe(0);
  expect(
    await retrieveForAssistant(repo, await ctx('user'), '无人机播种', 'business_answer'),
  ).toEqual([]);
  expect((await call('getDocument', { document_id: d.document_id, version: p.version })).code).toBe(
    0,
  );
  expect(repo.rows('knowledge_revisions')).toHaveLength(2);
});
it('filters management use and village scope inside assistant retrieval', async () => {
  const d = await call('saveDraft', {
    ...input,
    assistant_usage: 'management_answer',
    scope: { business_scene: 'village', region_id: 'b' },
  });
  const p = d.data as { document_id: string; version: number };
  await call('publish', {
    document_id: p.document_id,
    expected_version: p.version,
    reason: '人工核验管理说明',
  });
  await expect(
    retrieveForAssistant(repo, await ctx('user'), '无人机', 'management_answer'),
  ).rejects.toThrow();
  expect(
    await retrieveForAssistant(repo, await ctx('local'), '无人机', 'management_answer'),
  ).toEqual([]);
  expect(
    await retrieveForAssistant(repo, await ctx('root'), '无人机', 'management_answer'),
  ).toHaveLength(1);
});
it('stops returning scoped knowledge when the selected grant is revoked, expired or belongs to another user', async () => {
  const saved = await call('saveDraft', {
    ...input,
    scope: { business_scene: 'village', region_id: 'a' },
  });
  const document = saved.data as { document_id: string; version: number };
  await call('publish', {
    document_id: document.document_id,
    expected_version: document.version,
    reason: '核验辖区说明',
  });
  const context = await ctx('user');
  expect(await retrieveForAssistant(repo, context, '无人机', 'business_answer')).toHaveLength(1);
  for (const grant of [
    { ...context.grant!, status: 'revoked' as const, revoked_at: now },
    { ...context.grant!, expires_at: now - 1 },
    { ...context.grant!, user_id: 'other' },
  ])
    expect(
      await retrieveForAssistant(repo, { ...context, grant }, '无人机', 'business_answer'),
    ).toEqual([]);
});
it('only accepts API knowledge from the exact current contract pipeline, and forbids hand edits', async () => {
  await expect(
    publishGeneratedKnowledge(repo, '受控工具说明', '0'.repeat(64), now),
  ).rejects.toThrow();
  await publishGeneratedKnowledge(
    repo,
    '受控工具 submit_my_demand，提交后 pending_audit。',
    release.source_hash,
    now,
  );
  const d = repo.rows<KnowledgeDocument>('knowledge_documents')[0];
  expect(
    (await call('saveDraft', { ...input, document_id: d._id, expected_version: d.version })).code,
  ).toBe(403);
  expect((await call('saveDraft', { ...input, assistant_usage: 'tool_reference' })).code).toBe(403);
  expect(
    await retrieveForAssistant(repo, await ctx('user'), 'submit_my_demand', 'tool_reference'),
  ).toHaveLength(1);
  d.source_hash = '0'.repeat(64);
  repo.seed('knowledge_documents', d);
  expect(
    await retrieveForAssistant(repo, await ctx('user'), 'submit_my_demand', 'tool_reference'),
  ).toEqual([]);
});
