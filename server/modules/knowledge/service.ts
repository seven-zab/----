import type { Repository, Entity, Transaction } from '../../core/repository';
import { audit, resolveUser, runCommand } from '../../core/command';
import { assertAccount, assertCanStartNewAction } from '../../core/policy';
import { ensure } from '../../core/errors';
import { hash } from '../../core/hash';
import { decodeCursor, encodeCursor } from '../../core/pagination';
import { requestData, type CallRequest } from '../../core/request';
import type { Grant, User } from '../../core/entities';
import type { ContentSafety } from '../../adapters/content-safety';
import { officialTextImporter, type KnowledgeImporter } from '../../adapters/knowledge-import';
import type { ContractMap } from '../../../contracts/generated/dto';
import release from '../../../contracts/generated/release.json';
type Fields = Omit<
  ContractMap['knowledgeService.saveDraft']['request'],
  'document_id' | 'expected_version'
>;
export interface KnowledgeDocument extends Entity {
  fields: Fields;
  status: 'draft' | 'published' | 'unpublished';
  version: number;
  source_type: 'manual' | 'official_text' | 'generated_api';
  source_hash: string | null;
  release_id: string | null;
  content_hash: string;
  published_by: string | null;
  created_at: number;
  updated_at: number;
}
export interface KnowledgeChunk extends Entity {
  document_id: string;
  version: number;
  text: string;
  created_at: number;
}
const dto = (d: KnowledgeDocument) => ({
  document_id: d._id,
  ...d.fields,
  status: d.status,
  version: d.version,
  source_type: d.source_type,
  source_hash: d.source_hash,
  release_id: d.release_id,
  content_hash: d.content_hash,
  admin_visibility: 'super_admin' as const,
});
async function admin(tx: Transaction, openid: string, grantId: string | undefined, now: number) {
  const user = await resolveUser(tx, openid);
  ensure(user, 'USER_NOT_INITIALIZED', '请先登录', 401);
  const grant = grantId ? await tx.get<Grant>('role_grants', grantId) : null;
  assertCanStartNewAction(user, grant, now);
  ensure(grant.role === 'super_admin', 'FORBIDDEN', '知识库仅超级管理员可浏览和维护');
  return user;
}
export function chunkKnowledge(body: string): string[] {
  const chars = Array.from(body);
  const result: string[] = [];
  for (let at = 0; at < chars.length; at += 1000) result.push(chars.slice(at, at + 1200).join(''));
  return result;
}
async function storeChunks(tx: Transaction, d: KnowledgeDocument, now: number) {
  for (const [index, text] of chunkKnowledge(d.fields.body_text).entries())
    await tx.put<KnowledgeChunk>('knowledge_chunks', {
      _id: hash([d._id, d.version, index]),
      document_id: d._id,
      version: d.version,
      text,
      created_at: now,
    });
}
export function createKnowledgeService(
  repo: Repository,
  safety?: ContentSafety,
  importer: KnowledgeImporter = officialTextImporter,
) {
  async function write(openid: string, request: CallRequest, now: number) {
    let imported: string | undefined;
    let checkedHash: string | undefined;
    if (request.action === 'importDraft') {
      await repo.transaction((tx) => admin(tx, openid, request.grant_id, now));
      const data = requestData('knowledgeService.importDraft', request);
      imported = await importer.read(data.source_ref);
    }
    if (request.action === 'publish') {
      const data = requestData('knowledgeService.publish', request);
      const d = await repo.transaction(async (tx) => {
        await admin(tx, openid, request.grant_id, now);
        const d = await tx.get<KnowledgeDocument>('knowledge_documents', data.document_id);
        ensure(d && d.version === data.expected_version, 'VERSION_CONFLICT', '知识版本已变化', 409);
        return d;
      });
      ensure(d.source_type !== 'generated_api', 'FORBIDDEN', 'API知识由可信契约流水线发布');
      ensure(safety, 'DEPENDENCY_UNAVAILABLE', '知识内容检查未配置', 503);
      ensure(
        (await safety.checkText(openid, `${d.fields.title}\n${d.fields.body_text}`)) === 'pass',
        'CONTENT_REJECTED',
        '知识内容检查未通过',
        400,
      );
      checkedHash = d.content_hash;
    }
    return runCommand(
      repo,
      openid,
      'knowledgeService',
      request,
      async (ctx) => {
        await admin(ctx.tx, openid, request.grant_id, now);
        if (request.action === 'saveDraft' || request.action === 'importDraft') {
          const input =
            request.action === 'saveDraft'
              ? requestData('knowledgeService.saveDraft', request)
              : requestData('knowledgeService.importDraft', request);
          const data =
            'source_type' in input
              ? {
                  title: input.title,
                  body_text: imported ?? '',
                  source_ref: input.source_ref,
                  assistant_usage: input.assistant_usage,
                  scope: input.scope,
                }
              : input;
          ensure(
            data.assistant_usage !== 'tool_reference',
            'FORBIDDEN',
            '工具参考只能由真实契约生成',
          );
          ensure(
            data.title.trim().length >= 4 && data.body_text.trim().length > 0,
            'VALIDATION_FAILED',
            '请填写知识标题与正文',
            400,
          );
          const previous =
            'document_id' in input && input.document_id
              ? await ctx.tx.get<KnowledgeDocument>('knowledge_documents', input.document_id)
              : null;
          if ('document_id' in input && input.document_id)
            ensure(
              previous && previous.version === input.expected_version,
              'VERSION_CONFLICT',
              '知识版本已变化',
              409,
            );
          ensure(previous?.source_type !== 'generated_api', 'FORBIDDEN', '不能手改生成的API知识');
          if (previous)
            await ctx.tx.put('knowledge_revisions', {
              ...previous,
              _id: hash([previous._id, previous.version]),
              document_id: previous._id,
            });
          const fields: Fields = {
            title: data.title.trim(),
            body_text: data.body_text.trim(),
            assistant_usage: data.assistant_usage,
            scope: data.scope,
            ...(data.source_ref ? { source_ref: data.source_ref } : {}),
          };
          const d: KnowledgeDocument = {
            _id: previous?._id ?? ctx.command_id,
            fields,
            status: 'draft',
            version: (previous?.version ?? 0) + 1,
            source_type: request.action === 'importDraft' ? 'official_text' : 'manual',
            source_hash: null,
            release_id: null,
            content_hash: hash(fields),
            published_by: null,
            created_at: previous?.created_at ?? now,
            updated_at: now,
          };
          await ctx.tx.put('knowledge_documents', d);
          await audit(ctx, d._id, '保存知识草稿');
          return dto(d);
        }
        const data =
          request.action === 'publish'
            ? requestData('knowledgeService.publish', request)
            : requestData('knowledgeService.unpublish', request);
        const d = await ctx.tx.get<KnowledgeDocument>('knowledge_documents', data.document_id);
        ensure(d, 'NOT_FOUND', '知识不存在', 404);
        ensure(d.version === data.expected_version, 'VERSION_CONFLICT', '知识版本已变化', 409);
        ensure(d.source_type !== 'generated_api', 'FORBIDDEN', 'API知识由可信契约流水线维护');
        if (request.action === 'publish')
          ensure(
            d.status !== 'published' && checkedHash === d.content_hash,
            'STATE_CONFLICT',
            '请重新检查知识版本',
            409,
          );
        else ensure(d.status === 'published', 'STATE_CONFLICT', '知识尚未发布', 409);
        await ctx.tx.put('knowledge_revisions', {
          ...d,
          _id: hash([d._id, d.version]),
          document_id: d._id,
        });
        d.version++;
        d.status = request.action === 'publish' ? 'published' : 'unpublished';
        d.published_by = ctx.user._id;
        d.updated_at = now;
        await ctx.tx.put('knowledge_documents', d);
        if (d.status === 'published') await storeChunks(ctx.tx, d, now);
        await audit(ctx, d._id, `知识${d.status}:${data.reason}`);
        return dto(d);
      },
      now,
    );
  }
  async function read(openid: string, request: CallRequest, now: number) {
    await repo.transaction((tx) => admin(tx, openid, request.grant_id, now));
    if (request.action === 'getDocument') {
      const data = requestData('knowledgeService.getDocument', request);
      let d = await repo.get<KnowledgeDocument>('knowledge_documents', data.document_id);
      if (data.version && d?.version !== data.version)
        d = await repo.get<KnowledgeDocument>(
          'knowledge_revisions',
          hash([data.document_id, data.version]),
        );
      ensure(d, 'NOT_FOUND', '知识不存在', 404);
      return dto({ ...d, _id: data.document_id });
    }
    const data = requestData('knowledgeService.search', request),
      size = data.page_size ?? 20;
    const scope = { query: data.query ?? '', usage: data.usage ?? '' };
    let after = decodeCursor(data.cursor, scope);
    let last: KnowledgeDocument | undefined;
    let more = true;
    const found: KnowledgeDocument[] = [];
    for (let scanned = 0; scanned < 1000 && more && found.length <= size; scanned += 100) {
      const rows = await repo.find<KnowledgeDocument>('knowledge_documents', {}, 100, {
        newest: true,
        after,
      });
      more = rows.length === 100;
      for (const d of rows) {
        last = d;
        if (
          (!data.usage || d.fields.assistant_usage === data.usage) &&
          (!data.query || `${d.fields.title}\n${d.fields.body_text}`.includes(data.query))
        )
          found.push(d);
      }
      if (last) after = { created_at: last.created_at, id: last._id };
    }
    const items = found.slice(0, size),
      has_more = found.length > size || more;
    const tail = found.length > size ? items[items.length - 1] : last;
    return {
      items: items.map(dto),
      has_more,
      next_cursor: has_more && tail ? encodeCursor(tail, scope) : null,
    };
  }
  return { read, write };
}
export interface RetrievalContext {
  user: User;
  grant: Grant | null;
  now: number;
}
/** Internal only. Never register this function as a client action or return its raw result to a user. */
export async function retrieveForAssistant(
  repo: Repository,
  ctx: RetrievalContext,
  query: string,
  usage: Fields['assistant_usage'],
) {
  assertAccount(ctx.user);
  const grant =
    ctx.grant?.user_id === ctx.user._id &&
    ctx.grant.status === 'active' &&
    ctx.grant.revoked_at === null &&
    (ctx.grant.expires_at === null || ctx.grant.expires_at > ctx.now)
      ? ctx.grant
      : null;
  if (usage === 'management_answer') {
    assertCanStartNewAction(ctx.user, grant, ctx.now);
    ensure(
      ['local_admin', 'super_admin'].includes(grant.role),
      'FORBIDDEN',
      '当前身份无管理知识权限',
    );
  }
  const rows: KnowledgeDocument[] = [];
  let after: { created_at: number; id: string } | undefined;
  for (let count = 0; count <= 1000; count += 100) {
    const page = await repo.find<KnowledgeDocument>(
      'knowledge_documents',
      { status: 'published' },
      100,
      { after, newest: true },
    );
    ensure(
      count < 1000 || page.length === 0,
      'RATE_LIMITED',
      '知识检索超过扫描上限，请收窄范围',
      429,
    );
    rows.push(...page);
    if (page.length < 100) break;
    const last = page[page.length - 1];
    after = { created_at: last.created_at, id: last._id };
  }
  const terms = query.toLocaleLowerCase().match(/[a-z0-9]+|[\u3400-\u9fff]{1,2}/gu) ?? [];
  return rows
    .filter(
      (d) =>
        d.published_by &&
        d.fields.assistant_usage === usage &&
        (d.source_type !== 'generated_api' || d.source_hash === release.source_hash) &&
        (!d.fields.scope.region_id ||
          grant?.role === 'super_admin' ||
          grant?.scope_region_id === d.fields.scope.region_id) &&
        (d.fields.scope.business_scene !== 'campus' ||
          grant?.role === 'super_admin' ||
          grant?.organization_id === 'sztu'),
    )
    .flatMap((d) =>
      chunkKnowledge(d.fields.body_text).map((text) => ({
        document_id: d._id,
        version: d.version,
        title: d.fields.title,
        text,
        score: terms.filter((t) => `${d.fields.title}\n${text}`.toLocaleLowerCase().includes(t))
          .length,
      })),
    )
    .filter((d) => d.score > 0)
    .sort((a, b) => b.score - a.score || a.document_id.localeCompare(b.document_id))
    .slice(0, 5)
    .map(({ score, ...snippet }) => {
      void score;
      return snippet;
    });
}
export async function publishGeneratedKnowledge(
  repo: Repository,
  body: string,
  expectedSourceHash: string,
  now: number,
) {
  ensure(
    expectedSourceHash === release.source_hash,
    'STATE_CONFLICT',
    'API知识与后端版本不一致',
    409,
  );
  await repo.transaction(async (tx) => {
    const id = 'api-' + release.source_hash;
    const previous = await tx.get<KnowledgeDocument>('knowledge_documents', id);
    const fields: Fields = {
      title: '当前版本接口与受控工具说明',
      body_text: body,
      assistant_usage: 'tool_reference',
      scope: { business_scene: 'village' },
    };
    ensure(
      Array.from(body).length <= 20000,
      'VALIDATION_FAILED',
      'API知识须拆分为小于20000字的文档',
      400,
    );
    if (previous) {
      ensure(
        previous.content_hash === hash(fields),
        'STATE_CONFLICT',
        '相同API版本内容发生漂移',
        409,
      );
      return;
    }
    const d: KnowledgeDocument = {
      _id: id,
      fields,
      status: 'published',
      version: 1,
      source_type: 'generated_api',
      source_hash: release.source_hash,
      release_id: 'v1-' + release.source_hash,
      content_hash: hash(fields),
      published_by: 'contract-pipeline',
      created_at: now,
      updated_at: now,
    };
    await tx.put('knowledge_documents', d);
    await storeChunks(tx, d, now);
  });
}
