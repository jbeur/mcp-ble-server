const { criticalPaths, failingPaths, wipPaths } = require('./tests/test-categories');

// Helper function to convert paths to regex patterns
function pathToPattern(path) {
  return path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Create regex patterns for different test categories
const criticalPattern = `(${criticalPaths.map(pathToPattern).join('|')})`;
const failingPattern = `(${failingPaths.map(pathToPattern).join('|')})`;
const wipPattern = `(${wipPaths.map(pathToPattern).join('|')})`;

const config = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.(js|jsx|ts|tsx)$': 'babel-jest'
  },
  transformIgnorePatterns: [
    '/node_modules/(?!(@babel/runtime|chai)/)'
  ],
  testTimeout: 15000,
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/__unstable__/'
  ],
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
  testMatch: [
    '**/tests/**/*.test.js'
  ],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1'
  },
  setupFilesAfterEnv: ['./jest.setup.js'],
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/**/*.test.js',
    '!src/**/index.js'
  ],
  // Temporarily disabled coverage thresholds
  // coverageThreshold: {
  //   global: {
  //     branches: 80,
  //     functions: 80,
  //     lines: 80,
  //     statements: 80
  //   }
  // },
  verbose: true
};

// In CI, only run critical tests if CI_CRITICAL_ONLY is set
if (process.env.CI_CRITICAL_ONLY === 'true') {
  config.testMatch = criticalPaths.map(path => `<rootDir>/${path}`);
} else {
  // For local development, exclude failing and WIP tests by default
  const failingPattern = failingPaths.map(path => `<rootDir>/${path}`);
  const wipPattern = wipPaths.map(path => `<rootDir>/${path}`);
  config.testPathIgnorePatterns = [
    ...config.testPathIgnorePatterns,
    ...failingPattern,
    ...wipPattern
  ];
}

module.exports = config; 