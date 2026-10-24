import { useUserStore } from '@/stores/user';

export type RoleChangeCallback = (newRole: string, oldRole: string) => void;
export type StatusChangeCallback = (newStatus: string, oldStatus: string) => void;

export interface UserStatusChangeEvent {
  type: 'role' | 'status' | 'available_roles';
  oldValue: unknown;
  newValue: unknown;
}

export type UserStatusChangeHandler = (event: UserStatusChangeEvent) => void;

class UserStatusWatcher {
  private timer: ReturnType<typeof setInterval> | null = null;
  private intervalMs: number = 30000;
  private changeHandlers: Set<UserStatusChangeHandler> = new Set();
  private lastKnownRole: string = '';
  private lastKnownStatus: string = '';

  constructor(intervalMs: number = 30000) {
    this.intervalMs = intervalMs;
  }

  start(intervalMs?: number): void {
    if (intervalMs) {
      this.intervalMs = intervalMs;
    }

    if (this.timer) {
      console.log('[UserStatusWatcher] Already running');
      return;
    }

    const userStore = useUserStore();
    if (!userStore.isLoggedIn) {
      console.log('[UserStatusWatcher] User not logged in, skipping start');
      return;
    }

    this.lastKnownRole = userStore.role;
    this.lastKnownStatus = userStore.status;

    console.log(`[UserStatusWatcher] Starting polling every ${this.intervalMs}ms`);

    this.timer = setInterval(async () => {
      await this.checkForUpdates();
    }, this.intervalMs);

    this.checkForUpdates();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('[UserStatusWatcher] Stopped polling');
    }
  }

  onUserStatusChange(handler: UserStatusChangeHandler): () => void {
    this.changeHandlers.add(handler);
    return () => {
      this.changeHandlers.delete(handler);
    };
  }

  private async checkForUpdates(): Promise<void> {
    const userStore = useUserStore();

    if (!userStore.isLoggedIn) {
      this.stop();
      return;
    }

    try {
      const success = await userStore.refreshUserInfo();

      if (success) {
        this.detectChanges(userStore);
      }
    } catch (error) {
      console.error('[UserStatusWatcher] Error checking for updates:', error);
    }
  }

  private detectChanges(userStore: ReturnType<typeof useUserStore>): void {
    const newRole = userStore.role;
    const newStatus = userStore.status;

    if (newRole !== this.lastKnownRole) {
      console.log(`[UserStatusWatcher] Role changed: ${this.lastKnownRole} -> ${newRole}`);

      this.changeHandlers.forEach(handler => {
        handler({
          type: 'role',
          oldValue: this.lastKnownRole,
          newValue: newRole
        });
      });

      this.lastKnownRole = newRole;
    }

    if (newStatus !== this.lastKnownStatus) {
      console.log(`[UserStatusWatcher] Status changed: ${this.lastKnownStatus} -> ${newStatus}`);

      this.changeHandlers.forEach(handler => {
        handler({
          type: 'status',
          oldValue: this.lastKnownStatus,
          newValue: newStatus
        });
      });

      this.lastKnownStatus = newStatus;
    }
  }

  isRunning(): boolean {
    return this.timer !== null;
  }

  getInterval(): number {
    return this.intervalMs;
  }

  setInterval(intervalMs: number): void {
    if (this.timer && intervalMs !== this.intervalMs) {
      this.stop();
      this.intervalMs = intervalMs;
      this.start();
    } else {
      this.intervalMs = intervalMs;
    }
  }
}

export const userStatusWatcher = new UserStatusWatcher(30000);

export default userStatusWatcher;
