import { defineStore } from 'pinia';

export const useSettingsStore = defineStore('settings', {
  state: () => ({
    largeTextMode: false,
  }),
  actions: {
    initSettings() {
      try {
        const stored = uni.getStorageSync('largeTextMode');
        if (stored !== '') {
          this.largeTextMode = stored;
        }
      } catch (e) {
        console.error('Failed to load settings', e);
      }
    },
    toggleLargeTextMode() {
      this.largeTextMode = !this.largeTextMode;
      try {
        uni.setStorageSync('largeTextMode', this.largeTextMode);
      } catch (e) {
        console.error('Failed to save settings', e);
      }
    },
  },
});
