import { defineStore } from 'pinia';
import { ref } from 'vue';

export interface UserRoleContext {
  role_code: 'farmer' | 'local_admin' | 'school_admin' | 'general_user';
  role_name: string;
  context: Record<string, any>;
}

export interface UserInfo {
  _id: string;
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

const CLOUD_ENV = 'test-yzxz-0g1jgylp46818d68';
const TOKEN_KEY = 'user_token';
const USER_INFO_KEY = 'user_info';
// Token expiry: 7 days in milliseconds
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const TOKEN_EXPIRY = 7 * 24 * 60 * 60 * 1000;

export const useUserStore = defineStore('user', () => {
  const userInfo = ref<UserInfo | null>(null);
  const isLoggedIn = ref(false);
  const role = ref<UserInfo['role']>('general_user');
  const status = ref<UserInfo['status']>('active');
  const currentContext = ref<Record<string, any>>({});
  const availableRoles = ref<UserRoleContext[]>([]);

  /**
   * Initialize user store from local storage
   * @description Check local storage for existing session and restore state
   */
  const initFromStorage = (): boolean => {
    try {
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

      const { result } = await wx.cloud.callFunction({
        name: 'login',
        config: { env: CLOUD_ENV },
      });

      console.log('[UserStore] Login result:', result);

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

      const { result } = await wx.cloud.callFunction({
        name: 'register',
        data: formData,
        config: { env: CLOUD_ENV },
      });

      console.log('[UserStore] Register result:', result);

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

      const { result } = await wx.cloud.callFunction({
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

      const { result } = await wx.cloud.callFunction({
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

      const { result } = await wx.cloud.callFunction({
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

      const { result } = await wx.cloud.callFunction({
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
   * Initialize admin roles (Development Helper)
   * @returns Promise<boolean>
   */
  const initAdminRoles = async (): Promise<boolean> => {
    try {
      const { result } = await wx.cloud.callFunction({
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

  return {
    userInfo,
    isLoggedIn,
    role,
    status,
    currentContext,
    availableRoles,
    initFromStorage,
    login,
    register,
    updateAvatar,
    updateProfile,
    getDemandStats,
    logout,
    hasRole,
    canPerformAction,
    switchRole,
    initAdminRoles,
  };
});
