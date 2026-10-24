import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useUserStore } from '../../src/stores/user';
import {
  validateDemandForm,
  checkPublishPermission,
  checkAuditPermission,
  checkClaimPermission,
  publishDemand,
  getMyDemands,
  getDemandDetail,
  auditDemand,
  claimTask,
  getClaimedTasks,
  getPendingDemands,
} from '../../src/services/demandService';

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

describe('DemandService - 需求发布', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  describe('validateDemandForm - 表单验证', () => {
    it('should pass validation with valid data', () => {
      const validData = {
        title: '测试需求',
        content: '这是需求描述',
        type: 'enterprise' as const,
        subType: 'production_tech',
      };
      expect(validateDemandForm(validData).valid).toBe(true);
    });

    it('should fail when title is empty', () => {
      const data = {
        title: '',
        content: '内容',
        type: 'enterprise' as const,
        subType: 'production_tech',
      };
      const result = validateDemandForm(data);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('请填写需求标题');
    });

    it('should fail when content is empty', () => {
      const data = {
        title: '标题',
        content: '',
        type: 'enterprise' as const,
        subType: 'production_tech',
      };
      const result = validateDemandForm(data);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('请填写需求描述');
    });

    it('should fail when type is missing', () => {
      const data = {
        title: '标题',
        content: '内容',
        type: '' as any,
        subType: 'production_tech',
      };
      const result = validateDemandForm(data);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('请选择需求类型');
    });

    it('should fail when title is only whitespace', () => {
      const data = {
        title: '   ',
        content: '内容',
        type: 'enterprise' as const,
        subType: 'production_tech',
      };
      const result = validateDemandForm(data);
      expect(result.valid).toBe(false);
    });
  });

  describe('checkPublishPermission - 发布权限检查', () => {
    it('should allow farmer role to publish', () => {
      const store = useUserStore();
      store.userInfo = { _id: 'test', name: 'Test', role: 'farmer', status: 'active' } as any;
      store.role = 'farmer';
      store.status = 'active';
      store.isLoggedIn = true;

      expect(checkPublishPermission().allowed).toBe(true);
    });

    it('should allow local_admin role to publish', () => {
      const store = useUserStore();
      store.userInfo = { _id: 'test', name: 'Test', role: 'local_admin', status: 'active' } as any;
      store.role = 'local_admin';
      store.status = 'active';
      store.isLoggedIn = true;

      expect(checkPublishPermission().allowed).toBe(true);
    });

    it('should deny general_user role', () => {
      const store = useUserStore();
      store.userInfo = { _id: 'test', name: 'Test', role: 'general_user', status: 'active' } as any;
      store.role = 'general_user';
      store.status = 'active';
      store.isLoggedIn = true;

      const result = checkPublishPermission();
      expect(result.allowed).toBe(false);
      expect(result.error).toContain('只有认证农户或村委才能发布需求');
    });

    it('should deny when not logged in', () => {
      const store = useUserStore();
      store.isLoggedIn = false;

      const result = checkPublishPermission();
      expect(result.allowed).toBe(false);
      expect(result.error).toBe('请先登录');
    });

    it('should deny when status is banned', () => {
      const store = useUserStore();
      store.userInfo = { _id: 'test', name: 'Test', role: 'farmer', status: 'banned' } as any;
      store.role = 'farmer';
      store.status = 'banned';
      store.isLoggedIn = true;

      const result = checkPublishPermission();
      expect(result.allowed).toBe(false);
      expect(result.error).toContain('账号状态异常');
    });
  });

  describe('publishDemand - 发布需求', () => {
    it('should publish successfully as farmer', async () => {
      const store = useUserStore();
      store.userInfo = { _id: 'test', name: 'Test', role: 'farmer', status: 'active' } as any;
      store.role = 'farmer';
      store.status = 'active';
      store.isLoggedIn = true;

      mockCallFunction.mockResolvedValue({
        result: { code: 0, msg: 'Success', data: { _id: 'demand_123' } },
      });

      const result = await publishDemand({
        title: '测试需求',
        content: '测试内容',
        type: 'enterprise',
        subType: 'production_tech',
      });

      expect(result.success).toBe(true);
      expect(result.demandId).toBe('demand_123');
    });

    it('should fail validation before API call', async () => {
      const store = useUserStore();
      store.isLoggedIn = true;
      store.role = 'farmer';
      store.status = 'active';

      const result = await publishDemand({
        title: '',
        content: '内容',
        type: 'enterprise',
        subType: 'production_tech',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('请填写需求标题');
      expect(mockCallFunction).not.toHaveBeenCalled();
    });

    it('should fail permission check before API call', async () => {
      const store = useUserStore();
      store.isLoggedIn = true;
      store.role = 'general_user';
      store.status = 'active';

      const result = await publishDemand({
        title: '标题',
        content: '内容',
        type: 'enterprise',
        subType: 'production_tech',
      });

      expect(result.success).toBe(false);
      expect(mockCallFunction).not.toHaveBeenCalled();
    });

    it('should handle API error', async () => {
      const store = useUserStore();
      store.userInfo = { _id: 'test', name: 'Test', role: 'farmer', status: 'active' } as any;
      store.role = 'farmer';
      store.status = 'active';
      store.isLoggedIn = true;

      mockCallFunction.mockResolvedValue({
        result: { code: 500, msg: 'Server error' },
      });

      const result = await publishDemand({
        title: '标题',
        content: '内容',
        type: 'enterprise',
        subType: 'production_tech',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Server error');
    });

    it('should handle network exception', async () => {
      const store = useUserStore();
      store.userInfo = { _id: 'test', name: 'Test', role: 'farmer', status: 'active' } as any;
      store.role = 'farmer';
      store.status = 'active';
      store.isLoggedIn = true;

      mockCallFunction.mockRejectedValue(new Error('Network error'));

      const result = await publishDemand({
        title: '标题',
        content: '内容',
        type: 'enterprise',
        subType: 'production_tech',
      });

      expect(result.success).toBe(false);
    });
  });
});

describe('DemandService - 需求审核', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  describe('checkAuditPermission - 审核权限检查', () => {
    it('should allow local_admin to audit', () => {
      const store = useUserStore();
      store.userInfo = { _id: 'test', name: 'Test', role: 'local_admin', status: 'active' } as any;
      store.role = 'local_admin';
      store.status = 'active';
      store.isLoggedIn = true;

      expect(checkAuditPermission().allowed).toBe(true);
    });

    it('should deny farmer role', () => {
      const store = useUserStore();
      store.userInfo = { _id: 'test', name: 'Test', role: 'farmer', status: 'active' } as any;
      store.role = 'farmer';
      store.status = 'active';
      store.isLoggedIn = true;

      const result = checkAuditPermission();
      expect(result.allowed).toBe(false);
      expect(result.error).toContain('只有村委才有审核权限');
    });
  });

  describe('auditDemand - 审核需求', () => {
    it('should approve demand successfully', async () => {
      const store = useUserStore();
      store.userInfo = { _id: 'test', name: 'Admin', role: 'local_admin', status: 'active' } as any;
      store.role = 'local_admin';
      store.status = 'active';
      store.isLoggedIn = true;

      mockCallFunction.mockResolvedValue({
        result: { code: 0, msg: 'Success' },
      });

      const result = await auditDemand('demand_123', 'approve', '符合要求');
      expect(result.success).toBe(true);
    });

    it('should reject demand successfully', async () => {
      const store = useUserStore();
      store.userInfo = { _id: 'test', name: 'Admin', role: 'local_admin', status: 'active' } as any;
      store.role = 'local_admin';
      store.status = 'active';
      store.isLoggedIn = true;

      mockCallFunction.mockResolvedValue({
        result: { code: 0, msg: 'Success' },
      });

      const result = await auditDemand('demand_123', 'reject', '不符合要求');
      expect(result.success).toBe(true);
    });

    it('should fail with empty demandId', async () => {
      const store = useUserStore();
      store.isLoggedIn = true;
      store.role = 'local_admin';
      store.status = 'active';

      const result = await auditDemand('', 'approve');
      expect(result.success).toBe(false);
      expect(result.error).toBe('需求ID不能为空');
    });
  });
});

describe('DemandService - 接取任务', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  describe('checkClaimPermission - 接取权限检查', () => {
    it('should allow school_admin to claim', () => {
      const store = useUserStore();
      store.userInfo = { _id: 'test', name: 'Student', role: 'school_admin', status: 'active' } as any;
      store.role = 'school_admin';
      store.status = 'active';
      store.isLoggedIn = true;

      expect(checkClaimPermission().allowed).toBe(true);
    });

    it('should deny farmer role', () => {
      const store = useUserStore();
      store.userInfo = { _id: 'test', name: 'Farmer', role: 'farmer', status: 'active' } as any;
      store.role = 'farmer';
      store.status = 'active';
      store.isLoggedIn = true;

      const result = checkClaimPermission();
      expect(result.allowed).toBe(false);
      expect(result.error).toContain('只有高校师生才能接取任务');
    });
  });

  describe('claimTask - 接取任务', () => {
    it('should claim task successfully', async () => {
      const store = useUserStore();
      store.userInfo = { _id: 'test', name: 'Student', role: 'school_admin', status: 'active' } as any;
      store.role = 'school_admin';
      store.status = 'active';
      store.isLoggedIn = true;

      mockCallFunction.mockResolvedValue({
        result: { code: 0, msg: 'Success' },
      });

      const result = await claimTask('demand_456');
      expect(result.success).toBe(true);
    });

    it('should fail with empty demandId', async () => {
      const store = useUserStore();
      store.isLoggedIn = true;
      store.role = 'school_admin';
      store.status = 'active';

      const result = await claimTask('');
      expect(result.success).toBe(false);
      expect(result.error).toBe('需求ID不能为空');
    });
  });
});

describe('DemandService - 查询需求', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  describe('getMyDemands - 获取我的需求', () => {
    it('should get demands successfully', async () => {
      const store = useUserStore();
      store.isLoggedIn = true;

      mockCallFunction.mockResolvedValue({
        result: { code: 0, data: { list: [{ _id: '1', title: 'Test' }], total: 1 } },
      });

      const result = await getMyDemands();
      expect(result.success).toBe(true);
      expect(result.data?.list.length).toBe(1);
    });

    it('should fail when not logged in', async () => {
      const store = useUserStore();
      store.isLoggedIn = false;

      const result = await getMyDemands();
      expect(result.success).toBe(false);
      expect(result.error).toBe('请先登录');
    });
  });

  describe('getDemandDetail - 获取需求详情', () => {
    it('should get detail successfully', async () => {
      mockCallFunction.mockResolvedValue({
        result: { code: 0, data: { _id: 'demand_123', title: 'Test' } },
      });

      const result = await getDemandDetail('demand_123');
      expect(result.success).toBe(true);
      expect(result.data?.title).toBe('Test');
    });

    it('should fail with empty id', async () => {
      const result = await getDemandDetail('');
      expect(result.success).toBe(false);
      expect(result.error).toBe('需求ID不能为空');
    });
  });

  describe('getClaimedTasks - 获取已认领任务', () => {
    it('should get claimed tasks successfully', async () => {
      const store = useUserStore();
      store.isLoggedIn = true;

      mockCallFunction.mockResolvedValue({
        result: { code: 0, data: { list: [], total: 0 } },
      });

      const result = await getClaimedTasks();
      expect(result.success).toBe(true);
    });
  });

  describe('getPendingDemands - 获取待审核需求', () => {
    it('should get pending demands as local_admin', async () => {
      const store = useUserStore();
      store.isLoggedIn = true;
      store.role = 'local_admin';
      store.status = 'active';

      mockCallFunction.mockResolvedValue({
        result: { code: 0, data: { list: [], total: 0 } },
      });

      const result = await getPendingDemands();
      expect(result.success).toBe(true);
    });

    it('should deny farmer role', async () => {
      const store = useUserStore();
      store.isLoggedIn = true;
      store.role = 'farmer';
      store.status = 'active';

      const result = await getPendingDemands();
      expect(result.success).toBe(false);
    });
  });
});
