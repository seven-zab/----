import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { cloudCall, newRequestId, CloudError } from '../services/cloudClient';
import type { UserMeDTO } from '../../contracts/generated/dto';

export const useSessionStore = defineStore('session-v1', () => {
  const me = ref<UserMeDTO | null>(null);
  const grantId = ref<string | undefined>();
  const grant = computed(() => me.value?.grants.find((g) => g.grant_id === grantId.value) ?? null);
  const validGrant = computed(() =>
    grant.value?.status === 'active' &&
    (grant.value.expires_at === null || grant.value.expires_at > Date.now())
      ? grant.value
      : null,
  );
  const isManager = computed(
    () => validGrant.value?.role === 'local_admin' || validGrant.value?.role === 'super_admin',
  );
  const options = () => (grantId.value ? { grant_id: grantId.value } : {});
  function accept(user: UserMeDTO) {
    me.value = user;
    if (!user.grants.some((g) => g.grant_id === grantId.value))
      grantId.value = user.grants.find((g) => g.status === 'active')?.grant_id;
  }
  async function login() {
    accept(await cloudCall('userService.bootstrap', {}, { idempotency_key: newRequestId() }));
  }
  async function refresh() {
    if (me.value) {
      const userId = me.value.user_id;
      try {
        const current = await cloudCall('userService.getMe', {});
        if (me.value?.user_id === userId) accept(current);
      } catch (error) {
        if (
          me.value?.user_id === userId &&
          error instanceof CloudError &&
          ['UNAUTHENTICATED', 'USER_NOT_INITIALIZED', 'ACCOUNT_DISABLED'].includes(error.code)
        ) {
          me.value = null;
          grantId.value = undefined;
        }
        throw error;
      }
    }
  }
  function select(id: string) {
    const candidate = me.value?.grants.find(
      (g) =>
        g.grant_id === id &&
        g.status === 'active' &&
        (g.expires_at === null || g.expires_at > Date.now()),
    );
    if (!candidate) throw new Error('只能切换本人有效身份');
    grantId.value = id;
  }
  function logout() {
    me.value = null;
    grantId.value = undefined;
  }
  return { me, grantId, grant, validGrant, isManager, options, login, refresh, select, logout };
});
