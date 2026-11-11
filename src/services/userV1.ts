import { cloudCall, newRequestId } from './cloudClient';
import { useSessionStore } from '../stores/session';
import type { ContractMap } from '../../contracts/generated/dto';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { utf8ToBytes } from './utf8';
type UserRoute = Extract<keyof ContractMap, `userService.${string}`>;
export async function userCommand<K extends UserRoute>(route: K, data: ContractMap[K]['request']) {
  const session = useSessionStore();
  const fingerprint = bytesToHex(
    sha256(
      utf8ToBytes(
        JSON.stringify({ route, data, actor: session.me?.user_id, grant: session.grantId }),
      ),
    ),
  );
  const storageKey = `pending-user-command:${fingerprint}`;
  const stored: unknown = uni.getStorageSync(storageKey);
  const key = typeof stored === 'string' && stored ? stored : newRequestId();
  uni.setStorageSync(storageKey, key);
  const result = await cloudCall(route, data, { ...session.options(), idempotency_key: key });
  uni.removeStorageSync(storageKey);
  return result;
}
