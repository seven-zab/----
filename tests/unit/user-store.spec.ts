import { setActivePinia, createPinia } from 'pinia';
import { useUserStore } from '../../src/stores/user';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock uni global object
global.uni = {
  getStorageSync: vi.fn(),
  setStorageSync: vi.fn(),
  login: vi.fn(),
} as any;

describe('User Store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('initializes with default values', () => {
    const store = useUserStore();
    expect(store.userInfo).toBeNull();
    expect(store.isLoggedIn).toBe(false);
  });

  it('initFromStorage restores state if data exists', () => {
    const mockUser = {
      name: 'Test User',
      role: 'farmer',
      status: 'active',
    };
    (uni.getStorageSync as any).mockImplementation((key: string) => {
      if (key === 'user_token') {
        return JSON.stringify({
          token: 'test-session',
          expiresAt: Date.now() + 60000,
          lastActiveTime: Date.now(),
        });
      }
      return key === 'user_info' ? JSON.stringify(mockUser) : '';
    });

    const store = useUserStore();
    // @ts-ignore
    store.initFromStorage();

    expect(store.userInfo).toEqual(mockUser);
    expect(store.role).toBe('farmer');
    expect(store.status).toBe('active');
    expect(store.isLoggedIn).toBe(true);
  });

  it('initFromStorage handles empty storage', () => {
    (uni.getStorageSync as any).mockReturnValue('');
    const store = useUserStore();
    // @ts-ignore
    store.initFromStorage();
    expect(store.userInfo).toBeNull();
    expect(store.isLoggedIn).toBe(false);
  });
});
