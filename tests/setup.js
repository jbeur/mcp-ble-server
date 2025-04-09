// Mock console methods to avoid noise during tests
global.console = {
  ...console,
  // Keep error logging for debugging
  error: jest.fn(),
  // Mock other console methods
  log: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn()
};

// Mock setInterval and clearInterval
global.setInterval = jest.fn();
global.clearInterval = jest.fn();

// Mock logger
const mockLogger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
};

jest.mock('../src/utils/logger', () => mockLogger);

// Mock metrics
const mockMetrics = {
  increment: jest.fn(),
  gauge: jest.fn(),
  histogram: {
    observe: jest.fn()
  },
  Counter: jest.fn().mockImplementation(() => ({
    inc: jest.fn()
  })),
  Gauge: jest.fn().mockImplementation(() => ({
    set: jest.fn()
  }))
};

jest.mock('../src/utils/metrics', () => mockMetrics);

// Mock process.env
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.LOG_LEVEL = 'debug';

// Global test timeout
jest.setTimeout(10000);

// Reset all mocks before each test
beforeEach(() => {
  jest.clearAllMocks();
});

// Clean up mocks after each test
afterEach(() => {
  jest.clearAllMocks();
}); 