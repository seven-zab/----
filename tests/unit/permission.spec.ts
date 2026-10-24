import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useUserStore } from '../../src/stores/user';

vi.stubGlobal('uni', {
  getStorageSync: vi.fn(),
  setStorageSync: vi.fn(),
  removeStorageSync: vi.fn(),
  showToast: vi.fn(),
});

describe('User Store - Permission Tests', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('should check hasRole correctly', () => {
    const store = useUserStore();
    store.role = 'farmer';
    store.status = 'active';

    expect(store.hasRole(['farmer'])).toBe(true);
    expect(store.hasRole(['local_admin'])).toBe(false);
    expect(store.hasRole(['farmer', 'local_admin'])).toBe(true);
  });

  it('should check canPerformAction for publish_demand', () => {
    const store = useUserStore();
    store.role = 'farmer';
    store.status = 'active';

    expect(store.canPerformAction('publish_demand')).toBe(true);
  });

  it('should check canPerformAction for audit_demand', () => {
    const store = useUserStore();
    store.role = 'local_admin';
    store.status = 'active';

    expect(store.canPerformAction('audit_demand')).toBe(true);
  });

  it('should deny action when status is not active', () => {
    const store = useUserStore();
    store.role = 'farmer';
    store.status = 'banned';

    expect(store.canPerformAction('publish_demand')).toBe(false);
  });

  it('should compute canChat correctly', () => {
    const store = useUserStore();
    store.role = 'farmer';
    expect(store.canChat).toBe(true);

    store.role = 'general_user';
    expect(store.canChat).toBe(false);
  });
});
