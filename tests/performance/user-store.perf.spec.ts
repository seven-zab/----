import { describe, it, expect, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useUserStore } from '../../src/stores/user';

vi.stubGlobal('uni', {
  getStorageSync: vi.fn(),
  setStorageSync: vi.fn(),
  removeStorageSync: vi.fn(),
});

describe('Performance Tests - User Store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('initFromStorage should complete within 10ms', () => {
    const mockUser = {
      _id: 'test_user',
      name: 'Test User',
      role: 'farmer',
      status: 'active',
      phone: '13800138000',
      avatarUrl: '',
      created_at: Date.now(),
    };
    (uni.getStorageSync as any).mockImplementation((key: string) =>
      JSON.stringify(
        key === 'user_token'
          ? { token: 'test-session', expiresAt: Date.now() + 60000, lastActiveTime: Date.now() }
          : mockUser,
      ),
    );

    const start = performance.now();
    const store = useUserStore();
    store.initFromStorage();
    const end = performance.now();

    expect(end - start).toBeLessThan(10);
  });

  it('hasRole should be performant', () => {
    const store = useUserStore();
    store.role = 'farmer';

    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      store.hasRole(['farmer', 'local_admin']);
    }
    const end = performance.now();

    expect(end - start).toBeLessThan(50);
  });

  it('canPerformAction should be performant', () => {
    const store = useUserStore();
    store.role = 'farmer';
    store.status = 'active';

    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      store.canPerformAction('publish_demand');
    }
    const end = performance.now();

    expect(end - start).toBeLessThan(50);
  });

  it('logout should complete quickly', () => {
    const store = useUserStore();
    store.userInfo = {
      _id: 'test',
      name: 'test',
      role: 'farmer',
      status: 'active',
      phone: '138',
      avatarUrl: '',
      created_at: 0,
    } as any;
    store.isLoggedIn = true;

    const start = performance.now();
    store.logout();
    const end = performance.now();

    expect(end - start).toBeLessThan(10);
    expect(store.isLoggedIn).toBe(false);
    expect(store.userInfo).toBeNull();
  });
});
