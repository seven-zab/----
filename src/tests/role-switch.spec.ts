import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useUserStore } from '../stores/user';

// Mock wx.cloud
const mockCallFunction = vi.fn();
vi.stubGlobal('wx', {
  cloud: {
    callFunction: mockCallFunction,
  },
});

// Mock uni object
vi.stubGlobal('uni', {
  setStorageSync: vi.fn(),
  getStorageSync: vi.fn(),
  removeStorageSync: vi.fn(),
  showToast: vi.fn(),
});

describe('User Store - Role Switching', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('should switch role successfully when user has permission', async () => {
    const userStore = useUserStore();

    // 1. Setup Initial State (Multi-role User)
    const initialUser = {
      _id: 'user_123',
      role: 'local_admin',
      available_roles: [
        {
          role_code: 'local_admin',
          role_name: 'Village Committee',
          context: { region_code: '441623' },
        },
        {
          role_code: 'farmer',
          role_name: 'Farmer',
          context: { farm_location: 'Eagle Peach Base' },
        },
      ],
      current_context: { region_code: '441623' },
      status: 'active',
    };

    // Simulate login to populate store
    userStore.userInfo = initialUser as any;
    userStore.role = 'local_admin';
    userStore.availableRoles = initialUser.available_roles as any;
    userStore.currentContext = initialUser.current_context;
    userStore.isLoggedIn = true;

    // 2. Mock Cloud Function Response
    const targetRole = 'farmer';
    const updatedUser = {
      ...initialUser,
      role: targetRole,
      current_context: { farm_location: 'Eagle Peach Base' },
    };

    mockCallFunction.mockResolvedValue({
      result: {
        code: 0,
        msg: 'Success',
        data: updatedUser,
      },
    });

    // 3. Execute Switch Action
    const result = await userStore.switchRole(targetRole);

    // 4. Assertions
    expect(result).toBe(true);
    // Verify Cloud Function was called with correct args
    expect(mockCallFunction).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'userService',
        data: expect.objectContaining({
          action: 'switchRole',
          data: { targetRoleCode: targetRole },
        }),
      }),
    );
    // Verify Store State Update
    expect(userStore.role).toBe(targetRole);
    expect(userStore.currentContext).toEqual({ farm_location: 'Eagle Peach Base' });
    // Verify Local Storage Update
    expect(uni.setStorageSync).toHaveBeenCalled();
  });

  it('should fail to switch if user does not have the target role', async () => {
    const userStore = useUserStore();

    // Setup User with ONLY local_admin role
    userStore.userInfo = {
      _id: 'user_123',
      available_roles: [{ role_code: 'local_admin' }],
    } as any;
    userStore.availableRoles = [{ role_code: 'local_admin' }] as any;

    // Attempt to switch to 'farmer'
    const result = await userStore.switchRole('farmer');

    expect(result).toBe(false);
    expect(mockCallFunction).not.toHaveBeenCalled(); // Should fail locally before cloud call
    expect(uni.showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '无权切换到该角色',
      }),
    );
  });
});
