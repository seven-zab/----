import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useUserStore } from '../../src/stores/user';

const mockCallFunction = vi.fn();
vi.stubGlobal('wx', {
  cloud: {
    callFunction: mockCallFunction,
  },
});

vi.stubGlobal('uni', {
  getStorageSync: vi.fn(),
  setStorageSync: vi.fn(),
  removeStorageSync: vi.fn(),
  showToast: vi.fn(),
});

describe('User Store - Login Integration Tests', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('should login successfully and save user info', async () => {
    const mockUser = {
      _id: 'user_123',
      name: 'Test User',
      role: 'farmer',
      status: 'active',
      phone: '13800138000',
      avatarUrl: '',
      created_at: Date.now(),
    };

    mockCallFunction.mockResolvedValue({
      result: {
        code: 0,
        msg: 'Success',
        data: mockUser,
      },
    });

    const store = useUserStore();
    const result = await store.login();

    expect(result.success).toBe(true);
    expect(store.userInfo).toEqual(mockUser);
    expect(store.isLoggedIn).toBe(true);
    expect(store.role).toBe('farmer');
    expect(uni.setStorageSync).toHaveBeenCalled();
  });

  it('should handle login failure', async () => {
    mockCallFunction.mockResolvedValue({
      result: {
        code: 500,
        msg: 'Server error',
      },
    });

    const store = useUserStore();
    await expect(store.login()).rejects.toThrow();
  });

  it('should register new user successfully', async () => {
    const mockUser = {
      _id: 'new_user_123',
      name: 'New User',
      role: 'farmer',
      status: 'pending',
      phone: '13800138000',
      avatarUrl: '',
      created_at: Date.now(),
    };

    mockCallFunction.mockResolvedValue({
      result: {
        code: 0,
        msg: 'Success',
        data: mockUser,
      },
    });

    const store = useUserStore();
    const result = await store.register({
      name: 'New User',
      phone: '13800138000',
    });

    expect(result.success).toBe(true);
    expect(store.userInfo).toEqual(mockUser);
    expect(uni.setStorageSync).toHaveBeenCalled();
  });

  it('should throw error when register with incomplete data', async () => {
    const store = useUserStore();
    await expect(store.register({ name: 'Test' })).rejects.toThrow('请填写完整信息');
  });
});
