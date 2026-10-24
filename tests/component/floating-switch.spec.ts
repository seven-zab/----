import { mount } from '@vue/test-utils';
import FloatingSwitch from '../../src/components/FloatingSwitch.vue';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

// Mock uni global
const mockGetMenuButtonBoundingClientRect = vi.fn(() => ({ bottom: 80 }));
vi.stubGlobal('uni', {
  getMenuButtonBoundingClientRect: mockGetMenuButtonBoundingClientRect,
});

describe('FloatingSwitch.vue', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockGetMenuButtonBoundingClientRect.mockClear();
  });

  it('renders correctly', () => {
    const wrapper = mount(FloatingSwitch);
    expect(wrapper.find('.floating-switch').exists()).toBe(true);
    expect(wrapper.text()).toContain('大字版');
  });

  it('calculates top position from menu button', async () => {
    const wrapper = mount(FloatingSwitch);

    // Wait for next tick to ensure onMounted and reactivity updates happen
    await wrapper.vm.$nextTick();

    // Check if the mock was called
    expect(mockGetMenuButtonBoundingClientRect).toHaveBeenCalled();

    // 80 + 10 = 90
    expect((wrapper.element as HTMLElement).style.top).toBe('90px');
  });
});
