import { getCloudEnvId } from '@/utils/cloud-init';
import { legacyCall } from '@/services/legacyCloudClient';
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export interface UserRoleContext {
  role_code: 'farmer' | 'local_admin' | 'school_admin' | 'general_user';
  role_name: string;
  context: Record<string, any>;
}

export interface UserInfo {
  _id: string;
  openid?: string;
  name: string;
  phone: string;
  role: 'farmer' | 'local_admin' | 'school_admin' | 'general_user';
  status: 'pending' | 'active' | 'rejected' | 'banned';
  avatarUrl: string;
  current_context?: Record<string, any>;
  available_roles?: UserRoleContext[];
  audit_materials?: {
    name: string;
    phone: string;
    id_card?: string;
    verify_material?: string;
    school?: string;
    department?: string;
    student_id?: string;
    address?: string;
  };
  created_at: number;
}

export interface ApiResponse<T> {
  code: number;
  msg: string;
  data: T | null;
}

const CLOUD_ENV = getCloudEnvId();
const TOKEN_KEY = 'user_token';
const USER_INFO_KEY = 'user_info';
const TOKEN_EXPIRY = 7 * 24 * 60 * 60 * 1000;

interface TokenData {
  expiresAt: number;
  lastActiveTime: number;
}

export const useUserStore = defineStore('user', () => {
  const userInfo = ref<UserInfo | null>(null);
  const isLoggedIn = ref(false);
  const role = ref<UserInfo['role']>('general_user');
  const status = ref<UserInfo['status']>('active');
  const currentContext = ref<Record<string, any>>({});
  const availableRoles = ref<UserRoleContext[]>([]);

  /**
   * Check if session is expired based on last active time
   */
  const isSessionExpired = (): boolean => {
    try {
      const tokenData = uni.getStorageSync(TOKEN_KEY);
      if (!tokenData) return true;

      const parsed: TokenData = typeof tokenData === 'string' ? JSON.parse(tokenData) : tokenData;

      return Date.now() > parsed.expiresAt;
    } catch {
      return true;
    }
  };

  /**
   * Get time since last active (in days)
   */
  const getDaysSinceLastActive = (): number => {
    try {
      const tokenData = uni.getStorageSync(TOKEN_KEY);
      if (!tokenData) return 999;

      const parsed: TokenData = typeof tokenData === 'string' ? JSON.parse(tokenData) : tokenData;

      return Math.floor((Date.now() - parsed.lastActiveTime) / (1000 * 60 * 60 * 24));
    } catch {
      return 999;
    }
  };

  /**
   * Save session with expiry based on last active time
   */
  const saveSession = (): void => {
    const tokenData: TokenData = {
      expiresAt: Date.now() + TOKEN_EXPIRY,
      lastActiveTime: Date.now(),
    };
    uni.setStorageSync(TOKEN_KEY, JSON.stringify(tokenData));
  };

  /**
   * Update last active time (called on user actions)
   */
  const updateLastActiveTime = (): void => {
    try {
      const tokenData = uni.getStorageSync(TOKEN_KEY);
      if (tokenData) {
        const parsed: TokenData = typeof tokenData === 'string' ? JSON.parse(tokenData) : tokenData;
        parsed.lastActiveTime = Date.now();
        uni.setStorageSync(TOKEN_KEY, JSON.stringify(parsed));
      }
    } catch (e) {
      console.error('[UserStore] Failed to update last active time:', e);
    }
  };

  /**
   * Initialize user store from local storage
   * @description Check local storage for existing session and restore state
   */
  const initFromStorage = (): boolean => {
    try {
      if (isSessionExpired()) {
        const days = getDaysSinceLastActive();
        console.log(`[UserStore] Session expired (${days} days since last active)`);
        logout();
        return false;
      }

      const storedInfo = uni.getStorageSync(USER_INFO_KEY);
      if (storedInfo) {
        const parsed = typeof storedInfo === 'string' ? JSON.parse(storedInfo) : storedInfo;
        userInfo.value = parsed;
        role.value = parsed.role || 'general_user';
        status.value = parsed.status || 'active';
        currentContext.value = parsed.current_context || {};
        availableRoles.value = parsed.available_roles || [];
        isLoggedIn.value = true;
        return true;
      }
      return false;
    } catch (error) {
      console.error('[UserStore] Failed to init from storage:', error);
      return false;
    }
  };

  /**
   * Save user info to local storage
   * @param info - User information to store
   */
  const saveToStorage = (info: UserInfo): void => {
    try {
      uni.setStorageSync(USER_INFO_KEY, JSON.stringify(info));
    } catch (error) {
      console.error('[UserStore] Failed to save to storage:', error);
    }
  };

  /**
   * Perform WeChat login
   * @returns Promise<{ success: boolean; needRegister?: boolean; openid?: string }>
   * @throws {Error} Login failed
   */
  const login = async (): Promise<{
    success: boolean;
    needRegister?: boolean;
    openid?: string;
  }> => {
    try {
      console.log('[UserStore] Initiating login with env:', CLOUD_ENV);

      const { result } = await legacyCall<UserInfo>({
        name: 'login',
        config: { env: CLOUD_ENV },
      });

      if (!result) {
        throw new Error('No result returned from cloud function');
      }

      if (result.code === 0) {
        const userData = result.data as UserInfo;
        userInfo.value = userData;
        role.value = userData.role;
        status.value = userData.status;
        currentContext.value = userData.current_context || {};
        availableRoles.value = userData.available_roles || [];
        isLoggedIn.value = true;
        saveToStorage(userData);
        saveSession();
        console.info('[UserStore] Login successful for user:', userData._id);
        return { success: true };
      } else if (result.code === 404) {
        console.info('[UserStore] User not found, need registration');
        return { success: false, needRegister: true, openid: result.data.openid };
      } else {
        throw new Error(result.msg || 'Unknown error');
      }
    } catch (error: any) {
      console.error('[UserStore] Login error:', error);
      let errorMsg = '登录失败，请稍后重试';

      if (error.errMsg) {
        if (error.errMsg.includes('env check invalid')) {
          errorMsg = '环境配置错误：请确保云函数已部署且环境ID正确';
        } else if (error.errMsg.includes('login:fail user deny')) {
          errorMsg = '您取消了授权，请重新点击登录';
        } else if (error.errMsg.includes('cloud.callFunction:fail')) {
          if (error.message?.includes('functions execute fail')) {
            errorMsg = '云服务暂时不可用，请联系管理员';
          } else {
            errorMsg = '网络连接异常，请检查网络设置';
          }
        }
      } else if (error.message) {
        errorMsg = error.message;
      }

      uni.showToast({ title: errorMsg, icon: 'none', duration: 3000 });
      throw error;
    }
  };

  /**
   * Register new user
   * @param formData - Registration form data
   * @returns Promise<{ success: boolean }>
   * @throws {Error} Registration failed
   */
  const register = async (formData: Partial<UserInfo>): Promise<{ success: boolean }> => {
    try {
      if (!formData.name || !formData.phone) {
        throw new Error('请填写完整信息');
      }

      const { result } = await legacyCall<UserInfo>({
        name: 'register',
        data: formData,
        config: { env: CLOUD_ENV },
      });

      if (result.code === 0) {
        const userData = result.data as UserInfo;
        userInfo.value = userData;
        role.value = userData.role;
        status.value = userData.status;
        isLoggedIn.value = true;
        saveToStorage(userData);
        console.info('[UserStore] Registration successful for user:', userData._id);
        return { success: true };
      } else {
        throw new Error(result.msg);
      }
    } catch (error: any) {
      console.error('[UserStore] Register error:', error);
      uni.showToast({ title: error.message || '注册失败', icon: 'none' });
      throw error;
    }
  };

  /**
   * Update user avatar
   * @param avatarUrl - New avatar cloud path
   * @returns Promise<boolean>
   */
  const updateAvatar = async (avatarUrl: string): Promise<boolean> => {
    try {
      if (!userInfo.value?._id) {
        throw new Error('User not logged in');
      }

      const { result } = await legacyCall<null>({
        name: 'userService',
        data: {
          action: 'updateAvatar',
          data: {
            _id: userInfo.value._id,
            avatarUrl,
          },
        },
        config: { env: CLOUD_ENV },
      });

      if (result.code === 0) {
        userInfo.value.avatarUrl = avatarUrl;
        saveToStorage(userInfo.value);
        console.info('[UserStore] Avatar updated successfully');
        return true;
      } else {
        throw new Error(result.msg);
      }
    } catch (error: any) {
      console.error('[UserStore] Update avatar error:', error);
      uni.showToast({ title: error.message || '头像更新失败', icon: 'none' });
      return false;
    }
  };

  /**
   * Update user profile
   * @param profileData - Profile fields to update
   * @returns Promise<boolean>
   */
  const updateProfile = async (profileData: Partial<UserInfo>): Promise<boolean> => {
    try {
      if (!userInfo.value?._id) {
        throw new Error('User not logged in');
      }

      const { result } = await legacyCall<null>({
        name: 'userService',
        data: {
          action: 'updateProfile',
          data: {
            _id: userInfo.value._id,
            ...profileData,
          },
        },
        config: { env: CLOUD_ENV },
      });

      if (result.code === 0) {
        userInfo.value = { ...userInfo.value, ...profileData };
        saveToStorage(userInfo.value);
        console.info('[UserStore] Profile updated successfully');
        return true;
      } else {
        throw new Error(result.msg);
      }
    } catch (error: any) {
      console.error('[UserStore] Update profile error:', error);
      uni.showToast({ title: error.message || '资料更新失败', icon: 'none' });
      return false;
    }
  };

  /**
   * Get demand statistics for current user
   * @returns Promise<{ published: number; processing: number; completed: number }>
   */
  const getDemandStats = async (): Promise<{
    published: number;
    processing: number;
    completed: number;
  }> => {
    try {
      if (!userInfo.value?._id) {
        throw new Error('User not logged in');
      }

      const { result } = await legacyCall<{
        published: number;
        processing: number;
        completed: number;
      }>({
        name: 'demandService',
        data: {
          action: 'getUserStats',
          data: { userId: userInfo.value._id },
        },
        config: { env: CLOUD_ENV },
      });

      if (result.code === 0) {
        return result.data;
      } else {
        throw new Error(result.msg);
      }
    } catch (error) {
      console.error('[UserStore] Get demand stats error:', error);
      return { published: 0, processing: 0, completed: 0 };
    }
  };

  /**
   * Clear user session and logout
   * @description Remove all user data from state and local storage
   */
  const logout = (): void => {
    userInfo.value = null;
    isLoggedIn.value = false;
    role.value = 'general_user';
    status.value = 'active';
    uni.removeStorageSync(USER_INFO_KEY);
    uni.removeStorageSync(TOKEN_KEY);
    console.info('[UserStore] User logged out');
  };

  /**
   * Check if user has required role for certain actions
   * @param requiredRoles - Array of roles that are allowed
   * @returns boolean
   */
  const hasRole = (requiredRoles: UserInfo['role'][]): boolean => {
    return requiredRoles.includes(role.value);
  };

  /**
   * Check if user can perform specific action based on role
   * @param action - Action identifier
   * @returns boolean
   */
  const canPerformAction = (
    action: 'publish_demand' | 'claim_task' | 'audit_demand' | 'create_as_admin',
  ): boolean => {
    const permissionMap: Record<string, UserInfo['role'][]> = {
      publish_demand: ['farmer'],
      create_as_admin: ['local_admin'],
      claim_task: ['school_admin'],
      audit_demand: ['local_admin'],
    };
    const allowedRoles = permissionMap[action] || [];
    return hasRole(allowedRoles) && status.value === 'active';
  };

  /**
   * Switch user role
   * @param targetRoleCode - The role code to switch to
   * @returns Promise<boolean>
   */
  const switchRole = async (targetRoleCode: string): Promise<boolean> => {
    try {
      if (!userInfo.value?._id) {
        throw new Error('User not logged in');
      }

      const targetRole = availableRoles.value.find((r) => r.role_code === targetRoleCode);
      if (!targetRole) {
        throw new Error('无权切换到该角色');
      }

      const { result } = await legacyCall<UserInfo>({
        name: 'userService',
        data: {
          action: 'switchRole',
          data: {
            targetRoleCode,
          },
        },
        config: { env: CLOUD_ENV },
      });

      if (result.code === 0) {
        const updatedUser = result.data as UserInfo;
        userInfo.value = updatedUser;
        role.value = updatedUser.role;
        currentContext.value = updatedUser.current_context || {};
        // availableRoles usually doesn't change on switch, but good to sync
        availableRoles.value = updatedUser.available_roles || availableRoles.value;

        saveToStorage(updatedUser);
        console.info('[UserStore] Role switched successfully to:', targetRoleCode);
        return true;
      } else {
        throw new Error(result.msg);
      }
    } catch (error: any) {
      console.error('[UserStore] Switch role error:', error);
      uni.showToast({ title: error.message || '切换身份失败', icon: 'none' });
      return false;
    }
  };

  /**
   * Refresh user info silently
   * @description Fetch latest user info from cloud and update store
   * @returns Promise<boolean>
   */
  const refreshUserInfo = async (): Promise<boolean> => {
    try {
      if (!isLoggedIn.value) return false;

      const oldRole = role.value;
      const oldStatus = status.value;

      const { result } = await legacyCall<UserInfo>({
        name: 'login',
        config: { env: CLOUD_ENV },
      });

      if (result.code === 0) {
        const userData = result.data as UserInfo;
        const hasChanged =
          userData.role !== oldRole ||
          userData.status !== oldStatus ||
          JSON.stringify(userData.current_context) !== JSON.stringify(currentContext.value);

        userInfo.value = userData;
        role.value = userData.role;
        status.value = userData.status;
        currentContext.value = userData.current_context || {};
        availableRoles.value = userData.available_roles || [];

        saveToStorage(userData);
        saveSession();

        if (hasChanged) {
          console.info('[UserStore] User info refreshed with changes:', {
            oldRole,
            newRole: userData.role,
            oldStatus,
            newStatus: userData.status,
          });
        } else {
          console.info('[UserStore] User info refreshed (no changes):', userData._id);
        }
        return true;
      }
      return false;
    } catch (error) {
      console.error('[UserStore] Refresh info error:', error);
      return false;
    }
  };

  /**
   * Initialize admin roles (Development Helper)
   * @returns Promise<boolean>
   */
  const initAdminRoles = async (): Promise<boolean> => {
    try {
      const { result } = await legacyCall<UserInfo>({
        name: 'userService',
        data: {
          action: 'initUserRoles',
        },
        config: { env: CLOUD_ENV },
      });

      if (result.code === 0) {
        // Refresh user info
        const userData = result.data as UserInfo;
        userInfo.value = userData;
        role.value = userData.role;
        currentContext.value = userData.current_context || {};
        availableRoles.value = userData.available_roles || [];
        saveToStorage(userData);
        return true;
      }
      return false;
    } catch (e) {
      console.error(e);
      return false;
    }
  };

  const canChat = computed(() => {
    return role.value !== 'general_user';
  });

  return {
    canChat,
    userInfo,
    isLoggedIn,
    role,
    status,
    currentContext,
    availableRoles,
    initFromStorage,
    saveToStorage,
    login,
    register,
    updateAvatar,
    updateProfile,
    getDemandStats,
    logout,
    hasRole,
    canPerformAction,
    switchRole,
    refreshUserInfo,
    initAdminRoles,
    isSessionExpired,
    getDaysSinceLastActive,
    updateLastActiveTime,
  };
});
