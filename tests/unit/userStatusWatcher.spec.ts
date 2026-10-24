import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { userStatusWatcher } from '../../src/services/userStatusWatcher';
import { useUserStore } from '../../src/stores/user';

const mockCallFunction = vi.fn();
global.wx = {
  cloud: {
    callFunction: mockCallFunction,
  },
} as any;

global.uni = {
  showToast: vi.fn(),
  showModal: vi.fn(),
  setStorageSync: vi.fn(),
  getStorageSync: vi.fn(),
  removeStorageSync: vi.fn(),
} as any;

describe('UserStatusWatcher Service', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    vi.useFakeTimers();
    userStatusWatcher.stop();
    const store = useUserStore();
    store.isLoggedIn = true;
    mockCallFunction.mockResolvedValue({
      result: {
        code: 0,
        data: {
          _id: 'user_123',
          name: 'Test User',
          phone: '',
          avatarUrl: '',
          created_at: 0,
          role: 'general_user',
          status: 'active',
          current_context: {},
          available_roles: [],
        },
      },
    });
  });

  afterEach(() => {
    userStatusWatcher.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should start polling when user is logged in', async () => {
    const consoleSpy = vi.spyOn(console, 'log');

    userStatusWatcher.start(1000);

    expect(userStatusWatcher.isRunning()).toBe(true);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Starting polling')
    );
  });

  it('should not start polling when user is not logged in', async () => {
    const consoleSpy = vi.spyOn(console, 'log');
    useUserStore().isLoggedIn = false;

    userStatusWatcher.start(1000);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('User not logged in')
    );
    expect(userStatusWatcher.isRunning()).toBe(false);
    expect(mockCallFunction).not.toHaveBeenCalled();
  });

  it('should stop polling correctly', () => {
    userStatusWatcher.start(1000);
    expect(userStatusWatcher.isRunning()).toBe(true);

    userStatusWatcher.stop();
    expect(userStatusWatcher.isRunning()).toBe(false);
  });

  it('should detect role changes via handler', async () => {
    const handler = vi.fn();
    const removeHandler = userStatusWatcher.onUserStatusChange(handler);

    mockCallFunction.mockResolvedValue({
      result: {
        code: 0,
        data: {
          _id: 'user_123',
          role: 'farmer',
          status: 'active',
          current_context: {},
          available_roles: [],
        },
      },
    });

    userStatusWatcher.start(100);

    await vi.advanceTimersByTimeAsync(200);

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'role',
        oldValue: 'general_user',
        newValue: 'farmer',
      })
    );
    removeHandler();
  });

  it('should allow adding and removing handlers', () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    const remove1 = userStatusWatcher.onUserStatusChange(handler1);
    const remove2 = userStatusWatcher.onUserStatusChange(handler2);

    remove1();
    remove2();

    expect(handler1).toHaveBeenCalledTimes(0);
    expect(handler2).toHaveBeenCalledTimes(0);
  });

  it('should set interval correctly', () => {
    userStatusWatcher.setInterval(5000);
    expect(userStatusWatcher.getInterval()).toBe(5000);
  });
});
