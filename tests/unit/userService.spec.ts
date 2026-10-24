import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useUserStore } from '../../src/stores/user';
import {
  checkUserAuditPermission,
  listPendingUsers,
  auditUser,
  approveUser,
  rejectUser,
} from '../../src/services/userService';

const mockCallFunction = vi.fn();
vi.stubGlobal('wx', {
  cloud: {
    callFunction: mockCallFunction,
  },
});

vi.stubGlobal('uni', {
  showToast: vi.fn(),
  showLoading: vi.fn(),
  hideLoading: vi.fn(),
});

describe('UserService - 用户审核', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  describe('checkUserAuditPermission - 审核权限检查', () => {
    it('should allow local_admin to audit users', () => {
      const store = useUserStore();
      store.userInfo = { _id: 'test', name: 'Admin', role: 'local_admin', status: 'active' } as any;
      store.role = 'local_admin';
      store.status = 'active';
      store.isLoggedIn = true;

      expect(checkUserAuditPermission().allowed).toBe(true);
    });

    it('should deny farmer role', () => {
      const store = useUserStore();
      store.userInfo = { _id: 'test', name: 'Farmer', role: 'farmer', status: 'active' } as any;
      store.role = 'farmer';
      store.status = 'active';
      store.isLoggedIn = true;

      const result = checkUserAuditPermission();
      expect(result.allowed).toBe(false);
      expect(result.error).toContain('只有村委才有审核权限');
    });

    it('should deny when not logged in', () => {
      const store = useUserStore();
      store.isLoggedIn = false;

      const result = checkUserAuditPermission();
      expect(result.allowed).toBe(false);
      expect(result.error).toBe('请先登录');
    });

    it('should deny when status is banned', () => {
      const store = useUserStore();
      store.userInfo = { _id: 'test', name: 'Admin', role: 'local_admin', status: 'banned' } as any;
      store.role = 'local_admin';
      store.status = 'banned';
      store.isLoggedIn = true;

      const result = checkUserAuditPermission();
      expect(result.allowed).toBe(false);
      expect(result.error).toContain('账号状态异常');
    });
  });

  describe('listPendingUsers - 获取待审核用户列表', () => {
    it('should get pending users successfully', async () => {
      const store = useUserStore();
      store.userInfo = { _id: 'test', name: 'Admin', role: 'local_admin', status: 'active' } as any;
      store.role = 'local_admin';
      store.status = 'active';
      store.isLoggedIn = true;

      mockCallFunction.mockResolvedValue({
        result: {
          code: 0,
          data: {
            list: [
              { _id: 'user1', name: 'User 1', phone: '13800138000', role: 'farmer' },
              { _id: 'user2', name: 'User 2', phone: '13800138001', role: 'school_admin' },
            ],
            total: 2,
          },
        },
      });

      const result = await listPendingUsers();
      expect(result.success).toBe(true);
      expect(result.data?.list.length).toBe(2);
    });

    it('should return empty list when no pending users', async () => {
      const store = useUserStore();
      store.userInfo = { _id: 'test', name: 'Admin', role: 'local_admin', status: 'active' } as any;
      store.role = 'local_admin';
      store.status = 'active';
      store.isLoggedIn = true;

      mockCallFunction.mockResolvedValue({
        result: { code: 0, data: { list: [], total: 0 } },
      });

      const result = await listPendingUsers();
      expect(result.success).toBe(true);
      expect(result.data?.list.length).toBe(0);
    });

    it('should fail permission check', async () => {
      const store = useUserStore();
      store.isLoggedIn = false;

      const result = await listPendingUsers();
      expect(result.success).toBe(false);
      expect(mockCallFunction).not.toHaveBeenCalled();
    });
  });

  describe('auditUser - 审核用户', () => {
    it('should approve user successfully', async () => {
      const store = useUserStore();
      store.userInfo = { _id: 'test', name: 'Admin', role: 'local_admin', status: 'active' } as any;
      store.role = 'local_admin';
      store.status = 'active';
      store.isLoggedIn = true;

      mockCallFunction.mockResolvedValue({
        result: { code: 0, msg: 'Success' },
      });

      const result = await auditUser({ targetUserId: 'user_123', action: 'approve' });
      expect(result.success).toBe(true);
    });

    it('should reject user with reason', async () => {
      const store = useUserStore();
      store.userInfo = { _id: 'test', name: 'Admin', role: 'local_admin', status: 'active' } as any;
      store.role = 'local_admin';
      store.status = 'active';
      store.isLoggedIn = true;

      mockCallFunction.mockResolvedValue({
        result: { code: 0, msg: 'Success' },
      });

      const result = await auditUser({
        targetUserId: 'user_123',
        action: 'reject',
        reason: '资料不全',
      });
      expect(result.success).toBe(true);
    });

    it('should fail with empty userId', async () => {
      const store = useUserStore();
      store.isLoggedIn = true;
      store.role = 'local_admin';
      store.status = 'active';

      const result = await auditUser({ targetUserId: '', action: 'approve' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('用户ID不能为空');
    });

    it('should fail with invalid action', async () => {
      const store = useUserStore();
      store.isLoggedIn = true;
      store.role = 'local_admin';
      store.status = 'active';

      const result = await auditUser({ targetUserId: 'user_123', action: 'invalid' as any });
      expect(result.success).toBe(false);
      expect(result.error).toBe('审核操作无效');
    });

    it('should handle API error', async () => {
      const store = useUserStore();
      store.userInfo = { _id: 'test', name: 'Admin', role: 'local_admin', status: 'active' } as any;
      store.role = 'local_admin';
      store.status = 'active';
      store.isLoggedIn = true;

      mockCallFunction.mockResolvedValue({
        result: { code: 500, msg: 'Database error' },
      });

      const result = await auditUser({ targetUserId: 'user_123', action: 'approve' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Database error');
    });
  });

  describe('approveUser / rejectUser - 快捷方法', () => {
    it('approveUser should call auditUser with approve action', async () => {
      const store = useUserStore();
      store.userInfo = { _id: 'test', name: 'Admin', role: 'local_admin', status: 'active' } as any;
      store.role = 'local_admin';
      store.status = 'active';
      store.isLoggedIn = true;

      mockCallFunction.mockResolvedValue({
        result: { code: 0, msg: 'Success' },
      });

      const result = await approveUser('user_123');
      expect(result.success).toBe(true);

      expect(mockCallFunction).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            data: expect.objectContaining({
              action: 'approve',
            }),
          }),
        })
      );
    });

    it('rejectUser should call auditUser with reject action', async () => {
      const store = useUserStore();
      store.userInfo = { _id: 'test', name: 'Admin', role: 'local_admin', status: 'active' } as any;
      store.role = 'local_admin';
      store.status = 'active';
      store.isLoggedIn = true;

      mockCallFunction.mockResolvedValue({
        result: { code: 0, msg: 'Success' },
      });

      const result = await rejectUser('user_123', '不符合要求');
      expect(result.success).toBe(true);

      expect(mockCallFunction).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            data: expect.objectContaining({
              action: 'reject',
              reason: '不符合要求',
            }),
          }),
        })
      );
    });
  });
});
