import { legacyCall } from '@/services/legacyCloudClient';
import { useUserStore } from '@/stores/user';

export interface PendingUser {
  _id: string;
  name: string;
  phone: string;
  role: string;
  verify_material?: string;
  created_at: number;
}

export interface UserListResult {
  list: PendingUser[];
  total: number;
}

export interface AuditUserData {
  targetUserId: string;
  action: 'approve' | 'reject';
  reason?: string;
}

const checkUserAuditPermission = (): { allowed: boolean; error?: string } => {
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

export const listPendingUsers = async (): Promise<{
  success: boolean;
  data?: UserListResult;
  error?: string;
}> => {
  const permission = checkUserAuditPermission();
  if (!permission.allowed) {
    return { success: false, error: permission.error };
  }

  try {
    const { result } = await legacyCall<UserListResult>({
      name: 'userService',
      data: { action: 'listPendingUsers' },
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

export const auditUser = async (
  data: AuditUserData,
): Promise<{ success: boolean; error?: string }> => {
  const permission = checkUserAuditPermission();
  if (!permission.allowed) {
    return { success: false, error: permission.error };
  }

  if (!data.targetUserId) {
    return { success: false, error: '用户ID不能为空' };
  }

  if (!data.action || !['approve', 'reject'].includes(data.action)) {
    return { success: false, error: '审核操作无效' };
  }

  try {
    const { result } = await legacyCall<null>({
      name: 'userService',
      data: {
        action: 'auditUser',
        data,
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

export const approveUser = async (
  userId: string,
): Promise<{ success: boolean; error?: string }> => {
  return auditUser({ targetUserId: userId, action: 'approve' });
};

export const rejectUser = async (
  userId: string,
  reason?: string,
): Promise<{ success: boolean; error?: string }> => {
  return auditUser({ targetUserId: userId, action: 'reject', reason });
};

export { checkUserAuditPermission };
