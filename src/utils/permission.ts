import { useUserStore } from '@/stores/user';

/**
 * Permission check utility for frontend authorization
 * @description Check user permissions before performing actions
 */

export type ActionType =
  | 'publish_demand'
  | 'claim_task'
  | 'audit_demand'
  | 'view_stats'
  | 'create_as_admin';

interface PermissionConfig {
  action: ActionType;
  requiredRoles: string[];
  loginRequired: boolean;
  targetPage?: string;
  failMessage?: string;
}

const PERMISSION_MAP: Record<string, PermissionConfig> = {
  publish_demand: {
    action: 'publish_demand',
    requiredRoles: ['farmer'],
    loginRequired: true,
    failMessage: '只有认证农户才能发布需求',
  },
  create_as_admin: {
    action: 'create_as_admin',
    requiredRoles: ['local_admin'],
    loginRequired: true,
    failMessage: '只有村委/地方团委才能代发需求',
  },
  claim_task: {
    action: 'claim_task',
    requiredRoles: ['school_admin'],
    loginRequired: true,
    failMessage: '只有高校师生才能认领任务',
  },
  audit_demand: {
    action: 'audit_demand',
    requiredRoles: ['local_admin'],
    loginRequired: true,
    failMessage: '只有地方团委才能审核需求',
  },
  view_stats: {
    action: 'view_stats',
    requiredRoles: ['school_admin', 'local_admin'],
    loginRequired: true,
    failMessage: '权限不足，无法查看统计数据',
  },
};

/**
 * Check if user has permission to perform action
 * @param action - Action identifier
 * @returns { hasPermission: boolean; config?: PermissionConfig }
 */
export const checkPermission = (
  action: ActionType,
): { hasPermission: boolean; config?: PermissionConfig } => {
  const userStore = useUserStore();
  const config = PERMISSION_MAP[action];

  if (!config) {
    console.warn(`[Permission] Unknown action: ${action}`);
    return { hasPermission: false };
  }

  if (config.loginRequired && !userStore.isLoggedIn) {
    return { hasPermission: false, config };
  }

  const hasRole = config.requiredRoles.includes(userStore.role);
  const isActive = userStore.status === 'active';

  return {
    hasPermission: hasRole && isActive,
    config,
  };
};

/**
 * Navigate to action with permission check
 * @param action - Action identifier
 * @param targetPage - Target page URL if permitted
 * @param onFail - Callback when permission denied
 */
export const navigateWithPermission = (
  action: ActionType,
  targetPage: string,
  onFail?: () => void,
): void => {
  const { hasPermission, config } = checkPermission(action);

  if (hasPermission) {
    uni.navigateTo({ url: targetPage });
  } else {
    if (config?.failMessage) {
      uni.showToast({
        title: config.failMessage,
        icon: 'none',
        duration: 2000,
      });
    }
    onFail?.();
  }
};

/**
 * Show permission denied modal
 * @param message - Custom message
 * @param onConfirm - Callback when user confirms
 */
export const showPermissionDeniedModal = (
  message: string = '无操作权限，请前往个人中心进行身份认证',
  onConfirm?: () => void,
): void => {
  uni.showModal({
    title: '权限提示',
    content: message,
    confirmText: '前往认证',
    cancelText: '取消',
    success: (res) => {
      if (res.confirm) {
        onConfirm?.();
      }
    },
  });
};

/**
 * Require login or redirect to login page
 * @param redirectPath - Path to redirect after login
 */
export const requireLogin = (redirectPath?: string): boolean => {
  const userStore = useUserStore();

  if (!userStore.isLoggedIn) {
    const loginPath = redirectPath
      ? `/pages/login/login?redirect=${encodeURIComponent(redirectPath)}`
      : '/pages/login/login';
    uni.navigateTo({ url: loginPath });
    return false;
  }

  return true;
};

/**
 * Validate user role for specific page
 * @param pageName - Page identifier
 * @returns boolean
 */
export const validatePageAccess = (pageName: string): boolean => {
  const userStore = useUserStore();
  const pageRoles: Record<string, string[]> = {
    'demand-create': ['farmer', 'local_admin'],
    'claimed-tasks': ['school_admin'],
    'audit-manage': ['local_admin'],
    'stats-dashboard': ['school_admin', 'local_admin'],
  };

  const allowedRoles = pageRoles[pageName];
  if (!allowedRoles) return true;

  return allowedRoles.includes(userStore.role);
};

export default {
  checkPermission,
  navigateWithPermission,
  showPermissionDeniedModal,
  requireLogin,
  validatePageAccess,
};
