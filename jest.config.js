module.exports = {
  testEnvironment: 'jest-environment-node',
  roots: ['<rootDir>/tests/e2e'],
  testMatch: ['<rootDir>/tests/e2e/**/*.test.js'],
  modulePathIgnorePatterns: ['<rootDir>/.baseline/', '<rootDir>/.cache/', '<rootDir>/dist/'],
  testTimeout: 90000,
  verbose: true,
};
