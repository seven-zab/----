import type { Transaction } from '../../core/repository';
import type { User, Grant } from '../../core/entities';
import {
  assertCanStartNewAction,
  assertCanContinueBoundTask,
  assertScene,
} from '../../core/policy';
import { ensure } from '../../core/errors';
import type { Demand, Claim } from '../demand/service';
import { isDemandPublic } from '../demand/visibility';
import type { StoredFile } from './service';

/** A public demand exposes only its current form images, never process evidence. */
export async function demandFileDeadline(
  tx: Transaction,
  user: User | null,
  grant: Grant | null,
  demandId: string,
  file: StoredFile,
  now: number,
) {
  const d = await tx.get<Demand>('demands', demandId);
  ensure(d, 'NOT_FOUND', '需求不存在', 404);
  const publicImage =
    isDemandPublic(d) &&
    file.mime.startsWith('image/') &&
    d.form.attachments?.some((a) => a.file_id === file._id && a.usage === 'image');
  let permitted = Boolean(publicImage || (user && d.owner_id === user._id));
  if (!permitted && user && grant) {
    try {
      assertCanStartNewAction(user, grant, now);
      assertScene(grant, d, 'manage');
      permitted = true;
    } catch {
      /* A selected role is not proof of management permission. */
    }
  }
  if (!permitted && user && d.active_claim_id) {
    const claim = await tx.get<Claim>('demand_claims', d.active_claim_id);
    const bound = claim?.participant_grants.find((p) => p.user_id === user._id)?.grant_id;
    ensure(
      claim?.demand_id === d._id &&
        claim.confirmed_at !== null &&
        ['confirmed', 'completed', 'terminated'].includes(claim.status),
      'NOT_FOUND',
      '附件不存在',
      404,
    );
    assertCanContinueBoundTask(user, grant, bound, true, now);
    permitted = true;
  }
  ensure(permitted, 'NOT_FOUND', '附件不存在', 404);
  ensure(
    d.ended_at === null || (Number.isSafeInteger(d.ended_at) && d.ended_at > 0),
    'NOT_FOUND',
    '附件期限尚未核验',
    404,
  );
  return d.ended_at === null
    ? now + 5 * 60000
    : Math.min(now + 5 * 60000, d.ended_at + 365 * 86400000);
}
