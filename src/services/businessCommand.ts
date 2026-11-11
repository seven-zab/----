import { cloudCall, newRequestId } from './cloudClient';
import { useSessionStore } from '../stores/session';
import type { ContractMap } from '../../contracts/generated/dto';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { utf8ToBytes } from './utf8';
const pending = new Map<string, string>();
export async function businessCommand<K extends keyof ContractMap>(
  route: K,
  data: ContractMap[K]['request'],
  taskGrantId?: string | null,
) {
  const session = useSessionStore();
  const options = taskGrantId ? { grant_id: taskGrantId } : session.options();
  const requestHash = bytesToHex(
    sha256(
      utf8ToBytes(
        JSON.stringify({ route, data, grant: options.grant_id, actor: session.me?.user_id }),
      ),
    ),
  );
  const stored: unknown = uni.getStorageSync(`pending-command:${requestHash}`);
  const key =
    pending.get(requestHash) ?? (typeof stored === 'string' && stored ? stored : newRequestId());
  pending.set(requestHash, key);
  uni.setStorageSync(`pending-command:${requestHash}`, key);
  // Transport failure leaves a non-sensitive hash/key receipt for retry after page or app restart.
  const result = await cloudCall(route, data, { ...options, idempotency_key: key });
  pending.delete(requestHash);
  uni.removeStorageSync(`pending-command:${requestHash}`);
  return result;
}
