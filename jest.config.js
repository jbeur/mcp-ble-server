module.exports = {
    testEnvironment: 'node',
    moduleFileExtensions: ['js', 'json'],
    transform: {},
    testMatch: ['**/tests/**/*.test.js'],
    moduleDirectories: ['node_modules'],
    verbose: true,
    collectCoverage: true,
    coverageReporters: ['text', 'lcov'],
    coverageDirectory: 'coverage',
    testTimeout: 10000,
    transformIgnorePatterns: [
        'node_modules/(?!(chai)/)'
    ]
}; 