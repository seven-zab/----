import { mount } from '@vue/test-utils';
import LargeTextSwitch from '../../src/components/large-text-switch/large-text-switch.vue';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetStorageSync = vi.fn();
const mockSetStorageSync = vi.fn();
const mockShowToast = vi.fn();

vi.stubGlobal('uni', {
  getStorageSync: mockGetStorageSync,
  setStorageSync: mockSetStorageSync,
  showToast: mockShowToast,
});

describe('LargeTextSwitch.vue', () => {
  beforeEach(() => {
    mockGetStorageSync.mockReturnValue(false);
  });

  it('renders correctly', () => {
    const wrapper = mount(LargeTextSwitch);
    expect(wrapper.find('.large-text-switch').exists()).toBe(true);
    expect(wrapper.find('.switch-label').text()).toBe('标准版');
  });

  it('loads state from storage on mount', async () => {
    mockGetStorageSync.mockReturnValue(true);
    const wrapper = mount(LargeTextSwitch);
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    expect(mockGetStorageSync).toHaveBeenCalledWith('large_text_mode');
    expect(wrapper.find('.switch-label').text()).toBe('大字版');
  });

  it('toggles label when enabled changes', async () => {
    const wrapper = mount(LargeTextSwitch) as any;
    expect(wrapper.find('.switch-label').text()).toBe('标准版');

    wrapper.vm.isEnabled = true;
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.switch-label').text()).toBe('大字版');
  });

  it('saves state when handleChange is called', () => {
    const wrapper = mount(LargeTextSwitch) as any;
    wrapper.vm.handleChange(true);
    expect(mockSetStorageSync).toHaveBeenCalledWith('large_text_mode', true);
  });
});
