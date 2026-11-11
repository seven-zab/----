/* eslint-env node */
require('@rushstack/eslint-patch/modern-module-resolution');

module.exports = {
  root: true,
  extends: [
    'plugin:vue/vue3-essential',
    'eslint:recommended',
    '@vue/eslint-config-typescript',
    '@vue/eslint-config-prettier',
  ],
  parserOptions: {
    ecmaVersion: 'latest',
  },
  rules: {
    'vue/multi-word-component-names': 'off',
  },
  overrides: [
    { files: ['tests/e2e/**/*.cjs'], env: { node: true, commonjs: true } },
    {
      files: ['server/**/*.ts', 'tests/helpers/**/*.ts', 'tests/unit/v2-*.ts'],
      env: { node: true },
    },
    {
      files: ['src/components/SchemaForm.vue'],
      rules: { 'vue/no-mutating-props': ['error', { shallowOnly: true }] },
    },
    {
      files: ['cloudfunctions/**/*.js'],
      env: {
        node: true,
        commonjs: true,
      },
      rules: {
        '@typescript-eslint/no-var-requires': 'off',
        'no-undef': 'off',
        'no-unused-vars': 'off',
      },
    },
    {
      files: ['tests/e2e/**/*.test.js'],
      env: {
        jest: true,
        node: true,
      },
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      rules: {
        'no-undef': 'off',
      },
    },
    {
      files: ['jest.config.js', 'vitest.config.ts'],
      env: {
        node: true,
      },
      rules: {
        'no-undef': 'off',
      },
    },
  ],
};
