import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useSettingsStore } from '../stores/settings';

// Mock uni-app APIs
vi.stubGlobal('uni', {
  getStorageSync: vi.fn(),
  setStorageSync: vi.fn(),
});

describe('Settings Store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('should have default largeTextMode as false', () => {
    const store = useSettingsStore();
    expect(store.largeTextMode).toBe(false);
  });

  it('should init settings from storage', () => {
    const store = useSettingsStore();
    (uni.getStorageSync as any).mockReturnValue(true);

    store.initSettings();

    expect(uni.getStorageSync).toHaveBeenCalledWith('largeTextMode');
    expect(store.largeTextMode).toBe(true);
  });

  it('should toggle largeTextMode and save to storage', () => {
    const store = useSettingsStore();
    store.largeTextMode = false;

    store.toggleLargeTextMode();

    expect(store.largeTextMode).toBe(true);
    expect(uni.setStorageSync).toHaveBeenCalledWith('largeTextMode', true);

    store.toggleLargeTextMode();
    expect(store.largeTextMode).toBe(false);
    expect(uni.setStorageSync).toHaveBeenCalledWith('largeTextMode', false);
  });
});
