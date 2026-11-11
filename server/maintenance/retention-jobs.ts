import type { Entity, Repository, Transaction } from '../core/repository';
import { hash } from '../core/hash';
import { unbindFile, type StoredFile } from '../modules/file/service';
import type { Demand } from '../modules/demand/service';
import type { Application } from '../core/entities';
import { claimUnheld, elapsed, validResourceId, validTime } from './retention-safety';
import { scanBatch } from './scan';
import type { AIMessage, AISession, AIJob } from '../modules/ai/types';
import type { ChatMessage } from '../modules/chat/service';
interface Binding extends Entity {
  file_id: string;
  resource_type: string;
  resource_id: string;
  active: boolean;
  created_at: number;
}
async function held(tx: Transaction, kind: string, id: string) {
  return !(await claimUnheld(tx, kind, id));
}
async function queueIfOrphan(tx: Transaction, fileId: string, now: number, minimumAge = 0) {
  const f = await tx.get<StoredFile>('files', fileId);
  if (
    !f ||
    !elapsed(f.created_at, minimumAge, now) ||
    f.state !== 'active' ||
    f.ref_count !== 0 ||
    (await held(tx, 'file', fileId))
  )
    return false;
  f.state = 'deleting';
  await tx.put('files', f);
  await tx.put('outbox_events', {
    _id: hash(['file.delete', f._id]),
    type: 'file.delete',
    file_id: f._id,
    status: 'pending',
    attempts: 0,
    next_retry_at: now,
    created_at: now,
  });
  return true;
}
async function aiExpired(tx: Transaction, sessionId: string, createdAt: number, now: number) {
  if (!validResourceId(sessionId) || !validTime(createdAt) || createdAt > now) return false;
  const session = await tx.get<AISession>('ai_sessions', sessionId);
  if (!session || !(session.deleted_at === null || validTime(session.deleted_at))) return false;
  return (
    (elapsed(createdAt, 90 * 86400000, now) || elapsed(session.deleted_at, 0, now)) &&
    !(await held(tx, 'ai_session', sessionId))
  );
}
async function chatExpired(tx: Transaction, message: ChatMessage, now: number) {
  return (
    elapsed(message.created_at, 180 * 86400000, now) &&
    validResourceId(message.conversation_id) &&
    Boolean(await tx.get('conversations', message.conversation_id)) &&
    !(await held(tx, 'conversation', message.conversation_id))
  );
}
export async function runRetentionJobs(repo: Repository, now: number, pageSize = 20) {
  const counts = {
    bindings_released: 0,
    messages_deleted: 0,
    private_snapshots_deleted: 0,
    orphan_files_queued: 0,
  };
  await scanBatch<Binding>(
    repo,
    'retention-bindings',
    'file_bindings',
    { active: true },
    now,
    pageSize,
    async (row) => {
      await repo.transaction(async (tx) => {
        const b = await tx.get<Binding>('file_bindings', row._id);
        if (
          !b?.active ||
          (await held(tx, 'file', b.file_id)) ||
          (await held(tx, b.resource_type, b.resource_id))
        )
          return;
        let expired = false;
        if (b.resource_type === 'demand') {
          const d = await tx.get<Demand>('demands', b.resource_id);
          expired = elapsed(d?.ended_at, 365 * 86400000, now);
        } else if (b.resource_type === 'application') {
          const a = await tx.get<Application>('role_applications', b.resource_id);
          expired = elapsed(a?.reviewed_at, 180 * 86400000, now);
        } else if (b.resource_type === 'message') {
          const m = await tx.get<ChatMessage>('messages', b.resource_id);
          if (m) expired = await chatExpired(tx, m, now);
        } else if (b.resource_type === 'ai_message') {
          const m = await tx.get<AIMessage>('ai_messages', b.resource_id);
          if (m) expired = await aiExpired(tx, m.session_id, m.created_at, now);
        }
        if (expired) {
          await unbindFile(tx, b.file_id, b.resource_type, b.resource_id);
          await queueIfOrphan(tx, b.file_id, now);
          counts.bindings_released++;
        }
      });
    },
  );
  await scanBatch<ChatMessage>(
    repo,
    'retention-chat',
    'messages',
    {},
    now,
    pageSize,
    async (row) => {
      if (!elapsed(row.created_at, 180 * 86400000, now)) return;
      await repo.transaction(async (tx) => {
        const m = await tx.get<ChatMessage>('messages', row._id);
        if (!m || !(await chatExpired(tx, m, now))) return;
        if (m.file_id) {
          await unbindFile(tx, m.file_id, 'message', m._id);
          await queueIfOrphan(tx, m.file_id, now);
        }
        await tx.remove('messages', m._id);
        await tx.put('deletion_receipts', {
          _id: hash(['chat-message', m._id]),
          kind: 'chat_message',
          resource_id: m._id,
          deleted_at: now,
          created_at: now,
        });
        counts.messages_deleted++;
      });
    },
  );
  await scanBatch<AIMessage>(
    repo,
    'retention-ai-messages',
    'ai_messages',
    {},
    now,
    pageSize,
    async (row) => {
      await repo.transaction(async (tx) => {
        const m = await tx.get<AIMessage>('ai_messages', row._id);
        if (
          !m ||
          !Array.isArray(m.attachment_ids) ||
          !m.attachment_ids.every(validResourceId) ||
          !(await aiExpired(tx, m.session_id, m.created_at, now))
        )
          return;
        for (const id of m.attachment_ids) {
          await unbindFile(tx, id, 'ai_message', m._id);
          await queueIfOrphan(tx, id, now);
        }
        await tx.remove('ai_messages', m._id);
        await tx.put('deletion_receipts', {
          _id: hash(['ai-message', m._id]),
          kind: 'ai_message',
          resource_id: m._id,
          deleted_at: now,
          created_at: now,
        });
        counts.messages_deleted++;
      });
    },
  );
  for (const collection of ['ai_draft_proposals', 'ai_model_calls', 'ai_tool_receipts'] as const)
    await scanBatch<Entity & { created_at: number; session_id?: string; job_id?: string }>(
      repo,
      'retention-' + collection,
      collection,
      {},
      now,
      pageSize,
      async (row) => {
        await repo.transaction(async (tx) => {
          const current = await tx.get<
            Entity & { created_at: number; session_id?: string; job_id?: string }
          >(collection, row._id);
          if (!current) return;
          const job = current.job_id ? await tx.get<AIJob>('ai_jobs', current.job_id) : null;
          const sessionId = current.session_id ?? job?.session_id;
          if (!sessionId || !(await aiExpired(tx, sessionId, current.created_at, now))) return;
          await tx.remove(collection, row._id);
          counts.private_snapshots_deleted++;
        });
      },
    );
  await scanBatch<Demand>(
    repo,
    'retention-demand-private',
    'demands',
    {},
    now,
    pageSize,
    async (row) => {
      if (!elapsed(row.ended_at, 365 * 86400000, now)) return;
      await repo.transaction(async (tx) => {
        const d = await tx.get<Demand>('demands', row._id);
        if (!d || !elapsed(d.ended_at, 365 * 86400000, now) || (await held(tx, 'demand', d._id)))
          return;
        await tx.remove('demand_private', d._id);
        counts.private_snapshots_deleted++;
      });
    },
  );
  await scanBatch<StoredFile>(
    repo,
    'retention-orphan-files',
    'files',
    { state: 'active', ref_count: 0 },
    now,
    pageSize,
    async (row) => {
      if (!elapsed(row.created_at, 86400000, now)) return;
      await repo.transaction(async (tx) => {
        if (await queueIfOrphan(tx, row._id, now, 86400000)) counts.orphan_files_queued++;
      });
    },
  );
  await scanBatch<Application & { created_at: number }>(
    repo,
    'retention-identity-private',
    'role_applications',
    {},
    now,
    pageSize,
    async (row) => {
      if (!elapsed(row.reviewed_at, 180 * 86400000, now)) return;
      await repo.transaction(async (tx) => {
        const app = await tx.get<Application>('role_applications', row._id);
        if (
          app &&
          elapsed(app.reviewed_at, 180 * 86400000, now) &&
          !(await held(tx, 'application', app._id))
        ) {
          await tx.remove('role_application_private', app._id);
          counts.private_snapshots_deleted++;
        }
      });
    },
  );
  await scanBatch<
    Entity & { demand_id: string; created_at: number; private_snapshot_ciphertext: string }
  >(repo, 'retention-submission-private', 'demand_submissions', {}, now, pageSize, async (row) => {
    await repo.transaction(async (tx) => {
      const s = await tx.get<typeof row>('demand_submissions', row._id);
      if (!s || !validResourceId(s.demand_id)) return;
      const d = await tx.get<Demand>('demands', s.demand_id);
      if (!d || !elapsed(d.ended_at, 365 * 86400000, now) || (await held(tx, 'demand', d._id)))
        return;
      if (s?.private_snapshot_ciphertext) {
        s.private_snapshot_ciphertext = '';
        await tx.put('demand_submissions', s);
        counts.private_snapshots_deleted++;
      }
    });
  });
  await scanBatch<AIJob>(
    repo,
    'retention-ai-job-payloads',
    'ai_jobs',
    {},
    now,
    pageSize,
    async (row) => {
      if (['queued', 'running'].includes(row.status)) return;
      await repo.transaction(async (tx) => {
        const job = await tx.get<AIJob>('ai_jobs', row._id);
        if (
          job &&
          ['succeeded', 'partial_success', 'failed'].includes(job.status) &&
          (await aiExpired(tx, job.session_id, job.created_at, now))
        ) {
          job.business_answer = null;
          job.general_answer = null;
          job.route = null;
          job.openid = '';
          await tx.put('ai_jobs', job);
        }
      });
    },
  );
  return counts;
}
