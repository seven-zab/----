import { useUserStore } from '@/stores/user';

export interface DemandFormData {
  title: string;
  content: string;
  type: 'enterprise' | 'agriculture' | 'research';
  subType: string;
  images?: string[];
  attachments?: any[];
  extra?: Record<string, any>;
}

export interface Demand {
  _id: string;
  title: string;
  content: string;
  type: string;
  subType: string;
  status: 'pending' | 'approved' | 'rejected' | 'claimed' | 'completed';
  publisherId: string;
  publisherName: string;
  created_at: number;
  extra?: Record<string, any>;
}

export interface DemandListResult {
  list: Demand[];
  total: number;
}

const validateDemandForm = (data: DemandFormData): { valid: boolean; error?: string } => {
  if (!data.title || data.title.trim() === '') {
    return { valid: false, error: '请填写需求标题' };
  }
  if (!data.content || data.content.trim() === '') {
    return { valid: false, error: '请填写需求描述' };
  }
  if (!data.type) {
    return { valid: false, error: '请选择需求类型' };
  }
  return { valid: true };
};

const checkPublishPermission = (): { allowed: boolean; error?: string } => {
  const userStore = useUserStore();
  if (!userStore.isLoggedIn) {
    return { allowed: false, error: '请先登录' };
  }
  if (userStore.role !== 'farmer' && userStore.role !== 'local_admin') {
    return { allowed: false, error: '只有认证农户或村委才能发布需求' };
  }
  if (userStore.status !== 'active') {
    return { allowed: false, error: '您的账号状态异常，无法发布需求' };
  }
  return { allowed: true };
};

const checkAuditPermission = (): { allowed: boolean; error?: string } => {
  const userStore = useUserStore();
  if (!userStore.isLoggedIn) {
    return { allowed: false, error: '请先登录' };
  }
  if (userStore.role !== 'local_admin') {
    return { allowed: false, error: '只有村委才有审核权限' };
  }
  if (userStore.status !== 'active') {
    return { allowed: false, error: '您的账号状态异常' };
  }
  return { allowed: true };
};

const checkClaimPermission = (): { allowed: boolean; error?: string } => {
  const userStore = useUserStore();
  if (!userStore.isLoggedIn) {
    return { allowed: false, error: '请先登录' };
  }
  if (userStore.role !== 'school_admin') {
    return { allowed: false, error: '只有高校师生才能接取任务' };
  }
  if (userStore.status !== 'active') {
    return { allowed: false, error: '您的账号状态异常' };
  }
  return { allowed: true };
};

export const publishDemand = async (data: DemandFormData): Promise<{ success: boolean; error?: string; demandId?: string }> => {
  const validation = validateDemandForm(data);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  const permission = checkPublishPermission();
  if (!permission.allowed) {
    return { success: false, error: permission.error };
  }

  try {
    const submitData = {
      title: data.title,
      content: data.content,
      type: data.type,
      subType: data.subType,
      images: data.images || [],
      extra: data.extra || {},
      attachments: data.attachments || [],
    };

    const { result } = await wx.cloud.callFunction({
      name: 'demandService',
      data: {
        action: 'create',
        data: submitData,
      },
    });

    if (result.code === 0) {
      return { success: true, demandId: result.data?._id };
    } else {
      return { success: false, error: result.msg || '提交失败' };
    }
  } catch (e: any) {
    return { success: false, error: e.message || '网络错误' };
  }
};

export const getMyDemands = async (): Promise<{ success: boolean; data?: DemandListResult; error?: string }> => {
  const userStore = useUserStore();
  if (!userStore.isLoggedIn) {
    return { success: false, error: '请先登录' };
  }

  try {
    const { result } = await wx.cloud.callFunction({
      name: 'demandService',
      data: {
        action: 'getMyDemands',
      },
    });

    if (result.code === 0) {
      return { success: true, data: result.data };
    } else {
      return { success: false, error: result.msg };
    }
  } catch (e: any) {
    return { success: false, error: e.message || '网络错误' };
  }
};

export const getDemandDetail = async (demandId: string): Promise<{ success: boolean; data?: Demand; error?: string }> => {
  if (!demandId) {
    return { success: false, error: '需求ID不能为空' };
  }

  try {
    const { result } = await wx.cloud.callFunction({
      name: 'demandService',
      data: {
        action: 'getDetail',
        data: { demandId },
      },
    });

    if (result.code === 0) {
      return { success: true, data: result.data };
    } else {
      return { success: false, error: result.msg };
    }
  } catch (e: any) {
    return { success: false, error: e.message || '网络错误' };
  }
};

export const auditDemand = async (demandId: string, action: 'approve' | 'reject', reason?: string): Promise<{ success: boolean; error?: string }> => {
  const permission = checkAuditPermission();
  if (!permission.allowed) {
    return { success: false, error: permission.error };
  }

  if (!demandId) {
    return { success: false, error: '需求ID不能为空' };
  }

  try {
    const { result } = await wx.cloud.callFunction({
      name: 'demandService',
      data: {
        action: 'audit',
        data: { demandId, action, reason },
      },
    });

    if (result.code === 0) {
      return { success: true };
    } else {
      return { success: false, error: result.msg };
    }
  } catch (e: any) {
    return { success: false, error: e.message || '网络错误' };
  }
};

export const claimTask = async (demandId: string): Promise<{ success: boolean; error?: string }> => {
  const permission = checkClaimPermission();
  if (!permission.allowed) {
    return { success: false, error: permission.error };
  }

  if (!demandId) {
    return { success: false, error: '需求ID不能为空' };
  }

  try {
    const { result } = await wx.cloud.callFunction({
      name: 'demandService',
      data: {
        action: 'claim',
        data: { demandId },
      },
    });

    if (result.code === 0) {
      return { success: true };
    } else {
      return { success: false, error: result.msg };
    }
  } catch (e: any) {
    return { success: false, error: e.message || '网络错误' };
  }
};

export const getClaimedTasks = async (): Promise<{ success: boolean; data?: DemandListResult; error?: string }> => {
  const userStore = useUserStore();
  if (!userStore.isLoggedIn) {
    return { success: false, error: '请先登录' };
  }

  try {
    const { result } = await wx.cloud.callFunction({
      name: 'demandService',
      data: {
        action: 'getClaimedTasks',
      },
    });

    if (result.code === 0) {
      return { success: true, data: result.data };
    } else {
      return { success: false, error: result.msg };
    }
  } catch (e: any) {
    return { success: false, error: e.message || '网络错误' };
  }
};

export const getPendingDemands = async (): Promise<{ success: boolean; data?: DemandListResult; error?: string }> => {
  const permission = checkAuditPermission();
  if (!permission.allowed) {
    return { success: false, error: permission.error };
  }

  try {
    const { result } = await wx.cloud.callFunction({
      name: 'demandService',
      data: {
        action: 'getPendingDemands',
      },
    });

    if (result.code === 0) {
      return { success: true, data: result.data };
    } else {
      return { success: false, error: result.msg };
    }
  } catch (e: any) {
    return { success: false, error: e.message || '网络错误' };
  }
};

export {
  validateDemandForm,
  checkPublishPermission,
  checkAuditPermission,
  checkClaimPermission,
};
