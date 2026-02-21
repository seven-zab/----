import { defineConfig } from 'vite';
import uni from '@dcloudio/vite-plugin-uni';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [uni()],
  css: {
    preprocessorOptions: {
      scss: {
        // 抑制 sass 警告，特别是来自依赖包（如 wot-design-uni）的警告
        quietDeps: true,
        // 如果 sass 版本支持（>=1.74.0），可以使用 silenceDeprecations
        silenceDeprecations: ['legacy-js-api', 'import', 'global-builtin'],
      },
    },
  },
});
